// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — wire format between LocalHostLink (page) and the local host
// (Web Worker or main-thread fallback). Kept separate so the worker bundle
// never imports the page-side link (which constructs the worker).
// ─────────────────────────────────────────────────────────────────────────────

import type { HostCore } from '../../shared/host/host-core';
import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export type ToHost =
  | { op: 'connect'; c: string }
  | { op: 'disconnect'; c: string }
  | { op: 'msg'; c: string; m: ClientMsg }
  /** Debug/e2e only (?debug=1): force-end every running match. */
  | { op: 'debug'; action: 'endMatch' }
  /** Idle-time prewarm: build every map's collision world + nav graph so the first match starts fast. */
  | { op: 'warm' };
export type FromHost = { op: 'ready' } | { op: 'batch'; items: { c: string; m: ServerMsg }[] } | { op: 'fatal'; message: string };


/** Debug/e2e hooks into a HostCore (reaches into its rooms; test tooling only). */
export function debugHostCommand(host: HostCore, action: 'endMatch'): void {
  const rooms = (host as unknown as { rooms?: { sim: { endMatch(): void } }[] }).rooms ?? [];
  if (action === 'endMatch') for (const r of rooms) r.sim.endMatch();
}

