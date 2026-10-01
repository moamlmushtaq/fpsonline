// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — input glyphs for the tutorial prompt, per device.
//
//  • keyboard/mouse: the player's actual bindings (settings.bindings through
//    MatchApi.keyLabel), e.g. "W A S D", "L-Shift", "Space", "LMB";
//  • gamepad: Standard-mapping glyphs (input/gamepad.ts): LS / RS sticks,
//    A jump, B crouch-slide, X reload, LB throw, RT fire, LT aim, L3 sprint;
//  • touch: the tutorial pulse-highlights the real on-screen control
//    (returned as `touch`: a touch button id, the floating stick, or the
//    right-half look area). Gestures that a button pulse cannot show (drag to
//    look, drag to walk, push the stick past its ring to sprint, sprint then
//    tap to slide) get one short gesture pill — a player who has never held a
//    phone shooter cannot guess them.
// Hints (shown after 12 s on a drill) are device aware where the verb differs
// ("hold sprint" vs "click the left stick" vs "push the stick fully").
// ─────────────────────────────────────────────────────────────────────────────

import { detectPadStyle, padButtonLabel, padGlyph, PAD_LEFT_STICK, PAD_RIGHT_STICK, type PadStyle } from '../../input/glyphs';
import type { StepId } from './steps';

export type TouchTarget = 'stick' | 'look' | 'fire' | 'ads' | 'jump' | 'crouch' | 'reload' | 'throw' | null;

/** One token of a glyph row: a key cap, a pad button, a touch gesture pill, or a small joiner word ("then" / "+"). */
export interface GlyphToken {
  text: string;
  kind: 'key' | 'pad' | 'join' | 'gesture';
}

export interface StepGlyphs {
  tokens: GlyphToken[];
  touch: TouchTarget;
  /**
   * The tokens are an ordered sequence ("A then B"): in right-to-left
   * languages the row must flow right-to-left too, or Arabic readers read the
   * steps backwards. Plain key clusters (W A S D) keep keyboard order.
   */
  sequence: boolean;
}

const key = (text: string): GlyphToken => ({ text, kind: 'key' });
const pad = (text: string): GlyphToken => ({ text, kind: 'pad' });
const join = (text: string): GlyphToken => ({ text, kind: 'join' });
const gesture = (text: string): GlyphToken => ({ text, kind: 'gesture' });

const TOUCH: Record<StepId, TouchTarget> = {
  look: 'look',
  move: 'stick',
  sprint: 'stick',
  jump: 'jump',
  mantle: 'jump',
  slide: 'crouch',
  shoot: 'fire',
  ads: 'ads',
  reload: 'reload',
  throw: 'throw',
  capture: 'stick',
};

/** Touch drills whose gesture is not a single button tap (i18n key of the gesture pill). */
const TOUCH_GESTURE: Partial<Record<StepId, string>> = {
  look: 'tutorial.glyph.dragRight',
  move: 'tutorial.glyph.dragLeft',
  sprint: 'tutorial.glyph.pushStick',
  slide: 'tutorial.glyph.sprintTap',
};

/** Style of the first connected pad (Xbox / PlayStation / Nintendo labels), 'generic' when unknown. */
export function currentPadStyle(): PadStyle {
  try {
    // Structural type: this module is also type-checked without the DOM lib (tests).
    const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as { getGamepads?: () => ArrayLike<{ connected: boolean; id: string } | null> } | undefined;
    const pads = typeof nav?.getGamepads === 'function' ? Array.from(nav.getGamepads()) : [];
    for (const p of pads) if (p && p.connected) return detectPadStyle(p.id);
  } catch {
    // Permission policy / older browsers: fall back to generic labels.
  }
  return 'generic';
}

/** Pad label of a gameplay action on a pad style (Standard mapping), with a fallback. */
export function padLabel(action: string, style: PadStyle, fallback = ''): string {
  return padGlyph(action, style) || fallback;
}

/**
 * Glyphs for a drill on a device. `label(action)` resolves a keyboard binding
 * label ('' when unbound); `t` translates joiner words and gesture pills;
 * `style` picks the pad's own button names (✕ / A / B…).
 */
export function stepGlyphs(step: StepId, device: string, label: (action: string) => string, t: (k: string) => string, style: PadStyle = 'generic'): StepGlyphs {
  const touch = TOUCH[step];
  if (device === 'touch') {
    const g = TOUCH_GESTURE[step];
    return { tokens: g ? [gesture(t(g))] : [], touch, sequence: false };
  }
  const then = join(t('tutorial.glyph.then'));
  if (device === 'gamepad') {
    const b = (action: string, fallback: string): GlyphToken => pad(padLabel(action, style, fallback));
    const ls = pad(padButtonLabel(PAD_LEFT_STICK, style) || 'LS');
    const rs = pad(padButtonLabel(PAD_RIGHT_STICK, style) || 'RS');
    const P: Record<StepId, GlyphToken[]> = {
      look: [rs],
      move: [ls],
      sprint: [b('sprint', 'L3')],
      jump: [b('jump', 'A')],
      mantle: [b('jump', 'A')],
      slide: [b('sprint', 'L3'), then, b('crouch', 'B')],
      shoot: [b('fire', 'RT')],
      ads: [b('ads', 'LT'), join('+'), b('fire', 'RT')],
      reload: [b('reload', 'X')],
      throw: [b('throw', 'LB')],
      capture: [ls],
    };
    return { tokens: P[step], touch: null, sequence: step === 'slide' };
  }
  const k = (action: string, fallback: string): GlyphToken => key(label(action) || fallback);
  const moveKeys = [k('forward', 'W'), k('left', 'A'), k('back', 'S'), k('right', 'D')];
  const K: Record<StepId, GlyphToken[]> = {
    look: [key(t('tutorial.glyph.mouse'))],
    move: moveKeys,
    sprint: [k('sprint', 'Shift')],
    jump: [k('jump', 'Space')],
    mantle: [k('jump', 'Space')],
    slide: [k('sprint', 'Shift'), then, k('crouch', 'C')],
    shoot: [k('fire', 'LMB')],
    ads: [k('ads', 'RMB'), join('+'), k('fire', 'LMB')],
    reload: [k('reload', 'R')],
    throw: [k('throw', 'G')],
    capture: moveKeys,
  };
  return { tokens: K[step], touch: null, sequence: step === 'slide' };
}

/** Drills whose hint depends on the device ('kbm' uses the generic key). */
const DEVICE_HINTS: Record<string, readonly StepId[]> = {
  touch: ['look', 'move', 'sprint', 'slide', 'ads'],
  gamepad: ['look', 'sprint'],
};

/** i18n key of the hint for a drill on a device (every key returned exists in both locales). */
export function hintKey(step: StepId, device: string): string {
  const dev = device === 'gamepad' ? 'pad' : device;
  return DEVICE_HINTS[device]?.includes(step) ? `tutorial.hint.${step}.${dev}` : `tutorial.hint.${step}`;
}

/** Every hint key hintKey() can return (locale completeness tests). */
export function allHintKeys(steps: readonly StepId[]): string[] {
  const out = new Set<string>();
  for (const s of steps) for (const d of ['kbm', 'touch', 'gamepad']) out.add(hintKey(s, d));
  return [...out];
}

/** Glyph shown on the skip chip (hold View/Create for gamepad; Esc for keyboard; none for touch). */
export function skipGlyph(device: string, style: PadStyle = 'generic'): GlyphToken | null {
  if (device === 'gamepad') return pad(padLabel('scoreboard', style, '⧉'));
  if (device === 'kbm') return key('Esc');
  return null;
}
