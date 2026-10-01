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
import type { CardBatch } from './cards';
import { LEAF, canopyTree, cushion, hedgeRow } from './flora';
import { climbingVine, drapedVine, glowColor, hangingVine } from './vines';

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
  /** Suitcases strapped to the roof rack, one burst open on the ground. */
  luggage?: boolean;
  /** Driver's door left ajar. */
  doorOpen?: boolean;
}

/**
 * A car filling the collision box: center (cx, cz), length along `ry`
 * direction, width, height (roof top).
 */
/** Side profile (local z = forward, y = up) extruded across the car's width. */
function carProfile(kit: DecorKit, kind: 'paint' | 'window', m: THREE.Matrix4, pts: [number, number][], w: number, col: RGB): void {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  // Shape x → local z, extrusion (+Z, 0..w) → local −x … re-centred on the axis.
  const local = new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(w / 2, 0, 0));
  kit.geo(kind, g, m.clone().multiply(local), col, { drift: 0.05, base: 0, ao: 0.25 });
  g.dispose();
}

let ARCH: THREE.BufferGeometry | null = null;
let DISC: THREE.BufferGeometry | null = null;

function car(kit: DecorKit, cx: number, cz: number, len: number, wid: number, h: number, ry: number, o: CarOpts, rng: () => number, cards?: CardBatch): void {
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(cx, 0, cz);
  const place = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).applyMatrix4(m);
  const box = (kind: Parameters<DecorKit['boxE']>[0], x: number, y: number, z: number, sx: number, sy: number, sz: number, col: RGB, r = 0): void =>
    kit.boxE(kind, place(x, y, z), new THREE.Euler(0, ry, 0), new THREE.Vector3(sx, sy, sz), col, r, { base: 0 });
  const sag = o.flat ?? 0;
  const van = o.kind === 'van';
  // 1970s proportions: low belt line, tall glasshouse, long hood (+z = front).
  const bodyH = van ? h - 0.75 : 0.84;
  const bodyY = 0.28 - sag;
  const glass = mix(K.glass, K.dark, 0.15 + rng() * 0.35);
  const roofCol = o.roof ?? o.body;
  kit.contact(cx, 0.03, cz, wid * 0.78, len * 0.6, ry, 1);
  // Lower body (length along local z) + a slimmer hood/trunk deck line.
  box('paint', 0, bodyY + (bodyH - bodyY) / 2 + 0.02, 0, wid, bodyH - bodyY, len, o.body, 0.14);
  // Chrome belt trim + rocker shadow line along both flanks.
  for (const s of [-1, 1]) {
    box('chrome', s * (wid / 2 + 0.006), bodyH - 0.12, 0, 0.012, 0.035, len * 0.92, K.chrome, 0);
    box('paint', s * (wid / 2 + 0.004), bodyY + 0.06, 0, 0.012, 0.07, len * 0.7, mix(o.body, K.dark, 0.55), 0);
  }
  if (o.wood) {
    for (const s of [-1, 1]) box('wood', s * (wid / 2 + 0.005), bodyY + 0.3, -len * 0.04, 0.02, 0.28, len * 0.72, K.wood, 0);
  }
  // Glasshouse: extruded glass profile, roof slab and painted pillars.
  const top = h - 0.06;
  let prof: [number, number][];
  if (van) {
    prof = [
      [-len / 2 + 0.05, bodyH],
      [len / 2 - 0.25, bodyH],
      [len / 2 - 0.55, top],
      [-len / 2 + 0.08, top],
    ];
  } else if (o.kind === 'wagon') {
    prof = [
      [-len / 2 + 0.1, bodyH],
      [len * 0.16, bodyH],
      [len * 0.03, top],
      [-len / 2 + 0.16, top],
    ];
  } else {
    prof = [
      [-len * 0.3, bodyH],
      [len * 0.14, bodyH],
      [len * 0.01, top],
      [-len * 0.2, top],
    ];
  }
  carProfile(kit, 'window', m, prof, wid * 0.86, glass);
  const r0 = prof[3][0];
  const r1 = prof[2][0];
  box('paint', 0, top + 0.03, (r0 + r1) / 2, wid * 0.88, 0.07, r1 - r0 + 0.06, roofCol, 0.03);
  for (const s of [-1, 1]) {
    const x = s * wid * 0.43;
    kit.tube('paint', place(x, bodyH, prof[1][0] - 0.03), place(x, top, prof[2][0] + 0.02), 0.045, roofCol, 4);
    kit.tube('paint', place(x, bodyH, prof[0][0] + 0.03), place(x, top, prof[3][0] - 0.02), 0.06, roofCol, 4);
    if (!van) box('paint', x, (bodyH + top) / 2, (prof[1][0] + prof[0][0]) / 2 - 0.05, 0.03, top - bodyH, 0.1, roofCol, 0);
    // Side mirror.
    box('chrome', s * (wid / 2 + 0.07), bodyH + 0.1, prof[1][0] - 0.05, 0.12, 0.08, 0.05, K.chrome, 0);
  }
  if (!van && o.kind === 'sedan') {
    // Trunk lid seam + hood seam (dark hairlines).
    box('paint', 0, bodyH + 0.006, prof[1][0] + 0.25, wid * 0.86, 0.008, 0.02, mix(o.body, K.dark, 0.5), 0);
    box('paint', 0, bodyH + 0.006, prof[0][0] - 0.2, wid * 0.86, 0.008, 0.02, mix(o.body, K.dark, 0.5), 0);
  }
  // Front: grille + round headlamps; rear: tail lamps; plates; bumpers.
  DISC ??= new THREE.CylinderGeometry(1, 1, 1, kit.low ? 8 : 12).rotateX(Math.PI / 2).toNonIndexed();
  for (const s of [-1, 1]) {
    box('chrome', 0, bodyY + 0.12, s * (len / 2 + 0.03), wid * 1.02, 0.15, 0.1, K.chrome, 0.03);
    box('paint', 0, bodyY + 0.12, s * (len / 2 + 0.085), 0.3, 0.14, 0.012, mix(K.bone, K.yellow, 0.3), 0);
    if (s > 0) {
      box('paint', 0, bodyY + 0.36, len / 2 + 0.006, wid * 0.55, 0.2, 0.02, K.dark, 0);
      for (let i = 0; i < 4; i++) box('chrome', 0, bodyY + 0.29 + i * 0.05, len / 2 + 0.018, wid * 0.53, 0.012, 0.012, K.chrome, 0);
      for (const lx of [-0.37, 0.37]) {
        const p = place(lx * wid, bodyY + 0.37, len / 2 + 0.012);
        kit.geo('chrome', DISC, new THREE.Matrix4().makeRotationY(ry).setPosition(p).multiply(new THREE.Matrix4().makeScale(0.1, 0.1, 0.03)), K.chrome, { drift: 0 });
        kit.geo('window', DISC, new THREE.Matrix4().makeRotationY(ry).setPosition(p.clone().add(new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(0.01))).multiply(new THREE.Matrix4().makeScale(0.075, 0.075, 0.03)), mix(K.bone, K.yellow, 0.35), { drift: 0 });
      }
    } else {
      for (const lx of [-0.36, 0.36]) box('paint', lx * wid, bodyY + 0.38, -len / 2 - 0.006, 0.3, 0.13, 0.02, K.terraF, 0);
    }
  }
  // Wheels: tyre, hubcap, dark arch over each.
  ARCH ??= new THREE.CircleGeometry(0.42, 8, 0, Math.PI).toNonIndexed();
  for (const s of [-1, 1]) {
    for (const wz of [-0.32, 0.32]) {
      const wy = 0.33 - sag * 0.5;
      const p = place(s * (wid / 2 - 0.08), wy, wz * len);
      const g = new THREE.CylinderGeometry(0.33, 0.33, 0.24, kit.low ? 10 : 14);
      g.rotateZ(Math.PI / 2);
      kit.geo('paint', g, new THREE.Matrix4().makeRotationY(ry).setPosition(p), K.tire, { drift: 0.05 });
      g.dispose();
      const hub = place(s * (wid / 2 + 0.045), wy, wz * len);
      kit.geo('chrome', DISC, new THREE.Matrix4().makeRotationY(ry + Math.PI / 2).setPosition(hub).multiply(new THREE.Matrix4().makeScale(0.17, 0.17, 0.02)), K.chrome, { drift: 0 });
      const arch = place(s * (wid / 2 + 0.008), bodyY + 0.02, wz * len);
      kit.geo('paint', ARCH, new THREE.Matrix4().makeRotationY(ry + (s > 0 ? Math.PI / 2 : -Math.PI / 2)).setPosition(arch), mix(o.body, K.dark, 0.75), { drift: 0 });
    }
  }
  // Roof rack on wagons.
  if (o.kind === 'wagon') {
    for (const s of [-1, 1]) box('chrome', s * wid * 0.36, h + 0.04, (r0 + r1) / 2, 0.05, 0.05, (r1 - r0) * 0.8, K.chrome);
  }
  // Moss on the roof, leaf litter on the hood (painted cards).
  if (cards) {
    const rp = place((rng() - 0.5) * 0.4, h + 0.005, (r0 + r1) / 2);
    cushion(cards, rp.x, rp.y, rp.z, 0.9 + rng() * 0.4, rng, mix(LEAF.olive, LEAF.sage, rng()));
    const hp = place((rng() - 0.5) * 0.4, bodyH + 0.03, len * 0.36);
    cushion(cards, hp.x, hp.y - 0.02, hp.z, 0.6 + rng() * 0.3, rng, LEAF.mustard);
  }
  const cab = { z: (r0 + r1) / 2, l: r1 - r0 };
  if (o.luggage) {
    const cols = [K.terraF, K.mustard, K.blue];
    for (let i = 0; i < 3; i++) box('fabric', (i - 1) * 0.12, h + 0.2 + i * 0.05, cab.z - cab.l * 0.25 + i * 0.55, 0.7 - i * 0.1, 0.28, 0.5, cols[i], 0.04);
    // The one that fell: lid open, clothes spilled (flat, ≤ 0.3 m).
    const p = place(wid / 2 + 0.75, 0.13, len * 0.1);
    kit.boxE('fabric', p, new THREE.Euler(0, ry + 0.4, 0), new THREE.Vector3(0.75, 0.22, 0.5), K.terraF, 0.04);
    kit.boxE('fabric', p.clone().add(new THREE.Vector3(0, 0.26, 0)).addScaledVector(new THREE.Vector3(Math.sin(ry + 0.4), 0, Math.cos(ry + 0.4)), -0.3), new THREE.Euler(-1.2, ry + 0.4, 0, 'YXZ'), new THREE.Vector3(0.75, 0.05, 0.5), K.terraF, 0.02);
    for (let i = 0; i < 4; i++) kit.boxE('fabric', place(wid / 2 + 0.6 + rng() * 1.2, 0.04, len * 0.1 + (rng() - 0.5) * 1.4), new THREE.Euler(0, rng() * 3, 0), new THREE.Vector3(0.45, 0.03, 0.35), mix(K.bone, [K.pink, K.blue, K.mint, K.yellow][i], 0.6), 0.01);
  }
  if (o.doorOpen) {
    // Driver's door swung open (hinged at the front of the cabin).
    const hinge = place(-wid / 2, 0.75, cab.z + cab.l * 0.42);
    const dc = hinge.clone().add(new THREE.Vector3(-Math.cos(ry - 0.4) * 0.55, -0.12, Math.sin(ry - 0.4) * 0.55));
    kit.boxE('paint', dc, new THREE.Euler(0, ry - 0.4 + Math.PI / 2, 0), new THREE.Vector3(1.1, 0.55, 0.07), o.body, 0.03);
    // Door glass + slim frame above the panel.
    kit.boxE('window', dc.clone().add(new THREE.Vector3(0, 0.46, 0)), new THREE.Euler(0, ry - 0.4 + Math.PI / 2, 0), new THREE.Vector3(0.95, 0.36, 0.03), glass, 0);
    kit.boxE('paint', dc.clone().add(new THREE.Vector3(0, 0.66, 0)), new THREE.Euler(0, ry - 0.4 + Math.PI / 2, 0), new THREE.Vector3(1.0, 0.04, 0.05), roofCol, 0);
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
  // Collision: x 29.6..44, z ±1.2, 3.2 tall — the wreck seals the street and
  // both sidewalks. Van body x 33.6..41.6; the roadside sign, freezer and
  // crates fill the west end, the crushed porch of the corner house the east.
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
  // West end (x 29.6..33.6): the toppled "Mister Cosmo" roadside sign stands on
  // its edge against the van (it faces the intersection), a chest freezer on its
  // side and a stack of soda crates.
  kit.boxE('paint', new THREE.Vector3(30.05, 1.62, 0), new THREE.Euler(0, 0, -0.08), new THREE.Vector3(0.16, 3.25, 2.38), mix(K.pink, K.bone, 0.4), 0.04);
  signs.board.quad(REGION.cosmoSign, new THREE.Vector3(29.95, 1.62, 0), 2.3, 2.6, new THREE.Vector3(-1, 0.08, 0).normalize());
  kit.box('chrome', 30.1, 0, -1.25, 30.3, 0.5, -0.95, K.chrome, 0, { ao: 0.2 });
  kit.box('chrome', 30.1, 0, 0.95, 30.3, 0.5, 1.25, K.chrome, 0, { ao: 0.2 });
  kit.boxE('paint', new THREE.Vector3(31.3, 0.55, 0.45), new THREE.Euler(0, 0.12, Math.PI / 2), new THREE.Vector3(1.1, 1.3, 1.45), mix(K.bone, K.blue, 0.3), 0.08);
  kit.box('wood', 30.4, 0, -1.18, 31.5, 0.85, -0.12, K.wood, 0.03);
  kit.box('wood', 30.5, 0.85, -1.1, 31.4, 1.6, -0.2, K.woodDark, 0.03);
  kit.box('wood', 32.2, 0, -1.18, 33.5, 1.1, 0.2, mix(K.wood, K.sand, 0.3), 0.03);
  for (let i = 0; i < 6; i++) kit.cyl('paint', 30.6 + (i % 3) * 0.28, 1.6, -0.95 + Math.floor(i / 3) * 0.3, 0.05, 0.05, 0.22, i % 2 ? K.terraF : K.mint, 6);
  // East end (x 41.6..44): the van's nose buried in the corner-house porch —
  // collapsed porch roof, snapped posts and planks heaped against the house.
  kit.boxE('wood', new THREE.Vector3(43.05, 1.75, 0), new THREE.Euler(0, 0, 0.3), new THREE.Vector3(0.2, 3.5, 2.5), K.wood, 0.02);
  kit.boxE('wood', new THREE.Vector3(43.6, 1.55, -0.35), new THREE.Euler(0.15, 0, -0.22), new THREE.Vector3(0.16, 3.1, 1.6), mix(K.wood, K.bone, 0.3), 0.02);
  kit.boxE('wood', new THREE.Vector3(42.3, 1.3, 0.2), new THREE.Euler(0.25, 0, 0.55), new THREE.Vector3(0.18, 3.0, 2.2), K.woodDark, 0.02);
  kit.box('wood', 42.9, 0, -1.2, 44, 0.9, 1.2, mix(K.woodDark, K.sand, 0.3), 0.04);
  for (let i = 0; i < 5; i++) kit.boxE('wood', new THREE.Vector3(42.4 + rng() * 1.4, 0.95 + rng() * 1.6, (rng() - 0.5) * 2.1), new THREE.Euler(rng(), rng() * Math.PI, rng()), new THREE.Vector3(0.1, 0.1, 1.6 + rng()), mix(K.wood, K.bone, rng() * 0.5), 0);
  // Fallen streetlight across the roof.
  kit.tube('chrome', new THREE.Vector3(43.6, 0.2, -1.6), new THREE.Vector3(34.5, 3.1, 0.6), 0.09, K.boneShade, 6);
  kit.ball('paint', 34.3, 3.15, 0.65, 0.35, 0.35, 0.35, K.bone, 1);
  // Spilled cones / pops on the road + glowing vine over the wreck.
  for (let i = 0; i < 12; i++) kit.boxR('paint', 28.4 + rng() * 5.5, 0.06, (rng() < 0.5 ? -1 : 1) * (1.35 + rng() * 1.5), 0.25, 0.08, 0.1, rng() * Math.PI, mix(K.mustard, K.pink, rng()), 0);
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
  // Umbrella table tucked in the lee of the cabana (off the deck walkway: it
  // has no collision, so it stays out of the lanes).
  const ux = -50.6;
  const uz = 8.2;
  kit.cyl('chrome', ux, 0, uz, 0.03, 0.03, 2.3, K.chrome, 5);
  const um = new THREE.ConeGeometry(1.5, 0.5, 8, 1, true);
  kit.geo('fabric', um, new THREE.Matrix4().makeTranslation(ux, 2.2, uz), K.terraF, { drift: 0.1 });
  kit.geo('fabric', um, new THREE.Matrix4().makeTranslation(ux, 2.2, uz).multiply(new THREE.Matrix4().makeRotationX(Math.PI)), mix(K.terraF, K.dark, 0.3), { drift: 0.1 });
  um.dispose();
  kit.cyl('paint', ux, 0, uz, 0.55, 0.55, 0.72, K.bone, 12);
  // Inflatable swan deflated in the deep end, beach ball.
  kit.ball('paint', -40.5, deep + 0.12, 2.8, 0.6, 0.12, 0.4, K.bone, 1);
  kit.ball('paint', -36.2, -0.9, -3.5, 0.2, 0.2, 0.2, K.mustard, 1);
}

