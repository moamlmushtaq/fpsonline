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
// Aerial perspective: exponential fog whose color leans toward the sun glow
// when looking toward the sun (global fog-chunk patch, see installSunFog).
//
// Sun shadows: an orthographic 68–80 m box that follows the view, snapped to
// shadow-map texels in light space so edges never shimmer while moving; PCF
// with a per-preset kernel radius (soft, long golden-hour penumbrae) and a
// fade toward the box edge so the shadow range never ends in a hard line.
//
// Weather: ONE Points draw call; particles live in a box that wraps around the
// camera entirely in the vertex shader (zero CPU work per frame).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { Atmosphere, QualitySettings } from '../contracts';
import type { MapLighting } from '../../shared/maps/types';
import type { Vec3 } from '../../shared/types';
import { ENV } from './palette';

/** Half-size (m) of the sun's shadow box; texel = 2·half / mapSize. */
const SHADOW_HALF: Record<QualitySettings['shadows'], number> = { off: 35, low: 34, high: 40 };
/** PCF kernel radius in texels → soft, painterly penumbrae (sharper on medium's coarser map). */
const SHADOW_RADIUS: Record<QualitySettings['shadows'], number> = { off: 1, low: 1.8, high: 2.2 };
/** Renderer-side light calibration (map data stays in artist units). */
const SUN_BOOST = 1.4;
const HEMI_BOOST = 1.3;
/**
 * Extra sky/bounce fill while the sun casts shadows (medium/high). Without
 * shadows (low) every surface is sunlit; with them, cast-shadow areas receive
 * ONLY the hemisphere light, which at the map's 5:1 sun:sky ratio left them
 * near black after ACES' toe — the grading then had to lift them to a flat
 * blue-grey ("milky"). Luminous, local-color shadows come from light, not from
 * a lift: the sky fill is raised to at least this fraction of the sun (≈2× on
 * Gantry/Pastel, a touch on Observatory, which is already sky-lit), putting
 * shaded sand at ~⅓ of its sunlit value (painterly golden hour). Free.
 */
const SHADOW_FILL_RATIO = 0.36;

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
uniform vec3 uFogSun;
uniform float uFogSunK;
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

  // Horizon haze band = fog color (sun-tinted exactly like the geometry fog,
  // see installSunFog), so fogged geometry meets the sky seamlessly.
  vec3 fogC = mix(uFog, uFogSun, uFogSunK * sd * sd * sd);
  float band = 1.0 - smoothstep(0.0, 0.11, abs(h - 0.005));
  col = mix(col, fogC, band * 0.9);
  if (h < 0.0) col = mix(fogC, fogC * 0.92, smoothstep(0.0, -0.4, h));

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

// ── Aerial perspective: sun-tinted fog + soft shadow edges (chunk patches) ─
//
// three's fog is a single color. A low golden sun scatters warm light into the
// haze on its side of the sky, so the fog color here leans toward the sun glow
// with the view direction's alignment to the sun (cubed → a soft lobe).
// Implemented once, globally, by patching the fog shader chunks: every built-in
// material (and ShaderMaterials that merge UniformsLib.fog after this runs)
// shares two uniforms backed by the same Float32Arrays (UniformsUtils.clone
// keeps typed arrays by reference), so updating them is free. Scenes opt in via
// `scene.userData.fogSun`; the Renderer writes the arrays before each render
// and zeroes the strength for scenes without it.
//
// The same pass fades directional shadows out toward the shadow frustum edge so
// the camera-following shadow box never shows a hard line.

export interface SceneFogSun {
  /** Unit vector toward the sun (world). */
  dir: THREE.Vector3;
  color: THREE.Color;
  /** 0..1 blend toward `color` when looking straight at the sun. */
  strength: number;
}

const FOG_SUN_STRENGTH = 0.7;
const FOG_SUN_DIR = new Float32Array(4);
const FOG_SUN_COLOR = new Float32Array(3);
let sunFogInstalled = false;

function patchChunk(name: string, find: string | RegExp, replace: string): boolean {
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  const src = chunks[name];
  const found = typeof src === 'string' && (typeof find === 'string' ? src.includes(find) : find.test(src));
  if (!found) {
    console.warn(`[atmosphere] shader chunk '${name}' not patched (three.js changed?)`);
    return false;
  }
  chunks[name] = src.replace(find, replace);
  return true;
}

