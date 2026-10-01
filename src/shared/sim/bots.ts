// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — BotController: believable AI opponents (recruit / veteran /
// elite) that play through the exact same InputCmd path as humans.
//
// Structure
//  • think() runs every tick (cheap): aim + trigger (bots/combat.ts over the
//    human aim model in bots/aim.ts), locomotion (bots/motion.ts), button edges.
//    seq increments every tick.
//  • deliberate() runs at 20 Hz, staggered by player id: perception
//    (bots/perception.ts), goals (this file), path requests, stuck / stillness
//    checks, throwables, stance.
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

import { SIM_DT, SIM_HZ } from '../constants';
import { activeSlot, activeWeapon } from '../combat';
import { clamp, hash32, mulberry32, yawFromDir } from '../math';
import type { BotDifficulty, InputCmd, Vec3 } from '../types';
import { BTN_ADS, BTN_CROUCH, BTN_FIRE, BTN_JUMP, BTN_RELOAD, BTN_SPRINT, BTN_THROW } from '../types';
import { WEAPONS } from '../weapons';
import { BOT_PROFILES, ballisticPitch, type BotProfile } from './bot-profiles';
import { BotAim } from './bots/aim';
import { BotDirector } from './bots/director';
import { STATIONS, laneOfX, stationOfZ } from './bots/lanes';
import { desiredSlot, planThrow, shouldFire, updateAim, wantAds } from './bots/combat';
import { computeMove, headroom } from './bots/motion';
import { perceive } from './bots/perception';
import { findCoverNode, pickStationNode } from './bots/tactics';
import type { GameSim, SimPlayer } from './game';
import type { NavPath } from './nav';
import { insideZone } from './zones';

/** What the bot is currently doing (shared with the bots/*.ts helpers). */
export type GoalKind = 'none' | 'lane' | 'hold' | 'rotate' | 'objective' | 'chase' | 'cover' | 'peek' | 'pickup' | 'shift';

const THINK_EVERY = 3; // 20 Hz at SIM_HZ 60
const DT_THINK = SIM_DT * THINK_EVERY;
const POS: Vec3 = { x: 0, y: 0, z: 0 };
const LANE_COUNTS = [0, 0, 0];
const TRAIL = 32;

/**
 * One bot. The public API is think() / onSpawn() / id / difficulty; the other
 * fields are the bot's working state, shared with the bots/*.ts helpers.
 */
export class BotController {
  readonly id: number;
  readonly difficulty: BotDifficulty;
  readonly sim: GameSim;
  readonly prof: BotProfile;
  readonly rng: () => number;
  readonly dir: BotDirector;
  readonly aim: BotAim;
  seq = 0;
  readonly phase: number;

  // Perception / target.
  target = -1;
  targetVisible = false;
  targetDist = 0;
  lastSeenTick = -100000;
  readonly lastKnown: Vec3 = { x: 0, y: 0, z: 0 };
  hasLastKnown = false;
  knownBySight = false;
  lastKnownTick = -100000;
  lastContactTick = -100000;
  lastHurtTick = -100000;
  lastNoiseTick = -1;
  reactionT = 0;
  engagedWith = -1;
  fireReadyT = 0;
  aimHead = false;
  mercyK = 0;
  hurtT = 0;
  hurtYaw = 0;
  hurtLookT = 0;
  /** Other enemies visible this think (for grenade clusters): flat x,y,z. */
  readonly vis: number[] = [];

