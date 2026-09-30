// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel houses & buildings.
//
//  • The four enterable two-storey modernist houses (W2/E2 and their mirrors):
//    fully drawn here over their 'hidden' collision — pastel stucco, a white
//    floor band, opaque ribbon + porthole windows (walls are solid, so windows
//    never lie about sightlines), sliding patio doors in the open end slots,
//    a floating stair, a cantilevered balcony with wind chimes and a flat roof
//    with upswept butterfly eaves.
//  • Detail passes on builder-drawn masses: bungalows + carports, garage rows,
//    the pool house, the two-storey corner house, spawn screen walls.
//  • Spawn-end set pieces outside the bounds: the Halcyon Heights community
//    chapel (south) and the Moonbeam Diner + Comet Gas forecourt (north).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV } from '../../../engine/palette';
import { type DecorKit, type RGB, mix, rgb } from './kit';
import { REGION, type SignBatch } from './signs';
import { climbingVine, drapedVine, hangingVine } from './vines';

const UP = 2.7;
const ROOF = 5.1;

const K = {
  bone: rgb(ENV.bone),
  boneShade: rgb(ENV.boneShade),
  plinth: rgb(ENV.concreteDark),
  terra: rgb(ENV.terracotta),
  terraF: rgb(ENV.terracottaFaded),
  sage: rgb(ENV.sage),
  olive: rgb(ENV.olive),
  wood: rgb('#b39a7f'),
  woodDark: rgb('#8a7560'),
  dark: rgb('#3a3634'),
  chrome: rgb('#c9c6bf'),
  glassTint: rgb('#6f7f8a'),
  mustard: rgb('#d9c28b'),
  shingle: rgb('#a6705a'),
};

export interface Face {
  axis: 'x' | 'z';
  /** Wall outer plane coordinate. */
  plane: number;
  /** Outward direction (+1/−1) along the plane's normal axis. */
  out: number;
}

function faceBox(kit: DecorKit, kind: Parameters<DecorKit['box']>[0], f: Face, a0: number, a1: number, y0: number, y1: number, d0: number, d1: number, col: RGB, r = 0, base = -Infinity): void {
  const p0 = f.plane + f.out * d0;
  const p1 = f.plane + f.out * d1;
  if (f.axis === 'x') kit.box(kind, a0, y0, Math.min(p0, p1), a1, y1, Math.max(p0, p1), col, r, { base, ao: 0.2 });
  else kit.box(kind, Math.min(p0, p1), y0, a0, Math.max(p0, p1), y1, a1, col, r, { base, ao: 0.2 });
}

/** Opaque window with frame, sill and optional shutters on a wall face. */
export function windowOn(kit: DecorKit, f: Face, a0: number, a1: number, y0: number, y1: number, rng: () => number, shutters?: RGB): void {
  faceBox(kit, 'paint', f, a0 - 0.1, a1 + 0.1, y0 - 0.1, y1 + 0.1, 0, 0.06, K.bone);
  faceBox(kit, 'window', f, a0, a1, y0, y1, 0.02, 0.07, mix(K.glassTint, rgb(ENV.skyBlue), 0.2 + rng() * 0.4));
  const mullions = Math.max(1, Math.round((a1 - a0) / 1.1));
  for (let i = 1; i < mullions; i++) {
    const a = a0 + ((a1 - a0) * i) / mullions;
    faceBox(kit, 'paint', f, a - 0.03, a + 0.03, y0, y1, 0.02, 0.09, K.bone);
  }
  faceBox(kit, 'concrete', f, a0 - 0.18, a1 + 0.18, y0 - 0.16, y0 - 0.06, 0, 0.14, K.boneShade);
  // Half-drawn blind inside (reads as "inside is dark", never see-through).
  if (rng() < 0.6) faceBox(kit, 'fabric', f, a0 + 0.02, a1 - 0.02, y1 - (y1 - y0) * (0.2 + rng() * 0.5), y1, 0.075, 0.08, mix(K.bone, K.terraF, rng() * 0.5));
  if (shutters) {
    const w = Math.min(0.6, (a1 - a0) * 0.35);
    faceBox(kit, 'wood', f, a0 - 0.12 - w, a0 - 0.12, y0, y1, 0, 0.05, shutters);
    faceBox(kit, 'wood', f, a1 + 0.12, a1 + 0.12 + w, y0, y1, 0, 0.05, shutters);
  }
}

/** Round porthole window. */
export function porthole(kit: DecorKit, f: Face, a: number, y: number, r: number): void {
  const n = f.axis === 'x' ? new THREE.Vector3(0, 0, f.out) : new THREE.Vector3(f.out, 0, 0);
  const pos = f.axis === 'x' ? new THREE.Vector3(a, y, f.plane) : new THREE.Vector3(f.plane, y, a);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  const ring = new THREE.TorusGeometry(r, 0.07, 6, kit.low ? 12 : 20);
  kit.geo('paint', ring, new THREE.Matrix4().compose(pos.clone().addScaledVector(n, 0.04), q, new THREE.Vector3(1, 1, 1)), K.bone, { drift: 0.03 });
  ring.dispose();
  const disc = new THREE.CircleGeometry(r * 0.96, kit.low ? 12 : 20);
  kit.geo('window', disc, new THREE.Matrix4().compose(pos.clone().addScaledVector(n, 0.03), q, new THREE.Vector3(1, 1, 1)), mix(K.glassTint, rgb(ENV.skyBlue), 0.5), { drift: 0 });
  disc.dispose();
}

// ── Enterable two-storey house (collision in src/shared/maps/pastel.ts) ─────

export interface HouseStyle {
  wall: RGB;
  accent: RGB;
  shutters: RGB;
}

/**
 * Draws W2 at its canonical placement (x −30..−17, z 16..27) mapped through
 * (sx, sz) mirroring: sx = −1 mirrors to E2, sz = −1 to the north half.
 */
