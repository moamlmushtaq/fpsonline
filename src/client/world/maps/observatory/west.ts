// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Observatory WEST lane: the ridge along the cliff and the
// SIGNAL ARRAY (Zone A).
//
//  • The ridge: one faceted rock formation (plateau + paths + ramps) whose west
//    face IS the summit cliff; a rope-and-post rail along the rim.
//  • Two big radio dishes on alt-az mounts (animated: they slowly track),
//    guyed lattice masts on the rim with blinking tips, strings of pastel
//    signal pennants flapping in the wind, cable reels, the frozen receiver
//    cabinet at the zone, signal huts on the paths.
//  • Below: the under-ridge yard (boulders, the rib, the forecourt outcrop),
//    the spectrograph hut with its own little dome, spare dome segments.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { OBS } from '../../../../shared/maps/observatory';
import { ENV } from '../../../engine/palette';
import { rect } from './atlas';
import { beam, box, cable, cyl, cylAB, lathe, lattice, ObsKit, quad, rbox, sphere, floorQuad } from './kit';
import { boulder, drift, lichen, ROCK, ROCK_DARK, rockBox, rockFace } from './rocks';

const R = OBS.ridge;

export interface WestParts {
  dishes: { group: THREE.Group; base: number; speed: number; phase: number }[];
  masts: THREE.Vector3[];
  pennants: { mesh: THREE.Mesh; mat: THREE.Material & { userData: { uTime?: { value: number } } } } | null;
  kits: ObsKit[];
}

