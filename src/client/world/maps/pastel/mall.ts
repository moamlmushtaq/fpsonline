// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — STARLIGHT MALL (Pastel's landmark).
//
// A bone-white modernist box (fluted concrete, terracotta band, deep roof
// fascia) crowned by rooftop "STARLIGHT" letters and a glass barrel-vault
// skylight with missing panes. Inside: a flooded terrazzo atrium with a star
// inlay, the dry fountain island and its "Sunrise" ceramic sculpture carrying
// the bridge, four double escalators, galleries with broken railings, dead
// storefronts, a GRAND OPENING 1976 banner, hanging glowing vines and warm
// light shafts through the broken glass.
//
// Collision (src/shared/maps/pastel.ts) is mirrored here exactly; everything
// decorative stays out of the walking volumes or is small enough to ignore.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MapLighting } from '../../../../shared/maps/types';
import { createLightShaft } from '../../../engine/atmosphere';
import { ENV } from '../../../engine/palette';
import { type DecorKit, type RGB, mix, rgb } from './kit';
import { REGION, SHOP_NAMES, type SignBatch, shopSub } from './signs';
import { hangingVine } from './vines';

export const MALL_Y = -0.35;
export const GAL = 3.2;
const TOP = 8;
const ROOF = 8.7;

const COL = {
  bone: rgb(ENV.bone),
  boneShade: rgb(ENV.boneShade),
  plinth: rgb(ENV.concreteDark),
  terra: rgb(ENV.terracotta),
  terraF: rgb(ENV.terracottaFaded),
  mustard: rgb('#d9c28b'),
  sage: rgb(ENV.sage),
  sky: rgb(ENV.skyBlue),
  mint: rgb(ENV.pastelMint),
  pink: rgb(ENV.pastelPink),
  chrome: rgb('#c9c6bf'),
  dark: rgb('#3a3634'),
  terrazzo: rgb('#ddd3c2'),
  glass: rgb('#cfe0e6'),
  shopGlass: rgb('#5d6670'),
  shutter: rgb('#a9a397'),
};

export interface MallParts {
  /** Hanging banner mesh (flutters). */
  banner: THREE.Mesh | null;
  shafts: THREE.Object3D[];
}

export function buildMall(kit: DecorKit, signs: { board: SignBatch; lit: SignBatch }, lighting: MapLighting, rng: () => number): MallParts {
  shell(kit, signs, rng);
  vault(kit, rng);
  interior(kit, signs, rng);
  const parts: MallParts = { banner: null, shafts: [] };
  // Grand-opening banner strung across the atrium between the galleries.
  for (const s of [1, -1]) {
    signs.board.quad2(REGION.banner, new THREE.Vector3(0, 6.6, 6.2 * s), 15, 1.9, new THREE.Vector3(0, 0, s));
    // Strings to the vault ribs.
    for (const x of [-7.5, 7.5]) kit.tube('chrome', new THREE.Vector3(x, 7.55, 6.2 * s), new THREE.Vector3(x * 1.1, 10.8, 6.2 * s), 0.015, COL.dark, 4);
  }
  // Light shafts through the broken skylight and the west gallery opening.
  if (kit.q.lightShafts) {
    const d = new THREE.Vector3(-lighting.sunDir.x, -lighting.sunDir.y, -lighting.sunDir.z).normalize();
    const color = '#ffe0a8';
    const add = (x: number, y: number, z: number, radius: number, intensity: number): void => {
      // Travel until the light meets the far gallery wall / floor / end walls.
      const tWall = (14.2 - x) / d.x;
      const tFloor = (y - MALL_Y) / -d.y;
      const tEnd = d.z < 0 ? (z + 11.2) / -d.z : (11.2 - z) / d.z;
      const len = Math.max(4, Math.min(tWall, tFloor, tEnd));
      const shaft = createLightShaft({ pos: { x, y, z }, dir: { x: d.x, y: d.y, z: d.z }, length: len, radius, color, intensity });
      parts.shafts.push(kit.add(shaft));
    };
    add(-6.5, 11.6, 8.5, 1.7, 1.1);
    add(-2.5, 12.2, 5.0, 1.4, 0.9);
    add(-7.5, 11.2, 0.5, 1.6, 1.0);
    add(-15.2, 6.6, 3.8, 1.5, 1.2);
    add(-15.2, 6.2, 9.8, 1.3, 0.9);
    if (kit.detail > 0.8) add(-4.5, 11.9, -4.5, 1.3, 0.8);
  }
  return parts;
}

// ── Exterior shell ──────────────────────────────────────────────────────────

function flutes(kit: DecorKit, axis: 'x' | 'z', face: number, from: number, to: number, out: number): void {
  // Vertical ribs on a facade: axis = the facade runs along this axis, `face`
  // = the wall's outer plane coordinate, `out` = +1/−1 outward direction.
  const step = 1.1;
  const n = Math.floor((to - from) / step);
  const off = (to - from - n * step) / 2;
  for (let i = 0; i <= n; i++) {
    const a = from + off + i * step;
    if (a < from + 0.2 || a > to - 0.2) continue;
    const c0 = face + out * 0.001;
    const c1 = face + out * 0.16;
    if (axis === 'x') kit.box('concrete', a - 0.17, 0.62, Math.min(c0, c1), a + 0.17, TOP - 0.45, Math.max(c0, c1), COL.bone, 0.05, { ao: 0.25 });
    else kit.box('concrete', Math.min(c0, c1), 0.62, a - 0.17, Math.max(c0, c1), TOP - 0.45, a + 0.17, COL.bone, 0.05, { ao: 0.25 });
  }
}

