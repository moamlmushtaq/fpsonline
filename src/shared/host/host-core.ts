// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — HostCore: the one host implementation. Runs inside the Node
// server (kind 'online') and inside a browser Web Worker (kind 'local').
//
// Responsibilities: connections + hello (validation, name sanitize/dedupe,
// optional account resolution), quick-play matchmaking with bot fill and
// drop-in, instant bot matches, the training range, private rooms (codes,
// lobby settings/teams, host migration, return to lobby after a match), and
// driving every Room at a fixed 60 Hz from `update(nowMs)`.
//
// Deterministic: no Math.random / Date.now. Time only comes from update(nowMs);
// randomness (room codes, map rotation, sim seeds) from a seeded RNG.
// Robust: every message is validated; handler errors are caught and logged.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_RATING, GAME_VERSION, PROTOCOL_VERSION, ROOM_CODE_LENGTH, SIM_HZ } from '../constants';
import { sanitizeLoadout } from '../combat';
import { sanitizeCosmetics } from '../cosmetics';
import { getMap } from '../maps/index';
import { hash32, mulberry32 } from '../math';
import { MODES, makeGameConfig } from '../modes';
import { dedupeName, guestName, sanitizeName } from '../names';
import { MAX_LEVEL } from '../progression';
import type {
  AdminMsg,
  AdminReplyMsg,
  AdminState,
  ClientMsg,
  CreateRoomMsg,
  ErrorCode,
  HelloMsg,
  QueueMsg,
  RoomLobbyPlayer,
  RoomSettingsMsg,
  ServerMsg,
} from '../protocol';
import { ADMIN_CHEATS, RANGE_ACTIONS } from '../protocol';
import type { BotDifficulty, CosmeticSelection, Lang, MapId, ModeId, Platform, Team } from '../types';
import { MAP_IDS, MODE_IDS, PVP_MAP_IDS, TEAM_NONE } from '../types';
import { Matchmaker, mapsCompatible, ratingBand, type QueueEntry } from './matchmaker';
import { Room, type RoomClient, type RoomKind } from './room';

export interface HostConnection {
  readonly id: string;
  send(msg: ServerMsg): void;
  readonly rttMs?: number;
}

export interface AccountHooks {
  resolve(token: string): Promise<{ name: string; rating: number } | null>;
  recordMatch(token: string, rating: number): void;
}

/**
 * Online admin authorization (the Node server implements it: ADMIN_PASSWORD with a
 * constant-time compare, optional ADMIN_ACCOUNTS, per-connection lockout). Absent =
 * admin disabled online. The local host never uses it (see onAdmin).
 */
export interface AdminHooks {
  verify(req: { connId: string; password: string; account: string | null }): { ok: boolean; message?: string };
  /** The connection closed: drop its attempt counters. */
  forget?(connId: string): void;
}

export interface HostOptions {
  kind: 'online' | 'local';
  accounts?: AccountHooks;
  admin?: AdminHooks;
  log?: (...a: unknown[]) => void;
  maxRooms?: number;
  /** Seed for room codes / map rotation / match seeds (e.g. the server's start time). */
  seed?: number;
}

const TICK_MS = 1000 / SIM_HZ;
const MAX_STEPS_PER_UPDATE = 8;
const QUEUE_STATUS_MS = 500;
const MATCHMAKER_MS = 250;
const DROP_IN_MIN_TIME_LEFT = 90;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DIFFICULTIES: readonly BotDifficulty[] = ['recruit', 'veteran', 'elite'];
const PLATFORMS: readonly Platform[] = ['desktop', 'mobile', 'tablet'];

interface ClientState extends RoomClient {
  conn: HostConnection;
  welcomed: boolean;
  resolving: boolean;
  backlog: ClientMsg[];
  lang: Lang;
  room: Room | null;
  lobby: Lobby | null;
  queued: boolean;
  lastQueueStatus: number;
  /** Authorized for admin cheats (see onAdmin). */
  admin: boolean;
  /** Account name when signed in with a valid token (ADMIN_ACCOUNTS check). */
  account: string | null;
}

interface LobbyMember {
  client: ClientState;
  lobbyId: number;
  team: Team;
}

