import { describe, expect, it } from 'vitest';
import { SIM_HZ } from '../../src/shared/constants';
import { getMap } from '../../src/shared/maps/index';
import { makeGameConfig } from '../../src/shared/modes';
import { GameSim } from '../../src/shared/sim/game';
import type { InputCmd } from '../../src/shared/types';
import { PVP_MAP_IDS } from '../../src/shared/types';

/** Max seconds any living bot stayed within 1.5 m of one spot. */
function runMatch(sim: GameSim, seconds: number): { kills: number; maxStill: number } {
  let kills = 0;
  let maxStill = 0;
  const anchor = new Map<number, { x: number; y: number; z: number; t: number }>();
  for (let i = 0; i < seconds * SIM_HZ; i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.ev.t === 'kill') kills++;
    for (const p of sim.players) {
      if (!p.alive) {
        anchor.delete(p.ident.id);
        continue;
      }
      const a = anchor.get(p.ident.id);
      const pos = p.move.pos;
      if (!a || Math.hypot(pos.x - a.x, pos.y - a.y, pos.z - a.z) > 1.5) anchor.set(p.ident.id, { x: pos.x, y: pos.y, z: pos.z, t: sim.tick });
      else maxStill = Math.max(maxStill, (sim.tick - a.t) / SIM_HZ);
    }
  }
  return { kills, maxStill };
}

describe('bots', () => {
  for (const id of PVP_MAP_IDS) {
    it(`4v4 veteran TDM on ${id}: 60 s without errors, kills happen, nobody gets stuck`, () => {
      const cfg = { ...makeGameConfig('tdm', id, { botFill: true, botDifficulty: 'veteran' }), maxPlayers: 8 };
      const sim = new GameSim(cfg, getMap(id), 4242);
      sim.fillBots();
      expect(sim.players.filter((p) => p.ident.team === 0).length).toBe(4);
      expect(sim.players.filter((p) => p.ident.team === 1).length).toBe(4);
      const r = runMatch(sim, 60);
      expect(r.kills).toBeGreaterThan(3);
      expect(r.maxStill).toBeLessThan(10);
      // Every bot fired and moved through the normal command path.
      for (const p of sim.players) {
        expect(p.ackSeq).toBeGreaterThan(3000);
        expect(p.stats.shots + p.stats.deaths).toBeGreaterThan(0);
      }
    });
  }

  it('bots play Launch Control objectives and FFA', () => {
    const control = new GameSim({ ...makeGameConfig('control', 'pastel', { botFill: true }), maxPlayers: 8 }, getMap('pastel'), 7);
    control.fillBots();
    runMatch(control, 45);
    expect(control.zoneStates().some((z) => z.owner !== 2)).toBe(true);
    expect(control.teamScores[0] + control.teamScores[1]).toBeGreaterThan(10);
    expect(control.players.some((p) => p.stats.captures > 0)).toBe(true);

    const ffa = new GameSim(makeGameConfig('ffa', 'observatory', { botFill: true, botDifficulty: 'elite' }), getMap('observatory'), 8);
    ffa.fillBots();
    expect(ffa.players.length).toBe(8);
    const r = runMatch(ffa, 45);
    expect(r.kills).toBeGreaterThan(5);
  });

  it('elite bots beat recruit bots', () => {
    let elite = 0;
    let recruit = 0;
    for (const seed of [1, 2, 3]) {
      const cfg = { ...makeGameConfig('tdm', 'gantry', { botFill: false }), maxPlayers: 8, countdown: 0 };
      const sim = new GameSim(cfg, getMap('gantry'), seed);
      for (let i = 0; i < 4; i++) {
        sim.addBot(0, 'elite');
        sim.addBot(1, 'recruit');
      }
      runMatch(sim, 60);
      elite += sim.teamScores[0];
      recruit += sim.teamScores[1];
    }
    expect(elite).toBeGreaterThan(recruit);
  });

  it('bot commands are well-formed and seq increments every tick', () => {
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
  });
});
