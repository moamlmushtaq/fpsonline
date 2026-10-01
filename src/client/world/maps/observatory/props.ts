// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Observatory prop dressing (all merged into the decor kit).
//
//  • Prop builders: stencilled plank crates with skids, corner steel and snow
//    caps; ribbed equipment cases with latches; ribbed fuel drums; jerrycans;
//    lamp posts with warm pools; icicle rows; guy-wires; lumpy snow caps.
//  • Placement (buildProps): icicles under every eave, warm window light spilled
//    onto the snow, lamp posts hugging the courtyard crate stacks, case stacks
//    filling the empty tops of the crate / sled collision boxes (no invisible
//    walls), snowcat kit, drum dumps on the rim past the bounds, snow-capped rock
//    outcrops, guy-wired antennas, a weather station on the dome roof whose
//    anemometer spins, and a lunch box + thermos left on the receiver cabinet.
// Every free-standing prop sits inside existing collision, on unreachable
// roofs, or past the playable bounds: nothing non-colliding stands in a lane.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { OBS } from '../../../../shared/maps/observatory';
import { ENV } from '../../../engine/palette';
import { box, cyl, cylAB, floorQuad, ObsKit, rbox, sphere } from './kit';
import { prect, type PropName } from './propatlas';
import { noise3, rockBox } from './rocks';

type Rect = [number, number, number, number];

/** Remaps a BoxGeometry's per-face UVs (order +x, −x, +y, −y, +z, −z) into atlas rects. */
function faceUV(g: THREE.BufferGeometry, rects: Rect[]): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const r = rects[f];
    for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
  }
  return g;
}

/** Box (corners) with atlas UVs: `side` on the long faces, `end` on the short ones, `top` above. */
export function uvBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, side: PropName, end: PropName, top: PropName): THREE.BufferGeometry {
  const g = box(x0, y0, z0, x1, y1, z1);
  const S = prect(side), E = prect(end), T = prect(top);
  const longX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  return faceUV(g, longX ? [E, E, T, T, S, S] : [S, S, T, T, E, E]);
}

/** Cylinder UVs: side band + caps from the atlas (CylinderGeometry groups: side, top, bottom). */
function uvCyl(g: THREE.CylinderGeometry, side: Rect, cap: Rect): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const index = g.index!;
  const done = new Uint8Array(uv.count);
  g.groups.forEach((grp, gi) => {
    const r = gi === 0 ? side : cap;
    for (let k = grp.start; k < grp.start + grp.count; k++) {
      const i = index.getX(k);
      if (done[i]) continue;
      done[i] = 1;
      uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
    }
  });
  return g;
}

/** Lumpy snow cap on a horizontal top (x0..x1 × z0..z1 at y). */
export function snowCap(kit: ObsKit, x0: number, y: number, z0: number, x1: number, z1: number, thick: number, seed = 0): void {
  const w = x1 - x0, d = z1 - z0;
  const mx = kit.low ? 2 : 5;
  const sx = Math.max(2, Math.min(mx, Math.round(w / 0.5)));
  const sz = Math.max(2, Math.min(mx, Math.round(d / 0.5)));
  const g = new THREE.BoxGeometry(w, thick, d, sx, 1, sz);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const lx = p.getX(i), ly = p.getY(i), lz = p.getZ(i);
    if (ly > 0) {
      const ex = 1 - Math.pow(Math.abs(lx) / (w / 2), 4);
      const ez = 1 - Math.pow(Math.abs(lz) / (d / 2), 4);
      const n = noise3((x0 + lx) * 2.1 + seed, 0.3, (z0 + lz) * 2.1);
      // Pillowy middle, thin rolled edges, wind-thinned on the windward (−x) side.
      p.setY(i, ly * (0.35 + 0.9 * Math.min(ex, ez) * (0.7 + 0.6 * n)) * (0.8 + 0.2 * (lx / w + 0.5)));
    }
    // Rolled edge overhang.
    p.setX(i, lx * (1 + (ly > 0 ? 0.02 : 0.04)));
    p.setZ(i, lz * (1 + (ly > 0 ? 0.02 : 0.04)));
  }
  g.computeVertexNormals();
  g.translate((x0 + x1) / 2, y + thick / 2 - 0.01, (z0 + z1) / 2);
  kit.add('snow', g, ENV.snow, { flat: true });
}

/**
 * A stencilled plank crate exactly covering x0..x1 × y0..y1 × z0..z1: skids,
 * corner steel, optional rope lashing and a snow cap.
 */