export function buildWest(kit: ObsKit, root: THREE.Object3D, rnd: () => number, decor: number): WestParts {
  kit.section = 'west.ridge';
  // Plateau + paths: rock formation (walkable tops at R) that runs out past the bounds into the cliff.
  rockBox(kit, -58.5, -2, -13, -40, R, 13, { flatTop: true, amp: 0.45, skip: ['x-'] });
  for (const s of [-1, 1]) {
    rockBox(kit, -58.5, -2, s > 0 ? 13 : -30, -49, R, s > 0 ? 30 : -13, { flatTop: true, amp: 0.4, skip: ['x-', s > 0 ? 'z-' : 'z+'] });
    // Path ramp down to the forecourt: sloped snow top + rocky side.
    const za = s * 30;
    const zb = s * 38;
    const ramp = new THREE.BufferGeometry();
    const pts = [
      [-58.5, R, za],
      [-49, R, za],
      [-49, 0, zb],
      [-58.5, 0, zb],
    ];
    const tri = (a: number[], b: number[], c: number[]): number[] => [...a, ...b, ...c];
    const top = s > 0 ? [...tri(pts[0], pts[2], pts[1]), ...tri(pts[0], pts[3], pts[2])] : [...tri(pts[0], pts[1], pts[2]), ...tri(pts[0], pts[2], pts[3])];
    ramp.setAttribute('position', new THREE.Float32BufferAttribute(top.map((v, i) => (i % 3 === 1 ? v + 0.03 : v)), 3));
    ramp.computeVertexNormals();
    kit.add('snow', ramp, ENV.snow, { flat: true });
    // Rocky east flank of the ramp (face under the slope).
    rockFace(kit, -49, za, zb, R, 0, 1, 0.3);
  }
  // Access ramps from the under-ridge yard up to the plateau corners (stone steps look).
  for (const s of [-1, 1]) {
    const z0 = s * 8.5;
    const z1 = s * 12.5;
    for (let i = 0; i < 10; i++) {
      const xa = -33 - (7 * i) / 10;
      const xb = -33 - (7 * (i + 1)) / 10;
      const yTop = (R * (i + 0.5)) / 10 + 0.02;
      kit.add('concrete', box(xb, 0, Math.min(z0, z1), xa, yTop, Math.max(z0, z1)), '#b9b1a4', { base: 0 });
    }
    // Hand rail posts along the steps' open side (outside the walkway).
    for (let i = 0; i <= 3; i++) {
      const x = -33.5 - i * 2.2;
      const y = (R * (-33 - x)) / 7;
      kit.add('metal', cylAB(x, y, s * 8.35, x, y + 1.05, s * 8.35, 0.03, 0.03, 5), '#55585c', { flat: true });
    }
    kit.add('metal', cylAB(-33.5, 1.05 + (R * 0.5) / 7, s * 8.35, -40, R + 1.05, s * 8.35, 0.035, 0.035, 5), ENV.terracottaFaded, { flat: true });
  }
  // Concrete array platform on the plateau (the instrument floor) + cable trenches.
  kit.add('concrete', box(-54, R, -9.5, -41, R + 0.06, 9.5), '#c3bbad', { flat: true, snow: 0.7 });
  kit.add('metal', box(-53, R + 0.06, -0.25, -45.6, R + 0.1, 0.25), '#55585c', { flat: true, snow: 0.5 });
  // Rope rail along the cliff rim (just outside the bounds).
  kit.section = 'west.rim';
  for (let z = -37; z <= 37; z += 3.7) {
    const y = Math.abs(z) < 30 ? R : Math.max(0, R - (R * (Math.abs(z) - 30)) / 8);
    kit.add('wood', cylAB(-57.35, y - 0.1, z, -57.35, y + 1.05, z, 0.05, 0.06, 5), '#7a6048', { flat: true });
    if (z + 3.7 <= 37) {
      const y2 = Math.abs(z + 3.7) < 30 ? R : Math.max(0, R - (R * (Math.abs(z + 3.7) - 30)) / 8);
      kit.add('fabric', cable(-57.35, y + 0.95, z, -57.35, y2 + 0.95, z + 3.7, 0.25, 0.018, 6, 3), '#d9c7a7', { flat: true, snow: 0 });
    }
  }

  kit.section = 'west.array';
  // Dish pedestals (collision) with plinths, then animated alt-az dishes.
  const dishes: WestParts['dishes'] = [];
  const kits: ObsKit[] = [];
  for (const s of [-1, 1]) {
    const z0 = s > 0 ? 4 : -8;
    const z1 = s > 0 ? 8 : -4;
    const PT = R + OBS.pedestal;
    kit.add('concrete', rbox(-53, R, z0, -48, PT, z1, 0.08), '#d2cabb', { base: R });
    kit.add('concrete', box(-53.25, R, z0 - 0.25, -47.75, R + 0.45, z1 + 0.25), ENV.concreteDark, { flat: true });
    kit.add('metal', box(-48.02, R + 0.4, (z0 + z1) / 2 - 0.5, -47.9, R + 2.4, (z0 + z1) / 2 + 0.5), '#8e968a', { flat: true });
    kit.add('sign', quad(-47.88, R + 1.7, (z0 + z1) / 2, 0.9, 0.45, 1, 0, rect('dials', 2)), '#ffffff', { flat: true });
    // Ladder on the pedestal (visual, flush).
    for (let y = R + 0.4; y < PT - 0.1; y += 0.35) kit.add('metal', box(-50.9, y, s > 0 ? z1 : z0 - 0.06, -50.1, y + 0.04, s > 0 ? z1 + 0.06 : z0), '#55585c', { flat: true });
    const g = new THREE.Group();
    g.position.set(-50.5, PT, (z0 + z1) / 2);
    const dk = new ObsKit(kit.ctx, 'obs.dish');
    dk.snowDefault = 0.6;
    buildDish(dk, s);
    dk.build(g);
    root.add(g);
    kits.push(dk);
    dishes.push({ group: g, base: s > 0 ? 2.5 : 0.9, speed: s > 0 ? 0.011 : -0.008, phase: s > 0 ? 0 : 2 });
  }
  // Cable reels at the ramp heads (two drums each) and the receiver cabinet at the zone.
  for (const s of [-1, 1]) {
    for (const zz of [6.05, 7.05]) {
      const z = s * zz;
      kit.add('wood', cylAB(-44, R + 0.55, z, -42.4, R + 0.55, z, 0.55, 0.55, kit.seg(16)), '#8a6a4c', { base: R });
      kit.add('wood', cylAB(-43.85, R + 0.55, z, -42.55, R + 0.55, z, 0.38, 0.38, kit.seg(12)), '#5e4a38', { base: R });
    }
    kit.add('metal', cylAB(-43.2, R + 0.55, s * 5.5, -43.2, R + 0.55, s * 7.6, 0.12, 0.12, 6), '#55585c', { flat: true });
  }
  kit.add('paint', rbox(-46, R, -1, -44.4, R + 1.2, 1, 0.05), ENV.sage, { base: R });
  kit.add('sign', quad(-44.38, R + 0.72, 0, 1.6, 0.8, 1, 0, rect('dials', 2)), '#ffffff', { flat: true });
  kit.add('sign', quad(-46.02, R + 0.72, 0, 1.2, 1.2, -1, 0, rect('gauge', 2)), '#ffffff', { flat: true });
  kit.add('metal', cylAB(-45.6, R + 1.2, 0.6, -45.6, R + 2.8, 0.6, 0.02, 0.02, 4), '#34302c', { flat: true });
  kit.add('glow', sphere(-45.6, R + 2.85, 0.6, 0.05, 6, 4), '#ffb3c7', { k: 3, flat: true });
  // Cable runs from the cabinet to the dishes (lying in the snow).
  for (const s of [-1, 1]) kit.add('metal', cable(-46, R + 0.1, s * 0.8, -48, R + 0.1, s * 5.5, -0.05, 0.05, 8, 4), '#2e2d31', { flat: true, snow: 0 });

  kit.section = 'west.masts';
  // Guyed lattice masts on the rim (outside the bounds so nobody walks through them).
  const masts: THREE.Vector3[] = [];
  const mastDefs: [number, number, number][] = [
    [-57.9, -24, 18],
    [-58.0, -9, 22],
    [-57.9, 9, 20],
    [-58.0, 24, 16],
  ];
  for (const [x, z, hgt] of mastDefs) {
    kit.addAll('metal', lattice(x, z, 0.45, 0.22, R, R + hgt, 1.6, 0.07, 0.035), '#d6d0c4', { flat: true, snow: 0.3 });
    kit.add('concrete', box(x - 0.7, R - 0.3, z - 0.7, x + 0.7, R + 0.25, z + 0.7), ENV.concreteDark, { flat: true });
    // Crossed dipoles + a small dish near the top.
    for (let k = 0; k < 3; k++) {
      const y = R + hgt - 2 - k * 2.2;
      kit.add('metal', cylAB(x - 1.3, y, z, x + 1.3, y, z, 0.03, 0.03, 4), '#d6d0c4', { flat: true });
      kit.add('metal', cylAB(x, y + 0.4, z - 1.3, x, y + 0.4, z + 1.3, 0.03, 0.03, 4), '#d6d0c4', { flat: true });
    }
    // Guy wires down the cliff and along the rim.
    for (const [gx, gz] of [
      [-66, z],
      [-58.3, z + 9],
      [-58.3, z - 9],
    ]) {
      kit.add('metal', cylAB(x, R + hgt * 0.8, z, gx, gx < -62 ? R - 14 : R, gz, 0.012, 0.012, 3), '#3a3a40', { flat: true, snow: 0 });
    }
    masts.push(new THREE.Vector3(x, R + hgt + 0.3, z));
  }
  // Signal huts on the paths (collision boxes) — corrugated, a door, an antenna.
  for (const s of [-1, 1]) {
    const z0 = s > 0 ? 21 : -25;
    const z1 = s > 0 ? 25 : -21;
    kit.add('corrugated', rbox(-57.5, R, z0, -52.5, R + 2.8, z1, 0.05), s > 0 ? ENV.pastelBlue : ENV.sage, { base: R });
    kit.add('metal', box(-57.7, R + 2.8, z0 - 0.25, -52.25, R + 2.95, z1 + 0.25), '#55585c', { flat: true });
    kit.add('paint', box(-52.48, R, (z0 + z1) / 2 - 0.5, -52.4, R + 2.05, (z0 + z1) / 2 + 0.5), '#6d6a66', { flat: true });
    kit.add('glow', box(-52.4, R + 2.25, (z0 + z1) / 2 - 0.15, -52.3, R + 2.35, (z0 + z1) / 2 + 0.15), ENV.glowGold, { k: 2.4, flat: true });
    kit.add('pool', floorQuad(-51.5, R + 0.05, (z0 + z1) / 2, 2.4, 2.4), ENV.glowGold, { k: 0.35, flat: true });
    kit.add('metal', cylAB(-55, R + 2.95, (z0 + z1) / 2, -55, R + 6.5, (z0 + z1) / 2, 0.035, 0.02, 4), '#34302c', { flat: true });
    kit.add('sign', quad(-52.44, R + 1.3, (z0 + z1) / 2 + s * 1.3, 0.8, 0.8, 1, 0, rect('gauge', 2)), '#ffffff', { flat: true });
  }

  kit.section = 'west.yard';
  // Under-ridge boulders, the rib, the forecourt outcrop (collision boxes, all covered by rock).
  for (const s of [-1, 1]) {
    rockBox(kit, -42, -0.3, s > 0 ? 20 : -25, -34, 3.2, s > 0 ? 25 : -20, { amp: 0.55, crest: 0.6, color: ROCK });
    rockBox(kit, -28, -0.3, s > 0 ? 7 : -27, -23, OBS.ribTop, s > 0 ? 27 : -7, { amp: 0.55, crest: 0.7, seg: 1.1, color: ROCK });
    rockBox(kit, -31, -0.3, s > 0 ? 30.5 : -40.5, -25, OBS.outcropTop, s > 0 ? 40.5 : -30.5, { amp: 0.55, crest: 0.8, color: ROCK_DARK });
    // Glowing lichen on the shaded (west) feet of the rocks.
    lichen(kit, -28.6, 0, s * 12, 1.8, ENV.glowChartreuse, rnd);
    lichen(kit, -42.6, 0, s * 23.5, 1.5, ENV.glowSoftPink, rnd);
    if (decor > 0.5) lichen(kit, -31.6, 0, s * 35, 1.4, ENV.glowChartreuse, rnd);
    // Loose boulders and drifts (visual, low).
    for (let i = 0; i < Math.round(6 * decor); i++) {
      const x = -48 + rnd() * 20;
      const z = s * (14 + rnd() * 22);
      const blocked = (x > -42.8 && x < -33.2 && Math.abs(z) > 19 && Math.abs(z) < 26) || (x > -28.8 && x < -22.2 && Math.abs(z) > 6 && Math.abs(z) < 28);
      if (blocked) continue;
      boulder(kit, x, 0, z, 0.25 + rnd() * 0.25, rnd, ROCK_DARK);
    }
    drift(kit, -48, 0, s * 18, 1.4, 4, 0.35, 0.1);
    drift(kit, -36.5, 0, s * 27.5, 3, 1.1, 0.3, 0.2);
    drift(kit, -44, 0, s * 33, 2.2, 1.2, 0.28, -0.3);
  }
  // Spectrograph hut (z-symmetric) with its own little dome and a coelostat mirror.
  kit.section = 'west.hut';
  kit.add('concrete', rbox(-34, 0, -3, -28, 3.2, 3, 0.06), '#d2cabb', { base: 0 });
  kit.add('concrete', box(-34.2, 3.1, -3.2, -27.8, 3.35, 3.2), ENV.bone, { flat: true });
  kit.add('gloss', lathe([[2.1, 0], [2.1, 0.35], [1.95, 0.9], [1.6, 1.45], [1.05, 1.85], [0.4, 2.05], [0, 2.08]], kit.seg(20), -31, 3.35, 0), '#dcd8d0', { snow: 0.7 });
  kit.add('paint', box(-29.3, 3.9, -0.35, -28.9, 5.1, 0.35), '#34302c', { flat: true, snow: 0 });
  kit.add('paint', box(-27.98, 0, -0.7, -27.9, 2.2, 0.7), '#6d6a66', { flat: true });
  kit.add('sign', quad(-27.88, 2.65, 0, 2.6, 0.33, 1, 0, rect('signSpectro', 2)), '#ffffff', { flat: true });
  kit.add('glow', box(-27.9, 2.25, -0.2, -27.8, 2.33, 0.2), ENV.glowGold, { k: 2.4, flat: true });
  kit.add('pool', floorQuad(-26.8, 0.04, 0, 3, 3), ENV.glowGold, { k: 0.4, flat: true });
  for (const s of [-1, 1]) kit.add('signGlow', quad(-31, 1.9, s * 3.02, 0.5, 1.2, 0, s, rect('window', 4)), '#ffffff', { k: 1.1 });
  // Spare dome segments on a timber cradle (west court; mirrored).
  kit.section = 'west.segments';
  for (const s of [-1, 1]) {
    const z0 = s > 0 ? 7 : -10.5;
    kit.add('wood', box(-21, 0, z0, -16.5, 0.35, z0 + 3.5), '#8a6a4c', { base: 0 });
    for (let i = 0; i < 4; i++) {
      const y = 0.35 + i * 0.6;
      const panel = lathe([[2.1, 0], [2.0, 0.45], [1.75, 0.9]], 8, 0, 0, 0, 0, Math.PI * 0.55);
      panel.rotateZ(Math.PI / 2);
      panel.translate(-18.75 + 0.45, y + 0.1, z0 + 1.75);
      panel.scale(1, 1, 1);
      kit.add('gloss', panel, i % 2 ? '#dcd8d0' : '#cfcac1', { snow: i === 3 ? 1 : 0.4 });
    }
    kit.add('fabric', rbox(-21.05, 1.4, z0 - 0.05, -18.2, 2.8, z0 + 3.55, 0.25, 2), ENV.terracottaFaded, { base: 0 });
  }

  // ── Signal pennants: pastel flags strung between the masts and posts (one animated draw) ──
  const pennants = decor > 0.3 ? buildPennants(kit, masts) : null;
  return { dishes, masts, pennants, kits };
}

