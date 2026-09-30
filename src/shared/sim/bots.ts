// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — BotController: believable AI opponents (recruit / veteran /
// elite) that play through the exact same InputCmd path as humans.
//
// Structure
//  • think() runs every tick (cheap): aim (bots/aim.ts), path following, combat
//    footwork, trigger discipline, button edges. seq increments every tick.
//  • deliberate() runs at 20 Hz, staggered by player id: perception, goals,
//    path requests, stuck detection, throwables, stance.
//  • BotDirector (bots/director.ts) coordinates a team: lane spread, fight
//    hotspots, target sharing, Launch Control roles, Sunspear claims, mercy.
//  • Lane skeleton (bots/lanes.ts): stations along each lane with the angles a
//    player would hold there.
//
// Fair play
//  • Sees only through a view cone with line of sight (chest or head) and never
//    through smoke; notices far / peripheral enemies later.
//  • Hears gunshots (capped by loudness and profile) and footsteps of moving
//    enemies nearby, with a position error that grows with distance.
//  • Damage from an unseen attacker gives a direction (like the HUD's damage
//    indicator), not a target: the bot turns toward it after a reaction delay.
//  • Never lingers in the enemy spawn area and never shoots spawn-protected
//    players; spreads its attention instead of piling onto one human.
//
// Goals: lane (advance station to station) → hold (an angle, briefly) →
// rotate (to a live fight) | objective (Launch Control role) | chase / investigate
// (last known / heard) | cover (low health or reloading) → peek | pickup.
// ─────────────────────────────────────────────────────────────────────────────

import { EYE_HEIGHT, SIM_DT, SIM_HZ } from '../constants';
import { activeSlot, activeWeapon, aimAngles, currentSpread } from '../combat';
import { angleDiff, clamp, forwardFromAngles, hash32, mulberry32, wrapAngle, yawFromDir } from '../math';
import { eyeHeight, playerHeight } from '../movement';
import type { BotDifficulty, InputCmd, Vec3 } from '../types';
import { BTN_ADS, BTN_CROUCH, BTN_FIRE, BTN_JUMP, BTN_RELOAD, BTN_SPRINT, BTN_THROW, TEAM_NONE } from '../types';
import { WEAPONS } from '../weapons';
import { BOT_PROFILES, PREFERRED_RANGE, ballisticPitch, type BotProfile } from './bot-profiles';
import { BotAim } from './bots/aim';
import { BotDirector } from './bots/director';
import { STATIONS, laneOfX, stationOfZ } from './bots/lanes';
import { findCoverNode, pickStationNode, throwLaneClear } from './bots/tactics';
import type { GameSim, SimPlayer } from './game';
import type { RewoundState } from './lagcomp';
import { LINK_MANTLE, type NavPath } from './nav';
import { insideZone } from './zones';

type GoalKind = 'none' | 'lane' | 'hold' | 'rotate' | 'objective' | 'chase' | 'cover' | 'peek' | 'pickup' | 'shift';

const THINK_EVERY = 3; // 20 Hz at SIM_HZ 60
const DT_THINK = SIM_DT * THINK_EVERY;
const TMP: RewoundState = { pos: { x: 0, y: 0, z: 0 }, crouchT: 0, alive: true };
const EYE: Vec3 = { x: 0, y: 0, z: 0 };
const FWD: Vec3 = { x: 0, y: 0, z: 0 };
const POS: Vec3 = { x: 0, y: 0, z: 0 };
const AIM = { yaw: 0, pitch: 0 };
const AIM_CMD: InputCmd = { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0, viewTick: 0 };
const LANE_COUNTS = [0, 0, 0];

export class BotController {
  readonly id: number;
  readonly difficulty: BotDifficulty;
  private readonly sim: GameSim;
  private readonly prof: BotProfile;
  private readonly rng: () => number;
  private readonly dir: BotDirector;
  private readonly aim: BotAim;
  private seq = 0;
  private readonly phase: number;

  // Perception / target.
  private target = -1;
  private targetVisible = false;
  private targetDist = 0;
  private lastSeenTick = -100000;
  private readonly lastKnown: Vec3 = { x: 0, y: 0, z: 0 };
  private hasLastKnown = false;
  private knownBySight = false;
  private lastKnownTick = -100000;
  private lastContactTick = -100000;
  private lastHurtTick = -100000;
  private lastNoiseTick = -1;
  private reactionT = 0;
  private engagedWith = -1;
  private fireReadyT = 0;
  private aimHead = false;
  private mercyK = 0;
  private hurtT = 0;
  private hurtYaw = 0;
  private hurtLookT = 0;
  /** Other enemies visible this think (for grenade clusters): flat x,y,z. */
  private readonly vis: number[] = [];

  // Movement / goals.
  private goalKind: GoalKind = 'none';
  private readonly goal: Vec3 = { x: 0, y: 0, z: 0 };
  private path: NavPath | null = null;
  private pathIdx = 0;
  private repathT = 0;
  private goalT = 0;
  private lane = 1;
  private station = 0;
  private adv = 1;
  private holdYaw = 0;
  private holdT = 0;
  private holdStart = 0;
  private readonly stillRef: Vec3 = { x: 0, y: 0, z: 0 };
  private stillSince = 0;
  private searchT = 0;
  private coverT = 0;
  private coverUntil = 0;
  private reloadInCover = false;
  private readonly peekPos: Vec3 = { x: 0, y: 0, z: 0 };
  private hasPeek = false;
  private strafeDir = 1;
  private strafeT = 0;
  private crouchT = 0;
  private jumpCd = 0;
  private readonly stuckRef: Vec3 = { x: 0, y: 0, z: 0 };
  private stuckT = 0;
  private stuckCount = 0;
  private unstickT = 0;
  private unstickDir = 1;
  private moveX = 0;
  private moveZ = 0;
  private wantSprint = false;
  private mantleJump = false;
  private slideWish = false;

  // Trigger & throwables.
  private burstT = 0;
  private pauseT = 0;
  private lastFire = false;
  private lastButtons = 0;
  private reloadPress = false;
  private throwAt: Vec3 | null = null;
  private throwT = 0;
  private throwCd = 0;

  constructor(sim: GameSim, playerId: number, difficulty: BotDifficulty) {
    this.sim = sim;
    this.id = playerId;
    this.difficulty = difficulty;
    this.prof = BOT_PROFILES[difficulty] ?? BOT_PROFILES.veteran;
    this.rng = mulberry32(hash32(sim.seed, playerId, 0xb07));
    this.phase = playerId % THINK_EVERY;
    this.dir = BotDirector.for(sim);
    this.aim = new BotAim(this.prof, this.rng);
    this.throwCd = this.rand(6, 14);
  }

  private rand(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rng();
  }

  /** Compact state for tooling/tests. */
  debugState(): string {
    return `${this.goalKind} lane=${this.lane} st=${this.station} tgt=${this.target}${this.targetVisible ? '*' : ''}`;
  }

