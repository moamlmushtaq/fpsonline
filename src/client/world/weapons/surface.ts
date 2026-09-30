// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — weapon surfaces: finish palette shader, skin patterns, the
// shared print atlas (dial faces, labels, knurl panels) and the amber
// seven-segment ammo screen.
//
// Every weapon (and the first-person gloves) is drawn with ONE "finish"
// material: each vertex carries a finish index (+ a baked ambient-occlusion
// factor) and the shader looks color / metalness / roughness / emissive /
// pattern-mix up in a small uniform palette. Consequences:
//   • a whole weapon is one draw call (world LOD) or one per moving part
//     (view LOD), whatever its mix of ceramic, anodized metal, rubber, brass…
//   • merged geometry is skin-independent (cached per weapon); a skin only
//     swaps the palette + pattern texture (one material per skin, shared).
//   • glows that animate (Sunspear coils, Pulse capacitor) are palette slots
//     updated per instance — no extra meshes or materials per coil.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { WeaponSkin } from '../../../shared/cosmetics';
import type { WeaponId } from '../../../shared/types';
import { DANGER_COLOR, ENV, PICKUP_COLOR } from '../../engine/palette';
import { makeCanvas } from '../../engine/textures';

// ── Finishes ────────────────────────────────────────────────────────────────

/** Palette slot per surface finish (vertex attribute `aFin.x`). */
export const F = {
  shell: 0, // ceramic shell (skin shell color + pattern)
  accent: 1, // painted accent (skin accent)
  metal: 2, // brushed metal (skin metal)
  dark: 3, // anodized receiver metal (skin metal, deepened)
  rubber: 4, // knurled grips, pads
  steel: 5, // screws, pins, bolt
  brass: 6, // rings, shell bases
  glass: 7, // lenses (reflective)
  cream: 8, // enamel inserts, dial bezels
  bakelite: 9, // glossy brown bakelite
  amber: 10, // static warm glow (lamps, world-LOD screens)
  gold: 11, // Sunspear gilt trim
  sight: 12, // sight dots / beads
  danger: 13, // grenade light
  g0: 14, // dynamic glow groups (per-instance)
  g1: 15,
  g2: 16,
  g3: 17,
  g4: 18,
  g5: 19,
  hull: 20, // shotgun shell hulls
} as const;
export type Fin = (typeof F)[keyof typeof F];
export const FIN_COUNT = 21;

export interface FinishDef {
  color: string;
  metal: number;
  rough: number;
  emissive: number;
  pattern: number;
}

/** Linear-space palette storage shared with the shader. */
export class Palette {
  readonly color = new Float32Array(FIN_COUNT * 3);
  readonly mr = new Float32Array(FIN_COUNT * 4);
  private readonly tmp = new THREE.Color();
  set(slot: number, d: Partial<FinishDef>): this {
    if (d.color !== undefined) {
      this.tmp.set(d.color);
      this.color[slot * 3] = this.tmp.r;
      this.color[slot * 3 + 1] = this.tmp.g;
      this.color[slot * 3 + 2] = this.tmp.b;
    }
    if (d.metal !== undefined) this.mr[slot * 4] = d.metal;
    if (d.rough !== undefined) this.mr[slot * 4 + 1] = d.rough;
    if (d.emissive !== undefined) this.mr[slot * 4 + 2] = d.emissive;
    if (d.pattern !== undefined) this.mr[slot * 4 + 3] = d.pattern;
    return this;
  }
  /** Direct linear color write (hot path: no string parsing). */
  setLinear(slot: number, r: number, g: number, b: number, emissive?: number): void {
    this.color[slot * 3] = r;
    this.color[slot * 3 + 1] = g;
    this.color[slot * 3 + 2] = b;
    if (emissive !== undefined) this.mr[slot * 4 + 2] = emissive;
  }
  copy(p: Palette): this {
    this.color.set(p.color);
    this.mr.set(p.mr);
    return this;
  }
}

function mixHex(a: string, b: string, k: number): string {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
}