interface Lobby {
  code: string;
  mode: ModeId;
  map: MapId;
  botFill: boolean;
  botDifficulty: BotDifficulty;
  members: LobbyMember[];
  hostLobbyId: number;
  nextLobbyId: number;
  state: 'lobby' | 'playing';
  room: Room | null;
}

export class HostCore {
  readonly kind: 'online' | 'local';
  private readonly accounts?: AccountHooks;
  private readonly admin?: AdminHooks;
  private readonly log: (...a: unknown[]) => void;
  private readonly maxRooms: number;
  private readonly rng: () => number;
  private readonly clients = new Map<string, ClientState>();
  private readonly rooms: Room[] = [];
  private readonly lobbies = new Map<string, Lobby>();
  private readonly matchmaker = new Matchmaker<ClientState>();
  private nextRoomId = 1;
  private lastMs: number | null = null;
  private acc = 0;
  private nowMs = 0;
  private lastMatchmake = -Infinity;

  constructor(opts: HostOptions) {
    this.kind = opts.kind;
    this.accounts = opts.accounts;
    this.admin = opts.admin;
    this.log = opts.log ?? (() => {});
    this.maxRooms = Math.max(1, opts.maxRooms ?? 200);
    this.rng = mulberry32(hash32(opts.seed ?? 0x48414c43, opts.kind === 'online' ? 1 : 2));
  }

  /** Players connected and welcomed. */
  get onlineCount(): number {
    let n = 0;
    for (const c of this.clients.values()) if (c.welcomed) n++;
    return n;
  }

  get roomCount(): number {
    return this.rooms.length;
  }

  /** Diagnostics for the server's status endpoint / debug overlays. */
  stats(): { online: number; rooms: number; queued: number; lobbies: number } {
    return { online: this.onlineCount, rooms: this.rooms.length, queued: this.matchmaker.size, lobbies: this.lobbies.size };
  }

  // ── Connections ───────────────────────────────────────────────────────────

  connect(conn: HostConnection): void {
    if (this.clients.has(conn.id)) return;
    this.clients.set(conn.id, {
      conn,
      welcomed: false,
      resolving: false,
      backlog: [],
      name: '',
      rating: DEFAULT_RATING,
      level: 1,
      platform: 'desktop',
      lang: 'en',
      loadout: sanitizeLoadout(undefined),
      cosmetics: sanitizeCosmetics(undefined),
      faction: 0,
      room: null,
      lobby: null,
      queued: false,
      lastQueueStatus: 0,
      admin: false,
      account: null,
    });
  }

  disconnect(conn: HostConnection): void {
    const c = this.clients.get(conn.id);
    if (!c) return;
    try {
      this.leaveAll(c);
    } catch (err) {
      this.log('disconnect error', err);
    }
    this.clients.delete(conn.id);
    this.admin?.forget?.(conn.id);
  }

