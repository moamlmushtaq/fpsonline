// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry west lane: the fuel tank farm and mission control.
//  • Hortonsphere LOX tanks on concrete plinths (spiral stairs, stencils),
//    a horizontal RP-1 bullet tank on saddles, low pipe runs, pump skids and a
//    valve manifold at Zone C.
//  • The west catwalk (open inner edge, cantilevered from boundary posts) that
//    runs over the half-buried mission-control bunker.
//  • The bunker: slanted firing window, consoles with amber CRTs, abandoned
//    lunch boxes + thermos + clipboards, a radio still playing, the countdown
//    board frozen at T-00:04:12.
//  • Divider buildings (fuel transfer station, compressor houses) and the big
//    roadside countdown clock facing the pad.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { GANTRY_CATWALK as CW } from '../../../../shared/maps/gantry';
import { ENV } from '../../../engine/palette';
import { lamp, moss } from './pad';
import { ivy } from './compounds';
import { beam, box, boxC, cyl, cylAB, DecorKit, floorQuad, lathe, litFloor, litWall, pipe, quad, railing, rbox, sphere, stairs, type BakedLight } from './kit';
import { uvOf } from './signage';

const STEEL = ENV.metalLight;
const STEEL_DARK = ENV.metalDark;

export interface TankFarmAnim {
  /** Light-shaft anchors (bunker window). */
  shafts: { pos: THREE.Vector3; dir: THREE.Vector3; length: number; radius: number; color?: string; intensity?: number }[];
  /** Countdown digit glow meshes are part of the static signGlow batch; flicker is global. */
  radio: THREE.Vector3;
}

function sphereTank(kit: DecorKit, rnd: () => number, s: number, decor: number): void {
  // Collision: x −58.5..−47.5, z s*[28.5, 39.5], 0..15.5.
  const cx = -53;
  const cz = s * 34;
  const r = 6;
  const cy = 9.5;
  const bloomSide = s > 0;
  kit.add('concrete', rbox(-58.45, 0, cz - 5.45, -47.55, 3, cz + 5.45, 0.12), ENV.boneShade);
  kit.add('concrete', box(-58.5, 2.9, cz - 5.5, -47.5, 3.05, cz + 5.5), ENV.bone, { flat: true });
  const col = bloomSide ? '#dfe3d2' : ENV.bone;
  kit.add('paint', sphere(cx, cy, cz, r, kit.seg(32), kit.seg(20)), col, {
    shade: (_x, y, _z, _nx, ny) => 0.7 + 0.3 * Math.max(0, ny * 0.5 + 0.5) + (Math.abs(y - cy) < 0.3 ? -0.08 : 0),
  });
  // Equator girder + hoop band.
  const ring = new THREE.TorusGeometry(r + 0.05, 0.14, 6, kit.segRaw(40));
  ring.rotateX(Math.PI / 2);
  ring.translate(cx, cy, cz);
  kit.add('metal', ring, STEEL_DARK, { flat: true });
  const band = new THREE.CylinderGeometry(r * 0.94, r * 0.94, 0.9, kit.segRaw(32), 1, true);
  band.translate(cx, cy + 3.3, cz);
  kit.add('paint', band, bloomSide ? ENV.sage : ENV.terracottaFaded, { flat: true });
  // Legs from the plinth to the equator.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const lx = cx + Math.cos(a) * 5.0;
    const lz = cz + Math.sin(a) * 5.0;
    kit.add('metal', cylAB(lx, 3, lz, cx + Math.cos(a) * 5.95, cy, cz + Math.sin(a) * 5.95, 0.26, 0.22, 8), '#a79f90');
    if (k % 2 === 0) kit.add('metal', beam(lx, 3.3, lz, cx + Math.cos(a + Math.PI / 4) * 5.9, cy - 0.3, cz + Math.sin(a + Math.PI / 4) * 5.9, 0.08), STEEL_DARK, { flat: true });
  }
  // Spiral stair to the crown platform.
  const steps = Math.round(34 * Math.max(0.5, decor));
  for (let i = 0; i < steps; i++) {
    const f = i / steps;
    const a = -Math.PI * 0.35 + f * Math.PI * 1.25;
    const y = 3.3 + f * (r * 2 - 0.6);
    const lat = Math.asin(Math.min(1, Math.max(-1, (y - cy) / r)));
    const rr = Math.cos(lat) * r + 0.55;
    kit.add('metal', boxC(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr, 0.9, 0.06, 0.35, -a), '#8a8680', { flat: true });
  }
  kit.add('metal', cyl(cx, cy + r - 0.2, cz, 1.4, 0.35, 12), '#8a8680');
  kit.addAll('metal', railing(cx - 1.3, cy + r + 0.15, cz, cx + 1.3, cy + r + 0.15, cz, 0.9, 1.3), ENV.bone);
  kit.add('sign', quad(cx + 5.6, cy + 1.6, cz, 4.4, 0.55, 0.92, 0, uvOf('stencilLox2'), 0), '#ffffff', { flat: true });
  // Pipe from the tank bottom into a valve pit toward the lane.
  kit.add('metal', pipe([[cx + 2, 4.2, cz], [cx + 2, 3.3, cz], [-47.72, 3.3, cz + 0.6], [-47.72, 0.2, cz + 0.6]], 0.2, 8, 0.6), ENV.terracottaFaded);
  if (bloomSide) {
    ivy(kit, rnd, cx - 5, cx + 5, 3.0, cz - s * 5.45, s > 0 ? 'z-' : 'z+', decor, 2.4);
    moss(kit, rnd, -48, 0, cz - s * 6.2, 1.1, Math.round(10 * decor));
  } else moss(kit, rnd, -57, 0, cz - s * 6.1, 0.8, Math.round(6 * decor));
}

