// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — map builder: MapDef → MapView.
//
//  1. Scene + atmosphere (sky, sun, fog, weather) + per-mood grading.
//  2. Static geometry from every non-'hidden' solid: chamfered boxes (crisp
//     highlight edges), wedge ramps, faceted rocks, soft blobs (hedges/snow),
//     balustrades, pipes, glass panes. World-scale box UVs (constant texel
//     density) and baked vertex colors: palette color × ambient occlusion
//     (height AO on walls, contact AO around everything standing on a floor,
//     darker bottoms, bleached tops) × low-frequency painterly variation.
//     Everything is merged into one mesh per texture/material (a dozen draws).
//  3. Backdrop: terrain skirt to the horizon, coast (sea toward the sun) or a
//     cloud sea with a mountain plinth; water plane at def.waterY.
//  4. Gameplay visuals: control zones, Sunspear pedestals, range targets.
//  5. Per-map decor: world/maps/<id>.ts default-exports a DecorBuilder and may
//     export `backdrop: BackdropOptions` to override step 3.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
  DecorBuilder,
  DecorContext,
  GradingSettings,
  MapDecor,
  MapRuntimeState,
  MapView,
  MaterialLibrary,
  QualitySettings,
  RenderEngine,
  ShowcasePose,
} from '../contracts';
import type { MapDef, MapLighting, Solid } from '../../shared/maps/types';
import type { SurfaceTag, TargetSnap, Team, Vec3, ZoneSnap } from '../../shared/types';
import { hashString, mulberry32 } from '../../shared/math';
import { createAtmosphere, type AtmosphereView } from '../engine/atmosphere';
import { Materials, TAG_COLOR, textureForSurface, WOOD_COLOR } from '../engine/materials';
import { ENV, NEUTRAL_OBJECTIVE, PICKUP_COLOR, UI, teamColors } from '../engine/palette';
import { TEX_TILE } from '../engine/textures';
import { WeaponModels, type WeaponModelView } from './weapon-models';

// ── Public extras ───────────────────────────────────────────────────────────

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

/** Grading derived from a map's lighting mood (applied by buildMapView). */
export function gradingForLighting(l: MapLighting): Partial<GradingSettings> {
  const tint = l.mood === 'sunset' ? '#ffeedd' : l.mood === 'golden' ? '#fff3df' : '#f4eefc';
  return {
    exposure: l.exposure,
    bloomStrength: l.bloom,
    saturation: l.mood === 'dusk' ? 1.1 : l.mood === 'golden' ? 1.16 : 1.13,
    tint,
    vignette: 0.34,
    grain: 0.035,
    shadowTint: ENV.shadowCool,
  };
}

// ── Geometry accumulation ──────────────────────────────────────────────────

type V3 = [number, number, number];
/** Returns a linear RGB multiplier for a vertex (position, normal). */
type Shade = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => V3;

class Bucket {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  constructor(
    readonly material: THREE.Material,
    readonly cast: boolean,
    readonly tile: number,
  ) {}

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, shade: Shade, ax: number): void {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    const t = this.tile;
    // Box projection by the face's dominant axis (world meters / tile).
    if (ax === 1) this.uv.push(x / t, z / t);
    else if (ax === 0) this.uv.push(z / t, y / t);
    else this.uv.push(x / t, y / t);
    const c = shade(x, y, z, nx, ny, nz);
    this.col.push(c[0], c[1], c[2]);
  }

  /** Triangle with a flat normal; winding fixed to face `out` (outward hint). */
  tri(a: V3, b: V3, c: V3, out: V3 | null, shade: Shade): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l;
    ny /= l;
    nz /= l;
    if (out && nx * out[0] + ny * out[1] + nz * out[2] < 0) {
      const t = b;
      b = c;
      c = t;
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const ax = Math.abs(ny) >= Math.abs(nx) && Math.abs(ny) >= Math.abs(nz) ? 1 : Math.abs(nx) >= Math.abs(nz) ? 0 : 2;
    this.vert(a[0], a[1], a[2], nx, ny, nz, shade, ax);
    this.vert(b[0], b[1], b[2], nx, ny, nz, shade, ax);
    this.vert(c[0], c[1], c[2], nx, ny, nz, shade, ax);
  }

  quad(a: V3, b: V3, c: V3, d: V3, out: V3, shade: Shade): void {
    this.tri(a, b, c, out, shade);
    this.tri(a, c, d, out, shade);
  }

  /** Appends an arbitrary geometry (any index/normals) transformed by `m`. */
  geometry(geo: THREE.BufferGeometry, m: THREE.Matrix4, shade: Shade, smooth = false): void {
    let g = geo.clone();
    if (!g.attributes.normal || smooth) g.computeVertexNormals();
    g.applyMatrix4(m);
    if (g.index) g = g.toNonIndexed();
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
      const ax = Math.abs(ny) >= Math.abs(nx) && Math.abs(ny) >= Math.abs(nz) ? 1 : Math.abs(nx) >= Math.abs(nz) ? 0 : 2;
      this.vert(p.getX(i), p.getY(i), p.getZ(i), nx, ny, nz, shade, ax);
    }
    g.dispose();
  }

  build(receive: boolean, castEnabled: boolean): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.castShadow = this.cast && castEnabled;
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }
}

// ── Noise helpers (deterministic, for painterly vertex variation) ───────────