/** Palette for a weapon skin. */
export function skinPalette(skin: WeaponSkin): Palette {
  const p = new Palette();
  p.set(F.shell, { color: skin.shell, metal: 0, rough: 0.3, emissive: 0, pattern: 1 });
  p.set(F.accent, { color: skin.accent, metal: 0.08, rough: 0.36, emissive: 0, pattern: 0 });
  p.set(F.metal, { color: mixHex(skin.metal, '#b9b6b0', 0.12), metal: 0.82, rough: 0.3, emissive: 0, pattern: 0 });
  p.set(F.dark, { color: mixHex(skin.metal, '#1c1c1e', 0.62), metal: 0.5, rough: 0.42, emissive: 0, pattern: 0 });
  p.set(F.rubber, { color: '#2e2b28', metal: 0, rough: 0.82, emissive: 0, pattern: 0 });
  p.set(F.steel, { color: '#b4b4b0', metal: 0.92, rough: 0.26, emissive: 0, pattern: 0 });
  p.set(F.brass, { color: '#caa15a', metal: 0.92, rough: 0.28, emissive: 0, pattern: 0 });
  p.set(F.glass, { color: '#1b2233', metal: 1, rough: 0.05, emissive: 0.15, pattern: 0 });
  p.set(F.cream, { color: ENV.bone, metal: 0, rough: 0.4, emissive: 0, pattern: 0 });
  p.set(F.bakelite, { color: '#5b3a28', metal: 0, rough: 0.26, emissive: 0, pattern: 0 });
  // Third-person ammo screens: a warm amber pinpoint, never a white-hot chip.
  p.set(F.amber, { color: '#ff9a3c', metal: 0, rough: 0.5, emissive: 1.15, pattern: 0 });
  p.set(F.gold, { color: '#e6b85a', metal: 0.95, rough: 0.22, emissive: 0, pattern: 0 });
  p.set(F.sight, { color: '#ffd88a', metal: 0, rough: 0.5, emissive: 3.2, pattern: 0 });
  p.set(F.danger, { color: DANGER_COLOR, metal: 0, rough: 0.5, emissive: 2.6, pattern: 0 });
  p.set(F.hull, { color: '#a24b35', metal: 0.05, rough: 0.5, emissive: 0, pattern: 0 });
  for (let i = 0; i < 6; i++) p.set(F.g0 + i, { color: PICKUP_COLOR, metal: 0.2, rough: 0.35, emissive: 0.6, pattern: 0 });
  return p;
}

// ── Finish material (shader patch) ──────────────────────────────────────────

export type FinishKind = 'standard' | 'lambert';

