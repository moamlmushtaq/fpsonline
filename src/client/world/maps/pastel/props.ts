// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel props: the cars (wood-panel station wagons, a sedan,
// camper vans, the crashed "Mister Cosmo" soft-serve step van), the drained
// kidney pool, backyard storytelling (lunch boxes on the picnic table, kids'
// bikes, trampoline, laundry, BBQ, gnomes), street furniture (globe lamps,
// mailboxes — one stuffed with letters — hydrants, signs, the bus shelter with
// its MOON BASE poster), the STARLIGHT pylons, trees and the perimeter.
//
// Every prop with a collision box matches it; props without collision are
// small, thin or tucked against walls / the bounds.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV } from '../../../engine/palette';
import { type DecorKit, type RGB, mix, rgb } from './kit';
import { REGION, type SignBatch } from './signs';
import { drapedVine, glowColor, hangingVine } from './vines';

const K = {
  bone: rgb(ENV.bone),
  boneShade: rgb(ENV.boneShade),
  terra: rgb(ENV.terracotta),
  terraF: rgb(ENV.terracottaFaded),
  sage: rgb(ENV.sage),
  olive: rgb(ENV.olive),
  mint: rgb(ENV.pastelMint),
  pink: rgb(ENV.pastelPink),
  yellow: rgb(ENV.pastelYellow),
  blue: rgb(ENV.pastelBlue),
  sand: rgb(ENV.sand),
  wood: rgb('#b39a7f'),
  woodDark: rgb('#8a7560'),
  dark: rgb('#3a3634'),
  tire: rgb('#2f2c2a'),
  chrome: rgb('#c9c6bf'),
  glass: rgb('#687885'),
  rust: rgb(ENV.rust),
  mustard: rgb('#d9c28b'),
  trunk: rgb('#7a6a58'),
};

type Signs = { board: SignBatch; lit: SignBatch };

// ── Vehicles ────────────────────────────────────────────────────────────────

interface CarOpts {
  body: RGB;
  roof?: RGB;
  wood?: boolean;
  /** Cabin covers the rear (wagon/van) or the middle (sedan). */
  kind: 'wagon' | 'sedan' | 'van';
  flat?: number;
}

/**
 * A car filling the collision box: center (cx, cz), length along `ry`
 * direction, width, height (roof top).
 */
function car(kit: DecorKit, cx: number, cz: number, len: number, wid: number, h: number, ry: number, o: CarOpts, rng: () => number): void {
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(cx, 0, cz);
  const place = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).applyMatrix4(m);
  const box = (kind: Parameters<DecorKit['boxE']>[0], x: number, y: number, z: number, sx: number, sy: number, sz: number, col: RGB, r = 0): void =>
    kit.boxE(kind, place(x, y, z), new THREE.Euler(0, ry, 0), new THREE.Vector3(sx, sy, sz), col, r, { base: 0 });
  const sag = o.flat ?? 0;
  const bodyH = o.kind === 'van' ? h - 0.35 : 0.95;
  const bodyY = 0.28 - sag;
  // Lower body (length along local z).
  box('paint', 0, bodyY + (bodyH - bodyY) / 2 + 0.02, 0, wid, bodyH - bodyY, len, o.body, 0.14);
  if (o.wood) {
    for (const s of [-1, 1]) box('wood', s * (wid / 2 + 0.005), bodyY + 0.36, len * 0.08, 0.02, 0.34, len * 0.7, K.wood, 0);
  }
  // Cabin + glass band.
  const cab = o.kind === 'sedan' ? { z: -0.05 * len, l: len * 0.46 } : o.kind === 'wagon' ? { z: 0.1 * len, l: len * 0.68 } : { z: 0.02 * len, l: len * 0.9 };
  const cabH = h - bodyH;
  box('paint', 0, bodyH + cabH / 2 - 0.01, cab.z, wid * 0.92, cabH, cab.l, o.roof ?? o.body, 0.12);
  box('window', 0, bodyH + cabH * 0.48, cab.z, wid * 0.93, cabH * 0.62, cab.l * 0.94, mix(K.glass, K.dark, rng() * 0.4), 0.05);
  // Bumpers, lights, wheels.
  for (const s of [-1, 1]) {
    box('chrome', 0, bodyY + 0.12, s * (len / 2 + 0.03), wid * 1.02, 0.16, 0.1, K.chrome, 0.03);
    for (const lx of [-0.34, 0.34]) box('paint', lx * wid, bodyY + 0.42, s * (len / 2 + 0.005), 0.26, 0.16, 0.02, s > 0 ? K.bone : K.terraF, 0);
    for (const wz of [-0.32, 0.32]) {
      const p = place(s * (wid / 2 - 0.08), 0.33 - sag * 0.5, wz * len);
      const g = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12);
      g.rotateZ(Math.PI / 2);
      kit.geo('paint', g, new THREE.Matrix4().makeRotationY(ry).setPosition(p), K.tire, { drift: 0.05 });
      g.dispose();
      kit.boxE('chrome', place(s * (wid / 2 + 0.02), 0.33 - sag * 0.5, wz * len), new THREE.Euler(0, ry, 0), new THREE.Vector3(0.02, 0.26, 0.26), K.chrome, 0);
    }
  }
  // Roof rack on wagons.
  if (o.kind === 'wagon') {
    for (const s of [-1, 1]) box('chrome', s * wid * 0.36, h + 0.04, cab.z, 0.05, 0.05, cab.l * 0.8, K.chrome);
  }
  // Overgrowth: a vine across the roof + a few glowing buds, leaves on the hood.
  const a = place(-wid * 0.5, h - 0.05, cab.z - cab.l * 0.3);
  const b = place(wid * 0.5, h - 0.05, cab.z + cab.l * 0.2);
  drapedVine(kit, a, b, -0.05, rng, 2);
  for (let i = 0; i < 5; i++) {
    const p = place((rng() - 0.5) * wid * 0.8, bodyH + 0.02, -len * 0.38 + rng() * 0.2);
    kit.boxR('foliage', p.x, p.y, p.z, 0.25, 0.02, 0.18, rng() * Math.PI, mix(K.olive, K.mustard, rng() * 0.6), 0, { drift: 0.2 });
  }
}