function h2(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise2(x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h2(x0, y0), b = h2(x0 + 1, y0), c = h2(x0, y0 + 1), d = h2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function vnoise3(x: number, y: number, z: number): number {
  const a = vnoise2(x + z * 1.7, y - z * 0.6);
  const b = vnoise2(y * 1.3 - x * 0.4 + 11, z + 5.2);
  return (a + b) * 0.5;
}

// ── Style look-up ───────────────────────────────────────────────────────────

type Shape = 'box' | 'ground' | 'rock' | 'blob' | 'rail' | 'pipe' | 'glass' | 'house' | 'tank';

interface Look {
  shape: Shape;
  chamfer: number;
  colors?: readonly string[];
  /** Value multiplier on the base color. */
  tone?: number;
  cast?: boolean;
}

const PASTELS = [ENV.pastelPink, ENV.pastelMint, ENV.pastelYellow, ENV.pastelBlue, ENV.bone] as const;
const CONTAINERS = [ENV.terracottaFaded, ENV.sage, ENV.pastelBlue, ENV.rust, ENV.sand] as const;

const LOOKS: Record<string, Partial<Look>> = {
  ground: { shape: 'ground', chamfer: 0, cast: false },
  floor: { chamfer: 0.02 },
  wall: { chamfer: 0.05 },
  crate: { chamfer: 0.06, tone: 1.02 },
  pillar: { chamfer: 0.08 },
  trim: { chamfer: 0.03, colors: [ENV.terracottaFaded] },
  roof: { chamfer: 0.04, tone: 0.92 },
  stairs: { chamfer: 0.035 },
  ramp: { chamfer: 0 },
  glass: { shape: 'glass', chamfer: 0 },
  railing: { shape: 'rail', chamfer: 0.02 },
  pipe: { shape: 'pipe', chamfer: 0, colors: [ENV.terracottaFaded] },
  cliff: { shape: 'rock', chamfer: 0 },
  ridge: { shape: 'rock', chamfer: 0 },
  rock: { shape: 'rock', chamfer: 0 },
  shelf: { shape: 'rock', chamfer: 0 },
  berm: { shape: 'rock', chamfer: 0 },
  hedge: { shape: 'blob', chamfer: 0 },
  snowbank: { shape: 'blob', chamfer: 0 },
  house: { shape: 'house', chamfer: 0.05, colors: PASTELS },
  kiosk: { chamfer: 0.06, colors: [ENV.pastelYellow] },
  car: { chamfer: 0.22, colors: PASTELS },
  container: { chamfer: 0.05, colors: CONTAINERS },
  tank: { shape: 'tank', chamfer: 0.55, colors: [ENV.bone] },
  dome: { chamfer: 0.9, colors: [ENV.bone] },
  dish: { chamfer: 0.25, colors: [ENV.bone] },
  tower: { chamfer: 0.12, colors: [ENV.boneShade] },
  hangar: { chamfer: 0.08, colors: [ENV.boneShade] },
  crane: { chamfer: 0.08, colors: [ENV.pastelYellow] },
  pylon: { chamfer: 0.06, colors: [ENV.terracottaFaded] },
  pad: { chamfer: 0.06, colors: [ENV.boneShade] },
  tunnel: { chamfer: 0.04, tone: 0.8 },
  pool: { chamfer: 0.06, colors: [ENV.pastelBlue] },
  shelter: { chamfer: 0.04, colors: [ENV.pastelMint] },
  bench: { chamfer: 0.04, colors: [ENV.sage] },
  bin: { chamfer: 0.06, colors: [ENV.sage] },
  cover: { chamfer: 0.06, colors: [ENV.sage] },
  barrier: { chamfer: 0.08, colors: [ENV.bone] },
  marker: { chamfer: 0.05, colors: [ENV.bone] },
  lintel: { chamfer: 0.03 },
  parapet: { chamfer: 0.05 },
  catwalk: { chamfer: 0.03 },
  pier: { chamfer: 0.03 },
  carport: { chamfer: 0.04, colors: [ENV.bone] },
  lodge: { chamfer: 0.05 },
  garage: { chamfer: 0.05, colors: PASTELS },
  counter: { chamfer: 0.04 },
};

function lookFor(s: Solid): Look {
  let style = s.style ?? '';
  // Blockout fallback for decor-drawn solids: big flat slabs read as ground.
  if (style === 'hidden') style = s.max.y - s.min.y <= 1.05 && (s.max.x - s.min.x) * (s.max.z - s.min.z) > 200 ? 'ground' : '';
  const l = LOOKS[style] ?? {};
  let shape: Shape = l.shape ?? 'box';
  if (s.tag === 'rock' && shape === 'box') shape = 'rock';
  if (s.tag === 'glass') shape = 'glass';
  if (s.tag === 'foliage' && shape === 'box') shape = 'blob';
  if (s.tag === 'snow' && shape === 'box' && style !== 'ground') shape = 'blob';
  return { shape, chamfer: l.chamfer ?? 0.05, colors: l.colors, tone: l.tone, cast: l.cast };
}

function linearColor(hex: string): V3 {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

// ── Builder ─────────────────────────────────────────────────────────────────

interface Ctx {
  lib: MaterialLibrary;
  quality: QualitySettings;
  buckets: Map<string, Bucket>;
  solids: readonly Solid[];
  grid: SolidGrid;
  groundY: number;
  /** Draw 'hidden' solids too (fallback when a map has no decor module yet). */
  drawHidden: boolean;
}

/** Coarse XZ grid of solids for AO queries. */
class SolidGrid {
  private readonly cells = new Map<number, number[]>();
  constructor(readonly solids: readonly Solid[], readonly cell = 4, pad = 1.6) {
    solids.forEach((s, i) => {
      if (s.walkThrough) return;
      const x0 = Math.floor((s.min.x - pad) / cell), x1 = Math.floor((s.max.x + pad) / cell);
      const z0 = Math.floor((s.min.z - pad) / cell), z1 = Math.floor((s.max.z + pad) / cell);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4000) return; // giant ground slabs never occlude
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x * 73856093 ^ z * 19349663;
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(i);
      }
    });
  }
  near(x: number, z: number): number[] | undefined {
    return this.cells.get(Math.floor(x / this.cell) * 73856093 ^ Math.floor(z / this.cell) * 19349663);
  }
}

function bucketFor(ctx: Ctx, tag: SurfaceTag, style: string | undefined, cast: boolean): Bucket {
  const tex = textureForSurface(tag, style);
  const key = `${tag}|${tex}|${cast ? 1 : 0}`;
  let b = ctx.buckets.get(key);
  if (!b) {
    const lib = ctx.lib as MaterialLibrary & { surfaceVC?: Materials['surfaceVC'] };
    // Color lives in the vertex colors; the material stays white so many
    // palette colors share one draw call per texture.
    const mat = lib.surfaceVC ? lib.surfaceVC(tag, { style, color: '#ffffff' }) : lib.surface(tag, { style, color: '#ffffff' });
    b = new Bucket(mat, cast, tex ? TEX_TILE[tex] : 4);
    ctx.buckets.set(key, b);
  }
  return b;
}

/** Contact ambient occlusion at a point on an upward-facing surface at height y. */
function contactAO(ctx: Ctx, self: Solid | null, x: number, y: number, z: number): number {
  const list = ctx.grid.near(x, z);
  if (!list) return 1;
  let occ = 0;
  for (const i of list) {
    const s = ctx.solids[i];
    if (s === self || s.max.y < y + 0.25 || s.min.y > y + 0.4) continue;
    const dx = Math.max(s.min.x - x, 0, x - s.max.x);
    const dz = Math.max(s.min.z - z, 0, z - s.max.z);
    const d = Math.hypot(dx, dz);
    const r = THREE.MathUtils.clamp((s.max.y - y) * 0.55, 0.35, 1.5);
    if (d < r) {
      const k = 1 - d / r;
      occ += k * k * 0.6;
    }
  }
  return 1 - Math.min(occ, 0.55);
}

/** True when a solid rests on the ground or on another solid's top. */
function grounded(ctx: Ctx, s: Solid): boolean {
  if (s.min.y <= ctx.groundY + 0.06) return true;
  for (const o of ctx.solids) {
    if (o === s || Math.abs(o.max.y - s.min.y) > 0.06) continue;
    if (o.max.x > s.min.x && o.min.x < s.max.x && o.max.z > s.min.z && o.min.z < s.max.z) return true;
  }
  return false;
}

/** Painterly patch colors for large ground areas (two ENV neighbours per surface). */
const GROUND_PATCH: Partial<Record<SurfaceTag, [string, string]>> = {
  grass: [ENV.olive, ENV.sand],
  sand: [ENV.sandLight, ENV.terracottaFaded],
  concrete: [ENV.boneShade, ENV.sand],
  snow: [ENV.skyPale, ENV.bone],
  rock: [ENV.concreteDark, ENV.sand],
  dirt: [ENV.rust, ENV.sand],
  tile: [ENV.bone, ENV.pastelBlue],
};

function makeShade(ctx: Ctx, s: Solid, base: V3, onGround: boolean, patches = false): Shade {
  const baseY = s.min.y;
  const topY = s.max.y;
  const pc = patches ? GROUND_PATCH[s.tag] : undefined;
  const pa = pc ? linearColor(pc[0]) : null;
  const pb = pc ? linearColor(pc[1]) : null;
  const col: V3 = [0, 0, 0];
  return (x, y, z, nx, ny, nz) => {
    let k = 1;
    col[0] = base[0];
    col[1] = base[1];
    col[2] = base[2];
    if (ny > 0.5) {
      k *= 1.035 * contactAO(ctx, s, x, y, z);
      if (pa && pb) {
        // Two scales of soft patches: broad drifts + smaller clumps.
        const a = THREE.MathUtils.smoothstep(vnoise2(x * 0.045 + 11, z * 0.045 - 4), 0.45, 0.75) * 0.55;
        const b = THREE.MathUtils.smoothstep(vnoise2(x * 0.13 - 7, z * 0.13 + 2), 0.55, 0.85) * 0.4;
        for (let i = 0; i < 3; i++) col[i] = col[i] + (pa[i] - col[i]) * a + (pb[i] - col[i]) * b;
      }
    } else if (ny < -0.5) {
      k *= 0.58;
    } else {
      // Walls: dark contact band at the floor, bleached toward the top.
      const hgt = y - baseY;
      if (onGround) k *= 0.6 + 0.4 * THREE.MathUtils.smoothstep(hgt, 0, 1.3);
      k *= 0.95 + 0.09 * THREE.MathUtils.smoothstep(y, baseY, topY);
      if (ny > 0.1) k *= 1.1; // top chamfers catch light (worn, bleached edges)
    }
    // Low-frequency painterly variation (value + a faint warm/cool drift).
    const n = vnoise2(x * 0.14 + 3.1, z * 0.14 - 7.7) - 0.5;
    const w = vnoise2(x * 0.05 - 1.3, (z + y) * 0.05 + 9.2) - 0.5;
    k *= 1 + n * 0.12;
    return [col[0] * k * (1 + w * 0.06), col[1] * k, col[2] * k * (1 - w * 0.06)];
  };
}

function solidColor(s: Solid, look: Look, rng: () => number): V3 {
  let hex = s.color ?? (look.colors ? look.colors[Math.floor(rng() * look.colors.length) % look.colors.length] : undefined);
  if (!hex) hex = s.tag === 'wood' ? WOOD_COLOR : TAG_COLOR[s.tag];
  const c = linearColor(hex);
  const t = (look.tone ?? 1) * (0.97 + rng() * 0.06);
  return [c[0] * t, c[1] * t, c[2] * t];
}

/** Axis-aligned chamfered box with optional grid on the top face and a Y split on the sides. */
function chamferBox(b: Bucket, min: V3, max: V3, chamfer: number, shade: Shade, topGrid: number, splitY: number[], skipBottom: boolean): void {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const c = Math.max(0, Math.min(chamfer, size[0] * 0.3, size[1] * 0.3, size[2] * 0.3));
  const inner = (ax: number, sgn: number): number => (sgn > 0 ? max[ax] - c : min[ax] + c);
  const outer = (ax: number, sgn: number): number => (sgn > 0 ? max[ax] : min[ax]);
  const cuts = (ax: number, lo: number, hi: number, grid: number, extra: number[]): number[] => {
    const out = [lo];
    if (grid > 0 && hi - lo > grid * 1.5) {
      const n = Math.ceil((hi - lo) / grid);
      for (let i = 1; i < n; i++) out.push(lo + ((hi - lo) * i) / n);
    }
    for (const e of extra) if (e > lo + 0.05 && e < hi - 0.05) out.push(e);
    out.push(hi);
    return out.sort((p, q) => p - q);
  };
  const P = (ax: number, a: number, uAx: number, u: number, vAx: number, v: number): V3 => {
    const p: V3 = [0, 0, 0];
    p[ax] = a;
    p[uAx] = u;
    p[vAx] = v;
    return p;
  };

  // Faces.
  for (let ax = 0; ax < 3; ax++) {
    for (const sgn of [-1, 1]) {
      if (ax === 1 && sgn < 0 && skipBottom) continue;
      const uAx = ax === 0 ? 2 : 0;
      const vAx = ax === 1 ? 2 : 1;
      const out: V3 = [0, 0, 0];
      out[ax] = sgn;
      const us = cuts(uAx, min[uAx] + c, max[uAx] - c, ax === 1 && sgn > 0 ? topGrid : 0, []);
      const vs = cuts(vAx, min[vAx] + c, max[vAx] - c, ax === 1 && sgn > 0 ? topGrid : 0, ax !== 1 ? splitY : []);
      const a = outer(ax, sgn);
      for (let i = 0; i < us.length - 1; i++) {
        for (let j = 0; j < vs.length - 1; j++) {
          b.quad(P(ax, a, uAx, us[i], vAx, vs[j]), P(ax, a, uAx, us[i + 1], vAx, vs[j]), P(ax, a, uAx, us[i + 1], vAx, vs[j + 1]), P(ax, a, uAx, us[i], vAx, vs[j + 1]), out, shade);
        }
      }
    }
  }
  if (c <= 1e-4) return;
  // Edge bevels (12) — vertical ones split like the side faces.
  for (let a = 0; a < 3; a++) {
    for (let bx = a + 1; bx < 3; bx++) {
      const cAx = 3 - a - bx;
      for (const sa of [-1, 1]) {
        for (const sb of [-1, 1]) {
          if (skipBottom && ((a === 1 && sa < 0) || (bx === 1 && sb < 0))) continue;
          const out: V3 = [0, 0, 0];
          out[a] = sa;
          out[bx] = sb;
          const along = cuts(cAx, min[cAx] + c, max[cAx] - c, 0, cAx === 1 ? splitY : []);
          for (let i = 0; i < along.length - 1; i++) {
            const q = (aa: number, bb: number, cc: number): V3 => {
              const p: V3 = [0, 0, 0];
              p[a] = aa;
              p[bx] = bb;
              p[cAx] = cc;
              return p;
            };
            b.quad(
              q(outer(a, sa), inner(bx, sb), along[i]),
              q(inner(a, sa), outer(bx, sb), along[i]),
              q(inner(a, sa), outer(bx, sb), along[i + 1]),
              q(outer(a, sa), inner(bx, sb), along[i + 1]),
              out,
              shade,
            );
          }
        }
      }
    }
  }
  // Corner triangles (8).
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    if (skipBottom && sy < 0) continue;
    b.tri(
      [outer(0, sx), inner(1, sy), inner(2, sz)],
      [inner(0, sx), outer(1, sy), inner(2, sz)],
      [inner(0, sx), inner(1, sy), outer(2, sz)],
      [sx, sy, sz],
      shade,
    );
  }
}

