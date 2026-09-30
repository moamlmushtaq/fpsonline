// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Observatory EAST lane: the observers' dormitory and the
// CABLE PYLON STATION (Zone C).
//
//  • Dormitory: pastel plaster, frosted windows glowing warm, porches with
//    lamps; inside a common room (table, the old radio still playing, chairs,
//    stove, star charts) and two bunk wings.
//  • Station deck: bullwheel house (the big wheel inside), control booths, a
//    cable spool, hazard edges; the pylon anchor + lattice pylon on the rim.
//    The freight ropeway heads out over the void toward the launch mesa; its
//    cabin No. 7 hangs stuck just past the pylon, swaying in the wind.
//  • Maintenance shed / fuel store, generator house / boiler house, cable reels.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { OBS } from '../../../../shared/maps/observatory';
import { ENV } from '../../../engine/palette';
import { rect } from './atlas';
import { beam, box, cable, cyl, cylAB, lattice, ObsKit, quad, rbox, sphere, floorQuad } from './kit';
import { drift, lichen } from './rocks';

const D = OBS.deck;
const DM = OBS.dorm;

export interface EastParts {
  cabin: THREE.Group;
  cabinKit: ObsKit;
  wheel: THREE.Group;
  wheelKit: ObsKit;
  beacons: THREE.Vector3[];
}

export function buildEast(kit: ObsKit, root: THREE.Object3D, rnd: () => number, decor: number, cableDir: THREE.Vector3): EastParts {
  buildDorm(kit, rnd, decor);
  buildYard(kit, rnd, decor);
  return buildStation(kit, root, rnd, decor, cableDir);
}

// ── Dormitory ──────────────────────────────────────────────────────────────

