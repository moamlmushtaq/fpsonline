// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Transport contract (TEMPORARY STUB by the shell engineer).
//
// The netcode engineer replaces this file with WebSocketTransport +
// LocalTransport implementations. Only the interface below is relied upon by
// the App shell; keep it source-compatible.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export interface Transport {
  readonly kind: 'online' | 'local';
  send(m: ClientMsg): void;
  onMessage(cb: (m: ServerMsg) => void): () => void;
  onClose(cb: () => void): () => void;
  close(): void;
}