  receive(conn: HostConnection, msg: ClientMsg): void {
    const c = this.clients.get(conn.id);
    if (!c || !msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return;
    try {
      if (msg.type === 'ping') {
        const t = Number(msg.t);
        c.conn.send({ type: 'pong', t: Number.isFinite(t) ? t : 0, tick: c.room ? c.room.sim.tick : 0 });
        return;
      }
      if (msg.type === 'hello') {
        this.onHello(c, msg);
        return;
      }
      if (!c.welcomed) {
        if (c.resolving && c.backlog.length < 64) c.backlog.push(msg);
        return;
      }
      this.dispatch(c, msg);
    } catch (err) {
      this.log('host message error', msg.type, err);
    }
  }

  private dispatch(c: ClientState, msg: ClientMsg): void {
    switch (msg.type) {
      case 'input':
        c.room?.input(c.conn.id, msg.cmds);
        return;
      case 'queue':
        this.onQueue(c, msg);
        return;
      case 'cancelQueue':
        if (this.matchmaker.remove(c)) this.sendQueueStatus(c, 'cancelled', 0, 0, 0);
        c.queued = false;
        return;
      case 'createRoom':
        this.onCreateRoom(c, msg);
        return;
      case 'joinRoom':
        this.onJoinRoom(c, String(msg.code ?? ''));
        return;
      case 'roomSettings':
        this.onRoomSettings(c, msg);
        return;
      case 'roomTeam':
        this.onRoomTeam(c, msg.team);
        return;
      case 'startRoom':
        this.onStartRoom(c);
        return;
      case 'leave':
        this.leaveAll(c);
        return;
      case 'loadout':
        c.loadout = sanitizeLoadout(msg.loadout);
        c.room?.setLoadout(c.conn.id, c.loadout);
        return;
      case 'loaded':
        c.room?.markLoaded(c.conn.id);
        return;
      case 'admin':
        this.onAdmin(c, msg);
        return;
      case 'range':
        // RANGE_ACTIONS: reset | difficulty | weapon | throwable (weapon/throwable added for the range rack).
        if (c.room && RANGE_ACTIONS.includes(msg.action)) {
          const v = Number(msg.value);
          c.room.rangeCommand(c.conn.id, msg.action, Number.isFinite(v) ? v : undefined);
        }
        return;
      default:
        return;
    }
  }

  private error(c: ClientState, code: ErrorCode, message?: string): void {
    c.conn.send(message ? { type: 'error', code, message } : { type: 'error', code });
  }

  // ── Hello ─────────────────────────────────────────────────────────────────

  private onHello(c: ClientState, msg: HelloMsg): void {
    if (Number(msg.protocol) !== PROTOCOL_VERSION) {
      this.error(c, 'bad_protocol', `expected protocol ${PROTOCOL_VERSION}`);
      return;
    }
    const level = Math.round(Number(msg.level));
    c.level = Number.isFinite(level) ? Math.max(1, Math.min(MAX_LEVEL, level)) : 1;
    const rating = Number(msg.rating);
    c.rating = Number.isFinite(rating) ? Math.max(0, Math.min(4000, rating)) : DEFAULT_RATING;
    c.platform = PLATFORMS.includes(msg.platform) ? msg.platform : 'desktop';
    c.lang = msg.lang === 'ar' ? 'ar' : 'en';
    c.loadout = sanitizeLoadout(msg.loadout);
    c.cosmetics = sanitizeCosmetics(msg.cosmetics as Partial<CosmeticSelection> | undefined);
    c.faction = msg.faction === 1 ? 1 : 0;
    c.token = typeof msg.token === 'string' && msg.token.length > 0 && msg.token.length < 512 ? msg.token : undefined;
    const requested = sanitizeName(msg.name);
    if (c.token && this.accounts && !c.room) {
      c.resolving = true;
      c.welcomed = false;
      const token = c.token;
      const accounts = this.accounts;
      // Promise.resolve().then(...) also turns a synchronous throw inside resolve() into a rejection.
      Promise.resolve()
        .then(() => accounts.resolve(token))
        .then((acc) => {
          if (!this.clients.has(c.conn.id)) return;
          if (acc) {
            c.account = typeof acc.name === 'string' ? acc.name : null;
            const r = Number(acc.rating);
            if (Number.isFinite(r)) c.rating = Math.max(0, Math.min(4000, r));
            this.welcome(c, sanitizeName(acc.name) ?? requested);
          } else {
            c.token = undefined;
            c.account = null;
            this.welcome(c, requested);
          }
        })
        .catch((err) => {
          this.log('account resolve failed', err);
          if (!this.clients.has(c.conn.id)) return;
          c.token = undefined;
          this.welcome(c, requested);
        });
      return;
    }
    this.welcome(c, requested);
  }

  private welcome(c: ClientState, requested: string | null): void {
    const base = requested ?? guestName(this.rng);
    const taken = (n: string) => {
      const l = n.toLowerCase();
      for (const o of this.clients.values()) if (o !== c && o.welcomed && o.name.toLowerCase() === l) return true;
      return false;
    };
    // Keep the current name when re-sending hello with the same name.
    c.name = c.welcomed && c.name.toLowerCase() === base.toLowerCase() ? c.name : dedupeName(base, taken);
    c.welcomed = true;
    c.resolving = false;
    c.conn.send({
      type: 'welcome',
      protocol: PROTOCOL_VERSION,
      serverVersion: GAME_VERSION,
      host: this.kind,
      online: this.onlineCount,
      name: c.name,
    });
    const backlog = c.backlog;
    c.backlog = [];
    for (const m of backlog) this.receive(c.conn, m);
  }

  // ── Admin console ────────────────────────────────────────────────────────

  private adminStateFor(c: ClientState): AdminState {
    if (c.room) return c.room.adminState(c.conn.id);
    return { authorized: c.admin, god: false, ammo: false, speed: 1, freezeBots: false, inMatch: false };
  }

  /**
   * Auth: online → the AdminHooks check the password (admin is disabled without them);
   * local → the in-browser host trusts the client's own code check (`trusted`), which is
   * all an offline game needs. Cheats are only honoured for authorized connections.
   */
  private onAdmin(c: ClientState, msg: AdminMsg): void {
    const reply = (r: Omit<AdminReplyMsg, 'type'>) => c.conn.send({ type: 'admin', ...r });
    const who = () => `${c.name || '?'} (${c.conn.id}${c.account ? `, account ${c.account}` : ''})`;
    if (msg.action === 'auth') {
      let ok = false;
      let message = 'denied';
      if (this.kind === 'local') ok = msg.trusted === true;
      else if (!this.admin) message = 'disabled';
      else {
        const password = typeof msg.password === 'string' ? msg.password.slice(0, 256) : '';
        const r = this.admin.verify({ connId: c.conn.id, password, account: c.account });
        ok = r.ok === true;
        if (!ok) message = r.message ?? 'denied';
      }
      c.admin = ok;
      if (this.kind === 'online') this.log(`admin: auth ${ok ? 'GRANTED' : `refused (${message})`} for ${who()}`);
      reply(ok ? { ok, message: 'ok', state: this.adminStateFor(c) } : { ok, message });
      return;
    }
    if (msg.action !== 'cheat') return;
    if (!c.admin) {
      if (this.kind === 'online') this.log(`admin: refused cheat '${String(msg.cheat).slice(0, 16)}' from unauthorized ${who()}`);
      reply({ ok: false, message: 'unauthorized' });
      return;
    }
    if (!ADMIN_CHEATS.includes(msg.cheat)) {
      reply({ ok: false, message: 'bad_cheat' });
      return;
    }
    const raw = msg.value;
    const value = typeof raw === 'boolean' || (typeof raw === 'number' && Number.isFinite(raw)) ? raw : typeof raw === 'string' ? raw.slice(0, 16) : undefined;
    if (!c.room) {
      reply({ ok: false, message: 'no_match', state: this.adminStateFor(c) });
      return;
    }
    const r = c.room.adminCheat(c.conn.id, msg.cheat, value);
    if (this.kind === 'online') this.log(`admin: ${who()} room ${c.room.id}: ${msg.cheat}${value !== undefined ? ` ${String(value)}` : ''} → ${r.ok ? 'ok' : r.message}`);
    c.conn.send(r);
  }

  // ── Queue / matches ──────────────────────────────────────────────────────

  private onQueue(c: ClientState, msg: QueueMsg): void {
    if (c.room || c.lobby) this.leaveAll(c);
    this.matchmaker.remove(c);
    c.queued = false;
    const mode: ModeId = MODE_IDS.includes(msg.mode) ? msg.mode : 'tdm';
    const difficulty: BotDifficulty = DIFFICULTIES.includes(msg.botDifficulty) ? msg.botDifficulty : 'veteran';
    const map: MapId | 'any' = msg.map === 'any' || !MAP_IDS.includes(msg.map) ? 'any' : msg.map;
    if (msg.kind === 'solo' || mode === 'range') {
      this.startSolo(c, !!msg.tutorial);
      return;
    }
    if (msg.kind === 'bots' || this.kind === 'local') {
      const room = this.createRoom('bots', mode, this.resolveMap(mode, map), difficulty, true);
      if (!room) return this.error(c, 'server_full');
      this.sendQueueStatus(c, 'found', 0, 1, room.config.maxPlayers);
      this.joinRoom(c, room);
      room.fillBots();
      room.announce();
      return;
    }
    if (msg.kind !== 'quick') return;
    this.matchmaker.enqueue({ client: c, mode, map, rating: c.rating, botDifficulty: difficulty, since: this.nowMs });
    c.queued = true;
    c.lastQueueStatus = this.nowMs;
    this.sendQueueStatus(c, 'searching', 0, 1, Matchmaker.lobbySize(mode));
    // Try immediately (drop-in into a running room feels instant).
    this.runMatchmaker(true);
  }

  private startSolo(c: ClientState, tutorial: boolean): void {
    const config = makeGameConfig('range', 'range', { botFill: false, tutorial });
    const room = this.newRoom('solo', config);
    if (!room) return this.error(c, 'server_full');
    this.sendQueueStatus(c, 'found', 0, 1, 1);
    this.joinRoom(c, room);
    room.announce();
  }

  private resolveMap(mode: ModeId, map: MapId | 'any'): MapId {
    const maps = MODES[mode]?.maps ?? PVP_MAP_IDS;
    if (map !== 'any' && maps.includes(map)) return map;
    return maps[Math.floor(this.rng() * maps.length) % maps.length];
  }

  private createRoom(kind: RoomKind, mode: ModeId, map: MapId, difficulty: BotDifficulty, botFill: boolean, roomCode?: string): Room | null {
    const config = makeGameConfig(mode, map, { botFill, botDifficulty: difficulty, roomCode });
    return this.newRoom(kind, config);
  }

  private newRoom(kind: RoomKind, config: ReturnType<typeof makeGameConfig>): Room | null {
    if (this.rooms.length >= this.maxRooms) return null;
    const room = new Room({
      id: this.nextRoomId++,
      kind,
      config,
      map: getMap(config.map),
      seed: Math.floor(this.rng() * 0xffffffff),
      recordMatch: this.accounts ? (t, r) => this.accounts?.recordMatch(t, r) : undefined,
      log: this.log,
    });
    this.rooms.push(room);
    return room;
  }

  private joinRoom(c: ClientState, room: Room, team?: Team): void {
    c.room = room;
    c.queued = false;
    room.addHuman(c, team);
  }

  private runMatchmaker(force = false): void {
    if (this.matchmaker.size === 0) return;
    if (!force && this.nowMs - this.lastMatchmake < MATCHMAKER_MS) return;
    this.lastMatchmake = this.nowMs;
    this.matchmaker.update(this.nowMs, {
      tryDropIn: (e) => this.tryDropIn(e),
      start: (group, mode, map) => this.startQuick(group, mode, map),
    });
  }

  private tryDropIn(e: QueueEntry<ClientState>): boolean {
    const band = ratingBand((this.nowMs - e.since) / 1000);
    let best: Room | null = null;
    for (const r of this.rooms) {
      if (r.config.mode !== e.mode || !mapsCompatible(e.map, r.config.map)) continue;
      if (!r.joinableForDropIn(DROP_IN_MIN_TIME_LEFT)) continue;
      if (Math.abs(r.averageHumanRating() - e.rating) > band) continue;
      if (!best || r.botCount > best.botCount) best = r;
    }
    if (!best) return false;
    const c = e.client;
    c.room = best;
    if (!best.dropIn(c)) {
      c.room = null;
      return false;
    }
    // Only report 'found' once the slot is really taken (a failed drop-in keeps searching).
    c.queued = false;
    this.sendQueueStatus(c, 'found', (this.nowMs - e.since) / 1000, best.humanCount, best.config.maxPlayers);
    best.announce();
    return true;
  }

  private startQuick(group: QueueEntry<ClientState>[], mode: ModeId, map: MapId | 'any'): void {
    const difficulty = group[0].botDifficulty;
    const room = this.createRoom('quick', mode, this.resolveMap(mode, map), difficulty, true);
    if (!room) {
      for (const g of group) {
        g.client.queued = false;
        this.error(g.client, 'server_full');
      }
      return;
    }
    for (const g of group) {
      this.sendQueueStatus(g.client, 'found', (this.nowMs - g.since) / 1000, group.length, room.config.maxPlayers);
      this.joinRoom(g.client, room);
    }
    room.fillBots();
    room.announce();
  }

  private sendQueueStatus(c: ClientState, state: 'searching' | 'found' | 'cancelled', elapsed: number, humans: number, size: number): void {
    c.conn.send({ type: 'queueStatus', state, elapsed: Math.round(elapsed * 10) / 10, humans, size });
  }

  // ── Private rooms ────────────────────────────────────────────────────────

  private newCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(this.rng() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
      if (!this.lobbies.has(code)) return code;
    }
    return `R${this.nextRoomId}${this.lobbies.size}`.slice(0, ROOM_CODE_LENGTH).toUpperCase();
  }

