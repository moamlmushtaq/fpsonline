// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — the Launch Control finale rocket (shared by every map).
//
// A retro-futurist 1970s launch vehicle: ceramic-white body with a black roll
// pattern, bare-metal interstage, swept black fins, a stacked "HALCYON" stencil,
// five engine bells and an escape-tower spike — standing on its launch mount.
//
//  • Idle: slow LOX venting from the interstage, cold vapour rolling off the
//    mount, a warm blinking beacon on the fin tips and the escape tower.
//  • launch.t 0 → 1.5 s: ignition — the engine bells glow, a gold-white flame
//    grows, warm steam billows out radially across the pad.
//    1.5 s →: liftoff with smooth acceleration, a gentle pitch-over toward the
//    sea (+X), a long warm smoke column from the pad to the tail. Beacons and
//    livery strips glow in the WINNING TEAM's color (teamColors().emissive) —
//    the only team color in any environment art.
//
// Placement: `root` origin = the top of the launch pad (the mount stands on it).
// Height ≈ 50 m × scale (mount 3.6 m + vehicle 46 m). The launch pitches over
// toward local +X — rotate `root` so +X points away from the audience.
// `tower: true` adds a standalone complex (lattice umbilical tower with swing
// arms on the local −Z side + a concrete apron) for horizon rockets.
// Distant rockets: the materials here thin the scene fog with distance from the
// map origin so the silhouette stays readable on the horizon (keep it inside the
// camera far plane: quality.drawDistance is 260 m on Low).
//
// Cost: ~10 draw calls, zero allocations per frame, puffs are one InstancedMesh.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialLibrary, QualitySettings } from '../contracts';
import type { Team } from '../../shared/types';
import { ENV, teamColors } from '../engine/palette';

export interface LaunchRocket {
  readonly root: THREE.Group;
  update(dt: number, launch: { team: Team; t: number } | null, time: number): void;
  dispose(): void;
}

// ── Dimensions (scale 1, meters) ────────────────────────────────────────────

/** Launch mount (pedestal) — Gantry's collision mirrors this: 7.2 × 3.6 × 7.2. */
export const ROCKET_MOUNT_HALF = 3.6;
export const ROCKET_MOUNT_H = 3.6;
/** Body radius of the first stage. */
export const ROCKET_RADIUS = 2.6;
/** Top of the nose above the mount top (escape tower adds ~5.5 m). */
const BODY_H = 41;
const LIFTOFF_T = 1.5;

const C_DARK = '#34302c';
const C_METAL = ENV.metalLight;
const C_BONE = ENV.bone;

// ── Small geometry helpers ──────────────────────────────────────────────────

/** Merge geometries after normalising them to non-indexed position/normal/uv. */
function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') n.deleteAttribute(name);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    if (!n.attributes.normal) n.computeVertexNormals();
    return n;
  });
  const out = mergeGeometries(norm, false);
  for (const g of norm) g.dispose();
  if (!out) throw new Error('rocket: merge failed');
  return out;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** A thin box beam from a to b (square section t). */
function beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number): THREE.BufferGeometry {
  const a = new THREE.Vector3(ax, ay, az);
  const b = new THREE.Vector3(bx, by, bz);
  const d = b.clone().sub(a);
  const len = d.length();
  const g = new THREE.BoxGeometry(t, len, t);
  _q.setFromUnitVectors(_up, d.normalize());
  _m.compose(a.add(b).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  return g;
}

/** Lathe from (radius, y) pairs; UV v remapped to y / vRange so a vertical canvas maps by height. */
function lathe(profile: [number, number][], segs: number, vRange?: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segs,
  );
  if (vRange) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setY(i, THREE.MathUtils.clamp(pos.getY(i) / vRange, 0, 1));
  }
  return g;
}

// ── Fog thinning for distant rockets ────────────────────────────────────────