/** Glass curtain (aluminum mullions + panes, some missing) in a vertical rect. */
function curtain(kit: DecorKit, axis: 'x' | 'z', plane: number, a0: number, a1: number, y0: number, y1: number, rng: () => number, broken = 0.3): void {
  const cols = Math.max(1, Math.round((a1 - a0) / 1.1));
  const rows = Math.max(1, Math.round((y1 - y0) / 1.35));
  const mull = 0.07;
  for (let i = 0; i <= cols; i++) {
    const a = a0 + ((a1 - a0) * i) / cols;
    if (axis === 'x') kit.box('chrome', a - mull, y0, plane - 0.06, a + mull, y1, plane + 0.06, COL.chrome, 0, { drift: 0.04 });
    else kit.box('chrome', plane - 0.06, y0, a - mull, plane + 0.06, y1, a + mull, COL.chrome, 0, { drift: 0.04 });
  }
  for (let j = 0; j <= rows; j++) {
    const y = y0 + ((y1 - y0) * j) / rows;
    if (axis === 'x') kit.box('chrome', a0, y - mull, plane - 0.06, a1, y + mull, plane + 0.06, COL.chrome, 0, { drift: 0.04 });
    else kit.box('chrome', plane - 0.06, y - mull, a0, plane + 0.06, y + mull, a1, COL.chrome, 0, { drift: 0.04 });
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (rng() < broken) continue;
      const b0 = a0 + ((a1 - a0) * i) / cols + mull;
      const b1 = a0 + ((a1 - a0) * (i + 1)) / cols - mull;
      const c0 = y0 + ((y1 - y0) * j) / rows + mull;
      const c1 = y0 + ((y1 - y0) * (j + 1)) / rows - mull;
      const tint = mix(COL.glass, COL.pink, rng() * 0.25);
      if (axis === 'x') kit.box('glass', b0, c0, plane - 0.01, b1, c1, plane + 0.01, tint, 0, { drift: 0 });
      else kit.box('glass', plane - 0.01, c0, b0, plane + 0.01, c1, b1, tint, 0, { drift: 0 });
    }
  }
}

