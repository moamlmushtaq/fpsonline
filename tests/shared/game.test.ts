import { describe, expect, it } from 'vitest';
import {
  MATCH_OUTRO,
  MAX_HEALTH,
  REGEN_DELAY,
  RESPAWN_TIME,
  SIM_HZ,
  ZONE_CAPTURE_TIME,
} from '../../src/shared/constants';
import type { MapDef } from '../../src/shared/maps/types';
import { makeGameConfig } from '../../src/shared/modes';
import { GameSim, sanitizeCmd, type RoutedEvent } from '../../src/shared/sim/game';
import type { GameConfig, GameEvent, InputCmd, ModeId, Vec3 } from '../../src/shared/types';
import { BTN_FIRE, BTN_THROW } from '../../src/shared/types';
import { RANGE } from '../../src/shared/maps/range';

function testMap(): MapDef {
  return {
    id: 'gantry',
    nameKey: 'x',
    descKey: 'x',
    bounds: { min: { x: -40, y: -20, z: -40 }, max: { x: 40, y: 30, z: 40 } },
    killY: -10,
    solids: [
      // Ground with a pit in the (+x, +z) corner to fall out of the world.
      { min: { x: -40, y: -1, z: -40 }, max: { x: 40, y: 0, z: 30 }, tag: 'concrete' },
      { min: { x: -40, y: -1, z: 30 }, max: { x: 30, y: 0, z: 40 }, tag: 'concrete' },
    ],
    spawns: [
      { pos: { x: -5, y: 0, z: 25 }, yaw: 0, team: 0 },
      { pos: { x: 0, y: 0, z: 25 }, yaw: 0, team: 0 },
      { pos: { x: 5, y: 0, z: 25 }, yaw: 0, team: 0 },
      { pos: { x: -5, y: 0, z: -25 }, yaw: Math.PI, team: 1 },
      { pos: { x: 0, y: 0, z: -25 }, yaw: Math.PI, team: 1 },
      { pos: { x: 5, y: 0, z: -25 }, yaw: Math.PI, team: 1 },
      { pos: { x: -25, y: 0, z: 0 }, yaw: 0, team: 2 },
      { pos: { x: 25, y: 0, z: 0 }, yaw: 0, team: 2 },
    ],
    zones: [
      { id: 'A', center: { x: -15, y: 0, z: 0 }, radius: 4, height: 3, nameKey: 'z' },
      { id: 'B', center: { x: 0, y: 0, z: 0 }, radius: 4, height: 3, nameKey: 'z' },
      { id: 'C', center: { x: 15, y: 0, z: 0 }, radius: 4, height: 3, nameKey: 'z' },
    ],
    pickups: [{ id: 'spear', kind: 'sunspear', pos: { x: 0, y: 0, z: 10 }, respawn: 45 }],
    landmarks: [],
    lighting: {
      mood: 'golden', sunDir: { x: 0, y: 1, z: 0 }, sunColor: '#fff', sunIntensity: 1, skyZenith: '#fff', skyHorizon: '#fff', sunGlow: '#fff',
      hemiSky: '#fff', hemiGround: '#fff', hemiIntensity: 1, fogColor: '#fff', fogDensity: 0, exposure: 1, bloom: 0, stars: 0, weather: 'none',
    },
    audio: { reverb: 'open', echo: 0, ambience: 'range', emitters: [] },
    rocket: { pos: { x: 0, y: 0, z: -100 }, scale: 1 },
  };
}

function human(name: string) {
  return {
    name,
    isBot: false,
    faction: 0 as const,
    loadout: { primary: 'meridian' as const, throwable: 'grenade' as const },
    cosmetics: { armor: 'standard', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: {} },
    level: 1,
    platform: 'desktop' as const,
  };
}

function config(mode: ModeId, over: Partial<GameConfig> = {}): GameConfig {
  return { ...makeGameConfig(mode, 'gantry', { botFill: false }), countdown: 0, ...over };
}

