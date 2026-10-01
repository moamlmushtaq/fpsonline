// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — GameSim: the authoritative match simulation.
//
// Owns players (movement + combat state, health, respawn, stats), hitscan with
// lag compensation, throwables, Sunspear pickups, mode rules (TDM / FFA /
// Launch Control / Training Range), match phases and events. Runs identically
// in the Node server and the browser worker host. Deterministic given the seed
// and the input stream: no Math.random / Date.now anywhere.
//
// Per tick (step):
//   1. phase clock        2. player commands (bots think; humans' queued cmds)
//   3. lag-comp history   4. throwables / smokes   5. pickups   6. falls
//   7. zones / range      8. respawns & regen      9. match end checks
// Events are queued with optional routing (`to` = only that player, `except` =
// everyone but that player) and drained by the Room after each step.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ASSIST_WINDOW,
  GRENADE_DAMAGE,
  GRENADE_MIN_DAMAGE,
  GRENADE_RADIUS,
  MATCH_OUTRO,
  MAX_CMDS_PER_TICK,
  MAX_HEALTH,
  REGEN_DELAY,
  REGEN_RATE,
  RESPAWN_TIME,
  SIM_DT,
  SIM_HZ,
  SPAWN_PROTECTION,
  THROW_SPEED,
  THROW_UP,
  ZONE_POINTS_PER_SEC,
} from '../constants';
import {
  activeWeapon,
  aimAngles,
  giveSunspear,
  cloneCombatState,
  createCombatState,
  eyePosition,
  hitboxes,
  sanitizeLoadout,
  stepPlayer,
  type CombatStepResult,
  type Hitboxes,
  type ShotRequest,
} from '../combat';
import { ARMOR_TINTS, NAMECARDS, VISOR_STYLES, defaultCosmetics } from '../cosmetics';
import type { MapDef, PickupDef } from '../maps/types';
import { clamp, forwardFromAngles, hash32, lerp, mulberry32, pick, q2, randInt } from '../math';
import { cloneMoveState, createMoveState, eyeHeight, playerHeight } from '../movement';
import type { PlayerCheats } from './player';
import { botName } from '../names';
import { CollisionWorld } from '../physics';
import type { RangeAction, ScoreboardRow, SnapshotMsg } from '../protocol';
import type {
  BotDifficulty,
  GameConfig,
  GameEvent,
  InputCmd,
  KillCause,
  Loadout,
  MatchClock,
  MatchPhase,
  MatchResults,
  PlayerIdentity,
  ShotImpact,
  Team,
  Vec3,
  ZoneId,
} from '../types';
import {
  BTN_FIRE,
  BTN_THROW,
  PRIMARY_WEAPON_IDS,
  TEAM_NONE,
} from '../types';
import { WEAPONS, damageAt } from '../weapons';
import { BotController } from './bots';
import { LagHistory, type RewoundState } from './lagcomp';
import { NavGraph } from './nav';
import { RangeSim } from './range';
import { pickSpawn, type SpawnActor } from './spawns';
import { ThrowableSystem, smokeBlocks as smokeBlocksImpl, type Projectile, type SmokeCloud } from './throwables';
import {
  createSimPlayer,
  emptyStats,
  pickBotPrimary,
  sanitizeCmd,
  worldForMap,
  SCORE_ASSIST,
  SCORE_CAPTURE,
  SCORE_HEADSHOT,
  SCORE_KILL,
  SCORE_OBJECTIVE_PER_SEC,
  type Noise,
  type RoutedEvent,
  type SimPlayer,
} from './player';
import { tracePellet } from './hitscan';
import { PickupSystem } from './pickups';
import { buildResults, playerSnap, scoreboardRows } from './views';
import { ZoneSystem, type ZoneOccupant, type ZoneState } from './zones';

/** Sight test through smoke clouds: true if the segment a→b is blocked by any cloud. */
export { smokeBlocksImpl as smokeBlocks };

export type { DamageEntry, Noise, PlayerCheats, RoutedEvent, SimPlayer } from './player';
export { sanitizeCmd, worldForMap } from './player';

type SharedSnapshot = Omit<SnapshotMsg, 'type' | 'events' | 'self'>;

export type { PickupState } from './pickups';

/** Frames without input before a human is stepped with a neutral command. */
const STARVE_TICKS = 30;
/** Max queued commands kept per human. */
const MAX_QUEUE = 24;
/** Multi-kill window. */
const MULTI_KILL_WINDOW = 4;
/** A fall within this many seconds of being damaged credits the attacker. */
const FALL_CREDIT_WINDOW = 5;

export class GameSim {
  readonly config: GameConfig;
  readonly map: MapDef;
  readonly world: CollisionWorld;
  readonly seed: number;
  /** Seeded RNG for all host-side randomness (spawns, bots, loadouts). */
  readonly rng: () => number;
  tick = 0;
  readonly players: SimPlayer[] = [];
  readonly throwables = new ThrowableSystem();
  readonly zones: ZoneSystem | null;
  readonly range: RangeSim | null;
  /** Recent gunshots/explosions for bot hearing (newest last, bounded). */
  readonly noises: Noise[] = [];
  readonly teamScores: [number, number] = [0, 0];

  private phase: MatchPhase;
  private phaseTicks = 0;
  /**
   * Set by the Room while a human who was sent matchStart is still loading the map:
   * the pre-match countdown then waits (bounded by the Room) so nobody misses the start.
   */
  holdCountdown = false;
  /** Admin cheat (room-level): bots stand still and hold fire. */
  botsFrozen = false;
  private liveTicks = 0;
  private events: RoutedEvent[] = [];
  private nextId = 1;
  private readonly history = new LagHistory();
  private readonly pickups: PickupSystem;
  private readonly recentDeaths: { pos: Vec3; tick: number }[] = [];
  private firstBlood = false;
  private finalMinuteSent = false;
  private launchReadySent = false;
  private endResult: { winner: Team; winnerPlayer: number; draw: boolean } | null = null;
  private navGraph: NavGraph | null = null;
  private snapCache: { tick: number; snap: SharedSnapshot } | null = null;
  private readonly rewound: RewoundState = { pos: { x: 0, y: 0, z: 0 }, crouchT: 0, alive: false };
  private readonly hbScratch: Hitboxes[] = [];

