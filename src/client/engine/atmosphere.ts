// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — atmosphere: painted sky dome, sun + fill lights, aerial fog,
// stars, GPU weather particles and fake volumetric light shafts.
//
// Sky: a camera-centred dome drawn first (depth test off) with a gradient
// zenith→horizon, sun disc (HDR, blooms) + halo, painterly cloud streaks from a
// warped fbm on a perspective cloud plane, a horizon haze band that equals the
// fog color (so geometry dissolves seamlessly into the sky), and hash stars
// that twinkle in with `starAmount`.
//
// Sun shadows: an orthographic ~70 m box that follows the view, snapped to
// shadow-map texels in light space so edges never shimmer while moving.
//
// Weather: ONE Points draw call; particles live in a box that wraps around the
// camera entirely in the vertex shader (zero CPU work per frame).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { Atmosphere, QualitySettings } from '../contracts';
import type { MapLighting } from '../../shared/maps/types';
import type { Vec3 } from '../../shared/types';
import { ENV } from './palette';

const SHADOW_HALF = 35;
/** Renderer-side light calibration (map data stays in artist units). */
const SUN_BOOST = 1.4;
const HEMI_BOOST = 1.15;

// ── Sky shader ──────────────────────────────────────────────────────────────

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSunGlow;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uStars;
uniform float uClouds;
varying vec3 vDir;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    s += vnoise(p) * a;
    p = p * 2.03 + vec2(17.1, 3.7);
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float sd = max(dot(d, uSunDir), 0.0);

  // Base gradient: horizon → zenith with a painterly (non-linear) falloff.
  float t = pow(clamp(h, 0.0, 1.0), 0.5);
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.85, t));
  // Warm the horizon toward the sun side (sunset/golden light scattering).
  col = mix(col, uSunGlow, pow(sd, 3.0) * 0.45 * (1.0 - smoothstep(0.0, 0.5, h)));

  // Painterly cloud streaks on a perspective plane.
  if (h > 0.0 && uClouds > 0.0) {
    vec2 p = d.xz / (h + 0.14) * 0.42;
    p += vec2(uTime * 0.006, uTime * 0.0025);
    vec2 q = vec2(p.x * 0.45, p.y * 1.5);
    float warp = fbm(q * 0.6 + 3.1);
    float n = fbm(q + warp * 1.1);
    float c = smoothstep(0.5, 0.74, n) * uClouds;
    c *= smoothstep(0.015, 0.16, h) * (1.0 - smoothstep(0.5, 0.95, h) * 0.8);
    // Pseudo lighting: clouds catch the low sun on their sun-facing side.
    float lit = clamp(0.35 + pow(sd, 2.0) * 0.9 + (n - 0.6) * 1.4, 0.0, 1.2);
    vec3 shade = mix(uZenith, uHorizon, 0.55) * 0.92;
    vec3 bright = mix(uHorizon, uSunGlow, 0.65) * 1.08;
    vec3 cloud = mix(shade, bright, lit);
    col = mix(col, cloud, c * 0.85);
  }

  // Horizon haze band = fog color, so fogged geometry meets the sky seamlessly.
  float band = 1.0 - smoothstep(0.0, 0.11, abs(h - 0.005));
  col = mix(col, uFog, band * 0.9);
  if (h < 0.0) col = mix(uFog, uFog * 0.92, smoothstep(0.0, -0.4, h));

  // Sun halo + HDR disc (blooms).
  col += uSunGlow * (pow(sd, 10.0) * 0.35 + pow(sd, 90.0) * 0.6);
  float disc = smoothstep(0.99935, 0.99965, sd);
  col += uSunColor * disc * 5.0 * smoothstep(-0.02, 0.02, h);

  // Stars (twinkling hash field) fade in with uStars.
  if (uStars > 0.001 && h > 0.0) {
    vec3 sp = d * 180.0;
    vec3 id = floor(sp);
    float r = hash13(id);
    if (r > 0.985) {
      vec3 f = fract(sp) - 0.5;
      vec3 off = vec3(hash13(id + 1.7), hash13(id + 5.3), hash13(id + 9.1)) - 0.5;
      float dist = length(f - off * 0.5);
      float star = smoothstep(0.16, 0.0, dist) * (r - 0.985) / 0.015;
      float tw = 0.65 + 0.35 * sin(uTime * (1.3 + r * 5.0) + r * 91.0);
      float vis = smoothstep(0.04, 0.3, h) * (1.0 - pow(sd, 6.0));
      col += vec3(1.0, 0.96, 0.9) * star * tw * vis * uStars * 2.2;
    }
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ── Weather shader ─────────────────────────────────────────────────────────

const WEATHER_VERT = /* glsl */ `
attribute float aSeed;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uTime;
uniform float uSize;
uniform float uScale;
uniform float uSwirl;
varying float vAlpha;
varying float vSeed;
void main() {
  vec3 p = position * uBox + uVel * uTime * (0.75 + aSeed * 0.5);
  float ph = aSeed * 6.2831 + uTime * (0.6 + aSeed);
  p += vec3(sin(ph), sin(ph * 0.7 + 1.3) * 0.5, cos(ph * 1.1)) * uSwirl;
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.1);
  gl_PointSize = clamp(uSize * (0.6 + aSeed * 0.8) * uScale / dist, 1.0, 48.0);
  vec3 e = abs(rel) / (uBox * 0.5);
  float edge = 1.0 - smoothstep(0.7, 1.0, max(max(e.x, e.y), e.z));
  vAlpha = edge * smoothstep(0.4, 1.6, dist);
  vSeed = aSeed;
}`;

const WEATHER_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uTwinkle;
varying float vAlpha;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  float tw = mix(1.0, 0.45 + 0.55 * sin(uTime * (2.0 + vSeed * 3.0) + vSeed * 40.0), uTwinkle);
  float alpha = a * vAlpha * uOpacity * tw;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface WeatherPreset {
  count: number;
  box: [number, number, number];
  vel: [number, number, number];
  size: number;
  swirl: number;
  opacity: number;
  additive: boolean;
  twinkle: number;
  color: (l: MapLighting) => THREE.Color;
}

const WEATHER: Record<Exclude<MapLighting['weather'], 'none'>, WeatherPreset> = {
  dust: {
    count: 700,
    box: [46, 18, 46],
    vel: [0.35, 0.05, 0.22],
    size: 0.05,
    swirl: 0.6,
    opacity: 0.55,
    additive: true,
    twinkle: 0.6,
    color: (l) => new THREE.Color(l.sunGlow).multiplyScalar(0.9),
  },
  snow: {
    count: 2200,
    box: [40, 22, 40],
    vel: [2.4, -2.1, 0.8],
    size: 0.06,
    swirl: 0.8,
    opacity: 0.85,
    additive: false,
    twinkle: 0,
    color: () => new THREE.Color(ENV.snow).multiplyScalar(1.1),
  },
  spores: {
    count: 420,
    box: [40, 14, 40],
    vel: [0.12, 0.16, 0.08],
    size: 0.07,
    swirl: 0.9,
    opacity: 0.9,
    additive: true,
    twinkle: 0.8,
    color: () => new THREE.Color(ENV.glowChartreuse).lerp(new THREE.Color(ENV.glowGold), 0.35).multiplyScalar(2.4),
  },
};

// ── Implementation ─────────────────────────────────────────────────────────

class AtmosphereImpl implements Atmosphere {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** Soft warm bounce from the side opposite the sun (fake GI, no shadows). */
  readonly fill: THREE.DirectionalLight;
  readonly sky: THREE.Mesh;
  readonly fog: THREE.FogExp2;
  private weather: THREE.Points | null = null;
  private weatherPreset: WeatherPreset | null = null;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly sunDir = new THREE.Vector3();
  private readonly lx = new THREE.Vector3();
  private readonly ly = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private time = 0;
  private quality: QualitySettings;

  constructor(private readonly scene: THREE.Scene, private readonly lighting: MapLighting, quality: QualitySettings) {
    this.quality = quality;
    const l = lighting;
    this.sunDir.set(l.sunDir.x, l.sunDir.y, l.sunDir.z).normalize();
    this.lx.crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    if (this.lx.lengthSq() < 1e-6) this.lx.set(1, 0, 0);
    this.ly.crossVectors(this.sunDir, this.lx).normalize();

    // Fog = aerial perspective; its color is the sky's horizon band.
    this.fog = new THREE.FogExp2(new THREE.Color(l.fogColor).getHex(), l.fogDensity);
    scene.fog = this.fog;
    scene.background = new THREE.Color(l.fogColor);

    // Sun.
    // Stylized balance: a strong warm key and a cooler, dimmer sky fill give the
    // warm-light / cool-shadow split of a painted golden-hour frame.
    this.sun = new THREE.DirectionalLight(new THREE.Color(l.sunColor), l.sunIntensity * SUN_BOOST);
    this.sun.name = 'sun';
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_HALF;
    sc.right = SHADOW_HALF;
    sc.top = SHADOW_HALF;
    sc.bottom = -SHADOW_HALF;
    sc.near = 1;
    sc.far = 320;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Hemisphere fill (sky/ground bounce). Slightly boosted: painterly shadows
    // are luminous, never black (the grading pass tints them cool-violet).
    // Sky fill leans toward the zenith color and gets a little extra chroma so
    // shadows read as luminous cool color rather than grey.
    const skyFill = new THREE.Color(l.hemiSky).lerp(new THREE.Color(l.skyZenith), 0.45);
    const hsl = { h: 0, s: 0, l: 0 };
    skyFill.getHSL(hsl);
    skyFill.setHSL(hsl.h, Math.min(1, hsl.s * 1.35), hsl.l);
    this.hemi = new THREE.HemisphereLight(skyFill, new THREE.Color(l.hemiGround), l.hemiIntensity * HEMI_BOOST);
    scene.add(this.hemi);

    this.fill = new THREE.DirectionalLight(new THREE.Color(l.hemiGround).lerp(new THREE.Color(l.sunColor), 0.35), l.sunIntensity * 0.16);
    this.fill.position.set(-l.sunDir.x, 0.35, -l.sunDir.z).normalize().multiplyScalar(100);
    scene.add(this.fill);

    // Sky dome (drawn first, depth test off → radius is irrelevant).
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color(l.skyZenith) },
        uHorizon: { value: new THREE.Color(l.skyHorizon) },
        uFog: { value: new THREE.Color(l.fogColor) },
        uSunGlow: { value: new THREE.Color(l.sunGlow) },
        uSunColor: { value: new THREE.Color(l.sunColor).lerp(new THREE.Color('#fff6e0'), 0.5) },
        uSunDir: { value: this.sunDir.clone() },
        uTime: { value: 0 },
        uStars: { value: 0 },
        uClouds: { value: l.mood === 'dusk' ? 0.75 : 1 },
      },
      defines: { OCTAVES: quality.preset === 'low' ? 3 : 4 },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.name = 'sky';
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.setQuality(quality);
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    const cast = q.shadows !== 'off';
    this.sun.castShadow = cast;
    if (cast && this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const oct = q.preset === 'low' ? 3 : 4;
    if (this.skyMat.defines.OCTAVES !== oct) {
      this.skyMat.defines.OCTAVES = oct;
      this.skyMat.needsUpdate = true;
    }
    this.buildWeather();
  }

  private buildWeather(): void {
    if (this.weather) {
      this.scene.remove(this.weather);
      this.weather.geometry.dispose();
      (this.weather.material as THREE.Material).dispose();
      this.weather = null;
    }
    const kind = this.lighting.weather;
    if (kind === 'none') return;
    const p = WEATHER[kind];
    this.weatherPreset = p;
    const count = Math.max(16, Math.round(p.count * this.quality.particles));
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    let s = 1234567;
    const rnd = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rnd();
      pos[i * 3 + 1] = rnd();
      pos[i * 3 + 2] = rnd();
      seed[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(...p.box) },
        uVel: { value: new THREE.Vector3(...p.vel) },
        uTime: { value: 0 },
        uSize: { value: p.size },
        uScale: { value: 600 },
        uSwirl: { value: p.swirl },
        uColor: { value: p.color(this.lighting) },
        uOpacity: { value: p.opacity },
        uTwinkle: { value: p.twinkle },
      },
      vertexShader: WEATHER_VERT,
      fragmentShader: WEATHER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: p.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.weather = new THREE.Points(g, m);
    this.weather.name = `weather.${kind}`;
    this.weather.frustumCulled = false;
    this.weather.renderOrder = 10;
    this.scene.add(this.weather);
  }

  update(dt: number, camera: THREE.Camera, starAmount: number): void {
    this.time += dt;
    const cam = camera.position;
    this.sky.position.copy(cam);
    const su = this.skyMat.uniforms;
    su.uTime.value = this.time;
    su.uStars.value = THREE.MathUtils.clamp(starAmount, 0, 1);

    // Shadow frustum: centred ahead of the view, snapped to texels in light space.
    camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() > 1e-6) this.fwd.normalize();
    const c = this.tmp.copy(cam).addScaledVector(this.fwd, SHADOW_HALF * 0.45);
    const texel = (SHADOW_HALF * 2) / Math.max(256, this.sun.shadow.mapSize.x);
    const cx = Math.round(c.dot(this.lx) / texel) * texel;
    const cy = Math.round(c.dot(this.ly) / texel) * texel;
    const cz = c.dot(this.sunDir);
    const t = this.sun.target.position;
    t.set(0, 0, 0).addScaledVector(this.lx, cx).addScaledVector(this.ly, cy).addScaledVector(this.sunDir, cz);
    this.sun.position.copy(t).addScaledVector(this.sunDir, 150);
    this.sun.target.updateMatrixWorld();

    if (this.weather && this.weatherPreset) {
      const u = (this.weather.material as THREE.ShaderMaterial).uniforms;
      u.uCam.value.copy(cam);
      u.uTime.value = this.time;
      const persp = camera as THREE.PerspectiveCamera;
      if (persp.isPerspectiveCamera) {
        // Pixels per world unit at distance 1 (for size attenuation).
        const h = typeof window !== 'undefined' ? window.innerHeight * Math.min(2, window.devicePixelRatio || 1) : 720;
        u.uScale.value = (h * 0.5) / Math.tan(THREE.MathUtils.degToRad(persp.fov) * 0.5);
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.sun, this.sun.target, this.hemi, this.fill, this.sky);
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    this.hemi.dispose();
    this.fill.dispose();
    this.sky.geometry.dispose();
    this.skyMat.dispose();
    if (this.weather) {
      this.scene.remove(this.weather);
      this.weather.geometry.dispose();
      (this.weather.material as THREE.Material).dispose();
    }
    if (this.scene.fog === this.fog) this.scene.fog = null;
  }
}

