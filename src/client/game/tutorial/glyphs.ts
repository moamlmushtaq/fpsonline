// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — input glyphs for the tutorial prompt, per device.
//
//  • keyboard/mouse: the player's actual bindings (settings.bindings through
//    MatchApi.keyLabel), e.g. "W A S D", "L-Shift", "Space", "LMB";
//  • gamepad: Standard-mapping glyphs (input/gamepad.ts): LS / RS sticks,
//    A jump, B crouch-slide, X reload, LB throw, RT fire, LT aim, L3 sprint;
//  • touch: no glyph text — the tutorial pulse-highlights the real on-screen
//    control instead (returned as `touch`: a touch button id, the floating
//    stick, or the right-half look area).
// ─────────────────────────────────────────────────────────────────────────────

import type { StepId } from './steps';

export type TouchTarget = 'stick' | 'look' | 'fire' | 'ads' | 'jump' | 'crouch' | 'reload' | 'throw' | null;

/** One token of a glyph row: a key cap, or a small joiner word ("then" / "+"). */
export interface GlyphToken {
  text: string;
  kind: 'key' | 'pad' | 'join';
}

export interface StepGlyphs {
  tokens: GlyphToken[];
  touch: TouchTarget;
}

const key = (text: string): GlyphToken => ({ text, kind: 'key' });
const pad = (text: string): GlyphToken => ({ text, kind: 'pad' });
const join = (text: string): GlyphToken => ({ text, kind: 'join' });

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

/**
 * Glyphs for a drill on a device. `label(action)` resolves a keyboard binding
 * label ('' when unbound); `t` translates joiner words.
 */
export function stepGlyphs(step: StepId, device: string, label: (action: string) => string, t: (k: string) => string): StepGlyphs {
  const touch = TOUCH[step];
  if (device === 'touch') return { tokens: [], touch };
  const then = join(t('tutorial.glyph.then'));
  if (device === 'gamepad') {
    const P: Record<StepId, GlyphToken[]> = {
      look: [pad('RS')],
      move: [pad('LS')],
      sprint: [pad('L3')],
      jump: [pad('A')],
      mantle: [pad('A')],
      slide: [pad('L3'), then, pad('B')],
      shoot: [pad('RT')],
      ads: [pad('LT'), join('+'), pad('RT')],
      reload: [pad('X')],
      throw: [pad('LB')],
      capture: [pad('LS')],
    };
    return { tokens: P[step], touch: null };
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
  return { tokens: K[step], touch: null };
}

/** Glyph shown on the skip chip (hold for gamepad; Esc for keyboard; none for touch). */
export function skipGlyph(device: string): GlyphToken | null {
  if (device === 'gamepad') return pad('⧉');
  if (device === 'kbm') return key('Esc');
  return null;
}
