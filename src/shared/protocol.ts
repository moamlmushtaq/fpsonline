// HALCYON FRONT — network protocol (architecture contract, see ARCHITECTURE.md).
//
// The SAME protocol is used for:
//   • online play: browser ⇄ WebSocket ⇄ Node server (src/server) running HostCore
//   • offline play: browser ⇄ postMessage ⇄ Web Worker (src/client/net/local-host.worker.ts) running HostCore
// Messages are plain JSON-serializable objects discriminated by `type`.

import type {
  BotDifficulty,
  CosmeticSelection,
  GameConfig,
  GameEvent,
  InputCmd,
  Lang,
  Loadout,
  MapId,
  MatchClock,
  MatchResults,
  ModeId,
  PickupSnap,
  Platform,
  PlayerIdentity,
  PlayerSnap,
  ProjectileSnap,
  SelfSnap,
  SmokeSnap,
  TargetSnap,
  Team,
  ZoneSnap,
} from './types';

// ── Client → Host ───────────────────────────────────────────────────────────

export interface HelloMsg {
  type: 'hello';
  protocol: number;
  name: string;
  /** Account session token (optional; guests omit). */
  token?: string;
  platform: Platform;
  lang: Lang;
  level: number;
  /** Skill rating used by the matchmaker (guest: stored locally). */
  rating: number;
  loadout: Loadout;
  cosmetics: CosmeticSelection;
  /** Preferred visual faction for FFA / training. */
  faction: 0 | 1;
}

export interface QueueMsg {
  type: 'queue';
  mode: ModeId;
  /** Specific map or 'any'. */
  map: MapId | 'any';
  /** Bot difficulty for bot fill / bot matches. */
  botDifficulty: BotDifficulty;
  /**
   * 'quick'  = matchmaking with humans, fill with bots after QUEUE_BOT_FILL_AFTER seconds.
   * 'bots'   = start immediately, just me + bots.
   * 'solo'   = training range.
   */
  kind: 'quick' | 'bots' | 'solo';
  tutorial?: boolean;
}

export interface CancelQueueMsg {
  type: 'cancelQueue';
}

export interface CreateRoomMsg {
  type: 'createRoom';
  mode: ModeId;
  map: MapId;
  botFill: boolean;
  botDifficulty: BotDifficulty;
}

export interface JoinRoomMsg {
  type: 'joinRoom';
  code: string;
}

/** Host of a private room changes settings in the lobby. */
export interface RoomSettingsMsg {
  type: 'roomSettings';
  mode: ModeId;
  map: MapId;
  botFill: boolean;
  botDifficulty: BotDifficulty;
}

/** Player in a private-room lobby switches team (team modes). */
export interface RoomTeamMsg {
  type: 'roomTeam';
  team: Team;
}

export interface StartRoomMsg {
  type: 'startRoom';
}

export interface LeaveMsg {
  type: 'leave';
}

/** Input commands. Clients send every tick the latest few unacknowledged commands (redundancy). */
export interface InputMsg {
  type: 'input';
  cmds: InputCmd[];
}

/** Change loadout; applied on next respawn. */
export interface LoadoutMsg {
  type: 'loadout';
  loadout: Loadout;
}

export interface PingMsg {
  type: 'ping';
  /** Client timestamp (ms), echoed back. */
  t: number;
}

/**
 * The client finished loading the match (map view built, shaders ready) and is showing it.
 * Sent once after matchStart. The host holds the pre-match countdown until every human in
 * the room has loaded (bounded), so slow devices don't miss the start of the match.
 */
export interface LoadedMsg {
  type: 'loaded';
}

/**
 * Training range: reset stats / targets, target speed ('difficulty', value =
 * speed multiplier). Additive, backward compatible: 'weapon' swaps the primary
 * at the firing-line rack (value = index into PRIMARY_WEAPON_IDS) and
 * 'throwable' swaps the throwable (value 0 = grenade, 1 = smoke); both apply
 * immediately in the range only and never touch the saved loadout.
 */
export type RangeAction = 'reset' | 'difficulty' | 'weapon' | 'throwable';
export const RANGE_ACTIONS: readonly RangeAction[] = ['reset', 'difficulty', 'weapon', 'throwable'];

export interface RangeCmdMsg {
  type: 'range';
  action: RangeAction;
  value?: number;
}

export type ClientMsg =
  | HelloMsg
  | QueueMsg
  | CancelQueueMsg
  | CreateRoomMsg
  | JoinRoomMsg
  | RoomSettingsMsg
  | RoomTeamMsg
  | StartRoomMsg
  | LeaveMsg
  | InputMsg
  | LoadoutMsg
  | PingMsg
  | RangeCmdMsg
  | LoadedMsg;