function rampWedge(b: Bucket, s: Solid, shade: Shade): void {
  const r = s.ramp!;
  const { min, max } = s;
  const ax = r.axis === 'x' ? 0 : 2;
  const ox = ax === 0 ? 2 : 0;
  const lo = [min.x, min.y, min.z] as V3;
  const hi = [max.x, max.y, max.z] as V3;
  const highAt = r.dir > 0 ? hi[ax] : lo[ax];
  const lowAt = r.dir > 0 ? lo[ax] : hi[ax];
  const P = (a: number, o: number, y: number): V3 => {
    const p: V3 = [0, y, 0];
    p[ax] = a;
    p[ox] = o;
    return p;
  };
  const center: V3 = [(lo[0] + hi[0]) / 2, lo[1] + (hi[1] - lo[1]) * 0.33, (lo[2] + hi[2]) / 2];
  const outOf = (p: V3[]): V3 => {
    const cx = (p[0][0] + p[1][0] + p[2][0]) / 3 - center[0];
    const cy = (p[0][1] + p[1][1] + p[2][1]) / 3 - center[1];
    const cz = (p[0][2] + p[1][2] + p[2][2]) / 3 - center[2];
    return [cx, cy, cz];
  };
  // Slope (subdivided along the rise for AO/shading smoothness).
  const steps = Math.max(1, Math.ceil(Math.abs(highAt - lowAt) / 2));
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const a0 = lowAt + (highAt - lowAt) * t0;
    const a1 = lowAt + (highAt - lowAt) * t1;
    const y0 = lo[1] + (hi[1] - lo[1]) * t0;
    const y1 = lo[1] + (hi[1] - lo[1]) * t1;
    b.quad(P(a0, lo[ox], y0), P(a1, lo[ox], y1), P(a1, hi[ox], y1), P(a0, hi[ox], y0), [0, 1, 0], shade);
  }
  // Back face at the high edge.
  const back = [P(highAt, lo[ox], lo[1]), P(highAt, hi[ox], lo[1]), P(highAt, hi[ox], hi[1]), P(highAt, lo[ox], hi[1])];
  b.quad(back[0], back[1], back[2], back[3], outOf(back), shade);
  // Side triangles.
  for (const o of [lo[ox], hi[ox]]) {
    const t: V3[] = [P(lowAt, o, lo[1]), P(highAt, o, lo[1]), P(highAt, o, hi[1])];
    const out: V3 = [0, 0, 0];
    out[ox] = o === lo[ox] ? -1 : 1;
    b.tri(t[0], t[1], t[2], out, shade);
  }
}

/** Faceted (rock) or smooth (hedge/snow) displaced box. Displacement depends only on position → crack-free. */
function lumpyBox(b: Bucket, s: Solid, shade: Shade, smooth: boolean, amp: number, seg: number): void {
  const w = s.max.x - s.min.x, h = s.max.y - s.min.y, d = s.max.z - s.min.z;
  const g0 = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.round(w / seg)), Math.max(1, Math.round(h / seg)), Math.max(1, Math.round(d / seg)));
  g0.deleteAttribute('normal');
  g0.deleteAttribute('uv');
  const g = mergeVertices(g0, 1e-4);
  g0.dispose();
  const p = g.attributes.position as THREE.BufferAttribute;
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const cx = (s.min.x + s.max.x) / 2, cy = (s.min.y + s.max.y) / 2, cz = (s.min.z + s.max.z) / 2;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const wx = v.x + cx, wy = v.y + cy, wz = v.z + cz;
    const onBottom = v.y <= -hy + 1e-4;
    // Direction in "box space" so displacement grows outward from each face.
    const dir = new THREE.Vector3(v.x / hx, onBottom ? 0 : v.y / hy, v.z / hz);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    dir.normalize();
    const n = vnoise3(wx * 0.45, wy * 0.45, wz * 0.45);
    const n2 = vnoise3(wx * 1.3 + 7, wy * 1.3, wz * 1.3 - 3);
    const k = amp * (0.25 + 0.75 * n) + amp * 0.25 * (n2 - 0.5);
    // Rounded top edges for blobs: pull the top rim in slightly.
    const top = !onBottom && v.y > hy - 1e-4 ? 1 : 0;
    v.addScaledVector(dir, Math.max(0, k));
    if (smooth && top) v.y -= amp * 0.35 * (Math.abs(v.x / hx) + Math.abs(v.z / hz)) * 0.5;
    p.setXYZ(i, v.x, Math.max(-hy, v.y), v.z);
  }
  if (smooth) g.computeVertexNormals();
  const m = new THREE.Matrix4().makeTranslation(cx, cy, cz);
  if (smooth) b.geometry(g, m, shade, false);
  else {
    const flat = g.toNonIndexed();
    flat.computeVertexNormals();
    b.geometry(flat, m, shade, false);
    flat.dispose();
  }
  g.dispose();
}

