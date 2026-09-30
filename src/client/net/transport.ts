// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — transports. The client speaks the SAME protocol
// (shared/protocol.ts) to:
//   • WebSocketTransport — the Node server (online): JSON over /ws, the
//     socket owned by a Web Worker (ws.worker.ts) when available.
//   • LocalTransport     — the in-browser host (offline / bots / training):
//     a HostCore running in a Web Worker, or on the main thread when Workers
//     are unavailable (see local-host.ts).
// Both deliver messages asynchronously and in order.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClientMsg, ServerMsg } from '../../shared/protocol';
import { LocalHostLink, type LocalEndpoint } from './local-host';
import { HARD_BUFFER_BYTES, SOFT_BUFFER_BYTES, type WsFromWorker, type WsToWorker } from './ws-protocol';

export interface Transport {
  readonly kind: 'online' | 'local';
  send(m: ClientMsg): void;
  onMessage(cb: (m: ServerMsg) => void): () => void;
  onClose(cb: () => void): () => void;
  close(): void;
  /** True once closed (by either side). */
  readonly closed?: boolean;
}

/** Tiny ordered listener set that survives listeners removing themselves while dispatching. */
class Listeners<A extends unknown[]> {
  private list: ((...a: A) => void)[] = [];
  add(cb: (...a: A) => void): () => void {
    this.list.push(cb);
    return () => {
      const i = this.list.indexOf(cb);
      if (i >= 0) this.list.splice(i, 1);
    };
  }
  emit(...a: A): void {
    const snapshot = this.list.slice();
    for (const cb of snapshot) {
      try {
        cb(...a);
      } catch (err) {
        console.error('[net] listener failed', err);
      }
    }
  }
  clear(): void {
    this.list = [];
  }
}

// ── WebSocket ───────────────────────────────────────────────────────────────
//
// The socket is owned by a Web Worker (ws.worker.ts) when possible: a page
// whose main thread stalls for seconds (map build on a slow phone, shader
// compiles, a busy machine) would otherwise stop reading the socket — the
// browser then also stops reading the server's heartbeat pings behind the
// queued snapshots, and the server drops the player. In the worker the socket
// keeps draining; messages queue up in order for the page. `?wsThread=main`
// forces the plain main-thread socket (also the fallback without Workers).

/** Callbacks a socket backend reports to. */
interface SocketEvents {
  open(): void;
  close(code: number, reason: string): void;
  message(m: ServerMsg): void;
  dropped(): void;
}

interface SocketBackend {
  readonly thread: 'worker' | 'main';
  send(data: string, expendable: boolean): void;
  close(): void;
}

class MainThreadSocket implements SocketBackend {
  readonly thread = 'main' as const;
  private readonly ws: WebSocket;

  constructor(url: string, private readonly ev: SocketEvents) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => ev.open());
    this.ws.addEventListener('close', (e: CloseEvent) => ev.close(e.code, e.reason));
    this.ws.addEventListener('message', (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      let m: unknown;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m && typeof m === 'object' && typeof (m as { type?: unknown }).type === 'string') ev.message(m as ServerMsg);
    });
  }

  send(data: string, expendable: boolean): void {
    const ws = this.ws;
    if (ws.readyState !== WebSocket.OPEN) return;
    const buffered = ws.bufferedAmount;
    if ((expendable && buffered > SOFT_BUFFER_BYTES) || buffered > HARD_BUFFER_BYTES) {
      this.ev.dropped();
      return;
    }
    try {
      ws.send(data);
    } catch {
      /* closing */
    }
  }

  close(): void {
    try {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close(1000, 'bye');
    } catch {
      /* ignore */
    }
  }
}

class WorkerSocket implements SocketBackend {
  readonly thread = 'worker' as const;
  private worker: Worker | null;
  private ready = false;
  private done = false;

  /** Throws when Workers are unavailable; `failed` is called if the worker cannot start (caller falls back). */
  constructor(url: string, private readonly ev: SocketEvents, failed: () => void) {
    const worker = new Worker(new URL('./ws.worker.ts', import.meta.url), { type: 'module', name: 'halcyon-net' });
    this.worker = worker;
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as WsFromWorker;
      switch (m.op) {
        case 'msg':
          ev.message(m.m);
          break;
        case 'ready':
          this.ready = true;
          break;
        case 'open':
          ev.open();
          break;
        case 'dropped':
          ev.dropped();
          break;
        case 'close':
          this.dispose();
          ev.close(m.code, m.reason);
          break;
        case 'error':
          break; // a 'close' always follows
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      const wasReady = this.ready;
      this.dispose();
      if (!wasReady) failed();
      else {
        console.warn('[net] network worker crashed', e.message);
        ev.close(1006, 'worker crashed');
      }
    };
    worker.postMessage({ op: 'open', url } satisfies WsToWorker);
  }

  send(data: string, expendable: boolean): void {
    this.worker?.postMessage({ op: 'send', data, expendable } satisfies WsToWorker);
  }

