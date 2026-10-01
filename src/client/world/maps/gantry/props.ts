// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry prop library: the small industrial storytelling kit
// (barrels, carts, a forklift, a crew pickup, scaffolding, pipe racks with
// valves and gauges, hoses, cable trays, lockers, the crew's mugs and lunch
// boxes, notice boards, safety plates), coastal bits (rocks, gulls, buoys,
// a wrecked dinghy) and the Bloom's glowing fungi. Every prop is authored in
// local space (origin on the ground, +Z forward) and appended through a
// trs() matrix to the shared batches — no draw calls of their own.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV } from '../../../engine/palette';
import { beam, box, boxC, contact, cyl, cylAB, DecorKit, floorQuad, GREENS, lathe, pipe, quad, rbox, sphere, trs, type Kind } from './kit';
import { uvD, type DecalName } from './decals';

const STEEL = ENV.metalLight;
const STEEL_DARK = ENV.metalDark;
const RUST = ENV.rust;

// ── Decals ──────────────────────────────────────────────────────────────────

/** Flat decal on a floor at height y (w × d meters, yaw rot). */
export function floorDecal(kit: DecorKit, name: DecalName, x: number, y: number, z: number, w: number, d: number, rot = 0, color: string = '#ffffff', k = 1): void {
  kit.add('decal', floorQuad(x, y + 0.006, z, w, d, uvD(name), rot), color, { flat: true, k });
}

/** Decal on a wall facing (nx, nz). */
export function wallDecal(kit: DecorKit, name: DecalName, x: number, y: number, z: number, w: number, h: number, nx: number, nz: number, color: string = '#ffffff', k = 1): void {
  kit.add('decal', quad(x + nx * 0.012, y, z + nz * 0.012, w, h, nx, nz, uvD(name)), color, { flat: true, k });
}

/** Enamel safety plate (or notice board) on a wall: a thin steel backing + the atlas face. */
export function plate(kit: DecorKit, name: DecalName, x: number, y: number, z: number, w: number, h: number, nx: number, nz: number, backing = true): void {
  if (backing) kit.add('metal', boxC(x - nx * 0.01, y, z - nz * 0.01, nz !== 0 ? w + 0.04 : 0.03, h + 0.04, nx !== 0 ? w + 0.04 : 0.03), STEEL_DARK, { flat: true });
  kit.add('sign2', quad(x + nx * 0.012, y, z + nz * 0.012, w, h, nx, nz, uvD(name, 2)), '#ffffff', { flat: true });
}

/** Round pressure gauge on a short stem, facing (nx, nz). */
export function gauge(kit: DecorKit, x: number, y: number, z: number, nx: number, nz: number, r = 0.11): void {
  kit.add('metal', cylAB(x - nx * 0.08, y, z - nz * 0.08, x, y, z, r * 1.08, r * 1.08, 12), STEEL_DARK, { flat: true });
  kit.add('sign2', quad(x + nx * 0.004, y, z + nz * 0.004, r * 2, r * 2, nx, nz, uvD('gauge', 2)), '#ffffff', { flat: true });
}

/** Valve handwheel facing (nx, nz) on a stem from the pipe at (x, y, z). */
export function handwheel(kit: DecorKit, x: number, y: number, z: number, nx: number, nz: number, r = 0.22, col: string = ENV.terracottaFaded): void {
  const w = new THREE.TorusGeometry(r, r * 0.16, kit.low ? 3 : 5, kit.low ? 8 : 14);
  if (nx === 0 && nz === 0) {
    // Horizontal wheel on top of a valve bonnet.
    w.rotateX(Math.PI / 2);
    w.translate(x, y, z);
    kit.add('metal', w, col, { flat: true });
    kit.add('metal', beam(x - r, y, z, x + r, y, z, 0.03), col, { flat: true });
    return;
  }
  w.rotateY(Math.atan2(nx, nz));
  w.translate(x + nx * 0.25, y, z + nz * 0.25);
  kit.add('metal', w, col, { flat: true });
  kit.add('metal', cylAB(x, y, z, x + nx * 0.25, y, z + nz * 0.25, 0.035, 0.035, 6), STEEL_DARK, { flat: true });
  kit.add('metal', beam(x + nx * 0.25 - nz * r, y, z + nz * 0.25 + nx * r, x + nx * 0.25 + nz * r, y, z + nz * 0.25 - nx * r, 0.03), col, { flat: true });
}

/**
 * Wall-mounted utility cluster (facing (nx, nz)): an electrical cabinet with a
 * conduit up to the roof line, a fire-hose reel box, a small plate.
 */
export function wallCabinet(kit: DecorKit, x: number, z: number, nx: number, nz: number, roofY: number, col = '#9fa98c'): void {
  kit.add('paint', rbox(x - (nx !== 0 ? 0 : 0.31) + Math.min(0, nx) * 0.24, 0.9, z - (nz !== 0 ? 0 : 0.31) + Math.min(0, nz) * 0.24, x + (nx !== 0 ? 0 : 0.31) + Math.max(0, nx) * 0.24, 1.85, z + (nz !== 0 ? 0 : 0.31) + Math.max(0, nz) * 0.24, 0.03), col, {});
  kit.add('metal', boxC(x + nx * 0.245, 1.38, z + nz * 0.245, nx !== 0 ? 0.01 : 0.5, 0.012, nx !== 0 ? 0.5 : 0.01), STEEL_DARK, { flat: true });
  kit.add('metal', boxC(x + nx * 0.25 + nz * 0.22, 1.25, z + nz * 0.25 + nx * 0.22, 0.03, 0.12, 0.03), STEEL, { flat: true });
  // Conduit to the roof and a drop into the ground.
  kit.add('metal', cylAB(x + nx * 0.06 - nz * 0.18, 1.85, z + nz * 0.06 - nx * 0.18, x + nx * 0.06 - nz * 0.18, roofY, z + nz * 0.06 - nx * 0.18, 0.03, 0.03, 6), '#8a8680', { flat: true });
  kit.add('metal', cylAB(x + nx * 0.06 + nz * 0.15, 0, z + nz * 0.06 + nx * 0.15, x + nx * 0.06 + nz * 0.15, 0.9, z + nz * 0.06 + nx * 0.15, 0.035, 0.035, 6), '#8a8680', { flat: true });
  // Hose reel box beside it.
  const hx = x + nz * 0.75;
  const hz = z + nx * 0.75;
  kit.add('paint', rbox(hx - (nx !== 0 ? 0 : 0.25) + Math.min(0, nx) * 0.2, 0.7, hz - (nz !== 0 ? 0 : 0.25) + Math.min(0, nz) * 0.2, hx + (nx !== 0 ? 0 : 0.25) + Math.max(0, nx) * 0.2, 1.3, hz + (nz !== 0 ? 0 : 0.25) + Math.max(0, nz) * 0.2, 0.03), ENV.terracottaFaded, {});
  kit.add('paint', boxC(hx + nx * 0.205, 1.0, hz + nz * 0.205, nx !== 0 ? 0.01 : 0.36, 0.36, nx !== 0 ? 0.36 : 0.01), '#e6dcc4', { flat: true });
  contact(kit, x + nx * 0.3, 0, z + nz * 0.3, nx !== 0 ? 0.5 : 0.9, nx !== 0 ? 0.9 : 0.5);
}

