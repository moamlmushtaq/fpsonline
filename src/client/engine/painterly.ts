// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — painterly material shading + the low preset's palette grade.
//

//  1. HF_PAINTERLY (opt-in per material via `material.defines`; global chunk
//     patches installed once at module load, before any program compiles —
//     three caches built-in programs by parameters, not source): a hand-painted
//     finish for ENVIRONMENT surfaces, sampled in WORLD space so it never tiles
//     with the texture and never repeats across a large wall:
//       • soft value blotches (≈ 8 m) + brush-stroke patches (≈ 1–2 m, soft-
//         edged, thresholded) laid in each face's plane and warped by the
//         blotches, + fine dabs (≈ 0.3 m): two-plus scales of mottling,
//       • a very low-frequency warm (sand/terracotta) ↔ cool (sky) hue drift
//         across large surfaces (luminance preserving),
//       • top-lit / bottom-dark: upward faces a touch brighter and warmer,
//         downward faces cooler and darker (painted form, not lighting).
//     Cost: 3 fetches (high; 2 on medium) of one 128² noise texture + ~30
//     ALU per pixel. Medium/high only: on low the finish comes from the
//     painterly textures and the map's baked vertex colors (zero per-pixel
//     cost). Characters, weapons and effects never get it.
//
//  2. Direct grading state for the LOW preset (no post pipeline): the same
//     saturation, warm tint and cool-violet split tone as post.ts's
//     GradingPass, applied on the CPU to the scene's constant colors — sun,
//     sky fill and bounce lights (the sky fill, which lights the shadows, gets
//     the cool-violet split), fog and the sky dome's palette (atmosphere.ts).
//     Lit surfaces are albedo × light, so grading the lights grades the frame
//     (tint exactly; saturation closely, environment albedos being neutral):
//     Low lands on Medium's palette at ZERO per-pixel cost. (A per-material
//     shader grade measured +15–20 % frame time on software rasterisation.)
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { GradingSettings } from '../contracts';
import { paintNoiseTexture } from './textures';

// ── GLSL ────────────────────────────────────────────────────────────────────

const PAINT_PARS_VERTEX = /* glsl */ `
#ifdef HF_PAINTERLY
	varying vec3 vHfWorld;
	varying vec3 vHfNormal;
#endif`;

const PAINT_VERTEX = /* glsl */ `
#ifdef HF_PAINTERLY
	vec4 hfWp = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		hfWp = batchingMatrix * hfWp;
	#endif
	#ifdef USE_INSTANCING
		hfWp = instanceMatrix * hfWp;
	#endif
	hfWp = modelMatrix * hfWp;
	vHfWorld = hfWp.xyz;
	// transformedNormal is view space here → back to world (rotation only).
	vHfNormal = ( vec4( transformedNormal, 0.0 ) * viewMatrix ).xyz;
#endif`;

const PAINT_PARS_FRAGMENT = /* glsl */ `
#ifdef HF_PAINTERLY
	varying vec3 vHfWorld;
	uniform sampler2D hfPaintTex;
	varying vec3 vHfNormal;
	vec3 hfPaint( vec3 c ) {
		vec3 n = normalize( vHfNormal );
		vec3 p = vHfWorld;
		vec3 an = abs( n );
		vec2 fp = an.y > 0.7 ? p.xz : ( an.x > an.z ? p.zy : p.xy );
		// Large scale: a continuous skewed mapping of 3D position (seam-free on
		// every face orientation) → value blotches (r) + hue drift (b).
		vec4 L = texture2D( hfPaintTex, vec2( p.x + p.y * 0.37, p.z - p.y * 0.29 ) * ( 1.0 / 30.0 ) );
		// Mid scale: strokes laid in the face's dominant plane, warped by L.
		vec4 M = texture2D( hfPaintTex, fp * ( 1.0 / 3.4 ) + ( L.rb - 0.5 ) * 0.5 );
		#ifdef HF_PAINT_HI
			vec4 S = texture2D( hfPaintTex, fp.yx * ( 1.0 / 1.15 ) + M.rg * 0.35 ); // fine dabs (high only)
		#else
			vec4 S = M;
		#endif
		// Strokes as flat-ish patches with soft edges (thresholded), not smooth noise.
		float stroke = smoothstep( 0.36, 0.64, M.g ) - 0.5;
		float v = 1.0 + ( L.r - 0.5 ) * 0.34 + stroke * 0.2 + ( S.a - 0.5 ) * 0.12;
		// Warm ↔ cool drift (normalised to luminance 1 → value preserved), plus a
		// little temperature change from stroke to stroke, as a painter mixes.
		vec3 hue = mix( vec3( 0.9, 0.99, 1.13 ), vec3( 1.1, 0.995, 0.86 ), smoothstep( 0.25, 0.75, L.b ) );
		hue *= mix( vec3( 0.97, 1.0, 1.04 ), vec3( 1.03, 1.0, 0.96 ), smoothstep( 0.35, 0.65, M.r ) );
		// Top-lit / bottom-dark painted form.
		float up = n.y;
		vec3 form = up > 0.0 ? mix( vec3( 1.0 ), vec3( 1.07, 1.04, 0.98 ), up ) : mix( vec3( 1.0 ), vec3( 0.84, 0.86, 0.93 ), -up );
		return c * v * mix( vec3( 1.0 ), hue, 0.75 ) * form;
	}
#endif`;

