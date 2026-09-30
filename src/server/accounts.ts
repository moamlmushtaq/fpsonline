// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — optional player accounts.
//
// File-backed store (data/accounts.json) held fully in memory:
//  • Passwords: scrypt (N=16384, r=8, p=1, 64-byte key) with a per-user random
//    salt; parameters are stored per record so they can be raised later.
//    Verification uses timingSafeEqual; unknown names still burn one scrypt so
//    login timing does not reveal which names exist. Concurrent scrypt work is
//    bounded (it runs on libuv's small thread pool).
//  • Sessions: 32 random bytes (hex) handed to the client; only their SHA-256
//    is stored, so a leaked file holds no usable tokens. 90-day sliding expiry
//    (refreshed at most daily), at most 10 per user (oldest dropped).
//  • Writes: coalesced (debounced) and atomic — tmp file + fsync + rename.
//    If the data directory is not writable the store keeps working in memory
//    and logs loudly.
//  • Profiles: every client-supplied field is validated and clamped. Merge
//    policy on PUT: the server keeps the max XP (level derived from XP),
//    lifetime counters merge field-wise by max, loadout/cosmetics/faction follow
//    the newer `updatedAt`, rating is server-authoritative (HostCore reports it
//    through AccountHooks.recordMatch). Cosmetics are gated by level.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import path from 'node:path';
import { sanitizeLoadout } from '../shared/combat';
import { DEFAULT_RATING } from '../shared/constants';
import { defaultCosmetics, sanitizeCosmetics } from '../shared/cosmetics';
import type { AccountHooks } from '../shared/host/host-core';
import { isUnlocked, levelFromXp, MAX_LEVEL, totalXpForLevel } from '../shared/progression';
import type { AuthResponse, StoredProfile } from '../shared/protocol';
import type { CosmeticSelection } from '../shared/types';
import { WEAPON_IDS } from '../shared/types';
import type { LogFn } from './http-util';

export const ACCOUNT_NAME_RE = /^[A-Za-z0-9_-]{3,16}$/;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 256;
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_SESSIONS_PER_USER = 10;
export const TOKEN_RE = /^[0-9a-f]{64}$/;
export const RATING_MAX = 4000;
/** XP ceiling: generous headroom above max level (XP keeps counting after MAX_LEVEL). */
export const XP_MAX = totalXpForLevel(MAX_LEVEL) * 20;
const COUNTER_MAX = 1_000_000_000;
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;
const RESERVED_NAMES = new Set(['admin', 'administrator', 'moderator', 'mod', 'server', 'system', 'halcyon', 'bloom', 'root', 'support']);

const SCRYPT_KEYLEN = 64;
const SCRYPT_DEFAULT = { N: 16384, r: 8, p: 1 };
const SCRYPT_MAX_CONCURRENT = 4;
const SCRYPT_MAX_QUEUE = 64;

interface KdfRecord {
  alg: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
}

interface SessionRecord {
  /** SHA-256 (hex) of the token. */
  h: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number;
}

interface AccountRecord {
  id: string;
  name: string;
  /** Lower-cased name (uniqueness key). */
  key: string;
  kdf: KdfRecord;
  createdAt: number;
  lastLoginAt: number;
  profile: StoredProfile;
  sessions: SessionRecord[];
}

interface AccountsFile {
  version: 1;
  accounts: AccountRecord[];
}

export type AuthError = NonNullable<AuthResponse['error']>;
export type AuthResult = { ok: true; token: string; profile: StoredProfile } | { ok: false; error: AuthError };

export interface AccountStoreOptions {
  /** Directory for accounts.json (created if missing). */
  dataDir: string;
  log?: LogFn;
  /** Clock (ms); injectable for tests. */
  now?: () => number;
  /** Coalescing delay for writes (default 1500 ms). */
  saveDelayMs?: number;
  /** scrypt cost N for NEW hashes (default 16384). Existing records keep their own. */
  scryptN?: number;
}

// ── Validation helpers ──────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Account name rules: 3–16 of [A-Za-z0-9_-], not reserved. Returns the trimmed name or null. */
export function validateAccountName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!ACCOUNT_NAME_RE.test(name) || RESERVED_NAMES.has(name.toLowerCase())) return null;
  return name;
}

export function validatePassword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const pw = raw.normalize('NFC');
  const len = Array.from(pw).length;
  return len >= PASSWORD_MIN && pw.length <= PASSWORD_MAX ? pw : null;
}

