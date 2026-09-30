// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Observatory spawn compounds + courtyard props.
//
//  • South (HALCYON): the UPPER TRAM TERMINAL — a streamlined 1970s station
//    cantilevered over the cliff, a warm glowing glass front, the tramway
//    cables diving south into the clouds with a far cabin mid-way.
//  • North (BLOOM): the WINTER QUARTERS — timber bunkhouse, the generator hut
//    with glowing louvers and an exhaust stack, fuel tanks, a snowcat garage.
//  • Both yards: walls with gate portals, blast baffles, benches, the summit map.
//  • Courtyards (collision mirrored, props varied): snowcat / fuel sled, crate
//    stacks, the crated spare mirror blank, the instrument sled, lamp posts.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { OBS } from '../../../../shared/maps/observatory';
import { ENV } from '../../../engine/palette';
import { rect } from './atlas';
import { beam, box, cable, cyl, cylAB, lattice, ObsKit, quad, rbox, smooth, sphere, floorQuad } from './kit';
import { drift, lichen } from './rocks';

const WALL = '#d3cbbc';

export function buildCompounds(kit: ObsKit, rnd: () => number, decor: number): void {
  const YW = OBS.yardWall;
  for (const s of [-1, 1] as const) {
    kit.section = 'spawn.walls';
    // Yard walls (4 m) with coping + pilasters, gate portals, baffles.
    const segs: [number, number][] = [
      [-53, -2],
      [2, 53],
    ];
    const z0 = s * 42;
    const z1 = s * 43;
    const band = s > 0 ? ENV.terracottaFaded : ENV.sage;
    for (const [a, b] of segs) {
      kit.add('concrete', rbox(a, 0, Math.min(z0, z1), b, YW, Math.max(z0, z1), 0.05), WALL, { base: 0 });
      kit.add('concrete', box(a - 0.05, YW - 0.15, Math.min(z0, z1) - 0.12, b + 0.05, YW + 0.1, Math.max(z0, z1) + 0.12), ENV.bone, { flat: true });
      // Pilasters on both faces every 5 m (the long wall reads as bays, not a blank slab).
      for (let x = a + 3; x < b - 1; x += 5) {
        kit.add('concrete', box(x - 0.25, 0.4, s * 41.85, x + 0.25, YW - 0.15, s * 41.95), WALL, { flat: true });
        kit.add('concrete', box(x - 0.25, 0.4, s * 43.05, x + 0.25, YW - 0.15, s * 43.15), WALL, { flat: true });
      }
      // A faded painted band on both faces + a darker plinth.
      kit.add('paint', box(a, 1.1, s * 41.98, b, 1.35, s * 41.99), band, { flat: true, snow: 0 });
      kit.add('paint', box(a, YW - 1.2, s * 41.98, b, YW - 0.95, s * 41.99), band, { flat: true, snow: 0 });
      kit.add('paint', box(a, 2.6, s * 43.01, b, 2.8, s * 43.02), band, { flat: true, snow: 0 });
      kit.add('concrete', box(a, 0, Math.min(z0, z1) - 0.06, b, 0.45, Math.max(z0, z1) + 0.06), ENV.concreteDark, { flat: true, snow: 0.7 });
    }
    // Wall lamps along the outer face (warm pools every 10 m — the forecourts read at night).
    for (let x = -45; x <= 45; x += 10) {
      if (Math.abs(x) < 6) continue;
      kit.add('metal', box(x - 0.18, 3.1, s * 41.72, x + 0.18, 3.3, s * 41.98), '#34302c', { flat: true });
      kit.add('glow', box(x - 0.14, 3.02, s * 41.74, x + 0.14, 3.1, s * 41.94), ENV.glowGold, { k: 2.6, flat: true });
      kit.add('pool', floorQuad(x, 0.04, s * 40.4, 3.4, 3), ENV.glowGold, { k: 0.3, flat: true });
    }
    for (const [ga, gb] of OBS.gates) {
      for (const x of [ga - 0.4, gb + 0.4]) {
        // Portal pilasters sit inside the wall line (no invisible-collision mismatch) and rise above it.
        kit.add('concrete', rbox(x - 0.4, 0, s * 42.5 - 0.55, x + 0.4, YW + 0.7, s * 42.5 + 0.55, 0.05), ENV.bone, { base: 0 });
        kit.add('glow', sphere(x, YW + 0.85, s * 42.5, 0.16, 8, 6), ENV.glowGold, { k: 3, flat: true });
      }
      kit.add('pool', floorQuad((ga + gb) / 2, 0.04, s * 40.8, 5, 3.5), ENV.glowGold, { k: 0.45, flat: true });
      kit.add('metal', box(ga - 0.4, 4.3, s * 42.45, gb + 0.4, 4.45, s * 42.55), '#55585c', { flat: true });
      // Wall above the gate opening (the collision is the full-height wall with a 4.3 m portal cut).
      kit.add('concrete', box(ga, 4.45, Math.min(z0, z1), gb, YW, Math.max(z0, z1)), WALL, { flat: true });
    }
    // Baffles (3.2 m) with a painted stripe.
    for (const [a, b] of [
      [-57, -47],
      [-8.5, 8.5],
      [47, 57],
    ]) {
      kit.add('concrete', rbox(a, 0, s > 0 ? 44.6 : -45.6, b, 3.2, s > 0 ? 45.6 : -44.6, 0.06), WALL, { base: 0 });
      kit.add('paint', box(a, 2.3, s > 0 ? 44.58 : -45.62, b, 2.5, s > 0 ? 45.62 : -44.58), s > 0 ? ENV.pastelBlue : ENV.pastelMint, { flat: true, snow: 0 });
    }
    buildPorch(kit, s);
    buildYardDressing(kit, s);
    // Summit map boards + signs (inside the yard, on the baffles).
    kit.add('sign', quad(0, 1.6, s * (45.6 + 0.02), 1.6, 1.6, 0, s, rect('map', 2)), '#ffffff', { flat: true });
    // Station sign over the centre gate (facing the map; a solid board behind it for the yard side).
    kit.add('sign', quad(0, 5.0, s * 41.72, 6.4, 0.8, 0, -s, rect(s > 0 ? 'signTerminal' : 'signQuarters', 2)), '#ffffff', { flat: true });
    kit.add('metal', box(-3.3, 4.55, Math.min(s * 41.75, s * 41.95), 3.3, 5.45, Math.max(s * 41.75, s * 41.95)), '#34302c', { flat: true });
    // Yard paving + snow drifts in the corners.
    kit.add('concrete', box(-57, 0, Math.min(s * 45.6, s * 60), 57, 0.02, Math.max(s * 45.6, s * 60)), '#c8c0b2', { flat: true, snow: 0.35 });
    drift(kit, -55.5, 0, s * 47, 1.3, 2.4, 0.4, 0);
    drift(kit, 55.5, 0, s * 47.5, 1.3, 2.6, 0.45, 0);
    drift(kit, -20, 0, s * 43.6, 3.5, 0.6, 0.3, 0);
    drift(kit, 25, 0, s * 43.6, 4, 0.6, 0.35, 0);

    if (s > 0) buildTerminal(kit, rnd, decor);
    else buildQuarters(kit, rnd, decor);
  }
  buildCourtyards(kit, rnd, decor);
}

