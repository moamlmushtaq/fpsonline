// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — BotDirector: light team-level coordination shared by all bots
// in one GameSim (one per sim, created lazily, updated once per tick by the
// first bot that thinks — deterministic because the player order is).
//
//  • Lanes     — spreads each team over the three lanes (humans count too), so
//                flank lanes are not deserted and bots fill what humans leave.
//  • Hotspots  — gunshots/explosions (sim.noises) merged into decaying "fight"
//                spots; idle bots rotate toward real fights.
//  • Targets   — who is shooting at whom; bots avoid all piling onto one enemy
//                (a human especially).
//  • Zones     — Launch Control roles: attack / defend / contest, capped per
//                zone so the team never stacks on one objective.
//  • Sunspear  — one bot per team goes for the pickup at a time.
//  • Mercy     — tracks each human's losing streak; recruit/veteran bots ease
//                up a little on someone who keeps dying (never noticeably).
// ─────────────────────────────────────────────────────────────────────────────

import { SIM_HZ } from '../../constants';
import { hash32, mulberry32 } from '../../math';
import { TEAM_NONE } from '../../types';
import type { GameSim, SimPlayer } from '../game';
import { inSpawnArea, laneInfoFor, laneOfX, type LaneInfo } from './lanes';

export interface Hotspot {
  x: number;
  y: number;
  z: number;
  heat: number;
  tick: number;
  /** Bitmask of shooter teams (1 = team 0, 2 = team 1, 4 = none/FFA). */
  teams: number;
}

/** Desired share of a team per lane (west, center, east). */
const LANE_SHARE = [0.32, 0.36, 0.32];
const MAX_HOTSPOTS = 12;

const directors = new WeakMap<GameSim, BotDirector>();

export class BotDirector {
  readonly lanes: LaneInfo | null;
  readonly hotspots: Hotspot[] = [];
  private readonly sim: GameSim;
  private readonly rng: () => number;
  private lastTick = -1;
  private lastNoiseTick = -1;
  private readonly laneOf = new Map<number, number>();
  private readonly targetOf = new Map<number, { target: number; team: number }>();
  private readonly zoneOf = new Map<number, number>();
  private readonly humans = new Map<number, { kills: number; deaths: number; streak: number }>();
  /** Smoothed share of each side's living players per lane: [side][lane] (side 2 = FFA). */
  private readonly occ: number[][] = [
    [LANE_SHARE[0], LANE_SHARE[1], LANE_SHARE[2]],
    [LANE_SHARE[0], LANE_SHARE[1], LANE_SHARE[2]],
    [LANE_SHARE[0], LANE_SHARE[1], LANE_SHARE[2]],
  ];
  private readonly spearClaim: { id: number; tick: number }[] = [
    { id: -1, tick: 0 },
    { id: -1, tick: 0 },
    { id: -1, tick: 0 },
  ];

  static for(sim: GameSim): BotDirector {
    let d = directors.get(sim);
    if (!d) {
      d = new BotDirector(sim);
      directors.set(sim, d);
    }
    return d;
  }

  private constructor(sim: GameSim) {
    this.sim = sim;
    this.rng = mulberry32(hash32(sim.seed, 0xd1ec7));
    this.lanes = sim.config.mode === 'range' ? null : laneInfoFor(sim.map, sim.world, sim.nav);
  }

  /** Once per tick (idempotent). */
  update(): void {
    const sim = this.sim;
    const t = sim.tick;
    if (t === this.lastTick) return;
    this.lastTick = t;
    this.absorbNoises();
    if (t % 15 === 0) this.decayHotspots();
    if (t % 30 === 0) {
      this.trackHumans();
      this.trackLanes();
    }
    if (t % 45 === 0 && sim.config.mode === 'control') this.assignZones();
  }

  // ── Lanes ────────────────────────────────────────────────────────────────

  /** Picks the least-covered lane for a (re)spawning bot, counting humans by position. */
  pickLane(bot: SimPlayer): number {
    const count = [0, 0, 0];
    let n = 1;
    for (const p of this.sim.players) {
      if (p === bot || !this.sameSide(p, bot)) continue;
      let lane = p.bot ? this.laneOf.get(p.ident.id) : undefined;
      if (lane === undefined) {
        if (!this.lanes || !p.alive) continue;
        lane = laneOfX(this.lanes, p.move.pos.x);
      }
      count[lane]++;
      n++;
    }
    let best = 1;
    let bestScore = -Infinity;
    for (let l = 0; l < 3; l++) {
      // Prefer the lane we are already next to (short walk, less transit through mid).
      const walk = this.lanes && bot.alive ? Math.abs(bot.move.pos.x - this.lanes.laneX[l]) / 70 : 0;
      // Feedback: a lane the side has actually been neglecting (transit, chases
      // pulling players to mid) gets reinforced first.
      const neglect = (LANE_SHARE[l] - this.occ[this.side(bot)][l]) * n * 2.5;
      const s = LANE_SHARE[l] * n - count[l] + neglect + this.rng() * 0.6 - walk;
      if (s > bestScore) {
        bestScore = s;
        best = l;
      }
    }
    this.laneOf.set(bot.ident.id, best);
    return best;
  }

