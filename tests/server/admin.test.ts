// Admin console authorization on the Node server: ADMIN_PASSWORD (constant-time
// compare), optional ADMIN_ACCOUNTS, per-connection lockout, audit logging, and
// the real WebSocket path (auth → cheats honoured; unauthenticated → refused).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../../src/shared/constants';
import { HostCore, type AccountHooks, type HostConnection } from '../../src/shared/host/host-core';
import type { ClientMsg, HelloMsg, ServerMsg } from '../../src/shared/protocol';
import { ADMIN_LOCKOUT_MS, ADMIN_MAX_FAILS, createAdminAuth, parseAdminAccounts } from '../../src/server/admin';
import { startServer, type RunningServer } from '../../src/server/index';

type AdminReply = Extract<ServerMsg, { type: 'admin' }>;

function hello(name: string, over: Partial<HelloMsg> = {}): HelloMsg {
  return {
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    name,
    platform: 'desktop',
    lang: 'en',
    level: 3,
    rating: 1000,
    loadout: { primary: 'meridian', throwable: 'smoke' },
    cosmetics: { armor: 'standard', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: {} },
    faction: 0,
    ...over,
  };
}

describe('createAdminAuth', () => {
  it('is disabled without a password', () => {
    const a = createAdminAuth({ password: '' });
    expect(a.enabled).toBe(false);
    expect(a.verify({ connId: 'c', password: '', account: null })).toEqual({ ok: false, message: 'disabled' });
  });

  it('accepts the exact password only', () => {
    const a = createAdminAuth({ password: 'Sesame-42' });
    expect(a.enabled).toBe(true);
    expect(a.verify({ connId: 'c', password: 'Sesame-42', account: null }).ok).toBe(true);
    expect(a.verify({ connId: 'c', password: 'sesame-42', account: null })).toEqual({ ok: false, message: 'denied' });
    expect(a.verify({ connId: 'c', password: 'Sesame-42 ', account: null }).ok).toBe(false);
    expect(a.verify({ connId: 'c', password: '', account: null }).ok).toBe(false);
  });

  it(`locks a connection out for a minute after ${ADMIN_MAX_FAILS} failures (even for the right password)`, () => {
    let now = 1_000_000;
    const a = createAdminAuth({ password: 'pw', now: () => now });
    for (let i = 0; i < ADMIN_MAX_FAILS - 1; i++) expect(a.verify({ connId: 'x', password: 'nope', account: null }).message).toBe('denied');
    expect(a.verify({ connId: 'x', password: 'nope', account: null }).message).toBe('locked');
    expect(a.verify({ connId: 'x', password: 'pw', account: null })).toEqual({ ok: false, message: 'locked' });
    // Other connections are unaffected.
    expect(a.verify({ connId: 'y', password: 'pw', account: null }).ok).toBe(true);
    now += ADMIN_LOCKOUT_MS - 1;
    expect(a.verify({ connId: 'x', password: 'pw', account: null }).message).toBe('locked');
    now += 2;
    expect(a.verify({ connId: 'x', password: 'pw', account: null }).ok).toBe(true);
  });

  it('forget() drops the counters of a closed connection', () => {
    const a = createAdminAuth({ password: 'pw', maxFails: 2 });
    a.verify({ connId: 'z', password: 'a', account: null });
    a.forget?.('z');
    expect(a.verify({ connId: 'z', password: 'b', account: null }).message).toBe('denied');
  });

  it('ADMIN_ACCOUNTS restricts access to those signed-in accounts (case-insensitive)', () => {
    expect(parseAdminAccounts(' Alice, bob ,,alice')).toEqual(['alice', 'bob']);
    const a = createAdminAuth({ password: 'pw', accounts: 'Alice,Bob' });
    expect(a.verify({ connId: 'c', password: 'pw', account: null }).ok).toBe(false);
    expect(a.verify({ connId: 'c', password: 'pw', account: 'Mallory' }).ok).toBe(false);
    expect(a.verify({ connId: 'c', password: 'pw', account: 'ALICE' }).ok).toBe(true);
    expect(a.verify({ connId: 'd', password: 'wrong', account: 'bob' }).ok).toBe(false);
  });
});