// ── Barrels, crates, carts ──────────────────────────────────────────────────

const BARREL_COLS = [ENV.terracottaFaded, ENV.sage, ENV.pastelBlue, ENV.bone, '#8e9aa0', ENV.pastelYellow];

/** 55-gallon drum: body, rolling hoops, lid rim, a faded band. `tipped` lies it on its side along rot. */
export function barrel(kit: DecorKit, x: number, y: number, z: number, col: string, rot = 0, tipped = false, rusty = 0.4): void {
  const m = tipped ? trs(x, y + 0.3, z, rot).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(0, -0.44, 0)) : trs(x, y, z, rot);
  const seg = kit.low ? 10 : 14;
  kit.add('paint', cyl(0, 0, 0, 0.3, 0.88, seg), col, { base: y, shade: tipped ? undefined : (_x, yy) => 0.66 + 0.34 * Math.min(1, (yy - y) / 0.9) }, m);
  for (const hy of kit.low ? [0.44] : [0.29, 0.59]) kit.add('metal', cyl(0, hy, 0, 0.312, 0.035, seg), STEEL_DARK, { flat: true }, m);
  kit.add('metal', cyl(0, 0.86, 0, 0.305, 0.035, seg, 0.28), '#6d6a64', { flat: true }, m);
  if (rusty > 0.2) kit.add('paint', cyl(0, 0.02, 0, 0.306, 0.18 + rusty * 0.2, seg), RUST, { flat: true }, m);
  if (!tipped && !kit.low) kit.add('metal', cyl(0.14, 0.89, 0.05, 0.035, 0.03, 6), '#4c4743', { flat: true }, m);
  if (!tipped) contact(kit, x, y, z, 0.45, 0.45);
}

/** A tidy cluster of drums (one tipped) on a pallet. */
export function barrelGroup(kit: DecorKit, rnd: () => number, x: number, z: number, rot: number, n: number, pallet = true): void {
  const m = trs(x, 0, z, rot);
  const y0 = pallet ? 0.14 : 0;
  if (pallet) pallet3(kit, x, z, rot, 1.25, 1.25);
  const spots: [number, number][] = [
    [-0.31, -0.31],
    [0.31, -0.31],
    [-0.31, 0.31],
    [0.31, 0.31],
  ];
  const v = new THREE.Vector3();
  for (let i = 0; i < Math.min(4, n); i++) {
    v.set(spots[i][0], 0, spots[i][1]).applyMatrix4(m);
    barrel(kit, v.x, y0, v.z, BARREL_COLS[Math.floor(rnd() * BARREL_COLS.length)], rnd() * 6, false, rnd());
  }
  contact(kit, x, 0, z, 0.95, 0.95, rot);
}

/** Timber shipping pallet (local 1.2 × 1.0 by default). */
export function pallet3(kit: DecorKit, x: number, z: number, rot: number, w = 1.2, d = 1.0, y = 0): void {
  const m = trs(x, y, z, rot);
  for (const dz of [-d / 2 + 0.06, 0, d / 2 - 0.06]) kit.add('wood', box(-w / 2, 0, dz - 0.05, w / 2, 0.1, dz + 0.05), '#8c7660', { flat: true }, m);
  for (let i = 0; i < 5; i++) {
    const px = -w / 2 + 0.06 + (i * (w - 0.12)) / 4;
    kit.add('wood', box(px - 0.05, 0.1, -d / 2, px + 0.05, 0.14, d / 2), '#b39a7f', { flat: true }, m);
  }
}

/** Wooden crate with battens (local footprint s × s, height h). */
export function crate(kit: DecorKit, x: number, y: number, z: number, s: number, h: number, rot: number, col = '#b39a7f'): void {
  const m = trs(x, y, z, rot);
  kit.add('wood', rbox(-s / 2, 0, -s / 2, s / 2, h, s / 2, 0.03), col, { base: y }, m);
  for (const yy of [0.12, h - 0.12]) kit.add('wood', box(-s / 2 - 0.015, yy - 0.05, -s / 2 - 0.015, s / 2 + 0.015, yy + 0.05, s / 2 + 0.015), '#8c7660', { flat: true }, m);
  kit.add('wood', beam(-s / 2 - 0.016, 0.12, -s / 2 - 0.016, s / 2 + 0.016, h - 0.12, -s / 2 - 0.016, 0.07), '#8c7660', { flat: true }, m);
}