export function crate(kit: ObsKit, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color = '#c9b49a', variant = 0, cap = true): void {
  const longX = x1 - x0 >= z1 - z0;
  kit.add('prop', uvBox(x0, y0, z0, x1, y1, z1, variant % 2 ? 'crateB' : 'crateA', 'crateEnd', 'crateEnd'), color, { base: y0, snow: 0 });
  const dark = '#5e4a3a';
  // Skids under the long axis (inside the footprint).
  if (y0 < 0.05 && y1 - y0 > 0.5) {
    for (const f of [0.18, 0.82]) {
      if (longX) {
        const z = z0 + (z1 - z0) * f;
        kit.add('wood', box(x0 + 0.02, y0, z - 0.07, x1 - 0.02, y0 + 0.1, z + 0.07), dark, { flat: true, snow: 0 });
      } else {
        const x = x0 + (x1 - x0) * f;
        kit.add('wood', box(x - 0.07, y0, z0 + 0.02, x + 0.07, y0 + 0.1, z1 - 0.02), dark, { flat: true, snow: 0 });
      }
    }
  }
  // Corner steel (proud by 1 cm).
  const e = 0.012, t = 0.07;
  for (const [cx, cz] of [
    [x0, z0],
    [x1, z0],
    [x0, z1],
    [x1, z1],
  ]) {
    const sx = cx === x0 ? 1 : -1, sz = cz === z0 ? 1 : -1;
    kit.add('metal', box(cx - sx * e, y0 + 0.02, cz - sz * e, cx + sx * t, y1 - 0.02, cz + sz * t), '#4b4c52', { flat: true, snow: 0 });
  }
  if (cap) snowCap(kit, x0 + 0.03, y1, z0 + 0.03, x1 - 0.03, z1 - 0.03, 0.06 + 0.06 * noise3(x0, y1, z0), x0 + z0);
}

/** Rope lashing around a box (two hoops across the long axis). */
export function lashing(kit: ObsKit, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const longX = x1 - x0 >= z1 - z0;
  for (const f of [0.3, 0.7]) {
    if (longX) {
      const x = x0 + (x1 - x0) * f;
      kit.add('fabric', box(x - 0.03, y1, z0 - 0.02, x + 0.03, y1 + 0.02, z1 + 0.02), '#6b5a46', { flat: true, snow: 0 });
      for (const z of [z0 - 0.02, z1]) kit.add('fabric', box(x - 0.03, y0 + 0.1, z, x + 0.03, y1 + 0.02, z + 0.02), '#6b5a46', { flat: true, snow: 0 });
    } else {
      const z = z0 + (z1 - z0) * f;
      kit.add('fabric', box(x0 - 0.02, y1, z - 0.03, x1 + 0.02, y1 + 0.02, z + 0.03), '#6b5a46', { flat: true, snow: 0 });
      for (const x of [x0 - 0.02, x1]) kit.add('fabric', box(x, y0 + 0.1, z - 0.03, x + 0.02, y1 + 0.02, z + 0.03), '#6b5a46', { flat: true, snow: 0 });
    }
  }
}

/** Moulded equipment case standing at (cx, y0, cz): w along x (before rotY), d along z, h tall. */
export function equipCase(kit: ObsKit, cx: number, y0: number, cz: number, w: number, d: number, h: number, rotY: number, color: string, cap = true): void {
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(cx, y0, cz);
  const g = faceUV(box(-w / 2, 0, -d / 2, w / 2, h, d / 2), [prect('caseTop'), prect('caseTop'), prect('caseTop'), prect('caseTop'), prect('caseSide'), prect('caseSide')]);
  kit.add('prop', g, color, { base: y0, snow: 0 }, m);
  // Feet + carry handle on the lid.
  kit.add('metal', box(-w / 2 + 0.04, h, -0.03, w / 2 - 0.04, h + 0.012, 0.03), '#3b3c42', { flat: true, snow: 0 }, m);
  if (cap) {
    const g2 = new THREE.BoxGeometry(w * 0.86, 0.035, d * 0.8, 3, 1, 2);
    g2.translate(0.04 * w, h + 0.012, 0);
    kit.add('snow', g2, ENV.snow, { flat: true }, m);
  }
}