function iceCreamVan(kit: DecorKit, signs: Signs, rng: () => number): void {
  // Collision: x 31..42.8, z ±1.2, 3.2 tall. Van body x 33.6..41.6, debris the rest.
  const x0 = 33.6;
  const x1 = 41.6;
  const cz = 0;
  kit.box('paint', x0, 0.35, cz - 1.2, x1, 3.0, cz + 1.2, K.pink, 0.22, { base: 0 });
  kit.box('paint', x0 - 0.01, 0.35, cz - 1.21, x1 + 0.01, 0.95, cz + 1.21, K.bone, 0.18, { base: 0 });
  kit.box('paint', x1 - 1.6, 1.6, cz - 1.22, x1 + 0.02, 2.6, cz + 1.22, K.bone, 0.1, { ao: 0 });
  kit.box('window', x1 - 1.4, 1.75, cz - 1.23, x1 - 0.3, 2.45, cz + 1.23, K.glass, 0.02, { ao: 0 });
  kit.box('window', x1 + 0.02, 1.7, cz - 1.0, x1 + 0.05, 2.5, cz + 1.0, mix(K.glass, K.dark, 0.5), 0.02, { ao: 0 });
  // Serving hatch (open awning) on the north side + livery both sides.
  kit.boxE('paint', new THREE.Vector3(36.8, 2.75, -1.75), new THREE.Euler(-0.9, 0, 0), new THREE.Vector3(3.4, 0.06, 1.2), K.bone);
  kit.box('window', 35.1, 1.5, -1.23, 38.5, 2.4, -1.2, K.dark, 0, { ao: 0 });
  signs.board.quad(REGION.truck, new THREE.Vector3(37.2, 1.2, 1.235), 5.4, 1.7, new THREE.Vector3(0, 0, 1));
  signs.board.quad(REGION.truck, new THREE.Vector3(37.2, 1.2, -1.235), 5.4, 1.7, new THREE.Vector3(0, 0, -1));
  // Giant fibreglass cone on the roof (billboard cards crossed).
  const top = new THREE.Vector3(36.8, 3.0 + 1.3, 0);
  signs.board.quad2(REGION.cone, top, 1.7, 2.6, new THREE.Vector3(0, 0, 1));
  signs.board.quad2(REGION.cone, top, 1.7, 2.6, new THREE.Vector3(1, 0, 0));
  // Wheels (front ones buckled).
  for (const [wx, wz, tilt] of [
    [34.8, -1.15, 0],
    [34.8, 1.15, 0],
    [40.4, -1.15, 0.25],
    [40.4, 1.15, -0.2],
  ] as const) {
    const g = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
    g.rotateX(Math.PI / 2);
    kit.geo('paint', g, new THREE.Matrix4().makeRotationY(tilt).setPosition(wx, 0.4, wz), K.tire, { drift: 0.05 });
    g.dispose();
  }
  // Debris filling the rest of the blocking volume: the toppled roadside
  // sign leaning on the van, a chest freezer on its side, stacked crates, the
  // snapped porch post and a fallen streetlight.
  kit.boxE('paint', new THREE.Vector3(32.05, 1.45, 0), new THREE.Euler(0, 0, -0.32), new THREE.Vector3(0.14, 3.2, 2.35), mix(K.pink, K.bone, 0.4), 0.03);
  signs.board.quad(REGION.cone, new THREE.Vector3(31.95, 1.5, 0), 1.9, 2.85, new THREE.Vector3(-0.95, 0.31, 0).normalize());
  kit.boxE('paint', new THREE.Vector3(32.9, 0.55, 0.55), new THREE.Euler(0, 0.2, Math.PI / 2), new THREE.Vector3(1.1, 1.3, 1.0), mix(K.bone, K.blue, 0.3), 0.08);
  kit.box('wood', 31.2, 0, -1.15, 32.3, 0.85, -0.1, K.wood, 0.03);
  kit.box('wood', 31.3, 0.85, -1.05, 32.2, 1.6, -0.2, K.woodDark, 0.03);
  kit.boxE('wood', new THREE.Vector3(42.2, 1.4, 0), new THREE.Euler(0.2, 0, 0.5), new THREE.Vector3(0.18, 3.2, 2.2), K.wood, 0.02);
  kit.tube('chrome', new THREE.Vector3(42.6, 0.2, -1.6), new THREE.Vector3(34.5, 3.1, 0.6), 0.09, K.boneShade, 6);
  kit.ball('paint', 34.3, 3.15, 0.65, 0.35, 0.35, 0.35, K.bone, 1);
  // Spilled cones / pops on the road + glowing vine over the wreck.
  for (let i = 0; i < 10; i++) kit.boxR('paint', 30 + rng() * 3, 0.06, -2.5 + rng() * 5, 0.25, 0.08, 0.1, rng() * Math.PI, mix(K.mustard, K.pink, rng()), 0);
  drapedVine(kit, new THREE.Vector3(34, 3.05, -1.2), new THREE.Vector3(41, 3.05, 1.2), -0.05, rng, 4);
}