/** Rolling tool cart (local 1.0 × 0.55, 0.95 tall): drawers, a toolbox, a vice. Back faces −Z. */
export function toolCart(kit: DecorKit, x: number, z: number, rot: number, col = '#9fb4be'): void {
  const m = trs(x, 0, z, rot);
  kit.add('paint', rbox(-0.5, 0.14, -0.27, 0.5, 0.92, 0.27, 0.03), col, { base: 0 }, m);
  for (let i = 0; i < 4; i++) {
    const y = 0.24 + i * 0.17;
    kit.add('metal', box(-0.46, y, 0.27, 0.46, y + 0.13, 0.285), new THREE.Color(col).multiplyScalar(0.86), { flat: true }, m);
    kit.add('metal', box(-0.12, y + 0.05, 0.285, 0.12, y + 0.08, 0.31), STEEL, { flat: true }, m);
  }
  for (const [cx, cz] of [
    [-0.42, -0.2],
    [0.42, -0.2],
    [-0.42, 0.2],
    [0.42, 0.2],
  ]) kit.add('metal', cyl(cx, 0, cz, 0.06, 0.14, 6), '#34302c', { flat: true }, m);
  kit.add('metal', box(-0.5, 0.92, -0.27, 0.5, 0.95, 0.27), STEEL_DARK, { flat: true }, m);
  kit.add('paint', rbox(-0.38, 0.95, -0.15, 0.08, 1.12, 0.12, 0.02), ENV.terracottaFaded, {}, m);
  kit.add('metal', box(0.18, 0.95, -0.05, 0.36, 1.08, 0.08), '#4c4743', {}, m);
  kit.add('metal', beam(0.2, 1.03, 0.14, 0.42, 1.0, 0.2, 0.03), STEEL, { flat: true }, m);
  contact(kit, x, 0, z, 0.7, 0.45, rot);
}

/** Small yard forklift (local: forks toward +Z, ~2.6 × 1.2, mast 2.3 m). */
export function forklift(kit: DecorKit, x: number, z: number, rot: number, col: string, overgrown: boolean, rnd: () => number): void {
  const m = trs(x, 0, z, rot);
  kit.add('paint', rbox(-0.6, 0.25, -1.3, 0.6, 1.05, 0.5, 0.12, kit.low ? 1 : 2), col, { base: 0 }, m);
  kit.add('paint', rbox(-0.62, 0.3, -1.45, 0.62, 1.1, -1.0, 0.15), '#5c574f', { base: 0 }, m); // counterweight
  for (const [wx, wz, r] of [
    [-0.62, 0.15, 0.3],
    [0.62, 0.15, 0.3],
    [-0.58, -0.95, 0.25],
    [0.58, -0.95, 0.25],
  ] as [number, number, number][]) kit.add('metal', cylAB(wx - Math.sign(wx) * 0.1, r, wz, wx + Math.sign(wx) * 0.05, r, wz, r, r, 12), '#2f2c2a', { flat: true }, m);
  // Overhead guard, seat, steering wheel.
  for (const px of [-0.5, 0.5]) for (const pz of [-0.95, 0.35]) kit.add('metal', beam(px, 1.05, pz, px, 2.05, pz * 0.9, 0.06), STEEL_DARK, { flat: true }, m);
  kit.add('metal', box(-0.55, 2.0, -1.0, 0.55, 2.07, 0.4), STEEL_DARK, { flat: true }, m);
  for (let i = 0; i < 4; i++) kit.add('metal', box(-0.5, 2.07, -0.9 + i * 0.36, 0.5, 2.1, -0.86 + i * 0.36), '#4c4743', { flat: true }, m);
  kit.add('fabric', rbox(-0.32, 1.05, -0.75, 0.32, 1.18, -0.25, 0.05), '#4a433d', {}, m);
  kit.add('fabric', rbox(-0.32, 1.15, -0.85, 0.32, 1.6, -0.72, 0.05), '#4a433d', {}, m);
  const sw = new THREE.TorusGeometry(0.16, 0.025, 4, 12);
  sw.rotateX(-1.0);
  sw.translate(0, 1.42, 0.05);
  kit.add('metal', sw, '#2f2c2a', { flat: true }, m);
  // Mast + carriage + forks (lowered, a pallet still on them).
  for (const px of [-0.38, 0.38]) kit.add('metal', box(px - 0.05, 0.1, 0.55, px + 0.05, 2.3, 0.65), '#5c574f', {}, m);
  kit.add('metal', box(-0.45, 0.2, 0.62, 0.45, 0.7, 0.7), '#5c574f', {}, m);
  for (const px of [-0.25, 0.25]) kit.add('metal', box(px - 0.05, 0.05, 0.7, px + 0.05, 0.1, 1.75), STEEL_DARK, { flat: true }, m);
  const pv = new THREE.Vector3(0, 0, 1.25).applyMatrix4(m);
  pallet3(kit, pv.x, pv.z, rot, 1.0, 1.0, 0.1);
  if (overgrown) {
    for (let i = 0; i < 8; i++) kit.add('foliage', sphere((rnd() - 0.5) * 1.1, 1.05 + rnd() * 0.1, -1.2 + rnd() * 1.5, 0.18 + rnd() * 0.2, 6, 3, 0.45), GREENS[Math.floor(rnd() * 3)], { flat: true }, m);
    kit.add('glow', sphere(0.3, 2.12, -0.3, 0.07, 6, 4), ENV.glowChartreuse, { flat: true, k: 2.4 }, m);
  }
  contact(kit, x, 0, z, 1.0, 1.7, rot);
}

