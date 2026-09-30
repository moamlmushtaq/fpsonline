// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — WebSocket ⇄ HostCore glue (endpoint /ws).
//
// One SocketConnection (a HostConnection) per socket:
//  • send(): JSON per message. Under backpressure (bufferedAmount > 256 KB)
//    snapshots are SKIPPED, never queued — the next snapshot is a full state
//    anyway. Gameplay-relevant events of a skipped snapshot (kills, spawns,
//    hits, zone changes, roster…) are carried into the next one that is sent;
//    purely cosmetic ones (tracers, reload sounds…) are dropped as stale.
//    A client that stops reading entirely (> 2 MB buffered) is terminated.
//  • rttMs: smoothed from ws ping/pong, pinged on connect and every 5 s; a
//    socket that misses a pong for a full interval is terminated.
//  • Input hygiene: text frames only, JSON parsed in try/catch, message type
//    whitelist, token buckets (≤ 120 msgs/s overall, ≤ 70 input msgs/s
//    averaged). Violations add "strikes" that decay over time; sustained abuse
//    closes the socket with 1008. No hello within 15 s → closed.
// The gateway also caps total connections and connections per IP.
// permessage-deflate is OFF (latency + CPU), maxPayload 64 KB.
// ─────────────────────────────────────────────────────────────────────────────

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { HostConnection, HostCore } from '../shared/host/host-core';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import type { GameEvent } from '../shared/types';
import { clientIp, type LogFn, type ProxyTrust } from './http-util';

export const WS_PATH = '/ws';
export const WS_MAX_PAYLOAD = 64 * 1024;
/** Above this many buffered bytes, snapshots for that client are skipped. */
export const SNAPSHOT_SKIP_BYTES = 256 * 1024;
/** Above this, the client is not reading at all: terminate. */
export const HARD_BUFFER_BYTES = 2 * 1024 * 1024;
export const HEARTBEAT_MS = 5000;
export const HELLO_TIMEOUT_MS = 15_000;

const MSG_RATE = 120;
const MSG_BURST = 240;
const INPUT_RATE = 70;
const INPUT_BURST = 140;
const STRIKE_DECAY_PER_SEC = 20;
const STRIKE_LIMIT = 100;
const MAX_CARRIED_EVENTS = 256;

/** Closing codes (RFC 6455 / IANA registry). */
export const CLOSE_POLICY = 1008;
export const CLOSE_RESTART = 1012;
export const CLOSE_TRY_LATER = 1013;

const CLIENT_TYPES: ReadonlySet<string> = new Set<ClientMsg['type']>([
  'hello',
  'queue',
  'cancelQueue',
  'createRoom',
  'joinRoom',
  'roomSettings',
  'roomTeam',
  'startRoom',
  'leave',
  'input',
  'loadout',
  'ping',
  'range',
]);

/** Events worth delivering late when the snapshot that carried them was skipped. */
const CARRY_EVENTS: ReadonlySet<GameEvent['t']> = new Set<GameEvent['t']>([
  'hit',
  'dmg',
  'kill',
  'spawn',
  'pickup',
  'pickupSpawn',
  'zone',
  'target',
  'phase',
  'announce',
  'join',
  'leave',
  'teamSwap',
]);

class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.last = now;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** The subset of a ws WebSocket a connection uses (lets tests substitute a fake). */
export interface SocketLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  ping(): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

/** Serialized form of messages sent identically to many clients (scoreboards). */
const sharedJson = new WeakMap<object, string>();

export class SocketConnection implements HostConnection {
  rttMs: number | undefined = undefined;
  /** Snapshots skipped because of backpressure (diagnostics). */
  skippedSnaps = 0;
  closed = false;
  helloSeen = false;
  alive = true;
  readonly openedAt: number;
  private pingAt = 0;
  private strikes = 0;
  private strikesAt: number;
  private readonly msgBucket: TokenBucket;
  private readonly inputBucket: TokenBucket;
  private carry: GameEvent[] = [];

  constructor(
    readonly id: string,
    readonly ws: SocketLike,
    readonly ip: string,
    private readonly log: LogFn = () => {},
    now = performance.now(),
  ) {
    this.openedAt = now;
    this.strikesAt = now;
    this.msgBucket = new TokenBucket(MSG_RATE, MSG_BURST, now);
    this.inputBucket = new TokenBucket(INPUT_RATE, INPUT_BURST, now);
  }

