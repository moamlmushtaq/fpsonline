// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — snapshot clock + interpolation buffers for remote entities.
//
// InterpClock turns jittery snapshot arrivals into a smooth, monotonic
// "render tick" (fractional host tick) that sits INTERP_DELAY (+ measured
// jitter) behind the newest data:
//   • offset = estimate of (hostTick − localTick(now)). It tracks the EARLIEST
//     arrivals (least-delayed packets) and decays slowly toward later ones, so
//     a permanent latency change is followed without reacting to single late
//     packets.
//   • jitter = EWMA of how late packets arrive relative to that estimate; the
//     delay grows with it so we interpolate instead of extrapolating.
//   • renderTick advances at real time, nudged ≤ ±10 % toward its target (no
//     visible speed-ups), and hard-resyncs after long stalls (hidden tab).
// The same render tick is sent to the host as InputCmd.viewTick for lag
// compensation, so what you see is what the host rewinds to.
//
// EntityBuffer is a fixed ring of samples keyed by host tick; `sample()`
// interpolates position/angles (shortest arc), steps discrete fields, never
// lerps across teleports/respawns, extrapolates ≤ 100 ms with velocity, then
// freezes.
//
// Pure logic: no DOM, no three.js — unit-tested in tests/client.
// ─────────────────────────────────────────────────────────────────────────────

import { INTERP_DELAY, SIM_HZ, SNAPSHOT_EVERY_TICKS } from '../../shared/constants';
import { wrapAngle } from '../../shared/math';

/** Snapshots this far from the clock estimate force a resync (ticks ≈ 1 s). */
const RESYNC_TICKS = 60;
/** Render tick further than this from its target jumps instead of slewing (ticks). */
const HARD_RESYNC_TICKS = 20;
/** Max rate adjustment while slewing toward the target. */
const MAX_SLEW = 0.1;
/**
 * Largest extra delay the jitter estimate may add (ticks). Kept small so that
 * render delay + input latency stays inside the host's MAX_REWIND (15 ticks):
 * beyond that, lag compensation clamps and on-screen hits would miss.
 */
const MAX_EXTRA_DELAY = 5;

export class InterpClock {
  /** Fractional host tick currently being displayed. */
  renderTick = 0;
  /** Newest host tick received. */
  latestTick = -1;
  synced = false;
  /** Snapshots received. */
  count = 0;
  /** Estimated (hostTick − localTick) where localTick = nowMs·SIM_HZ/1000. */
  private offset = 0;
  /** EWMA of packet lateness (ticks). */
  jitter = 0;
  private lastNow = -1;

  constructor(private readonly baseDelay = INTERP_DELAY * SIM_HZ) {}

  /** Current interpolation delay in ticks (base, or more under jitter). */
  get delayTicks(): number {
    return Math.max(this.baseDelay, Math.min(this.baseDelay + MAX_EXTRA_DELAY, SNAPSHOT_EVERY_TICKS + 1 + this.jitter * 2));
  }

  /** Best estimate of the host's current tick at local time `nowMs`. */
  hostTickAt(nowMs: number): number {
    return (nowMs * SIM_HZ) / 1000 + this.offset;
  }

  /** Call when a snapshot for `tick` arrives (nowMs = arrival time). */
  onSnapshot(tick: number, nowMs: number): void {
    this.count++;
    if (tick > this.latestTick) this.latestTick = tick;
    const sample = tick - (nowMs * SIM_HZ) / 1000;
    if (!this.synced || Math.abs(sample - this.offset) > RESYNC_TICKS) {
      const first = !this.synced;
      this.offset = sample;
      this.jitter = 0;
      this.synced = true;
      if (first || this.renderTick < tick - RESYNC_TICKS) this.renderTick = Math.max(this.renderTick, tick - this.delayTicks);
      return;
    }
    const late = this.offset - sample;
    if (late < 0) {
      // Earliest arrival so far: adopt most of it (fast-up).
      this.offset += -late * 0.6;
    } else {
      // Late arrival: decay slowly so a real latency increase is eventually followed.
      this.offset -= late * 0.02;
    }
    this.jitter += (Math.max(0, late) - this.jitter) * 0.08;
  }

  /**
   * Advances the render tick for a frame. Uses the real time elapsed since the
   * previous call (the frame dt is often capped by the app after hitches, which
   * would make the clock fall behind); `dt` is only the first-call fallback.
   */
  update(nowMs: number, dt: number): void {
    const elapsed = this.lastNow >= 0 ? Math.min(1, Math.max(0, (nowMs - this.lastNow) / 1000)) : Math.max(0, dt);
    this.lastNow = nowMs;
    if (!this.synced) return;
    dt = elapsed;
    const target = this.hostTickAt(nowMs) - this.delayTicks;
    const err = target - this.renderTick;
    if (err > HARD_RESYNC_TICKS) {
      this.renderTick = target;
      return;
    }
    if (err < -HARD_RESYNC_TICKS) {
      // Far ahead (clock went backwards?) — hold still until time catches up; never rewind.
      return;
    }
    const rate = 1 + Math.max(-MAX_SLEW, Math.min(MAX_SLEW, err * 0.08));
    this.renderTick += dt * SIM_HZ * rate;
  }
}

// ── Entity buffers ──────────────────────────────────────────────────────────

