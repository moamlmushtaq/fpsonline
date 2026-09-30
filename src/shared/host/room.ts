// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Room: one running match. Owns a GameSim, the humans connected
// to it, event routing, snapshots, scoreboard, bot fill/replacement and the
// end-of-match results (rating deltas, account recording).
//
// Per tick: step the sim, route drained events into each human's pending list
// (respecting `to` / `except`), every SNAPSHOT_EVERY_TICKS send each human a
// `snap` (with its SelfSnap), every second a scoreboard, and when the sim is
// finished a final snap + `matchEnd` per human.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_RATING, SIM_HZ, SNAPSHOT_EVERY_TICKS } from '../constants';
import type { MapDef } from '../maps/types';
import { ratingDelta } from '../progression';
import type { RangeAction, ScoreboardRow } from '../protocol';
import { GameSim } from '../sim/game';
import type { BotDifficulty, CosmeticSelection, GameConfig, GameEvent, Loadout, MatchResults, Platform, PlayerIdentity, Team } from '../types';
import type { HostConnection } from './host-core';

/** Host-side view of a connected human that a Room needs. */
export interface RoomClient {
  readonly conn: HostConnection;
  name: string;
  rating: number;
  token?: string;
  level: number;
  platform: Platform;
  loadout: Loadout;
  cosmetics: CosmeticSelection;
  faction: 0 | 1;
}

export type RoomKind = 'quick' | 'bots' | 'solo' | 'private';

export interface RoomMember {
  client: RoomClient;
  playerId: number;
  pending: GameEvent[];
  /** matchStart was sent. */
  started: boolean;
  /** The client reported that it finished loading the match ('loaded'). */
  loaded: boolean;
}

export interface RoomOptions {
  id: number;
  kind: RoomKind;
  config: GameConfig;
  map: MapDef;
  seed: number;
  /** Called with the final rating of account players (token) after a rated match. */
  recordMatch?: (token: string, rating: number) => void;
  log?: (...a: unknown[]) => void;
}

/** Average skill rating assumed for bots when computing rating changes. */
export const BOT_RATING: Record<BotDifficulty, number> = { recruit: 1000, veteran: 1100, elite: 1250 };

const MAX_CMDS_PER_MSG = 16;
/**
 * Longest the pre-match countdown waits (in total) for humans still loading the map.
 * Bounded so one slow or silent client can't hold a room hostage.
 */
export const LOAD_HOLD_MAX_TICKS = 20 * SIM_HZ;

export class Room {
  readonly id: number;
  readonly kind: RoomKind;
  readonly config: GameConfig;
  readonly sim: GameSim;
  readonly seed: number;
  readonly members = new Map<string, RoomMember>();
  /** Set when the match is over (or no humans remain). The host removes closed rooms. */
  closed = false;
  /** Set when the match reached its natural end (results were sent). */
  completed = false;
  private readonly recordMatch?: (token: string, rating: number) => void;
  private readonly log: (...a: unknown[]) => void;
  /** Ticks the countdown has been held for loading humans so far. */
  private loadHoldTicks = 0;

  constructor(opts: RoomOptions) {
    this.id = opts.id;
    this.kind = opts.kind;
    this.config = opts.config;
    this.seed = opts.seed >>> 0;
    this.sim = new GameSim(opts.config, opts.map, this.seed);
    this.recordMatch = opts.recordMatch;
    this.log = opts.log ?? (() => {});
  }

  get humanCount(): number {
    return this.members.size;
  }

  get botCount(): number {
    let n = 0;
    for (const p of this.sim.players) if (p.ident.isBot) n++;
    return n;
  }

  /** Can a quick-play human drop into this room right now? */
  joinableForDropIn(minTimeLeft: number): boolean {
    if (this.closed || this.kind !== 'quick') return false;
    const ph = this.sim.currentPhase;
    if (ph !== 'live' && ph !== 'countdown') return false;
    if (this.sim.timeLeft() <= minTimeLeft) return false;
    return this.botCount > 0;
  }

