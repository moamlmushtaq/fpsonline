// Bot CPU budget: a full 10-player bot match (sim + bot thinking + director)
// must average well under 0.6 ms per tick in Node, in every mode and on every
// map. Thinking is staggered (20 Hz per bot, offset by id), so ticks stay flat.
//
// Each configuration is timed over several 5-second windows and the best window
// is kept: on a busy CI box (parallel test files, other processes) wall-clock
// time includes time the thread was descheduled, and the fastest window is the
// best estimate of the code's own cost.
import { describe, expect, it } from 'vitest';
import { SIM_HZ } from '../../src/shared/constants';
import { getMap } from '../../src/shared/maps/index';
import { makeGameConfig } from '../../src/shared/modes';
import { GameSim } from '../../src/shared/sim/game';
import type { ModeId } from '../../src/shared/types';
import { PVP_MAP_IDS } from '../../src/shared/types';

describe('bot performance', () => {
  it('10-player bot matches stay under 0.6 ms/tick on average (tdm / control / ffa, all maps)', () => {
    const rows: string[] = [];
    let worst = 0;
    for (const mode of ['tdm', 'control', 'ffa'] as ModeId[]) {
      for (const id of PVP_MAP_IDS) {
        const cfg = { ...makeGameConfig(mode, id, { botFill: true, botDifficulty: 'elite' }), maxPlayers: 10, countdown: 0, scoreLimit: 0 };
        const sim = new GameSim(cfg, getMap(id), 1234);
        sim.fillBots();
        void sim.nav; // navigation + lane skeleton are built once per map and cached
        for (let i = 0; i < SIM_HZ * 3; i++) {
          sim.step();
          sim.drainEvents();
        }
        const window = SIM_HZ * 5;
        let best = Infinity;
        let sum = 0;
        for (let w = 0; w < 5; w++) {
          const t0 = performance.now();
          for (let i = 0; i < window; i++) {
            sim.step();
            sim.drainEvents();
          }
          const ms = (performance.now() - t0) / window;
          best = Math.min(best, ms);
          sum += ms;
        }
        worst = Math.max(worst, best);
        rows.push(`${mode}/${id} ${best.toFixed(3)} (mean ${(sum / 5).toFixed(3)})`);
      }
    }
    console.log(`[bots perf] ms/tick — ${rows.join(', ')}`);
    expect(worst).toBeLessThan(0.6);
  }, 120_000);
});
