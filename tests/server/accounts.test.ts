// Accounts: the file-backed store (validation, hashing, sessions, merge policy,
// persistence) and the REST API on a running server (status codes, auth,
// body limits, CORS, per-IP rate limit).

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RATING } from '../../src/shared/constants';
import { levelFromXp, totalXpForLevel } from '../../src/shared/progression';
import type { StoredProfile } from '../../src/shared/protocol';
import { AccountStore, MAX_SESSIONS_PER_USER, SESSION_TTL_MS } from '../../src/server/accounts';
import { startServer, type RunningServer } from '../../src/server/index';

const DAY = 24 * 60 * 60 * 1000;
const tmpDirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'hf-acc-'));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** A store with a controllable clock and cheap scrypt (the cost parameter is stored per record). */
async function openStore(dir = tmpDir(), clock = { t: 1_700_000_000_000 }) {
  const store = await AccountStore.open({ dataDir: dir, now: () => clock.t, saveDelayMs: 10, scryptN: 1024 });
  return { store, dir, clock };
}

function profileInput(over: Partial<StoredProfile> = {}): Partial<StoredProfile> {
  return {
    name: 'ignored',
    xp: 0,
    level: 1,
    rating: 1000,
    loadout: { primary: 'swift', throwable: 'smoke' },
    cosmetics: { armor: 'standard', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: {} },
    faction: 1,
    lifetime: { matches: 1, wins: 1, kills: 5, deaths: 3, headshots: 1, shots: 100, hits: 40, playSeconds: 400 },
    updatedAt: 1_600_000_000_000,
    ...over,
  };
}

