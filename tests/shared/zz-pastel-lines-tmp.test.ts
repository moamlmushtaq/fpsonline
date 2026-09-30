import { it } from 'vitest';
import { EYE_HEIGHT } from '../../src/shared/constants';
import { getMap } from '../../src/shared/maps/index';
import { CollisionWorld } from '../../src/shared/physics';
import { NavGraph } from '../../src/shared/sim/nav';
it('lines', () => {
  let total = 0;
  const map = getMap('pastel');
  const world = new CollisionWorld(map.solids, map.bounds, { waterY: map.waterY });
  const nav = NavGraph.build(world, map);
  const pts: number[][] = [];
  for (let i = 0; i < nav.mainNodes.length; i++) {
    const k = nav.mainNodes[i];
    const x = nav.px[k], z = nav.pz[k];
    if (Math.abs(z) > 39) continue;
    if (Math.abs((x + 54) % 2 - 0.5) < 0.3 && Math.abs((z + 54) % 2 - 0.5) < 0.3) pts.push([x, nav.py[k] + EYE_HEIGHT, z]);
  }
  const buckets = new Map<string, { n: number; best: number; ex: string }>();
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i], b = pts[j];
    const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
    if (d < 46) continue;
    const elevated = a[1] > 2.5 || b[1] > 2.5;
    if ((process.env.ELEV === '1') !== elevated) continue;
    if (world.segmentClear(a[0], a[1], a[2], b[0], b[1], b[2], 'sight')) {
      const key = `${Math.round(a[0] / 8) * 8},${Math.round(a[2] / 8) * 8} -> ${Math.round(b[0] / 8) * 8},${Math.round(b[2] / 8) * 8}`;
      const e = buckets.get(key) ?? { n: 0, best: 0, ex: '' };
      e.n++;
      if (d > e.best) { e.best = d; e.ex = `(${a.map((v) => v.toFixed(1))}) -> (${b.map((v) => v.toFixed(1))})`; }
      buckets.set(key, e);
    }
  }
  const list = [...buckets.entries()].sort((p, q) => q[1].n - p[1].n);
  console.log(`pts ${pts.length}; buckets ${list.length}`);
  for (const [k, e] of list.slice(0, 45)) console.log(`${e.n}\t${e.best.toFixed(0)}m\t${k}\t${e.ex}`);
});