/**
 * Spawn-yard dressing — only flat or wall-mounted things (nothing free-standing
 * without collision where players spawn): painted safety lines and gate
 * chevrons on the paving, lamps on the baffles' yard faces, a platform edge
 * stripe along the building front.
 */
function buildYardDressing(kit: ObsKit, s: 1 | -1): void {
  kit.section = 'spawn.dressing';
  const y = 0.03;
  const line = s > 0 ? ENV.pastelYellow : ENV.bone;
  // Dashed safety line between the spawn row and the baffles.
  for (let x = -54; x < 54; x += 2.4) kit.add('paint', box(x, 0.02, s * 47.7 - 0.07, x + 1.3, y, s * 47.7 + 0.07), line, { flat: true, snow: 0 });
  // Chevrons pointing to each gate's way round its baffle.
  const bar = (ax: number, az: number, bx: number, bz: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const m = new THREE.Matrix4().makeRotationY(Math.atan2(bx - ax, bz - az)).setPosition((ax + bx) / 2, 0, (az + bz) / 2);
    kit.add('paint', box(-0.09, 0.02, -len / 2, 0.09, y, len / 2), line, { flat: true, snow: 0 }, m);
  };
  const chevron = (cx: number, cz: number, dir: 1 | -1): void => {
    for (const k of [0, 0.9]) {
      const tx = cx + dir * k;
      bar(tx - dir * 0.5, cz - 0.55, tx, cz);
      bar(tx - dir * 0.5, cz + 0.55, tx, cz);
    }
  };
  chevron(-44, s * 46.6, -1);
  chevron(-11, s * 46.6, 1);
  chevron(11, s * 46.6, -1);
  chevron(44, s * 46.6, 1);
  // Lamps on the baffles' yard faces.
  for (const x of [-52, -12 + 3.5, 12 - 3.5, 52]) {
    const zf = s * 45.62;
    kit.add('metal', box(x - 0.2, 2.55, Math.min(zf, zf + s * 0.22), x + 0.2, 2.72, Math.max(zf, zf + s * 0.22)), '#34302c', { flat: true });
    kit.add('glow', box(x - 0.15, 2.48, Math.min(zf, zf + s * 0.19), x + 0.15, 2.55, Math.max(zf, zf + s * 0.19)), ENV.glowGold, { k: 2.6, flat: true });
    kit.add('pool', floorQuad(x, 0.04, s * 47.2, 3.6, 3.2), ENV.glowGold, { k: 0.34, flat: true });
  }
  // Platform edge stripe along the building front.
  kit.add('sign', floorQuad(0, y, s * 59.4, 28, 0.36, rect('hazard', 2), s > 0 ? 0 : Math.PI), '#ffffff', { flat: true });
}

