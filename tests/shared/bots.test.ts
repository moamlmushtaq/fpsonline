// Bot flow & balance: whole bot matches on every map/mode — kills happen, nobody
// gets stuck, every lane gets used, every Launch Control zone gets captured,
// and difficulties order elite > veteran > recruit.
import { describe, expect, it } from 'vitest';
import { SIM_HZ } from '../../src/shared/constants';
import { getMap } from '../../src/shared/maps/index';
import { makeGameConfig } from '../../src/shared/modes';
import type { BotDifficulty, InputCmd, MapId, ModeId } from '../../src/shared/types';
import { PVP_MAP_IDS } from '../../src/shared/types';
import { GameSim } from '../../src/shared/sim/game';
import { laneInfoFor, laneOfX } from '../../src/shared/sim/bots/lanes';

interface Run {
  kills: number;
  /** Longest time (s) any living player stayed within 1.5 m of one spot. */
  maxStill: number;
  lanes: [number, number, number];
  captured: Set<string>;
}

/** Steps a sim, sampling every 0.5 s like the map suites do. */
function run(sim: GameSim, seconds: number): Run {
  const out: Run = { kills: 0, maxStill: 0, lanes: [0, 0, 0], captured: new Set() };
  const info = laneInfoFor(sim.map, sim.world, sim.nav);
  const anchor = new Map<number, { x: number; y: number; z: number; t: number }>();
  for (let i = 0; i < seconds * SIM_HZ; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.ev.t === 'kill') out.kills++;
      if (e.ev.t === 'zone' && e.ev.ev === 'captured') out.captured.add(e.ev.z);
    }
    if (i % 30 !== 0) continue;
    for (const p of sim.players) {
      if (!p.alive) {
        anchor.delete(p.ident.id);
        continue;
      }
      const { x, y, z } = p.move.pos;
      if (info && Math.abs(z) < 38) out.lanes[laneOfX(info, x)]++;
      const a = anchor.get(p.ident.id);
      if (!a || Math.hypot(x - a.x, y - a.y, z - a.z) > 1.5) anchor.set(p.ident.id, { x, y, z, t: sim.tick });
      else out.maxStill = Math.max(out.maxStill, (sim.tick - a.t) / SIM_HZ);
    }
  }
  return out;
}

function botMatch(mode: ModeId, map: MapId, difficulty: BotDifficulty, seed: number): GameSim {
  const cfg = { ...makeGameConfig(mode, map, { botFill: true, botDifficulty: difficulty }), countdown: 0, scoreLimit: 0 };
  const sim = new GameSim(cfg, getMap(map), seed);
  sim.fillBots();
  return sim;
}

describe('bot matches', () => {
  for (const id of PVP_MAP_IDS) {
    it(`5v5 veteran TDM on ${id}: kills happen, nobody stuck > 10 s, every lane ≥ 15 %`, () => {
      const sim = botMatch('tdm', id, 'veteran', 4242);
      expect(sim.players.filter((p) => p.ident.team === 0).length).toBe(5);
      const r = run(sim, 90);
      expect(r.kills).toBeGreaterThan(8);
      expect(r.maxStill).toBeLessThan(10);
      const total = r.lanes[0] + r.lanes[1] + r.lanes[2];
      for (const n of r.lanes) expect(n / total, `${id} lanes ${r.lanes.join('/')}`).toBeGreaterThanOrEqual(0.15);
      // Every bot fired and moved through the normal command path.
      for (const p of sim.players) {
        expect(p.ackSeq).toBeGreaterThan(90 * SIM_HZ - 10);
        expect(p.stats.shots + p.stats.deaths).toBeGreaterThan(0);
      }
    }, 60_000);
  }

  for (const id of PVP_MAP_IDS) {
    it(`Launch Control on ${id}: all three zones get captured, nobody stuck`, () => {
      const sim = botMatch('control', id, 'veteran', 5);
      const r = run(sim, 120);
      expect([...r.captured].sort()).toEqual(['A', 'B', 'C']);
      expect(r.maxStill).toBeLessThan(10);
      expect(sim.players.some((p) => p.stats.captures > 0)).toBe(true);
    }, 60_000);
  }

  it('FFA on every map: action everywhere, nobody stuck', () => {
    for (const id of PVP_MAP_IDS) {
      const sim = botMatch('ffa', id, 'elite', 8);
      expect(sim.players.length).toBe(8);
      const r = run(sim, 45);
      expect(r.kills).toBeGreaterThan(5);
      expect(r.maxStill).toBeLessThan(10);
    }
  }, 60_000);

  it('recruit bots on every map keep moving too (they wander the most)', () => {
    for (const id of PVP_MAP_IDS) {
      const r = run(botMatch('tdm', id, 'recruit', 31), 60);
      expect(r.maxStill).toBeLessThan(10);
    }
  }, 60_000);
});