/** Installs the sun-fog + shadow-edge chunk patches (idempotent). */
export function installSunFog(): void {
  if (sunFogInstalled) return;
  sunFogInstalled = true;
  const ok =
    patchChunk('fog_pars_vertex', 'varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogView;') &&
    patchChunk('fog_vertex', 'vFogDepth = - mvPosition.z;', 'vFogDepth = - mvPosition.z;\n\tvFogView = mvPosition.xyz;') &&
    patchChunk('fog_pars_fragment', 'varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogView;\n\tuniform vec4 fogSunDir;\n\tuniform vec3 fogSunColor;') &&
    patchChunk(
      'fog_fragment',
      'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
      `vec3 hfFogColor = fogColor;
	if ( fogSunDir.w > 0.0 ) {
		vec3 hfSunV = ( viewMatrix * vec4( fogSunDir.xyz, 0.0 ) ).xyz;
		float hfSa = max( dot( normalize( vFogView ), hfSunV ), 0.0 );
		hfFogColor = mix( fogColor, fogSunColor, fogSunDir.w * hfSa * hfSa * hfSa );
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, hfFogColor, fogFactor );`,
    );
  if (ok) {
    const u = { fogSunDir: { value: FOG_SUN_DIR }, fogSunColor: { value: FOG_SUN_COLOR } };
    Object.assign(THREE.UniformsLib.fog, u);
    const lib = THREE.ShaderLib as unknown as Record<string, { uniforms?: Record<string, THREE.IUniform> }>;
    for (const k of Object.keys(lib)) {
      const un = lib[k].uniforms;
      if (un && 'fogColor' in un) Object.assign(un, u);
    }
  }
  // Smooth PCF: three's PCF takes 17 POINT samples spread over ±radius texels,
  // which leaves visible stair-steps along every shadow edge (worst on medium's
  // 1024 map and on surfaces at grazing angles). Five BILINEAR taps on a
  // rotated grid (20 fetches, ≈ the same cost) give a smooth, stair-free,
  // radius-controlled painterly penumbra. (One-line macro: no continuations.)
  patchChunk(
    'shadowmap_pars_fragment',
    /#if defined\( SHADOWMAP_TYPE_PCF \)\s*vec2 texelSize = vec2\( 1\.0 \) \/ shadowMapSize;[\s\S]*?\* \( 1\.0 \/ 17\.0 \);/,
    `#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			#define HF_BILIN( P ) { vec2 hfUv = ( P ); vec2 hfF = fract( hfUv * shadowMapSize + 0.5 ); hfUv -= hfF * texelSize; shadow += mix( mix( texture2DCompare( shadowMap, hfUv, shadowCoord.z ), texture2DCompare( shadowMap, hfUv + vec2( texelSize.x, 0.0 ), shadowCoord.z ), hfF.x ), mix( texture2DCompare( shadowMap, hfUv + vec2( 0.0, texelSize.y ), shadowCoord.z ), texture2DCompare( shadowMap, hfUv + texelSize, shadowCoord.z ), hfF.x ), hfF.y ); }
			vec2 hfR = texelSize * shadowRadius;
			shadow = 0.0;
			HF_BILIN( shadowCoord.xy )
			HF_BILIN( shadowCoord.xy + vec2( -0.5, -0.9 ) * hfR )
			HF_BILIN( shadowCoord.xy + vec2( 0.9, -0.5 ) * hfR )
			HF_BILIN( shadowCoord.xy + vec2( 0.5, 0.9 ) * hfR )
			HF_BILIN( shadowCoord.xy + vec2( -0.9, 0.5 ) * hfR )
			shadow *= 0.2;
			#undef HF_BILIN`,
  );
  // Whitespace-agnostic: the published build strips the blank lines that the
  // chunk sources contain (an exact-string find silently failed there). The
  // first match is getShadow() (directional/spot), not getPointShadow().
  patchChunk(
    'shadowmap_pars_fragment',
    /\}\s*return mix\( 1\.0, shadow, shadowIntensity \);\s*\}/,
    `}
		// Halcyon: fade toward the shadow frustum edge (no hard cut-off line).
		vec2 hfEdge = abs( shadowCoord.xy * 2.0 - 1.0 );
		shadow = mix( shadow, 1.0, smoothstep( 0.8, 0.97, max( hfEdge.x, hfEdge.y ) ) );
		return mix( 1.0, shadow, shadowIntensity );
	}`,
  );
}

// Patch at module load — before ANY program compiles: three caches built-in
// programs by parameters (not source), so a program compiled before the patch
// would be reused unpatched by later materials.
installSunFog();

