// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range: the movement course (east side).
//
// Numbered station signs (1 SPRINT · 2 JUMP · 3 MANTLE · 4 SLIDE · 5 PERCH ·
// 6 PIT), a painted sprint strip with chevrons, hazard-striped jump edges,
// a ceramic coping on the mantle wall, a padded slide beam, railings up the
// ramp and around the perch, a pennant, the capture pad plinth and the
// sandbag grenade pit, plus lamp posts along the course. Terracotta / bone
// only — objectives keep the saturated colors.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV } from '../../../engine/palette';
import { RANGE_COURSE } from '../../../../shared/maps/range';
import { rgb, type RangeKit } from './kit';
import { sandbag } from './lanes';
import type { SignAtlas } from './signs';

const C = RANGE_COURSE;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface CourseAnim {
  update(t: number): void;
}

export function buildCourse(k: RangeKit, signs: SignAtlas, rng: () => number): CourseAnim {
  const bone = rgb(ENV.bone);
  const boneShade = rgb(ENV.boneShade);
  const terra = rgb(ENV.terracottaFaded);
  const metal = rgb(ENV.metalDark);
  const metalL = rgb(ENV.metalLight);

  // ── 1 SPRINT: painted strip + chevrons ──
  k.slab('paint', 10.3, -12.8, 13.7, 2.4, 0.012, rgb(ENV.boneShade, 0.95), { drift: 0.35 });
  for (const x of [10.3, 13.7]) k.slab('paint', x - 0.06, -12.8, x + 0.06, 2.4, 0.016, terra, { drift: 0.3 });
  for (let z = 0.2; z > -12; z -= 2.6) signs.ground('chevron', V(12, 0.02, z), 0, 1.9);
  signs.ground('stencil.0', V(12, 0.02, 1.6), 0, 2.6);
  // Station sign posts (west side of the strip).
  const post = (x: number, z: number, id: string, ry: number) => {
    k.cyl('trim', x - 0.5, 0, z, 0.035, 0.035, 2.3, metal, 8);
    k.cyl('trim', x + 0.5, 0, z, 0.035, 0.035, 2.3, metal, 8);
    signs.backed(k, id, V(x, 2.0, z + 0.04), ry, 0.46, boneShade);
  };
  post(9.3, 2.2, 'course.0', 0);

  // ── Station signs on the channel wall's east face (x = 7) ──
  const wallSign = (z: number, id: string) => signs.board(id, V(7.03, 1.9, z), Math.PI / 2, 0.52);
  wallSign(-15.5, 'course.1');
  wallSign(-27.8, 'course.2');
  wallSign(-33.4, 'course.3');
  wallSign(-40.2, 'course.4');
  // A faded band along the channel wall.
  k.box('paint', 7.0, 1.32, -41, 7.025, 1.44, -13, terra);

  // ── 2 JUMP: hazard stripes on both gap edges + stencil ──
  for (const [z, ry] of [
    [-20.25, 0],
    [-23.25, Math.PI],
  ] as const) {
    for (let i = 0; i < 3; i++) signs.ground('hazard', V(9.1 + i * 4.1, 1.012, z), ry, 4.05);
  }
  signs.ground('stencil.1', V(12, 1.012, -18.3), 0, 2.4);
  // Gap floor: darker dirt, a few stones.
  k.slab('sand', 7, -23, 19.4, -20.5, 0.01, rgb(ENV.sand, 0.72), { drift: 0.4 });

  // ── 3 MANTLE: ceramic coping, handholds, stencil ──
  k.box('ceramic', 6.98, 1.2, -30.86, 19.42, 1.28, -29.94, bone, 0.04);
  signs.board('stencil.2', V(13, 0.6, -29.985), 0, 0.46, true);
  for (let x = 8; x < 19; x += 2.2) k.tube('trim', V(x, 1.28, -29.9), V(x + 0.5, 1.28, -29.9), 0.02, metalL, 6);

  // ── 4 SLIDE: padded bumper on the beam + stencil above ──
  for (let i = 0; i < 3; i++) signs.board('hazard', V(9.07 + i * 4.1, 1.5, -35.985), 0, 0.5, true);
  signs.board('stencil.3', V(13.2, 2.1, -35.985), 0, 0.5, true);
  k.box('fabric', 7, 1.2, -36.12, 19.4, 1.3, -35.94, rgb(ENV.shadowWarm, 1.3), 0.04);

  // ── Ramp rails + perch railing + pennant ──
  for (const x of [9.05, 14.95]) {
    k.tube('trim', V(x, 0.95, -40), V(x, 3.95, -45.5), 0.03, metalL, 8);
    for (const [z, y] of [
      [-40, 0],
      [-42.75, 1.5],
      [-45.5, 3],
    ] as const) k.cyl('trim', x, y, z, 0.03, 0.03, 0.95, metalL, 6);
  }
  for (const x of [8.05, 15.95]) {
    k.tube('trim', V(x, 3.95, -45.5), V(x, 3.95, -50.45), 0.03, metalL, 8);
    for (const z of [-45.5, -48, -50.45]) k.cyl('trim', x, 3, z, 0.03, 0.03, 0.95, metalL, 6);
  }
  k.box('ceramic', 8, 3.0, -50.62, 16, 3.14, -50.45, bone, 0.03);
  // PERCH sign spans the top of the ramp overhead (walk under it).
  signs.backed(k, 'course.4', V(12, 5.45, -45.4), 0, 0.46, boneShade);
  k.cyl('trim', 9.05, 3, -45.4, 0.035, 0.035, 2.75, metal, 6);
  k.cyl('trim', 14.95, 3, -45.4, 0.035, 0.035, 2.75, metal, 6);
  k.tube('trim', V(9.05, 5.72, -45.4), V(14.95, 5.72, -45.4), 0.03, metal, 6);
  k.cyl('trim', 15.7, 3, -50.2, 0.035, 0.045, 3.2, metalL, 8);
  const penGeo = k.own(new THREE.PlaneGeometry(1.1, 0.42, 8, 1).translate(0.55, 0, 0));
  const penBase = (penGeo.attributes.position as THREE.BufferAttribute).array.slice() as Float32Array;
  const pennant = k.add(new THREE.Mesh(penGeo, k.own(new THREE.MeshLambertMaterial({ color: new THREE.Color(ENV.terracottaFaded), side: THREE.DoubleSide }))));
  pennant.position.set(15.7, 5.9, -50.2);
  pennant.castShadow = k.q.shadows !== 'off';

  // ── Capture pad plinth (the zone ring draws on top) ──
  k.cyl('concrete', C.pad.x, 0, C.pad.z, 2.75, 2.8, 0.03, rgb(ENV.concrete, 1.05), 40, { drift: 0.15 });
  k.cyl('ceramic', C.pad.x, 0, C.pad.z, 2.95, 2.98, 0.022, boneShade, 40);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.boxR('ceramic', C.pad.x + Math.cos(a) * 3.2, 0.2, C.pad.z + Math.sin(a) * 3.2, 0.3, 0.4, 0.3, -a, bone, 0.08);
  }

  // ── 6 PIT: sandbags over the berm solids, raked floor, sign ──
  k.slab('sand', 9.3, -62, 14.7, -58.4, 0.008, rgb(ENV.sand, 0.86), { drift: 0.4 });
  const bag = rgb('#cdb68e');
  for (let row = 0; row < 3; row++) for (let i = 0; i < 11; i++) sandbag(k, 8.9 + i * 0.63 + (row % 2) * 0.3, row * 0.25, -62.5 + (rng() - 0.5) * 0.06, (rng() - 0.5) * 0.1, row % 2 ? bag : rgb('#c7ae84'));
  for (const x of [8.9, 15.1]) for (let row = 0; row < 2; row++) for (let i = 0; i < 5; i++) sandbag(k, x, row * 0.25, -61.6 + i * 0.66, Math.PI / 2 + (rng() - 0.5) * 0.1, bag);
  signs.backed(k, 'course.5', V(8.2, 1.35, -58.2), 0.5, 0.46, boneShade);
  k.cyl('trim', 7.5, 0, -58.55, 0.03, 0.03, 1.2, metal, 6);
  k.cyl('trim', 8.9, 0, -57.85, 0.03, 0.03, 1.2, metal, 6);

  // ── Lamp posts along the east wall ──
  for (let z = 4; z > -100; z -= 16) {
    k.cyl('trim', 18.9, 0, z, 0.06, 0.08, 4.6, metal, 8);
    k.box('ceramic', 18.1, 4.5, z - 0.16, 19.0, 4.7, z + 0.16, bone, 0.06);
    k.box('glow', 18.2, 4.45, z - 0.1, 18.7, 4.5, z + 0.1, rgb(ENV.glowGold, 1.4));
  }

  const pos = penGeo.attributes.position as THREE.BufferAttribute;
  return {
    update(t) {
      // Pennant ripple (vertex wave, amplitude grows toward the free end).
      for (let i = 0; i < pos.count; i++) {
        const x = penBase[i * 3];
        pos.setZ(i, Math.sin(t * 5 - x * 5) * 0.09 * x + Math.sin(t * 2.3) * 0.04 * x);
        pos.setY(i, penBase[i * 3 + 1] - x * 0.05 + Math.sin(t * 4 - x * 3) * 0.02 * x);
      }
      pos.needsUpdate = true;
      pennant.rotation.y = -0.6 + Math.sin(t * 0.6) * 0.15;
    },
  };
}
