// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — BotController: believable AI opponents (recruit / veteran /
// elite) that play through the exact same InputCmd path as humans.
//
// Structure
//  • think() runs every tick (cheap): smooth aim, path following, trigger
//    discipline, button edges. seq increments every tick.
//  • deliberate() runs at 20 Hz, staggered by player id: perception (FOV + line
//    of sight + smoke + hearing + damage awareness), target selection, reaction
//    timers, goals (objective / lanes / chase / cover / pickup), path requests,
//    stuck detection, throwable decisions.
//
// Human-likeness
//  • Reaction delay on every new acquisition; aim starts with an error offset
//    that settles over time (never snaps); turn rate + smoothing limits.
//  • Aim tracks a slightly delayed target position (perception lag) with partial
//    velocity prediction → strafing targets are genuinely harder to hit.
//  • Partial recoil compensation, burst discipline by range, strafing, the odd
//    crouch/jump/slide, retreat to cover when hurt, reload when safe.
// ─────────────────────────────────────────────────────────────────────────────

import { EYE_HEIGHT, PITCH_LIMIT, SIM_DT, SIM_HZ } from '../constants';
import { activeSlot, activeWeapon, aimAngles, currentSpread } from '../combat';
import { angleDiff, clamp, forwardFromAngles, mulberry32, hash32, wrapAngle, yawFromDir } from '../math';
import { eyeHeight, playerHeight } from '../movement';
import type { BotDifficulty, InputCmd, Vec3 } from '../types';
import { BTN_ADS, BTN_CROUCH, BTN_FIRE, BTN_JUMP, BTN_RELOAD, BTN_SPRINT, BTN_THROW, TEAM_NONE } from '../types';
import { WEAPONS } from '../weapons';
import { BOT_PROFILES, PREFERRED_RANGE, ballisticPitch, type BotProfile } from './bot-profiles';
import type { GameSim, SimPlayer } from './game';
import type { RewoundState } from './lagcomp';
import { LINK_MANTLE, type NavPath } from './nav';
import { insideZone } from './zones';

type GoalKind = 'none' | 'objective' | 'roam' | 'chase' | 'cover' | 'pickup';

const THINK_EVERY = 3; // 20 Hz at SIM_HZ 60
const TMP: RewoundState = { pos: { x: 0, y: 0, z: 0 }, crouchT: 0, alive: true };

export class BotController {
  readonly id: number;
  readonly difficulty: BotDifficulty;
  private readonly sim: GameSim;
  private readonly prof: BotProfile;
  private readonly rng: () => number;
  private seq = 0;
  private yaw = 0;
  private pitch = 0;
  private readonly phase: number;

  // Perception / target.
  private target = -1;
  private targetVisible = false;
  private lastSeenTick = -100000;
  private readonly lastKnown: Vec3 = { x: 0, y: 0, z: 0 };
  private hasLastKnown = false;
  private lastKnownTick = -100000;
  private reactionT = 0;
  private errYaw = 0;
  private errPitch = 0;
  private aimHead = false;
  private lastNoiseTick = 0;
  private targetDist = 0;

  // Movement.
  private goalKind: GoalKind = 'none';
  private readonly goal: Vec3 = { x: 0, y: 0, z: 0 };
  private path: NavPath | null = null;
  private pathIdx = 0;
  private repathT = 0;
  private goalT = 0;
  private lane: number;
  private laneStage = 0;
  private strafeDir = 1;
  private strafeT = 0;
  private crouchT = 0;
  private jumpCd = 0;
  private coverT = 0;
  private coverUntil = 0;
  private holdT = 0;
  private searchT = 0;
  private readonly stuckRef: Vec3 = { x: 0, y: 0, z: 0 };
  private stuckT = 0;
  private stuckCount = 0;
  private unstickT = 0;
  private unstickDir = 1;
  private defender: boolean;

  // Trigger discipline.
  private burstT = 0;
  private pauseT = 0;
  private lastFire = false;
  private lastButtons = 0;
  private reloadPress = false;
  private throwAt: Vec3 | null = null;
  private throwT = 0;
  private throwCd = 0;
  private slideWish = false;
  private moveX = 0;
  private moveZ = 0;
  private wantSprint = false;
  private mantleJump = false;

  constructor(sim: GameSim, playerId: number, difficulty: BotDifficulty) {
    this.sim = sim;
    this.id = playerId;
    this.difficulty = difficulty;
    this.prof = BOT_PROFILES[difficulty] ?? BOT_PROFILES.veteran;
    this.rng = mulberry32(hash32(sim.seed, playerId, 0xb07));
    this.phase = playerId % THINK_EVERY;
    this.lane = Math.floor(this.rng() * 3);
    this.defender = this.rng() < 0.25;
  }

  private rand(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rng();
  }