function buildDorm(kit: ObsKit, rnd: () => number, decor: number): void {
  kit.section = 'east.dorm';
  const WALL = ENV.pastelBlue;
  const TRIM = ENV.bone;
  const x0 = DM.x0;
  const x1 = DM.x1;
  const Z = DM.z;
  const H = DM.h;
  const wallShade = (x: number, y: number, z: number, nx: number, ny: number): number => (ny < -0.5 ? 0.62 : 0.64 + 0.36 * Math.min(1, y / 1.3));
  // Walls (match collision), plinth, roof with parapet + snow.
  const walls: [number, number, number, number][] = [
    [x0, OBS.doorHalf, x0 + 0.5, Z],
    [x0, -Z, x0 + 0.5, -OBS.doorHalf],
    [x1 - 0.5, 9.4, x1, Z],
    [x1 - 0.5, -Z, x1, -9.4],
    [x1 - 0.5, -6.6, x1, 6.6],
    [x0, Z - 0.5, 28, Z],
    [31, Z - 0.5, x1, Z],
    [x0, -Z, 28, -Z + 0.5],
    [31, -Z, x1, -Z + 0.5],
  ];
  for (const [a, b, c, d] of walls) kit.add('plaster', box(a, 0, b, c, H, d), WALL, { shade: wallShade });
  // Door heads (above the openings, below the roof) — visual lintels (the west one spans the deep wall).
  kit.add('plaster', box(x0, 2.5, -OBS.doorHalf, DM.bay, H, OBS.doorHalf), WALL, { flat: true });
  kit.add('interiorWood', box(x0 + 0.5, 0, -OBS.doorHalf, DM.bay, 0.03, OBS.doorHalf), '#8a6a4c', { flat: true, snow: 0 });
  for (const s of [-1, 1]) {
    kit.add('plaster', box(x1 - 0.5, 2.5, s > 0 ? 6.6 : -9.4, x1, H, s > 0 ? 9.4 : -6.6), WALL, { flat: true });
    kit.add('plaster', box(28, 2.5, s > 0 ? Z - 0.5 : -Z, 31, H, s > 0 ? Z : -Z + 0.5), WALL, { flat: true });
  }
  // Plinth band around the outside (not a slab: the floor inside is at 0).
  kit.add('concrete', box(x0 - 0.08, 0, -Z - 0.08, x0, 0.4, Z + 0.08), ENV.concreteDark, { flat: true, snow: 0.8 });
  kit.add('concrete', box(x1, 0, -Z - 0.08, x1 + 0.08, 0.4, Z + 0.08), ENV.concreteDark, { flat: true, snow: 0.8 });
  kit.add('concrete', box(x0, 0, Z, x1, 0.4, Z + 0.08), ENV.concreteDark, { flat: true, snow: 0.8 });
  kit.add('concrete', box(x0, 0, -Z - 0.08, x1, 0.4, -Z), ENV.concreteDark, { flat: true, snow: 0.8 });
  // Deep insulated roof with a parapet band (collision top = roofTop).
  kit.add('plaster', box(x0 - 0.15, H, -Z - 0.15, x1 + 0.15, DM.roofTop, Z + 0.15), TRIM, { flat: false, base: H });
  kit.add('paint', box(x0 - 0.17, H + 0.35, -Z - 0.17, x1 + 0.17, H + 0.45, Z + 0.17), ENV.terracottaFaded, { flat: true, snow: 0 });
  kit.add('plaster', box(x0 - 0.15, DM.roofTop, -Z - 0.15, x1 + 0.15, DM.roofTop + 0.3, -Z + 0.1), TRIM, { flat: true });
  kit.add('plaster', box(x0 - 0.15, DM.roofTop, Z - 0.1, x1 + 0.15, DM.roofTop + 0.3, Z + 0.15), TRIM, { flat: true });
  kit.add('snow', rbox(x0 + 0.1, DM.roofTop - 0.05, -Z + 0.1, x1 - 0.1, DM.roofTop + 0.22, Z - 0.1, 0.12, 2), ENV.snow, { flat: true });
  // Roof furniture: vent stacks, a chimney, the long-wire antenna.
  for (const z of [-9, 3, 11]) kit.add('metal', cyl(31.5, DM.roofTop, z, 0.25, 1.2, 8), '#6d7076', { base: DM.roofTop });
  kit.add('concrete', box(26.2, DM.roofTop, -3.2, 27.2, DM.roofTop + 1.9, -2.2), ENV.terracottaFaded, { base: DM.roofTop });
  kit.add('metal', cylAB(33.6, DM.roofTop, -13, 33.6, DM.roofTop + 6, -13, 0.04, 0.03, 4), '#34302c', { flat: true });
  kit.add('metal', cylAB(33.6, DM.roofTop, 13, 33.6, DM.roofTop + 6, 13, 0.04, 0.03, 4), '#34302c', { flat: true });
  kit.add('metal', cable(33.6, DM.roofTop + 5.8, -13, 33.6, DM.roofTop + 5.8, 13, 0.9, 0.01, 10, 3), '#34302c', { flat: true, snow: 0 });
  // Frosted windows glowing warm (both faces, both long sides + ends).
  for (let z = -13; z <= 13; z += 2.6) {
    const nearDoor = (zz: number): boolean => Math.abs(zz) < 2.6 || Math.abs(Math.abs(zz) - 8) < 2;
    if (!(Math.abs(z) < 2.4)) {
      kit.add('signGlow', quad(x0 - 0.02, 1.75, z, 0.9, 1.3, -1, 0, rect('window', 4)), '#ffffff', { k: 1.25 });
      kit.add('plaster', box(x0 - 0.12, 1.02, z - 0.55, x0, 1.1, z + 0.55), TRIM, { flat: true });
    }
    if (!nearDoor(z)) {
      kit.add('signGlow', quad(x1 + 0.02, 1.75, z, 0.9, 1.3, 1, 0, rect('window', 4)), '#ffffff', { k: 1.25 });
      if (Math.abs(z) < 9.4) kit.add('signGlow', quad(x1 - 0.52, 1.75, z, 0.9, 1.3, -1, 0, rect('windowCool', 4)), '#ffffff', { k: 0.55 });
      kit.add('plaster', box(x1, 1.02, z - 0.55, x1 + 0.12, 1.1, z + 0.55), TRIM, { flat: true });
    }
  }
  for (const s of [-1, 1]) {
    for (const x of [26.3, 33]) kit.add('signGlow', quad(x, 1.75, s * (Z + 0.02), 0.9, 1.3, 0, s, rect('window', 4)), '#ffffff', { k: 1.25 });
  }
  // Porches: canopy + lamp at each door (W, E×2, N, S).
  const porch = (cx: number, cz: number, nx: number, nz: number, w: number): void => {
    const d = 1.4;
    if (nx !== 0) {
      kit.add('plaster', box(nx > 0 ? cx : cx - d, 2.75, cz - w / 2, nx > 0 ? cx + d : cx, 2.95, cz + w / 2), TRIM, { base: 2.75 });
      kit.add('glow', box(cx + nx * 0.6 - 0.2, 2.68, cz - 0.2, cx + nx * 0.6 + 0.2, 2.75, cz + 0.2), ENV.glowGold, { k: 2.6, flat: true });
      kit.add('pool', floorQuad(cx + nx * 1.3, 0.04, cz, 3.2, 3.6), ENV.glowGold, { k: 0.42, flat: true });
    } else {
      kit.add('plaster', box(cx - w / 2, 2.75, nz > 0 ? cz : cz - d, cx + w / 2, 2.95, nz > 0 ? cz + d : cz), TRIM, { base: 2.75 });
      kit.add('glow', box(cx - 0.2, 2.68, cz + nz * 0.6 - 0.2, cx + 0.2, 2.75, cz + nz * 0.6 + 0.2), ENV.glowGold, { k: 2.6, flat: true });
      kit.add('pool', floorQuad(cx, 0.04, cz + nz * 1.3, 3.6, 3.2), ENV.glowGold, { k: 0.42, flat: true });
    }
  };
  porch(x1, 8, 1, 0, 3.6);
  porch(x1, -8, 1, 0, 3.6);
  porch(29.5, Z, 0, 1, 3.8);
  porch(29.5, -Z, 0, -1, 3.8);
  kit.add('sign', quad(x1 + 0.03, 2.2, 0, 3.8, 0.47, 1, 0, rect('signDorm', 2)), '#ffffff', { flat: true });

  kit.section = 'east.dormInside';
  // Interior: timber floor, warm lining on every wall (the hemisphere sky light would
  // otherwise turn the rooms blue), ceiling lamps, the common room (radio!), bunk wings.
  kit.add('interiorWood', box(x0 + 0.5, 0, -Z + 0.5, x1 - 0.5, 0.03, Z - 0.5), '#a07c5c', { flat: true, snow: 0 });
  kit.add('interior', box(x0 + 0.5, H - 0.04, -Z + 0.5, x1 - 0.5, H, Z - 0.5), '#c9a887', { flat: true, snow: 0 });
  const LINE = '#e7c9a6';
  const lining: [number, number, number, number][] = [
    [x1 - 0.52, 9.4, x1 - 0.5, Z - 0.5],
    [x1 - 0.52, -Z + 0.5, x1 - 0.5, -9.4],
    [x1 - 0.52, -6.6, x1 - 0.5, 6.6],
    [x0 + 0.5, Z - 0.52, 28, Z - 0.5],
    [31, Z - 0.52, x1 - 0.5, Z - 0.5],
    [x0 + 0.5, -Z + 0.5, 28, -Z + 0.52],
    [31, -Z + 0.5, x1 - 0.5, -Z + 0.52],
  ];
  for (const [a, b, c, d] of lining) {
    kit.add('interiorWood', box(a, 0.03, b, c, 0.95, d), '#9a7658', { flat: true, snow: 0 });
    kit.add('interior', box(a, 0.95, b, c, H - 0.04, d), LINE, { flat: true, snow: 0 });
  }
  for (const s of [-1, 1]) kit.add('interior', box(DM.bay, 0, s > 0 ? 5 : -5.4, 31, H, s > 0 ? 5.4 : -5), LINE, { shade: (x, y) => (y < 0.95 ? 0.7 : 1), snow: 0 });
  buildBuiltIns(kit, rnd);
  for (const z of [-11, -2, 2, 11]) {
    kit.add('glow', box(28.9, H - 0.08, z - 0.35, 30.1, H - 0.04, z + 0.35), ENV.glowGold, { k: 2.4, flat: true });
    kit.add('pool', floorQuad(29.5, 0.05, z, 5, 5), ENV.glowGold, { k: 0.6, flat: true });
    kit.add('pool', quad(29.5, H - 0.3, z, 4, 1.2, 0, 1, undefined, -Math.PI / 2), ENV.glowGold, { k: 0.25, flat: true });
  }
  // Common room: table (collision) with the radio, chairs, a stove, shelves, charts.
  kit.add('wood', box(28.4, 0.8, -0.8, 30.6, 0.9, 0.8), '#8a6a4c', { flat: true, snow: 0 });
  for (const [x, z] of [
    [28.55, -0.65],
    [30.45, -0.65],
    [28.55, 0.65],
    [30.45, 0.65],
  ])
    kit.add('wood', box(x - 0.05, 0, z - 0.05, x + 0.05, 0.8, z + 0.05), '#6b5240', { flat: true, snow: 0 });
  // The radio (still playing): case, speaker face, antenna, a warm dial light.
  kit.add('paint', rbox(29.0, 0.9, -0.35, 29.9, 1.35, 0.05, 0.05), ENV.terracottaFaded, { flat: true, snow: 0 });
  kit.add('sign', quad(29.45, 1.12, 0.055, 0.8, 0.4, 0, 1, rect('radio', 2)), '#ffffff', { flat: true, k: 1.1 });
  kit.add('metal', cylAB(29.8, 1.35, -0.25, 30.3, 2.1, -0.4, 0.008, 0.008, 3), '#9a9b98', { flat: true, snow: 0 });
  kit.add('glow', box(29.62, 1.2, 0.06, 29.72, 1.26, 0.07), ENV.glowGold, { k: 3, flat: true });
  // Mugs + a thermos on the table.
  kit.add('gloss', cyl(28.8, 0.9, 0.4, 0.045, 0.1, 8), ENV.bone, { flat: true, snow: 0 });
  kit.add('gloss', cyl(30.2, 0.9, 0.3, 0.045, 0.1, 8), ENV.pastelBlue, { flat: true, snow: 0 });
  kit.add('gloss', cyl(30.3, 0.9, -0.4, 0.06, 0.32, 8), ENV.sage, { flat: true, snow: 0 });
  // Chairs (low, around the table — visual, within the table's footprint margin).
  // Chairs pushed in under the table (inside its collision footprint).
  for (const [x, z, r] of [
    [28.75, -0.3, 0],
    [30.25, 0.35, Math.PI],
  ] as const) {
    const m = new THREE.Matrix4().makeRotationY(r).setPosition(x, 0, z);
    kit.add('wood', box(-0.22, 0.44, -0.22, 0.22, 0.49, 0.22), '#8a6a4c', { flat: true, snow: 0 }, m);
    kit.add('wood', box(-0.24, 0.49, -0.22, -0.2, 0.95, 0.22), '#8a6a4c', { flat: true, snow: 0 }, m);
    kit.add('wood', box(-0.22, 0, -0.22, 0.22, 0.44, 0.22), '#6b5240', { flat: true, snow: 0 }, m);
  }
  // Wall dressing: star charts, the calendar, a tram poster, the summit map.
  kit.add('sign', quad(27.6, 1.75, 4.98, 1.0, 1.0, 0, -1, rect('chart1', 2)), '#ffffff', { flat: true });
  kit.add('sign', quad(27.3, 1.8, -4.98, 0.7, 0.7, 0, 1, rect('calendar', 2)), '#ffffff', { flat: true });
  kit.add('sign', quad(x1 - 0.52, 1.8, 3, 1.0, 1.5, -1, 0, rect('poster', 2)), '#ffffff', { flat: true });
  kit.add('sign', quad(x1 - 0.52, 1.8, -3.5, 1.2, 1.2, -1, 0, rect('map', 2)), '#ffffff', { flat: true });
  // Bunk wings: lockers on the east wall (the bunks are built into the west wall, see buildBuiltIns).
  for (const s of [-1, 1]) {
    // Lockers flush with the thickened east wall (collision face x1 − 0.9), a shelf of kit above.
    for (let i = 0; i < 7; i++) {
      const z = 9.76 + i * 0.72;
      kit.add('interiorMetal', box(x1 - 0.9, 0, s * z - 0.35, x1 - 0.5, 2.05, s * z + 0.35), i % 3 === 1 ? ENV.pastelBlue : ENV.sage, { snow: 0, shade: (x, y) => 0.75 + 0.25 * Math.min(1, y / 1.2) });
      kit.add('interiorMetal', box(x1 - 0.92, 1.35, s * z - 0.08, x1 - 0.9, 1.45, s * z + 0.08), '#34302c', { flat: true, snow: 0 });
    }
    kit.add('interiorWood', box(x1 - 0.9, 2.05, s > 0 ? 9.4 : -14.5, x1 - 0.5, H - 0.04, s > 0 ? 14.5 : -9.4), '#b48d68', { flat: true, snow: 0 });
    kit.add('sign', quad(29, 1.8, s * (Z - 0.52), 0.9, 0.9, 0, -s, rect(s > 0 ? 'chart2' : 'chart1', 2)), '#ffffff', { flat: true });
  }
  void decor;
}

