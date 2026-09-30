// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — local player profile + optional account sync.
//
// Everyone starts as a guest with a generated callsign; progress lives in
// localStorage. Signing in (POST /api/login | /api/register) stores a session
// token; after each match the profile is pushed to the server (PUT /api/profile)
// and pulled on sign-in. Every network helper resolves (never throws) and is a
// no-op when unreachable, so offline play is never blocked by accounts.
// ─────────────────────────────────────────────────────────────────────────────

import { defaultCosmetics, sanitizeCosmetics } from '../../shared/cosmetics';
import { DEFAULT_RATING } from '../../shared/constants';
import { guestName, sanitizeName } from '../../shared/names';
import { computeMatchXp, isUnlocked, levelFromXp, MAX_LEVEL, totalXpForLevel, unlocksBetween } from '../../shared/progression';
import type { MatchXp, Unlock, UnlockKind } from '../../shared/progression';
import type { AuthResponse, StoredProfile } from '../../shared/protocol';
import { mulberry32 } from '../../shared/math';
import type { CosmeticSelection, Loadout, MatchResults, PlayerMatchStats, WeaponId } from '../../shared/types';
import { PRIMARY_WEAPON_IDS } from '../../shared/types';

const STORAGE_KEY = 'hf.profile';
const SCHEMA_VERSION = 1;

export interface RangeBest {
  /** Best range session score. */
  score: number;
  accuracy: number;
  headshots: number;
}

export interface LocalProfile extends StoredProfile {
  guest: boolean;
  /** Account session token (null for guests). */
  token: string | null;
  seenTutorial: boolean;
  /** Local calendar day (YYYY-MM-DD) of the last completed match (daily XP bonus). */
  lastPlayedDay: string;
  rangeBest: RangeBest | null;
}

export interface LevelSnapshot {
  level: number;
  /** Total XP. */
  xp: number;
  into: number;
  needed: number;
}

export interface MatchApplication {
  xp: MatchXp;
  before: LevelSnapshot;
  after: LevelSnapshot;
  unlocks: Unlock[];
  won: boolean;
  draw: boolean;
  mvp: boolean;
  /** The local player's stats (zeros if not found in the results). */
  stats: PlayerMatchStats;
  ratingBefore: number;
  ratingAfter: number;
}

export type AuthResult = { ok: true } | { ok: false; error: NonNullable<AuthResponse['error']> };

export type RatingTier = 'cadet' | 'pilot' | 'navigator' | 'commander' | 'luminary';

/** Retro-futurist callsign like "Amber Kestrel 42" (fits NAME_MAX). */
export function generateGuestName(): string {
  let seed = 0;
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    seed = a[0];
  } catch {
    seed = (Date.now() ^ (performance.now() * 1000)) >>> 0;
  }
  return guestName(mulberry32(seed)).replace(/-/g, ' ');
}

export function ratingTier(rating: number): RatingTier {
  if (rating < 950) return 'cadet';
  if (rating < 1100) return 'pilot';
  if (rating < 1300) return 'navigator';
  if (rating < 1550) return 'commander';
  return 'luminary';
}

function emptyStats(): PlayerMatchStats {
  return { kills: 0, deaths: 0, assists: 0, damage: 0, shots: 0, hits: 0, headshots: 0, objectiveTime: 0, captures: 0, score: 0, bestStreak: 0 };
}