function lounger(kit: DecorKit, x: number, z: number, ry: number): void {
  kit.contact(x, 0.035, z, 0.5, 1.15, ry, 0.75);
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
  // Picnic table (collision x −36.6..−34.4, z ±23.05..23.95, 0.78 m): lunch
  // boxes still laid out in the south yard; the north one is overgrown.
  const px = -35.5;
  const pz = Z(23.5);
  kit.contact(px, 0.005, pz, 1.4, 1.0, 0, 0.75);
  kit.contact(-43.2, 0.005, Z(28.8), 1.5, 1.5, 0, 0.45); // trampoline
  kit.box('wood', px - 1.1, 0.72, pz - 0.45, px + 1.1, 0.78, pz + 0.45, K.wood, 0.02);
  for (const s of [-1, 1]) {
    kit.box('wood', px - 1.1, 0.42, pz + s * 0.75 - 0.15, px + 1.1, 0.47, pz + s * 0.75 + 0.15, K.wood, 0.02);
    kit.box('wood', px + s * 0.9 - 0.05, 0, pz - 0.8, px + s * 0.9 + 0.05, 0.72, pz + 0.8, K.woodDark, 0);
  }
  if (rich) {
    // Two lunch boxes (tin, pastel) + a thermos + an apple.
    kit.box('paint', px - 0.6, 0.78, pz - 0.18, px - 0.22, 1.02, pz + 0.08, K.blue, 0.03);
    kit.box('paint', px - 0.6, 1.02, pz - 0.18, px - 0.22, 1.05, pz + 0.08, K.terra, 0.01);
    kit.boxR('paint', px + 0.35, 0.9, pz + 0.05, 0.36, 0.24, 0.24, 0.4, K.yellow, 0.03);
    kit.cyl('paint', px + 0.05, 0.78, pz + 0.2, 0.06, 0.06, 0.28, K.terraF, 8);
    kit.ball('paint', px - 0.05, 0.83, pz - 0.2, 0.05, 0.05, 0.05, K.terra, 1);
    // BBQ kettle, tucked under the house balcony against the wall.
    const qx = -30.75;
    const qz = Z(25.9);
    kit.ball('paint', qx, 0.85, qz, 0.36, 0.3, 0.36, K.dark, 1);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      kit.tube('chrome', new THREE.Vector3(qx, 0.7, qz), new THREE.Vector3(qx + Math.cos(a) * 0.35, 0, qz + Math.sin(a) * 0.35), 0.02, K.chrome, 3);
    }
    // Kids' bikes dropped on the lawn.
    bike(kit, -39.2, Z(30.8), 0.6, K.terraF);
    bike(kit, -37.8, Z(31.4), 2.2, K.mint);
    // For-sale sign.
    kit.box('wood', -44.6, 0, Z(13.4) - 0.04, -44.5, 1.2, Z(13.4) + 0.04, K.bone, 0);
    signs.board.quad(REGION.forSale, new THREE.Vector3(-44.55, 1.1, Z(13.4) - sz * 0.05), 0.75, 0.56, new THREE.Vector3(0, 0, -sz));
  } else {
    // A cooler, a toppled soda bottle and a transistor radio, swallowed by vines.
    kit.box('paint', px + 0.2, 0.78, pz - 0.25, px + 0.75, 1.1, pz + 0.12, mix(K.bone, K.terraF, 0.3), 0.04);
    kit.box('paint', px + 0.18, 1.1, pz - 0.27, px + 0.77, 1.14, pz + 0.14, K.bone, 0.01);
    kit.boxR('paint', px - 0.5, 0.86, pz + 0.1, 0.3, 0.16, 0.1, 0.3, K.terraF, 0.02);
    kit.tube('glass', new THREE.Vector3(px - 0.1, 0.81, pz - 0.15), new THREE.Vector3(px - 0.35, 0.81, pz - 0.3), 0.035, K.mint, 6);
    drapedVine(kit, new THREE.Vector3(px - 1.2, 0.8, pz - 0.5), new THREE.Vector3(px + 1.2, 0.8, pz + 0.4), -0.1, rng, 3);
    // Kiddie pool.
    kit.cyl('paint', -40.5, 0, Z(25.5), 1.1, 1.1, 0.28, K.blue, 16);
    kit.cyl('tile', -40.5, 0.02, Z(25.5), 0.98, 0.98, 0.2, rgb('#6f95a0'), 16);
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
  kit.cyl('concrete', -44.1, 0, Z(18.6), 0.12, 0.2, 0.8, K.boneShade, 10);
  kit.cyl('concrete', -44.1, 0.8, Z(18.6), 0.5, 0.2, 0.15, K.boneShade, 12);
}