  averageHumanRating(): number {
    if (this.members.size === 0) return DEFAULT_RATING;
    let s = 0;
    for (const m of this.members.values()) s += m.client.rating;
    return s / this.members.size;
  }

  private identFor(client: RoomClient, team?: Team): Omit<PlayerIdentity, 'id' | 'team'> & { team?: Team } {
    return {
      name: client.name,
      isBot: false,
      faction: client.faction,
      loadout: client.loadout,
      cosmetics: client.cosmetics,
      level: client.level,
      platform: client.platform,
      team,
    };
  }

  /**
   * Adds a human (before or during the match). matchStart is sent by announce()
   * (call it after filling bots so the roster is complete) or on the next step.
   */
  addHuman(client: RoomClient, team?: Team): RoomMember {
    const ident = this.sim.addPlayer(this.identFor(client, team));
    return this.admit(client, ident.id);
  }

  /** Drop-in: the human takes a bot's slot. Returns null if no bot could be replaced. */
  dropIn(client: RoomClient): RoomMember | null {
    const ident = this.sim.replaceBotWith(this.identFor(client));
    if (!ident) return null;
    return this.admit(client, ident.id);
  }

  private admit(client: RoomClient, playerId: number): RoomMember {
    const m: RoomMember = { client, playerId, pending: [], started: false, loaded: false };
    this.members.set(client.conn.id, m);
    return m;
  }

  /** Sends matchStart (full roster, current tick) to every member that has not had one. */
  announce(): void {
    let players: ReturnType<GameSim['identities']> | null = null;
    for (const m of this.members.values()) {
      if (m.started) continue;
      players = players ?? this.sim.identities();
      m.started = true;
      // Events that happened before this player's matchStart (their own join, bot joins) are
      // already reflected in the roster.
      m.pending.length = 0;
      m.client.conn.send({ type: 'matchStart', config: this.config, you: m.playerId, players, tick: this.sim.tick, seed: this.seed });
    }
  }

  /** Fills remaining slots with bots (per config.botFill). */
  fillBots(): void {
    if (this.config.botFill) this.sim.fillBots();
  }

  member(connId: string): RoomMember | undefined {
    return this.members.get(connId);
  }

  /** A human leaves (disconnect or 'leave'). Training sends its results first. */
  removeHuman(connId: string): void {
    const m = this.members.get(connId);
    if (!m) return;
    if (this.config.mode === 'range' && !this.completed) {
      // Training has no natural end: hand the player their session results on exit.
      this.flush(m);
      m.client.conn.send({ type: 'matchEnd', results: this.sim.results(), ratingDelta: 0 });
    }
    this.members.delete(connId);
    const running = !this.completed && this.sim.currentPhase !== 'ended';
    const keepTeamsEven = running && (this.kind === 'quick' || (this.kind === 'private' && this.config.botFill));
    if (keepTeamsEven && this.members.size > 0) this.sim.replaceWithBot(m.playerId);
    else this.sim.removePlayer(m.playerId);
    if (this.members.size === 0) this.closed = true;
  }

  /** The member finished loading the match view. */
  markLoaded(connId: string): void {
    const m = this.members.get(connId);
    if (m) m.loaded = true;
  }

  /** Should the countdown wait this tick for a human who is still loading? */
  private holdForLoading(): boolean {
    if (this.sim.currentPhase !== 'countdown' || this.loadHoldTicks >= LOAD_HOLD_MAX_TICKS) return false;
    for (const m of this.members.values()) {
      if (m.started && !m.loaded) {
        this.loadHoldTicks++;
        return true;
      }
    }
    return false;
  }

  input(connId: string, cmds: unknown): void {
    const m = this.members.get(connId);
    if (!m || !Array.isArray(cmds)) return;
    this.sim.pushInputs(m.playerId, cmds.length > MAX_CMDS_PER_MSG ? cmds.slice(-MAX_CMDS_PER_MSG) : cmds);
  }

  setLoadout(connId: string, loadout: Loadout): void {
    const m = this.members.get(connId);
    if (m) this.sim.setLoadout(m.playerId, loadout);
  }

