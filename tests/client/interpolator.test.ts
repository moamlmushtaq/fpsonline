import { describe, expect, it } from 'vitest';
import { INTERP_DELAY, SIM_HZ, SNAPSHOT_EVERY_TICKS } from '../../src/shared/constants';
import { mulberry32 } from '../../src/shared/math';
import { EntityBuffer, InterpClock, emptySample } from '../../src/client/game/interpolator';
import { PF_ALIVE } from '../../src/shared/types';

const TICK_MS = 1000 / SIM_HZ;

/** Simulates a host sending snapshots every SNAPSHOT_EVERY_TICKS with network jitter; returns per-frame render ticks. */
function runClock(opts: { seconds: number; jitterMs: number; latencyMs: number; frameMs?: number; seed?: number; stallAt?: number; stallMs?: number }) {
  const rng = mulberry32(opts.seed ?? 7);
  const clock = new InterpClock();
  const frameMs = opts.frameMs ?? 1000 / 60;
  // Pre-compute arrivals (ordered delivery, like TCP / postMessage).
  const arrivals: { tick: number; at: number }[] = [];
  let lastAt = 0;
  for (let tick = SNAPSHOT_EVERY_TICKS; tick * TICK_MS < opts.seconds * 1000; tick += SNAPSHOT_EVERY_TICKS) {
    let at = tick * TICK_MS + opts.latencyMs + rng() * opts.jitterMs;
    if (opts.stallAt !== undefined && at > opts.stallAt && at < opts.stallAt + (opts.stallMs ?? 0)) at = opts.stallAt + (opts.stallMs ?? 0);
    at = Math.max(at, lastAt);
    lastAt = at;
    arrivals.push({ tick, at });
  }
  const frames: { now: number; render: number; latest: number; hostNow: number }[] = [];
  let i = 0;
  for (let now = 0; now < opts.seconds * 1000; now += frameMs) {
    while (i < arrivals.length && arrivals[i].at <= now) clock.onSnapshot(arrivals[i].tick, arrivals[i].at), i++;
    clock.update(now, frameMs / 1000);
    frames.push({ now, render: clock.renderTick, latest: clock.latestTick, hostNow: now / TICK_MS });
  }
  return { clock, frames };
}

describe('InterpClock', () => {
  it('renders monotonically, at ~real-time rate, INTERP_DELAY behind the newest data on a clean link', () => {
    const { frames } = runClock({ seconds: 8, jitterMs: 2, latencyMs: 30 });
    const settled = frames.filter((f) => f.now > 2000);
    let extrap = 0;
    for (let k = 1; k < frames.length; k++) expect(frames[k].render).toBeGreaterThanOrEqual(frames[k - 1].render);
    for (let k = 1; k < settled.length; k++) {
      const rate = (settled[k].render - settled[k - 1].render) / ((settled[k].now - settled[k - 1].now) / TICK_MS);
      expect(rate).toBeGreaterThan(0.89);
      expect(rate).toBeLessThan(1.11);
      if (settled[k].render > settled[k].latest) extrap++;
    }
    // Rendered ≈ delay behind the host's clock (latency + INTERP_DELAY).
    const lag = settled.map((f) => f.hostNow - f.render);
    const avg = lag.reduce((s, x) => s + x, 0) / lag.length;
    expect(avg).toBeGreaterThan(INTERP_DELAY * SIM_HZ);
    expect(avg).toBeLessThan(INTERP_DELAY * SIM_HZ + 30 / TICK_MS + 3);
    expect(extrap).toBe(0);
  });

  it('absorbs heavy jitter by growing the delay instead of extrapolating', () => {
    const { frames, clock } = runClock({ seconds: 12, jitterMs: 70, latencyMs: 40, seed: 3 });
    const settled = frames.filter((f) => f.now > 4000);
    const extrapFrames = settled.filter((f) => f.render > f.latest).length;
    expect(extrapFrames / settled.length).toBeLessThan(0.05);
    expect(clock.delayTicks).toBeGreaterThan(INTERP_DELAY * SIM_HZ);
    for (let k = 1; k < frames.length; k++) expect(frames[k].render).toBeGreaterThanOrEqual(frames[k - 1].render);
  });

  it('recovers from a long stall (hidden tab) by resyncing instead of crawling', () => {
    const { frames } = runClock({ seconds: 10, jitterMs: 5, latencyMs: 30, stallAt: 3000, stallMs: 2500 });
    const after = frames.filter((f) => f.now > 6500);
    for (const f of after) expect(Math.abs(f.hostNow - f.render)).toBeLessThan(INTERP_DELAY * SIM_HZ + 12);
  });

  it('works at low frame rates', () => {
    const { frames } = runClock({ seconds: 6, jitterMs: 10, latencyMs: 20, frameMs: 100 });
    for (let k = 1; k < frames.length; k++) expect(frames[k].render).toBeGreaterThanOrEqual(frames[k - 1].render);
    const last = frames[frames.length - 1];
    expect(last.hostNow - last.render).toBeLessThan(20);
  });
});

describe('EntityBuffer', () => {
  const snap = (x: number, yaw: number, alive = true) => ({ x, y: 0, z: 0, vx: 6, vy: 0, vz: 0, yaw, pitch: 0, f: alive ? PF_ALIVE : 0, w: 0, hp: 100, c: 0 });

  it('interpolates position and takes the shortest arc for yaw', () => {
    const b = new EntityBuffer(8);
    b.push(30, snap(0, 3.0));
    b.push(33, snap(0.3, -3.0));
    const out = emptySample();
    expect(b.sample(31.5, out)).toBe('interp');
    expect(out.x).toBeCloseTo(0.15, 6);
    // 3.0 → -3.0 crosses ±π: halfway is π (or -π), not 0.
    expect(Math.abs(out.yaw)).toBeGreaterThan(3.1);
  });

  it('never lerps across a teleport or a respawn', () => {
    const b = new EntityBuffer(8);
    b.push(30, snap(0, 0, false));
    b.push(33, snap(40, 0, true));
    const out = emptySample();
    b.sample(32.9, out);
    expect(out.x).toBe(0);
    b.sample(33, out);
    expect(out.x).toBe(40);
  });

  it('extrapolates with velocity for at most 100 ms, then freezes', () => {
    const b = new EntityBuffer(8);
    b.push(30, snap(0, 0));
    b.push(33, snap(0.3, 0));
    const out = emptySample();
    expect(b.sample(36, out)).toBe('extrap');
    expect(out.x).toBeCloseTo(0.3 + 6 * (3 / SIM_HZ), 6);
    expect(b.sample(60, out)).toBe('frozen');
    expect(out.x).toBeCloseTo(0.3 + 6 * 0.1, 6);
  });

  it('keeps a bounded ring and ignores stale ticks', () => {
    const b = new EntityBuffer(4);
    for (let t = 0; t < 40; t += 3) b.push(t, snap(t, 0));
    expect(b.size).toBe(4);
    b.push(10, snap(999, 0)); // older than newest → ignored
    expect(b.newest()?.x).toBe(39);
    b.push(39, snap(1000, 0)); // same tick → replaces newest
    expect(b.newest()?.x).toBe(1000);
  });
});
