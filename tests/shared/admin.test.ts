// Admin cheats: authoritative effects in GameSim (god / ammo / speed / respawn
// persistence / falls), the local-host authorization path (the `trusted` flag is
// honoured only by kind 'local'), refusal of unauthenticated cheats, and the
// room-level cheats (killbots, freezebots, sunspear, teleport, endmatch).

import { describe, expect, it } from 'vitest';
import { MAX_HEALTH, PROTOCOL_VERSION, SIM_HZ } from '../../src/shared/constants';
import { HostCore, type HostConnection } from '../../src/shared/host/host-core';
import type { MapDef } from '../../src/shared/maps/types';
import { getMap } from '../../src/shared/maps/index';
import { makeGameConfig } from '../../src/shared/modes';
import type { ClientMsg, HelloMsg, ServerMsg } from '../../src/shared/protocol';
import { adminCodeHash, sha256Hex } from '../../src/shared/sha256';
import { GameSim } from '../../src/shared/sim/game';
import type { InputCmd } from '../../src/shared/types';
import { BTN_FIRE } from '../../src/shared/types';
import { WEAPONS } from '../../src/shared/weapons';
import { createHash } from 'node:crypto';

function flatMap(): MapDef {
  const g = getMap('gantry');
  return {
    ...g,
    bounds: { min: { x: -60, y: -20, z: -60 }, max: { x: 60, y: 30, z: 60 } },
    killY: -10,
    solids: [{ min: { x: -60, y: -1, z: -60 }, max: { x: 60, y: 0, z: 60 }, tag: 'concrete' }],
    spawns: [
      { pos: { x: -20, y: 0, z: 30 }, yaw: 0, team: 0 },
      { pos: { x: 20, y: 0, z: 30 }, yaw: 0, team: 0 },
      { pos: { x: -20, y: 0, z: -30 }, yaw: Math.PI, team: 1 },
      { pos: { x: 20, y: 0, z: -30 }, yaw: Math.PI, team: 1 },
    ],
    zones: [
      { id: 'A', center: { x: -30, y: 0, z: 0 }, radius: 4, height: 3, nameKey: 'z' },
      { id: 'B', center: { x: 0, y: 0, z: 0 }, radius: 4, height: 3, nameKey: 'z' },
      { id: 'C', center: { x: 30, y: 0, z: 0 }, radius: 4, height: 3, nameKey: 'z' },
    ],
    pickups: [],
  };
}

function human(name: string) {
  return {
    name,
    isBot: false,
    faction: 0 as const,
    loadout: { primary: 'swift' as const, throwable: 'grenade' as const },
    cosmetics: { armor: 'standard', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: {} },
    level: 1,
    platform: 'desktop' as const,
  };
}

function liveSim(): GameSim {
  return new GameSim({ ...makeGameConfig('tdm', 'gantry', { botFill: false }), countdown: 0 }, flatMap(), 7);
}

let seqs = new Map<number, number>();
function cmd(id: number, over: Partial<InputCmd> = {}): InputCmd {
  const seq = (seqs.get(id) ?? 0) + 1;
  seqs.set(id, seq);
  return { seq, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0, viewTick: 0, ...over };
}