function bulletTank(kit: DecorKit, s: number): void {
  // Collision: x −50..−39, z s*[16.4, 20], 0..3.6.
  const cz = s * 18.2;
  const r = 1.78;
  const y = 1.8;
  kit.add('paint', cylAB(-48.9, y, cz, -40.1, y, cz, r, r, kit.seg(24)), '#ece2cf', { shade: (_x, yy) => 0.72 + 0.28 * Math.min(1, yy / 3.2) });
  for (const [x0, dir] of [
    [-48.9, -1],
    [-40.1, 1],
  ] as [number, number][]) {
    const cap = new THREE.SphereGeometry(r, kit.segRaw(24), 10, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.55, 1);
    cap.rotateZ((-dir * Math.PI) / 2);
    cap.translate(x0, y, cz);
    kit.add('paint', cap, '#ece2cf');
  }
  for (const x of [-47, -42]) kit.add('concrete', box(x - 0.6, 0, cz - 1.5, x + 0.6, 1.2, cz + 1.5), ENV.boneShade);
  for (const x of [-45.5, -43.5]) {
    const b = new THREE.TorusGeometry(r + 0.02, 0.06, 5, kit.segRaw(24));
    b.rotateY(Math.PI / 2);
    b.translate(x, y, cz);
    kit.add('metal', b, ENV.terracottaFaded, { flat: true });
  }
  kit.add('sign', quad(-44.5, 1.9, cz - s * 1.8, 3.4, 0.5, 0, -s, uvOf('stencilRp1')), '#ffffff', { flat: true });
  kit.add('metal', box(-49.2, 3.5, cz - 0.4, -39.8, 3.6, cz + 0.4), '#8a8680', { flat: true });
  kit.add('metal', cylAB(-44, 3.56, cz, -44, 3.9, cz, 0.35, 0.3, 10), '#8a8680');
}