function shell(kit: DecorKit, signs: { board: SignBatch; lit: SignBatch }, rng: () => number): void {
  // Wall masses (collision: N/S x ±15 segments; W/E z ±12 segments).
  for (const s of [1, -1]) {
    const z0 = 11.5 * s;
    const z1 = 12 * s;
    for (const [a, b] of [
      [-15, -8],
      [-4, 4],
      [8, 15],
    ] as const) {
      kit.box('concrete', a, MALL_Y, Math.min(z0, z1), b, TOP, Math.max(z0, z1), COL.bone, 0.04, { base: 0 });
      kit.box('concrete', a - 0.04, MALL_Y, Math.min(z0, z1) - 0.04, b + 0.04, 0.62, Math.max(z0, z1) + 0.04, COL.plinth, 0.02, { base: 0 });
      // Terracotta band at gallery level.
      kit.box('plaster', a - 0.03, 3.25, Math.min(z0, z1) - 0.03, b + 0.03, 3.6, Math.max(z0, z1) + 0.03, COL.terraF, 0.02, { ao: 0 });
    }
    flutes(kit, 'x', 12 * s, -15, -8, s);
    flutes(kit, 'x', 12 * s, 8, 15, s);
    // Central pier: 1970s sunburst supergraphic.
    sunburst(kit, 0, 4.3, 12 * s + 0.02 * s, s);
    // Doors: aluminum frames, broken glass above, canopy.
    for (const dx of [-6, 6]) {
      const x0 = dx - 2;
      const x1 = dx + 2;
      kit.box('chrome', x0, MALL_Y, 11.45 * s - 0.1, x0 + 0.14, TOP, 11.45 * s + 0.1, COL.chrome, 0, { drift: 0.03 });
      kit.box('chrome', x1 - 0.14, MALL_Y, 11.45 * s - 0.1, x1, TOP, 11.45 * s + 0.1, COL.chrome, 0, { drift: 0.03 });
      kit.box('chrome', x0, 2.72, 11.75 * s - 0.1, x1, 2.9, 11.75 * s + 0.1, COL.chrome, 0, { drift: 0.03 });
      curtain(kit, 'x', 11.75 * s, x0 + 0.14, x1 - 0.14, 2.9, TOP - 0.1, rng, 0.35);
      // Swing doors: one hanging open, one frame shattered.
      kit.boxR('chrome', x0 + 0.95 + 0.62, 1.15, 12.4 * s, 1.3, 2.3, 0.06, 0.9 * s, COL.chrome, 0);
      kit.boxR('glass', x0 + 0.95 + 0.62, 1.15, 12.4 * s, 1.1, 2.1, 0.02, 0.9 * s, COL.glass, 0, { drift: 0 });
      kit.box('chrome', x1 - 1.35, MALL_Y, 11.72 * s - 0.03, x1 - 1.27, 2.7, 11.72 * s + 0.03, COL.chrome, 0);
      // Canopy.
      const zc0 = 12 * s;
      const zc1 = 14.6 * s;
      kit.box('concrete', x0 - 0.6, 3.25, Math.min(zc0, zc1), x1 + 0.6, 3.55, Math.max(zc0, zc1), COL.bone, 0.05, { ao: 0 });
      kit.box('plaster', x0 - 0.62, 3.25, Math.min(zc0, zc1) - 0.02, x1 + 0.62, 3.33, Math.max(zc0, zc1) + 0.02, COL.terraF, 0, { ao: 0 });
      for (let i = 0; i < 3; i++) kit.cyl('glow', x0 + 0.8 + i * 1.2, 3.2, 13.4 * s, 0.16, 0.16, 0.05, rgb('#ffe3a1', 1.3), 10);
      // Directory beside the door (facing out).
      if (dx > 0) signs.board.quad(REGION.directory, new THREE.Vector3(x1 + 1.1, 1.45, 12.18 * s), 1.2, 1.8, new THREE.Vector3(0, 0, s));
    }
    // Rooftop letters over the entrance front.
    signs.board.quad2(REGION.mallSign, new THREE.Vector3(0, ROOF + 1.05, 13.25 * s), 12.6, 2.1, new THREE.Vector3(0, 0, s), 0.02);
    kit.box('chrome', -6, ROOF, 13.05 * s - 0.05, 6, ROOF + 0.12, 13.05 * s + 0.05, COL.dark, 0, { ao: 0 });
    for (let x = -5.5; x <= 5.5; x += 2.75) kit.box('chrome', x - 0.04, ROOF, 12.95 * s - 0.04, x + 0.04, ROOF + 1.9, 12.95 * s + 0.04, COL.dark, 0, { ao: 0 });
  }
  for (const s of [1, -1]) {
    const x0 = 14.5 * s;
    const x1 = 15 * s;
    for (const [a, b] of [
      [5, 12],
      [-12, -5],
    ] as const) {
      kit.box('concrete', Math.min(x0, x1), MALL_Y, a, Math.max(x0, x1), TOP, b, COL.bone, 0.04, { base: 0 });
      kit.box('concrete', Math.min(x0, x1) - 0.04, MALL_Y, a - 0.04, Math.max(x0, x1) + 0.04, 0.62, b + 0.04, COL.plinth, 0.02, { base: 0 });
      kit.box('plaster', Math.min(x0, x1) - 0.03, 3.25, a - 0.03, Math.max(x0, x1) + 0.03, 3.6, b + 0.03, COL.terraF, 0.02, { ao: 0 });
      flutes(kit, 'z', 15 * s, a, b, s);
    }
    // Two-storey portal over the grand stair: lintel + slim columns + glass upper panes.
    kit.box('concrete', Math.min(x0, x1) - 0.2, 6.3, -5.2, Math.max(x0, x1) + 0.2, TOP, 5.2, COL.bone, 0.05, { ao: 0 });
    kit.box('plaster', Math.min(x0, x1) - 0.23, 6.3, -5.2, Math.max(x0, x1) + 0.23, 6.55, 5.2, COL.terra, 0.02, { ao: 0 });
    curtain(kit, 'z', 14.75 * s, -5, 5, 6.55, TOP - 0.1, rng, 0.5);
    signs.board.quad(REGION.mallSign, new THREE.Vector3(15.3 * s, 7.25, 0), 7.8, 1.3, new THREE.Vector3(s, 0, 0));
    // Grand stair: terrazzo treads over the ramp + low cheek walls.
    grandStair(kit, s);
  }
  // Roof slab + fascia (hole over the atrium for the vault).
  const roofPieces: [number, number, number, number][] = [
    [-16.2, -13.2, -10, 13.2],
    [10, -13.2, 16.2, 13.2],
    [-10, -13.2, 10, -11],
    [-10, 11, 10, 13.2],
  ];
  for (const [a, b, c, d] of roofPieces) kit.box('concrete', a, TOP, b, c, ROOF, d, COL.bone, 0.08, { ao: 0, drift: 0.06 });
  // Fascia pinstripe + soffit shadow line.
  for (const s of [1, -1]) {
    kit.box('plaster', -16.24, TOP + 0.12, 13.2 * s - 0.03, 16.24, TOP + 0.24, 13.2 * s + 0.03, COL.terraF, 0, { ao: 0 });
    kit.box('plaster', 16.2 * s - 0.03, TOP + 0.12, -13.24, 16.2 * s + 0.03, TOP + 0.24, 13.24, COL.terraF, 0, { ao: 0 });
  }
  // Rooftop plant: HVAC boxes, ducts, a water tank.
  const roofProps: [number, number, number, number, number][] = [
    [12.5, 6, 2.4, 1.5, 3],
    [12.8, -7, 2, 1.2, 2.4],
    [-12.8, -3, 2.2, 1.4, 2.8],
    [-12.5, 8.5, 1.8, 1.0, 1.8],
  ];
  for (const [x, z, sx, sy, sz] of roofProps) {
    kit.box('metal', x - sx / 2, ROOF, z - sz / 2, x + sx / 2, ROOF + sy, z + sz / 2, COL.boneShade, 0.06, { base: ROOF, ao: 0.3 });
    kit.box('metal', x - sx / 2 + 0.2, ROOF + sy, z - 0.4, x + sx / 2 - 0.2, ROOF + sy + 0.12, z + 0.4, COL.plinth, 0.03, { ao: 0 });
  }
  kit.cyl('metal', -13, ROOF, -9.5, 1.1, 1.1, 2.4, COL.boneShade, 16);
  kit.cyl('metal', -13, ROOF + 2.4, -9.5, 0.2, 1.15, 0.6, COL.terraF, 16);
}

