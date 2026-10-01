// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry center: the launch pad, the lattice launch tower with
// its service platform and swing arms, the flame trench + maintenance tunnels
// underneath (dark, piped, emergency-lit, with glowing moss by the drips), the
// broken grate over the Sunspear, the crawlerway, and the hero rocket.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { GANTRY_DECK as D, GANTRY_GRATE, GANTRY_L1 as L1, GANTRY_ROCKET } from '../../../../shared/maps/gantry';
import { ENV } from '../../../engine/palette';
import { box, boxC, beam, cylAB, DecorKit, GREENS, floorQuad, lattice, litFloor, pipe, quad, railing, rbox, sphere, stairs, type BakedLight } from './kit';
import { uvOf } from './signage';

const DARK = '#4b443d';
const SOOT = '#3a3431';
const TOWER = '#8e9ea6'; // dusty blue-grey steel: complementary to the sunset, never a team color
const TOWER_DARK = '#6f7a80';
const STEEL = ENV.metalLight;
const STEEL_DARK = ENV.metalDark;

/** Emergency lamp: caged glowing box + soft light pools on the wall (and floor). */
export function lamp(kit: DecorKit, x: number, y: number, z: number, nx: number, nz: number, color: string = ENV.glowGold, poolSize = 3.2, floorY: number | null = 0): void {
  kit.add('metal', boxC(x - nx * 0.06, y, z - nz * 0.06, nz !== 0 ? 0.42 : 0.12, 0.22, nx !== 0 ? 0.42 : 0.12), STEEL_DARK, { flat: true });
  kit.add('glow', boxC(x + nx * 0.02, y, z + nz * 0.02, nz !== 0 ? 0.34 : 0.1, 0.14, nx !== 0 ? 0.34 : 0.1), color, { flat: true, k: 3.2 });
  // Wire cage over the lens (two bars + a hoop): reads as a caged service lamp.
  for (const dy of [-0.045, 0.045]) kit.add('metal', boxC(x + nx * 0.085, y + dy, z + nz * 0.085, nz !== 0 ? 0.38 : 0.014, 0.014, nx !== 0 ? 0.38 : 0.014), STEEL_DARK, { flat: true });
  kit.add('metal', boxC(x + nx * 0.085, y, z + nz * 0.085, 0.014, 0.17, 0.014), STEEL_DARK, { flat: true });
  kit.add('pool', quad(x + nx * 0.05, y - 0.2, z + nz * 0.05, poolSize, poolSize * 0.8, nx, nz), color, { flat: true, k: 0.42 });
  if (floorY !== null) kit.add('pool', floorQuad(x + nx * 0.9, floorY + 0.03, z + nz * 0.9, poolSize * 1.1, poolSize * 1.1), color, { flat: true, k: 0.22 });
}

/**
 * A cluster of bioluminescent moss: a dark leafy mat, a few pods on thin
 * stems with glowing tips (chartreuse / pale gold / soft pink), and a soft
 * light pool on the surface around it. For shaded corners only.
 */
export function moss(kit: DecorKit, rnd: () => number, x: number, y: number, z: number, spread: number, count: number, wallNx = 0, wallNz = 0): void {
  const onWall = wallNx !== 0 || wallNz !== 0;
  // Leafy mat.
  if (!onWall) {
    for (let k = 0; k < Math.max(1, Math.round(count / 5)); k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * spread * 0.7;
      const mat = new THREE.CircleGeometry(0.25 + rnd() * spread * 0.45, 7);
      mat.rotateX(-Math.PI / 2);
      mat.translate(x + Math.cos(a) * r, y + 0.012 + k * 0.002, z + Math.sin(a) * r);
      kit.add('foliage', mat, GREENS[k % 3], { flat: true, k: 0.55 });
    }
  }
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * spread;
    let px = x + Math.cos(a) * r;
    let pz = z + Math.sin(a) * r;
    let py = y;
    if (onWall) {
      // Spread up the wall instead of across the floor.
      px = x + (wallNz !== 0 ? Math.cos(a) * r : 0) + wallNx * 0.03;
      pz = z + (wallNx !== 0 ? Math.cos(a) * r : 0) + wallNz * 0.03;
      py = y + Math.abs(Math.sin(a)) * r * 0.8;
    }
    const hue = rnd();
    const col = hue < 0.62 ? ENV.glowChartreuse : hue < 0.86 ? ENV.glowGold : ENV.glowSoftPink;
    const stem = onWall ? 0.02 : 0.06 + rnd() * 0.16;
    if (!onWall) kit.add('foliage', beam(px, py, pz, px + (rnd() - 0.5) * 0.05, py + stem, pz + (rnd() - 0.5) * 0.05, 0.018), GREENS[0], { flat: true });
    const tip = 0.022 + rnd() * 0.03;
    kit.add('glow', sphere(px, py + stem + tip * 0.6, pz, tip, 5, 3, 1.2), col, { flat: true, k: 2.0 + rnd() * 1.0 });
  }
  const size = spread * 3.2;
  kit.add('pool', onWall ? quad(x + wallNx * 0.04, y + spread * 0.4, z + wallNz * 0.04, size, size * 0.8, wallNx, wallNz) : floorQuad(x, y + 0.03, z, size, size), ENV.glowChartreuse, { flat: true, k: 0.28 });
}

export interface PadAnim {
  arms: THREE.Group;
  shaftAnchors: { pos: THREE.Vector3; dir: THREE.Vector3; length: number; radius: number; color?: string; intensity?: number }[];
}