const FOG_FRAG_SCALED = /* glsl */ `
#ifdef USE_FOG
  float fdS = vFogDepth * uFogScale;
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fdS * fdS );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, fdS );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;

function withFogScale<T extends THREE.Material>(m: T, u: { value: number }): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFogScale = u;
    sh.fragmentShader = 'uniform float uFogScale;\n' + sh.fragmentShader.replace('#include <fog_fragment>', FOG_FRAG_SCALED);
  };
  m.customProgramCacheKey = () => 'halcyon.rocketFog';
  return m;
}

// ── Body livery texture ─────────────────────────────────────────────────────

function paintBody(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const py = (y: number): number => (1 - y / BODY_H) * h;
  const band = (y0: number, y1: number, style: string): void => {
    ctx.fillStyle = style;
    ctx.fillRect(0, py(y1), w, py(y0) - py(y1));
  };
  let seed = 90210;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Ceramic base with soft vertical brush strokes.
  ctx.fillStyle = C_BONE;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) {
    const warm = rnd() < 0.5;
    ctx.fillStyle = warm ? `rgba(255,248,236,${0.05 + rnd() * 0.08})` : `rgba(120,104,88,${0.02 + rnd() * 0.035})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 8 + rnd() * 50);
  }
  // Panel seams.
  ctx.strokeStyle = 'rgba(92,80,68,0.28)';
  ctx.lineWidth = 1;
  for (let y = 5.6; y < 33; y += 2.4) {
    ctx.beginPath();
    ctx.moveTo(0, py(y));
    ctx.lineTo(w, py(y));
    ctx.stroke();
  }
  for (let k = 0; k < 16; k++) {
    const x = (k / 16) * w + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, py(33));
    ctx.lineTo(x, py(3.3));
    ctx.stroke();
  }
  // Roll pattern: alternating black quarters (offset per band).
  const quarters = (y0: number, y1: number, off: number): void => {
    ctx.fillStyle = C_DARK;
    for (let q = 0; q < 4; q++) if ((q + off) % 2 === 0) ctx.fillRect((q / 4) * w, py(y1), w / 4, py(y0) - py(y1));
  };
  quarters(3.3, 7.4, 0);
  quarters(17.2, 19.6, 1);
  quarters(30.4, 33, 0);
  // Aft skirt: dark with pale ribs.
  band(0, 3.3, C_DARK);
  ctx.fillStyle = 'rgba(210,200,185,0.22)';
  for (let k = 0; k < 48; k++) ctx.fillRect((k / 48) * w, py(3.2), 2, py(0.6) - py(3.2));
  // Interstage: bare metal with ribs and rivets.
  band(20.9, 22.5, C_METAL);
  ctx.fillStyle = 'rgba(60,60,62,0.35)';
  for (let k = 0; k < 64; k++) ctx.fillRect((k / 64) * w, py(22.4), 1, py(21) - py(22.4));
  band(20.85, 20.95, '#2a2724');
  band(22.45, 22.55, '#2a2724');
  // Stacked stencil letters (two sides), with stencil bridges.
  const letters = 'HALCYON';
  const lh = (16.6 - 8) / letters.length;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontPx = Math.round((lh / BODY_H) * h * 0.92);
  ctx.font = `700 ${fontPx}px "Space Grotesk", "Arial Narrow", Arial, sans-serif`;
  for (const u of [0.125, 0.625]) {
    for (let i = 0; i < letters.length; i++) {
      const y = 16.6 - (i + 0.5) * lh;
      ctx.fillStyle = C_DARK;
      ctx.fillText(letters[i], u * w, py(y));
      ctx.fillStyle = C_BONE;
      ctx.fillRect(u * w - 1, py(y) - fontPx * 0.5, 2, fontPx);
    }
  }
  // Agency emblem on the second stage: a low sun over a striped sea.
  for (const u of [0.375, 0.875]) {
    const cx = u * w;
    const cy = py(26.5);
    const r = (1.25 / BODY_H) * h;
    ctx.fillStyle = ENV.terracottaFaded;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = C_DARK;
    for (let i = 0; i < 3; i++) ctx.fillRect(cx - r, cy + 2 + i * r * 0.28, r * 2, r * 0.13);
  }
  // Capsule windows and a metal nose cap.
  ctx.fillStyle = '#2b2a2c';
  for (let k = 0; k < 10; k++) ctx.fillRect(((k + 0.3) / 10) * w, py(36.1), w / 26, py(35.2) - py(36.1));
  band(39.2, BODY_H, C_METAL);
  // Weathering: soot at the base, drips below the interstage.
  const soot = ctx.createLinearGradient(0, py(0), 0, py(9));
  soot.addColorStop(0, 'rgba(40,34,30,0.55)');
  soot.addColorStop(1, 'rgba(40,34,30,0)');
  ctx.fillStyle = soot;
  ctx.fillRect(0, py(9), w, py(0) - py(9));
  for (let i = 0; i < 40; i++) {
    const x = rnd() * w;
    const len = (1 + rnd() * 4) / BODY_H * h;
    ctx.fillStyle = `rgba(110,96,84,${0.05 + rnd() * 0.08})`;
    ctx.fillRect(x, py(20.8), 1 + rnd() * 2, len);
  }
}

// ── Shaders ─────────────────────────────────────────────────────────────────

