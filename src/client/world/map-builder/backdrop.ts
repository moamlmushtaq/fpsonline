// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — map builder: backdrop (beyond the playable space).
//
// Terrain skirt to the horizon, coast (no skirt toward the sun so the sea
// shows), or a cloud sea around a faceted mountain plinth; plus the shared
// animated water plane at def.waterY.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MapDef } from '../../../shared/maps/types';
import type { SurfaceTag } from '../../../shared/types';
import { TAG_COLOR } from '../../engine/materials';
import { ENV } from '../../engine/palette';
import { h2, vnoise2, vnoise3, type Shade, type V3 } from './geometry';
import { bucketFor, linearColor, lookFor, type Ctx } from './solids';

/** Optional named export of a decor module to control the default backdrop. */
export interface BackdropOptions {
  /** 'terrain' skirt to the horizon, 'coast' (no skirt toward the sun, sea visible), 'clouds' (mountain + cloud sea), 'none'. */
  kind?: 'terrain' | 'coast' | 'clouds' | 'none';
  /** Terrain skirt surface/color override. */
  tag?: SurfaceTag;
  color?: string;
  /** Render the default water plane at def.waterY (default true). */
  water?: boolean;
}

// ── Backdrop: skirt, coast, clouds, water ──────────────────────────────────

const WATER_VERT = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uOpacity;
varying vec3 vWorld;
#include <fog_pars_fragment>
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = vWorld.xz;
  // Two drifting wave layers → a stylized normal (calmer with distance so far
  // water does not alias into noise).
  float e = 0.35;
  vec2 q1 = p * 0.35 + vec2(uTime * 0.05, uTime * 0.03);
  vec2 q2 = p * 0.9 - vec2(uTime * 0.07, -uTime * 0.04);
  float hC = vn(q1) + vn(q2) * 0.5;
  float hX = vn(q1 + vec2(e, 0.0)) + vn(q2 + vec2(e, 0.0)) * 0.5;
  float hZ = vn(q1 + vec2(0.0, e)) + vn(q2 + vec2(0.0, e)) * 0.5;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  float calm = 1.0 / (1.0 + dist * 0.012);
  vec3 n = normalize(vec3((hC - hX) * 1.1 * calm, 1.0, (hC - hZ) * 1.1 * calm));
  vec3 v = toCam / max(dist, 1e-3);
  // Schlick Fresnel (water F0 ≈ 0.02): seen from above the sea shows its own
  // deep body color; it only turns into a sky mirror toward grazing angles.
  // (The old constant +0.12 sky term + pow3 Fresnel washed it out pale/white.)
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 r = reflect(-v, n);
  // Reflected sky: horizon haze → zenith by the reflected ray's elevation,
  // warmed toward the sun.
  vec3 sky = mix(uSkyHorizon, uSkyZenith, smoothstep(0.02, 0.7, r.y));
  float sd = max(dot(r, uSunDir), 0.0);
  sky += uSun * pow(sd, 6.0) * 0.35;
  vec3 body = mix(uDeep, uShallow, clamp(hC * 0.4 - 0.1, 0.0, 1.0));
  vec3 col = mix(body, sky, fres);
  // Sun glint: sharp, broken highlights (painterly sparkle streak) → blooms.
  float sparkle = step(0.55, vn(p * 3.0 + uTime * 0.6));
  col += uSun * (pow(sd, 240.0) * 9.0 * (0.25 + sparkle) + pow(sd, 28.0) * 0.1);
  gl_FragColor = vec4(col, mix(uOpacity, 1.0, fres));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function createWater(def: MapDef, y: number, extent: number): THREE.Mesh {
  const l = def.lighting;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        // Linear body colors: a deep, slightly desaturated sea under a lighter
        // wave-crest tone (both from the palette's water).
        uDeep: { value: new THREE.Color(ENV.water).multiplyScalar(0.3) },
        uShallow: { value: new THREE.Color(ENV.water).multiplyScalar(0.62) },
        uSkyHorizon: { value: new THREE.Color(l.skyHorizon).lerp(new THREE.Color(l.fogColor), 0.5) },
        uSkyZenith: { value: new THREE.Color(l.skyZenith) },
        uSun: { value: new THREE.Color(l.sunColor) },
        uSunDir: { value: new THREE.Vector3(l.sunDir.x, l.sunDir.y, l.sunDir.z).normalize() },
        uTime: { value: 0 },
        uOpacity: { value: 0.86 },
      },
    ]),
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const g = new THREE.PlaneGeometry(extent * 2, extent * 2, 1, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set((def.bounds.min.x + def.bounds.max.x) / 2, y, (def.bounds.min.z + def.bounds.max.z) / 2);
  m.renderOrder = 2;
  m.name = 'water';
  m.receiveShadow = false;
  return m;
}

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vWorld;
#include <fog_pars_fragment>
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += vn(p) * a; p *= 2.07; a *= 0.5; } return s; }
void main() {
  vec2 p = vWorld.xz * 0.012 + vec2(uTime * 0.004, 0.0);
  float n = fbm(p + fbm(p * 0.7) * 0.8);
  float nl = fbm(p + uSunDir.xz * 0.05 + fbm(p * 0.7) * 0.8);
  float lit = clamp(0.5 + (n - nl) * 6.0, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, lit * 0.8 + n * 0.4);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function createCloudSea(def: MapDef, y: number): THREE.Mesh {
  const l = def.lighting;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uLit: { value: new THREE.Color(l.skyHorizon).lerp(new THREE.Color(l.sunGlow), 0.4) },
        uShade: { value: new THREE.Color(l.fogColor).lerp(new THREE.Color(l.skyZenith), 0.35) },
        uSunDir: { value: new THREE.Vector3(l.sunDir.x, l.sunDir.y, l.sunDir.z).normalize() },
        uTime: { value: 0 },
      },
    ]),
    vertexShader: WATER_VERT,
    fragmentShader: CLOUD_FRAG,
    fog: true,
  });
  const g = new THREE.PlaneGeometry(4000, 4000, 1, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.y = y;
  m.name = 'cloudSea';
  return m;
}

