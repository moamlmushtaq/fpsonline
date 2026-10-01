// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — client-only admin cheat flags, read by game code (HUD bridge,
// remote players, the in-match assist in game/admin-assist.ts) without
// importing the admin console UI. Written only by admin/admin.ts, which keeps
// them off unless the current session is offline (local host) or the server
// authorized this connection as admin.
//
// `assist` / `visuals` are the master switches the per-frame code checks first:
// with every client cheat off, the game pays one boolean test per frame.
// ─────────────────────────────────────────────────────────────────────────────

export type AimBone = 'head' | 'chest';

export const adminFlags = {
  /** Any of radarAll / chams / esp (kept for older call sites; `wallhack` turns all three on). */
  wallhack: false,
  /** Radar shows every enemy. */
  radarAll: false,
  /** Enemies glow, and show through walls (occluded parts in team colour). */
  chams: false,

  /** Master switch: aimbot or triggerbot active (game/admin-assist.ts runs). */
  assist: false,
  /** Master switch: something is drawn on the ESP canvas (ESP or the aimbot FOV circle). */
  visuals: false,

  aimbot: false,
  /** Full cone angle (degrees, 5..180) around the crosshair in which targets are picked. */
  aimFov: 30,
  /** 0 = instant lock … 1 = very smooth. */
  aimSmooth: 0.25,
  aimBone: 'head' as AimBone,
  /** Ignore walls and smoke when picking a target (off = visible targets only). */
  aimWalls: false,
  /** Always steer (off = only while aiming down sights or firing). */
  aimAlways: false,

  trigger: false,
  /** Seconds the crosshair must rest on an enemy before the trigger pulls. */
  triggerDelay: 0.05,

  esp: false,
  espBoxes: true,
  espSkeleton: true,
  espNames: true,
  espHealth: true,
  espDistance: true,
  espLines: false,
  /** Also draw teammates. */
  espTeam: false,
};

export type AdminFlags = typeof adminFlags;
