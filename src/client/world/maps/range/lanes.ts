// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range: the lanes and the far berm.
//
// Raked-sand lane field with faded bone lane and row lines, big painted
// distance numerals on the ground (read from the firing line), distance
// boards on the lane posts, steel rails under the strafing targets, concrete
// lips around the pop-up pits, and the bullet berm: sandbag face, timber
// frames, the HALCYON PROVING GROUND board, scrub and glowing sprouts in the
// berm's shade.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV } from '../../../engine/palette';
import { RANGE_COURSE } from '../../../../shared/maps/range';
import type { MapDef } from '../../../../shared/maps/types';
import { rgb, type RangeKit } from './kit';
import type { SignAtlas } from './signs';

const C = RANGE_COURSE;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** One sandbag (squashed capsule) — shared geometry. */
export function sandbag(k: RangeKit, x: number, y: number, z: number, ry: number, color: [number, number, number]): void {
  const g = k.cached('sandbag', () => new THREE.CapsuleGeometry(0.17, 0.42, 2, k.low ? 6 : 8).rotateZ(Math.PI / 2).scale(1, 0.62, 0.95));
  k.place('fabric', g, V(x, y + 0.1, z), new THREE.Euler(0, ry, 0), V(1, 1, 1), color, { base: y, ao: 0.3 });
}

export function buildLanes(k: RangeKit, signs: SignAtlas, def: MapDef, rng: () => number): void {
  const paint = rgb(ENV.bone, 0.9);
  const sandLight = rgb(ENV.sandLight);
  const sandBag = rgb('#cdb68e');
  const metal = rgb(ENV.metalDark);
  const concrete = rgb(ENV.concrete);
  const terra = rgb(ENV.terracottaFaded);

  // Raked lane field (slightly lighter sand) and faded lines.
  k.slab('sand', -17.4, -103, 1.4, -1.4, 0.006, sandLight, { drift: 0.35 });
  for (const x of [-17.3, -11.3, -5.3, 0.7]) k.slab('paint', x - 0.04, -103, x + 0.04, -1.4, 0.014, paint, { drift: 0.4 });
  for (const r of C.rows) {
    k.slab('paint', -17.3, r.z + 1.1, 0.7, r.z + 1.22, 0.014, paint, { drift: 0.4 });
    // Painted numerals, growing with distance so they read in perspective.
    const w = 3.4 + (r.distance / 100) * 4.2;
    signs.ground(`ground.${r.distance}`, V(-8.3, 0.018, r.z + 2.4 + w * 0.25), 0, w);
  }

  // Distance boards on the lane posts (post caps + angled boards).
  for (const r of C.rows) {
    for (const [x, ry] of [
      [-18.7, 0.32],
      [2.1, -0.32],
    ] as const) {
      k.box('ceramic', x - 0.26, 1.2, r.z - 0.26, x + 0.26, 1.28, r.z + 0.26, rgb(ENV.bone), 0.04);
      k.box('trim', x - 0.03, 1.28, r.z - 0.03, x + 0.03, 1.4, r.z + 0.03, metal);
      signs.backed(k, `dist.${r.distance}`, V(x, 1.72, r.z), ry, 0.62, rgb(ENV.boneShade));
    }
  }

  // Rails under strafers, lips around pop-up pits.
  for (const t of def.targets ?? []) {
    if (t.path) {
      const x0 = Math.min(t.pos.x, t.pos.x + t.path.x) - 0.55;
      const x1 = Math.max(t.pos.x, t.pos.x + t.path.x) + 0.55;
      k.box('trim', x0, 0, t.pos.z - 0.2, x1, 0.05, t.pos.z - 0.14, metal);
      k.box('trim', x0, 0, t.pos.z + 0.14, x1, 0.05, t.pos.z + 0.2, metal);
      k.box('paint', x0 - 0.14, 0, t.pos.z - 0.26, x0, 0.16, t.pos.z + 0.26, terra, 0.03);
      k.box('paint', x1, 0, t.pos.z - 0.26, x1 + 0.14, 0.16, t.pos.z + 0.26, terra, 0.03);
    } else if (t.popup) {
      const { x, z } = t.pos;
      k.box('concrete', x - 0.7, 0, z - 0.55, x + 0.7, 0.08, z - 0.4, concrete);
      k.box('concrete', x - 0.7, 0, z + 0.4, x + 0.7, 0.08, z + 0.55, concrete);
      k.box('concrete', x - 0.7, 0, z - 0.4, x - 0.55, 0.08, z + 0.4, concrete);
      k.box('concrete', x + 0.55, 0, z - 0.4, x + 0.7, 0.08, z + 0.4, concrete);
      k.slab('paint', x - 0.55, z - 0.4, x + 0.55, z + 0.4, 0.01, rgb(ENV.shadowWarm, 1.2));
    }
  }

  // ── The berm: sandbag face, timber frames, the big board, scrub + sprouts ──
  const bz = -100.95;
  const nBags = Math.round(58 * (0.55 + 0.45 * k.detail));
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < nBags - row * 6; i++) {
      const span = 38.4 - row * 3;
      const x = -span / 2 + (i + (row % 2) * 0.5) * (span / (nBags - row * 6)) + (rng() - 0.5) * 0.08;
      sandbag(k, x, row * 0.24, bz + row * -0.12 + (rng() - 0.5) * 0.05, (rng() - 0.5) * 0.12, row % 2 ? sandBag : rgb('#c7ae84'));
    }
  }
  // The big board stands on the crest.
  for (const x of [-4.2, 4.2]) k.box('wood', x - 0.12, 6.6, -106.9, x + 0.12, 8.2, -106.66, rgb('#9c7a55'));
  signs.backed(k, 'berm', V(0, 8.9, -106.6), 0, 1.75, rgb(ENV.boneShade), 0.08);
  // Scrub on the berm top, glowing sprouts in its shade.
  const scrub = Math.round(26 * k.detail);
  for (let i = 0; i < scrub; i++) {
    const x = -18 + rng() * 36;
    const z = -101.8 - rng() * 7.5;
    const s = 0.4 + rng() * 0.6;
    const gy = Math.min(7, Math.max(0, (-101.2 - z) * (7 / 5.3)));
    k.place('grass', k.cached('scrub', () => new THREE.IcosahedronGeometry(1, 0)), V(x, gy + s * 0.12, z), new THREE.Euler(rng() * 0.3, rng() * 6, 0), V(s * 1.3, s * 0.45, s), rgb(i % 3 ? ENV.olive : ENV.sage), { drift: 0.2 });
  }
  const sprouts = Math.round(34 * k.detail);
  for (let i = 0; i < sprouts; i++) {
    const x = -18.6 + rng() * 37.2;
    const z = bz + 0.25 + rng() * 0.7;
    const h = 0.18 + rng() * 0.45;
    k.cyl('paint', x, 0, z, 0.012, 0.022, h, rgb(ENV.olive), 5, { drift: 0 });
    k.place('glow', k.cached('bulb', () => new THREE.IcosahedronGeometry(1, 0)), V(x, h, z), new THREE.Euler(), V(0.045 + rng() * 0.03, 0.06, 0.045), rgb(i % 4 === 0 ? ENV.glowGold : ENV.glowChartreuse, 2.2), { drift: 0 });
  }
}
