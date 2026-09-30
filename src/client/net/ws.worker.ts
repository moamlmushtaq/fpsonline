// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — WebSocket owner thread for online play.
//
// The socket lives in this worker so it keeps being read — and the server's
// heartbeat pings keep being answered — even while the page's main thread is
// busy for seconds (building a map on a slow phone, compiling shaders). JSON
// parsing of snapshots also moves off the main thread. Messages are posted to
// the page in order; outgoing messages arrive pre-serialized.
// Protocol: see ws-protocol.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { ServerMsg } from '../../shared/protocol';
import { SOFT_BUFFER_BYTES, HARD_BUFFER_BYTES, type WsFromWorker, type WsToWorker } from './ws-protocol';

interface WorkerScope {
  postMessage(m: WsFromWorker): void;
  addEventListener(type: 'message', cb: (e: MessageEvent) => void): void;
}

const scope = self as unknown as WorkerScope;
let ws: WebSocket | null = null;

function open(url: string): void {
  try {
    ws = new WebSocket(url);
  } catch (err) {
    scope.postMessage({ op: 'error', message: String(err) });
    scope.postMessage({ op: 'close', code: 1006, reason: 'constructor failed' });
    return;
  }
  ws.addEventListener('open', () => scope.postMessage({ op: 'open' }));
  ws.addEventListener('error', () => scope.postMessage({ op: 'error', message: 'socket error' }));
  ws.addEventListener('close', (e: CloseEvent) => scope.postMessage({ op: 'close', code: e.code, reason: e.reason }));
  ws.addEventListener('message', (e: MessageEvent) => {
    if (typeof e.data !== 'string') return;
    let m: unknown;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m && typeof m === 'object' && typeof (m as { type?: unknown }).type === 'string') scope.postMessage({ op: 'msg', m: m as ServerMsg });
  });
}

scope.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as WsToWorker;
  if (!m || typeof m !== 'object') return;
  if (m.op === 'open') {
    if (!ws) open(m.url);
    return;
  }
  if (m.op === 'send') {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const buffered = ws.bufferedAmount;
    if ((m.expendable && buffered > SOFT_BUFFER_BYTES) || buffered > HARD_BUFFER_BYTES) {
      scope.postMessage({ op: 'dropped' });
      return;
    }
    try {
      ws.send(m.data);
    } catch {
      /* closing */
    }
    return;
  }
  if (m.op === 'close') {
    try {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close(1000, 'bye');
    } catch {
      /* ignore */
    }
  }
});

scope.postMessage({ op: 'ready' });
