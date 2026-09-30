import { describe, expect, it } from 'vitest';
import type { Solid } from '../../src/shared/maps/types';
import {
  angleDiff,
  clamp,
  forwardFromAngles,
  hash32,
  hashFloat,
  hashFloat4,
  lerp,
  mulberry32,
  normalize,
  smoothstep,
  v3,
  wrapAngle,
  yawFromDir,
} from '../../src/shared/math';
import { dedupeName, guestName, sanitizeName } from '../../src/shared/names';
import { CollisionWorld } from '../../src/shared/physics';
import { LagHistory } from '../../src/shared/sim/lagcomp';
import { smokeBlocks } from '../../src/shared/sim/throwables';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, extra: Partial<Solid> = {}): Solid => ({
  min: { x: x0, y: y0, z: z0 },
  max: { x: x1, y: y1, z: z1 },
  tag: 'concrete',
  ...extra,
});
const bounds = { min: { x: -100, y: -10, z: -100 }, max: { x: 100, y: 50, z: 100 } };

describe('math', () => {
  it('angles follow the types.ts convention', () => {
    const f0 = forwardFromAngles(0, 0);
    expect(f0.z).toBeCloseTo(-1, 12);
    const left = forwardFromAngles(Math.PI / 2, 0);
    expect(left.x).toBeCloseTo(-1, 12); // +yaw turns left
    const up = forwardFromAngles(0, 0.5);
    expect(up.y).toBeCloseTo(Math.sin(0.5), 12);
    expect(yawFromDir(-1, 0)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(angleDiff(3, -3)).toBeCloseTo(2 * Math.PI - 6, 12);
  });

  it('hashing and RNG are deterministic and well distributed', () => {
    expect(hash32(1, 2, 3)).toBe(hash32(1, 2, 3));
    expect(hash32(1, 2, 3)).not.toBe(hash32(3, 2, 1));
    expect(hashFloat4(4, 5, 6, 7)).toBe(hashFloat(4, 5, 6, 7));
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const a = r1();
      expect(a).toBe(r2());
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
      sum += a;
    }
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(normalize(v3(), v3(0, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('names: sanitize, dedupe, guest', () => {
    expect(sanitizeName('  Hello   World  ')).toBe('Hello World');
    expect(sanitizeName('<script>alert(1)</script>')).toBe('scriptalert1scri');
    expect(sanitizeName('ab')).toBeNull();
    expect(sanitizeName('سلام عليكم')).toBe('سلام عليكم');
    expect(sanitizeName(42)).toBeNull();
    expect(dedupeName('Ace', (n) => n === 'Ace' || n === 'Ace2')).toBe('Ace3');
    expect(dedupeName('SixteenCharsName', (n) => n === 'SixteenCharsName')).toBe('SixteenCharsNam2');
    const g = guestName(mulberry32(1));
    expect(g.length).toBeLessThanOrEqual(16);
    expect(g).toMatch(/^[A-Za-z]+-[A-Za-z]+-\d\d$/);
  });
});

describe('CollisionWorld', () => {
  it('raycasts hit the nearest box face with the right normal', () => {
    const w = new CollisionWorld([box(-1, 0, -11, 1, 3, -10), box(-1, 0, -21, 1, 3, -20)], bounds);
    const hit = w.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 100)!;
    expect(hit.dist).toBeCloseTo(10, 9);
    expect(hit.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(hit.point.z).toBeCloseTo(-10, 9);
    expect(w.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 5)).toBeNull();
    expect(w.raycast({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: -1 }, 100)).toBeNull();
    // Long diagonal ray across many grid cells.
    const d = normalize(v3(), v3(1, 0, -1));
    const w2 = new CollisionWorld([box(60, 0, -61, 61, 3, -59)], bounds);
    expect(w2.raycast({ x: 0, y: 1, z: 0 }, d, 200)?.dist).toBeCloseTo(60 * Math.SQRT2, 6);
  });

  it('ramps are wedges: rays hit the slope, groundAt follows it', () => {
    // Rises from y=0 at z=0 to y=4 at z=-10 (toward −z).
    const w = new CollisionWorld([box(-2, 0, -10, 2, 4, 0, { ramp: { axis: 'z', dir: -1 } })], bounds);
    expect(w.groundAt(0, -5, 10, 20)!.y).toBeCloseTo(2, 9);
    expect(w.groundAt(0, -10, 10, 20)!.y).toBeCloseTo(4, 9);
    // A horizontal ray at y=1 enters the slope at z = −2.5 (the wedge's top), not the box face at z=0.
    const hit = w.raycast({ x: 0, y: 1, z: 5 }, { x: 0, y: 0, z: -1 }, 100)!;
    expect(hit.point.z).toBeCloseTo(-2.5, 6);
    expect(hit.normal.y).toBeGreaterThan(0.9);
    expect(hit.normal.z).toBeGreaterThan(0.3);
    // A ray above the slope passes over the low end.
    expect(w.raycast({ x: 0, y: 3.5, z: 5 }, { x: 0, y: 0, z: -1 }, 7)).toBeNull();
    // Straight down onto the slope.
    expect(w.raycast({ x: 0, y: 10, z: -5 }, { x: 0, y: -1, z: 0 }, 100)!.dist).toBeCloseTo(8, 6);
  });

  it('modes: bullets pass shootThrough, movement passes walkThrough', () => {
    const w = new CollisionWorld([box(-1, 0, -6, 1, 3, -5, { shootThrough: true }), box(-1, 0, -11, 1, 3, -10, { walkThrough: true })], bounds);
    const o = { x: 0, y: 1, z: 0 };
    const d = { x: 0, y: 0, z: -1 };
    expect(w.raycast(o, d, 100, 'bullet')!.dist).toBeCloseTo(10, 9);
    expect(w.raycast(o, d, 100, 'sight')!.dist).toBeCloseTo(10, 9);
    expect(w.raycast(o, d, 100, 'move')!.dist).toBeCloseTo(5, 9);
    expect(w.visible({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -8 })).toBe(true);
    expect(w.visible({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -12 })).toBe(false);
    expect(w.playerOverlaps({ x: 0, y: 0, z: -10.5 }, 1.8)).toBe(false);
    expect(w.playerOverlaps({ x: 0, y: 0, z: -5.5 }, 1.8)).toBe(true);
  });

  it('groundAt picks the highest surface below, ignoring those above', () => {
    const w = new CollisionWorld([box(-5, -1, -5, 5, 0, 5), box(-1, 2, -1, 1, 2.3, 1)], bounds);
    expect(w.groundAt(0, 0, 5, 10)!.y).toBeCloseTo(2.3, 9);
    expect(w.groundAt(0, 0, 1, 10)!.y).toBeCloseTo(0, 9);
    expect(w.groundAt(20, 20, 5, 10)).toBeNull();
    expect(w.playerOverlaps({ x: 0, y: 0, z: 0 }, 2.1)).toBe(true); // head in the slab
    expect(w.playerOverlaps({ x: 0, y: 0, z: 0 }, 1.8)).toBe(false);
    expect(w.playerOverlaps({ x: 0, y: 2.3, z: 0 }, 1.8)).toBe(false); // standing on it
  });

  it('is fast enough for thousands of rays per second', () => {
    const solids: Solid[] = [box(-60, -1, -60, 60, 0, 60)];
    const rng = mulberry32(3);
    for (let i = 0; i < 100; i++) {
      const x = rng() * 100 - 50;
      const z = rng() * 100 - 50;
      solids.push(box(x, 0, z, x + 1 + rng() * 4, 0.5 + rng() * 5, z + 1 + rng() * 4));
    }
    const w = new CollisionWorld(solids, bounds);
    const t0 = performance.now();
    let hits = 0;
    for (let i = 0; i < 20000; i++) {
      const d = normalize(v3(), v3(rng() - 0.5, rng() * 0.2 - 0.1, rng() - 0.5));
      if (w.rayDist(rng() * 80 - 40, 1.5, rng() * 80 - 40, d.x, d.y, d.z, 80, 'sight') !== Infinity) hits++;
    }
    const perRay = ((performance.now() - t0) * 1000) / 20000;
    expect(hits).toBeGreaterThan(1000);
    expect(perRay).toBeLessThan(20); // µs
  });
});

describe('LagHistory & smoke', () => {
  it('rewinds with interpolation and clamps', () => {
    const h = new LagHistory(10);
    for (let t = 1; t <= 20; t++) h.record(1, t, { x: t, y: 0, z: 0 }, 0, true);
    const out = { pos: { x: 0, y: 0, z: 0 }, crouchT: 0, alive: false };
    expect(h.sample(1, 15.5, out)).toBe(true);
    expect(out.pos.x).toBeCloseTo(15.5, 9);
    h.sample(1, 2, out);
    expect(out.pos.x).toBe(11); // oldest kept sample
    h.sample(1, 99, out);
    expect(out.pos.x).toBe(20);
    expect(h.sample(2, 5, out)).toBe(false);
    expect(LagHistory.clampViewTick(0, 100)).toBe(100 - 15);
    expect(LagHistory.clampViewTick(NaN, 100)).toBe(100);
  });

  it('smoke clouds block sight lines through them', () => {
    const smokes = [{ id: 1, pos: { x: 0, y: 1, z: 0 }, r: 5, t: 10, age: 3 }];
    expect(smokeBlocks(smokes, { x: -10, y: 1, z: 0 }, { x: 10, y: 1, z: 0 })).toBe(true);
    expect(smokeBlocks(smokes, { x: -10, y: 1, z: 8 }, { x: 10, y: 1, z: 8 })).toBe(false);
    expect(smokeBlocks([], { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })).toBe(false);
  });
});

describe('RangeStats', () => {
  it('computes accuracy and time-to-kill per distance', async () => {
    const { RangeStats } = await import('../../src/shared/sim/range');
    const st = new RangeStats();
    st.onShot();
    st.onTargetEvent({ t: 'target', id: 1, head: false, kill: false, dmg: 40, dist: 25 }, 10);
    st.onShot();
    st.onShot();
    st.onTargetEvent({ t: 'target', id: 1, head: true, kill: true, dmg: 60, dist: 25 }, 10.5);
    const s = st.summary();
    expect(s.shots).toBe(3);
    expect(s.hits).toBe(2);
    expect(s.headshots).toBe(1);
    expect(s.kills).toBe(1);
    expect(s.accuracy).toBeCloseTo(2 / 3, 6);
    expect(s.ttkByDistance).toEqual([{ distance: 25, avg: 0.5, count: 1 }]);
  });
});