const PUFF_VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSeed;
varying float vAlpha;
varying float vSeed;
varying vec2 vUv;
varying float vFogD;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vSeed = aSeed;
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz) * length(modelMatrix[0].xyz);
  float r = aSeed * 6.2831;
  vec2 p = mat2(cos(r), -sin(r), sin(r), cos(r)) * position.xy;
  c.xy += p * s;
  vFogD = -c.z;
  gl_Position = projectionMatrix * c;
}`;

const PUFF_FRAG = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uSunW;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float uFogScale;
varying float vAlpha;
varying float vSeed;
varying vec2 vUv;
varying float vFogD;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  float ang = atan(p.y, p.x);
  float edge = 0.92 + 0.1 * sin(ang * 5.0 + vSeed * 40.0) + 0.06 * sin(ang * 11.0 - vSeed * 17.0);
  float a = 1.0 - smoothstep(edge * 0.35, edge, d);
  a *= vAlpha;
  if (a < 0.004) discard;
  vec3 nV = normalize(vec3(p * 2.0, sqrt(max(0.05, 1.0 - d * d))));
  vec3 nW = (vec4(nV, 0.0) * viewMatrix).xyz;
  float lit = clamp(dot(nW, uSunW) * 0.6 + 0.45 + nW.y * 0.15, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, lit);
  float fd = vFogD * uFogScale;
  col = mix(col, fogColor, 1.0 - exp(-fogDensity * fogDensity * fd * fd));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const TRAIL_VERT = /* glsl */ `
uniform float uTop;
uniform float uTopX;
uniform float uSpread;
uniform float uTime;
varying vec3 vNW;
varying vec3 vW;
varying float vH;
varying float vFogD;
void main() {
  float h = position.y + 0.5;
  float y = h * uTop;
  float ang = atan(position.z, position.x);
  float r = mix(uSpread, 1.4, pow(h, 0.3)) + y * 0.025;
  float lump = sin(y * 0.33 - uTime * 0.7 + ang * 3.0) * 0.45 + sin(y * 0.13 + ang * 5.0 + uTime * 0.25) * 0.35 + sin(y * 0.71 + ang * 7.0 - uTime * 1.1) * 0.2;
  r *= 1.0 + 0.3 * lump * smoothstep(0.02, 0.2, h);
  vec3 p = vec3(position.x * r, y, position.z * r);
  p.x += uTopX * h * h;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vNW = normalize(mat3(modelMatrix) * vec3(position.x, 0.25 - h * 0.2, position.z));
  vH = h;
  vec4 mv = viewMatrix * wp;
  vFogD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const TRAIL_FRAG = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uSunW;
uniform float uOpacity;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float uFogScale;
varying vec3 vNW;
varying vec3 vW;
varying float vH;
varying float vFogD;
void main() {
  vec3 n = normalize(vNW);
  vec3 v = normalize(cameraPosition - vW);
  float facing = abs(dot(n, v));
  float a = smoothstep(0.05, 0.75, facing) * uOpacity;
  a *= smoothstep(1.0, 0.9, vH) * (0.65 + 0.35 * smoothstep(0.0, 0.08, vH));
  if (a < 0.004) discard;
  float lit = clamp(dot(n, uSunW) * 0.55 + 0.5, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, lit);
  float fd = vFogD * uFogScale;
  col = mix(col, fogColor, 1.0 - exp(-fogDensity * fogDensity * fd * fd));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FLAME_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vFogD;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFogD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FLAME_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uPower;
uniform float uTime;
uniform float fogDensity;
uniform float uFogScale;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vFogD;
void main() {
  float along = vUv.y; // 1 at the nozzle, 0 at the tail
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float core = pow(facing, 2.2);
  float flick = 0.82 + 0.18 * sin(uTime * 43.0 + along * 17.0) * sin(uTime * 29.0 - vUv.x * 25.0);
  float fade = smoothstep(0.0, 0.7, along);
  vec3 col = mix(uEdge, uCore, core) * (0.35 + core) * fade * flick;
  col += uCore * core * pow(0.5 + 0.5 * sin(along * 34.0 - uTime * 24.0), 8.0) * 0.5 * smoothstep(0.45, 1.0, along);
  float fd = vFogD * uFogScale;
  col *= exp(-fogDensity * fogDensity * fd * fd) * uPower;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.2);
  gl_FragColor = vec4(uColor * a * uPower, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// ── Puff pool ───────────────────────────────────────────────────────────────

class PuffPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly n: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly peak: Float32Array;
  private readonly drag: Float32Array;
  private readonly alpha: THREE.InstancedBufferAttribute;
  private next = 0;
  private live = 0;
  private readonly mtx = new THREE.Matrix4();

  constructor(n: number, material: THREE.ShaderMaterial) {
    this.n = n;
    const g = new THREE.PlaneGeometry(1, 1);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) seed[i] = ((i * 0.61803398875) % 1 + 0.137 * i) % 1;
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aAlpha', this.alpha);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    this.mesh = new THREE.InstancedMesh(g, material, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.name = 'rocket.puffs';
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.peak = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.mtx.makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, this.mtx);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, peak: number, drag: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.peak[i] = peak;
    this.drag[i] = drag;
    this.live = this.n;
  }

  clear(): void {
    for (let i = 0; i < this.n; i++) this.age[i] = this.life[i] = 1;
    this.live = this.n;
  }

  update(dt: number, windX: number, windZ: number): void {
    if (this.live === 0) return;
    let alive = 0;
    const a = this.alpha.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) {
        if (a[i] !== 0) {
          a[i] = 0;
          this.mtx.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(i, this.mtx);
        }
        continue;
      }
      alive++;
      this.age[i] += dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vx[i] = this.vx[i] * k + windX * (1 - k);
      this.vz[i] = this.vz[i] * k + windZ * (1 - k);
      this.vy[i] *= Math.exp(-0.35 * dt);
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      const f = Math.min(1, this.age[i] / this.life[i]);
      const s = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - f) * (1 - f));
      a[i] = this.peak[i] * Math.min(1, f * 6) * (1 - f) * (1 - f * 0.4);
      this.mtx.makeScale(s, s, s);
      this.mtx.setPosition(this.px[i], this.py[i], this.pz[i]);
      this.mesh.setMatrixAt(i, this.mtx);
    }
    this.alpha.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.live = alive;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

