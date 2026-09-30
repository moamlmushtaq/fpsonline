// Server integration: boots the real Node server on a random port and drives it
// with `ws` clients — quick play with bot fill, snapshots/inputs/pong, private
// rooms, account tokens in hello, abuse handling and snapshot backpressure.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, QUEUE_BOT_FILL_AFTER, ROOM_CODE_LENGTH, SNAPSHOT_EVERY_TICKS } from '../../src/shared/constants';
import type { AuthResponse, ClientMsg, HelloMsg, ServerMsg } from '../../src/shared/protocol';
import type { GameEvent, InputCmd } from '../../src/shared/types';
import { startServer, type RunningServer } from '../../src/server/index';
import { HARD_BUFFER_BYTES, SNAPSHOT_SKIP_BYTES, SocketConnection, type SocketLike } from '../../src/server/ws';

type Msg<T extends ServerMsg['type']> = Extract<ServerMsg, { type: T }>;

class Client {
  readonly msgs: ServerMsg[] = [];
  closeCode: number | null = null;
  private readonly listeners = new Set<() => void>();

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      this.msgs.push(JSON.parse(d.toString()) as ServerMsg);
      for (const l of [...this.listeners]) l();
    });
    ws.on('close', (code) => {
      this.closeCode = code;
      for (const l of [...this.listeners]) l();
    });
  }

  static open(url: string): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const c = new Client(ws);
      ws.once('open', () => resolve(c));
      ws.once('error', reject);
    });
  }

  send(msg: ClientMsg | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  of<T extends ServerMsg['type']>(type: T): Msg<T>[] {
    return this.msgs.filter((m) => m.type === type) as Msg<T>[];
  }

  /** Resolves with the first message (index ≥ from) of `type` matching `pred`. */
  wait<T extends ServerMsg['type']>(type: T, pred: (m: Msg<T>) => boolean = () => true, timeoutMs = 5000, from = 0): Promise<Msg<T>> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        for (let i = from; i < this.msgs.length; i++) {
          const m = this.msgs[i];
          if (m.type === type && pred(m as Msg<T>)) {
            done();
            resolve(m as Msg<T>);
            return true;
          }
        }
        if (this.closeCode !== null) {
          done();
          reject(new Error(`socket closed (${this.closeCode}) while waiting for ${type}`));
          return true;
        }
        return false;
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`timeout waiting for ${type}`));
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        this.listeners.delete(listener);
      };
      const listener = () => void check();
      this.listeners.add(listener);
      check();
    });
  }

  waitClose(timeoutMs = 5000): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.closeCode !== null) return resolve(this.closeCode);
      const timer = setTimeout(() => reject(new Error('timeout waiting for close')), timeoutMs);
      this.ws.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

function hello(name: string, over: Partial<HelloMsg> = {}): HelloMsg {
  return {
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    name,
    platform: 'desktop',
    lang: 'en',
    level: 3,
    rating: 1000,
    loadout: { primary: 'meridian', throwable: 'smoke' },
    cosmetics: { armor: 'standard', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: {} },
    faction: 0,
    ...over,
  };
}

function cmd(seq: number, mz = 1): InputCmd {
  return { seq, mx: 0, mz, yaw: 0, pitch: 0, buttons: 0, slot: 0, viewTick: 0 };
}

let srv: RunningServer;
let tmp: string;
let wsUrl: string;
const clients: Client[] = [];

async function connect(name?: string, over: Partial<HelloMsg> = {}): Promise<Client> {
  const c = await Client.open(wsUrl);
  clients.push(c);
  if (name) {
    c.send(hello(name, over));
    await c.wait('welcome');
  }
  return c;
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'hf-ws-'));
  srv = await startServer({ port: 0, host: '127.0.0.1', dev: false, dataDir: path.join(tmp, 'data'), clientDir: path.join(tmp, 'none'), log: false });
  wsUrl = `ws://127.0.0.1:${srv.port}/ws`;
});