// ── Pool ────────────────────────────────────────────────────────────────────

function pool(kit: DecorKit, rng: () => number): void {
  // Hole x −45..−33, z ±5: deep floor −1.2 (x < −38), sloped floor up to x −33.
  const tileW = rgb('#bcd2d8');
  const tileD = rgb('#9fbac4');
  const deep = -1.2;
  // Walls (tiled) — inner faces of the hole, just inside the edge.
  kit.box('tile', -45, deep, -5, -44.96, 0, 5, tileW, 0, { base: deep, ao: 0.3 });
  kit.box('tile', -45, deep, 4.96, -33, 0, 5, tileW, 0, { base: deep, ao: 0.3 });
  kit.box('tile', -45, deep, -5, -33, 0, -4.96, tileW, 0, { base: deep, ao: 0.3 });
  // Floor: deep part + slope (quad following the ramp).
  kit.slab('tile', -45, -5, -38, 5, deep + 0.003, mix(tileD, K.sand, 0.25), { drift: 0.18 });
  kit.quad('tile', new THREE.Vector3(-38, deep + 0.003, 5), new THREE.Vector3(-33, 0.003, 5), new THREE.Vector3(-33, 0.003, -5), new THREE.Vector3(-38, deep + 0.003, -5), mix(tileD, K.sand, 0.2), { drift: 0.18 });
  // Waterline band of darker tile + coping (rounded bone).
  kit.box('tile', -44.97, -0.35, -4.98, -44.95, -0.12, 4.98, rgb('#6f95a0'), 0, { ao: 0 });
  kit.box('tile', -45, -0.35, 4.95, -33, -0.12, 4.97, rgb('#6f95a0'), 0, { ao: 0 });
  kit.box('tile', -45, -0.35, -4.97, -33, -0.12, -4.95, rgb('#6f95a0'), 0, { ao: 0 });
  for (const [a, b, c, d] of [
    [-45.35, -5.35, -32.65, -4.95],
    [-45.35, 4.95, -32.65, 5.35],
    [-45.35, -5.35, -44.95, 5.35],
  ] as const) kit.box('concrete', a, -0.04, b, c, 0.09, d, K.bone, 0.04, { ao: 0 });
  // Lane markings on the floor.
  for (const z of [-2.5, 0, 2.5]) kit.slab('paint', -44.5, z - 0.12, -38.4, z + 0.12, deep + 0.008, rgb('#5b7b86'), { drift: 0.1 });
  // Rainwater puddle in the deep end with glowing algae.
  const pg = new THREE.CircleGeometry(1, kit.low ? 14 : 24);
  pg.rotateX(-Math.PI / 2);
  kit.geo('tile', pg, new THREE.Matrix4().makeTranslation(-42, deep + 0.012, -0.6).multiply(new THREE.Matrix4().makeScale(2.6, 1, 3.3)), rgb('#5e7e80'), { drift: 0.1 });
  pg.dispose();
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const r = 2.4 + rng() * 1.2;
    kit.ball('glow', -42 + Math.cos(a) * r * 0.85, deep + 0.03, -0.6 + Math.sin(a) * r * 1.05, 0.12 + rng() * 0.2, 0.02, 0.1 + rng() * 0.15, glowColor(rng, 0.8), 0);
  }
  // Ladder (deep end, north wall) + diving board (west end).
  for (const x of [-43.6, -43.0]) {
    kit.tube('chrome', new THREE.Vector3(x, 0.9, -4.7), new THREE.Vector3(x, 0.9, -5.3), 0.035, K.chrome, 6);
    kit.tube('chrome', new THREE.Vector3(x, 0.9, -4.7), new THREE.Vector3(x, -1.0, -4.85), 0.035, K.chrome, 6);
  }
  kit.box('concrete', -46.8, 0, -0.7, -45.4, 0.5, 0.7, K.boneShade, 0.05);
  kit.box('paint', -46.2, 0.5, -0.35, -42.4, 0.6, 0.35, K.bone, 0.04, { ao: 0 });
  // Loungers + umbrella table on the deck (north side, out of the lanes).
  for (const [x, z, ry] of [
    [-36, 9.5, 0.2],
    [-38.8, 9.8, -0.1],
    [-35.2, -9.6, 3.0],
  ] as const) lounger(kit, x, z, ry);
  kit.cyl('chrome', -41.6, 0, 10, 0.03, 0.03, 2.3, K.chrome, 5);
  const um = new THREE.ConeGeometry(1.5, 0.5, 8, 1, true);
  kit.geo('fabric', um, new THREE.Matrix4().makeTranslation(-41.6, 2.2, 10), K.terraF, { drift: 0.1 });
  kit.geo('fabric', um, new THREE.Matrix4().makeTranslation(-41.6, 2.2, 10).multiply(new THREE.Matrix4().makeRotationX(Math.PI)), mix(K.terraF, K.dark, 0.3), { drift: 0.1 });
  um.dispose();
  kit.cyl('paint', -41.6, 0, 10, 0.55, 0.55, 0.72, K.bone, 12);
  // Inflatable swan deflated in the deep end, beach ball.
  kit.ball('paint', -40.5, deep + 0.12, 2.8, 0.6, 0.12, 0.4, K.bone, 1);
  kit.ball('paint', -36.2, -0.9, -3.5, 0.2, 0.2, 0.2, K.mustard, 1);
}