// ── Host → Client ───────────────────────────────────────────────────────────

export interface WelcomeMsg {
  type: 'welcome';
  protocol: number;
  serverVersion: string;
  /** 'online' for the Node server, 'local' for the in-browser worker host. */
  host: 'online' | 'local';
  /** Players currently connected (online indicator in menus). */
  online: number;
  /** Name as accepted by the host (sanitized / de-duplicated). */
  name: string;
}

export interface QueueStatusMsg {
  type: 'queueStatus';
  state: 'searching' | 'found' | 'cancelled';
  /** Seconds searching so far. */
  elapsed: number;
  /** Humans currently matched together. */
  humans: number;
  /** Target lobby size. */
  size: number;
}

export interface RoomLobbyPlayer {
  id: number;
  name: string;
  team: Team;
  level: number;
  host: boolean;
  platform: Platform;
}

export interface RoomStateMsg {
  type: 'roomState';
  code: string;
  mode: ModeId;
  map: MapId;
  botFill: boolean;
  botDifficulty: BotDifficulty;
  players: RoomLobbyPlayer[];
  /** Id of the receiving player within the lobby. */
  you: number;
  state: 'lobby' | 'playing';
}

export interface MatchStartMsg {
  type: 'matchStart';
  config: GameConfig;
  /** Receiving player's id. */
  you: number;
  players: PlayerIdentity[];
  /** Current host tick (clients align their clocks to it). */
  tick: number;
  seed: number;
}

export interface SnapshotMsg {
  type: 'snap';
  /** Host tick this snapshot represents. */
  tick: number;
  clock: MatchClock;
  players: PlayerSnap[];
  /** Receiving player's authoritative state (absent for spectators). */
  self?: SelfSnap;
  projectiles: ProjectileSnap[];
  smokes: SmokeSnap[];
  zones: ZoneSnap[];
  pickups: PickupSnap[];
  targets: TargetSnap[];
  /** Events since the previous snapshot addressed to this client. */
  events: GameEvent[];
}

export interface ScoreboardRow {
  id: number;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  objectiveTime: number;
  ping: number;
}

/** Sent about once per second. */
export interface ScoreboardMsg {
  type: 'scoreboard';
  rows: ScoreboardRow[];
}

export interface MatchEndMsg {
  type: 'matchEnd';
  results: MatchResults;
  /** Rating change for the receiving player (applied client-side for guests, server-side for accounts). */
  ratingDelta: number;
}

export interface PongMsg {
  type: 'pong';
  t: number;
  /** Host tick at the time of reply. */
  tick: number;
}

export type ErrorCode =
  | 'room_not_found'
  | 'room_full'
  | 'room_started'
  | 'not_host'
  | 'bad_protocol'
  | 'server_full'
  | 'offline_unavailable'
  | 'kicked';

export interface ErrorMsg {
  type: 'error';
  code: ErrorCode;
  message?: string;
}

export type ServerMsg =
  | WelcomeMsg
  | QueueStatusMsg
  | RoomStateMsg
  | MatchStartMsg
  | SnapshotMsg
  | ScoreboardMsg
  | MatchEndMsg
  | PongMsg
  | ErrorMsg;

// ── Account REST API (Node server only; path prefix /api) ───────────────────
//   POST /api/register  { name, password, profile? }  → AuthResponse
//   POST /api/login     { name, password }            → AuthResponse
//   GET  /api/profile   (Authorization: Bearer <token>) → { profile: StoredProfile }
//   PUT  /api/profile   (Authorization: Bearer <token>) { profile } → { profile: StoredProfile }
//   GET  /api/status    → { online: number, version: string }

/** Progress that an account persists server-side. Mirrors the client's local profile progress fields. */
export interface StoredProfile {
  name: string;
  xp: number;
  level: number;
  rating: number;
  loadout: Loadout;
  cosmetics: CosmeticSelection;
  faction: 0 | 1;
  /** Lifetime stats. */
  lifetime: {
    matches: number;
    wins: number;
    kills: number;
    deaths: number;
    headshots: number;
    shots: number;
    hits: number;
    playSeconds: number;
  };
  updatedAt: number;
}

export interface AuthResponse {
  ok: boolean;
  token?: string;
  profile?: StoredProfile;
  error?: 'name_taken' | 'bad_credentials' | 'invalid' | 'server';
}