/**
 * The dorm's deep west wall (collision x0…bay, 1.4 m): its whole inner face is
 * built-in joinery flush with the collision plane — bunk bays with curtains and
 * lockers in the wings, a bookcase wall with a window seat and the cast-iron
 * stove set into the wall in the common room.
 */
function buildBuiltIns(kit: ObsKit, rnd: () => number): void {
  kit.section = 'east.builtins';
  const F = DM.bay; // face plane
  const H = DM.h;
  const back = DM.x0 + 0.5;
  const TEAK = '#8a6a4c';
  const DARKW = '#6b5240';
  for (const s of [-1, 1]) {
    const zz = (a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a]);
    // ── Bunk wing (|z| 5.4 … 14.5): carcass, three double bunks, lockers between, storage soffit. ──
    {
      const [a, b] = zz(5.4, DM.z - 0.5);
      kit.add('interiorWood', box(back, 0, a, F - 0.9, H, b), '#7a5c43', { flat: true, snow: 0 }); // back panel
      kit.add('interiorWood', box(F - 0.9, 2.05, a, F, H - 0.04, b), '#b48d68', { flat: true, snow: 0 }); // storage soffit
      kit.add('interiorWood', box(F - 0.02, 2.05, a, F, 2.12, b), DARKW, { flat: true, snow: 0 });
      for (let z = 5.9; z < 14.2; z += 0.75) {
        const [c0, c1] = zz(z, z + 0.03);
        kit.add('interiorWood', box(F - 0.02, 2.2, c0, F, H - 0.1, c1), DARKW, { flat: true, snow: 0 }); // cupboard door joints
      }
      kit.add('interiorWood', box(F - 0.9, 0, a, F, 0.12, b), DARKW, { flat: true, snow: 0 }); // plinth
    }
    const bunks = [7.6, 10.4, 13];
    for (const zc of bunks) {
      const [a, b] = zz(zc - 0.95, zc + 0.95);
      for (const y of [0.35, 1.45]) {
        kit.add('interiorWood', box(F - 0.9, y, a, F, y + 0.14, b), TEAK, { flat: true, snow: 0 });
        kit.add('interiorFabric', box(F - 0.86, y + 0.14, a + 0.05, F - 0.05, y + 0.3, b - 0.05), rnd() < 0.5 ? ENV.terracottaFaded : ENV.sage, { flat: true, snow: 0 });
        kit.add('interiorFabric', rbox(F - 0.8, y + 0.3, a + 0.1, F - 0.5, y + 0.42, a + 0.55, 0.05), ENV.bone, { flat: true, snow: 0 }); // pillow
      }
      // Half-drawn curtain on the upper bunk, a reading lamp.
      kit.add('interiorFabric', box(F - 0.04, 1.62, a + 0.05, F, 2.02, a + 0.7), rnd() < 0.5 ? ENV.pastelBlue : ENV.pastelPink, { flat: true, snow: 0 });
      kit.add('glow', box(F - 0.3, 1.9, zc - 0.1, F - 0.2, 1.96, zc + 0.1), ENV.glowGold, { k: 1.6, flat: true });
    }
    // Lockers filling the gaps between the bunks (0 → soffit).
    for (const [g0, g1] of [
      [5.4, 6.65],
      [8.55, 9.45],
      [11.35, 12.05],
      [13.95, DM.z - 0.5],
    ]) {
      const [a, b] = zz(g0, g1);
      kit.add('interiorMetal', box(F - 0.9, 0, a, F, 2.05, b), rnd() < 0.5 ? ENV.sage : ENV.pastelBlue, { snow: 0, shade: (x, y) => 0.75 + 0.25 * Math.min(1, y / 1.2) });
      kit.add('metal', box(F, 1.3, (a + b) / 2 - 0.12, F + 0.02, 1.36, (a + b) / 2 + 0.12), '#34302c', { flat: true, snow: 0 });
    }
    // ── Common room (|z| 1.4 … 5): lower cupboards + bookcase, a window seat. ──
    {
      const [a, b] = zz(OBS.doorHalf, 5);
      kit.add('interiorWood', box(back, 0, a, F, 0.9, b), '#9a7658', { flat: true, snow: 0 });
      kit.add('interiorWood', box(F - 0.45, 0.9, a, F + 0.02, 0.96, b), DARKW, { flat: true, snow: 0 });
      kit.add('interiorWood', box(back, 0.96, a, F - 0.35, H - 0.04, b), '#7a5c43', { flat: true, snow: 0 });
      // The north bay has the cast-iron stove set into it (z −4.1…−2.9, up to 1.9 m).
      const stove = s < 0 ? [-4.25, -2.75] : null;
      const runs: [number, number][] = stove ? [[a, stove[0]], [stove[1], b]] : [[a, b]];
      for (const y of [1.55, 2.15, 2.75]) {
        for (const [r0, r1] of y < 2 && stove ? runs : [[a, b] as [number, number]]) kit.add('interiorWood', box(F - 0.35, y, r0, F, y + 0.04, r1), TEAK, { flat: true, snow: 0 });
      }
      // Books: a few runs of spines in faded paper colours.
      const cols = [ENV.terracottaFaded, ENV.sage, ENV.pastelBlue, ENV.boneShade, ENV.pastelYellow, '#7a6048'];
      for (const y of [0.96, 1.59, 2.19, 2.79]) {
        let z = a + 0.08;
        while (z < b - 0.3) {
          if (stove && y < 2 && z > stove[0] - 0.1 && z < stove[1]) {
            z = stove[1] + 0.05;
            continue;
          }
          const w = 0.05 + rnd() * 0.05;
          const h = 0.34 + rnd() * 0.16;
          if (rnd() < 0.12) {
            z += 0.25;
            continue;
          }
          kit.add('interior', box(F - 0.32, y, z, F - 0.08, y + h, z + w), cols[Math.floor(rnd() * cols.length)], { flat: true, snow: 0 });
          z += w + 0.005;
        }
      }
      // End panels (door jamb side + partition side).
      kit.add('interiorWood', box(F - 0.9, 0, a, F, H - 0.04, a + 0.04), DARKW, { flat: true, snow: 0 });
      kit.add('interiorWood', box(F - 0.9, 0, b - 0.04, F, H - 0.04, b), DARKW, { flat: true, snow: 0 });
    }
    // The stove set into the north bookcase bay; a record player on the south counter.
    if (s < 0) {
      kit.add('metal', box(F - 0.6, 0.9, -4.1, F - 0.02, 1.9, -2.9), '#2e2d31', { flat: true, snow: 0 });
      kit.add('metal', cylAB(F - 0.3, 1.9, -3.5, F - 0.3, H, -3.5, 0.09, 0.09, 8), '#2e2d31', { flat: true, snow: 0 });
      kit.add('glow', box(F - 0.03, 1.1, -3.85, F, 1.45, -3.15), '#ffb36b', { k: 2.4, flat: true });
      kit.add('pool', floorQuad(F + 0.8, 0.05, -3.5, 2, 2), '#ffb36b', { k: 0.55, flat: true });
    } else {
      kit.add('paint', rbox(F - 0.34, 0.96, 3.2, F - 0.04, 1.14, 3.9, 0.02), ENV.terracottaFaded, { flat: true, snow: 0 });
      kit.add('metal', cyl(F - 0.19, 1.14, 3.55, 0.14, 0.012, 16), '#1f1e22', { flat: true, snow: 0 });
    }
  }
}