function lounger(kit: DecorKit, x: number, z: number, ry: number): void {
  kit.boxR('paint', x, 0.3, z, 0.7, 0.06, 1.9, ry, K.bone, 0.02);
  kit.boxE('fabric', new THREE.Vector3(x - Math.sin(ry) * 0.75, 0.55, z - Math.cos(ry) * 0.75), new THREE.Euler(-0.9, ry, 0), new THREE.Vector3(0.68, 0.05, 0.7), K.mint, 0.02);
  for (const s of [-1, 1]) kit.boxR('chrome', x + Math.cos(ry) * 0.3 * s, 0.15, z, 0.04, 0.3, 1.7, ry, K.chrome, 0);
}

// ── Backyard storytelling (south yard is the busier one) ────────────────────

function backyard(kit: DecorKit, signs: Signs, sz: number, rng: () => number, rich: boolean): void {
  const Z = (z: number): number => z * sz;
  // Privacy fence planks (collision x −45..−37, z 34..34.3 → 1.2 m).
  for (let x = -45; x < -37; x += 0.34) kit.box('wood', x + 0.02, 0, Math.min(Z(34), Z(34.3)), x + 0.31, 1.2 + ((x * 7) % 1 > 0.5 ? 0.05 : 0), Math.max(Z(34), Z(34.3)), mix(K.wood, K.sand, rng() * 0.4), 0.01);
  kit.box('wood', -45, 0.25, Math.min(Z(34.3), Z(34.45)), -37, 0.35, Math.max(Z(34.3), Z(34.45)), K.woodDark, 0);
  kit.box('wood', -45, 0.9, Math.min(Z(34.3), Z(34.45)), -37, 1.0, Math.max(Z(34.3), Z(34.45)), K.woodDark, 0);
  drapedVine(kit, new THREE.Vector3(-45, 1.2, Z(34.15)), new THREE.Vector3(-41, 1.2, Z(34.15)), 0.15, rng, 2);
  // Shed door + window (builder mass x −42..−39, z 19..22).
  const shedFace = Z(19) - sz * 0.02;
  kit.box('wood', -41.4, 0, Math.min(shedFace, shedFace - sz * 0.05), -40.2, 1.9, Math.max(shedFace, shedFace - sz * 0.05), K.terraF, 0.02);
  kit.box('chrome', -40.35, 0.9, Math.min(shedFace, shedFace - sz * 0.09), -40.3, 1.0, Math.max(shedFace, shedFace - sz * 0.09), K.chrome, 0);
  hangingVine(kit, new THREE.Vector3(-42.05, 2.25, Z(21.5)), 1.6, rng, 1.3);
  // Trampoline (no collision; tucked into the yard corner).
  const tx = -43.2;
  const tz = Z(28.8);
  const ring = new THREE.TorusGeometry(1.4, 0.06, 5, kit.low ? 12 : 20);
  ring.rotateX(Math.PI / 2);
  kit.geo('chrome', ring, new THREE.Matrix4().makeTranslation(tx, 0.85, tz), K.chrome, { drift: 0 });
  ring.dispose();
  const mat = new THREE.CircleGeometry(1.3, kit.low ? 12 : 20);
  mat.rotateX(-Math.PI / 2);
  kit.geo('paint', mat, new THREE.Matrix4().makeTranslation(tx, 0.83, tz), K.dark, { drift: 0.05 });
  mat.dispose();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    kit.tube('chrome', new THREE.Vector3(tx + Math.cos(a) * 1.4, 0.85, tz + Math.sin(a) * 1.4), new THREE.Vector3(tx + Math.cos(a) * 1.5, 0, tz + Math.sin(a) * 1.5), 0.03, K.chrome, 4);
  }
  // Picnic table with lunch boxes (the south one) / a kiddie pool (north).
  if (rich) {
    const px = -35.5;
    const pz = Z(23.5);
    kit.box('wood', px - 1.1, 0.72, pz - 0.45, px + 1.1, 0.78, pz + 0.45, K.wood, 0.02);
    for (const s of [-1, 1]) {
      kit.box('wood', px - 1.1, 0.42, pz + s * 0.75 - 0.15, px + 1.1, 0.47, pz + s * 0.75 + 0.15, K.wood, 0.02);
      kit.box('wood', px + s * 0.9 - 0.05, 0, pz - 0.8, px + s * 0.9 + 0.05, 0.72, pz + 0.8, K.woodDark, 0);
    }
    // Two lunch boxes (tin, pastel) + a thermos + an apple.
    kit.box('paint', px - 0.6, 0.78, pz - 0.18, px - 0.22, 1.02, pz + 0.08, K.blue, 0.03);
    kit.box('paint', px - 0.6, 1.02, pz - 0.18, px - 0.22, 1.05, pz + 0.08, K.terra, 0.01);
    kit.boxR('paint', px + 0.35, 0.9, pz + 0.05, 0.36, 0.24, 0.24, 0.4, K.yellow, 0.03);
    kit.cyl('paint', px + 0.05, 0.78, pz + 0.2, 0.06, 0.06, 0.28, K.terraF, 8);
    kit.ball('paint', px - 0.05, 0.83, pz - 0.2, 0.05, 0.05, 0.05, K.terra, 1);
    // BBQ kettle.
    kit.ball('paint', -33.2, 0.85, Z(27.6), 0.36, 0.3, 0.36, K.dark, 1);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      kit.tube('chrome', new THREE.Vector3(-33.2, 0.7, Z(27.6)), new THREE.Vector3(-33.2 + Math.cos(a) * 0.35, 0, Z(27.6) + Math.sin(a) * 0.35), 0.02, K.chrome, 3);
    }
    // Kids' bikes dropped on the lawn.
    bike(kit, -39.2, Z(30.8), 0.6, K.terraF);
    bike(kit, -37.8, Z(31.4), 2.2, K.mint);
    // For-sale sign.
    kit.box('wood', -44.6, 0, Z(13.4) - 0.04, -44.5, 1.2, Z(13.4) + 0.04, K.bone, 0);
    signs.board.quad(REGION.forSale, new THREE.Vector3(-44.55, 1.1, Z(13.4) - sz * 0.05), 0.75, 0.56, new THREE.Vector3(0, 0, -sz));
  } else {
    kit.cyl('paint', -35.5, 0, Z(24), 1.1, 1.1, 0.28, K.blue, 16);
    kit.cyl('tile', -35.5, 0.02, Z(24), 0.98, 0.98, 0.2, rgb('#6f95a0'), 16);
    bike(kit, -38.6, Z(30.2), 1.4, K.yellow);
  }
  // Laundry line (small items high up: towels + shirts; no collision).
  const l0 = new THREE.Vector3(-44.9, 2.1, Z(26));
  const l1 = new THREE.Vector3(-38.5, 2.1, Z(27.5));
  kit.tube('chrome', l0, l1, 0.008, K.bone, 3);
  kit.box('wood', l0.x - 0.05, 0, l0.z - 0.05, l0.x + 0.05, 2.2, l0.z + 0.05, K.woodDark, 0);
  kit.box('wood', l1.x - 0.05, 0, l1.z - 0.05, l1.x + 0.05, 2.2, l1.z + 0.05, K.woodDark, 0);
  const cloth = [K.bone, K.terraF, K.mint, K.yellow, K.pink];
  for (let i = 0; i < 6; i++) {
    const t = 0.12 + i * 0.14;
    const p = l0.clone().lerp(l1, t);
    const dir = new THREE.Vector3().subVectors(l1, l0).normalize();
    const w = 0.45 + rng() * 0.3;
    const h = 0.5 + rng() * 0.35;
    kit.quad('fabric', p.clone().addScaledVector(dir, -w / 2), p.clone().addScaledVector(dir, w / 2), p.clone().addScaledVector(dir, w / 2).setY(p.y - h), p.clone().addScaledVector(dir, -w / 2).setY(p.y - h), cloth[i % cloth.length], { drift: 0.1 });
  }
  // Garden gnome + birdbath.
  kit.cyl('paint', -44.2, 0, Z(17.2), 0.12, 0.16, 0.35, K.sage, 8);
  kit.cyl('paint', -44.2, 0.35, Z(17.2), 0.0, 0.1, 0.25, K.terra, 8);
  kit.cyl('concrete', -36.5, 0, Z(16.5), 0.12, 0.2, 0.8, K.boneShade, 10);
  kit.cyl('concrete', -36.5, 0.8, Z(16.5), 0.5, 0.2, 0.15, K.boneShade, 12);
}