export function buildPad(kit: DecorKit, rnd: () => number, root: THREE.Group, decor: number): PadAnim {
  const RX = GANTRY_ROCKET.x;
  const halves: (1 | -1)[] = [-1, 1];

  // ── Pad shell dressing ────────────────────────────────────────────────────
  // Coping band and pilasters on the outer faces.
  kit.add('concrete', box(-16.06, D - 0.35, -17.06, 16.06, D, -16.94), ENV.bone);
  kit.add('concrete', box(-16.06, D - 0.35, 16.94, 16.06, D, 17.06), ENV.bone);
  kit.add('concrete', box(15.94, D - 0.35, -17.06, 16.06, D, -3.5), ENV.bone);
  kit.add('concrete', box(15.94, D - 0.35, 3.5, 16.06, D, 17.06), ENV.bone);
  // West coping stops at the deck-level alcove under L1 (|z| ≤ 5, filled to the deck).
  kit.add('concrete', box(-16.06, D - 0.35, -17.06, -15.94, D, -5), ENV.bone);
  kit.add('concrete', box(-16.06, D - 0.35, 5, -15.94, D, 17.06), ENV.bone);
  for (const s of halves) {
    for (let x = -14; x <= 14; x += 4) {
      if ((x > -10 && x < -6) || (x > 0 && x < 6)) continue; // tunnel mouth / crawlerway
      kit.add('concrete', box(x - 0.3, 0, s * 17 - 0.12, x + 0.3, D - 0.35, s * 17 + 0.12), ENV.boneShade);
    }
    for (let z = 5; z <= 15; z += 5) kit.add('concrete', box(15.88, 0, s * z - 0.3, 16.14, D - 0.35, s * z + 0.3), ENV.boneShade);
    // Big "7" roundels on the deck.
    kit.add('sign', floorQuad(-8.5, D + 0.012, s * 11.5, 5.2, 5.2, uvOf('deckSeven'), s > 0 ? Math.PI : 0), '#ffffff', { flat: true, k: 0.9 });
  }

  // Scorched ring around the launch mount + blast marks on the deck.
  for (let i = 0; i < 3; i++) {
    const r0 = 3.9 + i * 1.5;
    const ring = new THREE.RingGeometry(r0, r0 + 1.4, 40, 1);
    ring.rotateX(-Math.PI / 2);
    ring.translate(RX, D + 0.006 + i * 0.001, 0);
    kit.add('paint', ring, i === 0 ? SOOT : i === 1 ? '#6a5f55' : '#9d9285', { flat: true });
  }
  // Crawlerway rails: from the hangar doors, up the ramps, across the deck to the mount.
  for (const s of halves) {
    for (const rx of [RX - 1.9, RX + 1.9]) {
      kit.add('metal', box(rx - 0.09, 0, s * 46, rx + 0.09, 0.07, s * 38.1), '#7a6a5e');
      kit.add('metal', box(rx - 0.09, 0, s * 36.9, rx + 0.09, 0.07, s * 26), '#7a6a5e');
      const ramp = beam(rx, 0.04, s * 26, rx, D + 0.04, s * 17, 0.18);
      kit.add('metal', ramp, '#7a6a5e', { flat: true });
      kit.add('metal', box(rx - 0.09, D, s * 17, rx + 0.09, D + 0.06, s * 3.7), '#7a6a5e', { flat: true });
      // Gravel crawlerway bed with rusty tread scars.
      kit.add('sand', box(rx - 1.1, 0, s * 45.5, rx + 1.1, 0.03, s * 38.1), '#c8b393', { flat: true });
      kit.add('sand', box(rx - 1.1, 0, s * 36.9, rx + 1.1, 0.03, s * 26.2), '#c8b393', { flat: true });
      for (let z = 27; z < 45; z += 1.3) if (z < 36.6 || z > 38.2) kit.add('paint', box(rx - 0.9, 0.031, s * z, rx + 0.9, 0.04, s * (z + 0.35)), '#8f7563', { flat: true });
    }
  }

  // ── Pop-up stair wells (steel stairs over the ramp collision) ─────────────
  for (const s of halves) {
    const z0 = s * 12.5;
    const z1 = s * 3.5;
    kit.addAll('metal', stairs(7.05, Math.min(z0, z1), 9.55, Math.max(z0, z1), 0, D, 'z', s > 0 ? 1 : -1, 0.3), STEEL, { base: 0 });
    // Stringers + tread nosings.
    kit.add('metal', beam(7.1, 0.2, z1, 7.1, D - 0.05, z0, 0.12, 0.3), STEEL_DARK);
    kit.add('metal', beam(9.5, 0.2, z1, 9.5, D - 0.05, z0, 0.12, 0.3), STEEL_DARK);
    // Handrails inside the slot walls.
    kit.addAll('metal', railing(7.14, 0.3, z1, 7.14, D + 0.2, z0, 0.9, 3), STEEL);
    kit.addAll('metal', railing(9.46, 0.3, z1, 9.46, D + 0.2, z0, 0.9, 3), STEEL);
    lamp(kit, 9.58, 2.6, s * 9, -1, 0, ENV.glowGold, 2.4, null);
    kit.add('sign', quad(7.02 + 0.0, 2.2, s * 6.2, 2.4, 0.3, 1, 0, uvOf('stencilExit')), '#ffffff', { flat: true });
    // Parapet coping.
    kit.add('concrete', box(6.55, D + 1, z0, 7.05, D + 1.08, z1), ENV.bone);
    kit.add('concrete', box(9.55, D + 1, z0, 10.05, D + 1.08, z1), ENV.bone);
  }

  // ── East-face climb: crates → cable cabinet → deck ────────────────────────
  for (const s of halves) {
    kit.add('wood', rbox(16.05, 0, s * 14, 17.55, 1.2, s * 12.05, 0.05), '#b39a7f');
    kit.add('wood', box(16.0, 0.55, s * 14.02, 17.6, 0.65, s * 12.03), '#8c7660');
    // Cable switch cabinet (collision x 16..18.6): a sage steel box on a plinth.
    kit.add('concrete', box(16.0, 0, s * 12.02, 18.6, 0.25, s * 7.98), ENV.concreteDark);
    kit.add('paint', rbox(16.02, 0.25, s * 12, 18.58, 2.4, s * 8, 0.08), '#9fa98c');
    for (let y = 0.6; y < 2.2; y += 0.35) kit.add('metal', box(18.58, y, s * 11.4, 18.64, y + 0.12, s * 8.6), STEEL_DARK, { flat: true });
    kit.add('metal', box(18.58, 0.5, s * 10.05 - 0.02, 18.66, 2.2, s * 10.05 + 0.02), STEEL_DARK, { flat: true });
    kit.add('sign', quad(18.67, 2.05, s * 10, 1.8, 0.2, 1, 0, uvOf('hazard')), '#ffffff', { flat: true });
    kit.add('paint', box(16.0, 2.4, s * 12.02, 18.6, 2.46, s * 7.98), '#7d8566', { flat: true });
    // Cable bundle climbing from the cabinet into the deck.
    kit.add('metal', cylAB(16.6, 2.46, s * 9, 16.1, 3.4, s * 9, 0.14, 0.14, 8), '#34302c');
  }

  // ── Apron chicanes (break the forecourt-to-forecourt lines along the pad) ──
  // West: nitrogen bottle racks against the gantry stairs (x −21.6..−18.6, z ±[10, 12], 2.6 m).
  for (const s of halves) {
    const z0 = s * 10;
    const z1 = s * 12;
    const zl = Math.min(z0, z1);
    const zh = Math.max(z0, z1);
    kit.add('concrete', box(-21.62, 0, zl - 0.02, -18.6, 0.2, zh + 0.02), ENV.concreteDark);
    // Frame: corner posts, top canopy, mid chain rails; a solid back sheet on the stair side.
    for (const x of [-21.55, -18.75]) for (const z of [zl + 0.07, zh - 0.07]) kit.add('metal', box(x - 0.06, 0.2, z - 0.06, x + 0.06, 2.5, z + 0.06), STEEL_DARK);
    kit.add('metal', rbox(-21.65, 2.44, zl - 0.06, -18.6, 2.6, zh + 0.06, 0.03), '#8a8680');
    kit.add('metal', box(-18.9, 0.2, zl + 0.02, -18.62, 2.44, zh - 0.02), '#7d8566');
    for (const y of [0.9, 1.7]) kit.add('metal', box(-21.6, y, s > 0 ? zl + 0.02 : zh - 0.06, -18.65, y + 0.05, s > 0 ? zl + 0.06 : zh - 0.02), STEEL_DARK, { flat: true });
    const bottles = [ENV.bone, '#9fa98c', ENV.bone, ENV.terracottaFaded, ENV.bone];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 3; j++) {
        const x = -21.3 + i * 0.52 + (j % 2) * 0.12;
        const z = zl + 0.38 + j * 0.62;
        const col = bottles[(i + j * 2) % bottles.length];
        kit.add('paint', cylAB(x, 0.2, z, x, 2.02, z, 0.25, 0.25, kit.seg(10)), col);
        kit.add('paint', sphere(x, 2.02, z, 0.25, kit.seg(10), 5, 0.55), col);
        kit.add('metal', cylAB(x, 2.1, z, x, 2.32, z, 0.06, 0.05, 6), STEEL_DARK, { flat: true });
      }
    }
    kit.add('sign', quad(-21.66, 1.35, (zl + zh) / 2, 1.9, 0.26, -1, 0, uvOf('hazard')), '#ffffff', { flat: true });
  }
  // West, z = 0: fuel-line valve station on the transfer station's face
  // (x −24..−21, z ±1.5, 3.2 m) with risers up to the overhead fuel lines.
  {
    kit.add('concrete', box(-24.02, 0, -1.52, -20.98, 0.45, 1.52), ENV.concreteDark);
    kit.add('paint', rbox(-24.0, 0.45, -1.5, -21.0, 3.2, 1.5, 0.12, 2), '#c9c1b0');
    kit.add('paint', box(-21.02, 2.9, -1.52, -20.96, 3.05, 1.52), ENV.terracottaFaded, { flat: true });
    for (const [dz, r, col] of [
      [-0.6, 0.3, ENV.bone],
      [0.3, 0.24, '#9fa98c'],
      [0.95, 0.17, TOWER_DARK],
    ] as [number, number, string][]) {
      kit.add('metal', cylAB(-22.6, 3.1, dz * 0.9, -22.6, 7.2, dz, r, r, 10), col);
      kit.add('metal', cylAB(-22.6, 3.15, dz * 0.9, -22.6, 3.4, dz * 0.9, r + 0.1, r + 0.1, 10), STEEL_DARK);
    }
    for (const z of [-0.8, 0.7]) {
      const w = new THREE.TorusGeometry(0.42, 0.06, 6, 18);
      w.rotateY(Math.PI / 2);
      w.translate(-20.86, 1.7, z);
      kit.add('metal', w, ENV.terracottaFaded, { flat: true });
      kit.add('metal', cylAB(-20.98, 1.7, z, -20.86, 1.7, z, 0.06, 0.06, 6), STEEL_DARK, { flat: true });
    }
    kit.add('sign', quad(-20.97, 2.6, 0, 2.6, 0.36, 1, 0, uvOf('stencilLox')), '#ffffff', { flat: true });
    lamp(kit, -20.96, 3.35, 0, 1, 0, ENV.glowGold, 2.6, 0);
  }
  // East, z = 0: the deluge water valve house (sound suppression) on the
  // transit shed's face (x 18.4..22, z ±1.5, 3.2 m); its main feeds the trench.
  {
    kit.add('concrete', rbox(18.42, 0, -1.5, 22.0, 3.2, 1.5, 0.1, 2), '#b3ab9c');
    kit.add('concrete', box(18.38, 3.05, -1.56, 22.0, 3.3, 1.56), ENV.bone);
    kit.add('metal', box(18.36, 0.1, -0.7, 18.42, 2.2, 0.7), '#8e9aa0');
    kit.add('sign', quad(18.35, 2.62, 0, 3.0, 0.38, -1, 0, uvOf('stencilDeluge')), '#ffffff', { flat: true });
    // Water main: out of the house, along the apron into the trench mouth.
    kit.add('metal', pipe([[19.2, 0.35, 1.4], [19.2, 0.35, 2.6], [17.2, 0.35, 2.6], [15.6, 0.35, 2.6], [12.5, 0.35, 2.9]], 0.3, 12, 0.7), '#9fb4be');
    kit.add('metal', cylAB(19.2, 0.35, 1.35, 19.2, 0.35, 1.6, 0.4, 0.4, 12), STEEL_DARK);
    const w = new THREE.TorusGeometry(0.5, 0.06, 6, 18);
    w.rotateY(Math.PI / 2);
    w.translate(18.26, 1.45, 0);
    kit.add('metal', w, ENV.terracottaFaded, { flat: true });
    kit.add('glow', box(18.36, 1.95, 0.9, 18.37, 2.2, 1.2), ENV.glowGold, { flat: true, k: 1.6 });
    moss(kit, rnd, 18.2, 0, -1.9, 0.5, Math.round(6 * decor));
  }

  // ── Maintenance tunnels (south/north) ─────────────────────────────────────
  for (const s of halves) {
    const za = s * 17;
    const zb = s * 3.5;
    const zlo = Math.min(za, zb);
    const zhi = Math.max(za, zb);
    // Dark liners (inset) so the tunnels read dark on every quality tier.
    kit.add('concrete', box(-9.29, 0, zlo, -9.25, 2.4, zhi), DARK, { base: 0 });
    kit.add('concrete', box(-6.75, 0, zlo, -6.71, 2.4, zhi), DARK, { base: 0 });
    kit.add('concrete', box(-9.3, 2.34, zlo, -6.7, 2.39, zhi), '#3f3934', { flat: true });
    kit.add('metal', box(-8.45, 0, zlo, -7.55, 0.025, zhi), '#6d6a64', { flat: true });
    // Pipes along the ceiling corners + a cable tray.
    for (const [px, py, pr, col] of [
      [-9.05, 2.12, 0.13, '#8a7d6f'],
      [-8.8, 2.2, 0.08, TOWER_DARK],
      [-8.62, 2.22, 0.07, '#9fa98c'],
    ] as [number, number, number, string][]) {
      kit.add('metal', cylAB(px, py, za, px, py, zb, pr, pr, 8), col);
    }
    kit.add('metal', box(-7.2, 2.08, zlo, -6.8, 2.14, zhi), STEEL_DARK, { flat: true });
    for (let z = 5; z < 17; z += 2.2) kit.add('metal', box(-9.25, 1.98, s * z - 0.04, -6.75, 2.04, s * z + 0.04), STEEL_DARK, { flat: true });
    // Emergency lamps staggered on both walls every ~2.2 m: a warm rhythm down the tunnel.
    for (let z = 5.2; z < 17; z += 4.4) {
      lamp(kit, -6.76, 1.95, s * z, -1, 0, ENV.glowGold, 2.8);
      lamp(kit, -9.24, 1.95, s * (z + 2.2), 1, 0, ENV.glowGold, 2.8);
    }
    // Mouth: steel portal frame, open blast door, stencil.
    kit.add('metal', box(-9.5, 0, za - s * 0.18, -9.3, 2.6, za + s * 0.02), STEEL_DARK);
    kit.add('metal', box(-6.7, 0, za - s * 0.18, -6.5, 2.6, za + s * 0.02), STEEL_DARK);
    kit.add('metal', box(-9.5, 2.4, za - s * 0.18, -6.5, 2.65, za + s * 0.02), STEEL_DARK);
    kit.add('gloss', rbox(-12.4, 0.02, za + s * 0.02, -9.6, 2.5, za + s * 0.28, 0.05), '#b8b6ae');
    kit.add('sign', quad(-11, 1.3, za + s * 0.3, 2.6, 0.32, 0, s, uvOf('hazard')), '#ffffff', { flat: true });
    kit.add('sign', quad(-8, 3.0, za + s * 0.03, 4.6, 0.58, 0, s, uvOf('stencilTrench')), '#ffffff', { flat: true });
    moss(kit, rnd, -9.1, 0, s * 14.5, 0.5, Math.round(10 * decor));
    moss(kit, rnd, -6.9, 0, s * 8.5, 0.45, Math.round(8 * decor));
  }

  // ── Flame trench ──────────────────────────────────────────────────────────
  // Damp floors (trench + both tunnels) with the emergency lamps, the grate's
  // shaft and the sunset spill at the mouth baked in; drain channel down the middle.
  const underLights: BakedLight[] = [
    { x: -3.2, y: 0, z: 0, r: 3.2, k: 1.1 },
    { x: 12.5, y: 0, z: 0, r: 6, k: 0.9 },
    { x: 16, y: 0, z: 0, r: 4, k: 0.8 },
  ];
  for (const x of [-10.5, 6, 13]) underLights.push({ x, y: 0, z: 2.6, r: 2.6, k: 0.8 }, { x: x + 1.2, y: 0, z: -2.6, r: 2.6, k: 0.8 });
  for (const s of halves) {
    for (let z = 5.2; z < 17; z += 4.4) underLights.push({ x: -7.3, y: 0, z: s * z, r: 2.4, k: 0.85 }, { x: -8.7, y: 0, z: s * (z + 2.2), r: 2.4, k: 0.85 });
    underLights.push({ x: -8, y: 0, z: s * 17.5, r: 3, k: 0.7 });
  }
  litFloor(kit, -12, -3.5, 16, 3.5, 0.008, '#5a524a', 0.62, underLights, 0.9);
  for (const s of halves) litFloor(kit, -9.3, Math.min(s * 3.5, s * 17), -6.7, Math.max(s * 3.5, s * 17), 0.008, '#5a524a', 0.62, underLights, 0.9);
  kit.add('metal', box(-12, 0.008, -0.2, 16, 0.02, 0.2), '#2d2a27', { flat: true });
  // Ceiling with transverse ribs, scorched wall liners (skipping openings).
  {
    // Ceiling liner, open over the broken grate.
    const { x0, x1, hz } = GANTRY_GRATE;
    kit.add('concrete', box(-12, 2.95, -3.5, x0, 2.99, 3.5), '#37312d', { flat: true });
    kit.add('concrete', box(x1, 2.95, -3.5, 16, 2.99, 3.5), '#37312d', { flat: true });
    kit.add('concrete', box(x0, 2.95, -3.5, x1, 2.99, -hz), '#37312d', { flat: true });
    kit.add('concrete', box(x0, 2.95, hz, x1, 2.99, 3.5), '#37312d', { flat: true });
  }
  for (let x = -11; x < 16; x += 2.2) {
    if (x > -4.6 && x < -1.8) continue; // broken grate
    kit.add('concrete', box(x - 0.15, 2.6, -3.5, x + 0.15, 2.96, 3.5), '#4a423c', { flat: true });
  }
  const wallSeg = (x0: number, x1: number, z: number): void => {
    kit.add('concrete', box(x0, 0, z - 0.02, x1, 2.95, z + 0.02), '#4a433d', {
      shade: (_x, y) => 0.55 + 0.45 * Math.min(1, y / 2.6) * (0.75 + 0.25 * Math.sin(_x * 1.7)),
    });
  };
  for (const s of halves) {
    const z = s * 3.49;
    wallSeg(-12, -9.3, z);
    wallSeg(-6.7, 7, z);
    wallSeg(9.6, 16, z);
  }
  kit.add('concrete', box(-11.99, 0, -3.5, -11.95, 2.95, 3.5), '#433c36');
  // Service pipes running along both trench walls at knee and head height.
  for (const s of halves) {
    const z = s * 3.3;
    kit.add('metal', cylAB(-11.9, 2.35, z, -6.9, 2.35, z, 0.12, 0.12, 8), '#8a7d6f');
    kit.add('metal', cylAB(-6.5, 2.35, z, 6.8, 2.35, z, 0.12, 0.12, 8), '#8a7d6f');
    kit.add('metal', cylAB(9.8, 2.35, z, 15.9, 2.35, z, 0.12, 0.12, 8), '#8a7d6f');
    kit.add('metal', cylAB(-6.5, 0.5, s * 3.36, 0.8, 0.5, s * 3.36, 0.08, 0.08, 6), '#6f7a80');
    for (let x = -11; x < 16; x += 3.1) if (x < -9.3 || (x > -6.7 && x < 7) || x > 9.6) kit.add('metal', box(x - 0.05, 2.2, z - s * 0.18, x + 0.05, 2.5, z + s * 0.1), STEEL_DARK, { flat: true });
  }
  // Hazard striping on the deflector's flanks.
  for (const s of halves) kit.add('sign', quad(3, 2.55, s * 2.0 + s * 0.02, 3.8, 0.4, 0, s, uvOf('hazard')), '#ffffff', { flat: true, k: 0.8 });
  // Soot plumes on the walls around the deflector.
  for (const s of halves) {
    for (let i = 0; i < 5; i++) {
      const x = 0 + i * 2.6;
      kit.add('paint', quad(x, 1.7, s * 3.46, 2.6, 2.2, 0, -s), SOOT, { flat: true });
    }
  }
  // Flame deflector: scorched steel block with ribs and a curved cap.
  kit.add('metal', rbox(1.02, 0, -1.98, 4.98, 2.94, 1.98, 0.12, 2), '#6a625b', { base: 0 });
  for (let z = -1.6; z <= 1.6; z += 0.8) {
    kit.add('metal', box(0.94, 0.2, z - 0.06, 1.02, 2.8, z + 0.06), '#4b4540', { flat: true });
    kit.add('metal', box(4.98, 0.2, z - 0.06, 5.06, 2.8, z + 0.06), '#4b4540', { flat: true });
  }
  kit.add('paint', quad(0.95, 1.6, 0, 3.7, 2.4, -1, 0), SOOT, { flat: true });
  kit.add('paint', quad(5.05, 1.6, 0, 3.7, 2.4, 1, 0), SOOT, { flat: true });
  // Valve / pump housing (breaks the tunnel line): plinth, pipes, wheels, panel.
  // (Collision x −10.4..−6, z ±1.1, to the 3 m ceiling: the casing fills it.)
  kit.add('concrete', rbox(-10.38, 0, -1.08, -6.02, 1.1, 1.08, 0.05), '#8e877b');
  kit.add('metal', rbox(-10.3, 1.1, -1.02, -6.1, 2.6, 1.02, 0.18, 2), '#9fa98c');
  for (let x = -9.8; x < -6.3; x += 0.7) kit.add('metal', box(x - 0.05, 1.1, -1.08, x + 0.05, 2.6, 1.08), '#7d8566', { flat: true });
  kit.add('metal', box(-10.36, 2.6, -1.06, -6.04, 2.96, 1.06), '#6f7a80');
  kit.add('metal', cylAB(-8.2, 2.6, 0, -8.2, 2.96, 0, 0.34, 0.34, 10), '#8a7d6f');
  kit.add('metal', cylAB(-9.4, 2.6, 0.5, -9.4, 2.96, 0.5, 0.2, 0.2, 8), TOWER_DARK);
  for (const [wx, wz] of [
    [-7.2, 1.1],
    [-9.2, -1.1],
  ] as [number, number][]) {
    const t = new THREE.TorusGeometry(0.34, 0.05, 6, 16);
    t.translate(wx, 1.85, wz * 1.08);
    kit.add('metal', t, ENV.terracottaFaded, { flat: true });
    kit.add('metal', cylAB(wx, 1.85, wz * 1.08, wx, 1.85, wz * 0.9, 0.05, 0.05, 6), STEEL_DARK, { flat: true });
  }
  kit.add('paint', box(-8.9, 0.5, 1.08, -7.5, 1.05, 1.12), '#2b2825', { flat: true });
  kit.add('glow', box(-8.7, 0.72, 1.12, -8.4, 0.9, 1.13), ENV.glowGold, { flat: true, k: 2.4 });
  kit.add('glow', box(-8.1, 0.72, 1.12, -7.8, 0.9, 1.13), ENV.glowChartreuse, { flat: true, k: 1.6 });
  // Broken grate: rim frame on the deck, torn bars hanging into the trench
  // (all hanging along the hole's west/east lips so the drop stays clean).
  {
    const { x0, x1, hz } = GANTRY_GRATE;
    const cx = (x0 + x1) / 2;
    kit.add('metal', box(x0 - 0.25, D, -hz - 0.25, x1 + 0.25, D + 0.03, -hz), STEEL_DARK, { flat: true });
    kit.add('metal', box(x0 - 0.25, D, hz, x1 + 0.25, D + 0.03, hz + 0.25), STEEL_DARK, { flat: true });
    kit.add('metal', box(x0 - 0.25, D, -hz, x0, D + 0.03, hz), STEEL_DARK, { flat: true });
    kit.add('metal', box(x1, D, -hz, x1 + 0.25, D + 0.03, hz), STEEL_DARK, { flat: true });
    kit.add('sign', floorQuad(cx, D + 0.011, -hz - 0.55, x1 - x0 + 0.6, 0.5, uvOf('hazard')), '#ffffff', { flat: true });
    kit.add('sign', floorQuad(cx, D + 0.011, hz + 0.55, x1 - x0 + 0.6, 0.5, uvOf('hazard'), Math.PI), '#ffffff', { flat: true });
    for (let i = 0; i < 6; i++) {
      const z = -hz + 0.25 + i * ((2 * hz - 0.5) / 5);
      if (i === 2 || i === 3) continue;
      const bent = i === 1 || i === 4;
      kit.add('metal', beam(x0, D - 0.04, z, bent ? x0 + 0.5 : x0 + 0.9, bent ? 2.2 : D - 0.35, z + (bent ? 0.15 : 0), 0.06), STEEL_DARK, { flat: true });
    }
    kit.add('metal', beam(x1, D - 0.04, hz - 0.3, x1 - 0.45, 2.4, hz - 0.45, 0.06), STEEL_DARK, { flat: true });
    kit.add('metal', beam(x1, D - 0.04, -hz + 0.4, x1 - 0.7, 2.9, -hz + 0.5, 0.06), STEEL_DARK, { flat: true });
  }
  // Under the hole: a rain puddle with moss (the Sunspear pedestal is drawn by the builder).
  const puddle = new THREE.CircleGeometry(1.5, 20);
  puddle.rotateX(-Math.PI / 2);
  puddle.translate(-3.0, 0.015, 0.2);
  kit.add('gloss', puddle, '#4e5a5c', { flat: true });
  moss(kit, rnd, -4.6, 0, -2.6, 0.7, Math.round(14 * decor));
  moss(kit, rnd, -1.6, 0, 2.7, 0.6, Math.round(12 * decor));
  moss(kit, rnd, -3.2, 0.2, 3.46, 0.8, Math.round(10 * decor), 0, -1);
  moss(kit, rnd, 12, 0, -2.8, 0.5, Math.round(6 * decor));
  // Emergency lamps along the trench.
  for (const x of [-10.5, 6, 13]) {
    lamp(kit, x, 2.2, 3.44, 0, -1, ENV.glowGold, 3);
    lamp(kit, x + 1.2, 2.2, -3.44, 0, 1, ENV.glowGold, 3);
  }
  // Mouth: scorched lip, soot fan on the face above, stencil.
  kit.add('metal', box(15.7, 2.8, -3.6, 16.25, 3.1, 3.6), '#5d544c');
  kit.add('metal', box(15.7, 0, -3.8, 16.25, 3.0, -3.5), '#5d544c');
  kit.add('metal', box(15.7, 0, 3.5, 16.25, 3.0, 3.8), '#5d544c');
  kit.add('paint', quad(16.27, 3.3, 0, 8.5, 0.5, 1, 0), SOOT, { flat: true });
  kit.add('sign', quad(16.16, 2.0, -6.2, 4.4, 0.55, 1, 0, uvOf('stencilTrench')), '#ffffff', { flat: true });
  kit.add('sign', quad(16.16, 2.0, 6.2, 4.4, 0.55, 1, 0, uvOf('stencilPad')), '#ffffff', { flat: true });

  // ── Launch tower ──────────────────────────────────────────────────────────
  const TX0 = -13;
  const TX1 = -6;
  const TCX = (TX0 + TX1) / 2;
  const top = 64;
  // Legs (heavy box columns) and base plates.
  for (const lx of [TX0 + 0.5, TX1 - 0.5]) {
    for (const lz of [-3, 3]) {
      kit.add('metal', box(lx - 0.46, D, lz - 0.46, lx + 0.46, top, lz + 0.46), TOWER, { base: D });
      kit.add('metal', box(lx - 0.8, D, lz - 0.8, lx + 0.8, D + 0.25, lz + 0.8), STEEL_DARK);
    }
  }
  // Lattice bracing above head height on L1.
  kit.addAll('metal', lattice(TCX, 0, 3, 11, top, 5.3, 0.2, 0.16, !kit.low, false), TOWER);
  // Service levels (grated floors + small cantilevers toward the rocket).
  for (let y = 16.3; y < top - 2; y += 10.6) {
    kit.add('metal', box(TX0 - 0.6, y - 0.18, -3.8, TX1 + 0.6, y, 3.8), ENV.boneShade);
    kit.addAll('metal', railing(TX1 + 0.6, y, -3.8, TX1 + 0.6, y, 3.8, 1.0, 1.9), ENV.bone);
  }
  // Elevator core cage + a stuck elevator car at L1.
  kit.addAll('metal', lattice(-9.5, 0, 0.92, D, top, kit.low ? 6.4 : 3.2, 0.14, 0.07, false), '#8b7466');
  kit.add('paint', rbox(-10.4, L1 + 0.02, -0.9, -8.6, L1 + 2.3, 0.9, 0.06), ENV.bone);
  kit.add('glow', box(-8.58, L1 + 1.5, -0.5, -8.56, L1 + 2.0, 0.5), ENV.glowGold, { flat: true, k: 1.6 });
  // Hammerhead crane, lightning mast.
  kit.add('paint', rbox(TX0 - 9, top + 0.4, -0.9, TX1 + 11, top + 2.0, 0.9, 0.12), ENV.bone);
  kit.add('paint', rbox(TX0 - 7.5, top - 1.2, -1.6, TX0 - 3.5, top + 0.6, 1.6, 0.12), ENV.boneShade);
  kit.add('paint', rbox(TX0 - 0.6, top, -3.6, TX1 + 0.6, top + 0.5, 3.6, 0.1), ENV.boneShade);
  kit.add('paint', box(TX1 + 9.6, top - 7, -0.05, TX1 + 9.7, top + 0.4, 0.05), STEEL_DARK);
  kit.add('metal', rbox(TX1 + 9.2, top - 7.6, -0.4, TX1 + 10.1, top - 6.8, 0.4, 0.1), '#8a7d6f');
  kit.add('metal', cylAB(TCX, top + 2, 0, TCX, top + 12, 0, 0.2, 0.08, 8), STEEL);
  kit.add('sign', quad(TX0 - 0.62, top - 3, 0, 5.6, 0.7, -1, 0, uvOf('stencilPad')), '#ffffff', { flat: true });
  // Floodlight banks aimed at the rocket.
  for (const y of [14, 36, 52]) {
    for (const z of [-2.4, 2.4]) {
      kit.add('metal', box(TX1 - 0.1, y, z - 0.6, TX1 + 0.3, y + 0.8, z + 0.6), STEEL_DARK, { flat: true });
      kit.add('glow', box(TX1 + 0.3, y + 0.1, z - 0.5, TX1 + 0.32, y + 0.7, z + 0.5), '#fff3dc', { flat: true, k: 1.8 });
    }
  }

  // ── L1 service platform + the gantry stairs ──────────────────────────────
  kit.add('metal', box(-18.6, L1 - 0.4, -5, -5, L1, 5), '#77736c');
  for (let x = -18; x < -5; x += 1.5) kit.add('metal', box(x, L1 - 0.72, -5, x + 0.18, L1 - 0.4, 5), STEEL_DARK, { flat: true });
  kit.add('metal', box(-18.6, L1 - 0.02, -5, -5, L1 + 0.005, 5), '#8a8680', { flat: true });
  kit.addAll('metal', railing(-5.1, L1, -5, -5.1, L1, 5, 1.0, 1.7), ENV.bone);
  kit.addAll('metal', railing(-18.7, L1, -5, -18.7, L1, 5, 1.0, 1.7), ENV.bone);
  for (const s of halves) {
    kit.addAll('metal', railing(-16, L1, s * 5.1, -5, L1, s * 5.1, 1.0, 1.8), ENV.bone);
    // Monumental stair: concrete wedge body + steel treads + outer handrail.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(21, 0);
    shape.lineTo(21, L1 - 0.02);
    shape.closePath();
    const wedge = new THREE.ExtrudeGeometry(shape, { depth: 2.6, bevelEnabled: false });
    // (shape x, shape y, extrude) → (−extrude, y, shape x): a proper rotation.
    wedge.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)));
    if (s < 0) wedge.translate(-16, 0, -26);
    else {
      wedge.rotateY(Math.PI);
      wedge.translate(-18.6, 0, 26);
    }
    kit.add('concrete', wedge, ENV.boneShade);
    const zA = s * 26;
    const zB = s * 5;
    kit.addAll('metal', stairs(-18.55, Math.min(zA, zB), -16.05, Math.max(zA, zB), 0, L1, 'z', s < 0 ? 1 : -1, 0.3), '#8a8680');
    // Outer railing only where it has collision (|z| ≤ 21, stair ≥ 2 m); the
    // low flight is flanked by a concrete kerb. The inner side is left open on
    // purpose: you can drop from the stairs onto the deck.
    const zR = s * 21;
    const yR = (L1 * 5) / 21;
    kit.addAll('metal', railing(-18.7, yR, zR, -18.7, L1, zB, 1.0, 2.1), ENV.bone);
    kit.add('concrete', box(-18.85, 0, zR - 0.2, -18.55, yR + 1.1, zR + 0.2), ENV.boneShade);
    kit.add('concrete', beam(-18.7, 0.12, zA, -18.7, yR + 0.12, zR, 0.28, 0.24), ENV.boneShade);
    // The pocket under L1 is walled off: a riveted service wall with a sealed door.
  }
  {
    kit.add('metal', box(-18.8, 0, -5, -18.62, L1 - 0.4, 5), '#8e877b', { base: 0 });
    for (let z = -4.5; z <= 4.5; z += 1.5) kit.add('metal', box(-18.86, 0.1, z - 0.05, -18.8, L1 - 0.5, z + 0.05), STEEL_DARK, { flat: true });
    for (const y of [2.6, 5.4]) kit.add('metal', box(-18.86, y, -5, -18.8, y + 0.1, 5), STEEL_DARK, { flat: true });
    // Inner face, seen from the deck-level alcove under L1 (floor at the deck).
    for (let z = -3.75; z <= 3.75; z += 2.5) kit.add('metal', box(-18.62, D, z - 0.05, -18.56, L1 - 0.5, z + 0.05), STEEL_DARK, { flat: true });
    kit.add('metal', box(-18.62, 5.4, -5, -18.56, 5.5, 5), STEEL_DARK, { flat: true });
    kit.add('gloss', rbox(-18.9, 0.02, -1.2, -18.8, 2.4, 1.2, 0.04), '#a8a79f');
    kit.add('sign', quad(-18.92, 2.8, 0, 3.2, 0.4, -1, 0, uvOf('stencilService')), '#ffffff', { flat: true });
    lamp(kit, -18.9, 3.4, 0, -1, 0, ENV.glowGold, 2.8, 0);
  }
  // Fuel lines from the west (over the apron) under L1 into the tower.
  for (const [dz, r, col] of [
    [-0.6, 0.32, ENV.bone],
    [0.3, 0.26, '#9fa98c'],
    [0.95, 0.18, TOWER_DARK],
  ] as [number, number, string][]) {
    kit.add('metal', cylAB(-34, 7.2, dz, -10.6, 7.2, dz, r, r, 10), col);
  }
  kit.add('metal', box(-24.2, 6.9, -1.4, -23.8, 7.7, 1.4), STEEL_DARK);
  kit.add('metal', box(-19.0, 6.7, -1.4, -18.6, 7.7, 1.4), STEEL_DARK);

  // ── The rocket's umbilical swing arms (retract at launch) ────────────────
  const arms = new THREE.Group();
  arms.name = 'gantry.arms';
  arms.position.set(TX1, 0, 0);
  const armKit = new DecorKit(kit.ctx);
  const rocketFace = RX - 2.75 - TX1;
  for (const [y, w, white] of [
    [20, 1.2, false],
    [31, 1.2, false],
    [43, 1.8, true],
  ] as [number, number, boolean][]) {
    // Box truss: two chords + diagonals, a walkway deck, a hose, and the white room at the crew arm.
    for (const dz of [-w / 2, w / 2]) {
      armKit.add('metal', box(0, y + 0.5, dz - 0.07, rocketFace, y + 0.64, dz + 0.07), ENV.bone);
      armKit.add('metal', box(0, y - 0.64, dz - 0.07, rocketFace, y - 0.5, dz + 0.07), ENV.bone);
      for (let x = 0; x < rocketFace - 0.5; x += 1.25) armKit.add('metal', beam(x, y - 0.57, dz, x + 1.25, y + 0.57, dz, 0.07), TOWER_DARK);
    }
    armKit.add('metal', box(0, y - 0.66, -w / 2, rocketFace, y - 0.58, w / 2), '#8a8680');
    if (white) armKit.add('paint', rbox(rocketFace - 1.7, y - 1.1, -1.35, rocketFace + 0.05, y + 1.5, 1.35, 0.2), '#f4efe6');
    armKit.add('metal', cylAB(0.4, y - 0.85, 0.35, rocketFace, y - 0.85, 0.35, 0.12, 0.12, 6), '#8a7d6f');
  }
  armKit.build(arms);
  root.add(arms);
  (arms.userData as { kit?: DecorKit }).kit = armKit;

  // Light shafts: through the broken grate onto the Sunspear, and the sunset
  // pouring horizontally into the trench mouth.
  const shaftAnchors: PadAnim['shaftAnchors'] = [
    { pos: new THREE.Vector3(-3.2, D + 3.5, 0.3), dir: new THREE.Vector3(0.12, -1, -0.05).normalize(), length: 7.5, radius: 1.3, color: ENV.glowGold, intensity: 1.2 },
    // Sunset slipping past the deluge valve house into the trench mouth.
    { pos: new THREE.Vector3(21.5, 3.3, -3.1), dir: new THREE.Vector3(-0.96, -0.1, 0.24).normalize(), length: 19, radius: 2.2, color: '#ffd2a0', intensity: 0.9 },
  ];
  // Warm spill where the sunset hits the trench floor.
  kit.add('pool', floorQuad(11, 0.03, 0, 12, 7), '#ffc995', { flat: true, k: 0.5 });
  kit.add('pool', quad(-11.9, 1.4, 0.4, 5, 3.2, 1, 0), '#ffc995', { flat: true, k: 0.18 });
  // Glow halo under the grate (reads even without shafts on Low).
  kit.add('pool', floorQuad(-3.2, 0.035, 0, 3.4, 3.4), ENV.glowGold, { flat: true, k: 0.5 });

  // Cable/propellant lines lying along the deck edge from the tower to the mount.
  for (const s of halves) {
    kit.add('metal', box(-5.6, D, s * 4.35, RX - 3.7, D + 0.16, s * 4.65), STEEL_DARK);
    kit.add('metal', cylAB(-5.6, D + 0.3, s * 4.5, RX - 3.7, D + 0.3, s * 4.5, 0.14, 0.14, 8), ENV.bone);
  }
  return { arms, shaftAnchors };
}