/** Ribbed 200 L fuel drum (r 0.29, 0.88 tall) — upright, or tipped on its side (`lie` = yaw). */
export function drum(kit: ObsKit, x: number, y0: number, z: number, color: string, lie: number | null = null, capSnow = true): void {
  const seg = kit.low ? 10 : 16;
  const body = uvCyl(new THREE.CylinderGeometry(0.29, 0.29, 0.88, seg, 1), prect('drum'), prect('drumTop'));
  const ribs = [new THREE.CylinderGeometry(0.3, 0.3, 0.035, seg, 1, true).translate(0, -0.15, 0), new THREE.CylinderGeometry(0.3, 0.3, 0.035, seg, 1, true).translate(0, 0.15, 0)];
  const rim = new THREE.CylinderGeometry(0.295, 0.295, 0.04, seg, 1, true).translate(0, 0.43, 0);
  const m = new THREE.Matrix4();
  if (lie === null) m.makeRotationY(x * 1.7 + z).setPosition(x, y0 + 0.44, z);
  else m.makeRotationY(lie).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).setPosition(x, y0 + 0.29, z);
  kit.add('prop', body, color, { base: y0, snow: lie === null ? 0 : 0.8 }, m);
  for (const r of [...ribs, rim]) kit.add('metal', r, '#5d5e63', { flat: true, snow: 0 }, m);
  if (capSnow && lie === null) {
    const s = new THREE.CylinderGeometry(0.24, 0.27, 0.06, seg, 1);
    s.translate(0.02, 0.47, 0);
    kit.add('snow', s, ENV.snow, { flat: true }, m);
  }
}

/** Jerrycan (0.35 × 0.17 × 0.47) standing at (x, y0, z). */
export function jerrycan(kit: ObsKit, x: number, y0: number, z: number, rotY: number, color: string): void {
  const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y0, z);
  const J = prect('jerry');
  kit.add('prop', faceUV(box(-0.085, 0, -0.175, 0.085, 0.47, 0.175), [J, J, J, J, J, J]), color, { base: y0, snow: 0 }, m);
  kit.add('metal', box(-0.03, 0.47, -0.16, 0.03, 0.53, 0.02), '#3b3c42', { flat: true, snow: 0 }, m);
  kit.add('metal', cyl(0, 0.47, 0.11, 0.03, 0.05, 6), '#3b3c42', { flat: true, snow: 0 }, m);
}

/** Lamp post (thin, hugging a corner), warm head, a pool on the snow. */
export function lampPost(kit: ObsKit, x: number, z: number, armX: number, armZ: number, h = 3.8): void {
  kit.add('metal', cylAB(x, 0, z, x, 0.35, z, 0.11, 0.09, 8), '#34302c', { flat: true });
  kit.add('metal', cylAB(x, 0.35, z, x, h, z, 0.055, 0.045, 6), '#34302c', { flat: true });
  const hx = x + armX * 0.55, hz = z + armZ * 0.55;
  kit.add('metal', cylAB(x, h - 0.05, z, hx, h, hz, 0.03, 0.03, 4), '#34302c', { flat: true });
  kit.add('metal', cylAB(hx, h + 0.02, hz, hx, h - 0.16, hz, 0.06, 0.2, 8, true), '#2e2d31', { flat: true, snow: 0.8 });
  kit.add('glow', sphere(hx, h - 0.17, hz, 0.1, 8, 5), ENV.glowGold, { k: 3.2, flat: true });
  kit.add('pool', floorQuad(hx + armX * 0.4, 0.045, hz + armZ * 0.4, 5.2, 5.2), ENV.glowGold, { k: 0.55, flat: true });
  // A little snow on the arm.
  kit.add('snow', cylAB(x, h + 0.05, z, hx, h + 0.06, hz, 0.025, 0.025, 4), ENV.snow, { flat: true });
}

/** A row of icicles hanging under an eave from a to b (base at the given y's). */
export function icicles(kit: ObsKit, ax: number, ay: number, az: number, bx: number, by: number, bz: number, rnd: () => number, maxLen = 0.6, density = 1): void {
  const len = Math.hypot(bx - ax, bz - az);
  const stepBase = (kit.low ? 0.7 : 0.32) / density;
  const sides = kit.low ? 3 : 5;
  for (let s = rnd() * stepBase; s < len; s += stepBase * (0.6 + rnd() * 0.9)) {
    // Clusters: a long one with short ones around it, gaps between clusters.
    const cl = noise3(ax + s * 0.7, ay, az + s * 0.7);
    if (cl < 0.32) continue;
    const t = s / len;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
    const L = maxLen * (0.15 + 0.85 * Math.pow(rnd(), 1.6)) * (0.5 + cl);
    const r = 0.018 + L * 0.06;
    const g = new THREE.ConeGeometry(r, L, sides, 1, true);
    g.rotateX(Math.PI);
    g.translate(x, y - L / 2 + 0.01, z);
    kit.add('ice', g, '#e9effa', { flat: true });
  }
}

/** Thin guy-wire. */
export function guy(kit: ObsKit, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  kit.add('metal', cylAB(ax, ay, az, bx, by, bz, 0.01, 0.01, 3), '#2f2e34', { flat: true, snow: 0 });
}