/** Drops cosmetics the level has not unlocked (defaults instead); skins only for real weapons. */
export function gateCosmetics(c: CosmeticSelection, level: number): CosmeticSelection {
  const d = defaultCosmetics();
  const skins: CosmeticSelection['skins'] = {};
  for (const w of WEAPON_IDS) {
    const s = c.skins[w];
    if (typeof s === 'string' && s !== 'factory' && isUnlocked(level, 'skin', s, w)) skins[w] = s;
  }
  return {
    armor: isUnlocked(level, 'armor', c.armor) ? c.armor : d.armor,
    visor: isUnlocked(level, 'visor', c.visor) ? c.visor : d.visor,
    namecard: isUnlocked(level, 'namecard', c.namecard) ? c.namecard : d.namecard,
    elimFx: isUnlocked(level, 'elimFx', c.elimFx) ? c.elimFx : d.elimFx,
    skins,
  };
}

const LIFETIME_KEYS = ['matches', 'wins', 'kills', 'deaths', 'headshots', 'shots', 'hits', 'playSeconds'] as const;

function sanitizeLifetime(raw: unknown): StoredProfile['lifetime'] {
  const src = isObj(raw) ? raw : {};
  const out = {} as StoredProfile['lifetime'];
  for (const k of LIFETIME_KEYS) out[k] = clampInt(src[k], 0, COUNTER_MAX, 0);
  out.wins = Math.min(out.wins, out.matches);
  return out;
}

/**
 * Builds a fully valid StoredProfile from untrusted input. `name` is always the
 * account's name; `updatedAt` is clamped to `now` (no future timestamps).
 */
export function sanitizeStoredProfile(raw: unknown, name: string, now: number): StoredProfile {
  const p = isObj(raw) ? raw : {};
  const xp = clampInt(p.xp, 0, XP_MAX, 0);
  const level = levelFromXp(xp).level;
  return {
    name,
    xp,
    level,
    rating: clampInt(p.rating, 0, RATING_MAX, DEFAULT_RATING),
    loadout: sanitizeLoadout(isObj(p.loadout) ? p.loadout : undefined),
    cosmetics: gateCosmetics(sanitizeCosmetics(isObj(p.cosmetics) ? (p.cosmetics as Partial<CosmeticSelection>) : undefined), level),
    faction: p.faction === 1 ? 1 : 0,
    lifetime: sanitizeLifetime(p.lifetime),
    updatedAt: clampInt(p.updatedAt, 0, now, 0),
  };
}

/** Server-side merge of a (sanitized) client profile into the stored one. See file header. */
export function mergeProfiles(stored: StoredProfile, incoming: StoredProfile): StoredProfile {
  const xp = Math.max(stored.xp, incoming.xp);
  const level = levelFromXp(xp).level;
  const newer = incoming.updatedAt > stored.updatedAt;
  const src = newer ? incoming : stored;
  const lifetime = {} as StoredProfile['lifetime'];
  for (const k of LIFETIME_KEYS) lifetime[k] = Math.max(stored.lifetime[k], incoming.lifetime[k]);
  lifetime.wins = Math.min(lifetime.wins, lifetime.matches);
  return {
    name: stored.name,
    xp,
    level,
    rating: stored.rating,
    loadout: { ...src.loadout },
    cosmetics: gateCosmetics(src.cosmetics, level),
    faction: src.faction,
    lifetime,
    updatedAt: Math.max(stored.updatedAt, incoming.updatedAt),
  };
}

function cloneProfile(p: StoredProfile): StoredProfile {
  return JSON.parse(JSON.stringify(p)) as StoredProfile;
}

