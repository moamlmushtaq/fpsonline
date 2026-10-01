// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — character material: ONE shared material per (tier, team,
// friendly) drives the whole body in a single draw call.
//
// Per-vertex data (see kit.ts) selects the look: albedo (vertex colour),
// team paint, team / secondary emissive, gloss. Team colours are UNIFORMS read
// from teamColors() — a colour-blind mode switch only updates uniforms
// (refreshCharacterColors), geometry never rebuilds.
//
// Shading extras (all cheap, no extra passes):
//  • detail texture: R = ceramic scuffs & scratches, G = fabric weave,
//    B = roughness breakup, A = ceramic panel seams (one sample, interpreted
//    by gloss); worn bevel highlights from screen-space curvature;
//  • team-colour fresnel rim (stronger on paint & visors) so players pop
//    against warm dusty backdrops; enemies get a stronger rim than friendlies;
//  • fake sky reflection from the scene's hemisphere light on glossy ceramic
//    (Standard tier only — the maps have no environment map);
//  • per-instance effects (spawn materialize sweep, hit flash, Sunspear charge
//    glow on the hands, highlight) live on a lazily created per-instance
//    material that shares the same GL program; it is only bound while active.
// Low preset uses MeshLambertMaterial with the same hooks.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { Team } from '../../../shared/types';
import { getColorblindMode, teamColors, PICKUP_COLOR } from '../../engine/palette';
import { BONE_INDEX } from './rig';

export type MatTier = 'lambert' | 'standard';

export interface CharUniforms {
  uGlowA: { value: THREE.Color };
  uGlowB: { value: THREE.Color };
  uPaintA: { value: THREE.Color };
  uPaintB: { value: THREE.Color };
  uRim: { value: THREE.Color };
  uCharge: { value: THREE.Color };
  uSpawn: { value: number };
  uFlash: { value: number };
  uWear: { value: number };
  uGlowK: { value: number };
}

export interface CharMaterial extends THREE.Material {
  userData: { hf: CharUniforms; team: Team; friendly: boolean; tier: MatTier };
}

/**
 * Emissive intensity of visor lines (HDR). The colour is pre-saturated for the
 * ACES grade (see glowColor), so the visor reads as the TEAM colour — orange
 * or teal — instead of burning out to cream. Far away the shader boosts it
 * (READ_* below) so the line still carries (and blooms) at 40–80 m.
 */
const GLOW_A = 1.65;
const GLOW_B = 1.5;
/** ACES input-matrix pre-compensation: push hue away from grey before tone mapping. */
const GLOW_SAT = 1.75;

const _lum = new THREE.Color();

/**
 * Linear team colour, saturated so that after the ACES fit (which mixes
 * channels and desaturates highlights) the on-screen hue matches the palette
 * swatch; normalised to max channel = 1, then scaled by `k`.
 */
function glowColor(out: THREE.Color, hex: string, k: number): THREE.Color {
  out.set(hex);
  const l = out.r * 0.2126 + out.g * 0.7152 + out.b * 0.0722;
  _lum.setRGB(
    Math.max(0, l + (out.r - l) * GLOW_SAT),
    Math.max(0, l + (out.g - l) * GLOW_SAT),
    Math.max(0, l + (out.b - l) * GLOW_SAT),
  );
  const m = Math.max(_lum.r, _lum.g, _lum.b, 1e-4);
  return out.setRGB((_lum.r / m) * k, (_lum.g / m) * k, (_lum.b / m) * k);
}

// ── Detail texture ─────────────────────────────────────────────────────────

