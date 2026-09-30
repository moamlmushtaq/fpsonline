// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel ground: every walkable surface the collision draws as
// 'hidden' — lawns, sun-bleached asphalt, sidewalks with curbs, the chapel /
// diner lots, the mall plaza, the pool deck — plus faded paint, cracks with
// weeds, oil stains and leaf litter. Subdivided so the painterly vertex drift
// reads across big areas.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV } from '../../../engine/palette';
import { type DecorKit, type Kind, type RGB, mix, rgb, vnoise } from './kit';

export const C = {
  lawn: mix(rgb(ENV.sage), rgb(ENV.sand), 0.25),
  lawnDark: rgb(ENV.olive),
  dry: rgb(ENV.sand),
  asphalt: rgb('#978f84'),
  asphaltDark: rgb('#857d72'),
  walk: rgb(ENV.concrete),
  plaza: rgb('#d6cdbb'),
  deck: rgb(ENV.bone),
  paint: rgb('#e9e0cc'),
  paintYellow: rgb('#e2d3ac'),
  curb: rgb('#cbc3b3'),
  oil: rgb('#4f4a45'),
};

/** Subdivided horizontal rectangle with painterly patches. */
export function ground(kit: DecorKit, kind: Kind, x0: number, z0: number, x1: number, z1: number, y: number, base: RGB, patch?: RGB, patchAmt = 0.35): void {
  const cell = kit.low ? 6 : 3;
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell));
  const nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  const shade = (x: number, _y: number, z: number): number => 0.94 + (vnoise(x * 0.21 + 5, z * 0.21 - 3) - 0.5) * 0.14;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const a0 = x0 + ((x1 - x0) * i) / nx;
      const a1 = x0 + ((x1 - x0) * (i + 1)) / nx;
      const b0 = z0 + ((z1 - z0) * j) / nz;
      const b1 = z0 + ((z1 - z0) * (j + 1)) / nz;
      const cx = (a0 + a1) / 2;
      const cz = (b0 + b1) / 2;
      let col = base;
      if (patch) {
        const p = THREE.MathUtils.smoothstep(vnoise(cx * 0.09 + 11, cz * 0.09 - 4), 0.42, 0.78) * patchAmt;
        col = mix(base, patch, p);
      }
      kit.slab(kind, a0, b0, a1, b1, y, col, { drift: 0.12, shade });
    }
  }
}

/** Dashed line along X or Z. */
function dashes(kit: DecorKit, along: 'x' | 'z', fixed: number, from: number, to: number, y: number, w: number, dash: number, gap: number, col: RGB): void {
  for (let t = from; t < to; t += dash + gap) {
    const e = Math.min(to, t + dash);
    if (along === 'z') kit.slab('paint', fixed - w / 2, t, fixed + w / 2, e, y, col, { drift: 0.2 });
    else kit.slab('paint', t, fixed - w / 2, e, fixed + w / 2, y, col, { drift: 0.2 });
  }
}

/** Curb strip (visual; 0.1 m). */
function curb(kit: DecorKit, x0: number, z0: number, x1: number, z1: number): void {
  kit.box('concrete', x0, -0.02, z0, x1, 0.1, z1, C.curb, 0.03, { ao: 0.25 });
}

