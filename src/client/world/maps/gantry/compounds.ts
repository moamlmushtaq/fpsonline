// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry spawn compounds and forecourts.
//  • South: HALCYON's sun-bleached Vehicle Assembly Hangar (corrugated bone
//    walls, giant stacked doors, agency emblem, the next rocket stage lying on
//    its cradle inside, sodium work lamps), a derelict crawler-transporter, the
//    blast baffle painted with the faded "HALCYON I — FIRST LIGHT" mural.
//  • North: THE BLOOM's overgrown tracking station (brutalist sage concrete, a
//    slowly sweeping radar dish on the roof, vines with glowing bulbs), the
//    same crawler reclaimed by moss, the baffle tagged with glowing paint.
// Collision is mirror-symmetric; the dressing is not.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV } from '../../../engine/palette';
import { lamp, moss } from './pad';
import { beam, box, boxC, cyl, cylAB, DecorKit, GREENS, floorQuad, lathe, quad, railing, rbox, sphere } from './kit';
import { LEAF_UV, uvOf } from './signage';

const STEEL_DARK = ENV.metalDark;
const RUST = ENV.rust;

export interface CompoundAnim {
  dish: THREE.Group;
  flag: THREE.Mesh;
  flagBase: Float32Array;
}

/** Hanging vine strand with leaves and a few glowing bulbs. */
export function vine(kit: DecorKit, rnd: () => number, x: number, y: number, z: number, len: number, nx: number, nz: number, bulbs = true): void {
  const segs = Math.max(2, Math.round(len / 0.7));
  let px = x;
  let pz = z;
  let py = y;
  for (let i = 0; i < segs; i++) {
    const ny = py - len / segs;
    const qx = px + (rnd() - 0.5) * 0.25 + nx * 0.04;
    const qz = pz + (rnd() - 0.5) * 0.25 + nz * 0.04;
    kit.add('foliage', cylAB(px, py, pz, qx, ny, qz, 0.04, 0.04, 4), GREENS[0], { flat: true, k: 0.8 });
    if (rnd() < 0.7) kit.add('foliage', sphere(qx + nx * 0.1, ny + 0.2, qz + nz * 0.1, 0.14 + rnd() * 0.12, 5, 3, 0.55), GREENS[Math.floor(rnd() * 3)], { flat: true, k: 0.85 });
    if (bulbs && rnd() < 0.3) kit.add('glow', sphere(qx + nx * 0.14, ny, qz + nz * 0.14, 0.07 + rnd() * 0.06, 6, 4), rnd() < 0.7 ? ENV.glowChartreuse : ENV.glowSoftPink, { flat: true, k: 2.6 });
    px = qx;
    py = ny;
    pz = qz;
  }
}

/**
 * Ivy curtain on a wall: overlapping alpha-tested leaf cards hung from the top
 * edge (dense crown, trailing tongues), with a few glowing bulbs.
 * a0..a1 run along the wall's tangent; the wall plane sits at `plane` on the
 * normal axis; n = outward normal.
 */
export function ivy(kit: DecorKit, rnd: () => number, a0: number, a1: number, yTop: number, plane: number, n: 'x+' | 'x-' | 'z+' | 'z-', density: number, maxDrop: number): void {
  const nx = n === 'x+' ? 1 : n === 'x-' ? -1 : 0;
  const nz = n === 'z+' ? 1 : n === 'z-' ? -1 : 0;
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  let t = lo;
  let layer = 0;
  while (t < hi) {
    const w = 1.4 + rnd() * 1.4;
    if (rnd() < 0.3 + 0.7 * density) {
      const h = Math.max(1.2, maxDrop * (0.35 + rnd() * 0.65));
      const c = Math.min(hi - 0.2, t + w / 2);
      const off = 0.05 + (layer++ % 3) * 0.02;
      const px = nx !== 0 ? plane + nx * off : c;
      const pz = nz !== 0 ? plane + nz * off : c;
      kit.add('leaf', quad(px, yTop - h / 2 + 0.3, pz, w, h + 0.6, nx, nz, LEAF_UV.curtain), '#ffffff', { flat: true, k: 0.85 + rnd() * 0.25 });
      if (rnd() < 0.5) kit.add('glow', sphere(px + nx * 0.08, yTop - rnd() * h * 0.7, pz + nz * 0.08, 0.06 + rnd() * 0.05, 6, 4), rnd() < 0.7 ? ENV.glowChartreuse : ENV.glowSoftPink, { flat: true, k: 1.8 });
    }
    t += w * 0.62;
  }
}

/** Crossed-card bush (or fern tuft) standing on the ground. */
export function bush(kit: DecorKit, x: number, y: number, z: number, size: number, rot: number, tuft = false): void {
  const uv = tuft ? LEAF_UV.tuft : LEAF_UV.bush;
  for (let k = 0; k < 2; k++) {
    const a = rot + (k * Math.PI) / 2;
    kit.add('leaf', quad(x, y + size * 0.45, z, size * 1.2, size, Math.sin(a), Math.cos(a), uv), '#ffffff', { flat: true, k: 0.9 });
  }
}