class FakeConn implements HostConnection {
  readonly msgs: ServerMsg[] = [];
  constructor(readonly id: string) {}
  send(msg: ServerMsg): void {
    this.msgs.push(JSON.parse(JSON.stringify(msg)));
  }
  admin(): AdminReply[] {
    return this.msgs.filter((m): m is AdminReply => m.type === 'admin');
  }
}

describe('HostCore (online) admin authorization', () => {
  const accounts: AccountHooks = {
    resolve: async (token) => (token === 'tok-alice' ? { name: 'Alice', rating: 1200 } : null),
    recordMatch: () => {},
  };

  it('honours ADMIN_ACCOUNTS through the account the hello token resolved to, and ignores `trusted`', async () => {
    const log: string[] = [];
    const host = new HostCore({ kind: 'online', accounts, admin: createAdminAuth({ password: 'pw', accounts: 'alice' }), log: (...a) => log.push(a.join(' ')) });
    const guest = new FakeConn('g');
    host.connect(guest);
    host.receive(guest, hello('Guest'));
    host.receive(guest, { type: 'admin', action: 'auth', password: 'pw' });
    host.receive(guest, { type: 'admin', action: 'auth', password: '', trusted: true });
    expect(guest.admin().map((m) => m.ok)).toEqual([false, false]);

    const alice = new FakeConn('a');
    host.connect(alice);
    host.receive(alice, hello('Alice', { token: 'tok-alice' }));
    await new Promise((r) => setTimeout(r, 0));
    host.receive(alice, { type: 'admin', action: 'auth', password: 'pw' });
    expect(alice.admin()[0]).toMatchObject({ ok: true, state: { authorized: true, inMatch: false } });
    expect(log.some((l) => l.includes('admin: auth GRANTED') && l.includes('account Alice'))).toBe(true);
    expect(log.some((l) => l.includes('admin: auth refused'))).toBe(true);
  });

  it('without AdminHooks admin is disabled online', () => {
    const host = new HostCore({ kind: 'online' });
    const c = new FakeConn('c');
    host.connect(c);
    host.receive(c, hello('X'));
    host.receive(c, { type: 'admin', action: 'auth', password: 'anything', trusted: true });
    host.receive(c, { type: 'admin', action: 'cheat', cheat: 'god', value: true });
    expect(c.admin()).toEqual([
      { type: 'admin', ok: false, message: 'disabled' },
      { type: 'admin', ok: false, message: 'unauthorized' },
    ]);
  });
});

// ── Real server over WebSocket ──────────────────────────────────────────────

