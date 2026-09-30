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
//    B = roughness breakup (one sample, interpreted by gloss);
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
      out[i + 3] = 255;
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
varying vec4 vFx;
varying vec3 vRest;
varying float vHand;
`;

const VERT_MAIN = /* glsl */ `
vFx = fx;
vRest = position;
// Visor lines (fx.w flag, fx.y = bind-space eye-line height) thicken with
// distance around their own centre line: ×1 up close, ×3.6 tall at 80 m, so
// the team-coloured line still covers a pixel row (and blooms) at range.
if ( fx.w > 1.25 ) {
  vFx.y = 0.0;
  vec4 hfEye = modelViewMatrix * vec4( 0.0, fx.y, 0.0, 1.0 );
  float hfS = smoothstep( 20.0, 80.0, length( hfEye.xyz ) );
  transformed.y = fx.y + ( transformed.y - fx.y ) * ( 1.0 + hfS * 2.6 );
  transformed.x *= 1.0 + hfS * 0.3;
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
diffuseColor.rgb *= vColor;
float hfPaintA = clamp( vFx.z, 0.0, 1.0 );
float hfPaintB = clamp( -vFx.z, 0.0, 1.0 );
diffuseColor.rgb = mix( diffuseColor.rgb, uPaintA, hfPaintA );
diffuseColor.rgb = mix( diffuseColor.rgb, uPaintB, hfPaintB );
float hfGloss = clamp( vFx.w, 0.0, 1.0 );
float hfGlowMask = clamp( vFx.x + vFx.y, 0.0, 1.0 );
diffuseColor.rgb *= 1.0 - hfGlowMask * 0.85;
// Scuffs on hard shells, weave on fabric.
diffuseColor.rgb *= mix( 1.0, hfDetail.r, uWear * smoothstep( 0.3, 0.8, hfGloss ) );
diffuseColor.rgb *= mix( 1.0, 0.8 + 0.34 * hfDetail.g, 1.0 - smoothstep( 0.15, 0.45, hfGloss ) );
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
{
  vec3 hfV = normalize( vViewPosition );
  float hfFres = pow( 1.0 - clamp( dot( normal, hfV ), 0.0, 1.0 ), mix( 3.0, 1.8, hfFar ) );
  totalEmissiveRadiance += uRim * hfFres * ( 0.3 + hfPaintA * 1.4 + vFx.x * 1.5 + hfFar * 1.6 );
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
  mat.customProgramCacheKey = () => `hf-character-v5-${tier}`;
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