describe('AccountStore', () => {
  it('registers with validated names/passwords and case-insensitive uniqueness', async () => {
    const { store } = await openStore();
    for (const bad of ['ab', 'has space', 'x'.repeat(17), 'émile', 'admin', '', 42]) {
      expect(await store.register(bad, 'password1')).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await store.register('Valid_Name', '12345')).toEqual({ ok: false, error: 'invalid' });
    const ok = await store.register('  Pilot-One ', 'secret99');
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.token).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.profile).toMatchObject({ name: 'Pilot-One', xp: 0, level: 1, rating: DEFAULT_RATING });
    expect(await store.register('PILOT-one', 'another1')).toEqual({ ok: false, error: 'name_taken' });
  });

  it('logs in with the right password only; unknown names look the same as wrong passwords', async () => {
    const { store } = await openStore();
    await store.register('Kestrel', 'correct-horse');
    expect(await store.login('Kestrel', 'wrong-horse')).toEqual({ ok: false, error: 'bad_credentials' });
    expect(await store.login('Nobody', 'correct-horse')).toEqual({ ok: false, error: 'bad_credentials' });
    const ok = await store.login('kestrel', 'correct-horse');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(store.getProfile(ok.token)?.name).toBe('Kestrel');
  });

  it('sanitizes uploaded profiles: level from XP, clamps, cosmetics gated by level', async () => {
    const { store, clock } = await openStore();
    const xp = totalXpForLevel(6) + 10; // level 6
    const r = await store.register('Gated', 'password', {
      ...profileInput({ xp, level: 49, rating: 99999, updatedAt: clock.t + 10 * DAY }),
      cosmetics: {
        armor: 'slate', // level 6 → allowed
        visor: 'halo', // level 26 → rejected
        namecard: 'nope', // unknown
        elimFx: 'default',
        skins: { meridian: 'sunburst', longline: 'orbital', bogus: 'factory' } as never,
      },
      loadout: { primary: 'sunspear', throwable: 'nuke' } as never,
      lifetime: { matches: 2, wins: 9, kills: -4, deaths: 1e20, headshots: 'x', shots: 1, hits: 1, playSeconds: 1.7 } as never,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.profile;
    expect(p.level).toBe(levelFromXp(xp).level);
    expect(p.level).toBe(6);
    expect(p.rating).toBe(4000);
    expect(p.updatedAt).toBe(clock.t); // future timestamps clamped
    expect(p.cosmetics).toEqual({ armor: 'slate', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: { meridian: 'sunburst' } });
    expect(p.loadout).toEqual({ primary: 'meridian', throwable: 'grenade' });
    expect(p.lifetime).toMatchObject({ matches: 2, wins: 2, kills: 0, headshots: 0, playSeconds: 1 });
    expect(p.lifetime.deaths).toBeLessThanOrEqual(1e9);
  });

  it('merges PUTs: max XP, newer updatedAt wins cosmetics/loadout, rating stays server-side', async () => {
    const { store, clock } = await openStore();
    const reg = await store.register('Merger', 'password', profileInput({ xp: 5000, updatedAt: clock.t - 1000 }));
    if (!reg.ok) throw new Error('register failed');
    const t = reg.token;

    // Older client data: XP lower (kept at max), cosmetics/loadout ignored, lifetime merged by max.
    let p = store.putProfile(t, profileInput({ xp: 100, rating: 3000, updatedAt: clock.t - 5000, loadout: { primary: 'breaker', throwable: 'grenade' }, lifetime: { matches: 9, wins: 0, kills: 0, deaths: 0, headshots: 0, shots: 0, hits: 0, playSeconds: 0 } }))!;
    expect(p.xp).toBe(5000);
    expect(p.level).toBe(levelFromXp(5000).level);
    expect(p.rating).toBe(1000);
    expect(p.loadout.primary).toBe('swift');
    expect(p.lifetime.matches).toBe(9);
    expect(p.lifetime.kills).toBe(5);

    // Newer client data: its loadout/faction apply, XP grows.
    p = store.putProfile(t, profileInput({ xp: 9000, faction: 0, updatedAt: clock.t, loadout: { primary: 'longline', throwable: 'grenade' } }))!;
    expect(p).toMatchObject({ xp: 9000, faction: 0, loadout: { primary: 'longline', throwable: 'grenade' }, updatedAt: clock.t, name: 'Merger' });
    expect(store.putProfile('f'.repeat(64), profileInput())).toBeNull();
  });

  it('sessions: capped per user, 90-day sliding expiry, logout revokes', async () => {
    const { store, clock } = await openStore();
    const reg = await store.register('Sessions', 'password');
    if (!reg.ok) throw new Error('register failed');
    const tokens = [reg.token];
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 1; i++) {
      clock.t += 1000;
      const r = await store.login('Sessions', 'password');
      if (r.ok) tokens.push(r.token);
    }
    // Oldest two dropped (12 created, 10 kept).
    expect(store.getProfile(tokens[0])).toBeNull();
    expect(store.getProfile(tokens[1])).toBeNull();
    expect(store.getProfile(tokens[2])).not.toBeNull();

    const hooks = store.hooks();
    const last = tokens[tokens.length - 1];
    expect(await hooks.resolve(last)).toEqual({ name: 'Sessions', rating: DEFAULT_RATING });
    clock.t += 60 * DAY; // used at day 60 → expiry slides
    expect(store.getProfile(last)).not.toBeNull();
    clock.t += 80 * DAY; // day 140: still within 90 days of last use
    expect(store.getProfile(last)).not.toBeNull();
    clock.t += SESSION_TTL_MS + 1; // unused for > 90 days
    expect(store.getProfile(last)).toBeNull();
    expect(await hooks.resolve(last)).toBeNull();

    const fresh = await store.login('Sessions', 'password');
    if (!fresh.ok) throw new Error('login failed');
    expect(store.logout(fresh.token)).toBe(true);
    expect(store.logout(fresh.token)).toBe(false);
    expect(store.getProfile(fresh.token)).toBeNull();
    expect(await hooks.resolve('not-a-token')).toBeNull();
  });

  it('AccountHooks.recordMatch updates the stored rating', async () => {
    const { store } = await openStore();
    const reg = await store.register('Rated', 'password');
    if (!reg.ok) throw new Error('register failed');
    store.hooks().recordMatch(reg.token, 1234.4);
    expect(store.getProfile(reg.token)?.rating).toBe(1234);
    store.hooks().recordMatch(reg.token, -50);
    expect(store.getProfile(reg.token)?.rating).toBe(0);
  });

  it('persists atomically and reloads (hashed tokens only on disk)', async () => {
    const dir = tmpDir();
    const { store, clock } = await openStore(dir);
    const reg = await store.register('Durable', 'password1', profileInput({ xp: 1234 }));
    if (!reg.ok) throw new Error('register failed');
    store.hooks().recordMatch(reg.token, 1111);
    await store.close();

    const file = path.join(dir, 'accounts.json');
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain(reg.token);
    expect(raw).not.toContain('password1');
    expect(JSON.parse(raw).accounts).toHaveLength(1);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toHaveLength(0);

    const { store: again } = await openStore(dir, clock);
    expect(again.size).toBe(1);
    expect(again.getProfile(reg.token)).toMatchObject({ name: 'Durable', xp: 1234, rating: 1111 });
    expect((await again.login('durable', 'password1')).ok).toBe(true);
    await again.close();
  });

  it('moves a corrupt file aside instead of crashing or overwriting it', async () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, 'accounts.json'), '{"version":1,"accounts":[{broken');
    const { store } = await openStore(dir);
    expect(store.size).toBe(0);
    expect(readdirSync(dir).some((f) => f.startsWith('accounts.json.corrupt-'))).toBe(true);
    await store.close();
  });
});