function buildDish(k: ObsKit, s: number): void {
  // Turret (rotates in azimuth), yoke, dish (paraboloid) + quadrupod and feed.
  k.add('metal', cyl(0, 0, 0, 1.3, 0.9, k.seg(20), 1.15), '#8e968a', { base: 0, snow: 0.5 });
  k.add('gloss', cyl(0, 0.9, 0, 1.0, 0.5, k.seg(16), 0.9), '#e7e1d6', { snow: 0.5 });
  for (const side of [-1, 1]) k.add('gloss', box(-0.4, 1.3, side * 1.05 - 0.15, 0.4, 2.8, side * 1.05 + 0.15), '#e7e1d6', { snow: 0.5 });
  const dish = new THREE.Group();
  const f = 3.1;
  const Rd = 4.4;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const r = (Rd * i) / 8;
    prof.push([r, (r * r) / (4 * f)]);
  }
  void dish;
  const inner = lathe(prof, k.seg(32));
  const back: [number, number][] = prof.map(([r, y]) => [r, y - 0.12]);
  back.push([Rd, (Rd * Rd) / (4 * f) - 0.05]);
  const outer = lathe(back.reverse(), k.seg(32));
  // Orient: axis +Y → elevation e toward local +X; pivot at the yoke.
  const e = s > 0 ? 0.95 : 1.1;
  const m = new THREE.Matrix4().makeTranslation(0, 2.6, 0).multiply(new THREE.Matrix4().makeRotationZ(-(Math.PI / 2 - e))).multiply(new THREE.Matrix4().makeTranslation(0, 0.3, 0));
  k.add('gloss', inner, '#f1ece2', { snow: 0.9, shade: (x, y, z, nx, ny) => 0.85 + 0.15 * ny }, m);
  k.add('metal', outer, '#9a9b98', { snow: 0.2 }, m);
  // Back-structure ribs.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.add('metal', beam(0, 0.1, 0, Math.cos(a) * Rd * 0.95, (Rd * Rd) / (4 * f) - 0.2, Math.sin(a) * Rd * 0.95, 0.08), '#6d7076', { flat: true, snow: 0 }, m);
  }
  // Quadrupod + feed horn at the focus.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.add('metal', cylAB(Math.cos(a) * Rd * 0.8, (Rd * Rd * 0.64) / (4 * f), Math.sin(a) * Rd * 0.8, 0, f - 0.2, 0, 0.04, 0.04, 4), '#d6d0c4', { flat: true, snow: 0 }, m);
  }
  k.add('gloss', cyl(0, f - 0.35, 0, 0.28, 0.55, 12, 0.18), '#e7e1d6', { flat: true, snow: 0.5 }, m);
  k.add('glow', sphere(0, f + 0.25, 0, 0.07, 6, 4), '#ffb3c7', { k: 2.4, flat: true }, m);
}