export function twoStorey(kit: DecorKit, signs: { board: SignBatch; lit: SignBatch }, sx: number, sz: number, st: HouseStyle, rng: () => number, tv: boolean): void {
  const X = (x: number): number => x * sx;
  const Z = (z: number): number => z * sz;
  const bx = (kind: Parameters<DecorKit['box']>[0], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: RGB, r = 0, base = 0): void =>
    kit.box(kind, Math.min(X(x0), X(x1)), y0, Math.min(Z(z0), Z(z1)), Math.max(X(x0), X(x1)), y1, Math.max(Z(z0), Z(z1)), col, r, { base });
  const wallTop = ROOF - 0.2;
  // Long walls + end-wall segments (collision-exact).
  bx('plaster', -30, 0, 16, -17, wallTop, 16.4, st.wall, 0.03);
  bx('plaster', -30, 0, 26.6, -17, wallTop, 27, st.wall, 0.03);
  bx('plaster', -30, 0, 16.4, -29.6, wallTop, 20, st.wall, 0.03);
  bx('plaster', -30, 0, 23, -29.6, wallTop, 26.6, st.wall, 0.03);
  bx('plaster', -17.4, 0, 16.4, -17, wallTop, 20, st.wall, 0.03);
  bx('plaster', -17.4, 0, 23, -17, wallTop, 26.6, st.wall, 0.03);
  // Plinth + white floor band wrapping the house.
  bx('concrete', -30.04, 0, 15.96, -16.96, 0.4, 16.44, K.plinth, 0.02);
  bx('concrete', -30.04, 0, 26.56, -16.96, 0.4, 27.04, K.plinth, 0.02);
  bx('plaster', -30.06, UP - 0.35, 15.94, -16.94, UP + 0.05, 16.46, K.bone, 0.02, -Infinity);
  bx('plaster', -30.06, UP - 0.35, 26.54, -16.94, UP + 0.05, 27.06, K.bone, 0.02, -Infinity);
  // Roof slab (walkable, 5.1) + deep fascia + butterfly eaves on the long sides.
  bx('concrete', -30.3, wallTop, 15.7, -16.7, ROOF, 27.3, K.bone, 0.04, -Infinity);
  bx('plaster', -30.32, wallTop - 0.02, 15.68, -16.68, wallTop + 0.1, 27.32, st.accent, 0, -Infinity);
  for (const side of [1, -1]) {
    const zEdge = side > 0 ? 27.3 : 15.7;
    const a = new THREE.Vector3(X(-30.4), ROOF - 0.05, Z(zEdge));
    const b = new THREE.Vector3(X(-16.6), ROOF - 0.05, Z(zEdge));
    const c = new THREE.Vector3(X(-16.6), ROOF + 0.55, Z(zEdge + side * 1.3));
    const d = new THREE.Vector3(X(-30.4), ROOF + 0.55, Z(zEdge + side * 1.3));
    kit.quad('plaster', a, b, c, d, K.bone, { drift: 0.05 });
    kit.quad('plaster', a, d, c, b, K.boneShade, { drift: 0.05 });
    kit.tube('paint', c, d, 0.06, st.accent, 5);
  }
  // Upper floor + balcony slab (wood floor, bone edge) and its curb.
  bx('wood', -31.6, UP - 0.3, 16.4, -22, UP, 26.6, K.wood, 0.02, -Infinity);
  bx('plaster', -31.62, UP - 0.32, 16.4, -31.5, UP + 0.18, 26.6, K.bone, 0.02, -Infinity);
  // Floating stair over the ramp (x −17.8 → −22 rising, z 24.4..26.6).
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const xa = -17.8 - 4.2 * t0;
    const xb = -17.8 - 4.2 * t1;
    const y = UP * t1;
    bx('wood', xb, y - 0.12, 24.5, xa, y, 26.55, K.wood, 0.02, -Infinity);
  }
  // Stringer (white steel) under the treads.
  {
    const a = new THREE.Vector3(X(-17.9), 0.05, Z(24.45));
    const b = new THREE.Vector3(X(-22), UP - 0.2, Z(24.45));
    kit.tube('paint', a, b, 0.08, K.bone, 6);
  }
  // Patio doors: sliding frames in both end slots (ground floor), upper frames.
  for (const xEnd of [-29.8, -17.2]) {
    const f: Face = { axis: 'z', plane: X(xEnd), out: sx * (xEnd < -20 ? -1 : 1) };
    const za = Math.min(Z(20), Z(23));
    const zb = Math.max(Z(20), Z(23));
    faceBox(kit, 'chrome', f, za, za + 0.1, 0, UP - 0.3, -0.05, 0.05, K.chrome);
    faceBox(kit, 'chrome', f, zb - 0.1, zb, 0, UP - 0.3, -0.05, 0.05, K.chrome);
    faceBox(kit, 'chrome', f, za, zb, UP - 0.42, UP - 0.3, -0.05, 0.05, K.chrome);
    // One door panel pushed aside (open), one missing.
    faceBox(kit, 'chrome', f, za + 0.1, za + 1.2, 0.02, UP - 0.44, -0.12, -0.08, K.chrome);
    faceBox(kit, 'glass', f, za + 0.14, za + 1.16, 0.08, UP - 0.48, -0.105, -0.095, rgb('#cfe0e6'));
    // Upper opening: frame only (open to the balcony / double-height room).
    faceBox(kit, 'chrome', f, za, zb, wallTop - 0.14, wallTop, -0.05, 0.05, K.chrome);
    faceBox(kit, 'chrome', f, za, za + 0.08, UP, wallTop, -0.05, 0.05, K.chrome);
    faceBox(kit, 'chrome', f, zb - 0.08, zb, UP, wallTop, -0.05, 0.05, K.chrome);
  }
  // Windows on the long walls (opaque): ribbon at ground floor, portholes above.
  for (const [zPlane, out] of [
    [16, -1],
    [27, 1],
  ] as const) {
    const f: Face = { axis: 'x', plane: Z(zPlane), out: out * sz };
    const x0 = Math.min(X(-28.8), X(-24.2));
    const x1 = Math.max(X(-28.8), X(-24.2));
    windowOn(kit, f, x0, x1, 1.0, 2.0, rng);
    for (const px of [-20.5, -26.5]) porthole(kit, f, X(px), 3.85, 0.5);
    if (zPlane === 16) {
      const w0 = Math.min(X(-21.5), X(-18.3));
      const w1 = Math.max(X(-21.5), X(-18.3));
      windowOn(kit, f, w0, w1, 0.9, 2.1, rng, st.shutters);
    }
  }
  // Breeze-block relief panel on the street-facing long wall.
  {
    const f: Face = { axis: 'x', plane: Z(16), out: -sz };
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        const a = X(-23.5) + sx * (i * 0.42 - 0.1);
        faceBox(kit, 'concrete', f, Math.min(a, a + sx * 0.36), Math.max(a, a + sx * 0.36), 3.1 + j * 0.42, 3.46 + j * 0.42, 0, 0.08, K.bone);
      }
    }
  }
  // Interior: parquet floor, walnut wall paneling, a pendant lamp.
  bx('wood', -29.6, 0.005, 16.4, -17.4, 0.04, 26.6, mix(K.wood, K.terraF, 0.25), 0, -Infinity);
  for (const [z0, z1] of [
    [16.4, 16.46],
    [26.54, 26.6],
  ] as const) bx('wood', -29.6, 0, z0, -17.4, 1.25, z1, K.woodDark, 0, -Infinity);
  // Pale interior liners (bounce the sky fill so rooms stay readable).
  const liner = mix(K.bone, st.wall, 0.35);
  bx('plaster', -29.6, 1.45, 16.4, -17.4, wallTop - 0.02, 16.45, liner, 0, -Infinity);
  bx('plaster', -29.6, 1.45, 26.55, -17.4, wallTop - 0.02, 26.6, liner, 0, -Infinity);
  for (const xw of [-29.6, -17.4]) {
    const a = xw < -20 ? xw : xw - 0.05;
    bx('plaster', a, 0, 16.45, a + 0.05, wallTop - 0.02, 20, liner, 0, -Infinity);
    bx('plaster', a, 0, 23, a + 0.05, wallTop - 0.02, 26.55, liner, 0, -Infinity);
  }
  bx('plaster', -30, wallTop - 0.25, 16.4, -17, wallTop - 0.2, 26.6, K.bone, 0, -Infinity);
  bx('plaster', -31.5, UP - 0.34, 16.4, -22, UP - 0.3, 26.6, K.bone, 0, -Infinity);
  bx('plaster', -29.6, 1.25, 16.4, -17.4, 1.45, 16.47, K.mustard, 0, -Infinity);
  bx('plaster', -29.6, 1.25, 26.53, -22.2, 1.45, 26.6, K.mustard, 0, -Infinity);
  kit.tube('chrome', new THREE.Vector3(X(-19.6), ROOF - 0.2, Z(21.5)), new THREE.Vector3(X(-19.6), 3.3, Z(21.5)), 0.01, K.dark, 3);
  kit.ball('glow', X(-19.6), 3.1, Z(21.5), 0.34, 0.26, 0.34, rgb(ENV.glowGold, 0.9), 1, { drift: 0 });
  kit.cyl('paint', X(-19.6), 3.18, Z(21.5), 0.36, 0.1, 0.22, st.accent, 12);
  // Vines that crept in through the patio door.
  hangingVine(kit, new THREE.Vector3(X(-17.8), UP - 0.35, Z(22.6)), 1.6, rng, 1.4);
  climbingVine(kit, new THREE.Vector3(X(-17.45), 0, Z(23.4)), 2.2, new THREE.Vector3(-sx, 0, 0), rng, 1.3);
  bx('fabric', -21.8, 0, 16.45, -19.2, 0.45, 17.3, mix(st.accent, K.terraF, 0.4), 0.12);
  bx('fabric', -21.8, 0.45, 16.45, -19.2, 0.85, 16.75, mix(st.accent, K.terraF, 0.4), 0.1, -Infinity);
  bx('wood', -18.9, 0, 16.45, -17.6, 0.6, 16.95, K.woodDark, 0.03);
  if (tv) {
    // Console TV with a test card (lit).
    bx('wood', -18.8, 0.6, 16.5, -17.8, 1.4, 17.05, K.woodDark, 0.08, -Infinity);
    signs.lit.quad(REGION.tv, new THREE.Vector3(X(-18.3), 1.0, Z(17.08)), 0.72, 0.54, new THREE.Vector3(0, 0, sz));
  }
  // Shag rug + lamp.
  bx('fabric', -22, 0.01, 18.2, -18.5, 0.03, 21.5, K.mustard, 0);
  kit.cyl('chrome', X(-21.6), 0, Z(24), 0.02, 0.02, 1.5, K.chrome, 5);
  kit.ball('paint', X(-21.6), 1.6, Z(24), 0.28, 0.2, 0.28, K.bone, 1);
  // Kitchen counter along the north wall (under the upper floor).
  bx('wood', -29.5, 0, 26.0, -23.5, 0.9, 26.55, K.bone, 0.03);
  bx('concrete', -29.5, 0.9, 25.95, -23.5, 0.96, 26.58, K.terraF, 0.01, -Infinity);
  // Bedroom upstairs (bed against the south wall).
  bx('fabric', -29.2, UP, 16.45, -27.2, UP + 0.45, 18.6, K.bone, 0.1, UP);
  bx('fabric', -29.2, UP + 0.45, 16.45, -27.2, UP + 0.55, 17.2, K.terraF, 0.05, -Infinity);
  // Balcony: planters + wind chimes + hanging vines.
  for (const z of [17.2, 25.8]) {
    bx('concrete', -31.5, UP, z - 0.5, -30.9, UP + 0.45, z + 0.5, K.terraF, 0.05, UP);
    kit.ball('foliage', X(-31.2), UP + 0.65, Z(z), 0.45, 0.35, 0.55, K.sage, 1);
    hangingVine(kit, new THREE.Vector3(X(-31.55), UP - 0.1, Z(z - 0.3)), 1.4 + rng(), rng, 1.2);
  }
  chimes(kit, new THREE.Vector3(X(-31.2), UP + 1.9, Z(21.5)));
  // Ivy on the shaded wall + vines under the roof edge.
  climbingVine(kit, new THREE.Vector3(X(-17), 0, Z(25.6)), 3.9, new THREE.Vector3(sx, 0, 0), rng, 0.8);
  for (let i = 0; i < 4; i++) hangingVine(kit, new THREE.Vector3(X(-29 + i * 3.4), wallTop - 0.05, Z(27.35)), 0.8 + rng() * 1.4, rng, 1);
}

