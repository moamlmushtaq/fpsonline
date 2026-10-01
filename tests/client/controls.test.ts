import { describe, expect, it } from 'vitest';
import { PAD_LOOK, PAD_MOVE, shapeStick, TOUCH_STICK, TouchLookFilter, touchLookGain } from '../../src/client/input/curves';
import { detectPadStyle, padButtonLabel, padGlyph } from '../../src/client/input/glyphs';
import { rebindWithSwap } from '../../src/client/input/rebind';
import { assistCone, ASSIST_MAX_SLOW, computeAimAssist, type AimAssistResult } from '../../src/client/game/aim-assist';

describe('stick shaping', () => {
  it('has a dead zone without an output jump at its edge', () => {
    for (const s of [PAD_MOVE, PAD_LOOK, TOUCH_STICK]) {
      expect(shapeStick(s.inner * 0.9, 0, s).m).toBe(0);
      expect(shapeStick(s.inner + 0.01, 0, s).m).toBeLessThan(0.08);
      expect(shapeStick(0, -1, s).m).toBeCloseTo(1, 5);
      expect(shapeStick(s.outer + 0.001, 0, s).m).toBeCloseTo(1, 5);
    }
  });

  it('is monotonic and preserves direction', () => {
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 0.02) {
      const m = shapeStick(v, 0, PAD_LOOK).m;
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
    const o = shapeStick(0.5, 0.5, PAD_MOVE);
    expect(o.x).toBeCloseTo(o.y, 6);
    expect(o.x).toBeGreaterThan(0);
  });

  it('look curve is finer than linear near the centre', () => {
    const lin = (0.3 - PAD_LOOK.inner) / (PAD_LOOK.outer - PAD_LOOK.inner);
    expect(shapeStick(0.3, 0, PAD_LOOK).m).toBeLessThan(lin);
  });
});

describe('touch look', () => {
  it('gain is ~1 at a tracking speed, finer when slow, faster on flicks', () => {
    expect(touchLookGain(420)).toBeCloseTo(1, 5);
    expect(touchLookGain(40)).toBeLessThan(0.95);
    expect(touchLookGain(3000)).toBeGreaterThan(1.8);
  });

  it('delivers the whole drag (no loss) and is frame-rate independent', () => {
    const run = (hz: number) => {
      const f = new TouchLookFilter();
      const o = { x: 0, y: 0 };
      let total = 0;
      const frames = hz / 2; // 0.5 s drag at 200 px/s
      for (let i = 0; i < frames; i++) {
        f.push(200 / hz, 0);
        total += f.step(1 / hz, true, o).x;
      }
      total += f.step(1 / hz, false, o).x; // finger lifts: remainder flushed
      return total;
    };
    const a = run(60);
    const b = run(120);
    expect(a).toBeGreaterThan(80);
    expect(Math.abs(a - b) / a).toBeLessThan(0.08);
  });

  it('never drifts after the finger lifts', () => {
    const f = new TouchLookFilter();
    const o = { x: 0, y: 0 };
    f.push(30, 10);
    f.step(1 / 60, true, o);
    f.step(1 / 60, false, o);
    expect(f.step(1 / 60, false, o)).toEqual({ x: 0, y: 0 });
  });
});