// ── Placement ───────────────────────────────────────────────────────────────

export interface PropParts {
  /** Anemometer cups (spin in update). */
  cups: THREE.Group;
  cupKit: ObsKit;
}

export function buildProps(kit: ObsKit, root: THREE.Object3D, rnd: () => number, decor: number): PropParts {
  buildIcicles(kit, rnd, decor);
  buildWindowLight(kit);
  buildCourtProps(kit, rnd, decor);
  buildRimProps(kit, rnd, decor);
  buildAntennas(kit);
  return buildWeatherStation(kit, root);
}

function buildIcicles(kit: ObsKit, rnd: () => number, decor: number): void {
  kit.section = 'props.icicles';
  const d = decor;
  const DM = OBS.dorm;
  const H = DM.h;
  // Dorm roof (underside at H), skipping the arcade junction on the west side.
  icicles(kit, DM.x1 + 0.15, H, -DM.z - 0.15, DM.x1 + 0.15, H, DM.z + 0.15, rnd, 0.7, d);
  for (const s of [-1, 1]) {
    icicles(kit, DM.x0 - 0.15, H, s * 2.6, DM.x0 - 0.15, H, s * (DM.z + 0.15), rnd, 0.6, d);
    icicles(kit, DM.x0 - 0.15, H, s * (DM.z + 0.15), DM.x1 + 0.15, H, s * (DM.z + 0.15), rnd, 0.65, d);
  }
  // Generator / boiler house cornice and the maintenance shed / fuel store.
  for (const s of [-1, 1]) {
    const g0 = s > 0 ? 15 : -24, g1 = s > 0 ? 24 : -15;
    const y = OBS.genTop - 0.1;
    icicles(kit, 17.85, y, g0 - 0.15, 17.85, y, g1 + 0.15, rnd, 0.8, d);
    icicles(kit, 26.15, y, g0 - 0.15, 26.15, y, g1 + 0.15, rnd, 0.9, d);
    icicles(kit, 17.85, y, s > 0 ? g1 + 0.15 : g0 - 0.15, 26.15, y, s > 0 ? g1 + 0.15 : g0 - 0.15, rnd, 0.8, d);
    const z0 = s > 0 ? 20 : -27.5, z1 = s > 0 ? 27.5 : -20;
    icicles(kit, 34.3, 3.1, z0 - 0.3, 34.3, 3.1, z1 + 0.3, rnd, 0.45, d);
    icicles(kit, 43.2, 3.1, z0 - 0.3, 43.2, 3.1, z1 + 0.3, rnd, 0.55, d);
    icicles(kit, 34.3, 3.1, s > 0 ? z1 + 0.3 : z0 - 0.3, 43.2, 3.1, s > 0 ? z1 + 0.3 : z0 - 0.3, rnd, 0.45, d);
    // Arcade roofs (both long edges, east and west arcades).
    for (const [xa, xb] of [
      [OBS.baseHalf + 0.3, DM.x0 - 0.3],
      [-24 + 0.3, -OBS.baseHalf - 0.3],
    ]) {
      icicles(kit, xa, OBS.arcadeRoof, s * (OBS.arcadeHalf + 0.25), xb, OBS.arcadeRoof, s * (OBS.arcadeHalf + 0.25), rnd, 0.4, d);
    }
    // Signal-hut roofs on the ridge paths, deck control booths.
    const hz0 = s > 0 ? 21 : -25, hz1 = s > 0 ? 25 : -21;
    icicles(kit, -52.25, OBS.ridge + 2.8, hz0 - 0.25, -52.25, OBS.ridge + 2.8, hz1 + 0.25, rnd, 0.5, d);
    const b0 = s > 0 ? 5 : -7.5, b1 = s > 0 ? 7.5 : -5;
    icicles(kit, 47.3, OBS.deck + 2.4, b0 - 0.2, 47.3, OBS.deck + 2.4, b1 + 0.2, rnd, 0.35, d);
  }
  // Dome base cornice (long icicles in the shade of the north and west faces).
  const B = OBS.baseHalf + 0.3;
  const y = OBS.baseTop - 0.45;
  for (const s of [-1, 1]) {
    icicles(kit, -B, y, s * B, B, y, s * B, rnd, 1.0, d);
    icicles(kit, s * B, y, -B, s * B, y, B, rnd, 1.0, d);
  }
  // Wheelhouse, spectrograph hut, the winter quarters' eave and the terminal roof.
  icicles(kit, 49.8, OBS.wheelTop, -3.8, 49.8, OBS.wheelTop, 3.8, rnd, 0.7, d);
  icicles(kit, -27.8, 3.1, -3.2, -27.8, 3.1, 3.2, rnd, 0.4, d);
  icicles(kit, -17.5, 4.2, -59.6, 5.5, 4.2, -59.6, rnd, 0.7, d);
  icicles(kit, -16, 7.0, 59, 16, 7.0, 59, rnd, 0.9, d);
}

