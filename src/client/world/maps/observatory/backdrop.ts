// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Observatory backdrop: the world beyond the summit.
//
//  • Summit cliffs: a faceted rock skirt from the rim down into the clouds.
//  • The cloud sea: a luminous animated layer far below, warm where it faces
//    the last light, lavender elsewhere, fading into the horizon haze.
//  • Cloud billows and a ring of snowy peaks poking through (lit by the scene's
//    low sun; fog thinned so they read as painted silhouettes).
//  • The launch mesa rising from the clouds with the shared finale rocket.
//  • Night sky extras that fade in with the match: the Milky Way band, and a
//    big pale moon opposite the sunset (the cold light in the dome slit).
// Pulled in (and scaled) on short draw distances so Low keeps the same frame.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MaterialLibrary, QualitySettings } from '../../../contracts';
import type { MapDef } from '../../../../shared/maps/types';
import { ENV } from '../../../engine/palette';
import { createLaunchRocket, type LaunchRocket } from '../../rocket';
import { rect } from './atlas';
import { ObsKit, rockGeo } from './kit';
import { noise3 } from './rocks';

export const RIM_X = 58.5;
export const RIM_Z = 61.5;
const CLOUD_Y = -42;

export interface BackdropParts {
  rocket: LaunchRocket;
  cloudMat: THREE.ShaderMaterial;
  milkyMat: THREE.ShaderMaterial;
  milky: THREE.Mesh;
  moon: THREE.Mesh;
  moonDir: THREE.Vector3;
  moonDist: number;
  farMats: THREE.Material[];
  owned: { dispose(): void }[];
  rocketTarget: THREE.Vector3;
}

// ── Fog-thinned lit material for far scenery ────────────────────────────────

