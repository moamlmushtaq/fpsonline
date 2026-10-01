// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — core shared types.
//
// This file is part of the architecture contract (see ARCHITECTURE.md). It is
// imported by the browser client, the in-browser local host (Web Worker) and the
// Node server. It must never import DOM, Node or three.js APIs.
//
// Coordinate system (matches three.js): +Y up, player `pos` = FEET position.
// yaw = rotation about +Y in radians; yaw 0 looks toward -Z; positive yaw turns
// LEFT (counter-clockwise seen from above), exactly like `object.rotation.y`.
// pitch = radians, positive looks UP, clamped to ±PITCH_LIMIT.
// Forward vector for (yaw, pitch):
//   x = -sin(yaw) * cos(pitch),  y = sin(pitch),  z = -cos(yaw) * cos(pitch)
// ─────────────────────────────────────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 0 = HALCYON (ceramic white + warm orange), 1 = THE BLOOM (teal + violet), 2 = no team (FFA / training). */
export type Team = 0 | 1 | 2;
export const TEAM_HALCYON = 0 as const;
export const TEAM_BLOOM = 1 as const;
export const TEAM_NONE = 2 as const;

/** Visual faction of a character (armor set + elimination style). In team modes faction === team. */
export type Faction = 0 | 1;

export type ModeId = 'tdm' | 'control' | 'ffa' | 'range';
export type MapId = 'gantry' | 'pastel' | 'observatory' | 'range';
export type WeaponId = 'meridian' | 'swift' | 'longline' | 'breaker' | 'pulse' | 'sunspear';
export type PrimaryWeaponId = 'meridian' | 'swift' | 'longline' | 'breaker';
export type ThrowableId = 'smoke' | 'grenade';
export type BotDifficulty = 'recruit' | 'veteran' | 'elite';
export type Platform = 'desktop' | 'mobile' | 'tablet';
export type InputDevice = 'kbm' | 'touch' | 'gamepad';
export type Lang = 'en' | 'ar';
export type ZoneId = 'A' | 'B' | 'C';

/** Material/surface of world geometry. Drives impact FX, footstep sounds and default map materials. */
export type SurfaceTag =
  | 'concrete'
  | 'metal'
  | 'ceramic'
  | 'wood'
  | 'plaster'
  | 'tile'
  | 'glass'
  | 'grass'
  | 'dirt'
  | 'sand'
  | 'rock'
  | 'snow'
  | 'water'
  | 'foliage'
  | 'fabric';

export const WEAPON_IDS: readonly WeaponId[] = ['meridian', 'swift', 'longline', 'breaker', 'pulse', 'sunspear'];
export const PRIMARY_WEAPON_IDS: readonly PrimaryWeaponId[] = ['meridian', 'swift', 'longline', 'breaker'];
export const MAP_IDS: readonly MapId[] = ['gantry', 'pastel', 'observatory', 'range'];
export const PVP_MAP_IDS: readonly MapId[] = ['gantry', 'pastel', 'observatory'];
export const MODE_IDS: readonly ModeId[] = ['tdm', 'control', 'ffa', 'range'];

// ── Player identity / loadout / cosmetics ───────────────────────────────────

/** Each player carries one primary, the "Pulse" sidearm (always), and one throwable per life. */
export interface Loadout {
  primary: PrimaryWeaponId;
  throwable: ThrowableId;
}

/** Cosmetic choices. All ids reference src/shared/cosmetics.ts. Cosmetics never change gameplay. */
export interface CosmeticSelection {
  /** Armor tint id (secondary armor color). Team accent color always stays readable. */
  armor: string;
  /** Visor style id (shape of the emissive visor line). */
  visor: string;
  /** Name card id (banner shown on scoreboard / kill cam / profile). */
  namecard: string;
  /** Elimination effect id; 'default' = faction dissolve (petals for Bloom, ceramic shards for Halcyon). */
  elimFx: string;
  /** Weapon skin id per weapon; missing = 'factory'. */
  skins: Partial<Record<WeaponId, string>>;
}