  constructor(config: GameConfig, map: MapDef, seed: number) {
    this.config = config;
    this.map = map;
    this.seed = seed >>> 0;
    this.rng = mulberry32(hash32(this.seed, 0x5eed));
    this.world = worldForMap(map);
    this.zones = config.mode === 'control' || config.mode === 'range' ? new ZoneSystem(map.zones) : null;
    this.range = config.mode === 'range' ? new RangeSim(map.targets ?? []) : null;
    this.pickups = new PickupSystem(map.pickups); // the range has its own Sunspear pedestal
    this.phase = config.countdown > 0 ? 'countdown' : 'live';
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get finished(): boolean {
    return this.phase === 'ended' && this.phaseTicks >= MATCH_OUTRO * SIM_HZ;
  }

  get currentPhase(): MatchPhase {
    return this.phase;
  }

  /** True in modes where every other player is an enemy. */
  get ffa(): boolean {
    return this.config.mode === 'ffa' || this.config.mode === 'range';
  }

  /** Lazily built navigation graph (cached per map across rooms). */
  get nav(): NavGraph {
    if (!this.navGraph) this.navGraph = NavGraph.build(this.world, this.map);
    return this.navGraph;
  }

  get smokes(): readonly SmokeCloud[] {
    return this.throwables.smokes;
  }

  get projectiles(): readonly Projectile[] {
    return this.throwables.projectiles;
  }

  player(id: number): SimPlayer | undefined {
    for (const p of this.players) if (p.ident.id === id) return p;
    return undefined;
  }

  isEnemy(a: SimPlayer, b: SimPlayer): boolean {
    if (a === b) return false;
    return this.ffa || a.ident.team !== b.ident.team;
  }

  /** Sight blocked by any smoke cloud between a and b. */
  smokeBlocks(a: Vec3, b: Vec3): boolean {
    return smokeBlocksImpl(this.throwables.smokes, a, b);
  }

  /** Seconds left in the live phase (Infinity if unlimited / not live yet). */
  timeLeft(): number {
    if (this.config.timeLimit <= 0) return Infinity;
    if (this.phase === 'countdown') return this.config.timeLimit;
    if (this.phase !== 'live') return 0;
    return Math.max(0, this.config.timeLimit - this.liveTicks * SIM_DT);
  }

  zoneStates(): readonly ZoneState[] {
    return this.zones ? this.zones.zones : [];
  }

  pickupStates(): readonly { def: PickupDef; available: boolean; respawnT: number }[] {
    return this.pickups.items;
  }

  // ── Players ───────────────────────────────────────────────────────────────

  /** Adds a player; assigns id and a balanced team. Spawns immediately when the match is running. */
  addPlayer(ident: Omit<PlayerIdentity, 'id' | 'team'> & { team?: Team }): PlayerIdentity {
    const id = this.nextId++;
    const teams = !this.ffa;
    let team: Team = TEAM_NONE;
    if (teams) {
      if (ident.team === 0 || ident.team === 1) team = ident.team;
      else {
        const c0 = this.players.filter((p) => p.ident.team === 0).length;
        const c1 = this.players.filter((p) => p.ident.team === 1).length;
        team = c0 <= c1 ? 0 : 1;
      }
    }
    const faction = teams ? (team as 0 | 1) : ident.faction === 1 ? 1 : 0;
    const full: PlayerIdentity = {
      id,
      name: ident.name,
      isBot: ident.isBot,
      team,
      faction,
      loadout: sanitizeLoadout(ident.loadout),
      cosmetics: ident.cosmetics ?? defaultCosmetics(),
      level: ident.level,
      platform: ident.platform,
      botDifficulty: ident.isBot ? (ident.botDifficulty ?? this.config.botDifficulty) : undefined,
    };
    const p = createSimPlayer(full, this.map.spawns[0]?.pos ?? { x: 0, y: 0, z: 0 });
    this.players.push(p);
    this.snapCache = null;
    if (full.isBot) p.bot = new BotController(this, id, full.botDifficulty ?? this.config.botDifficulty);
    this.emit({ t: 'join', p: { ...full } });
    if (this.phase === 'countdown' || this.phase === 'live') this.spawnPlayer(p);
    else p.respawnT = 0;
    return { ...full };
  }

  /** Adds one bot (balanced team unless given). */
  addBot(team?: Team, difficulty?: BotDifficulty): PlayerIdentity {
    const rng = this.rng;
    const taken = this.players.map((p) => p.ident.name);
    const cos = defaultCosmetics();
    cos.armor = pick(rng, ARMOR_TINTS).id;
    cos.visor = pick(rng, VISOR_STYLES).id;
    cos.namecard = pick(rng, NAMECARDS).id;
    return this.addPlayer({
      name: botName(rng, taken),
      isBot: true,
      team,
      faction: rng() < 0.5 ? 0 : 1,
      loadout: { primary: pickBotPrimary(rng()), throwable: rng() < 0.6 ? 'grenade' : 'smoke' },
      cosmetics: cos,
      level: randInt(rng, 2, 42),
      platform: 'desktop',
      botDifficulty: difficulty ?? this.config.botDifficulty,
    });
  }

  /** Fills empty slots with bots up to config.maxPlayers (range: never). */
  fillBots(): PlayerIdentity[] {
    const out: PlayerIdentity[] = [];
    if (this.config.mode === 'range') return out;
    while (this.players.length < this.config.maxPlayers) out.push(this.addBot());
    return out;
  }

  removePlayer(id: number): void {
    const i = this.players.findIndex((p) => p.ident.id === id);
    if (i < 0) return;
    this.players.splice(i, 1);
    this.history.remove(id);
    this.throwables.removeOwner(id);
    this.snapCache = null;
    this.emit({ t: 'leave', p: id });
  }

  /** A human takes a bot's slot mid-match (drop-in). Returns null if there is no bot to replace. */
  replaceBotWith(ident: Omit<PlayerIdentity, 'id' | 'team'> & { team?: Team }): PlayerIdentity | null {
    const bots = this.players.filter((p) => p.ident.isBot);
    if (bots.length === 0) return null;
    let candidates = bots;
    if (!this.ffa) {
      const humans = (t: Team) => this.players.filter((p) => !p.ident.isBot && p.ident.team === t).length;
      const pref: Team = ident.team === 0 || ident.team === 1 ? ident.team : humans(0) <= humans(1) ? 0 : 1;
      const onPref = bots.filter((b) => b.ident.team === pref);
      if (onPref.length) candidates = onPref;
    }
    // Prefer a dead bot (clean hand-over), then the lowest-scoring one.
    candidates = [...candidates].sort((a, b) => Number(a.alive) - Number(b.alive) || a.stats.score - b.stats.score);
    const bot = candidates[0];
    const team = bot.ident.team;
    this.removePlayer(bot.ident.id);
    return this.addPlayer({ ...ident, team });
  }

  /** Replaces a human with a bot on the same team (quick play leave). */
  replaceWithBot(id: number): PlayerIdentity | null {
    const p = this.player(id);
    if (!p) return null;
    const team = p.ident.team;
    this.removePlayer(id);
    return this.addBot(this.ffa ? undefined : team);
  }

  setLoadout(id: number, loadout: Loadout): void {
    const p = this.player(id);
    if (!p) return;
    p.pendingLoadout = sanitizeLoadout(loadout);
    if (!p.alive || this.config.mode === 'range') this.applyPendingLoadout(p, this.config.mode === 'range' && p.alive);
  }

  private applyPendingLoadout(p: SimPlayer, reequip: boolean): void {
    if (!p.pendingLoadout) return;
    p.ident.loadout = p.pendingLoadout;
    p.pendingLoadout = null;
    if (reequip) {
      p.combat = createCombatState(p.ident.loadout);
      this.syncCheats(p);
    }
  }

  /** Queues input commands for a human; ignores seq ≤ last received. */
  pushInputs(id: number, cmds: readonly unknown[]): void {
    const p = this.player(id);
    if (!p || p.ident.isBot || !Array.isArray(cmds)) return;
    const list: InputCmd[] = [];
    for (let i = 0; i < cmds.length && i < 32; i++) {
      const c = sanitizeCmd(cmds[i]);
      if (c) list.push(c);
    }
    list.sort((a, b) => a.seq - b.seq);
    for (const c of list) {
      if (c.seq <= p.lastQueuedSeq) continue;
      p.queue.push(c);
      p.lastQueuedSeq = c.seq;
    }
    if (p.queue.length > MAX_QUEUE) p.queue.splice(0, p.queue.length - MAX_QUEUE);
  }

  identities(): PlayerIdentity[] {
    return this.players.map((p) => ({ ...p.ident }));
  }

  /**
   * Training range remote commands. 'weapon' / 'throwable' (additive, range
   * rack) re-equip the given player immediately without touching the saved loadout.
   */
  rangeCommand(action: RangeAction, value?: number, playerId?: number): void {
    if (!this.range) return;
    if (action === 'reset') {
      this.range.reset();
      for (const p of this.players) p.stats = emptyStats();
      this.zones?.reset();
    } else if (action === 'difficulty') this.range.setSpeed(value ?? 1);
    else if (action === 'weapon' || action === 'throwable') {
      const p = playerId !== undefined ? this.player(playerId) : this.players.find((x) => !x.ident.isBot);
      const i = Math.floor(Number(value));
      if (!p || !Number.isFinite(i)) return;
      const cur = p.pendingLoadout ?? p.ident.loadout;
      if (action === 'weapon') {
        const primary = PRIMARY_WEAPON_IDS[i];
        if (!primary) return;
        this.setLoadout(p.ident.id, { ...cur, primary });
      } else {
        if (i !== 0 && i !== 1) return;
        this.setLoadout(p.ident.id, { ...cur, throwable: i === 0 ? 'grenade' : 'smoke' });
      }
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  private emit(ev: GameEvent, to?: number, except?: number): void {
    const e: RoutedEvent = { ev };
    if (to !== undefined) e.to = to;
    if (except !== undefined) e.except = except;
    this.events.push(e);
  }

  drainEvents(): RoutedEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ── Step ──────────────────────────────────────────────────────────────────

  step(): void {
    this.tick++;
    this.snapCache = null;
    this.stepPhase();
    const live = this.phase === 'live';

    // Commands.
    for (const p of this.players) {
      if (p.bot) {
        if (this.botsFrozen) {
          // Admin freeze: physics keeps running (gravity), but no movement, aim changes or fire.
          const c = p.lastCmd;
          this.processCmd(p, { seq: c.seq + 1, mx: 0, mz: 0, yaw: c.yaw, pitch: c.pitch, buttons: 0, slot: c.slot, viewTick: this.tick - 1 }, live, true);
        } else this.processCmd(p, p.bot.think(), live, true);
        continue;
      }
      const n = Math.min(p.queue.length, MAX_CMDS_PER_TICK);
      if (n > 0) {
        p.starve = 0;
        for (let i = 0; i < n; i++) this.processCmd(p, p.queue.shift() as InputCmd, live, true);
      } else if (++p.starve > STARVE_TICKS && p.alive) {
        // No input for a while (stalled connection): keep physics going with a neutral command.
        const c = p.lastCmd;
        this.processCmd(p, { seq: c.seq, mx: 0, mz: 0, yaw: c.yaw, pitch: c.pitch, buttons: 0, slot: c.slot, viewTick: c.viewTick }, live, false);
      }
    }

    for (const p of this.players) this.history.record(p.ident.id, this.tick, p.move.pos, p.move.crouchT, p.alive);

    this.throwables.step(this.world, SIM_DT, this.tick, this.map.killY, (ev) => this.emit(ev), (pr) => this.explode(pr));
    if (live) this.pickups.step(SIM_DT, this.players, (ev) => this.emit(ev));
    this.stepFalls();
    if (this.zones && (live || this.config.mode === 'range')) this.stepZones();
    this.range?.step(SIM_DT);
    this.stepLife();
    if (this.config.mode === 'range') this.refillRangeAmmo();
    if (live) this.checkEnd();
    // Keep the noise list short.
    while (this.noises.length && this.tick - this.noises[0].tick > SIM_HZ * 3) this.noises.shift();
  }

  private stepPhase(): void {
    if (this.phase === 'countdown' && this.holdCountdown) return;
    this.phaseTicks++;
    if (this.phase === 'countdown') {
      if (this.phaseTicks >= this.config.countdown * SIM_HZ) this.setPhase('live');
    } else if (this.phase === 'live') {
      this.liveTicks++;
      const left = this.timeLeft();
      if (!this.finalMinuteSent && this.config.timeLimit > 90 && left <= 60) {
        this.finalMinuteSent = true;
        this.emit({ t: 'announce', key: 'final_minute' });
      }
    }
  }

  private setPhase(ph: MatchPhase): void {
    this.phase = ph;
    this.phaseTicks = 0;
    this.emit({ t: 'phase', phase: ph });
    if (ph === 'live' && this.config.mode !== 'range') this.emit({ t: 'announce', key: 'match_start' });
  }

  private processCmd(p: SimPlayer, cmd: InputCmd, live: boolean, ack: boolean): void {
    if (ack) p.ackSeq = cmd.seq;
    p.lastCmd = cmd;
    if (!p.alive) return;
    let c = cmd;
    if (!live && this.config.mode !== 'range') c = { ...cmd, buttons: cmd.buttons & ~(BTN_FIRE | BTN_THROW) };
    const r = stepPlayer(this.world, p.move, p.combat, c, p.ident.id, SIM_DT);
    this.handleCombat(p, c, r);
  }

  private handleCombat(p: SimPlayer, cmd: InputCmd, r: CombatStepResult): void {
    const id = p.ident.id;
    if (r.shot) {
      p.protectedT = 0;
      this.resolveShot(p, r.shot, cmd);
    }
    if (r.reloadStarted) this.emit({ t: 'reload', p: id, w: activeWeapon(p.combat) }, undefined, id);
    if (r.chargeStarted) this.emit({ t: 'charge', p: id }, undefined, id);
    if (r.swappedTo) this.emit({ t: 'swap', p: id, w: r.swappedTo }, undefined, id);
    if (r.throwRequested) {
      p.protectedT = 0;
      this.spawnThrowable(p, cmd);
    }
  }

  // ── Hitscan ───────────────────────────────────────────────────────────────

  private resolveShot(shooter: SimPlayer, shot: ShotRequest, cmd: InputCmd): void {
    const w = WEAPONS[shot.weapon];
    const o = shot.origin;
    shooter.stats.shots++;
    this.noises.push({ x: o.x, y: o.y, z: o.z, tick: this.tick, id: shooter.ident.id, team: shooter.ident.team, radius: shot.weapon === 'sunspear' ? 60 : 38 });
    if (this.noises.length > 48) this.noises.shift();

    // Rewind potential victims to what the shooter saw.
    const viewTick = LagHistory.clampViewTick(cmd.viewTick, this.tick - 1);
    const victims: SimPlayer[] = [];
    let hbCount = 0;
    for (const v of this.players) {
      if (!v.alive || !this.isEnemy(shooter, v)) continue;
      const hb = this.hbScratch[hbCount] ?? (this.hbScratch[hbCount] = hitboxes({ x: 0, y: 0, z: 0 }, 0));
      if (this.history.sample(v.ident.id, viewTick, this.rewound)) {
        if (!this.rewound.alive) continue;
        hitboxes(this.rewound.pos, this.rewound.crouchT, hb);
      } else hitboxes(v.move.pos, v.move.crouchT, hb);
      victims.push(v);
      hbCount++;
    }

    const impacts: ShotImpact[] = [];
    const dmgBy = new Map<SimPlayer, { dmg: number; head: boolean }>();
    let anyHit = false;
    for (const d of shot.dirs) {
      const tr = tracePellet(this.world, o, d, w.range, this.hbScratch, victims.length, this.range);
      const imp = tr.impact;
      const dmg = damageAt(w.id, tr.dist) * (tr.head ? w.headMult : 1);
      if (tr.candidate >= 0) {
        const victim = victims[tr.candidate];
        imp.pl = victim.ident.id;
        const acc = dmgBy.get(victim) ?? { dmg: 0, head: false };
        acc.dmg += dmg;
        acc.head = acc.head || tr.head;
        dmgBy.set(victim, acc);
        anyHit = true;
      } else if (tr.target && this.range) {
        imp.tg = tr.target.id;
        const kill = this.range.damage(tr.target, dmg, this.tick);
        anyHit = true;
        if (tr.head) shooter.stats.headshots++;
        if (kill) shooter.stats.kills++;
        shooter.stats.damage += dmg;
        this.emit({ t: 'target', id: tr.target.id, head: tr.head, kill, dmg: Math.round(dmg), dist: tr.target.def.distance, w: w.id, s: cmd.seq }, shooter.ident.id);
      }
      impacts.push(imp);
    }
    if (anyHit) shooter.stats.hits++;
    this.emit({ t: 'shot', p: shooter.ident.id, w: w.id, o: { x: q2(o.x), y: q2(o.y), z: q2(o.z) }, hits: impacts }, undefined, shooter.ident.id);
    const from = { x: q2(o.x), y: q2(o.y), z: q2(o.z) };
    for (const [victim, acc] of dmgBy) this.applyDamage(victim, shooter, acc.dmg, w.id, acc.head, from);
  }

  // ── Damage & kills ────────────────────────────────────────────────────────

  /** Applies damage; returns true if it killed. */
  applyDamage(victim: SimPlayer, attacker: SimPlayer | null, amount: number, cause: KillCause, head: boolean, from: Vec3): boolean {
    if (!victim.alive || amount <= 0) return false;
    if (victim.cheats?.god) return false; // admin god mode
    if (this.phase !== 'live') return false;
    if (victim.protectedT > 0) return false;
    if (this.config.mode === 'range') return false;
    victim.health -= amount;
    victim.lastDamageTick = this.tick;
    victim.lastDamageFrom.x = from.x;
    victim.lastDamageFrom.y = from.y;
    victim.lastDamageFrom.z = from.z;
    const selfHarm = !attacker || attacker === victim;
    if (!selfHarm && attacker) {
      victim.lastAttacker = attacker.ident.id;
      victim.lastAttackerTick = this.tick;
      attacker.stats.damage += victim.health < 0 ? amount + victim.health : amount;
      const log = victim.damageLog.find((d) => d.id === attacker.ident.id);
      if (log) {
        log.dmg += amount;
        log.tick = this.tick;
      } else victim.damageLog.push({ id: attacker.ident.id, dmg: amount, tick: this.tick });
    }
    const kill = victim.health <= 0;
    const vid = victim.ident.id;
    this.emit({ t: 'dmg', v: vid, from, dmg: Math.round(amount), hp: Math.max(0, Math.ceil(victim.health)) }, vid);
    if (!selfHarm && attacker) {
      this.emit({ t: 'hit', p: attacker.ident.id, v: vid, dmg: Math.round(amount), head, kill }, attacker.ident.id);
    }
    if (kill) this.kill(victim, selfHarm ? null : attacker, cause, head);
    return kill;
  }

  private kill(victim: SimPlayer, killer: SimPlayer | null, cause: KillCause, head: boolean): void {
    victim.alive = false;
    victim.health = 0;
    victim.respawnT = RESPAWN_TIME;
    victim.stats.deaths++;
    victim.streak = 0;
    victim.move.vel.x = 0;
    victim.move.vel.y = 0;
    victim.move.vel.z = 0;
    victim.move.mantleT = 0;
    victim.move.slideT = 0;
    this.recentDeaths.push({ pos: { x: victim.move.pos.x, y: victim.move.pos.y, z: victim.move.pos.z }, tick: this.tick });
    if (this.recentDeaths.length > 24) this.recentDeaths.shift();

    // Falls shortly after taking damage credit the last attacker.
    if (!killer && cause === 'fall' && victim.lastAttacker >= 0 && this.tick - victim.lastAttackerTick <= FALL_CREDIT_WINDOW * SIM_HZ) {
      killer = this.player(victim.lastAttacker) ?? null;
    }

    let assistId = -1;
    let bestAssist = 0;
    for (const d of victim.damageLog) {
      if (killer && d.id === killer.ident.id) continue;
      if (this.tick - d.tick > ASSIST_WINDOW * SIM_HZ) continue;
      const a = this.player(d.id);
      if (!a || !this.isEnemy(a, victim)) continue;
      a.stats.assists++;
      a.stats.score += SCORE_ASSIST;
      if (d.dmg > bestAssist) {
        bestAssist = d.dmg;
        assistId = d.id;
      }
    }
    victim.damageLog.length = 0;

    let streak = 0;
    if (killer && killer !== victim) {
      killer.stats.kills++;
      killer.streak++;
      streak = killer.streak;
      killer.stats.bestStreak = Math.max(killer.stats.bestStreak, killer.streak);
      killer.stats.score += SCORE_KILL + (head ? SCORE_HEADSHOT : 0);
      if (head) killer.stats.headshots++;
      if (this.config.mode === 'tdm' && (killer.ident.team === 0 || killer.ident.team === 1)) this.teamScores[killer.ident.team] += 1;
      const kid = killer.ident.id;
      killer.multiKills = this.tick - killer.lastKillTick <= MULTI_KILL_WINDOW * SIM_HZ ? killer.multiKills + 1 : 1;
      killer.lastKillTick = this.tick;
      if (killer.multiKills === 2) this.emit({ t: 'announce', key: 'double_elim' }, kid);
      else if (killer.multiKills === 3) this.emit({ t: 'announce', key: 'triple_elim' }, kid);
      if (killer.streak === 5) this.emit({ t: 'announce', key: 'streak_5' }, kid);
      if (!this.firstBlood) {
        this.firstBlood = true;
        this.emit({ t: 'announce', key: 'first_blood' });
      }
    }
    this.emit({ t: 'kill', k: killer ? killer.ident.id : -1, v: victim.ident.id, w: cause, head, assist: assistId, streak });
  }

  // ── Throwables ────────────────────────────────────────────────────────────

  private spawnThrowable(p: SimPlayer, cmd: InputCmd): void {
    const kind = p.ident.loadout.throwable;
    const aim = aimAngles(cmd, p.combat);
    const dir = forwardFromAngles(aim.yaw, aim.pitch);
    const eye = eyePosition(p.move);
    // Start slightly in front of the eye unless that is inside a wall.
    const clear = this.world.rayDist(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 0.6, 'bullet');
    const off = clear === Infinity ? 0.45 : Math.max(0, clear - 0.15);
    const origin = { x: eye.x + dir.x * off, y: eye.y + dir.y * off - 0.1, z: eye.z + dir.z * off };
    const vel = {
      x: dir.x * THROW_SPEED + p.move.vel.x * 0.35,
      y: dir.y * THROW_SPEED + THROW_UP + p.move.vel.y * 0.2,
      z: dir.z * THROW_SPEED + p.move.vel.z * 0.35,
    };
    const pr = this.throwables.spawn(p.ident.id, p.ident.team, kind, origin, vel, this.tick);
    this.emit({ t: 'throw', p: p.ident.id, kind, id: pr.id });
  }

  private explode(pr: Projectile): void {
    const owner = this.player(pr.owner) ?? null;
    const ox = pr.pos.x;
    const oy = pr.pos.y + 0.15;
    const oz = pr.pos.z;
    this.noises.push({ x: ox, y: oy, z: oz, tick: this.tick, id: pr.owner, team: pr.team, radius: 50 });
    const from = { x: q2(pr.pos.x), y: q2(pr.pos.y), z: q2(pr.pos.z) };
    for (const v of this.players) {
      if (!v.alive) continue;
      const isOwner = v.ident.id === pr.owner;
      if (!isOwner && !this.ffa && v.ident.team === pr.team) continue; // friendly fire off
      const h = playerHeight(v.move);
      const cy = v.move.pos.y + h * 0.55;
      const dx = v.move.pos.x - ox;
      const dy = cy - oy;
      const dz = v.move.pos.z - oz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > GRENADE_RADIUS) continue;
      const vis =
        this.world.segmentClear(ox, oy, oz, v.move.pos.x, cy, v.move.pos.z, 'bullet') ||
        this.world.segmentClear(ox, oy, oz, v.move.pos.x, v.move.pos.y + h - 0.15, v.move.pos.z, 'bullet');
      if (!vis) continue;
      let dmg = lerp(GRENADE_DAMAGE, GRENADE_MIN_DAMAGE, clamp(d / GRENADE_RADIUS, 0, 1));
      if (isOwner) dmg *= 0.5;
      this.applyDamage(v, isOwner ? null : owner, dmg, 'grenade', false, from);
    }
    if (this.range && owner) {
      for (const t of this.range.targets) {
        if (!t.alive) continue;
        const dx = t.pos.x - ox;
        const dy = t.pos.y + 1 - oy;
        const dz = t.pos.z - oz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > GRENADE_RADIUS) continue;
        const dmg = lerp(GRENADE_DAMAGE, GRENADE_MIN_DAMAGE, clamp(d / GRENADE_RADIUS, 0, 1));
        const kill = this.range.damage(t, dmg, this.tick);
        this.emit({ t: 'target', id: t.id, head: false, kill, dmg: Math.round(dmg), dist: t.def.distance, w: 'grenade' }, owner.ident.id);
      }
    }
  }

  // ── Pickups, falls, zones, life ───────────────────────────────────────────

  private stepFalls(): void {
    for (const p of this.players) {
      if (!p.alive || p.move.pos.y >= this.map.killY) continue;
      if (this.config.mode === 'range' || this.phase !== 'live' || p.cheats?.god) {
        // (Admin god mode: falling off the map just puts you back at a spawn.)
        this.spawnPlayer(p);
        continue;
      }
      p.health = 0;
      p.lastDamageTick = this.tick;
      this.emit({ t: 'dmg', v: p.ident.id, from: { x: q2(p.move.pos.x), y: q2(p.move.pos.y), z: q2(p.move.pos.z) }, dmg: 100, hp: 0 }, p.ident.id);
      this.kill(p, null, 'fall', false);
    }
  }

  private readonly occupants: ZoneOccupant[] = [];

  private stepZones(): void {
    const zs = this.zones;
    if (!zs) return;
    const occ = this.occupants;
    occ.length = 0;
    for (const p of this.players) {
      if (!p.alive) continue;
      const t = p.ident.team;
      occ.push({ id: p.ident.id, team: t === 1 ? 1 : 0, pos: p.move.pos });
    }
    zs.step(
      SIM_DT,
      occ,
      (ev) => this.emit(ev),
      (_z, _team, ids) => {
        for (const id of ids) {
          const p = this.player(id);
          if (!p) continue;
          p.stats.captures++;
          p.stats.score += SCORE_CAPTURE;
        }
      },
      (id, dt) => {
        const p = this.player(id);
        if (!p) return;
        p.stats.objectiveTime += dt;
        p.objectiveScoreFrac += dt * SCORE_OBJECTIVE_PER_SEC;
        if (p.objectiveScoreFrac >= 1) {
          const whole = Math.floor(p.objectiveScoreFrac);
          p.stats.score += whole;
          p.objectiveScoreFrac -= whole;
        }
      },
    );
    if (this.config.mode === 'control' && this.phase === 'live') {
      for (const z of zs.zones) if (z.owner === 0 || z.owner === 1) this.teamScores[z.owner] += ZONE_POINTS_PER_SEC * SIM_DT;
      if (!this.launchReadySent && this.config.scoreLimit > 0) {
        const lead = Math.max(this.teamScores[0], this.teamScores[1]);
        if (lead >= this.config.scoreLimit * 0.85 || (this.timeLeft() <= 30 && lead > 0)) {
          this.launchReadySent = true;
          this.emit({ t: 'announce', key: 'launch_ready' });
        }
      }
    }
  }

  private stepLife(): void {
    const canSpawn = this.phase === 'countdown' || this.phase === 'live';
    for (const p of this.players) {
      if (!p.alive) {
        if (!canSpawn) continue;
        p.respawnT -= SIM_DT;
        if (p.respawnT <= 0) this.spawnPlayer(p);
        continue;
      }
      if (p.protectedT > 0) p.protectedT = Math.max(0, p.protectedT - SIM_DT);
      if (p.health < MAX_HEALTH && (this.tick - p.lastDamageTick) * SIM_DT >= REGEN_DELAY) {
        p.health = Math.min(MAX_HEALTH, p.health + REGEN_RATE * SIM_DT);
      }
    }
  }

  private spawnActors(exclude: SimPlayer): SpawnActor[] {
    const out: SpawnActor[] = [];
    for (const p of this.players) if (p !== exclude && p.alive) out.push({ id: p.ident.id, team: p.ident.team, pos: p.move.pos });
    return out;
  }

  private spawnPlayer(p: SimPlayer): void {
    const sp = pickSpawn(
      { map: this.map, world: this.world, living: this.spawnActors(p), recentDeaths: this.recentDeaths, tick: this.tick, tickRate: SIM_HZ, rng: this.rng },
      p.ident.team,
      this.ffa,
      p.ident.id,
    );
    this.applyPendingLoadout(p, false);
    p.move = createMoveState(sp.pos);
    p.combat = createCombatState(p.ident.loadout);
    this.syncCheats(p);
    p.health = MAX_HEALTH;
    p.alive = true;
    p.respawnT = 0;
    p.protectedT = this.config.mode === 'range' ? 0 : SPAWN_PROTECTION;
    p.damageLog.length = 0;
    p.lastDamageTick = -100000;
    p.spawnTick = this.tick;
    p.lastCmd = { ...p.lastCmd, yaw: sp.yaw, pitch: 0, buttons: 0, mx: 0, mz: 0 };
    p.bot?.onSpawn();
    this.emit({ t: 'spawn', p: p.ident.id, pos: { x: sp.pos.x, y: sp.pos.y, z: sp.pos.z }, yaw: sp.yaw });
  }

  private refillRangeAmmo(): void {
    for (const p of this.players) {
      for (const s of p.combat.slots) {
        if (!s) continue;
        const w = WEAPONS[s.id];
        if (s.reserve < w.reserve) s.reserve = w.reserve;
      }
      p.combat.throwables = Math.max(p.combat.throwables, 1);
    }
  }

  // ── Match end ─────────────────────────────────────────────────────────────

  private checkEnd(): void {
    if (this.config.mode === 'range') return;
    const timeUp = this.config.timeLimit > 0 && this.liveTicks >= this.config.timeLimit * SIM_HZ;
    let scoreReached = false;
    if (this.config.scoreLimit > 0) {
      if (this.config.mode === 'ffa') scoreReached = this.players.some((p) => p.stats.kills >= this.config.scoreLimit);
      else scoreReached = Math.max(this.teamScores[0], this.teamScores[1]) >= this.config.scoreLimit;
    }
    if (timeUp || scoreReached) this.endMatch();
  }

  /** Ends the match now (also used by hosts for forced ends). `forced` overrides the winner (admin). */
  endMatch(forced?: { winner: Team; winnerPlayer: number; draw: boolean }): void {
    if (this.phase === 'ended') return;
    this.endResult = forced ?? this.computeWinner();
    this.setPhase('ended');
    const r = this.endResult;
    for (const p of this.players) {
      if (p.ident.isBot) continue;
      let key: 'victory' | 'defeat' | 'draw';
      if (r.draw) key = 'draw';
      else if (this.config.mode === 'ffa') key = r.winnerPlayer === p.ident.id ? 'victory' : 'defeat';
      else key = r.winner === p.ident.team ? 'victory' : 'defeat';
      this.emit({ t: 'announce', key }, p.ident.id);
    }
  }

  private computeWinner(): { winner: Team; winnerPlayer: number; draw: boolean } {
    if (this.config.mode === 'ffa') {
      const sorted = [...this.players].sort((a, b) => b.stats.kills - a.stats.kills || b.stats.score - a.stats.score);
      if (sorted.length === 0) return { winner: TEAM_NONE, winnerPlayer: -1, draw: true };
      const top = sorted[0];
      const tie = sorted.length > 1 && sorted[1].stats.kills === top.stats.kills && sorted[1].stats.score === top.stats.score;
      return { winner: TEAM_NONE, winnerPlayer: tie ? -1 : top.ident.id, draw: tie };
    }
    const s0 = Math.floor(this.teamScores[0]);
    const s1 = Math.floor(this.teamScores[1]);
    if (s0 === s1) return { winner: TEAM_NONE, winnerPlayer: -1, draw: true };
    return { winner: s0 > s1 ? 0 : 1, winnerPlayer: -1, draw: false };
  }

  // ── Admin cheats (the host checks authorization; see protocol AdminMsg) ──

  /** Mirrors a player's ammo/speed/weapon cheats into the predicted combat state (after every re-equip). */
  private syncCheats(p: SimPlayer): void {
    const ch = p.cheats;
    if (ch?.ammo) p.combat.cheatAmmo = true;
    else delete p.combat.cheatAmmo;
    if (ch && ch.speed > 1) p.combat.cheatSpeed = ch.speed;
    else delete p.combat.cheatSpeed;
    if (ch?.norecoil) {
      p.combat.cheatNoRecoil = true;
      p.combat.recoilPitch = p.combat.recoilYaw = 0;
    } else delete p.combat.cheatNoRecoil;
    if (ch?.nospread) p.combat.cheatNoSpread = true;
    else delete p.combat.cheatNoSpread;
    if (ch?.rapid) p.combat.cheatRapid = true;
    else delete p.combat.cheatRapid;
  }

  /** Updates a player's cheats; returns the new set (null if no such player). */
  setCheats(id: number, patch: Partial<PlayerCheats>): PlayerCheats | null {
    const p = this.player(id);
    if (!p) return null;
    const cur: PlayerCheats = p.cheats ?? { god: false, ammo: false, speed: 1 };
    const next: PlayerCheats = {
      god: patch.god ?? cur.god,
      ammo: patch.ammo ?? cur.ammo,
      speed: patch.speed !== undefined && Number.isFinite(patch.speed) ? clamp(Math.round(patch.speed * 100) / 100, 1, 3) : cur.speed,
    };
    // Weapon cheats: only present when on, so ordinary cheat sets stay { god, ammo, speed }.
    if (patch.norecoil ?? cur.norecoil) next.norecoil = true;
    if (patch.nospread ?? cur.nospread) next.nospread = true;
    if (patch.rapid ?? cur.rapid) next.rapid = true;
    if (next.god || next.ammo || next.speed > 1 || next.norecoil || next.nospread || next.rapid) p.cheats = next;
    else delete p.cheats;
    this.syncCheats(p);
    return next;
  }

  /** Puts a fresh Sunspear in the player's pickup slot (alive only). */
  adminGiveSunspear(id: number): boolean {
    const p = this.player(id);
    if (!p || !p.alive) return false;
    giveSunspear(p.combat);
    return true;
  }

  /** Eliminates every living enemy bot of `forId` (cause 'world': nobody is credited). Returns the count. */
  adminKillBots(forId: number): number {
    const me = this.player(forId);
    if (!me) return 0;
    let n = 0;
    for (const p of this.players) {
      if (!p.alive || !p.ident.isBot || !this.isEnemy(me, p)) continue;
      p.damageLog.length = 0; // no assists either
      p.lastAttacker = -1;
      this.kill(p, null, 'world', false);
      n++;
    }
    return n;
  }

  /** Moves a living player to a zone centre or one of their team's spawns. */
  adminTeleport(id: number, where: ZoneId | 'spawn'): boolean {
    const p = this.player(id);
    if (!p || !p.alive) return false;
    let pos: Vec3;
    if (where === 'spawn') {
      const sp = pickSpawn(
        { map: this.map, world: this.world, living: this.spawnActors(p), recentDeaths: this.recentDeaths, tick: this.tick, tickRate: SIM_HZ, rng: this.rng },
        p.ident.team,
        this.ffa,
        p.ident.id,
      );
      pos = { x: sp.pos.x, y: sp.pos.y, z: sp.pos.z };
    } else {
      const z = this.map.zones.find((zz) => zz.id === where);
      if (!z) return false;
      const g = this.world.groundAt(z.center.x, z.center.z, z.center.y + 2, 6);
      pos = { x: z.center.x, y: (g ? g.y : z.center.y) + 0.02, z: z.center.z };
    }
    p.move = createMoveState(pos);
    return true;
  }

  /** Ends the match now; with `favor` that player's team (FFA: that player) wins. */
  adminEndMatch(favor: number | null): boolean {
    if (this.phase === 'ended' || this.config.mode === 'range') return false;
    const p = favor !== null ? this.player(favor) : undefined;
    if (!p) {
      this.endMatch();
      return true;
    }
    if (this.config.mode === 'ffa') {
      this.endMatch({ winner: TEAM_NONE, winnerPlayer: p.ident.id, draw: false });
      return true;
    }
    const t = p.ident.team === 1 ? 1 : 0;
    // Keep the scoreboard consistent with the declared winner.
    this.teamScores[t] = Math.max(Math.floor(this.teamScores[t]), Math.floor(this.teamScores[1 - t]) + 1);
    this.endMatch({ winner: t, winnerPlayer: -1, draw: false });
    return true;
  }

  // ── Views ─────────────────────────────────────────────────────────────────

  clock(): MatchClock {
    let phaseLeft = 0;
    if (this.phase === 'countdown') phaseLeft = Math.max(0, this.config.countdown - this.phaseTicks * SIM_DT);
    else if (this.phase === 'live') phaseLeft = this.config.timeLimit > 0 ? this.timeLeft() : 0;
    else if (this.phase === 'ended') phaseLeft = Math.max(0, MATCH_OUTRO - this.phaseTicks * SIM_DT);
    return {
      phase: this.phase,
      phaseLeft: Math.round(phaseLeft * 100) / 100,
      elapsed: Math.round(this.liveTicks * SIM_DT * 100) / 100,
      teamScores: [Math.floor(this.teamScores[0]), Math.floor(this.teamScores[1])],
    };
  }

  /** Snapshot for one receiver (self state included when forId is a player). */
  buildSnapshot(forId: number | null): Omit<SnapshotMsg, 'type' | 'events'> {
    if (!this.snapCache || this.snapCache.tick !== this.tick) {
      this.snapCache = {
        tick: this.tick,
        snap: {
          tick: this.tick,
          clock: this.clock(),
          players: this.players.map((p) => playerSnap(p)),
          projectiles: this.throwables.projectileSnaps(),
          smokes: this.throwables.smokeSnaps(),
          zones: this.zones ? this.zones.snaps() : [],
          pickups: this.pickups.snaps(),
          targets: this.range ? this.range.snaps() : [],
        },
      };
    }
    const shared = this.snapCache.snap;
    const p = forId !== null ? this.player(forId) : undefined;
    if (!p) return { ...shared };
    return {
      ...shared,
      self: {
        ack: p.ackSeq,
        move: cloneMoveState(p.move),
        combat: cloneCombatState(p.combat),
        health: Math.max(0, Math.ceil(p.health)),
        alive: p.alive,
        respawnIn: p.alive ? 0 : Math.max(0, Math.round(p.respawnT * 100) / 100),
        protectedT: Math.round(p.protectedT * 100) / 100,
      },
    };
  }

  scoreboard(): ScoreboardRow[] {
    return scoreboardRows(this.players);
  }

  results(): MatchResults {
    return buildResults(this.config, this.players, this.endResult ?? this.computeWinner(), this.teamScores, this.liveTicks);
  }

  /** Eye position of a player (helper for bots / host). */
  eyeOf(p: SimPlayer, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    out.x = p.move.pos.x;
    out.y = p.move.pos.y + eyeHeight(p.move);
    out.z = p.move.pos.z;
    return out;
  }

  /** Samples a player's lag-compensation history (bots use it to perceive with a delay). */
  sampleHistory(id: number, tick: number, out: RewoundState): boolean {
    return this.history.sample(id, tick, out);
  }
}
