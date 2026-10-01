// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — controller glyphs for on-screen prompts (pure, no DOM).
//
// Pads are identified by their Gamepad.id string (vendor ids or names):
//   045e / Xbox / XInput        → 'xbox'        A B X Y · LB RB · LT RT
//   054c / DualShock / DualSense → 'playstation' ✕ ○ □ △ · L1 R1 · L2 R2
//   057e / Nintendo / Joy-Con   → 'nintendo'    B A Y X · L R · ZL ZR (positional)
//   anything else               → 'generic'     Xbox-style labels
// PAD_ACTION_BUTTON mirrors the gameplay mapping in gamepad.ts (Standard
// Gamepad button indices) so prompts always name the real button.
// ─────────────────────────────────────────────────────────────────────────────

export type PadStyle = 'xbox' | 'playstation' | 'nintendo' | 'generic';

export function detectPadStyle(id: string | null | undefined): PadStyle {
  const s = (id ?? '').toLowerCase();
  if (!s) return 'generic';
  // Vendor ids first (most reliable), then product names. A bare "Wireless
  // Controller" is how browsers name a DualShock 4 without a vendor string.
  if (/054c/.test(s)) return 'playstation';
  if (/057e/.test(s)) return 'nintendo';
  if (/045e|xbox|xinput|x-box|microsoft/.test(s)) return 'xbox';
  if (/playstation|dualshock|dualsense|sony|\bps[345]\b|^wireless controller/.test(s)) return 'playstation';
  if (/nintendo|switch|joy-?con|pro controller/.test(s)) return 'nintendo';
  return 'generic';
}

/** Standard Gamepad button index → label, per style (16 = LS, 17 = RS pseudo-indices). */
const LABELS: Record<PadStyle, readonly string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '↑', '↓', '←', '→', 'LS', 'RS'],
  playstation: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', '↑', '↓', '←', '→', 'L', 'R'],
  nintendo: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'LS', 'RS', '↑', '↓', '←', '→', 'LS', 'RS'],
  generic: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '↑', '↓', '←', '→', 'LS', 'RS'],
};

export const PAD_LEFT_STICK = 16;
export const PAD_RIGHT_STICK = 17;

export function padButtonLabel(index: number, style: PadStyle): string {
  return LABELS[style][index] ?? '';
}

/** Gameplay action → Standard Gamepad button index (see gamepad.ts). */
export const PAD_ACTION_BUTTON: Readonly<Record<string, number>> = {
  jump: 0,
  crouch: 1,
  reload: 2,
  nextWeapon: 3,
  throw: 4,
  interact: 5,
  ads: 6,
  fire: 7,
  scoreboard: 8,
  pause: 9,
  sprint: 10,
  pickupSlot: 11,
  primary: 12,
  secondary: 13,
  forward: PAD_LEFT_STICK,
  back: PAD_LEFT_STICK,
  left: PAD_LEFT_STICK,
  right: PAD_LEFT_STICK,
};

/** Glyph text for an action on a pad style ('' if the action has no pad button). */
export function padGlyph(action: string, style: PadStyle): string {
  const i = PAD_ACTION_BUTTON[action];
  return i === undefined ? '' : padButtonLabel(i, style);
}