export function buildGround(kit: DecorKit, rng: () => number): void {
  // ── Lawns: every outdoor ground solid top (minus the pool hole & mall) ──
  const lawn = (x0: number, z0: number, x1: number, z1: number): void => ground(kit, 'grass', x0, z0, x1, z1, 0, C.lawn, C.lawnDark, 0.55);
  lawn(-54, 12, 54, 54);
  lawn(-54, -54, 54, -12);
  lawn(-54, -12, -45, 12);
  lawn(15, -12, 54, 12);

  for (const s of [1, -1]) {
    const Z = (a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a]);
    // ── Main street + cul-de-sac bulb ──
    {
      const [a, b] = Z(0, 54);
      ground(kit, 'asphalt', 31, a, 43, b, 0.03, C.asphalt, C.asphaltDark, 0.4);
      dashes(kit, 'z', 37, a + 1, b - 12, 0.05, 0.16, 3, 3, C.paintYellow);
      // Sidewalks + curbs.
      ground(kit, 'concrete', 43, a, 45, b, 0.035, C.walk);
      ground(kit, 'concrete', 30, a, 31, b, 0.035, C.walk);
      curb(kit, 42.9, a, 43.08, b);
      curb(kit, 30.92, a, 31.1, b);
    }
    // Turnaround at the spawn end.
    {
      const zc = 47 * s;
      const r = 8.5;
      const seg = kit.low ? 16 : 28;
      const g = new THREE.CircleGeometry(r, seg);
      g.rotateX(-Math.PI / 2);
      kit.geo('asphalt', g, new THREE.Matrix4().makeTranslation(37, 0.031, zc), C.asphalt, { drift: 0.14 });
      g.dispose();
      // Island with an overgrown planter.
      kit.cyl('concrete', 37, 0, zc, 2.2, 2.3, 0.35, C.curb, 20);
      kit.cyl('grass', 37, 0.35, zc, 2.0, 2.0, 0.05, C.lawnDark, 20, { base: -Infinity });
    }
    // ── Parking lot + chapel / diner lot ──
    {
      const [a, b] = Z(15.6, 40);
      ground(kit, 'asphalt', -17, a, 17, b, 0.03, C.asphalt, C.asphaltDark, 0.35);
      const [c, d] = Z(40.4, 54);
      ground(kit, 'asphalt', -36, c, 30, d, 0.03, C.asphalt, C.asphaltDark, 0.3);
      // Stall lines (angled rows on both sides of the pylon island).
      const faded = mix(C.paint, C.asphalt, 0.25);
      for (let x = -14; x <= 14; x += 2.8) {
        if (Math.abs(x) < 3) continue;
        const [p, q] = Z(29.5, 34.5);
        kit.slab('paint', x - 0.06, p, x + 0.06, q, 0.05, faded, { drift: 0.3 });
        const [p2, q2] = Z(17.5, 21);
        if (Math.abs(x) > 4) kit.slab('paint', x - 0.06, p2, x + 0.06, q2, 0.05, faded, { drift: 0.3 });
      }
      for (let x = -32; x <= 26; x += 3) {
        const [p, q] = Z(49.5, 53.5);
        kit.slab('paint', x - 0.06, p, x + 0.06, q, 0.05, faded, { drift: 0.3 });
      }
      // Fire lane chevrons in front of the mall doors.
      for (const cx of [-6, 6]) {
        for (let i = 0; i < 3; i++) {
          const [p, q] = Z(13 + i * 0.9, 13.35 + i * 0.9);
          kit.slab('paint', cx - 2, p, cx + 2, q, 0.05, mix(C.paintYellow, C.asphalt, 0.3), { drift: 0.3 });
        }
      }
    }
    // ── Plaza apron around the mall (terrazzo-ish concrete) ──
    {
      const [a, b] = Z(12, 15.6);
      ground(kit, 'concrete', -15, a, 15, b, 0.037, C.plaza);
    }
    // Garage-row forecourts / driveways (concrete).
    {
      const [a, b] = Z(9, 12);
      ground(kit, 'concrete', -30, a, -15, b, 0.035, C.walk);
      ground(kit, 'concrete', 15, a, 31, b, 0.035, C.walk);
      // Bungalow driveways (carports) toward the outer lanes.
      const [c, d] = Z(25, 36);
      ground(kit, 'concrete', -54, c, -46, d, 0.035, C.walk, C.dry, 0.2);
      ground(kit, 'concrete', 46, c, 54, d, 0.035, C.walk, C.dry, 0.2);
      // Spawn exit paths (pavers).
      const [e, f] = Z(40, 42);
      ground(kit, 'concrete', -36, e, -26, f, 0.035, C.walk);
      ground(kit, 'concrete', 26, e, 36, f, 0.035, C.walk);
    }
    // Backyard patios along the houses.
    {
      const [a, b] = Z(15, 25);
      ground(kit, 'concrete', -45, a, -43, b, 0.036, C.plaza);
      const [c, d] = Z(18, 25);
      ground(kit, 'tile', -33.5, c, -30, d, 0.036, mix(C.deck, rgb(ENV.terracottaFaded), 0.35));
    }
  }

  // ── West service alley + cross street (mid band) ──
  ground(kit, 'concrete', -33, -12, -15, 12, 0.03, C.walk, C.dry, 0.25);
  ground(kit, 'asphalt', 15, -6.5, 31, 6.5, 0.03, C.asphalt, C.asphaltDark, 0.3);
  ground(kit, 'concrete', 15, -12, 31, -6.5, 0.03, C.walk, C.dry, 0.2);
  ground(kit, 'concrete', 15, 6.5, 31, 12, 0.03, C.walk, C.dry, 0.2);
  ground(kit, 'asphalt', 31, -12, 43, 12, 0.031, C.asphalt, C.asphaltDark, 0.35);
  // Crosswalks at the intersection.
  for (let i = 0; i < 6; i++) {
    const z = -5.5 + i * 2.2;
    kit.slab('paint', 29.2, z, 30.8, z + 1.1, 0.05, mix(C.paint, C.asphalt, 0.2), { drift: 0.3 });
  }
  for (const s of [1, -1]) {
    for (let i = 0; i < 5; i++) {
      const x = 32 + i * 2.2;
      kit.slab('paint', x, s * 13.2 - 0.8, x + 1.1, s * 13.2 + 0.8, 0.05, mix(C.paint, C.asphalt, 0.2), { drift: 0.3 });
    }
  }
  // Corner-house front walk + sidewalk.
  ground(kit, 'concrete', 43, -12, 44, 12, 0.035, C.walk);

  // ── Pool deck ──
  ground(kit, 'tile', -47.5, 5, -30, 12, 0.035, C.deck, rgb(ENV.pastelBlue), 0.3);
  ground(kit, 'tile', -47.5, -12, -30, -5, 0.035, C.deck, rgb(ENV.pastelBlue), 0.3);
  ground(kit, 'tile', -47.5, -5, -45, 5, 0.035, C.deck);
  ground(kit, 'tile', -33, -5, -30, 5, 0.035, C.deck);

  // ── Details: cracks with weeds, oil stains, leaf litter ──
  const count = Math.round(140 * kit.detail);
  const weed = mix(C.lawnDark, rgb(ENV.glowChartreuse), 0.18);
  for (let i = 0; i < count; i++) {
    const x = -52 + rng() * 104;
    const z = -52 + rng() * 104;
    if (Math.abs(x) < 15.5 && Math.abs(z) < 12.5) continue; // mall
    if (x > -45.5 && x < -32.5 && Math.abs(z) < 5.5) continue; // pool
    const len = 0.8 + rng() * 2.4;
    const ang = rng() * Math.PI;
    const onStreet = x > 31 && x < 43;
    if (rng() < 0.35) {
      // Oil stain / tar patch.
      kit.boxR('asphalt', x, 0.045, z, 0.6 + rng() * 1.2, 0.004, 0.5 + rng() * 0.9, ang, onStreet ? C.oil : mix(C.oil, C.asphalt, 0.5), 0, { drift: 0.3 });
    } else {
      // Crack line with a tuft of weeds.
      kit.boxR('paint', x, 0.052, z, len, 0.004, 0.05, ang, mix(C.oil, C.asphaltDark, 0.4), 0, { drift: 0 });
      const tufts = 2 + Math.floor(rng() * 3);
      for (let t = 0; t < tufts; t++) {
        const u = (rng() - 0.5) * len;
        const tx = x + Math.cos(ang) * u;
        const tz = z - Math.sin(ang) * u;
        kit.boxR('foliage', tx, 0.12, tz, 0.08, 0.26, 0.28, rng() * Math.PI, weed, 0, { drift: 0.2, base: -Infinity });
      }
    }
  }
}