/** 1970s crew pickup (local: nose toward +Z, 4.9 × 2.0). Tailgate down, toolbox in the bed. */
export function pickup(kit: DecorKit, x: number, z: number, rot: number, col: string, rnd: () => number, overgrown: boolean): void {
  const m = trs(x, 0, z, rot);
  const body = col;
  kit.add('paint', rbox(-0.95, 0.45, -2.4, 0.95, 1.15, 2.4, 0.12, kit.low ? 1 : 2), body, { base: 0 }, m);
  // Cab and hood.
  kit.add('paint', rbox(-0.9, 1.1, -0.1, 0.9, 1.95, 1.2, 0.14, kit.low ? 1 : 2), body, {}, m);
  kit.add('paint', rbox(-0.9, 1.1, 1.2, 0.9, 1.28, 2.38, 0.08), new THREE.Color(body).multiplyScalar(0.94), {}, m);
  kit.add('glass', box(-0.82, 1.35, 1.19, 0.82, 1.85, 1.22), '#9fb4be', { flat: true }, m);
  kit.add('glass', box(-0.91, 1.35, 0.05, -0.89, 1.85, 1.0), '#9fb4be', { flat: true }, m);
  kit.add('glass', box(0.89, 1.35, 0.05, 0.91, 1.85, 1.0), '#9fb4be', { flat: true }, m);
  kit.add('glass', box(-0.8, 1.38, -0.12, 0.8, 1.82, -0.09), '#9fb4be', { flat: true }, m);
  // Bed (open) with a toolbox and coiled hose.
  kit.add('paint', box(-0.92, 1.15, -2.38, -0.84, 1.45, -0.15), body, {}, m);
  kit.add('paint', box(0.84, 1.15, -2.38, 0.92, 1.45, -0.15), body, {}, m);
  kit.add('paint', box(-0.86, 1.15, -2.4, 0.86, 1.18, -0.15), '#6d6a64', { flat: true }, m);
  kit.add('paint', box(-0.86, 0.95, -2.95, 0.86, 1.0, -2.4), body, { flat: true }, m); // tailgate down
  kit.add('paint', rbox(-0.7, 1.18, -0.6, 0.7, 1.5, -0.25, 0.04), ENV.terracottaFaded, {}, m);
  const hose = new THREE.TorusGeometry(0.32, 0.06, 5, 14);
  hose.rotateX(Math.PI / 2);
  hose.translate(0.2, 1.25, -1.6);
  kit.add('fabric', hose, '#4a433d', { flat: true }, m);
  // Chrome-less 70s face: grille slats, round lamps, bumper.
  for (let i = 0; i < 4; i++) kit.add('metal', box(-0.6, 0.62 + i * 0.12, 2.4, 0.6, 0.67 + i * 0.12, 2.43), STEEL_DARK, { flat: true }, m);
  for (const px of [-0.7, 0.7]) kit.add('glow', cylAB(px, 0.85, 2.4, px, 0.85, 2.44, 0.12, 0.12, 10), '#fff1d6', { flat: true, k: 0.7 }, m);
  kit.add('metal', box(-1.0, 0.38, 2.38, 1.0, 0.52, 2.52), '#8a8680', {}, m);
  kit.add('metal', box(-1.0, 0.38, -2.52, 1.0, 0.52, -2.38), '#8a8680', {}, m);
  // Wheels (one flat).
  for (const [wx, wz] of [
    [-0.92, 1.55],
    [0.92, 1.55],
    [-0.92, -1.55],
    [0.92, -1.55],
  ] as [number, number][]) {
    const flat = wx > 0 && wz < 0;
    kit.add('metal', cylAB(wx - Math.sign(wx) * 0.12, flat ? 0.3 : 0.38, wz, wx + Math.sign(wx) * 0.12, flat ? 0.3 : 0.38, wz, 0.38, 0.38, 14), '#2f2c2a', { flat: true }, m);
    kit.add('metal', cylAB(wx + Math.sign(wx) * 0.12, flat ? 0.3 : 0.38, wz, wx + Math.sign(wx) * 0.13, flat ? 0.3 : 0.38, wz, 0.2, 0.2, 10), '#8a8680', { flat: true }, m);
  }
  // Door roundel (agency) and rust along the sills.
  kit.add('paint', box(-0.955, 0.48, -2.0, -0.95, 0.62, 1.1), RUST, { flat: true }, m);
  kit.add('paint', box(0.95, 0.48, -2.0, 0.955, 0.62, 1.1), RUST, { flat: true }, m);
  if (overgrown) {
    for (let i = 0; i < 10; i++) kit.add('foliage', sphere((rnd() - 0.5) * 1.5, 1.2 + rnd() * 0.15, -2.2 + rnd() * 1.9, 0.2 + rnd() * 0.25, 6, 3, 0.5), GREENS[Math.floor(rnd() * 3)], { flat: true }, m);
    for (let i = 0; i < 4; i++) kit.add('glow', sphere((rnd() - 0.5) * 1.4, 1.35 + rnd() * 0.2, -2 + rnd() * 1.6, 0.06, 6, 4), rnd() < 0.7 ? ENV.glowChartreuse : ENV.glowGold, { flat: true, k: 2.4 }, m);
  }
  contact(kit, x, 0, z, 1.25, 2.8, rot);
}

// ── Pipes, hoses, trays, scaffolding ───────────────────────────────────────

/** Hose lying on the ground along a polyline (flattened tube). */
export function hose(kit: DecorKit, pts: [number, number][], r = 0.06, col = '#6a5d50', y = 0): void {
  kit.add('fabric', pipe(pts.map(([x, z]) => [x, y + r, z] as [number, number, number]), r, 6, 0.6), col, { flat: true });
}

/** Ground cable tray on short legs from a to b (axis aligned), with a cable bundle. */
export function cableTray(kit: DecorKit, ax: number, az: number, bx: number, bz: number, y = 0): void {
  const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
  const w = 0.16;
  if (alongX) {
    const x0 = Math.min(ax, bx);
    const x1 = Math.max(ax, bx);
    kit.add('metal', box(x0, y + 0.12, az - w, x1, y + 0.14, az + w), '#8a8680', { flat: true });
    kit.add('metal', box(x0, y + 0.14, az - w, x1, y + 0.22, az - w + 0.02), '#8a8680', { flat: true });
    kit.add('metal', box(x0, y + 0.14, az + w - 0.02, x1, y + 0.22, az + w), '#8a8680', { flat: true });
    for (let x = x0 + 0.4; x < x1; x += 1.6) kit.add('metal', box(x - 0.03, y, az - w, x + 0.03, y + 0.12, az + w), STEEL_DARK, { flat: true });
    for (const [dz, col] of [
      [-0.07, '#34302c'],
      [0.0, '#5a4f45'],
      [0.07, '#34302c'],
    ] as [number, string][]) kit.add('fabric', cylAB(x0, y + 0.18, az + dz, x1, y + 0.18, az + dz, 0.035, 0.035, 5), col, { flat: true });
  } else {
    const z0 = Math.min(az, bz);
    const z1 = Math.max(az, bz);
    kit.add('metal', box(ax - w, y + 0.12, z0, ax + w, y + 0.14, z1), '#8a8680', { flat: true });
    kit.add('metal', box(ax - w, y + 0.14, z0, ax - w + 0.02, y + 0.22, z1), '#8a8680', { flat: true });
    kit.add('metal', box(ax + w - 0.02, y + 0.14, z0, ax + w, y + 0.22, z1), '#8a8680', { flat: true });
    for (let z = z0 + 0.4; z < z1; z += 1.6) kit.add('metal', box(ax - w, y, z - 0.03, ax + w, y + 0.12, z + 0.03), STEEL_DARK, { flat: true });
    for (const [dx, col] of [
      [-0.07, '#34302c'],
      [0.0, '#5a4f45'],
      [0.07, '#34302c'],
    ] as [number, string][]) kit.add('fabric', cylAB(ax + dx, y + 0.18, z0, ax + dx, y + 0.18, z1, 0.035, 0.035, 5), col, { flat: true });
  }
}