function bike(kit: DecorKit, x: number, z: number, ry: number, col: RGB): void {
  // Lying on its side.
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0.06, z);
  for (const off of [-0.45, 0.45]) {
    const w = new THREE.TorusGeometry(0.28, 0.025, 4, 12);
    w.rotateX(Math.PI / 2);
    kit.geo('paint', w, m.clone().multiply(new THREE.Matrix4().makeTranslation(off, 0, 0)), K.dark, { drift: 0 });
    w.dispose();
  }
  const p = (a: number, b: number): THREE.Vector3 => new THREE.Vector3(a, 0.08, b).applyMatrix4(m);
  kit.tube('paint', p(-0.45, 0), p(0.1, 0.05), 0.03, col, 4);
  kit.tube('paint', p(0.1, 0.05), p(0.45, 0), 0.03, col, 4);
  kit.tube('paint', p(-0.1, 0.05), p(0.1, 0.05), 0.03, col, 4);
  kit.tube('chrome', p(0.4, -0.25), p(0.4, 0.25), 0.02, K.chrome, 4);
  kit.boxR('fabric', x, 0.12, z, 0.2, 0.05, 0.1, ry, K.terraF, 0.02);
}

// ── Street furniture ────────────────────────────────────────────────────────

function globeLamp(kit: DecorKit, x: number, z: number, h = 4.4): void {
  kit.cyl('concrete', x, 0, z, 0.14, 0.2, 0.5, K.boneShade, 8);
  kit.cyl('chrome', x, 0.5, z, 0.06, 0.08, h - 0.5, K.bone, 8);
  kit.ball('glow', x, h + 0.25, z, 0.32, 0.32, 0.32, rgb('#fff1d6', 0.55), 1, { drift: 0 });
  kit.cyl('chrome', x, h, z, 0.14, 0.1, 0.1, K.chrome, 8);
}