  send(msg: ServerMsg): void {
    const ws = this.ws;
    if (this.closed || ws.readyState !== WebSocket.OPEN) return;
    const buffered = ws.bufferedAmount;
    if (buffered > HARD_BUFFER_BYTES) {
      this.log(`ws ${this.id}: client not reading (${buffered} bytes buffered) — terminating`);
      this.closed = true;
      ws.terminate();
      return;
    }
    let out: ServerMsg = msg;
    if (msg.type === 'snap') {
      if (buffered > SNAPSHOT_SKIP_BYTES) {
        this.skippedSnaps++;
        for (const e of msg.events) if (CARRY_EVENTS.has(e.t) && this.carry.length < MAX_CARRIED_EVENTS) this.carry.push(e);
        return;
      }
      if (this.carry.length) {
        out = { ...msg, events: this.carry.concat(msg.events) };
        this.carry = [];
      }
    } else if (msg.type === 'matchStart') {
      this.carry = []; // events of a previous match are meaningless now
    }
    let text: string | undefined;
    if (msg.type === 'scoreboard') {
      text = sharedJson.get(msg);
      if (text === undefined) {
        text = JSON.stringify(msg);
        sharedJson.set(msg, text);
      }
    } else text = JSON.stringify(out);
    try {
      ws.send(text);
    } catch (err) {
      this.log(`ws ${this.id}: send failed`, err);
    }
  }

  /** Called for every inbound message. False → drop it (a strike was recorded). */
  admit(now: number, isInput: boolean): boolean {
    if (!this.msgBucket.take(now)) return this.strike(now, 1);
    if (isInput && !this.inputBucket.take(now)) return this.strike(now, 1);
    return true;
  }

  /** Records misbehaviour; closes the socket once the decayed strike score exceeds the limit. Returns false. */
  strike(now: number, weight: number): false {
    this.strikes = Math.max(0, this.strikes - ((now - this.strikesAt) / 1000) * STRIKE_DECAY_PER_SEC) + weight;
    this.strikesAt = now;
    if (this.strikes > STRIKE_LIMIT && !this.closed) {
      this.log(`ws ${this.id} (${this.ip}): closing for abuse`);
      this.closed = true;
      this.ws.close(CLOSE_POLICY, 'rate limit');
    }
    return false;
  }

  /** Heartbeat: returns false if the previous ping went unanswered (caller terminates). */
  heartbeat(now: number): boolean {
    if (!this.alive) return false;
    this.alive = false;
    this.pingAt = now;
    try {
      this.ws.ping();
    } catch {
      /* socket closing */
    }
    return true;
  }

  onPong(now: number): void {
    this.alive = true;
    if (this.pingAt > 0) {
      const sample = now - this.pingAt;
      this.pingAt = 0;
      // Smoothed like TCP's SRTT so the scoreboard ping doesn't flicker.
      this.rttMs = this.rttMs === undefined ? sample : this.rttMs * 0.75 + sample * 0.25;
    }
  }
}

export interface WsGatewayOptions {
  host: HostCore;
  /** How to derive client IPs for the per-IP cap (default: socket address). */
  proxy?: ProxyTrust;
  /** Total simultaneous sockets (default 1000). */
  maxConnections?: number;
  /** Simultaneous sockets per client IP (default 16). */
  maxPerIp?: number;
  heartbeatMs?: number;
  log?: LogFn;
  /** Called on every accepted client message (wakes an idle host loop). */
  onActivity?: () => void;
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

export class WsGateway {
  private readonly wss: WebSocketServer;
  private readonly host: HostCore;
  private readonly proxy: ProxyTrust;
  private readonly maxConnections: number;
  private readonly maxPerIp: number;
  private readonly log: LogFn;
  private readonly onActivity: () => void;
  private readonly conns = new Set<SocketConnection>();
  private readonly perIp = new Map<string, number>();
  private readonly heartbeatTimer: NodeJS.Timeout;
  private nextId = 1;
  private closing = false;

