// Tutorial prompts per device: glyph rows, touch gesture pills, device-aware hints and the
// locale keys they need (pure: no DOM).
import { describe, expect, it } from 'vitest';
import { allHintKeys, hintKey, skipGlyph, stepGlyphs } from '../../src/client/game/tutorial/glyphs';
import { STEP_ORDER } from '../../src/client/game/tutorial/steps';
import ar from '../../src/client/ui/locales/ar/tutorial';
import en from '../../src/client/ui/locales/en/tutorial';

const label = (a: string) => ({ forward: 'W', left: 'A', back: 'S', right: 'D', sprint: 'L-Shift', crouch: 'C', jump: 'Space', fire: 'LMB', ads: 'RMB', reload: 'R', throw: 'G' })[a] ?? '';
const t = (k: string) => (en as Record<string, string>)[k] ?? k;

describe('tutorial glyphs', () => {
  it('every drill has a glyph row on keyboard and gamepad, and a control (or gesture) on touch', () => {
    for (const s of STEP_ORDER) {
      expect(stepGlyphs(s, 'kbm', label, t).tokens.length).toBeGreaterThan(0);
      expect(stepGlyphs(s, 'gamepad', label, t).tokens.length).toBeGreaterThan(0);
      const touch = stepGlyphs(s, 'touch', label, t);
      expect(touch.touch).not.toBeNull();
      for (const g of touch.tokens) expect(g.kind).toBe('gesture');
    }
  });

  it('uses the player bindings and the pad style button names', () => {
    expect(stepGlyphs('jump', 'kbm', label, t).tokens.map((g) => g.text)).toEqual(['Space']);
    expect(stepGlyphs('jump', 'gamepad', label, t, 'playstation').tokens.map((g) => g.text)).toEqual(['✕']);
    expect(stepGlyphs('throw', 'gamepad', label, t, 'xbox').tokens.map((g) => g.text)).toEqual(['LB']);
    expect(skipGlyph('gamepad', 'playstation')?.text).toBe('Create');
    expect(skipGlyph('kbm')?.text).toBe('Esc');
    expect(skipGlyph('touch')).toBeNull();
  });

  it('gestures that a button pulse cannot show get a pill on touch', () => {
    for (const s of ['look', 'move', 'sprint', 'slide'] as const) expect(stepGlyphs(s, 'touch', label, t).tokens).toHaveLength(1);
    expect(stepGlyphs('shoot', 'touch', label, t).tokens).toHaveLength(0);
  });

  it('marks ordered sequences so RTL rows flow right-to-left', () => {
    expect(stepGlyphs('slide', 'kbm', label, t).sequence).toBe(true);
    expect(stepGlyphs('slide', 'gamepad', label, t).sequence).toBe(true);
    expect(stepGlyphs('move', 'kbm', label, t).sequence).toBe(false);
  });

  it('hints are device aware where the verb differs', () => {
    expect(hintKey('sprint', 'kbm')).toBe('tutorial.hint.sprint');
    expect(hintKey('sprint', 'touch')).toBe('tutorial.hint.sprint.touch');
    expect(hintKey('sprint', 'gamepad')).toBe('tutorial.hint.sprint.pad');
    expect(hintKey('reload', 'touch')).toBe('tutorial.hint.reload');
  });

  it('both locales have every prompt, hint and gesture string', () => {
    const keys = [...STEP_ORDER.map((s) => `tutorial.${s}`), ...allHintKeys(STEP_ORDER), 'tutorial.glyph.dragRight', 'tutorial.glyph.dragLeft', 'tutorial.glyph.pushStick', 'tutorial.glyph.sprintTap'];
    for (const k of keys) {
      expect((en as Record<string, string>)[k], `en ${k}`).toBeTruthy();
      expect((ar as Record<string, string>)[k], `ar ${k}`).toBeTruthy();
    }
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });
});
