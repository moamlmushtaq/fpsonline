// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — host-side player state and small simulation helpers shared by
// GameSim, its views (snapshots/results) and bots: SimPlayer, input sanitizing,
// the per-map collision-world cache, score values.
// ─────────────────────────────────────────────────────────────────────────────

import { MAX_HEALTH, PITCH_LIMIT } from '../constants';
import { createCombatState } from '../combat';
import type { MapDef } from '../maps/types';
import { clamp, wrapAngle } from '../math';
import { createMoveState } from '../movement';
import { CollisionWorld } from '../physics';
import type {
  CombatState,
  GameEvent,
  InputCmd,
  Loadout,
  MoveState,
  PlayerIdentity,
  PlayerMatchStats,
  PrimaryWeaponId,
  Team,
  Vec3,
} from '../types';
import type { BotController } from './bots';

export interface DamageEntry {
  id: number;
  dmg: number;
  tick: number;
}

/** Full host-side state of one player. */
export interface SimPlayer {
  ident: PlayerIdentity;
  move: MoveState;
  combat: CombatState;
  health: number;
  alive: boolean;
  /** Seconds until respawn while dead. */
  respawnT: number;
  protectedT: number;
  lastDamageTick: number;
  /** Last attacker id and tick (for bots' threat awareness and fall-kill credit). */
  lastAttacker: number;
  lastAttackerTick: number;
  lastDamageFrom: Vec3;
  damageLog: DamageEntry[];
  stats: PlayerMatchStats;
  objectiveScoreFrac: number;
  streak: number;
  multiKills: number;
  lastKillTick: number;
  queue: InputCmd[];
  lastQueuedSeq: number;
  /** Last InputCmd.seq applied (SelfSnap.ack). */
  ackSeq: number;
  /** Last applied command (view angles for snapshots / throws). */
  lastCmd: InputCmd;
  starve: number;
  pendingLoadout: Loadout | null;
  bot: BotController | null;
  spawnTick: number;
  /** Admin cheats (absent unless an authorized admin turned one on). Survive respawns. */
  cheats?: PlayerCheats;
}

/** Per-player admin cheats. ammo/speed are mirrored into CombatState (predicted); god is host-only. */
export interface PlayerCheats {
  god: boolean;
  ammo: boolean;
  speed: number;
}

export interface Noise {
  x: number;
  y: number;
  z: number;
  tick: number;
  id: number;
  team: Team;
  /** Audible radius (m). */
  radius: number;
}

export interface RoutedEvent {
  ev: GameEvent;
  to?: number;
  except?: number;
}

/** Score values (MVP = highest score). */
export const SCORE_KILL = 100;
export const SCORE_ASSIST = 50;
export const SCORE_CAPTURE = 150;
export const SCORE_OBJECTIVE_PER_SEC = 5;
export const SCORE_HEADSHOT = 20;

const worldCache = new WeakMap<MapDef, CollisionWorld>();

/** Shared (cached) collision world for a map definition. Worlds are immutable. */
export function worldForMap(map: MapDef): CollisionWorld {
  let w = worldCache.get(map);
  if (!w) {
    w = new CollisionWorld(map.solids, map.bounds, { waterY: map.waterY });
    worldCache.set(map, w);
  }
  return w;
}

/** Validates/clamps a network InputCmd. Returns null if unusable. */
export function sanitizeCmd(raw: unknown): InputCmd | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const seq = Number(c.seq);
  if (!Number.isInteger(seq) || seq < 1 || seq > 0x7fffffff) return null;
  const num = (v: unknown, d = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const slot = num(c.slot) | 0;
  return {
    seq,
    mx: clamp(num(c.mx), -1, 1),
    mz: clamp(num(c.mz), -1, 1),
    yaw: wrapAngle(num(c.yaw)),
    pitch: clamp(num(c.pitch), -PITCH_LIMIT, PITCH_LIMIT),
    buttons: (num(c.buttons) | 0) & 0xff,
    slot: slot >= 0 && slot <= 2 ? slot : 0,
    viewTick: num(c.viewTick),
  };
}

export function emptyStats(): PlayerMatchStats {
  return { kills: 0, deaths: 0, assists: 0, damage: 0, shots: 0, hits: 0, headshots: 0, objectiveTime: 0, captures: 0, score: 0, bestStreak: 0 };
}

/** Fresh (not yet spawned) host state for a player. */
export function createSimPlayer(ident: PlayerIdentity, at: Vec3): SimPlayer {
  return {
    ident,
    move: createMoveState(at),
    combat: createCombatState(ident.loadout),
    health: MAX_HEALTH,
    alive: false,
    respawnT: 0,
    protectedT: 0,
    lastDamageTick: -100000,
    lastAttacker: -1,
    lastAttackerTick: -100000,
    lastDamageFrom: { x: 0, y: 0, z: 0 },
    damageLog: [],
    stats: emptyStats(),
    objectiveScoreFrac: 0,
    streak: 0,
    multiKills: 0,
    lastKillTick: -100000,
    queue: [],
    lastQueuedSeq: 0,
    ackSeq: 0,
    lastCmd: { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0, viewTick: 0 },
    starve: 0,
    pendingLoadout: null,
    bot: null,
    spawnTick: 0,
  };
}

/** Bot primary weapon mix: mostly all-rounders, fewer marksmen (a lobby of snipers is no fun). */
export function pickBotPrimary(r: number): PrimaryWeaponId {
  if (r < 0.4) return 'meridian';
  if (r < 0.66) return 'swift';
  if (r < 0.84) return 'breaker';
  return 'longline';
}