  private onCreateRoom(c: ClientState, msg: CreateRoomMsg): void {
    if (this.kind === 'local') return this.error(c, 'offline_unavailable');
    this.leaveAll(c);
    if (this.rooms.length >= this.maxRooms) return this.error(c, 'server_full');
    const mode: ModeId = MODE_IDS.includes(msg.mode) && msg.mode !== 'range' ? msg.mode : 'tdm';
    const lobby: Lobby = {
      code: this.newCode(),
      mode,
      map: this.resolveMap(mode, MAP_IDS.includes(msg.map) ? msg.map : 'any'),
      botFill: msg.botFill !== false,
      botDifficulty: DIFFICULTIES.includes(msg.botDifficulty) ? msg.botDifficulty : 'veteran',
      members: [],
      hostLobbyId: 1,
      nextLobbyId: 1,
      state: 'lobby',
      room: null,
    };
    this.lobbies.set(lobby.code, lobby);
    this.addToLobby(lobby, c);
    this.broadcastLobby(lobby);
  }

  private onJoinRoom(c: ClientState, rawCode: string): void {
    if (this.kind === 'local') return this.error(c, 'offline_unavailable');
    const code = rawCode.trim().toUpperCase();
    const lobby = this.lobbies.get(code);
    if (!lobby) return this.error(c, 'room_not_found');
    if (lobby.members.some((m) => m.client === c)) {
      this.broadcastLobby(lobby);
      return;
    }
    if (lobby.state !== 'lobby') return this.error(c, 'room_started');
    if (lobby.members.length >= MODES[lobby.mode].maxPlayers) return this.error(c, 'room_full');
    this.leaveAll(c);
    this.addToLobby(lobby, c);
    this.broadcastLobby(lobby);
  }

