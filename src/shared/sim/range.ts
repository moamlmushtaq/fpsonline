// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range: moving humanoid targets + shooting stats.
//
// Targets come from MapDef.targets. Each oscillates smoothly between `pos` and
// `pos + path` (period seconds per full cycle), has 100 HP and humanoid
// hitboxes (same as players), and respawns 1.5 s after being eliminated.
// The host reports hits through 'target' events (dist = the target's lane
// distance label) and exposes positions through snapshot `targets`.
// `RangeStats` can be fed from those events on either side (host results or a
// client HUD) to compute accuracy and time-to-kill per distance.
// ─────────────────────────────────────────────────────────────────────────────

import { hitboxes, rayVsHitboxes, type Hitboxes } from '../combat';
import type { TargetDef } from '../maps/types';
import { q2, q3 } from '../math';
import type { GameEvent, TargetSnap, Vec3 } from '../types';

export const TARGET_HP = 100;
export const TARGET_RESPAWN = 1.5;

export interface RangeTarget {
  def: TargetDef;
  id: number;
  pos: Vec3;
  yaw: number;
  alive: boolean;
  hp: number;
  respawnT: number;
  /** Oscillation phase 0..1. */
  phase: number;
  /** Tick of the first hit of the current life (-1 = untouched), for time-to-kill. */
  firstHitTick: number;
  hb: Hitboxes;
}

export class RangeSim {
  readonly targets: RangeTarget[];
  /** Movement speed multiplier (RangeCmd 'difficulty'). */
  speed = 1;

  constructor(defs: readonly TargetDef[]) {
    this.targets = defs.map((d) => ({
      def: d,
      id: d.id,
      pos: { x: d.pos.x, y: d.pos.y, z: d.pos.z },
      yaw: d.yaw,
      alive: true,
      hp: TARGET_HP,
      respawnT: 0,
      phase: 0,
      firstHitTick: -1,
      hb: hitboxes(d.pos, 0),
    }));
  }

  reset(): void {
    for (const t of this.targets) {
      t.alive = true;
      t.hp = TARGET_HP;
      t.respawnT = 0;
      t.phase = 0;
      t.firstHitTick = -1;
      this.place(t);
    }
  }

  setSpeed(k: number): void {
    this.speed = Number.isFinite(k) ? Math.max(0, Math.min(3, k)) : 1;
  }

  step(dt: number): void {
    for (const t of this.targets) {
      if (!t.alive) {
        t.respawnT -= dt;
        if (t.respawnT <= 0) {
          t.alive = true;
          t.hp = TARGET_HP;
          t.firstHitTick = -1;
        }
      }
      const period = t.def.period ?? 0;
      if (t.def.path && period > 0) {
        t.phase = (t.phase + (dt * this.speed) / period) % 1;
        this.place(t);
      }
    }
  }

  private place(t: RangeTarget): void {
    const p = t.def.path;
    const k = p ? 0.5 - 0.5 * Math.cos(t.phase * Math.PI * 2) : 0;
    t.pos.x = t.def.pos.x + (p ? p.x * k : 0);
    t.pos.y = t.def.pos.y + (p ? p.y * k : 0);
    t.pos.z = t.def.pos.z + (p ? p.z * k : 0);
    hitboxes(t.pos, 0, t.hb);
  }

  /** Nearest living target hit by the ray within maxDist. */
  hitTest(o: Vec3, d: Vec3, maxDist: number): { target: RangeTarget; dist: number; head: boolean } | null {
    let best: { target: RangeTarget; dist: number; head: boolean } | null = null;
    for (const t of this.targets) {
      if (!t.alive) continue;
      const h = rayVsHitboxes(o, d, best ? best.dist : maxDist, t.hb);
      if (h && (!best || h.dist < best.dist)) best = { target: t, dist: h.dist, head: h.head };
    }
    return best;
  }

  /** Applies damage; returns true if the target was eliminated. */
  damage(t: RangeTarget, dmg: number, tick: number): boolean {
    if (!t.alive) return false;
    if (t.firstHitTick < 0) t.firstHitTick = tick;
    t.hp -= dmg;
    if (t.hp <= 0) {
      t.hp = 0;
      t.alive = false;
      t.respawnT = TARGET_RESPAWN;
      return true;
    }
    return false;
  }

  snaps(): TargetSnap[] {
    return this.targets.map((t) => ({
      id: t.id,
      x: q2(t.pos.x),
      y: q2(t.pos.y),
      z: q2(t.pos.z),
      yaw: q3(t.yaw),
      alive: t.alive,
      hp: Math.round((t.hp / TARGET_HP) * 100) / 100,
    }));
  }
}

export interface RangeSummary {
  shots: number;
  hits: number;
  headshots: number;
  kills: number;
  /** 0..1 */
  accuracy: number;
  /** Average time-to-kill (s) per target distance label (m). */
  ttkByDistance: { distance: number; avg: number; count: number }[];
}

/**
 * Training statistics accumulator, usable on the host or in a client HUD. Call
 * `onShot()` for every trigger pull and `onTargetEvent(ev, timeSec)` for every
 * 'target' event (timeSec = any monotonic clock in seconds, e.g. tick / SIM_HZ).
 * Time-to-kill is measured from the first hit on a target life to its elimination.
 * Pass `shotIndex` to count shotgun pellets of one shot as a single hit.
 */
export class RangeStats {
  shots = 0;
  hits = 0;
  headshots = 0;
  kills = 0;
  private ttk = new Map<number, { sum: number; n: number }>();
  private firstHit = new Map<number, number>();
  private lastHitShot = -1;

  onShot(): void {
    this.shots++;
  }

  onTargetEvent(ev: Extract<GameEvent, { t: 'target' }>, timeSec: number, shotIndex = this.shots): void {
    if (shotIndex !== this.lastHitShot) {
      this.hits++;
      this.lastHitShot = shotIndex;
    }
    if (ev.head) this.headshots++;
    if (!this.firstHit.has(ev.id)) this.firstHit.set(ev.id, timeSec);
    if (ev.kill) {
      this.kills++;
      const t0 = this.firstHit.get(ev.id) ?? timeSec;
      this.firstHit.delete(ev.id);
      const e = this.ttk.get(ev.dist) ?? { sum: 0, n: 0 };
      e.sum += Math.max(0, timeSec - t0);
      e.n++;
      this.ttk.set(ev.dist, e);
    }
  }

  reset(): void {
    this.shots = 0;
    this.hits = 0;
    this.headshots = 0;
    this.kills = 0;
    this.lastHitShot = -1;
    this.ttk.clear();
    this.firstHit.clear();
  }

  summary(): RangeSummary {
    const ttkByDistance = [...this.ttk.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([distance, e]) => ({ distance, avg: e.n ? e.sum / e.n : 0, count: e.n }));
    return {
      shots: this.shots,
      hits: this.hits,
      headshots: this.headshots,
      kills: this.kills,
      accuracy: this.shots ? Math.min(1, this.hits / this.shots) : 0,
      ttkByDistance,
    };
  }
}
