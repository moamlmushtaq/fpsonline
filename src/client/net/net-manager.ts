// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — NetManager: server discovery + transport factories.
//
//  • Discovery is HTTP only: GET <server>/api/status (2.5 s timeout, one quick
//    retry when a busy page starves the request). JSON
//    with a matching `protocol` → 'online' (+ onlineCount); anything else
//    (static hosting, 404 HTML, file://, CORS, timeout, protocol mismatch) →
//    'offline' quickly, and Quick Play falls back to local bots.
//  • Re-probes every 20 s while no transport is open (i.e. in menus), and
//    right after an online connection fails or drops.
//  • Server URL: `?server=wss://host/ws` (or https://host) overrides; else
//    same origin (ws(s)://<host>/ws and /api/status).
//  • openOnline(): connects and waits for 'open' (4 s timeout → reject). The
//    socket lives in a Web Worker so main-thread stalls don't get the player
//    dropped by the server heartbeat (see transport.ts).
//    openLocal(): the in-browser host (Web Worker, main-thread fallback).
// ─────────────────────────────────────────────────────────────────────────────

import { PROTOCOL_VERSION } from '../../shared/constants';
import { resolveServerEndpoints, type ServerEndpoints } from './endpoints';
import { LocalTransport, WebSocketTransport, type Transport } from './transport';

export { resolveServerEndpoints, type ServerEndpoints };

export type NetStatus = 'connecting' | 'online' | 'offline';

const PROBE_TIMEOUT_MS = 2500;
const REPROBE_MS = 20000;
const CONNECT_TIMEOUT_MS = 4000;

export class NetManager {
  status: NetStatus = 'connecting';
  onlineCount = 0;
  /** Server build reported by /api/status. */
  serverVersion = '';
  readonly endpoints: ServerEndpoints;
  private readonly listeners = new Set<() => void>();
  private inflight: Promise<void> | null = null;
  private timer = 0;
  private open = new Set<Transport>();
  private probes = 0;

  constructor() {
    this.endpoints = resolveServerEndpoints();
    if (!this.endpoints.status) this.status = 'offline';
  }

  onStatus(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private set(status: NetStatus, count: number): void {
    const changed = status !== this.status || count !== this.onlineCount;
    this.status = status;
    this.onlineCount = count;
    if (!changed) return;
    for (const cb of [...this.listeners]) {
      try {
        cb();
      } catch (err) {
        console.error('[net] status listener failed', err);
      }
    }
  }

  /** Probes the server (deduplicated while in flight). Never rejects. */
  probe(): Promise<void> {
    if (this.inflight) return this.inflight;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.inflight = this.doProbe().finally(() => {
      this.inflight = null;
      this.schedule();
    });
    return this.inflight;
  }

  /** Resolves once the first probe has settled (immediately afterwards). */
  async settled(): Promise<void> {
    if (this.status === 'connecting') await this.probe();
  }

  private async doProbe(): Promise<void> {
    this.probes++;
    // A page that is busy booting (shader compiles, key art) can starve the fetch
    // callback past the timeout: retry once quickly before settling (≤ ~6.5 s worst case).
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.probeOnce();
      if (r !== 'timeout') return;
      if (attempt === 0) await new Promise((res) => window.setTimeout(res, 1500));
    }
    this.set('offline', 0);
  }

  /** One status request. Returns 'timeout' when it could not complete in time. */
  private async probeOnce(): Promise<'ok' | 'offline' | 'timeout'> {
    const url = this.endpoints.status;
    if (!url || typeof fetch !== 'function') {
      this.set('offline', 0);
      return 'offline';
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      ctrl?.abort();
    }, PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl?.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('json')) throw new Error('not json');
      const j = (await res.json()) as { online?: unknown; version?: unknown; protocol?: unknown };
      if (j.protocol !== undefined && Number(j.protocol) !== PROTOCOL_VERSION) {
        console.warn(`[net] server protocol ${String(j.protocol)} ≠ client ${PROTOCOL_VERSION}; playing offline`);
        this.set('offline', 0);
        return 'offline';
      }
      this.serverVersion = typeof j.version === 'string' ? j.version : '';
      const n = Number(j.online);
      this.set('online', Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);
      return 'ok';
    } catch {
      if (timedOut) return 'timeout';
      this.set('offline', 0);
      return 'offline';
    } finally {
      window.clearTimeout(timeout);
    }
  }

  /** Re-probe periodically while idle in menus (no transport open). */
  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    if (this.open.size > 0 || !this.endpoints.status) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      if (this.open.size === 0) void this.probe();
    }, REPROBE_MS);
  }

  private track(t: Transport): void {
    this.open.add(t);
    window.clearTimeout(this.timer);
    this.timer = 0;
    t.onClose(() => {
      this.open.delete(t);
      if (t.kind === 'online') {
        // Dropped or finished: refresh the status soon (server restarts close with 1012).
        window.setTimeout(() => void this.probe(), 800);
      } else this.schedule();
    });
  }

  /** Opens a WebSocket to the game server; rejects after 4 s without 'open'. */
  async openOnline(): Promise<Transport> {
    if (!this.endpoints.ws) throw new Error('no server');
    const t = new WebSocketTransport(this.endpoints.ws, CONNECT_TIMEOUT_MS);
    this.track(t);
    t.onMessage((m) => {
      if (m.type === 'welcome' && m.host === 'online') this.set('online', Math.max(1, m.online | 0));
    });
    try {
      await t.opened;
    } catch (err) {
      t.close();
      this.set('offline', 0);
      throw err;
    }
    return t;
  }

  /** In-browser host (always available; Web Worker with a main-thread fallback). */
  openLocal(): Transport {
    const t = new LocalTransport();
    this.track(t);
    return t;
  }
}
