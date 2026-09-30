// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel backdrop: the rest of Halcyon Heights beyond the
// playable bounds (rows of pastel roofs, lollipop trees, power poles, a golf-
// ball water tower), soft hills on the horizon, the lattice radio mast with a
// warm beacon (landmark, NE), a lazy flock of birds, and the launch rocket far
// out on the north-west horizon (shared rocket module).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MapDef } from '../../../../shared/maps/types';
import type { MapRuntimeState } from '../../../contracts';
import { ENV } from '../../../engine/palette';
import { createLaunchRocket, type LaunchRocket } from '../../rocket';
import { type DecorKit, mix, rgb } from './kit';

const HOUSE_COLS = [ENV.pastelPink, ENV.pastelMint, ENV.pastelYellow, ENV.pastelBlue, ENV.bone, ENV.sandLight].map((h) => rgb(h));
const ROOF_COLS = [rgb(ENV.bone), rgb(ENV.terracottaFaded), rgb(ENV.boneShade), rgb('#a6705a')];

/** Keep-out rectangles (spawn set pieces live there). */
const KEEP_OUT: [number, number, number, number][] = [
  [-16, 55, 20, 76],
  [-24, -72, 32, -54],
];

function blocked(x: number, z: number, r: number): boolean {
  for (const [a, b, c, d] of KEEP_OUT) if (x + r > a && x - r < c && z + r > b && z - r < d) return true;
  return false;
}

function farHouse(kit: DecorKit, x: number, z: number, ry: number, rng: () => number): void {
  const w = 8 + rng() * 5;
  const d = 7 + rng() * 4;
  const h = rng() < 0.3 ? 5.6 : 3.2;
  const col = HOUSE_COLS[Math.floor(rng() * HOUSE_COLS.length)];
  kit.boxR('plaster', x, h / 2, z, w, h, d, ry, col, 0.06, { base: 0, ao: 0.3 });
  const roof = ROOF_COLS[Math.floor(rng() * ROOF_COLS.length)];
  if (rng() < 0.5) {
    // Flat roof with a deep fascia.
    kit.boxR('concrete', x, h + 0.15, z, w + 0.7, 0.3, d + 0.7, ry, roof, 0.04, { ao: 0 });
  } else {
    // Butterfly roof: two tilted slabs.
    for (const s of [-1, 1]) {
      const off = new THREE.Vector3(0, 0, s * d * 0.27).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      kit.boxE('concrete', new THREE.Vector3(x + off.x, h + 0.35, z + off.z), new THREE.Euler(s * 0.18, ry, 0, 'YXZ'), new THREE.Vector3(w + 0.8, 0.22, d * 0.58), roof, 0.03, { ao: 0 });
    }
  }
  // A couple of dark windows facing the map.
  const face = new THREE.Vector3(0, 0, d / 2 + 0.02).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
  kit.boxR('window', x + face.x, h * 0.45, z + face.z, w * 0.5, 1.0, 0.05, ry, rgb('#5d6670'), 0, { ao: 0 });
}

function lollipop(kit: DecorKit, x: number, z: number, s: number, rng: () => number): void {
  kit.cyl('wood', x, 0, z, 0.2 * s, 0.3 * s, 3 * s, rgb('#7a6a58'), 6);
  kit.ball('foliage', x, 4.2 * s, z, 2.4 * s, 2.0 * s, 2.4 * s, mix(mix(rgb(ENV.sage), rgb(ENV.sand), 0.2), rgb(ENV.olive), rng() * 0.5), 1, { drift: 0.2 });
}

export interface BackdropParts {
  rocket: LaunchRocket;
  beacon: THREE.MeshBasicMaterial;
  birds: THREE.InstancedMesh;
  update(dt: number, s: MapRuntimeState): void;
  dispose(): void;
}