/** Wind chimes: little chrome tubes hanging from a disc (sway via 'stem'?? — static, cheap). */
function chimes(kit: DecorKit, top: THREE.Vector3): void {
  kit.cyl('wood', top.x, top.y - 0.04, top.z, 0.12, 0.12, 0.04, K.wood, 10);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const x = top.x + Math.cos(a) * 0.08;
    const z = top.z + Math.sin(a) * 0.08;
    kit.tube('chrome', new THREE.Vector3(x, top.y - 0.1, z), new THREE.Vector3(x, top.y - 0.35 - i * 0.05, z), 0.012, K.chrome, 5);
  }
  kit.tube('chrome', new THREE.Vector3(top.x, top.y, top.z), new THREE.Vector3(top.x, top.y + 0.3, top.z), 0.005, K.dark, 3);
}

// ── Bungalows with carports (builder draws the masses) ──────────────────────

export function bungalow(kit: DecorKit, sx: number, sz: number, rng: () => number): void {
  const X = (x: number): number => x * sx;
  const Z = (z: number): number => z * sz;
  // Mass: x −54..−45, z 15..25 (roof 2.95). Yard-facing wall at x = −45.
  const yard: Face = { axis: 'z', plane: X(-45), out: sx };
  const za = Math.min(Z(16.2), Z(19.6));
  const zb = Math.max(Z(16.2), Z(19.6));
  windowOn(kit, yard, za, zb, 0.9, 2.1, rng, K.terraF);
  // Door + porch light + step.
  const d0 = Math.min(Z(21), Z(22.2));
  const d1 = Math.max(Z(21), Z(22.2));
  faceBox(kit, 'paint', yard, d0 - 0.1, d1 + 0.1, 0, 2.2, 0, 0.06, K.bone);
  faceBox(kit, 'wood', yard, d0, d1, 0, 2.1, 0.02, 0.08, K.terra);
  faceBox(kit, 'concrete', yard, d0 - 0.5, d1 + 0.5, 0, 0.18, 0, 0.7, K.boneShade, 0.02, 0);
  faceBox(kit, 'glow', yard, d1 + 0.25, d1 + 0.45, 2.0, 2.25, 0.02, 0.14, rgb('#ffe3a1', 1.5));
  porthole(kit, yard, Z(23.8), 1.6, 0.45);
  // Street-facing wall (z = 15 side) with a window.
  const front: Face = { axis: 'x', plane: Z(15), out: -sz };
  windowOn(kit, front, Math.min(X(-52.5), X(-48.5)), Math.max(X(-52.5), X(-48.5)), 0.9, 2.1, rng, K.sage);
  // Carport posts (slab collision x −54..−46, z 25..31 at 2.3–2.55).
  for (const [px, pz] of [
    [-46.2, 25.2],
    [-46.2, 30.8],
    [-53.8, 30.8],
  ] as const) kit.box('chrome', X(px) - 0.07, 0, Z(pz) - 0.07, X(px) + 0.07, 2.3, Z(pz) + 0.07, K.bone, 0.02);
  kit.box('plaster', Math.min(X(-54), X(-46)) - 0.03, 2.28, Math.min(Z(31), Z(31.1)), Math.max(X(-54), X(-46)) + 0.03, 2.6, Math.max(Z(31), Z(31.1)), K.terra, 0, { ao: 0 });
  for (let i = 0; i < 3; i++) hangingVine(kit, new THREE.Vector3(X(-47 - i * 2.6), 2.28, Z(31.05)), 0.9 + rng() * 0.8, rng, 1.2);
  climbingVine(kit, new THREE.Vector3(X(-46.2), 0, Z(30.9)), 2.3, new THREE.Vector3(0, 0, sz), rng, 1);
  // TV antenna on the roof.
  kit.tube('chrome', new THREE.Vector3(X(-50), 2.95, Z(18)), new THREE.Vector3(X(-50), 5.2, Z(18)), 0.03, K.dark, 4);
  for (let i = 0; i < 4; i++) kit.tube('chrome', new THREE.Vector3(X(-50) - 0.8 + i * 0.1, 4.6 + i * 0.15, Z(18)), new THREE.Vector3(X(-50) + 0.8 - i * 0.1, 4.6 + i * 0.15, Z(18)), 0.012, K.dark, 3);
}