function addSolid(ctx: Ctx, s: Solid, idx: number): void {
  if (s.style === 'hidden' && !ctx.drawHidden) return;
  const look = lookFor(s);
  const rng = mulberry32(hashString(`${idx}|${s.min.x}|${s.min.y}|${s.min.z}`));
  const base = solidColor(s, look, rng);
  const onGround = grounded(ctx, s);
  const shade = makeShade(ctx, s, base, onGround, look.shape === 'ground');
  const cast = look.cast ?? true;
  const lo: V3 = [s.min.x, s.min.y, s.min.z];
  const hi: V3 = [s.max.x, s.max.y, s.max.z];
  const h = hi[1] - lo[1];
  const splitY = onGround && h > 1.6 ? [lo[1] + 0.9] : [];
  const skipBottom = onGround;
  const topGrid = look.shape === 'ground' ? (ctx.quality.preset === 'low' ? 3 : 2) : (hi[0] - lo[0]) * (hi[2] - lo[2]) > 16 ? 2.5 : 0;

  if (s.ramp) {
    rampWedge(bucketFor(ctx, s.tag, s.style, cast), s, shade);
    return;
  }
  switch (look.shape) {
    case 'rock':
      lumpyBox(bucketFor(ctx, s.tag, s.style, cast), s, shade, false, Math.min(0.45, Math.min(hi[0] - lo[0], hi[2] - lo[2]) * 0.12), ctx.quality.preset === 'low' ? 2.4 : 1.5);
      return;
    case 'blob':
      lumpyBox(bucketFor(ctx, s.tag, s.style, cast), s, shade, true, Math.min(0.3, Math.min(hi[0] - lo[0], hi[2] - lo[2]) * 0.15), 0.8);
      return;
    case 'glass':
      addGlass(ctx, s, shade);
      return;
    case 'rail':
      addRail(ctx, s, base);
      return;
    case 'pipe':
      addPipe(ctx, s, base);
      return;
    case 'house': {
      const bk = bucketFor(ctx, s.tag, s.style, cast);
      chamferBox(bk, lo, hi, look.chamfer, shade, 0, splitY, skipBottom);
      // Flat modernist roof slab with a crisp white fascia and a small overhang.
      const o = 0.28;
      const roofShade = makeShade(ctx, { ...s, min: { ...s.min, y: hi[1] - 0.24 } }, linearColor(ENV.bone), false);
      chamferBox(bucketFor(ctx, 'plaster', 'trim', true), [lo[0] - o, hi[1] - 0.24, lo[2] - o], [hi[0] + o, hi[1], hi[2] + o], 0.04, roofShade, 2.5, [], false);
      // Plinth band.
      const plinthShade = makeShade(ctx, s, linearColor(ENV.concreteDark), onGround);
      chamferBox(bucketFor(ctx, 'concrete', 'wall', true), [lo[0] - 0.04, lo[1], lo[2] - 0.04], [hi[0] + 0.04, lo[1] + 0.35, hi[2] + 0.04], 0.02, plinthShade, 0, [], true);
      return;
    }
    case 'tank': {
      const bk = bucketFor(ctx, s.tag, s.style, cast);
      chamferBox(bk, lo, hi, Math.min(look.chamfer, (hi[0] - lo[0]) * 0.2), shade, 0, splitY, skipBottom);
      // Two faded hoop bands.
      const band = makeShade(ctx, s, linearColor(ENV.terracottaFaded), onGround);
      for (const f of [0.28, 0.72]) {
        const y = lo[1] + h * f;
        chamferBox(bk, [lo[0] - 0.03, y, lo[2] - 0.03], [hi[0] + 0.03, y + 0.35, hi[2] + 0.03], Math.min(look.chamfer, (hi[0] - lo[0]) * 0.2), band, 0, [], false);
      }
      return;
    }
    default:
      chamferBox(bucketFor(ctx, s.tag, s.style, cast), lo, hi, look.chamfer, shade, topGrid, splitY, skipBottom);
  }
}

function addGlass(ctx: Ctx, s: Solid, shade: Shade): void {
  const lo: V3 = [s.min.x, s.min.y, s.min.z];
  const hi: V3 = [s.max.x, s.max.y, s.max.z];
  const glassShade: Shade = () => [1, 1, 1];
  chamferBox(bucketFor(ctx, 'glass', 'glass', false), lo, hi, 0, glassShade, 0, [], false);
  // Slim metal frame around the pane's largest face.
  const sx = hi[0] - lo[0], sz = hi[2] - lo[2];
  const f = 0.06;
  const frame = bucketFor(ctx, 'metal', 'trim', true);
  const fs = makeShade(ctx, s, linearColor(ENV.metalDark), false);
  void shade;
  const bar = (a: V3, b: V3): void => chamferBox(frame, a, b, 0.01, fs, 0, [], false);
  const e = 0.01;
  if (sx >= sz) {
    bar([lo[0], lo[1], lo[2] - e], [hi[0], lo[1] + f, hi[2] + e]);
    bar([lo[0], hi[1] - f, lo[2] - e], [hi[0], hi[1], hi[2] + e]);
    bar([lo[0], lo[1], lo[2] - e], [lo[0] + f, hi[1], hi[2] + e]);
    bar([hi[0] - f, lo[1], lo[2] - e], [hi[0], hi[1], hi[2] + e]);
  } else {
    bar([lo[0] - e, lo[1], lo[2]], [hi[0] + e, lo[1] + f, hi[2]]);
    bar([lo[0] - e, hi[1] - f, lo[2]], [hi[0] + e, hi[1], hi[2]]);
    bar([lo[0] - e, lo[1], lo[2]], [hi[0] + e, hi[1], lo[2] + f]);
    bar([lo[0] - e, lo[1], hi[2] - f], [hi[0] + e, hi[1], hi[2]]);
  }
}

/** Balustrade: lower panel (blocks bullets like its collision) + rounded top rail + posts. */
function addRail(ctx: Ctx, s: Solid, base: V3): void {
  const lo: V3 = [s.min.x, s.min.y, s.min.z];
  const hi: V3 = [s.max.x, s.max.y, s.max.z];
  const alongX = hi[0] - lo[0] >= hi[2] - lo[2];
  const thick = alongX ? hi[2] - lo[2] : hi[0] - lo[0];
  const h = hi[1] - lo[1];
  const bk = bucketFor(ctx, s.tag, 'railing', true);
  const shade = makeShade(ctx, s, base, true);
  const mid = alongX ? (lo[2] + hi[2]) / 2 : (lo[0] + hi[0]) / 2;
  const pt = Math.min(thick, 0.12) / 2;
  if (!s.shootThrough) {
    const panelTop = lo[1] + h * 0.78;
    const pl: V3 = alongX ? [lo[0], lo[1], mid - pt] : [mid - pt, lo[1], lo[2]];
    const ph: V3 = alongX ? [hi[0], panelTop, mid + pt] : [mid + pt, panelTop, hi[2]];
    chamferBox(bucketFor(ctx, 'ceramic', 'trim', true), pl, ph, 0.02, makeShade(ctx, s, linearColor(ENV.bone), true), 0, [], true);
  }
  // Top rail.
  const len = alongX ? hi[0] - lo[0] : hi[2] - lo[2];
  const r = Math.max(0.035, Math.min(0.06, thick * 0.4));
  const cyl = new THREE.CylinderGeometry(r, r, len, 10, 1);
  const m = new THREE.Matrix4();
  if (alongX) m.makeRotationZ(Math.PI / 2);
  else m.makeRotationX(Math.PI / 2);
  m.setPosition(alongX ? (lo[0] + hi[0]) / 2 : mid, hi[1] - r, alongX ? mid : (lo[2] + hi[2]) / 2);
  bk.geometry(cyl, m, shade);
  // Posts.
  const n = Math.max(2, Math.round(len / 1.4) + 1);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = (alongX ? lo[0] : lo[2]) + 0.04 + t * (len - 0.08);
    const pl: V3 = alongX ? [a - 0.03, lo[1], mid - 0.03] : [mid - 0.03, lo[1], a - 0.03];
    const ph: V3 = alongX ? [a + 0.03, hi[1] - r, mid + 0.03] : [mid + 0.03, hi[1] - r, a + 0.03];
    chamferBox(bk, pl, ph, 0.01, shade, 0, [], true);
  }
  if (s.shootThrough) {
    const my = lo[1] + h * 0.45;
    const m2 = m.clone().setPosition(alongX ? (lo[0] + hi[0]) / 2 : mid, my, alongX ? mid : (lo[2] + hi[2]) / 2);
    bk.geometry(new THREE.CylinderGeometry(r * 0.6, r * 0.6, len, 8, 1), m2, shade);
  }
  cyl.dispose();
}