/** Patches a Standard/Lambert material to read its surface from the finish palette. */
export function applyFinishShader(mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial, palette: Palette, kind: FinishKind): void {
  const uColor = { value: palette.color };
  const uMR = { value: palette.mr };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFinColor = uColor;
    sh.uniforms.uFinMR = uMR;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aFin;
uniform vec3 uFinColor[${FIN_COUNT}];
uniform vec4 uFinMR[${FIN_COUNT}];
varying vec3 vFinColor;
varying vec4 vFinMR;
varying float vFinAO;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{ int fi = int(aFin.x + 0.5); vFinColor = uFinColor[fi]; vFinMR = uFinMR[fi]; vFinAO = aFin.y; }`,
      );
    let frag = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vFinColor;
varying vec4 vFinMR;
varying float vFinAO;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec3 finPat = texture2D( map, vMapUv ).rgb;
  diffuseColor.rgb = mix( vFinColor, finPat, vFinMR.w );
#else
  diffuseColor.rgb = vFinColor;
#endif
  diffuseColor.rgb *= vFinAO;`,
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += vFinColor * vFinMR.z;`);
    if (kind === 'standard') {
      frag = frag
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vFinMR.y;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vFinMR.x;');
    }
    sh.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => `halcyon-finish-${kind}`;
}

export function finishMaterial(palette: Palette, pattern: THREE.Texture | null, kind: FinishKind): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  const mat =
    kind === 'standard'
      ? new THREE.MeshStandardMaterial({ color: 0xffffff, map: pattern, roughness: 0.4, metalness: 0 })
      : new THREE.MeshLambertMaterial({ color: 0xffffff, map: pattern });
  applyFinishShader(mat, palette, kind);
  return mat;
}

// ── Skin pattern textures (tiling, 4 repeats per meter) ─────────────────────

const patternCache = new Map<string, THREE.Texture>();

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Draws `fn` at the 9 wrap offsets so blotches tile seamlessly. */
function wrapDraw(size: number, x: number, y: number, fn: (x: number, y: number) => void): void {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(x + ox, y + oy);
}

export function patternTexture(skin: WeaponSkin): THREE.Texture {
  const hit = patternCache.get(skin.id);
  if (hit) return hit;
  const S = 256;
  const c = makeCanvas(S, S);
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  const r = rng(0x5eed + skin.id.length * 97);
  x.fillStyle = skin.shell;
  x.fillRect(0, 0, S, S);
  // Painterly ceramic mottling under every pattern (very low contrast).
  for (let i = 0; i < 140; i++) {
    const px = r() * S, py = r() * S, rad = 10 + r() * 34;
    const light = r() < 0.5;
    wrapDraw(S, px, py, (qx, qy) => {
      const g = x.createRadialGradient(qx, qy, 0, qx, qy, rad);
      g.addColorStop(0, light ? 'rgba(255,250,240,0.05)' : 'rgba(90,70,50,0.04)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(qx - rad, qy - rad, rad * 2, rad * 2);
    });
  }
  let wrapV = true;
  if (skin.pattern === 'stripes') {
    // 1970s triple rally stripes on a 45° diagonal (period 128 px → tiles).
    const cols = [skin.accent, mixHex(skin.accent, '#f0b35b', 0.55), skin.metal];
    const widths = [13, 8, 5];
    for (let k = -2; k < 4; k++) {
      let off = k * 128;
      cols.forEach((col, i) => {
        x.fillStyle = col;
        x.beginPath();
        x.moveTo(off, 0);
        x.lineTo(off + widths[i], 0);
        x.lineTo(off + widths[i] + S, S);
        x.lineTo(off + S, S);
        x.closePath();
        x.fill();
        off += widths[i] + 4;
      });
    }
  } else if (skin.pattern === 'patina') {
    const light = mixHex(skin.shell, '#d8ecd9', 0.45);
    const deep = mixHex(skin.shell, '#2f5a50', 0.4);
    for (let i = 0; i < 90; i++) {
      const px = r() * S, py = r() * S, rw = 6 + r() * 26, rh = 5 + r() * 16, a = r() * Math.PI;
      const col = r() < 0.55 ? light : deep;
      wrapDraw(S, px, py, (qx, qy) => {
        x.globalAlpha = 0.18 + r() * 0.12;
        x.fillStyle = col;
        x.beginPath();
        x.ellipse(qx, qy, rw, rh, a, 0, Math.PI * 2);
        x.fill();
      });
    }
    // Bronze showing through + cream mineral crust.
    for (let i = 0; i < 160; i++) {
      const px = r() * S, py = r() * S, rad = 0.8 + r() * 2.4;
      const col = r() < 0.6 ? skin.metal : skin.accent;
      wrapDraw(S, px, py, (qx, qy) => {
        x.globalAlpha = 0.35 + r() * 0.3;
        x.fillStyle = col;
        x.beginPath();
        x.arc(qx, qy, rad, 0, Math.PI * 2);
        x.fill();
      });
    }
    x.globalAlpha = 1;
  } else if (skin.pattern === 'speckle') {
    for (let i = 0; i < 900; i++) {
      x.fillStyle = r() < 0.6 ? skin.accent : skin.metal;
      x.globalAlpha = 0.7;
      x.beginPath();
      x.arc(r() * S, r() * S, 0.6 + r() * 1.6, 0, Math.PI * 2);
      x.fill();
    }
    x.globalAlpha = 1;
  } else if (skin.pattern === 'gradient') {
    // "Orbital" livery: white upper, a thin red pinstripe, deep navy belly.
    wrapV = false;
    const g = x.createLinearGradient(0, S, 0, 0);
    g.addColorStop(0, skin.metal);
    g.addColorStop(0.3, skin.metal);
    g.addColorStop(0.335, skin.accent);
    g.addColorStop(0.36, skin.accent);
    g.addColorStop(0.375, skin.shell);
    g.addColorStop(1, skin.shell);
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    // Faint panel seams keep it from reading as a flat fill.
    x.strokeStyle = 'rgba(40,50,70,0.10)';
    x.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      x.beginPath();
      x.moveTo(i * 64 + 20, S * 0.4);
      x.lineTo(i * 64 + 20, S);
      x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = wrapV ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  if (!wrapV) {
    // v = y·4 → map weapon heights y ∈ [−0.12, 0.155] onto the gradient.
    t.repeat.set(1, 1 / 1.1);
    t.offset.set(0, 0.48 / 1.1);
  }
  patternCache.set(skin.id, t);
  return t;
}

// ── Print atlas (dial faces, labels, knurl, markings) ───────────────────────

export const ATLAS_W = 1024;
export const ATLAS_H = 512;
export type Rect = [number, number, number, number];

export const REGION = {
  dialAmmo: [0, 0, 128, 128] as Rect,
  dialCharge: [128, 0, 128, 128] as Rect,
  knurl: [256, 0, 128, 128] as Rect,
  selector: [384, 0, 128, 48] as Rect,
  badge: [384, 64, 64, 64] as Rect,
  hazard: [448, 64, 64, 32] as Rect,
  vent: [448, 96, 64, 32] as Rect,
  scale: [512, 0, 128, 32] as Rect,
  serial: [512, 32, 128, 32] as Rect,
  grille: [640, 0, 128, 128] as Rect,
} as const;

const LABELS: Record<WeaponId, [string, string]> = {
  meridian: ['MERIDIAN', 'HF·AR 7  5.6 CAL'],
  swift: ['SWIFT', 'HF·SM 3  RAPID'],
  longline: ['LONGLINE', 'HF·MR 12  PRECISION'],
  breaker: ['BREAKER', 'HF·PG 4  12 GA'],
  pulse: ['PULSE', 'HF·SA 2'],
  sunspear: ['SUNSPEAR', 'HELIOS · X-1'],
};
const LABEL_ORDER: WeaponId[] = ['meridian', 'swift', 'longline', 'breaker', 'pulse', 'sunspear'];
export function labelRegion(id: WeaponId): Rect {
  const i = LABEL_ORDER.indexOf(id);
  return [(i % 3) * 256, 160 + Math.floor(i / 3) * 64, 256, 56];
}

let atlasTex: THREE.CanvasTexture | null = null;
let printMat: THREE.MeshStandardMaterial | null = null;

function drawDial(x: CanvasRenderingContext2D, [ox, oy, w]: Rect, charge: boolean): void {
  const cx = ox + w / 2, cy = oy + w / 2, R = w / 2 - 1;
  x.save();
  const g = x.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
  g.addColorStop(0, charge ? '#2b2620' : '#fbf5ea');
  g.addColorStop(1, charge ? '#15120f' : '#e3d7c1');
  x.fillStyle = g;
  x.beginPath();
  x.arc(cx, cy, R, 0, Math.PI * 2);
  x.fill();
  const ink = charge ? '#f2c66d' : '#2a2622';
  // 270° sweep from lower-left (empty) to lower-right (full).
  const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
  // Warm red "low" arc.
  x.strokeStyle = charge ? '#7a5a2a' : '#c4552f';
  x.lineWidth = R * 0.1;
  x.beginPath();
  x.arc(cx, cy, R * 0.8, a0, a0 + sweep * 0.2);
  x.stroke();
  for (let i = 0; i <= 40; i++) {
    const a = a0 + (i / 40) * sweep;
    const major = i % 10 === 0;
    const mid = i % 5 === 0;
    x.strokeStyle = ink;
    x.lineWidth = major ? 3.4 : mid ? 2.2 : 1.2;
    const r1 = R * 0.9, r2 = R * (major ? 0.66 : mid ? 0.74 : 0.8);
    x.beginPath();
    x.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    x.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    x.stroke();
  }
  x.fillStyle = ink;
  x.font = `700 ${Math.round(R * 0.2)}px "JetBrains Mono", ui-monospace, monospace`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(charge ? 'FLUX' : 'AMMO', cx, cy + R * 0.42);
  x.font = `700 ${Math.round(R * 0.17)}px "JetBrains Mono", ui-monospace, monospace`;
  x.fillText('E', cx + Math.cos(a0) * R * 0.52, cy + Math.sin(a0) * R * 0.52);
  x.fillText('F', cx + Math.cos(a0 + sweep) * R * 0.52, cy + Math.sin(a0 + sweep) * R * 0.52);
  // Brass hub printed under the real needle pivot.
  x.fillStyle = charge ? '#e6b85a' : '#3a342e';
  x.beginPath();
  x.arc(cx, cy, R * 0.09, 0, Math.PI * 2);
  x.fill();
  x.restore();
}

function drawAtlas(): HTMLCanvasElement {
  const c = makeCanvas(ATLAS_W, ATLAS_H);
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.clearRect(0, 0, ATLAS_W, ATLAS_H);
  drawDial(x, REGION.dialAmmo, false);
  drawDial(x, REGION.dialCharge, true);
  // Diamond knurl (opaque rubber panel).
  {
    const [ox, oy, w, h] = REGION.knurl;
    x.fillStyle = '#25221f';
    x.fillRect(ox, oy, w, h);
    const step = 8;
    x.save();
    x.beginPath();
    x.rect(ox, oy, w, h);
    x.clip();
    for (let d = -h; d < w + h; d += step) {
      x.strokeStyle = 'rgba(255,240,220,0.13)';
      x.lineWidth = 1.4;
      x.beginPath();
      x.moveTo(ox + d, oy);
      x.lineTo(ox + d + h, oy + h);
      x.stroke();
      x.beginPath();
      x.moveTo(ox + d + h, oy);
      x.lineTo(ox + d, oy + h);
      x.stroke();
      x.strokeStyle = 'rgba(0,0,0,0.5)';
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(ox + d + 1.5, oy);
      x.lineTo(ox + d + h + 1.5, oy + h);
      x.stroke();
    }
    x.restore();
  }
  // Fire selector markings.
  {
    const [ox, oy, w, h] = REGION.selector;
    x.fillStyle = '#2a2622';
    x.font = '700 22px "JetBrains Mono", ui-monospace, monospace';
    x.textBaseline = 'middle';
    x.textAlign = 'center';
    x.fillText('S', ox + w * 0.15, oy + h / 2);
    x.fillStyle = '#c4552f';
    x.fillText('1', ox + w * 0.5, oy + h / 2);
    x.fillText('A', ox + w * 0.85, oy + h / 2);
    x.fillStyle = '#2a2622';
    x.beginPath();
    x.arc(ox + w * 0.33, oy + h / 2, 3, 0, Math.PI * 2);
    x.arc(ox + w * 0.67, oy + h / 2, 3, 0, Math.PI * 2);
    x.fill();
  }
  // Halcyon sunrise badge.
  {
    const [ox, oy, w] = REGION.badge;
    const cx = ox + w / 2, cy = oy + w / 2;
    x.fillStyle = '#2a2622';
    x.beginPath();
    x.arc(cx, cy, w / 2 - 2, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#f0b35b';
    x.beginPath();
    x.arc(cx, cy + 6, 13, Math.PI, 0);
    x.fill();
    x.strokeStyle = '#f0b35b';
    x.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * 17, cy + 6 + Math.sin(a) * 17);
      x.lineTo(cx + Math.cos(a) * 24, cy + 6 + Math.sin(a) * 24);
      x.stroke();
    }
    x.fillRect(cx - 20, cy + 9, 40, 3);
  }
  // Hazard chevrons.
  {
    const [ox, oy, w, h] = REGION.hazard;
    x.fillStyle = '#e8a33c';
    x.fillRect(ox, oy, w, h);
    x.fillStyle = '#26221e';
    for (let i = -2; i < 6; i++) {
      x.beginPath();
      x.moveTo(ox + i * 16, oy + h);
      x.lineTo(ox + i * 16 + 8, oy + h);
      x.lineTo(ox + i * 16 + 8 + h / 2, oy);
      x.lineTo(ox + i * 16 + h / 2, oy);
      x.closePath();
      x.fill();
    }
  }
  // Vent slot row (dark rounded slots, transparent between).
  {
    const [ox, oy, w, h] = REGION.vent;
    x.fillStyle = '#1b1917';
    for (let i = 0; i < 5; i++) {
      const sx = ox + 4 + i * ((w - 8) / 5);
      roundRect(x, sx, oy + 4, (w - 8) / 5 - 4, h - 8, 3);
      x.fill();
    }
  }
  // Scope scale / range ticks.
  {
    const [ox, oy, w, h] = REGION.scale;
    x.fillStyle = '#f1e7d4';
    for (let i = 0; i <= 24; i++) {
      const tall = i % 4 === 0;
      x.fillRect(ox + 4 + i * ((w - 8) / 24), oy + (tall ? 4 : 12), 1.6, tall ? h - 8 : h - 16);
    }
  }
  // Serial plate text.
  {
    const [ox, oy, , h] = REGION.serial;
    x.fillStyle = '#2a2622';
    x.font = '600 15px "JetBrains Mono", ui-monospace, monospace';
    x.textBaseline = 'middle';
    x.textAlign = 'left';
    x.fillText('SN 2090·0417', ox + 4, oy + h / 2);
  }
  // Speaker-style grille (Braun dots).
  {
    const [ox, oy, w, h] = REGION.grille;
    x.fillStyle = '#1d1b19';
    for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) {
      x.beginPath();
      x.arc(ox + 8 + gx * ((w - 16) / 7), oy + 8 + gy * ((h - 16) / 7), 4.2, 0, Math.PI * 2);
      x.fill();
    }
  }
  // Weapon model labels (Braun typography + orange square).
  for (const id of LABEL_ORDER) {
    const [ox, oy, , h] = labelRegion(id);
    x.fillStyle = '#d9722e';
    x.fillRect(ox + 4, oy + 8, 14, 14);
    x.fillStyle = '#2a2622';
    x.fillRect(ox + 4, oy + 28, 14, 3);
    x.font = '700 26px "Space Grotesk", "Helvetica Neue", Arial, sans-serif';
    x.textBaseline = 'middle';
    x.textAlign = 'left';
    x.fillText(LABELS[id][0], ox + 26, oy + h * 0.33);
    x.font = '500 14px "JetBrains Mono", ui-monospace, monospace';
    x.fillStyle = '#5d554c';
    x.fillText(LABELS[id][1], ox + 26, oy + h * 0.78);
  }
  return c;
}

function roundRect(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number): void {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}

/** Shared decal material (dial faces, labels, knurl panels, markings). */
export function printMaterial(): THREE.MeshStandardMaterial {
  if (printMat) return printMat;
  atlasTex = new THREE.CanvasTexture(drawAtlas());
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = 4;
  printMat = new THREE.MeshStandardMaterial({
    map: atlasTex,
    roughness: 0.5,
    metalness: 0,
    alphaTest: 0.4,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  printMat.name = 'weapon.print';
  // Fonts may finish loading after the first draw: redraw once they are ready.
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  fonts?.ready.then(() => {
    if (!atlasTex) return;
    atlasTex.image = drawAtlas();
    atlasTex.needsUpdate = true;
  }).catch(() => undefined);
  return printMat;
}

/** Maps a 0..1 plane UV into an atlas region (canvas y grows downward, texture v upward). */
export function remapUV(g: THREE.BufferGeometry, [rx, ry, rw, rh]: Rect): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, (rx + u * rw) / ATLAS_W, 1 - (ry + (1 - v) * rh) / ATLAS_H);
  }
  return g;
}

// ── Ammo screen (per-instance canvas, redrawn only when the count changes) ──

export const SCREEN_W = 128;
export const SCREEN_H = 64;
const AMBER = '#ffb347';
const AMBER_GHOST = 'rgba(255,179,71,0.085)';

// Seven-segment map: a b c d e f g.
const SEGS: Record<string, number> = {
  '0': 0b1111110, '1': 0b0110000, '2': 0b1101101, '3': 0b1111001, '4': 0b0110011,
  '5': 0b1011011, '6': 0b1011111, '7': 0b1110000, '8': 0b1111111, '9': 0b1111011, '-': 0b0000001,
};

function segPoly(x: CanvasRenderingContext2D, pts: number[], slant: number, ox: number, oy: number): void {
  x.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    const px = ox + pts[i] - pts[i + 1] * slant;
    const py = oy + pts[i + 1];
    if (i === 0) x.moveTo(px, py);
    else x.lineTo(px, py);
  }
  x.closePath();
  x.fill();
}

/** One slanted seven-segment digit; `mask` bits = lit segments (ghost segments drawn dim). */
function drawDigit(x: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, t: number, mask: number, lit: string): void {
  const hh = h / 2;
  const g = t * 0.5;
  // Hexagonal segment polygons (horizontal and vertical).
  const H = (y: number): number[] => [g + 1, y, g + t * 0.5 + 1, y - g, w - g - t * 0.5 - 1, y - g, w - g - 1, y, w - g - t * 0.5 - 1, y + g, g + t * 0.5 + 1, y + g];
  const V = (xx: number, y0: number, y1: number): number[] => [xx, y0 + 1, xx + g, y0 + g + 1, xx + g, y1 - g - 1, xx, y1 - 1, xx - g, y1 - g - 1, xx - g, y0 + g + 1];
  const segs = [H(g), V(w - g, g, hh), V(w - g, hh, h - g), H(h - g), V(g, hh, h - g), V(g, g, hh), H(hh)];
  const slant = 0.12;
  for (let i = 0; i < 7; i++) {
    const on = (mask >> (6 - i)) & 1;
    x.fillStyle = on ? lit : AMBER_GHOST;
    x.shadowBlur = on ? 6 : 0;
    segPoly(x, segs[i], slant, ox + h * slant, oy);
  }
  x.shadowBlur = 0;
}

/** Draws the amber VFD-style counter: two/three digits + a segmented fill bar. */
export function drawAmmoScreen(x: CanvasRenderingContext2D, mag: number, magSize: number, label: string): void {
  const W = SCREEN_W, H = SCREEN_H;
  x.fillStyle = '#120c08';
  x.fillRect(0, 0, W, H);
  // Subtle glass vignette + scanlines.
  const g = x.createRadialGradient(W * 0.4, H * 0.35, 4, W / 2, H / 2, W * 0.7);
  g.addColorStop(0, 'rgba(255,170,90,0.07)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,179,71,0.035)';
  for (let y = 0; y < H; y += 3) x.fillRect(0, y, W, 1);
  const n = Math.max(0, Math.min(999, Math.round(mag)));
  const digits = magSize >= 100 ? 3 : 2;
  const s = String(n).padStart(digits, ' ');
  const low = magSize > 0 && n / magSize <= 0.25;
  const lit = n <= 0 ? '#ff6a3d' : low ? '#ffc76b' : AMBER;
  x.shadowColor = lit;
  const dw = digits === 3 ? 26 : 30, dh = 40, t = 6.5;
  const total = digits * dw + (digits - 1) * 6;
  let ox = W - 12 - total;
  for (const ch of s) {
    drawDigit(x, ox, 6, dw, dh, t, ch === ' ' ? 0 : SEGS[ch] ?? 0, lit);
    ox += dw + 6;
  }
  // Tiny label + fill bar.
  x.fillStyle = 'rgba(255,179,71,0.55)';
  x.font = '700 10px "JetBrains Mono", ui-monospace, monospace';
  x.textBaseline = 'top';
  x.textAlign = 'left';
  x.fillText(label, 6, 8);
  const f = magSize > 0 ? Math.max(0, Math.min(1, n / magSize)) : 0;
  const cells = 10;
  for (let i = 0; i < cells; i++) {
    x.fillStyle = i < Math.ceil(f * cells - 1e-6) ? lit : AMBER_GHOST;
    x.fillRect(6 + i * 11.6, H - 11, 9, 5);
  }
}
