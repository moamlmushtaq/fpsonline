// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — messages between WebSocketTransport (page) and ws.worker.ts,
// the thread that owns the online socket. Kept separate so the worker bundle
// never pulls in the transport module.
// ─────────────────────────────────────────────────────────────────────────────

import type { ServerMsg } from '../../shared/protocol';

/** Input/ping messages are skipped while this much is queued in the socket (they are redundant/periodic). */
export const SOFT_BUFFER_BYTES = 64 * 1024;
/** Beyond this, every message is dropped. */
export const HARD_BUFFER_BYTES = 1024 * 1024;

export type WsToWorker =
  | { op: 'open'; url: string }
  /** `data` is already JSON; `expendable` messages may be dropped under backpressure. */
  | { op: 'send'; data: string; expendable: boolean }
  | { op: 'close' };

export type WsFromWorker =
  | { op: 'ready' }
  | { op: 'open' }
  | { op: 'error'; message: string }
  | { op: 'close'; code: number; reason: string }
  | { op: 'msg'; m: ServerMsg }
  | { op: 'dropped' };