  rangeCommand(connId: string, action: RangeAction, value?: number): void {
    const m = this.members.get(connId);
    if (!m || this.config.mode !== 'range') return;
    this.sim.rangeCommand(action, value, m.playerId);
  }

  /** One simulation tick + networking. */
  step(): void {
    if (this.closed) return;
    this.announce();
    this.sim.holdCountdown = this.holdForLoading();
    this.sim.step();
    const events = this.sim.drainEvents();
    if (events.length) {
      for (const m of this.members.values()) {
        const pid = m.playerId;
        for (const e of events) {
          if (e.to !== undefined && e.to !== pid) continue;
          if (e.except !== undefined && e.except === pid) continue;
          m.pending.push(e.ev);
        }
      }
    }
    const tick = this.sim.tick;
    if (tick % SNAPSHOT_EVERY_TICKS === 0) for (const m of this.members.values()) this.flush(m);
    if (tick % SIM_HZ === 0) this.sendScoreboard();
    if (this.sim.finished && !this.completed) this.finish();
  }

  /** Sends a snapshot with the member's pending events. */
  private flush(m: RoomMember): void {
    const snap = this.sim.buildSnapshot(m.playerId);
    m.client.conn.send({ type: 'snap', ...snap, events: m.pending });
    m.pending = [];
  }

  scoreboardRows(): ScoreboardRow[] {
    const rows = this.sim.scoreboard();
    const ping = new Map<number, number>();
    for (const m of this.members.values()) ping.set(m.playerId, Math.round(m.client.conn.rttMs ?? 0));
    for (const r of rows) r.ping = ping.get(r.id) ?? 0;
    return rows;
  }

  private sendScoreboard(): void {
    if (this.members.size === 0) return;
    const msg = { type: 'scoreboard' as const, rows: this.scoreboardRows() };
    for (const m of this.members.values()) m.client.conn.send(msg);
  }

  /** Natural end of the match: final snap, results + rating change per human. */
  private finish(): void {
    this.completed = true;
    const results = this.sim.results();
    for (const m of this.members.values()) {
      this.flush(m);
      const delta = this.ratingDeltaFor(m, results);
      m.client.conn.send({ type: 'matchEnd', results, ratingDelta: delta });
      if (delta !== 0 && m.client.token && this.recordMatch) {
        try {
          this.recordMatch(m.client.token, Math.max(0, Math.round(m.client.rating + delta)));
        } catch (err) {
          this.log('recordMatch failed', err);
        }
      }
      m.client.rating = Math.max(0, m.client.rating + delta);
    }
    this.closed = true;
  }

  /** Elo-style change for rated matches (quick play and private rooms). */
  ratingDeltaFor(m: RoomMember, results: MatchResults): number {
    if (this.kind === 'bots' || this.kind === 'solo' || this.config.mode === 'range') return 0;
    const me = results.players.find((p) => p.id === m.playerId);
    if (!me) return 0;
    const ratingOf = (id: number, isBot: boolean): number => {
      if (isBot) return BOT_RATING[this.config.botDifficulty] ?? 1100;
      for (const mm of this.members.values()) if (mm.playerId === id) return mm.client.rating;
      return DEFAULT_RATING;
    };
    const ffa = this.config.mode === 'ffa';
    const opponents = results.players.filter((p) => p.id !== me.id && (ffa || p.team !== me.team));
    if (opponents.length === 0) return 0;
    const oppAvg = opponents.reduce((s, p) => s + ratingOf(p.id, p.isBot), 0) / opponents.length;
    let result: 1 | 0.5 | 0;
    if (ffa) {
      const rank = results.players.findIndex((p) => p.id === me.id);
      result = results.winnerPlayer === me.id ? 1 : rank < results.players.length / 2 ? 0.5 : 0;
    } else result = results.draw ? 0.5 : results.winner === me.team ? 1 : 0;
    const mean = results.players.reduce((s, p) => s + p.stats.score, 0) / results.players.length;
    const performance = (me.stats.score - mean) / Math.max(200, mean);
    return ratingDelta(m.client.rating, oppAvg, result, performance);
  }
}