function bike(kit: DecorKit, x: number, z: number, ry: number, col: RGB): void {
  kit.contact(x, 0.005, z, 0.8, 0.4, ry, 0.5);
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
  kit.contact(x, 0.035, z, 0.4, 0.4, 0, 0.7);
  kit.cyl('concrete', x, 0, z, 0.14, 0.2, 0.5, K.boneShade, 8);
  kit.cyl('chrome', x, 0.5, z, 0.06, 0.08, h - 0.5, K.bone, 8);
  kit.ball('glow', x, h + 0.25, z, 0.32, 0.32, 0.32, rgb('#fff1d6', 0.55), 1, { drift: 0 });
  kit.cyl('chrome', x, h, z, 0.14, 0.1, 0.1, K.chrome, 8);
}

function parkingLamp(kit: DecorKit, x: number, z: number): void {
  kit.contact(x, 0.03, z, 0.55, 0.55, 0, 0.7);
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
  kit.contact(x, 0.035, z, 0.35, 0.35, 0, 0.75);
  kit.cyl('paint', x, 0, z, 0.14, 0.17, 0.62, K.terra, 8);
  kit.ball('paint', x, 0.64, z, 0.15, 0.1, 0.15, K.terra, 1);
  kit.box('paint', x - 0.22, 0.35, z - 0.06, x + 0.22, 0.45, z + 0.06, K.terra, 0.02, { ao: 0 });
}