export function dominantGround(def: MapDef): { tag: SurfaceTag; y: number } {
  const area = new Map<SurfaceTag, number>();
  let y = 0;
  let best = 0;
  for (const s of def.solids) {
    if (lookFor(s).shape !== 'ground') continue;
    const a = (s.max.x - s.min.x) * (s.max.z - s.min.z);
    area.set(s.tag, (area.get(s.tag) ?? 0) + a);
    if (a > best) {
      best = a;
      y = s.max.y;
    }
  }
  let tag: SurfaceTag = 'sand';
  let max = 0;
  for (const [t, a] of area) if (a > max) ((max = a), (tag = t));
  return { tag, y };
}

export function buildBackdrop(ctx: Ctx, def: MapDef, opts: BackdropOptions, scene: THREE.Scene, tickers: ((dt: number) => void)[]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const mood = def.lighting.mood;
  const kind = opts.kind ?? (mood === 'dusk' ? 'clouds' : def.waterY !== undefined && mood === 'sunset' ? 'coast' : 'terrain');
  const g = dominantGround(def);
  const tag = opts.tag ?? (kind === 'clouds' ? 'rock' : g.tag === 'concrete' || g.tag === 'tile' ? 'sand' : g.tag);
  const color = linearColor(opts.color ?? TAG_COLOR[tag]);
  // Solids' XZ footprint (the skirt starts where the map ends).
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of def.solids) {
    x0 = Math.min(x0, s.min.x);
    x1 = Math.max(x1, s.max.x);
    z0 = Math.min(z0, s.min.z);
    z1 = Math.max(z1, s.max.z);
  }
  const F = 1600;
  const y = g.y - 0.03;
  const b = bucketFor(ctx, tag, 'ground', false);
  const shade: Shade = (x, _y, z) => {
    const n = vnoise2(x * 0.03, z * 0.03) - 0.5;
    const d = Math.max(x0 - x, x - x1, z0 - z, z - z1, 0);
    // Rolling tonal variation that calms down with distance (fog takes over).
    const k = 0.93 + n * 0.16 * Math.exp(-d * 0.01);
    return [color[0] * k, color[1] * k, color[2] * k];
  };
  const sun = def.lighting.sunDir;
  const slab = (ax0: number, az0: number, ax1: number, az1: number): void => {
    // Subdivide near the map for tonal variation, coarse far away.
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const u0 = ax0 + ((ax1 - ax0) * i) / steps, u1 = ax0 + ((ax1 - ax0) * (i + 1)) / steps;
        const v0 = az0 + ((az1 - az0) * j) / steps, v1 = az0 + ((az1 - az0) * (j + 1)) / steps;
        b.quad([u0, y, v0], [u1, y, v0], [u1, y, v1], [u0, y, v1], [0, 1, 0], shade);
      }
    }
  };
  if (kind === 'terrain' || kind === 'coast') {
    const skipEast = kind === 'coast' && Math.abs(sun.x) >= Math.abs(sun.z) && sun.x > 0;
    const skipWest = kind === 'coast' && Math.abs(sun.x) >= Math.abs(sun.z) && sun.x < 0;
    const skipSouth = kind === 'coast' && Math.abs(sun.z) > Math.abs(sun.x) && sun.z > 0;
    const skipNorth = kind === 'coast' && Math.abs(sun.z) > Math.abs(sun.x) && sun.z < 0;
    const ex0 = skipWest ? x0 : -F;
    const ex1 = skipEast ? x1 : F;
    if (!skipWest) slab(-F, -F, x0, F);
    if (!skipEast) slab(x1, -F, F, F);
    if (!skipNorth) slab(Math.max(ex0, x0), -F, Math.min(ex1, x1), z0);
    if (!skipSouth) slab(Math.max(ex0, x0), z1, Math.min(ex1, x1), F);
  } else if (kind === 'clouds') {
    // Mountain plinth: a faceted rock frustum under the map, down to the cloud sea.
    const depth = 70;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
    const rockShade: Shade = (x, yy, z, nx, ny) => {
      const n = vnoise3(x * 0.08, yy * 0.08, z * 0.08);
      const snow = ny > 0.55 ? 1.25 : 1;
      const k = (0.75 + n * 0.35) * THREE.MathUtils.lerp(0.7, 1, THREE.MathUtils.smoothstep(yy, y - depth, y)) * snow;
      return [color[0] * k, color[1] * k, color[2] * k];
    };
    const rb = bucketFor(ctx, 'rock', 'cliff', false);
    const ring = 24;
    const pts = (level: number, spread: number, yy: number): V3[] => {
      const arr: V3[] = [];
      for (let i = 0; i < ring; i++) {
        const a = (i / ring) * Math.PI * 2;
        const jitter = 1 + (h2(i, level) - 0.5) * 0.18;
        const r = spread * jitter;
        // Superellipse around the rectangular footprint.
        const cxv = Math.cos(a), czv = Math.sin(a);
        const k = 1 / Math.pow(Math.pow(Math.abs(cxv), 4) + Math.pow(Math.abs(czv), 4), 0.25);
        arr.push([cx + cxv * k * (hx + 1) * r, yy, cz + czv * k * (hz + 1) * r]);
      }
      return arr;
    };
    const levels = [pts(0, 1.0, y + 0.02), pts(1, 1.18, y - 14), pts(2, 1.5, y - 38), pts(3, 2.1, y - depth)];
    for (let l = 0; l < levels.length - 1; l++) {
      for (let i = 0; i < ring; i++) {
        const a = levels[l][i], bb = levels[l][(i + 1) % ring], c = levels[l + 1][(i + 1) % ring], d = levels[l + 1][i];
        const mid: V3 = [(a[0] + c[0]) / 2 - cx, 0.3, (a[2] + c[2]) / 2 - cz];
        rb.tri(a, bb, c, mid, rockShade);
        rb.tri(a, c, d, mid, rockShade);
      }
    }
    const sea = createCloudSea(def, y - depth + 12);
    const u = (sea.material as THREE.ShaderMaterial).uniforms;
    tickers.push((dt) => (u.uTime.value += dt));
    out.push(sea);
  }
  if (def.waterY !== undefined && opts.water !== false) {
    const w = createWater(def, def.waterY, kind === 'coast' ? F : Math.max(x1 - x0, z1 - z0) * 0.75);
    const u = (w.material as THREE.ShaderMaterial).uniforms;
    tickers.push((dt) => (u.uTime.value += dt));
    out.push(w);
  }
  for (const o of out) scene.add(o);
  return out;
}
