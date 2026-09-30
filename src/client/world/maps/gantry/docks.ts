// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry east lane: the docks and the seawall.
//  • The rail-mounted harbor crane over Zone A (a landmark: pale-yellow portal,
//    A-frame and a long boom reaching out over the sea).
//  • Container door ends, the zone's spreader frame, the transit shed dressing
//    with a windsock on its roof.
//  • The lower timber pier, bollards, tyre fenders and the seawall face, with
//    animated waves: foam bands rolling in + periodic splashes (all in shaders,
//    zero CPU per frame), a moored boat bobbing and the beached rowboat.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { Solid } from '../../../../shared/maps/types';
import { GANTRY_PIER_Y as PY } from '../../../../shared/maps/gantry';
import { ENV } from '../../../engine/palette';
import { lamp, moss } from './pad';
import { beam, box, boxC, cyl, cylAB, DecorKit, floorQuad, lathe, quad, railing, rbox, sphere } from './kit';
import { uvOf } from './signage';

const CRANE = '#e9e1d0'; // bone-white portal (a pale yellow read as orange at sunset)
const CRANE_SHADE = '#c9c3b6';
const STEEL_DARK = ENV.metalDark;

export interface DocksAnim {
  waves: THREE.Mesh;
  splash: THREE.Mesh;
  boat: THREE.Group;
  sock: THREE.Group;
  materials: THREE.ShaderMaterial[];
}

const FOAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
varying float vFogD;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFogD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FOAM_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 fogColor;
uniform float fogDensity;
varying vec2 vUv;
varying vec3 vW;
varying float vFogD;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  // vUv.x: 0 at the wall → 1 out at sea. Bands roll toward the wall.
  float d = vUv.x;
  float z = vW.z;
  float wave = fract(d * 1.6 + uTime * 0.21 + n(vec2(z * 0.06, uTime * 0.05)) * 0.8);
  float band = smoothstep(0.0, 0.05, wave) * (1.0 - smoothstep(0.05, 0.16, wave));
  float lace = step(0.58, n(vec2(z * 1.3, d * 14.0 - uTime * 0.8)));
  float wall = (1.0 - smoothstep(0.0, 0.12, d)) * (0.5 + 0.5 * sin(uTime * 1.3 + z * 0.21));
  float a = (band * lace * 0.55 * (1.0 - d) + wall * (0.35 + 0.5 * lace)) * smoothstep(1.0, 0.6, d);
  if (a < 0.01) discard;
  vec3 col = mix(uColor, fogColor, 1.0 - exp(-fogDensity * fogDensity * vFogD * vFogD));
  gl_FragColor = vec4(col, a * 0.85);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SPLASH_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 fogColor;
uniform float fogDensity;
varying vec2 vUv;
varying vec3 vW;
varying float vFogD;
float h(float p) { return fract(sin(p * 91.7) * 43758.5453); }
void main() {
  // Vertical sheet against the wall; bursts travel along z with random phases.
  float cell = floor(vW.z / 4.0);
  float ph = h(cell) * 6.2831;
  float period = 3.5 + h(cell + 7.0) * 2.5;
  float t = fract((uTime + ph) / period);
  float life = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.35, 0.7, t));
  float cx = fract(vW.z / 4.0) - 0.5;
  float height = (0.3 + 0.7 * smoothstep(0.0, 0.3, t)) * (0.6 + 0.4 * h(cell + 3.0));
  float shape = (1.0 - smoothstep(0.15, 0.45, abs(cx) + vUv.y * 0.25)) * (1.0 - smoothstep(height * 0.6, height, vUv.y));
  float grain = step(0.45, fract(sin(dot(floor(vW.zy * 7.0 + t * 30.0), vec2(12.9898, 78.233))) * 43758.5453));
  float a = shape * life * (0.55 + 0.45 * grain);
  if (a < 0.02) discard;
  vec3 col = mix(uColor, fogColor, 1.0 - exp(-fogDensity * fogDensity * vFogD * vFogD));
  gl_FragColor = vec4(col, a * 0.9);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function foamMaterial(frag: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uColor: { value: new THREE.Color('#fbf3e6') } }]),
    vertexShader: FOAM_VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
  });
}