let detailTex: THREE.Texture | null = null;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function detailTexture(): THREE.Texture {
  if (detailTex) return detailTex;
  const S = 256;
  const layer = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, S, S);
    return [c, ctx];
  };
  const r = rng(9173);
  // R: scuffs (soft blotches), chips and fine scratches — wrapped for tiling.
  const [, wear] = layer();
  const wrap = (fn: (ox: number, oy: number) => void): void => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
  };
  for (let i = 0; i < 26; i++) {
    const x = r() * S, y = r() * S, rad = 6 + r() * 22, v = 200 + r() * 40;
    wrap((ox, oy) => {
      const g = wear.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      g.addColorStop(0, `rgba(${v},${v},${v},0.55)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      wear.fillStyle = g;
      wear.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    });
  }
  wear.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = r() * S, y = r() * S, a = r() * Math.PI, len = 4 + r() * 22, v = 150 + r() * 60;
    const bend = (r() - 0.5) * 6;
    wrap((ox, oy) => {
      wear.strokeStyle = `rgba(${v},${v},${v},${0.35 + r() * 0.35})`;
      wear.lineWidth = 0.6 + r() * 0.8;
      wear.beginPath();
      wear.moveTo(x + ox, y + oy);
      wear.quadraticCurveTo(x + ox + Math.cos(a) * len * 0.5 + bend, y + oy + Math.sin(a) * len * 0.5 - bend, x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
      wear.stroke();
    });
  }
  for (let i = 0; i < 90; i++) {
    const x = r() * S, y = r() * S, rad = 0.6 + r() * 1.6, v = 120 + r() * 60;
    wear.fillStyle = `rgba(${v},${v},${v},0.8)`;
    wear.beginPath();
    wear.arc(x, y, rad, 0, Math.PI * 2);
    wear.fill();
  }
  const wd = wear.getImageData(0, 0, S, S).data;
  // A: ceramic panel layout — recursive rectangle split; each panel gets a
  // slight value shift (128 ± 10), seams are dark 2-px grooves on the panel's
  // top/left edges (tiles seamlessly: the split covers the whole square) with a
  // 1-px light lip below/right of the groove.
  const [, pan] = layer();
  pan.fillStyle = 'rgb(128,128,128)';
  pan.fillRect(0, 0, S, S);
  const rects: [number, number, number, number][] = [];
  const split = (x: number, y: number, w: number, h: number, depth: number): void => {
    if (depth >= 4 || (w < 46 && h < 46) || (depth >= 2 && r() < 0.25)) {
      rects.push([x, y, w, h]);
      return;
    }
    const f = 0.3 + r() * 0.4;
    if (w >= h) {
      const a = Math.round(w * f);
      split(x, y, a, h, depth + 1);
      split(x + a, y, w - a, h, depth + 1);
    } else {
      const a = Math.round(h * f);
      split(x, y, w, a, depth + 1);
      split(x, y + a, w, h - a, depth + 1);
    }
  };
  split(0, 0, S, S, 0);
  for (const [x, y, w, h] of rects) {
    const v = Math.round(128 + (r() - 0.5) * 20);
    pan.fillStyle = `rgb(${v},${v},${v})`;
    pan.fillRect(x, y, w, h);
  }
  for (const [x, y, w, h] of rects) {
    pan.fillStyle = 'rgb(14,14,14)';
    pan.fillRect(x, y, w, 2);
    pan.fillRect(x, y, 2, h);
    pan.fillStyle = 'rgb(205,205,205)';
    pan.fillRect(x + 2, y + 2, w - 2, 1);
    pan.fillRect(x + 2, y + 2, 1, h - 2);
    // A few panels carry a small fastener pair.
    if (w > 30 && h > 30 && r() < 0.45) {
      pan.fillStyle = 'rgb(60,60,60)';
      for (const fx of [x + 6, x + w - 7]) {
        pan.beginPath();
        pan.arc(fx, y + h - 7, 1.4, 0, Math.PI * 2);
        pan.fill();
      }
    }
  }
  const pd = pan.getImageData(0, 0, S, S).data;
  // G: fabric weave; B: low-frequency roughness breakup.
  const out = new Uint8Array(S * S * 4);
  const n2 = (x: number, y: number): number =>
    Math.sin(x * 0.049 + Math.sin(y * 0.031) * 2.1) * 0.5 + Math.sin(y * 0.061 + Math.sin(x * 0.043) * 1.7) * 0.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const weave = 0.5 + 0.5 * Math.sin((x + y) * ((Math.PI * 2) / 4)) * Math.sin((x - y) * ((Math.PI * 2) / 4));
      const fib = r();
      const g = 150 + weave * 70 + fib * 35;
      const b = 128 + n2((x / S) * 256, (y / S) * 256) * 60 + (r() - 0.5) * 30;
      out[i] = wd[i];
      out[i + 1] = Math.max(0, Math.min(255, g));
      out[i + 2] = Math.max(0, Math.min(255, b));
      out[i + 3] = pd[i];
    }
  }
  const t = new THREE.DataTexture(out, S, S, THREE.RGBAFormat);
  t.name = 'character.detail';
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  detailTex = t;
  return t;
}

// ── Shader hooks ───────────────────────────────────────────────────────────

const VERT_PARS = /* glsl */ `
attribute vec4 fx;
attribute vec4 fxg;
varying vec4 vFx;
varying vec3 vRest;
varying float vHand;
`;

const VERT_MAIN = /* glsl */ `
vFx = fx;
vRest = position;
// Far readability (fxg = bind-space part centre + grow): team-coloured parts
// scale up around their own centre with distance so they still cover pixels
// (and bloom) at 60–80 m. Visors (w < 0) thicken vertically: ×1 up close,
// ×3.6 tall at 80 m; accents (w > 0) grow isotropically by ×(1 + w).
if ( fxg.w != 0.0 ) {
  vec4 hfC = modelViewMatrix * vec4( fxg.xyz, 1.0 );
  float hfS = smoothstep( 20.0, 80.0, length( hfC.xyz ) );
  vec3 hfD = transformed - fxg.xyz;
  if ( fxg.w < 0.0 ) hfD *= vec3( 1.0 + hfS * 0.3, 1.0 - hfS * fxg.w, 1.0 );
  else hfD *= 1.0 + hfS * fxg.w;
  transformed = fxg.xyz + hfD;
}
vHand = 0.0;
#ifdef USE_SKINNING
  vHand = (abs(skinIndex.x - ${BONE_INDEX.handL.toFixed(1)}) < 0.5 || abs(skinIndex.x - ${BONE_INDEX.handR.toFixed(1)}) < 0.5) ? 1.0 : 0.0;
#endif
`;

const FRAG_PARS = /* glsl */ `
uniform vec3 uGlowA;
uniform vec3 uGlowB;
uniform vec3 uPaintA;
uniform vec3 uPaintB;
uniform vec3 uRim;
uniform vec3 uCharge;
uniform float uSpawn;
uniform float uFlash;
uniform float uWear;
uniform float uGlowK;
varying vec4 vFx;
varying vec3 vRest;
varying float vHand;
`;

const FRAG_COLOR = /* glsl */ `
vec4 hfDetail = texture2D( map, vMapUv );
if ( uSpawn < 1.0 ) {
  float hfEdge = uSpawn * 2.3 - 0.15;
  if ( vRest.y > hfEdge ) discard;
}
diffuseColor.rgb *= vColor.rgb;
float hfPaintA = clamp( vFx.z, 0.0, 1.0 );
float hfPaintB = clamp( -vFx.z, 0.0, 1.0 );
diffuseColor.rgb = mix( diffuseColor.rgb, uPaintA, hfPaintA );
diffuseColor.rgb = mix( diffuseColor.rgb, uPaintB, hfPaintB );
float hfGloss = clamp( vFx.w, 0.0, 1.0 );
float hfGlowMask = clamp( vFx.x + vFx.y, 0.0, 1.0 );
diffuseColor.rgb *= 1.0 - hfGlowMask * 0.85;
// Far value lift (colour alpha): flagged parts drift to a light ceramic
// value at range so the figure reads as one coherent mass.
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.66, 0.63, 0.58 ), vColor.a * smoothstep( 22.0, 70.0, length( vViewPosition ) ) * 0.6 );
// Scuffs on hard shells, weave on fabric.
diffuseColor.rgb *= mix( 1.0, hfDetail.r, uWear * smoothstep( 0.3, 0.8, hfGloss ) );
diffuseColor.rgb *= mix( 1.0, 0.8 + 0.34 * hfDetail.g, 1.0 - smoothstep( 0.15, 0.45, hfGloss ) );
// Ceramic panel breakup (detail alpha): recessed seams, a light bevel lip
// and a slight per-panel value shift — only on hard glossy armour.
float hfHard = smoothstep( 0.62, 0.8, hfGloss ) * ( 1.0 - hfGlowMask );
float hfNear = 1.0 - smoothstep( 9.0, 24.0, length( vViewPosition ) );
diffuseColor.rgb *= 1.0 + hfHard * ( hfDetail.a - 0.5 ) * 0.62 * ( 0.35 + 0.65 * hfNear );
#ifndef FLAT_SHADED
{
  // Worn bevels: high surface curvature (plate rims, panel corners) shows a
  // brighter chipped edge — painted paint wear toward bare ceramic.
  vec3 hfN = normalize( vNormal );
  float hfCurv = length( fwidth( hfN ) ) / max( length( fwidth( vViewPosition ) ), 1e-4 );
  float hfEdge = smoothstep( 24.0, 70.0, hfCurv ) * hfHard * hfNear;
  diffuseColor.rgb = mix( diffuseColor.rgb, max( diffuseColor.rgb * 1.22, vec3( 0.86, 0.83, 0.77 ) ), hfEdge * 0.55 );
}
#endif
`;

const FRAG_ROUGH = /* glsl */ `
float roughnessFactor = clamp( mix( 0.94, 0.26, hfGloss ) + ( hfDetail.b - 0.5 ) * 0.16 + ( 1.0 - hfDetail.r ) * 0.35, 0.05, 1.0 );
`;

const FRAG_EMISSIVE = /* glsl */ `
// Readability at range: beyond ~18 m the visor/bulb glow and the team rim
// ramp up, so a 12-px figure at 60–80 m still shows its team-coloured line
// (and blooms) and its silhouette edge picks up the team hue against a
// backlit sky. Hue never changes — friendly vs enemy only scales uRim.
float hfFar = smoothstep( 18.0, 72.0, length( vViewPosition ) );
totalEmissiveRadiance += ( uGlowA * vFx.x + uGlowB * vFx.y ) * uGlowK * ( 1.0 + hfFar * 1.7 );
// Team paint (Halcyon orange stripes / pods bands, Bloom violet edges) picks up
// a faint self-glow at range so the accent colour survives haze and backlight.
totalEmissiveRadiance += ( uPaintA * hfPaintA + uPaintB * hfPaintB ) * hfFar * 0.95;
{
  vec3 hfV = normalize( vViewPosition );
  float hfFres = pow( 1.0 - clamp( dot( normal, hfV ), 0.0, 1.0 ), mix( 3.0, 1.5, hfFar ) );
  totalEmissiveRadiance += uRim * hfFres * ( 0.3 + hfPaintA * 1.4 + vFx.x * 1.5 + hfFar * 2.6 );
}
// Distance fill: albedo self-lift at range keeps the faction VALUE read
// (white ceramic Halcyon vs dark bark Bloom) even when backlit by the sun.
totalEmissiveRadiance += diffuseColor.rgb * ( hfFar * 0.28 * ( 1.0 - hfGlowMask ) );
totalEmissiveRadiance += uCharge * vHand;
if ( uSpawn < 1.0 ) {
  float hfEdge = uSpawn * 2.3 - 0.15;
  float hfBand = 1.0 - smoothstep( 0.0, 0.16, hfEdge - vRest.y );
  totalEmissiveRadiance += uGlowA * hfBand * 2.5 + uGlowA * ( 1.0 - uSpawn ) * 0.35;
}
totalEmissiveRadiance += vec3( uFlash );
`;

const FRAG_SHEEN = /* glsl */ `
#if NUM_HEMI_LIGHTS > 0
{
  vec3 hfV2 = normalize( vViewPosition );
  vec3 hfR = inverseTransformDirection( reflect( -hfV2, normal ), viewMatrix );
  vec3 hfEnv = mix( hemisphereLights[ 0 ].groundColor, hemisphereLights[ 0 ].skyColor, smoothstep( -0.25, 0.65, hfR.y ) );
  float hfF = 0.05 + 0.95 * pow( 1.0 - clamp( dot( normal, hfV2 ), 0.0, 1.0 ), 4.0 );
  reflectedLight.indirectSpecular += hfEnv * hfF * smoothstep( 0.35, 0.95, hfGloss ) * 0.55 * hfDetail.r;
}
#endif
`;

function makeUniforms(): CharUniforms {
  return {
    uGlowA: { value: new THREE.Color() },
    uGlowB: { value: new THREE.Color() },
    uPaintA: { value: new THREE.Color() },
    uPaintB: { value: new THREE.Color() },
    uRim: { value: new THREE.Color() },
    uCharge: { value: new THREE.Color(0, 0, 0) },
    uSpawn: { value: 1 },
    uFlash: { value: 0 },
    uWear: { value: 0.85 },
    uGlowK: { value: 1 },
  };
}

function applyTeam(u: CharUniforms, team: Team, friendly: boolean, tier: MatTier): void {
  const tc = teamColors(team);
  // Without bloom (low preset) a hot emissive tone-maps to white: keep it saturated instead.
  const k = tier === 'lambert' ? 0.7 : 1;
  glowColor(u.uGlowA.value, tc.emissive, GLOW_A * k);
  glowColor(u.uGlowB.value, tc.secondary, GLOW_B * k);
  u.uPaintA.value.set(tc.primary);
  u.uPaintB.value.set(tc.secondary);
  u.uRim.value.set(tc.primary).multiplyScalar(friendly ? 0.22 : 0.38);
}

function createMaterial(tier: MatTier, team: Team, friendly: boolean): CharMaterial {
  const map = detailTexture();
  const mat =
    tier === 'standard'
      ? new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 1, metalness: 0 })
      : new THREE.MeshLambertMaterial({ vertexColors: true, map });
  const u = makeUniforms();
  applyTeam(u, team, friendly, tier);
  mat.name = `character.${tier}.t${team}`;
  mat.userData = { hf: u, team, friendly, tier };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${tier === 'standard' ? FRAG_SHEEN : ''}`);
  };
  mat.customProgramCacheKey = () => `hf-character-v6-${tier}`;
  return mat as unknown as CharMaterial;
}