/** Pipe run along the longest horizontal axis (1–2 pipes) with flanges and saddles. */
function addPipe(ctx: Ctx, s: Solid, base: V3): void {
  const w = s.max.x - s.min.x, h = s.max.y - s.min.y, d = s.max.z - s.min.z;
  const alongX = w >= d;
  const len = alongX ? w : d;
  const cross = alongX ? d : w;
  const count = cross > h * 1.6 ? 2 : 1;
  const r = Math.min(h, cross / count) * 0.46;
  const bk = bucketFor(ctx, 'metal', 'pipe', true);
  const shade = makeShade(ctx, s, base, true);
  const flangeShade = makeShade(ctx, s, linearColor(ENV.metalLight), true);
  const cyl = new THREE.CylinderGeometry(r, r, len, ctx.quality.preset === 'low' ? 10 : 16, 1);
  const flange = new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.12, ctx.quality.preset === 'low' ? 10 : 16, 1);
  const rot = alongX ? new THREE.Matrix4().makeRotationZ(Math.PI / 2) : new THREE.Matrix4().makeRotationX(Math.PI / 2);
  for (let i = 0; i < count; i++) {
    const off = count === 1 ? 0 : (i - 0.5) * (cross / 2);
    const cxz = alongX ? (s.min.z + s.max.z) / 2 + off : (s.min.x + s.max.x) / 2 + off;
    const y = s.min.y + r + 0.02;
    const m = rot.clone().setPosition(alongX ? (s.min.x + s.max.x) / 2 : cxz, y, alongX ? cxz : (s.min.z + s.max.z) / 2);
    bk.geometry(cyl, m, shade);
    const nf = Math.max(2, Math.round(len / 3) + 1);
    for (let f = 0; f < nf; f++) {
      const a = (alongX ? s.min.x : s.min.z) + 0.1 + (f / (nf - 1)) * (len - 0.2);
      const mf = rot.clone().setPosition(alongX ? a : cxz, y, alongX ? cxz : a);
      bk.geometry(flange, mf, flangeShade);
    }
  }
  // Saddles at both ends.
  const sadShade = makeShade(ctx, s, linearColor(ENV.concreteDark), true);
  for (const e of [0.4, len - 0.4]) {
    const a = (alongX ? s.min.x : s.min.z) + e;
    const lo: V3 = alongX ? [a - 0.15, s.min.y, s.min.z] : [s.min.x, s.min.y, a - 0.15];
    const hi: V3 = alongX ? [a + 0.15, s.min.y + r * 0.9, s.max.z] : [s.max.x, s.min.y + r * 0.9, a + 0.15];
    chamferBox(bucketFor(ctx, 'concrete', 'wall', true), lo, hi, 0.02, sadShade, 0, [], true);
  }
  cyl.dispose();
  flange.dispose();
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
uniform vec3 uSky;
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
  // Two drifting wave layers → a stylized normal.
  float e = 0.35;
  vec2 q1 = p * 0.35 + vec2(uTime * 0.05, uTime * 0.03);
  vec2 q2 = p * 0.9 - vec2(uTime * 0.07, -uTime * 0.04);
  float hC = vn(q1) + vn(q2) * 0.5;
  float hX = vn(q1 + vec2(e, 0.0)) + vn(q2 + vec2(e, 0.0)) * 0.5;
  float hZ = vn(q1 + vec2(0.0, e)) + vn(q2 + vec2(0.0, e)) * 0.5;
  vec3 n = normalize(vec3((hC - hX) * 0.9, 1.0, (hC - hZ) * 0.9));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 col = mix(uShallow, uDeep, clamp(0.35 + hC * 0.25, 0.0, 1.0));
  col = mix(col, uSky, clamp(fres * 0.9 + 0.12, 0.0, 1.0));
  // Sun glint: sharp, broken highlights (painterly sparkle streak).
  vec3 r = reflect(-v, n);
  float g = pow(max(dot(r, uSunDir), 0.0), 180.0);
  float sparkle = step(0.55, vn(p * 3.0 + uTime * 0.6));
  col += uSun * (g * 6.0 * (0.4 + sparkle) + pow(max(dot(r, uSunDir), 0.0), 12.0) * 0.18);
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
        uDeep: { value: new THREE.Color(ENV.water).multiplyScalar(0.55) },
        uShallow: { value: new THREE.Color(ENV.water).lerp(new THREE.Color(ENV.skyPale), 0.25) },
        uSky: { value: new THREE.Color(l.skyHorizon).lerp(new THREE.Color(l.fogColor), 0.5) },
        uSun: { value: new THREE.Color(l.sunColor) },
        uSunDir: { value: new THREE.Vector3(l.sunDir.x, l.sunDir.y, l.sunDir.z).normalize() },
        uTime: { value: 0 },
        uOpacity: { value: 0.72 },
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

function dominantGround(def: MapDef): { tag: SurfaceTag; y: number } {
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

function buildBackdrop(ctx: Ctx, def: MapDef, opts: BackdropOptions, scene: THREE.Scene, tickers: ((dt: number) => void)[]): THREE.Object3D[] {
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

// ── Decor loading ───────────────────────────────────────────────────────────

// world/maps/<id>.ts (contract) — or world/maps/<id>/index.ts for multi-file decor.
const DECOR_MODULES = import.meta.glob(['./maps/*.ts', './maps/*/index.ts']);

interface DecorModule {
  default?: DecorBuilder;
  backdrop?: BackdropOptions;
}

async function loadDecor(id: string): Promise<DecorModule | null> {
  const loader = DECOR_MODULES[`./maps/${id}.ts`] ?? DECOR_MODULES[`./maps/${id}/index.ts`];
  if (!loader) return null;
  try {
    return (await loader()) as DecorModule;
  } catch (err) {
    console.error(`[map] decor module for '${id}' failed to load`, err);
    return null;
  }
}

// ── MapView ─────────────────────────────────────────────────────────────────

class MapViewImpl implements MapView {
  readonly scene = new THREE.Scene();
  readonly atmosphere: AtmosphereView;
  decor: MapDecor | null = null;
  readonly tickers: ((dt: number) => void)[] = [];
  gameplay: GameplayVisuals | null = null;
  private readonly owned: THREE.Object3D[] = [];
  private tickObjects: THREE.Object3D[] = [];

  constructor(readonly def: MapDef, quality: QualitySettings) {
    this.scene.name = `map.${def.id}`;
    this.atmosphere = createAtmosphere(this.scene, def.lighting, quality);
  }

  own(o: THREE.Object3D): void {
    this.owned.push(o);
  }

  collectTickers(root: THREE.Object3D): void {
    this.tickObjects = [];
    root.traverse((o) => {
      if (typeof o.userData.halcyonTick === 'function') this.tickObjects.push(o);
    });
  }

  update(dt: number, s: MapRuntimeState): void {
    this.atmosphere.update(dt, s.camera, this.def.lighting.stars * THREE.MathUtils.clamp(s.matchProgress, 0, 1));
    for (const t of this.tickers) t(dt);
    for (const o of this.tickObjects) (o.userData.halcyonTick as (dt: number, scene: THREE.Scene) => void)(dt, this.scene);
    this.gameplay?.update(dt, s);
    this.decor?.update?.(dt, s);
  }

  showcase(kind: 'intro' | 'outro' | 'keyart'): ShowcasePose {
    const custom = this.decor?.showcase?.(kind);
    if (custom) return custom;
    return defaultShowcase(this.def, kind);
  }

  dispose(): void {
    this.decor?.dispose?.();
    this.gameplay?.dispose();
    for (const o of this.tickObjects) (o.userData.dispose as (() => void) | undefined)?.();
    for (const o of this.owned) {
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        // Shared library materials are owned by MaterialLibrary; only dispose our own.
        const mat = m.material as THREE.Material | undefined;
        if (mat && (mat as THREE.ShaderMaterial).isShaderMaterial) mat.dispose();
      });
      o.removeFromParent();
    }
    this.atmosphere.dispose();
    this.scene.clear();
  }
}