  close(): void {
    const worker = this.worker;
    if (!worker || this.done) return;
    worker.postMessage({ op: 'close' } satisfies WsToWorker);
    // Let the close frame go out, then stop the thread even if no 'close' comes back.
    window.setTimeout(() => this.dispose(), 1000);
  }

  private dispose(): void {
    this.done = true;
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }
}

export class WebSocketTransport implements Transport {
  readonly kind = 'online' as const;
  /** Resolves when the socket is open; rejects on error / close / timeout before that. */
  readonly opened: Promise<void>;
  private backend: SocketBackend;
  private readonly messages = new Listeners<[ServerMsg]>();
  private readonly closes = new Listeners<[]>();
  private isClosed = false;
  private isOpen = false;
  private outbox: { data: string; expendable: boolean }[] = [];
  private settleOpen: ((err?: Error) => void) | null = null;
  /** Messages dropped by the backpressure guard (diagnostics). */
  dropped = 0;
  closeCode = 0;

  constructor(readonly url: string, openTimeoutMs = 4000) {
    this.opened = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (!this.settleOpen) return;
        this.settleOpen(new Error('connect timeout'));
        this.close();
      }, openTimeoutMs);
      this.settleOpen = (err) => {
        this.settleOpen = null;
        window.clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
    });
    // Avoid unhandled-rejection noise when nobody awaits `opened`.
    this.opened.catch(() => undefined);
    this.backend = this.createBackend();
  }

  /** Which thread owns the socket (diagnostics). */
  get thread(): 'worker' | 'main' {
    return this.backend.thread;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  private createBackend(): SocketBackend {
    const events: SocketEvents = {
      open: () => this.handleOpen(),
      close: (code, reason) => this.handleClose(code, reason),
      message: (m) => {
        if (!this.isClosed) this.messages.emit(m);
      },
      dropped: () => {
        this.dropped++;
      },
    };
    const forceMain = typeof location !== 'undefined' && new URLSearchParams(location.search).get('wsThread') === 'main';
    if (!forceMain && typeof Worker !== 'undefined') {
      try {
        return new WorkerSocket(this.url, events, () => {
          // The worker script could not start: redo the connection on this thread.
          if (this.isClosed || this.isOpen) return;
          console.warn('[net] network worker unavailable; using the main thread');
          this.backend = new MainThreadSocket(this.url, events);
        });
      } catch {
        /* fall through */
      }
    }
    return new MainThreadSocket(this.url, events);
  }

  private handleOpen(): void {
    if (this.isClosed) return;
    this.isOpen = true;
    for (const o of this.outbox) this.backend.send(o.data, o.expendable);
    this.outbox = [];
    this.settleOpen?.();
  }

  private handleClose(code: number, reason: string): void {
    this.closeCode = code;
    this.settleOpen?.(new Error('socket closed'));
    if (!this.isClosed) console.info(`[net] server connection closed (code ${code}${reason ? `, ${reason}` : ''})`);
    this.finish();
  }

  send(m: ClientMsg): void {
    if (this.isClosed) return;
    const expendable = m.type === 'input' || m.type === 'ping';
    if (!this.isOpen) {
      if (!expendable || this.outbox.length < 8) this.outbox.push({ data: JSON.stringify(m), expendable });
      return;
    }
    this.backend.send(JSON.stringify(m), expendable);
  }

  onMessage(cb: (m: ServerMsg) => void): () => void {
    return this.messages.add(cb);
  }

  onClose(cb: () => void): () => void {
    if (this.isClosed) {
      queueMicrotask(cb);
      return () => undefined;
    }
    return this.closes.add(cb);
  }

  close(): void {
    if (this.isClosed) return;
    this.backend.close();
    this.finish();
  }

  private finish(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.settleOpen?.(new Error('closed'));
    this.closes.emit();
    this.closes.clear();
    this.messages.clear();
  }
}

// ── Local (in-browser host) ─────────────────────────────────────────────────

export class LocalTransport implements Transport, LocalEndpoint {
  readonly kind = 'local' as const;
  private readonly messages = new Listeners<[ServerMsg]>();
  private readonly closes = new Listeners<[]>();
  private readonly id: string;
  private isClosed = false;

  constructor(private readonly link: LocalHostLink = LocalHostLink.get()) {
    this.id = link.connect(this);
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** Which backend runs the host ('worker' | 'main' | 'pending'). */
  get backend(): string {
    return this.link.backend;
  }

  send(m: ClientMsg): void {
    if (this.isClosed) return;
    this.link.send(this.id, m);
  }

  onMessage(cb: (m: ServerMsg) => void): () => void {
    return this.messages.add(cb);
  }

  onClose(cb: () => void): () => void {
    if (this.isClosed) {
      queueMicrotask(cb);
      return () => undefined;
    }
    return this.closes.add(cb);
  }

  close(): void {
    if (this.isClosed) return;
    this.link.disconnect(this.id);
    this.finish();
  }

  // LocalEndpoint
  deliver(m: ServerMsg): void {
    if (!this.isClosed) this.messages.emit(m);
  }

  hostLost(): void {
    this.finish();
  }

  private finish(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.closes.emit();
    this.closes.clear();
    this.messages.clear();
  }
}