export type AtmosphereView = Atmosphere & {
  readonly hemi: THREE.HemisphereLight;
  readonly fill: THREE.DirectionalLight;
  readonly sky: THREE.Mesh;
  readonly fog: THREE.FogExp2;
};

export function createAtmosphere(scene: THREE.Scene, lighting: MapLighting, quality: QualitySettings): AtmosphereView {
  return new AtmosphereImpl(scene, lighting, quality);
}

// ── Light shafts ───────────────────────────────────────────────────────────

const SHAFT_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vT;
varying float vAng;
varying float vCam;
varying float vFogDepth;
uniform float uLength;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  vCam = length(vV);
  vT = 0.5 - position.y / uLength;
  vAng = atan(position.x, position.z);
  vec4 mv = viewMatrix * wp;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const SHAFT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;
uniform float fogDensity;
varying vec3 vN;
varying vec3 vV;
varying float vT;
varying float vAng;
varying float vCam;
varying float vFogDepth;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float edge = pow(facing, 1.8);
  float along = smoothstep(0.0, 0.15, vT) * (1.0 - smoothstep(0.45, 1.0, vT));
  float streak = 0.7 + 0.3 * sin(vAng * 7.0 + uTime * 0.35) * sin(vAng * 17.0 - uTime * 0.21 + vT * 3.0);
  float near = smoothstep(0.8, 5.0, vCam);
  float fogF = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  float a = edge * along * streak * near * fogF * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const MOTE_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uLength;