/** Called by the Renderer before drawing `scene` (cheap: 7 floats). */
export function applySceneFogSun(scene: THREE.Scene | null): void {
  const fs = scene?.userData.fogSun as SceneFogSun | undefined;
  if (!fs || !scene?.fog) {
    FOG_SUN_DIR[3] = 0;
    return;
  }
  FOG_SUN_DIR[0] = fs.dir.x;
  FOG_SUN_DIR[1] = fs.dir.y;
  FOG_SUN_DIR[2] = fs.dir.z;
  FOG_SUN_DIR[3] = fs.strength;
  FOG_SUN_COLOR[0] = fs.color.r;
  FOG_SUN_COLOR[1] = fs.color.g;
  FOG_SUN_COLOR[2] = fs.color.b;
}

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
  private weatherCount = 0;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly sunDir = new THREE.Vector3();
  private readonly lx = new THREE.Vector3();
  private readonly ly = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private time = 0;
  private quality: QualitySettings;
  private shadowHalf = 35;
  /** Hemisphere intensity without the shadow fill (see SHADOW_FILL_RATIO). */
  private hemiBase = 1;
  /** Fog color looking toward the sun (aerial perspective): the sun glow scattered in the haze. */
  private readonly fogSunColor: THREE.Color;

  constructor(private readonly scene: THREE.Scene, private readonly lighting: MapLighting, quality: QualitySettings) {
    this.quality = quality;
    const l = lighting;
    this.sunDir.set(l.sunDir.x, l.sunDir.y, l.sunDir.z).normalize();
    installSunFog();
    this.fogSunColor = new THREE.Color(l.fogColor).lerp(new THREE.Color(l.sunGlow), 0.62).multiplyScalar(1.12);
    // Read by the Renderer every frame (applySceneFogSun) — per scene, so the
    // menu or another scene never inherits this map's sun.
    const fogSun: SceneFogSun = { dir: this.sunDir, color: this.fogSunColor, strength: FOG_SUN_STRENGTH };
    scene.userData.fogSun = fogSun;
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
    this.hemiBase = this.hemi.intensity;

    this.fill = new THREE.DirectionalLight(new THREE.Color(l.hemiGround).lerp(new THREE.Color(l.sunColor), 0.35), l.sunIntensity * 0.16);
    this.fill.position.set(-l.sunDir.x, 0.35, -l.sunDir.z).normalize().multiplyScalar(100);
    scene.add(this.fill);

    // Sky dome (drawn first, depth test off → radius is irrelevant).
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color(l.skyZenith) },
        uHorizon: { value: new THREE.Color(l.skyHorizon) },
        uFog: { value: new THREE.Color(l.fogColor) },
        uFogSun: { value: this.fogSunColor },
        uFogSunK: { value: FOG_SUN_STRENGTH },
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
    this.hemi.intensity = cast ? Math.max(this.hemiBase * 1.12, this.sun.intensity * SHADOW_FILL_RATIO) : this.hemiBase;
    this.shadowHalf = SHADOW_HALF[q.shadows];
    const sc = this.sun.shadow.camera;
    if (sc.right !== this.shadowHalf) {
      sc.left = -this.shadowHalf;
      sc.right = this.shadowHalf;
      sc.top = this.shadowHalf;
      sc.bottom = -this.shadowHalf;
      sc.updateProjectionMatrix();
    }
    this.sun.shadow.radius = SHADOW_RADIUS[q.shadows];
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
    // setQuality also runs for Auto's render-scale-only steps: keep the
    // existing Points (and its compiled program) when nothing it uses changed.
    const kind0 = this.lighting.weather;
    if (this.weather && kind0 !== 'none' && this.weatherCount === Math.max(16, Math.round(WEATHER[kind0].count * this.quality.particles))) return;
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
    this.weatherCount = count;
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
    const c = this.tmp.copy(cam).addScaledVector(this.fwd, this.shadowHalf * 0.45);
    const texel = (this.shadowHalf * 2) / Math.max(256, this.sun.shadow.mapSize.x);
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
    if (this.scene.userData.fogSun) delete this.scene.userData.fogSun;
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
  vAng = abs(position.x) + abs(position.z) < 1e-6 ? 0.0 : atan(position.x, position.z); // atan(0,0) is NaN on Apple GPUs
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
  // Slow drifting dust density along the beam (breaks up the cone's CG look).
  streak *= 0.82 + 0.18 * sin(vT * 11.0 - uTime * 0.6 + vAng * 2.0);
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
  gl_PointSize = clamp(0.05 * uScale / max(-mv.z, 0.2), 1.0, 24.0);
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
      uIntensity: { value: 0.46 },
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

  const n = 56;
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
      uColor: { value: color.clone().multiplyScalar(3) },
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