/** Warm window light spilled onto the snow below lit windows (additive, draped). */
function buildWindowLight(kit: ObsKit): void {
  kit.section = 'props.windowLight';
  const DM = OBS.dorm;
  const warm = ENV.glowGold;
  for (let z = -13; z <= 13; z += 2.6) {
    if (Math.abs(z) >= 2.4) kit.add('pool', floorQuad(DM.x0 - 1.1, 0.045, z, 1.7, 1.5), warm, { k: 0.32, flat: true });
    const nearDoor = Math.abs(z) < 2.6 || Math.abs(Math.abs(z) - 8) < 2;
    if (!nearDoor) kit.add('pool', floorQuad(DM.x1 + 1.1, 0.045, z, 1.7, 1.5), warm, { k: 0.32, flat: true });
  }
  for (const s of [-1, 1]) {
    for (const x of [26.3, 33]) kit.add('pool', floorQuad(x, 0.045, s * (DM.z + 1.1), 1.5, 1.7), warm, { k: 0.3, flat: true });
    // Generator clerestories (high, a broad soft spill) and louvers.
    const g0 = s > 0 ? 15 : -24, g1 = s > 0 ? 24 : -15;
    for (const x of [19.4, 22, 24.6]) kit.add('pool', floorQuad(x, 0.045, s > 0 ? g1 + 1.6 : g0 - 1.6, 2.4, 2.4), '#ffb36b', { k: 0.3, flat: true });
    for (const z of [g0 + 2.2, (g0 + g1) / 2, g1 - 2.2]) kit.add('pool', floorQuad(16.6, 0.045, z, 2.2, 2.2), warm, { k: 0.18, flat: true });
    // Shed windows on the spawn-facing back and the dorm passage.
    const z0 = s > 0 ? 20 : -27.5, z1 = s > 0 ? 27.5 : -20;
    const back = s > 0 ? z1 : z0;
    for (const x of [36.4, 38.4]) kit.add('pool', floorQuad(x, 0.045, back + s * 1.0, 1.4, 1.3), warm, { k: 0.3, flat: true });
    // Dome base slit windows: a long warm wash at the foot of each face.
    for (const a of [-8.25, -4.95, 4.95, 8.25]) {
      kit.add('pool', floorQuad(a, 0.045, s * (OBS.baseHalf + 1.3), 1.4, 1.9), warm, { k: 0.16, flat: true });
      kit.add('pool', floorQuad(s * (OBS.baseHalf + 1.3), 0.045, a, 1.9, 1.4), warm, { k: 0.16, flat: true });
    }
  }
}