uniform float uRadius;
uniform float uScale;
varying float vA;
void main() {
  float t = fract(position.y + uTime * 0.02 * (0.5 + aSeed));
  float y = (0.5 - t) * uLength;
  float r = mix(uRadius * 0.55, uRadius, t) * position.x;
  float ang = position.z * 6.2831 + uTime * 0.1 * (aSeed - 0.5);
  vec3 p = vec3(cos(ang) * r, y, sin(ang) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.035 * uScale / max(-mv.z, 0.2), 1.0, 24.0);
  vA = sin(t * 3.14159) * (0.5 + 0.5 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 30.0));
}`;

const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vA;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface LightShaftOptions {
  /** Top of the shaft (where light enters, e.g. a hole in a roof). */
  pos: Vec3;
  /** Direction the light travels (usually −sunDir). */
  dir: Vec3;
  length: number;
  /** Radius at the bottom (the top is ~55%). */
  radius: number;
  color?: string;
  /** Overall brightness multiplier (default 1). */
  intensity?: number;
}

/**
 * Fake volumetric light shaft: an additive, soft-edged open cone with slowly
 * drifting streaks plus a few dust motes. Only place these when
 * `quality.lightShafts` is true. The returned object has an `update(dt)` in
 * `userData.update` (call it from decor update, or let MapView do it: the map
 * builder ticks every object tagged with `userData.halcyonTick`).
 */
export function createLightShaft(opts: LightShaftOptions): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'lightShaft';
  const color = new THREE.Color(opts.color ?? ENV.glowGold).multiplyScalar(0.55 * (opts.intensity ?? 1));
  const len = Math.max(0.5, opts.length);
  const rad = Math.max(0.1, opts.radius);
  const cone = new THREE.CylinderGeometry(rad * 0.55, rad, len, 20, 1, true);
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uTime: { value: 0 },
      uIntensity: { value: 0.32 },
      uLength: { value: len },
      fogDensity: { value: 0 },
    },
    vertexShader: SHAFT_VERT,
    fragmentShader: SHAFT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(cone, shaftMat);
  mesh.renderOrder = 20;
  group.add(mesh);

  const n = 36;
  const mp = new Float32Array(n * 3);
  const ms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    mp[i * 3] = Math.sqrt(h - Math.floor(h));
    mp[i * 3 + 1] = (i * 0.618) % 1;
    mp[i * 3 + 2] = ((i * 0.377) % 1) + 0.1;
    ms[i] = (i * 0.731) % 1;
  }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 1));
  const moteMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone().multiplyScalar(2.2) },
      uTime: { value: 0 },
      uLength: { value: len },
      uRadius: { value: rad },
      uScale: { value: 700 },
    },
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const motes = new THREE.Points(mg, moteMat);
  motes.frustumCulled = false;
  motes.renderOrder = 21;
  group.add(motes);

  // Orient: local −Y (cone axis, top at +len/2) → dir; place top at pos.
  const dir = new THREE.Vector3(opts.dir.x, opts.dir.y, opts.dir.z).normalize();
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  group.position.set(opts.pos.x, opts.pos.y, opts.pos.z).addScaledVector(dir, len / 2);

  let t = Math.random() * 100;
  const update = (dt: number, scene?: THREE.Scene): void => {
    t += dt;
    shaftMat.uniforms.uTime.value = t;
    moteMat.uniforms.uTime.value = t;
    const fog = scene?.fog as THREE.FogExp2 | undefined;
    if (fog && 'density' in fog) shaftMat.uniforms.fogDensity.value = fog.density;
  };
  group.userData.update = update;
  group.userData.halcyonTick = update;
  group.userData.dispose = (): void => {
    cone.dispose();
    shaftMat.dispose();
    mg.dispose();
    moteMat.dispose();
  };
  return group;
}