function crawler(kit: DecorKit, rnd: () => number, s: number, overgrown: boolean, decor: number): void {
  // Collision: x 6..16, z s*[30,37], top 2.4. Everything stays inside that box.
  const z0 = s * 30;
  const z1 = s * 37;
  const zl = Math.min(z0, z1);
  const zh = Math.max(z0, z1);
  const body = overgrown ? '#8f8a74' : '#a79a88';
  // Four track trucks.
  for (const tx of [6.05, 12.6]) {
    for (const tz of [zl + 0.05, zh - 2.45]) {
      kit.add('metal', rbox(tx, 0, tz, tx + 3.35, 1.35, tz + 2.4, 0.3, 2), '#5c534b');
      for (let k = 0; k < 7; k++) kit.add('metal', box(tx + 0.2 + k * 0.45, 0, tz - 0.02, tx + 0.45 + k * 0.45, 0.2, tz + 2.42), RUST, { flat: true });
      kit.add('metal', cylAB(tx + 0.6, 0.68, tz - 0.03, tx + 0.6, 0.68, tz + 2.43, 0.5, 0.5, 10), '#4a433d');
      kit.add('metal', cylAB(tx + 2.75, 0.68, tz - 0.03, tx + 2.75, 0.68, tz + 2.43, 0.5, 0.5, 10), '#4a433d');
    }
  }
  // Deck with jacking cylinders, handrail stubs, rivet bands.
  kit.add('paint', rbox(6.05, 1.35, zl + 0.05, 15.95, 2.4, zh - 0.05, 0.1), body);
  for (const jx of [8, 14]) for (const jz of [zl + 1.2, zh - 1.2]) kit.add('metal', cyl(jx, 1.2, jz, 0.45, 1.25, 10), '#8a8680');
  kit.add('metal', box(6.0, 1.9, zl + 0.02, 16.0, 2.0, zh - 0.02), '#6f665d', { flat: true });
  kit.add('sign', quad(11, 1.9, s > 0 ? zl + 0.01 : zh - 0.01, 3.4, 0.45, 0, s > 0 ? -1 : 1, uvOf('hazard')), '#ffffff', { flat: true });
  // Rust streaks.
  for (let i = 0; i < 6; i++) kit.add('paint', quad(6.6 + i * 1.7, 1.6, s > 0 ? zl : zh, 0.3, 0.9, 0, s > 0 ? -1 : 1), '#7c5a45', { flat: true });
  if (overgrown) {
    for (let i = 0; i < Math.round(26 * decor); i++) {
      const x = 6.4 + rnd() * 9.2;
      const z = zl + 0.4 + rnd() * 6.2;
      kit.add('foliage', sphere(x, 2.42, z, 0.35 + rnd() * 0.5, 6, 3, 0.35), GREENS[Math.floor(rnd() * 3)], { flat: true });
    }
    ivy(kit, rnd, 6.2, 15.8, 2.45, s > 0 ? zl - 0.02 : zh + 0.02, s > 0 ? 'z-' : 'z+', decor, 1.8);
    moss(kit, rnd, 11, 2.41, s * 33.5, 1.4, Math.round(10 * decor));
  }
}

function tanker(kit: DecorKit, s: number, overgrown: boolean, rnd: () => number, decor: number): void {
  // Collision: x -30..-22, z s*[50.6,53], h 3.0. Cab at +x end.
  const zl = Math.min(s * 50.6, s * 53);
  const zh = Math.max(s * 50.6, s * 53);
  const zc = (zl + zh) / 2;
  const cabCol = overgrown ? '#9fa98c' : '#e8dcc4';
  kit.add('paint', rbox(-24.6, 0.55, zl + 0.05, -22.05, 2.95, zh - 0.05, 0.25, 2), cabCol);
  kit.add('glass', box(-22.08, 1.9, zl + 0.25, -22.0, 2.6, zh - 0.25), '#cfe0e6', { flat: true });
  kit.add('paint', box(-22.3, 0.4, zl + 0.02, -21.98, 0.9, zh - 0.02), '#c9785b');
  kit.add('metal', cylAB(-29.8, 1.85, zc, -24.8, 1.85, zc, 1.1, 1.1, 16), overgrown ? '#b9bfa6' : '#efe6d6');
  kit.add('metal', sphere(-29.8, 1.85, zc, 1.1, 12, 8, 1), overgrown ? '#b9bfa6' : '#efe6d6');
  kit.add('paint', box(-29.9, 0.35, zl + 0.1, -24.6, 0.75, zh - 0.1), '#4a433d');
  for (const wx of [-29, -27.8, -23.6]) for (const wz of [zl + 0.02, zh - 0.37]) kit.add('metal', cylAB(wx, 0.5, wz, wx, 0.5, wz + 0.35, 0.5, 0.5, 12), '#2f2c2a');
  kit.add('sign', quad(-27.3, 1.85, s > 0 ? zl - 0.02 : zh + 0.02, 2.2, 0.3, 0, s > 0 ? -1 : 1, uvOf('stencilRp1')), '#ffffff', { flat: true });
  if (overgrown) ivy(kit, rnd, -29.8, -24.8, 3.0, s > 0 ? zl - 0.02 : zh + 0.02, s > 0 ? 'z-' : 'z+', decor, 1.6);
}