// ── Yard: shed / fuel store, generator / boiler house, reels ────────────────

function buildYard(kit: ObsKit, rnd: () => number, decor: number): void {
  kit.section = 'east.yard';
  for (const s of [-1, 1]) {
    // Maintenance shed (S, sage) / fuel store (N, faded terracotta): corrugated, roller door, snow.
    const z0 = s > 0 ? 20 : -27.5;
    const z1 = s > 0 ? 27.5 : -20;
    kit.add('corrugated', box(34.5, 0, z0, 43, 3.1, z1), s > 0 ? ENV.sage : ENV.terracottaFaded, { base: 0 });
    kit.add('metal', box(34.3, 3.1, z0 - 0.3, 43.2, 3.4, z1 + 0.3), '#6d7076', { flat: true });
    const face = s > 0 ? z0 - 0.02 : z1 + 0.02;
    kit.add('paint', quad(38.8, 1.45, face, 3.6, 2.9, 0, -s), '#8e877b', { flat: true });
    for (let y = 0.2; y < 2.9; y += 0.3) kit.add('metal', box(37, y, face - s * 0.02, 40.6, y + 0.05, face - s * 0.06), '#6d6a66', { flat: true });
    kit.add('glow', box(38.6, 3.0, face - s * 0.02, 39, 3.06, face - s * 0.3), ENV.glowGold, { k: 2.4, flat: true });
    kit.add('pool', floorQuad(38.8, 0.04, face - s * 1.4, 3.4, 3), ENV.glowGold, { k: 0.4, flat: true });
    drift(kit, 38.8, 0, s > 0 ? 28.3 : -28.3, 3.4, 0.9, 0.35, 0);
    // The spawn-facing back: personnel door under a lamp, two frosted windows,
    // a painted band and downpipes (this face is in shade all match long).
    const back = s > 0 ? z1 + 0.02 : z0 - 0.02;
    kit.add('paint', box(35.2, 0.4, Math.min(back, back + s * 0.02), 43, 0.62, Math.max(back, back + s * 0.02)), s > 0 ? ENV.terracottaFaded : ENV.sage, { flat: true, snow: 0 });
    kit.add('paint', box(40.6, 0, Math.min(back, back + s * 0.04), 41.7, 2.15, Math.max(back, back + s * 0.04)), '#6d6a66', { flat: true });
    kit.add('metal', box(40.45, 2.15, Math.min(back, back + s * 0.35), 41.85, 2.25, Math.max(back, back + s * 0.35)), '#55585c', { flat: true });
    kit.add('glow', box(40.95, 2.4, Math.min(back, back + s * 0.12), 41.35, 2.47, Math.max(back, back + s * 0.12)), ENV.glowGold, { k: 2.6, flat: true });
    kit.add('pool', floorQuad(41.15, 0.04, back + s * 1.5, 3.2, 3), ENV.glowGold, { k: 0.4, flat: true });
    for (const x of [36.4, 38.4]) kit.add('signGlow', quad(x, 1.75, back, 1.1, 0.8, 0, s, rect('window', 4)), '#ffffff', { k: 1.15 });
    kit.add('sign', quad(37.4, 2.65, back + s * 0.01, 2.6, 0.33, 0, s, rect('stencil', 2)), '#ffffff', { flat: true });
    for (const x of [34.8, 42.7]) kit.add('metal', cylAB(x, 0.1, back + s * 0.12, x, 3.1, back + s * 0.12, 0.06, 0.06, 6), '#6d7076', { flat: true, snow: 0 });
    // West face (dorm passage): a frosted window pair; east face: a big painted shed number.
    for (const z of [(z0 + z1) / 2 - 1.4, (z0 + z1) / 2 + 1.4]) kit.add('signGlow', quad(34.48, 1.8, z, 1.0, 0.8, -1, 0, rect('window', 4)), '#ffffff', { k: 1.1 });
    kit.add('sign', quad(43.02, 1.9, (z0 + z1) / 2, 2.8, 2.8, 1, 0, rect('seven', 2)), '#ffffff', { flat: true, k: 0.8 });

    // Generator house (S) with exhaust stacks / boiler house (N) with a water tank.
    const g0 = s > 0 ? 15 : -24;
    const g1 = s > 0 ? 24 : -15;
    const GT = OBS.genTop;
    kit.add('concrete', rbox(18, 0, g0, 26, GT, g1, 0.06), '#cfc7b8', { base: 0 });
    kit.add('concrete', box(17.85, GT - 0.1, g0 - 0.15, 26.15, GT + 0.15, g1 + 0.15), ENV.bone, { flat: true });
    kit.add('paint', box(17.98, 3.3, g0 - 0.02, 26.02, 3.5, g1 + 0.02), s > 0 ? ENV.terracottaFaded : ENV.sage, { flat: true, snow: 0 });
    // Clerestory windows glowing warm on every face (the plant room is still lit).
    for (const x of [19.4, 22, 24.6]) {
      for (const zf of [g0 - 0.02, g1 + 0.02]) kit.add('signGlow', quad(x, 4.2, zf, 1.5, 0.7, 0, zf > (g0 + g1) / 2 ? 1 : -1, rect('window', 4)), '#ffffff', { k: 1.1 });
    }
    for (const z of [g0 + 2.2, (g0 + g1) / 2, g1 - 2.2]) {
      kit.add('signGlow', quad(17.98, 4.2, z, 1.5, 0.7, -1, 0, rect('window', 4)), '#ffffff', { k: 1.1 });
      kit.add('signGlow', quad(26.02, 4.2, z, 1.5, 0.7, 1, 0, rect('window', 4)), '#ffffff', { k: 1.1 });
    }
    // Service door + lamp + sign on the courtyard (west) face.
    const zm = (g0 + g1) / 2;
    kit.add('paint', box(17.92, 0, zm - 0.6, 18, 2.2, zm + 0.6), '#6d6a66', { flat: true });
    kit.add('glow', box(17.8, 2.4, zm - 0.15, 17.9, 2.48, zm + 0.15), ENV.glowGold, { k: 2.4, flat: true });
    kit.add('pool', floorQuad(16.8, 0.04, zm, 3, 3), ENV.glowGold, { k: 0.35, flat: true });
    kit.add('sign', quad(17.96, 2.8, zm, 2.4, 0.6, -1, 0, rect(s > 0 ? 'stencil' : 'signBoiler', 2)), '#ffffff', { flat: true });
    // Louvered vents glowing warm (the generator still ticks over).
    for (const x of [19.5, 22, 24.5]) {
      const zf = s > 0 ? g1 + 0.02 : g0 - 0.02;
      kit.add('metal', quad(x, 1.8, zf, 1.4, 1, 0, s), '#34302c', { flat: true });
      for (let y = 1.4; y < 2.25; y += 0.16) kit.add('glow', box(x - 0.65, y, zf - s * 0.005, x + 0.65, y + 0.035, zf + s * 0.02), '#ffb36b', { k: s > 0 ? 1.5 : 0.8, flat: true });
    }
    const RT = GT + 0.15;
    if (s > 0) {
      for (const x of [20, 24]) {
        kit.add('metal', cyl(x, RT, 19.5, 0.35, 3.2, 10, 0.3), '#55585c', { base: RT });
        kit.add('metal', cyl(x, RT + 3.2, 19.5, 0.42, 0.2, 10), '#34302c', { flat: true });
      }
    } else {
      kit.add('metal', cyl(22, RT, -19.5, 2.6, 3.2, 20), ENV.pastelBlue, { base: RT });
      kit.add('metal', cyl(22, RT + 3.2, -19.5, 2.7, 0.3, 20, 2.2), '#6d7076', { flat: true });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        kit.add('metal', cylAB(22 + Math.cos(a) * 2.2, RT, -19.5 + Math.sin(a) * 2.2, 22 + Math.cos(a) * 2.4, RT, -19.5 + Math.sin(a) * 2.4, 0.08, 0.08, 4), '#55585c', { flat: true });
      }
    }
    // Pipes into the dorm.
    kit.add('metal', cylAB(26, 2.9, s * 16, 26, 2.9, s * 15.1, 0.12, 0.12, 8), '#6d7076', { flat: true });
    kit.add('metal', cylAB(26, 2.9, s * 15.1, 26.4, 2.9, s * 15.1, 0.12, 0.12, 8), '#6d7076', { flat: true });

    // Forecourt reels (S) / timber + pipe stack (N) — covers box(25,0,31, 31,3,40).
    const r0 = s > 0 ? 31 : -40;
    const r1 = s > 0 ? 40 : -31;
    if (s > 0) {
      for (const zc of [32.5, 35.5, 38.5]) {
        kit.add('wood', cylAB(25, 1.5, zc, 31, 1.5, zc, 1.5, 1.5, kit.seg(20)), '#8a6a4c', { base: 0 });
        kit.add('wood', cylAB(25.2, 1.5, zc, 30.8, 1.5, zc, 0.95, 0.95, kit.seg(14)), '#3a3a40', { base: 0 });
        kit.add('metal', cylAB(25.25, 1.5, zc, 30.75, 1.5, zc, 1.05, 1.05, kit.seg(14)), '#2e2d31', { flat: true, snow: 0.6 });
      }
    } else {
      kit.add('wood', box(25, 0, r0, 31, 1.4, r1), '#8a6a4c', { base: 0 });
      for (let i = 0; i < 5; i++) kit.add('metal', cylAB(25, 1.75, r0 + 0.9 + i * 1.8, 31, 1.75, r0 + 0.9 + i * 1.8, 0.45, 0.45, 10), '#8e968a', { base: 0 });
      kit.add('fabric', rbox(24.9, 2.1, r0 - 0.1, 31.1, 3.0, r1 + 0.1, 0.3, 2), ENV.sage, { base: 0 });
    }
    lichen(kit, 24.5, 0, s * 35.5, 1.4, ENV.glowSoftPink, rnd);

    // Spare cabin No. 3 under a lashed tarp on its sled (collision 49.5…57 × 27.5…30.5, 2.8 m).
    {
      const [a, b] = s > 0 ? [27.5, 30.5] : [-30.5, -27.5];
      for (const z of [a + 0.35, b - 0.35]) kit.add('metal', rbox(49.4, 0, z - 0.18, 57.1, 0.28, z + 0.18, 0.1, 2), '#34302c', { flat: true, snow: 0.8 });
      kit.add('wood', box(49.5, 0.28, a, 57, 0.5, b), '#6b5240', { base: 0 });
      kit.add('fabric', rbox(49.5, 0.5, a, 57, 2.8, b, 0.6, 3), s > 0 ? ENV.terracottaFaded : ENV.sage, { base: 0.5 });
      for (const x of [50.6, 53.25, 55.9]) kit.add('fabric', box(x - 0.04, 0.45, a - 0.03, x + 0.04, 2.83, b + 0.03), '#4a4038', { flat: true, snow: 0 });
      const face = s > 0 ? a - 0.03 : b + 0.03;
      kit.add('sign', quad(53.25, 1.5, face, 2.6, 0.65, 0, -s, rect('signSpare', 2)), '#ffffff', { flat: true });
      drift(kit, 53, 0, s > 0 ? a - 0.6 : b + 0.6, 3.6, 0.8, 0.5, 0);
    }
  }
  buildTransformer(kit);
  void decor;
}

