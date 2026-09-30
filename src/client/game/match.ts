// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — ClientMatch (TEMPORARY STUB by the shell engineer).
//
// The in-match orchestrator is written by a later engineer. This stub only
// satisfies the agreed signature so the App shell compiles and its flows can
// be exercised: `done` resolves with null when the player leaves.
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../app';
import type { Transport } from '../net/transport';
import type { MatchStartMsg } from '../../shared/protocol';
import type { MatchResults } from '../../shared/types';

export class ClientMatch {
  readonly done: Promise<{ results: MatchResults; ratingDelta: number } | null>;
  private resolveDone!: (v: { results: MatchResults; ratingDelta: number } | null) => void;

  constructor(app: App, transport: Transport, start: MatchStartMsg) {
    void app;
    void transport;
    void start;
    this.done = new Promise((resolve) => (this.resolveDone = resolve));
  }

  update(dt: number): void {
    void dt;
  }

  leave(): void {
    this.resolveDone(null);
  }

  dispose(): void {
    /* nothing to release in the stub */
  }
}
