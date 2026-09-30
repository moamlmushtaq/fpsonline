// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range: beyond the walls.
//
// The RANGE CONTROL tower (landmark, west): a brutalist shaft with a round
// glass cab, ceramic roof and a pale-gold mast light; two ceramic fuel
// spheres (east); lamp posts on the perimeter; scrub; a windsock; and far
// downrange a launch gantry with a waiting rocket in the haze — the
// optimistic space age that built this place.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV } from '../../../engine/palette';
import { rgb, type RangeKit } from './kit';
import type { SignAtlas } from './signs';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface BackdropAnim {
  update(t: number): void;
}

export function buildBackdrop(k: RangeKit, signs: SignAtlas, rng: () => number): BackdropAnim {
  const bone = rgb(ENV.bone);
  const boneShade = rgb(ENV.boneShade);
  const concrete = rgb(ENV.concrete);
  const concreteDark = rgb(ENV.concreteDark);
  const terra = rgb(ENV.terracottaFaded);
  const metal = rgb(ENV.metalDark);

  // ── RANGE CONTROL tower ──
  const tx = -34;
  const tz = -34;
  k.cyl('concrete', tx, 0, tz, 1.9, 2.4, 1.2, concreteDark, 20);
  k.cyl('concrete', tx, 1.2, tz, 1.25, 1.55, 11.6, concrete, 20);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    k.boxR('concrete', tx + Math.cos(a) * 1.5, 3.6, tz + Math.sin(a) * 1.5, 0.5, 7.2, 0.5, -a, concrete, 0.05);
  }
  k.cyl('ceramic', tx, 12.6, tz, 3.4, 1.6, 1.0, bone, 28);
  k.cyl('glass', tx, 13.6, tz, 3.15, 3.15, 2.3, rgb('#cfe0e6', 0.9), 28);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.box('trim', tx + Math.cos(a) * 3.14 - 0.05, 13.6, tz + Math.sin(a) * 3.14 - 0.05, tx + Math.cos(a) * 3.14 + 0.05, 15.9, tz + Math.sin(a) * 3.14 + 0.05, metal);
  }
  k.cyl('ceramic', tx, 15.9, tz, 3.7, 3.7, 0.35, bone, 28);
  k.place('ceramic', k.cached('dome', () => new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2)), V(tx, 16.25, tz), new THREE.Euler(), V(3.1, 0.9, 3.1), boneShade);
  k.cyl('paint', tx, 12.95, tz, 3.42, 3.42, 0.14, terra, 28);
  k.cyl('trim', tx, 17, tz, 0.07, 0.1, 4.2, metal, 8);
  k.tube('trim', V(tx, 19.5, tz), V(tx + 1.2, 19.5, tz), 0.03, metal, 6);
  const beaconMat = k.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(ENV.glowGold).multiplyScalar(3) }));
  const beacon = k.add(new THREE.Mesh(k.cached('beacon', () => new THREE.SphereGeometry(0.22, 10, 8)), beaconMat));
  beacon.position.set(tx, 21.3, tz);
  signs.board('tower', V(tx + 1.58, 9.2, tz), Math.PI / 2, 0.9);

  // ── Fuel spheres (east, beyond the wall) ──
  for (const [sx, sz, r] of [
    [34, -58, 4.2],
    [39, -71, 3.6],
  ] as const) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.cyl('trim', sx + Math.cos(a) * r * 0.8, 0, sz + Math.sin(a) * r * 0.8, 0.14, 0.18, r + 1.4, metal, 8);
    }
    k.place('ceramic', k.cached('sphere', () => new THREE.SphereGeometry(1, 22, 14)), V(sx, r + 2, sz), new THREE.Euler(), V(r, r, r), bone);
    k.place('paint', k.cached('band', () => new THREE.CylinderGeometry(1, 1, 1, 22, 1, true)), V(sx, r + 2, sz), new THREE.Euler(), V(r * 1.005, 0.5, r * 1.005), terra);
  }

  // ── Launch gantry + rocket far downrange (fogged silhouette) ──
  const gx = 46;
  const gz = -240;
  k.cyl('ceramic', gx, 0, gz, 2.2, 2.2, 30, bone, 16);
  k.place('ceramic', k.cached('nose', () => new THREE.ConeGeometry(1, 1, 16)), V(gx, 34, gz), new THREE.Euler(), V(2.2, 8, 2.2), bone);
  for (const y of [8, 22]) k.cyl('paint', gx, y, gz, 2.23, 2.23, 1.2, terra, 16);
  for (let y = 0; y < 34; y += 3.4) k.box('trim', gx - 7.2, y, gz - 1.2, gx - 4.6, y + 0.35, gz + 1.2, metal);
  k.box('trim', gx - 7.2, 0, gz - 1.2, gx - 6.8, 36, gz - 0.8, metal);
  k.box('trim', gx - 5, 0, gz - 1.2, gx - 4.6, 36, gz - 0.8, metal);
  k.box('trim', gx - 7.2, 0, gz + 0.8, gx - 6.8, 36, gz + 1.2, metal);
  k.box('trim', gx - 5, 0, gz + 0.8, gx - 4.6, 36, gz + 1.2, metal);
  k.box('concrete', gx - 12, 0, gz - 9, gx + 8, 1.5, gz + 9, concreteDark);

  // ── Perimeter walls: pilasters, a faded band and a ceramic coping ──
  for (const side of [-1, 1] as const) {
    const face = side * 19.4;
    const inX = face - side * 0.12;
    for (let z = 10; z > -104; z -= 6) k.box('concrete', Math.min(face, inX), 0, z - 0.2, Math.max(face, inX), 3.0, z + 0.2, concreteDark, 0.03);
    k.box('ceramic', side < 0 ? -20.05 : 19.35, 3.0, -104, side < 0 ? -19.35 : 20.05, 3.12, 12.6, boneShade, 0.03);
    k.box('paint', side < 0 ? -19.4 : 19.37, 2.25, -104, side < 0 ? -19.37 : 19.4, 2.4, 12, terra);
  }
  k.box('ceramic', -20.05, 1.5, 11.95, 20.05, 1.62, 12.65, boneShade, 0.03);

  // ── Perimeter lamp posts (west wall) + scrub outside the walls ──
  for (let z = 4; z > -100; z -= 16) {
    k.cyl('trim', -20.3, 0, z, 0.06, 0.08, 4.6, metal, 8);
    k.box('ceramic', -20.4, 4.5, z - 0.16, -19.5, 4.7, z + 0.16, bone, 0.06);
    k.box('glow', -20.1, 4.45, z - 0.1, -19.6, 4.5, z + 0.1, rgb(ENV.glowGold, 1.4));
  }
  const scrubN = Math.round(60 * k.detail);
  for (let i = 0; i < scrubN; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (21.5 + rng() * 26);
    const z = 16 - rng() * 130;
    if (Math.hypot(x - tx, z - tz) < 5) continue;
    const s = 0.5 + rng() * 1.1;
    k.place('grass', k.cached('scrub', () => new THREE.IcosahedronGeometry(1, 0)), V(x, s * 0.25, z), new THREE.Euler(rng(), rng() * 6, 0), V(s * 1.4, s * 0.6, s * 1.1), rgb(i % 3 ? ENV.olive : ENV.sage, 0.95), { drift: 0.25 });
  }

  // ── Windsock (animated) on a pole behind the pavilion ──
  k.cyl('trim', 5.4, 0, 11.2, 0.05, 0.07, 6.2, rgb(ENV.metalLight), 8);
  const sock = new THREE.Group();
  sock.position.set(5.4, 6.1, 11.2);
  const sockGeo = k.own(new THREE.CylinderGeometry(0.28, 0.12, 1.5, 12, 4, true).rotateZ(Math.PI / 2).translate(0.78, 0, 0));
  const colors: number[] = [];
  const p = sockGeo.attributes.position as THREE.BufferAttribute;
  const cT = new THREE.Color(ENV.terracotta);
  const cB = new THREE.Color(ENV.bone);
  for (let i = 0; i < p.count; i++) {
    const band = Math.floor(p.getX(i) / 0.3) % 2;
    const c = band ? cB : cT;
    colors.push(c.r, c.g, c.b);
  }
  sockGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sockMesh = new THREE.Mesh(sockGeo, k.own(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  sockMesh.castShadow = k.q.shadows !== 'off';
  sock.add(sockMesh);
  k.add(sock);

  return {
    update(t) {
      beaconMat.color.setScalar(1).set(ENV.glowGold).multiplyScalar(Math.sin(t * 2.4) > 0.6 ? 3.2 : 0.8);
      sock.rotation.y = Math.PI * 0.85 + Math.sin(t * 0.4) * 0.25 + Math.sin(t * 1.7) * 0.06;
      sock.rotation.z = -0.18 + Math.sin(t * 1.1) * 0.06;
    },
  };
}