function pipeRun(kit: DecorKit, s: number): void {
  // Collision: x −37.5..−36, z s*[12, 30], h 1.0.
  const zA = s * 12;
  const zB = s * 30;
  for (let z = 12.5; z < 30; z += 3) kit.add('concrete', box(-37.5, 0, s * z - 0.25, -36, 0.35, s * z + 0.25), ENV.concreteDark);
  const lines: [number, number, number, string][] = [
    [-37.1, 0.62, 0.28, ENV.bone],
    [-36.45, 0.55, 0.2, '#9fa98c'],
    [-36.8, 0.88, 0.12, ENV.terracottaFaded],
  ];
  for (const [x, y, r, col] of lines) kit.add('metal', pipe([[x, -0.3, zB + s * 0.6], [x, y, zB], [x, y, zA], [x, -0.3, zA - s * 0.6]], r, 10, 0.5), col);
  for (const z of [s * 20, s * 26]) {
    const w = new THREE.TorusGeometry(0.28, 0.04, 5, 12);
    w.translate(-37.1, 1.05, z);
    kit.add('metal', w, ENV.terracottaFaded, { flat: true });
    kit.add('metal', cylAB(-37.1, 0.62, z, -37.1, 1.05, z, 0.05, 0.05, 6), STEEL_DARK, { flat: true });
  }
  // Valve pits at both ends.
  kit.add('concrete', box(-37.9, 0, zB - 0.2, -35.6, 0.18, zB + s * 1.2), ENV.concreteDark, { flat: true });
  kit.add('concrete', box(-37.9, 0, zA + 0.2, -35.6, 0.18, zA - s * 1.2), ENV.concreteDark, { flat: true });
}

