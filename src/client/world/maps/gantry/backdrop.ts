// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry backdrop: the world beyond the fences, layered in
// aerial perspective (the haze eats everything past ~250 m, so silhouettes sit
// at 80–220 m): tank-farm giants and dunes to the west, the rest of the space
// center north and south (a derelict sister tower, a water tower, a second
// assembly building), a rocky coastline with headlands and a lighthouse on the
// sea, and seagulls wheeling over the docks.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV } from '../../../engine/palette';
import { beam, box, cyl, cylAB, DecorKit, GREENS, lattice, rbox, sphere } from './kit';

const GULL_VERT = /* glsl */ `
attribute float aPhase;
uniform float uTime;
varying float vFogD;
void main() {
  vec3 p = position;
  float flap = sin(uTime * 7.0 + aPhase * 6.2831) * 0.55 + 0.15;
  p.y += abs(p.x) * flap;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  vFogD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const GULL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 fogColor;
uniform float fogDensity;
varying float vFogD;
void main() {
  float f = 1.0 - exp(-fogDensity * fogDensity * vFogD * vFogD * 0.5);
  gl_FragColor = vec4(mix(uColor, fogColor, f), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface Gulls {
  mesh: THREE.InstancedMesh;
  mat: THREE.ShaderMaterial;
  update(time: number): void;
  dispose(): void;
}

/** Lumpy rock/dune mound from a squashed, jittered sphere. */
function mound(kit: DecorKit, rnd: () => number, x: number, y: number, z: number, rx: number, ry: number, rz: number, kind: 'sand' | 'rock', color: string): void {
  const g = new THREE.SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (rnd() - 0.5) * 0.18;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * (0.9 + rnd() * 0.2), p.getZ(i) * k);
  }
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  g.computeVertexNormals();
  kit.add(kind, g, color, { shade: (_x, yy) => 0.78 + 0.22 * Math.min(1, (yy - y) / Math.max(1, ry)) });
}

export function buildBackdrop(kit: DecorKit, rnd: () => number, root: THREE.Group, quality: { decor: number; preset: string }): Gulls {
  const d = quality.decor;
  // ── West: giant storage tanks behind the boundary wall, then dunes & mesas ─
  for (const [x, z, r, h, col] of [
    [-82, -30, 9, 13, ENV.bone],
    [-84, 2, 8, 11, '#dfe3d2'],
    [-80, 34, 10, 14, ENV.boneShade],
    [-108, -8, 11, 16, ENV.bone],
    [-104, 52, 8, 10, '#dfe3d2'],
    [-100, -52, 9, 12, ENV.boneShade],
  ] as [number, number, number, number, string][]) {
    kit.add('paint', cyl(x, 0, z, r, h, kit.seg(28)), col, { shade: (_x, y) => 0.7 + 0.3 * Math.min(1, y / h) });
    kit.add('paint', cyl(x, h, z, r, 1.2, kit.seg(28), r * 0.86), col);
    const b = new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.8, kit.segRaw(28), 1, true);
    b.translate(x, h * 0.7, z);
    kit.add('paint', b, ENV.terracottaFaded, { flat: true });
    kit.add('metal', box(x + r - 0.1, 0, z - 0.4, x + r + 0.4, h + 1, z + 0.4), '#9a9b98');
  }
  kit.add('metal', cylAB(-120, 0, 24, -120, 36, 24, 0.9, 0.6, 10), '#a79f90');
  kit.add('glow', sphere(-120, 36.6, 24, 0.7, 8, 6, 1.4), '#ffe3a1', { flat: true, k: 2.5 });
  for (let i = 0; i < 16; i++) {
    const z = -220 + i * 30 + rnd() * 12;
    mound(kit, rnd, -150 - rnd() * 60, -1, z, 30 + rnd() * 30, 6 + rnd() * 10, 22 + rnd() * 18, 'sand', i % 3 === 0 ? ENV.sandLight : ENV.sand);
  }
  for (const [x, z, w, h] of [
    [-230, -80, 60, 34],
    [-215, 90, 70, 28],
    [-250, 10, 40, 42],
  ] as [number, number, number, number][]) {
    kit.add('rock', rbox(x - w / 2, -1, z - w * 0.4, x + w / 2, h, z + w * 0.4, 3, 2), ENV.terracottaFaded, { shade: (_x, y) => 0.75 + 0.25 * Math.min(1, y / h) });
    kit.add('rock', rbox(x - w * 0.6, -1, z - w * 0.5, x + w * 0.6, h * 0.35, z + w * 0.5, 2, 2), ENV.rust);
  }
  // Power pylons marching inland.
  for (let i = 0; i < 5; i++) {
    const x = -95 - i * 28;
    const z = -95 + i * 6;
    kit.addAll('metal', lattice(x, z, 1.2 - 0.3, 0, 26, 6.5, 0.18, 0.08, false), '#8e877b');
    kit.add('metal', box(x - 5, 24, z - 0.15, x + 5, 24.4, z + 0.15), '#8e877b');
  }

  // ── South: the space center beyond Halcyon's hangar ───────────────────────
  // A second assembly building: stepped mass, tall door slot, faded banding.
  kit.add('concrete', rbox(-70, 0, -165, -20, 38, -128, 0.6), '#e2d8c6', { shade: (_x, y) => 0.72 + 0.28 * Math.min(1, y / 38) });
  kit.add('concrete', rbox(-64, 38, -160, -34, 46, -134, 0.4), '#d8cdb9');
  kit.add('paint', box(-52, 0, -127.95, -40, 34, -127.85), '#b9b1a2', { flat: true });
  for (let y = 4; y < 34; y += 5) kit.add('paint', box(-52, y, -127.84, -40, y + 0.3, -127.8), '#a39b8c', { flat: true });
  kit.add('paint', box(-68, 30, -127.9, -56, 36, -127.8), '#9fb4be', { flat: true });
  for (let x = -68; x < -20; x += 6) kit.add('concrete', box(x, 0, -128.3, x + 0.6, 38, -127.9), '#d2c8b5');
  kit.add('concrete', rbox(40, 0, -130, 70, 12, -96, 0.4), ENV.boneShade);
  // Water tower (a sphere on legs) — the classic launch-site silhouette.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    kit.add('metal', cylAB(95 + Math.cos(a) * 5, 0, -120 + Math.sin(a) * 5, 95 + Math.cos(a) * 3.5, 30, -120 + Math.sin(a) * 3.5, 0.3, 0.25, 6), '#a79f90');
  }
  kit.add('paint', sphere(95, 36, -120, 7, 16, 10), ENV.bone);
  kit.add('paint', cylAB(95, 29, -120, 95, 30.5, -120, 4, 4, 16), ENV.terracottaFaded);
  // A rail spur and lamp masts in the middle distance.
  kit.add('metal', box(-64, 0.02, -78.2, 70, 0.1, -77.8), '#7a6a5e', { flat: true });
  kit.add('metal', box(-64, 0.02, -76.2, 70, 0.1, -75.8), '#7a6a5e', { flat: true });
  for (const x of [-50, -10, 30]) {
    kit.add('metal', cylAB(x, 0, -86, x, 22, -86, 0.3, 0.2, 8), '#9a9b98');
    kit.add('metal', box(x - 1.6, 22, -86.4, x + 1.6, 23.4, -85.6), '#8a8680');
    kit.add('glow', box(x - 1.4, 22.2, -85.62, x + 1.4, 23.2, -85.58), ENV.glowGold, { flat: true, k: 1.6 });
  }

  // ── North: Launch Complex 6 — a derelict sister tower, overgrown ──────────
  kit.addAll('metal', lattice(30, 170, 3, 0, 46, 5.75, 0.5, 0.22), ENV.rust);
  kit.add('metal', box(22, 46, 167, 40, 47.5, 173), ENV.rust);
  kit.add('concrete', rbox(10, 0, 150, 50, 5, 190, 0.4), ENV.boneShade);
  // A ruined blockhouse swallowed by the Bloom.
  kit.add('concrete', rbox(-70, 0, 120, -46, 16, 150, 0.4), '#c9cbb8');
  kit.add('concrete', rbox(-46, 0, 126, -30, 9, 146, 0.4), '#bfc2ae');
  for (let i = 0; i < Math.round(14 * d); i++) kit.add('foliage', sphere(-70 + rnd() * 40, 8 + rnd() * 9, 118 + rnd() * 4, 2 + rnd() * 3, 7, 4, 0.8), GREENS[Math.floor(rnd() * 3)], { flat: true });
  for (const x of [-40, 0, 40]) {
    kit.add('metal', cylAB(x, 0, 86, x, 22, 86, 0.3, 0.2, 8), '#9a9b98');
    kit.add('metal', box(x - 1.6, 22, 85.6, x + 1.6, 23.4, 86.4), '#8a8680');
    kit.add('glow', box(x - 1.4, 22.2, 85.58, x + 1.4, 23.2, 85.62), ENV.glowGold, { flat: true, k: 1.6 });
  }
  kit.add('metal', box(-64, 0.02, 77.8, 70, 0.1, 78.2), '#7a6a5e', { flat: true });
  kit.add('metal', box(-64, 0.02, 75.8, 70, 0.1, 76.2), '#7a6a5e', { flat: true });
  // Overgrowth creeping in from the north (Bloom country).
  for (let i = 0; i < Math.round(26 * d); i++) {
    const x = -60 + rnd() * 120;
    const z = 64 + rnd() * 30;
    kit.add('foliage', sphere(x, 0, z, 1.2 + rnd() * 2.6, 7, 4, 0.55), GREENS[Math.floor(rnd() * 3)], { flat: true });
    if (rnd() < 0.35) kit.add('glow', sphere(x + rnd(), 0.8, z + rnd(), 0.18, 6, 4), rnd() < 0.7 ? ENV.glowChartreuse : ENV.glowSoftPink, { flat: true, k: 2.2 });
  }

  // ── Coastline: rocky shore north and south, headlands, a lighthouse ───────
  for (let i = 0; i < 22; i++) {
    const z = (i < 11 ? -1 : 1) * (64 + (i % 11) * 16 + rnd() * 8);
    mound(kit, rnd, 66 + rnd() * 10, -3.5, z, 6 + rnd() * 8, 2.5 + rnd() * 3.5, 5 + rnd() * 6, 'rock', ENV.rock);
  }
  mound(kit, rnd, 190, -4, 150, 70, 26, 40, 'rock', '#9d8f86');
  mound(kit, rnd, 215, -4, 190, 50, 16, 36, 'sand', ENV.sand);
  mound(kit, rnd, 170, -4, -210, 60, 20, 34, 'rock', '#9d8f86');
  mound(kit, rnd, 120, -4, 70, 8, 9, 7, 'rock', ENV.rock);
  mound(kit, rnd, 132, -4, 64, 5, 14, 5, 'rock', '#9d8f86');
  // Lighthouse on the northern headland.
  kit.add('paint', cyl(176, 18, 150, 3.2, 20, 16, 2.4), ENV.bone);
  for (const y of [22, 30]) kit.add('paint', cyl(176, y, 150, 3.0 - (y - 18) * 0.04, 2.2, 16, 2.9 - (y - 18) * 0.04), ENV.terracottaFaded, { flat: true });
  kit.add('metal', cyl(176, 38, 150, 2.6, 0.5, 12), '#6d6a64');
  kit.add('glow', cyl(176, 38.5, 150, 1.6, 2, 10), '#fff1d0', { flat: true, k: 3.2 });
  kit.add('metal', cyl(176, 40.5, 150, 1.9, 1.2, 10, 0.3), '#6d6a64');
  // Distant cargo ship (hazy silhouette) and a buoy.
  kit.add('paint', rbox(150, -3.5, -40, 160, 4, 30, 1.2), '#8e8a87');
  kit.add('paint', box(151.5, 4, 14, 158.5, 12, 26), '#b8b3aa');
  kit.add('paint', box(152, 4, -34, 158, 9, 8), '#9a6a4f');
  kit.add('paint', cyl(99, -3.4, 36, 0.8, 3, 10, 0.3), ENV.terracottaFaded);
  kit.add('glow', sphere(99, 0, 36, 0.25, 6, 4), ENV.glowGold, { flat: true, k: 2.5 });

  // ── Seagulls wheeling over the docks and the pad ──────────────────────────
  const n = Math.max(6, Math.round(16 * d));
  const g = new THREE.BufferGeometry();
  // A simple gull: two swept wing triangles + a small body wedge (local +z forward).
  const v = new Float32Array([
    0, 0, 0.35, -1.0, 0.05, -0.15, 0, 0, -0.25,
    0, 0, 0.35, 0, 0, -0.25, 1.0, 0.05, -0.15,
    0, 0, 0.45, -0.12, -0.05, -0.45, 0.12, -0.05, -0.45,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) phase[i] = rnd();
  g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uColor: { value: new THREE.Color('#4a4452') } }]),
    vertexShader: GULL_VERT,
    fragmentShader: GULL_FRAG,
    side: THREE.DoubleSide,
    fog: true,
  });
  const mesh = new THREE.InstancedMesh(g, mat, n);
  mesh.frustumCulled = false;
  mesh.name = 'gantry.gulls';
  root.add(mesh);
  const birds = Array.from({ length: n }, (_, i) => ({
    cx: i < n / 2 ? 70 + rnd() * 30 : -5 + rnd() * 30,
    cz: (rnd() - 0.5) * 60,
    r: 14 + rnd() * 26,
    y: 26 + rnd() * 22,
    w: (0.18 + rnd() * 0.14) * (rnd() < 0.5 ? 1 : -1),
    a0: rnd() * Math.PI * 2,
    s: 0.7 + rnd() * 0.4,
  }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const update = (time: number): void => {
    mat.uniforms.uTime.value = time;
    for (let i = 0; i < n; i++) {
      const b = birds[i];
      const a = b.a0 + time * b.w;
      p.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(time * 0.3 + i) * 1.5, b.cz + Math.sin(a) * b.r);
      // Heading = tangent of the circle, banked into the turn.
      const sg = Math.sign(b.w);
      e.set(0, Math.atan2(-Math.sin(a) * sg, Math.cos(a) * sg), -0.35 * sg);
      q.setFromEuler(e);
      sc.setScalar(b.s);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  void beam;
  return {
    mesh,
    mat,
    update,
    dispose: () => {
      g.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
