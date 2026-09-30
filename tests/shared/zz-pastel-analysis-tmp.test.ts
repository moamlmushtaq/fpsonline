import { it } from 'vitest';
import { EYE_HEIGHT, SIM_HZ } from '../../src/shared/constants';
import { getMap } from '../../src/shared/maps/index';
import { makeGameConfig } from '../../src/shared/modes';
import { GameSim } from '../../src/shared/sim/game';
import { CollisionWorld } from '../../src/shared/physics';
import { NavGraph } from '../../src/shared/sim/nav';

it('analysis', () => {
  const map = getMap('pastel');
  const world = new CollisionWorld(map.solids, map.bounds, { waterY: map.waterY });
  const nav = NavGraph.build(world, map);
  console.log('solids', map.solids.length, 'nav nodes', nav.count, 'main', nav.mainNodes.length);
  // 1. spawn visibility from enemy-reachable nodes with z < 30 (for team 0 spawns at +z)
  const spawns0 = map.spawns.filter((s) => s.team === 0);
  const vis: string[] = [];
  for (const s of spawns0) {
    let worst = 999; let wp = '';
    let count = 0;
    for (let i = 0; i < nav.mainNodes.length; i++) {
      const k = nav.mainNodes[i];
      const x = nav.px[k], y = nav.py[k], z = nav.pz[k];
      if (z > 30) continue;
      const d = Math.hypot(x - s.pos.x, z - s.pos.z);
      if (d > 75) continue;
      if (world.segmentClear(x, y + EYE_HEIGHT, z, s.pos.x, s.pos.y + EYE_HEIGHT, s.pos.z, 'sight') ||
          world.segmentClear(x, y + EYE_HEIGHT, z, s.pos.x, s.pos.y + 1.0, s.pos.z, 'sight')) {
        count++;
        if (z < worst) { worst = z; wp = `(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)})`; }
      }
    }
    vis.push(`spawn ${JSON.stringify(s.pos)} seen from ${count} nodes (z<30); min z ${worst.toFixed(1)} at ${wp}`);
  }
  console.log(vis.join('\n'));
  // 2. long sightlines: sample nodes on a 3 m grid
  const pts: number[][] = [];
  for (let i = 0; i < nav.mainNodes.length; i++) {
    const k = nav.mainNodes[i];
    const x = nav.px[k], z = nav.pz[k];
    if (Math.abs((x + 54) % 3 - 0.5) < 0.3 && Math.abs((z + 54) % 3 - 0.5) < 0.3) pts.push([x, nav.py[k] + EYE_HEIGHT, z]);
  }
  let long = 0; const ex: string[] = [];
  let maxd = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i], b = pts[j];
    const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
    if (d < 50) continue;
    if (world.segmentClear(a[0], a[1], a[2], b[0], b[1], b[2], 'sight')) {
      long++; maxd = Math.max(maxd, d);
      if (ex.length < 30 && Math.random() < 0.05) ex.push(`${a.map((v) => v.toFixed(0))} -> ${b.map((v) => v.toFixed(0))} d=${d.toFixed(0)}`);
    }
  }
  console.log(`pts ${pts.length}, sightlines > 50m: ${long}, max ${maxd.toFixed(1)}\n` + ex.join('\n'));
});

function heat(mode: 'tdm' | 'control', seed: number) {
  const map = getMap('pastel');
  const cfg = { ...makeGameConfig(mode, 'pastel', { botFill: true, botDifficulty: 'veteran' }), maxPlayers: 10 };
  const sim = new GameSim(cfg, map, seed);
  sim.fillBots();
  const G = 4; const N = 27; const grid = new Float64Array(N * N);
  let lanes = [0, 0, 0]; let up = 0; let total = 0; let kills = 0;
  const killPos: number[][] = [];
  for (let i = 0; i < 150 * SIM_HZ; i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.ev.t === 'kill') { kills++; const v = sim.players.find((p) => p.ident.id === (e.ev as any).v); if (v) killPos.push([v.move.pos.x, v.move.pos.z]); }
    if (i % 30) continue;
    for (const p of sim.players) {
      if (!p.alive) continue;
      const { x, y, z } = p.move.pos;
      const gx = Math.floor((x + 54) / G), gz = Math.floor((z + 54) / G);
      if (gx >= 0 && gz >= 0 && gx < N && gz < N) grid[gz * N + gx]++;
      if (Math.abs(z) < 40) { lanes[x < -17 ? 0 : x > 17 ? 2 : 1]++; total++; }
      if (y > 1.5) up++;
    }
  }
  let max = 0; for (const v of grid) max = Math.max(max, v);
  const chars = ' .:-=+*#%@';
  const rows: string[] = [];
  for (let gz = 0; gz < N; gz++) { let r = ''; for (let gx = 0; gx < N; gx++) { const v = grid[gz * N + gx]; r += chars[Math.min(9, Math.ceil((v / max) * 9))]; } rows.push(r); }
  console.log(`${mode} seed ${seed}: kills ${kills}, lanes W/C/E ${lanes.map((l) => ((l / total) * 100).toFixed(0) + '%').join('/')}, elevated ${((up / (total || 1)) * 100).toFixed(0)}%, scores ${sim.teamScores}\n` + rows.join('\n'));
  // kill heat
  const kg = new Float64Array(N * N);
  for (const [x, z] of killPos) { const gx = Math.floor((x + 54) / G), gz = Math.floor((z + 54) / G); if (gx >= 0 && gz >= 0 && gx < N && gz < N) kg[gz * N + gx]++; }
  const kr: string[] = [];
  for (let gz = 0; gz < N; gz++) { let r = ''; for (let gx = 0; gx < N; gx++) { const v = kg[gz * N + gx]; r += v ? String(Math.min(9, v)) : '.'; } kr.push(r); }
  console.log('kills:\n' + kr.join('\n'));
}
it('heat tdm', () => heat('tdm', 11));
it('heat control', () => heat('control', 12));
