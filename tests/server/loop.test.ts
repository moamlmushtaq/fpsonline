// HostLoop: drives a target that reproduces HostCore's fixed-step accumulator
// and checks that (a) the simulation advances at 60 Hz of wall time, (b) each
// wake advances exactly one step (even snapshot spacing), (c) idle mode sleeps
// and wake() resumes promptly, and (d) the loop recovers from event-loop stalls.

import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { SIM_HZ } from '../../src/shared/constants';
import { HostLoop, type TickTarget } from '../../src/server/loop';

const TICK_MS = 1000 / SIM_HZ;

/** Same accumulator logic as HostCore.update (fixed steps, ≤ 8 per call, excess dropped). */
class AccumulatorTarget implements TickTarget {
  lastMs: number | null = null;
  acc = 0;
  steps = 0;
  perUpdate: number[] = [];
  updateTimes: number[] = [];
  rooms = 1;
  update(nowMs: number): void {
    this.updateTimes.push(performance.now());
    if (this.lastMs === null) {
      this.lastMs = nowMs;
      return;
    }
    let elapsed = nowMs - this.lastMs;
    this.lastMs = nowMs;
    if (!(elapsed > 0)) elapsed = 0;
    this.acc += elapsed;
    let steps = Math.floor(this.acc / TICK_MS);
    if (steps > 8) {
      steps = 8;
      this.acc = 0;
    } else this.acc -= steps * TICK_MS;
    this.steps += steps;
    this.perUpdate.push(steps);
  }
  stats(): { rooms: number; queued: number } {
    return { rooms: this.rooms, queued: 0 };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let loop: HostLoop | null = null;
afterEach(() => loop?.stop());

describe('HostLoop', () => {
  it('advances exactly one fixed step per wake at 60 Hz', async () => {
    const t = new AccumulatorTarget();
    loop = new HostLoop(t);
    const t0 = performance.now();
    loop.start();
    await sleep(1000);
    loop.stop();
    const elapsed = performance.now() - t0;
    const expected = (elapsed / 1000) * SIM_HZ;
    expect(t.steps).toBeGreaterThan(expected * 0.9);
    expect(t.steps).toBeLessThan(expected * 1.05);
    // Never a wasted wake (0 steps) — and nearly always exactly one step.
    expect(t.perUpdate.filter((s) => s === 0)).toHaveLength(0);
    const single = t.perUpdate.filter((s) => s === 1).length;
    expect(single / t.perUpdate.length).toBeGreaterThan(0.9);
  });

  it('sleeps while idle and wakes promptly on activity', async () => {
    const t = new AccumulatorTarget();
    t.rooms = 0;
    loop = new HostLoop(t, { idleMs: 100 });
    loop.start();
    await sleep(600);
    const idleUpdates = t.updateTimes.length;
    expect(idleUpdates).toBeLessThanOrEqual(9); // ~6 wakes + the initial clock sample
    expect(t.perUpdate.every((s) => s <= 8)).toBe(true); // idle sleep never exceeds the catch-up budget
    t.rooms = 1;
    const woke = performance.now();
    loop.wake();
    await sleep(60);
    const after = t.updateTimes.filter((x) => x >= woke);
    expect(after.length).toBeGreaterThanOrEqual(2);
    expect(after[0] - woke).toBeLessThan(40);
  });

  it('recovers the one-step cadence after an event-loop stall', async () => {
    const t = new AccumulatorTarget();
    let stalled = 0;
    loop = new HostLoop(t, { onStall: (ms) => (stalled += ms) });
    loop.start();
    await sleep(200);
    const block = performance.now();
    while (performance.now() - block < 300) {
      /* stall the event loop for 300 ms (> 8 ticks) */
    }
    await sleep(20);
    const mark = t.perUpdate.length;
    await sleep(500);
    loop.stop();
    expect(loop.stalls).toBeGreaterThanOrEqual(1);
    expect(stalled).toBeGreaterThan(0);
    const tail = t.perUpdate.slice(mark);
    expect(tail.filter((s) => s === 0)).toHaveLength(0);
    expect(tail.filter((s) => s === 1).length / tail.length).toBeGreaterThan(0.85);
  });
});