export function buildTankFarm(kit: DecorKit, rnd: () => number, root: THREE.Group, decor: number): TankFarmAnim {
  for (const s of [-1, 1]) {
    sphereTank(kit, rnd, s, decor);
    bulletTank(kit, s);
    pipeRun(kit, s);
    // Pump skid (x −45..−42, z s*[7.5, 9.5], h 1.2).
    const zc = s * 8.5;
    kit.add('metal', box(-45, 0, zc - 1, -42, 0.25, zc + 1), '#6d6a64');
    kit.add('paint', rbox(-44.8, 0.25, zc - 0.7, -43.2, 1.18, zc + 0.7, 0.12), s > 0 ? '#9fa98c' : '#b9cfda');
    kit.add('metal', cylAB(-43.2, 0.7, zc, -42.1, 0.7, zc, 0.22, 0.22, 10), '#8a8680');
    kit.add('metal', cylAB(-42.4, 0.25, zc, -42.4, 1.15, zc, 0.18, 0.18, 10), ENV.terracottaFaded);
    // Catwalk stair (ramp x −64..−61, z s*[26, 38] → 4.8) and walkway (z s*[6, 26]).
    const z0 = s * 38;
    const z1 = s * 26;
    kit.addAll('metal', stairs(-63.95, Math.min(z0, z1), -61.05, Math.max(z0, z1), 0, CW, 'z', s < 0 ? 1 : -1, 0.3), '#8a8680');
    kit.add('metal', beam(-61.05, 0.15, z0, -61.05, CW - 0.1, z1, 0.14, 0.3), STEEL_DARK);
    kit.add('metal', beam(-63.9, 0.15, z0, -63.9, CW - 0.1, z1, 0.14, 0.3), STEEL_DARK);
    kit.addAll('metal', railing(-63.85, 0.2, z0, -63.85, CW, z1, 1.0, 2), ENV.bone);
    const za = s * 6;
    const zb = s * 26;
    kit.add('metal', box(-64, CW - 0.4, Math.min(za, zb), -61, CW - 0.05, Math.max(za, zb)), '#77736c');
    kit.add('metal', box(-64, CW - 0.05, Math.min(za, zb), -61, CW, Math.max(za, zb)), '#8a8680', { flat: true });
    kit.add('sign', quad(-61.0, CW - 0.22, s * 16, 20, 0.34, 1, 0, uvOf('hazard')), '#ffffff', { flat: true });
    for (let z = 7; z <= 26; z += 4.75) {
      kit.add('metal', box(-63.95, 0, s * z - 0.14, -63.65, CW + 1.1, s * z + 0.14), '#8a8680');
      kit.add('metal', beam(-63.8, CW - 1.6, s * z, -61.2, CW - 0.42, s * z, 0.12), STEEL_DARK);
    }
    kit.addAll('metal', railing(-63.8, CW, za, -63.8, CW, zb, 1.05, 2.4), ENV.bone);
    // Sodium floodlights on the catwalk posts: the tank farm lies in the long
    // shadow of the tower at sunset, so its light comes in warm islands.
    for (const z of [s * 11.75, s * 21.25]) {
      kit.add('metal', box(-63.9, CW + 1.1, z - 0.5, -63.3, CW + 1.5, z + 0.5), STEEL_DARK, { flat: true });
      kit.add('metal', box(-63.35, CW + 1.0, z - 0.45, -63.1, CW + 1.55, z + 0.45), '#8a8680', { flat: true });
      kit.add('glow', box(-63.09, CW + 1.08, z - 0.38, -63.07, CW + 1.47, z + 0.38), '#ffd08a', { flat: true, k: 3 });
      kit.add('pool', floorQuad(-55.5, 0.03, z + s * 0.5, 12, 9), '#ffc98a', { flat: true, k: 0.32 });
      kit.add('pool', floorQuad(-60.5, 0.035, z, 5, 5), '#ffd08a', { flat: true, k: 0.3 });
    }
    // Boundary wall beyond the catwalk (x < −64) with a sand drift.
    kit.add('concrete', box(-64.6, 0, s * 6, -64.05, 3.2, s * 60), ENV.concreteDark);
    kit.add('sand', box(-66, -0.5, s * 6, -64.6, 1.4, s * 60), ENV.sand, { flat: true });
  }

  // ── Mission-control bunker ─────────────────────────────────────────────────
  {
    // Massive roof slab (= catwalk level) with a chamfered brow over the window.
    kit.add('concrete', rbox(-64.4, 3.2, -6.3, -53.95, CW, 6.3, 0.18, 2), '#cbc2b1');
    kit.add('concrete', box(-54.6, 2.2, -6.3, -53.95, 3.25, 6.3), '#bdb5a6');
    kit.add('concrete', box(-54.6, 0, -6.3, -53.95, 1.1, 6.3), '#bdb5a6');
    // Side walls (collision z ±[5.6, 6]) and door frames.
    for (const s of [-1, 1]) {
      kit.add('concrete', box(-64.4, 0, s * 5.55, -56.4, 3.2, s * 6.05), '#bdb5a6');
      // Door frames flush with the collision jambs (opening x −56.4..−54.6).
      kit.add('metal', box(-56.7, 0, s * 5.5, -56.4, 3.2, s * 6.4), STEEL_DARK);
      kit.add('metal', box(-54.6, 0, s * 5.5, -54.3, 3.2, s * 6.4), STEEL_DARK);
      kit.add('metal', box(-56.7, 2.9, s * 5.5, -54.3, 3.2, s * 6.4), STEEL_DARK);
      // Blast door swung open against the wall.
      kit.add('gloss', rbox(-58.8, 0.02, s * 6.05, -56.7, 2.9, s * 6.22, 0.04), '#a8a79f');
      kit.add('sign', quad(-61.2, 2.5, s * 6.07, 3.4, 0.5, 0, s, uvOf('stencilBunker')), '#ffffff', { flat: true });
      // Sand drifts at the foot of the walls.
      kit.add('sand', sphere(-61, 0, s * 6.3, 2.2, 10, 5, 0.08), ENV.sand, { flat: true });
    }
    // Slanted window: panes tilting outward, mullions, the brow shadow line.
    for (let z = -5.7; z < 5.7; z += 1.9) {
      const g = new THREE.PlaneGeometry(1.8, 1.25);
      g.rotateX(-0.32);
      g.rotateY(Math.PI / 2);
      g.translate(-54.25, 1.66, z + 0.95);
      kit.add('glass', g, '#9fb4be', { flat: true });
      kit.add('metal', beam(-54.45, 1.08, z, -54.05, 2.22, z, 0.08), STEEL_DARK, { flat: true });
    }
    // Interior: dark liner, consoles, CRTs, the lunch-break still life.
    // Liners with the room's light baked in: two caged ceiling lamps, the
    // sunset spilling through the slot window, the CRT bank, the countdown board.
    const room: BakedLight[] = [
      { x: -61, y: 3, z: -3, r: 5, k: 0.7 },
      { x: -61, y: 3, z: 3, r: 5, k: 0.7 },
      { x: -56.2, y: 0.6, z: 0, r: 5.5, k: 0.95 },
      { x: -59.2, y: 1.3, z: 0, r: 3.5, k: 0.5 },
      { x: -63.9, y: 2.45, z: 0, r: 3, k: 0.55 },
      { x: -63.6, y: 1.5, z: 3.4, r: 2, k: 0.5 },
    ];
    kit.add('concrete', box(-63.95, 3.12, -5.55, -54.6, 3.19, 5.55), '#3d3833', { flat: true });
    litWall(kit, 'x+', -63.97, -5.55, 5.55, 0, 3.12, '#6a6158', 0.6, room, 0.8);
    // (Side liners stop at the doorways, x −56.4..−54.6.)
    litWall(kit, 'z+', -5.57, -63.95, -56.4, 0, 3.12, '#6a6158', 0.6, room, 0.8);
    litWall(kit, 'z-', 5.57, -63.95, -56.4, 0, 3.12, '#6a6158', 0.6, room, 0.8);
    litWall(kit, 'z+', -5.57, -56.4, -54.6, 2.4, 3.12, '#6a6158', 0.6, room, 0.8);
    litWall(kit, 'z-', 5.57, -56.4, -54.6, 2.4, 3.12, '#6a6158', 0.6, room, 0.8);
    litFloor(kit, -63.95, -5.55, -54.6, 5.55, 0.008, '#5e564e', 0.6, room, 0.8, 'paint');
    // Console row (collision x −60.2..−59, z ±3.6, h 0.95) with a raked screen bank behind.
    kit.add('paint', rbox(-60.2, 0, -3.6, -59, 0.95, 3.6, 0.06), '#9d9486');
    kit.add('paint', box(-59.02, 0.2, -3.5, -58.98, 0.8, 3.5), '#8e877b', { flat: true });
    const deskTop = new THREE.BoxGeometry(1.25, 0.06, 7.3);
    deskTop.rotateZ(-0.18);
    deskTop.translate(-59.6, 0.98, 0);
    kit.add('paint', deskTop, '#a39a8a');
    for (let i = 0; i < 4; i++) {
      const z = -2.7 + i * 1.8;
      kit.add('paint', rbox(-60.35, 0.95, z - 0.75, -59.6, 1.75, z + 0.75, 0.05), '#8e877b');
      // Rear vents and a dim status lamp so the console reads from behind too.
      kit.add('metal', box(-60.37, 1.1, z - 0.6, -60.35, 1.6, z + 0.6), ENV.metalDark, { flat: true });
      kit.add('glow', box(-60.38, 1.65, z - 0.08, -60.37, 1.7, z + 0.08), i % 2 ? ENV.glowChartreuse : ENV.glowGold, { flat: true, k: 2 });
      const scr = quad(-59.58, 1.37, z, 1.2, 0.5, 1, 0, [
        uvOf('screens')[0] + ((uvOf('screens')[2] - uvOf('screens')[0]) / 4) * i,
        uvOf('screens')[1],
        uvOf('screens')[0] + ((uvOf('screens')[2] - uvOf('screens')[0]) / 4) * (i + 1),
        uvOf('screens')[3],
      ]);
      kit.add('signGlow', scr, '#ffffff', { flat: true, k: 1.6 });
      kit.add('pool', quad(-59.2, 1.2, z, 1.8, 1.4, 1, 0), ENV.glowGold, { flat: true, k: 0.16 });
      // Dials and toggle rows on the desk.
      for (let k = 0; k < 3; k++) {
        const d = new THREE.CircleGeometry(0.07, 10);
        d.rotateY(Math.PI / 2);
        d.rotateZ(-0.18 - Math.PI / 2 + Math.PI / 2);
        d.translate(-59.35, 1.02, z - 0.4 + k * 0.4);
        kit.add('glow', d, k === 1 ? ENV.glowChartreuse : ENV.glowGold, { flat: true, k: 1.4 });
      }
    }
    // Lunch boxes, a thermos, coffee mugs, clipboards (on the desk).
    kit.add('paint', rbox(-59.75, 1.0, -3.3, -59.45, 1.2, -2.85, 0.03), ENV.pastelBlue);
    kit.add('paint', box(-59.72, 1.2, -3.2, -59.48, 1.22, -2.95), '#8e877b', { flat: true });
    kit.add('paint', rbox(-59.8, 1.0, 1.1, -59.5, 1.2, 1.55, 0.03), ENV.terracottaFaded);
    kit.add('paint', cyl(-59.62, 1.0, -2.45, 0.07, 0.34, 10), '#c9785b');
    kit.add('metal', cyl(-59.62, 1.34, -2.45, 0.075, 0.06, 10), '#8a8680');
    kit.add('paint', cyl(-59.55, 1.0, 0.3, 0.05, 0.1, 10), ENV.bone);
    kit.add('paint', cyl(-59.5, 1.0, 2.6, 0.05, 0.1, 10), ENV.pastelYellow);
    for (const z of [-1.3, 2.1]) {
      const clip = new THREE.BoxGeometry(0.34, 0.02, 0.24);
      clip.rotateY(0.3);
      clip.translate(-59.62, 1.02, z);
      kit.add('paint', clip, '#b39a7f', { flat: true });
      const paper = new THREE.BoxGeometry(0.3, 0.01, 0.22);
      paper.rotateY(0.3);
      paper.translate(-59.62, 1.035, z);
      kit.add('paint', paper, '#f4efe6', { flat: true });
    }
    // Chairs tucked under the desk (inside the console collision).
    for (let i = 0; i < 3; i++) kit.add('paint', rbox(-60.15, 0.35, -2 + i * 2 - 0.3, -59.8, 0.45, -2 + i * 2 + 0.3, 0.03), '#9fa98c');
    // The radio on a shelf by the back wall, dial glowing.
    kit.add('paint', box(-63.95, 1.3, 2.2, -63.4, 1.35, 4.6), '#8c7660');
    kit.add('paint', rbox(-63.9, 1.35, 3.0, -63.5, 1.72, 3.9, 0.05), '#b39a7f');
    kit.add('glow', box(-63.49, 1.5, 3.2, -63.48, 1.62, 3.7), ENV.glowGold, { flat: true, k: 2.2 });
    kit.add('metal', cylAB(-63.7, 1.72, 3.8, -63.4, 2.4, 4.3, 0.01, 0.01, 3), STEEL, { flat: true });
    // Countdown board frozen at T-00:04:12 over the back wall, and posters.
    kit.add('paint', box(-63.95, 2.05, -1.6, -63.85, 2.85, 1.6), '#2a2724');
    kit.add('signGlow', quad(-63.84, 2.45, 0, 3.0, 0.72, 1, 0, uvOf('countdown')), '#ffffff', { flat: true, k: 1.3 });
    kit.add('pool', quad(-63.8, 2.3, 0, 4.2, 2.2, 1, 0), ENV.glowGold, { flat: true, k: 0.18 });
    kit.add('sign', quad(-63.93, 1.5, -3.6, 0.9, 1.35, 1, 0, uvOf('posterReach')), '#ffffff', { flat: true });
    kit.add('sign', quad(-63.93, 1.5, -1.9 - 0.1, 0.9, 1.35, 1, 0, uvOf('posterSafety')), '#ffffff', { flat: true });
    kit.add('sign', quad(-58, 2.4, -5.53, 3.8, 0.5, 0, 1, uvOf('plaque')), '#ffffff', { flat: true });
    // Ceiling lamps (caged fixtures) and the sunset spilling through the slot window.
    for (const z of [-3, 3]) {
      kit.add('metal', box(-61.4, 2.98, z - 0.7, -60.6, 3.12, z + 0.7), ENV.metalDark, { flat: true });
      kit.add('glow', box(-61.3, 2.96, z - 0.6, -60.7, 2.98, z + 0.6), ENV.glowGold, { flat: true, k: 1.9 });
      kit.add('pool', floorQuad(-61, 0.02, z, 5, 5), ENV.glowGold, { flat: true, k: 0.2 });
    }
    kit.add('pool', floorQuad(-56.8, 0.025, 0, 4.2, 11.5), '#ffc58f', { flat: true, k: 0.55 });
    kit.add('pool', floorQuad(-57.5, 3.1, 0, 5, 11), '#ffc58f', { flat: true, k: 0.3 });
    kit.add('pool', quad(-63.9, 1.7, 0, 9, 2.6, 1, 0), '#ffb98a', { flat: true, k: 0.32 });
    moss(kit, rnd, -63.7, 0, -5.2, 0.5, Math.round(8 * decor));
  }

  // Valve manifold at Zone C (x −44..−42.4, z ±1, h 1.3): a solid steel
  // manifold box (it is waist-high cover you can vault) with valve heads on top.
  kit.add('concrete', box(-44.05, 0, -1.05, -42.35, 0.25, 1.05), ENV.concreteDark);
  kit.add('metal', rbox(-43.98, 0.25, -0.98, -42.42, 1.18, 0.98, 0.1, 2), '#b9bfa6');
  for (let z = -0.7; z <= 0.71; z += 0.7) kit.add('metal', box(-44.02, 0.35, z - 0.05, -42.38, 1.1, z + 0.05), '#8e9474', { flat: true });
  kit.add('metal', box(-44.0, 1.18, -1.0, -42.4, 1.3, 1.0), '#6f7a80');
  for (const [x, z, r] of [
    [-43.55, -0.55, 0.2],
    [-42.85, 0.45, 0.16],
    [-43.5, 0.5, 0.14],
  ] as [number, number, number][]) {
    kit.add('metal', cyl(x, 1.3, z, r * 0.5, 0.12, 8), STEEL_DARK);
    const w = new THREE.TorusGeometry(r + 0.1, 0.035, 5, 12);
    w.rotateX(Math.PI / 2);
    w.translate(x, 1.44, z);
    kit.add('metal', w, ENV.terracottaFaded, { flat: true });
  }
  // Feed pipes dive into the ground on both ends.
  for (const x of [-44.3, -42.1]) kit.add('metal', pipe([[x < -43 ? -43.9 : -42.5, 0.75, -0.5], [x, 0.75, -0.5], [x, -0.3, -0.5]], 0.14, 8, 0.3), '#8a8680');
  kit.add('sign', floorQuad(-45, 0.012, 0, 4.4, 4.4, uvOf('deckSeven'), -Math.PI / 2), '#ffffff', { flat: true, k: 0.75 });

  // ── West divider buildings (builder-drawn masses) ─────────────────────────
  // Fuel transfer station (x −34..−24, z ±11, h 7): roof pump room, vents, doors,
  // and the big roadside countdown clock facing the pad.
  kit.add('concrete', box(-34.1, 6.7, -11.1, -23.9, 7.15, 11.1), ENV.bone);
  kit.add('metal', rbox(-32, 7, -6, -27, 9.2, 2, 0.1), '#c9c1b0');
  for (const z of [-9, 6, 9]) kit.add('metal', cyl(-28, 7, z, 0.7, 0.9, 12), '#9a9b98');
  kit.add('paint', box(-23.95, 3.55, -3.8, -23.8, 6.25, 3.8), '#2a2724');
  kit.add('signGlow', quad(-23.78, 4.9, 0, 7.2, 1.8, 1, 0, uvOf('countdown')), '#ffffff', { flat: true, k: 1.35 });
  kit.add('pool', quad(-23.7, 4.9, 0, 10, 4.5, 1, 0), ENV.glowGold, { flat: true, k: 0.12 });
  kit.add('sign', quad(-23.95, 2.2, -7.3, 4.8, 0.6, 1, 0, uvOf('stencilLox')), '#ffffff', { flat: true });
  kit.add('sign', quad(-23.95, 1.8, 7.2, 1.3, 1.95, 1, 0, uvOf('posterSky')), '#ffffff', { flat: true });
  kit.add('metal', box(-34.25, 0, -2, -34.02, 2.6, 2), '#9fa98c');
  kit.add('sign', quad(-34.26, 3.3, 0, 5.2, 0.62, -1, 0, uvOf('stencilLox')), '#ffffff', { flat: true });
  kit.add('sign', quad(-34.1, 1.7, 6.5, 1.3, 1.95, -1, 0, uvOf('posterReach')), '#ffffff', { flat: true });
  // Fuel lines descend the station's west wall into the ground.
  for (const [dz, r, col] of [
    [-0.5, 0.2, ENV.bone],
    [0.1, 0.16, '#9fa98c'],
    [0.6, 0.12, ENV.rust],
  ] as [number, number, string][]) {
    kit.add('metal', pipe([[-33.6, 7.2, dz + 3], [-34.02 - r, 7.2, dz + 3], [-34.02 - r, -0.4, dz + 3]], r, 8, 0.4), col);
  }
  lamp(kit, -24.02, 3.0, -9, 1, 0, ENV.glowGold, 3.4);
  lamp(kit, -24.02, 3.0, 9, 1, 0, ENV.glowGold, 3.4);
  // West faces of the divider buildings light the lane's inner edge.
  for (const z of [-26, -6, 6, 26]) {
    lamp(kit, -34.02 - 0.05, 3.6, z, -1, 0, '#ffd08a', 3.6, 0);
    kit.add('pool', floorQuad(-38.5, 0.03, z, 7, 7), '#ffc98a', { flat: true, k: 0.26 });
  }
  // Zone C: floodlight on the bunker brow washing the valve manifold.
  for (const z of [-3.2, 3.2]) {
    kit.add('metal', box(-54.2, CW - 0.35, z - 0.5, -53.7, CW + 0.05, z + 0.5), STEEL_DARK, { flat: true });
    kit.add('glow', box(-53.69, CW - 0.3, z - 0.4, -53.67, CW, z + 0.4), '#ffd08a', { flat: true, k: 3 });
  }
  kit.add('pool', floorQuad(-46.5, 0.03, 0, 13, 12), '#ffc98a', { flat: true, k: 0.3 });
  // Compressor houses (x −34..−24, z s*[19, 33], h 5.5).
  for (const s of [-1, 1]) {
    const zc = s * 26;
    kit.add('concrete', box(-34.1, 5.3, zc - 7.1, -23.9, 5.65, zc + 7.1), ENV.bone);
    for (const z of [zc - 4, zc, zc + 4]) {
      kit.add('metal', cyl(-29, 5.5, z, 1.2, 0.6, 16), '#9a9b98');
      kit.add('metal', cyl(-29, 6.1, z, 1.0, 0.08, 16), STEEL_DARK);
    }
    kit.add('metal', box(-24.05, 0, zc - 1.6, -23.85, 2.5, zc + 1.6), s > 0 ? '#9fa98c' : '#b9cfda');
    kit.add('metal', box(-34.15, 0, zc - 1.6, -33.95, 2.5, zc + 1.6), s > 0 ? '#9fa98c' : '#b9cfda');
    kit.add('sign', quad(-23.8, 3.3, zc, 4.4, 0.55, 1, 0, uvOf('stencilLox')), '#ffffff', { flat: true });
    for (const x of [-33, -25]) kit.add('glass', box(x, 3.3, s * 19 - s * 0.03, x + 1.6, 4.4, s * 19 + s * 0.0), '#8fa3ab', { flat: true });
    if (s > 0) ivy(kit, rnd, -34, -24, 5.5, s * 19, 'z-', decor, 4);
  }
  void lathe;
  void rnd;

  const shafts: TankFarmAnim['shafts'] = [{ pos: new THREE.Vector3(-51.5, 2.6, -1.8), dir: new THREE.Vector3(-0.96, -0.14, 0.24).normalize(), length: 9, radius: 1.8, color: '#ffd2a0', intensity: 0.8 }];
  void root;
  return { shafts, radio: new THREE.Vector3(-63.6, 1.6, 3.4) };
}