// ── Garage rows (builder masses x ±15..±30, z ±12..±15.6, 5 m) ─────────────

export function garageRow(kit: DecorKit, signs: { board: SignBatch; lit: SignBatch }, sx: number, sz: number, rng: () => number): void {
  const X = (x: number): number => x * sx;
  const Z = (z: number): number => z * sz;
  const f: Face = { axis: 'x', plane: Z(12), out: -sz };
  // Three roll-up doors, weathered.
  for (let i = 0; i < 3; i++) {
    const a = X(-28.6 + i * 4.3);
    const b = X(-25.4 + i * 4.3);
    const a0 = Math.min(a, b);
    const a1 = Math.max(a, b);
    faceBox(kit, 'paint', f, a0 - 0.12, a1 + 0.12, 0, 2.55, 0, 0.05, K.bone);
    const open = rng() < 0.35;
    faceBox(kit, 'corrugated', f, a0, a1, open ? 1.4 : 0.02, 2.45, 0.01, 0.06, mix(K.boneShade, K.terraF, rng() * 0.6));
    if (open) faceBox(kit, 'window', f, a0, a1, 0.02, 1.4, -0.02, 0.0, K.dark);
  }
  // Apartment windows above + a shop sign band.
  for (let i = 0; i < 3; i++) {
    const a = X(-28.2 + i * 4.3);
    const b = X(-25.8 + i * 4.3);
    windowOn(kit, f, Math.min(a, b), Math.max(a, b), 3.3, 4.3, rng);
  }
  const signMid = new THREE.Vector3(X(-22.5), 2.95, Z(12) - sz * 0.08);
  faceBox(kit, 'paint', f, Math.min(X(-26), X(-19)), Math.max(X(-26), X(-19)), 2.62, 3.1, 0, 0.06, K.bone);
  signs.board.quad(sx > 0 ? REGION.laundro : REGION.repair, signMid.setY(2.86), 6.6, 0.44, new THREE.Vector3(0, 0, -sz));
  // Ivy + hanging vines along the gutter (shaded face when facing north).
  for (let i = 0; i < 5; i++) hangingVine(kit, new THREE.Vector3(X(-29 + i * 3.2), 4.75, Z(11.8)), 0.8 + rng() * 1.8, rng, 1.1);
  climbingVine(kit, new THREE.Vector3(X(-16), 0, Z(11.95)), 4.6, new THREE.Vector3(0, 0, -sz), rng, 0.9);
}

// ── Pool house, corner house, spawn walls ─────────────────────────────────

export function poolHouse(kit: DecorKit, rng: () => number): void {
  // Mass x −54..−47.5, z ±3.5, 4.4 m. Butterfly roof wings + louvered front.
  const f: Face = { axis: 'z', plane: -47.5, out: 1 };
  faceBox(kit, 'wood', f, -2.6, 2.6, 0.3, 2.6, 0, 0.08, K.wood);
  for (let i = 0; i < 9; i++) faceBox(kit, 'wood', f, -2.5, 2.5, 0.45 + i * 0.24, 0.55 + i * 0.24, 0.08, 0.14, K.woodDark);
  signs_poolClock(kit, f);
  for (const side of [1, -1]) {
    const a = new THREE.Vector3(-54.3, 4.35, side * 0.2);
    const b = new THREE.Vector3(-47.2, 4.35, side * 0.2);
    const c = new THREE.Vector3(-47.2, 5.2, side * 4.1);
    const d = new THREE.Vector3(-54.3, 5.2, side * 4.1);
    kit.quad('plaster', a, b, c, d, K.bone, { drift: 0.05 });
    kit.quad('plaster', a, d, c, b, K.boneShade, { drift: 0.05 });
  }
  climbingVine(kit, new THREE.Vector3(-47.45, 0, 2.9), 3.8, new THREE.Vector3(1, 0, 0), rng, 1.2);
  climbingVine(kit, new THREE.Vector3(-47.45, 0, -2.9), 3.2, new THREE.Vector3(1, 0, 0), rng, 1.2);
}

