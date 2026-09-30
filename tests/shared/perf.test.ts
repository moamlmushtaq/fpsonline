import { describe, expect, it } from 'vitest';
import { SIM_HZ } from '../../src/shared/constants';
import { getMap } from '../../src/shared/maps/index';
import { makeGameConfig } from '../../src/shared/modes';
import { GameSim } from '../../src/shared/sim/game';
import { PVP_MAP_IDS } from '../../src/shared/types';

describe('performance', () => {
  it('a 10-player bot match steps in well under 0.6 ms per tick on average', () => {
    const results: string[] = [];
    let worstAvg = 0;
    for (const id of PVP_MAP_IDS) {
      const sim = new GameSim(makeGameConfig('control', id, { botFill: true, botDifficulty: 'elite' }), getMap(id), 77);
      sim.fillBots();
      expect(sim.players.length).toBe(10);
      void sim.nav; // navigation is built once per map and cached; exclude it from the tick budget
      for (let i = 0; i < SIM_HZ * 5; i++) {
        sim.step();
        sim.drainEvents();
      }
      const ticks = SIM_HZ * 40;
      const t0 = performance.now();
      for (let i = 0; i < ticks; i++) {
        sim.step();
        sim.drainEvents();
        if (i % 3 === 0) sim.buildSnapshot(sim.players[0].ident.id);
      }
      const avg = (performance.now() - t0) / ticks;
      worstAvg = Math.max(worstAvg, avg);
      results.push(`${id}: ${avg.toFixed(3)} ms/tick`);
    }
    console.log(`[perf] 10-player bot match — ${results.join(', ')}`);
    expect(worstAvg).toBeLessThan(0.6);
  });
});