/** One remote-entity sample (a PlayerSnap superset; unused fields stay 0). */
export interface EntitySample {
  tick: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  /** Flags (PF_* for players; bit 0 = alive for targets). */
  f: number;
  /** Discrete payload (weapon index). */
  w: number;
  hp: number;
  /** Crouch 0..100. */
  c: number;
}

export interface EntitySnapLike {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  yaw?: number;
  pitch?: number;
  f?: number;
  w?: number;
  hp?: number;
  c?: number;
}

export function emptySample(): EntitySample {
  return { tick: -1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, f: 0, w: 0, hp: 0, c: 0 };
}

export type SampleMode = 'empty' | 'interp' | 'extrap' | 'frozen' | 'early';

/** Distance (m) between consecutive samples treated as a teleport (no lerp). */
const TELEPORT_DIST = 4;
/** Flag bit whose change forbids interpolation (alive). */
const ALIVE_BIT = 1;

export class EntityBuffer {
  private readonly ring: EntitySample[];
  private head = 0;
  private n = 0;

  constructor(private readonly capacity = 24) {
    this.ring = [];
    for (let i = 0; i < capacity; i++) this.ring.push(emptySample());
  }

  get size(): number {
    return this.n;
  }

  private at(i: number): EntitySample {
    // i = 0 oldest … n-1 newest
    return this.ring[(this.head - this.n + i + this.capacity * 2) % this.capacity];
  }

  newest(): EntitySample | null {
    return this.n ? this.at(this.n - 1) : null;
  }

  clear(): void {
    this.n = 0;
  }

  /** Adds a sample for `tick` (older/equal ticks replace the newest or are ignored). */
  push(tick: number, s: EntitySnapLike): void {
    let slot: EntitySample;
    const last = this.newest();
    if (last && tick < last.tick) return;
    if (last && tick === last.tick) slot = last;
    else {
      slot = this.ring[this.head];
      this.head = (this.head + 1) % this.capacity;
      if (this.n < this.capacity) this.n++;
    }
    slot.tick = tick;
    slot.x = s.x;
    slot.y = s.y;
    slot.z = s.z;
    slot.vx = s.vx ?? 0;
    slot.vy = s.vy ?? 0;
    slot.vz = s.vz ?? 0;
    slot.yaw = s.yaw ?? 0;
    slot.pitch = s.pitch ?? 0;
    slot.f = s.f ?? 0;
    slot.w = s.w ?? 0;
    slot.hp = s.hp ?? 0;
    slot.c = s.c ?? 0;
  }

  /**
   * Writes the state at (fractional) `tick` into `out`. Extrapolates with the
   * newest velocity for at most `maxExtrap` ticks, then freezes.
   */
  sample(tick: number, out: EntitySample, maxExtrap = SIM_HZ * 0.1): SampleMode {
    const n = this.n;
    if (n === 0) return 'empty';
    const first = this.at(0);
    if (tick <= first.tick) {
      copySample(first, out);
      out.tick = tick;
      return 'early';
    }
    const last = this.at(n - 1);
    if (tick >= last.tick) {
      copySample(last, out);
      const ext = Math.min(tick - last.tick, maxExtrap);
      if (ext > 0 && (last.f & ALIVE_BIT) !== 0) {
        const s = ext / SIM_HZ;
        out.x += last.vx * s;
        out.y += last.vy * s;
        out.z += last.vz * s;
      }
      out.tick = tick;
      return tick - last.tick > maxExtrap ? 'frozen' : 'extrap';
    }
    // Find the bracketing pair (newest first — the render tick is near the end).
    let b = n - 1;
    while (b > 0 && this.at(b - 1).tick > tick) b--;
    const A = this.at(b - 1);
    const B = this.at(b);
    const span = B.tick - A.tick;
    const k = span > 0 ? (tick - A.tick) / span : 1;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const dz = B.z - A.z;
    const teleport = dx * dx + dy * dy + dz * dz > TELEPORT_DIST * TELEPORT_DIST * Math.max(1, span / SNAPSHOT_EVERY_TICKS) || (A.f & ALIVE_BIT) !== (B.f & ALIVE_BIT);
    if (teleport) {
      copySample(A, out);
      out.tick = tick;
      return 'interp';
    }
    out.tick = tick;
    out.x = A.x + dx * k;
    out.y = A.y + dy * k;
    out.z = A.z + dz * k;
    out.vx = A.vx + (B.vx - A.vx) * k;
    out.vy = A.vy + (B.vy - A.vy) * k;
    out.vz = A.vz + (B.vz - A.vz) * k;
    out.yaw = wrapAngle(A.yaw + wrapAngle(B.yaw - A.yaw) * k);
    out.pitch = A.pitch + (B.pitch - A.pitch) * k;
    out.c = A.c + (B.c - A.c) * k;
    out.hp = A.hp + (B.hp - A.hp) * k;
    // Discrete state steps at the midpoint (flags/weapon change "during" the interval).
    const D = k < 0.5 ? A : B;
    out.f = D.f;
    out.w = D.w;
    return 'interp';
  }
}

export function copySample(src: EntitySample, dst: EntitySample): void {
  dst.tick = src.tick;
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.vz = src.vz;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  dst.f = src.f;
  dst.w = src.w;
  dst.hp = src.hp;
  dst.c = src.c;
}
