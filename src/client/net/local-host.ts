// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — link to the in-browser host (offline play).
//
// One HostCore('local') serves every LocalTransport of the page (bot matches,
// training). It runs in a dedicated Web Worker (local-host.worker.ts) so the
// simulation + bots never compete with rendering. If Workers are unavailable
// (old browsers, file://, CSP) or the worker fails to boot, the same HostCore
// is loaded on the main thread instead — messages keep their async, ordered,
// structured-clone semantics either way.
//
// Wire format (both directions are batched per host update):
//   → host : { op:'connect'|'disconnect', c } | { op:'msg', c, m }
//   ← host : { op:'ready' } | { op:'batch', items:[{ c, m }] } | { op:'fatal', message }
// ─────────────────────────────────────────────────────────────────────────────

import type { ClientMsg, ServerMsg } from '../../shared/protocol';
import type { HostConnection, HostCore } from '../../shared/host/host-core';
import { debugHostCommand, type FromHost, type ToHost } from './local-host-protocol';

export type { FromHost, ToHost } from './local-host-protocol';

export interface LocalEndpoint {
  deliver(m: ServerMsg): void;
  hostLost(): void;
}

/**
 * Worker boot must answer within this time or we fall back to the main thread.
 * Generous on purpose: broken workers fail fast with an 'error' event; a slow
 * device merely parsing the host bundle should not be abandoned.
 */
const BOOT_TIMEOUT_MS = 10000;
/** Host update period (ms). */
export const HOST_TICK_MS = 4;

interface Backend {
  post(msg: ToHost): void;
  dispose(): void;
}

// ── Main-thread fallback ────────────────────────────────────────────────────

class MainThreadHost implements Backend {
  private host: HostCore | null = null;
  private readonly conns = new Map<string, HostConnection>();
  private readonly early: ToHost[] = [];
  private outbox: { c: string; m: ServerMsg }[] = [];
  private flushQueued = false;
  private timer = 0;
  private disposed = false;

  constructor(private readonly onBatch: (items: { c: string; m: ServerMsg }[]) => void) {
    void import('../../shared/host/host-core')
      .then(({ HostCore: Core }) => {
        if (this.disposed) return;
        this.host = new Core({ kind: 'local', seed: (Math.random() * 0xffffffff) >>> 0, log: (...a: unknown[]) => console.warn('[local-host]', ...a) });
        for (const m of this.early.splice(0)) this.handle(m);
        this.timer = window.setInterval(() => this.tick(), HOST_TICK_MS);
      })
      .catch((err) => console.error('[local-host] main-thread host failed to load', err));
  }

  post(msg: ToHost): void {
    if (!this.host) this.early.push(msg);
    else this.handle(msg);
  }

  private handle(msg: ToHost): void {
    const host = this.host;
    if (!host) return;
    if (msg.op === 'connect') {
      if (this.conns.has(msg.c)) return;
      const id = msg.c;
      const conn: HostConnection = { id, send: (m: ServerMsg) => this.out(id, m) };
      this.conns.set(id, conn);
      host.connect(conn);
    } else if (msg.op === 'disconnect') {
      const conn = this.conns.get(msg.c);
      if (!conn) return;
      this.conns.delete(msg.c);
      host.disconnect(conn);
    } else if (msg.op === 'debug') {
      debugHostCommand(host, msg.action);
    } else {
      const conn = this.conns.get(msg.c);
      if (conn) host.receive(conn, msg.m);
    }
  }

  private out(c: string, m: ServerMsg): void {
    // Structured clone: the host shares snapshot arrays between receivers and ticks.
    this.outbox.push({ c, m: structuredClone(m) });
    if (!this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(() => this.flush());
    }
  }

  private flush(): void {
    this.flushQueued = false;
    if (!this.outbox.length) return;
    const items = this.outbox;
    this.outbox = [];
    this.onBatch(items);
  }

  private tick(): void {
    try {
      this.host?.update(performance.now());
    } catch (err) {
      console.error('[local-host] update failed', err);
    }
  }

  dispose(): void {
    this.disposed = true;
    window.clearInterval(this.timer);
    this.conns.clear();
  }
}

// ── Worker backend ──────────────────────────────────────────────────────────

class WorkerHost implements Backend {
  private readonly worker: Worker;
  private ready = false;
  private readonly early: ToHost[] = [];
  private bootTimer = 0;

