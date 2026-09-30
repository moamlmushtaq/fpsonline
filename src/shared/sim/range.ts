// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range: targets (static / strafing / pop-up) + stats.
//
// RangeSim (host): targets come from MapDef.targets. Each has 100 HP and the
// same humanoid hitboxes as players.
//  • strafing: oscillates smoothly between `pos` and `pos + path` (period s);
//  • pop-up: stands for `popup.up` s, lies down for `popup.down` s (not
//    hittable), phase-shifted by `popup.offset`; an eliminated pop-up stays
//    down until its next rise;
//  • static / strafing targets respawn TARGET_RESPAWN s after elimination.
// The target-speed multiplier ('difficulty' range command) scales strafing and
// pop-up timing. Everything is tick-driven (deterministic).
//
// Stats (usable on the host or the client, no DOM):
//  • RangeStats — the original compact accumulator (accuracy, head hits,
//    eliminations, time-to-kill per distance). Kept for compatibility.
//  • RangeSession — the client's richer session tracker: shots keyed by the
//    InputCmd seq (pellets of one shot = one hit; a shot with no confirmed hit
//    after MISS_AFTER seconds is a miss), per-weapon breakdown, best hit
//    streak, time-to-kill per distance band, damage, session time.
// ─────────────────────────────────────────────────────────────────────────────

import { hitboxes, rayVsHitboxes, type Hitboxes } from '../combat';
import type { TargetDef } from '../maps/types';
import { q2, q3 } from '../math';
import type { GameEvent, KillCause, TargetSnap, Vec3, WeaponId } from '../types';

export const TARGET_HP = 100;
export const TARGET_RESPAWN = 1.5;
/** Target speed presets (Slow / Normal / Fast). */
export const RANGE_SPEEDS = [0.6, 1, 1.6] as const;
/** Distance bands used by the stats (m). */
export const RANGE_BANDS = [10, 25, 50, 75, 100] as const;

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
  /** Pop-up: currently in its "up" window. */
  up: boolean;
  /** Pop-up: eliminated during the current up window. */
  downed: boolean;
  hb: Hitboxes;
}