// ── REST API ────────────────────────────────────────────────────────────────

let srv: RunningServer;
let limited: RunningServer;

beforeAll(async () => {
  const opts = { port: 0, host: '127.0.0.1', dev: false, log: false as const, prewarm: false, clientDir: path.join(tmpDir(), 'none') };
  srv = await startServer({ ...opts, dataDir: tmpDir(), authRateLimit: 1000 });
  limited = await startServer({ ...opts, dataDir: tmpDir() });
});

afterAll(async () => {
  await srv?.close();
  await limited?.close();
});

async function api(base: string, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, json };
}

describe('Accounts REST API', () => {
  it('register → login → profile GET/PUT → logout', async () => {
    const reg = await api(srv.url, 'POST', '/api/register', { name: 'RestUser', password: 'secret12', profile: profileInput({ xp: 2000 }) });
    expect(reg.status).toBe(200);
    expect(reg.json).toMatchObject({ ok: true, profile: { name: 'RestUser', xp: 2000 } });
    expect(reg.headers.get('cache-control')).toBe('no-store');

    expect((await api(srv.url, 'POST', '/api/register', { name: 'restuser', password: 'secret12' })).status).toBe(409);
    expect((await api(srv.url, 'POST', '/api/register', { name: 'x', password: 'secret12' })).json).toEqual({ ok: false, error: 'invalid' });

    const bad = await api(srv.url, 'POST', '/api/login', { name: 'RestUser', password: 'nope-nope' });
    expect(bad.status).toBe(401);
    expect(bad.json).toEqual({ ok: false, error: 'bad_credentials' });

    const login = await api(srv.url, 'POST', '/api/login', { name: 'RESTUSER', password: 'secret12' });
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.json.token}` };

    const get = await api(srv.url, 'GET', '/api/profile', undefined, auth);
    expect(get.status).toBe(200);
    expect(get.json.profile).toMatchObject({ name: 'RestUser', xp: 2000 });

    const put = await api(srv.url, 'PUT', '/api/profile', { profile: profileInput({ xp: 3000, updatedAt: Date.now() }) }, auth);
    expect(put.status).toBe(200);
    expect(put.json.profile).toMatchObject({ xp: 3000, level: levelFromXp(3000).level, name: 'RestUser' });

    expect((await api(srv.url, 'PUT', '/api/profile', { nope: 1 }, auth)).status).toBe(400);
    expect((await api(srv.url, 'GET', '/api/profile')).status).toBe(401);
    expect((await api(srv.url, 'GET', '/api/profile', undefined, { Authorization: 'Bearer abc' })).status).toBe(401);

    expect((await api(srv.url, 'POST', '/api/logout', undefined, auth)).status).toBe(200);
    expect((await api(srv.url, 'GET', '/api/profile', undefined, auth)).status).toBe(401);
  });

  it('rejects wrong methods, non-JSON bodies and oversized bodies', async () => {
    expect((await api(srv.url, 'GET', '/api/login')).status).toBe(405);
    expect((await api(srv.url, 'POST', '/api/login', 'name=a&password=b', { 'Content-Type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await api(srv.url, 'POST', '/api/login', '{oops')).status).toBe(400);
    const huge = await api(srv.url, 'POST', '/api/register', { name: 'Huge', password: 'x'.repeat(40_000) });
    expect(huge.status).toBe(413);
    expect((await api(srv.url, 'GET', '/api/nothing')).status).toBe(404);
  });

  it('CORS only on /api/status', async () => {
    const st = await api(srv.url, 'GET', '/api/status');
    expect(st.status).toBe(200);
    expect(st.json).toMatchObject({ online: 0, version: expect.any(String), rooms: 0 });
    expect(st.headers.get('access-control-allow-origin')).toBe('*');
    const pre = await fetch(`${srv.url}/api/status`, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    const login = await api(srv.url, 'POST', '/api/login', { name: 'a', password: 'b' });
    expect(login.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rate-limits login/register per IP (10/min)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await api(limited.url, 'POST', i % 2 ? '/api/login' : '/api/register', { name: `Rl${i}xx`, password: 'bad' });
      statuses.push(r.status);
      if (r.status === 429) {
        expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
        expect(r.json).toEqual({ ok: false, error: 'server' });
      }
    }
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // Other endpoints are unaffected.
    expect((await api(limited.url, 'GET', '/api/status')).status).toBe(200);
  });
});