/** Ceramic sunburst supergraphic on the entrance pier. */
function sunburst(kit: DecorKit, cx: number, cy: number, z: number, s: number): void {
  const rings: [number, RGB][] = [
    [3.6, mix(COL.terraF, COL.bone, 0.2)],
    [2.9, rgb(ENV.pastelYellow)],
    [2.2, COL.bone],
    [1.5, COL.pink],
    [0.8, COL.sage],
  ];
  const seg = kit.low ? 16 : 28;
  rings.forEach(([r, col], i) => {
    const g = new THREE.CircleGeometry(r, seg, 0, Math.PI);
    const m = new THREE.Matrix4().makeTranslation(cx, cy - 1.6, z + s * i * 0.012);
    if (s < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    kit.geo('plaster', g, m, col, { drift: 0.06 });
    g.dispose();
  });
  // Rays.
  for (let i = 0; i < 9; i++) {
    const a = Math.PI / 9 + (i / 8) * ((7 * Math.PI) / 9);
    const r0 = 3.75;
    const r1 = 4.25 + (i % 2) * 0.55;
    const mid = new THREE.Vector3(cx + Math.cos(a) * (r0 + r1) * 0.5, cy - 1.6 + Math.sin(a) * (r0 + r1) * 0.5, z + s * 0.02);
    kit.boxE('plaster', mid, new THREE.Euler(0, 0, a), new THREE.Vector3(r1 - r0, 0.28, 0.04), i % 2 ? mix(COL.terraF, COL.bone, 0.2) : rgb(ENV.pastelYellow));
  }
}

function grandStair(kit: DecorKit, s: number): void {
  // Ramp collision: x from 24·s (y 0) to 15·s (y GAL), z −2..2.
  const n = 16;
  const run = 9;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const xa = 24 * s - s * run * t0;
    const xb = 24 * s - s * run * t1;
    const y = GAL * t1;
    kit.box('concrete', Math.min(xa, xb), 0, -2, Math.max(xa, xb) + (s > 0 ? 0.02 : -0.02), y, 2, i % 2 ? COL.bone : mix(COL.bone, COL.boneShade, 0.4), 0.015, { ao: 0.2, base: 0 });
    kit.box('plaster', Math.min(xa, xb), y - 0.03, -2.02, Math.max(xa, xb), y + 0.005, 2.02, COL.terraF, 0, { ao: 0, drift: 0.05 });
  }
  // Cheek walls (low, sloped caps rendered as stepped boxes).
  for (const z of [-2.15, 2.15]) {
    for (let i = 0; i < 6; i++) {
      const t = (i + 1) / 6;
      const xa = 24 * s - s * run * (i / 6);
      const xb = 24 * s - s * run * t;
      kit.box('concrete', Math.min(xa, xb), 0, z - 0.15, Math.max(xa, xb), GAL * t + 0.35, z + 0.15, COL.boneShade, 0.03, { base: 0 });
    }
  }
}

// ── Skylight: glass barrel vault over the atrium ───────────────────────────

function vaultY(x: number): number {
  const u = Math.max(-1, Math.min(1, x / 10));
  return ROOF + 3.6 * Math.sqrt(1 - u * u);
}

function vault(kit: DecorKit, rng: () => number): void {
  const segs = 10;
  const ribs: number[] = [];
  for (let z = -11; z <= 11.001; z += 2.2) ribs.push(z);
  const xs: number[] = [];
  for (let i = 0; i <= segs; i++) xs.push(-10 + (20 * i) / segs);
  // Arched ribs.
  for (const z of ribs) {
    for (let i = 0; i < segs; i++) {
      const a = new THREE.Vector3(xs[i], vaultY(xs[i]), z);
      const b = new THREE.Vector3(xs[i + 1], vaultY(xs[i + 1]), z);
      kit.tube('paint', a, b, 0.09, COL.bone, 6, { drift: 0.03 });
    }
  }
  // Purlins along the vault.
  for (let i = 0; i <= segs; i++) {
    const y = vaultY(xs[i]);
    kit.tube('paint', new THREE.Vector3(xs[i], y, -11), new THREE.Vector3(xs[i], y, 11), 0.05, COL.boneShade, 5, { drift: 0.03 });
  }
  // Panes (west half more broken: the light pours in there).
  for (let r = 0; r < ribs.length - 1; r++) {
    for (let i = 0; i < segs; i++) {
      const west = xs[i] < 0;
      if (rng() < (west ? 0.45 : 0.18)) continue;
      const z0 = ribs[r] + 0.06;
      const z1 = ribs[r + 1] - 0.06;
      const a = new THREE.Vector3(xs[i], vaultY(xs[i]) + 0.02, z0);
      const b = new THREE.Vector3(xs[i + 1], vaultY(xs[i + 1]) + 0.02, z0);
      const c = new THREE.Vector3(xs[i + 1], vaultY(xs[i + 1]) + 0.02, z1);
      const d = new THREE.Vector3(xs[i], vaultY(xs[i]) + 0.02, z1);
      kit.quad('glass', a, d, c, b, mix(COL.glass, COL.pink, rng() * 0.3), { drift: 0 });
    }
  }
  // Gable ends: fan of glass with a few holes.
  for (const z of [-11, 11]) {
    for (let i = 0; i < segs; i++) {
      if (rng() < 0.3) continue;
      const a = new THREE.Vector3(xs[i], ROOF, z);
      const b = new THREE.Vector3(xs[i + 1], ROOF, z);
      const c = new THREE.Vector3(xs[i + 1], vaultY(xs[i + 1]), z);
      const d = new THREE.Vector3(xs[i], vaultY(xs[i]), z);
      kit.quad('glass', a, b, c, d, COL.glass, { drift: 0 });
    }
  }
  // Dead pendant globe lamps on long rods.
  for (const [x, z] of [
    [-5, -6.6],
    [5, 6.6],
    [-5, 6.6],
    [5, -6.6],
  ] as const) {
    kit.tube('chrome', new THREE.Vector3(x, vaultY(x), z), new THREE.Vector3(x, 6.8, z), 0.02, COL.dark, 4);
    kit.ball('paint', x, 6.5, z, 0.42, 0.42, 0.42, COL.bone, 1, { drift: 0.02 });
    kit.cyl('chrome', x, 6.82, z, 0.12, 0.22, 0.12, COL.chrome, 10);
  }
}

