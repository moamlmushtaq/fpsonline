// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — map builder: solids → stylized static geometry.
//
// Every non-'hidden' collision solid becomes a chamfered box, wedge ramp,
// faceted rock, soft blob, balustrade, pipe run or glass pane, chosen from its
// `style` / surface tag (LOOKS). Colors are baked per vertex: palette color ×
// ambient occlusion (height AO on walls, contact AO around everything standing
// on a floor, darker bottoms, bleached tops) × low-frequency painterly
// variation, so many palette colors share one draw call per texture.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MaterialLibrary, QualitySettings } from '../../contracts';
import type { Solid } from '../../../shared/maps/types';
import type { SurfaceTag } from '../../../shared/types';
import { hashString, mulberry32 } from '../../../shared/math';
import { TAG_COLOR, textureForSurface, WOOD_COLOR, type Materials } from '../../engine/materials';
import { ENV } from '../../engine/palette';
import { TEX_TILE } from '../../engine/textures';
import { Bucket, chamferBox, lumpyBox, rampWedge, vnoise2, type Shade, type V3 } from './geometry';

// ── Style look-up ───────────────────────────────────────────────────────────

type Shape = 'box' | 'ground' | 'rock' | 'blob' | 'rail' | 'pipe' | 'glass' | 'house' | 'tank';

export interface Look {
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

export function lookFor(s: Solid): Look {
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

export function linearColor(hex: string): V3 {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

// ── Builder ─────────────────────────────────────────────────────────────────

export interface Ctx {
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
export class SolidGrid {
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

export function bucketFor(ctx: Ctx, tag: SurfaceTag, style: string | undefined, cast: boolean): Bucket {
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

export function makeShade(ctx: Ctx, s: Solid, base: V3, onGround: boolean, patches = false): Shade {
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
    // Edge highlights: chamfer bevels (normals between two axes) read as worn,
    // sun-bleached edges — strongest on top edges, a warm lift on vertical
    // corners — the painter's "catch light" that separates planes.
    let warm = 0;
    if (Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz)) < 0.93 && ny > -0.3) {
      const top = ny > 0.2;
      k *= top ? 1.22 : 1.12;
      warm = top ? 0.05 : 0.03;
    }
    // Low-frequency painterly variation (value + a faint warm/cool drift).
    const n = vnoise2(x * 0.14 + 3.1, z * 0.14 - 7.7) - 0.5;
    const w = vnoise2(x * 0.05 - 1.3, (z + y) * 0.05 + 9.2) - 0.5;
    k *= 1 + n * 0.12;
    return [col[0] * k * (1 + w * 0.06 + warm), col[1] * k * (1 + warm * 0.4), col[2] * k * (1 - w * 0.06 - warm * 0.6)];
  };
}

function solidColor(s: Solid, look: Look, rng: () => number): V3 {
  let hex = s.color ?? (look.colors ? look.colors[Math.floor(rng() * look.colors.length) % look.colors.length] : undefined);
  if (!hex) hex = s.tag === 'wood' ? WOOD_COLOR : TAG_COLOR[s.tag];
  const c = linearColor(hex);
  const t = (look.tone ?? 1) * (0.97 + rng() * 0.06);
  return [c[0] * t, c[1] * t, c[2] * t];
}

export function addSolid(ctx: Ctx, s: Solid, idx: number): void {
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