  private addToLobby(lobby: Lobby, c: ClientState): void {
    const id = lobby.nextLobbyId++;
    lobby.members.push({ client: c, lobbyId: id, team: this.balancedTeam(lobby) });
    if (lobby.members.length === 1) lobby.hostLobbyId = id;
    c.lobby = lobby;
  }

  private balancedTeam(lobby: Lobby): Team {
    if (!MODES[lobby.mode].teams) return TEAM_NONE;
    const n0 = lobby.members.filter((m) => m.team === 0).length;
    const n1 = lobby.members.filter((m) => m.team === 1).length;
    return n0 <= n1 ? 0 : 1;
  }

  private isLobbyHost(c: ClientState): Lobby | null {
    const lobby = c.lobby;
    if (!lobby) return null;
    const me = lobby.members.find((m) => m.client === c);
    if (!me || me.lobbyId !== lobby.hostLobbyId) {
      this.error(c, 'not_host');
      return null;
    }
    return lobby;
  }

  private onRoomSettings(c: ClientState, msg: RoomSettingsMsg): void {
    const lobby = this.isLobbyHost(c);
    if (!lobby || lobby.state !== 'lobby') return;
    const mode: ModeId = MODE_IDS.includes(msg.mode) && msg.mode !== 'range' ? msg.mode : lobby.mode;
    const modeChanged = mode !== lobby.mode;
    lobby.mode = mode;
    lobby.map = MAP_IDS.includes(msg.map) && MODES[mode].maps.includes(msg.map) ? msg.map : MODES[mode].maps.includes(lobby.map) ? lobby.map : MODES[mode].maps[0];
    lobby.botFill = msg.botFill !== false;
    if (DIFFICULTIES.includes(msg.botDifficulty)) lobby.botDifficulty = msg.botDifficulty;
    if (modeChanged) {
      // Re-balance teams for the new mode.
      const teams = MODES[mode].teams;
      lobby.members.forEach((m, i) => (m.team = teams ? ((i % 2) as Team) : TEAM_NONE));
    }
    this.broadcastLobby(lobby);
  }