/**
 * Wall-mounted pipe rack running along a wall plane: `n` pipes on brackets,
 * flanges, valves with handwheels, a gauge or two and an ID plate. The wall
 * faces (nx, nz); the run goes from a0 to a1 along the wall at height y.
 */
export function wallPipes(kit: DecorKit, rnd: () => number, n: 'x+' | 'x-' | 'z+' | 'z-', plane: number, a0: number, a1: number, y: number, allCols: string[] = [ENV.bone, '#9fa98c', ENV.terracottaFaded]): void {
  const cols = kit.low ? allCols.slice(0, 2) : allCols;
  const nx = n === 'x+' ? 1 : n === 'x-' ? -1 : 0;
  const nz = n === 'z+' ? 1 : n === 'z-' ? -1 : 0;
  const P = (a: number, off: number, yy: number): [number, number, number] => (nx !== 0 ? [plane + nx * off, yy, a] : [a, yy, plane + nz * off]);
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  cols.forEach((col, i) => {
    const off = 0.22 + i * 0.05;
    const yy = y + i * 0.3;
    const r = 0.09 - i * 0.015;
    const [ax, ay, az] = P(lo, off, yy);
    const [bx, by, bz] = P(hi, off, yy);
    kit.add('metal', cylAB(ax, ay, az, bx, by, bz, r, r, 8), col);
    for (let a = lo + 1.5; a < hi; a += 3) {
      const [fx, fy, fz] = P(a, off, yy);
      kit.add('metal', cylAB(fx - (nx === 0 ? 0.04 : 0), fy, fz - (nz === 0 ? 0.04 : 0), fx + (nx === 0 ? 0.04 : 0), fy, fz + (nz === 0 ? 0.04 : 0), r + 0.03, r + 0.03, 8), STEEL_DARK, { flat: true });
    }
  });
  // Brackets.
  for (let a = lo + 0.6; a < hi; a += 2.2) {
    const [x0, y0, z0] = P(a, 0, y - 0.15);
    const [x1, , z1] = P(a, 0.42, y - 0.15);
    kit.add('metal', beam(x0, y0, z0, x1, y0, z1, 0.06), STEEL_DARK, { flat: true });
    const [x2, y2, z2] = P(a, 0, y + cols.length * 0.3);
    kit.add('metal', beam(x0, y0, z0, x2, y2, z2, 0.05), STEEL_DARK, { flat: true });
  }
  // Valves + gauges at a few spots along the bottom pipe.
  const span = hi - lo;
  for (let k = 0; k < Math.max(1, Math.round(span / 6)); k++) {
    const a = lo + span * (0.2 + 0.6 * ((k + 0.5) / Math.max(1, Math.round(span / 6))));
    const [vx, vy, vz] = P(a, 0.22, y);
    kit.add('metal', cylAB(vx - (nx === 0 ? 0.12 : 0), vy, vz - (nz === 0 ? 0.12 : 0), vx + (nx === 0 ? 0.12 : 0), vy, vz + (nz === 0 ? 0.12 : 0), 0.13, 0.13, 8), STEEL_DARK);
    handwheel(kit, vx, vy + 0.18, vz, 0, 0, 0.16);
    kit.add('metal', cylAB(vx, vy, vz, vx, vy + 0.2, vz, 0.03, 0.03, 5), STEEL_DARK, { flat: true });
    const [gx, gy, gz] = P(a + 0.6, 0.2, y - 0.45);
    kit.add('metal', cylAB(gx - nx * 0.15, gy + 0.42, gz - nz * 0.15, gx - nx * 0.15, gy + 0.05, gz - nz * 0.15, 0.02, 0.02, 4), STEEL_DARK, { flat: true });
    gauge(kit, gx, gy, gz, nx, nz, 0.12);
    if (rnd() < 0.6) {
      const [px, py, pz] = P(a - 0.7, 0.01, y - 0.55);
      plate(kit, 'plate', px, py, pz, 0.6, 0.3, nx, nz, false);
    }
  }
}

/** Freestanding pipe rack bridge between two points at height y (two posts each end, n pipes). */
export function pipeBridge(kit: DecorKit, ax: number, az: number, bx: number, bz: number, y: number, cols: string[]): void {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const tx = -dz / len;
  const tz = dx / len;
  cols.forEach((col, i) => {
    const o = (i - (cols.length - 1) / 2) * 0.42;
    const r = 0.16 - (i % 2) * 0.04;
    kit.add('metal', cylAB(ax + tx * o, y + 0.2 + r, az + tz * o, bx + tx * o, y + 0.2 + r, bz + tz * o, r, r, 10), col);
  });
  const half = (cols.length * 0.42) / 2 + 0.15;
  const n = Math.max(2, Math.round(len / 4));
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const cx = ax + dx * f;
    const cz = az + dz * f;
    kit.add('metal', beam(cx - tx * half, y, cz - tz * half, cx + tx * half, y, cz + tz * half, 0.16, 0.12), STEEL_DARK);
  }
  kit.add('metal', beam(ax - tx * half, y - 0.05, az - tz * half, bx - tx * half, y - 0.05, bz - tz * half, 0.12), STEEL_DARK, { flat: true });
  kit.add('metal', beam(ax + tx * half, y - 0.05, az + tz * half, bx + tx * half, y - 0.05, bz + tz * half, 0.12), STEEL_DARK, { flat: true });
}

/**
 * Tube-and-coupler scaffolding tower (x0..x1, z0..z1 footprint, up to y1)
 * with plank decks every 2 m, a ladder and toe boards. `lift` = base height.
 */