  setLane(botId: number, lane: number): void {
    this.laneOf.set(botId, lane);
  }

  /** Teammates (bots + humans by position) currently in each lane. */
  laneCounts(bot: SimPlayer, out: number[]): number[] {
    out[0] = out[1] = out[2] = 0;
    for (const p of this.sim.players) {
      if (p === bot || !this.sameSide(p, bot)) continue;
      const l = p.bot ? this.laneOf.get(p.ident.id) : this.lanes && p.alive ? laneOfX(this.lanes, p.move.pos.x) : undefined;
      if (l !== undefined) out[l]++;
    }
    return out;
  }

  private side(p: SimPlayer): number {
    return this.sim.ffa ? 2 : p.ident.team === 1 ? 1 : 0;
  }

  private trackLanes(): void {
    const info = this.lanes;
    if (!info) return;
    const n = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (const p of this.sim.players) {
      if (!p.alive) continue;
      n[this.side(p)][laneOfX(info, p.move.pos.x)]++;
    }
    for (let s = 0; s < 3; s++) {
      const tot = n[s][0] + n[s][1] + n[s][2];
      if (tot === 0) continue;
      for (let l = 0; l < 3; l++) this.occ[s][l] += (n[s][l] / tot - this.occ[s][l]) * 0.04;
    }
  }

  private sameSide(a: SimPlayer, b: SimPlayer): boolean {
    if (this.sim.ffa) return false;
    return a.ident.team === b.ident.team;
  }

  /** True if (x, z) is inside the spawn area of an enemy of `team` (never camp there). */
  inEnemySpawn(team: number, x: number, z: number, margin = 0): boolean {
    if (!this.lanes || this.sim.ffa) return false;
    return inSpawnArea(this.lanes, team === 0 ? 1 : 0, x, z, margin);
  }

  // ── Hotspots ─────────────────────────────────────────────────────────────

  private absorbNoises(): void {
    // Only whole past ticks are absorbed (noises of the current tick may still be
    // added by players stepped after us), so nothing is missed or counted twice.
    const noises = this.sim.noises;
    const upTo = this.sim.tick - 1;
    for (let i = noises.length - 1; i >= 0; i--) {
      const n = noises[i];
      if (n.tick > upTo) continue;
      if (n.tick <= this.lastNoiseTick) break;
      const bit = n.team === 0 ? 1 : n.team === 1 ? 2 : 4;
      let hs: Hotspot | null = null;
      for (const h of this.hotspots) {
        const dx = h.x - n.x;
        const dz = h.z - n.z;
        if (dx * dx + dz * dz < 14 * 14) {
          hs = h;
          break;
        }
      }
      if (hs) {
        const w = 1 / (hs.heat + 1);
        hs.x += (n.x - hs.x) * w;
        hs.y += (n.y - hs.y) * w;
        hs.z += (n.z - hs.z) * w;
        hs.heat = Math.min(30, hs.heat + 1);
        hs.tick = n.tick;
        hs.teams |= bit;
      } else {
        if (this.hotspots.length >= MAX_HOTSPOTS) {
          let ci = 0;
          for (let k = 1; k < this.hotspots.length; k++) if (this.hotspots[k].heat < this.hotspots[ci].heat) ci = k;
          this.hotspots.splice(ci, 1);
        }
        this.hotspots.push({ x: n.x, y: n.y - 1.6, z: n.z, heat: 1, tick: n.tick, teams: bit });
      }
    }
    this.lastNoiseTick = upTo;
  }

  private decayHotspots(): void {
    for (let i = this.hotspots.length - 1; i >= 0; i--) {
      const h = this.hotspots[i];
      h.heat *= 0.955;
      if (h.heat < 0.4) this.hotspots.splice(i, 1);
    }
  }

  /**
   * The most attractive live fight for a bot at `pos`: hot, recent, mutual (both
   * sides shooting), not too far, never inside the enemy spawn.
   */
  bestHotspot(team: number, x: number, z: number, maxDist: number, minHeat = 3): Hotspot | null {
    let best: Hotspot | null = null;
    let bestScore = -Infinity;
    const tick = this.sim.tick;
    for (const h of this.hotspots) {
      if (h.heat < minHeat || tick - h.tick > SIM_HZ * 6) continue;
      const d = Math.hypot(h.x - x, h.z - z);
      if (d > maxDist || d < 12) continue;
      if (this.inEnemySpawn(team, h.x, h.z, 6)) continue;
      const mutual = (h.teams & 3) === 3 || (h.teams & 4) !== 0;
      const s = h.heat * (mutual ? 1.4 : 0.8) - d / 12;
      if (s > bestScore) {
        bestScore = s;
        best = h;
      }
    }
    return best;
  }