describe('GameSim admin cheats', () => {
  it('god: no damage taken; a fall below killY respawns instead of eliminating', () => {
    seqs = new Map();
    const sim = liveSim();
    const a = sim.addPlayer({ ...human('A'), team: 0 });
    const b = sim.addPlayer({ ...human('B'), team: 1 });
    sim.step();
    const pa = sim.player(a.id)!;
    const pb = sim.player(b.id)!;
    pa.protectedT = pb.protectedT = 0;
    sim.setCheats(a.id, { god: true });
    expect(sim.applyDamage(pa, pb, 500, 'swift', true, pb.move.pos)).toBe(false);
    expect(pa.health).toBe(MAX_HEALTH);
    expect(pa.alive).toBe(true);
    // The same hit without god lands.
    expect(sim.applyDamage(pb, pa, 40, 'swift', false, pa.move.pos)).toBe(false);
    expect(pb.health).toBe(MAX_HEALTH - 40);
    sim.drainEvents();
    pa.move.pos.y = -50;
    sim.step();
    expect(pa.alive).toBe(true);
    expect(pa.move.pos.y).toBeGreaterThan(-1);
    expect(sim.drainEvents().some((e) => e.ev.t === 'kill')).toBe(false);
    // Turning it off restores normal damage.
    sim.setCheats(a.id, { god: false });
    pa.protectedT = 0;
    expect(sim.applyDamage(pa, pb, 500, 'swift', true, pb.move.pos)).toBe(true);
  });

  it('ammo: the magazine never drops and no reload is needed', () => {
    seqs = new Map();
    const sim = liveSim();
    const a = sim.addPlayer({ ...human('A'), team: 0 });
    const b = sim.addPlayer({ ...human('B'), team: 0 });
    sim.setCheats(a.id, { ammo: true });
    const mag = WEAPONS.swift.magSize;
    for (let i = 0; i < SIM_HZ * 4; i++) {
      sim.pushInputs(a.id, [cmd(a.id, { buttons: BTN_FIRE, pitch: -0.5 })]);
      sim.pushInputs(b.id, [cmd(b.id, { buttons: BTN_FIRE, pitch: -0.5 })]);
      sim.step();
      expect(sim.player(a.id)!.combat.slots[0].mag).toBe(mag);
      expect(sim.player(a.id)!.combat.reloadT).toBe(0);
    }
    const pa = sim.player(a.id)!;
    const pb = sim.player(b.id)!;
    expect(pa.stats.shots).toBeGreaterThan(mag * 1.5); // way more than one magazine
    expect(pb.stats.shots).toBeLessThan(pa.stats.shots); // the honest player had to reload
    expect(pa.combat.cheatAmmo).toBe(true);
    expect(pb.combat.cheatAmmo).toBeUndefined();
  });

  it('speed: the movement multiplier scales ground speed (clamped to 1..3)', () => {
    seqs = new Map();
    const sim = liveSim();
    const a = sim.addPlayer({ ...human('A'), team: 0 });
    const b = sim.addPlayer({ ...human('B'), team: 0 });
    expect(sim.setCheats(a.id, { speed: 9 })?.speed).toBe(3);
    sim.setCheats(a.id, { speed: 2 });
    sim.step();
    const pa = sim.player(a.id)!;
    const pb = sim.player(b.id)!;
    const a0 = { ...pa.move.pos };
    const b0 = { ...pb.move.pos };
    for (let i = 0; i < SIM_HZ; i++) {
      sim.pushInputs(a.id, [cmd(a.id, { mz: 1 })]);
      sim.pushInputs(b.id, [cmd(b.id, { mz: 1 })]);
      sim.step();
    }
    const da = Math.hypot(pa.move.pos.x - a0.x, pa.move.pos.z - a0.z);
    const db = Math.hypot(pb.move.pos.x - b0.x, pb.move.pos.z - b0.z);
    expect(db).toBeGreaterThan(2);
    expect(da / db).toBeGreaterThan(1.8);
    expect(da / db).toBeLessThan(2.2);
    sim.setCheats(a.id, { speed: 1 });
    expect(pa.combat.cheatSpeed).toBeUndefined();
    expect(pa.cheats).toBeUndefined();
  });

  it('cheats survive death and respawn (re-applied to the fresh combat state)', () => {
    seqs = new Map();
    const sim = liveSim();
    const a = sim.addPlayer({ ...human('A'), team: 0 });
    const b = sim.addPlayer({ ...human('B'), team: 1 });
    sim.setCheats(a.id, { ammo: true, speed: 1.5 });
    const pa = sim.player(a.id)!;
    pa.protectedT = 0;
    expect(sim.applyDamage(pa, sim.player(b.id)!, 500, 'swift', false, pa.move.pos)).toBe(true);
    for (let i = 0; i < SIM_HZ * 8 && !pa.alive; i++) sim.step();
    expect(pa.alive).toBe(true);
    expect(pa.combat.cheatAmmo).toBe(true);
    expect(pa.combat.cheatSpeed).toBe(1.5);
  });

  it('killbots / teleport / endmatch(win) from the sim API', () => {
    seqs = new Map();
    const sim = liveSim();
    const a = sim.addPlayer({ ...human('A'), team: 0 });
    sim.addBot(0);
    sim.addBot(1);
    sim.addBot(1);
    sim.step();
    expect(sim.adminKillBots(a.id)).toBe(2); // enemies only
    const kills = sim.drainEvents().filter((e) => e.ev.t === 'kill').map((e) => e.ev as Extract<typeof e.ev, { t: 'kill' }>);
    expect(kills).toHaveLength(2);
    for (const k of kills) expect(k).toMatchObject({ k: -1, w: 'world', assist: -1 });
    expect(sim.players.filter((p) => p.ident.isBot && p.ident.team === 0 && p.alive)).toHaveLength(1);
    expect(sim.adminTeleport(a.id, 'C')).toBe(true);
    expect(sim.player(a.id)!.move.pos).toMatchObject({ x: 30, z: 0 });
    expect(sim.adminEndMatch(a.id)).toBe(true);
    expect(sim.currentPhase).toBe('ended');
    expect(sim.results().winner).toBe(0);
  });
});