const FOG_SCALED = /* glsl */ `
#ifdef USE_FOG
  float fdS = vFogDepth * uFogScale;
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fdS * fdS );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, fdS );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;

function farMaterial(scale: number, low: boolean): THREE.Material {
  const m = low ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const u = { value: scale };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFogScale = u;
    sh.fragmentShader = 'uniform float uFogScale;\n' + sh.fragmentShader.replace('#include <fog_fragment>', FOG_SCALED);
  };
  m.customProgramCacheKey = () => `obs.far.${scale}`;
  return m;
}

// ── Summit cliffs ───────────────────────────────────────────────────────────

function topY(x: number, z: number): number {
  if (x > -RIM_X + 0.5) return 0;
  const az = Math.abs(z);
  if (az < 30) return 3;
  if (az < 38) return 3 * (1 - (az - 30) / 8);
  return 0;
}

function buildCliffs(kit: ObsKit): void {
  kit.section = 'backdrop.cliffs';
  // Perimeter samples on the rim rectangle (normals fan around the corners).
  const samples: { p: THREE.Vector2; n: THREE.Vector2 }[] = [];
  const corners = [
    new THREE.Vector2(RIM_X, RIM_Z),
    new THREE.Vector2(-RIM_X, RIM_Z),
    new THREE.Vector2(-RIM_X, -RIM_Z),
    new THREE.Vector2(RIM_X, -RIM_Z),
  ];
  const step = kit.low ? 5 : 3.2;
  for (let c = 0; c < 4; c++) {
    const a = corners[c];
    const b = corners[(c + 1) % 4];
    const d = b.clone().sub(a);
    const len = d.length();
    d.normalize();
    const n = new THREE.Vector2(d.y, -d.x); // outward (counter-clockwise walk seen from +Y)
    const n0 = Math.max(2, Math.round(len / step));
    for (let i = 0; i < n0; i++) samples.push({ p: a.clone().addScaledVector(d, (len * i) / n0), n: n.clone() });
    // Corner fan at b.
    const nb = new THREE.Vector2(-d.x, -d.y).rotateAround(new THREE.Vector2(), 0);
    void nb;
    const next = corners[(c + 2) % 4].clone().sub(b).normalize();
    const n2 = new THREE.Vector2(next.y, -next.x);
    for (let k = 1; k <= 3; k++) {
      const t = k / 4;
      samples.push({ p: b.clone(), n: n.clone().lerp(n2, t).normalize() });
    }
  }
  // Fix orientation: make sure normals point away from the center.
  for (const s of samples) if (s.n.dot(s.p) < 0) s.n.negate();
  const levels = [
    { off: 0, y: -0.04, amp: 0 },
    { off: 1.6, y: -5, amp: 1.6 },
    { off: 4.5, y: -13, amp: 3 },
    { off: 9, y: -24, amp: 5 },
    { off: 17, y: -36, amp: 8 },
    { off: 30, y: -54, amp: 12 },
  ];
  const N = samples.length;
  const pts: THREE.Vector3[][] = levels.map((L, li) =>
    samples.map((s) => {
      const nz = noise3(s.p.x * 0.07 + li * 3.1, li * 1.7, s.p.y * 0.07);
      const off = L.off + L.amp * (nz - 0.3);
      const y0 = li === 0 ? topY(s.p.x, s.p.y) + L.y : L.y + (topY(s.p.x, s.p.y) * (1 - li / levels.length)) + (noise3(s.p.x * 0.11, li * 5.3, s.p.y * 0.11) - 0.5) * 3;
      return new THREE.Vector3(s.p.x + s.n.x * off, y0, s.p.y + s.n.y * off);
    }),
  );
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let l = 0; l < levels.length - 1; l++) {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = pts[l][i], b = pts[l][j], c = pts[l + 1][j], d = pts[l + 1][i];
      // Winding: outward faces (samples walk clockwise seen from above → a, c, b).
      tri(a, c, b);
      tri(a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // Ensure normals face outward (flip triangles whose normal points inward).
  const p = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    if (nrm.getX(i) * cx + nrm.getZ(i) * cz < 0) {
      for (const k of [0, 1, 2]) nrm.setXYZ(i + k, -nrm.getX(i + k), -nrm.getY(i + k), -nrm.getZ(i + k));
      const bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, bx, by, bz);
    }
  }
  kit.add('rock', g, '#7d768a', {
    shade: (x, y, z, nx, ny) => {
      const depth = Math.min(1, Math.max(0, -y / 50));
      let s = 1.0 - depth * 0.45;
      if (ny < -0.2) s *= 0.6;
      return s * (0.85 + 0.3 * noise3(x * 0.2, y * 0.2, z * 0.2));
    },
    snow: 1,
  });
}

// ── Rim crags + arêtes ──────────────────────────────────────────────────────

/**
 * A knife-edge ridge (arête) running from the rim out and down into the cloud
 * sea: snowy shallow shoulders near the crest, steep rock flanks below. Turns
 * the rectangular summit into the top of a real mountain in every long view.
 */
function arete(kit: ObsKit, ax: number, ay: number, az: number, bx: number, by: number, bz: number, rnd: () => number, n: number): void {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const px = -uz, pz = ux; // lateral
  const base = CLOUD_Y - 14;
  const rows: THREE.Vector3[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const jl = i === 0 ? 0 : (rnd() - 0.5) * 7;
    const cy = ay + (by - ay) * Math.pow(t, 0.8) + (i > 0 && i < n ? (rnd() - 0.3) * 5 : 0);
    const cx = ax + dx * t + px * jl;
    const cz = az + dz * t + pz * jl;
    const h = Math.max(4, cy - base);
    const sh = 0.3 * h; // shoulder drop
    const w1 = sh * (1.3 + rnd() * 0.5); // shallow snowy shoulder
    const w2 = w1 + (h - sh) * (0.45 + rnd() * 0.2); // steep flank
    const row: THREE.Vector3[] = [];
    for (const [off, y] of [
      [-w2, base],
      [-w1, cy - sh],
      [0, cy],
      [w1 * (0.8 + rnd() * 0.4), cy - sh * (0.8 + rnd() * 0.4)],
      [w2, base],
    ] as const) row.push(new THREE.Vector3(cx + px * off, y, cz + pz * off));
    rows.push(row);
  }
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    // Keep faces pointing up/outward from the ridge line.
    const e1 = b.clone().sub(a);
    const e2 = c.clone().sub(a);
    const nrm = e1.cross(e2);
    if (nrm.y < 0) pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
    else pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 4; j++) {
      const a = rows[i][j], b = rows[i + 1][j], c = rows[i + 1][j + 1], d = rows[i][j + 1];
      tri(a, b, c);
      tri(a, c, d);
    }
  }
  // Blunt end cap at the far end (drops into the clouds anyway).
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  kit.add('rock', g, '#6c667e', {
    shade: (x, y, z, nx, ny) => {
      const depth = Math.min(1, Math.max(0, -y / 60));
      return (1 - depth * 0.4) * (ny < 0.3 ? 0.78 : 1) * (0.88 + 0.24 * noise3(x * 0.05, y * 0.05, z * 0.05));
    },
    snow: 1,
  });
}

function buildRim(kit: ObsKit, rnd: () => number): void {
  kit.section = 'backdrop.rim';
  const n = kit.low ? 6 : 11;
  // Arêtes from the four corners and the west flank, fanning out into the clouds.
  arete(kit, -58, -4, 61, -175, -62, 150, rnd, n);
  arete(kit, -58, -4, -61, -160, -66, -170, rnd, n);
  arete(kit, 58, -4, 61, 185, -64, 128, rnd, n);
  arete(kit, 58, -4, -61, 128, -70, -205, rnd, n);
  arete(kit, -60, -8, 8, -215, -66, 30, rnd, n);
  // Crags and pinnacles standing on the rim just past the bounds: they frame the
  // play space and break the straight skyline of the summit edge.
  const crags: [number, number, number, number, number][] = [
    // x, z, base y, height, radius
    [-61.5, 64, -3, 10, 4.2],
    [-60.2, 66.5, -3, 6, 3],
    [-61.8, -64.5, -3, 13, 4.6],
    [-58.8, -66, -3, 7, 3.4],
    [61.2, 64.5, -3, 8, 3.8],
    [60.8, -64, -3, 11, 4.2],
    [63.5, -60.5, -3, 6, 3],
    [-61.2, 38, 0, 6.5, 3],
    [-61.5, -38, 0, 7.5, 3.2],
    [60.8, 26, -2, 5, 2.8],
    [60.6, -27, -2, 6, 3],
    [-40, 63.2, -3, 5, 3.2],
    [36, 63.5, -3, 6, 3.4],
    [-46, -63.5, -3, 7, 3.6],
    [42, -63.4, -3, 5.5, 3.2],
  ];
  for (const [x, z, y0, h, r] of crags) {
    kit.add('rock', rockGeo(x - r, y0, z - r * 0.8, x + r, y0 + h, z + r * 0.8, rnd, kit.low ? 0 : 1, 0.26), '#77708a', { base: y0 });
    // A lower buttress at its foot.
    const r2 = r * (0.55 + rnd() * 0.3);
    const ox = (rnd() - 0.5) * r * 1.6;
    kit.add('rock', rockGeo(x + ox - r2, y0 - 1, z - r2, x + ox + r2, y0 + h * 0.45, z + r2, rnd, 0, 0.3), '#6c667e', { base: y0 });
  }
}

// ── Cloud sea ───────────────────────────────────────────────────────────────

const CLOUD_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uMid;
uniform vec3 uShade;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uFade;
varying vec3 vWorld;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < OCT; i++) { s += vn(p) * a; p = p * 2.07 + vec2(3.1, 1.7); a *= 0.5; } return s; }
void main() {
  vec2 p = vWorld.xz * 0.0085 + vec2(uTime * 0.0035, uTime * 0.0012);
  float w = fbm(p * 0.55 + 7.3);
  float n = fbm(p + w * 0.9);
  vec2 sd = normalize(uSunDir.xz + 1e-4);
  float nl = fbm(p + sd * 0.05 + w * 0.9);
  float relief = clamp(0.55 + (n - nl) * 7.0, 0.0, 1.2);
  vec3 toFrag = vWorld - cameraPosition;
  float dist = length(toFrag.xz);
  vec2 vd = toFrag.xz / max(dist, 1e-3);
  float facing = max(dot(vd, sd), 0.0);
  // Billow body: violet in the troughs, lavender on the crowns.
  vec3 col = mix(uShade, uMid, smoothstep(0.3, 0.75, n));
  // Sun-lit crowns (stronger toward the last light).
  col = mix(col, uLit, relief * (0.18 + 0.55 * pow(facing, 2.5)) * smoothstep(0.4, 0.8, n));
  // Luminous horizon toward the sun.
  col += uLit * pow(facing, 7.0) * smoothstep(150.0, 1400.0, dist) * 0.55;
  // Own aerial perspective into the sky's horizon band.
  float f = 1.0 - exp(-dist * 0.0011);
  col = mix(col, uHorizon, clamp(f, 0.0, 1.0) * 0.92);
  gl_FragColor = vec4(col * uFade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function buildCloudSea(def: MapDef, low: boolean): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const l = def.lighting;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uLit: { value: new THREE.Color(l.sunGlow).lerp(new THREE.Color('#ffe0c4'), 0.3) },
      uMid: { value: new THREE.Color(l.skyHorizon).lerp(new THREE.Color(ENV.snow), 0.25) },
      uShade: { value: new THREE.Color(l.fogColor).lerp(new THREE.Color(l.skyZenith), 0.45) },
      uHorizon: { value: new THREE.Color(l.fogColor) },
      uSunDir: { value: new THREE.Vector3(l.sunDir.x, l.sunDir.y, l.sunDir.z).normalize() },
      uTime: { value: 0 },
      uFade: { value: 1 },
    },
    defines: { OCT: low ? 3 : 5 },
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
  });
  const g = new THREE.PlaneGeometry(6000, 6000, 1, 1);
  g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.y = CLOUD_Y;
  mesh.name = 'obs.cloudSea';
  mesh.renderOrder = -10;
  return { mesh, mat };
}

// ── Milky Way band (camera-centred, fades in with the match) ───────────────

const MW_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const MW_FRAG = /* glsl */ `
uniform float uAmount;
uniform vec3 uNormal;
uniform vec3 uSunDir;
uniform vec3 uTint;
uniform vec3 uTint2;
varying vec3 vDir;
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vn3(vec3 p) { vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float band = exp(-pow(dot(d, uNormal) / 0.2, 2.0));
  float n = vn3(d * 7.0) * 0.6 + vn3(d * 19.0) * 0.3 + vn3(d * 43.0) * 0.1;
  float dust = smoothstep(0.45, 0.7, vn3(d * 11.0 + 5.0)) * exp(-pow(dot(d, uNormal) / 0.06, 2.0));
  float glow = band * (0.35 + 0.9 * n) * (1.0 - dust * 0.85);
  // Tiny dense star specks inside the band.
  vec3 sp = d * 420.0;
  float r = hash13(floor(sp));
  float speck = step(0.992, r) * band * 1.4;
  float vis = smoothstep(0.05, 0.35, h) * (1.0 - pow(max(dot(d, uSunDir), 0.0), 3.0));
  vec3 col = mix(uTint, uTint2, n) * glow * 0.32 + vec3(1.0, 0.97, 0.9) * speck;
  gl_FragColor = vec4(col * vis * uAmount, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function buildMilkyWay(sunDir: THREE.Vector3): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uAmount: { value: 0 },
      uNormal: { value: new THREE.Vector3(0.62, 0.35, 0.7).normalize() },
      uSunDir: { value: sunDir.clone() },
      uTint: { value: new THREE.Color('#b6a6e0') },
      uTint2: { value: new THREE.Color(ENV.glowGold) },
    },
    vertexShader: MW_VERT,
    fragmentShader: MW_FRAG,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat);
  mesh.name = 'obs.milkyWay';
  mesh.renderOrder = -999;
  mesh.frustumCulled = false;
  return { mesh, mat };
}