function rowboat(kit: DecorKit, x: number, y: number, z: number, rot: number, col: string, upside = false): void {
  const hull = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  hull.scale(0.85, 0.55, 2.2);
  if (upside) hull.rotateZ(Math.PI);
  const m = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y + (upside ? 0.55 : 0.55), z);
  kit.add('wood', hull, col, { flat: true }, m);
  kit.add('wood', boxC(0, 0.5, 0, 1.55, 0.06, 0.3, 0), '#8c7660', { flat: true }, m);
  kit.add('wood', boxC(0, 0.5, 0.9, 1.4, 0.06, 0.3, 0), '#8c7660', { flat: true }, m);
  kit.add('wood', beam(0.5, 0.45, -1, -0.3, 0.1, 1.9, 0.07), '#b39a7f', { flat: true }, m);
}

export function buildDocks(kit: DecorKit, rnd: () => number, root: THREE.Group, decor: number, solids: readonly Solid[]): DocksAnim {
  // ── Harbor crane (legs at x 45 / 60.5, z ±5) ──────────────────────────────
  for (const lz of [-5, 5]) {
    kit.add('paint', box(44.55, 0, lz - 0.45, 45.45, 16, lz + 0.45), CRANE, { base: 0 });
    kit.add('paint', box(60.05, PY, lz - 0.45, 60.95, 16, lz + 0.45), CRANE, { base: PY });
    // Bogies on the rails (kept tight around the legs).
    kit.add('metal', rbox(44.3, 0, lz - 0.75, 45.7, 0.8, lz + 0.75, 0.1), '#5c534b');
    kit.add('metal', rbox(59.8, PY, lz - 0.75, 61.2, PY + 0.8, lz + 0.75, 0.1), '#5c534b');
  }
  for (const lx of [45, 60.5]) {
    kit.add('paint', box(lx - 0.5, 14.2, -5.5, lx + 0.5, 16, 5.5), CRANE_SHADE);
    kit.add('paint', beam(lx, 4, -4.6, lx, 14.2, 4.6, 0.3), CRANE_SHADE);
    kit.add('paint', beam(lx, 4, 4.6, lx, 14.2, -4.6, 0.3), CRANE_SHADE);
  }
  for (const lz of [-5, 5]) kit.add('paint', box(44.5, 15, lz - 0.55, 61, 16.4, lz + 0.55), CRANE);
  // Machinery house, A-frame, boom to seaward, counter-jib, operator cab.
  kit.add('paint', rbox(47, 16.4, -3.2, 58, 20.6, 3.2, 0.2), '#9fb4be');
  kit.add('sign', quad(52.5, 19.4, -3.22, 5.2, 0.9, 0, -1, uvOf('stencilCrane')), '#ffffff', { flat: true });
  kit.add('sign', quad(52.5, 19.4, 3.22, 5.2, 0.9, 0, 1, uvOf('stencilDock')), '#ffffff', { flat: true });
  for (const lz of [-2.4, 2.4]) {
    kit.add('paint', beam(49, 20.6, lz, 54, 33, lz * 0.3, 0.45), CRANE);
    kit.add('paint', beam(58, 20.6, lz, 54, 33, lz * 0.3, 0.45), CRANE);
  }
  kit.add('paint', box(53.4, 32.6, -1, 54.6, 34, 1), CRANE_SHADE);
  // Boom: a tapering box truss out over the sea.
  const bx0 = 58;
  const bx1 = 98;
  for (const dz of [-1.1, 1.1]) {
    kit.add('paint', beam(bx0, 21.5, dz, bx1, 25.5, dz * 0.4, 0.28), CRANE);
    kit.add('paint', beam(bx0, 23.3, dz, bx1, 26.3, dz * 0.4, 0.22), CRANE);
  }
  for (let x = bx0; x < bx1 - 1; x += 3.3) {
    const f = (x - bx0) / (bx1 - bx0);
    const y0 = 21.5 + f * 4;
    const y1 = 23.3 + f * 3;
    const w = 1.1 * (1 - f * 0.6);
    kit.add('paint', beam(x, y0, -w, x + 1.65, y1, -w, 0.12), CRANE_SHADE, { flat: true });
    kit.add('paint', beam(x, y0, w, x + 1.65, y1, w, 0.12), CRANE_SHADE, { flat: true });
    kit.add('paint', beam(x, y0, -w, x, y0, w, 0.12), CRANE_SHADE, { flat: true });
  }
  // Stays from the A-frame to the boom tip, and the hook hanging over the water.
  for (const dz of [-0.4, 0.4]) kit.add('metal', beam(54, 33.5, dz, bx1, 26.3, dz, 0.07), STEEL_DARK, { flat: true });
  kit.add('metal', cylAB(84, 24.4, 0, 84, 9, 0, 0.03, 0.03, 4), STEEL_DARK, { flat: true });
  kit.add('paint', rbox(83.4, 7.8, -0.5, 84.6, 9.2, 0.5, 0.2), '#8e9aa0');
  kit.add('metal', box(83.9, 6.9, -0.08, 84.1, 7.8, 0.08), STEEL_DARK, { flat: true });
  // Counter-jib and counterweight.
  kit.add('paint', beam(47, 21.5, 0, 36, 22.5, 0, 0.8), CRANE);
  kit.add('concrete', rbox(35, 19.5, -1.6, 38.6, 23.4, 1.6, 0.15), '#9f9788');
  for (const dz of [-0.3, 0.3]) kit.add('metal', beam(54, 33.5, dz, 36.8, 23.4, dz, 0.07), STEEL_DARK, { flat: true });
  // Operator cab with warm window glow.
  kit.add('paint', rbox(58.2, 17.4, -1.4, 61, 20, 1.4, 0.18), '#efe6d6');
  kit.add('glass', box(60.98, 18.3, -1.2, 61.05, 19.7, 1.2), '#9fb4be', { flat: true });
  kit.add('glow', box(60.2, 18.4, -1.1, 60.3, 19.4, 1.1), ENV.glowGold, { flat: true, k: 0.9 });
  // Crane rails along the quay and the pier.
  for (const [rx, ry] of [
    [45, 0],
    [60.5, PY],
  ] as [number, number][]) {
    for (const d of [-0.35, 0.35]) kit.add('metal', box(rx + d - 0.06, ry, -46, rx + d + 0.06, ry + 0.06, 46), '#7a6a5e', { flat: true });
  }
  // Spreader frame lying in Zone A (x 47..53, z ±1, h 1.1).
  kit.add('paint', box(47.05, 0.6, -0.95, 52.95, 1.1, -0.65), '#9fb4be');
  kit.add('paint', box(47.05, 0.6, 0.65, 52.95, 1.1, 0.95), '#9fb4be');
  for (const x of [47.05, 49.4, 51.5]) kit.add('paint', box(x, 0.6, -0.95, x + 1.4, 1.1, 0.95), '#8ea3ad');
  // Resting on timber dunnage the full length: reads as the solid 1.1 m cover it is.
  for (const z of [-0.95, 0.35]) kit.add('wood', box(47.0, 0, z, 53.0, 0.6, z + 0.6), '#8c7660');
  kit.add('wood', box(47.1, 0, -0.35, 52.9, 0.5, 0.35), '#6e5a4a');
  for (const x of [47.4, 52.6]) for (const z of [-0.8, 0.8]) kit.add('metal', boxC(x, 1.12, z, 0.3, 0.06, 0.3), STEEL_DARK, { flat: true });
  kit.add('metal', box(49.6, 1.1, -0.2, 50.4, 1.22, 0.2), STEEL_DARK);

  // ── Container door ends + corner castings ─────────────────────────────────
  for (const s of solids) {
    if (s.style !== 'container') continue;
    const sx = s.max.x - s.min.x;
    const sz = s.max.z - s.min.z;
    const alongX = sx > sz;
    const col = new THREE.Color(s.color ?? '#c99a82').multiplyScalar(0.82);
    const tiers = Math.round((s.max.y - s.min.y) / 2.6);
    for (let t = 0; t < tiers; t++) {
      const y0 = s.min.y + t * 2.6;
      // Doors at the +end (x or z), locking bars, castings at all corners.
      if (alongX) {
        const x = s.max.x + 0.015;
        kit.add('paint', box(x - 0.02, y0 + 0.1, s.min.z + 0.1, x + 0.02, y0 + 2.5, s.max.z - 0.1), col, { flat: true });
        for (const f of [0.18, 0.4, 0.6, 0.82]) kit.add('metal', box(x + 0.02, y0 + 0.2, s.min.z + sz * f - 0.03, x + 0.07, y0 + 2.4, s.min.z + sz * f + 0.03), '#6f665d', { flat: true });
      } else {
        const z = s.max.z + 0.015;
        kit.add('paint', box(s.min.x + 0.1, y0 + 0.1, z - 0.02, s.max.x - 0.1, y0 + 2.5, z + 0.02), col, { flat: true });
        for (const f of [0.18, 0.4, 0.6, 0.82]) kit.add('metal', box(s.min.x + sx * f - 0.03, y0 + 0.2, z + 0.02, s.min.x + sx * f + 0.03, y0 + 2.4, z + 0.07), '#6f665d', { flat: true });
      }
      for (const cx of [s.min.x, s.max.x]) for (const cz of [s.min.z, s.max.z]) for (const cy of [y0, y0 + 2.6 - 0.18]) kit.add('metal', boxC(cx, cy + 0.09, cz, 0.24, 0.18, 0.24), '#5c534b', { flat: true });
    }
    // Shade side (west faces) collects glowing lichen on the Bloom half.
    if (s.min.z > 10 && rnd() < 0.8 * decor) moss(kit, rnd, s.min.x - 0.05, 0, (s.min.z + s.max.z) / 2, 0.6, Math.round(5 * decor), -1, 0);
  }

  // ── Transit shed (x 22..32, z ±10, h 7): roof, doors, windsock ────────────
  kit.add('metal', box(21.8, 6.95, -10.2, 32.2, 7.25, 10.2), '#bdb5a6');
  for (let z = -9; z < 10; z += 4.5) {
    const g = new THREE.CylinderGeometry(1.6, 1.6, 10.3, 12, 1, false, 0, Math.PI);
    g.rotateZ(Math.PI / 2);
    g.translate(27, 7.2, z + 2.2);
    kit.add('corrugated', g, '#d9d1c2', { flat: true });
  }
  for (const z of [-5, 5]) {
    kit.add('metal', rbox(32.0, 0.02, z - 3.3, 32.3, 5.2, z + 3.3, 0.04), z < 0 ? '#b9cfda' : '#a3ad8f');
    for (let y = 0.5; y < 5; y += 0.6) kit.add('metal', box(32.28, y, z - 3.2, 32.34, y + 0.06, z + 3.2), '#8a8680', { flat: true });
    kit.add('paint', box(32.0, 0, z - 3.6, 32.45, 0.5, z - 3.3), '#34302c');
  }
  kit.add('sign', quad(32.36, 5.9, 0, 6.2, 0.78, 1, 0, uvOf('stencilDock')), '#ffffff', { flat: true });
  kit.add('sign', quad(21.97, 2.1, -6.5, 1.3, 1.95, -1, 0, uvOf('posterSafety')), '#ffffff', { flat: true });
  kit.add('sign', quad(21.97, 2.1, 6.8, 1.3, 1.95, -1, 0, uvOf('posterReach')), '#ffffff', { flat: true });
  lamp(kit, 32.4, 5.3, -9, 1, 0, ENV.glowGold, 3);
  lamp(kit, 32.4, 5.3, 9, 1, 0, ENV.glowGold, 3);
  kit.add('metal', cylAB(30.5, 7.2, 8.5, 30.5, 13, 8.5, 0.08, 0.06, 6), '#9a9b98');
  const sock = new THREE.Group();
  sock.position.set(30.5, 12.7, 8.5);
  {
    const sk = new DecorKit(kit.ctx);
    const cone = new THREE.CylinderGeometry(0.42, 0.18, 2.6, 12, 5, true);
    cone.rotateZ(-Math.PI / 2);
    cone.translate(1.4, 0, 0);
    sk.add('fabric', cone, '#efe6d6', { flat: true });
    // Faded terracotta bands.
    for (const x0 of [0.6, 1.6]) {
      const b = new THREE.CylinderGeometry(0.4 - x0 * 0.08, 0.36 - x0 * 0.08, 0.5, 12, 1, true);
      b.rotateZ(-Math.PI / 2);
      b.translate(x0 + 0.25, 0, 0);
      sk.add('fabric', b, ENV.terracottaFaded, { flat: true });
    }
    const ring = new THREE.TorusGeometry(0.42, 0.03, 4, 12);
    ring.rotateY(Math.PI / 2);
    ring.translate(0.1, 0, 0);
    sk.add('metal', ring, '#9a9b98', { flat: true });
    sk.build(sock);
    (sock.userData as { kit?: DecorKit }).kit = sk;
  }
  root.add(sock);

  // ── Quay edge, pier, seawall ──────────────────────────────────────────────
  kit.add('concrete', box(55.55, -0.02, -60, 56.05, 0.04, 60), '#e9dfc7', { flat: true });
  kit.add('concrete', box(55.98, PY, -60, 56.08, -0.02, 60), '#9d9587', { base: PY });
  for (let z = -50; z <= 50; z += 10) {
    for (let y = PY + 0.25; y < 0; y += 0.32) kit.add('metal', box(56.08, y, z - 0.25, 56.14, y + 0.04, z + 0.25), STEEL_DARK, { flat: true });
  }
  // Seawall face under the pier and quay ends (x ≥ 64), dark, wet at the foot.
  kit.add('concrete', box(64, -6, -60, 64.6, PY, 60), '#8e877b', { shade: (_x, y) => (y < -2.6 ? 0.55 : 0.8 + 0.2 * Math.min(1, (y + 2.6) / 1.5)) });
  // Piles along the pier's sea edge, bollards, tyre fenders.
  for (let z = -57; z <= 57; z += 3) {
    kit.add('wood', cyl(64.2, -5, z, 0.22, 3.7, 8), '#6e5a4a');
    if ((z + 57) % 9 === 0) {
      kit.add('metal', lathe([[0.02, 0], [0.3, 0], [0.26, 0.45], [0.36, 0.55], [0.36, 0.62], [0.02, 0.62]], 10, 63.85, PY, z), '#4a433d');
      const tyre = new THREE.TorusGeometry(0.42, 0.16, 6, 14);
      tyre.rotateY(Math.PI / 2);
      tyre.translate(64.78, -2.1, z + 1.5);
      kit.add('paint', tyre, '#2d2a28', { flat: true });
    }
  }
  kit.add('metal', box(63.7, PY, -60, 63.95, PY + 0.2, 60), '#6e5a4a', { flat: true });
  // Pier net crates (x 60..62, z ±[13, 15], h 1.2): nets heaped on crates, floats.
  for (const s of [-1, 1]) {
    kit.add('wood', rbox(60.02, PY, s * 13.02, 61.98, PY + 1.15, s * 14.98, 0.05), '#b39a7f');
    kit.add('fabric', sphere(61, PY + 1.15, s * 14, 1.0, 10, 6, 0.3), '#8e8474', { flat: true });
    for (let i = 0; i < 5; i++) kit.add('paint', sphere(60.3 + rnd() * 1.4, PY + 1.25, s * 14 + (rnd() - 0.5) * 1.6, 0.14, 8, 6), rnd() < 0.5 ? ENV.bone : ENV.terracottaFaded, { flat: true });
  }
  // Coiled ropes on the pier (flat, walk-over) and mooring lines to the boat.
  for (const z of [-30, 8, 26]) {
    const r = new THREE.TorusGeometry(0.35, 0.07, 5, 14);
    r.rotateX(Math.PI / 2);
    r.translate(62.8, PY + 0.07, z);
    kit.add('fabric', r, '#b8a98e', { flat: true });
  }
  kit.add('fabric', cylAB(63.85, PY + 0.55, 18, 67.6, -2.2, 16.5, 0.03, 0.03, 4), '#b8a98e', { flat: true });
  kit.add('fabric', cylAB(63.85, PY + 0.55, 27, 67.6, -2.2, 26, 0.03, 0.03, 4), '#b8a98e', { flat: true });
  // Pier lamps on the quay face.
  for (const z of [-32, 0.5, 32]) lamp(kit, 56.12, -0.3, z, 1, 0, ENV.glowGold, 2.2, PY);

  // Beached rowboat on a little shingle beach below the south-east seawall.
  kit.add('sand', rbox(64.6, -3.6, -64, 76, -2.4, -50, 1, 2), ENV.sand);
  kit.add('rock', sphere(74, -2.8, -60, 2.2, 8, 6, 0.6), ENV.rock);
  kit.add('rock', sphere(77, -3, -52, 1.6, 8, 6, 0.7), ENV.rock);
  rowboat(kit, 69, -2.55, -56, 0.5, '#b9cfda');
  rowboat(kit, 72.5, -2.6, -58.5, -0.3, '#c99a82', true);

  // Deep sea bed under the (transparent) water so the sea reads deep blue-grey
  // instead of showing the pale sky through it; the haze takes it at distance.
  const bed = new THREE.PlaneGeometry(900, 1400);
  bed.rotateX(-Math.PI / 2);
  bed.translate(64.6 + 450, -9, 0);
  kit.add('paint', bed, new THREE.Color(ENV.water).multiplyScalar(0.42), { flat: true });
  const shelf = new THREE.PlaneGeometry(14, 1400);
  shelf.rotateX(-Math.PI / 2);
  shelf.translate(64.6 + 7, -5.5, 0);
  kit.add('sand', shelf, '#7f7a6b', { flat: true });

  // ── Animated water dressing ───────────────────────────────────────────────
  const foamMat = foamMaterial(FOAM_FRAG);
  // Plane across the seawall's foot: u (0 → 1) runs from the wall out to sea.
  const foamGeo = new THREE.PlaneGeometry(6, 200, 1, 1);
  foamGeo.rotateX(-Math.PI / 2);
  const waves = new THREE.Mesh(foamGeo, foamMat);
  waves.position.set(64.6 + 3, -2.95, 0);
  waves.renderOrder = 5;
  waves.frustumCulled = false;
  root.add(waves);
  const splashMat = foamMaterial(SPLASH_FRAG);
  const splashGeo = new THREE.PlaneGeometry(200, 3.2, 1, 1);
  splashGeo.rotateY(-Math.PI / 2);
  const splash = new THREE.Mesh(splashGeo, splashMat);
  splash.position.set(64.75, -3 + 1.6, 0);
  splash.renderOrder = 6;
  splash.frustumCulled = false;
  root.add(splash);

  // A moored fishing boat, bobbing.
  const boat = new THREE.Group();
  boat.position.set(69, -3, 21);
  {
    const bk = new DecorKit(kit.ctx);
    const hull = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    hull.scale(1.9, 1.3, 5.2);
    hull.translate(0, 1.0, 0);
    bk.add('paint', hull, '#efe6d6', { shade: (_x, y) => (y < 0.35 ? 0.5 : 1) });
    bk.add('paint', box(-1.85, 0.9, -4.6, 1.85, 1.05, 4.6), '#c99a82', { flat: true });
    bk.add('wood', box(-1.6, 1.0, -3.8, 1.6, 1.08, 3.8), '#b39a7f', { flat: true });
    bk.add('paint', rbox(-1.1, 1.05, -0.6, 1.1, 3.0, 1.8, 0.15), '#e8dcc4');
    bk.add('glass', box(-1.0, 2.2, 1.79, 1.0, 2.8, 1.82), '#9fb4be', { flat: true });
    bk.add('metal', cylAB(0, 3.0, 0.4, 0, 7.5, 0.4, 0.07, 0.05, 6), '#9a9b98');
    bk.add('metal', beam(0, 6.5, 0.4, 0, 3.4, -3.8, 0.04), STEEL_DARK, { flat: true });
    bk.add('glow', sphere(0, 7.6, 0.4, 0.1, 6, 4), ENV.glowGold, { flat: true, k: 2.5 });
    bk.build(boat);
    (boat.userData as { kit?: DecorKit }).kit = bk;
  }
  root.add(boat);
  void railing;
  void floorQuad;
  return { waves, splash, boat, sock, materials: [foamMat, splashMat] };
}
