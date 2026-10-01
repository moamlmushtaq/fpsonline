// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — procedural painterly canvas textures.
//
// All textures are generated once (lazily), cached, tileable and mostly
// NEUTRAL (light grey with faint warm/cool brush variation) so a single texture
// serves every palette color: materials multiply them by an ENV color.
//
// Recipe building blocks:
//  • periodic value-noise fbm computed at low resolution with wrap padding and
//    upscaled with bilinear filtering (fast on phones, seamless);
//  • wrapped brush strokes drawn with the 2D canvas API (painterly marks);
//  • a per-pixel grain pass through ImageData.
// Sizes stay ≤ 512 px (256 on the low preset).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { mulberry32 } from '../../shared/math';

export type TexName =
  | 'concrete'
  | 'plaster'
  | 'metal'
  | 'corrugated'
  | 'ceramic'
  | 'wood'
  | 'tile'
  | 'grass'
  | 'dirt'
  | 'sand'
  | 'rock'
  | 'snow'
  | 'foliage'
  | 'fabric'
  | 'knurl'
  | 'wear';

/** World meters covered by one texture repeat (keeps texel density consistent). */
export const TEX_TILE: Record<TexName, number> = {
  concrete: 4,
  plaster: 3,
  metal: 2.5,
  corrugated: 2.4,
  ceramic: 2,
  wood: 2.4,
  tile: 2,
  grass: 5,
  dirt: 5,
  sand: 6,
  rock: 5,
  snow: 6,
  foliage: 2.5,
  fabric: 1.5,
  knurl: 0.05,
  wear: 1,
};

type Ctx = CanvasRenderingContext2D;

const cache = new Map<string, THREE.CanvasTexture>();

export function proceduralTexture(name: TexName, size = 512, anisotropy = 1): THREE.CanvasTexture {
  const key = `${name}|${size}`;
  let t = cache.get(key);
  if (t) {
    if (anisotropy > t.anisotropy) {
      t.anisotropy = anisotropy;
      t.needsUpdate = true;
    }
    return t;
  }
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Ctx;
  RECIPES[name](ctx, size, mulberry32(hashName(name)));
  t = new THREE.CanvasTexture(canvas);
  t.name = `tex.${name}`;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  cache.set(key, t);
  return t;
}

export function disposeProceduralTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

let paintNoise: THREE.DataTexture | null = null;

/**
 * Tileable 128² RGBA "paint noise" sampled in WORLD space by the painterly
 * material chunk (engine/painterly.ts). Pure data (no DOM), built once:
 *  R  soft blotches (fbm, 4 cells/tile)        → large value mottling
 *  G  brush strokes (anisotropic fbm, 2×10)    → mid-scale stroke marks
 *  B  very low-frequency drift (2 cells/tile)  → warm/cool hue shift
 *  A  fine bristle grain (fbm, 16 cells/tile)  → small dabs
 */
export function paintNoiseTexture(): THREE.DataTexture {
  if (paintNoise) return paintNoise;
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const i = (y * N + x) * 4;
      const r = fbm(u, v, 4, 4, 501);
      // Strokes: lattice stretched 5:1 (period 2 across, 10 along) + a warp so
      // marks wander like a loaded brush instead of ruled lines.
      const w = fbm(u, v, 3, 2, 509) - 0.5;
      let g = 0;
      let amp = 0.5;
      let norm = 0;
      for (let o = 0; o < 3; o++) {
        const px = 2 << o;
        const py = 10 << o;
        g += pnoise2(u * px + w * 0.9, v * py, px, py, 517 + o * 13) * amp;
        norm += amp;
        amp *= 0.5;
      }
      g /= norm;
      const b = fbm(u, v, 2, 3, 523);
      const a = fbm(u, v, 16, 2, 541);
      // Stretch contrast around the mean (fbm clusters near 0.5).
      data[i] = clamp255((r - 0.5) * 1.9 * 255 + 128);
      data[i + 1] = clamp255((g - 0.5) * 2.2 * 255 + 128);
      data[i + 2] = clamp255((b - 0.5) * 2.0 * 255 + 128);
      data[i + 3] = clamp255((a - 0.5) * 2.0 * 255 + 128);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.name = 'tex.paintNoise';
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  paintNoise = t;
  return t;
}