// ── Interior ────────────────────────────────────────────────────────────────

function storefront(kit: DecorKit, signs: { board: SignBatch; lit: SignBatch }, axis: 'x' | 'z', plane: number, inward: number, a0: number, a1: number, y0: number, y1: number, shop: number, rng: () => number): void {
  // Facade on the inner face of a wall: plane = wall inner coordinate, inward = ±1.
  const off = inward * 0.06;
  const P = (along: number, y: number, depth: number): THREE.Vector3 =>
    axis === 'x' ? new THREE.Vector3(along, y, plane + off + inward * depth) : new THREE.Vector3(plane + off + inward * depth, y, along);
  const boxA = (kind: 'chrome' | 'window' | 'plaster' | 'paint' | 'metal', b0: number, b1: number, c0: number, c1: number, d0: number, d1: number, col: RGB): void => {
    const p = P(b0, c0, d0);
    const q = P(b1, c1, d1);
    kit.box(kind, Math.min(p.x, q.x), Math.min(p.y, q.y), Math.min(p.z, q.z), Math.max(p.x, q.x), Math.max(p.y, q.y), Math.max(p.z, q.z), col, 0, { ao: 0.2, base: y0 });
  };
  const signH = Math.min(0.75, (y1 - y0) * 0.22);
  const glassTop = y1 - signH - 0.05;
  // Shop glass (opaque, reflective) with mullions.
  boxA('window', a0 + 0.15, a1 - 0.15, y0 + 0.35, glassTop, 0, 0.04, mix(COL.shopGlass, COL.sky, rng() * 0.3));
  const n = Math.max(2, Math.round((a1 - a0) / 1.6));
  for (let i = 0; i <= n; i++) {
    const a = a0 + 0.1 + ((a1 - a0 - 0.2) * i) / n;
    boxA('chrome', a - 0.05, a + 0.05, y0, glassTop, 0.04, 0.1, COL.chrome);
  }
  boxA('plaster', a0, a1, y0, y0 + 0.35, 0.02, 0.12, COL.boneShade);
  // Rolling shutter half down.
  const shutter = glassTop - (glassTop - y0) * (0.25 + rng() * 0.45);
  boxA('metal', a0 + 0.12, a1 - 0.12, shutter, glassTop, 0.1, 0.16, COL.shutter);
  // Sign band + sign.
  boxA('paint', a0, a1, glassTop, y1, 0.02, 0.1, mix(COL.bone, COL.terraF, rng() * 0.3));
  const mid = P((a0 + a1) / 2, glassTop + signH / 2 + 0.02, 0.105);
  const nrm = axis === 'x' ? new THREE.Vector3(0, 0, inward) : new THREE.Vector3(inward, 0, 0);
  const w = Math.min(a1 - a0 - 0.4, signH * 5.3);
  signs.board.quad(REGION.shops, mid, w, signH * 0.9, nrm, shopSub(shop % SHOP_NAMES.length));
}