/** Centre-gate wind-break porch (collision box −5.5…5.5 × 37.2…38.2, 3.2 m): exits split left / right. */
function buildPorch(kit: ObsKit, s: 1 | -1): void {
  kit.section = 'spawn.porch';
  const za = s * 37.2;
  const zb = s * 38.2;
  const z0 = Math.min(za, zb);
  const z1 = Math.max(za, zb);
  const board = (x: number, y: number): number => (0.64 + 0.36 * smooth(0, 1.6, y)) * (0.97 + 0.03 * Math.sign(Math.sin(y * 7.9)));
  kit.add('concrete', rbox(-5.5, 0, z0, 5.5, 3.2, z1, 0.06), WALL, { shade: board });
  kit.add('concrete', box(-5.62, 3.05, z0 - 0.12, 5.62, 3.3, z1 + 0.12), ENV.bone, { flat: true });
  kit.add('concrete', box(-5.5, 0, z0 - 0.06, 5.5, 0.45, z1 + 0.06), ENV.concreteDark, { flat: true, snow: 0.7 });
  // Painted gate lettering + chevrons on the map-facing face, a stripe on the gate side.
  const out = s > 0 ? z0 - 0.02 : z1 + 0.02;
  const inner = s > 0 ? z1 + 0.02 : z0 - 0.02;
  kit.add('sign', quad(0, 1.75, out, 5.2, 0.65, 0, -s, rect('signPorch', 2)), '#ffffff', { flat: true });
  kit.add('paint', box(-5.5, 2.35, Math.min(inner, inner + s * 0.01), 5.5, 2.55, Math.max(inner, inner + s * 0.01)), s > 0 ? ENV.pastelBlue : ENV.pastelMint, { flat: true, snow: 0 });
  // Hooded lamps on the gate side light the vestibule; a drift piles against the windward face.
  for (const x of [-3.2, 3.2]) {
    kit.add('metal', box(x - 0.22, 2.7, Math.min(inner, inner + s * 0.3), x + 0.22, 2.9, Math.max(inner, inner + s * 0.3)), '#34302c', { flat: true });
    kit.add('glow', box(x - 0.16, 2.62, Math.min(inner, inner + s * 0.26), x + 0.16, 2.7, Math.max(inner, inner + s * 0.26)), ENV.glowGold, { k: 2.8, flat: true });
  }
  kit.add('pool', floorQuad(0, 0.04, s * 40, 11, 3.6), ENV.glowGold, { k: 0.4, flat: true });
  drift(kit, -1.5, 0, s * 36.7, 4.8, 0.9, 0.55, 0);
  drift(kit, 3.8, 0, s * 36.8, 2.2, 0.7, 0.4, 0.2);
}