// ── Host: authorization paths ───────────────────────────────────────────────

class FakeConn implements HostConnection {
  readonly msgs: ServerMsg[] = [];
  constructor(readonly id: string) {}
  send(msg: ServerMsg): void {
    this.msgs.push(JSON.parse(JSON.stringify(msg)));
  }
  lastAdmin(): Extract<ServerMsg, { type: 'admin' }> | undefined {
    const l = this.msgs.filter((m) => m.type === 'admin');
    return l[l.length - 1] as Extract<ServerMsg, { type: 'admin' }> | undefined;
  }
}

function hello(name: string): HelloMsg {
  return {
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    name,
    platform: 'desktop',
    lang: 'en',
    level: 5,
    rating: 1000,
    loadout: { primary: 'meridian', throwable: 'grenade' },
    cosmetics: { armor: 'standard', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: {} },
    faction: 0,
  };
}

function localHost() {
  const host = new HostCore({ kind: 'local', seed: 3 });
  let now = 1000;
  const c = new FakeConn('local-1');
  host.connect(c);
  host.receive(c, hello('Owner'));
  const send = (m: ClientMsg) => {
    host.receive(c, m);
    return c.lastAdmin();
  };
  const run = (sec: number) => {
    for (let t = 0; t < sec * 60; t++) {
      now += 1000 / 60;
      host.update(now);
    }
  };
  return { host, c, send, run };
}

