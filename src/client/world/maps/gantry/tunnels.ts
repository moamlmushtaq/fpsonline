// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry maintenance tunnels + flame trench (art pass 2).
// The two 2.6 m service tunnels get their period paint scheme (sage dado,
// bone stripe, warm-grey upper wall) with the caged lamps baked into the
// liners, sagging cable runs on hooks, a conduit with junction boxes, floor
// drains, puddles and leaf litter blown in from the mouths, deck grates that
// drop pale shafts of daylight, stencilled tunnel plates and glowing fungi in
// the corners. The trench gains puddles, cracks, rust drips and fungi.
// All non-colliding; the light shafts are returned for High.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { GANTRY_DECK as D } from '../../../../shared/maps/gantry';
import { ENV } from '../../../engine/palette';
import { box, boxC, cylAB, DecorKit, floorQuad, litWall, pipe, type BakedLight } from './kit';
import { uvD } from './decals';
import { puddle } from './groundwork';
import { floorDecal, fungi, hardHat, lunchbox, plate, wallDecal } from './props';

export interface ShaftAnchor {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  radius: number;
  color?: string;
  intensity?: number;
}

/** Downward-facing quad (ceiling decal / skylight). */
function ceilQuad(x: number, y: number, z: number, w: number, d: number, uv?: [number, number, number, number]): THREE.BufferGeometry {
  const g = floorQuad(0, 0, 0, w, d, uv);
  g.rotateX(Math.PI);
  g.translate(x, y, z);
  return g;
}