function interior(kit: DecorKit, signs: { board: SignBatch; lit: SignBatch }, rng: () => number): void {
  // Terrazzo floor + star inlay (reads through the water).
  kit.slab('tile', -14.5, -11.5, 14.5, 11.5, MALL_Y + 0.004, COL.terrazzo, { drift: 0.1 });
  const star = (r: number, col: RGB, y: number, pts: number, rot: number): void => {
    const shape = new THREE.Shape();
    for (let i = 0; i < pts * 2; i++) {
      const a = (i / (pts * 2)) * Math.PI * 2 + rot;
      const rad = i % 2 === 0 ? r : r * 0.38;
      if (i === 0) shape.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else shape.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    kit.geo('paint', g, new THREE.Matrix4().makeTranslation(0, y, 0), col, { drift: 0.08 });
    g.dispose();
  };
  star(9.5, COL.terraF, MALL_Y + 0.008, 8, Math.PI / 8);
  star(7.2, COL.bone, MALL_Y + 0.011, 4, 0);
  star(5.4, COL.mustard, MALL_Y + 0.014, 8, 0);
  const ring = new THREE.RingGeometry(10.2, 10.6, kit.low ? 24 : 48);
  ring.rotateX(-Math.PI / 2);
  kit.geo('paint', ring, new THREE.Matrix4().makeTranslation(0, MALL_Y + 0.009, 0), COL.sage, { drift: 0.1 });
  ring.dispose();

  // Storefronts: ground-floor arcade (under the galleries) and N/S bays.
  let shop = 0;
  for (const s of [1, -1]) {
    for (const [a, b] of [
      [5.2, 11.3],
      [-11.3, -5.2],
    ] as const) {
      storefront(kit, signs, 'z', 14.5 * s, -s, a, b, MALL_Y, 2.9, shop++, rng);
      storefront(kit, signs, 'z', 14.5 * s, -s, a, b, GAL, 6.6, shop++, rng);
    }
    for (const [a, b] of [
      [-14.3, -8.2],
      [8.2, 14.3],
    ] as const) {
      storefront(kit, signs, 'x', 11.5 * s, -s, a, b, MALL_Y, 3.6, shop++, rng);
    }
    // Pier: two posters and the directory.
    signs.board.quad(REGION.poster1, new THREE.Vector3(-2.2, 1.5, 11.44 * s), 1.3, 1.95, new THREE.Vector3(0, 0, -s));
    signs.board.quad(REGION.directory, new THREE.Vector3(0, 1.4, 11.44 * s), 1.1, 1.65, new THREE.Vector3(0, 0, -s));
    signs.board.quad(REGION.poster2, new THREE.Vector3(2.2, 1.5, 11.44 * s), 1.3, 1.95, new THREE.Vector3(0, 0, -s));
    // Neon "Starlight" script above the pier, inside.
    signs.lit.quad(REGION.starlightNeon, new THREE.Vector3(0, 5.2, 11.42 * s), 5.6, 1.05, new THREE.Vector3(0, 0, -s));
  }

  // Galleries: slab edge fascia, terrazzo top, soffit lights, broken railings.
  for (const s of [1, -1]) {
    const xe = 10 * s;
    kit.box('concrete', Math.min(xe, 15 * s), GAL - 0.3, -11.5, Math.max(xe, 15 * s), GAL, 11.5, COL.bone, 0.03, { ao: 0 });
    kit.box('plaster', xe - 0.06, GAL - 0.62, -11.5, xe + 0.06, GAL + 0.02, 11.5, COL.bone, 0.03, { ao: 0 });
    kit.box('plaster', xe - 0.07, GAL - 0.5, -11.5, xe + 0.07, GAL - 0.4, 11.5, COL.terra, 0, { ao: 0 });
    for (let z = -10.5; z <= 10.5; z += 2.1) {
      if (Math.abs(z) < 2) continue;
      kit.cyl('glow', 12.5 * s, GAL - 0.33, z, 0.18, 0.18, 0.03, rgb('#ffe3a1', 0.9), 10);
    }
    // Railing stubs + surviving sections.
    for (let z = -11; z <= 11.01; z += 1.5) {
      if (Math.abs(z) < 2.2) continue;
      const h = rng() < 0.3 ? 0.25 + rng() * 0.3 : 1.0;
      kit.box('chrome', xe - 0.035 * s - 0.035, GAL, z - 0.035, xe - 0.035 * s + 0.035, GAL + h, z + 0.035, COL.chrome, 0);
    }
    for (const [za, zb] of [
      [-11, -8],
      [6.5, 9.5],
    ] as const) {
      kit.tube('chrome', new THREE.Vector3(xe - 0.035 * s, GAL + 1.0, za), new THREE.Vector3(xe - 0.035 * s, GAL + 1.0, zb), 0.04, COL.chrome, 6);
      kit.box('glass', xe - 0.04 * s - 0.01, GAL + 0.08, za, xe - 0.04 * s + 0.01, GAL + 0.95, zb, COL.glass, 0, { drift: 0 });
    }
    // A fallen railing section lying in the water.
    kit.boxE('chrome', new THREE.Vector3(8.2 * s, MALL_Y + 0.1, -4.5 * s), new THREE.Euler(0.1, 0.4 * s, 1.35), new THREE.Vector3(0.08, 3, 0.08), COL.chrome);
    // Planters against the gallery back walls, overgrown.
    for (const z of [-8, 8]) {
      kit.box('concrete', 13.3 * s - 0.6, GAL, z - 0.9, 13.3 * s + 0.6, GAL + 0.7, z + 0.9, COL.boneShade, 0.06, { base: GAL });
      kit.ball('foliage', 13.3 * s, GAL + 1.05, z, 0.8, 0.6, 1.0, COL.sage, 1);
    }
  }

  // Bridge: deck, fascias, parapets with cap rail + planters.
  kit.box('concrete', -10, GAL - 0.3, -1.75, 10, GAL, 1.75, COL.bone, 0.03, { ao: 0 });
  for (const s of [1, -1]) {
    kit.box('plaster', -10, GAL - 0.6, 1.75 * s - 0.05, 10, GAL + 0.02, 1.75 * s + 0.05, COL.bone, 0.03, { ao: 0 });
    kit.box('plaster', -10, GAL - 0.48, 1.75 * s - 0.06, 10, GAL - 0.38, 1.75 * s + 0.06, COL.terra, 0, { ao: 0 });
    kit.box('plaster', -3.6, GAL, Math.min(1.45 * s, 1.75 * s), 3.6, GAL + 1, Math.max(1.45 * s, 1.75 * s), COL.bone, 0.04, { base: GAL, ao: 0.25 });
    kit.box('chrome', -3.62, GAL + 1, 1.6 * s - 0.2, 3.62, GAL + 1.06, 1.6 * s + 0.2, COL.chrome, 0.02, { ao: 0 });
    for (const x of [-2.4, 2.4]) {
      kit.box('concrete', x - 0.7, GAL + 1.06, 1.6 * s - 0.2, x + 0.7, GAL + 1.3, 1.6 * s + 0.2, COL.terraF, 0.03, { ao: 0 });
      hangingVine(kit, new THREE.Vector3(x - 0.4, GAL + 1.25, 1.78 * s), 2.2 + rng() * 1.2, rng, 0.9);
      hangingVine(kit, new THREE.Vector3(x + 0.3, GAL + 1.25, 1.78 * s), 1.6 + rng() * 1.4, rng, 0.9);
    }
    for (let x = -9; x <= 9; x += 3) kit.cyl('glow', x, GAL - 0.33, 0.9 * s, 0.14, 0.14, 0.03, rgb('#ffe3a1', 0.8), 8);
  }

  // Escalators (double) — collision ramps x ±[3.9, 8.1], z ±[1.75, 9.3].
  for (const sx of [1, -1]) for (const sz of [1, -1]) escalator(kit, sx, sz);

  // Fountain island + "Sunrise" sculpture.
  fountain(kit, rng);

  // Floating debris & leaves on the water, a tipped shopping cart.
  const n = Math.round(40 * kit.detail);
  for (let i = 0; i < n; i++) {
    const x = -13.5 + rng() * 27;
    const z = -10.5 + rng() * 21;
    if (Math.abs(x) < 3 && Math.abs(z) < 3) continue;
    kit.boxR('foliage', x, -0.19, z, 0.18 + rng() * 0.2, 0.01, 0.1 + rng() * 0.1, rng() * Math.PI, mix(COL.sage, COL.mustard, rng() * 0.6), 0, { drift: 0.2 });
  }
  cart(kit, -11.6, MALL_Y, -7.2, 0.6);
  cart(kit, 11.4, GAL, 8.6, -2.1);
}

function cart(kit: DecorKit, x: number, y: number, z: number, ry: number): void {
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  const p = (a: number, b: number, c: number): THREE.Vector3 => new THREE.Vector3(a, b, c).applyMatrix4(m);
  const bars: [number, number, number, number, number, number][] = [
    [-0.3, 0.45, -0.45, -0.3, 0.95, 0.45],
    [0.3, 0.45, -0.45, 0.3, 0.95, 0.45],
    [-0.3, 0.45, -0.45, 0.3, 0.45, -0.45],
    [-0.3, 0.95, 0.45, 0.3, 0.95, 0.45],
    [-0.3, 0.95, -0.45, 0.3, 0.95, -0.45],
    [-0.3, 0.1, 0.45, -0.3, 1.1, 0.6],
    [0.3, 0.1, 0.45, 0.3, 1.1, 0.6],
    [-0.3, 1.1, 0.6, 0.3, 1.1, 0.6],
  ];
  for (const [a, b, c, d, e, f] of bars) kit.tube('chrome', p(a, b, c), p(d, e, f), 0.018, COL.chrome, 4);
  for (const [a, c] of [
    [-0.25, -0.4],
    [0.25, -0.4],
    [-0.25, 0.4],
    [0.25, 0.4],
  ] as const) kit.tube('chrome', p(a, 0.08, c), p(a, 0.45, c), 0.015, COL.chrome, 4);
}

/** Extruded side profile in the (z, y) plane, thickness along x from x0. */
function profile(kit: DecorKit, kind: 'paint' | 'plaster' | 'chrome' | 'glass', pts: [number, number][], x0: number, thick: number, col: RGB, opts: { base?: number } = {}): void {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  // Shape (x = world z, y = world y) extruded along +Z → rotate so it runs along x.
  const m = new THREE.Matrix4().makeTranslation(x0 + thick, 0, 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  kit.geo(kind, g, m, col, { ao: 0.2, base: opts.base ?? MALL_Y, drift: 0.05 });
  g.dispose();
}

function escalator(kit: DecorKit, sx: number, sz: number): void {
  const xa = 3.9 * sx;
  const xb = 8.1 * sx;
  const x0 = Math.min(xa, xb);
  const x1 = Math.max(xa, xb);
  const xm = (x0 + x1) / 2;
  const zTop = 1.75 * sz;
  const zBot = 9.3 * sz;
  const zFoot = 10.1 * sz;
  const rise = GAL - MALL_Y;
  // Truss cladding: the wedge's outer faces (bone, terracotta pinstripe).
  const truss: [number, number][] = [
    [zBot, MALL_Y],
    [zTop, GAL - 0.02],
    [zTop, MALL_Y],
  ];
  profile(kit, 'paint', truss, x0 - 0.02, 0.06, COL.bone);
  profile(kit, 'paint', truss, x1 - 0.04, 0.06, COL.bone);
  // Balustrade skirts: slim sloped bands along the step edges + flat runs at both ends.
  const band = (xc: number, w: number, col: RGB, h0: number, h1: number, kind: 'paint' | 'chrome' | 'glass'): void => {
    const pts: [number, number][] = [
      [zFoot, MALL_Y + h0],
      [zBot, MALL_Y + h0],
      [zTop, GAL + h0],
      [zTop - sz * 0.6, GAL + h0],
      [zTop - sz * 0.6, GAL + h1],
      [zTop, GAL + h1],
      [zBot, MALL_Y + h1],
      [zFoot, MALL_Y + h1],
    ];
    profile(kit, kind, pts, xc - w / 2, w, col);
  };
  for (const xc of [x0 + 0.12, x1 - 0.12, xm]) {
    band(xc, xc === xm ? 0.3 : 0.2, xc === xm ? COL.boneShade : COL.chrome, 0, 0.18, xc === xm ? 'paint' : 'chrome');
    band(xc, 0.03, COL.glass, 0.18, 0.92, 'glass');
    band(xc, xc === xm ? 0.16 : 0.12, COL.dark, 0.92, 1.0, 'paint');
  }
  // Steps (each lane) — treads on the ramp, grooved aluminium.
  const steps = 18;
  const tread = mix(COL.chrome, COL.dark, 0.35);
  const riser = mix(COL.chrome, COL.dark, 0.6);
  for (const [l0, l1] of [
    [x0 + 0.22, xm - 0.15],
    [xm + 0.15, x1 - 0.22],
  ] as const) {
    for (let i = 0; i < steps; i++) {
      const za = zBot + (zTop - zBot) * (i / steps);
      const zb = zBot + (zTop - zBot) * ((i + 1) / steps);
      const y = MALL_Y + (rise * (i + 1)) / steps;
      kit.box('metal', l0, y - 0.05, Math.min(za, zb), l1, y, Math.max(za, zb), tread, 0, { ao: 0, drift: 0.03 });
      const zr = za;
      kit.box('metal', l0, y - rise / steps, Math.min(zr, zr + sz * 0.03), l1, y - 0.05, Math.max(zr, zr + sz * 0.03), riser, 0, { ao: 0, drift: 0 });
    }
  }
  // Comb plates at both landings.
  kit.box('chrome', x0 + 0.2, MALL_Y, Math.min(zBot, zFoot), x1 - 0.2, MALL_Y + 0.03, Math.max(zBot, zFoot), COL.chrome, 0, { ao: 0 });
  kit.box('chrome', x0 + 0.2, GAL - 0.02, Math.min(zTop, zTop - sz * 0.5), x1 - 0.2, GAL + 0.01, Math.max(zTop, zTop - sz * 0.5), COL.chrome, 0, { ao: 0 });
}

function fountain(kit: DecorKit, rng: () => number): void {
  // Island: collision box ±2.6 (top 0.45). Rounded terrazzo rim, dry basin.
  kit.box('tile', -2.6, MALL_Y, -2.6, 2.6, 0.45, 2.6, COL.terrazzo, 0.35, { base: MALL_Y, ao: 0.35 });
  kit.box('tile', -2.25, 0.2, -2.25, 2.25, 0.455, 2.25, mix(COL.sky, COL.bone, 0.45), 0.25, { ao: 0 });
  kit.box('paint', -2.64, 0.38, -2.64, 2.64, 0.47, 2.64, COL.terraF, 0.3, { ao: 0 });
  // Dry basin bottom: leaves + glowing algae crust.
  for (let i = 0; i < 12; i++) {
    const x = (rng() - 0.5) * 4;
    const z = (rng() - 0.5) * 4;
    if (Math.abs(z) < 0.5) continue;
    kit.ball('glow', x, 0.47, z, 0.18 + rng() * 0.25, 0.02, 0.14 + rng() * 0.2, rgb(rng() < 0.6 ? ENV.glowChartreuse : ENV.glowGold, 1.15), 0);
  }
  // "Sunrise": fanned ceramic fins (collision screen x ±2.4, z ±0.35, up to 2.9).
  const fins = 9;
  for (let i = 0; i < fins; i++) {
    const t = i / (fins - 1);
    const x = -2.1 + t * 4.2;
    const h = 1.6 + Math.sin(t * Math.PI) * 0.85;
    const lean = (t - 0.5) * 0.35;
    kit.boxE('paint', new THREE.Vector3(x, 0.45 + h / 2, 0), new THREE.Euler(0, 0, -lean), new THREE.Vector3(0.36, h, 0.55), COL.bone, 0.12);
    kit.ball('paint', x + Math.sin(lean) * h * 0.5, 0.45 + h + 0.05, 0, 0.2, 0.2, 0.2, COL.mustard, 1);
  }
  // Sun disc between the fins + column carrying the bridge.
  const disc = new THREE.CylinderGeometry(1.05, 1.05, 0.5, kit.low ? 16 : 28);
  disc.rotateX(Math.PI / 2);
  kit.geo('paint', disc, new THREE.Matrix4().makeTranslation(0, 1.75, 0), COL.mustard, { drift: 0.05 });
  disc.dispose();
  kit.box('paint', -0.35, 2.3, -0.3, 0.35, GAL - 0.3, 0.3, COL.bone, 0.08, { ao: 0 });
  kit.box('plaster', -2.4, 2.62, -0.33, 2.4, GAL - 0.3, 0.33, COL.bone, 0.06, { ao: 0 });
}
