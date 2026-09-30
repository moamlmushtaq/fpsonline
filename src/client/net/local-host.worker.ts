// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Web Worker running the local HostCore (offline matches,
// bots, training). Same host code as the Node server; driven by a 4 ms timer
// with performance.now() (HostCore keeps its own fixed 60 Hz accumulator).
// Outgoing messages are batched per update into one postMessage. The timer
// only runs while at least one connection exists.
// Protocol: see local-host-protocol.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { HostCore, type HostConnection } from '../../shared/host/host-core';
import type { ServerMsg } from '../../shared/protocol';
import { debugHostCommand, type FromHost, type ToHost } from './local-host-protocol';

interface WorkerScope {
  postMessage(m: FromHost): void;
  addEventListener(type: 'message', cb: (e: MessageEvent) => void): void;
}

const scope = self as unknown as WorkerScope;
const TICK_MS = 4;
/** Keep ticking briefly after the last disconnect so leave messages flush. */
const IDLE_STOP_MS = 3000;

let host: HostCore | null = null;
const conns = new Map<string, HostConnection>();
let outbox: { c: string; m: ServerMsg }[] = [];
let timer: ReturnType<typeof setInterval> | 0 = 0;
let idleSince = 0;

function getHost(): HostCore {
  if (!host) {
    host = new HostCore({
      kind: 'local',
      seed: (Math.random() * 0xffffffff) >>> 0,
      log: (...a: unknown[]) => console.warn('[local-host]', ...a),
    });
  }
  return host;
}

function flush(): void {
  if (outbox.length === 0) return;
  const items = outbox;
  outbox = [];
  try {
    scope.postMessage({ op: 'batch', items });
  } catch (err) {
    console.error('[local-host] postMessage failed', err);
  }
}

function tick(): void {
  try {
    getHost().update(performance.now());
  } catch (err) {
    console.error('[local-host] update failed', err);
  }
  flush();
  if (conns.size === 0) {
    if (!idleSince) idleSince = performance.now();
    else if (performance.now() - idleSince > IDLE_STOP_MS && timer) {
      clearInterval(timer);
      timer = 0;
    }
  } else idleSince = 0;
}

function ensureTimer(): void {
  if (!timer) timer = setInterval(tick, TICK_MS);
}

function handle(msg: ToHost): void {
  const h = getHost();
  switch (msg.op) {
    case 'connect': {
      if (conns.has(msg.c)) return;
      const id = msg.c;
      const conn: HostConnection = { id, send: (m: ServerMsg) => outbox.push({ c: id, m }) };
      conns.set(id, conn);
      h.connect(conn);
      ensureTimer();
      return;
    }
    case 'disconnect': {
      const conn = conns.get(msg.c);
      if (!conn) return;
      conns.delete(msg.c);
      h.disconnect(conn);
      return;
    }
    case 'msg': {
      const conn = conns.get(msg.c);
      if (conn) h.receive(conn, msg.m);
      return;
    }
    case 'debug':
      debugHostCommand(h, msg.action);
      return;
    default:
      return;
  }
}

scope.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as ToHost;
  if (!msg || typeof msg !== 'object') return;
  try {
    handle(msg);
  } catch (err) {
    console.error('[local-host] message failed', err);
  }
  flush();
});

try {
  getHost();
  scope.postMessage({ op: 'ready' });
} catch (err) {
  scope.postMessage({ op: 'fatal', message: String(err) });
}
