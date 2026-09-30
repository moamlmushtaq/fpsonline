// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry groundwork: the big flat surfaces get a painter's
// texture of use — expansion joints in the concrete apron, faded bone-white
// markings, oil stains, manhole covers, tyre ruts through the tank-farm sand,
// salt-crusted puddles near the seawall. All flat decals (walk-over, no
// collision), merged into the shared batches.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV } from '../../../engine/palette';
import { box, DecorKit } from './kit';

const JOINT = '#8f877b';

/** Rectangles (x0, z0, x1, z1) where apron joints are skipped (pad, buildings, pier). */
const SKIP: [number, number, number, number][] = [
  [-16.2, -17.2, 16.2, 17.2],
  [-34, -33, -24, 33],
  [22, -10, 32, 10],
];

function skipped(x: number, z: number): boolean {
  for (const [x0, z0, x1, z1] of SKIP) if (x > x0 && x < x1 && z > z0 && z < z1) return true;
  return false;
}

export function buildGround(kit: DecorKit, rnd: () => number, decor: number): void {
  // Expansion joints: a 6 m grid across the concrete apron (x −35 → 56).
  for (let x = -30; x < 56; x += 6) {
    let z0 = -60;
    for (let z = -60; z <= 60; z += 2) {
      const skip = skipped(x, z) || z >= 60;
      if (skip) {
        if (z - z0 > 2) kit.add('paint', box(x - 0.04, 0, z0, x + 0.04, 0.007, z - 0.2), JOINT, { flat: true });
        z0 = z + 2;
      }
    }
  }
  for (let z = -54; z < 60; z += 6) {
    let x0 = -35;
    for (let x = -35; x <= 56; x += 2) {
      const skip = skipped(x, z) || x >= 56;
      if (skip) {
        if (x - x0 > 2) kit.add('paint', box(x0, 0, z - 0.04, x - 0.2, 0.007, z + 0.04), JOINT, { flat: true });
        x0 = x + 2;
      }
    }
  }
  // Faded apron markings: lane lines along the east apron and the docks, parking bays.
  for (const s of [-1, 1]) {
    kit.add('paint', box(18.7, 0, s * 18, 18.95, 0.009, s * 44), ENV.boneShade, { flat: true });
    kit.add('paint', box(-23.4, 0, s * 12, -23.15, 0.009, s * 44), ENV.boneShade, { flat: true });
    for (let z = 20; z < 44; z += 4) kit.add('paint', box(33.5, 0, s * z, 34.2, 0.009, s * (z + 2)), ENV.boneShade, { flat: true });
    for (let x = 22; x < 34; x += 3) kit.add('paint', box(x, 0, s * 45.2, x + 0.12, 0.009, s * 49), ENV.boneShade, { flat: true });
  }
  // Oil stains and manhole covers.
  const stains: [number, number, number][] = [
    [-26, -51, 1.4],
    [-25, 50, 1.2],
    [10, -33, 2.2],
    [12, 34, 1.8],
    [-44, -8.5, 1.1],
    [50, -22, 1.6],
    [41, 26, 1.3],
    [28, 14, 1.0],
  ];
  for (const [x, z, r] of stains) {
    const g = new THREE.CircleGeometry(r, 12);
    g.scale(1, 0.7 + rnd() * 0.3, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0.008, z);
    kit.add('paint', g, '#8b8176', { flat: true });
  }
  for (const [x, z] of [
    [-12, -20],
    [-12, 20],
    [19.5, -30],
    [19.5, 30],
    [40, -8],
    [40, 8],
  ] as [number, number][]) {
    const g = new THREE.CircleGeometry(0.45, 14);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0.011, z);
    kit.add('metal', g, '#5c574f', { flat: true });
  }
  // Tyre ruts through the tank-farm sand (two darker strips curving north–south).
  for (const rx of [-40.6, -39.2]) {
    let px = rx;
    for (let z = -44; z < 44; z += 4) {
      const nx = rx + Math.sin(z * 0.07) * 2.2;
      const len = Math.hypot(nx - px, 4);
      const g = new THREE.PlaneGeometry(0.42, len);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.atan2(nx - px, 4));
      g.translate((px + nx) / 2, 0.01, z + 2);
      kit.add('sand', g, '#b9a584', { flat: true });
      px = nx;
    }
  }
  // Gravel patches and salt-crusted puddles.
  for (let i = 0; i < Math.round(24 * decor); i++) {
    const x = -62 + rnd() * 26;
    const z = (rnd() - 0.5) * 110;
    const g = new THREE.CircleGeometry(0.8 + rnd() * 1.8, 9);
    g.scale(1, 0.6 + rnd() * 0.4, 1);
    g.rotateX(-Math.PI / 2);
    g.rotateY(rnd() * Math.PI);
    g.translate(x, 0.009, z);
    kit.add('sand', g, rnd() < 0.5 ? ENV.sandLight : '#c4b08e', { flat: true });
  }
  for (const [x, z, r] of [
    [53, -36, 1.6],
    [50.5, 31, 1.3],
    [43, 3, 1.1],
  ] as [number, number, number][]) {
    const g = new THREE.CircleGeometry(r, 14);
    g.scale(1, 0.6, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0.012, z);
    kit.add('gloss', g, '#6f858c', { flat: true });
  }
}