function buildCourtProps(kit: ObsKit, rnd: () => number, decor: number): void {
  kit.section = 'props.court';
  for (const s of [-1, 1] as const) {
    const zr = (a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a]);
    // Lamp posts hugging the crate stacks and the generator corner (warm pools on the paths).
    lampPost(kit, -15.82, s * 30.68, 0.6, s * 0.8);
    lampPost(kit, 12.32, s * 26.82, -0.7, -s * 0.7);
    lampPost(kit, 17.82, s * 14.82, -0.8, -s * 0.6);
    lampPost(kit, 49.32, s * 27.32, -0.8, -s * 0.6);
    // Case stacks filling the empty tops of the crate-stack collision boxes.
    {
      const [a, b] = zr(27.5, 30.5);
      equipCase(kit, -17.55, 2.1, (a + b) / 2, 2.6, 1.0, 0.68, 0, s > 0 ? '#a3ad8f' : '#c99a82');
    }
    {
      const [a, b] = zr(27, 29.6);
      equipCase(kit, 17.05, 2.3, (a + b) / 2, 1.6, 1.0, 0.48, 0.05, '#efdca6');
      lashing(kit, 13, 1.5, a + 0.15, 16.2, 2.8, b - 0.15);
    }
    {
      const [a, b] = zr(13.5, 15.5);
      equipCase(kit, 15.85, 1.2, (a + b) / 2, 1.2, 1.7, 0.62, 0, '#8e968a');
      equipCase(kit, 15.85, 1.82, (a + b) / 2 - 0.2, 1.0, 1.1, 0.36, 0.06, '#c99a82');
    }
    // Equipment sled: a stack of instrument cases beside the crate (fills the collision box).
    {
      const [a, b] = zr(25.5, 27.6);
      const zc = (a + b) / 2;
      if (s > 0) {
        equipCase(kit, 2.15, 0.9, zc, 1.6, 1.8, 0.75, 0, '#8e968a');
        equipCase(kit, 2.1, 1.65, zc + 0.1, 1.4, 1.4, 0.62, 0.08, '#b9cfda');
        equipCase(kit, 2.15, 2.27, zc - 0.15, 1.1, 0.9, 0.45, -0.1, '#efdca6');
      } else {
        equipCase(kit, 1.85, 1.7, zc, 1.9, 0.75, 0.42, 0, '#a3ad8f');
        jerrycan(kit, 2.6, 2.12, zc + 0.15, 0.2, '#c99a82');
      }
    }
    // Snowcat (S): roof rack with jerrycans + cases, whip antenna, exhaust, mirrors, plow blade.
    if (s > 0) {
      const [z0, z1] = zr(17, 20);
      kit.add('metal', box(-17.1, 1.6, z0 + 0.85, -15.7, 1.66, z1 - 0.85), '#2e2d31', { flat: true, snow: 0.9 });
      for (const zz of [z0 + 1.0, z1 - 1.0]) kit.add('metal', box(-17.1, 1.66, zz - 0.02, -15.7, 1.8, zz + 0.02), '#2e2d31', { flat: true, snow: 0 });
      jerrycan(kit, -16.55, 1.66, z1 - 1.1, 0, '#c99a82');
      jerrycan(kit, -16.15, 1.66, z1 - 1.1, 0, '#a3ad8f');
      kit.add('metal', cylAB(-12.6, 2.3, z0 + 0.95, -12.6, 4.3, z0 + 0.95, 0.012, 0.008, 3), '#2e2d31', { flat: true, snow: 0 });
      kit.add('fabric', box(-12.6, 4.0, z0 + 0.95, -12.25, 4.22, z0 + 0.96), ENV.pastelYellow, { flat: true, snow: 0 });
      kit.add('metal', cylAB(-15.0, 2.3, z1 - 0.95, -15.0, 2.75, z1 - 0.95, 0.06, 0.05, 6), '#34302c', { flat: true, snow: 0 });
      for (const zz of [z0 + 0.72, z1 - 0.72]) kit.add('metal', box(-12.5, 1.75, zz - 0.02, -12.38, 1.95, zz + 0.02), '#34302c', { flat: true, snow: 0 });
      kit.add('metal', box(-12.2, 0.15, z0 + 0.05, -12.02, 0.95, z1 - 0.05), '#d9c28a', { flat: true, snow: 1 });
      kit.add('glow', box(-12.25, 1.1, z1 - 1.1, -12.2, 1.3, z1 - 0.8), ENV.glowGold, { k: 1.6, flat: true });
    } else {
      // Fuel sled (N): jerrycans strapped along the tank, a hand pump on top.
      const [z0, z1] = zr(17, 20);
      for (const x of [-16.9, -16.5, -12.85]) jerrycan(kit, x, 0.45, z1 - 0.35, 0, '#c99a82');
      kit.add('metal', cylAB(-14.7, 2.28, (z0 + z1) / 2, -14.7, 2.3 - 0.01, (z0 + z1) / 2, 0.12, 0.12, 8), '#34302c', { flat: true });
    }
    // Crates of the spawn porches' lee? No — keep lanes clean. Ground clutter only past the rim.
    void rnd;
    void decor;
  }
  // The lunch box + thermos left on the receiver cabinet at Zone A (someone was here at 7:40).
  const R = OBS.ridge;
  const m = new THREE.Matrix4().makeRotationY(0.35).setPosition(-45.25, R + 1.2, -0.45);
  kit.add('prop', faceUV(box(-0.17, 0, -0.1, 0.17, 0.2, 0.1), [prect('lunch'), prect('lunch'), prect('lunch'), prect('lunch'), prect('lunch'), prect('lunch')]), '#ffffff', { flat: true, snow: 0 }, m);
  kit.add('metal', box(-0.07, 0.2, -0.015, 0.07, 0.24, 0.015), '#3b3c42', { flat: true, snow: 0 }, m);
  kit.add('gloss', cyl(-45.25, R + 1.2, 0.35, 0.05, 0.28, 10), '#c99a82', { flat: true, snow: 0 });
  kit.add('metal', cyl(-45.25, R + 1.48, 0.35, 0.052, 0.06, 10), '#34302c', { flat: true, snow: 0 });
}