function buildTerminal(kit: ObsKit, rnd: () => number, decor: number): void {
  kit.section = 'spawn.terminal';
  const zf = 60.2;
  // Streamlined station hall over the cliff: stepped concrete podium, glass front, swept roof.
  kit.add('concrete', box(-16, -8, zf, 16, 0.4, zf + 12), ENV.concreteDark, { base: -8 });
  kit.add('concrete', rbox(-15, 0.4, zf, 15, 1.2, zf + 11), WALL, { base: 0.4 });
  const wing = new THREE.Shape();
  wing.moveTo(-16, 0);
  wing.lineTo(16, 0);
  wing.lineTo(15, 1.0);
  wing.quadraticCurveTo(0, 2.2, -15, 1.0);
  wing.lineTo(-16, 0);
  const roof = new THREE.ExtrudeGeometry(wing, { depth: 13, bevelEnabled: false, curveSegments: 8 });
  roof.translate(0, 7.2, zf - 1.2);
  kit.add('plaster', roof, ENV.bone, { base: 7 });
  kit.add('metal', box(-16, 7.0, zf - 1.2, 16, 7.25, zf + 11.8), '#55585c', { flat: true });
  // Glass front: frosted panels glowing warm between slim mullions.
  for (let x = -14; x < 14; x += 2.8) {
    kit.add('signGlow', quad(x + 1.4, 4.15, zf - 0.02, 2.6, 5.9, 0, -1, rect('window', 3)), '#ffffff', { k: 1.15 });
    kit.add('metal', box(x - 0.08, 1.2, zf - 0.1, x + 0.08, 7.1, zf + 0.05), '#6d7076', { flat: true });
  }
  kit.add('metal', box(-14.1, 1.15, zf - 0.12, 14.1, 1.3, zf + 0.05), '#6d7076', { flat: true });
  kit.add('pool', floorQuad(0, 0.04, 57.5, 26, 6), ENV.glowGold, { k: 0.28, flat: true });
  // Side walls (terracotta panels) + the tram roundel.
  for (const x of [-15, 15]) kit.add('plaster', box(x - 0.6, 1.2, zf, x + 0.6, 7.1, zf + 11), ENV.terracottaFaded, { base: 1.2 });
  kit.add('sign', quad(0, 8.6, zf - 1.25, 2.2, 2.2, 0, -1, rect('roundel', 2)), '#ffffff', { flat: true });
  // Tramway: bullwheel housing at the back and the cables diving south into the clouds.
  const tgt: [number, number, number][] = [
    [-2.2, 5.5, 72],
    [2.2, 5.5, 72],
  ];
  for (const [x, y, z] of tgt) {
    kit.add('metal', cable(x, y, z, x * 3 - 60, -40, 330, 22, 0.07, 32, 4), '#2e2d31', { flat: true, snow: 0 });
  }
  // A far cabin mid-way down (tiny, warm window).
  const far = new THREE.Vector3(-18, -6, 150);
  kit.add('paint', rbox(far.x - 1.1, far.y - 1.6, far.z - 1.4, far.x + 1.1, far.y + 0.8, far.z + 1.4, 0.3, 2), ENV.pastelYellow, { flat: true });
  kit.add('glow', box(far.x - 1.12, far.y - 0.6, far.z - 0.9, far.x + 1.12, far.y + 0.1, far.z + 0.9), ENV.glowGold, { k: 1.8, flat: true });
  kit.add('metal', cylAB(far.x, far.y + 0.8, far.z, far.x, far.y + 3.2, far.z, 0.08, 0.08, 4), '#2e2d31', { flat: true });
  // Benches, luggage cart and lamp posts along the back rim — just past the
  // playable bounds (z > 60.4), so nothing without collision stands where players walk.
  for (const x of [-30, 30]) {
    kit.add('wood', box(x - 1.2, 0.42, 60.55, x + 1.2, 0.5, 61.15), '#8a6a4c', { flat: true, snow: 0.8 });
    for (const dx of [-1, 1]) kit.add('metal', box(x + dx - 0.05, 0, 60.55, x + dx + 0.05, 0.42, 61.15), '#55585c', { flat: true });
  }
  for (const x of [-40, -20, 20, 40]) lampPost(kit, x, 60.75);
  kit.add('metal', box(-26, 0.3, 60.5, -23.4, 0.4, 61.4), '#6d7076', { flat: true });
  for (const [x, c] of [
    [-25.5, ENV.terracottaFaded],
    [-24.4, ENV.pastelBlue],
  ] as const)
    kit.add('fabric', rbox(x - 0.45, 0.4, 60.55, x + 0.45, 0.95, 61.35, 0.08), c, { base: 0.4 });
  kit.add('sign', quad(10.5, 1.6, 59.95, 1.1, 1.65, 0, -1, rect('poster', 2)), '#ffffff', { flat: true });
  void rnd;
  void decor;
}