function busShelter(kit: DecorKit, signs: Signs, sz: number): void {
  // Collision back panel x 22..29.5, z 6..6.4 (3.9 m: shelter 2.6 m + rooftop
  // billboard). Faces the cross street.
  const zb = 6.2 * sz;
  kit.box('paint', 22, 0, Math.min(zb - 0.2, zb + 0.2), 29.5, 2.6, Math.max(zb - 0.2, zb + 0.2), K.mint, 0.04);
  // Rooftop billboard: the mall's grand-opening ad, both faces, on a bone
  // frame that fills the collision up to 3.9 m (no invisible wall above).
  kit.box('paint', 22, 2.78, Math.min(zb - 0.2, zb + 0.2), 29.5, 3.9, Math.max(zb - 0.2, zb + 0.2), K.bone, 0.03, { ao: 0 });
  kit.box('paint', 21.95, 3.86, Math.min(zb - 0.23, zb + 0.23), 29.55, 3.96, Math.max(zb - 0.23, zb + 0.23), K.terra, 0.02, { ao: 0 });
  signs.board.quad2(REGION.banner, new THREE.Vector3(25.75, 3.34, zb), 7.0, 0.88, new THREE.Vector3(0, 0, 1), 0.205);
  const zr0 = 6.4 * sz;
  const zr1 = 4.2 * sz;
  kit.box('paint', 21.8, 2.6, Math.min(zr0, zr1), 29.7, 2.78, Math.max(zr0, zr1), K.bone, 0.05, { ao: 0 });
  // Side screens long since smashed out: bare frames (no phantom glass walls).
  for (const x of [22.1, 29.4]) {
    kit.box('chrome', x - 0.03, 0, Math.min(zr1 + 0.3 * sz, zr1 + 0.36 * sz), x + 0.03, 2.6, Math.max(zr1 + 0.3 * sz, zr1 + 0.36 * sz), K.chrome, 0);
    kit.box('chrome', x - 0.03, 2.2, Math.min(zb, zr1 + 0.3 * sz), x + 0.03, 2.26, Math.max(zb, zr1 + 0.3 * sz), K.chrome, 0);
    kit.box('glass', x - 0.01, 2.26, Math.min(zb, zr1 + 0.3 * sz), x + 0.01, 2.58, Math.max(zb, zr1 + 0.3 * sz), rgb('#cfe0e6'), 0, { drift: 0 });
  }
  kit.box('wood', 23, 0.42, Math.min(zb - sz * 0.25, zb - sz * 0.7), 28.5, 0.5, Math.max(zb - sz * 0.25, zb - sz * 0.7), K.wood, 0.02);
  signs.board.quad(REGION.poster2, new THREE.Vector3(24.2, 1.45, zb - sz * 0.205), 1.3, 1.95, new THREE.Vector3(0, 0, -sz));
  signs.board.quad(REGION.poster1, new THREE.Vector3(27.2, 1.45, zb - sz * 0.205), 1.3, 1.95, new THREE.Vector3(0, 0, -sz));
  signs.board.quad(REGION.poster1, new THREE.Vector3(25.7, 1.45, zb + sz * 0.205), 1.3, 1.95, new THREE.Vector3(0, 0, sz));
  // Bus stop pole.
  kit.cyl('chrome', 29.9, 0, 4.5 * sz, 0.04, 0.04, 2.8, K.chrome, 6);
  kit.cyl('paint', 29.9, 2.8, 4.5 * sz, 0.28, 0.28, 0.06, K.terra, 14);
}