// ── Peaks, billows, launch mesa ─────────────────────────────────────────────

/**
 * The launch butte rising out of the clouds (top = the rocket pad): a narrow,
 * steep-sided rock pillar with strata ledges catching snow — it must read as
 * far away and vertiginous, not as a table.
 */
function buildMesa(rp: THREE.Vector3, k: number, rnd: () => number): THREE.BufferGeometry {
  const sides = 22;
  const bottom = CLOUD_Y - 40 * k;
  const topR = 40 * k;
  const rings: { y: number; r: number; snow: number }[] = [
    { y: bottom, r: 64 * k, snow: 0 },
    { y: bottom + (rp.y - bottom) * 0.3, r: 55 * k, snow: 0 },
    { y: bottom + (rp.y - bottom) * 0.34, r: 58 * k, snow: 0.45 }, // strata ledge
    { y: bottom + (rp.y - bottom) * 0.62, r: 48 * k, snow: 0 },
    { y: bottom + (rp.y - bottom) * 0.66, r: 50 * k, snow: 0.45 },
    { y: bottom + (rp.y - bottom) * 0.93, r: 43 * k, snow: 0 },
    { y: rp.y - 0.35, r: topR, snow: 0.6 },
  ];
  const jit = rings.map(() => Array.from({ length: sides }, () => 0.86 + rnd() * 0.24));
  const pos: number[] = [];
  const col: number[] = [];
  const rock = new THREE.Color('#4c4862');
  const rockLit = new THREE.Color('#645c7c');
  const snow = new THREE.Color(ENV.snow);
  const c = new THREE.Color();
  const push = (v: THREE.Vector3, snowAmt: number, lit: number): void => {
    pos.push(v.x, v.y, v.z);
    c.copy(rock).lerp(rockLit, lit).lerp(snow, snowAmt);
    col.push(c.r, c.g, c.b);
  };
  const addColumn = (cx: number, cz: number, scaleR: number, ringsU: typeof rings, jj: number[][], topY: number): void => {
    const P = (i: number, j: number): THREE.Vector3 => {
      const a = ((i % sides) / sides) * Math.PI * 2;
      const r = ringsU[j].r * scaleR * jj[j][i % sides];
      return new THREE.Vector3(cx + Math.cos(a) * r, ringsU[j].y, cz + Math.sin(a) * r);
    };
    for (let j = 0; j < ringsU.length - 1; j++) {
      for (let i = 0; i < sides; i++) {
        const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
        const lit = (i % 3) / 3;
        push(a, ringsU[j].snow, lit), push(cc, ringsU[j + 1].snow, lit), push(b, ringsU[j].snow, lit);
        push(a, ringsU[j].snow, lit), push(d, ringsU[j + 1].snow, lit), push(cc, ringsU[j + 1].snow, lit);
      }
    }
    const center = new THREE.Vector3(cx, topY, cz);
    for (let i = 0; i < sides; i++) {
      const a = P(i, ringsU.length - 1), b = P(i + 1, ringsU.length - 1);
      push(center, 1, 0), push(b, 1, 0), push(a, 1, 0);
    }
  };
  addColumn(rp.x, rp.z, 1, rings, jit, rp.y - 0.35);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Make every face point away from its column axis / up.
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const ax = rp.x;
    const az = rp.z;
    const e1x = p.getX(i + 1) - p.getX(i), e1y = p.getY(i + 1) - p.getY(i), e1z = p.getZ(i + 1) - p.getZ(i);
    const e2x = p.getX(i + 2) - p.getX(i), e2y = p.getY(i + 2) - p.getY(i), e2z = p.getZ(i + 2) - p.getZ(i);
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const outward = Math.abs(fy) > 0.9 * Math.hypot(fx, fy, fz) && cy > rp.y - 12 * k ? fy : fx * (cx - ax) + fz * (cz - az);
    if (outward < 0) {
      const bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, bx, by, bz);
      const r = col.slice((i + 1) * 3, (i + 2) * 3);
      const ca = g.attributes.color as THREE.BufferAttribute;
      ca.setXYZ(i + 1, ca.getX(i + 2), ca.getY(i + 2), ca.getZ(i + 2));
      ca.setXYZ(i + 2, r[0], r[1], r[2]);
    }
  }
  g.computeVertexNormals();
  void n;
  return g;
}