/** Transformer cabinet in the east alley (collision 36.6…38.8 × −1.2…1.2, 2.1 m): it hums. */
function buildTransformer(kit: ObsKit): void {
  kit.section = 'east.transformer';
  kit.add('concrete', box(36.5, 0, -1.3, 38.9, 0.2, 1.3), ENV.concreteDark, { flat: true, snow: 0.8 });
  kit.add('metal', rbox(36.6, 0.2, -1.2, 38.8, 1.9, 1.2, 0.05), ENV.sage, { base: 0 });
  // Radiator fins on the long faces (flush: within 4 cm of the collision).
  for (const zf of [-1.2, 1.2]) {
    for (let x = 36.85; x < 38.7; x += 0.22) kit.add('metal', box(x - 0.03, 0.35, zf < 0 ? zf - 0.04 : zf, x + 0.03, 1.4, zf < 0 ? zf : zf + 0.04), '#7d8566', { flat: true, snow: 0 });
    kit.add('sign', quad(37.7, 1.62, zf < 0 ? zf - 0.05 : zf + 0.05, 1.6, 0.4, 0, zf < 0 ? -1 : 1, rect('signVolts', 2)), '#ffffff', { flat: true });
  }
  // Squat insulators on the lid (below the step height) + a cable conduit to the dorm.
  for (const x of [37.1, 37.7, 38.3]) kit.add('gloss', cyl(x, 1.9, 0, 0.09, 0.22, 8, 0.06), '#c99a82', { flat: true, snow: 0 });
  kit.add('metal', box(34.5, 0, -0.15, 36.6, 0.12, 0.15), '#34302c', { flat: true, snow: 0.5 });
  kit.add('glow', box(38.8, 1.55, -0.08, 38.83, 1.63, 0.08), ENV.glowChartreuse, { k: 2.2, flat: true });
}