/** Rim dressing past the playable bounds: drum dumps, snow-capped rock outcrops. */
function buildRimProps(kit: ObsKit, rnd: () => number, decor: number): void {
  kit.section = 'props.rim';
  const drums = [ENV.pastelBlue, ENV.terracottaFaded, ENV.sage, '#8e968a', ENV.pastelYellow];
  for (const s of [-1, 1]) {
    // East rim strip (x 57.1–58.4): a drum dump behind the tarp cabin and by the deck ramp.
    const dump: [number, number, number | null][] = [
      [57.55, 33.2, null],
      [58.15, 33.8, null],
      [57.6, 34.0, null],
      [57.8, 35.0, 0.3],
      [57.6, 18.5, null],
      [58.2, 19.1, null],
      [57.75, 21.0, 1.2],
    ];
    dump.forEach(([x, z, lie], i) => drum(kit, x, 0, s * z, drums[(i + (s > 0 ? 0 : 2)) % drums.length], lie));
    // Snow-capped rock outcrops breaking through on the rim.
    if (decor > 0.4) {
      for (const [x0, z0, x1, z1, h] of [
        [57.6, 23, 59.2, 26.2, 1.4],
        [57.6, 11, 59, 13.5, 0.9],
        [57.7, 37, 59.4, 40.6, 1.7],
      ] as const) {
        rockBox(kit, x0, -0.4, s > 0 ? z0 : -z1, x1, h, s > 0 ? z1 : -z0, { amp: 0.35, crest: 0.45, seg: 0.8, color: '#7a7488', fins: 0.6 });
      }
    }
  }
  // Behind the winter quarters (BLOOM): a fuel dump by the generator hut.
  for (const [x, z, lie] of [
    [16.2, -60.9, null],
    [16.85, -61.3, null],
    [16.4, -61.7, null],
    [17.4, -60.8, 0.6],
  ] as [number, number, number | null][]) {
    drum(kit, x, 0, z, ENV.terracottaFaded, lie);
  }
  // Beside the upper terminal (HALCYON): a stack of crates waiting for the tram.
  crate(kit, 22, 0, 60.6, 24.2, 1.1, 61.8, '#c9b49a', 0);
  crate(kit, 24.4, 0, 60.7, 25.8, 0.9, 61.7, '#b9a184', 1);
  crate(kit, 22.3, 1.1, 60.8, 23.9, 1.9, 61.6, '#d3bfa3', 1);
  void rnd;
}

/** Guy-wired antennas: dorm long-wire masts, signal-hut whips, the generator stacks. */
function buildAntennas(kit: ObsKit): void {
  kit.section = 'props.guys';
  const DM = OBS.dorm;
  const RT = DM.roofTop;
  for (const s of [-1, 1]) {
    const z = s * 13;
    for (const [gx, gz] of [
      [DM.x0 + 0.4, z],
      [DM.x1 - 0.2, z + s * 1.8],
      [33.6, z - s * 6],
    ]) {
      guy(kit, 33.6, RT + 4.2, z, gx, RT + 0.05, gz);
    }
    // Signal-hut whips.
    const hz = s * 23;
    for (const [gx, gz] of [
      [-57.4, hz + 1.8],
      [-52.6, hz - 1.8],
    ]) {
      guy(kit, -55, OBS.ridge + 5.6, hz, gx, OBS.ridge + 2.95, gz);
    }
  }
  // Generator stacks (S) braced to the roof corners.
  const RT2 = OBS.genTop + 0.15;
  for (const x of [20, 24]) {
    guy(kit, x, RT2 + 2.6, 19.5, x - 1.6, RT2, 15.4);
    guy(kit, x, RT2 + 2.6, 19.5, x + (x < 22 ? -1.7 : 1.7), RT2, 23.6);
  }
}