function peakGeo(h: number, r: number, rnd: () => number, snowLine: number): THREE.BufferGeometry {
  // A jagged massif: a main summit plus two shoulders, faceted, snow above the line.
  const pos: number[] = [];
  const col: number[] = [];
  const rock = new THREE.Color('#6a6379');
  const snow = new THREE.Color(ENV.snow);
  const cone = (cx: number, cz: number, hh: number, rr: number): void => {
    const sides = 9;
    const rings = 6;
    const jit: number[][] = [];
    for (let j = 0; j <= rings; j++) {
      jit.push([]);
      for (let i = 0; i < sides; i++) jit[j].push(0.6 + rnd() * 0.8);
    }
    const lift: number[][] = jit.map((row) => row.map(() => (rnd() - 0.5) * 0.12));
    const P = (i: number, j: number): THREE.Vector3 => {
      const t = j / rings;
      const a = ((i % sides) / sides) * Math.PI * 2 + t * 0.9;
      const rrr = rr * Math.pow(1 - t, 1.1) * jit[j][i % sides];
      return new THREE.Vector3(cx + Math.cos(a) * rrr, hh * Math.min(1, t + lift[j][i % sides] * (j > 0 && j < rings ? 1 : 0)), cz + Math.sin(a) * rrr);
    };
    const push = (v: THREE.Vector3): void => {
      pos.push(v.x, v.y, v.z);
      const f = v.y / h;
      const sAmt = f > snowLine ? 1 : f > snowLine - 0.15 ? 0.55 : 0;
      const c = rock.clone().lerp(snow, sAmt);
      col.push(c.r, c.g, c.b);
    };
    const top = new THREE.Vector3(cx, hh, cz);
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < sides; i++) {
        const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
        if (j === rings - 1) {
          push(a), push(top), push(b);
        } else {
          push(a), push(c), push(b);
          push(a), push(d), push(c);
        }
      }
    }
  };
  cone(0, 0, h, r);
  cone(r * 0.55, r * 0.2, h * (0.45 + rnd() * 0.2), r * 0.7);
  cone(-r * 0.5, -r * 0.25, h * (0.35 + rnd() * 0.25), r * 0.65);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function billowGeo(r: number, h: number, rnd: () => number, low: boolean): THREE.BufferGeometry {
  const g0 = new THREE.SphereGeometry(1, low ? 8 : 12, low ? 5 : 7, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g0.attributes.position as THREE.BufferAttribute;
  const o = rnd() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.8 + 0.4 * noise3(x * 2 + o, y * 2, z * 2);
    p.setXYZ(i, x * r * k, y * h * k, z * r * k);
  }
  g0.computeVertexNormals();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h;
    const c = new THREE.Color('#b9aed4').lerp(new THREE.Color('#f3e6ea'), Math.min(1, t * 1.3));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g0.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g0;
}