export interface PlayerIdentity {
  id: number;
  name: string;
  isBot: boolean;
  team: Team;
  faction: Faction;
  loadout: Loadout;
  cosmetics: CosmeticSelection;
  level: number;
  platform: Platform;
  botDifficulty?: BotDifficulty;
}

// ── Input ───────────────────────────────────────────────────────────────────

export const BTN_JUMP = 1 << 0;
export const BTN_CROUCH = 1 << 1; // held state (client converts toggle-crouch into held state)
export const BTN_SPRINT = 1 << 2; // held state (client converts toggle/auto-sprint into held state)
export const BTN_FIRE = 1 << 3;
export const BTN_ADS = 1 << 4;
export const BTN_RELOAD = 1 << 5;
export const BTN_THROW = 1 << 6;
export const BTN_INTERACT = 1 << 7;

/**
 * One fixed simulation step (SIM_DT) of player intent. Produced by the client at
 * SIM_HZ, by bots on the host. Server applies commands in `seq` order.
 */
export interface InputCmd {
  /** Monotonically increasing per player, starts at 1. */
  seq: number;
  /** Strafe axis -1..1 (+ = right). */
  mx: number;
  /** Forward axis -1..1 (+ = forward). */
  mz: number;
  /** View yaw (radians), see coordinate notes at top of file. Recoil is NOT included (the sim adds it). */
  yaw: number;
  /** View pitch (radians). */
  pitch: number;
  /** Bitmask of BTN_* flags (held state). */
  buttons: number;
  /** Desired weapon slot: 0 = primary, 1 = sidearm, 2 = pickup (Sunspear). Ignored if slot empty. */
  slot: number;
  /** Server tick (may be fractional) the client was displaying remote players at. Used for lag compensation. */
  viewTick: number;
}

// ── Simulation state ────────────────────────────────────────────────────────

/** Movement state. Fully deterministic given (state, InputCmd, CollisionWorld). Predicted on the client. */
export interface MoveState {
  pos: Vec3;
  vel: Vec3;
  onGround: boolean;
  /** True while crouched (or forced crouched by low ceiling). */
  crouch: boolean;
  /** Smoothed crouch amount 0..1 (drives eye height & hitbox height). */
  crouchT: number;
  sprint: boolean;
  /** Remaining slide time in seconds; > 0 means sliding. */
  slideT: number;
  slideCooldown: number;
  /** Remaining mantle time in seconds; > 0 means mantling (position is scripted from mantleFrom → mantleTo). */
  mantleT: number;
  mantleFrom: Vec3;
  mantleTo: Vec3;
  /** Previous-tick held buttons (for edge detection inside the deterministic sim). */
  prevButtons: number;
  /** Seconds since leaving the ground (coyote time / fall damage-free landing effects). */
  airTime: number;
  /** Set to the downward speed on the tick the player lands, else 0. Clients use it for landing dip / sounds. */
  landImpact: number;
  /** Surface currently stood on (for footsteps). */
  ground: SurfaceTag;
  /** Accumulates distance travelled on ground; clients emit a footstep each time it crosses a stride length. */
  stride: number;
}

export interface WeaponSlotState {
  id: WeaponId;
  /** Rounds in magazine (for Sunspear: charges remaining). */
  mag: number;
  /** Reserve rounds. */
  reserve: number;
}

/** Combat state. Deterministic (spread uses a seeded hash of playerId + seq). Predicted on the client. */
export interface CombatState {
  /** [primary, sidearm, pickup]. Pickup slot is null unless a Sunspear was picked up. */
  slots: [WeaponSlotState, WeaponSlotState, WeaponSlotState | null];
  active: number;
  /** Remaining weapon-swap time (s). Cannot fire while > 0. */
  swapT: number;
  /** Remaining reload time (s); > 0 while reloading. */
  reloadT: number;
  /** Seconds until the next shot may fire. */
  fireCd: number;
  /** Shots fired in the current spray (indexes the recoil pattern). Decays when not firing. */
  recoilIdx: number;
  /** Current recoil offsets (radians) added to view angles for aim; recover toward 0 over time. */
  recoilPitch: number;
  recoilYaw: number;
  /** Extra spread (radians) from sustained fire. */
  bloom: number;
  /** Aim-down-sights amount 0..1. */
  adsT: number;
  /** Sunspear charge progress (s). */
  chargeT: number;
  /** Remaining pump/bolt cycle time (s) for Breaker/Longline (visual + gating). */
  cycleT: number;
  /** Throwables remaining this life. */
  throwables: number;
  throwCd: number;
  /** FIRE was held on the previous tick (semi-auto edge detection). */
  fireHeld: boolean;
  /**
   * Admin cheats (absent for everyone else). They live HERE — in the predicted,
   * snapshotted combat state — so client prediction replays them exactly.
   * cheatAmmo: magazines stay full (no reloads). cheatSpeed: movement multiplier 1..3.
   */
  cheatAmmo?: boolean;
  cheatSpeed?: number;
}

