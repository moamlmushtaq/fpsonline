// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — client-only admin cheat flags, read by game code (HUD bridge,
// remote players) without importing the admin console UI. Written only by
// admin/admin.ts, which keeps them off unless the current session is offline
// (local host) or the server authorized this connection as admin.
// ─────────────────────────────────────────────────────────────────────────────

export const adminFlags = {
  /** Radar shows every enemy; enemies get a soft glow + an on-screen marker through walls. */
  wallhack: false,
};