// ── scrypt with bounded concurrency ─────────────────────────────────────────

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
  ) {}
  /** Runs `fn` when a slot is free. Rejects immediately with 'busy' when the queue is full. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiting.length >= this.maxQueue) throw new Error('busy');
      // The releasing task hands its slot over directly (active stays counted).
      await new Promise<void>((r) => this.waiting.push(r));
    } else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

// ── Store ───────────────────────────────────────────────────────────────────

export class AccountStore {
  readonly file: string;
  private readonly log: LogFn;
  private readonly now: () => number;
  private readonly saveDelayMs: number;
  private readonly scryptN: number;
  private readonly byKey = new Map<string, AccountRecord>();
  /** sha256(token) → account. */
  private readonly bySession = new Map<string, AccountRecord>();
  private readonly kdfSlots = new Semaphore(SCRYPT_MAX_CONCURRENT, SCRYPT_MAX_QUEUE);
  private readonly dummySalt = randomBytes(16);
  private saveTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> | null = null;
  private dirty = false;
  private persistent = true;
  private closed = false;

  private constructor(opts: AccountStoreOptions) {
    this.file = path.join(path.resolve(opts.dataDir), 'accounts.json');
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.saveDelayMs = opts.saveDelayMs ?? 1500;
    this.scryptN = opts.scryptN ?? SCRYPT_DEFAULT.N;
  }

  /** Opens (and if needed creates) the store. Never throws for I/O problems: falls back to memory. */
  static async open(opts: AccountStoreOptions): Promise<AccountStore> {
    const store = new AccountStore(opts);
    await store.load();
    return store;
  }

  get size(): number {
    return this.byKey.size;
  }

  /** False when the data directory is not writable (accounts live in memory only). */
  get isPersistent(): boolean {
    return this.persistent;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async register(rawName: unknown, rawPassword: unknown, rawProfile?: unknown): Promise<AuthResult> {
    const name = validateAccountName(rawName);
    const password = validatePassword(rawPassword);
    if (!name || !password) return { ok: false, error: 'invalid' };
    const key = name.toLowerCase();
    if (this.byKey.has(key)) return { ok: false, error: 'name_taken' };
    let kdf: KdfRecord;
    try {
      kdf = await this.hashPassword(password);
    } catch (err) {
      this.log('register: hashing failed', err);
      return { ok: false, error: 'server' };
    }
    // Re-check: another registration for the same name may have completed while hashing.
    if (this.byKey.has(key)) return { ok: false, error: 'name_taken' };
    const now = this.now();
    const profile = sanitizeStoredProfile(rawProfile, name, now);
    // Without an uploaded profile, updatedAt 0 lets the client's first PUT set cosmetics/loadout.
    if (rawProfile === undefined || rawProfile === null) profile.updatedAt = 0;
    const acc: AccountRecord = {
      id: randomBytes(8).toString('hex'),
      name,
      key,
      kdf,
      createdAt: now,
      lastLoginAt: now,
      profile,
      sessions: [],
    };
    this.byKey.set(key, acc);
    const token = this.createSession(acc, now);
    this.scheduleSave();
    return { ok: true, token, profile: cloneProfile(acc.profile) };
  }

  async login(rawName: unknown, rawPassword: unknown): Promise<AuthResult> {
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    const password = typeof rawPassword === 'string' ? rawPassword.normalize('NFC') : '';
    if (!name || !password || password.length > PASSWORD_MAX || name.length > 32) return { ok: false, error: 'bad_credentials' };
    const acc = this.byKey.get(name.toLowerCase());
    let ok = false;
    try {
      if (acc) ok = await this.verifyPassword(password, acc.kdf);
      else await this.burnHash(password); // equalize timing for unknown names
    } catch (err) {
      this.log('login: hashing failed', err);
      return { ok: false, error: 'server' };
    }
    if (!acc || !ok) return { ok: false, error: 'bad_credentials' };
    const now = this.now();
    acc.lastLoginAt = now;
    const token = this.createSession(acc, now);
    this.scheduleSave();
    return { ok: true, token, profile: cloneProfile(acc.profile) };
  }

  /** Profile for a valid session token, else null. */
  getProfile(token: string): StoredProfile | null {
    const acc = this.accountFor(token, true);
    return acc ? cloneProfile(acc.profile) : null;
  }

  /** Merges an uploaded profile (see mergeProfiles). Returns the result, or null for a bad token. */
  putProfile(token: string, rawProfile: unknown): StoredProfile | null {
    const acc = this.accountFor(token, true);
    if (!acc) return null;
    const incoming = sanitizeStoredProfile(rawProfile, acc.name, this.now());
    const merged = mergeProfiles(acc.profile, incoming);
    if (JSON.stringify(merged) !== JSON.stringify(acc.profile)) {
      acc.profile = merged;
      this.scheduleSave();
    }
    return cloneProfile(acc.profile);
  }

  /** Revokes one session. Returns false if the token was unknown. */
  logout(token: string): boolean {
    if (!TOKEN_RE.test(token)) return false;
    const h = sha256(token);
    const acc = this.bySession.get(h);
    if (!acc) return false;
    this.bySession.delete(h);
    acc.sessions = acc.sessions.filter((s) => s.h !== h);
    this.scheduleSave();
    return true;
  }

  /** Account name for a token (diagnostics / tests). */
  nameFor(token: string): string | null {
    return this.accountFor(token, false)?.name ?? null;
  }

  /** HostCore integration: token → in-game identity; rated match results → stored rating. */
  hooks(): AccountHooks {
    return {
      resolve: async (token: string) => {
        const acc = this.accountFor(token, true);
        return acc ? { name: acc.name, rating: acc.profile.rating } : null;
      },
      recordMatch: (token: string, rating: number) => {
        const acc = this.accountFor(token, false);
        if (!acc) return;
        const r = clampInt(Math.round(rating), 0, RATING_MAX, acc.profile.rating);
        if (r === acc.profile.rating) return;
        // Rating is server-authoritative and not part of the updatedAt merge, so updatedAt is untouched.
        acc.profile.rating = r;
        this.scheduleSave();
      },
    };
  }

  /** Writes pending changes now (awaits any in-flight write). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    for (let attempt = 0; attempt < 3 && (this.dirty || this.writing); attempt++) {
      if (this.writing) {
        await this.writing.catch(() => {});
        continue;
      }
      try {
        await this.write();
      } catch {
        break; // already logged; don't spin on a broken disk
      }
    }
  }

  /** Flushes and stops timers. */
  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  private createSession(acc: AccountRecord, now: number): string {
    const token = randomBytes(32).toString('hex');
    const s: SessionRecord = { h: sha256(token), createdAt: now, expiresAt: now + SESSION_TTL_MS, lastUsedAt: now };
    this.pruneSessions(acc, now);
    acc.sessions.push(s);
    // Cap: drop the least recently used sessions.
    if (acc.sessions.length > MAX_SESSIONS_PER_USER) {
      acc.sessions.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
      for (const old of acc.sessions.splice(0, acc.sessions.length - MAX_SESSIONS_PER_USER)) this.bySession.delete(old.h);
    }
    this.bySession.set(s.h, acc);
    return token;
  }

  private pruneSessions(acc: AccountRecord, now: number): void {
    const keep: SessionRecord[] = [];
    for (const s of acc.sessions) {
      if (s.expiresAt > now) keep.push(s);
      else this.bySession.delete(s.h);
    }
    acc.sessions = keep;
  }

  /** Resolves a token; `touch` slides the expiry (persisted at most once a day per session). */
  private accountFor(token: string, touch: boolean): AccountRecord | null {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    const h = sha256(token);
    const acc = this.bySession.get(h);
    if (!acc) return null;
    const s = acc.sessions.find((x) => x.h === h);
    const now = this.now();
    if (!s || s.expiresAt <= now) {
      this.bySession.delete(h);
      if (s) {
        acc.sessions = acc.sessions.filter((x) => x !== s);
        this.scheduleSave();
      }
      return null;
    }
    if (touch && now - s.lastUsedAt >= SESSION_REFRESH_MS) {
      s.lastUsedAt = now;
      s.expiresAt = now + SESSION_TTL_MS;
      this.scheduleSave();
    }
    return acc;
  }

  // ── Password hashing ──────────────────────────────────────────────────────

  private scryptOpts(N: number, r: number, p: number): ScryptOptions {
    return { N, r, p, maxmem: 128 * N * r * p + 16 * 1024 * 1024 };
  }

  private async hashPassword(password: string): Promise<KdfRecord> {
    const salt = randomBytes(16);
    const { r, p } = SCRYPT_DEFAULT;
    const N = this.scryptN;
    const key = await this.kdfSlots.run(() => scryptAsync(password, salt, SCRYPT_KEYLEN, this.scryptOpts(N, r, p)));
    return { alg: 'scrypt', N, r, p, salt: salt.toString('hex'), hash: key.toString('hex') };
  }

  private async verifyPassword(password: string, kdf: KdfRecord): Promise<boolean> {
    const expected = Buffer.from(kdf.hash, 'hex');
    const key = await this.kdfSlots.run(() =>
      scryptAsync(password, Buffer.from(kdf.salt, 'hex'), expected.length || SCRYPT_KEYLEN, this.scryptOpts(kdf.N, kdf.r, kdf.p)),
    );
    return key.length === expected.length && timingSafeEqual(key, expected);
  }

  private async burnHash(password: string): Promise<void> {
    const { r, p } = SCRYPT_DEFAULT;
    await this.kdfSlots.run(() => scryptAsync(password, this.dummySalt, SCRYPT_KEYLEN, this.scryptOpts(this.scryptN, r, p)));
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    const dir = path.dirname(this.file);
    try {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.access(dir, fsConstants.W_OK);
    } catch (err) {
      this.persistent = false;
      this.log(`accounts: data dir ${dir} is not writable — accounts will NOT persist`, (err as Error).message);
    }
    // Leftovers of writes interrupted by a crash.
    try {
      const base = path.basename(this.file);
      for (const f of await fsp.readdir(dir)) {
        if (f.startsWith(`${base}.`) && f.endsWith('.tmp')) await fsp.unlink(path.join(dir, f)).catch(() => {});
      }
    } catch {
      /* directory missing / unreadable */
    }
    let text: string;
    try {
      text = await fsp.readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log('accounts: cannot read', this.file, (err as Error).message);
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      const aside = `${this.file}.corrupt-${this.now()}`;
      this.log(`accounts: ${this.file} is corrupt — moved to ${aside}, starting empty`);
      await fsp.rename(this.file, aside).catch(() => {});
      return;
    }
    const list = isObj(data) && Array.isArray(data.accounts) ? data.accounts : [];
    const now = this.now();
    let skipped = 0;
    for (const raw of list) {
      const acc = this.reviveRecord(raw, now);
      if (!acc || this.byKey.has(acc.key)) {
        skipped++;
        continue;
      }
      this.byKey.set(acc.key, acc);
      for (const s of acc.sessions) this.bySession.set(s.h, acc);
    }
    if (skipped) this.log(`accounts: skipped ${skipped} invalid record(s)`);
  }

  /** Validates a record read from disk (re-sanitizing its profile against the current catalog). */
  private reviveRecord(raw: unknown, now: number): AccountRecord | null {
    if (!isObj(raw) || !isObj(raw.kdf)) return null;
    const name = validateAccountName(raw.name) ?? (typeof raw.name === 'string' && ACCOUNT_NAME_RE.test(raw.name) ? raw.name : null);
    const k = raw.kdf;
    if (!name || k.alg !== 'scrypt' || typeof k.salt !== 'string' || typeof k.hash !== 'string') return null;
    const N = clampInt(k.N, 2, 1 << 20, 0);
    const r = clampInt(k.r, 1, 64, 0);
    const p = clampInt(k.p, 1, 16, 0);
    if (!N || !r || !p || (N & (N - 1)) !== 0) return null;
    const sessions: SessionRecord[] = [];
    if (Array.isArray(raw.sessions)) {
      for (const s of raw.sessions) {
        if (!isObj(s) || typeof s.h !== 'string' || !/^[0-9a-f]{64}$/.test(s.h)) continue;
        const expiresAt = clampInt(s.expiresAt, 0, Number.MAX_SAFE_INTEGER, 0);
        if (expiresAt <= now) continue;
        sessions.push({
          h: s.h,
          createdAt: clampInt(s.createdAt, 0, now, now),
          expiresAt,
          lastUsedAt: clampInt(s.lastUsedAt, 0, now, now),
        });
      }
    }
    return {
      id: typeof raw.id === 'string' ? raw.id : randomBytes(8).toString('hex'),
      name,
      key: name.toLowerCase(),
      kdf: { alg: 'scrypt', N, r, p, salt: k.salt, hash: k.hash },
      createdAt: clampInt(raw.createdAt, 0, now, now),
      lastLoginAt: clampInt(raw.lastLoginAt, 0, now, now),
      profile: sanitizeStoredProfile(raw.profile, name, now),
      sessions: sessions.slice(-MAX_SESSIONS_PER_USER),
    };
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer || this.closed) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.writing) {
        // A write is in flight: try again once it settles.
        this.writing.finally(() => this.dirty && this.scheduleSave()).catch(() => {});
        return;
      }
      this.write().catch(() => {
        // Retry later (already logged); keeps data in memory meanwhile.
        if (!this.closed) setTimeout(() => this.scheduleSave(), 5000).unref();
      });
    }, this.saveDelayMs);
    this.saveTimer.unref();
  }

  private write(): Promise<void> {
    if (!this.persistent) {
      this.dirty = false;
      return Promise.resolve();
    }
    this.dirty = false;
    const now = this.now();
    for (const acc of this.byKey.values()) this.pruneSessions(acc, now);
    const data: AccountsFile = { version: 1, accounts: [...this.byKey.values()] };
    const text = JSON.stringify(data);
    const tmp = `${this.file}.${process.pid}.tmp`;
    const job = (async () => {
      const fh = await fsp.open(tmp, 'w', 0o600);
      try {
        await fh.writeFile(text, 'utf8');
        await fh.sync();
      } finally {
        await fh.close();
      }
      await fsp.rename(tmp, this.file);
    })().catch((err: unknown) => {
      this.dirty = true;
      this.log('accounts: write failed', (err as Error).message);
      throw err;
    });
    this.writing = job.finally(() => {
      this.writing = null;
    });
    // Callers await the job itself; `writing` swallows nothing (it is only used for sequencing).
    this.writing.catch(() => {});
    return job;
  }
}