export interface PlayerMatchStats {
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  shots: number;
  hits: number;
  headshots: number;
  /** Seconds spent inside a zone that your team owns or is capturing (Launch Control). */
  objectiveTime: number;
  captures: number;
  score: number;
  bestStreak: number;
}

// ── Snapshots (host → client) ───────────────────────────────────────────────

export const PF_ALIVE = 1 << 0;
export const PF_CROUCH = 1 << 1;
export const PF_SLIDE = 1 << 2;
export const PF_SPRINT = 1 << 3;
export const PF_ADS = 1 << 4;
export const PF_RELOAD = 1 << 5;
export const PF_AIR = 1 << 6;
export const PF_MANTLE = 1 << 7;
export const PF_PROTECTED = 1 << 8; // spawn protection
export const PF_CHARGING = 1 << 9; // Sunspear charging
export const PF_SWAP = 1 << 10;

/** Compact per-player state for rendering remote players (quantized: positions 0.01, angles 0.001). */
export interface PlayerSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  /** PF_* flags. */
  f: number;
  /** Index into WEAPON_IDS of the active weapon. */
  w: number;
  /** Health 0..100 (rounded). */
  hp: number;
  /** crouchT quantized 0..100. */
  c: number;
}

/** Authoritative state of the receiving player, used for prediction reconciliation. */
export interface SelfSnap {
  /** Last InputCmd.seq the host applied for this player. */
  ack: number;
  move: MoveState;
  combat: CombatState;
  health: number;
  alive: boolean;
  /** Seconds until respawn (0 when alive). */
  respawnIn: number;
  /** Remaining spawn protection seconds. */
  protectedT: number;
}

export interface ProjectileSnap {
  id: number;
  kind: ThrowableId;
  owner: number;
  x: number;
  y: number;
  z: number;
}

export interface SmokeSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Current radius (grows then holds). */
  r: number;
  /** Seconds remaining. */
  t: number;
}

export interface ZoneSnap {
  id: ZoneId;
  /** Team that owns the zone (TEAM_NONE = neutral). */
  owner: Team;
  /** Capture progress -1..1: negative = toward Halcyon (0), positive = toward Bloom (1). ±1 = fully owned. */
  progress: number;
  /** Team currently capturing (TEAM_NONE if nobody / contested). */
  capturing: Team;
  contested: boolean;
}

export interface PickupSnap {
  id: string;
  available: boolean;
  /** Seconds until respawn when unavailable. */
  respawnIn: number;
}

export interface TargetSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  alive: boolean;
  /** Health fraction 0..1. */
  hp: number;
}

export type MatchPhase = 'warmup' | 'countdown' | 'live' | 'ended';

export interface MatchClock {
  phase: MatchPhase;
  /** Seconds remaining in the current phase (live: match time left; countdown: seconds to go; ended: outro time left). */
  phaseLeft: number;
  /** Seconds elapsed since the match went live. */
  elapsed: number;
  teamScores: [number, number];
}

// ── Events (host → client), carried inside snapshot messages ────────────────

export interface ShotImpact {
  /** End point of the trace. */
  e: Vec3;
  /** Surface normal at the impact (absent if nothing was hit within range). */
  n?: Vec3;
  /** World surface hit. */
  s?: SurfaceTag;
  /** Player id hit, if any. */
  pl?: number;
  /** Training target id hit, if any. */
  tg?: number;
  head?: boolean;
}