function parkingLamp(kit: DecorKit, x: number, z: number): void {
  kit.cyl('concrete', x, 0, z, 0.25, 0.3, 0.6, K.boneShade, 8);
  kit.cyl('chrome', x, 0.6, z, 0.09, 0.12, 7.4, K.bone, 8);
  for (const s of [-1, 1]) {
    kit.box('chrome', x + s * 0.2, 7.85, z - 0.08, x + s * 1.2, 7.95, z + 0.08, K.bone, 0);
    kit.box('paint', x + s * 1.2 - 0.35, 7.7, z - 0.28, x + s * 1.2 + 0.35, 7.95, z + 0.28, K.bone, 0.05, { ao: 0 });
  }
}

function mailbox(kit: DecorKit, x: number, z: number, ry: number, col: RGB, stuffed: boolean): void {
  kit.cyl('wood', x, 0, z, 0.05, 0.05, 1.0, K.woodDark, 6);
  kit.boxR('paint', x, 1.12, z, 0.26, 0.26, 0.5, ry, col, 0.1);
  kit.boxR('paint', x + Math.cos(ry) * 0.14, 1.2, z - Math.sin(ry) * 0.14, 0.03, 0.2, 0.04, ry, K.terra, 0);
  if (stuffed) {
    // Letters bursting out of the door and littering the grass.
    for (let i = 0; i < 9; i++) {
      const a = ry;
      const off = 0.28 + i * 0.03;
      kit.boxE('paint', new THREE.Vector3(x - Math.sin(a) * off, 1.12 + (i % 3) * 0.03, z - Math.cos(a) * off), new THREE.Euler(0.3 * (i % 2), a + i * 0.2, 0.2), new THREE.Vector3(0.2, 0.01, 0.12), i % 2 ? K.bone : mix(K.bone, K.yellow, 0.5), 0, { drift: 0 });
    }
  }
}

function hydrant(kit: DecorKit, x: number, z: number): void {
  kit.cyl('paint', x, 0, z, 0.14, 0.17, 0.62, K.terra, 8);
  kit.ball('paint', x, 0.64, z, 0.15, 0.1, 0.15, K.terra, 1);
  kit.box('paint', x - 0.22, 0.35, z - 0.06, x + 0.22, 0.45, z + 0.06, K.terra, 0.02, { ao: 0 });
}

function tree(kit: DecorKit, x: number, z: number, h: number, r: number, rng: () => number, vines = true): void {
  kit.cyl('wood', x, 0, z, 0.14, 0.24, h * 0.55, K.trunk, 7);
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2;
    kit.tube('wood', new THREE.Vector3(x, h * 0.45, z), new THREE.Vector3(x + Math.cos(a) * r * 0.5, h * 0.72, z + Math.sin(a) * r * 0.5), 0.07, K.trunk, 5);
  }
  const blobs = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < blobs; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * r * 0.45;
    const s = r * (0.55 + rng() * 0.35);
    kit.ball('foliage', x + Math.cos(a) * d, h * 0.72 + rng() * h * 0.2, z + Math.sin(a) * d, s, s * 0.72, s, mix(mix(K.sage, K.sand, 0.25), K.olive, rng() * 0.45), 1, { drift: 0.2, shade: (_x, _y, _z, _nx, ny) => (ny < -0.3 ? 0.82 : 1.06) });
  }
  if (vines) {
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      hangingVine(kit, new THREE.Vector3(x + Math.cos(a) * r * 0.7, h * 0.66, z + Math.sin(a) * r * 0.7), 0.8 + rng() * 1.6, rng, 1.3);
    }
  }
}

function hedge(kit: DecorKit, x0: number, z0: number, x1: number, z1: number, h: number, rng: () => number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 2.4));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    kit.ball('foliage', x, h * 0.5, z, 1.5 + rng() * 0.3, h * 0.55, 1.5 + rng() * 0.3, mix(K.olive, K.sage, rng() * 0.6), 1, { drift: 0.25, base: 0, ao: 0.35 });
  }
}