  private onRoomTeam(c: ClientState, team: Team): void {
    const lobby = c.lobby;
    if (!lobby || lobby.state !== 'lobby' || !MODES[lobby.mode].teams) return;
    if (team !== 0 && team !== 1) return;
    const me = lobby.members.find((m) => m.client === c);
    if (!me || me.team === team) return;
    const cap = Math.ceil(MODES[lobby.mode].maxPlayers / 2);
    if (lobby.members.filter((m) => m.team === team).length >= cap) return;
    me.team = team;
    this.broadcastLobby(lobby);
  }

  private onStartRoom(c: ClientState): void {
    const lobby = this.isLobbyHost(c);
    if (!lobby || lobby.state !== 'lobby') return;
    const room = this.createRoom('private', lobby.mode, lobby.map, lobby.botDifficulty, lobby.botFill, lobby.code);
    if (!room) return this.error(c, 'server_full');
    lobby.state = 'playing';
    lobby.room = room;
    const teams = MODES[lobby.mode].teams;
    for (const m of lobby.members) this.joinRoom(m.client, room, teams ? m.team : undefined);
    room.fillBots();
    this.broadcastLobby(lobby);
    room.announce();
  }

  private broadcastLobby(lobby: Lobby): void {
    const players: RoomLobbyPlayer[] = lobby.members.map((m) => ({
      id: m.lobbyId,
      name: m.client.name,
      team: m.team,
      level: m.client.level,
      host: m.lobbyId === lobby.hostLobbyId,
      platform: m.client.platform,
    }));
    for (const m of lobby.members) {
      m.client.conn.send({
        type: 'roomState',
        code: lobby.code,
        mode: lobby.mode,
        map: lobby.map,
        botFill: lobby.botFill,
        botDifficulty: lobby.botDifficulty,
        players,
        you: m.lobbyId,
        state: lobby.state,
      });
    }
  }