  onSpawn(): void {
    const p = this.sim.player(this.id);
    if (p) {
      this.aim.reset(p.lastCmd.yaw);
      this.stuckRef.x = p.move.pos.x;
      this.stuckRef.y = p.move.pos.y;
      this.stuckRef.z = p.move.pos.z;
      this.lane = this.dir.pickLane(p);
      const team = p.ident.team;
      if (this.sim.ffa || (team !== 0 && team !== 1)) {
        this.adv = this.rng() < 0.5 ? 1 : -1;
        this.station = this.dir.lanes ? stationOfZ(this.dir.lanes, p.move.pos.z) : 3;
      } else {
        this.adv = team === 0 ? 1 : -1;
        this.station = team === 0 ? 1 : STATIONS - 2;
      }
    }
    this.target = -1;
    this.targetVisible = false;
    this.engagedWith = -1;
    this.hasLastKnown = false;
    this.path = null;
    this.goalKind = 'none';
    this.stuckT = 0;
    this.stuckCount = 0;
    this.throwAt = null;
    this.coverT = 0;
    this.holdT = 0;
    this.hasPeek = false;
    this.hurtT = 0;
    this.hurtLookT = 0;
    this.lastHurtTick = this.sim.tick;
    this.lastContactTick = this.sim.tick;
    this.stillSince = this.sim.tick;
    if (p) {
      this.stillRef.x = p.move.pos.x;
      this.stillRef.y = p.move.pos.y;
      this.stillRef.z = p.move.pos.z;
    }
  }

  /** Produces this tick's command. */
  think(): InputCmd {
    this.seq++;
    const sim = this.sim;
    const p = sim.player(this.id);
    if (!p || !p.alive) {
      this.lastButtons = 0;
      if (p) this.dir.setTarget(p, -1);
      return { seq: this.seq, mx: 0, mz: 0, yaw: this.aim.yaw, pitch: this.aim.pitch, buttons: 0, slot: 0, viewTick: sim.tick };
    }
    this.dir.update();
    if ((sim.tick + this.phase) % THINK_EVERY === 0) this.deliberate(p);
    this.decayTimers();

    const aimed = this.updateAim(p);
    this.computeMove(p);
    let buttons = 0;
    const w = WEAPONS[activeWeapon(p.combat)];
    if (this.shouldFire(p)) {
      if (w.fireMode === 'semi') {
        if (!this.lastFire) buttons |= BTN_FIRE;
      } else buttons |= BTN_FIRE;
    }
    this.lastFire = (buttons & BTN_FIRE) !== 0;
    if (this.wantAds(p)) buttons |= BTN_ADS;
    const settled = !this.path || this.pathIdx >= this.path.points.length;
    const hiding = this.goalKind === 'cover' && settled;
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
      this.throwCd = this.rand(10, 22);
    }
    // Edges: never hold jump/throw/reload across ticks.
    buttons &= ~(this.lastButtons & (BTN_JUMP | BTN_THROW | BTN_RELOAD));
    this.lastButtons = buttons;
    this.slideWish = false;
    this.mantleJump = false;