function signs_poolClock(kit: DecorKit, f: Face): void {
  // Big 70s starburst clock over the louvers.
  const c = new THREE.Vector3(f.plane + 0.12, 3.4, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    kit.boxE('chrome', c.clone().add(new THREE.Vector3(0, Math.sin(a) * 0.45, Math.cos(a) * 0.45)), new THREE.Euler(a, 0, 0), new THREE.Vector3(0.03, 0.04, 0.4), K.mustard);
  }
  kit.ball('paint', c.x, c.y, c.z, 0.06, 0.2, 0.2, K.bone, 1);
}

export function cornerHouse(kit: DecorKit, rng: () => number): void {
  // Mass x 44..54, z ±6, 5.5 m. Porch facing the street (x = 44), radio on the rail.
  const f: Face = { axis: 'z', plane: 44, out: -1 };
  windowOn(kit, f, -4.8, -1.8, 0.9, 2.2, rng, K.sage);
  windowOn(kit, f, 1.8, 4.8, 0.9, 2.2, rng, K.sage);
  windowOn(kit, f, -4.5, -1.5, 3.3, 4.6, rng);
  porthole(kit, f, 3.0, 4.0, 0.55);
  faceBox(kit, 'paint', f, -0.8, 0.8, 0, 2.3, 0, 0.06, K.bone);
  faceBox(kit, 'wood', f, -0.65, 0.65, 0, 2.2, 0.02, 0.08, K.terra);
  // Porch roof: intact at the north end, torn down where the van ploughed in
  // (the heap itself is drawn with the wreck in props.ts).
  kit.box('wood', 42.6, 2.55, -5.6, 44, 2.72, -1.25, K.wood, 0.02, { ao: 0 });
  kit.boxE('wood', new THREE.Vector3(43.2, 0.16, 2.8), new THREE.Euler(0.08, 0.2, 0.06), new THREE.Vector3(1.4, 0.12, 2.6), K.wood);
  for (const z of [-5.4, -2.5]) kit.box('wood', 42.7, 0, z - 0.08, 42.86, 2.55, z + 0.08, K.bone, 0.02);
  // Porch rail + the radio (still playing).
  kit.box('wood', 42.7, 0.85, -5.5, 42.86, 0.95, -1.2, K.bone, 0.02, { ao: 0 });
  kit.box('paint', 42.66, 0.95, -3.6, 42.96, 1.2, -3.0, K.terraF, 0.04, { ao: 0 });
  kit.box('chrome', 42.64, 1.0, -3.55, 42.66, 1.15, -3.05, K.chrome, 0, { ao: 0 });
  kit.tube('chrome', new THREE.Vector3(42.8, 1.2, -3.1), new THREE.Vector3(42.7, 1.65, -2.9), 0.006, K.chrome, 3);
  kit.box('glow', 42.63, 1.05, -3.25, 42.65, 1.1, -3.12, rgb('#ffe3a1', 1.6), 0, { ao: 0 });
  // Rocking chair + climbing ivy.
  kit.box('wood', 43.1, 0.4, -2.75, 43.6, 0.46, -2.2, K.woodDark, 0.02);
  kit.box('wood', 43.5, 0.46, -2.75, 43.56, 1.1, -2.2, K.woodDark, 0.02);
  climbingVine(kit, new THREE.Vector3(44, 0, 5.4), 5.2, new THREE.Vector3(-1, 0, 0), rng, 1);
  for (let i = 0; i < 3; i++) hangingVine(kit, new THREE.Vector3(42.7, 2.55, -5 + i * 2.2), 0.7 + rng() * 0.9, rng, 1);
}

/** Breeze-block pattern (atlas tiles on both faces) + coping on a screen wall. */
export function screenWall(kit: DecorKit, signs: { board: SignBatch; lit: SignBatch }, x0: number, x1: number, z0: number, z1: number, h: number, pattern: boolean): void {
  kit.box('concrete', x0 - 0.06, h, z0 - 0.06, x1 + 0.06, h + 0.12, z1 + 0.06, K.terraF, 0.02, { ao: 0 });
  if (!pattern) return;
  // Real breeze-block scale: one atlas tile = 3 × 3 blocks of ~0.4 m.
  const rows = Math.max(1, Math.round((h - 0.3) / 1.2));
  const th = (h - 0.3) / rows;
  const n = Math.max(1, Math.round((x1 - x0) / 1.2));
  const tw = (x1 - x0) / n;
  for (let r = 0; r < rows; r++) {
    const cy = 0.15 + th * (r + 0.5);
    for (let i = 0; i < n; i++) {
      const cx = x0 + tw * (i + 0.5);
      signs.board.quad(REGION.breeze, new THREE.Vector3(cx, cy, z0 - 0.012), tw, th, new THREE.Vector3(0, 0, -1));
      signs.board.quad(REGION.breeze, new THREE.Vector3(cx, cy, z1 + 0.012), tw, th, new THREE.Vector3(0, 0, 1));
    }
  }
}

/**
 * The long spawn screen wall (x ±26 at z ±40..40.4, 3.2 m): the spawn side
 * carries a painted mural (Halcyon Heights / Moonbeam) lit by little flood
 * lamps and flanked by breeze-block relief; the lot side gets breeze panels and
 * overgrowth along the coping. sz = +1 Halcyon (south), −1 Bloom (north).
 */