export function buildBackdrop(kit: DecorKit, def: MapDef, rng: () => number): BackdropParts {
  const detail = kit.detail;
  // ── The rest of Halcyon Heights: house rows along a street grid ──
  // Blocks of 16 m lots facing streets every 36 m, beyond a 58 m margin.
  const lot = 16;
  const lim = kit.low ? 100 : 124;
  for (let gx = -lim; gx <= lim; gx += lot) {
    for (let gz = -lim; gz <= lim; gz += lot) {
      if (Math.abs(gx) < 64 && Math.abs(gz) < 64) continue;
      if (blocked(gx, gz, 9)) continue;
      // Streets: skip every third row/column (open corridors between blocks).
      const rowX = Math.round((gx + lim) / lot) % 3;
      const rowZ = Math.round((gz + lim) / lot) % 3;
      if (rowX === 2 || rowZ === 2) {
        if (rng() < 0.35 * detail) lollipop(kit, gx + (rng() - 0.5) * 6, gz + (rng() - 0.5) * 6, 0.8 + rng() * 0.5, rng);
        continue;
      }
      if (rng() < 0.12) continue;
      // Face the nearest cross street.
      const ry = (rowZ === 0 ? 0 : Math.PI) + (rowX === 0 ? 0 : 0) + (Math.abs(gx) > Math.abs(gz) ? Math.PI / 2 * Math.sign(gx) : 0);
      farHouse(kit, gx + (rng() - 0.5) * 2, gz + (rng() - 0.5) * 2, ry, rng);
      if (rng() < 0.55 * (0.5 + detail * 0.5)) lollipop(kit, gx + lot * 0.42, gz + (rng() - 0.5) * lot * 0.6, 0.8 + rng() * 0.6, rng);
    }
  }
  // Power poles along the outer road.
  for (let i = 0; i < 10; i++) {
    const x = -70 + i * 16;
    const z = 97;
    kit.cyl('wood', x, 0, z, 0.14, 0.2, 9, rgb('#6f5e4d'), 6);
    kit.box('wood', x - 1.2, 8.2, z - 0.08, x + 1.2, 8.35, z + 0.08, rgb('#6f5e4d'), 0);
    if (i > 0) for (const o of [-1, 1]) kit.tube('paint', new THREE.Vector3(x - 16 + o, 8.4, z), new THREE.Vector3(x + o, 8.4, z), 0.015, rgb('#3a3634'), 3);
  }
  // Golf-ball water tower (west-south-west, under the sun).
  kit.cyl('concrete', -92, 0, 58, 1.1, 1.6, 22, rgb(ENV.boneShade), 12);
  kit.ball('paint', -92, 27, 58, 6, 5.6, 6, rgb(ENV.bone), 2, { drift: 0.05 });
  kit.box('plaster', -98.2, 26.4, 57, -85.8, 27.6, 59, rgb(ENV.terracottaFaded), 0, { ao: 0, drift: 0 });

  // ── Hills on the horizon (inside the Low far plane) ──
  const hills: [number, number, number, number, number][] = [
    [-190, -120, 70, 18, 50],
    [-120, -200, 90, 22, 60],
    [40, -210, 110, 16, 60],
    [190, -90, 80, 20, 70],
    [200, 110, 90, 14, 70],
    [60, 200, 120, 18, 60],
    [-150, 170, 90, 16, 60],
    [-215, 40, 70, 12, 60],
  ];
  for (const [x, z, sx, sy, sz] of hills) kit.ball('grass', x, -2, z, sx, sy, sz, mix(rgb(ENV.sage), rgb(ENV.sand), 0.35 + rng() * 0.3), kit.low ? 1 : 2, { drift: 0.3 });

  // ── Radio mast (NE landmark): tapered lattice + guy wires + beacon ──
  const mx = 78;
  const mz = -70;
  const mh = 34;
  const legs: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    legs.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  const col = rgb(ENV.terracottaFaded);
  const lvls = 9;
  for (let l = 0; l < lvls; l++) {
    const y0 = (mh * l) / lvls;
    const y1 = (mh * (l + 1)) / lvls;
    const r0 = 1.6 * (1 - (l / lvls) * 0.7);
    const r1 = 1.6 * (1 - ((l + 1) / lvls) * 0.7);
    for (let i = 0; i < 3; i++) {
      const a = legs[i];
      const b = legs[(i + 1) % 3];
      const p0 = new THREE.Vector3(mx + a.x * r0, y0, mz + a.z * r0);
      const p1 = new THREE.Vector3(mx + a.x * r1, y1, mz + a.z * r1);
      const q1 = new THREE.Vector3(mx + b.x * r1, y1, mz + b.z * r1);
      kit.tube('paint', p0, p1, 0.09, l % 2 ? col : rgb(ENV.bone), 4, { drift: 0 });
      kit.tube('paint', p0, q1, 0.035, rgb(ENV.boneShade), 3, { drift: 0 });
      kit.tube('paint', p1, q1, 0.035, rgb(ENV.boneShade), 3, { drift: 0 });
    }
  }
  kit.tube('paint', new THREE.Vector3(mx, mh, mz), new THREE.Vector3(mx, mh + 6, mz), 0.08, rgb(ENV.bone), 4);
  for (let i = 0; i < 3; i++) {
    const a = legs[i];
    kit.tube('paint', new THREE.Vector3(mx + a.x * 0.8, mh * 0.8, mz + a.z * 0.8), new THREE.Vector3(mx + a.x * 22, 0, mz + a.z * 22), 0.02, rgb('#5a5450'), 3, { drift: 0 });
  }
  const beacon = kit.ownMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color(ENV.glowGold).multiplyScalar(2) }));
  const bGeo = kit.ownGeometry(new THREE.IcosahedronGeometry(0.55, 1));
  const beaconMesh = new THREE.Mesh(bGeo, beacon);
  beaconMesh.position.set(mx, mh + 6.3, mz);
  kit.add(beaconMesh);

  // ── Birds: one instanced draw, flapping by scaling. ──
  const bird = new THREE.BufferGeometry();
  bird.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, -0.9, 0.12, -0.1, 0, 0, -0.15, 0, 0, 0.25, 0, 0, -0.15, 0.9, 0.12, -0.1], 3));
  bird.computeVertexNormals();
  kit.ownGeometry(bird);
  const birdMat = kit.ownMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color('#5a4f4a'), side: THREE.DoubleSide }));
  const count = kit.low ? 7 : 14;
  const birds = new THREE.InstancedMesh(bird, birdMat, count);
  birds.frustumCulled = false;
  kit.add(birds);
  const phase = Array.from({ length: count }, () => rng() * Math.PI * 2);
  const radius = Array.from({ length: count }, () => 45 + rng() * 25);
  const height = Array.from({ length: count }, () => 30 + rng() * 14);
  const mtx = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const eul = new THREE.Euler();

  // ── Launch rocket on the NW horizon (pulled in on short draw distances) ──
  const rocket = createLaunchRocket(kit.lib, kit.q, { scale: def.rocket.scale, tower: true });
  const rp = new THREE.Vector3(def.rocket.pos.x, def.rocket.pos.y, def.rocket.pos.z);
  const dist = Math.hypot(rp.x, rp.z);
  const maxDist = kit.q.drawDistance - 75;
  if (dist > maxDist) {
    const k = maxDist / dist;
    rp.set(rp.x * k, rp.y * k, rp.z * k);
    rocket.root.scale.multiplyScalar(k);
  }
  rocket.root.position.copy(rp);
  // Seen from town, the lattice tower (local −Z) stands BEHIND the rocket so the
  // white body reads in silhouette against it, and the pitch-over (local +X)
  // arcs sideways to the north — across the view, away from the sun's glare.
  const away = Math.hypot(rp.x, rp.z);
  rocket.root.rotation.y = Math.atan2(-rp.x / away, -rp.z / away);
  kit.add(rocket.root);
  // Launch complex apron + a few service buildings around the pad.
  const pad = rp.clone();
  const ps = rocket.root.scale.x / def.rocket.scale;
  kit.box('concrete', pad.x - 26 * ps, pad.y - 3, pad.z - 26 * ps, pad.x + 26 * ps, pad.y, pad.z + 26 * ps, rgb(ENV.concrete), 0, { ao: 0 });
  kit.box('plaster', pad.x + 22 * ps, pad.y, pad.z - 10 * ps, pad.x + 34 * ps, pad.y + 7 * ps, pad.z + 6 * ps, rgb(ENV.bone), 0.2, { ao: 0.2, base: pad.y });

  let blinkT = 0;
  const beaconOn = new THREE.Color(ENV.glowGold).multiplyScalar(3.2);
  const beaconOff = new THREE.Color(ENV.glowGold).multiplyScalar(0.5);
  // DEV-only: ?launch=<seconds> previews the finale in the harness.
  const devLaunchAt = import.meta.env?.DEV ? Number(new URLSearchParams(globalThis.location?.search ?? '').get('launch') ?? NaN) : NaN;
  const devLaunch = { team: 0 as const, t: 0 };
  const update = (dt: number, s: MapRuntimeState): void => {
    if (Number.isFinite(devLaunchAt)) devLaunch.t = Math.min(devLaunchAt, Math.max(0, s.time - 1));
    rocket.update(dt, s.rocketLaunch ?? (Number.isFinite(devLaunchAt) && s.time > 1 ? devLaunch : null), s.time);
    blinkT += dt;
    const on = blinkT % 2.2 < 0.25;
    beacon.color.copy(on ? beaconOn : beaconOff);
    for (let i = 0; i < count; i++) {
      const a = s.time * (0.08 + (i % 3) * 0.01) + phase[i];
      pos.set(Math.cos(a) * radius[i] + 10, height[i] + Math.sin(a * 3 + i) * 1.5, Math.sin(a) * radius[i] - 10);
      eul.set(0, -a, Math.sin(s.time * 7 + phase[i]) * 0.1);
      quat.setFromEuler(eul);
      const flap = 0.35 + 0.65 * Math.abs(Math.sin(s.time * 6 + phase[i] * 3));
      scl.set(1.1, flap * 1.2, 1.1);
      mtx.compose(pos, quat, scl);
      birds.setMatrixAt(i, mtx);
    }
    birds.instanceMatrix.needsUpdate = true;
  };
  const dispose = (): void => {
    rocket.dispose();
    birds.dispose();
  };
  return { rocket, beacon, birds, update, dispose };
}