  // Movement / goals.
  goalKind: GoalKind = 'none';
  readonly goal: Vec3 = { x: 0, y: 0, z: 0 };
  path: NavPath | null = null;
  pathIdx = 0;
  repathT = 0;
  goalT = 0;
  lane = 1;
  station = 0;
  adv = 1;
  holdYaw = 0;
  holdT = 0;
  holdStart = 0;
  /** Tick after which a marksman may settle into another long-range watch. */
  watchReady = 0;
  readonly stillRef: Vec3 = { x: 0, y: 0, z: 0 };
  /** Recent positions (ring of TRAIL samples, every 0.2 s) and how long we have been still. */
  readonly trail = new Float32Array(TRAIL * 3);
  trailHead = 0;
  trailLen = 0;
  trailTick = -1000;
  stillFor = 0;
  searchT = 0;
  coverT = 0;
  coverUntil = 0;
  reloadInCover = false;
  readonly peekPos: Vec3 = { x: 0, y: 0, z: 0 };
  hasPeek = false;
  strafeDir = 1;
  strafeT = 0;
  crouchT = 0;
  jumpCd = 0;
  readonly stuckRef: Vec3 = { x: 0, y: 0, z: 0 };
  stuckT = 0;
  stuckCount = 0;
  unstickT = 0;
  unstickDir = 1;
  dodgeT = 0;
  wedgeT = 0;
  shiftTick = -100000;
  moveX = 0;
  moveZ = 0;
  wantSprint = false;
  mantleJump = false;
  slideWish = false;

  // Trigger & throwables.
  burstT = 0;
  pauseT = 0;
  lastFire = false;
  lastButtons = 0;
  reloadPress = false;
  throwAt: Vec3 | null = null;
  throwT = 0;
  throwCd = 0;

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

  rand(lo: number, hi: number): number {
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
    this.trailLen = 0;
    this.stillFor = 0;
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

    const aimed = updateAim(this, p);
    computeMove(this, p);
    // Airborne but motionless = wedged under a low ceiling (e.g. a jump released
    // mid-air in a tunnel): crouching always frees the player.
    const mv = p.move.vel;
    if (!p.move.onGround && Math.abs(mv.x) + Math.abs(mv.y) + Math.abs(mv.z) < 0.05) {
      this.wedgeT += SIM_DT;
      if (this.wedgeT > 0.2) this.crouchT = Math.max(this.crouchT, 0.6);
    } else this.wedgeT = 0;
    let buttons = 0;
    const w = WEAPONS[activeWeapon(p.combat)];
    if (shouldFire(this, p)) {
      if (w.fireMode === 'semi') {
        if (!this.lastFire) buttons |= BTN_FIRE;
      } else buttons |= BTN_FIRE;
    }
    this.lastFire = (buttons & BTN_FIRE) !== 0;
    if (wantAds(this, p)) buttons |= BTN_ADS;
    const settled = !this.path || this.pathIdx >= this.path.points.length;
    const hiding = this.goalKind === 'cover' && settled;
    if (this.crouchT > 0 || this.slideWish || hiding) buttons |= BTN_CROUCH;
    if (this.wantSprint && !(buttons & (BTN_FIRE | BTN_ADS))) buttons |= BTN_SPRINT;
    if ((this.mantleJump || (this.unstickT > 0 && this.jumpCd <= 0)) && headroom(this, p)) {
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
      slot: desiredSlot(this, p),
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
    if (this.dodgeT > 0) this.dodgeT -= dt;
    if (this.burstT > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) this.pauseT = this.rand(this.prof.burstPause[0], this.prof.burstPause[1]);
    } else if (this.pauseT > 0) this.pauseT -= dt;
  }

  // ── Deliberation (20 Hz) ─────────────────────────────────────────────────