function today(): string {
  const d = new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

function defaultProfile(): LocalProfile {
  return {
    name: generateGuestName(),
    xp: 0,
    level: 1,
    rating: DEFAULT_RATING,
    loadout: { primary: 'meridian', throwable: 'grenade' },
    cosmetics: defaultCosmetics(),
    faction: 0,
    lifetime: { matches: 0, wins: 0, kills: 0, deaths: 0, headshots: 0, shots: 0, hits: 0, playSeconds: 0 },
    updatedAt: Date.now(),
    guest: true,
    token: null,
    seenTutorial: false,
    lastPlayedDay: '',
    rangeBest: null,
  };
}

function finite(v: unknown, def: number, min = -Infinity, max = Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
}

function sanitizeLoadout(l: unknown): Loadout {
  const src = (l ?? {}) as Partial<Loadout>;
  return {
    primary: PRIMARY_WEAPON_IDS.includes(src.primary as never) ? (src.primary as Loadout['primary']) : 'meridian',
    throwable: src.throwable === 'smoke' || src.throwable === 'grenade' ? src.throwable : 'grenade',
  };
}

/** Accepts both LocalProfile and server StoredProfile shapes. */
function sanitizeProfile(raw: unknown, base: LocalProfile = defaultProfile()): LocalProfile {
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<LocalProfile>;
  const life = (p.lifetime ?? {}) as Partial<StoredProfile['lifetime']>;
  const xp = finite(p.xp, base.xp, 0, totalXpForLevel(MAX_LEVEL) + 1e6);
  const rb = p.rangeBest as Partial<RangeBest> | null | undefined;
  return {
    name: sanitizeName(p.name) ?? base.name,
    xp,
    level: levelFromXp(xp).level,
    rating: finite(p.rating, base.rating, 0, 4000),
    loadout: sanitizeLoadout(p.loadout ?? base.loadout),
    cosmetics: sanitizeCosmetics((p.cosmetics ?? base.cosmetics) as Partial<CosmeticSelection>),
    faction: p.faction === 1 ? 1 : p.faction === 0 ? 0 : base.faction,
    lifetime: {
      matches: finite(life.matches, base.lifetime.matches, 0),
      wins: finite(life.wins, base.lifetime.wins, 0),
      kills: finite(life.kills, base.lifetime.kills, 0),
      deaths: finite(life.deaths, base.lifetime.deaths, 0),
      headshots: finite(life.headshots, base.lifetime.headshots, 0),
      shots: finite(life.shots, base.lifetime.shots, 0),
      hits: finite(life.hits, base.lifetime.hits, 0),
      playSeconds: finite(life.playSeconds, base.lifetime.playSeconds, 0),
    },
    updatedAt: finite(p.updatedAt, base.updatedAt, 0),
    guest: typeof p.guest === 'boolean' ? p.guest : base.guest,
    token: typeof p.token === 'string' && p.token.length > 0 ? p.token : p.token === null ? null : base.token,
    seenTutorial: typeof p.seenTutorial === 'boolean' ? p.seenTutorial : base.seenTutorial,
    lastPlayedDay: typeof p.lastPlayedDay === 'string' ? p.lastPlayedDay : base.lastPlayedDay,
    rangeBest:
      rb && typeof rb === 'object'
        ? { score: finite(rb.score, 0, 0), accuracy: finite(rb.accuracy, 0, 0, 1), headshots: finite(rb.headshots, 0, 0) }
        : rb === null
          ? null
          : base.rangeBest,
  };
}

/** Resolves the REST base URL: `?server=wss://host/ws` → https://host/api, else same origin /api. */
function resolveApiBase(): string {
  try {
    const params = new URLSearchParams(location.search);
    const server = params.get('server');
    if (server) {
      const u = new URL(server, location.href);
      u.protocol = u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol;
      return `${u.origin}/api`;
    }
    return `${location.origin}/api`;
  } catch {
    return '/api';
  }
}

function toStored(p: LocalProfile): StoredProfile {
  return {
    name: p.name,
    xp: p.xp,
    level: p.level,
    rating: p.rating,
    loadout: p.loadout,
    cosmetics: p.cosmetics,
    faction: p.faction,
    lifetime: p.lifetime,
    updatedAt: p.updatedAt,
  };
}

export class ProfileStore {
  private _value: LocalProfile;
  private listeners = new Set<(p: LocalProfile) => void>();
  private storage: Storage | null = null;
  private apiBase = resolveApiBase();

  constructor() {
    try {
      this.storage = window.localStorage;
    } catch {
      this.storage = null;
    }
    this._value = this.load();
  }

  get value(): LocalProfile {
    return this._value;
  }

  get signedIn(): boolean {
    return !this._value.guest && !!this._value.token;
  }

  setApiBase(url: string): void {
    this.apiBase = url.replace(/\/$/, '');
  }

  onChange(cb: (p: LocalProfile) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  update(patch: Partial<LocalProfile>): void {
    this._value = sanitizeProfile({ ...this._value, ...patch, updatedAt: Date.now() }, this._value);
    this.save();
    this.emit();
  }

  /** Returns false if the name is invalid. */
  setName(raw: string): boolean {
    const name = sanitizeName(raw);
    if (!name) return false;
    this.update({ name });
    void this.pushProfile();
    return true;
  }

  randomizeName(): string {
    const name = generateGuestName();
    this.update({ name });
    return name;
  }

  setLoadout(patch: Partial<Loadout>): void {
    this.update({ loadout: { ...this._value.loadout, ...patch } });
  }

  setCosmetics(patch: Partial<CosmeticSelection>): void {
    const c = this._value.cosmetics;
    this.update({ cosmetics: { ...c, ...patch, skins: { ...c.skins, ...(patch.skins ?? {}) } } });
  }

  levelInfo(xp = this._value.xp): LevelSnapshot {
    const l = levelFromXp(xp);
    return { level: l.level, xp, into: l.into, needed: l.needed };
  }

  isUnlocked(kind: UnlockKind, id: string, weapon?: WeaponId): boolean {
    return isUnlocked(this._value.level, kind, id, weapon);
  }

  /**
   * Applies a finished match to the profile: XP (with first-match-of-the-day bonus and
   * the bot-match reduction), lifetime stats, rating (mirrored locally for guests) and
   * range bests. Returns everything the results screen animates.
   */
  applyMatch(results: MatchResults, youId: number, ratingDelta: number, opts: { botMatch?: boolean } = {}): MatchApplication {
    const p = this._value;
    const me = results.players.find((r) => r.id === youId);
    const stats = me ? me.stats : emptyStats();
    const teams = results.mode === 'tdm' || results.mode === 'control';
    const draw = results.draw;
    const won = !draw && (teams ? !!me && me.team === results.winner : results.winnerPlayer === youId);
    const mvp = results.mvp === youId;
    const otherHumans = results.players.some((r) => r.id !== youId && !r.isBot);
    const botMatch = opts.botMatch ?? !otherHumans;
    const day = today();
    const firstMatchOfDay = results.mode !== 'range' && p.lastPlayedDay !== day;

    const xp = computeMatchXp(stats, {
      mode: results.mode,
      won,
      draw,
      mvp: mvp && results.mode !== 'range',
      secondsPlayed: results.duration,
      botMatch: botMatch && results.mode !== 'range',
      firstMatchOfDay,
    });

    const before = this.levelInfo(p.xp);
    const newXp = p.xp + Math.max(0, xp.total);
    const after = this.levelInfo(newXp);
    const unlocks = unlocksBetween(before.level, after.level);
    const ratingBefore = p.rating;
    const ratingAfter = Math.max(0, Math.min(4000, p.rating + (Number.isFinite(ratingDelta) ? ratingDelta : 0)));

    const life = { ...p.lifetime };
    if (results.mode !== 'range') {
      life.matches += 1;
      if (won) life.wins += 1;
      life.kills += stats.kills;
      life.deaths += stats.deaths;
    }
    life.headshots += stats.headshots;
    life.shots += stats.shots;
    life.hits += stats.hits;
    life.playSeconds += Math.max(0, Math.round(results.duration));

    let rangeBest = p.rangeBest;
    if (results.mode === 'range') {
      const accuracy = stats.shots > 0 ? stats.hits / stats.shots : 0;
      if (!rangeBest || stats.score > rangeBest.score) rangeBest = { score: stats.score, accuracy, headshots: stats.headshots };
    }

    this.update({
      xp: newXp,
      rating: ratingAfter,
      lifetime: life,
      lastPlayedDay: results.mode !== 'range' ? day : p.lastPlayedDay,
      rangeBest,
      seenTutorial: p.seenTutorial || results.mode === 'range',
    });
    void this.pushProfile();

    return { xp, before, after, unlocks, won, draw, mvp, stats, ratingBefore, ratingAfter };
  }

  // ── Account sync ───────────────────────────────────────────────────────

  async login(name: string, password: string): Promise<AuthResult> {
    return this.auth('login', { name, password });
  }

  async register(name: string, password: string): Promise<AuthResult> {
    return this.auth('register', { name, password, profile: toStored(this._value) });
  }

  logout(): void {
    this.update({ token: null, guest: true });
  }

  /** Uploads progress (accounts only). Silently ignores failures. */
  async pushProfile(): Promise<boolean> {
    const token = this._value.token;
    if (!token || this._value.guest) return false;
    try {
      const res = await this.fetchJson('profile', { method: 'PUT', token, body: { profile: toStored(this._value) } });
      return !!res && typeof res === 'object' && 'profile' in res;
    } catch {
      return false;
    }
  }

  /** Downloads server progress and merges it (server wins when it has more XP or is newer). */
  async pullProfile(): Promise<boolean> {
    const token = this._value.token;
    if (!token || this._value.guest) return false;
    try {
      const res = (await this.fetchJson('profile', { method: 'GET', token })) as { profile?: StoredProfile } | null;
      if (!res?.profile) return false;
      this.mergeServer(res.profile);
      return true;
    } catch {
      return false;
    }
  }

  private mergeServer(server: StoredProfile): void {
    const local = this._value;
    const useServer = server.xp >= local.xp || server.updatedAt > local.updatedAt;
    if (!useServer) {
      void this.pushProfile();
      return;
    }
    const merged = sanitizeProfile({ ...local, ...server, guest: false, token: local.token }, local);
    this._value = merged;
    this.save();
    this.emit();
  }

  private async auth(kind: 'login' | 'register', body: Record<string, unknown>): Promise<AuthResult> {
    const name = sanitizeName(body.name);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!name || password.length < 6 || password.length > 128) return { ok: false, error: 'invalid' };
    try {
      const res = (await this.fetchJson(kind, { method: 'POST', body: { ...body, name } })) as AuthResponse | null;
      if (!res) return { ok: false, error: 'server' };
      if (!res.ok || !res.token) return { ok: false, error: res.error ?? 'server' };
      this._value = sanitizeProfile({ ...this._value, guest: false, token: res.token, name }, this._value);
      if (res.profile) this.mergeServer(res.profile);
      else {
        this.save();
        this.emit();
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'server' };
    }
  }

  private async fetchJson(path: string, opts: { method: string; token?: string; body?: unknown }): Promise<unknown> {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : 0;
    try {
      const headers: Record<string, string> = {};
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
      const res = await fetch(`${this.apiBase}/${path}`, {
        method: opts.method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl?.signal,
      });
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────

  private load(): LocalProfile {
    if (!this.storage) return defaultProfile();
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) {
        const p = defaultProfile();
        this._value = p;
        this.save();
        return p;
      }
      const parsed = JSON.parse(raw) as { v?: number; data?: unknown };
      return sanitizeProfile(parsed.data ?? parsed);
    } catch (err) {
      console.warn('[profile] could not read saved profile', err);
      return defaultProfile();
    }
  }

  private save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, data: this._value }));
    } catch (err) {
      console.warn('[profile] save failed', err);
    }
  }

  private emit(): void {
    for (const cb of [...this.listeners]) {
      try {
        cb(this._value);
      } catch (err) {
        console.error('[profile] listener failed', err);
      }
    }
  }
}

export const profile = new ProfileStore();