export function buildCompounds(kit: DecorKit, rnd: () => number, root: THREE.Group, decor: number): CompoundAnim {
  // ════ HALCYON: Vehicle Assembly Hangar (south) ════════════════════════════
  {
    const s = -1;
    const wall = '#e4d9c5';
    // Upper facade above the collision walls (12 → 22 m), side walls and back.
    kit.add('corrugated', box(-18.5, 12, -46.5, 18.5, 22, -46), wall, { base: 12, flat: true });
    kit.add('corrugated', box(-18.5, 12, -60.5, -18, 22, -46), wall, { flat: true });
    kit.add('corrugated', box(18, 12, -60.5, 18.5, 22, -46), wall, { flat: true });
    kit.add('corrugated', box(-18.5, 0, -60.8, 18.5, 22, -60.2), wall, { flat: true });
    kit.add('concrete', box(-19.2, 21.8, -61, 19.2, 22.6, -45.4), ENV.boneShade);
    kit.add('concrete', box(-19.2, 22.6, -45.8, 19.2, 23.4, -45.4), ENV.bone);
    // Corner pilasters and plinth band.
    for (const x of [-18.8, 18.8]) kit.add('concrete', box(x - 0.55, 0, -46.8, x + 0.55, 22.6, -45.7), ENV.bone);
    kit.add('concrete', box(-18.8, 0, -46.1, -14.5, 0.8, -45.8), ENV.concreteDark);
    kit.add('concrete', box(14.5, 0, -46.1, 18.8, 0.8, -45.8), ENV.concreteDark);
    // Giant stacked door panels above the lintel line.
    for (let i = 0; i < 5; i++) {
      const y0 = 6 + i * 2.8;
      kit.add('metal', rbox(-6.2, y0 + 0.05, -46.4, 6.2, y0 + 2.75, -46.05, 0.06), i % 2 ? '#d9cdb8' : '#e8dcc4');
      kit.add('metal', box(-6.2, y0 + 1.3, -46.08, 6.2, y0 + 1.45, -46.0), '#b8ad9a', { flat: true });
    }
    kit.add('metal', box(-0.08, 6, -46.06, 0.08, 20, -45.98), '#8e877b', { flat: true });
    kit.add('sign', quad(0, 21.2, -45.97, 7.5, 0.95, 0, 1, uvOf('stencilHangar')), '#ffffff', { flat: true });
    // Work floodlights on the shaded north facade (sunset is behind the hangar):
    // over the corner doors, washing the emblem, and warm light spilling out of the door.
    for (const x of [-16.3, 16.3]) {
      kit.add('metal', box(x - 0.5, 7.0, -46.0, x + 0.5, 7.5, -45.4), ENV.metalDark, { flat: true });
      kit.add('glow', box(x - 0.42, 7.0, -45.42, x + 0.42, 7.1, -45.38), ENV.glowGold, { flat: true, k: 2.8 });
      kit.add('pool', quad(x, 5.2, -45.95, 5.5, 5, 0, 1), ENV.glowGold, { flat: true, k: 0.3 });
      kit.add('pool', floorQuad(x, 0.03, -43.5, 6, 6), ENV.glowGold, { flat: true, k: 0.26 });
    }
    kit.add('metal', box(-12, 12.2, -45.9, -10.4, 12.7, -45.2), ENV.metalDark, { flat: true });
    kit.add('glow', box(-11.9, 12.2, -45.25, -10.5, 12.3, -45.2), '#fff1d6', { flat: true, k: 2.4 });
    kit.add('pool', quad(-11.2, 16.2, -45.94, 15, 8.5, 0, 1), '#ffe6c0', { flat: true, k: 0.2 });
    kit.add('pool', quad(0, 3, -46.45, 12, 6, 0, 1), ENV.glowGold, { flat: true, k: 0.35 });
    kit.add('pool', floorQuad(0, 0.03, -44, 13, 5), ENV.glowGold, { flat: true, k: 0.28 });
    // Agency emblem + lettering over the west bay.
    kit.add('sign', quad(-11.2, 16.2, -45.96, 13.2, 6.6, 0, 1, uvOf('facadeHalcyon')), '#ffffff', { flat: true });
    // Clerestory windows (east + west walls) and roof vents.
    for (const x of [-18.52, 18.52]) {
      for (let z = -58; z < -47; z += 3.2) kit.add('glass', box(x - 0.03, 14, z, x + 0.03, 17, z + 2.4), '#9fb4be', { flat: true });
    }
    for (const x of [-10, 0, 10]) kit.add('metal', rbox(x - 1.4, 22.6, -55, x + 1.4, 24, -52, 0.2), '#b8b6ae');
    // Corner roll-up doors (half raised) with striped frames.
    for (const sx of [-1, 1]) {
      const xa = sx * 14.5;
      const xb = sx * 18;
      kit.add('metal', box(Math.min(xa, xb), 3.2, -46.45, Math.max(xa, xb), 6, -46.1), '#c9c1b0');
      for (let y = 3.3; y < 6; y += 0.35) kit.add('metal', box(Math.min(xa, xb), y, -46.1, Math.max(xa, xb), y + 0.06, -46.04), '#a79f90', { flat: true });
      kit.add('metal', box(Math.min(xa, xb) - 0.05, 6, -46.5, Math.max(xa, xb) + 0.05, 6.6, -45.9), STEEL_DARK);
      kit.add('sign', quad(sx * 16.25, 2.95, -45.98, 3.4, 0.3, 0, 1, uvOf('hazard')), '#ffffff', { flat: true });
    }
    // Interior: the next rocket's first stage on its transport cradle (the spawn cover).
    const stageCol = '#efe6d6';
    kit.add('paint', cylAB(-12.2, 2.3, -51, 12.4, 2.3, -51, 2.2, 2.2, kit.seg(28)), stageCol);
    for (let x = -10; x <= 10; x += 5) kit.add('paint', cylAB(x, 2.3, -51, x + 1.2, 2.3, -51, 2.23, 2.23, kit.seg(28)), '#34302c');
    kit.add('metal', lathe([[0.02, 0], [2.2, 0], [2.2, 0.4], [1.2, 1.8], [0.02, 1.8]], kit.seg(24)).rotateZ(Math.PI / 2).translate(-12.2, 2.3, -51), '#9a9b98');
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const b = lathe([[0.3, 0], [0.45, 0.4], [0.75, 1.3], [0.85, 1.7]], 12);
      b.rotateZ(-Math.PI / 2);
      b.translate(12.4, 2.3 + Math.cos(a) * (k ? 1.2 : 0), -51 + Math.sin(a) * (k ? 1.2 : 0));
      kit.add('metal', b, '#3a3633');
    }
    for (const x of [-9, 0, 9]) {
      kit.add('metal', box(x - 0.8, 0, -53.4, x + 0.8, 0.9, -48.6), '#8a7d6f');
      kit.add('metal', box(x - 0.8, 0.9, -53.4, x + 0.8, 1.5, -52.5), '#8a7d6f');
      kit.add('metal', box(x - 0.8, 0.9, -49.5, x + 0.8, 1.5, -48.6), '#8a7d6f');
    }
    kit.add('sign', quad(0, 2.4, -48.75, 5, 0.62, 0, 1, uvOf('stencilPad')), '#ffffff', { flat: true });
    // Work platforms high on the side walls, an overhead crane, sodium lamps.
    for (const x of [-17.9, 17.9]) {
      kit.add('metal', box(x - (x < 0 ? 0 : 2), 9.6, -59.5, x + (x < 0 ? 2 : 0), 9.9, -47), '#8a8680');
      kit.addAll('metal', railing(x + (x < 0 ? 2 : -2), 9.9, -59.5, x + (x < 0 ? 2 : -2), 9.9, -47, 1, 2.5), ENV.bone);
    }
    kit.add('paint', box(-18, 18, -56.5, 18, 19.2, -55.3), '#c9a24e');
    kit.add('paint', box(-1, 15.5, -56.3, 1, 18, -55.5), '#55585c');
    kit.add('metal', cylAB(0, 15.5, -55.9, 0, 9, -55.9, 0.03, 0.03, 4), STEEL_DARK);
    for (const x of [-12, -4, 4, 12]) {
      for (const z of [-57.5, -48]) {
        kit.add('metal', cylAB(x, 21.8, z, x, 11.6, z, 0.02, 0.02, 3), STEEL_DARK, { flat: true });
        kit.add('metal', lathe([[0.05, 0], [0.6, -0.1], [0.62, -0.5]], 10, x, 11.6, z), '#8a8680');
        kit.add('glow', sphere(x, 11.1, z, 0.28, 8, 6), ENV.glowGold, { flat: true, k: 2.6 });
        kit.add('pool', floorQuad(x, 0.02, z, 9.5, 9.5), ENV.glowGold, { flat: true, k: 0.3 });
      }
    }
    // Back wall: lockers, benches, posters (all within the unreachable margin).
    for (let x = -16; x < 16; x += 0.9) {
      if (Math.abs(x) < 3) continue;
      kit.add('paint', box(x, 0, -60.2, x + 0.85, 2.1, -59.62), (Math.floor(x) & 1) === 0 ? '#9fb4be' : '#b9cfda');
      kit.add('paint', box(x + 0.1, 1.6, -59.63, x + 0.75, 1.64, -59.6), '#6d7a80', { flat: true });
    }
    kit.add('sign', quad(-1.6, 2.4, -60.15, 1.4, 2.1, 0, 1, uvOf('posterReach')), '#ffffff', { flat: true });
    kit.add('sign', quad(1.6, 2.4, -60.15, 1.4, 2.1, 0, 1, uvOf('posterSafety')), '#ffffff', { flat: true });
    // Sunset through the east clerestory lands high on the west wall.
    for (let z = -58; z < -47; z += 3.2) kit.add('pool', quad(-17.93, 11.4, z + 1.2, 2.8, 3.4, 1, 0), '#ffc08e', { flat: true, k: 0.45 });
    // Painted assembly floor (darker than the sunlit apron outside).
    kit.add('concrete', box(-18, 0, -60, 18, 0.006, -46.5), '#8a8176', { flat: true });
    // Floor bay markings.
    for (const x of [-14.5, 14.5]) kit.add('paint', box(x - 0.08, 0, -59.5, x + 0.08, 0.012, -46.5), '#d8cdb8', { flat: true });
    void s;
  }

  // ════ BLOOM: overgrown tracking station (north) ═══════════════════════════
  const dish = new THREE.Group();
  dish.name = 'gantry.dish';
  {
    const concrete = '#b3b89f';
    kit.add('concrete', box(-18.5, 12, 46, 18.5, 13.4, 46.5), concrete, { flat: true });
    kit.add('concrete', box(-18.5, 12, 46, -18, 13.4, 60.5), concrete, { flat: true });
    kit.add('concrete', box(18, 12, 46, 18.5, 13.4, 60.5), concrete, { flat: true });
    kit.add('concrete', box(-18.5, 0, 60.2, 18.5, 13.4, 60.8), concrete, { flat: true });
    kit.add('concrete', box(-19, 12.6, 45.6, 19, 13.2, 61), '#a3ad8f');
    // Brutalist vertical fins on the facade + a dark window band.
    for (let x = -18; x <= 18; x += 3) {
      if (Math.abs(x) < 7 || (Math.abs(x) > 14 && Math.abs(x) < 18)) continue;
      kit.add('concrete', box(x - 0.3, 0.8, 45.72, x + 0.3, 12.6, 46), '#c1c5ae');
    }
    // Window band: the reclaimed interior glows faintly through the dusty glass.
    kit.add('glow', box(-14.3, 7.4, 46.0, -6.2, 9.6, 46.02), '#55683f', { flat: true, k: 0.75 });
    kit.add('glow', box(6.2, 7.4, 46.0, 14.3, 9.6, 46.02), '#55683f', { flat: true, k: 0.75 });
    kit.add('glass', box(-14.3, 7.4, 45.94, -6.2, 9.6, 46.0), '#7f9199', { flat: true });
    kit.add('glass', box(6.2, 7.4, 45.94, 14.3, 9.6, 46.0), '#7f9199', { flat: true });
    kit.add('concrete', box(-18, 0, 46.5, 18, 0.006, 60), '#6f7466', { flat: true });
    kit.add('sign', quad(0, 9.2, 45.96, 11.4, 2.85, 0, -1, uvOf('facadeStation')), '#ffffff', { flat: true });
    // Bioluminescent spill from the reclaimed interior + two old sodium lamps still burning.
    kit.add('pool', quad(0, 3, 46.45, 12, 6, 0, -1), ENV.glowChartreuse, { flat: true, k: 0.22 });
    kit.add('pool', floorQuad(0, 0.03, 44, 13, 5), ENV.glowChartreuse, { flat: true, k: 0.18 });
    for (const x of [-16.3, 16.3]) {
      kit.add('metal', box(x - 0.5, 7.0, 45.4, x + 0.5, 7.5, 46.0), ENV.metalDark, { flat: true });
      kit.add('glow', box(x - 0.42, 7.0, 45.38, x + 0.42, 7.1, 45.42), ENV.glowGold, { flat: true, k: 2.4 });
      kit.add('pool', quad(x, 5.2, 45.95, 5.5, 5, 0, -1), ENV.glowGold, { flat: true, k: 0.26 });
      kit.add('pool', floorQuad(x, 0.03, 43.5, 6, 6), ENV.glowGold, { flat: true, k: 0.22 });
    }
    kit.add('sign', quad(16.25, 2.95, 45.98, 3.4, 0.3, 0, -1, uvOf('hazard')), '#ffffff', { flat: true });
    kit.add('sign', quad(-16.25, 2.95, 45.98, 3.4, 0.3, 0, -1, uvOf('stencilStation')), '#ffffff', { flat: true });
    // Corner doors: steel shutters jammed half open, overgrown.
    for (const sx of [-1, 1]) {
      kit.add('metal', box(Math.min(sx * 14.5, sx * 18), 3.0, 46.1, Math.max(sx * 14.5, sx * 18), 6.2, 46.45), '#9aa08c');
    }
    // Roof: turret + sweeping dish (animated group), masts, vines.
    kit.add('concrete', cyl(0, 13.2, 53, 3.2, 3.6, kit.seg(20), 2.6), '#c1c5ae');
    const dk = new DecorKit(kit.ctx);
    dk.add('metal', box(-2.4, 0, -0.6, 2.4, 0.8, 0.6), '#8a8680');
    dk.add('metal', box(-2.4, 0, -0.6, -2.0, 5.2, 0.6), '#8a8680');
    dk.add('metal', box(2.0, 0, -0.6, 2.4, 5.2, 0.6), '#8a8680');
    // Dish in its own frame (vertex at origin, axis +y), tilted up toward the pad.
    const M = new THREE.Matrix4().makeTranslation(0, 5.0, -1.2).multiply(new THREE.Matrix4().makeRotationX(-0.95));
    const bowl: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const r = (i / 10) * 9;
      bowl.push([Math.max(0.05, r), (r * r) / 30]);
    }
    dk.add('paint', lathe(bowl, kit.seg(40)), '#efe6d6', { shade: (_x, y) => 0.72 + 0.28 * Math.min(1, Math.max(0, (y - 1) / 9)) }, M);
    dk.add('metal', lathe([[0.02, -0.6], [1.4, -0.6], [1.6, 0.2], [0.02, 0.2]], 12), '#8a8680', {}, M);
    const feedY = 7.5;
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2 + 0.3;
      dk.add('metal', beam(Math.cos(ang) * 8.4, 2.35, Math.sin(ang) * 8.4, 0, feedY, 0, 0.12), '#9a9b98', {}, M);
    }
    dk.add('metal', cylAB(0, feedY - 0.6, 0, 0, feedY + 0.7, 0, 0.55, 0.35, 10), '#8a8680', {}, M);
    // The Bloom's vines drape over the dish rim.
    const rim = new THREE.Vector3();
    for (let i = 0; i < Math.round(8 * decor); i++) {
      const ang = Math.PI * (0.1 + 0.8 * (i / 8));
      rim.set(Math.cos(ang) * 9, 2.7, Math.sin(ang) * 9).applyMatrix4(M);
      vine(dk, rnd, rim.x, rim.y, rim.z, 2 + rnd() * 2.5, 0, 0);
    }
    dk.build(dish);
    dish.position.set(0, 16.8, 53);
    (dish.userData as { kit?: DecorKit }).kit = dk;
    root.add(dish);
    for (const [x, z] of [
      [-16, 58],
      [16, 48],
    ] as [number, number][]) {
      kit.add('metal', cylAB(x, 13.2, z, x, 24, z, 0.14, 0.06, 6), '#9a9b98');
      for (let y = 15; y < 24; y += 2.5) kit.add('metal', box(x - 0.9, y, z - 0.04, x + 0.9, y + 0.06, z + 0.04), '#9a9b98');
      kit.add('glow', sphere(x, 24.2, z, 0.16, 6, 4), ENV.glowGold, { flat: true, k: 3 });
    }
    // Ivy pouring over the parapet and down the facade, a few hanging strands, moss at its feet.
    ivy(kit, rnd, -18.5, -6.5, 13.2, 45.4, 'z-', decor, 9);
    ivy(kit, rnd, 6.5, 18.5, 13.2, 45.4, 'z-', decor, 10);
    ivy(kit, rnd, -5.5, 5.5, 13.2, 45.9, 'z-', decor * 0.6, 3.5);
    ivy(kit, rnd, 46.5, 60, 13.2, -18.55, 'x-', decor * 0.8, 8);
    ivy(kit, rnd, 46.5, 60, 13.2, 18.55, 'x+', decor * 0.8, 8);
    for (let i = 0; i < Math.round(8 * decor); i++) vine(kit, rnd, -18 + rnd() * 36, 12.9, 45.3, 2 + rnd() * 5, 0, -1);
    moss(kit, rnd, -10, 0, 45.2, 1.6, Math.round(12 * decor));
    moss(kit, rnd, 11, 0, 45.2, 1.4, Math.round(10 * decor));
    // Interior: racks of tracking electronics (the spawn cover), dead indicator lamps, plants.
    for (let x = -14.4; x < 14.4; x += 1.8) {
      kit.add('paint', rbox(x + 0.05, 0, 48.55, x + 1.75, 4.45, 53.45, 0.05), x < 0 ? '#aeb49a' : '#c1c5ae');
      for (let y = 0.6; y < 4; y += 0.55) {
        kit.add('paint', box(x + 0.2, y, 48.5, x + 1.6, y + 0.4, 48.54), '#3a3a36', { flat: true });
        if (rnd() < 0.35) kit.add('glow', box(x + 0.3 + rnd() * 1.1, y + 0.15, 48.49, x + 0.42 + rnd() * 1.1, y + 0.25, 48.5), rnd() < 0.7 ? ENV.glowGold : ENV.glowChartreuse, { flat: true, k: 1.4 });
      }
    }
    for (let i = 0; i < Math.round(10 * decor); i++) vine(kit, rnd, -14 + rnd() * 28, 4.45, 48.5, 0.8 + rnd() * 2, 0, -1);
    for (let i = 0; i < Math.round(20 * decor); i++) {
      const x = -14 + rnd() * 28;
      kit.add('foliage', sphere(x, 4.5, 49 + rnd() * 4, 0.4 + rnd() * 0.5, 6, 3, 0.4), GREENS[Math.floor(rnd() * 3)], { flat: true });
    }
    for (const x of [-12, -4, 4, 12]) {
      kit.add('glow', sphere(x, 11.2, 55, 0.24, 8, 6), ENV.glowSoftPink, { flat: true, k: 1.8 });
      kit.add('metal', cylAB(x, 12.4, 55, x, 11.4, 55, 0.02, 0.02, 3), STEEL_DARK, { flat: true });
      kit.add('pool', floorQuad(x, 0.02, 55, 6, 6), ENV.glowSoftPink, { flat: true, k: 0.12 });
    }
    kit.add('sign', quad(-1.6, 2.4, 60.15, 1.4, 2.1, 0, -1, uvOf('posterSky')), '#ffffff', { flat: true });
    kit.add('sign', quad(1.6, 2.4, 60.15, 1.4, 2.1, 0, -1, uvOf('posterReach')), '#ffffff', { flat: true });
  }

  // ════ Forecourts (both sides) ═════════════════════════════════════════════
  for (const s of [-1, 1] as const) {
    const bloom = s > 0;
    // Blast baffle: coping + mural (Halcyon) / glowing graffiti (Bloom) on the pad side.
    kit.add('concrete', box(-9.1, 4.5, s * 40 - 0.05, 9.1, 4.7, s * 41 + 0.05), ENV.bone);
    const face = s * 40 - s * 0.02;
    if (!bloom) kit.add('sign', quad(0, 2.3, face, 17.4, 4.1, 0, -s, uvOf('mural')), '#ffffff', { flat: true, k: 0.95 });
    else {
      kit.add('sign', quad(-3.5, 2.2, face, 8.5, 3.6, 0, -s, uvOf('mural')), '#ffffff', { flat: true, k: 0.62 });
      kit.add('signGlow', quad(3.2, 2.3, face - s * 0.01, 9.5, 3.4, 0, -s, uvOf('graffiti')), '#ffffff', { flat: true, k: 1.25 });
      ivy(kit, rnd, -9, 9, 4.6, face, s > 0 ? 'z-' : 'z+', decor * 0.7, 2.6);
    }
    kit.add('sign', quad(0, 2.3, s * 41 + s * 0.02, 5, 0.6, 0, s, uvOf('stencilPad')), '#ffffff', { flat: true });
    // Gooseneck lamps on the baffle's crown wash the pad-side painting.
    for (const x of [-5, 5]) {
      kit.add('metal', beam(x, 4.7, s * 40.5, x, 5.3, s * 40.5 - s * 0.9, 0.06), ENV.metalDark, { flat: true });
      kit.add('metal', box(x - 0.3, 5.1, s * 40.5 - s * 1.15, x + 0.3, 5.4, s * 40.5 - s * 0.75), ENV.metalDark, { flat: true });
      kit.add('glow', box(x - 0.25, 5.08, s * 40.5 - s * 1.1, x + 0.25, 5.1, s * 40.5 - s * 0.8), ENV.glowGold, { flat: true, k: 2.6 });
      kit.add('pool', quad(x, 2.6, face - s * 0.02, 8, 4.4, 0, -s), ENV.glowGold, { flat: true, k: 0.24 });
    }
    // Weeds in the cracks; the Bloom's side is properly reclaimed.
    const weeds = Math.round((bloom ? 26 : 8) * decor);
    for (let i = 0; i < weeds; i++) {
      const x = -22 + rnd() * 44;
      const z = s * (18 + rnd() * 26);
      if (Math.abs(x) < 9.5 && Math.abs(z) > 39.5 && Math.abs(z) < 41.5) continue;
      bush(kit, x, 0, z, bloom ? 0.8 + rnd() * 1.2 : 0.5 + rnd() * 0.5, rnd() * Math.PI, !bloom || rnd() < 0.5);
    }
    if (bloom) {
      // Bloom flora in the pad's shade: glowing moss and tall bulb stalks.
      for (const [x, z] of [
        [-16.5, 43.5],
        [15.8, 43.8],
        [-8.5, 39.3],
        [8.7, 39.3],
        [-21.8, 33],
        [4.8, 18.4],
        [-6.5, 18.2],
      ] as [number, number][]) {
        moss(kit, rnd, x, 0, z, 0.9, Math.round(14 * decor));
        for (let i = 0; i < Math.round(4 * decor); i++) {
          const px = x + (rnd() - 0.5) * 1.6;
          const pz = z + (rnd() - 0.5) * 1.2;
          const h = 0.7 + rnd() * 1.3;
          kit.add('foliage', beam(px, 0, pz, px + (rnd() - 0.5) * 0.3, h, pz + (rnd() - 0.5) * 0.3, 0.035), GREENS[1], { flat: true });
          kit.add('glow', sphere(px, h + 0.08, pz, 0.1 + rnd() * 0.08, 7, 5, 1.3), rnd() < 0.6 ? ENV.glowChartreuse : ENV.glowSoftPink, { flat: true, k: 2.6 });
        }
      }
      for (const [x, z, sz] of [
        [-17.5, 44.5, 2.2],
        [17.2, 44.8, 2.6],
        [-9.6, 39.2, 1.8],
        [9.8, 39.4, 2.0],
        [-22.5, 30, 2.4],
        [21.5, 26, 2.0],
      ] as [number, number, number][]) bush(kit, x, 0, z, sz, rnd() * Math.PI);
    }
    crawler(kit, rnd, s, bloom, decor);
    tanker(kit, s, bloom, rnd, decor);
    // Cable drums (x -6..-3.6, z s*[29.2, 31], h 1.2).
    for (const cx of [-5.4, -4.2]) {
      const zc = s * 30.1;
      kit.add('wood', cylAB(cx - 0.55, 0.6, zc, cx + 0.55, 0.6, zc, 0.6, 0.6, 14), '#b39a7f');
      kit.add('wood', cylAB(cx - 0.35, 0.6, zc, cx + 0.35, 0.6, zc, 0.62, 0.62, 14), '#6e5a4a');
    }
    for (const cx of [-5.4, -4.2]) {
      const d0 = new THREE.CylinderGeometry(0.6, 0.6, 0.08, 16);
      d0.rotateX(Math.PI / 2);
      d0.translate(cx, 0.6, s * 29.25);
      kit.add('wood', d0, '#8c7660');
    }
    // Barrier hazard stripes.
    kit.add('sign', quad(-13, 0.62, s * 23.8 - s * 0.02, 3.9, 0.35, 0, -s, uvOf('hazard')), '#ffffff', { flat: true });
    // Lamp masts on unreachable roofs + yard floodlights.
    // Boundary fence along the yards (unreachable margin beyond the bounds).
    for (const [xa, xb] of [
      [-64, -18.5],
      [18.5, 64],
    ] as [number, number][]) {
      const z = s * 60.25;
      for (let x = xa; x <= xb; x += 3) kit.add('metal', box(x - 0.05, 0, z - 0.05, x + 0.05, 2.8, z + 0.05), '#8a8680', { flat: true });
      for (const y of [0.9, 1.8, 2.7]) kit.add('metal', box(xa, y, z - 0.015, xb, y + 0.025, z + 0.015), '#8a8680', { flat: true });
      kit.add('metal', box(xa, 2.72, z - 0.25, xb, 2.76, z + 0.25), '#6d6a64', { flat: true });
    }
    // Oil drums and pallets tucked against the fence (within the bounds margin).
    for (let i = 0; i < Math.round(10 * decor); i++) {
      const x = (rnd() < 0.5 ? -60 : 24) + rnd() * 30;
      const col = rnd() < 0.5 ? ENV.terracottaFaded : rnd() < 0.5 ? ENV.sage : ENV.pastelBlue;
      kit.add('paint', cyl(x, 0, s * 60.1, 0.3, 0.9, 10), col);
    }
    // Lamp posts along the yards' fence line.
    for (const x of [-40, -26, 26, 40, 54]) {
      kit.add('metal', cylAB(x, 0, s * 60.4, x, 9, s * 60.4, 0.12, 0.08, 8), '#8a8680');
      kit.add('metal', box(x - 0.4, 9, s * 60.4 - s * 1.2, x + 0.4, 9.3, s * 60.4), '#6d6a64');
      kit.add('glow', box(x - 0.3, 8.98, s * 60.4 - s * 1.1, x + 0.3, 9.0, s * 60.4 - s * 0.2), ENV.glowGold, { flat: true, k: 2.2 });
    }
  }
  void boxC;

  // Tattered agency flag on the hangar roof (animated by vertex offsets).
  const flagGeo = new THREE.PlaneGeometry(4.2, 2.6, 12, 6);
  flagGeo.translate(2.1, 0, 0);
  const flagTex = kit.ctx.materials.canvasTexture('gantry.flag', 128, 80, (c, w, h) => {
    c.fillStyle = '#efe6d6';
    c.fillRect(0, 0, w, h);
    c.fillStyle = ENV.terracottaFaded;
    c.beginPath();
    c.arc(w * 0.45, h * 0.62, h * 0.32, Math.PI, 0);
    c.fill();
    c.fillStyle = '#2f2a26';
    for (let i = 0; i < 3; i++) c.fillRect(w * 0.22, h * (0.68 + i * 0.09), w * 0.46, h * 0.04);
    // Frayed trailing edge.
    c.clearRect(w - 10, 0, 10, h);
    for (let y = 0; y < h; y += 6) c.clearRect(w - 20 - ((y * 7) % 14), y, 20, 4);
  });
  const flagMat = new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
  kit.owned.push(flagMat);
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(-16, 26.6, -47);
  flag.castShadow = kit.shadows;
  root.add(flag);
  kit.add('metal', cylAB(-16, 22.6, -47, -16, 28.2, -47, 0.07, 0.05, 6), '#9a9b98');
  const flagBase = Float32Array.from(flagGeo.attributes.position.array as Float32Array);
  return { dish, flag, flagBase };
}