function busShelter(kit: DecorKit, signs: Signs, sz: number): void {
  // Collision back panel x 22..29.5, z 6..6.4 (2.6 m). Faces the cross street.
  const zb = 6.2 * sz;
  kit.box('paint', 22, 0, Math.min(zb - 0.2, zb + 0.2), 29.5, 2.6, Math.max(zb - 0.2, zb + 0.2), K.mint, 0.04);
  const zr0 = 6.4 * sz;
  const zr1 = 4.2 * sz;
  kit.box('paint', 21.8, 2.6, Math.min(zr0, zr1), 29.7, 2.78, Math.max(zr0, zr1), K.bone, 0.05, { ao: 0 });
  for (const x of [22.1, 29.4]) kit.box('glass', x - 0.02, 0.2, Math.min(zb, zr1 + 0.3 * sz), x + 0.02, 2.5, Math.max(zb, zr1 + 0.3 * sz), rgb('#cfe0e6'), 0);
  kit.box('wood', 23, 0.42, Math.min(zb - sz * 0.25, zb - sz * 0.7), 28.5, 0.5, Math.max(zb - sz * 0.25, zb - sz * 0.7), K.wood, 0.02);
  signs.board.quad(REGION.poster2, new THREE.Vector3(24.2, 1.45, zb - sz * 0.205), 1.3, 1.95, new THREE.Vector3(0, 0, -sz));
  signs.board.quad(REGION.poster1, new THREE.Vector3(27.2, 1.45, zb - sz * 0.205), 1.3, 1.95, new THREE.Vector3(0, 0, -sz));
  signs.board.quad(REGION.poster1, new THREE.Vector3(25.7, 1.45, zb + sz * 0.205), 1.3, 1.95, new THREE.Vector3(0, 0, sz));
  // Bus stop pole.
  kit.cyl('chrome', 29.9, 0, 4.5 * sz, 0.04, 0.04, 2.8, K.chrome, 6);
  kit.cyl('paint', 29.9, 2.8, 4.5 * sz, 0.28, 0.28, 0.06, K.terra, 14);
}

function pylon(kit: DecorKit, signs: Signs, sz: number): void {
  // Collision base x ±1.3, z 18.5..24.5 (×sz), 3 m. Brick base + two legs + sign.
  const z0 = Math.min(18.5 * sz, 24.5 * sz);
  const z1 = Math.max(18.5 * sz, 24.5 * sz);
  kit.box('concrete', -1.3, 0, z0, 1.3, 3.0, z1, mix(K.sand, K.terraF, 0.3), 0.08);
  kit.box('concrete', -1.36, 2.85, z0 - 0.06, 1.36, 3.05, z1 + 0.06, K.bone, 0.04, { ao: 0 });
  for (const zz of [z0 + 1.2, z1 - 1.2]) kit.box('concrete', -0.35, 3.0, zz - 0.35, 0.35, 12.6, zz + 0.35, K.bone, 0.08, { ao: 0 });
  const zc = (z0 + z1) / 2;
  kit.box('paint', -0.28, 4.6, zc - 1.9, 0.28, 12.0, zc + 1.9, K.bone, 0.06, { ao: 0 });
  for (const s of [-1, 1]) signs.board.quad(REGION.pylon, new THREE.Vector3(s * 0.3, 8.3, zc), 3.4, 7.2, new THREE.Vector3(s, 0, 0));
  // Star on top (lit).
  signs.lit.quad2(REGION.pylonStar, new THREE.Vector3(0, 13.9, zc), 2.6, 2.6, new THREE.Vector3(1, 0, 0));
  signs.lit.quad2(REGION.pylonStar, new THREE.Vector3(0, 13.9, zc), 2.6, 2.6, new THREE.Vector3(0, 0, 1));
  // Planter tops with glowing overgrowth spilling down the base.
  for (let i = 0; i < 4; i++) kit.ball('foliage', (i % 2 ? 0.7 : -0.7), 3.3, z0 + 1 + i * 1.3, 0.6, 0.35, 0.7, K.sage, 1);
}

// ── Assembly ────────────────────────────────────────────────────────────────