  onSpawn(): void {
    const p = this.sim.player(this.id);
    if (p) {
      this.yaw = p.lastCmd.yaw;
      this.pitch = 0;
      this.stuckRef.x = p.move.pos.x;
      this.stuckRef.y = p.move.pos.y;
      this.stuckRef.z = p.move.pos.z;
    }
    this.target = -1;
    this.targetVisible = false;
    this.hasLastKnown = false;
    this.path = null;
    this.goalKind = 'none';
    this.stuckT = 0;
    this.stuckCount = 0;
    this.throwAt = null;
    this.coverT = 0;
    this.holdT = 0;
    if (this.rng() < 0.35) this.lane = Math.floor(this.rng() * 3);
    this.laneStage = 0;
  }

  /** Produces this tick's command. */
  think(): InputCmd {
    this.seq++;
    const sim = this.sim;
    const p = sim.player(this.id);
    if (!p || !p.alive) {
      this.lastButtons = 0;
      return { seq: this.seq, mx: 0, mz: 0, yaw: this.yaw, pitch: this.pitch, buttons: 0, slot: 0, viewTick: sim.tick };
    }
    if ((sim.tick + this.phase) % THINK_EVERY === 0) this.deliberate(p);
    this.decayTimers();

    const aimed = this.updateAim(p);
    let buttons = 0;
    this.computeMove(p);

    // Trigger.
    const fire = this.shouldFire(p);
    const w = WEAPONS[activeWeapon(p.combat)];
    if (fire) {
      if (w.fireMode === 'semi') {
        if (!this.lastFire) buttons |= BTN_FIRE;
      } else buttons |= BTN_FIRE;
    }
    this.lastFire = (buttons & BTN_FIRE) !== 0;
    if (this.wantAds(p)) buttons |= BTN_ADS;
    const hiding = this.goalKind === 'cover' && (!this.path || this.pathIdx >= this.path.points.length);
    if (this.crouchT > 0 || this.slideWish || hiding) buttons |= BTN_CROUCH;
    if (this.wantSprint && !(buttons & (BTN_FIRE | BTN_ADS))) buttons |= BTN_SPRINT;
    if (this.mantleJump || (this.unstickT > 0 && this.jumpCd <= 0)) {
      buttons |= BTN_JUMP;
      this.jumpCd = 0.5;
    }
    if (this.reloadPress) {
      buttons |= BTN_RELOAD;
      this.reloadPress = false;
    }
    if (this.throwAt && this.throwT <= 0 && aimed) {
      buttons |= BTN_THROW;
      this.throwAt = null;
      this.throwCd = this.rand(12, 25);
    }
    // Edges: never hold jump/throw/reload across ticks.
    buttons &= ~(this.lastButtons & (BTN_JUMP | BTN_THROW | BTN_RELOAD));
    this.lastButtons = buttons;
    this.slideWish = false;
    this.mantleJump = false;

    // World-space move → view-relative axes.
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const mz = this.moveX * -sy + this.moveZ * -cy;
    const mx = this.moveX * cy + this.moveZ * -sy;

    return {
      seq: this.seq,
      mx: clamp(mx, -1, 1),
      mz: clamp(mz, -1, 1),
      yaw: this.yaw,
      pitch: this.pitch,
      buttons,
      slot: this.desiredSlot(p),
      viewTick: sim.tick,
    };
  }

  // ── Timers ───────────────────────────────────────────────────────────────