afterAll(async () => {
  for (const c of clients) c.ws.terminate();
  await srv?.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('WebSocket server', () => {
  it('quick play: two humans matched into one bot-filled TDM room, snaps with self, inputs acked, pong', async () => {
    const a = await connect('Alpha');
    const b = await connect('Bravo');
    expect(a.of('welcome')[0]).toMatchObject({ protocol: PROTOCOL_VERSION, host: 'online', name: 'Alpha' });
    expect(a.of('welcome')[0].serverVersion).toBeTruthy();

    const queuedAt = Date.now();
    const q: ClientMsg = { type: 'queue', mode: 'tdm', map: 'any', botDifficulty: 'recruit', kind: 'quick' };
    a.send(q);
    b.send(q);
    await a.wait('queueStatus', (m) => m.state === 'searching');

    const limit = (QUEUE_BOT_FILL_AFTER + 2) * 1000;
    const [ma, mb] = await Promise.all([a.wait('matchStart', undefined, limit), b.wait('matchStart', undefined, limit)]);
    expect(Date.now() - queuedAt).toBeLessThan(limit);
    // Same room: same seed/map, both humans in one complete roster with bots.
    expect(ma.seed).toBe(mb.seed);
    expect(ma.config).toEqual(mb.config);
    expect(ma.config.mode).toBe('tdm');
    expect(ma.players).toHaveLength(10);
    const names = ma.players.map((p) => p.name);
    expect(names).toContain('Alpha');
    expect(names).toContain('Bravo');
    expect(ma.players.filter((p) => p.isBot)).toHaveLength(8);
    expect(ma.you).not.toBe(mb.you);
    expect(a.of('queueStatus').some((m) => m.state === 'found')).toBe(true);

    // Snapshots carry the receiver's authoritative self state.
    const first = await a.wait('snap', (s) => !!s.self);
    expect(first.self!.alive).toBe(true);
    expect(first.players.length).toBe(10);

    // Stream inputs at ~60 Hz for a while; the host must ack them.
    let seq = 0;
    const streamStart = Date.now();
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const cmds: InputCmd[] = [];
        seq++;
        for (let s = Math.max(1, seq - 3); s <= seq; s++) cmds.push(cmd(s));
        a.send({ type: 'input', cmds });
        if (Date.now() - streamStart > 1200) {
          clearInterval(timer);
          resolve();
        }
      }, 16);
    });
    const acked = await a.wait('snap', (s) => (s.self?.ack ?? 0) >= seq, 3000);
    expect(acked.self!.ack).toBe(seq);

    // The host loop runs at 60 Hz: snapshot ticks advance ~60/s in steps of SNAPSHOT_EVERY_TICKS.
    const snaps = a.of('snap');
    const recent = snaps.slice(-20);
    for (let i = 1; i < recent.length; i++) expect((recent[i].tick - recent[i - 1].tick) % SNAPSHOT_EVERY_TICKS).toBe(0);
    const startTick = snaps[snaps.length - 1].tick;
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 1000));
    const endSnap = a.of('snap').at(-1)!;
    const rate = ((endSnap.tick - startTick) * 1000) / (Date.now() - t0);
    expect(rate).toBeGreaterThan(50);
    expect(rate).toBeLessThan(70);

    // Application-level ping → pong with the room tick.
    a.send({ type: 'ping', t: 12345 });
    const pong = await a.wait('pong', (p) => p.t === 12345);
    expect(pong.tick).toBeGreaterThan(0);

    // Scoreboards arrive once per second and include every player.
    const sb = await a.wait('scoreboard', undefined, 3000);
    expect(sb.rows).toHaveLength(10);

    const status = (await (await fetch(`${srv.url}/api/status`)).json()) as { online: number; rooms: number };
    expect(status.online).toBeGreaterThanOrEqual(2);
    expect(status.rooms).toBeGreaterThanOrEqual(1);

    a.close();
    b.close();
  }, 20_000);

  it('private rooms: create → join by code → host-only start → both start the same match', async () => {
    const host = await connect('Charlie');
    const guest = await connect('Delta');
    host.send({ type: 'createRoom', mode: 'ffa', map: 'pastel', botFill: true, botDifficulty: 'veteran' });
    const created = await host.wait('roomState');
    expect(created.code).toHaveLength(ROOM_CODE_LENGTH);
    expect(created.state).toBe('lobby');
    expect(created.players).toHaveLength(1);
    expect(created.players[0]).toMatchObject({ name: 'Charlie', host: true });

    guest.send({ type: 'joinRoom', code: created.code.toLowerCase() });
    const joined = await guest.wait('roomState', (r) => r.players.length === 2);
    expect(joined.code).toBe(created.code);
    await host.wait('roomState', (r) => r.players.length === 2);

    guest.send({ type: 'startRoom' });
    const err = await guest.wait('error');
    expect(err.code).toBe('not_host');

    host.send({ type: 'startRoom' });
    const [sh, sg] = await Promise.all([host.wait('matchStart'), guest.wait('matchStart')]);
    expect(sh.seed).toBe(sg.seed);
    expect(sh.config).toMatchObject({ mode: 'ffa', map: 'pastel', roomCode: created.code });
    expect(sh.players).toHaveLength(8);
    await guest.wait('roomState', (r) => r.state === 'playing');

    const stranger = await connect('Echo');
    stranger.send({ type: 'joinRoom', code: 'ZZZZZ' });
    expect((await stranger.wait('error')).code).toBe('room_not_found');
    stranger.send({ type: 'joinRoom', code: created.code });
    expect((await stranger.wait('error', (e) => e.code !== 'room_not_found')).code).toBe('room_started');
  }, 15_000);

  it('account tokens in hello resolve to the account name', async () => {
    const res = await fetch(`${srv.url}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Foxtrot_7', password: 'hunter22' }),
    });
    const auth = (await res.json()) as AuthResponse;
    expect(auth.ok).toBe(true);
    const c = await Client.open(wsUrl);
    clients.push(c);
    c.send(hello('SomethingElse', { token: auth.token! }));
    expect((await c.wait('welcome')).name).toBe('Foxtrot_7');
  });

  it('rejects abusive clients: floods are closed with 1008, garbage is ignored', async () => {
    const c = await connect('Golf');
    c.send({ type: 'nope' });
    c.ws.send('{not json');
    c.send({ type: 'ping', t: 1 });
    expect((await c.wait('pong')).t).toBe(1); // still alive after a little garbage
    for (let i = 0; i < 1500; i++) c.send({ type: 'input', cmds: [cmd(i + 1)] });
    expect(await c.waitClose(5000)).toBe(1008);
  });

  it('refuses upgrades on paths other than /ws', async () => {
    await expect(Client.open(`ws://127.0.0.1:${srv.port}/other`)).rejects.toBeTruthy();
  });

  it('fails cleanly when the port is taken', async () => {
    await expect(
      startServer({ port: srv.port, host: '127.0.0.1', dataDir: path.join(tmp, 'data2'), clientDir: path.join(tmp, 'none'), log: false, prewarm: false }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});

describe('graceful shutdown', () => {
  it('closes sockets with 1012 and flushes accounts to disk', async () => {
    const dataDir = path.join(tmp, 'shutdown-data');
    const s = await startServer({ port: 0, host: '127.0.0.1', dataDir, clientDir: path.join(tmp, 'none'), log: false, prewarm: false });
    const reg = await fetch(`${s.url}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hotel', password: 'password' }),
    });
    expect(reg.status).toBe(200);
    const c = await Client.open(`ws://127.0.0.1:${s.port}/ws`);
    c.send(hello('India'));
    await c.wait('welcome');
    const closed = c.waitClose(3000);
    await s.close();
    expect(await closed).toBe(1012);
    const saved = JSON.parse(readFileSync(path.join(dataDir, 'accounts.json'), 'utf8')) as { accounts: { name: string }[] };
    expect(saved.accounts.map((a) => a.name)).toEqual(['Hotel']);
    await s.close(); // idempotent
  });
});

// ── Backpressure (unit) ───────────────────────────────────────────────────

class FakeSocket implements SocketLike {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  sent: string[] = [];
  terminated = false;
  send(data: string): void {
    this.sent.push(data);
  }
  ping(): void {}
  close(): void {}
  terminate(): void {
    this.terminated = true;
  }
}

function snap(tick: number, events: GameEvent[]): ServerMsg {
  return {
    type: 'snap',
    tick,
    clock: { phase: 'live', phaseLeft: 100, elapsed: 1, teamScores: [0, 0] },
    players: [],
    projectiles: [],
    smokes: [],
    zones: [],
    pickups: [],
    targets: [],
    events,
  };
}

describe('SocketConnection backpressure', () => {
  const kill: GameEvent = { t: 'kill', k: 1, v: 2, w: 'meridian', head: false, assist: -1, streak: 1 };
  const shot: GameEvent = { t: 'shot', p: 1, w: 'meridian', o: { x: 0, y: 0, z: 0 }, hits: [] };

  it('skips snapshots above the threshold and carries important events into the next one', () => {
    const sock = new FakeSocket();
    const conn = new SocketConnection('t1', sock, '127.0.0.1');
    sock.bufferedAmount = SNAPSHOT_SKIP_BYTES + 1;
    conn.send(snap(3, [kill, shot]));
    expect(sock.sent).toHaveLength(0);
    expect(conn.skippedSnaps).toBe(1);
    // Non-snapshot messages still go out.
    conn.send({ type: 'pong', t: 1, tick: 3 });
    expect(sock.sent).toHaveLength(1);

    sock.bufferedAmount = 0;
    conn.send(snap(6, []));
    const out = JSON.parse(sock.sent[1]) as Msg<'snap'>;
    expect(out.tick).toBe(6);
    expect(out.events).toEqual([kill]); // cosmetic 'shot' dropped as stale
    conn.send(snap(9, []));
    expect((JSON.parse(sock.sent[2]) as Msg<'snap'>).events).toEqual([]);
  });

  it('terminates clients that stop reading entirely', () => {
    const sock = new FakeSocket();
    const conn = new SocketConnection('t2', sock, '127.0.0.1');
    sock.bufferedAmount = HARD_BUFFER_BYTES + 1;
    conn.send({ type: 'pong', t: 1, tick: 0 });
    expect(sock.terminated).toBe(true);
    expect(sock.sent).toHaveLength(0);
  });

  it('measures a smoothed RTT from ping/pong', () => {
    const sock = new FakeSocket();
    const conn = new SocketConnection('t3', sock, '127.0.0.1', undefined, 0);
    expect(conn.heartbeat(1000)).toBe(true);
    conn.onPong(1040);
    expect(conn.rttMs).toBe(40);
    expect(conn.heartbeat(6000)).toBe(true);
    conn.onPong(6080);
    expect(conn.rttMs).toBeCloseTo(50);
    expect(conn.heartbeat(11_000)).toBe(true);
    // No pong for a whole interval → dead.
    expect(conn.heartbeat(16_000)).toBe(false);
  });
});