function pylon(kit: DecorKit, signs: Signs, sz: number, rng: () => number): void {
  // Collision: one monolith x ±0.8, z 18.5..24.5 (×sz), 0..12.6 m. A 1970s
  // terrazzo slab sign: brick plinth, bone shaft with terracotta racing
  // stripes, the vertical STARLIGHT panel on both long faces, marquee bulbs on
  // the ends, a capped top carrying the lit star.
  const z0 = Math.min(18.5 * sz, 24.5 * sz);
  const z1 = Math.max(18.5 * sz, 24.5 * sz);
  const zc = (z0 + z1) / 2;
  const H = 12.6;
  kit.box('concrete', -0.8, 0, z0, 0.8, H, z1, K.bone, 0.06, { base: 0, ao: 0.3 });
  kit.box('concrete', -0.86, 0, z0 - 0.06, 0.86, 1.1, z1 + 0.06, mix(K.sand, K.terraF, 0.45), 0.05, { base: 0, ao: 0.35 });
  kit.box('plaster', -0.87, 1.1, z0 - 0.07, 0.87, 1.22, z1 + 0.07, K.bone, 0.02, { ao: 0 });
  // Racing stripes down both long faces + the cap.
  for (const s of [-1, 1]) {
    for (const [a, col] of [
      [z0 + 0.25, K.terra],
      [z0 + 0.55, K.mustard],
      [z1 - 0.55, K.mustard],
      [z1 - 0.25, K.terra],
    ] as const) kit.box('paint', s * 0.8 - 0.02, 1.22, a - 0.1, s * 0.8 + 0.02, H - 0.35, a + 0.1, col, 0, { ao: 0, drift: 0.06 });
    signs.board.quad(REGION.pylon, new THREE.Vector3(s * 0.83, 6.9, zc), 3.5, 10.3, new THREE.Vector3(s, 0, 0));
  }
  kit.box('plaster', -0.95, H - 0.35, z0 - 0.15, 0.95, H, z1 + 0.15, K.terraF, 0.04, { ao: 0 });
  kit.box('concrete', -0.3, H, zc - 1.1, 0.3, H + 0.25, zc + 1.1, K.bone, 0.04, { ao: 0 });
  // Marquee bulbs on the narrow ends (a few still glow on the dead circuit).
  for (const zEnd of [z0 - 0.01, z1 + 0.01]) {
    for (let i = 0; i < 9; i++) {
      const lit = rng() < 0.45;
      kit.ball(lit ? 'glow' : 'chrome', 0, 2.0 + i * 1.1, zEnd, 0.11, 0.11, 0.06, lit ? rgb(ENV.glowGold, 1.3) : K.chrome, 0, { drift: 0 });
    }
  }
  // Star on top (lit).
  signs.lit.quad2(REGION.pylonStar, new THREE.Vector3(0, H + 1.4, zc), 2.6, 2.6, new THREE.Vector3(1, 0, 0));
  signs.lit.quad2(REGION.pylonStar, new THREE.Vector3(0, H + 1.4, zc), 2.6, 2.6, new THREE.Vector3(0, 0, 1));
  // Glowing ivy creeping up the shaded (east) face and over the plinth.
  climbingVine(kit, new THREE.Vector3(0.82, 0, zc - 1.6), 5.5, new THREE.Vector3(1, 0, 0), rng, 1.3);
  climbingVine(kit, new THREE.Vector3(0.82, 0, zc + 1.9), 3.2, new THREE.Vector3(1, 0, 0), rng, 1.1);
  for (let i = 0; i < 5; i++) hangingVine(kit, new THREE.Vector3(0.9, H - 0.4, z0 + 0.6 + i * 1.2), 0.8 + rng() * 2.4, rng, 1.2);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) kit.mound(s * (0.98 + rng() * 0.2), 0.28, z0 + 0.8 + i * 2.1, 0.5, 0.32, 0.6, mix(K.sage, K.olive, rng() * 0.4));
}