const PAINT_FRAGMENT = /* glsl */ `
#ifdef HF_PAINTERLY
	diffuseColor.rgb = hfPaint( diffuseColor.rgb );
#endif`;

// ── Direct grading state (low preset) ───────────────────────────────────────

/** rgb: warm tint − 1 (luminance-normalised), [3]: saturation − 1. */
const GRADE_A = new Float32Array(4);
/** rgb: cool-violet shadow hue − 1 (luminance-normalised), [3]: split amount. */
const GRADE_B = new Float32Array(4);
let gradeOn = false;
let gradeVer = 0;

/** True while the low preset's palette grade is active (no post pipeline). */
export function directGradingOn(): boolean {
  return gradeOn;
}

/** Bumped whenever the direct grade changes (atmospheres re-grade their colors). */
export function directGradingVersion(): number {
  return gradeVer;
}

/**
 * Grades one constant linear color the way post.ts grades pixels: saturation
 * around luminance, the warm tint, and — for `shadow` = 0..1 — the cool-violet
 * split tone (used for the sky fill that lights the shadows). In place.
 */
export function gradeRGB(rgb: Float32Array | number[], o = 0, shadow = 0): void {
  const l = rgb[o] * 0.2126 + rgb[o + 1] * 0.7152 + rgb[o + 2] * 0.0722;
  const sat = 1 + GRADE_A[3];
  const k = GRADE_B[3] * shadow;
  for (let i = 0; i < 3; i++) {
    const c = Math.max(0, l + (rgb[o + i] - l) * sat) * (1 + GRADE_A[i]);
    rgb[o + i] = c * (1 + GRADE_B[i] * k);
  }
}

let installed = false;

function append(name: string, code: string): void {
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  if (typeof chunks[name] === 'string') chunks[name] += code;
}

/** Installs the painterly chunk patches (idempotent; runs at module load). */
export function installPainterly(): void {
  if (installed) return;
  installed = true;
  append('color_pars_vertex', PAINT_PARS_VERTEX);
  append('worldpos_vertex', PAINT_VERTEX);
  append('color_pars_fragment', PAINT_PARS_FRAGMENT);
  append('color_fragment', PAINT_FRAGMENT);

  const lib = THREE.ShaderLib as unknown as Record<string, { uniforms?: Record<string, THREE.IUniform> }>;
  const tex = { hfPaintTex: { value: null as THREE.Texture | null } };
  for (const k of ['lambert', 'standard', 'physical', 'phong', 'toon']) {
    const un = lib[k]?.uniforms;
    if (un) Object.assign(un, tex);
  }
  // The noise texture is created lazily (DOM-free DataTexture) the first time a
  // material opts in; ShaderLib entries share this holder until then.
  painterlyTexHolder = tex.hfPaintTex;
}

let painterlyTexHolder: { value: THREE.Texture | null } | null = null;