export function spawnWall(kit: DecorKit, signs: { board: SignBatch; lit: SignBatch }, sz: number, rng: () => number): void {
  const zIn = 40.4 * sz + 0.012 * sz; // spawn-facing face
  const zOut = 40 * sz - 0.012 * sz; // lot-facing face
  const nIn = new THREE.Vector3(0, 0, sz);
  const nOut = new THREE.Vector3(0, 0, -sz);
  const mw = 23.4;
  const mh = 2.7;
  signs.board.quad(sz > 0 ? REGION.muralH : REGION.muralB, new THREE.Vector3(0, 0.3 + mh / 2, zIn), mw, mh, nIn);
  // Mural plinth + flood lamps on slim arms over the coping.
  kit.box('concrete', -mw / 2 - 0.3, 0, Math.min(zIn, zIn + 0.3 * sz), mw / 2 + 0.3, 0.26, Math.max(zIn, zIn + 0.3 * sz), K.terraF, 0.03, { ao: 0.2 });
  for (const x of [-9, -3, 3, 9]) {
    const a = new THREE.Vector3(x, 3.3, 40.2 * sz);
    const b = new THREE.Vector3(x, 3.55, 41.2 * sz);
    kit.tube('chrome', a, b, 0.03, K.dark, 4);
    kit.cyl('chrome', x, 3.35, 41.25 * sz, 0.16, 0.1, 0.22, K.chrome, 8);
    kit.ball('glow', x, 3.33, 41.25 * sz, 0.12, 0.05, 0.12, rgb(ENV.glowGold, 1.4), 0, { drift: 0 });
  }
  // Breeze-block relief flanking the mural (spawn side) and across the lot side.
  const rows = 2;
  const th = (3.2 - 0.3) / rows;
  const panel = (x0: number, x1: number, z: number, n: THREE.Vector3): void => {
    const cols = Math.max(1, Math.round((x1 - x0) / 1.2));
    const tw = (x1 - x0) / cols;
    for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++) signs.board.quad(REGION.breeze, new THREE.Vector3(x0 + tw * (i + 0.5), 0.15 + th * (r + 0.5), z), tw, th, n);
  };
  panel(-25.6, -12.4, zIn, nIn);
  panel(12.4, 25.6, zIn, nIn);
  panel(-9.6, 9.6, zOut, nOut);
  // Overgrowth over the coping (heavier on the Bloom side).
  const strands = sz > 0 ? 9 : 16;
  for (let i = 0; i < strands; i++) {
    const x = -25 + rng() * 50;
    const side = rng() < 0.5 ? 1 : -1;
    hangingVine(kit, new THREE.Vector3(x, 3.3, (40.2 + side * 0.28) * sz), 0.6 + rng() * (sz > 0 ? 1.2 : 2.2), rng, 1.3);
  }
  climbingVine(kit, new THREE.Vector3(-25.6, 0, zIn), 3.1, nIn, rng, 1.2);
  climbingVine(kit, new THREE.Vector3(25.4, 0, zIn), 2.6, nIn, rng, 1.2);
  if (sz < 0) {
    climbingVine(kit, new THREE.Vector3(-13.2, 0, zIn), 3.0, nIn, rng, 1.5);
    climbingVine(kit, new THREE.Vector3(11.8, 0, zIn), 2.4, nIn, rng, 1.5);
    drapedVine(kit, new THREE.Vector3(4, 3.25, zIn), new THREE.Vector3(18, 3.25, zIn), 0.5, rng, 5);
  }
}

// ── Spawn-end set pieces (outside the bounds) ──────────────────────────────