export function scaffold(kit: DecorKit, x0: number, z0: number, x1: number, z1: number, y1: number, lift = 0, col: string = STEEL): void {
  const t = 0.05;
  const posts: [number, number][] = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  for (const [px, pz] of posts) {
    kit.add('metal', cylAB(px, lift, pz, px, y1 + 1, pz, t, t, 6), col, { flat: true });
    kit.add('metal', box(px - 0.12, lift, pz - 0.12, px + 0.12, lift + 0.04, pz + 0.12), STEEL_DARK, { flat: true });
  }
  for (let y = lift + 2; y <= y1 + 0.01; y += 2) {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = posts[i];
      const [bx, bz] = posts[(i + 1) % 4];
      kit.add('metal', cylAB(ax, y, az, bx, y, bz, t * 0.9, t * 0.9, 5), col, { flat: true });
      kit.add('metal', cylAB(ax, y + 1, az, bx, y + 1, bz, t * 0.8, t * 0.8, 5), col, { flat: true });
      if (((y - lift) / 2) % 2 === 1) kit.add('metal', cylAB(ax, y - 2, az, bx, y, bz, t * 0.8, t * 0.8, 5), col, { flat: true });
    }
    // Planks.
    const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
    const n = Math.max(2, Math.floor((alongX ? Math.abs(z1 - z0) : Math.abs(x1 - x0)) / 0.24));
    for (let k = 0; k < n; k++) {
      const f0 = k / n + 0.01;
      const f1 = (k + 1) / n - 0.01;
      if (alongX) kit.add('wood', box(x0 - 0.1, y + 0.02, z0 + (z1 - z0) * f0, x1 + 0.1, y + 0.07, z0 + (z1 - z0) * f1), k % 3 ? '#b39a7f' : '#9c8468', { flat: true });
      else kit.add('wood', box(x0 + (x1 - x0) * f0, y + 0.02, z0 - 0.1, x0 + (x1 - x0) * f1, y + 0.07, z1 + 0.1), k % 3 ? '#b39a7f' : '#9c8468', { flat: true });
    }
  }
  // Ladder up one face.
  const lx = x0 + (x1 - x0) * 0.3;
  for (const dx of [-0.2, 0.2]) kit.add('metal', cylAB(lx + dx, lift, z0 - 0.05, lx + dx, y1 + 1, z0 - 0.05, 0.025, 0.025, 4), '#8a8680', { flat: true });
  for (let y = lift + 0.3; y < y1 + 0.9; y += 0.3) kit.add('metal', cylAB(lx - 0.2, y, z0 - 0.05, lx + 0.2, y, z0 - 0.05, 0.018, 0.018, 4), '#8a8680', { flat: true });
}

// ── Crew life ───────────────────────────────────────────────────────────────

/** Bank of steel lockers against a wall (the wall faces (nx, nz)); some doors ajar. */
export function lockers(kit: DecorKit, rnd: () => number, a0: number, a1: number, plane: number, n: 'x+' | 'x-' | 'z+' | 'z-', cols: string[], overgrown = false): void {
  const nx = n === 'x+' ? 1 : n === 'x-' ? -1 : 0;
  const nz = n === 'z+' ? 1 : n === 'z-' ? -1 : 0;
  const d = 0.42;
  for (let a = Math.min(a0, a1); a < Math.max(a0, a1) - 0.4; a += 0.46) {
    const col = cols[Math.floor(rnd() * cols.length)];
    const g = nx !== 0 ? box(plane, 0.06, a + 0.02, plane + nx * d, 1.9, a + 0.44) : box(a + 0.02, 0.06, plane, a + 0.44, 1.9, plane + nz * d);
    kit.add('paint', g, col, { base: 0 });
    // Vents, handle, and a door hanging open now and then.
    const fx = (along: number, off: number, yy: number): [number, number, number] => (nx !== 0 ? [plane + nx * off, yy, a + along] : [a + along, yy, plane + nz * off]);
    for (let k = 0; k < (kit.low ? 0 : 3); k++) {
      const [vx, vy, vz] = fx(0.23, d + 0.004, 1.6 + k * 0.06);
      kit.add('metal', boxC(vx, vy, vz, nx !== 0 ? 0.01 : 0.24, 0.025, nx !== 0 ? 0.24 : 0.01), '#4c4743', { flat: true });
    }
    const [hx, hy, hz] = fx(0.38, d + 0.01, 1.05);
    kit.add('metal', boxC(hx, hy, hz, nx !== 0 ? 0.03 : 0.03, 0.14, nx !== 0 ? 0.03 : 0.03), STEEL, { flat: true });
    if (rnd() < 0.2) {
      const [ox, , oz] = fx(0.02, d, 0);
      const door = box(-0.21, 0.08, 0, 0.21, 1.86, 0.02);
      const ang = Math.atan2(nx, nz) + 0.9;
      kit.add('paint', door, new THREE.Color(col).multiplyScalar(0.92), { flat: true }, trs(ox + Math.sin(ang) * 0.21, 0, oz + Math.cos(ang) * 0.21, ang - Math.PI / 2));
    }
  }
  if (overgrown) {
    for (let i = 0; i < 6; i++) {
      const a = Math.min(a0, a1) + rnd() * Math.abs(a1 - a0);
      const p: [number, number, number] = nx !== 0 ? [plane + nx * (d + 0.05), 1.9, a] : [a, 1.9, plane + nz * (d + 0.05)];
      kit.add('foliage', sphere(p[0], p[1], p[2], 0.25 + rnd() * 0.2, 6, 3, 0.5), GREENS[Math.floor(rnd() * 3)], { flat: true });
    }
  }
}

/** Coffee mug (handle facing rot). */
export function mug(kit: DecorKit, x: number, y: number, z: number, col: string, rot = 0): void {
  const m = trs(x, y, z, rot);
  kit.add('paint', lathe([[0.001, 0], [0.042, 0], [0.045, 0.1], [0.04, 0.1], [0.037, 0.012], [0.001, 0.012]], 10), col, { flat: true }, m);
  const h = new THREE.TorusGeometry(0.026, 0.008, 4, 8, Math.PI);
  h.rotateZ(-Math.PI / 2);
  h.translate(0.046, 0.05, 0);
  kit.add('paint', h, col, { flat: true }, m);
  kit.add('paint', cyl(0, 0.07, 0, 0.037, 0.005, 8), '#3a2c22', { flat: true }, m);
}