  private deliberate(p: SimPlayer): void {
    const sim = this.sim;
    perceive(this, p);
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
    planThrow(this, p);

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
   * Nobody stands on one spot for long, even mid-fight: after ~5 s inside a
   * small circle the bot relocates (a marksman changes angle, a zone holder
   * shifts position, a lane holder moves on). Positions are sampled 5×/s into
   * a ring; "still for" = how far back every sample stays within 1.3 m of us.
   */
  private checkStill(p: SimPlayer): void {
    const pos = p.move.pos;
    const tick = this.sim.tick;
    if (tick - this.trailTick >= 12) {
      this.trailTick = tick;
      const i = this.trailHead;
      this.trail[i * 3] = pos.x;
      this.trail[i * 3 + 1] = pos.y;
      this.trail[i * 3 + 2] = pos.z;
      this.trailHead = (i + 1) % TRAIL;
      if (this.trailLen < TRAIL) this.trailLen++;
    }
    let n = 0;
    for (; n < this.trailLen; n++) {
      const i = (this.trailHead - 1 - n + TRAIL * 2) % TRAIL;
      const dx = this.trail[i * 3] - pos.x;
      const dy = this.trail[i * 3 + 1] - pos.y;
      const dz = this.trail[i * 3 + 2] - pos.z;
      if (dx * dx + dy * dy + dz * dz > 1.3 * 1.3) break;
    }
    this.stillFor = n * 0.2;
    if (this.stillFor < 4.8 + this.rng() * 0.6) return;
    this.trailLen = 0;
    this.stillFor = 0;
    this.stillRef.x = pos.x;
    this.stillRef.y = pos.y;
    this.stillRef.z = pos.z;
    this.shiftTick = tick;
    if (this.targetVisible) {
      // Mid-fight: at least side-step hard for a moment (and then relocate).
      this.dodgeT = this.rand(0.7, 1.1);
      this.strafeDir = this.rng() < 0.5 ? -1 : 1;
    }
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
      this.plan(p);
      if (this.goalKind === 'shift') return;
    }
    for (let i = 0; i < 4; i++) {
      const k = nav.randomNode(this.rng, pos, 20);
      if (k < 0) continue;
      this.setGoal('shift', nav.nodePos(k), 6);
      this.plan(p);
      if (this.goalKind === 'shift') return;
    }
    this.goalKind = 'none';
    this.path = null;
    this.advanceStation(p);
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
      // Break off when losing the trade (they are healthier, or it's 2-on-1);
      // a fight we are winning is finished instead.
      const foe = this.targetVisible ? sim.player(this.target) : undefined;
      const losing = !foe || foe.health > p.health + 10 || this.vis.length >= 6;
      const hurt = threatened && p.health < prof.retreatHp && losing;
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
      this.advanceStation(p); // the fight moved us on: don't walk back to the same corner
    }
    if (this.goalKind === 'peek') {
      if (!this.targetVisible && this.goalT > 0 && this.path && this.pathIdx < this.path.points.length) return;
      this.goalKind = 'none';
      this.path = null;
      this.advanceStation(p);
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
      if (wid === 'longline' && d > 14 && this.knownBySight && (this.goalKind === 'hold' ? tick - this.holdStart < SIM_HZ * 6 : tick >= this.watchReady && this.stillFor < 2)) {
        // Marksmen keep the angle instead of running into close quarters (for a while).
        if (this.goalKind !== 'hold') {
          this.startHold(yawFromDir(this.lastKnown.x - pos.x, this.lastKnown.z - pos.z), this.rand(2, 4));
          this.watchReady = tick + SIM_HZ * 12;
        }
        return;
      }
      if (!offObjective && !camping && !crossLane && (this.knownBySight ? d < 45 : d < 26)) {
        if (this.goalKind !== 'chase' || Math.hypot(this.goal.x - this.lastKnown.x, this.goal.z - this.lastKnown.z) > 4) this.setGoal('chase', this.lastKnown, 7);
        return;
      }
    }
    if (this.goalKind === 'chase') {
      // Keep pressing while they are in sight; drop it once the trail goes cold.
      if (fresh && this.targetVisible) return;
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

  assignedZone() {
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
    return wid === 'longline' ? 1.6 : wid === 'breaker' || wid === 'swift' ? 0.6 : 1;
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
    // Just told to get moving: don't duck behind the same box again.
    const avoid = sim.tick - this.shiftTick < SIM_HZ * 3 ? this.stillRef : null;
    const k = findCoverNode(sim.nav, sim.world, this.rng, p.move.pos, threat, 13, tries, avoid);
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

}

export { BOT_PROFILES, ballisticPitch };