export type KillCause = WeaponId | 'grenade' | 'fall' | 'world';

export type GameEvent =
  /** A weapon fired (not sent to the shooter, who predicts their own shots). */
  | { t: 'shot'; p: number; w: WeaponId; o: Vec3; hits: ShotImpact[] }
  /** Sent only to the attacker: damage they dealt was confirmed. */
  | { t: 'hit'; p: number; v: number; dmg: number; head: boolean; kill: boolean }
  /** Sent only to the victim: damage taken and where it came from. */
  | { t: 'dmg'; v: number; from: Vec3; dmg: number; hp: number }
  | { t: 'kill'; k: number; v: number; w: KillCause; head: boolean; assist: number; streak: number }
  | { t: 'spawn'; p: number; pos: Vec3; yaw: number }
  | { t: 'reload'; p: number; w: WeaponId }
  | { t: 'charge'; p: number }
  | { t: 'swap'; p: number; w: WeaponId }
  | { t: 'throw'; p: number; kind: ThrowableId; id: number }
  | { t: 'explode'; id: number; pos: Vec3 }
  | { t: 'smoke'; id: number; pos: Vec3 }
  | { t: 'bounce'; id: number; pos: Vec3 }
  | { t: 'pickup'; p: number; id: string; w: WeaponId }
  | { t: 'pickupSpawn'; id: string }
  | { t: 'zone'; z: ZoneId; team: Team; ev: 'captured' | 'neutralized' | 'contested' }
  /**
   * Training range hit (sent to the shooter). Additive optional fields:
   * `w` = weapon (or 'grenade') that dealt it, `s` = InputCmd.seq of the shot
   * (lets the client count pellets of one shot as one hit and detect misses).
   */
  | { t: 'target'; id: number; head: boolean; kill: boolean; dmg: number; dist: number; w?: KillCause; s?: number }
  | { t: 'phase'; phase: MatchPhase }
  | { t: 'announce'; key: AnnouncerKey }
  | { t: 'join'; p: PlayerIdentity }
  | { t: 'leave'; p: number }
  | { t: 'teamSwap'; p: number; team: Team };

/**
 * Announcer lines. The host emits the objective-neutral ones; the client derives
 * relative ones (e.g. 'zone_captured' vs 'zone_lost') from zone/kill events.
 */
export type AnnouncerKey =
  | 'match_start'
  | 'final_minute'
  | 'victory'
  | 'defeat'
  | 'draw'
  | 'zone_captured'
  | 'zone_lost'
  | 'zone_contested'
  | 'lead_taken'
  | 'lead_lost'
  | 'launch_ready'
  | 'double_elim'
  | 'triple_elim'
  | 'streak_5'
  | 'first_blood'
  | 'training_complete';

// ── Results ─────────────────────────────────────────────────────────────────

export interface PlayerResult {
  id: number;
  name: string;
  team: Team;
  faction: Faction;
  isBot: boolean;
  level: number;
  namecard: string;
  stats: PlayerMatchStats;
}

export interface MatchResults {
  mode: ModeId;
  map: MapId;
  /** Winning team (TEAM_NONE when FFA or draw). */
  winner: Team;
  /** FFA winner player id, else -1. */
  winnerPlayer: number;
  draw: boolean;
  teamScores: [number, number];
  players: PlayerResult[];
  /** MVP player id. */
  mvp: number;
  /** Seconds of live play. */
  duration: number;
}

export interface GameConfig {
  mode: ModeId;
  map: MapId;
  /** Live match length in seconds. */
  timeLimit: number;
  /** Team (or FFA individual) score to win. 0 = no limit. */
  scoreLimit: number;
  /** Max players including bots (10 for 5v5, 8 FFA, 1 range). */
  maxPlayers: number;
  /** Fill empty slots with bots. */
  botFill: boolean;
  botDifficulty: BotDifficulty;
  /** Seconds of pre-match countdown. */
  countdown: number;
  /** Private room code, if any. */
  roomCode?: string;
  /** Training range tutorial enabled. */
  tutorial?: boolean;
}