  // ── Targets ──────────────────────────────────────────────────────────────

  setTarget(bot: SimPlayer, target: number): void {
    if (target < 0) this.targetOf.delete(bot.ident.id);
    else this.targetOf.set(bot.ident.id, { target, team: bot.ident.team });
  }

  /** Number of OTHER bots on `team` currently engaging `target`. */
  claims(team: number, target: number, exceptBot: number): number {
    let n = 0;
    for (const [id, c] of this.targetOf) {
      if (id === exceptBot || c.target !== target) continue;
      if (!this.sim.ffa && c.team !== team) continue;
      const b = this.sim.player(id);
      if (!b || !b.alive) {
        this.targetOf.delete(id); // left or died without telling us
        continue;
      }
      n++;
    }
    return n;
  }

  // ── Sunspear ─────────────────────────────────────────────────────────────

  /** One bot per team heads for the pickup at a time (claims expire). */
  claimSunspear(bot: SimPlayer): boolean {
    const t = bot.ident.team === 0 ? 0 : bot.ident.team === 1 ? 1 : 2;
    const c = this.spearClaim[t];
    const holder = c.id >= 0 ? this.sim.player(c.id) : undefined;
    const valid = holder && holder.alive && !holder.combat.slots[2] && this.sim.tick - c.tick < SIM_HZ * 14;
    if (valid && c.id !== bot.ident.id) return this.sim.ffa;
    c.id = bot.ident.id;
    if (!valid) c.tick = this.sim.tick;
    return true;
  }

  // ── Mercy ────────────────────────────────────────────────────────────────

  private trackHumans(): void {
    for (const p of this.sim.players) {
      if (p.ident.isBot) continue;
      let h = this.humans.get(p.ident.id);
      if (!h) {
        h = { kills: p.stats.kills, deaths: p.stats.deaths, streak: 0 };
        this.humans.set(p.ident.id, h);
      }
      if (p.stats.kills > h.kills) h.streak = 0;
      else if (p.stats.deaths > h.deaths) h.streak += p.stats.deaths - h.deaths;
      h.kills = p.stats.kills;
      h.deaths = p.stats.deaths;
    }
  }

  /** 0 (no easing) … 1 (max easing) for a human target on a losing streak. */
  mercy(targetId: number): number {
    const h = this.humans.get(targetId);
    if (!h) return 0;
    const streak = Math.max(0, Math.min(1, (h.streak - 2) / 4));
    const kd = h.deaths >= 6 && h.kills / h.deaths < 0.34 ? 0.5 : 0;
    return Math.max(streak, kd);
  }

  // ── Launch Control roles ─────────────────────────────────────────────────

  /** Zone index assigned to a bot (control mode), or -1. */
  zoneFor(botId: number): number {
    return this.zoneOf.get(botId) ?? -1;
  }

  private assignZones(): void {
    const sim = this.sim;
    const zones = sim.zoneStates();
    if (zones.length === 0) return;
    for (const team of [0, 1]) {
      const members = sim.players.filter((p) => p.ident.team === team);
      const bots = members.filter((p) => p.bot);
      if (bots.length === 0) continue;
      const cap = Math.max(1, Math.ceil(members.length * 0.5));
      const assigned = zones.map(() => 0);
      // Humans standing in a zone already cover it.
      for (const h of members) {
        if (h.bot || !h.alive) continue;
        zones.forEach((z, i) => {
          if (Math.hypot(h.move.pos.x - z.def.center.x, h.move.pos.z - z.def.center.z) < z.def.radius + 3) assigned[i]++;
        });
      }
      const need = zones.map((z) => {
        let s: number;
        if (z.owner === team) s = z.contested || (z.capturing !== TEAM_NONE && z.capturing !== team) ? 3.6 : 1.2;
        else s = z.owner === TEAM_NONE ? 2.8 : 3.1;
        if (z.contested) s += 0.8;
        return s;
      });
      for (const b of bots) {
        const cur = this.zoneOf.get(b.ident.id) ?? -1;
        let best = 0;
        let bestV = -Infinity;
        zones.forEach((z, i) => {
          if (assigned[i] >= cap) return;
          const d = Math.hypot(b.move.pos.x - z.def.center.x, b.move.pos.z - z.def.center.z);
          const v = need[i] - assigned[i] * 1.1 - d / 40 + (cur === i ? 0.9 : 0) + this.rng() * 0.35;
          if (v > bestV) {
            bestV = v;
            best = i;
          }
        });
        assigned[best]++;
        this.zoneOf.set(b.ident.id, best);
      }
    }
  }
}