const PENNANT_COLORS = [ENV.pastelPink, ENV.pastelYellow, ENV.pastelBlue, ENV.bone, ENV.pastelMint, ENV.terracottaFaded];

function buildPennants(kit: ObsKit, masts: THREE.Vector3[]): WestParts['pennants'] {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const wgt: number[] = [];
  const c = new THREE.Color();
  // Strings: mast top → mast top, and from each mast down to posts on the path/plateau rim.
  const lines: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i + 1 < masts.length; i++) lines.push([masts[i].clone().setY(masts[i].y - 5), masts[i + 1].clone().setY(masts[i + 1].y - 5)]);
  for (const m of masts) {
    lines.push([m.clone().setY(m.y - 1.5), new THREE.Vector3(-55.5, R + 1.4, m.z + (m.z > 0 ? -7 : 7))]);
  }
  lines.push([new THREE.Vector3(-57.9, R + 12, -24), new THREE.Vector3(-57.35, 1.2, -36)]);
  lines.push([new THREE.Vector3(-57.9, R + 12, 24), new THREE.Vector3(-57.35, 1.2, 36)]);
  let ci = 0;
  for (const [a, b] of lines) {
    const len = a.distanceTo(b);
    const n = Math.max(3, Math.round(len / 1.1));
    const sag = len * 0.06;
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.15) / n;
      const t1 = (i + 0.85) / n;
      const p0 = a.clone().lerp(b, t0);
      p0.y -= sag * 4 * t0 * (1 - t0);
      const p1 = a.clone().lerp(b, t1);
      p1.y -= sag * 4 * t1 * (1 - t1);
      const tip = p0.clone().lerp(p1, 0.5);
      tip.y -= 0.55;
      c.set(PENNANT_COLORS[ci++ % PENNANT_COLORS.length]);
      for (const [p, w] of [
        [p0, 0],
        [p1, 0],
        [tip, 1],
      ] as const) {
        pos.push(p.x, p.y, p.z);
        nor.push(1, 0.2, 0);
        col.push(c.r, c.g, c.b);
        wgt.push(w);
      }
    }
    // The string itself (thin dark line of quads is overkill: a tube in the static kit).
    kit.add('fabric', cable(a.x, a.y, a.z, b.x, b.y, b.z, sag, 0.012, 8, 3), '#4a4038', { flat: true, snow: 0 });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aWeight', new THREE.Float32BufferAttribute(wgt, 1));
  g.computeBoundingSphere();
  const uTime = { value: 0 };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWeight;\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = position.x * 0.9 + position.z * 1.7 + position.y * 0.6;
        float flap = sin(uTime * 7.0 + ph) * 0.35 + sin(uTime * 13.0 + ph * 2.3) * 0.12;
        transformed += vec3(0.55 + flap * 0.3, flap * 0.5, flap) * aWeight * 0.6;`,
      );
  };
  mat.customProgramCacheKey = () => 'obs.pennants';
  mat.userData.uTime = uTime;
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'obs.pennants';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return { mesh, mat: mat as THREE.Material & { userData: { uTime?: { value: number } } } };
}