/** Does the segment a→b pass through any solid (except those containing `ignore`)? */
function segmentBlocked(def: MapDef, a: Vec3, b: Vec3, ignore: Vec3): boolean {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  for (const s of def.solids) {
    if (s.style === 'ground') continue;
    if (ignore.x >= s.min.x && ignore.x <= s.max.x && ignore.z >= s.min.z && ignore.z <= s.max.z && ignore.y <= s.max.y + 0.5) continue;
    let t0 = 0;
    let t1 = 1;
    let hit = true;
    for (const ax of ['x', 'y', 'z'] as const) {
      const o = a[ax];
      const dd = d[ax];
      const lo = s.min[ax] - 0.3;
      const hi = s.max[ax] + 0.3;
      if (Math.abs(dd) < 1e-9) {
        if (o < lo || o > hi) {
          hit = false;
          break;
        }
      } else {
        let ta = (lo - o) / dd;
        let tb = (hi - o) / dd;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) {
          hit = false;
          break;
        }
      }
    }
    if (hit) return true;
  }
  return false;
}

/** Keeps the foreground clear: no solid within `clear` m of the first `len` m of the view ray. */
function nearClear(def: MapDef, a: Vec3, b: Vec3, len: number, clear: number): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const dl = Math.hypot(dx, dy, dz) || 1;
  for (let t = 0; t <= len; t += 2) {
    const x = a.x + (dx / dl) * t, y = a.y + (dy / dl) * t, z = a.z + (dz / dl) * t;
    for (const s of def.solids) {
      if (s.style === 'ground' || (s.max.x - s.min.x) * (s.max.z - s.min.z) > 4000) continue;
      const ex = Math.max(s.min.x - x, 0, x - s.max.x);
      const ey = Math.max(s.min.y - y, 0, y - s.max.y);
      const ez = Math.max(s.min.z - z, 0, z - s.max.z);
      if (Math.hypot(ex, ey, ez) < clear) return false;
    }
  }
  return true;
}

function insideSolid(def: MapDef, p: Vec3): boolean {
  return def.solids.some((s) => p.x > s.min.x - 0.5 && p.x < s.max.x + 0.5 && p.z > s.min.z - 0.5 && p.z < s.max.z + 0.5 && p.y > s.min.y - 0.5 && p.y < s.max.y + 1.2);
}

export function defaultShowcase(def: MapDef, kind: 'intro' | 'outro' | 'keyart'): ShowcasePose {
  const b = def.bounds;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const ext = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
  const sun = def.lighting.sunDir;
  const sunAz = Math.atan2(sun.z, sun.x);
  if (kind === 'outro') {
    const r = def.rocket;
    const dx = cx - r.pos.x;
    const dz = cz - r.pos.z;
    const dl = Math.hypot(dx, dz) || 1;
    const dist = 38 * r.scale + 22;
    return {
      pos: { x: r.pos.x + (dx / dl) * dist + (dz / dl) * dist * 0.35, y: r.pos.y + 10 * r.scale + 4, z: r.pos.z + (dz / dl) * dist - (dx / dl) * dist * 0.35 },
      target: { x: r.pos.x, y: r.pos.y + 16 * r.scale, z: r.pos.z },
      fov: 50,
    };
  }
  // Hero landmark: the tallest structure-type landmark near the middle.
  const heroes = def.landmarks.filter((l) => l.icon !== 'sun' && l.icon !== 'sea' && Math.abs(l.pos.x - cx) < ext && Math.abs(l.pos.z - cz) < ext);
  heroes.sort((p, q) => Math.hypot(p.pos.x - cx, p.pos.z - cz) - Math.hypot(q.pos.x - cx, q.pos.z - cz));
  const hero = heroes[0]?.pos ?? { x: cx, y: 6, z: cz };
  if (kind === 'intro') {
    const a = sunAz + Math.PI * 0.75;
    return {
      pos: { x: hero.x + Math.cos(a) * ext * 0.95, y: ext * 0.42, z: hero.z + Math.sin(a) * ext * 0.95 },
      target: { x: hero.x, y: Math.min(hero.y * 0.3, 6), z: hero.z },
      fov: 55,
    };
  }
  // Key art: low, heroic 3/4 angle with the low sun raking across the frame,
  // lots of painted sky above a low horizon. Search for an unobstructed spot.
  const target = { x: hero.x, y: THREE.MathUtils.clamp(hero.y * 0.55, 3, 16), z: hero.z };
  const offsets = [0.62, 0.52, 0.72, 0.42, 0.82, -0.62, -0.52, -0.72, 0.3, -0.3];
  const dists = [0.62, 0.5, 0.78, 0.4];
  const heights = [3.2, 6, 10, 15];
  for (const hgt of heights) {
    for (const dist of dists) {
      for (const off of offsets) {
        const a = sunAz + Math.PI * off;
        const pos = { x: hero.x + Math.cos(a) * ext * dist, y: hgt, z: hero.z + Math.sin(a) * ext * dist };
        if (Math.abs(pos.x - cx) > ext * 0.95 || Math.abs(pos.z - cz) > ext * 0.95) continue;
        if (insideSolid(def, pos) || segmentBlocked(def, pos, target, target)) continue;
        if (!nearClear(def, pos, target, 14, 2.5)) continue;
        return { pos, target, fov: 48 };
      }
    }
  }
  const a = sunAz + Math.PI * 0.62;
  return { pos: { x: hero.x + Math.cos(a) * ext * 0.6, y: 18, z: hero.z + Math.sin(a) * ext * 0.6 }, target, fov: 48 };
}

/**
 * Builds the complete visual map. Also applies the map's grading (exposure,
 * bloom, tint) to the engine — callers showing a different scene afterwards
 * should call engine.setGrading themselves.
 */
export async function buildMapView(def: MapDef, ctx: { engine: RenderEngine; materials: MaterialLibrary }): Promise<MapView> {
  const quality = ctx.engine.quality;
  if (ctx.materials instanceof Materials) ctx.materials.setQuality(quality);
  const view = new MapViewImpl(def, quality);
  ctx.engine.setGrading(gradingForLighting(def.lighting));

  const mod = await loadDecor(def.id);

  const g = dominantGround(def);
  const bctx: Ctx = {
    lib: ctx.materials,
    quality,
    buckets: new Map(),
    solids: def.solids,
    grid: new SolidGrid(def.solids),
    groundY: g.y,
    drawHidden: !mod?.default,
  };
  if (!mod?.default && def.solids.some((x) => x.style === 'hidden')) {
    console.info(`[map] '${def.id}' has no decor module yet — drawing 'hidden' solids as blockout.`);
  }
  def.solids.forEach((s, i) => addSolid(bctx, s, i));
  const backdrop = buildBackdrop(bctx, def, mod?.backdrop ?? {}, view.scene, view.tickers);
  for (const o of backdrop) view.own(o);

  const staticRoot = new THREE.Group();
  staticRoot.name = 'map.static';
  const castEnabled = quality.shadows !== 'off';
  for (const b of bctx.buckets.values()) {
    const m = b.build(true, castEnabled);
    if (m) staticRoot.add(m);
  }
  view.scene.add(staticRoot);
  view.own(staticRoot);

  view.gameplay = new GameplayVisuals(def, view.scene, ctx.materials, quality);

  // Per-map decor.
  const decorRoot = new THREE.Group();
  decorRoot.name = 'map.decor';
  view.scene.add(decorRoot);
  view.own(decorRoot);
  if (mod?.default) {
    const dctx: DecorContext = {
      def,
      scene: view.scene,
      root: decorRoot,
      quality,
      materials: ctx.materials,
      rng: mulberry32(hashString(`decor|${def.id}`)),
    };
    try {
      view.decor = mod.default(dctx);
    } catch (err) {
      console.error(`[map] decor builder for '${def.id}' threw`, err);
    }
  }
  view.collectTickers(view.scene);
  return view;
}

export type { Vec3 };

// ── Gameplay visuals: control zones, Sunspear pedestals, range targets ──────