describe('difficulty ordering', () => {
  /** Team K/D of side A vs side B over a few seeds and all maps (sides alternate). */
  function versus(a: BotDifficulty, b: BotDifficulty, seeds: number[]): [number, number] {
    const k = [0, 0];
    const d = [0, 0];
    seeds.forEach((seed, i) => {
      const map = PVP_MAP_IDS[i % PVP_MAP_IDS.length];
      const flip = i % 2 === 1;
      const cfg = { ...makeGameConfig('tdm', map, { botFill: false }), countdown: 0, scoreLimit: 0 };
      const sim = new GameSim(cfg, getMap(map), seed);
      for (let n = 0; n < 5; n++) {
        sim.addBot(0, flip ? b : a);
        sim.addBot(1, flip ? a : b);
      }
      run(sim, 50);
      for (const p of sim.players) {
        const side = (p.ident.team === 0) !== flip ? 0 : 1;
        k[side] += p.stats.kills;
        d[side] += p.stats.deaths;
      }
    });
    return [k[0] / Math.max(1, d[0]), k[1] / Math.max(1, d[1])];
  }

  it('elite > veteran > recruit in K/D over several seeds', () => {
    const [ev, ve] = versus('elite', 'veteran', [1, 2, 3]);
    const [vr, rv] = versus('veteran', 'recruit', [4, 5, 6]);
    expect(ev).toBeGreaterThan(ve);
    expect(vr).toBeGreaterThan(rv);
    expect(ev).toBeGreaterThan(1.2);
    expect(vr).toBeGreaterThan(1.5);
  }, 60_000);
});

describe('bot commands', () => {
  it('are well-formed and seq increments every tick', () => {
    const sim = new GameSim({ ...makeGameConfig('tdm', 'gantry', { botFill: true }), maxPlayers: 2 }, getMap('gantry'), 3);
    sim.fillBots();
    const bot = sim.players[0].bot!;
    let last = 0;
    for (let i = 0; i < 300; i++) {
      sim.step();
      const c: InputCmd = sim.players[0].lastCmd;
      expect(c.seq).toBe(last + 1);
      last = c.seq;
      for (const v of [c.mx, c.mz, c.yaw, c.pitch]) expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(c.mx)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.mz)).toBeLessThanOrEqual(1);
    }
    expect(bot.difficulty).toBe('veteran');
  }, 60_000);

  it('are deterministic for a seed (director, lanes and aim included)', () => {
    const a = botMatch('control', 'pastel', 'elite', 99);
    const b = botMatch('control', 'pastel', 'elite', 99);
    for (let i = 0; i < 20 * SIM_HZ; i++) {
      a.step();
      b.step();
      a.drainEvents();
      b.drainEvents();
    }
    for (let i = 0; i < a.players.length; i++) {
      expect(a.players[i].move.pos).toEqual(b.players[i].move.pos);
      expect(a.players[i].lastCmd).toEqual(b.players[i].lastCmd);
    }
  }, 60_000);
});