export function buildProps(kit: DecorKit, signs: Signs, rng: () => number): void {
  // Cars (collision boxes in src/shared/maps/pastel.ts).
  for (const sz of [1, -1]) {
    const Z = (z: number): number => z * sz;
    // Bungalow station wagons in the carports (x ∓52, z 28..33.5).
    car(kit, -52, Z(30.75), 5.5, 2, 1.3, 0, { body: sz > 0 ? K.sand : K.mint, wood: true, kind: 'wagon', flat: 0.05 }, rng);
    car(kit, 52, Z(30.75), 5.5, 2, 1.3, 0, { body: sz > 0 ? K.terraF : K.bone, wood: sz > 0, kind: 'wagon' }, rng);
    // Parking lot: wagon (x −10..−8, z 21..25.5) + sedan (x 6..10.5, z 27..29).
    car(kit, -9, Z(23.25), 4.5, 2, 1.3, 0, { body: sz > 0 ? K.yellow : K.blue, wood: true, kind: 'wagon', flat: 0.08 }, rng);
    car(kit, 8.25, Z(28), 4.5, 2, 1.3, Math.PI / 2, { body: sz > 0 ? K.pink : K.sage, roof: K.bone, kind: 'sedan' }, rng);
    // Street: car at the east curb (x 41.5..43.5, z 19..23.5), camper at the west curb.
    car(kit, 42.5, Z(21.25), 4.5, 2, 1.3, 0, { body: sz > 0 ? K.mint : K.terraF, roof: K.bone, kind: 'sedan', flat: 0.1 }, rng);
    car(kit, 32.3, Z(10), 5, 2.2, 2.2, 0, { body: sz > 0 ? K.blue : K.yellow, roof: K.bone, kind: 'van' }, rng);
  }
  iceCreamVan(kit, signs, rng);
  pool(kit, rng);
  backyard(kit, signs, 1, rng, true);
  backyard(kit, signs, -1, rng, false);
  for (const sz of [1, -1]) {
    busShelter(kit, signs, sz);
    pylon(kit, signs, sz);
  }
  // Street lamps along the main street (sidewalks) and the parking lots.
  for (const z of [-44, -30, -16, 16, 30, 44]) {
    globeLamp(kit, 44.2, z);
    globeLamp(kit, 30.4, z + 5);
  }
  for (const sz of [1, -1]) {
    parkingLamp(kit, -13.5, 31 * sz);
    parkingLamp(kit, 13.5, 21 * sz);
  }
  // Mailboxes along the curb; the one at the south bungalow is stuffed with letters.
  for (const sz of [1, -1]) {
    mailbox(kit, 44.4, 27 * sz, Math.PI / 2, sz > 0 ? K.bone : K.mint, sz > 0);
    mailbox(kit, 44.4, 10.5 * sz, Math.PI / 2, K.terraF, false);
    mailbox(kit, -44.7, 26 * sz, -Math.PI / 2, K.blue, false);
  }
  signs.board.quad(REGION.mailLetters, new THREE.Vector3(44.9, 0.06, 27.2), 1.4, 0.18, new THREE.Vector3(0, 1, 0), undefined, 0.4);
  hydrant(kit, 44.3, 7.5);
  hydrant(kit, 30.6, -13.4);
  hydrant(kit, -14.2, 16.2);
  // Street signs at the intersection.
  kit.cyl('chrome', 30.4, 0, 6.9, 0.04, 0.04, 3.2, K.chrome, 6);
  signs.board.quad(REGION.street1, new THREE.Vector3(30.4, 3.05, 6.9), 1.6, 0.4, new THREE.Vector3(1, 0, 0));
  signs.board.quad(REGION.street2, new THREE.Vector3(30.4, 3.5, 6.9), 1.6, 0.4, new THREE.Vector3(0, 0, 1));
  // Dead traffic light over the intersection corner.
  kit.cyl('chrome', 44.3, 0, -7.2, 0.1, 0.12, 5.4, K.boneShade, 8);
  kit.box('chrome', 38, 5.2, -7.28, 44.3, 5.36, -7.12, K.boneShade, 0);
  kit.box('paint', 38.6, 4.15, -7.4, 39.1, 5.2, -7.0, K.mustard, 0.06, { ao: 0 });
  // Trees: along the bounds, in yards and on the sidewalk strips (no collision).
  const trees: [number, number, number, number][] = [
    [-52.5, 38, 7, 3.2],
    [-52.5, -38, 7.5, 3.4],
    [52.5, 38.5, 7, 3.0],
    [52.5, -38.5, 6.6, 3.2],
    [45.2, 13.5, 6.4, 2.8],
    [45.2, -13.5, 6.8, 2.8],
    [-46.5, 11.2, 6.2, 2.6],
    [-46.5, -11.2, 6.6, 2.8],
    [-31.2, 38.5, 6, 2.6],
    [-31.2, -38.5, 5.6, 2.5],
    [-53, 8.5, 6.5, 2.6],
    [-53, -8.5, 7, 2.8],
  ];
  for (const [x, z, h, r] of trees) tree(kit, x, z, h, r, rng);
  // Perimeter hedges + fence line along the bounds (visual; the bounds clamp).
  for (const sz of [1, -1]) {
    hedge(kit, -53.8, 53.6 * sz, -36, 53.6 * sz, 2.4, rng);
    hedge(kit, 30.5, 53.6 * sz, 53.8, 53.6 * sz, 2.2, rng);
  }
  for (const sx of [1, -1]) {
    hedge(kit, 53.7 * sx, -40, 53.7 * sx, -26, 2.3, rng);
    hedge(kit, 53.7 * sx, 26, 53.7 * sx, 40, 2.3, rng);
  }
  hedge(kit, -53.7, -12, -53.7, -4, 2.2, rng);
  hedge(kit, -53.7, 4, -53.7, 12, 2.2, rng);
  hedge(kit, 53.7, -14.5, 53.7, -6.5, 2.4, rng);
  hedge(kit, 53.7, 6.5, 53.7, 14.5, 2.4, rng);
  // Low chain-link fence (rails + posts) across the street ends behind the bulbs.
  for (const sz of [1, -1]) {
    for (let x = 30; x <= 46; x += 2) kit.cyl('chrome', x, 0, 53.9 * sz, 0.03, 0.03, 1.6, K.chrome, 5);
    kit.tube('chrome', new THREE.Vector3(30, 1.55, 53.9 * sz), new THREE.Vector3(46, 1.55, 53.9 * sz), 0.025, K.chrome, 4);
    kit.box('glass', 30, 0.05, 53.88 * sz - 0.01, 46, 1.55, 53.88 * sz + 0.01, rgb('#b9b6ae'), 0, { drift: 0 });
  }
}
