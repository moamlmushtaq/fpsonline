import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, QUEUE_BOT_FILL_AFTER, ROOM_CODE_LENGTH } from '../../src/shared/constants';
import { HostCore, type AccountHooks, type HostConnection } from '../../src/shared/host/host-core';
import { Matchmaker } from '../../src/shared/host/matchmaker';
import { LOAD_HOLD_MAX_TICKS } from '../../src/shared/host/room';
import type { ClientMsg, HelloMsg, ServerMsg } from '../../src/shared/protocol';
import { cloneCombatState, stepPlayer } from '../../src/shared/combat';
import { SIM_DT } from '../../src/shared/constants';
import { getMap } from '../../src/shared/maps/index';
import { cloneMoveState } from '../../src/shared/movement';
import { worldForMap } from '../../src/shared/sim/game';
import type { InputCmd } from '../../src/shared/types';
import { BTN_CROUCH, BTN_FIRE, BTN_JUMP, BTN_SPRINT } from '../../src/shared/types';

class FakeConn implements HostConnection {
  readonly msgs: ServerMsg[] = [];
  rttMs = 42;
  constructor(readonly id: string) {}
  send(msg: ServerMsg): void {
    // Round-trip through JSON like a real transport (catches non-serializable payloads).
    this.msgs.push(JSON.parse(JSON.stringify(msg)));
  }
  of<T extends ServerMsg['type']>(t: T): Extract<ServerMsg, { type: T }>[] {
    return this.msgs.filter((m) => m.type === t) as Extract<ServerMsg, { type: T }>[];
  }
  last<T extends ServerMsg['type']>(t: T): Extract<ServerMsg, { type: T }> | undefined {
    const l = this.of(t);
    return l[l.length - 1];
  }
}

function hello(name: string, over: Partial<HelloMsg> = {}): HelloMsg {
  return {
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    name,
    platform: 'desktop',
    lang: 'en',
    level: 5,
    rating: 1000,
    loadout: { primary: 'swift', throwable: 'smoke' },
    cosmetics: { armor: 'standard', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: {} },
    faction: 1,
    ...over,
  };
}

class Harness {
  now = 1000;
  constructor(readonly host: HostCore) {}
  join(id: string, name = id, over: Partial<HelloMsg> = {}): FakeConn {
    const c = new FakeConn(id);
    this.host.connect(c);
    this.host.receive(c, hello(name, over));
    return c;
  }
  send(c: FakeConn, msg: ClientMsg): void {
    this.host.receive(c, msg);
  }
  /** Advances host time in ~16 ms frames. */
  advance(ms: number): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now = Math.min(end, this.now + 16);
      this.host.update(this.now);
    }
  }
}