// ── Station deck, pylon, cable, the stuck cabin ────────────────────────────

function buildStation(kit: ObsKit, root: THREE.Object3D, rnd: () => number, decor: number, cableDir: THREE.Vector3): EastParts {
  kit.section = 'east.deck';
  // Deck: concrete body + steel edge band + hazard stripes on the west edge.
  kit.add('concrete', box(42, 0, -9, 57.6, D, 9), '#c9c1b2', { shade: (x, y) => 0.6 + 0.4 * Math.min(1, y / 1.5) });
  kit.add('metal', box(41.95, D - 0.25, -9.05, 57.6, D, 9.05), '#6d7076', { flat: true });
  kit.add('sign', quad(41.93, D - 0.12, -5.5, 7, 0.2, -1, 0, rect('hazard', 2)), '#ffffff', { flat: true });
  kit.add('sign', quad(41.93, D - 0.12, 5.5, 7, 0.2, -1, 0, rect('hazard', 2)), '#ffffff', { flat: true });
  kit.add('sign', quad(41.93, 1.3, 5.5, 3.6, 0.45, -1, 0, rect('signCable', 2)), '#ffffff', { flat: true });
  // Ramps (concrete with anti-slip ribs).
  for (const s of [-1, 1]) {
    const za = s * 9;
    const zb = s * 16;
    const ramp = new THREE.BufferGeometry();
    const P = [
      [42, D + 0.02, za],
      [47, D + 0.02, za],
      [47, 0.02, zb],
      [42, 0.02, zb],
    ];
    const v = s > 0 ? [P[0], P[2], P[1], P[0], P[3], P[2]] : [P[0], P[1], P[2], P[0], P[2], P[3]];
    ramp.setAttribute('position', new THREE.Float32BufferAttribute(v.flat(), 3));
    ramp.computeVertexNormals();
    kit.add('concrete', ramp, '#c3bbad', { flat: true, snow: 0.5 });
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      const z = za + (zb - za) * t;
      const y = D * (1 - t);
      kit.add('metal', box(42.3, y, z - 0.04, 46.7, y + 0.06, z + 0.04), '#8e877b', { flat: true, snow: 0 });
    }
    for (const x of [42, 47]) {
      const side = new THREE.BufferGeometry();
      const q = [
        [x, D, za],
        [x, 0, zb],
        [x, 0, za],
      ];
      side.setAttribute('position', new THREE.Float32BufferAttribute((x > 44) === s > 0 ? [...q[0], ...q[2], ...q[1]] : [...q[0], ...q[1], ...q[2]], 3));
      side.computeVertexNormals();
      kit.add('concrete', side, '#b3ab9d', { base: 0 });
    }
    // Control booths (collision box(47.5, D, 5, 50, D+2.4, 7.5)).
    const b0 = s > 0 ? 5 : -7.5;
    const b1 = s > 0 ? 7.5 : -5;
    kit.add('plaster', rbox(47.5, D, b0, 50, D + 2.4, b1, 0.05), s > 0 ? ENV.pastelYellow : ENV.bone, { base: D });
    kit.add('metal', box(47.3, D + 2.4, b0 - 0.2, 50.2, D + 2.55, b1 + 0.2), '#6d7076', { flat: true });
    kit.add('signGlow', quad(47.48, D + 1.55, (b0 + b1) / 2, 1.8, 0.8, -1, 0, rect('window', 4)), '#ffffff', { k: 1.2 });
    kit.add('signGlow', quad(48.75, D + 1.55, s > 0 ? b0 - 0.02 : b1 + 0.02, 1.8, 0.8, 0, -s, rect('window', 4)), '#ffffff', { k: 1.2 });
    kit.add('pool', floorQuad(46.4, D + 0.04, (b0 + b1) / 2, 2.6, 2.6), ENV.glowGold, { k: 0.3, flat: true });
  }
  // Mantle crate on the deck's west face, cable spool on the deck.
  kit.add('wood', rbox(40.6, 0, -1.8, 42, 1.3, 1.8, 0.04), '#9b7d62', { base: 0 });
  kit.add('wood', box(40.55, 0.6, -1.85, 42.05, 0.7, 1.85), '#6b5240', { flat: true });
  kit.add('wood', cylAB(44.8, D + 0.6, -1.2, 44.8, D + 0.6, 1.2, 0.6, 0.6, kit.seg(16)), '#8a6a4c', { base: D });
  kit.add('metal', cylAB(44.8, D + 0.6, -1.0, 44.8, D + 0.6, 1.0, 0.45, 0.45, kit.seg(12)), '#2e2d31', { flat: true, snow: 0.6 });

  kit.section = 'east.wheelhouse';
  // Bullwheel house: steel frame + corrugated cladding, open toward the pylon.
  const WH = OBS.wheelTop - D; // house height (collision top = OBS.wheelTop)
  kit.add('corrugated', box(50, D, -3.5, 54.4, D + WH, -3.2), ENV.boneShade, { base: D });
  kit.add('corrugated', box(50, D, 3.2, 54.4, D + WH, 3.5), ENV.boneShade, { base: D });
  kit.add('corrugated', box(50, D, -3.5, 50.3, D + WH, 3.5), ENV.boneShade, { base: D });
  kit.add('metal', box(49.8, D + WH, -3.8, 55.2, D + WH + 0.3, 3.8), '#6d7076', { flat: true });
  for (const z of [-3.35, 3.35]) kit.add('metal', box(54.3, D, z - 0.15, 54.6, D + WH, z + 0.15), '#55585c', { flat: true });
  // The open east side: a gantry beam across the top so the house reads closed from the pylon.
  kit.add('metal', box(54.3, D + WH - 0.5, -3.5, 54.6, D + WH, 3.5), '#55585c', { flat: true });
  kit.add('sign', quad(50.0 - 0.02, D + 3.5, 0, 3.6, 0.45, -1, 0, rect('signCable', 2)), '#ffffff', { flat: true });
  kit.add('glow', box(49.9, D + 2.9, -0.3, 49.97, D + 3.0, 0.3), ENV.glowGold, { k: 2.5, flat: true });
  kit.add('pool', floorQuad(48.8, D + 0.05, 0, 3, 3), ENV.glowGold, { k: 0.38, flat: true });
  // Gearbox + motor under the wheel.
  kit.add('metal', rbox(51, D, -1.2, 53.4, D + 1.4, 1.2, 0.08), ENV.sage, { base: D });
  kit.add('metal', cyl(52.2, D + 1.4, 0, 0.35, 0.6, 10), '#55585c', { flat: true });
  // Pylon anchor block + lattice pylon on the rim (the landmark).
  kit.add('concrete', rbox(55, D, -3, 58.5, 9, 3, 0.1), '#cfc7b8', { base: D });
  kit.add('concrete', box(54.9, 8.9, -3.1, 58.6, 9.2, 3.1), ENV.bone, { flat: true });
  kit.addAll('metal', lattice(57.2, 0, 1.6, 0.7, 9.2, 23, 2.2, 0.18, 0.08), ENV.terracottaFaded, { flat: true, snow: 0.2 });
  // Crossarm with two sheave trains (carrier cables) pointing along the ropeway.
  const ca = new THREE.Vector3(cableDir.z, 0, -cableDir.x).normalize();
  const top = new THREE.Vector3(57.2, 23.2, 0);
  kit.add('metal', beam(top.x - ca.x * 3.2, top.y, top.z - ca.z * 3.2, top.x + ca.x * 3.2, top.y, top.z + ca.z * 3.2, 0.35, 0.5), ENV.terracottaFaded, { flat: true });
  const beacons: THREE.Vector3[] = [];
  for (const side of [-1, 1]) {
    const sx = top.x + ca.x * 2.6 * side;
    const sz = top.z + ca.z * 2.6 * side;
    kit.add('metal', beam(sx - cableDir.x * 1.6, top.y + 0.35, sz - cableDir.z * 1.6, sx + cableDir.x * 1.6, top.y + 0.35, sz + cableDir.z * 1.6, 0.25, 0.4), '#55585c', { flat: true });
    for (let k = -1; k <= 1; k++) kit.add('metal', cylAB(sx + cableDir.x * k * 1.0 - ca.x * 0.2, top.y + 0.6, sz + cableDir.z * k * 1.0 - ca.z * 0.2, sx + cableDir.x * k * 1.0 + ca.x * 0.2, top.y + 0.6, sz + cableDir.z * k * 1.0 + ca.z * 0.2, 0.28, 0.28, 10), '#2e2d31', { flat: true });
    beacons.push(new THREE.Vector3(sx, top.y + 1.3, sz));
    // Cables: from the bullwheel over the sheaves and out over the void (fading into the clouds).
    const out = new THREE.Vector3(sx, top.y + 0.9, sz).addScaledVector(cableDir, 240);
    out.y = -38;
    kit.add('metal', cable(52.2, D + 2.2, side * 2.4, sx, top.y + 0.9, sz, 0.3, 0.05, 8, 4), '#2e2d31', { flat: true, snow: 0 });
    kit.add('metal', cable(sx, top.y + 0.9, sz, out.x, out.y, out.z, 16, 0.06, 32, 4), '#2e2d31', { flat: true, snow: 0 });
  }
  // Maintenance ladder up the pylon (visual).
  kit.add('metal', cylAB(55.5, 9.2, -0.4, 56.4, 23, -0.4, 0.03, 0.03, 4), '#55585c', { flat: true });
  kit.add('metal', cylAB(55.5, 9.2, 0.4, 56.4, 23, 0.4, 0.03, 0.03, 4), '#55585c', { flat: true });
  beacons.push(new THREE.Vector3(57.2, 24.4, 0));
  kit.add('metal', box(56.9, 23.2, -0.3, 57.5, 24.2, 0.3), '#34302c', { flat: true });
  // Rim parapet around the deck's east edge (just past the bounds).
  for (const s of [-1, 1]) kit.add('concrete', box(57.05, D, s > 0 ? 3.2 : -9, 57.6, D + 1.0, s > 0 ? 9 : -3.2), '#bdb5a6', { base: D });
  lichen(kit, 42.4, 0, -6.5, 1.3, ENV.glowChartreuse, rnd);

  // ── The stuck cabin (own group; sways) + the bullwheel (own group; creaks) ──
  const cabin = new THREE.Group();
  cabin.name = 'obs.cabin';
  const grip = top.clone().addScaledVector(cableDir, 15);
  grip.y = top.y + 0.9 - 1.4;
  cabin.position.copy(grip);
  cabin.rotation.y = Math.atan2(cableDir.x, cableDir.z);
  const ck = new ObsKit(kit.ctx, 'obs.cabin');
  ck.snowDefault = 1;
  buildCabin(ck);
  ck.build(cabin);
  root.add(cabin);

  const wheel = new THREE.Group();
  wheel.name = 'obs.bullwheel';
  wheel.position.set(52.2, D + 2.2, 0);
  const wk = new ObsKit(kit.ctx, 'obs.wheel');
  wk.snowDefault = 0;
  wk.add('metal', cyl(0, -0.2, 0, 2.5, 0.4, wk.seg(32), 2.5, true), '#55585c', { flat: true });
  wk.add('metal', cyl(0, -0.25, 0, 2.62, 0.5, wk.seg(32), 2.62, true), '#2e2d31', { flat: true });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    wk.add('metal', beam(0, 0, 0, Math.cos(a) * 2.45, 0, Math.sin(a) * 2.45, 0.18, 0.14), ENV.sage, { flat: true });
  }
  wk.add('metal', cyl(0, -0.4, 0, 0.45, 0.8, 12), '#34302c', { flat: true });
  wk.build(wheel);
  root.add(wheel);
  void decor;
  return { cabin, cabinKit: ck, wheel, wheelKit: wk, beacons };
}

