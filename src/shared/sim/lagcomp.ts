// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — lag compensation history.
//
// The host records every player's position/crouch/alive state once per tick in
// a fixed ring buffer (HISTORY_TICKS deep). When resolving a shooter's hitscan,
// victims are rewound to the tick the shooter was displaying (InputCmd.viewTick,
// fractional), clamped to MAX_REWIND, and linearly interpolated between the two
// bracketing samples. Allocation-free after construction of each player's ring.
// ─────────────────────────────────────────────────────────────────────────────

import { HISTORY_TICKS, MAX_REWIND, SIM_HZ } from '../constants';
import type { Vec3 } from '../types';

/** Stride of one sample in the ring: x, y, z, crouchT, alive(0/1). */
const S = 5;

interface Ring {
  ticks: Int32Array;
  data: Float64Array;
  head: number;
  count: number;
}

export interface RewoundState {
  pos: Vec3;
  crouchT: number;
  alive: boolean;
}

export class LagHistory {
  private readonly rings = new Map<number, Ring>();
  private readonly capacity: number;

  constructor(capacity = HISTORY_TICKS) {
    this.capacity = Math.max(2, capacity | 0);
  }

  /** Records one player's state for `tick`. Call once per player per tick, ticks increasing. */
  record(id: number, tick: number, pos: Vec3, crouchT: number, alive: boolean): void {
    let r = this.rings.get(id);
    if (!r) {
      r = { ticks: new Int32Array(this.capacity), data: new Float64Array(this.capacity * S), head: 0, count: 0 };
      this.rings.set(id, r);
    }
    // Overwrite if the same tick is recorded twice.
    const last = (r.head - 1 + this.capacity) % this.capacity;
    let slot = r.head;
    if (r.count > 0 && r.ticks[last] === tick) slot = last;
    else {
      r.head = (r.head + 1) % this.capacity;
      if (r.count < this.capacity) r.count++;
    }
    r.ticks[slot] = tick;
    const o = slot * S;
    r.data[o] = pos.x;
    r.data[o + 1] = pos.y;
    r.data[o + 2] = pos.z;
    r.data[o + 3] = crouchT;
    r.data[o + 4] = alive ? 1 : 0;
  }

  remove(id: number): void {
    this.rings.delete(id);
  }

  clear(): void {
    this.rings.clear();
  }

  /** Clamps a requested view tick to the allowed rewind window ending at `nowTick`. */
  static clampViewTick(viewTick: number, nowTick: number): number {
    if (!Number.isFinite(viewTick)) return nowTick;
    const minTick = nowTick - MAX_REWIND * SIM_HZ;
    return viewTick < minTick ? minTick : viewTick > nowTick ? nowTick : viewTick;
  }

  /**
   * Samples player `id` at (fractional) `tick`, writing into `out`. Returns false if
   * there is no history for the player. Ticks outside the recorded range clamp to
   * the oldest/newest sample.
   */
  sample(id: number, tick: number, out: RewoundState): boolean {
    const r = this.rings.get(id);
    if (!r || r.count === 0) return false;
    const cap = this.capacity;
    const newest = (r.head - 1 + cap) % cap;
    const oldest = (r.head - r.count + cap) % cap;
    if (tick >= r.ticks[newest]) return this.write(r, newest, newest, 0, out);
    if (tick <= r.ticks[oldest]) return this.write(r, oldest, oldest, 0, out);
    // Walk back from the newest sample (rewinds are short, so this is a few steps).
    let b = newest;
    for (let k = 0; k < r.count - 1; k++) {
      const a = (b - 1 + cap) % cap;
      const ta = r.ticks[a];
      if (ta <= tick) {
        const tb = r.ticks[b];
        const f = tb > ta ? (tick - ta) / (tb - ta) : 0;
        return this.write(r, a, b, f, out);
      }
      b = a;
    }
    return this.write(r, oldest, oldest, 0, out);
  }

  private write(r: Ring, a: number, b: number, f: number, out: RewoundState): boolean {
    const oa = a * S;
    const ob = b * S;
    const d = r.data;
    // Do not interpolate across death/respawn teleports: snap to the nearer sample.
    const aliveA = d[oa + 4] > 0.5;
    const aliveB = d[ob + 4] > 0.5;
    if (aliveA !== aliveB) {
      const src = f < 0.5 ? oa : ob;
      out.pos.x = d[src];
      out.pos.y = d[src + 1];
      out.pos.z = d[src + 2];
      out.crouchT = d[src + 3];
      out.alive = d[src + 4] > 0.5;
      return true;
    }
    out.pos.x = d[oa] + (d[ob] - d[oa]) * f;
    out.pos.y = d[oa + 1] + (d[ob + 1] - d[oa + 1]) * f;
    out.pos.z = d[oa + 2] + (d[ob + 2] - d[oa + 2]) * f;
    out.crouchT = d[oa + 3] + (d[ob + 3] - d[oa + 3]) * f;
    out.alive = aliveA;
    return true;
  }
}