/** Tin lunch box with the rocket print on its side. */
export function lunchbox(kit: DecorKit, x: number, y: number, z: number, rot: number, col: string = ENV.pastelBlue, open = false): void {
  const m = trs(x, y, z, rot);
  kit.add('paint', rbox(-0.14, 0, -0.08, 0.14, 0.17, 0.08, 0.015), col, { flat: true }, m);
  kit.add('sign2', quad(0, 0.085, 0.082, 0.26, 0.13, 0, 1, uvD('lunch', 2)), '#ffffff', { flat: true }, m);
  kit.add('metal', beam(-0.06, 0.17, 0, 0.06, 0.17, 0, 0.012), STEEL_DARK, { flat: true }, m);
  if (open) kit.add('paint', box(-0.14, 0.17, -0.08, 0.14, 0.18, 0.08).rotateX(-1.1).translate(0, 0.07, -0.13), col, { flat: true }, m);
}

/** Thermos flask. */
export function thermos(kit: DecorKit, x: number, y: number, z: number, col: string = ENV.terracottaFaded): void {
  kit.add('paint', cyl(x, y, z, 0.045, 0.28, 10), col);
  kit.add('metal', cyl(x, y + 0.28, z, 0.047, 0.07, 10), '#8a8680', { flat: true });
}

/** Workbench against a wall (top at 0.9) with the crew's break-time still life. */
export function workbench(kit: DecorKit, rnd: () => number, x: number, z: number, rot: number, len = 1.8): void {
  const m = trs(x, 0, z, rot);
  kit.add('wood', box(-len / 2, 0.84, -0.32, len / 2, 0.9, 0.32), '#9c8468', {}, m);
  for (const px of [-len / 2 + 0.06, len / 2 - 0.06]) for (const pz of [-0.26, 0.26]) kit.add('metal', box(px - 0.03, 0, pz - 0.03, px + 0.03, 0.84, pz + 0.03), STEEL_DARK, { flat: true }, m);
  kit.add('metal', box(-len / 2, 0.25, -0.3, len / 2, 0.28, 0.3), '#6d6a64', { flat: true }, m);
  const v = new THREE.Vector3();
  const at = (lx: number, lz: number): THREE.Vector3 => v.set(lx, 0, lz).applyMatrix4(m);
  let p = at(-len / 2 + 0.3, 0.05);
  mug(kit, p.x, 0.9, p.z, ENV.bone, rnd() * 6);
  p = at(-len / 2 + 0.48, -0.1);
  mug(kit, p.x, 0.9, p.z, ENV.terracottaFaded, rnd() * 6);
  p = at(-0.1, -0.05);
  lunchbox(kit, p.x, 0.9, p.z, rot + 0.15, rnd() < 0.5 ? ENV.pastelBlue : ENV.pastelYellow, true);
  p = at(0.3, -0.12);
  thermos(kit, p.x, 0.9, p.z);
  p = at(len / 2 - 0.35, 0.0);
  // Transistor radio and a stack of manuals.
  kit.add('paint', rbox(-0.14, 0, -0.06, 0.14, 0.17, 0.06, 0.02), '#b39a7f', {}, trs(p.x, 0.9, p.z, rot));
  kit.add('glow', box(-0.08, 0.06, 0.061, 0.03, 0.12, 0.062), ENV.glowGold, { flat: true, k: 1.6 }, trs(p.x, 0.9, p.z, rot));
  p = at(0.65, 0.12);
  for (let i = 0; i < 3; i++) kit.add('paint', box(-0.11, i * 0.03, -0.08, 0.11, i * 0.03 + 0.028, 0.08), i % 2 ? ENV.bone : ENV.sage, { flat: true }, trs(p.x, 0.9, p.z, rot + i * 0.15));
  contact(kit, x, 0, z, len * 0.6, 0.45, rot);
}

/** Hard hat (dropped or on a hook). */
export function hardHat(kit: DecorKit, x: number, y: number, z: number, col: string = ENV.bone): void {
  kit.add('paint', sphere(x, y, z, 0.15, 10, 5, 0.75).scale(1, 1, 1), col, { flat: true });
  kit.add('paint', cyl(x, y - 0.005, z, 0.19, 0.015, 12), col, { flat: true });
}

// ── Glowing fungi (Bloom bioluminescence for shaded corners) ───────────────

/** Low has no bloom: HDR glow would clip to white there, so keep the hue. */
function glowK(kit: DecorKit): number {
  return kit.low ? 0.55 : 1;
}

/**
 * A cluster of glowing mushrooms (chartreuse / pale gold only) with a dark
 * mossy mat, or shelf fungi up a wall when (wallNx, wallNz) is given.
 */
export function fungi(kit: DecorKit, rnd: () => number, x: number, y: number, z: number, spread: number, count: number, wallNx = 0, wallNz = 0): void {
  const onWall = wallNx !== 0 || wallNz !== 0;
  if (!onWall) {
    const mat = new THREE.CircleGeometry(spread * 0.9, 8);
    mat.rotateX(-Math.PI / 2);
    mat.translate(x, y + 0.014, z);
    kit.add('foliage', mat, GREENS[0], { flat: true, k: 0.5 });
  }
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * spread;
    const col = rnd() < 0.68 ? ENV.glowChartreuse : ENV.glowGold;
    if (onWall) {
      // Bracket fungus: a half disc sticking out of the wall.
      const along = Math.cos(a) * r;
      const px = x + (wallNz !== 0 ? along : 0) + wallNx * 0.02;
      const pz = z + (wallNx !== 0 ? along : 0) + wallNz * 0.02;
      const py = y + Math.abs(Math.sin(a)) * r * 1.2;
      const s = 0.05 + rnd() * 0.07;
      const g = new THREE.CircleGeometry(s, 7, 0, Math.PI);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.atan2(wallNx, wallNz) + Math.PI); // the half disc points out of the wall
      g.translate(px, py, pz);
      kit.add('glow', g, col, { flat: true, k: (1.6 + rnd() * 0.8) * glowK(kit) });
      continue;
    }
    const h = 0.04 + rnd() * 0.16;
    const cap = 0.025 + rnd() * 0.06;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    kit.add('foliage', cylAB(px, y, pz, px + (rnd() - 0.5) * 0.03, y + h, pz + (rnd() - 0.5) * 0.03, cap * 0.22, cap * 0.18, 5), '#d8d2bf', { flat: true, k: 0.8 });
    kit.add('glow', sphere(px, y + h, pz, cap, 6, 3, 0.45), col, { flat: true, k: (1.8 + rnd() * 1.2) * glowK(kit) });
  }
  const size = spread * 3;
  kit.add('pool', onWall ? quad(x + wallNx * 0.04, y + spread * 0.6, z + wallNz * 0.04, size, size, wallNx, wallNz) : floorQuad(x, y + 0.035, z, size, size), ENV.glowChartreuse, { flat: true, k: 0.24 });
}