const ZONE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ZONE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uArcColor;
uniform float uArc;
uniform float uPulse;
uniform float uTime;
uniform float uScale;
varying vec2 vUv;
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uScale;
  float r = length(p);
  float a = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
  float aa = fwidth(r) * 1.5;
  float ring = 1.0 - smoothstep(0.012, 0.012 + aa, abs(r - 1.0));
  // Dial ticks (every 5°, long at quadrants) just inside the ring.
  float tickA = fract(a * 72.0);
  float tick = (1.0 - smoothstep(0.08, 0.16, abs(tickA - 0.5) * 2.0 - 0.8)) * step(0.92, r) * step(r, 0.965);
  float major = step(abs(fract(a * 4.0 + 0.5) - 0.5), 0.006) * step(0.86, r) * step(r, 0.99);
  // Capture progress arc outside the ring.
  float band = 1.0 - smoothstep(0.022, 0.022 + aa, abs(r - 1.065));
  float arc = band * step(a, uArc);
  float track = band * 0.18;
  // Soft inner fill, stronger near the rim.
  float fill = smoothstep(0.2, 1.0, r) * step(r, 1.0) * 0.16;
  float pulse = 1.0 + uPulse * 0.45 * sin(uTime * 9.0);
  vec3 col = uColor * (ring + tick * 0.7 + major + fill + track) * pulse + uArcColor * arc * 1.6;
  float alpha = clamp(max(max(ring, tick * 0.7), max(max(major, fill), max(arc, track))), 0.0, 1.0);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col * 1.4, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BEAM_VERT = /* glsl */ `
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  vT = uv.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float edge = pow(facing, 1.5);
  float fade = pow(1.0 - vT, 2.2) * smoothstep(0.0, 0.03, vT);
  float streak = 0.8 + 0.2 * sin(vT * 30.0 - uTime * 2.0);
  float a = edge * fade * streak * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function beamMaterial(color: THREE.Color, intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uIntensity: { value: intensity }, uTime: { value: 0 } },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function glowSpriteTexture(lib: MaterialLibrary): THREE.Texture {
  return lib.canvasTexture('fx.softglow', 64, 64, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
}

interface ZoneView {
  id: string;
  group: THREE.Group;
  ringMat: THREE.ShaderMaterial;
  beamMat: THREE.ShaderMaterial;
  letter: THREE.Sprite;
  baseY: number;
}

interface PickupView {
  id: string;
  respawn: number;
  group: THREE.Group;
  weapon: WeaponModelView;
  weaponPivot: THREE.Group;
  ring: THREE.Mesh;
  glow: THREE.Sprite;
  beamMat: THREE.ShaderMaterial;
  timerMat: THREE.ShaderMaterial;
  timer: THREE.Mesh;
  lit: number;
}

interface TargetView {
  id: number;
  group: THREE.Group;
  board: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  down: number;
  lastHp: number;
  flash: number;
  wobble: number;
}

class GameplayVisuals {
  private readonly root = new THREE.Group();
  private readonly zones: ZoneView[] = [];
  private readonly pickups: PickupView[] = [];
  private readonly targets = new Map<number, TargetView>();
  private readonly own: { dispose(): void }[] = [];
  private time = 0;
  private readonly weapons: WeaponModels;

  constructor(private readonly def: MapDef, scene: THREE.Scene, private readonly lib: MaterialLibrary, private readonly quality: QualitySettings) {
    this.root.name = 'map.gameplay';
    scene.add(this.root);
    this.weapons = new WeaponModels(lib);
    for (const z of def.zones) this.buildZone(z.id, z.center, z.radius);
    for (const p of def.pickups) this.buildPickup(p.id, p.pos, p.respawn);
    for (const t of def.targets ?? []) this.buildTarget(t.id, t.pos, t.yaw);
  }

  // Zones ------------------------------------------------------------------
  private buildZone(id: string, c: Vec3, radius: number): void {
    const group = new THREE.Group();
    group.position.set(c.x, c.y, c.z);
    group.visible = false;
    const margin = 1.25;
    const plane = new THREE.PlaneGeometry(radius * 2 * margin, radius * 2 * margin).rotateX(-Math.PI / 2);
    const ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(NEUTRAL_OBJECTIVE) },
        uArcColor: { value: new THREE.Color(NEUTRAL_OBJECTIVE) },
        uArc: { value: 0 },
        uPulse: { value: 0 },
        uTime: { value: 0 },
        uScale: { value: margin },
      },
      vertexShader: ZONE_VERT,
      fragmentShader: ZONE_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const ring = new THREE.Mesh(plane, ringMat);
    ring.position.y = 0.05;
    ring.renderOrder = 5;
    group.add(ring);
    const col = new THREE.CylinderGeometry(radius, radius, 9, this.quality.preset === 'low' ? 24 : 40, 1, true).translate(0, 4.5, 0);
    const beamMat = beamMaterial(new THREE.Color(NEUTRAL_OBJECTIVE), 0.22);
    const beam = new THREE.Mesh(col, beamMat);
    beam.renderOrder = 6;
    group.add(beam);
    const tex = this.lib.canvasTexture(`zone.letter.${id}`, 128, 128, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.strokeStyle = '#ffffff';
      x.lineWidth = 5;
      x.beginPath();
      x.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
      x.stroke();
      x.lineWidth = 2;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        x.beginPath();
        x.moveTo(w / 2 + Math.cos(a) * w * 0.34, h / 2 + Math.sin(a) * w * 0.34);
        x.lineTo(w / 2 + Math.cos(a) * w * (i % 6 === 0 ? 0.29 : 0.32), h / 2 + Math.sin(a) * w * (i % 6 === 0 ? 0.29 : 0.32));
        x.stroke();
      }
      x.fillStyle = '#ffffff';
      x.font = '700 62px "Space Grotesk", system-ui, sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(id, w / 2, h / 2 + 3);
    });
    const letterMat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(NEUTRAL_OBJECTIVE), transparent: true, depthWrite: false });
    const letter = new THREE.Sprite(letterMat);
    letter.scale.setScalar(1.7);
    letter.position.y = 4.2;
    letter.renderOrder = 7;
    group.add(letter);
    this.root.add(group);
    this.zones.push({ id, group, ringMat, beamMat, letter, baseY: 4.2 });
    this.own.push(plane, ringMat, col, beamMat, letterMat);
  }

  private updateZones(dt: number, zs: ZoneSnap[]): void {
    const show = zs.length > 0;
    for (const z of this.zones) {
      const snap = zs.find((s) => s.id === z.id);
      z.group.visible = show && !!snap;
      if (!snap) continue;
      const owner = snap.owner === 2 ? null : teamColors(snap.owner as Team);
      const base = owner ? owner.primary : NEUTRAL_OBJECTIVE;
      const arcTeam: Team = snap.progress < 0 ? 0 : 1;
      const u = z.ringMat.uniforms;
      (u.uColor.value as THREE.Color).set(base);
      (u.uArcColor.value as THREE.Color).set(teamColors(arcTeam).primary);
      u.uArc.value = Math.abs(snap.progress);
      u.uPulse.value += ((snap.contested ? 1 : 0) - u.uPulse.value) * Math.min(1, dt * 6);
      u.uTime.value = this.time;
      (z.beamMat.uniforms.uColor.value as THREE.Color).set(base);
      z.beamMat.uniforms.uTime.value = this.time;
      z.beamMat.uniforms.uIntensity.value = (owner ? 0.3 : 0.16) * (1 + u.uPulse.value * 0.6 * Math.sin(this.time * 9));
      z.letter.material.color.set(base).multiplyScalar(1.3);
      z.letter.position.y = z.baseY + Math.sin(this.time * 1.4 + z.id.charCodeAt(0)) * 0.12;
    }
  }

  // Pickups ----------------------------------------------------------------
  private buildPickup(id: string, pos: Vec3, respawn: number): void {
    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);
    const seg = this.quality.preset === 'low' ? 16 : 32;
    const profile = [
      [0, 0], [0.62, 0], [0.62, 0.07], [0.56, 0.11], [0.44, 0.16], [0.4, 0.5], [0.5, 0.56], [0.52, 0.62], [0, 0.62],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const ped = new THREE.LatheGeometry(profile, seg);
    const pedestal = new THREE.Mesh(ped, this.lib.painted(ENV.bone, { roughness: 0.4 }));
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    group.add(pedestal);
    const ringGeo = new THREE.TorusGeometry(0.47, 0.022, 8, seg).rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, this.lib.glow(PICKUP_COLOR, 2.6));
    ring.position.y = 0.63;
    group.add(ring);
    // Respawn timer ring (flat, shows fill while unavailable).
    const timerGeo = new THREE.RingGeometry(0.28, 0.36, seg).rotateX(-Math.PI / 2);
    const timerMat = new THREE.ShaderMaterial({
      uniforms: { uFill: { value: 0 }, uColor: { value: new THREE.Color(PICKUP_COLOR).multiplyScalar(1.6) } },
      vertexShader: ZONE_VERT,
      fragmentShader: /* glsl */ `
        uniform float uFill; uniform vec3 uColor; varying vec2 vUv;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float a = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
          float on = step(a, uFill);
          gl_FragColor = vec4(uColor * (0.25 + on * 0.75), 0.35 + on * 0.6);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    const timer = new THREE.Mesh(timerGeo, timerMat);
    timer.position.y = 0.625;
    timer.visible = false;
    group.add(timer);
    const weaponPivot = new THREE.Group();
    weaponPivot.position.y = 1.25;
    group.add(weaponPivot);
    const weapon = this.weapons.create('sunspear', 'factory', 'world');
    weapon.root.scale.setScalar(1.25);
    weapon.root.position.z = 0.2;
    weapon.setCharge(0.6);
    weaponPivot.add(weapon.root);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture(this.lib), color: new THREE.Color(PICKUP_COLOR).multiplyScalar(1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(2.2);
    glow.position.y = 1.25;
    group.add(glow);
    const beamGeo = new THREE.CylinderGeometry(0.42, 0.5, 3.4, 24, 1, true).translate(0, 0.62 + 1.7, 0);
    const beamMat = beamMaterial(new THREE.Color(PICKUP_COLOR), 0.35);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.renderOrder = 6;
    group.add(beam);
    this.root.add(group);
    this.pickups.push({ id, respawn, group, weapon, weaponPivot, ring, glow, beamMat, timerMat, timer, lit: 1 });
    this.own.push(ped, ringGeo, timerGeo, timerMat, glow.material, beamGeo, beamMat, weapon);
  }

  private updatePickups(dt: number, snaps: MapRuntimeState['pickups']): void {
    for (const p of this.pickups) {
      const s = snaps.find((x) => x.id === p.id);
      const available = s ? s.available : true;
      p.lit += ((available ? 1 : 0) - p.lit) * Math.min(1, dt * 5);
      p.weaponPivot.visible = p.lit > 0.05;
      p.weaponPivot.scale.setScalar(Math.max(0.001, p.lit));
      p.weaponPivot.rotation.y += dt * 0.9;
      p.weaponPivot.position.y = 1.25 + Math.sin(this.time * 1.6) * 0.06;
      p.glow.material.opacity = 0.25 + p.lit * (0.6 + Math.sin(this.time * 3) * 0.1);
      p.glow.position.y = p.weaponPivot.position.y;
      p.beamMat.uniforms.uIntensity.value = 0.05 + p.lit * 0.32;
      p.beamMat.uniforms.uTime.value = this.time;
      p.ring.visible = p.lit > 0.5;
      p.timer.visible = !available;
      if (s && !available) p.timerMat.uniforms.uFill.value = THREE.MathUtils.clamp(1 - s.respawnIn / Math.max(1, p.respawn), 0, 1);
    }
  }

  // Targets ----------------------------------------------------------------
  private buildTarget(id: number, pos: Vec3, yaw: number): void {
    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);
    group.rotation.y = yaw;
    const metal = this.lib.painted(ENV.metalDark, { roughness: 0.5, metalness: 0.3 });
    const baseGeo = targetGeo('base', () => new THREE.BoxGeometry(0.7, 0.06, 0.42).translate(0, 0.03, 0));
    const postGeo = targetGeo('post', () => new THREE.CylinderGeometry(0.035, 0.045, 0.3, 10).translate(0, 0.2, 0.06));
    const hingeGeo = targetGeo('hinge', () => new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10).rotateZ(Math.PI / 2).translate(0, 0.34, 0.06));
    for (const g of [baseGeo, postGeo, hingeGeo]) {
      const m = new THREE.Mesh(g, metal);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    const board = new THREE.Group();
    board.position.set(0, 0.34, 0.06);
    group.add(board);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(ENV.bone), roughness: 0.38, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 });
    const bodyGeo = targetGeo('board', silhouetteGeometry);
    const body = new THREE.Mesh(bodyGeo, mat);
    body.castShadow = true;
    board.add(body);
    const decalTex = this.lib.canvasTexture('target.rings', 128, 256, drawTargetRings);
    const decalMat = targetDecalMaterial(decalTex);
    const decal = new THREE.Mesh(targetGeo('decal', () => new THREE.PlaneGeometry(0.72, 1.44).translate(0, 0.72, 0)), decalMat);
    decal.position.z = -0.032;
    decal.rotation.y = Math.PI;
    board.add(decal);
    this.root.add(group);
    this.targets.set(id, { id, group, board, mat, down: 0, lastHp: 1, flash: 0, wobble: 0 });
    this.own.push(mat);
  }

  private updateTargets(dt: number, snaps: TargetSnap[]): void {
    const k = 1 - Math.exp(-dt * 14);
    for (const t of this.targets.values()) {
      const s = snaps.find((x) => x.id === t.id);
      const alive = s ? s.alive : true;
      if (s) {
        t.group.position.x += (s.x - t.group.position.x) * k;
        t.group.position.y += (s.y - t.group.position.y) * k;
        t.group.position.z += (s.z - t.group.position.z) * k;
        t.group.rotation.y = s.yaw;
        if (s.hp < t.lastHp - 1e-3 && alive) {
          t.flash = 1;
          t.wobble = 1;
        }
        t.lastHp = s.hp;
      }
      // Flip back (away from the shooter) when eliminated; spring up on respawn.
      const target = alive ? 0 : 1;
      t.down += (target - t.down) * Math.min(1, dt * (alive ? 6 : 10));
      t.wobble = Math.max(0, t.wobble - dt * 3);
      t.board.rotation.x = t.down * 1.45 + Math.sin(this.time * 28) * t.wobble * 0.06;
      t.flash = Math.max(0, t.flash - dt * 6);
      t.mat.emissiveIntensity = t.flash * 0.9;
    }
  }

  update(dt: number, s: MapRuntimeState): void {
    this.time += dt;
    if (this.zones.length) this.updateZones(dt, s.zones);
    if (this.pickups.length) this.updatePickups(dt, s.pickups);
    if (this.targets.size) this.updateTargets(dt, s.targets);
  }

  dispose(): void {
    for (const o of this.own) o.dispose();
    this.root.removeFromParent();
  }
}