export function chapel(kit: DecorKit, signs: { board: SignBatch; lit: SignBatch }, rng: () => number): void {
  const z0 = 57;
  // A-frame nave: two sloped roof planes to the ground-ish, glass gable.
  const w = 11;
  const len = 16;
  const peak = 14;
  const eave = 1.2;
  for (const side of [-1, 1]) {
    const a = new THREE.Vector3(side * w, eave, z0);
    const b = new THREE.Vector3(0, peak, z0);
    const c = new THREE.Vector3(0, peak, z0 + len);
    const d = new THREE.Vector3(side * w, eave, z0 + len);
    if (side > 0) {
      kit.quad('wood', a, d, c, b, K.shingle, { drift: 0.15 });
      kit.quad('wood', a, b, c, d, K.woodDark, { drift: 0.1 });
    } else {
      kit.quad('wood', a, b, c, d, K.shingle, { drift: 0.15 });
      kit.quad('wood', a, d, c, b, K.woodDark, { drift: 0.1 });
    }
    kit.box('concrete', side * w - 0.4, 0, z0, side * w + 0.4, eave, z0 + len, K.boneShade, 0.05, { base: 0 });
  }
  // Glass gable facing the map with warm stained panes (lit).
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const y0 = eave + ((peak - eave) * r) / rows;
    const y1 = eave + ((peak - eave) * (r + 1)) / rows;
    const hw0 = w * (1 - (y0 - eave) / (peak - eave));
    const hw1 = w * (1 - (y1 - eave) / (peak - eave));
    const cols = Math.max(1, Math.round(hw0 / 1.4));
    for (let c = 0; c < cols * 2; c++) {
      const xa = -hw0 + (2 * hw0 * c) / (cols * 2);
      const xb = -hw0 + (2 * hw0 * (c + 1)) / (cols * 2);
      const xa1 = -hw1 + (2 * hw1 * c) / (cols * 2);
      const xb1 = -hw1 + (2 * hw1 * (c + 1)) / (cols * 2);
      const tint = [ENV.glowGold, ENV.pastelYellow, ENV.terracottaFaded, ENV.pastelPink][Math.floor(rng() * 4)];
      // Wound to face −Z: the lit gable looks back over the Halcyon lot.
      kit.quad('glow', new THREE.Vector3(xa + 0.06, y0 + 0.06, z0 + 0.3), new THREE.Vector3(xa1 + 0.06, y1 - 0.06, z0 + 0.3), new THREE.Vector3(xb1 - 0.06, y1 - 0.06, z0 + 0.3), new THREE.Vector3(xb - 0.06, y0 + 0.06, z0 + 0.3), rgb(tint, 0.55 + rng() * 0.25), { drift: 0 });
    }
  }
  kit.box('paint', -0.12, eave, z0 + 0.2, 0.12, peak, z0 + 0.4, K.bone, 0);
  // Bell tower: open concrete frame with a bell and a thin cross-less star finial.
  const tx = 14;
  const tz = z0 + 3;
  for (const [ox, oz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) kit.box('concrete', tx + ox * 1.2 - 0.25, 0, tz + oz * 1.2 - 0.25, tx + ox * 1.2 + 0.25, 17, tz + oz * 1.2 + 0.25, K.bone, 0.06, { base: 0 });
  for (const y of [6, 11.5, 17]) kit.box('concrete', tx - 1.5, y, tz - 1.5, tx + 1.5, y + 0.4, tz + 1.5, K.bone, 0.06, { ao: 0 });
  kit.cyl('metal', tx, 13.2, tz, 0.45, 0.8, 1.2, K.mustard, 14);
  kit.tube('chrome', new THREE.Vector3(tx, 17.4, tz), new THREE.Vector3(tx, 19.5, tz), 0.06, K.bone, 6);
  kit.ball('glow', tx, 19.7, tz, 0.3, 0.3, 0.3, rgb(ENV.glowGold, 1.6), 1);
  // Chapel sign on the screen wall (faces the parking lot, north) + low planters.
  signs.board.quad(REGION.chapel, new THREE.Vector3(-14, 1.9, 39.94), 4.4, 1.1, new THREE.Vector3(0, 0, -1));
  signs.board.quad(REGION.poster1, new THREE.Vector3(14, 1.6, 39.94), 1.2, 1.8, new THREE.Vector3(0, 0, -1));
  // Flagpole with a bone/terracotta pennant (static; just outside the bounds).
  const fz = 55.4;
  kit.tube('chrome', new THREE.Vector3(-20, 0, fz), new THREE.Vector3(-20, 9, fz), 0.06, K.chrome, 6);
  const fa = new THREE.Vector3(-20, 8.8, fz);
  const fb = new THREE.Vector3(-17.6, 8.5, fz - 0.2);
  const fc = new THREE.Vector3(-17.6, 7.7, fz - 0.2);
  const fd = new THREE.Vector3(-20, 7.4, fz);
  kit.quad('fabric', fa, fb, fc, fd, K.terraF, { drift: 0.1 });
  kit.quad('fabric', fa, fd, fc, fb, K.terraF, { drift: 0.1 });
  // Letter-board marquee at the chapel gate, facing the lot.
  for (const x of [-9.9, -6.1]) kit.box('concrete', x - 0.12, 0, 55.3, x + 0.12, 2.35, 55.54, K.bone, 0.03, { base: 0 });
  kit.box('plaster', -10.2, 1.25, 55.36, -5.8, 2.4, 55.48, K.terraF, 0.03, { ao: 0 });
  signs.board.quad(REGION.marquee, new THREE.Vector3(-8, 1.82, 55.34), 4.0, 1.0, new THREE.Vector3(0, 0, -1));
  // The chapel's cream mini-bus, parked for good beyond the lot.
  const bx0 = 17.5;
  const bx1 = 27.5;
  kit.box('paint', bx0, 0.45, 55.8, bx1, 3.0, 58.2, K.bone, 0.3, { base: 0 });
  kit.box('paint', bx0 - 0.01, 0.45, 55.79, bx1 + 0.01, 1.05, 58.21, K.terraF, 0.2, { base: 0 });
  kit.box('window', bx0 + 0.6, 1.6, 55.77, bx1 - 1.9, 2.45, 58.23, mix(K.glassTint, K.dark, 0.3), 0.03, { ao: 0 });
  kit.box('window', bx0 - 0.03, 1.5, 56.2, bx0 + 0.1, 2.5, 57.8, mix(K.glassTint, K.dark, 0.3), 0.03, { ao: 0 });
  signs.board.quad(REGION.chapel, new THREE.Vector3(23, 1.25, 55.77), 3.2, 0.8, new THREE.Vector3(0, 0, -1));
  for (const x of [bx0 + 1.7, bx1 - 1.9]) {
    const g = new THREE.CylinderGeometry(0.45, 0.45, 2.5, 12);
    g.rotateX(Math.PI / 2);
    kit.geo('paint', g, new THREE.Matrix4().makeTranslation(x, 0.42, 57), rgb('#2f2c2a'), { drift: 0.05 });
    g.dispose();
  }
  drapedVine(kit, new THREE.Vector3(bx0 + 1, 3.0, 55.8), new THREE.Vector3(bx1 - 2, 3.0, 55.8), -0.05, rng, 3);
  // Chalk hopscotch + a kid's wagon left in the lot.
  const chalk = mix(K.bone, rgb(ENV.pastelPink), 0.3);
  for (const [cx, cz] of [
    [-22, 47],
    [-22, 47.9],
    [-22.45, 48.8],
    [-21.55, 48.8],
    [-22, 49.7],
    [-22.45, 50.6],
    [-21.55, 50.6],
  ] as const) {
    kit.box('paint', cx - 0.42, 0.045, cz - 0.42, cx + 0.42, 0.05, cz - 0.36, chalk, 0, { ao: 0, drift: 0.3 });
    kit.box('paint', cx - 0.42, 0.045, cz + 0.36, cx + 0.42, 0.05, cz + 0.42, chalk, 0, { ao: 0, drift: 0.3 });
    kit.box('paint', cx - 0.42, 0.045, cz - 0.42, cx - 0.36, 0.05, cz + 0.42, chalk, 0, { ao: 0, drift: 0.3 });
    kit.box('paint', cx + 0.36, 0.045, cz - 0.42, cx + 0.42, 0.05, cz + 0.42, chalk, 0, { ao: 0, drift: 0.3 });
  }
  kit.boxR('paint', -27.6, 0.3, 51.8, 0.55, 0.22, 0.95, 0.5, K.terra, 0.04);
  kit.tube('chrome', new THREE.Vector3(-27.4, 0.3, 51.3), new THREE.Vector3(-26.9, 0.55, 50.6), 0.02, K.dark, 4);
}

