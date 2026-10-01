// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — painterly material shading + in-material grading.
//
// Two global shader-chunk patches, installed once at module load (before any
// program compiles — three caches built-in programs by parameters, not source):
//
//  1. HF_PAINTERLY (opt-in per material via `material.defines`): a hand-painted
//     finish for ENVIRONMENT surfaces, sampled in WORLD space so it never tiles
//     with the texture and never repeats across a large wall:
//       • soft value blotches (≈ 8 m) + brush-stroke patches (≈ 1–2 m, soft-
//         edged, thresholded) laid in each face's plane and warped by the
//         blotches, + fine dabs (≈ 0.3 m): two-plus scales of mottling,
//       • a very low-frequency warm (sand/terracotta) ↔ cool (sky) hue drift
//         across large surfaces (luminance preserving),
//       • top-lit / bottom-dark: upward faces a touch brighter and warmer,
//         downward faces cooler and darker (painted form, not lighting).
//     Cost: 3 fetches of one 128² noise texture + ~25 ALU per pixel, on every
//     preset. Characters, weapons and effects never get the define.
//
//  2. Direct-to-screen grading (the LOW preset has no post pipeline): the same
//     saturation, warm tint, luminance-preserving cool-violet shadow split, toe
//     floor and vignette as post.ts's GradingPass, applied inside every
//     material's tone-mapping step (and to the fog color, so fogged geometry
//     still meets the graded sky). Only active when tone mapping happens in the
//     material, i.e. when drawing straight to the canvas: medium/high render
//     into a HalfFloat target with tone mapping off and grade in post — never
//     twice. No extra pass, ~15 ALU per pixel. Disabled (identity) when the
//     uniforms are zero, so ShaderMaterials that do not share them are safe.
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
	varying vec3 vHfNormal;
	uniform sampler2D hfPaintTex;
	vec3 hfPaint( vec3 c ) {
		vec3 n = normalize( vHfNormal );
		vec3 p = vHfWorld;
		// Large scale: a continuous skewed mapping of 3D position (seam-free on
		// every face orientation) → value blotches (r) + hue drift (b).
		vec4 L = texture2D( hfPaintTex, vec2( p.x + p.y * 0.37, p.z - p.y * 0.29 ) * ( 1.0 / 30.0 ) );
		// Mid scale: strokes laid in the face's dominant plane, warped by L.
		vec3 an = abs( n );
		vec2 fp = an.y > 0.7 ? p.xz : ( an.x > an.z ? p.zy : p.xy );
		vec4 M = texture2D( hfPaintTex, fp * ( 1.0 / 3.4 ) + ( L.rb - 0.5 ) * 0.5 );
		vec4 S = texture2D( hfPaintTex, fp.yx * ( 1.0 / 1.15 ) + M.rg * 0.35 );
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

const GRADE_PARS = /* glsl */ `
uniform vec4 hfGradeA; // rgb: luminance-normalised warm tint, w: saturation (0 = grading off)
uniform vec4 hfGradeB; // rgb: luminance-normalised shadow hue, w: shadow split amount
uniform vec4 hfGradeC; // xy: 1 / drawing-buffer size, z: vignette, w: aspect
uniform vec4 hfGradeD; // rgb: linear shadow tint × toe floor
vec3 hfGrade( vec3 col ) {
	if ( hfGradeA.w <= 0.0 ) return col;
	float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
	col = mix( vec3( l ), col, hfGradeA.w );
	col *= hfGradeA.rgb;
	float sh = 1.0 - smoothstep( 0.0, 0.2, l );
	col = mix( col, col * hfGradeB.rgb, sh * hfGradeB.w );
	col += hfGradeD.rgb * ( 1.0 - smoothstep( 0.0, 0.07, l ) );
	vec2 q = ( gl_FragCoord.xy * hfGradeC.xy - 0.5 ) * vec2( hfGradeC.w, 1.0 );
	col *= mix( 1.0, smoothstep( 1.05, 0.25, length( q ) * 1.1 ), hfGradeC.z );
	return clamp( col, 0.0, 1.0 );
}`;

// ── Uniforms (shared typed arrays: UniformsUtils.clone keeps them by reference) ─

const GRADE_A = new Float32Array(4);
const GRADE_B = new Float32Array(4);
const GRADE_C = new Float32Array(4);
const GRADE_D = new Float32Array(4);

/** Uniform entries for custom ShaderMaterials that should be graded on low (sky, water…). */
export function gradeUniforms(): Record<string, THREE.IUniform> {
  return { hfGradeA: { value: GRADE_A }, hfGradeB: { value: GRADE_B }, hfGradeC: { value: GRADE_C }, hfGradeD: { value: GRADE_D } };
}

let installed = false;

function patch(name: string, find: string, replace: string): boolean {
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  const src = chunks[name];
  if (typeof src !== 'string' || !src.includes(find)) {
    console.warn(`[painterly] shader chunk '${name}' not patched (three.js changed?)`);
    return false;
  }
  chunks[name] = src.replace(find, replace);
  return true;
}

function append(name: string, code: string): void {
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  if (typeof chunks[name] === 'string') chunks[name] += code;
}

/** Installs the painterly + direct-grading chunk patches (idempotent; runs at module load). */
export function installPainterly(): void {
  if (installed) return;
  installed = true;
  append('color_pars_vertex', PAINT_PARS_VERTEX);
  append('worldpos_vertex', PAINT_VERTEX);
  append('color_pars_fragment', PAINT_PARS_FRAGMENT);
  append('color_fragment', PAINT_FRAGMENT);
  append('tonemapping_pars_fragment', GRADE_PARS);
  patch('tonemapping_fragment', 'gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );', 'gl_FragColor.rgb = hfGrade( toneMapping( gl_FragColor.rgb ) );');

  const grade = gradeUniforms();
  const lib = THREE.ShaderLib as unknown as Record<string, { uniforms?: Record<string, THREE.IUniform> }>;
  const tex = { hfPaintTex: { value: null as THREE.Texture | null } };
  for (const k of Object.keys(lib)) {
    const un = lib[k].uniforms;
    if (!un) continue;
    Object.assign(un, grade);
    if (k === 'lambert' || k === 'standard' || k === 'physical' || k === 'phong' || k === 'toon') Object.assign(un, tex);
  }
  // ShaderMaterials that merge the fog uniforms (water, cloud sea…) get grading too.
  Object.assign(THREE.UniformsLib.fog, grade);
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

/** Opts one environment material into the painterly finish (idempotent). */
export function enablePainterly(m: THREE.Material): boolean {
  if (!paintable(m)) return false;
  const d = ((m as THREE.ShaderMaterial).defines ??= {}) as Record<string, string>;
  if ('HF_PAINTERLY' in d) return true;
  ensurePaintTexture();
  d.HF_PAINTERLY = '';
  m.needsUpdate = true;
  return true;
}

/**
 * Opts every paintable material under `root` into the painterly finish (map
 * decor, static geometry, backdrop). Objects flagged `userData.noPaint` (and
 * their materials) are skipped. Returns the number of materials changed.
 */
export function paintTree(root: THREE.Object3D): number {
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
      if (enablePainterly(m)) n++;
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
 * Pass `null` to disable it (post handles grading). `w`/`h` = drawing buffer.
 */
export function setDirectGrading(g: GradingSettings | null, w: number, h: number): void {
  if (!g) {
    GRADE_A[3] = 0;
    return;
  }
  if (g.tint !== lastTint) {
    lastTint = g.tint;
    displayRGB(g.tint, GRADE_A);
    const l = GRADE_A[0] * 0.2126 + GRADE_A[1] * 0.7152 + GRADE_A[2] * 0.0722 || 1;
    GRADE_A[0] /= l;
    GRADE_A[1] /= l;
    GRADE_A[2] /= l;
  }
  if (g.shadowTint !== lastShadow) {
    lastShadow = g.shadowTint;
    // Linear shadow tint (as post.ts), nudged toward violet, luminance-normalised.
    _c.setStyle(g.shadowTint);
    let r = _c.r * 1.3;
    let gg = _c.g * 0.86;
    let b = _c.b * 0.95;
    const l = r * 0.2126 + gg * 0.7152 + b * 0.0722 || 1;
    r /= l;
    gg /= l;
    b /= l;
    GRADE_B[0] = r;
    GRADE_B[1] = gg;
    GRADE_B[2] = b;
    GRADE_D[0] = _c.r * 0.12;
    GRADE_D[1] = _c.g * 0.12;
    GRADE_D[2] = _c.b * 0.12;
  }
  // Low lacks bloom's glow and the painterly filter's softening, so its split
  // tone and saturation lean a hair stronger to land on Medium's palette.
  GRADE_A[3] = Math.max(0.01, g.saturation * 1.02);
  GRADE_B[3] = 0.55;
  GRADE_C[0] = 1 / Math.max(1, w);
  GRADE_C[1] = 1 / Math.max(1, h);
  GRADE_C[2] = THREE.MathUtils.clamp(g.vignette, 0, 1);
  GRADE_C[3] = w / Math.max(1, h);
}