  constructor(
    onBatch: (items: { c: string; m: ServerMsg }[]) => void,
    private readonly onFail: (reason: string, pending: ToHost[]) => void,
  ) {
    // Throws synchronously where Workers are unsupported → caller falls back.
    this.worker = new Worker(new URL('./local-host.worker.ts', import.meta.url), { type: 'module', name: 'halcyon-local-host' });
    this.worker.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data as FromHost;
      if (!msg || typeof msg !== 'object') return;
      if (msg.op === 'ready') {
        if (this.ready) return;
        this.ready = true;
        window.clearTimeout(this.bootTimer);
        for (const m of this.early.splice(0)) this.worker.postMessage(m);
      } else if (msg.op === 'batch') onBatch(msg.items);
      else if (msg.op === 'fatal') this.fail(`fatal: ${msg.message}`);
    });
    this.worker.addEventListener('error', (e: ErrorEvent) => {
      e.preventDefault?.();
      this.fail(e.message || 'worker error');
    });
    this.worker.addEventListener('messageerror', () => this.fail('messageerror'));
    this.bootTimer = window.setTimeout(() => {
      if (!this.ready) this.fail('boot timeout');
    }, BOOT_TIMEOUT_MS);
  }

  private failed = false;

  private fail(reason: string): void {
    if (this.failed) return;
    this.failed = true;
    window.clearTimeout(this.bootTimer);
    const pending = this.ready ? [] : this.early.splice(0);
    const wasReady = this.ready;
    try {
      this.worker.terminate();
    } catch {
      /* ignore */
    }
    this.onFail(wasReady ? `crashed: ${reason}` : reason, pending);
  }

  post(msg: ToHost): void {
    if (this.failed) return;
    if (!this.ready) this.early.push(msg);
    else this.worker.postMessage(msg);
  }

  dispose(): void {
    window.clearTimeout(this.bootTimer);
    try {
      this.worker.terminate();
    } catch {
      /* ignore */
    }
  }
}

// ── Link (singleton) ────────────────────────────────────────────────────────

export class LocalHostLink {
  private static shared: LocalHostLink | null = null;

  /** Page-wide link (the worker boots on first use and is reused across matches). */
  static get(): LocalHostLink {
    if (!LocalHostLink.shared) LocalHostLink.shared = new LocalHostLink();
    return LocalHostLink.shared;
  }

  private backendImpl: Backend | null = null;
  private kind: 'worker' | 'main' | 'pending' = 'pending';
  private readonly endpoints = new Map<string, LocalEndpoint>();
  private nextId = 1;

  get backend(): 'worker' | 'main' | 'pending' {
    return this.kind;
  }

  private ensure(): Backend {
    if (this.backendImpl) return this.backendImpl;
    const forceMain = typeof location !== 'undefined' && new URLSearchParams(location.search).get('hostThread') === 'main';
    if (!forceMain && typeof Worker !== 'undefined') {
      try {
        this.backendImpl = new WorkerHost(
          (items) => this.dispatch(items),
          (reason, pending) => this.fallBack(reason, pending),
        );
        this.kind = 'worker';
        return this.backendImpl;
      } catch (err) {
        console.warn('[local-host] Web Worker unavailable, hosting on the main thread', err);
      }
    }
    this.backendImpl = new MainThreadHost((items) => this.dispatch(items));
    this.kind = 'main';
    return this.backendImpl;
  }

  private fallBack(reason: string, pending: ToHost[]): void {
    const crashed = reason.startsWith('crashed');
    console.warn(`[local-host] worker host unavailable (${reason}); hosting on the main thread`);
    this.backendImpl = new MainThreadHost((items) => this.dispatch(items));
    this.kind = 'main';
    if (crashed) {
      // Sessions on the dead worker are gone: tell their transports.
      const eps = [...this.endpoints.values()];
      this.endpoints.clear();
      for (const ep of eps) ep.hostLost();
      return;
    }
    for (const m of pending) this.backendImpl.post(m);
  }

  private dispatch(items: { c: string; m: ServerMsg }[]): void {
    for (const it of items) {
      const ep = this.endpoints.get(it.c);
      if (!ep) continue;
      try {
        ep.deliver(it.m);
      } catch (err) {
        console.error('[local-host] delivery failed', err);
      }
    }
  }

  connect(ep: LocalEndpoint): string {
    const id = `local-${this.nextId++}`;
    this.endpoints.set(id, ep);
    this.ensure().post({ op: 'connect', c: id });
    return id;
  }

  send(id: string, m: ClientMsg): void {
    if (!this.endpoints.has(id)) return;
    this.ensure().post({ op: 'msg', c: id, m });
  }

  disconnect(id: string): void {
    if (!this.endpoints.delete(id)) return;
    this.backendImpl?.post({ op: 'disconnect', c: id });
  }

  /** Debug/e2e only: see ToHost 'debug'. */
  debug(action: 'endMatch'): void {
    this.backendImpl?.post({ op: 'debug', action });
  }
}