const shared = new Map<string, CharMaterial>();
/** Per-instance fx materials that are alive (colour refresh). */
const liveFx = new Set<CharMaterial>();
let appliedMode = getColorblindMode();

export function tierFor(preset: 'low' | 'medium' | 'high'): MatTier {
  return preset === 'low' ? 'lambert' : 'standard';
}

/** Shared material for (tier, team, friendly). Never dispose it per instance. */
export function sharedMaterial(tier: MatTier, team: Team, friendly: boolean): CharMaterial {
  syncColorMode();
  const key = `${tier}|${team}|${friendly ? 1 : 0}`;
  let m = shared.get(key);
  if (!m) shared.set(key, (m = createMaterial(tier, team, friendly)));
  return m;
}

/** A private material (same GL program) for per-instance effects. Dispose with releaseFxMaterial. */
export function fxMaterial(tier: MatTier, team: Team, friendly: boolean): CharMaterial {
  const m = createMaterial(tier, team, friendly);
  liveFx.add(m);
  return m;
}

export function releaseFxMaterial(m: CharMaterial): void {
  liveFx.delete(m);
  m.dispose();
}

/** Re-reads team colours (colour-blind mode change) into every character material. */
export function refreshCharacterColors(): void {
  appliedMode = getColorblindMode();
  for (const m of shared.values()) applyTeam(m.userData.hf, m.userData.team, m.userData.friendly, m.userData.tier);
  for (const m of liveFx) applyTeam(m.userData.hf, m.userData.team, m.userData.friendly, m.userData.tier);
}

/** Cheap per-frame guard: picks up a colour-blind switch even if nobody calls refresh. */
export function syncColorMode(): void {
  if (getColorblindMode() !== appliedMode) refreshCharacterColors();
}

/** Sunspear charge colour (hands). */
export const CHARGE_COLOR = new THREE.Color(PICKUP_COLOR);

// ── Blob shadow (low preset: grounds characters without shadow maps) ───────

let blobGeo: THREE.BufferGeometry | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;

export function blobShadow(): THREE.Mesh {
  if (!blobGeo) blobGeo = new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);
  if (!blobMat) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(40,36,48,0.55)');
    g.addColorStop(0.55, 'rgba(40,36,48,0.28)');
    g.addColorStop(1, 'rgba(40,36,48,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    blobMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true });
    blobMat.name = 'character.blob';
  }
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.name = 'blobShadow';
  m.position.y = 0.015;
  m.renderOrder = -1;
  return m;
}