const targetGeoCache = new Map<string, THREE.BufferGeometry>();
function targetGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = targetGeoCache.get(key);
  if (!g) targetGeoCache.set(key, (g = make()));
  return g;
}

/** Humanoid ceramic target board (local origin at the hinge, front faces −Z). */
function silhouetteGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.2, 0);
  s.lineTo(-0.21, 0.6);
  s.quadraticCurveTo(-0.3, 0.86, -0.3, 1.02);
  s.quadraticCurveTo(-0.3, 1.13, -0.2, 1.15);
  s.lineTo(-0.075, 1.17);
  // Head: arc from the left neck point over the top to the right neck point.
  const cx = 0, cy = 1.35, r = 0.2;
  const aL = Math.atan2(1.19 - cy, -0.07);
  const aR = Math.atan2(1.19 - cy, 0.07);
  const sweep = aL - aR + Math.PI * 2;
  for (let i = 0; i <= 20; i++) {
    const a = aL - (sweep * i) / 20;
    s.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  s.lineTo(0.075, 1.17);
  s.lineTo(0.2, 1.15);
  s.quadraticCurveTo(0.3, 1.13, 0.3, 1.02);
  s.quadraticCurveTo(0.3, 0.86, 0.21, 0.6);
  s.lineTo(0.2, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -0.02);
  return g;
}

function drawTargetRings(x: CanvasRenderingContext2D, w: number, h: number): void {
  x.clearRect(0, 0, w, h);
  // Canvas is 0.72 × 1.44 m; board-local (u, v) → pixels.
  const px = (u: number): number => ((u + 0.36) / 0.72) * w;
  const py = (v: number): number => h - (v / 1.44) * h;
  const ring = (cx: number, cy: number, rad: number, lw: number, col: string): void => {
    x.strokeStyle = col;
    x.lineWidth = lw;
    x.beginPath();
    x.arc(px(cx), py(cy), (rad / 0.72) * w, 0, Math.PI * 2);
    x.stroke();
  };
  ring(0, 0.84, 0.17, 5, UI.accent);
  ring(0, 0.84, 0.1, 4, UI.accent);
  x.fillStyle = UI.accent;
  x.beginPath();
  x.arc(px(0), py(0.84), 5, 0, Math.PI * 2);
  x.fill();
  ring(0, 1.35, 0.11, 4, UI.headshot);
  x.fillStyle = 'rgba(40,36,32,0.35)';
  x.fillRect(px(-0.19), py(0.12), px(0.19) - px(-0.19), 3);
}

function targetDecalMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
}