export function dinerAndGas(kit: DecorKit, signs: { board: SignBatch; lit: SignBatch }, rng: () => number): void {
  // Diner (streamline box with rounded ends) at x −20..−4, z −68..−58.
  const x0 = -20;
  const x1 = -4;
  const zf = -57.5;
  kit.box('plaster', x0, 0, zf - 9, x1, 4.2, zf, rgb(ENV.pastelMint), 0.5, { base: 0 });
  kit.box('chrome', x0 - 0.05, 0.9, zf - 0.08, x1 + 0.05, 1.05, zf + 0.06, K.chrome, 0.02, { ao: 0 });
  kit.box('chrome', x0 - 0.05, 3.3, zf - 0.08, x1 + 0.05, 3.45, zf + 0.06, K.chrome, 0.02, { ao: 0 });
  for (let i = 0; i < 7; i++) {
    const x = x0 + 1.2 + i * 2.1;
    kit.box('glow', x, 1.3, zf + 0.02, x + 1.6, 2.9, zf + 0.05, rgb(ENV.glowGold, 0.55 + rng() * 0.2), 0, { ao: 0, drift: 0 });
  }
  kit.box('concrete', x0 - 0.5, 4.2, zf - 9.5, x1 + 0.5, 4.5, zf + 0.6, K.bone, 0.08, { ao: 0 });
  // Boomerang sign on a pylon.
  kit.box('chrome', -2.5, 0, zf + 1.2, -2.1, 8, zf + 1.6, K.bone, 0.05, { base: 0 });
  signs.lit.quad(REGION.diner, new THREE.Vector3(-2.3, 8.6, zf + 1.4), 5.2, 1.95, new THREE.Vector3(0, 0, 1));
  signs.lit.quad(REGION.openNeon, new THREE.Vector3(-12, 2.4, zf + 0.09), 1.2, 0.6, new THREE.Vector3(0, 0, 1));
  // Gas forecourt: wing canopy on two tapered legs + pumps + price sign.
  const cx = 16;
  const cz = -60;
  const wing = new THREE.Shape();
  wing.moveTo(-9, -3);
  wing.lineTo(9, -4.5);
  wing.lineTo(9, 4.5);
  wing.lineTo(-9, 3);
  wing.closePath();
  const wg = new THREE.ExtrudeGeometry(wing, { depth: 0.5, bevelEnabled: true, bevelSize: 0.15, bevelThickness: 0.1, bevelSegments: 1 });
  wg.rotateX(Math.PI / 2);
  kit.geo('paint', wg, new THREE.Matrix4().makeTranslation(cx, 5.6, cz).multiply(new THREE.Matrix4().makeRotationZ(0.05)), K.bone, { drift: 0.05 });
  wg.dispose();
  kit.box('plaster', cx - 9.1, 5.0, cz - 4.6, cx + 9.1, 5.12, cz + 4.6, K.terra, 0, { ao: 0 });
  for (const lx of [-4, 4]) kit.cyl('concrete', cx + lx, 0, cz, 0.3, 0.6, 5.1, K.bone, 12);
  for (const px of [-6, -2, 2, 6]) {
    kit.box('paint', cx + px - 0.4, 0, cz - 0.3, cx + px + 0.4, 1.6, cz + 0.3, mix(K.bone, K.terraF, 0.3), 0.08, { base: 0 });
    kit.box('window', cx + px - 0.3, 1.0, cz + 0.29, cx + px + 0.3, 1.4, cz + 0.31, K.dark, 0);
    hangingVine(kit, new THREE.Vector3(cx + px, 5.05, cz + 2), 1.5 + rng() * 2, rng, 1.2);
  }
  kit.box('chrome', 28.5, 0, -57.4, 28.9, 7.5, -57, K.bone, 0.04, { base: 0 });
  signs.board.quad(REGION.gas, new THREE.Vector3(28.7, 8.4, -56.9), 4.6, 1.45, new THREE.Vector3(0, 0, 1));
  signs.board.quad(REGION.gasPrice, new THREE.Vector3(28.7, 6.2, -56.9), 1.8, 1.8, new THREE.Vector3(0, 0, 1));
  // Diner-side screen wall signage (faces the parking lot, south).
  signs.board.quad(REGION.poster2, new THREE.Vector3(-14, 1.6, -39.94), 1.2, 1.8, new THREE.Vector3(0, 0, 1));
  signs.board.quad(REGION.watch, new THREE.Vector3(14, 1.7, -39.94), 1.1, 0.85, new THREE.Vector3(0, 0, 1));
  drapedVine(kit, new THREE.Vector3(-26, 3.1, -40.3), new THREE.Vector3(-9, 3.1, -40.3), 0.4, rng, 4);
  // Beyond the diner lot: an abandoned pickup with a camper shell, swallowed
  // by glowing vines, and a tipped dumpster.
  const px0 = -31;
  const px1 = -25.8;
  kit.box('paint', px0, 0.4, -57.4, px1, 1.25, -55.3, rgb(ENV.sage), 0.18, { base: 0 });
  kit.box('paint', px1 - 1.7, 1.25, -57.3, px1 - 0.1, 2.05, -55.4, rgb(ENV.sage), 0.14, { base: 0 });
  kit.box('window', px1 - 1.6, 1.4, -57.33, px1 - 0.3, 1.95, -55.37, mix(K.glassTint, K.dark, 0.4), 0.03, { ao: 0 });
  kit.box('paint', px0 + 0.1, 1.25, -57.3, px1 - 1.9, 2.3, -55.4, K.bone, 0.2, { base: 0 });
  for (const x of [px0 + 1, px1 - 1]) {
    const g = new THREE.CylinderGeometry(0.4, 0.4, 2.2, 12);
    g.rotateX(Math.PI / 2);
    kit.geo('paint', g, new THREE.Matrix4().makeTranslation(x, 0.36, -56.35), rgb('#2f2c2a'), { drift: 0.05 });
    g.dispose();
  }
  climbingVine(kit, new THREE.Vector3(px0 + 1.5, 0, -55.25), 2.2, new THREE.Vector3(0, 0, 1), rng, 1.6);
  drapedVine(kit, new THREE.Vector3(px0 + 0.2, 2.3, -55.3), new THREE.Vector3(px1 - 2, 2.3, -55.3), 0.3, rng, 4);
  kit.boxE('metal', new THREE.Vector3(4.5, 0.8, -56.2), new THREE.Euler(0, 0.35, Math.PI / 2 - 0.12), new THREE.Vector3(1.6, 2.2, 1.5), mix(rgb(ENV.sage), K.dark, 0.35), 0.06);
  for (let i = 0; i < 6; i++) kit.boxR('paint', 2.5 + rng() * 4, 0.06, -55.2 + rng() * 1.1, 0.3 + rng() * 0.3, 0.1, 0.25, rng() * Math.PI, mix(K.bone, K.terraF, rng()), 0);
  // Moss creeping out of the wall's shade across the lot (the Bloom's side):
  // dark sage cushions pricked with tiny glowing buds.
  for (let i = 0; i < Math.round(22 * kit.detail); i++) {
    const x = -34 + rng() * 62;
    const z = -41.2 - rng() * rng() * 11;
    const r = 0.3 + rng() * 0.5;
    const pad = new THREE.CircleGeometry(1, kit.low ? 9 : 14);
    pad.rotateX(-Math.PI / 2);
    kit.geo('foliage', pad, new THREE.Matrix4().makeTranslation(x, 0.045, z).multiply(new THREE.Matrix4().makeScale(r * 1.4, 1, r)), mix(rgb(ENV.olive), rgb(ENV.sage), rng() * 0.5), { drift: 0.25 });
    pad.dispose();
    for (let b = 0; b < 3 + Math.floor(rng() * 3); b++) {
      kit.ball('glow', x + (rng() - 0.5) * r * 2, 0.07, z + (rng() - 0.5) * r * 1.4, 0.035, 0.035, 0.035, rgb(rng() < 0.7 ? ENV.glowChartreuse : ENV.glowGold, 1.6), 0, { drift: 0 });
    }
  }
}