export function buildBackdrop(kit: ObsKit, root: THREE.Object3D, def: MapDef, materials: MaterialLibrary, quality: QualitySettings, rnd: () => number): BackdropParts {
  const low = quality.preset === 'low';
  const owned: { dispose(): void }[] = [];
  buildCliffs(kit);
  buildRim(kit, rnd);

  const sunDir = new THREE.Vector3(def.lighting.sunDir.x, def.lighting.sunDir.y, def.lighting.sunDir.z).normalize();
  const sea = buildCloudSea(def, low);
  root.add(sea.mesh);
  owned.push(sea.mesh.geometry, sea.mat);

  // Far scenery: pulled in to fit the camera far plane (keeps the angular size).
  const maxD = quality.drawDistance - 40;
  const place = (x: number, z: number): { x: number; z: number; k: number } => {
    const d = Math.hypot(x, z);
    const k = d > maxD ? maxD / d : 1;
    return { x: x * k, z: z * k, k };
  };
  const peakMat = farMaterial(0.32, low);
  const billowMat = farMaterial(0.4, low);
  owned.push(peakMat, billowMat);
  const peaks: THREE.BufferGeometry[] = [];
  const peakDefs: [number, number, number, number][] = [
    // azimuth (deg, 0 = +X, 90 = +Z), distance, height above the clouds, base radius
    [-70, 640, 95, 120],
    [-44, 900, 70, 150],
    [-100, 520, 60, 90],
    [-130, 760, 120, 140],
    [-160, 600, 85, 110],
    [172, 820, 130, 170],
    [146, 540, 55, 80],
    [120, 700, 95, 130],
    [95, 950, 110, 170],
    [66, 600, 45, 90],
    [-14, 1000, 38, 160],
    [8, 980, 30, 140],
    [205, 480, 40, 70],
    [-190, 900, 75, 120],
  ];
  for (const [azd, dist, h, r] of peakDefs) {
    const az = (azd * Math.PI) / 180;
    const pl = place(Math.cos(az) * dist, Math.sin(az) * dist);
    const g = peakGeo((h + 25) * pl.k, r * pl.k, rnd, 0.5);
    g.translate(pl.x, CLOUD_Y - 25 * pl.k, pl.z);
    peaks.push(g);
  }
  const billows: THREE.BufferGeometry[] = [];
  // (Billow mounds read as floating islands at this sun angle — the cloud sea's own relief is enough.)
  const mergeTo = (list: THREE.BufferGeometry[], mat: THREE.Material, name: string): THREE.Mesh => {
    let count = 0;
    for (const g of list) count += (g.index ? g.toNonIndexed() : g).attributes.position.count;
    const P = new Float32Array(count * 3);
    const N = new Float32Array(count * 3);
    const C = new Float32Array(count * 3);
    let o = 0;
    for (const g0 of list) {
      const g = g0.index ? g0.toNonIndexed() : g0;
      const p = g.attributes.position as THREE.BufferAttribute;
      const n = g.attributes.normal as THREE.BufferAttribute;
      const c = g.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++, o++) {
        P.set([p.getX(i), p.getY(i), p.getZ(i)], o * 3);
        N.set([n.getX(i), n.getY(i), n.getZ(i)], o * 3);
        C.set([c.getX(i), c.getY(i), c.getZ(i)], o * 3);
      }
      if (g !== g0) g.dispose();
      g0.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    owned.push(geo);
    return mesh;
  };
  root.add(mergeTo(peaks, peakMat, 'obs.peaks'));
  if (billows.length) root.add(mergeTo(billows, billowMat, 'obs.billows'));

  // Launch mesa + the shared finale rocket (tower complex).
  const rocket = createLaunchRocket(materials, quality, { scale: def.rocket.scale, tower: true });
  const rp = new THREE.Vector3(def.rocket.pos.x, def.rocket.pos.y, def.rocket.pos.z);
  const dist = Math.hypot(rp.x, rp.z);
  const maxR = quality.drawDistance - 75;
  let k = 1;
  if (dist > maxR) {
    k = maxR / dist;
    rp.set(rp.x * k, rp.y * k, rp.z * k);
    rocket.root.scale.multiplyScalar(k);
  }
  rocket.root.position.copy(rp);
  rocket.root.rotation.y = Math.atan2(-rp.z, rp.x);
  root.add(rocket.root);
  const mesaGeo = buildMesa(rp, k, rnd);
  // Hazier than the peaks: the butte must sit far behind the summit; the rocket
  // on it thins its own fog so the silhouette stays crisp against the glow.
  const mesaMat = farMaterial(0.3, low);
  owned.push(mesaMat);
  const mesa = new THREE.Mesh(mesaGeo, mesaMat);
  mesa.name = 'obs.mesa';
  root.add(mesa);
  owned.push(mesaGeo);
  const rocketTarget = new THREE.Vector3(rp.x, rp.y + 28 * def.rocket.scale * k, rp.z);

  // Milky Way + moon (follow the camera; see update in the decor module).
  const mw = buildMilkyWay(sunDir);
  root.add(mw.mesh);
  owned.push(mw.mesh.geometry, mw.mat);
  const atlas = kit.signTexture;
  let moonTex: THREE.Texture | null = null;
  if (atlas) {
    moonTex = atlas.clone();
    const r = rect('moon', 2);
    moonTex.offset.set(r[0], r[1]);
    moonTex.repeat.set(r[2] - r[0], r[3] - r[1]);
    moonTex.needsUpdate = true;
    owned.push(moonTex);
  }
  const moonMat = new THREE.MeshBasicMaterial({ map: moonTex, color: new THREE.Color('#f4f1ff').multiplyScalar(1.25), transparent: true, depthWrite: false, fog: false });
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), moonMat);
  moon.name = 'obs.moon';
  moon.renderOrder = -998;
  moon.frustumCulled = false;
  root.add(moon);
  owned.push(moon.geometry, moonMat);
  const moonDist = Math.min(220, quality.drawDistance * 0.7);
  moon.scale.setScalar(moonDist * 0.13);
  const moonDir = new THREE.Vector3(-0.88, 0.33, 0.34).normalize();
  return { rocket, cloudMat: sea.mat, milkyMat: mw.mat, milky: mw.mesh, moon, moonDir, moonDist, farMats: [peakMat, billowMat], owned, rocketTarget };
}