function buildCabin(k: ObsKit): void {
  // Local frame: origin = the grip on the carrier cable; −Y hangs down; +Z along the ropeway.
  const hang = 3.2;
  // Hanger arm + carriage (trolley wheels on the cable).
  k.add('metal', box(-0.2, -0.3, -1.2, 0.2, 0.2, 1.2), '#55585c', { flat: true });
  for (const z of [-0.9, 0.9]) k.add('metal', cylAB(-0.25, 0.1, z, 0.25, 0.1, z, 0.22, 0.22, 10), '#2e2d31', { flat: true });
  k.add('metal', beam(0, -0.2, 0, 0, -hang + 0.3, 0.4, 0.14), '#55585c', { flat: true });
  k.add('metal', beam(0, -hang + 0.3, 0.4, 0, -hang + 0.3, -0.6, 0.12), '#55585c', { flat: true });
  // Body: rounded 70s gondola, pastel yellow with a bone roof, big windows (dark), a number 7.
  const y0 = -hang - 2.3;
  const y1 = -hang + 0.1;
  k.add('paint', rbox(-1.2, y0, -1.6, 1.2, y1, 1.6, 0.35, 3), ENV.pastelYellow, { base: y0, snow: 0 });
  k.add('paint', rbox(-1.25, y1 - 0.25, -1.65, 1.25, y1 + 0.2, 1.65, 0.3, 2), ENV.bone, { snow: 1 });
  for (const s of [-1, 1]) {
    k.add('glass', quad(0, y0 + 1.45, s * 1.62, 2.0, 0.9, 0, s), '#3a3c4e', { flat: true });
    k.add('glass', quad(s * 1.22, y0 + 1.45, 0, 2.6, 0.9, s, 0), '#3a3c4e', { flat: true });
  }
  k.add('sign', quad(1.23, y0 + 0.55, 0.9, 0.55, 0.55, 1, 0, rect('seven', 2)), '#ffffff', { flat: true });
  k.add('sign', quad(-1.23, y0 + 0.55, -0.9, 0.55, 0.55, -1, 0, rect('seven', 2)), '#ffffff', { flat: true });
  // Door hanging ajar, icicles along the roof edge, a faint interior glow (someone left a lamp).
  k.add('paint', box(1.22, y0 + 0.15, -0.3, 1.28, y0 + 1.9, 0.45), ENV.pastelYellow, { flat: true, snow: 0 }, new THREE.Matrix4().makeRotationY(0.4));
  k.add('glow', box(-0.3, y0 + 0.9, -0.2, 0.3, y0 + 1.0, 0.2), ENV.glowGold, { k: 1.6, flat: true });
  for (let i = 0; i < 9; i++) {
    const z = -1.4 + i * 0.35;
    k.add('snow', new THREE.ConeGeometry(0.04, 0.2 + (i % 3) * 0.12, 5).rotateX(Math.PI).translate(1.25, y1 - 0.3 - 0.1, z), '#e8eef7', { flat: true });
  }
}

export { sphere };