class Client {
  readonly msgs: ServerMsg[] = [];
  private waiters: (() => void)[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      this.msgs.push(JSON.parse(d.toString()) as ServerMsg);
      for (const w of this.waiters.splice(0)) w();
    });
  }
  static open(url: string): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const c = new Client(ws);
      ws.once('open', () => resolve(c));
      ws.once('error', reject);
    });
  }
  send(m: ClientMsg): void {
    this.ws.send(JSON.stringify(m));
  }
  async next<T extends ServerMsg['type']>(type: T, from: number, timeoutMs = 5000): Promise<Extract<ServerMsg, { type: T }>> {
    const t0 = Date.now();
    for (;;) {
      for (let i = from; i < this.msgs.length; i++) if (this.msgs[i].type === type) return this.msgs[i] as Extract<ServerMsg, { type: T }>;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${type}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
  /** Sends and resolves with the admin reply to it. */
  async admin(m: ClientMsg): Promise<AdminReply> {
    const from = this.msgs.length;
    this.send(m);
    return this.next('admin', from);
  }
}

describe('Node server: ADMIN_PASSWORD over WebSocket', () => {
  let srv: RunningServer;
  let off: RunningServer;
  let tmp: string;
  const logs: string[] = [];
  const clients: Client[] = [];

  async function connect(url: string, name: string): Promise<Client> {
    const c = await Client.open(url);
    clients.push(c);
    c.send(hello(name));
    await c.next('welcome', 0);
    return c;
  }

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'hf-admin-'));
    const common = { host: '127.0.0.1', dev: false, clientDir: path.join(tmp, 'none'), prewarm: false } as const;
    srv = await startServer({ ...common, port: 0, dataDir: path.join(tmp, 'a'), adminPassword: 'correct horse', log: (...a: unknown[]) => logs.push(a.map(String).join(' ')) });
    off = await startServer({ ...common, port: 0, dataDir: path.join(tmp, 'b'), adminPassword: '', log: false });
  });

  afterAll(async () => {
    for (const c of clients) c.ws.terminate();
    await srv?.close();
    await off?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('success: the right password authorizes the connection and its cheats are applied', async () => {
    const c = await connect(`ws://127.0.0.1:${srv.port}/ws`, 'Owner');
    expect(await c.admin({ type: 'admin', action: 'cheat', cheat: 'god', value: true })).toMatchObject({ ok: false, message: 'unauthorized' });
    expect(await c.admin({ type: 'admin', action: 'auth', password: 'correct horse' })).toMatchObject({ ok: true, state: { authorized: true } });
    expect(await c.admin({ type: 'admin', action: 'cheat', cheat: 'god', value: true })).toMatchObject({ ok: false, message: 'no_match' });
    const from = c.msgs.length;
    c.send({ type: 'queue', mode: 'tdm', map: 'gantry', botDifficulty: 'recruit', kind: 'bots' });
    await c.next('matchStart', from, 15000);
    const r = await c.admin({ type: 'admin', action: 'cheat', cheat: 'god', value: true });
    expect(r).toMatchObject({ ok: true, state: { god: true, inMatch: true } });
    expect((await c.admin({ type: 'admin', action: 'cheat', cheat: 'speed', value: 2.5 })).state?.speed).toBe(2.5);
    // The self snapshot carries the predicted cheat fields.
    const s0 = c.msgs.length;
    let snap = await c.next('snap', s0);
    while (!snap.self) snap = await c.next('snap', c.msgs.indexOf(snap) + 1);
    expect(snap.self.combat.cheatSpeed).toBe(2.5);
    expect(logs.some((l) => l.includes('admin: auth GRANTED'))).toBe(true);
    expect(logs.some((l) => /admin: Owner .* god true → ok/.test(l))).toBe(true);
  }, 30000);

  it('failure + lockout: wrong passwords are refused, then the connection is locked out', async () => {
    const c = await connect(`ws://127.0.0.1:${srv.port}/ws`, 'Intruder');
    for (let i = 0; i < ADMIN_MAX_FAILS - 1; i++) expect(await c.admin({ type: 'admin', action: 'auth', password: `guess${i}` })).toEqual({ type: 'admin', ok: false, message: 'denied' });
    expect((await c.admin({ type: 'admin', action: 'auth', password: 'last guess' })).message).toBe('locked');
    expect(await c.admin({ type: 'admin', action: 'auth', password: 'correct horse' })).toEqual({ type: 'admin', ok: false, message: 'locked' });
    expect((await c.admin({ type: 'admin', action: 'cheat', cheat: 'killbots' })).message).toBe('unauthorized');
    // `trusted` (the offline host's flag) means nothing online.
    expect((await c.admin({ type: 'admin', action: 'auth', password: '', trusted: true })).ok).toBe(false);
    expect(logs.some((l) => l.includes("refused cheat 'killbots'"))).toBe(true);
  }, 20000);

  it('ADMIN_PASSWORD unset: admin is disabled online', async () => {
    const c = await connect(`ws://127.0.0.1:${off.port}/ws`, 'Someone');
    expect(await c.admin({ type: 'admin', action: 'auth', password: '' })).toEqual({ type: 'admin', ok: false, message: 'disabled' });
    expect(await c.admin({ type: 'admin', action: 'auth', password: 'correct horse' })).toEqual({ type: 'admin', ok: false, message: 'disabled' });
  });
});