export function buildTunnels(kit: DecorKit, rnd: () => number, decor: number): ShaftAnchor[] {
  const shafts: ShaftAnchor[] = [];
  const XW = -9.245; // west liner face
  const XE = -6.755; // east liner face
  for (const s of [-1, 1] as const) {
    const za = s * 3.6;
    const zb = s * 16.95;
    const zl = Math.min(za, zb);
    const zh = Math.max(za, zb);
    // Lamps as laid out in pad.ts (east wall z 5.2/9.6/14, west wall +2.2).
    const lights: BakedLight[] = [];
    for (let z = 5.2; z < 17; z += 4.4) {
      lights.push({ x: XE, y: 1.95, z: s * z, r: 2.8, k: 0.95 }, { x: XW, y: 1.95, z: s * (z + 2.2), r: 2.8, k: 0.95 });
    }
    // Daylight spilling in from the mouth and down the grates.
    lights.push({ x: -8, y: 1.2, z: s * 17.4, r: 3.4, k: 0.8 });
    for (const gz of [8.3, 12.7]) lights.push({ x: -8, y: 2.3, z: s * gz, r: 1.9, k: 0.55 });

    // Period paint: sage dado, bone stripe, warm-grey upper wall.
    for (const [plane, n] of [
      [XW, 'x+'],
      [XE, 'x-'],
    ] as [number, 'x+' | 'x-'][]) {
      litWall(kit, n, plane, zl, zh, 0, 1.1, '#7c836c', 0.5, lights, 0.75);
      litWall(kit, n, plane, zl, zh, 1.18, 2.33, '#958b7d', 0.5, lights, 0.75);
      const nx = n === 'x+' ? 1 : -1;
      kit.add('paint', box(plane + nx * 0.004 - 0.004, 1.1, zl, plane + nx * 0.012, 1.18, zh), ENV.bone, { shade: (_x, _y, z) => 0.55 + 0.45 * Math.max(0, 1 - Math.abs(Math.abs(z) - 17) / 6) });
      // Panel seams every 1.5 m.
      for (let z = 4.5; z < 16.9; z += 1.5) kit.add('paint', box(plane - 0.005, 0.02, s * z - 0.02, plane + nx * 0.014, 2.3, s * z + 0.02), '#4c463f', { flat: true });
      // Hazard band at knee height by the mouth.
      wallDecal(kit, 'hazardFaded', plane + nx * 0.01, 0.55, s * 16.2, 1.4, 0.18, nx, 0);
      // Rust weeping from the ceiling pipes.
      for (let i = 0; i < 3; i++) wallDecal(kit, 'drip', plane + nx * 0.012, 1.7, s * (5 + rnd() * 11), 0.35, 1.1, nx, 0, '#ffffff', 0.9);
    }

    // Cable run sagging between hooks on the west wall.
    const hooks: number[] = [];
    for (let z = 3.9; z < 16.8; z += 1.6) hooks.push(z);
    const cables = kit.low ? 2 : 3;
    for (let c = 0; c < cables; c++) {
      const y = 1.78 - c * 0.07;
      const pts: [number, number, number][] = [];
      for (let i = 0; i < hooks.length; i++) {
        pts.push([XW + 0.07 + c * 0.035, y, s * hooks[i]]);
        if (i < hooks.length - 1) pts.push([XW + 0.07 + c * 0.035, y - 0.05 - c * 0.012, s * (hooks[i] + 0.8)]);
      }
      kit.add('fabric', pipe(pts, 0.02, 5, 0.75), c === 1 ? '#5a4f45' : '#34302c', { flat: true });
    }
    for (const z of hooks) kit.add('metal', box(XW, 1.74, s * z - 0.025, XW + 0.18, 1.8, s * z + 0.025), '#4c4743', { flat: true });
    // Conduit with junction boxes low on the east wall.
    kit.add('metal', cylAB(XE - 0.05, 0.45, za, XE - 0.05, 0.45, zb, 0.035, 0.035, 6), '#8a8680', { flat: true });
    for (let z = 5.8; z < 16.5; z += 4.1) {
      kit.add('metal', boxC(XE - 0.08, 0.45, s * z, 0.12, 0.26, 0.26), '#8e9474');
      kit.add('metal', cylAB(XE - 0.05, 0.58, s * z, XE - 0.05, 1.98, s * z, 0.025, 0.025, 5), '#8a8680', { flat: true });
    }
    plate(kit, 'signTunnel', XW + 0.012, 1.42, s * 15.3, 0.64, 0.32, 1, 0);
    plate(kit, 'signHardHat', XE - 0.012, 1.42, s * 4.4, 0.64, 0.32, -1, 0);

    // Floor: drain grates down the centre strip, puddles, cracks, leaf litter.
    for (let z = 5.6; z < 16.5; z += 3.6) {
      kit.add('paint', box(-8.35, 0.012, s * z - 0.3, -7.65, 0.016, s * z + 0.3), '#1f1c1a', { flat: true });
      kit.add('sign2', floorQuad(-8, 0.03, s * z, 0.72, 0.62, uvD('grate', 2)), '#ffffff', { flat: true });
    }
    puddle(kit, rnd, -8.6, 0.008, s * 10.6, 0.55);
    puddle(kit, rnd, -7.4, 0.008, s * 14.6, 0.45);
    floorDecal(kit, 'crackA', -8.1, 0.009, s * 7.2, 1.6, 1.6, rnd() * 3);
    floorDecal(kit, 'leaves', -8.0, 0.009, s * 16.3, 1.6, 1.3, rnd() * 3);
    floorDecal(kit, 'debris', -7.2, 0.009, s * 12.4, 0.9, 0.9, rnd() * 3);

    // Deck grates over the tunnel: daylight falls through in pale shafts.
    for (const gz of [8.3, 12.7]) {
      const z = s * gz;
      kit.add('glow', ceilQuad(-8, 2.334, z, 1.1, 0.8), '#fff0d2', { flat: true, k: 1.25 });
      kit.add('sign2', ceilQuad(-8, 2.326, z, 1.16, 0.86, uvD('grate', 2)), '#ffffff', { flat: true });
      kit.add('pool', floorQuad(-8, 0.035, z, 1.9, 1.5), '#fff1d0', { flat: true, k: 0.45 });
      kit.add('pool', floorQuad(-8, 0.04, z, 3.4, 2.8), '#ffe6c0', { flat: true, k: 0.16 });
      // On the deck above.
      kit.add('paint', box(-8.6, D, z - 0.45, -7.4, D + 0.008, z + 0.45), '#1f1c1a', { flat: true });
      kit.add('sign2', floorQuad(-8, D + 0.014, z, 1.3, 1.0, uvD('grate', 2)), '#ffffff', { flat: true });
      shafts.push({ pos: new THREE.Vector3(-8, 2.36, z), dir: new THREE.Vector3(0.18, -1, -0.05).normalize(), length: 2.6, radius: 0.55, color: '#fff0d2', intensity: 0.55 });
    }

    // Glowing fungi in the corners (both walls, plus a shelf crop on the dado).
    fungi(kit, rnd, XW + 0.2, 0, s * 6.4, 0.25, Math.round(7 * decor));
    fungi(kit, rnd, XE - 0.2, 0, s * 11.5, 0.25, Math.round(6 * decor));
    fungi(kit, rnd, XW + 0.02, 0.25, s * 12.8, 0.35, Math.round(6 * decor), 1, 0);
    fungi(kit, rnd, XE - 0.02, 0.2, s * 15.8, 0.3, Math.round(5 * decor), -1, 0);
  }

  // ── Flame trench additions ────────────────────────────────────────────────
  puddle(kit, rnd, -0.6, 0.008, 2.25, 0.6);
  puddle(kit, rnd, 8.6, 0.008, -2.3, 0.7);
  puddle(kit, rnd, 13.4, 0.008, 2.0, 0.8);
  for (let i = 0; i < Math.round(8 * decor); i++) {
    const x = -11 + rnd() * 26;
    const z = (rnd() - 0.5) * 6;
    if (x > 0.5 && x < 5.5 && Math.abs(z) < 2.2) continue; // deflector
    floorDecal(kit, rnd() < 0.5 ? 'crackA' : 'crackB', x, 0.009, z, 1.4 + rnd(), 1.4 + rnd(), rnd() * 6);
  }
  floorDecal(kit, 'debris', 14.6, 0.009, -2.6, 1.2, 1.2, 0.4);
  floorDecal(kit, 'leaves', 15.2, 0.009, 2.4, 1.5, 1.2, 1.1);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) wallDecal(kit, 'drip', -10 + i * 6.5 + rnd(), 1.8, s * 3.47, 0.45, 1.3, 0, -s, '#ffffff', 0.85);
    fungi(kit, rnd, -11.6, 0, s * 3.1, 0.3, Math.round(7 * decor));
  }
  fungi(kit, rnd, 15.0, 0, -3.1, 0.3, Math.round(5 * decor));
  fungi(kit, rnd, 7.2, 0.25, 3.47, 0.4, Math.round(6 * decor), 0, -1);
  // Someone left in a hurry: a hard hat and a lunch box by the valve housing.
  hardHat(kit, -10.75, 0.11, 2.6, ENV.bone);
  lunchbox(kit, -11.3, 0.008, 2.95, 0.6, ENV.pastelYellow, false);
  return shafts;
}