  constructor(opts: WsGatewayOptions) {
    this.host = opts.host;
    this.proxy = opts.proxy ?? { trust: false };
    this.maxConnections = opts.maxConnections ?? 1000;
    this.maxPerIp = opts.maxPerIp ?? 16;
    this.log = opts.log ?? (() => {});
    this.onActivity = opts.onActivity ?? (() => {});
    this.wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: WS_MAX_PAYLOAD, clientTracking: false });
    this.heartbeatTimer = setInterval(() => this.sweep(), opts.heartbeatMs ?? HEARTBEAT_MS);
    this.heartbeatTimer.unref();
  }

  get connectionCount(): number {
    return this.conns.size;
  }

  /** Handles an HTTP upgrade already routed to WS_PATH. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => socket.destroy());
    if (this.closing) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const ip = clientIp(req, this.proxy);
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      // Over capacity: accept, explain, close — a browser only sees a bare 1006 for a refused handshake.
      const perIp = this.perIp.get(ip) ?? 0;
      if (this.conns.size >= this.maxConnections || perIp >= this.maxPerIp) {
        ws.send(JSON.stringify({ type: 'error', code: 'server_full' } satisfies ServerMsg));
        ws.close(CLOSE_TRY_LATER, 'server full');
        return;
      }
      this.accept(ws, ip);
    });
  }

  private accept(ws: WebSocket, ip: string): void {
    const conn = new SocketConnection(`ws${this.nextId++}`, ws, ip, this.log);
    this.conns.add(conn);
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    ws.on('message', (data, isBinary) => this.onMessage(conn, data, isBinary));
    ws.on('pong', () => conn.onPong(performance.now()));
    ws.on('error', (err) => {
      this.log(`ws ${conn.id}: error`, err.message);
      ws.terminate();
    });
    ws.once('close', () => this.onClose(conn));
    this.host.connect(conn);
    conn.heartbeat(performance.now()); // early RTT sample
  }

  private onMessage(conn: SocketConnection, data: RawData, isBinary: boolean): void {
    if (conn.closed) return;
    const now = performance.now();
    if (isBinary) {
      conn.strike(now, 10);
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(rawToString(data));
    } catch {
      conn.strike(now, 10);
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      conn.strike(now, 10);
      return;
    }
    const type = (msg as { type?: unknown }).type;
    if (typeof type !== 'string' || !CLIENT_TYPES.has(type)) {
      conn.strike(now, 5);
      return;
    }
    if (!conn.admit(now, type === 'input')) return;
    if (type === 'hello') conn.helloSeen = true;
    try {
      this.host.receive(conn, msg as ClientMsg);
    } catch (err) {
      this.log(`ws ${conn.id}: host error`, err);
    }
    if (type !== 'input' && type !== 'ping') this.onActivity();
  }

  private onClose(conn: SocketConnection): void {
    conn.closed = true;
    if (!this.conns.delete(conn)) return;
    const n = (this.perIp.get(conn.ip) ?? 1) - 1;
    if (n > 0) this.perIp.set(conn.ip, n);
    else this.perIp.delete(conn.ip);
    try {
      this.host.disconnect(conn);
    } catch (err) {
      this.log(`ws ${conn.id}: disconnect error`, err);
    }
  }

  /** Heartbeat + hello timeout sweep. */
  private sweep(): void {
    const now = performance.now();
    for (const conn of this.conns) {
      const ws = conn.ws;
      if (!conn.heartbeat(now)) {
        ws.terminate();
        continue;
      }
      if (!conn.helloSeen && now - conn.openedAt > HELLO_TIMEOUT_MS) {
        conn.closed = true;
        ws.close(CLOSE_POLICY, 'hello timeout');
      }
    }
  }

  /** Closes every socket (1012 "service restart" so clients reconnect) and stops accepting. */
  async close(): Promise<void> {
    this.closing = true;
    clearInterval(this.heartbeatTimer);
    for (const conn of this.conns) {
      try {
        conn.ws.close(CLOSE_RESTART, 'server restart');
      } catch {
        /* ignore */
      }
    }
    // Give close frames a moment, then force the stragglers.
    const deadline = Date.now() + 1000;
    while (this.conns.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    for (const conn of [...this.conns]) {
      conn.ws.terminate();
      this.onClose(conn);
    }
    await new Promise<void>((r) => this.wss.close(() => r()));
  }
}