function ensurePaintTexture(): void {
  if (painterlyTexHolder && !painterlyTexHolder.value) painterlyTexHolder.value = paintNoiseTexture();
}

installPainterly();

// ── Material opt-in ─────────────────────────────────────────────────────────

/** Built-in lit materials that can carry the painterly finish. */
function paintable(m: THREE.Material): boolean {
  const t = m as THREE.MeshStandardMaterial;
  if (!(t.isMeshStandardMaterial || (m as THREE.MeshLambertMaterial).isMeshLambertMaterial || (m as THREE.MeshPhongMaterial).isMeshPhongMaterial)) return false;
  if (m.transparent && m.opacity < 0.98) return false;
  if (m.userData.noPaint) return false;
  return true;
}

/**
 * Opts one environment material into the painterly finish (idempotent; for
 * medium/high — `high` adds the fine-dab layer).
 */
export function enablePainterly(m: THREE.Material, high = true): boolean {
  if (!paintable(m)) return false;
  const d = ((m as THREE.ShaderMaterial).defines ??= {}) as Record<string, string>;
  if ('HF_PAINTERLY' in d) return true;
  ensurePaintTexture();
  d.HF_PAINTERLY = '';
  if (high) d.HF_PAINT_HI = '';
  m.needsUpdate = true;
  return true;
}

/**
 * Opts every paintable material under `root` into the painterly finish (map
 * decor, static geometry, backdrop). Objects flagged `userData.noPaint` (and
 * their materials) are skipped. Returns the number of materials changed.
 */
export function paintTree(root: THREE.Object3D, high = true): number {
  let n = 0;
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o.userData.noPaint) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      if (enablePainterly(m, high)) n++;
    }
  });
  return n;
}

// ── Direct grading (low preset) ─────────────────────────────────────────────

const _c = new THREE.Color();

function displayRGB(hex: string, out: Float32Array): void {
  // Same convention as post.ts hexToDisplayRGB: the hex's display values.
  _c.setStyle(hex, THREE.LinearSRGBColorSpace);
  out[0] = _c.r;
  out[1] = _c.g;
  out[2] = _c.b;
}

let lastTint = '';
let lastShadow = '';

/**
 * Updates the in-material grading used when there is no post pipeline (low).
 * Pass `null` to disable it (post handles grading).
 */
export function setDirectGrading(g: GradingSettings | null): void {
  if (!g) {
    if (gradeOn) gradeVer++;
    gradeOn = false;
    GRADE_A.fill(0);
    GRADE_B.fill(0);
    lastTint = '';
    lastShadow = '';
    return;
  }
  const before = `${GRADE_A.join()}|${GRADE_B.join()}|${gradeOn}`;
  gradeOn = true;
  if (g.tint !== lastTint) {
    lastTint = g.tint;
    displayRGB(g.tint, GRADE_A);
    const l = GRADE_A[0] * 0.2126 + GRADE_A[1] * 0.7152 + GRADE_A[2] * 0.0722 || 1;
    GRADE_A[0] = GRADE_A[0] / l - 1;
    GRADE_A[1] = GRADE_A[1] / l - 1;
    GRADE_A[2] = GRADE_A[2] / l - 1;
  }
  if (g.shadowTint !== lastShadow) {
    lastShadow = g.shadowTint;
    // Linear shadow tint (as post.ts), nudged toward violet, luminance-normalised.
    _c.setStyle(g.shadowTint);
    const r = _c.r * 1.3;
    const gg = _c.g * 0.86;
    const b = _c.b * 0.95;
    const l = r * 0.2126 + gg * 0.7152 + b * 0.0722 || 1;
    GRADE_B[0] = r / l - 1;
    GRADE_B[1] = gg / l - 1;
    GRADE_B[2] = b / l - 1;
  }
  // Low lacks bloom's glow and the painterly filter's softening, so its split
  // tone and saturation lean a hair stronger to land on Medium's palette.
  GRADE_A[3] = g.saturation * 1.02 - 1;
  GRADE_B[3] = 0.55;
  if (`${GRADE_A.join()}|${GRADE_B.join()}|${gradeOn}` !== before) gradeVer++;
}