function makePuffMaterial(fogScale: { value: number }, sunW: THREE.Vector3): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uLit: { value: new THREE.Color('#fff4e8') },
        uShade: { value: new THREE.Color('#bca3a6') },
        uSunW: { value: sunW },
      },
    ]),
    vertexShader: PUFF_VERT,
    fragmentShader: PUFF_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  m.uniforms.uFogScale = fogScale;
  m.uniforms.uSunW.value = sunW;
  return m;
}

/**
 * A standalone pool of soft, sun-shaded steam puffs (the same look as the
 * rocket's). Maps use it for extra exhaust vents (e.g. Gantry's flame trench).
 * Positions are in the parent's space; zero allocations per frame.
 */
export interface SteamEmitter {
  readonly mesh: THREE.InstancedMesh;
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, alpha: number, drag: number): void;
  update(dt: number, windX: number, windZ: number): void;
  clear(): void;
  /** World-space direction toward the sun (defaults to a low sun from +X). */
  readonly sunDir: THREE.Vector3;
  dispose(): void;
}

export function createSteamEmitter(quality: QualitySettings, count = 48): SteamEmitter {
  const sunDir = new THREE.Vector3(0.9, 0.25, -0.3).normalize();
  const mat = makePuffMaterial({ value: 1 }, sunDir);
  const pool = new PuffPool(Math.max(8, Math.round(count * (0.4 + 0.6 * quality.particles))), mat);
  return {
    mesh: pool.mesh,
    sunDir,
    emit: (x, y, z, vx, vy, vz, life, s0, s1, alpha, drag) => pool.emit(x, y, z, vx, vy, vz, life, s0, s1, alpha, drag),
    update: (dt, wx, wz) => pool.update(dt, wx, wz),
    clear: () => pool.clear(),
    dispose: () => {
      pool.dispose();
      mat.dispose();
    },
  };
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createLaunchRocket(materials: MaterialLibrary, quality: QualitySettings, opts: { scale: number; tower?: boolean }): LaunchRocket {
  const low = quality.preset === 'low';
  const segs = low ? 20 : 36;
  const shadows = quality.shadows !== 'off';
  const fogScale = { value: 1 };
  const owned: THREE.Material[] = [];
  const own = <T extends THREE.Material>(m: T): T => {
    owned.push(m);
    return m;
  };

  const root = new THREE.Group();
  root.name = 'launchRocket';
  root.scale.setScalar(opts.scale);

  // ── Materials ──
  const bodyTex = materials.canvasTexture(low ? 'rocket.body.lo' : 'rocket.body', low ? 256 : 512, low ? 512 : 1024, paintBody);
  const mkStd = (color: string, map: THREE.Texture | null, rough: number, metal: number, side: THREE.Side = THREE.FrontSide): THREE.Material =>
    own(
      withFogScale(
        low
          ? new THREE.MeshLambertMaterial({ color: new THREE.Color(color), map, side })
          : new THREE.MeshStandardMaterial({ color: new THREE.Color(color), map, roughness: rough, metalness: metal, side }),
        fogScale,
      ),
    );
  const matBody = mkStd('#ffffff', bodyTex, 0.42, 0.04);
  const matDark = mkStd(C_DARK, null, 0.5, 0.2);
  const matMetal = mkStd(C_METAL, null, 0.34, 0.65, THREE.DoubleSide);
  const matMount = mkStd(ENV.concrete, null, 0.92, 0);
  const matTower = mkStd('#8e9ea6', null, 0.7, 0.25); // dusty blue-grey steel (never reads as a team color at sunset)
  const beaconBase = new THREE.Color(ENV.glowGold);
  const matBeacon = own(withFogScale(new THREE.MeshBasicMaterial({ color: beaconBase.clone() }), fogScale));
  const matLivery = own(withFogScale(new THREE.MeshBasicMaterial({ color: new THREE.Color(ENV.boneShade).multiplyScalar(0.55) }), fogScale));
  const matBell = own(withFogScale(new THREE.MeshBasicMaterial({ color: new THREE.Color('#1c1a19'), side: THREE.DoubleSide }), fogScale));

  const cast = (m: THREE.Mesh): THREE.Mesh => {
    m.castShadow = shadows;
    m.receiveShadow = true;
    return m;
  };

  // ── Launch mount (stays on the pad) ──
  const H = ROCKET_MOUNT_H;
  const M = ROCKET_MOUNT_HALF;
  {
    const parts: THREE.BufferGeometry[] = [];
    // Tapered concrete pedestal with a plinth step.
    const ped = lathe(
      [
        [0.01, 0],
        [M * 1.414, 0],
        [M * 1.414, 0.5],
        [M * 1.33, 0.62],
        [M * 1.3, H - 0.35],
        [M * 1.36, H - 0.2],
        [M * 1.36, H],
        [2.1, H],
        [2.1, H - 1.2],
      ],
      4,
    );
    ped.rotateY(Math.PI / 4);
    const pedFlat = ped.toNonIndexed();
    ped.dispose();
    pedFlat.computeVertexNormals();
    parts.push(pedFlat);
    root.add(cast(new THREE.Mesh(merge(parts), matMount)));
    // Hold-down arms (metal) at the diagonals.
    const arms: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      arms.push(beam(c * 4.4, H + 0.05, s * 4.4, c * 2.75, H + 1.3, s * 2.75, 0.45));
      arms.push(box(c * 4.1, H + 0.15, s * 4.1, 0.9, 0.3, 0.9));
    }
    root.add(cast(new THREE.Mesh(merge(arms), matMetal)));
  }

  // ── Vehicle (moves at launch) ──
  const vehicle = new THREE.Group();
  vehicle.name = 'rocket.vehicle';
  vehicle.position.y = H;
  root.add(vehicle);

  const R = ROCKET_RADIUS;
  const ogive: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    ogive.push([Math.max(0.02, 2.45 * Math.sqrt(1 - Math.pow(f, 1.7))), 33 + f * 8]);
  }
  const bodyGeo = lathe(
    [
      [0.02, 0.5],
      [1.6, 0.5],
      [3.02, 0.62],
      [2.95, 1.5],
      [2.72, 2.7],
      [R, 3.3],
      [R, 20.9],
      [2.47, 21.15],
      [2.47, 22.35],
      [2.45, 22.5],
      ...ogive,
    ],
    segs,
    BODY_H,
  );
  const bodyMesh = cast(new THREE.Mesh(bodyGeo, matBody));
  bodyMesh.rotation.y = Math.PI / 4;
  vehicle.add(bodyMesh);

  // Fins (swept, + configuration) — dark.
  const finShape = new THREE.Shape();
  finShape.moveTo(2.2, 0.3);
  finShape.lineTo(2.2, 10.6);
  finShape.lineTo(5.25, 2.5);
  finShape.lineTo(5.5, -0.5);
  finShape.closePath();
  const finParts: THREE.BufferGeometry[] = [];
  const liveryParts: THREE.BufferGeometry[] = [];
  const beaconParts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const f = new THREE.ExtrudeGeometry(finShape, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1, curveSegments: 1 });
    f.translate(0, 0, -0.17);
    f.rotateY((k * Math.PI) / 2);
    finParts.push(f);
    const le = beam(2.45, 10.05, 0, 5.2, 2.7, 0, 0.12);
    le.translate(0, 0, 0);
    // Offset the strip to both faces of the fin.
    const le2 = le.clone();
    le.translate(0, 0, 0.2);
    le2.translate(0, 0, -0.2);
    le.rotateY((k * Math.PI) / 2);
    le2.rotateY((k * Math.PI) / 2);
    liveryParts.push(le, le2);
    const bc = new THREE.SphereGeometry(0.22, 8, 6);
    bc.translate(5.45, -0.35, 0);
    bc.rotateY((k * Math.PI) / 2);
    beaconParts.push(bc);
  }
  // Escape tower spike + motor (dark/metal).
  const metalParts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    metalParts.push(beam(Math.cos(a) * 0.35, 40.6, Math.sin(a) * 0.35, Math.cos(a) * 0.12, 43.2, Math.sin(a) * 0.12, 0.08));
  }
  metalParts.push(lathe([[0.02, 43.1], [0.32, 43.2], [0.34, 44.6], [0.2, 45.2], [0.06, 46.4], [0.02, 46.6]], 10));
  // Vent pipes on the interstage (idle venting).
  metalParts.push(box(R + 0.12, 21.7, 0, 0.35, 0.35, 0.8));
  metalParts.push(box(-R - 0.12, 21.7, 0, 0.35, 0.35, 0.8));
  vehicle.add(cast(new THREE.Mesh(merge(metalParts), matMetal)));
  vehicle.add(cast(new THREE.Mesh(merge(finParts), matDark)));
  // Livery rings (interstage + skirt) glow at launch.
  liveryParts.push(new THREE.TorusGeometry(R + 0.03, 0.07, 6, segs).rotateX(Math.PI / 2).translate(0, 20.95, 0));
  liveryParts.push(new THREE.TorusGeometry(2.49, 0.07, 6, segs).rotateX(Math.PI / 2).translate(0, 22.48, 0));
  liveryParts.push(new THREE.TorusGeometry(R + 0.03, 0.08, 6, segs).rotateX(Math.PI / 2).translate(0, 3.32, 0));
  vehicle.add(new THREE.Mesh(merge(liveryParts), matLivery));
  const topBeacon = new THREE.SphereGeometry(0.2, 8, 6);
  topBeacon.translate(0, 46.7, 0);
  beaconParts.push(topBeacon);
  vehicle.add(new THREE.Mesh(merge(beaconParts), matBeacon));

  // Engine bells (dark inside, metal outside).
  {
    const bells: THREE.BufferGeometry[] = [];
    const place = (x: number, z: number, s: number): void => {
      const b = lathe(
        [
          [0.34 * s, 1.1],
          [0.42 * s, 0.85],
          [0.62 * s, 0.35],
          [0.86 * s, -0.25],
          [0.95 * s, -0.55],
        ],
        low ? 10 : 16,
      );
      b.translate(x, 0, z);
      bells.push(b);
    };
    place(0, 0, 1.05);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      place(Math.cos(a) * 1.55, Math.sin(a) * 1.55, 0.82);
    }
    vehicle.add(new THREE.Mesh(merge(bells), matBell));
  }

  // Flame (hidden until ignition).
  const flameMat = own(
    new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uCore: { value: new THREE.Color('#fff4dc').multiplyScalar(3.2) },
          uEdge: { value: new THREE.Color('#ffcf94').multiplyScalar(1.4) },
          uPower: { value: 0 },
          uTime: { value: 0 },
          uFogScale: fogScale,
        },
      ]),
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    }),
  );
  flameMat.uniforms.uFogScale = fogScale;
  const flameGeo = new THREE.CylinderGeometry(2.5, 0.35, 1, low ? 12 : 20, 6, true);
  flameGeo.translate(0, -0.5, 0);
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.y = -0.4;
  flame.visible = false;
  flame.renderOrder = 14;
  vehicle.add(flame);

  // Ignition glow on the pad (flat additive disc).
  const glowMat = own(
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#ffe3b0') }, uPower: { value: 0 } },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), glowMat);
  glow.position.y = 0.08;
  glow.visible = false;
  glow.renderOrder = 13;
  root.add(glow);

  // Smoke trail column.
  const sunW = new THREE.Vector3(0.9, 0.25, -0.3).normalize();
  const trailMat = own(
    new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTop: { value: 1 },
          uTopX: { value: 0 },
          uSpread: { value: 4 },
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uLit: { value: new THREE.Color('#fff0de') },
          uShade: { value: new THREE.Color('#b7a0aa') },
          uSunW: { value: sunW },
        },
      ]),
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    }),
  );
  trailMat.uniforms.uFogScale = fogScale;
  trailMat.uniforms.uSunW.value = sunW;
  const trail = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, low ? 10 : 18, low ? 16 : 32, true), trailMat);
  trail.frustumCulled = false;
  trail.visible = false;
  trail.renderOrder = 11;
  root.add(trail);

  // Steam / smoke puffs.
  const puffMat = own(makePuffMaterial(fogScale, sunW));
  const puffs = new PuffPool(Math.round(24 + 96 * quality.particles), puffMat);
  root.add(puffs.mesh);

  // ── Optional standalone complex: lattice umbilical tower + apron ──
  let arms: THREE.Mesh | null = null;
  if (opts.tower) {
    // The tower stands on the rocket's local −Z side so that, with local +X
    // (the pitch-over direction) pointing away from the viewers, it never
    // hides the rocket.
    const tz = -9;
    const half = 2.6;
    const top = 58;
    const lat: THREE.BufferGeometry[] = [];
    const legs: [number, number][] = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ];
    for (const [lx, lz] of legs) lat.push(box(lx, top / 2, tz + lz, 0.55, top, 0.55));
    const step = low ? 6 : 4;
    for (let y = 0; y < top - 0.1; y += step) {
      const y1 = Math.min(top, y + step);
      for (let i = 0; i < 4; i++) {
        const [ax, az] = legs[i];
        const [bx, bz] = legs[(i + 1) % 4];
        lat.push(beam(ax, y1, tz + az, bx, y1, tz + bz, 0.2));
        lat.push(beam(ax, y, tz + az, bx, y1, tz + bz, 0.14));
        if (!low) lat.push(beam(bx, y, tz + bz, ax, y1, tz + az, 0.14));
      }
    }
    // Hammerhead crane (jib over the rocket) + counterweight + mast.
    lat.push(box(0, top + 1.2, tz + 2, 1.6, 1.4, 14));
    lat.push(box(0, top + 0.2, tz - 3.5, 3, 2.4, 3));
    lat.push(box(0, top + 5, tz, 0.3, 8, 0.3));
    // Service platforms.
    for (const y of [12, 24, 36, 48]) lat.push(box(0, y, tz, 7.2, 0.3, 7.2));
    const latMesh = cast(new THREE.Mesh(merge(lat), matTower));
    root.add(latMesh);
    // Swing arms (pivot on the tower's rocket-side face; they swing away at ignition).
    const armGeo: THREE.BufferGeometry[] = [];
    for (const y of [16, 27, 38]) {
      armGeo.push(box(0, y + H, 2.1, 1.4, 0.9, 4.2));
      armGeo.push(box(0, y + H - 0.8, 4.0, 1.6, 1.6, 0.8));
    }
    arms = cast(new THREE.Mesh(merge(armGeo), matTower));
    arms.position.set(0, 0, tz + half);
    root.add(arms);
    // Concrete apron with the flame trench slot hinted by a dark band.
    const apron = new THREE.Mesh(new THREE.BoxGeometry(28, 3, 34), matMount);
    apron.position.set(0, -1.5, -4);
    apron.receiveShadow = true;
    root.add(apron);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(30, 0.1, 5), matDark);
    slot.position.set(0, 0.02, 0);
    root.add(slot);
  }

  // ── Runtime ──
  const cTeam = new THREE.Color();
  const liveryIdle = new THREE.Color(ENV.boneShade).multiplyScalar(0.55);
  let teamKey = '';
  let wasLaunching = false;
  let ventT = 0;
  let baseT = 0;
  let emitAcc = 0;
  let sunFound = false;
  let sunTries = 0;
  const wp = new THREE.Vector3();
  let seed = 1337;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const findSun = (): void => {
    if (sunFound || sunTries > 30) return;
    sunTries++;
    let top: THREE.Object3D = root;
    while (top.parent) top = top.parent;
    if (top === root) return;
    const sun = top.getObjectByName('sun') as THREE.DirectionalLight | undefined;
    if (sun && (sun as THREE.DirectionalLight).isDirectionalLight) {
      sunW.copy(sun.position).sub(sun.target.position);
      if (sunW.lengthSq() > 1e-6) {
        sunW.normalize();
        sunFound = true;
      }
    }
  };

  const idleVisual = (): void => {
    vehicle.position.set(0, H, 0);
    vehicle.rotation.set(0, 0, 0);
    flame.visible = false;
    glow.visible = false;
    trail.visible = false;
    if (arms) arms.rotation.y = 0;
    matLivery.color.copy(liveryIdle);
  };

  const update = (dt: number, launch: { team: Team; t: number } | null, time: number): void => {
    findSun();
    // Fog thinning with distance from the map center (horizon rockets stay readable).
    root.getWorldPosition(wp);
    const d = Math.hypot(wp.x, wp.z);
    fogScale.value = THREE.MathUtils.clamp(95 / Math.max(95, d), 0.18, 1);
    const windX = -0.9;
    const windZ = 0.25;
    const tt = time;

    if (!launch) {
      if (wasLaunching) {
        wasLaunching = false;
        puffs.clear();
        idleVisual();
      }
      // Warm beacon: short double-blink every 1.8 s.
      const ph = tt % 1.8;
      const on = ph < 0.12 || (ph > 0.26 && ph < 0.36) ? 3.2 : 0.35;
      matBeacon.color.copy(beaconBase).multiplyScalar(on);
      // LOX venting from the interstage + cold vapour rolling off the mount.
      ventT -= dt;
      if (ventT <= 0) {
        ventT = 0.45 + rnd() * 0.35;
        const side = rnd() < 0.5 ? 1 : -1;
        puffs.emit(side * (R + 0.4), H + 21.7, (rnd() - 0.5) * 0.4, side * (0.9 + rnd() * 0.6), 0.3 + rnd() * 0.3, (rnd() - 0.5) * 0.4, 3.2 + rnd() * 1.4, 0.7, 3.2 + rnd() * 1.5, 0.5, 0.9);
      }
      baseT -= dt;
      if (baseT <= 0) {
        baseT = 0.7 + rnd() * 0.6;
        // Cold vapour spills over the mount's lip and sinks along the pad.
        const a = rnd() * Math.PI * 2;
        puffs.emit(Math.cos(a) * 3.9, H - 0.2, Math.sin(a) * 3.9, Math.cos(a) * 0.7, -0.35, Math.sin(a) * 0.7, 4.5 + rnd() * 2, 1.2, 4.2, 0.3, 0.5);
      }
      puffs.update(dt, windX * 0.5, windZ * 0.5);
      return;
    }

    // ── Launch sequence ──
    const t = Math.max(0, launch.t);
    if (!wasLaunching) {
      wasLaunching = true;
      emitAcc = 0;
    }
    const tc = teamColors(launch.team);
    if (tc.emissive !== teamKey) {
      teamKey = tc.emissive;
      cTeam.set(teamKey);
    }
    const ign = THREE.MathUtils.smoothstep(t, 0.05, 1.2);
    const lift = Math.max(0, t - LIFTOFF_T);
    const y = 2.4 * Math.pow(lift, 2.4);
    const tilt = Math.min(0.32, Math.max(0, lift - 2.4) * 0.07);
    vehicle.position.set(y * Math.sin(tilt) * 0.55, H + y, 0);
    vehicle.rotation.set(0, 0, -tilt);
    // Beacons + livery in the winning team's color.
    const pulse = 0.75 + 0.25 * Math.sin(tt * 9);
    matBeacon.color.copy(cTeam).multiplyScalar(3.5 * pulse);
    matLivery.color.copy(liveryIdle).lerp(cTeam, ign).multiplyScalar(1 + ign * 1.8);
    // Swing arms retract.
    if (arms) arms.rotation.y = THREE.MathUtils.smoothstep(t, 0.2, 1.4) * 1.15;
    // Flame + pad glow.
    flame.visible = true;
    const thrust = THREE.MathUtils.smoothstep(t, 0.3, 1.6);
    const len = 4 + thrust * (16 + Math.min(14, lift * 3));
    flame.scale.set(0.55 + thrust * 0.45, len, 0.55 + thrust * 0.45);
    flameMat.uniforms.uPower.value = 0.35 + thrust * 0.95;
    flameMat.uniforms.uTime.value = tt;
    glow.visible = true;
    glowMat.uniforms.uPower.value = (0.4 + thrust * 1.4) * Math.exp(-Math.max(0, y - 6) * 0.03);
    // Smoke column from the pad to the tail.
    trail.visible = lift > 0.05;
    trailMat.uniforms.uTop.value = Math.max(1, H + y - 1);
    trailMat.uniforms.uTopX.value = vehicle.position.x;
    trailMat.uniforms.uSpread.value = 3 + Math.min(12, lift * 2.6);
    trailMat.uniforms.uTime.value = tt;
    trailMat.uniforms.uOpacity.value = Math.min(0.92, lift * 0.8);
    // Billowing steam: radial at the base during ignition, then along the climb.
    emitAcc += dt * (t < 3.2 ? 26 : 9) * (0.4 + quality.particles * 0.6);
    while (emitAcc >= 1) {
      emitAcc -= 1;
      const a = rnd() * Math.PI * 2;
      if (t < 3.2 || rnd() < 0.5) {
        const sp = 6 + rnd() * 7;
        puffs.emit(Math.cos(a) * 4.2, 1.0 + rnd() * 2.2, Math.sin(a) * 4.2, Math.cos(a) * sp, 1.2 + rnd() * 2.8, Math.sin(a) * sp, 5.5 + rnd() * 3, 3.2, 12 + rnd() * 7, 0.9, 0.6);
      } else {
        puffs.emit(vehicle.position.x + (rnd() - 0.5) * 2, H + y - 3 - rnd() * 3, (rnd() - 0.5) * 2, (rnd() - 0.5) * 2, -2, (rnd() - 0.5) * 2, 4.5 + rnd() * 2, 2.2, 7 + rnd() * 3, 0.7, 0.8);
      }
    }
    puffs.update(dt, windX, windZ);
  };

  const dispose = (): void => {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m !== puffs.mesh) m.geometry.dispose();
    });
    puffs.dispose();
    for (const m of owned) m.dispose();
    root.removeFromParent();
  };

  return { root, update, dispose };
}