describe('HostCore', () => {
  it('hello → welcome with sanitized, de-duplicated names', () => {
    const h = new Harness(new HostCore({ kind: 'online', seed: 1 }));
    const a = h.join('a', '  Ace\u0000 Pilot  ');
    const b = h.join('b', 'ace pilot');
    const c = h.join('c', '!!');
    expect(a.last('welcome')).toMatchObject({ type: 'welcome', protocol: PROTOCOL_VERSION, host: 'online', name: 'Ace Pilot' });
    expect(b.last('welcome')!.name).toBe('ace pilot2');
    expect(c.last('welcome')!.name).toMatch(/^[A-Za-z]+-[A-Za-z]+-\d\d$/);
    expect(h.host.onlineCount).toBe(3);
    const bad = new FakeConn('x');
    h.host.connect(bad);
    h.host.receive(bad, hello('Zed', { protocol: 999 }));
    expect(bad.last('error')?.code).toBe('bad_protocol');
    expect(bad.of('welcome').length).toBe(0);
    h.host.disconnect(a);
    expect(h.host.onlineCount).toBe(2);
  });

  it('queue bots → matchStart with full roster → snapshots with self, scoreboard, pong', () => {
    const h = new Harness(new HostCore({ kind: 'local', seed: 2 }));
    const a = h.join('a', 'Solo');
    h.send(a, { type: 'queue', mode: 'tdm', map: 'any', botDifficulty: 'elite', kind: 'bots' });
    const start = a.last('matchStart')!;
    expect(start).toBeTruthy();
    expect(start.config.mode).toBe('tdm');
    expect(start.config.botFill).toBe(true);
    expect(start.config.botDifficulty).toBe('elite');
    expect(['gantry', 'pastel', 'observatory']).toContain(start.config.map);
    expect(start.players.length).toBe(10);
    expect(start.players.find((p) => p.id === start.you)!.name).toBe('Solo');
    expect(start.players.find((p) => p.id === start.you)!.loadout.primary).toBe('swift');
    h.advance(1200);
    const snaps = a.of('snap');
    expect(snaps.length).toBeGreaterThan(15);
    const s = snaps[snaps.length - 1];
    expect(s.self).toBeTruthy();
    expect(s.self!.ack).toBe(0);
    expect(s.players.length).toBe(10);
    expect(a.of('scoreboard').length).toBeGreaterThanOrEqual(1);
    expect(a.last('scoreboard')!.rows.find((r) => r.id === start.you)!.ping).toBe(42);
    // Inputs are acknowledged.
    h.send(a, { type: 'input', cmds: [{ seq: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: 0, slot: 0, viewTick: 0 }] });
    h.advance(100);
    expect(a.last('snap')!.self!.ack).toBe(1);
    h.send(a, { type: 'ping', t: 1234 });
    expect(a.last('pong')).toMatchObject({ t: 1234 });
    expect(a.last('pong')!.tick).toBeGreaterThan(0);
    // Leaving closes the room (no humans left).
    h.send(a, { type: 'leave' });
    h.advance(50);
    expect(h.host.roomCount).toBe(0);
  });

  it('the countdown waits for humans still loading the match (bounded)', () => {
    const h = new Harness(new HostCore({ kind: 'local', seed: 3 }));
    const a = h.join('a', 'Loader');
    h.send(a, { type: 'queue', mode: 'tdm', map: 'gantry', botDifficulty: 'recruit', kind: 'bots' });
    const countdown = a.last('matchStart')!.config.countdown;
    expect(countdown).toBeGreaterThan(0);
    // Still loading: the countdown does not run.
    h.advance((countdown + 2) * 1000);
    expect(a.last('snap')!.clock.phase).toBe('countdown');
    expect(a.last('snap')!.clock.phaseLeft).toBeCloseTo(countdown, 5);
    // Loaded: the full countdown plays out, then the match is live.
    h.send(a, { type: 'loaded' });
    h.advance((countdown - 0.5) * 1000);
    expect(a.last('snap')!.clock.phase).toBe('countdown');
    h.advance(1000);
    expect(a.last('snap')!.clock.phase).toBe('live');

    // A client that never reports 'loaded' (old build, stuck tab) can't hold the room forever.
    const h2 = new Harness(new HostCore({ kind: 'local', seed: 4 }));
    const b = h2.join('b', 'Silent');
    h2.send(b, { type: 'queue', mode: 'tdm', map: 'gantry', botDifficulty: 'recruit', kind: 'bots' });
    h2.advance(15_000);
    expect(b.last('snap')!.clock.phase).toBe('countdown');
    h2.advance((LOAD_HOLD_MAX_TICKS / 60 - 15 + countdown + 0.5) * 1000);
    expect(b.last('snap')!.clock.phase).toBe('live');
  });

  it('solo queue starts the training range with the tutorial flag; leaving returns results', () => {
    const h = new Harness(new HostCore({ kind: 'local' }));
    const a = h.join('a', 'Trainee');
    h.send(a, { type: 'queue', mode: 'range', map: 'range', botDifficulty: 'recruit', kind: 'solo', tutorial: true });
    const start = a.last('matchStart')!;
    expect(start.config.mode).toBe('range');
    expect(start.config.tutorial).toBe(true);
    expect(start.players.length).toBe(1);
    h.advance(500);
    const snap = a.last('snap')!;
    expect(snap.targets.length).toBeGreaterThanOrEqual(16);
    expect(snap.zones.length).toBe(1);
    h.send(a, { type: 'range', action: 'difficulty', value: 2 });
    h.send(a, { type: 'leave' });
    expect(a.last('matchEnd')!.results.mode).toBe('range');
    expect(a.last('matchEnd')!.ratingDelta).toBe(0);
  });

  it('local host: quick play behaves like a bot match; private rooms are unavailable', () => {
    const h = new Harness(new HostCore({ kind: 'local' }));
    const a = h.join('a');
    h.send(a, { type: 'queue', mode: 'ffa', map: 'pastel', botDifficulty: 'recruit', kind: 'quick' });
    const start = a.last('matchStart')!;
    expect(start.config.mode).toBe('ffa');
    expect(start.config.map).toBe('pastel');
    expect(start.players.length).toBe(8);
    h.send(a, { type: 'createRoom', mode: 'tdm', map: 'gantry', botFill: true, botDifficulty: 'veteran' });
    expect(a.last('error')?.code).toBe('offline_unavailable');
    h.send(a, { type: 'joinRoom', code: 'ABCDE' });
    expect(a.of('error').length).toBe(2);
  });

  it('online quick play: groups queued players, fills bots after the wait, sends queue status', () => {
    const h = new Harness(new HostCore({ kind: 'online', seed: 3 }));
    const a = h.join('a');
    const b = h.join('b', 'b', { rating: 1100 });
    h.send(a, { type: 'queue', mode: 'tdm', map: 'any', botDifficulty: 'veteran', kind: 'quick' });
    h.advance(300);
    h.send(b, { type: 'queue', mode: 'tdm', map: 'any', botDifficulty: 'veteran', kind: 'quick' });
    expect(a.last('queueStatus')!.state).toBe('searching');
    h.advance(1500);
    expect(a.of('queueStatus').length).toBeGreaterThanOrEqual(3);
    expect(a.of('matchStart').length).toBe(0);
    h.advance(QUEUE_BOT_FILL_AFTER * 1000);
    const sa = a.last('matchStart')!;
    const sb = b.last('matchStart')!;
    expect(sa).toBeTruthy();
    expect(sb).toBeTruthy();
    expect(sa.seed).toBe(sb.seed);
    expect(sa.players.length).toBe(10);
    expect(sa.players.filter((p) => !p.isBot).length).toBe(2);
    expect(a.of('queueStatus').some((q) => q.state === 'found')).toBe(true);
    // A third player drops into the running match (replacing a bot).
    const c = h.join('c');
    h.send(c, { type: 'queue', mode: 'tdm', map: 'any', botDifficulty: 'veteran', kind: 'quick' });
    h.advance(300);
    const sc = c.last('matchStart')!;
    expect(sc).toBeTruthy();
    expect(sc.seed).toBe(sa.seed);
    expect(sc.players.length).toBe(10);
    expect(sc.players.filter((p) => !p.isBot).length).toBe(3);
    expect(h.host.roomCount).toBe(1);
    // A human leaving quick play is replaced by a bot.
    h.host.disconnect(b);
    h.advance(100);
    const last = a.last('snap')!;
    expect(last.players.length).toBe(10);
  });

  it('cancelQueue stops matchmaking', () => {
    const h = new Harness(new HostCore({ kind: 'online' }));
    const a = h.join('a');
    h.send(a, { type: 'queue', mode: 'control', map: 'any', botDifficulty: 'veteran', kind: 'quick' });
    h.send(a, { type: 'cancelQueue' });
    expect(a.last('queueStatus')!.state).toBe('cancelled');
    h.advance((QUEUE_BOT_FILL_AFTER + 1) * 1000);
    expect(a.of('matchStart').length).toBe(0);
  });

  it('private rooms: create, join, settings/team, start, host migration, back to lobby', () => {
    const h = new Harness(new HostCore({ kind: 'online', seed: 4 }));
    const a = h.join('a', 'Host');
    const b = h.join('b', 'Friend');
    h.send(a, { type: 'createRoom', mode: 'tdm', map: 'observatory', botFill: true, botDifficulty: 'recruit' });
    const rs = a.last('roomState')!;
    expect(rs.code).toMatch(new RegExp(`^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{${ROOM_CODE_LENGTH}}$`));
    expect(rs.players.length).toBe(1);
    expect(rs.players[0].host).toBe(true);
    expect(rs.state).toBe('lobby');
    h.send(b, { type: 'joinRoom', code: 'zzzzz' });
    expect(b.last('error')?.code).toBe('room_not_found');
    h.send(b, { type: 'joinRoom', code: rs.code.toLowerCase() });
    const rb = b.last('roomState')!;
    expect(rb.players.length).toBe(2);
    expect(rb.players.find((p) => p.id === rb.you)!.team).toBe(1);
    expect(a.last('roomState')!.players.length).toBe(2);
    // Only the host can change settings or start.
    h.send(b, { type: 'roomSettings', mode: 'ffa', map: 'pastel', botFill: false, botDifficulty: 'elite' });
    expect(b.last('error')?.code).toBe('not_host');
    h.send(b, { type: 'startRoom' });
    expect(b.of('matchStart').length).toBe(0);
    h.send(a, { type: 'roomSettings', mode: 'control', map: 'pastel', botFill: true, botDifficulty: 'elite' });
    expect(b.last('roomState')).toMatchObject({ mode: 'control', map: 'pastel', botDifficulty: 'elite' });
    h.send(b, { type: 'roomTeam', team: 0 });
    expect(b.last('roomState')!.players.every((p) => p.team === 0)).toBe(true);
    // Start.
    h.send(a, { type: 'startRoom' });
    const sa = a.last('matchStart')!;
    expect(sa.config.roomCode).toBe(rs.code);
    expect(sa.config.mode).toBe('control');
    expect(sa.players.filter((p) => !p.isBot).every((p) => p.team === 0)).toBe(true);
    expect(sa.players.length).toBe(10);
    expect(a.last('roomState')!.state).toBe('playing');
    // Late joiners are refused while playing.
    const c = h.join('c');
    h.send(c, { type: 'joinRoom', code: rs.code });
    expect(c.last('error')?.code).toBe('room_started');
    // Host leaves → migration to the friend.
    h.send(a, { type: 'leave' });
    expect(b.last('roomState')!.players.length).toBe(1);
    expect(b.last('roomState')!.players[0].host).toBe(true);
  });

  it('a finished private match returns everyone to the lobby with results and rating deltas', () => {
    const recorded: [string, number][] = [];
    const accounts: AccountHooks = {
      resolve: async (token) => (token === 'tok' ? { name: 'Registered', rating: 1200 } : null),
      recordMatch: (t, r) => recorded.push([t, r]),
    };
    const h = new Harness(new HostCore({ kind: 'online', seed: 5, accounts }));
    const a = h.join('a', 'Guest', { token: 'tok' });
    // Account resolution is async: welcome arrives after the promise settles.
    return Promise.resolve().then(async () => {
      await new Promise((r) => setTimeout(r, 0));
      expect(a.last('welcome')!.name).toBe('Registered');
      h.send(a, { type: 'createRoom', mode: 'tdm', map: 'gantry', botFill: true, botDifficulty: 'veteran' });
      h.send(a, { type: 'startRoom' });
      expect(a.last('matchStart')).toBeTruthy();
      // Shorten the match: jump the room's clock to the end.
      const host = h.host as unknown as { rooms: { sim: { endMatch(): void } }[] };
      host.rooms[0].sim.endMatch();
      h.advance(9000);
      const end = a.last('matchEnd')!;
      expect(end).toBeTruthy();
      expect(end.results.players.length).toBe(10);
      expect(typeof end.ratingDelta).toBe('number');
      expect(a.last('roomState')!.state).toBe('lobby');
      expect(h.host.roomCount).toBe(0);
      if (end.ratingDelta !== 0) expect(recorded[0][0]).toBe('tok');
    });
  });

  it('survives garbage messages and caps rooms', () => {
    const h = new Harness(new HostCore({ kind: 'local', maxRooms: 1 }));
    const a = h.join('a');
    const junk: unknown[] = [null, 5, 'x', {}, { type: 42 }, { type: 'input', cmds: 'nope' }, { type: 'input', cmds: [{ seq: 'a' }] }, { type: 'queue' }, { type: 'range' }, { type: 'loadout', loadout: { primary: 'laser' } }];
    for (const j of junk) h.host.receive(a, j as ClientMsg);
    h.advance(100);
    const b = h.join('b');
    h.send(b, { type: 'queue', mode: 'tdm', map: 'any', botDifficulty: 'veteran', kind: 'bots' });
    expect(b.last('error')?.code).toBe('server_full');
  });

  it('update() uses a fixed step and drops time beyond 8 steps', () => {
    const h = new Harness(new HostCore({ kind: 'local' }));
    const a = h.join('a');
    h.send(a, { type: 'queue', mode: 'tdm', map: 'gantry', botDifficulty: 'veteran', kind: 'bots' });
    h.host.update(10_000);
    h.host.update(20_000); // 10 s hitch → at most 8 ticks
    h.send(a, { type: 'ping', t: 1 });
    expect(a.last('pong')!.tick).toBeLessThanOrEqual(8);
    h.host.update(20_000 + 1000);
    h.send(a, { type: 'ping', t: 2 });
    expect(a.last('pong')!.tick).toBeGreaterThanOrEqual(8 + 8);
  });

  it('matchmaker bands by rating and widens over time', () => {
    const mm = new Matchmaker<string>();
    mm.enqueue({ client: 'low', mode: 'tdm', map: 'any', rating: 800, botDifficulty: 'veteran', since: 0 });
    mm.enqueue({ client: 'high', mode: 'tdm', map: 'any', rating: 1600, botDifficulty: 'veteran', since: 0 });
    const started: string[][] = [];
    const cb = { tryDropIn: () => false, start: (g: { client: string }[]) => started.push(g.map((e) => e.client)) };
    mm.update(1000, cb);
    expect(started.length).toBe(0);
    mm.update(QUEUE_BOT_FILL_AFTER * 1000 + 1, cb);
    // After the wait both start (band grew to ±550 — still too far apart → separate matches).
    expect(started.length).toBe(2);
    expect(mm.size).toBe(0);
  });

  it('client prediction replayed from SelfSnap reproduces the host exactly (movement + combat)', () => {
    const h = new Harness(new HostCore({ kind: 'local' }));
    const a = h.join('a', 'Predictor');
    h.send(a, { type: 'queue', mode: 'range', map: 'range', botDifficulty: 'veteran', kind: 'solo' });
    const start = a.last('matchStart')!;
    const world = worldForMap(getMap(start.config.map));
    h.advance(100);
    const first = a.last('snap')!.self!;
    let move = cloneMoveState(first.move);
    let combat = cloneCombatState(first.combat);
    const pending: InputCmd[] = [];
    let seq = 0;
    let seen = a.of('snap').length;
    let checks = 0;
    for (let frame = 0; frame < 420; frame++) {
      const t = frame / 60;
      let buttons = BTN_SPRINT;
      if (frame % 90 === 30) buttons |= BTN_JUMP;
      if (frame % 150 === 70) buttons |= BTN_CROUCH;
      if (frame % 200 > 150) buttons = BTN_FIRE;
      const cmd: InputCmd = { seq: ++seq, mx: Math.sin(t * 2) * 0.6, mz: 1, yaw: Math.sin(t) * 1.2, pitch: -0.05, buttons, slot: 0, viewTick: 0 };
      stepPlayer(world, move, combat, cmd, start.you, SIM_DT);
      pending.push(cmd);
      h.send(a, { type: 'input', cmds: pending.slice(-8) });
      h.advance(1000 / 60);
      const snaps = a.of('snap');
      for (; seen < snaps.length; seen++) {
        const self = snaps[seen].self!;
        while (pending.length && pending[0].seq <= self.ack) pending.shift();
        // Reconcile: reset to authoritative state and replay unacknowledged commands.
        const m2 = cloneMoveState(self.move);
        const c2 = cloneCombatState(self.combat);
        for (const c of pending) stepPlayer(world, m2, c2, c, start.you, SIM_DT);
        expect(m2.pos).toEqual(move.pos);
        expect(m2.vel).toEqual(move.vel);
        expect(c2.slots[0].mag).toBe(combat.slots[0].mag);
        expect(c2.recoilPitch).toBe(combat.recoilPitch);
        move = m2;
        combat = c2;
        checks++;
      }
    }
    expect(checks).toBeGreaterThan(100);
    // The player actually moved around the range.
    expect(Math.hypot(move.pos.x - first.move.pos.x, move.pos.z - first.move.pos.z)).toBeGreaterThan(3);
  });
});