  private decayTimers(): void {
    const dt = SIM_DT;
    if (this.reactionT > 0) this.reactionT -= dt;
    if (this.strafeT > 0) this.strafeT -= dt;
    if (this.crouchT > 0) this.crouchT -= dt;
    if (this.jumpCd > 0) this.jumpCd -= dt;
    if (this.unstickT > 0) this.unstickT -= dt;
    if (this.throwT > 0) this.throwT -= dt;
    if (this.throwCd > 0) this.throwCd -= dt;
    if (this.coverT > 0) this.coverT -= dt;
    if (this.holdT > 0) this.holdT -= dt;
    if (this.burstT > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) this.pauseT = this.rand(this.prof.burstPause[0], this.prof.burstPause[1]);
    } else if (this.pauseT > 0) this.pauseT -= dt;
  }

  // ── Perception & decisions (20 Hz) ──────────────────────────────────────

  private deliberate(p: SimPlayer): void {
    const sim = this.sim;
    const dtThink = SIM_DT * THINK_EVERY;
    this.perceive(p);

    // Stuck detection whenever we are trying to move (travel or footwork).
    const traveling = Math.hypot(this.moveX, this.moveZ) > 0.3;
    if (traveling) {
      this.stuckT += dtThink;
      if (this.stuckT >= 1.2) {
        const dx = p.move.pos.x - this.stuckRef.x;
        const dz = p.move.pos.z - this.stuckRef.z;
        if (dx * dx + dz * dz < 0.5 * 0.5) {
          this.stuckCount++;
          this.unstickT = 0.45;
          this.unstickDir = this.rng() < 0.5 ? -1 : 1;
          if (this.stuckCount >= 2) this.repathT = 0;
          if (this.stuckCount >= 3) {
            this.goalKind = 'none';
            this.path = null;
            this.stuckCount = 0;
          }
        } else this.stuckCount = 0;
        this.stuckT = 0;
        this.stuckRef.x = p.move.pos.x;
        this.stuckRef.y = p.move.pos.y;
        this.stuckRef.z = p.move.pos.z;
      }
    } else {
      this.stuckT = 0;
      this.stuckRef.x = p.move.pos.x;
      this.stuckRef.z = p.move.pos.z;
    }

    // Reload when safe.
    const slot = activeSlot(p.combat);
    const w = WEAPONS[slot.id];
    const since = (sim.tick - this.lastSeenTick) * SIM_DT;
    if (!this.targetVisible && since > 1.2 && p.combat.reloadT <= 0 && slot.reserve > 0 && slot.mag < w.magSize * 0.6 && w.fireMode !== 'charge') {
      this.reloadPress = true;
    }

    // Goal management.
    this.goalT -= dtThink;
    this.repathT -= dtThink;
    this.chooseGoal(p);
    if (this.goalKind !== 'none' && (this.path === null || this.repathT <= 0)) this.plan(p);

    // Occasional throwable toward a recently seen but hidden enemy.
    if (
      !this.throwAt &&
      this.throwCd <= 0 &&
      p.combat.throwables > 0 &&
      sim.currentPhase === 'live' &&
      this.hasLastKnown &&
      !this.targetVisible &&
      (sim.tick - this.lastKnownTick) * SIM_DT < 3
    ) {
      const d = Math.hypot(this.lastKnown.x - p.move.pos.x, this.lastKnown.z - p.move.pos.z);
      const smoke = p.ident.loadout.throwable === 'smoke';
      if (!smoke && d > 8 && d < 24 && this.rng() < this.prof.grenadeChance * 3) {
        this.throwAt = { x: this.lastKnown.x, y: this.lastKnown.y, z: this.lastKnown.z };
        this.throwT = 0.25;
      }
    }
    if (!this.throwAt && this.throwCd <= 0 && p.combat.throwables > 0 && p.ident.loadout.throwable === 'smoke' && this.goalKind === 'cover' && this.targetVisible) {
      if (this.rng() < 0.3) {
        // Smoke between us and the threat.
        const t = sim.player(this.target);
        if (t) {
          this.throwAt = {
            x: (p.move.pos.x * 2 + t.move.pos.x) / 3,
            y: p.move.pos.y,
            z: (p.move.pos.z * 2 + t.move.pos.z) / 3,
          };
          this.throwT = 0.1;
        }
      }
    }

    // Combat stance changes.
    if (this.targetVisible) {
      if (this.strafeT <= 0) {
        this.strafeDir = this.rng() < 0.5 ? -1 : 1;
        this.strafeT = this.rand(0.35, 1.1);
      }
      if (this.crouchT <= 0 && this.rng() < this.prof.crouchChance) this.crouchT = this.rand(0.3, 0.9);
      if (this.jumpCd <= 0 && this.targetDist < 14 && this.rng() < this.prof.jumpChance) {
        this.mantleJump = true;
        this.jumpCd = 1.5;
      }
    }
  }

  private perceive(p: SimPlayer): void {
    const sim = this.sim;
    const world = sim.world;
    const eye = sim.eyeOf(p);
    const fwd = forwardFromAngles(this.yaw, this.pitch);
    let best: SimPlayer | null = null;
    let bestScore = Infinity;
    let bestDist = 0;
    const hurtRecently = sim.tick - p.lastAttackerTick < SIM_HZ * 1.5 ? p.lastAttacker : -1;
    for (const e of sim.players) {
      if (!e.alive || !sim.isEnemy(p, e)) continue;
      const ex = e.move.pos.x;
      const ey = e.move.pos.y + playerHeight(e.move) * 0.62;
      const ez = e.move.pos.z;
      const dx = ex - eye.x;
      const dy = ey - eye.y;
      const dz = ez - eye.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 95 || d < 1e-3) continue;
      const cos = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d;
      const inFov = cos >= Math.cos(this.prof.fovHalf) || d < 3 || e.ident.id === hurtRecently || (e.ident.id === this.target && this.targetVisible);
      if (!inFov) continue;
      if (!world.segmentClear(eye.x, eye.y, eye.z, ex, ey, ez, 'sight')) {
        // Head peeking over cover still counts.
        const hy = e.move.pos.y + eyeHeight(e.move) + 0.05;
        if (!world.segmentClear(eye.x, eye.y, eye.z, ex, hy, ez, 'sight')) continue;
      }
      if (sim.smokeBlocks(eye, e.move.pos)) continue;
      let score = d;
      if (e.ident.id === this.target) score -= 12;
      if (e.ident.id === hurtRecently) score -= 10;
      score += e.health * 0.04;
      if (score < bestScore) {
        bestScore = score;
        best = e;
        bestDist = d;
      }
    }
    const tick = sim.tick;
    if (best) {
      const fresh = best.ident.id !== this.target || tick - this.lastSeenTick > SIM_HZ * 1.2;
      if (fresh) {
        const periph = 1 + Math.max(0, 1 - (fwd.x * (best.move.pos.x - eye.x) + fwd.z * (best.move.pos.z - eye.z)) / Math.max(1, bestDist)) * 0.6;
        this.reactionT = this.prof.reaction * this.rand(0.8, 1.25) * periph;
        const mag = this.prof.aimErr * this.rand(0.6, 1.3) * (1 + bestDist / 70);
        const ang = this.rng() * Math.PI * 2;
        this.errYaw = Math.cos(ang) * mag;
        this.errPitch = Math.sin(ang) * mag * 0.6;
        this.aimHead = this.rng() < this.prof.headChance;
        // Elite/veteran sometimes slide into close fights.
        const p2 = this.sim.player(this.id);
        if (p2 && p2.move.sprint && bestDist < 16 && this.rng() < this.prof.slideChance) this.slideWish = true;
      }
      this.target = best.ident.id;
      this.targetVisible = true;
      this.targetDist = bestDist;
      this.lastSeenTick = tick;
      this.setLastKnown(best.move.pos, tick);
      return;
    }
    this.targetVisible = false;
    // Damage from an unseen attacker: look toward it.
    if (hurtRecently >= 0 && p.lastAttackerTick > this.lastKnownTick) {
      this.setLastKnown(p.lastDamageFrom, p.lastAttackerTick);
    }
    // Hearing gunshots / explosions.
    for (let i = sim.noises.length - 1; i >= 0; i--) {
      const n = sim.noises[i];
      if (n.tick <= this.lastNoiseTick) break;
      if (n.id === this.id) continue;
      if (!sim.ffa && n.team === p.ident.team && n.team !== TEAM_NONE) continue;
      const r = Math.min(this.prof.hearing, n.radius);
      const dx = n.x - p.move.pos.x;
      const dz = n.z - p.move.pos.z;
      if (dx * dx + dz * dz <= r * r && n.tick > this.lastKnownTick) {
        this.setLastKnown({ x: n.x, y: n.y - EYE_HEIGHT, z: n.z }, n.tick);
        break;
      }
    }
    if (sim.noises.length) this.lastNoiseTick = sim.noises[sim.noises.length - 1].tick;
  }

  private setLastKnown(pos: Vec3, tick: number): void {
    this.lastKnown.x = pos.x;
    this.lastKnown.y = pos.y;
    this.lastKnown.z = pos.z;
    this.hasLastKnown = true;
    this.lastKnownTick = tick;
  }

  // ── Goals & paths ────────────────────────────────────────────────────────

  private chooseGoal(p: SimPlayer): void {
    const sim = this.sim;
    const tick = sim.tick;
    const pos = p.move.pos;

    // Hurt and under fire → cover.
    if (this.targetVisible && p.health < this.prof.retreatHp && this.goalKind !== 'cover') {
      const t = sim.player(this.target);
      if (t && t.health > p.health && this.findCover(p, t)) return;
    }
    if (this.goalKind === 'cover') {
      // Stay in cover while regenerating (bounded), unless the cover was flanked.
      const arrived = !this.path || this.pathIdx >= this.path.points.length;
      const flanked = arrived && this.targetVisible;
      const inTime = tick < this.coverUntil;
      if (!flanked && inTime && (this.coverT > 0 || p.health < 75)) return;
      this.goalKind = 'none';
      this.path = null;
    }
    // Sunspear pickup nearby.
    if (!p.combat.slots[2] && this.goalKind !== 'pickup' && !this.targetVisible) {
      for (const pk of sim.pickupStates()) {
        if (!pk.available) continue;
        const d = Math.hypot(pk.def.pos.x - pos.x, pk.def.pos.z - pos.z);
        if (d < 28 && Math.abs(pk.def.pos.y - pos.y) < 5) {
          this.setGoal('pickup', pk.def.pos, 12);
          return;
        }
      }
    }
    if (this.goalKind === 'pickup') {
      const pk = sim.pickupStates().find((k) => k.available && Math.hypot(k.def.pos.x - this.goal.x, k.def.pos.z - this.goal.z) < 0.5);
      if (pk && !p.combat.slots[2] && this.goalT > 0) return;
      this.goalKind = 'none';
    }
    // Reached a chase point with nobody there: look around briefly, then move on.
    if (this.goalKind === 'chase' && this.path && this.pathIdx >= this.path.points.length && !this.targetVisible) {
      if (this.searchT <= 0) this.searchT = this.rand(0.7, 1.5);
      else if ((this.searchT -= SIM_DT * THINK_EVERY) <= 0) {
        this.hasLastKnown = false;
        this.goalKind = 'none';
        this.path = null;
      }
      return;
    }
    this.searchT = 0;
    // Chase the last known enemy position (not while holding an objective).
    const fresh = this.hasLastKnown && (tick - this.lastKnownTick) * SIM_DT < 6;
    if (fresh && !this.targetVisible && this.goalKind !== 'objective') {
      if (this.goalKind !== 'chase' || Math.hypot(this.goal.x - this.lastKnown.x, this.goal.z - this.lastKnown.z) > 4) {
        this.setGoal('chase', this.lastKnown, 7);
      }
      return;
    }
    if (this.goalKind === 'chase' && !fresh) this.goalKind = 'none';

    const mode = sim.config.mode;
    if (mode === 'control') {
      if (this.goalKind !== 'objective' || this.goalT <= 0) this.pickZone(p);
      else if (this.path === null || this.pathIdx >= (this.path?.points.length ?? 0)) {
        // Inside the zone: wander within it.
        const z = this.currentZone();
        if (z && insideZone(z.def, pos) && this.holdT <= 0) {
          const k = sim.nav.randomNode(this.rng, z.def.center, z.def.radius * 0.6);
          if (k >= 0) {
            const np = sim.nav.nodePos(k);
            this.goal.x = np.x;
            this.goal.y = np.y;
            this.goal.z = np.z;
            this.holdT = this.rand(1.2, 2.8);
            this.plan(p);
          }
        }
      }
      return;
    }
    if (this.goalKind === 'none' || this.goalT <= 0 || this.path === null || this.pathIdx >= this.path.points.length) this.pickRoam(p);
  }

  private currentZone() {
    const zones = this.sim.zoneStates();
    let best = zones[0];
    let bd = Infinity;
    for (const z of zones) {
      const d = Math.hypot(z.def.center.x - this.goal.x, z.def.center.z - this.goal.z);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return best;
  }

  private pickZone(p: SimPlayer): void {
    const zones = this.sim.zoneStates();
    if (zones.length === 0) return this.pickRoam(p);
    const team = p.ident.team;
    let best = zones[0];
    let bestScore = -Infinity;
    zones.forEach((z, i) => {
      const d = Math.hypot(z.def.center.x - p.move.pos.x, z.def.center.z - p.move.pos.z);
      let s = -d / 25 + this.rng() * 1.2;
      if (z.owner !== team) s += 3;
      if (z.contested) s += 2;
      if (z.capturing !== TEAM_NONE && z.capturing !== team) s += 2.5;
      if (i === this.lane) s += 1;
      if (z.owner === team && !z.contested && !this.defender) s -= 2;
      if (s > bestScore) {
        bestScore = s;
        best = z;
      }
    });
    const k = this.sim.nav.randomNode(this.rng, best.def.center, best.def.radius * 0.6);
    const goal = k >= 0 ? this.sim.nav.nodePos(k) : best.def.center;
    this.setGoal('objective', goal, this.rand(6, 10));
  }

  private pickRoam(p: SimPlayer): void {
    const sim = this.sim;
    const nav = sim.nav;
    let anchor: Vec3 | null = null;
    const zones = sim.map.zones;
    if (sim.ffa) {
      // FFA: wander between lanes and the middle, biased toward action.
      const rnd = this.rng();
      if (rnd < 0.5 && zones.length) anchor = zones[Math.floor(this.rng() * zones.length) % zones.length].center;
      const k = anchor ? nav.randomNode(this.rng, anchor, 14) : nav.randomNode(this.rng);
      if (k >= 0) this.setGoal('roam', nav.nodePos(k), this.rand(10, 18));
      return;
    }
    // Team modes: push along a lane: own half → lane center → enemy half → switch lanes.
    const enemySpawns = sim.map.spawns.filter((s) => s.team !== p.ident.team && s.team !== TEAM_NONE);
    const lane = zones.length ? zones[this.lane % zones.length].center : { x: 0, y: 0, z: 0 };
    if (this.laneStage === 0) anchor = lane;
    else if (this.laneStage === 1 && enemySpawns.length) {
      let cx = 0;
      let cz = 0;
      for (const s of enemySpawns) {
        cx += s.pos.x;
        cz += s.pos.z;
      }
      cx /= enemySpawns.length;
      cz /= enemySpawns.length;
      anchor = { x: lane.x * 0.6 + cx * 0.4, y: lane.y, z: lane.z * 0.3 + cz * 0.7 };
    } else anchor = lane;
    this.laneStage = (this.laneStage + 1) % 3;
    if (this.laneStage === 0) this.lane = Math.floor(this.rng() * 3);
    let k = nav.randomNode(this.rng, anchor, 9);
    if (k < 0) k = nav.randomNode(this.rng);
    if (k >= 0) this.setGoal('roam', nav.nodePos(k), this.rand(12, 20));
  }

  private setGoal(kind: GoalKind, pos: Vec3, time: number): void {
    this.goalKind = kind;
    this.goal.x = pos.x;
    this.goal.y = pos.y;
    this.goal.z = pos.z;
    this.goalT = time;
    this.repathT = 0;
    this.path = null;
  }

  private plan(p: SimPlayer): void {
    const path = this.sim.nav.findPath(p.move.pos, this.goal, 25000);
    this.repathT = this.rand(2.5, 4);
    if (!path || path.points.length === 0) {
      this.path = null;
      this.goalKind = 'none';
      return;
    }
    this.path = path;
    this.pathIdx = 0;
  }

  private findCover(p: SimPlayer, threat: SimPlayer): boolean {
    const sim = this.sim;
    const nav = sim.nav;
    const te = sim.eyeOf(threat);
    const pos = p.move.pos;
    const cands: number[] = [];
    nav.forNodesNear(pos, 13, (k) => {
      if (cands.length < 400) cands.push(k);
    });
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < 16 && cands.length; i++) {
      const k = cands[Math.floor(this.rng() * cands.length) % cands.length];
      const x = nav.px[k];
      const y = nav.py[k] + 1.0;
      const z = nav.pz[k];
      const d = Math.hypot(x - pos.x, z - pos.z);
      if (d >= bd || d < 2) continue;
      if (Math.hypot(x - te.x, z - te.z) < 6) continue;
      if (sim.world.segmentClear(te.x, te.y, te.z, x, y, z, 'sight')) continue;
      best = k;
      bd = d;
    }
    if (best < 0) return false;
    this.setGoal('cover', nav.nodePos(best), 6);
    this.plan(p);
    if (this.goalKind !== 'cover') return false;
    this.coverT = this.rand(2, 3.5);
    this.coverUntil = sim.tick + Math.round(this.rand(4, 6) * SIM_HZ);
    return true;
  }

  // ── Movement ─────────────────────────────────────────────────────────────

  private computeMove(p: SimPlayer): void {
    const pos = p.move.pos;
    let dx = 0;
    let dz = 0;
    this.wantSprint = false;
    // Path following.
    if (this.path && this.pathIdx < this.path.points.length) {
      let wp = this.path.points[this.pathIdx];
      let hx = wp.x - pos.x;
      let hz = wp.z - pos.z;
      let hd = Math.hypot(hx, hz);
      const last = this.pathIdx === this.path.points.length - 1;
      const reach = last ? 0.5 : 0.45;
      if (hd < reach && Math.abs(wp.y - pos.y) < 1.6) {
        this.pathIdx++;
        if (this.pathIdx < this.path.points.length) {
          wp = this.path.points[this.pathIdx];
          hx = wp.x - pos.x;
          hz = wp.z - pos.z;
          hd = Math.hypot(hx, hz);
        } else hd = 0;
      }
      if (hd > 0.05 && this.pathIdx < this.path.points.length) {
        dx = hx / hd;
        dz = hz / hd;
        const kind = this.path.kinds[this.pathIdx];
        if (kind === LINK_MANTLE && hd < 1.4 && wp.y > pos.y + 0.3 && p.move.onGround && this.jumpCd <= 0) this.mantleJump = true;
        const speedOk = !this.targetVisible && (this.goalKind !== 'objective' || hd > 6);
        if (speedOk && hd > 2.5 && kind !== LINK_MANTLE) this.wantSprint = true;
      }
    }
    // Combat footwork: strafe + keep preferred range (not while retreating to cover).
    if (this.targetVisible && this.goalKind !== 'cover') {
      const t = this.sim.player(this.target);
      if (t) {
        const tx = t.move.pos.x - pos.x;
        const tz = t.move.pos.z - pos.z;
        const td = Math.hypot(tx, tz) || 1;
        const ux = tx / td;
        const uz = tz / td;
        const pref = PREFERRED_RANGE[activeWeapon(p.combat)];
        let bx = 0;
        let bz = 0;
        if (td > pref * 1.5) {
          // Close the distance, following the path when we have one (it routes around cover).
          const hasPath = dx !== 0 || dz !== 0;
          bx = (hasPath ? dx : ux) * 0.8;
          bz = (hasPath ? dz : uz) * 0.8;
        } else if (td < pref * 0.55) {
          bx = -ux * 0.6;
          bz = -uz * 0.6;
        }
        // Close range: dance. Mid/long range with rifles: plant the feet while a burst is out
        // (movement spread would waste the shots), shuffle between bursts.
        const wid = activeWeapon(p.combat);
        const planted = td > 16 && wid !== 'swift' && wid !== 'breaker';
        const steady = planted ? (this.burstT > 0 ? 0.15 : 0.6) : this.burstT > 0 ? 0.7 : 1;
        const strafe = this.strafeDir * this.prof.strafe * steady;
        dx = bx - uz * strafe;
        dz = bz + ux * strafe;
        this.wantSprint = false;
      }
    }
    // Unstick: sideways shuffle + jump.
    if (this.unstickT > 0) {
      const l = Math.hypot(dx, dz) || 1;
      const sx = -dz / l;
      const sz = dx / l;
      dx = dx * 0.4 + sx * this.unstickDir;
      dz = dz * 0.4 + sz * this.unstickDir;
    }
    // Avoid walking off big drops / out of the map.
    const l = Math.hypot(dx, dz);
    if (l > 1e-3) {
      dx /= l;
      dz /= l;
      if (!this.safeAhead(p, dx, dz)) {
        if (this.targetVisible) {
          this.strafeDir = -this.strafeDir;
          dx = -dx;
          dz = -dz;
          if (!this.safeAhead(p, dx, dz)) {
            dx = 0;
            dz = 0;
          }
        } else if (!(this.path && this.path.kinds[this.pathIdx] !== undefined && this.path.kinds[this.pathIdx] !== 0)) {
          dx = 0;
          dz = 0;
        }
      }
    }
    this.moveX = dx;
    this.moveZ = dz;
  }

  /** True if walking ~1 m in (dx,dz) keeps us over ground not far below. */
  private safeAhead(p: SimPlayer, dx: number, dz: number): boolean {
    const x = p.move.pos.x + dx * 1.1;
    const z = p.move.pos.z + dz * 1.1;
    const g = this.sim.world.supportHeight(x, z, 0.2, p.move.pos.y + 0.5, 6);
    return !Number.isNaN(g) && g > this.sim.map.killY + 1;
  }

  // ── Aim & trigger ────────────────────────────────────────────────────────

  /** Updates view angles; returns true when the aim is on the intended point (for throws). */
  private updateAim(p: SimPlayer): boolean {
    const sim = this.sim;
    const eye = sim.eyeOf(p);
    let tyaw = this.yaw;
    let tpitch = 0;
    const dt = SIM_DT;
    const t = this.target >= 0 ? sim.player(this.target) : undefined;
    let precise = false;
    if (this.throwAt) {
      const dx = this.throwAt.x - eye.x;
      const dz = this.throwAt.z - eye.z;
      tyaw = yawFromDir(dx, dz);
      tpitch = ballisticPitch(Math.hypot(dx, dz), this.throwAt.y + 0.3 - eye.y);
      precise = true;
    } else if (t && t.alive && this.targetVisible) {
      // Delayed perception of the target, with partial velocity prediction.
      const lagTicks = Math.round(this.prof.trackLag * SIM_HZ);
      if (!sim.sampleHistory(t.ident.id, sim.tick - 1 - lagTicks, TMP)) {
        TMP.pos.x = t.move.pos.x;
        TMP.pos.y = t.move.pos.y;
        TMP.pos.z = t.move.pos.z;
        TMP.crouchT = t.move.crouchT;
      }
      const lead = this.prof.trackLag * this.prof.predict;
      const ax = TMP.pos.x + t.move.vel.x * lead;
      const az = TMP.pos.z + t.move.vel.z * lead;
      const eyeT = 1.62 - 0.57 * TMP.crouchT;
      const ay = TMP.pos.y + (this.aimHead ? eyeT + 0.05 : eyeT * 0.72);
      const dx = ax - eye.x;
      const dy = ay - eye.y;
      const dz = az - eye.z;
      const hd = Math.hypot(dx, dz);
      tyaw = yawFromDir(dx, dz);
      tpitch = Math.atan2(dy, hd);
      // Aim error settles over time; small continuous jitter.
      const k = Math.exp(-this.prof.settle * dt);
      this.errYaw = this.errYaw * k + (this.rng() - 0.5) * this.prof.jitter;
      this.errPitch = this.errPitch * k + (this.rng() - 0.5) * this.prof.jitter * 0.6;
      tyaw += this.errYaw;
      tpitch += this.errPitch;
      // Partial recoil compensation (view = aim - recoil).
      tpitch -= p.combat.recoilPitch * this.prof.recoilComp;
      tyaw += p.combat.recoilYaw * this.prof.recoilComp;
      // Before reacting, only start turning halfway through the reaction window.
      if (this.reactionT > this.prof.reaction * 0.5) {
        tyaw = this.yaw;
        tpitch = this.pitch;
      }
    } else if (this.searchT > 0) {
      // Clearing the spot: sweep the view left and right.
      tyaw = wrapAngle(this.yaw + Math.sin(sim.tick * 0.07 + this.id) * 0.9);
      tpitch = 0;
    } else if (this.hasLastKnown && (sim.tick - this.lastKnownTick) * SIM_DT < 4) {
      const dx = this.lastKnown.x - eye.x;
      const dz = this.lastKnown.z - eye.z;
      if (Math.hypot(dx, dz) > 1.5) {
        tyaw = yawFromDir(dx, dz);
        tpitch = Math.atan2(this.lastKnown.y + 1.4 - eye.y, Math.hypot(dx, dz)) * 0.5;
      }
    } else if (Math.hypot(this.moveX, this.moveZ) > 0.1) {
      tyaw = yawFromDir(this.moveX, this.moveZ);
      tpitch = 0;
      // Mantle links need us to face the ledge.
    } else if (this.goalKind === 'objective') {
      // Holding a zone: watch away from our own spawn side.
      const own = this.sim.map.spawns.find((s) => s.team === p.ident.team);
      if (own) tyaw = wrapAngle(own.yaw + Math.sin(sim.tick * 0.01 + this.id) * 0.9);
    }
    // Smooth, rate-limited turning.
    const dyaw = angleDiff(this.yaw, tyaw);
    const dp = tpitch - this.pitch;
    const s = Math.min(1, this.prof.smooth * dt);
    const maxTurn = this.prof.turnRate * dt;
    this.yaw = wrapAngle(this.yaw + clamp(dyaw * s, -maxTurn, maxTurn));
    this.pitch = clamp(this.pitch + clamp(dp * s, -maxTurn, maxTurn), -PITCH_LIMIT, PITCH_LIMIT);
    if (precise) return Math.abs(angleDiff(this.yaw, tyaw)) < 0.05 && Math.abs(tpitch - this.pitch) < 0.05;
    return true;
  }

  private shouldFire(p: SimPlayer): boolean {
    const sim = this.sim;
    if (!this.targetVisible || this.reactionT > 0 || this.throwAt) return false;
    if (sim.currentPhase !== 'live') return false;
    const t = sim.player(this.target);
    if (!t || !t.alive) return false;
    const c = p.combat;
    const slot = activeSlot(c);
    const w = WEAPONS[slot.id];
    if (c.swapT > 0) return false;
    const eye = sim.eyeOf(p);
    const tx = t.move.pos.x;
    const ty = t.move.pos.y + playerHeight(t.move) * 0.6;
    const tz = t.move.pos.z;
    const dx = tx - eye.x;
    const dy = ty - eye.y;
    const dz = tz - eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > w.range * 0.95) return false;
    if (w.id === 'breaker' && d > 24) return false;
    // Angular error between where the gun points and the target.
    const aim = aimAngles({ seq: 0, mx: 0, mz: 0, yaw: this.yaw, pitch: this.pitch, buttons: 0, slot: 0, viewTick: 0 }, c);
    const f = forwardFromAngles(aim.yaw, aim.pitch);
    const cos = (f.x * dx + f.y * dy + f.z * dz) / d;
    const err = Math.acos(clamp(cos, -1, 1));
    const tol = Math.atan2(0.42, d) * this.prof.fireTol + currentSpread(c, p.move) * 0.4;
    if (w.fireMode === 'charge') return err < tol * 2.2;
    if (w.fireMode === 'bolt' && c.adsT < 0.9) return false;
    if (err > tol) return false;
    if (w.fireMode === 'auto') {
      // Burst discipline: long sprays up close, controlled bursts at range.
      if (this.pauseT > 0) return false;
      if (this.burstT <= 0) {
        const k = d < 12 ? 2 : d < 30 ? 1.3 : 0.7;
        this.burstT = this.rand(this.prof.burst[0], this.prof.burst[1]) * k;
      }
      return true;
    }
    return true;
  }

  private wantAds(p: SimPlayer): boolean {
    if (!this.targetVisible || this.reactionT > this.prof.reaction * 0.4) return false;
    const id = activeWeapon(p.combat);
    if (id === 'longline') return true;
    if (id === 'breaker') return this.targetDist > 9;
    if (id === 'swift') return this.targetDist > 12;
    return this.targetDist > 7;
  }

  private desiredSlot(p: SimPlayer): number {
    const c = p.combat;
    const pickup = c.slots[2];
    if (pickup && pickup.mag > 0) return 2;
    const primary = c.slots[0];
    if (primary.mag === 0 && primary.reserve === 0) return 1;
    // Quick-draw the sidearm when the primary runs dry mid-fight at close range.
    if (this.targetVisible && c.active === 0 && primary.mag === 0 && this.targetDist < 12 && c.reloadT > 0.6) return 1;
    // Back to the primary once the fight is over.
    if (c.active === 1 && !this.targetVisible) return 0;
    return c.active === 2 ? 0 : c.active;
  }
}

export { BOT_PROFILES, ballisticPitch };