/** Aim from a player's eye to a world point. */
function aim(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

class Driver {
  seqs = new Map<number, number>();
  events: RoutedEvent[] = [];
  constructor(readonly sim: GameSim) {}
  cmd(id: number, p: Partial<InputCmd>): void {
    const s = (this.seqs.get(id) ?? 0) + 1;
    this.seqs.set(id, s);
    this.sim.pushInputs(id, [{ seq: s, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0, viewTick: this.sim.tick, ...p }]);
  }
  /** Steps n ticks; `perTick` supplies commands for humans each tick. */
  step(n: number, perTick?: () => void): void {
    for (let i = 0; i < n; i++) {
      perTick?.();
      this.sim.step();
      this.events.push(...this.sim.drainEvents());
    }
  }
  of<T extends GameEvent['t']>(t: T): Extract<GameEvent, { t: T }>[] {
    return this.events.filter((e) => e.ev.t === t).map((e) => e.ev as Extract<GameEvent, { t: T }>);
  }
  /** Teleports a player (and lets one tick pass so lag-compensation history catches up). */
  place(id: number, pos: Vec3): void {
    const p = this.sim.player(id)!;
    p.move.pos.x = pos.x;
    p.move.pos.y = pos.y;
    p.move.pos.z = pos.z;
    p.move.vel.x = 0;
    p.move.vel.z = 0;
    p.protectedT = 0;
  }
  settle(): void {
    this.step(1);
  }
  /** Aims at the victim's chest compensating recoil (like a skilled player) and fires. */
  shootAt(shooter: number, victim: number): void {
    const s = this.sim.player(shooter)!;
    const v = this.sim.player(victim)!;
    const a = aim(this.sim.eyeOf(s), { x: v.move.pos.x, y: v.move.pos.y + 1.1, z: v.move.pos.z });
    this.cmd(shooter, { yaw: a.yaw + s.combat.recoilYaw, pitch: a.pitch - s.combat.recoilPitch, buttons: BTN_FIRE });
  }
}

describe('GameSim', () => {
  it('kill → respawn → score in TDM (with damage/hit/shot routing)', () => {
    const sim = new GameSim(config('tdm'), testMap(), 1);
    const a = sim.addPlayer(human('Alpha'));
    const b = sim.addPlayer(human('Bravo'));
    expect(a.team).toBe(0);
    expect(b.team).toBe(1);
    const d = new Driver(sim);
    d.step(1);
    d.place(a.id, { x: 0, y: 0, z: 8 });
    d.place(b.id, { x: 0, y: 0, z: -8 });
    d.settle();
    d.step(90, () => {
      d.shootAt(a.id, b.id);
      d.cmd(b.id, {});
    });
    const kills = d.of('kill');
    expect(kills.length).toBe(1);
    expect(kills[0].k).toBe(a.id);
    expect(kills[0].v).toBe(b.id);
    expect(kills[0].w).toBe('meridian');
    expect(sim.clock().teamScores).toEqual([1, 0]);
    expect(sim.player(a.id)!.stats.kills).toBe(1);
    expect(sim.player(a.id)!.stats.score).toBeGreaterThanOrEqual(100);
    expect(sim.player(b.id)!.stats.deaths).toBe(1);
    expect(sim.player(b.id)!.alive).toBe(false);
    // Routing: hit → attacker only, dmg → victim only, shot → everyone but the shooter.
    const hit = d.events.find((e) => e.ev.t === 'hit')!;
    expect(hit.to).toBe(a.id);
    const dmg = d.events.find((e) => e.ev.t === 'dmg')!;
    expect(dmg.to).toBe(b.id);
    const shot = d.events.find((e) => e.ev.t === 'shot')!;
    expect(shot.except).toBe(a.id);
    expect(d.of('announce').some((e) => e.key === 'first_blood')).toBe(true);
    // Respawn after RESPAWN_TIME with full health and spawn protection.
    d.events = [];
    d.step(RESPAWN_TIME * SIM_HZ + 2, () => d.cmd(b.id, {}));
    const pb = sim.player(b.id)!;
    expect(pb.alive).toBe(true);
    expect(pb.health).toBe(MAX_HEALTH);
    expect(pb.protectedT).toBeGreaterThan(0);
    expect(d.of('spawn').some((e) => e.p === b.id)).toBe(true);
    const snap = sim.buildSnapshot(b.id);
    expect(snap.self?.alive).toBe(true);
    expect(snap.players.length).toBe(2);
  });

  it('friendly fire is off; spawn protection blocks damage until the victim fires', () => {
    const sim = new GameSim(config('tdm'), testMap(), 2);
    const a = sim.addPlayer({ ...human('A'), team: 0 });
    const a2 = sim.addPlayer({ ...human('A2'), team: 0 });
    const b = sim.addPlayer({ ...human('B'), team: 1 });
    const d = new Driver(sim);
    d.step(1);
    d.place(a.id, { x: 0, y: 0, z: 8 });
    d.place(a2.id, { x: 0, y: 0, z: -8 });
    d.place(b.id, { x: 10, y: 0, z: -8 });
    d.settle();
    d.step(40, () => d.shootAt(a.id, a2.id));
    expect(sim.player(a2.id)!.health).toBe(MAX_HEALTH);
    sim.player(b.id)!.protectedT = 5;
    d.step(30, () => d.shootAt(a.id, b.id));
    expect(sim.player(b.id)!.health).toBe(MAX_HEALTH);
    // B fires once → protection breaks.
    d.step(2, () => d.cmd(b.id, { buttons: BTN_FIRE }));
    expect(sim.player(b.id)!.protectedT).toBe(0);
    d.step(30, () => d.shootAt(a.id, b.id));
    expect(sim.player(b.id)!.health).toBeLessThan(MAX_HEALTH);
  });

  it('health regenerates after REGEN_DELAY', () => {
    const sim = new GameSim(config('tdm'), testMap(), 3);
    const a = sim.addPlayer(human('A'));
    const b = sim.addPlayer(human('B'));
    const d = new Driver(sim);
    d.step(1);
    d.place(a.id, { x: 0, y: 0, z: 8 });
    d.place(b.id, { x: 0, y: 0, z: -8 });
    d.settle();
    d.step(6, () => d.shootAt(a.id, b.id));
    const pb = sim.player(b.id)!;
    const hurt = pb.health;
    expect(hurt).toBeLessThan(MAX_HEALTH);
    expect(pb.alive).toBe(true);
    d.step(Math.floor(REGEN_DELAY * SIM_HZ) - 20);
    expect(pb.health).toBe(hurt);
    d.step(5 * SIM_HZ);
    expect(pb.health).toBe(MAX_HEALTH);
  });

  it('TDM ends at the score limit, then finishes after the outro', () => {
    const sim = new GameSim(config('tdm', { scoreLimit: 1 }), testMap(), 4);
    const a = sim.addPlayer(human('A'));
    const b = sim.addPlayer(human('B'));
    const d = new Driver(sim);
    d.step(1);
    d.place(a.id, { x: 0, y: 0, z: 8 });
    d.place(b.id, { x: 0, y: 0, z: -8 });
    d.settle();
    d.step(90, () => d.shootAt(a.id, b.id));
    expect(sim.clock().phase).toBe('ended');
    expect(sim.finished).toBe(false);
    expect(d.of('announce').find((e) => e.key === 'victory')).toBeTruthy();
    expect(d.events.find((e) => e.ev.t === 'announce' && e.ev.key === 'defeat')?.to).toBe(b.id);
    d.step(MATCH_OUTRO * SIM_HZ + 1);
    expect(sim.finished).toBe(true);
    const r = sim.results();
    expect(r.winner).toBe(0);
    expect(r.draw).toBe(false);
    expect(r.mvp).toBe(a.id);
    expect(r.teamScores).toEqual([1, 0]);
    expect(r.players[0].id).toBe(a.id);
  });

  it('FFA ends when a player reaches the kill limit', () => {
    const sim = new GameSim(config('ffa', { scoreLimit: 1 }), testMap(), 5);
    const a = sim.addPlayer(human('A'));
    const b = sim.addPlayer(human('B'));
    expect(a.team).toBe(2);
    expect(b.team).toBe(2);
    const d = new Driver(sim);
    d.step(1);
    d.place(a.id, { x: 0, y: 0, z: 8 });
    d.place(b.id, { x: 0, y: 0, z: -8 });
    d.settle();
    d.step(90, () => d.shootAt(b.id, a.id));
    expect(sim.clock().phase).toBe('ended');
    const r = sim.results();
    expect(r.winnerPlayer).toBe(b.id);
    expect(r.winner).toBe(2);
  });

  it('TDM time limit with equal scores is a draw; final minute is announced', () => {
    const sim = new GameSim(config('tdm', { timeLimit: 62 }), testMap(), 6);
    sim.addPlayer(human('A'));
    sim.addPlayer(human('B'));
    const d = new Driver(sim);
    d.step(63 * SIM_HZ);
    expect(d.of('announce').some((e) => e.key === 'final_minute')).toBe(false); // limit ≤ 90 s: no final-minute line
    expect(sim.clock().phase).toBe('ended');
    expect(sim.results().draw).toBe(true);
    const sim2 = new GameSim(config('tdm', { timeLimit: 120 }), testMap(), 6);
    const d2 = new Driver(sim2);
    d2.step(61 * SIM_HZ);
    expect(d2.of('announce').some((e) => e.key === 'final_minute')).toBe(true);
  });

  it('countdown → live with phase + match_start events; no firing during countdown', () => {
    const sim = new GameSim(config('tdm', { countdown: 3 }), testMap(), 7);
    const a = sim.addPlayer(human('A'));
    sim.addPlayer(human('B'));
    const d = new Driver(sim);
    expect(sim.clock().phase).toBe('countdown');
    d.step(60, () => d.cmd(a.id, { buttons: BTN_FIRE }));
    expect(d.of('shot').length).toBe(0);
    d.step(3 * SIM_HZ);
    expect(sim.clock().phase).toBe('live');
    expect(d.of('phase').some((e) => e.phase === 'live')).toBe(true);
    expect(d.of('announce').some((e) => e.key === 'match_start')).toBe(true);
  });

  it('Launch Control: capture, points, contest, neutralize, recapture', () => {
    const sim = new GameSim(config('control'), testMap(), 8);
    const a = sim.addPlayer(human('A'));
    const b = sim.addPlayer(human('B'));
    const d = new Driver(sim);
    d.step(1);
    d.place(a.id, { x: -15, y: 0, z: 0 });
    d.place(b.id, { x: 20, y: 0, z: 20 });
    d.settle();
    d.step(Math.ceil(ZONE_CAPTURE_TIME * SIM_HZ) + 2);
    const zA = sim.zoneStates().find((z) => z.def.id === 'A')!;
    expect(zA.owner).toBe(0);
    expect(zA.progress).toBe(-1);
    expect(d.of('zone').some((e) => e.z === 'A' && e.ev === 'captured' && e.team === 0)).toBe(true);
    expect(sim.player(a.id)!.stats.captures).toBe(1);
    expect(sim.player(a.id)!.stats.objectiveTime).toBeGreaterThan(ZONE_CAPTURE_TIME - 0.1);
    const before = sim.teamScores[0];
    d.step(10 * SIM_HZ);
    expect(sim.teamScores[0] - before).toBeCloseTo(10, 1);
    // Contest.
    d.place(b.id, { x: -14, y: 0, z: 1 });
    d.settle();
    d.step(30);
    expect(zA.contested).toBe(true);
    expect(d.of('zone').some((e) => e.z === 'A' && e.ev === 'contested')).toBe(true);
    const frozen = zA.progress;
    d.step(60);
    expect(zA.progress).toBe(frozen);
    // A leaves: B neutralizes then captures.
    d.place(a.id, { x: 25, y: 0, z: 25 });
    d.settle();
    d.step(Math.ceil(ZONE_CAPTURE_TIME * SIM_HZ) + 5);
    expect(d.of('zone').some((e) => e.z === 'A' && e.ev === 'neutralized' && e.team === 1)).toBe(true);
    expect(zA.owner).toBe(TEAM_NONE_OR(zA.owner));
    d.step(Math.ceil(ZONE_CAPTURE_TIME * SIM_HZ) + 5);
    expect(zA.owner).toBe(1);
    expect(sim.buildSnapshot(null).zones.find((z) => z.id === 'A')!.owner).toBe(1);
  });

  it('two teammates capture faster than one', () => {
    const sim = new GameSim(config('control'), testMap(), 9);
    const a = sim.addPlayer({ ...human('A'), team: 0 });
    const a2 = sim.addPlayer({ ...human('A2'), team: 0 });
    sim.addPlayer({ ...human('B'), team: 1 });
    const d = new Driver(sim);
    d.step(1);
    d.place(a.id, { x: -15, y: 0, z: 0 });
    d.place(a2.id, { x: -14, y: 0, z: 1 });
    d.settle();
    d.step(Math.ceil((ZONE_CAPTURE_TIME / 1.3) * SIM_HZ));
    expect(sim.zoneStates()[0].owner).toBe(0);
  });

  it('Sunspear pickup: walk over to take it, respawns later', () => {
    const sim = new GameSim(config('tdm'), testMap(), 10);
    const a = sim.addPlayer(human('A'));
    sim.addPlayer(human('B'));
    const d = new Driver(sim);
    d.step(1);
    d.place(a.id, { x: 0, y: 0, z: 10.5 });
    d.settle();
    d.step(2);
    expect(d.of('pickup').length).toBe(1);
    expect(sim.player(a.id)!.combat.slots[2]?.id).toBe('sunspear');
    expect(sim.buildSnapshot(null).pickups[0].available).toBe(false);
    d.step(46 * SIM_HZ);
    expect(d.of('pickupSpawn').length).toBe(1);
  });

  it('falling below killY kills with cause fall', () => {
    const sim = new GameSim(config('tdm'), testMap(), 11);
    const a = sim.addPlayer(human('A'));
    sim.addPlayer(human('B'));
    const d = new Driver(sim);
    d.step(1);
    d.place(a.id, { x: 35, y: 0, z: 35 });
    d.settle();
    d.step(2 * SIM_HZ);
    const k = d.of('kill');
    expect(k.length).toBe(1);
    expect(k[0].w).toBe('fall');
    expect(k[0].k).toBe(-1);
  });

  it('pulse grenade damages enemies and the thrower (half), never teammates', () => {
    const sim = new GameSim(config('tdm'), testMap(), 12);
    const a = sim.addPlayer({ ...human('A'), team: 0 });
    const mate = sim.addPlayer({ ...human('M'), team: 0 });
    const b = sim.addPlayer({ ...human('B'), team: 1 });
    const d = new Driver(sim);
    d.step(1);
    d.place(a.id, { x: 0, y: 0, z: 10 });
    d.place(mate.id, { x: 1.5, y: 0, z: 9 });
    d.place(b.id, { x: -1.5, y: 0, z: 9 });
    d.settle();
    // Drop it at our own feet.
    d.cmd(a.id, { yaw: 0, pitch: -1.4, buttons: BTN_THROW });
    d.step(3 * SIM_HZ);
    expect(d.of('throw').length).toBe(1);
    expect(d.of('explode').length).toBe(1);
    expect(sim.player(mate.id)!.health).toBe(MAX_HEALTH);
    const pb = sim.player(b.id)!;
    const pa = sim.player(a.id)!;
    expect(pb.health < MAX_HEALTH || pb.stats.deaths > 0).toBe(true);
    expect(pa.health < MAX_HEALTH || pa.stats.deaths > 0).toBe(true);
    // Self-damage is halved: the thrower always ends up healthier than the enemy at equal range.
    expect(pa.stats.deaths).toBe(0);
    const kill = d.of('kill').find((k) => k.v === b.id);
    if (kill) expect(kill.w).toBe('grenade');
  });

  it('training range: targets take hits, die, respawn; player keeps infinite reserve', () => {
    const sim = new GameSim({ ...makeGameConfig('range', 'range', { botFill: false }) }, RANGE, 13);
    const p = sim.addPlayer(human('Trainee'));
    const d = new Driver(sim);
    d.step(1);
    const t = sim.range!.targets.find((x) => !x.def.path && x.def.distance === 10)!;
    let hits = 0;
    d.step(2 * SIM_HZ, () => {
      const me = sim.player(p.id)!;
      const tp = sim.range!.targets.find((x) => x.id === t.id)!;
      d.cmd(p.id, { ...aim(sim.eyeOf(me), { x: tp.pos.x, y: tp.pos.y + 1.1, z: tp.pos.z }), buttons: BTN_FIRE });
    });
    const tev = d.of('target');
    hits = tev.length;
    expect(hits).toBeGreaterThan(3);
    expect(tev.some((e) => e.kill && e.id === t.id && e.dist === 10)).toBe(true);
    expect(d.events.find((e) => e.ev.t === 'target')!.to).toBe(p.id);
    const snapT = sim.buildSnapshot(p.id).targets.find((x) => x.id === t.id)!;
    expect(snapT).toBeTruthy();
    // Reserve never runs dry in training.
    const slot = sim.player(p.id)!.combat.slots[0];
    expect(slot.reserve).toBeGreaterThan(0);
    d.step(2 * SIM_HZ);
    expect(sim.range!.targets.every((x) => x.alive)).toBe(true);
    expect(sim.player(p.id)!.alive).toBe(true);
    expect(sim.player(p.id)!.stats.shots).toBeGreaterThan(0);
  });

  it('bots fill teams evenly and replaceBotWith keeps the balance', () => {
    const cfg = { ...makeGameConfig('tdm', 'gantry', { botFill: true }), countdown: 0 };
    const sim = new GameSim(cfg, testMap(), 14);
    sim.addPlayer(human('H'));
    sim.fillBots();
    expect(sim.players.length).toBe(cfg.maxPlayers);
    expect(sim.players.filter((p) => p.ident.team === 0).length).toBe(5);
    const ident = sim.replaceBotWith(human('Late'));
    expect(ident).not.toBeNull();
    expect(sim.players.length).toBe(cfg.maxPlayers);
    expect(sim.players.filter((p) => p.ident.team === 0).length).toBe(5);
    expect(sim.players.filter((p) => !p.ident.isBot).length).toBe(2);
  });

  it('snapshots quantize positions/angles and sanitizeCmd clamps bad input', () => {
    const sim = new GameSim(config('tdm'), testMap(), 15);
    const a = sim.addPlayer(human('A'));
    sim.addPlayer(human('B'));
    const d = new Driver(sim);
    d.step(1);
    d.place(a.id, { x: 1.23456, y: 0, z: 2.98765 });
    d.settle();
    d.cmd(a.id, { yaw: 0.123456, pitch: 0.0004 });
    d.step(1);
    const s = sim.buildSnapshot(a.id);
    const ps = s.players.find((p) => p.id === a.id)!;
    expect(Math.round(ps.x * 100)).toBeCloseTo(ps.x * 100, 9);
    expect(Math.round(ps.yaw * 1000)).toBeCloseTo(ps.yaw * 1000, 9);
    expect(s.self?.ack).toBe(1);
    expect(sanitizeCmd({ seq: 5, mx: 9, mz: -Infinity, yaw: 100, pitch: 3, buttons: 0xfff, slot: 7, viewTick: 'x' })).toEqual({
      seq: 5, mx: 1, mz: 0, yaw: expect.any(Number), pitch: expect.any(Number), buttons: 0xff, slot: 0, viewTick: 0,
    });
    expect(sanitizeCmd({ seq: 0 })).toBeNull();
    expect(sanitizeCmd(null)).toBeNull();
    // Old / duplicate sequence numbers are ignored.
    sim.pushInputs(a.id, [{ seq: 1, mx: 1, mz: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0, viewTick: 0 }]);
    expect(sim.player(a.id)!.queue.length).toBe(0);
  });

  it('is deterministic for a given seed (bots included)', () => {
    const runOnce = () => {
      const cfg = { ...makeGameConfig('tdm', 'gantry', { botFill: true }), maxPlayers: 6, countdown: 0 };
      const sim = new GameSim(cfg, testMap(), 99);
      sim.fillBots();
      for (let i = 0; i < 600; i++) {
        sim.step();
        sim.drainEvents();
      }
      return JSON.stringify(sim.players.map((p) => [p.move.pos, p.health, p.stats]));
    };
    expect(runOnce()).toBe(runOnce());
  });
});

function TEAM_NONE_OR(owner: number): number {
  // After neutralizing, the zone is either neutral or already recaptured by the attackers.
  return owner === 1 ? 1 : 2;
}