/** Weather station on the dome roof deck (NE corner): mast, Stevenson screen, spinning anemometer. */
function buildWeatherStation(kit: ObsKit, root: THREE.Object3D): PropParts {
  kit.section = 'props.weather';
  const x = 10.4, z = -10.4, y = OBS.baseTop + 0.1;
  kit.add('metal', cylAB(x, y, z, x, y + 4.4, z, 0.05, 0.04, 6), '#d6d0c4', { flat: true, snow: 0.3 });
  kit.add('metal', cylAB(x - 0.7, y + 3.9, z, x + 0.7, y + 3.9, z, 0.025, 0.025, 4), '#d6d0c4', { flat: true, snow: 0.6 });
  for (const [gx, gz] of [
    [x - 1.4, z + 1.2],
    [x + 1.3, z + 1.4],
    [x + 1.4, z - 1.2],
  ]) {
    guy(kit, x, y + 3.6, z, gx, y, gz);
  }
  // Stevenson screen on legs (louvered white box), a little solar panel, a cable to the drum.
  const sx = x - 1.6, sz = z + 0.4;
  for (const [lx, lz] of [
    [-0.3, -0.25],
    [0.3, -0.25],
    [-0.3, 0.25],
    [0.3, 0.25],
  ]) {
    kit.add('metal', cylAB(sx + lx, y, sz + lz, sx + lx, y + 1.1, sz + lz, 0.02, 0.02, 4), '#d6d0c4', { flat: true });
  }
  kit.add('paint', rbox(sx - 0.38, y + 1.1, sz - 0.3, sx + 0.38, y + 1.75, sz + 0.3, 0.02), '#f0ebe1', { base: y + 1.1, snow: 0 });
  for (let yy = y + 1.18; yy < y + 1.7; yy += 0.08) kit.add('paint', box(sx - 0.39, yy, sz - 0.31, sx + 0.39, yy + 0.015, sz + 0.31), '#b8b2a8', { flat: true, snow: 0 });
  kit.add('paint', box(sx - 0.45, y + 1.75, sz - 0.36, sx + 0.45, y + 1.82, sz + 0.36), '#f0ebe1', { flat: true, snow: 1 });
  kit.add('metal', box(x + 0.15, y + 2.2, z - 0.3, x + 0.2, y + 2.8, z + 0.3), '#2a2d44', { flat: true, snow: 0 });
  kit.add('glow', sphere(x, y + 4.5, z, 0.06, 6, 4), ENV.glowSoftPink, { k: 2.4, flat: true });
  // Anemometer: three cups on arms (own group, spins in the wind).
  const cups = new THREE.Group();
  cups.name = 'obs.anemometer';
  cups.position.set(x + 0.7, y + 4.0, z);
  const ck = new ObsKit(kit.ctx, 'obs.anemometer');
  ck.snowDefault = 0;
  ck.add('metal', cylAB(0, -0.1, 0, 0, 0.12, 0, 0.02, 0.02, 5), '#d6d0c4', { flat: true });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const cx = Math.cos(a) * 0.32, cz = Math.sin(a) * 0.32;
    ck.add('metal', cylAB(0, 0.1, 0, cx, 0.1, cz, 0.008, 0.008, 3), '#d6d0c4', { flat: true });
    const cup = new THREE.SphereGeometry(0.075, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    cup.rotateZ(Math.PI / 2);
    cup.rotateY(-a);
    cup.translate(cx, 0.1, cz);
    ck.add('metal', cup, '#e8e2d6', { flat: true });
  }
  ck.build(cups);
  root.add(cups);
  // Wind vane on the other arm end (static, pointing downwind).
  kit.add('metal', box(x - 0.95, y + 3.98, z - 0.01, x - 0.45, y + 4.12, z + 0.01), '#d6d0c4', { flat: true, snow: 0 });
  // A small refractor on its tripod by the parapet, half under a lashed tarp (the
  // observers' guide scope), and an instrument case open beside it.
  {
    const tx = 10.7, tz = -8.0;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      kit.add('metal', cylAB(tx, y + 1.25, tz, tx + Math.cos(a) * 0.55, y, tz + Math.sin(a) * 0.55, 0.022, 0.018, 4), '#55585c', { flat: true, snow: 0.6 });
    }
    kit.add('metal', cyl(tx, y + 1.2, tz, 0.09, 0.14, 8), '#34302c', { flat: true });
    const tube = new THREE.Matrix4().makeTranslation(tx, y + 1.42, tz).multiply(new THREE.Matrix4().makeRotationY(-0.6)).multiply(new THREE.Matrix4().makeRotationZ(-0.95));
    kit.add('paint', cyl(0, -0.55, 0, 0.085, 1.25, 12), '#ece5d8', { flat: true, snow: 0 }, tube);
    kit.add('metal', cyl(0, 0.7, 0, 0.1, 0.22, 12, 0.1, true), '#34302c', { flat: true, snow: 0 }, tube);
    kit.add('metal', cyl(0, -0.75, 0, 0.04, 0.2, 8), '#34302c', { flat: true, snow: 0 }, tube);
    kit.add('fabric', rbox(tx - 0.45, y + 1.05, tz - 0.4, tx + 0.2, y + 1.5, tz + 0.35, 0.15, 2), ENV.terracottaFaded, { base: y + 1.05 });
    equipCase(kit, tx - 1.1, y, tz + 0.6, 0.8, 0.5, 0.32, 0.4, '#8e968a');
  }
  // Cable down to the drum.
  kit.add('metal', cylAB(x, y + 0.6, z, 8.3, y + 0.05, -8.3, 0.015, 0.015, 3), '#2f2e34', { flat: true, snow: 0 });
  return { cups, cupKit: ck };
}