describe('Local host admin authorization', () => {
  it('refuses cheats from an unauthenticated connection, and auth without the trusted flag', () => {
    const { c, send, run } = localHost();
    send({ type: 'queue', mode: 'tdm', map: 'gantry', botDifficulty: 'recruit', kind: 'bots' });
    run(0.5);
    expect(c.msgs.some((m) => m.type === 'matchStart')).toBe(true);
    expect(send({ type: 'admin', action: 'cheat', cheat: 'god', value: true })).toEqual({ type: 'admin', ok: false, message: 'unauthorized' });
    expect(send({ type: 'admin', action: 'cheat', cheat: 'killbots' })?.message).toBe('unauthorized');
    expect(send({ type: 'admin', action: 'auth', password: 'halcyon2090' })).toEqual({ type: 'admin', ok: false, message: 'denied' });
    expect(send({ type: 'admin', action: 'cheat', cheat: 'endmatch', value: true })?.message).toBe('unauthorized');
    run(0.2);
    // Nothing changed: no cheats on the player, match still running.
    const snap = [...c.msgs].reverse().find((m) => m.type === 'snap') as Extract<ServerMsg, { type: 'snap' }>;
    expect(snap.self?.combat.cheatAmmo).toBeUndefined();
    expect(snap.clock.phase).not.toBe('ended');
  });

  it('a trusted auth (client verified the code) authorizes the connection; room cheats work; the match is unrated', () => {
    const { c, send, run } = localHost();
    expect(send({ type: 'admin', action: 'auth', password: '', trusted: true })).toMatchObject({ ok: true, state: { authorized: true, inMatch: false } });
    expect(send({ type: 'admin', action: 'cheat', cheat: 'god', value: true })).toMatchObject({ ok: false, message: 'no_match' });
    send({ type: 'queue', mode: 'tdm', map: 'gantry', botDifficulty: 'recruit', kind: 'bots' });
    run(0.5);
    const start = c.msgs.find((m) => m.type === 'matchStart') as Extract<ServerMsg, { type: 'matchStart' }>;
    expect(start).toBeTruthy();
    expect(send({ type: 'admin', action: 'cheat', cheat: 'ammo' })).toMatchObject({ ok: true, state: { ammo: true } });
    expect(send({ type: 'admin', action: 'cheat', cheat: 'ammo' })).toMatchObject({ ok: true, state: { ammo: false } }); // toggle
    expect(send({ type: 'admin', action: 'cheat', cheat: 'speed', value: 7 })).toMatchObject({ ok: false, message: 'bad_value' });
    expect(send({ type: 'admin', action: 'cheat', cheat: 'freezebots', value: true })).toMatchObject({ ok: true, state: { freezeBots: true } });
    expect(send({ type: 'admin', action: 'cheat', cheat: 'sunspear' })?.ok).toBe(true);
    expect(send({ type: 'admin', action: 'cheat', cheat: 'teleport', value: 'b' })?.ok).toBe(true);
    expect(send({ type: 'admin', action: 'cheat', cheat: 'teleport', value: 'Z' })?.message).toBe('bad_value');
    const kb = send({ type: 'admin', action: 'cheat', cheat: 'killbots' });
    expect(kb?.ok).toBe(true);
    expect(Number(kb?.message?.split(':')[1])).toBe(5);
    run(0.3);
    const snap = [...c.msgs].reverse().find((m) => m.type === 'snap' && m.self) as Extract<ServerMsg, { type: 'snap' }>;
    expect(snap.self?.combat.slots[2]?.id).toBe('sunspear');
    expect(send({ type: 'admin', action: 'cheat', cheat: 'endmatch', value: true })?.ok).toBe(true);
    run(12);
    const end = c.msgs.find((m) => m.type === 'matchEnd') as Extract<ServerMsg, { type: 'matchEnd' }>;
    expect(end).toBeTruthy();
    const me = start.players.find((p) => p.id === start.you)!;
    expect(end.results.winner).toBe(me.team);
    expect(end.ratingDelta).toBe(0);
  }, 30000);

  it('frozen bots do not move or shoot', () => {
    const sim = new GameSim({ ...makeGameConfig('tdm', 'gantry', { botFill: false }), countdown: 0 }, getMap('gantry'), 5);
    for (let i = 0; i < 6; i++) sim.addBot();
    for (let i = 0; i < 30; i++) sim.step();
    sim.botsFrozen = true;
    for (let i = 0; i < 20; i++) sim.step(); // let any momentum settle
    const before = sim.players.map((p) => ({ x: p.move.pos.x, z: p.move.pos.z, shots: p.stats.shots }));
    for (let i = 0; i < SIM_HZ * 3; i++) sim.step();
    sim.players.forEach((p, i) => {
      expect(Math.hypot(p.move.pos.x - before[i].x, p.move.pos.z - before[i].z)).toBeLessThan(0.05);
      expect(p.stats.shots).toBe(before[i].shots);
    });
  });
});

describe('admin code hash', () => {
  it('pure-JS SHA-256 matches node:crypto (the build bakes it, the client recomputes it)', () => {
    for (const s of ['', 'abc', 'halcyon2090', 'صن سبير ✓', 'x'.repeat(200)]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
    expect(adminCodeHash('halcyon2090')).toHaveLength(64);
    expect(adminCodeHash('halcyon2090')).not.toBe(sha256Hex('halcyon2090')); // salted
  });
});