// ── Assembly ────────────────────────────────────────────────────────────────

/**
 * Trees (no collision): x, z, height, crown radius, blossom (soft-pink crown).
 * Along the bounds, in the yards, on the sidewalk strips and the lot corners
 * (trunks hug walls / corners; crowns stay above head height).
 */
export const TREES: readonly (readonly [number, number, number, number, boolean?])[] = [
  [-52.5, 38, 7, 3.2],
  [-52.5, -38, 7.5, 3.4],
  [52.5, 38.5, 7, 3.0],
  [52.5, -38.5, 6.6, 3.2],
  [45.2, 13.5, 6.4, 2.8],
  [45.2, -13.5, 6.8, 2.8],
  [-46.5, 11.2, 6.2, 2.6],
  [-46.5, -11.2, 6.6, 2.8],
  [-31.2, 38.5, 6, 2.6, true],
  [-31.2, -38.5, 5.6, 2.5],
  [-53, 8.5, 6.5, 2.6],
  [-53, -8.5, 7, 2.8],
  [-16.3, 38.6, 6.2, 2.5],
  [16.3, -38.6, 6.4, 2.6],
  [20.2, 38.7, 5.8, 2.4, true],
  [-20.2, -38.7, 6.0, 2.5],
];

export function buildProps(kit: DecorKit, signs: Signs, cards: CardBatch, rng: () => number): void {
  // Cars (collision boxes in src/shared/maps/pastel.ts).
  for (const sz of [1, -1]) {
    const Z = (z: number): number => z * sz;
    // Bungalow station wagons in the carports (x ∓52, z 28..33.5).
    car(kit, -52, Z(30.75), 5.5, 2, 1.3, 0, { body: sz > 0 ? K.sand : K.mint, wood: true, kind: 'wagon', flat: 0.05 }, rng, cards);
    car(kit, 52, Z(30.75), 5.5, 2, 1.3, 0, { body: sz > 0 ? K.terraF : K.bone, wood: sz > 0, kind: 'wagon' }, rng, cards);
    // Parking lot: wagon (x −10..−8, z 21..25.5) + sedan (x 6..10.5, z 27..29).
    // (Slightly askew, abandoned mid-manoeuvre: the yaw stays inside the
    // collision box to within a few cm.)
    car(kit, -9, Z(23.25), 4.35, 1.9, 1.3, sz > 0 ? 0.05 : -0.045, { body: sz > 0 ? K.yellow : K.blue, wood: true, kind: 'wagon', flat: 0.08, luggage: true }, rng, cards);
    car(kit, 8.25, Z(28), 4.35, 1.9, 1.3, Math.PI / 2 + (sz > 0 ? -0.05 : 0.055), { body: sz > 0 ? K.pink : K.sage, roof: K.bone, kind: 'sedan', doorOpen: true }, rng, cards);
    // Street: car at the east curb (x 41.5..43.5, z 19..23.5), camper at the west curb.
    car(kit, 42.5, Z(21.25), 4.5, 2, 1.3, 0, { body: sz > 0 ? K.mint : K.terraF, roof: K.bone, kind: 'sedan', flat: 0.1 }, rng, cards);
    car(kit, 32.3, Z(10), 5, 2.2, 2.2, 0, { body: sz > 0 ? K.blue : K.yellow, roof: K.bone, kind: 'van' }, rng, cards);
  }
  iceCreamVan(kit, signs, rng);
  pool(kit, rng);
  backyard(kit, signs, 1, rng, true);
  backyard(kit, signs, -1, rng, false);
  for (const sz of [1, -1]) {
    busShelter(kit, signs, sz);
    pylon(kit, signs, sz, rng);
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
  const hang = (p: THREE.Vector3, len: number): void => hangingVine(kit, p, len, rng, 1.3);
  for (const [x, z, h, r, blossom] of TREES) canopyTree(kit, cards, x, z, h, r, rng, { vines: blossom ? 1 : 3, tint: blossom ? LEAF.blossom : undefined }, hang);
  // Perimeter hedges + fence line along the bounds (visual; the bounds clamp).
  for (const sz of [1, -1]) {
    hedgeRow(kit, cards, -53.8, 53.6 * sz, -36, 53.6 * sz, 2.4, rng);
    hedgeRow(kit, cards, 30.5, 53.6 * sz, 53.8, 53.6 * sz, 2.2, rng);
  }
  for (const sx of [1, -1]) {
    hedgeRow(kit, cards, 53.7 * sx, -40, 53.7 * sx, -26, 2.3, rng);
    hedgeRow(kit, cards, 53.7 * sx, 26, 53.7 * sx, 40, 2.3, rng);
  }
  hedgeRow(kit, cards, -53.7, -12, -53.7, -4, 2.2, rng);
  hedgeRow(kit, cards, -53.7, 4, -53.7, 12, 2.2, rng);
  hedgeRow(kit, cards, 53.7, -14.5, 53.7, -6.5, 2.4, rng);
  hedgeRow(kit, cards, 53.7, 6.5, 53.7, 14.5, 2.4, rng);
  // Low chain-link fence (rails + posts) across the street ends behind the bulbs.
  for (const sz of [1, -1]) {
    for (let x = 30; x <= 46; x += 2) kit.cyl('chrome', x, 0, 53.9 * sz, 0.03, 0.03, 1.6, K.chrome, 5);
    kit.tube('chrome', new THREE.Vector3(30, 1.55, 53.9 * sz), new THREE.Vector3(46, 1.55, 53.9 * sz), 0.025, K.chrome, 4);
    kit.box('glass', 30, 0.05, 53.88 * sz - 0.01, 46, 1.55, 53.88 * sz + 0.01, rgb('#b9b6ae'), 0, { drift: 0 });
  }
}