/** Periodic value noise with independent x/y periods (tileable, anisotropic). */
function pnoise2(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const mx = (v: number): number => ((v % periodX) + periodX) % periodX;
  const my = (v: number): number => ((v % periodY) + periodY) % periodY;
  const a = lat(mx(x0), my(y0), seed);
  const b = lat(mx(x0 + 1), my(y0), seed);
  const c = lat(mx(x0), my(y0 + 1), seed);
  const d = lat(mx(x0 + 1), my(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ── Noise ───────────────────────────────────────────────────────────────────

/** Integer lattice hash → [0,1). */
function lat(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Periodic value noise: lattice wraps every `period` cells → tileable. */
function pnoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const m = (v: number): number => ((v % period) + period) % period;
  const a = lat(m(x0), m(y0), seed);
  const b = lat(m(x0 + 1), m(y0), seed);
  const c = lat(m(x0), m(y0 + 1), seed);
  const d = lat(m(x0 + 1), m(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Tileable fbm in [0,1] for u,v in [0,1). `base` = lattice cells across the tile. */
function fbm(u: number, v: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = base;
  for (let o = 0; o < octaves; o++) {
    sum += pnoise(u * p, v * p, p, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/**
 * Low-frequency layer: evaluates `fn(u,v)` → [r,g,b] (0..255) on a small grid
 * with one wrapped pixel of padding, then upscales it bilinearly over the whole
 * canvas. Seamless because the padding carries the wrapped neighbours.
 */
function lowFreq(ctx: Ctx, size: number, res: number, fn: (u: number, v: number) => [number, number, number]): void {
  const pad = res + 2;
  const c = makeCanvas(pad, pad);
  const cx = c.getContext('2d', { willReadFrequently: true }) as Ctx;
  const img = cx.createImageData(pad, pad);
  for (let y = 0; y < pad; y++) {
    for (let x = 0; x < pad; x++) {
      const u = (((x - 1 + res) % res) + 0.5) / res;
      const v = (((y - 1 + res) % res) + 0.5) / res;
      const [r, g, b] = fn(u, v);
      const i = (y * pad + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);
  const s = size / res;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Pixel centre (1.5) of the padded grid lands at destination s/2.
  ctx.drawImage(c, -s, -s, pad * s, pad * s);
}

/** Adds per-pixel grain (±amount) and optional warm/cool jitter. */
function grain(ctx: Ctx, size: number, amount: number, seed: number, tint = 0): void {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const n = (lat(p, 7, seed) - 0.5) * 2 * amount;
    const t = tint ? (lat(p, 13, seed) - 0.5) * tint : 0;
    d[i] = clamp255(d[i] + n + t);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n - t);
  }
  ctx.putImageData(img, 0, 0);
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function rgb(r: number, g: number, b: number, a = 1): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

/** Grey with a slight warm (t>0) or cool (t<0) bias; v in 0..255. */
function tone(v: number, t: number, a: number): string {
  return rgb(v + t * 6, v + t * 1.5, v - t * 6, a);
}

/** Draws `draw` at the 9 wrapped offsets that can touch the tile. */
function wrapped(size: number, x: number, y: number, reach: number, draw: (x: number, y: number) => void): void {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const px = x + ox * size;
      const py = y + oy * size;
      if (px + reach < 0 || py + reach < 0 || px - reach > size || py - reach > size) continue;
      draw(px, py);
    }
  }
}

/** A soft painterly brush stroke (tapered ellipse). */
function stroke(ctx: Ctx, size: number, x: number, y: number, len: number, width: number, angle: number, style: string): void {
  wrapped(size, x, y, len, (px, py) => {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.ellipse(0, 0, len * 0.5, width * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function line(ctx: Ctx, size: number, pts: [number, number][], width: number, style: string): void {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const reach = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  wrapped(size, cx, cy, reach, (px, py) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i][0] - cx + px;
      const y = pts[i][1] - cy + py;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
}

/** A wandering crack / scratch polyline. */
function crack(ctx: Ctx, size: number, rng: () => number, x: number, y: number, steps: number, stepLen: number, angle: number, width: number, style: string): void {
  const pts: [number, number][] = [[x, y]];
  let a = angle;
  for (let i = 0; i < steps; i++) {
    a += (rng() - 0.5) * 0.9;
    x += Math.cos(a) * stepLen;
    y += Math.sin(a) * stepLen;
    pts.push([x, y]);
  }
  line(ctx, size, pts, width, style);
}

// ── Recipes ─────────────────────────────────────────────────────────────────

type Recipe = (ctx: Ctx, size: number, rng: () => number) => void;

const RECIPES: Record<TexName, Recipe> = {
  concrete(ctx, s, rng) {
    // Sun-bleached base with large soft blotches.
    lowFreq(ctx, s, 64, (u, v) => {
      const n = fbm(u, v, 3, 4, 11);
      const b = 212 + (n - 0.5) * 46;
      const w = (fbm(u, v, 2, 2, 29) - 0.5) * 10;
      return [b + w, b + w * 0.4, b - w * 0.6];
    });
    const k = s / 512;
    // Brush-stroke noise: short, mostly horizontal marks.
    // Two scales: broad loaded-brush swipes, then short dabs.
    for (let i = 0; i < 160; i++) {
      const light = rng() < 0.5;
      stroke(ctx, s, rng() * s, rng() * s, (50 + rng() * 90) * k, (10 + rng() * 18) * k, (rng() - 0.5) * 0.35, tone(light ? 240 : 182, light ? 1 : -1, 0.07 + rng() * 0.07));
    }
    for (let i = 0; i < 900; i++) {
      const light = rng() < 0.5;
      const v = light ? 236 + rng() * 14 : 176 + rng() * 22;
      stroke(ctx, s, rng() * s, rng() * s, (10 + rng() * 34) * k, (2 + rng() * 5) * k, (rng() - 0.5) * 0.5, tone(v, light ? 1 : -1, 0.14 + rng() * 0.14));
    }
    // Form-work lines (every half tile vertically, every tile horizontally) + tie holes.
    for (const y of [0, s / 2]) {
      ctx.fillStyle = rgb(150, 146, 140, 0.35);
      ctx.fillRect(0, y, s, Math.max(1, 1.5 * k));
      ctx.fillStyle = rgb(250, 246, 238, 0.3);
      ctx.fillRect(0, y + 2 * k, s, Math.max(1, 1 * k));
    }
    ctx.fillStyle = rgb(150, 146, 140, 0.28);
    ctx.fillRect(0, 0, Math.max(1, 1.5 * k), s);
    for (let y = s / 4; y < s; y += s / 2) {
      for (let x = s / 8; x < s; x += s / 4) {
        ctx.fillStyle = rgb(120, 116, 112, 0.5);
        ctx.beginPath();
        ctx.arc(x, y, 3.2 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgb(245, 240, 232, 0.35);
        ctx.beginPath();
        ctx.arc(x + 1 * k, y + 1 * k, 3.2 * k, 0, Math.PI * 2);
        ctx.fill();
        // Rust-free rain streak below the tie hole.
        const g = ctx.createLinearGradient(0, y, 0, y + 60 * k);
        g.addColorStop(0, rgb(140, 136, 130, 0.16));
        g.addColorStop(1, rgb(140, 136, 130, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - 2 * k, y, 4 * k, 60 * k);
      }
    }
    // A few long weathering streaks from the form-work seams.
    for (let i = 0; i < 14; i++) {
      const x = rng() * s;
      const y = rng() < 0.5 ? 0 : s / 2;
      const h = (40 + rng() * 120) * k;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, rgb(150, 145, 138, 0.12));
      g.addColorStop(1, rgb(150, 145, 138, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, (3 + rng() * 8) * k, h);
    }
    grain(ctx, s, 7, 3, 2);
  },

  plaster(ctx, s, rng) {
    lowFreq(ctx, s, 64, (u, v) => {
      const n = fbm(u, v, 4, 4, 5);
      const b = 226 + (n - 0.5) * 30;
      return [b + 2, b, b - 2];
    });
    const k = s / 512;
    // Trowel marks: broad, faint, curved.
    for (let i = 0; i < 300; i++) {
      const light = rng() < 0.55;
      stroke(ctx, s, rng() * s, rng() * s, (30 + rng() * 60) * k, (8 + rng() * 14) * k, rng() * Math.PI, tone(light ? 246 : 192, light ? 1 : -1, 0.09 + rng() * 0.09));
    }
    for (let i = 0; i < 6; i++) crack(ctx, s, rng, rng() * s, rng() * s, 8 + ((rng() * 10) | 0), 7 * k, rng() * Math.PI * 2, 0.9 * k, rgb(120, 112, 104, 0.3));
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = tone(rng() < 0.5 ? 170 : 250, 0, 0.25);
      ctx.fillRect(rng() * s, rng() * s, 1.2 * k, 1.2 * k);
    }
    grain(ctx, s, 5, 7, 1);
  },

  metal(ctx, s, rng) {
    lowFreq(ctx, s, 32, (u, v) => {
      const n = fbm(u, v, 3, 3, 21);
      const b = 208 + (n - 0.5) * 36;
      return [b, b + 1, b + 3];
    });
    // Brushed grain: horizontal streaks.
    const img = ctx.getImageData(0, 0, s, s);
    const d = img.data;
    for (let y = 0; y < s; y++) {
      const row = (lat(y, 3, 99) - 0.5) * 10;
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        const n = row + (pnoise((x / s) * 8, (y / s) * (s / 2), s / 2, 5) - 0.5) * 14 + (lat(x, y, 4) - 0.5) * 6;
        d[i] = clamp255(d[i] + n);
        d[i + 1] = clamp255(d[i + 1] + n);
        d[i + 2] = clamp255(d[i + 2] + n);
      }
    }
    ctx.putImageData(img, 0, 0);
    const k = s / 256;
    // Soft wear patches (lighter) and a few scratches.
    for (let i = 0; i < 40; i++) stroke(ctx, s, rng() * s, rng() * s, (12 + rng() * 30) * k, (6 + rng() * 10) * k, rng() * Math.PI, tone(245, 1, 0.08));
    for (let i = 0; i < 18; i++) crack(ctx, s, rng, rng() * s, rng() * s, 3, (6 + rng() * 10) * k, rng() * Math.PI * 2, 0.7 * k, rgb(250, 250, 248, 0.35));
  },

  corrugated(ctx, s, rng) {
    RECIPES.metal(ctx, s, rng);
    // Vertical ribs: 8 per tile with a cosine shading profile.
    const img = ctx.getImageData(0, 0, s, s);
    const d = img.data;
    for (let x = 0; x < s; x++) {
      const ph = (x / s) * 8 * Math.PI * 2;
      const sh = Math.cos(ph) * 20 + Math.sin(ph) * 6;
      for (let y = 0; y < s; y++) {
        const i = (y * s + x) * 4;
        d[i] = clamp255(d[i] + sh);
        d[i + 1] = clamp255(d[i + 1] + sh);
        d[i + 2] = clamp255(d[i + 2] + sh);
      }
    }
    ctx.putImageData(img, 0, 0);
    // Faded weather streaks from the top edge.
    for (let i = 0; i < 16; i++) {
      const x = rng() * s;
      const h = s * (0.2 + rng() * 0.6);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, rgb(140, 120, 104, 0.22));
      g.addColorStop(1, rgb(140, 120, 104, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 2 + rng() * 6, h);
    }
  },

  ceramic(ctx, s, rng) {
    lowFreq(ctx, s, 32, (u, v) => {
      const n = fbm(u, v, 3, 3, 41);
      const b = 238 + (n - 0.5) * 14;
      return [b + 1, b, b - 1];
    });
    const k = s / 256;
    // Fine glaze crazing (very faint polygonal cracks).
    for (let i = 0; i < 70; i++) crack(ctx, s, rng, rng() * s, rng() * s, 4, (5 + rng() * 9) * k, rng() * Math.PI * 2, 0.5 * k, rgb(150, 144, 138, 0.16));
    // Soft glaze highlights.
    for (let i = 0; i < 30; i++) stroke(ctx, s, rng() * s, rng() * s, (20 + rng() * 40) * k, (6 + rng() * 10) * k, rng() * Math.PI, rgb(255, 255, 255, 0.06));
    grain(ctx, s, 2.5, 9);
  },

  wood(ctx, s, rng) {
    const planks = 4;
    const pw = s / planks;
    for (let p = 0; p < planks; p++) {
      const base = 196 + (rng() - 0.5) * 36;
      ctx.fillStyle = tone(base, 1, 1);
      ctx.fillRect(p * pw, 0, pw, s);
      // Grain lines: wobbly vertical strokes.
      for (let l = 0; l < 22; l++) {
        const x0 = p * pw + rng() * pw;
        const pts: [number, number][] = [];
        for (let y = -8; y <= s + 8; y += s / 16) pts.push([x0 + Math.sin(y * 0.02 + l) * 3 + (rng() - 0.5) * 1.5, y]);
        ctx.strokeStyle = tone(base - 30 - rng() * 30, 1, 0.18 + rng() * 0.18);
        ctx.lineWidth = 0.6 + rng() * 1.6;
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.stroke();
      }
      // Knot.
      if (rng() < 0.6) {
        const kx = p * pw + pw * (0.3 + rng() * 0.4);
        const ky = rng() * s;
        for (let r = 7; r > 1; r -= 2) {
          ctx.strokeStyle = tone(base - 50, 1, 0.25);
          ctx.beginPath();
          ctx.ellipse(kx, ky, r * 0.7, r * 1.4, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // Plank gap + sun-faded highlight on the edge.
      ctx.fillStyle = rgb(92, 80, 70, 0.8);
      ctx.fillRect(p * pw, 0, Math.max(1, s / 256), s);
      ctx.fillStyle = rgb(250, 244, 232, 0.18);
      ctx.fillRect(p * pw + s / 256, 0, Math.max(1, s / 200), s);
      // Nails.
      for (const ny of [s * 0.12, s * 0.62]) {
        ctx.fillStyle = rgb(90, 84, 80, 0.7);
        ctx.fillRect(p * pw + pw * 0.2, ny, 2, 2);
        ctx.fillRect(p * pw + pw * 0.8, ny, 2, 2);
      }
    }
    // Weathered (faded) wash.
    lowFreqOverlay(ctx, s, 16, 61, 0.22, [240, 234, 222]);
    grain(ctx, s, 6, 12, 2);
  },

  tile(ctx, s, rng) {
    const n = 8;
    const t = s / n;
    ctx.fillStyle = rgb(186, 182, 174);
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = 228 + (rng() - 0.5) * 22;
        const g = ctx.createLinearGradient(x * t, y * t, x * t + t, y * t + t);
        g.addColorStop(0, tone(v + 8, 1, 1));
        g.addColorStop(1, tone(v - 6, -1, 1));
        ctx.fillStyle = g;
        const gap = Math.max(1, t * 0.05);
        roundRect(ctx, x * t + gap, y * t + gap, t - gap * 2, t - gap * 2, t * 0.08);
        ctx.fill();
        if (rng() < 0.12) crack(ctx, s, rng, x * t + t * 0.5, y * t + t * 0.5, 3, t * 0.2, rng() * Math.PI * 2, 0.6, rgb(120, 116, 110, 0.35));
      }
    }
    grain(ctx, s, 3, 15);
  },

  grass(ctx, s, rng) {
    lowFreq(ctx, s, 64, (u, v) => {
      const n = fbm(u, v, 4, 4, 71);
      const dry = fbm(u, v, 2, 2, 73);
      const b = 196 + (n - 0.5) * 50;
      return [b + (dry - 0.5) * 40, b + 8, b - 20 - (dry - 0.5) * 20];
    });
    const k = s / 512;
    for (let i = 0; i < 2600; i++) {
      const warm = rng() < 0.45;
      const v = 150 + rng() * 100;
      const style = warm ? rgb(v + 26, v + 12, v - 40, 0.22) : rgb(v - 16, v + 10, v - 26, 0.22);
      stroke(ctx, s, rng() * s, rng() * s, (5 + rng() * 12) * k, (1.5 + rng() * 2.5) * k, -Math.PI / 2 + (rng() - 0.5) * 1.2, style);
    }
    grain(ctx, s, 6, 17, 3);
  },

  dirt(ctx, s, rng) {
    lowFreq(ctx, s, 64, (u, v) => {
      const n = fbm(u, v, 4, 4, 81);
      const b = 200 + (n - 0.5) * 56;
      return [b + 6, b, b - 10];
    });
    const k = s / 512;
    for (let i = 0; i < 700; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const r = (1.5 + rng() * 4) * k;
      stroke(ctx, s, x + r * 0.3, y + r * 0.4, r * 2.2, r * 1.6, rng() * Math.PI, rgb(110, 98, 88, 0.25));
      stroke(ctx, s, x, y, r * 2, r * 1.5, rng() * Math.PI, tone(170 + rng() * 70, 1, 0.5));
    }
    grain(ctx, s, 9, 19, 3);
  },

  sand(ctx, s, rng) {
    lowFreq(ctx, s, 64, (u, v) => {
      const n = fbm(u, v, 3, 4, 91);
      // Wind ripples: warped sine bands.
      const w = fbm(u, v, 2, 2, 93);
      const rip = Math.sin((v * 14 + w * 3.2) * Math.PI * 2) * 0.5 + 0.5;
      const b = 214 + (n - 0.5) * 30 + (rip - 0.5) * 18;
      return [b + 4, b, b - 6];
    });
    const k = s / 512;
    for (let i = 0; i < 120; i++) {
      stroke(ctx, s, rng() * s, rng() * s, (40 + rng() * 80) * k, (8 + rng() * 14) * k, (rng() - 0.5) * 0.3, tone(rng() < 0.5 ? 242 : 190, 1, 0.08));
    }
    for (let i = 0; i < 500; i++) {
      stroke(ctx, s, rng() * s, rng() * s, (8 + rng() * 22) * k, (2 + rng() * 4) * k, (rng() - 0.5) * 0.4, tone(rng() < 0.5 ? 244 : 186, 1, 0.12));
    }
    grain(ctx, s, 11, 21, 3);
  },

  rock(ctx, s, rng) {
    lowFreq(ctx, s, 64, (u, v) => {
      const n = fbm(u, v, 3, 5, 101);
      const b = 196 + (n - 0.5) * 60;
      return [b + 2, b, b - 2];
    });
    const k = s / 512;
    // Angular facets: light and shadow planes.
    for (let i = 0; i < 180; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const r = (14 + rng() * 40) * k;
      const light = rng() < 0.5;
      wrapped(s, x, y, r * 2, (px, py) => {
        ctx.fillStyle = tone(light ? 238 : 150, light ? 1 : -1, 0.12);
        ctx.beginPath();
        const sides = 4 + ((rng() * 3) | 0);
        for (let j = 0; j < sides; j++) {
          const a = (j / sides) * Math.PI * 2 + rng() * 0.5;
          const rr = r * (0.6 + rng() * 0.5);
          const qx = px + Math.cos(a) * rr;
          const qy = py + Math.sin(a) * rr * 0.7;
          if (j === 0) ctx.moveTo(qx, qy);
          else ctx.lineTo(qx, qy);
        }
        ctx.closePath();
        ctx.fill();
      });
    }
    for (let i = 0; i < 16; i++) crack(ctx, s, rng, rng() * s, rng() * s, 6 + ((rng() * 8) | 0), 10 * k, rng() * Math.PI * 2, 1.4 * k, rgb(90, 84, 80, 0.4));
    grain(ctx, s, 8, 23, 2);
  },

  snow(ctx, s, rng) {
    lowFreq(ctx, s, 64, (u, v) => {
      const n = fbm(u, v, 3, 4, 111);
      const b = 236 + (n - 0.5) * 26;
      // Cool blue in the hollows.
      const cool = (0.5 - n) * 18;
      return [b - cool, b - cool * 0.4, b + cool * 0.6];
    });
    const k = s / 512;
    for (let i = 0; i < 300; i++) stroke(ctx, s, rng() * s, rng() * s, (16 + rng() * 40) * k, (4 + rng() * 8) * k, (rng() - 0.5) * 0.6, rng() < 0.5 ? rgb(255, 255, 255, 0.12) : rgb(200, 210, 232, 0.1));
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rgb(255, 255, 255, 0.9);
      ctx.fillRect(rng() * s, rng() * s, 1.2 * k, 1.2 * k);
    }
    grain(ctx, s, 3, 25);
  },

  foliage(ctx, s, rng) {
    ctx.fillStyle = rgb(120, 136, 104);
    ctx.fillRect(0, 0, s, s);
    const k = s / 256;
    for (let i = 0; i < 900; i++) {
      const v = 120 + rng() * 120;
      const warm = rng() < 0.35;
      const style = warm ? rgb(v + 20, v + 14, v - 40, 0.55) : rgb(v - 30, v + 6, v - 36, 0.55);
      stroke(ctx, s, rng() * s, rng() * s, (6 + rng() * 10) * k, (3 + rng() * 4) * k, rng() * Math.PI, style);
    }
    grain(ctx, s, 8, 27, 3);
  },

  fabric(ctx, s, rng) {
    ctx.fillStyle = rgb(210, 206, 198);
    ctx.fillRect(0, 0, s, s);
    const n = 64;
    const t = s / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = rgb(180, 176, 170, 0.35);
      ctx.fillRect(i * t, 0, t * 0.45, s);
      ctx.fillStyle = rgb(236, 232, 224, 0.3);
      ctx.fillRect(0, i * t, s, t * 0.45);
    }
    lowFreqOverlay(ctx, s, 16, 131, 0.25, [230, 224, 214]);
    grain(ctx, s, 6, 29);
    void rng;
  },

  knurl(ctx, s) {
    ctx.fillStyle = rgb(170, 170, 168);
    ctx.fillRect(0, 0, s, s);
    const n = 8;
    const t = s / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const cx = x * t + t / 2;
        const cy = y * t + t / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - t * 0.46);
        ctx.lineTo(cx + t * 0.46, cy);
        ctx.lineTo(cx, cy + t * 0.46);
        ctx.lineTo(cx - t * 0.46, cy);
        ctx.closePath();
        const g = ctx.createLinearGradient(cx - t / 2, cy - t / 2, cx + t / 2, cy + t / 2);
        g.addColorStop(0, rgb(250, 250, 248));
        g.addColorStop(1, rgb(120, 120, 118));
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
  },

  wear(ctx, s, rng) {
    ctx.fillStyle = rgb(255, 255, 255);
    ctx.fillRect(0, 0, s, s);
    lowFreqOverlay(ctx, s, 16, 141, 0.12, [205, 200, 192]);
    const k = s / 256;
    for (let i = 0; i < 26; i++) crack(ctx, s, rng, rng() * s, rng() * s, 2 + ((rng() * 3) | 0), (4 + rng() * 10) * k, rng() * Math.PI * 2, 0.6 * k, rgb(150, 144, 136, 0.35));
    for (let i = 0; i < 20; i++) stroke(ctx, s, rng() * s, rng() * s, (4 + rng() * 10) * k, (2 + rng() * 4) * k, rng() * Math.PI, rgb(170, 162, 152, 0.18));
    grain(ctx, s, 3, 31);
  },
};

/** Blends a low-frequency mottled layer over the canvas at `alpha`. */
function lowFreqOverlay(ctx: Ctx, size: number, res: number, seed: number, alpha: number, col: [number, number, number]): void {
  const c = makeCanvas(size, size);
  const cx = c.getContext('2d', { willReadFrequently: true }) as Ctx;
  lowFreq(cx, size, res, (u, v) => {
    const n = fbm(u, v, 2, 3, seed);
    const f = 0.7 + n * 0.6;
    return [col[0] * f, col[1] * f, col[2] * f];
  });
  ctx.globalAlpha = alpha;
  ctx.drawImage(c, 0, 0);
  ctx.globalAlpha = 1;
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