// ── Coast ───────────────────────────────────────────────────────────────────

/** Faceted boulder (jittered icosahedron), half sunk at y. */
export function rock(kit: DecorKit, rnd: () => number, x: number, y: number, z: number, s: number, col: string = ENV.rock, kind: Kind = 'rock'): void {
  const g = new THREE.IcosahedronGeometry(1, kit.low ? 0 : 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  // Deterministic jitter per (shared) vertex position so faces stay closed.
  const seed = rnd() * 100;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i);
    const vy = p.getY(i);
    const vz = p.getZ(i);
    const k = 1 + Math.sin(vx * 5.1 + seed) * Math.cos(vz * 4.3 + seed * 0.7) * 0.18 + Math.sin(vy * 6.7 + seed) * 0.08;
    p.setXYZ(i, vx * k, vy * k * 0.72, vz * k);
  }
  g.computeVertexNormals();
  g.scale(s * (0.8 + rnd() * 0.5), s, s * (0.8 + rnd() * 0.5));
  g.rotateY(rnd() * Math.PI);
  g.translate(x, y, z);
  // Wet, dark foot; sun-bleached top.
  kit.add(kind, g, col, { shade: (_x, yy, _z, _nx, ny) => (yy < -2.6 ? 0.55 : 0.78) + (ny > 0.5 ? 0.2 : 0) });
}

/** A perched seagull (sunset silhouette: pale body, slate wings), facing rot. */
export function perchedGull(kit: DecorKit, x: number, y: number, z: number, rot: number, s = 1): void {
  const m = trs(x, y, z, rot, s);
  kit.add('paint', sphere(0, 0.16, 0, 0.12, 8, 5, 0.85).scale(1, 1, 1.6), '#ece6dc', { flat: true }, m);
  kit.add('paint', sphere(0, 0.27, 0.15, 0.065, 7, 5), '#f1ece3', { flat: true }, m);
  kit.add('paint', cylAB(0, 0.27, 0.2, 0, 0.26, 0.28, 0.018, 0.006, 4), '#c9a24e', { flat: true }, m);
  for (const sx of [-1, 1]) kit.add('paint', box(sx * 0.115, 0.13, -0.18, sx * 0.07, 0.24, 0.12).rotateX(-0.12), '#6a6e74', { flat: true }, m);
  kit.add('paint', box(-0.05, 0.12, -0.32, 0.05, 0.16, -0.16), '#4a4452', { flat: true }, m);
  for (const sx of [-0.04, 0.04]) kit.add('paint', cylAB(sx, 0, 0, sx, 0.07, 0.01, 0.008, 0.008, 3), '#c99a82', { flat: true }, m);
}

/** Rusted cage buoy (local, base at origin). */
export function buoyGeo(kit: DecorKit, m: THREE.Matrix4): void {
  kit.add('paint', lathe([[0.02, -0.6], [0.7, -0.35], [0.95, 0], [0.9, 0.3], [0.02, 0.32]], 14), '#9a6a4f', { shade: (_x, y) => (y < 0 ? 0.6 : 1) }, m);
  kit.add('paint', cyl(0, 0.0, 0, 0.96, 0.18, 14), ENV.bone, { flat: true }, m);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    kit.add('metal', beam(Math.cos(a) * 0.6, 0.3, Math.sin(a) * 0.6, Math.cos(a) * 0.18, 2.1, Math.sin(a) * 0.18, 0.07), '#7a5038', { flat: true }, m);
  }
  for (const y of [0.9, 1.6]) {
    const r = 0.6 - ((y - 0.3) / 1.8) * 0.42;
    const t = new THREE.TorusGeometry(r, 0.035, 4, 12);
    t.rotateX(Math.PI / 2);
    t.translate(0, y, 0);
    kit.add('metal', t, '#7a5038', { flat: true }, m);
  }
  kit.add('paint', sphere(0, 2.25, 0, 0.22, 8, 5), '#5c574f', { flat: true }, m);
  kit.add('glow', sphere(0, 2.5, 0, 0.09, 6, 4), ENV.glowGold, { flat: true, k: 2.2 }, m);
  // Salt crust and weed at the waterline.
  kit.add('paint', cyl(0, -0.12, 0, 0.93, 0.08, 14), '#e8e4da', { flat: true }, m);
}

/** Half-sunk wrecked dinghy: a split hull, broken ribs, a lost oar. */
export function wreckedDinghy(kit: DecorKit, x: number, y: number, z: number, rot: number, col: string): void {
  const m = trs(x, y, z, rot).multiply(new THREE.Matrix4().makeRotationZ(0.35)).multiply(new THREE.Matrix4().makeRotationX(0.12));
  const hull = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 1.35, Math.PI / 2, Math.PI / 2);
  hull.scale(0.85, 0.6, 2.2);
  hull.translate(0, 0.6, 0);
  kit.add('wood', hull, col, { shade: (_x, yy) => (yy < -2.6 ? 0.55 : 0.95) }, m);
  for (let i = -3; i <= 3; i++) {
    const zz = i * 0.55;
    const half = Math.cos((zz / 2.2) * (Math.PI / 2)) * 0.82;
    kit.add('wood', beam(-half, 0.6, zz, -half * 0.5, 0.1, zz, 0.06), '#6e5a4a', { flat: true }, m);
    if (i % 2 === 0) kit.add('wood', beam(half, 0.6, zz, half * 0.5, 0.1, zz, 0.06), '#6e5a4a', { flat: true }, m);
  }
  kit.add('wood', box(-0.75, 0.48, -0.1, 0.4, 0.54, 0.18), '#8c7660', { flat: true }, m);
  kit.add('wood', beam(1.4, 0.2, 1.4, -0.2, 0.25, 2.7, 0.05), '#b39a7f', { flat: true }, trs(x, y, z, rot));
}