function buildQuarters(kit: ObsKit, rnd: () => number, decor: number): void {
  kit.section = 'spawn.quarters';
  const zf = -60.2;
  // Long timber bunkhouse on a stone plinth (cantilevered over the rim), gabled roof with snow.
  kit.add('concrete', box(-18, -8, zf - 11, 6, 0.5, zf), ENV.concreteDark, { base: -8 });
  kit.add('wood', box(-17, 0.5, zf - 9, 5, 4.2, zf), '#a88c6c', { base: 0.5 });
  const gable = new THREE.Shape();
  gable.moveTo(-0.6, 0);
  gable.lineTo(9.6, 0);
  gable.lineTo(4.5, 2.6);
  gable.lineTo(-0.6, 0);
  const g = new THREE.ExtrudeGeometry(gable, { depth: 23, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(-17.5, 4.2, zf + 0.6);
  kit.add('plaster', g, ENV.terracottaFaded, { base: 4.2, snow: 1 });
  for (let x = -15; x < 4; x += 3) {
    kit.add('signGlow', quad(x, 2.4, zf + 0.02, 1.1, 1.4, 0, 1, rect('window', 4)), '#ffffff', { k: 1.25 });
    kit.add('wood', box(x - 0.7, 1.6, zf, x + 0.7, 1.7, zf + 0.15), ENV.bone, { flat: true });
  }
  kit.add('wood', box(-3, 0.5, zf - 0.05, -1.6, 2.6, zf + 0.05), '#6b5240', { flat: true });
  kit.add('pool', floorQuad(-2.3, 0.04, -58.6, 3, 2.6), ENV.glowGold, { k: 0.4, flat: true });
  kit.add('glow', box(-2.5, 2.8, zf + 0.02, -2.1, 2.9, zf + 0.25), ENV.glowGold, { k: 2.6, flat: true });
  // Generator hut with glowing louvers + exhaust stack.
  kit.add('corrugated', box(8, 0, zf - 7, 15, 3.6, zf), ENV.sage, { base: 0 });
  kit.add('metal', box(7.8, 3.6, zf - 7.2, 15.2, 3.8, zf + 0.2), '#6d7076', { flat: true });
  for (let y = 1.2; y < 2.8; y += 0.18) kit.add('glow', box(9, y, zf + 0.01, 14, y + 0.04, zf + 0.03), '#ffb36b', { k: 1.6, flat: true });
  kit.add('metal', cyl(13.5, 3.8, zf - 3, 0.35, 4.5, 10, 0.3), '#55585c', { base: 3.8 });
  kit.add('pool', floorQuad(11.5, 0.04, -58.8, 6, 2.6), '#ffb36b', { k: 0.35, flat: true });
  // Fuel tanks (horizontal) on saddles, a snowcat garage with a half-open door.
  for (const x of [20, 24]) {
    kit.add('metal', cylAB(x, 1.3, zf - 1.5, x, 1.3, zf - 7.5, 1.1, 1.1, 16), ENV.pastelBlue, { base: 0 });
    for (const z of [zf - 2.5, zf - 6.5]) kit.add('concrete', box(x - 0.9, 0, z - 0.3, x + 0.9, 0.5, z + 0.3), ENV.concreteDark, { flat: true });
  }
  kit.add('corrugated', box(-34, 0, zf - 10, -22, 4.5, zf), ENV.pastelMint, { base: 0 });
  kit.add('metal', box(-34.2, 4.5, zf - 10.2, -21.8, 4.8, zf + 0.2), '#6d7076', { flat: true });
  kit.add('paint', quad(-28, 2.9, zf + 0.02, 6, 3.2, 0, 1), '#8e877b', { flat: true });
  kit.add('paint', quad(-28, 0.65, zf + 0.02, 6, 1.3, 0, 1), '#1f1e22', { flat: true });
  kit.add('pool', floorQuad(-28, 0.04, -59, 6, 2.2), ENV.glowGold, { k: 0.25, flat: true });
  // Radio mast + frozen laundry line of scarves (pastel).
  kit.addAll('metal', lattice(-40, zf - 3, 0.35, 0.15, 0, 18, 1.5, 0.06, 0.03), '#d6d0c4', { flat: true, snow: 0.3 });
  kit.add('fabric', cable(-40, 6, zf - 3, -34, 4.5, zf - 1, 0.4, 0.01, 6, 3), '#4a4038', { flat: true, snow: 0 });
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    const x = -40 + 6 * t;
    const y = 6 - 1.5 * t - 0.4 * 4 * t * (1 - t) - 0.35;
    kit.add('fabric', box(x - 0.18, y - 0.35, zf - 3 + 2 * t - 0.01, x + 0.18, y + 0.3, zf - 3 + 2 * t + 0.01), [ENV.pastelPink, ENV.pastelYellow, ENV.bone, ENV.pastelBlue, ENV.sage][i], { flat: true, snow: 0 });
  }
  for (const x of [-40, -20, 20, 40]) lampPost(kit, x, -60.75);
  void rnd;
  void decor;
}

function lampPost(kit: ObsKit, x: number, z: number): void {
  kit.add('metal', cylAB(x, 0, z, x, 4.2, z, 0.07, 0.05, 6), '#34302c', { flat: true });
  kit.add('metal', cylAB(x, 4.2, z, x, 4.2, z - Math.sign(z) * 0.6, 0.04, 0.04, 4), '#34302c', { flat: true });
  kit.add('glow', sphere(x, 4.05, z - Math.sign(z) * 0.6, 0.14, 8, 6), ENV.glowGold, { k: 3, flat: true });
  kit.add('pool', floorQuad(x, 0.04, z - Math.sign(z) * 2, 4.4, 4.4), ENV.glowGold, { k: 0.35, flat: true });
}

// ── Courtyards ──────────────────────────────────────────────────────────────

function crate(kit: ObsKit, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color = '#b39a7f'): void {
  kit.add('wood', rbox(x0, y0, z0, x1, y1, z1, 0.03), color, { base: 0 });
  // Battens.
  kit.add('wood', box(x0 - 0.02, y0 + 0.08, z0 - 0.02, x1 + 0.02, y0 + 0.2, z1 + 0.02), '#6b5240', { flat: true, snow: 0 });
  kit.add('wood', box(x0 - 0.02, y1 - 0.2, z0 - 0.02, x1 + 0.02, y1 - 0.08, z1 + 0.02), '#6b5240', { flat: true, snow: 0 });
}

function buildCourtyards(kit: ObsKit, rnd: () => number, decor: number): void {
  kit.section = 'court';
  for (const s of [-1, 1] as const) {
    const Z = (z: number): number => s * z;
    const zr = (a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a]);
    // Snowcat (S) / fuel sled (N): box(-17.5,0,17, -12,2.3,20).
    {
      const [z0, z1] = zr(17, 20);
      if (s > 0) {
        for (const [ta, tb] of [
          [z0, z0 + 0.85],
          [z1 - 0.85, z1],
        ]) {
          kit.add('metal', rbox(-17.5, 0, ta, -12, 0.95, tb, 0.35, 2), '#2e2d31', { base: 0, snow: 0.6 });
          for (let x = -16.9; x <= -12.5; x += 1.1) kit.add('metal', cylAB(x, 0.45, ta - 0.02, x, 0.45, tb + 0.02, 0.3, 0.3, 10), '#55585c', { flat: true, snow: 0 });
        }
        kit.add('paint', rbox(-17.2, 0.85, z0 + 0.7, -12.3, 1.6, z1 - 0.7, 0.12, 2), ENV.pastelYellow, { base: 0.85 });
        kit.add('paint', rbox(-15.4, 1.6, z0 + 0.75, -12.4, 2.3, z1 - 0.75, 0.18, 2), ENV.pastelYellow, { base: 1.6 });
        kit.add('glass', quad(-12.38, 2.0, (z0 + z1) / 2, 1.3, 0.5, 1, 0, undefined, -0.2), '#3a3c4e', { flat: true });
        for (const zz of [z0 + 0.74, z1 - 0.74]) kit.add('glass', quad(-13.9, 2.0, zz, 2.4, 0.5, 0, zz < (z0 + z1) / 2 ? -1 : 1), '#3a3c4e', { flat: true });
        kit.add('metal', box(-17, 1.6, z0 + 0.8, -15.6, 1.9, z1 - 0.8), '#6d7076', { flat: true });
        for (const zz of [z0 + 1.0, z0 + 1.5]) kit.add('paint', rbox(-16.9, 1.9, zz - 0.18, -16.3, 2.35, zz + 0.18, 0.04), ENV.terracottaFaded, { base: 1.9 });
        kit.add('glow', box(-12.28, 1.1, z0 + 0.8, -12.2, 1.3, z0 + 1.1), ENV.glowGold, { k: 1.6, flat: true });
        kit.add('sign', quad(-14.75, 1.25, z1 - 0.68, 1.2, 0.3, 0, 1, rect('stencil', 2)), '#ffffff', { flat: true });
      } else {
        kit.add('wood', box(-17.5, 0, z0 + 0.2, -12, 0.25, z0 + 0.45), '#6b5240', { flat: true });
        kit.add('wood', box(-17.5, 0, z1 - 0.45, -12, 0.25, z1 - 0.2), '#6b5240', { flat: true });
        kit.add('wood', box(-17.3, 0.25, z0 + 0.1, -12.2, 0.45, z1 - 0.1), '#8a6a4c', { base: 0 });
        kit.add('metal', cylAB(-17.2, 1.37, (z0 + z1) / 2, -12.3, 1.37, (z0 + z1) / 2, 0.93, 0.93, 16), ENV.pastelBlue, { base: 0.45 });
        for (const x of [-16.5, -13]) kit.add('metal', box(x - 0.1, 0.45, z0 + 0.3, x + 0.1, 2.3, z1 - 0.3), '#55585c', { flat: true });
      }
    }
    // Crate stacks W & E, equipment sled, instrument crates, low crates, mirror-blank crate.
    {
      const [a, b] = zr(27.5, 30.5);
      crate(kit, -23, 0, a, -19.4, 1.45, b);
      crate(kit, -19.4, 0, a, -16, 1.45, b, '#c1a585');
      crate(kit, -22.6, 1.45, a + 0.2, -18.6, 2.8, b - 0.2, '#a88c6c');
      kit.add('sign', quad(-20.6, 2.1, s > 0 ? a - 0.02 : b + 0.02, 2.6, 0.33, 0, -s, rect('stencil', 2)), '#ffffff', { flat: true });
      kit.add('fabric', rbox(-19, 1.45, a + 0.1, -16.1, 2.1, b - 0.1, 0.2, 2), ENV.sage, { base: 1.45 });
    }
    {
      const [a, b] = zr(27, 29.6);
      crate(kit, 12.5, 0, a, 18, 1.5, b, '#c1a585');
      crate(kit, 13, 1.5, a + 0.15, 16.2, 2.8, b - 0.15);
      kit.add('fabric', rbox(16.2, 1.5, a + 0.2, 17.9, 2.3, b - 0.2, 0.25, 2), ENV.terracottaFaded, { base: 1.5 });
    }
    {
      const [a, b] = zr(25.5, 27.6);
      kit.add('wood', box(-3, 0, a, 3, 0.3, b), '#6b5240', { base: 0 });
      // Stencilled optics warning + vertical battens on both long faces of the crate.
      const cx1 = s > 0 ? 1.2 : 0.5;
      const cmid = (-2.7 + cx1) / 2;
      for (const zf of [a + 0.13, b - 0.13]) {
        const nz = zf < (a + b) / 2 ? -1 : 1;
        kit.add('sign', quad(cmid, 2.05, zf + nz * 0.05, cx1 + 2.7 - 0.6, 0.38, 0, nz, rect('stencil', 2)), '#ffffff', { flat: true });
        for (const x of [-2.4, cmid, cx1 - 0.3]) kit.add('wood', box(x - 0.08, 0.35, Math.min(zf, zf + nz * 0.04), x + 0.08, 1.8, Math.max(zf, zf + nz * 0.04)), '#6b5240', { flat: true, snow: 0 });
      }
      if (s > 0) {
        // Crated secondary mirror + a coil of cable.
        crate(kit, -2.7, 0.3, a + 0.15, 1.2, 2.8, b - 0.15, '#9b7d62');
        kit.add('glass', cyl(0, -0.015, 0, 0.6, 0.03, 20).rotateX(Math.PI / 2).translate(-0.75, 1.55, s > 0 ? a + 0.13 : b - 0.13), '#b9c6e6', { flat: true });
        kit.add('metal', cyl(2.1, 0.3, (a + b) / 2, 0.8, 0.6, 16, 0.8, true), '#2e2d31', { flat: true, snow: 0.5 });
      } else {
        // A crated star-tracker instrument and gas bottles.
        crate(kit, -2.7, 0.3, a + 0.15, 0.5, 2.8, b - 0.15, '#a88c6c');
        for (let i = 0; i < 4; i++) kit.add('gloss', cyl(1.2 + i * 0.42, 0.3, (a + b) / 2, 0.18, 1.4, 10), i % 2 ? ENV.bone : ENV.terracottaFaded, { base: 0.3 });
      }
    }
    {
      const [a, b] = zr(13.5, 15.5);
      crate(kit, 12.5, 0, a, 16.5, 1.2, b, '#c1a585');
      crate(kit, 12.8, 1.2, a + 0.1, 15.2, 2.2, b - 0.1);
      kit.add('sign', quad(14, 1.7, s > 0 ? b + 0.02 : a - 0.02, 1.4, 0.8, 0, s, rect('dials', 2)), '#ffffff', { flat: true });
    }
    {
      const [a, b] = zr(17, 19.4);
      crate(kit, -8, 0, a, -5.4, 1.2, b, '#9b7d62');
    }
    {
      const [a, b] = zr(19, 21.5);
      // The spare mirror blank in its cradle, tarp half off: a glass disc glinting.
      crate(kit, 4, 0, a, 9, 0.6, b, '#a88c6c');
      const disc = new THREE.CylinderGeometry(1.0, 1.0, 0.35, kit.seg(28), 1);
      disc.rotateX(Math.PI / 2);
      disc.scale(2.4, 1, 1);
      disc.translate(6.5, 1.6, (a + b) / 2);
      kit.add('glass', disc, '#c9d4ee', { flat: true });
      kit.add('wood', box(4, 0.6, a, 4.4, 2.6, b), '#8a6a4c', { base: 0 });
      kit.add('wood', box(8.6, 0.6, a, 9, 2.6, b), '#8a6a4c', { base: 0 });
      kit.add('wood', box(4, 2.45, a, 9, 2.6, b), '#8a6a4c', { flat: true });
      kit.add('fabric', rbox(6.5, 0.6, a - 0.02, 9.02, 2.5, b + 0.02, 0.2, 2), ENV.pastelBlue, { base: 0.6 });
    }
    // Drifts; lichen in the shade of the dome base.
    drift(kit, -9, 0, Z(24), 2.5, 1.1, 0.3, 0.4);
    drift(kit, 9.5, 0, Z(33), 3, 1, 0.3, -0.2);
    drift(kit, -3, 0, Z(35.5), 2.6, 0.9, 0.25, 0.1);
    if (decor > 0.5) lichen(kit, -12.6, 0, Z(10.5), 1.2, ENV.glowChartreuse, rnd);
  }
  void beam;
  void cyl;
}