  private leaveLobby(c: ClientState): void {
    const lobby = c.lobby;
    if (!lobby) return;
    c.lobby = null;
    const idx = lobby.members.findIndex((m) => m.client === c);
    if (idx < 0) return;
    const [gone] = lobby.members.splice(idx, 1);
    if (lobby.members.length === 0) {
      this.lobbies.delete(lobby.code);
      return;
    }
    if (gone.lobbyId === lobby.hostLobbyId) lobby.hostLobbyId = lobby.members[0].lobbyId; // host migration
    this.broadcastLobby(lobby);
  }

  /** Leaves queue, room and lobby. */
  private leaveAll(c: ClientState): void {
    if (this.matchmaker.remove(c)) c.queued = false;
    if (c.room) {
      const room = c.room;
      c.room = null;
      room.removeHuman(c.conn.id);
    }
    this.leaveLobby(c);
  }

  // ── Update loop ──────────────────────────────────────────────────────────

  /** Drive from a timer every ~4–16 ms. Fixed 60 Hz steps, at most 8 per call (excess time is dropped). */
  update(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    if (this.lastMs === null) {
      // First clock sample: re-base anything queued before the host clock started.
      this.lastMs = nowMs;
      for (const e of this.matchmaker.list()) {
        e.since = nowMs;
        e.client.lastQueueStatus = nowMs;
      }
    }
    let elapsed = nowMs - this.lastMs;
    this.lastMs = nowMs;
    if (!(elapsed > 0)) elapsed = 0;
    this.acc += elapsed;
    let steps = Math.floor(this.acc / TICK_MS);
    if (steps > MAX_STEPS_PER_UPDATE) {
      steps = MAX_STEPS_PER_UPDATE;
      this.acc = 0;
    } else this.acc -= steps * TICK_MS;
    this.nowMs = nowMs;
    for (let i = 0; i < steps; i++) this.stepRooms();
    this.runMatchmaker();
    this.tickQueueStatus();
  }

  private stepRooms(): void {
    for (let i = this.rooms.length - 1; i >= 0; i--) {
      const room = this.rooms[i];
      try {
        room.step();
      } catch (err) {
        this.log('room step error', room.id, err);
        room.closed = true;
      }
      if (room.closed) {
        this.rooms.splice(i, 1);
        this.onRoomClosed(room);
      }
    }
  }

  private onRoomClosed(room: Room): void {
    for (const c of this.clients.values()) if (c.room === room) c.room = null;
    for (const lobby of this.lobbies.values()) {
      if (lobby.room !== room) continue;
      lobby.room = null;
      lobby.state = 'lobby';
      this.broadcastLobby(lobby);
    }
  }

  private tickQueueStatus(): void {
    for (const e of this.matchmaker.list()) {
      const c = e.client;
      if (this.nowMs - c.lastQueueStatus < QUEUE_STATUS_MS) continue;
      c.lastQueueStatus = this.nowMs;
      this.sendQueueStatus(c, 'searching', (this.nowMs - e.since) / 1000, this.matchmaker.compatibleCount(e, this.nowMs), Matchmaker.lobbySize(e.mode));
    }
  }
}