    // World-space move → view-relative axes.
    const yaw = this.aim.yaw;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const mz = this.moveX * -sy + this.moveZ * -cy;
    const mx = this.moveX * cy + this.moveZ * -sy;
    return {
      seq: this.seq,
      mx: clamp(mx, -1, 1),
      mz: clamp(mz, -1, 1),
      yaw,
      pitch: this.aim.pitch,
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
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.hurtLookT > 0) this.hurtLookT -= dt;
    if (this.burstT > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) this.pauseT = this.rand(this.prof.burstPause[0], this.prof.burstPause[1]);
    } else if (this.pauseT > 0) this.pauseT -= dt;
  }

  // ── Deliberation (20 Hz) ─────────────────────────────────────────────────

  private deliberate(p: SimPlayer): void {
    const sim = this.sim;
    this.perceive(p);
    this.detectStuck(p);
    this.checkStill(p);

    // Reload when safe (or tucked into cover).
    const slot = activeSlot(p.combat);
    const w = WEAPONS[slot.id];
    const since = (sim.tick - this.lastSeenTick) * SIM_DT;
    const inCover = this.goalKind === 'cover' && (!this.path || this.pathIdx >= this.path.points.length);
    if (p.combat.reloadT <= 0 && slot.reserve > 0 && w.fireMode !== 'charge' && slot.mag < w.magSize) {
      if ((!this.targetVisible && since > 1.2 && slot.mag < w.magSize * 0.6) || (inCover && !this.targetVisible)) this.reloadPress = true;
    }

    this.goalT -= DT_THINK;
    this.repathT -= DT_THINK;
    this.chooseGoal(p);
    if (this.goalKind !== 'none' && this.goalKind !== 'hold' && (this.path === null || this.repathT <= 0)) this.plan(p);
    this.planThrow(p);

    // Combat stance changes.
    if (this.targetVisible) {
      if (this.strafeT <= 0) {
        this.strafeDir = this.rng() < 0.5 ? -1 : 1;
        this.strafeT = this.rand(0.3, 1.0);
      }
      if (this.crouchT <= 0 && this.rng() < this.prof.crouchChance) this.crouchT = this.rand(0.3, 0.9);
      if (this.jumpCd <= 0 && this.targetDist < 14 && this.rng() < this.prof.jumpChance) {
        this.mantleJump = true;
        this.jumpCd = 1.5;
      }
    } else if (this.goalKind === 'hold' && this.crouchT <= 0 && activeWeapon(p.combat) === 'longline' && this.rng() < 0.2) {
      this.crouchT = this.rand(1, 2.5);
    }
    this.dir.setTarget(p, this.targetVisible ? this.target : -1);
  }

  private detectStuck(p: SimPlayer): void {
    const traveling = Math.hypot(this.moveX, this.moveZ) > 0.3;
    if (!traveling) {
      this.stuckT = 0;
      this.stuckRef.x = p.move.pos.x;
      this.stuckRef.z = p.move.pos.z;
      return;
    }
    this.stuckT += DT_THINK;
    if (this.stuckT < 1.2) return;
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
        this.station = clamp(this.station + (this.rng() < 0.5 ? 1 : -1), 0, STATIONS - 1);
      }
    } else this.stuckCount = 0;
    this.stuckT = 0;
    this.stuckRef.x = p.move.pos.x;
    this.stuckRef.y = p.move.pos.y;
    this.stuckRef.z = p.move.pos.z;
  }

  /**
   * Nobody stands on one spot for long, even mid-fight: after ~7 s without
   * moving 1.5 m the bot relocates (a marksman changes angle, a zone holder
   * shifts position, a lane holder moves on).
   */
  private checkStill(p: SimPlayer): void {
    const pos = p.move.pos;
    const tick = this.sim.tick;
    if (Math.hypot(pos.x - this.stillRef.x, pos.y - this.stillRef.y, pos.z - this.stillRef.z) > 1.5) {
      this.stillRef.x = pos.x;
      this.stillRef.y = pos.y;
      this.stillRef.z = pos.z;
      this.stillSince = tick;
      return;
    }
    if (tick - this.stillSince < SIM_HZ * (6.5 + this.rng() * 1.5)) return;
    this.stillSince = tick;
    const nav = this.sim.nav;
    // A spot 4–14 m away, preferably not closer to the enemy we are watching.
    for (let i = 0; i < 10; i++) {
      const k = nav.randomNode(this.rng, pos, i < 5 ? 10 : 14);
      if (k < 0) continue;
      const np = nav.nodePos(k);
      const d = Math.hypot(np.x - pos.x, np.z - pos.z);
      if (d < 4 || Math.abs(np.y - pos.y) > 2.5) continue;
      if (this.dir.inEnemySpawn(p.ident.team, np.x, np.z, 2)) continue;
      if (this.hasLastKnown) {
        const before = Math.hypot(this.lastKnown.x - pos.x, this.lastKnown.z - pos.z);
        const after = Math.hypot(this.lastKnown.x - np.x, this.lastKnown.z - np.z);
        if (i < 6 && after < before - 3 && activeWeapon(p.combat) === 'longline') continue;
      }
      this.setGoal('shift', np, 5);
      return;
    }
    this.goalKind = 'none';
    this.path = null;
    this.advanceStation(p);
  }

  // ── Perception ───────────────────────────────────────────────────────────

  private perceive(p: SimPlayer): void {
    const sim = this.sim;
    const world = sim.world;
    const tick = sim.tick;
    const prof = this.prof;
    const eye = sim.eyeOf(p, EYE);
    const fwd = forwardFromAngles(this.aim.yaw, this.aim.pitch, FWD);
    const cosFov = Math.cos(prof.fovHalf);
    const cosTrack = Math.cos(Math.min(Math.PI * 0.85, prof.fovHalf * 1.7));
    const hurtBy = tick - p.lastAttackerTick < SIM_HZ * 1.5 ? p.lastAttacker : -1;
    let best: SimPlayer | null = null;
    let bestScore = Infinity;
    let bestDist = 0;
    let bestCos = 1;
    this.vis.length = 0;
    for (const e of sim.players) {
      if (!e.alive || !sim.isEnemy(p, e)) continue;
      const ex = e.move.pos.x;
      let ey = e.move.pos.y + playerHeight(e.move) * 0.62;
      const ez = e.move.pos.z;
      const dx = ex - eye.x;
      const dz = ez - eye.z;
      let dy = ey - eye.y;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 95 || d < 1e-3) continue;
      const cos = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d;
      const tracking = e.ident.id === this.target && tick - this.lastSeenTick < SIM_HZ * 0.6;
      if (!(cos >= cosFov || d < 2.5 || (tracking && cos >= cosTrack))) continue;
      if (!world.segmentClear(eye.x, eye.y, eye.z, ex, ey, ez, 'sight')) {
        // A head peeking over cover still counts.
        ey = e.move.pos.y + eyeHeight(e.move) + 0.05;
        dy = ey - eye.y;
        if (!world.segmentClear(eye.x, eye.y, eye.z, ex, ey, ez, 'sight')) continue;
      }
      POS.x = ex;
      POS.y = ey;
      POS.z = ez;
      if (sim.smokeBlocks(eye, POS)) continue;
      if (this.vis.length < 12) this.vis.push(ex, e.move.pos.y, ez);
      let score = d + (1 - cos) * 8 + e.health * 0.03;
      if (e.ident.id === this.target) score -= 10;
      if (e.ident.id === hurtBy) score -= 8;
      if (e.protectedT > 0) score += 30;
      if (!sim.ffa) {
        const c = this.dir.claims(p.ident.team, e.ident.id, this.id);
        score += c * (e.ident.isBot ? 3 : 8);
      }
      if (score < bestScore) {
        bestScore = score;
        best = e;
        bestDist = d;
        bestCos = cos;
      }
    }

    if (best) {
      const bid = best.ident.id;
      const sameTarget = bid === this.target;
      const lostFor = tick - this.lastSeenTick;
      if (!sameTarget || !this.targetVisible) {
        this.mercyK = prof.mercy && !best.ident.isBot ? this.dir.mercy(bid) : 0;
        const mercy = 1 + 0.35 * this.mercyK;
        if (sameTarget && lostFor <= SIM_HZ * 1.2) {
          // Re-acquiring someone we just saw duck out (we expected them).
          this.reactionT = prof.reaction * this.rand(0.3, 0.45) * mercy;
        } else {
          const periph = clamp(Math.acos(clamp(bestCos, -1, 1)) / prof.fovHalf, 0, 1.5);
          const still = best.move.crouchT > 0.5 && Math.hypot(best.move.vel.x, best.move.vel.z) < 1 ? 0.12 : 0;
          const switching = this.targetVisible ? 0.6 : 1;
          this.reactionT = ((prof.reaction * this.rand(0.85, 1.2) + (prof.reactionFar * bestDist) / 50) * (1 + periph * 0.5) + still) * switching * mercy;
          this.aimHead = this.rng() < prof.headChance * (1 - 0.6 * this.mercyK) * (bestDist < 45 ? 1 : 0.5);
          if (p.move.sprint && bestDist < 16 && this.rng() < prof.slideChance) this.slideWish = true;
        }
        this.engagedWith = -1;
      }
      this.target = bid;
      this.targetVisible = true;
      this.targetDist = bestDist;
      this.lastSeenTick = tick;
      this.lastContactTick = tick;
      this.hurtLookT = 0;
      this.setLastKnown(best.move.pos, tick, true);
      return;
    }
    this.targetVisible = false;

    // Hit by someone we cannot see: we get a direction (like a damage indicator).
    if (p.lastDamageTick > this.lastHurtTick) {
      this.lastHurtTick = p.lastDamageTick;
      if (hurtBy >= 0) {
        const f = p.lastDamageFrom;
        this.lastContactTick = tick;
        this.hurtYaw = yawFromDir(f.x - eye.x, f.z - eye.z);
        if (this.hurtLookT <= 0) this.hurtT = prof.reaction * this.rand(0.8, 1.15);
        this.hurtLookT = 1.6;
        const dd = Math.hypot(f.x - eye.x, f.z - eye.z);
        const err = dd * 0.12;
        this.setLastKnown({ x: f.x + (this.rng() - 0.5) * err, y: f.y - EYE_HEIGHT, z: f.z + (this.rng() - 0.5) * err }, tick, false);
      }
    }
    // Hearing: gunshots / explosions (whole past ticks only).
    const noises = sim.noises;
    const upTo = tick - 1;
    for (let i = noises.length - 1; i >= 0; i--) {
      const n = noises[i];
      if (n.tick > upTo) continue;
      if (n.tick <= this.lastNoiseTick) break;
      if (n.id === this.id) continue;
      if (!sim.ffa && n.team === p.ident.team && n.team !== TEAM_NONE) continue;
      const r = Math.min(prof.hearing, n.radius);
      const dx = n.x - p.move.pos.x;
      const dz = n.z - p.move.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= r * r && n.tick > this.lastKnownTick) {
        const err = Math.sqrt(d2) * 0.15;
        this.setLastKnown({ x: n.x + (this.rng() - 0.5) * err, y: n.y - EYE_HEIGHT, z: n.z + (this.rng() - 0.5) * err }, n.tick, false);
        this.lastContactTick = tick;
        break;
      }
    }
    this.lastNoiseTick = upTo;
    // Footsteps of moving enemies close by (crouch-walking is silent).
    if (tick - this.lastKnownTick > SIM_HZ) {
      for (const e of sim.players) {
        if (!e.alive || !sim.isEnemy(p, e) || !e.move.onGround || e.move.crouchT > 0.5) continue;
        const sp = Math.hypot(e.move.vel.x, e.move.vel.z);
        const loud = sp > 6.5 ? 1 : sp > 3.5 ? 0.5 : 0;
        if (loud === 0) continue;
        const dx = e.move.pos.x - p.move.pos.x;
        const dz = e.move.pos.z - p.move.pos.z;
        const r = prof.footsteps * loud;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r && Math.abs(e.move.pos.y - p.move.pos.y) < 4) {
          const err = Math.sqrt(d2) * 0.2;
          this.setLastKnown({ x: e.move.pos.x + (this.rng() - 0.5) * err, y: e.move.pos.y, z: e.move.pos.z + (this.rng() - 0.5) * err }, tick, false);
          break;
        }
      }
    }
  }

  private setLastKnown(pos: Vec3, tick: number, sight: boolean): void {
    this.lastKnown.x = pos.x;
    this.lastKnown.y = pos.y;
    this.lastKnown.z = pos.z;
    this.hasLastKnown = true;
    this.lastKnownTick = tick;
    this.knownBySight = sight;
  }

  // ── Goals ────────────────────────────────────────────────────────────────

  private chooseGoal(p: SimPlayer): void {
    const sim = this.sim;
    const tick = sim.tick;
    const pos = p.move.pos;
    const prof = this.prof;
    const slot = activeSlot(p.combat);
    const w = WEAPONS[slot.id];

    // 1. Cover: hurt under fire, or reloading a dry magazine behind something solid.
    if (this.goalKind !== 'cover') {
      const threatened = this.targetVisible || tick - p.lastDamageTick < SIM_HZ;
      const hurt = threatened && p.health < prof.retreatHp;
      const dry =
        this.targetVisible &&
        prof.tactics >= 0.5 &&
        w.fireMode !== 'charge' &&
        slot.reserve > 0 &&
        slot.mag <= Math.ceil(w.magSize * 0.2) &&
        this.targetDist > 10;
      if ((hurt || dry) && this.seekCover(p, dry && !hurt)) return;
    }
    if (this.goalKind === 'cover') {
      const arrived = !this.path || this.pathIdx >= this.path.points.length;
      const flanked = arrived && this.targetVisible && this.targetDist < 20;
      const busy = this.coverT > 0 || p.health < 80 || p.combat.reloadT > 0 || (this.reloadInCover && slot.mag < w.magSize * 0.5);
      if (!flanked && tick < this.coverUntil && busy) return;
      this.goalKind = 'none';
      this.path = null;
      this.reloadInCover = false;
      if (this.hasPeek && !flanked && this.hasLastKnown && (tick - this.lastKnownTick) * SIM_DT < 7 && this.rng() < 0.35 + 0.5 * prof.tactics) {
        // Peek back out where we last had eyes on them, walking, pre-aimed.
        this.setGoal('peek', this.peekPos, 4);
        this.hasPeek = false;
        return;
      }
      this.hasPeek = false;
    }
    if (this.goalKind === 'peek') {
      if (!this.targetVisible && this.goalT > 0 && this.path && this.pathIdx < this.path.points.length) return;
      this.goalKind = 'none';
      this.path = null;
    }

    if (this.goalKind === 'shift') {
      if (this.goalT > 0 && (!this.path || this.pathIdx < this.path.points.length)) return;
      this.goalKind = 'none';
      this.path = null;
    }

    // 2. Sunspear (one bot per team at a time).
    if (!p.combat.slots[2] && !this.targetVisible && this.goalKind !== 'pickup' && tick - this.lastContactTick > SIM_HZ * 2) {
      for (const pk of sim.pickupStates()) {
        if (!pk.available) continue;
        const d = Math.hypot(pk.def.pos.x - pos.x, pk.def.pos.z - pos.z);
        if (d < 42 && Math.abs(pk.def.pos.y - pos.y) < 7 && this.dir.claimSunspear(p)) {
          this.setGoal('pickup', pk.def.pos, 16);
          return;
        }
      }
    }
    if (this.goalKind === 'pickup') {
      const pk = sim.pickupStates().find((k) => k.available && Math.hypot(k.def.pos.x - this.goal.x, k.def.pos.z - this.goal.z) < 0.5);
      if (pk && !p.combat.slots[2] && this.goalT > 0 && !this.targetVisible) return;
      this.goalKind = 'none';
      this.path = null;
    }

    // 3. Chase / investigate the last known enemy position.
    if (this.goalKind === 'chase' && this.path && this.pathIdx >= this.path.points.length && !this.targetVisible) {
      if (this.searchT <= 0) this.searchT = this.rand(0.7, 1.6);
      else if ((this.searchT -= DT_THINK) <= 0) {
        this.hasLastKnown = false;
        this.goalKind = 'none';
        this.path = null;
      }
      return;
    }
    this.searchT = 0;
    const age = (tick - this.lastKnownTick) * SIM_DT;
    const fresh = this.hasLastKnown && age < (this.knownBySight ? 5 : 4);
    if (fresh && !this.targetVisible) {
      const d = Math.hypot(this.lastKnown.x - pos.x, this.lastKnown.z - pos.z);
      const wid = activeWeapon(p.combat);
      const zone = this.assignedZone();
      const offObjective = zone !== null && Math.hypot(this.lastKnown.x - zone.def.center.x, this.lastKnown.z - zone.def.center.z) > zone.def.radius + 12 && d > 10;
      const camping = this.dir.inEnemySpawn(p.ident.team, this.lastKnown.x, this.lastKnown.z, 4);
      // Lane discipline: don't desert the flank to chase something across the map.
      const info = this.dir.lanes;
      const crossLane = !!info && zone === null && !sim.ffa && laneOfX(info, this.lastKnown.x) !== this.lane && d > (this.prof.tactics >= 0.5 ? 18 : 26);
      if (wid === 'longline' && d > 14 && this.knownBySight && !(this.goalKind === 'hold' && tick - this.holdStart > SIM_HZ * 6)) {
        // Marksmen keep the angle instead of running into close quarters.
        if (this.goalKind !== 'hold') this.startHold(yawFromDir(this.lastKnown.x - pos.x, this.lastKnown.z - pos.z), this.rand(2, 4));
        return;
      }
      if (!offObjective && !camping && !crossLane && (this.knownBySight ? d < 45 : d < 26)) {
        if (this.goalKind !== 'chase' || Math.hypot(this.goal.x - this.lastKnown.x, this.goal.z - this.lastKnown.z) > 4) this.setGoal('chase', this.lastKnown, 7);
        return;
      }
    }
    if (this.goalKind === 'chase') {
      this.goalKind = 'none';
      this.path = null;
    }

    // 4. Mode goals. Nobody camps one spot for long: relocate after ~8 s.
    if (this.goalKind === 'hold' && tick - this.holdStart > SIM_HZ * 8 && !this.targetVisible) {
      this.goalKind = 'none';
      this.advanceStation(p);
    }
    if (this.dir.inEnemySpawn(p.ident.team, pos.x, pos.z, 2) && this.goalKind !== 'lane') {
      this.station = clamp(3 - this.adv, 0, STATIONS - 1);
      this.goLane(p);
      return;
    }
    if (sim.config.mode === 'control' && sim.zoneStates().length) {
      this.chooseObjective(p);
      return;
    }
    this.chooseLaneGoal(p);
  }

  private assignedZone() {
    if (this.sim.config.mode !== 'control') return null;
    const zones = this.sim.zoneStates();
    const i = this.dir.zoneFor(this.id);
    return i >= 0 && i < zones.length ? zones[i] : null;
  }

  private chooseObjective(p: SimPlayer): void {
    const sim = this.sim;
    const zones = sim.zoneStates();
    let zone = this.assignedZone();
    if (!zone) {
      // Before the first assignment: the nearest zone we don't own.
      let bd = Infinity;
      for (const z of zones) {
        const d = Math.hypot(z.def.center.x - p.move.pos.x, z.def.center.z - p.move.pos.z) + (z.owner === p.ident.team ? 30 : 0);
        if (d < bd) {
          bd = d;
          zone = z;
        }
      }
    }
    if (!zone) return;
    const c = zone.def.center;
    const inside = insideZone(zone.def, p.move.pos);
    const goalInZone = Math.hypot(this.goal.x - c.x, this.goal.z - c.z) < zone.def.radius;
    if (!inside) {
      if (this.goalKind !== 'objective' || !goalInZone || this.goalT <= 0) {
        const k = sim.nav.randomNode(this.rng, c, zone.def.radius * 0.6);
        this.setGoal('objective', k >= 0 ? sim.nav.nodePos(k) : c, this.rand(8, 14));
      }
      return;
    }
    // Inside: hold a spot, watch the approaches, shift every few seconds.
    const arrived = !this.path || this.pathIdx >= this.path.points.length;
    if (this.goalKind === 'hold' && this.holdT > 0) return;
    if (this.goalKind === 'objective' && !arrived && goalInZone) return;
    if (this.goalKind === 'objective' && arrived) {
      const spawnZ = this.dir.lanes ? this.dir.lanes.spawnZ[p.ident.team === 0 ? 1 : 0] : -p.move.pos.z;
      const look = yawFromDir((this.rng() - 0.5) * 30, spawnZ - p.move.pos.z);
      this.startHold(look, this.rand(1.5, 3.5));
      return;
    }
    // A different spot in the zone (not a shuffle on the same square meter).
    for (let i = 0; i < 4; i++) {
      const k = sim.nav.randomNode(this.rng, c, zone.def.radius * 0.8);
      if (k < 0) continue;
      const np = sim.nav.nodePos(k);
      if (i < 3 && Math.hypot(np.x - p.move.pos.x, np.z - p.move.pos.z) < 3) continue;
      this.setGoal('objective', np, this.rand(5, 9));
      return;
    }
  }

  private chooseLaneGoal(p: SimPlayer): void {
    const sim = this.sim;
    const info = this.dir.lanes;
    if (!info) {
      if (this.goalKind === 'none' || this.goalT <= 0 || !this.path || this.pathIdx >= this.path.points.length) {
        const k = sim.nav.randomNode(this.rng);
        if (k >= 0) this.setGoal('rotate', sim.nav.nodePos(k), this.rand(10, 18));
      }
      return;
    }
    const arrived = !this.path || this.pathIdx >= this.path.points.length;
    if (this.goalKind === 'hold') {
      if (this.holdT > 0) return;
      this.advanceStation(p);
      this.goLane(p);
      return;
    }
    if ((this.goalKind === 'lane' || this.goalKind === 'rotate') && !arrived && this.goalT > 0) {
      // Quiet for a while? Head for a real fight instead.
      if (this.goalKind === 'lane' && this.sim.tick - this.lastContactTick > SIM_HZ * 7 && (this.sim.tick + this.id) % 20 === 0) this.tryRotate(p);
      return;
    }
    if (this.goalKind === 'lane' && arrived) {
      const hold = this.rand(this.prof.hold[0], this.prof.hold[1]) * this.holdScale(p);
      this.startHold(this.holdYaw, hold);
      return;
    }
    if (this.goalKind === 'rotate' && arrived) {
      this.lane = laneOfX(info, p.move.pos.x);
      this.station = stationOfZ(info, p.move.pos.z);
      this.dir.setLane(this.id, this.lane);
      this.startHold(this.holdYaw, this.rand(1, 2.5));
      return;
    }
    if (this.sim.tick - this.lastContactTick > SIM_HZ * 7 && this.tryRotate(p)) return;
    this.goLane(p);
  }

  private holdScale(p: SimPlayer): number {
    const wid = activeWeapon(p.combat);
    return wid === 'longline' ? 2.2 : wid === 'breaker' || wid === 'swift' ? 0.6 : 1;
  }

  /** Next station along our push; at the far end, swing to another lane's middle. */
  private advanceStation(p: SimPlayer): void {
    const info = this.dir.lanes;
    if (!info) return;
    const team = p.ident.team;
    const last = this.sim.ffa || (team !== 0 && team !== 1) ? (this.adv > 0 ? STATIONS - 1 : 0) : this.adv > 0 ? STATIONS - 2 : 1;
    // Flank: cross to a neighbouring lane mid-push through the connectors.
    const counts = this.dir.laneCounts(p, LANE_COUNTS);
    if (this.station !== last && this.rng() < 0.18 * this.prof.tactics) {
      const side = this.lane === 1 ? (counts[0] <= counts[2] ? 0 : 2) : 1;
      if (counts[side] <= counts[this.lane]) {
        this.lane = side;
        this.dir.setLane(this.id, side);
      }
    }
    if (this.station === last) {
      // Pushed through: pick the thinnest lane and work back from its middle.
      this.lane = this.dir.pickLane(p);
      if (this.sim.ffa) this.adv = -this.adv;
      this.station = 3;
      return;
    }
    this.station = clamp(this.station + this.adv, 0, STATIONS - 1);
  }

  private goLane(p: SimPlayer): void {
    const info = this.dir.lanes;
    if (!info) return;
    const wid = activeWeapon(p.combat);
    const sightPref = wid === 'longline' ? 1 : wid === 'meridian' || wid === 'sunspear' ? 0.5 : 0.15;
    const team = this.sim.ffa ? (this.adv > 0 ? 0 : 1) : p.ident.team;
    const pick = pickStationNode(info, this.lane, this.station, team, this.rng, sightPref);
    if (!pick) return;
    this.holdYaw = pick.holdYaw;
    this.setGoal('lane', this.sim.nav.nodePos(pick.node), this.rand(14, 22));
  }

  private tryRotate(p: SimPlayer): boolean {
    const hs = this.dir.bestHotspot(p.ident.team, p.move.pos.x, p.move.pos.z, this.sim.ffa ? 70 : 55);
    if (!hs || this.rng() > 0.35 + 0.4 * this.prof.tactics) return false;
    const info = this.dir.lanes;
    if (info && !this.sim.ffa) {
      // Don't abandon the flanks: only reinforce a lane that is short of teammates.
      const hl = laneOfX(info, hs.x);
      const counts = this.dir.laneCounts(p, LANE_COUNTS);
      const team = counts[0] + counts[1] + counts[2] + 1;
      if (hl !== this.lane && counts[hl] + 1 > Math.ceil(team * 0.45)) return false;
    }
    const k = this.sim.nav.randomNode(this.rng, hs, 7);
    if (k < 0) return false;
    const np = this.sim.nav.nodePos(k);
    this.holdYaw = yawFromDir(hs.x - np.x, hs.z - np.z);
    this.setGoal('rotate', np, 14);
    return true;
  }

  private startHold(yaw: number, t: number): void {
    if (this.goalKind !== 'hold') this.holdStart = this.sim.tick;
    this.goalKind = 'hold';
    this.holdYaw = yaw;
    this.holdT = t;
    this.path = null;
    this.goalT = t + 1;
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

  private seekCover(p: SimPlayer, forReload: boolean): boolean {
    const sim = this.sim;
    let threat: Vec3;
    const t = this.targetVisible ? sim.player(this.target) : undefined;
    if (t) threat = sim.eyeOf(t, POS);
    else {
      const f = p.lastDamageFrom;
      threat = { x: f.x, y: f.y, z: f.z };
    }
    const tries = 8 + Math.round(12 * this.prof.tactics);
    const k = findCoverNode(sim.nav, sim.world, this.rng, p.move.pos, threat, 13, tries);
    if (k < 0) return false;
    this.peekPos.x = p.move.pos.x;
    this.peekPos.y = p.move.pos.y;
    this.peekPos.z = p.move.pos.z;
    this.setGoal('cover', sim.nav.nodePos(k), 6);
    this.plan(p);
    if (this.goalKind !== 'cover') return false;
    this.hasPeek = true;
    this.reloadInCover = forReload;
    this.coverT = forReload ? 0.8 : this.rand(2, 3.5);
    this.coverUntil = sim.tick + Math.round(this.rand(4, 6) * SIM_HZ);
    return true;
  }

  // ── Throwables ───────────────────────────────────────────────────────────

  private planThrow(p: SimPlayer): void {
    const sim = this.sim;
    if (this.throwAt || this.throwCd > 0 || p.combat.throwables <= 0 || sim.currentPhase !== 'live') return;
    const pos = p.move.pos;
    const eye = sim.eyeOf(p, EYE);
    const prof = this.prof;
    const tick = sim.tick;
    if (p.ident.loadout.throwable === 'grenade') {
      // Two or more enemies bunched up in view.
      const v = this.vis;
      for (let i = 0; i + 3 < v.length && !this.throwAt; i += 3) {
        for (let j = i + 3; j < v.length; j += 3) {
          if (Math.hypot(v[i] - v[j], v[i + 2] - v[j + 2]) > 5.5 || Math.abs(v[i + 1] - v[j + 1]) > 2) continue;
          const c = { x: (v[i] + v[j]) / 2, y: (v[i + 1] + v[j + 1]) / 2, z: (v[i + 2] + v[j + 2]) / 2 };
          const d = Math.hypot(c.x - pos.x, c.z - pos.z);
          if (d < 8 || d > 26 || this.teammateNear(p, c, 6) || !throwLaneClear(sim.world, eye, c)) continue;
          if (this.rng() < 0.55 * prof.grenadeSkill) this.queueThrow(c, 0.15);
          break;
        }
      }
      // Flush someone who ducked behind cover.
      const age = (tick - this.lastKnownTick) * SIM_DT;
      if (!this.throwAt && !this.targetVisible && this.hasLastKnown && this.knownBySight && age > 0.4 && age < 3) {
        const d = Math.hypot(this.lastKnown.x - pos.x, this.lastKnown.z - pos.z);
        if (d > 8 && d < 24 && !this.teammateNear(p, this.lastKnown, 5) && throwLaneClear(sim.world, eye, this.lastKnown) && this.rng() < 0.05 * prof.grenadeSkill) {
          this.queueThrow(this.lastKnown, 0.25);
        }
      }
      return;
    }
    // Smoke: cover a retreat…
    if (this.goalKind === 'cover' && this.path && this.pathIdx < this.path.points.length && this.targetVisible) {
      const t = sim.player(this.target);
      if (t && this.rng() < 0.3 * prof.smokeSkill) {
        this.queueThrow({ x: (pos.x * 2 + t.move.pos.x) / 3, y: pos.y, z: (pos.z * 2 + t.move.pos.z) / 3 }, 0.1);
        return;
      }
    }
    // …revive a stalled push onto an objective the enemy holds…
    const zone = this.assignedZone();
    if (zone && zone.owner !== p.ident.team && !this.targetVisible) {
      const c = zone.def.center;
      const d = Math.hypot(c.x - pos.x, c.z - pos.z);
      const enemyThere = this.hasLastKnown && Math.hypot(this.lastKnown.x - c.x, this.lastKnown.z - c.z) < zone.def.radius + 8 && (tick - this.lastKnownTick) * SIM_DT < 6;
      if (d > 12 && d < 28 && (zone.contested || enemyThere) && this.rng() < 0.08 * prof.smokeSkill) {
        const k = (d - 6) / d;
        const at = { x: pos.x + (c.x - pos.x) * k, y: c.y, z: pos.z + (c.z - pos.z) * k };
        if (throwLaneClear(sim.world, eye, at)) this.queueThrow(at, 0.2);
        return;
      }
    }
    // …or cross open ground under a watching long gun.
    const moving = this.goalKind === 'lane' || this.goalKind === 'rotate' || this.goalKind === 'objective' || this.goalKind === 'pickup';
    if (moving && !this.targetVisible && this.hasLastKnown && this.knownBySight && (tick - this.lastKnownTick) * SIM_DT < 4) {
      const d = Math.hypot(this.lastKnown.x - pos.x, this.lastKnown.z - pos.z);
      if (d > 24 && this.rng() < 0.06 * prof.smokeSkill) {
        const k = Math.min(10, d * 0.35) / d;
        const at = { x: pos.x + (this.lastKnown.x - pos.x) * k, y: pos.y, z: pos.z + (this.lastKnown.z - pos.z) * k };
        if (throwLaneClear(sim.world, eye, at)) this.queueThrow(at, 0.15);
      }
    }
  }

  private queueThrow(at: Vec3, delay: number): void {
    this.throwAt = { x: at.x, y: at.y, z: at.z };
    this.throwT = delay;
    this.throwCd = 1.5; // give up if the aim never lines up
  }

  private teammateNear(p: SimPlayer, at: Vec3, r: number): boolean {
    for (const q of this.sim.players) {
      if (!q.alive || (q !== p && this.sim.isEnemy(p, q))) continue;
      if (Math.hypot(q.move.pos.x - at.x, q.move.pos.z - at.z) < r) return true;
    }
    return false;
  }

  // ── Movement ─────────────────────────────────────────────────────────────

  private computeMove(p: SimPlayer): void {
    const pos = p.move.pos;
    let dx = 0;
    let dz = 0;
    this.wantSprint = false;
    if (this.path && this.pathIdx < this.path.points.length) {
      let wp = this.path.points[this.pathIdx];
      let hx = wp.x - pos.x;
      let hz = wp.z - pos.z;
      let hd = Math.hypot(hx, hz);
      const last = this.pathIdx === this.path.points.length - 1;
      if (hd < (last ? 0.5 : 0.45) && Math.abs(wp.y - pos.y) < 1.6) {
        this.pathIdx++;
        if (this.pathIdx < this.path.points.length) {
          wp = this.path.points[this.pathIdx];
          hx = wp.x - pos.x;
          hz = wp.z - pos.z;
          hd = Math.hypot(hx, hz);
        } else hd = 0;
      }
      if (hd <= 0.3 && this.pathIdx < this.path.points.length && wp.y < pos.y - 1) {
        // Standing on the lip right above a drop waypoint: step off toward what follows.
        const nx = this.path.points[this.pathIdx + 1] ?? wp;
        const px = this.pathIdx > 0 ? this.path.points[this.pathIdx - 1] : pos;
        let ex = nx.x - px.x;
        let ez = nx.z - px.z;
        if (Math.hypot(ex, ez) < 0.1) {
          ex = wp.x - px.x + 0.01;
          ez = wp.z - px.z;
        }
        hx = ex;
        hz = ez;
        hd = Math.hypot(ex, ez);
      }
      if (hd > 0.05 && this.pathIdx < this.path.points.length) {
        dx = hx / hd;
        dz = hz / hd;
        const kind = this.path.kinds[this.pathIdx];
        if (kind === LINK_MANTLE && hd < 1.4 && wp.y > pos.y + 0.3 && p.move.onGround && this.jumpCd <= 0) this.mantleJump = true;
        const calm = this.goalKind !== 'peek' && (this.goalKind !== 'objective' || hd > 6);
        if (calm && !this.targetVisible && hd > 2.5 && kind !== LINK_MANTLE) this.wantSprint = true;
        if (this.goalKind === 'peek') {
          dx *= 0.6;
          dz *= 0.6;
        }
      }
    }
    // Combat footwork: strafe + keep the weapon's range (not while retreating).
    const wid = activeWeapon(p.combat);
    const repositioning = this.goalKind === 'shift' && dx * dx + dz * dz > 0;
    if (this.targetVisible && this.goalKind !== 'cover' && this.reactionT <= this.prof.reaction * 0.5) {
      const t = this.sim.player(this.target);
      if (t) {
        const tx = t.move.pos.x - pos.x;
        const tz = t.move.pos.z - pos.z;
        const td = Math.hypot(tx, tz) || 1;
        const ux = tx / td;
        const uz = tz / td;
        const pref = PREFERRED_RANGE[wid];
        const hasPath = dx !== 0 || dz !== 0;
        let bx = 0;
        let bz = 0;
        if (repositioning || (this.goalKind === 'objective' && hasPath && td > pref * 0.55)) {
          // Moving to a new spot / onto the objective while trading shots.
          const k = repositioning ? 1 : 0.75;
          bx = dx * k;
          bz = dz * k;
        } else if (td > pref * 1.5) {
          // Close the distance along the path when we have one (it routes around cover).
          const push = wid === 'breaker' || wid === 'swift' ? 1 : 0.8;
          bx = (hasPath ? dx : ux) * push;
          bz = (hasPath ? dz : uz) * push;
          if (wid === 'breaker' && td > 14 && this.burstT <= 0) this.wantSprint = true;
        } else if (td < pref * 0.55) {
          bx = -ux * 0.6;
          bz = -uz * 0.6;
        }
        // Close range: dance. Mid/long range with rifles: plant the feet while a burst is out.
        const planted = td > 16 && wid !== 'swift' && wid !== 'breaker';
        const steady = planted ? (this.burstT > 0 ? 0.15 : 0.6) : this.burstT > 0 ? 0.7 : 1;
        const strafe = this.strafeDir * this.prof.strafe * steady * (repositioning ? 0.4 : 1);
        dx = bx - uz * strafe;
        dz = bz + ux * strafe;
        if (!(wid === 'breaker' && this.wantSprint)) this.wantSprint = false;
      }
    }
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
      const k = Math.min(1, l) / l;
      dx *= k;
      dz *= k;
      if (!this.safeAhead(p, dx / Math.min(1, l), dz / Math.min(1, l))) {
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

  /** Updates view angles; returns true when the aim is on the intended throw point. */
  private updateAim(p: SimPlayer): boolean {
    const sim = this.sim;
    const aim = this.aim;
    const eye = sim.eyeOf(p, EYE);
    const dt = SIM_DT;
    const t = this.target >= 0 ? sim.player(this.target) : undefined;
    if (this.throwAt) {
      const dx = this.throwAt.x - eye.x;
      const dz = this.throwAt.z - eye.z;
      const ty = yawFromDir(dx, dz);
      const tp = ballisticPitch(Math.hypot(dx, dz), this.throwAt.y + 0.3 - eye.y);
      aim.look(ty, tp, dt, this.prof.smooth * 1.5);
      return Math.abs(angleDiff(aim.yaw, ty)) < 0.05 && Math.abs(tp - aim.pitch) < 0.05;
    }
    if (t && t.alive && this.targetVisible && this.reactionT <= 0) {
      // Delayed perception of the target, with partial velocity prediction.
      const prof = this.prof;
      const lagTicks = Math.round(prof.trackLag * SIM_HZ);
      if (!sim.sampleHistory(t.ident.id, sim.tick - 1 - lagTicks, TMP)) {
        TMP.pos.x = t.move.pos.x;
        TMP.pos.y = t.move.pos.y;
        TMP.pos.z = t.move.pos.z;
        TMP.crouchT = t.move.crouchT;
      }
      const lead = prof.trackLag * prof.predict;
      const ax = TMP.pos.x + t.move.vel.x * lead;
      const az = TMP.pos.z + t.move.vel.z * lead;
      const eyeT = 1.62 - 0.57 * TMP.crouchT;
      const ay = TMP.pos.y + (this.aimHead ? eyeT + 0.05 : eyeT * 0.72);
      const dx = ax - eye.x;
      const dz = az - eye.z;
      const hd = Math.hypot(dx, dz);
      const ty = yawFromDir(dx, dz);
      const tp = Math.atan2(ay - eye.y, hd);
      if (this.engagedWith !== this.target || !aim.engaged) {
        aim.flickTo(ty, tp, Math.atan2(0.5, hd) * 2, 1 + 0.5 * this.mercyK);
        this.engagedWith = this.target;
        this.fireReadyT = prof.fireDelay * this.rand(0.8, 1.3) * (1 + this.mercyK);
      }
      aim.track(ty, tp, p.combat.recoilYaw, p.combat.recoilPitch, dt, 1 + 0.6 * this.mercyK);
      return true;
    }
    if (!(t && t.alive && this.targetVisible)) this.engagedWith = -1;
    if (t && t.alive && this.targetVisible) {
      // Still reacting: the eyes have it, the hands have not moved yet.
      aim.look(aim.yaw, aim.pitch, dt);
      return true;
    }
    let ty = aim.yaw;
    let tp = 0;
    let rate = this.prof.smooth;
    const age = (sim.tick - this.lastKnownTick) * SIM_DT;
    const moving = Math.hypot(this.moveX, this.moveZ) > 0.1;
    if (this.hurtLookT > 0 && this.hurtT <= 0) {
      // Turn toward where the shots came from.
      ty = this.hurtYaw;
      rate *= 1.6;
    } else if (this.hurtLookT > 0) {
      ty = aim.yaw;
      tp = aim.pitch;
    } else if (this.searchT > 0) {
      ty = wrapAngle(aim.yaw + Math.sin(sim.tick * 0.07 + this.id) * 0.9);
    } else if (this.hasLastKnown && age < 4 && (this.prof.tactics >= 0.5 || !moving)) {
      // Pre-aim where they were (chest height).
      const dx = this.lastKnown.x - eye.x;
      const dz = this.lastKnown.z - eye.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.5) {
        ty = yawFromDir(dx, dz);
        tp = Math.atan2(this.lastKnown.y + 1.25 - eye.y, d) * (this.knownBySight ? 1 : 0.5);
      }
    } else if (this.goalKind === 'hold') {
      const sweep = this.prof.tactics >= 0.5 ? 0.3 : 0.6;
      ty = wrapAngle(this.holdYaw + Math.sin(sim.tick * 0.018 + this.id * 1.7) * sweep);
      rate *= 0.6;
    } else if (moving) {
      ty = yawFromDir(this.moveX, this.moveZ);
      // Veterans glance down the lane toward the enemy side while advancing.
      if (this.prof.tactics >= 0.5 && this.goalKind === 'lane' && Math.abs(angleDiff(ty, this.holdYaw)) < 1.2) ty = wrapAngle(ty + angleDiff(ty, this.holdYaw) * 0.5);
      if (this.path && this.pathIdx < this.path.points.length) {
        const wp = this.path.points[this.pathIdx];
        const hd = Math.hypot(wp.x - eye.x, wp.z - eye.z);
        if (hd > 1) tp = clamp(Math.atan2(wp.y + 1.5 - eye.y, hd), -0.5, 0.5) * 0.6;
      }
    }
    aim.look(ty, tp, dt, rate);
    return true;
  }

  private shouldFire(p: SimPlayer): boolean {
    const sim = this.sim;
    if (!this.targetVisible || this.reactionT > 0 || this.throwAt || !this.aim.engaged) return false;
    if (sim.currentPhase !== 'live') return false;
    const t = sim.player(this.target);
    if (!t || !t.alive || t.protectedT > 0) return false;
    const c = p.combat;
    const slot = activeSlot(c);
    const w = WEAPONS[slot.id];
    if (c.swapT > 0) return false;
    const eye = sim.eyeOf(p, EYE);
    const dx = t.move.pos.x - eye.x;
    const dy = t.move.pos.y + playerHeight(t.move) * (this.aimHead ? 0.92 : 0.6) - eye.y;
    const dz = t.move.pos.z - eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > w.range * 0.95) return false;
    if (w.id === 'breaker' && d > 24) return false;
    // Angular error between where the gun points and the target.
    AIM_CMD.yaw = this.aim.yaw;
    AIM_CMD.pitch = this.aim.pitch;
    const a = aimAngles(AIM_CMD, c, AIM);
    const f = forwardFromAngles(a.yaw, a.pitch, FWD);
    const err = Math.acos(clamp((f.x * dx + f.y * dy + f.z * dz) / d, -1, 1));
    const tol = Math.atan2(0.42, d) * this.prof.fireTol + currentSpread(c, p.move) * 0.4;
    if (this.fireReadyT > 0) {
      // First shot of an engagement: confirm the sight picture first.
      if (err < tol) this.fireReadyT -= SIM_DT;
      return false;
    }
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
    }
    return true;
  }

  private wantAds(p: SimPlayer): boolean {
    if (!this.targetVisible || this.reactionT > this.prof.reaction * 0.4) {
      // Marksmen hold their angle scoped in.
      return this.goalKind === 'hold' && activeWeapon(p.combat) === 'longline' && this.prof.tactics >= 0.5;
    }
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
    // Marksmen swap to the sidearm when someone gets in their face.
    if (this.targetVisible && primary.id === 'longline' && this.targetDist < 8 && this.prof.tactics >= 0.5) return 1;
    if (c.active === 1 && primary.id === 'longline' && this.targetVisible && this.targetDist < 12) return 1;
    // Back to the primary once the fight is over.
    if (c.active === 1 && !this.targetVisible) return 0;
    return c.active === 2 ? 0 : c.active;
  }
}

export { BOT_PROFILES, ballisticPitch };