describe('pad glyphs', () => {
  it('detects controller families from Gamepad.id', () => {
    expect(detectPadStyle('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(detectPadStyle('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(detectPadStyle('054c-09cc-Wireless Controller')).toBe('playstation');
    expect(detectPadStyle('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('nintendo');
    expect(detectPadStyle('USB Gamepad')).toBe('generic');
    expect(detectPadStyle('')).toBe('generic');
  });

  it('labels actions per family', () => {
    expect(padGlyph('fire', 'xbox')).toBe('RT');
    expect(padGlyph('fire', 'playstation')).toBe('R2');
    expect(padGlyph('jump', 'playstation')).toBe('✕');
    expect(padGlyph('jump', 'nintendo')).toBe('B');
    expect(padGlyph('forward', 'xbox')).toBe('LS');
    expect(padButtonLabel(9, 'playstation')).toBe('Options');
    expect(padGlyph('nope', 'xbox')).toBe('');
  });
});

describe('aim assist', () => {
  const eye = { x: 0, y: 1.6, z: 0 };
  // yaw 0 looks toward -z (forward = (-sin yaw, 0, -cos yaw)).
  const query = (targets: { x: number; y: number; z: number }[], opts: { engaged?: boolean; visible?: boolean; yaw?: number } = {}) => ({
    eye,
    yaw: opts.yaw ?? 0,
    pitch: 0,
    engaged: opts.engaged ?? false,
    targets,
    count: targets.length,
    visible: () => opts.visible ?? true,
  });
  const fresh = (): AimAssistResult => ({ dx: 0, dy: 0, slow: 0, target: -1 });

  it('cone follows the angular size of the target', () => {
    expect(assistCone(5)).toBeGreaterThan(assistCone(30));
    expect(assistCone(200)).toBeGreaterThan(0);
  });

  it('slows down over a visible target and eases in', () => {
    const out = fresh();
    const q = query([{ x: 0, y: 1.6, z: -15 }]);
    computeAimAssist(q, 1 / 60, out);
    expect(out.target).toBe(0);
    expect(out.slow).toBeGreaterThan(0);
    expect(out.slow).toBeLessThan(ASSIST_MAX_SLOW);
    for (let i = 0; i < 60; i++) computeAimAssist(q, 1 / 60, out);
    expect(out.slow).toBeCloseTo(ASSIST_MAX_SLOW, 2);
    // Not engaged: no magnetism.
    expect(out.dx).toBe(0);
    expect(out.dy).toBe(0);
  });

  it('never assists through walls/smoke or behind the player', () => {
    const out = fresh();
    computeAimAssist(query([{ x: 0, y: 1.6, z: -15 }], { visible: false, engaged: true }), 1 / 60, out);
    expect(out.target).toBe(-1);
    expect(out.dx).toBe(0);
    const out2 = fresh();
    computeAimAssist(query([{ x: 0, y: 1.6, z: 15 }], { engaged: true }), 1 / 60, out2);
    expect(out2.target).toBe(-1);
  });

  it('magnetism is gentle and pulls toward the target without overshoot', () => {
    const out = fresh();
    // Target slightly to the RIGHT (+x) at 12 m.
    const t = { x: 0.35, y: 1.6, z: -12 };
    computeAimAssist(query([t], { engaged: true }), 1 / 60, out);
    expect(out.target).toBe(0);
    expect(out.dx).toBeGreaterThan(0); // turn right
    const perSecond = out.dx * 60;
    expect(perSecond).toBeLessThanOrEqual((2 * Math.PI) / 180 + 1e-9);
    // A huge dt cannot overshoot the target.
    const big = fresh();
    computeAimAssist(query([t], { engaged: true }), 100, big);
    const angle = Math.atan2(0.35, 12);
    expect(Math.hypot(big.dx, big.dy)).toBeLessThanOrEqual(angle + 1e-6);
  });

  it('ignores targets outside the cone', () => {
    const out = fresh();
    computeAimAssist(query([{ x: 6, y: 1.6, z: -20 }], { engaged: true }), 1 / 60, out);
    expect(out.target).toBe(-1);
    expect(out.slow).toBe(0);
  });
});

describe('rebinding', () => {
  // Mirrors SettingsStore.bind: a key bound elsewhere is removed there; max two keys.
  const store = () => {
    const value = { bindings: { fire: { keys: ['Mouse0'] }, reload: { keys: ['KeyR'] }, interact: { keys: ['KeyE', 'KeyF'] } } as Record<string, { keys: string[] }> };
    return {
      value,
      bind(action: string, slot: number, code: string | null) {
        const b = value.bindings;
        if (code) for (const a of Object.keys(b)) if (a !== action) b[a] = { keys: b[a].keys.filter((k) => k !== code) };
        const keys = [...b[action].keys];
        if (code) {
          const ex = keys.indexOf(code);
          if (ex >= 0) keys.splice(ex, 1);
          if (slot >= keys.length) keys.push(code);
          else keys[slot] = code;
        } else if (slot < keys.length) keys.splice(slot, 1);
        b[action] = { keys: keys.slice(0, 2) };
      },
    };
  };

  it('swaps keys on conflict so nothing is left unbound', () => {
    const s = store();
    const r = rebindWithSwap(s, 'reload', 0, 'KeyE');
    expect(r).toEqual({ from: 'interact', swapped: 'KeyR' });
    expect(s.value.bindings.reload.keys).toEqual(['KeyE']);
    expect(s.value.bindings.interact.keys).toContain('KeyR');
    expect(s.value.bindings.interact.keys).toContain('KeyF');
  });

  it('plain bind and unbind without conflicts', () => {
    const s = store();
    expect(rebindWithSwap(s, 'reload', 1, 'KeyT')).toEqual({ from: null, swapped: null });
    expect(s.value.bindings.reload.keys).toEqual(['KeyR', 'KeyT']);
    rebindWithSwap(s, 'reload', 1, null);
    expect(s.value.bindings.reload.keys).toEqual(['KeyR']);
  });

  it('moving a key into an empty slot just takes it', () => {
    const s = store();
    const r = rebindWithSwap(s, 'reload', 1, 'Mouse0');
    expect(r).toEqual({ from: 'fire', swapped: null });
    expect(s.value.bindings.fire.keys).toEqual([]);
  });
});
