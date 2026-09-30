// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — NetManager (TEMPORARY STUB by the shell engineer).
//
// The netcode engineer replaces this with real server discovery (status,
// online count, reconnect) and transport factories. The stub reports
// 'offline' and refuses to open transports, which the App handles gracefully.
// ─────────────────────────────────────────────────────────────────────────────

import type { Transport } from './transport';

export class NetManager {
  readonly status: 'connecting' | 'online' | 'offline' = 'offline';
  readonly onlineCount: number = 0;
  private listeners = new Set<() => void>();

  onStatus(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  probe(): Promise<void> {
    return Promise.resolve();
  }

  openOnline(): Promise<Transport> {
    return Promise.reject(new Error('not implemented'));
  }

  openLocal(): Transport {
    throw new Error('not implemented');
  }
}