export class RangeSim {
  readonly targets: RangeTarget[];
  /** Movement speed multiplier (RangeCmd 'difficulty'). */
  speed = 1;
  /** Scaled range clock (s) driving pop-up cycles. */
  private clock = 0;

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
      up: true,
      downed: false,
      hb: hitboxes(d.pos, 0),
    }));
    this.updatePopups();
  }

  reset(): void {
    this.clock = 0;
    for (const t of this.targets) {
      t.alive = true;
      t.hp = TARGET_HP;
      t.respawnT = 0;
      t.phase = 0;
      t.firstHitTick = -1;
      t.up = true;
      t.downed = false;
      this.place(t);
    }
    this.updatePopups();
  }

  setSpeed(k: number): void {
    this.speed = Number.isFinite(k) ? Math.max(0, Math.min(3, k)) : 1;
  }

  step(dt: number): void {
    this.clock += dt * this.speed;
    for (const t of this.targets) {
      if (!t.def.popup && !t.alive) {
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
    this.updatePopups();
  }

  /** Pop-up windows from the range clock: rise = fresh target, fall = hidden. */
  private updatePopups(): void {
    for (const t of this.targets) {
      const p = t.def.popup;
      if (!p) continue;
      const cycle = Math.max(0.1, p.up + p.down);
      const tt = (((this.clock + (p.offset ?? 0)) % cycle) + cycle) % cycle;
      const up = tt < p.up;
      if (up && !t.up) {
        t.downed = false;
        t.hp = TARGET_HP;
        t.firstHitTick = -1;
      }
      t.up = up;
      t.alive = up && !t.downed;
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
      if (t.def.popup) t.downed = true;
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

// ── RangeSession: the client's detailed session tracker ─────────────────────

/** A shot with no confirmed hit after this long counts as a miss (streaks). */
export const MISS_AFTER = 0.45;

export interface WeaponBreakdown {
  weapon: WeaponId;
  shots: number;
  hits: number;
  headshots: number;
  kills: number;
  accuracy: number;
}

export interface RangeSessionSummary extends RangeSummary {
  /** Head hits / hits (0..1). */
  headRate: number;
  /** Targets eliminated by throwables. */
  grenadeKills: number;
  damage: number;
  /** Current and best run of consecutive shots that hit. */
  streak: number;
  bestStreak: number;
  /** Seconds since the session (re)started. */
  time: number;
  /** Always the five range bands (count 0 = no data). */
  bands: { distance: number; avg: number; count: number; best: number }[];
  weapons: WeaponBreakdown[];
}

interface PendingShot {
  seq: number;
  weapon: WeaponId;
  at: number;
  hit: boolean;
}

/** Nearest range band for a distance label. */
export function bandOf(distance: number): number {
  let best: number = RANGE_BANDS[0];
  for (const b of RANGE_BANDS) if (Math.abs(b - distance) < Math.abs(best - distance)) best = b;
  return best;
}

export class RangeSession {
  private time = 0;
  private shots = 0;
  private hits = 0;
  private headshots = 0;
  private kills = 0;
  private grenadeKills = 0;
  private damage = 0;
  private streak = 0;
  private bestStreak = 0;
  private readonly pending: PendingShot[] = [];
  /** Shots already resolved as hits (seq), bounded. */
  private readonly hitSeqs = new Set<number>();
  private readonly headSeqs = new Set<number>();
  private readonly firstHit = new Map<number, number>();
  private readonly ttk = new Map<number, { sum: number; n: number; best: number }>();
  private readonly perWeapon = new Map<WeaponId, { shots: number; hits: number; headshots: number; kills: number }>();

  /** Advance the session clock (seconds); resolves stale shots as misses. */
  tick(dt: number): void {
    this.time += dt;
    while (this.pending.length && this.time - this.pending[0].at > MISS_AFTER) {
      const s = this.pending.shift() as PendingShot;
      if (!s.hit) this.streak = 0;
    }
  }

  get seconds(): number {
    return this.time;
  }

  private weapon(w: WeaponId): { shots: number; hits: number; headshots: number; kills: number } {
    let e = this.perWeapon.get(w);
    if (!e) this.perWeapon.set(w, (e = { shots: 0, hits: 0, headshots: 0, kills: 0 }));
    return e;
  }

  /** A trigger pull (predicted locally): its InputCmd seq and weapon. */
  onShot(seq: number, weapon: WeaponId): void {
    this.shots++;
    this.weapon(weapon).shots++;
    this.pending.push({ seq, weapon, at: this.time, hit: false });
    if (this.pending.length > 256) this.pending.shift();
  }

  /** A host 'target' event. */
  onTarget(ev: Extract<GameEvent, { t: 'target' }>): void {
    const cause: KillCause | undefined = ev.w;
    const thrown = cause === 'grenade';
    this.damage += ev.dmg;
    let weapon: WeaponId | null = cause && cause !== 'grenade' && cause !== 'fall' && cause !== 'world' ? cause : null;
    if (!thrown) {
      const seq = ev.s;
      // Pellets of one shot count once; events without a seq fall back to the newest pending shot.
      const shot = seq !== undefined ? this.pending.find((p) => p.seq === seq) : this.pending[this.pending.length - 1];
      const key = seq ?? shot?.seq ?? -1;
      if (!this.hitSeqs.has(key)) {
        this.hitSeqs.add(key);
        if (this.hitSeqs.size > 512) this.hitSeqs.delete(this.hitSeqs.values().next().value as number);
        this.hits++;
        this.streak++;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        if (shot) {
          shot.hit = true;
          weapon = weapon ?? shot.weapon;
        }
        if (weapon) this.weapon(weapon).hits++;
      }
      if (ev.head && !this.headSeqs.has(key)) {
        this.headSeqs.add(key);
        if (this.headSeqs.size > 512) this.headSeqs.delete(this.headSeqs.values().next().value as number);
        this.headshots++;
        if (weapon) this.weapon(weapon).headshots++;
      }
    }
    if (!this.firstHit.has(ev.id)) this.firstHit.set(ev.id, this.time);
    if (ev.kill) {
      this.kills++;
      if (thrown) this.grenadeKills++;
      else if (weapon) this.weapon(weapon).kills++;
      const t0 = this.firstHit.get(ev.id) ?? this.time;
      this.firstHit.delete(ev.id);
      if (!thrown) {
        const band = bandOf(ev.dist);
        const d = Math.max(0, this.time - t0);
        const e = this.ttk.get(band) ?? { sum: 0, n: 0, best: Infinity };
        e.sum += d;
        e.n++;
        // One-shot eliminations have a TTK of 0: keep them, they are the best possible.
        e.best = Math.min(e.best, d);
        this.ttk.set(band, e);
      }
    }
  }

  reset(): void {
    this.time = 0;
    this.shots = this.hits = this.headshots = this.kills = this.grenadeKills = this.damage = 0;
    this.streak = this.bestStreak = 0;
    this.pending.length = 0;
    this.hitSeqs.clear();
    this.headSeqs.clear();
    this.firstHit.clear();
    this.ttk.clear();
    this.perWeapon.clear();
  }

  summary(): RangeSessionSummary {
    const bands = RANGE_BANDS.map((distance) => {
      const e = this.ttk.get(distance);
      return { distance, avg: e && e.n ? e.sum / e.n : 0, count: e ? e.n : 0, best: e && e.n ? e.best : 0 };
    });
    const weapons: WeaponBreakdown[] = [...this.perWeapon.entries()].map(([weapon, e]) => ({
      weapon,
      ...e,
      accuracy: e.shots ? Math.min(1, e.hits / e.shots) : 0,
    }));
    return {
      shots: this.shots,
      hits: this.hits,
      headshots: this.headshots,
      kills: this.kills,
      accuracy: this.shots ? Math.min(1, this.hits / this.shots) : 0,
      ttkByDistance: bands.filter((b) => b.count > 0).map((b) => ({ distance: b.distance, avg: b.avg, count: b.count })),
      headRate: this.hits ? Math.min(1, this.headshots / this.hits) : 0,
      grenadeKills: this.grenadeKills,
      damage: Math.round(this.damage),
      streak: this.streak,
      bestStreak: this.bestStreak,
      time: this.time,
      bands,
      weapons,
    };
  }
}
