// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel foliage cards: ONE alpha-tested, swaying mesh for every
// painted leaf card in the suburb (tree canopies, hedges, wall ivy, roof-edge
// fringes, ferns and glowing undergrowth).
//
//  • One canvas atlas (hand-painted leaf clumps, ivy mass, hanging fringe,
//    fern fan) + a matching emissive "buds" mask: chartreuse / pale-gold /
//    soft-pink bioluminescent buds glow in the ivy and fern tips (bloom source
//    on medium/high; HDR-ish emissive on low). Never teal / orange / violet.
//  • Canopy cards carry SPHERICAL normals (from the crown's centre): the crown
//    lights as one soft painted volume — sunlit warm top, cool shaded belly —
//    instead of a heap of paper planes. Back faces keep the same normal (no
//    double-sided flip), so a card never goes black when seen from behind.
//  • Vertex colours tint each card (palette greens, sun-bleached yellows,
//    autumn mustard) and darken the inner / lower parts (cheap AO).
//  • A per-vertex sway weight shares the kit's wind uniform (gentle sway).
//  • Shadows: alpha-cut depth material (dappled shadows on medium/high; the
//    low preset's one-time baked sun shadow honours the cutout too).
//
// Cost: ONE draw call (+ its shadow pass) for all foliage cards on the map.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MaterialLibrary } from '../../../contracts';
import { type DecorKit, type RGB, swayMaterial } from './kit';

/** Atlas layout (logical 1024² canvas): [x, y, w, h] in pixels. */
const AW = 1024;
export const CARD = {
  leaf: [0, 0, 512, 512],
  ivy: [512, 0, 512, 512],
  fringe: [0, 512, 512, 512],
  fern: [512, 512, 512, 256],
  blossom: [512, 768, 256, 256],
  clover: [768, 768, 256, 256],
} as const satisfies Record<string, readonly [number, number, number, number]>;
export type CardRegion = (typeof CARD)[keyof typeof CARD];

// ── Atlas painting ──────────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Bud colours (sRGB strings) — chartreuse, pale gold, soft pink. */
const BUDS = ['214,246,140', '255,236,180', '255,200,216'];

function bud(ctx: Ctx, x: number, y: number, r: number, rnd: () => number, mask: boolean): void {
  const c = rnd();
  const col = BUDS[c < 0.55 ? 0 : c < 0.85 ? 1 : 2];
  // Soft halo then a bright core (the halo also lifts the albedo a little).
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
  g.addColorStop(0, `rgba(${col},1)`);
  g.addColorStop(0.35, `rgba(${col},0.9)`);
  g.addColorStop(1, `rgba(${col},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
  ctx.fill();
  if (!mask) return;
  ctx.fillStyle = `rgba(${col},1)`;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * One painted leaf: a pointed oval in a mid tone, a lighter sunlit half
 * (upper-left) and a thin vein — two-tone strokes read as brushwork.
 */
function paintLeaf(ctx: Ctx, x: number, y: number, len: number, wid: number, ang: number, base: [number, number, number], light: number, mask: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const [r, g, b] = base;
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(wid, len * 0.45, 0, len);
    ctx.quadraticCurveTo(-wid, len * 0.45, 0, 0);
    ctx.closePath();
  };
  if (mask) {
    ctx.fillStyle = '#000';
    path();
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
  path();
  ctx.fill();
  // Sunlit half.
  ctx.fillStyle = `rgba(${Math.min(255, r * light + 12) | 0},${Math.min(255, g * light + 16) | 0},${Math.min(255, b * light + 8) | 0},0.85)`;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-wid, len * 0.45, 0, len);
  ctx.quadraticCurveTo(-wid * 0.15, len * 0.5, 0, 0);
  ctx.fill();
  ctx.strokeStyle = `rgba(${(r * 0.72) | 0},${(g * 0.75) | 0},${(b * 0.7) | 0},0.55)`;
  ctx.lineWidth = Math.max(0.6, wid * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, len * 0.08);
  ctx.lineTo(0, len * 0.85);
  ctx.stroke();
  ctx.restore();
}

/** Mid-tone leaf colour around a neutral light green (the vertex colour tints it). */
function leafTone(rnd: () => number, depth: number): [number, number, number] {
  const v = 150 + rnd() * 70 - depth * 70;
  const warm = rnd();
  return [v * (0.86 + warm * 0.1), v * (0.97 + warm * 0.03), v * (0.78 + (1 - warm) * 0.1)];
}

function drawLeafClump(ctx: Ctx, ox: number, oy: number, s: number, mask: boolean): void {
  const rnd = seeded(91);
  const cx = ox + s / 2;
  const cy = oy + s / 2;
  // Irregular lobed silhouette: radius as a sum of a few harmonics.
  const lobes = [rnd() * 6, rnd() * 6, rnd() * 6];
  const radius = (a: number): number => s * (0.4 + 0.045 * Math.sin(a * 3 + lobes[0]) + 0.035 * Math.sin(a * 5 + lobes[1]) + 0.02 * Math.sin(a * 8 + lobes[2]));
  // Back layer (darker, denser) then front leaves; deeper leaves darker.
  const n = 520;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * radius(a) * (0.98 - (1 - t) * 0.12);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.96;
    const edge = rr / radius(a);
    const depth = (1 - t) * 0.7 + (1 - edge) * 0.25;
    const len = s * (0.05 + rnd() * 0.035);
    // Leaves point outward from the clump, drooping a little.
    const ang = Math.atan2(Math.sin(a), Math.cos(a)) - Math.PI / 2 + (rnd() - 0.5) * 1.3 + 0.25;
    paintLeaf(ctx, x, y, len, len * (0.36 + rnd() * 0.14), ang, leafTone(rnd, depth), 1.12, mask);
  }
}

function drawIvy(ctx: Ctx, ox: number, oy: number, s: number, mask: boolean): void {
  const rnd = seeded(37);
  // Woody stems climbing from the bottom edge, branching upward.
  if (!mask) {
    const rs = seeded(38);
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      let x = ox + s * (0.08 + rs() * 0.84);
      let y = oy + s;
      ctx.strokeStyle = `rgba(${96 + rs() * 20},${88 + rs() * 16},${64 + rs() * 12},1)`;
      ctx.lineWidth = 2.2 + rs() * 1.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const top = oy + s * (0.45 + rs() * 0.25);
      while (y > top) {
        x += (rs() - 0.5) * s * 0.08;
        y -= s * (0.05 + rs() * 0.04);
        ctx.lineTo(Math.max(ox + 4, Math.min(ox + s - 4, x)), y);
      }
      ctx.stroke();
    }
  }
  // Leaf mass: a rounded, cloud-like mound (union of overlapping circles on a
  // base band) — ivy spreading over a wall, never a spiky cone.
  const circles = Array.from({ length: 8 }, (_, i) => {
    const x = 0.12 + (i / 7) * 0.76 + (rnd() - 0.5) * 0.08;
    const r = 0.16 + rnd() * 0.14;
    return { x, y: 0.42 + rnd() * (0.36 - r * 0.6), r };
  });
  const inside = (u: number, v: number): boolean => {
    const feather = Math.min(1, u * 8, (1 - u) * 8);
    if (v < 0.42 * feather) return true;
    for (const c of circles) if ((u - c.x) * (u - c.x) + ((v - c.y) * (v - c.y)) / 1.1 < c.r * c.r * feather) return true;
    return false;
  };
  const sample = (): [number, number] => {
    for (let k = 0; k < 40; k++) {
      const u = 0.02 + rnd() * 0.96;
      const v = rnd() * 0.95;
      if (inside(u, v)) return [u, v];
    }
    return [0.5, 0.2];
  };
  const n = 820;
  for (let i = 0; i < n; i++) {
    const [u, v] = sample();
    const x = ox + u * s;
    const y = oy + s * (1 - v);
    const depth = (1 - i / n) * 0.6;
    const len = s * (0.032 + rnd() * 0.028);
    paintLeaf(ctx, x, y, len, len * 0.62, Math.PI + (rnd() - 0.5) * 1.8, leafTone(rnd, depth), 1.15, mask);
  }
  // Buds, mostly in the lower, shaded half.
  for (let i = 0; i < 40; i++) {
    const [u, v] = sample();
    bud(ctx, ox + u * s, oy + s * (1 - v * 0.9), 1.8 + rnd() * 1.8, rnd, mask);
  }
}

function drawFringe(ctx: Ctx, ox: number, oy: number, s: number, mask: boolean): void {
  const rnd = seeded(53);
  // Strand layout first (shared by the stem, leaf and bud passes).
  const r2 = seeded(54);
  const strands = Array.from({ length: 30 }, (_, i) => ({ x: ox + ((i + r2()) / 30) * s, len: s * (0.35 + r2() * 0.62) }));
  if (!mask) {
    ctx.strokeStyle = 'rgba(96,104,70,1)';
    ctx.lineWidth = 1.6;
    for (const st of strands) {
      ctx.beginPath();
      ctx.moveTo(st.x, oy);
      ctx.bezierCurveTo(st.x - 4, oy + st.len * 0.35, st.x + 4, oy + st.len * 0.7, st.x, oy + st.len);
      ctx.stroke();
    }
  }
  // Dense band at the top (the mat spilling over the edge).
  for (let i = 0; i < 420; i++) {
    const x = ox + rnd() * s;
    const y = oy + Math.pow(rnd(), 1.6) * s * (0.2 + 0.08 * Math.sin(x * 0.05));
    const len = s * (0.04 + rnd() * 0.03);
    paintLeaf(ctx, x, y, len, len * 0.5, (rnd() - 0.5) * 2.4, leafTone(rnd, 0.3 * rnd()), 1.12, mask);
  }
  // Leaves along the strands + a bud near most tips.
  for (const st of strands) {
    const leaves = 7 + Math.floor(rnd() * 9);
    for (let j = 0; j < leaves; j++) {
      const t = rnd();
      const ll = s * (0.03 + rnd() * 0.025);
      paintLeaf(ctx, st.x + (rnd() - 0.5) * 12, oy + t * st.len, ll, ll * 0.5, (rnd() - 0.5) * 2.2, leafTone(rnd, 0.15), 1.12, mask);
    }
    if (rnd() < 0.7) bud(ctx, st.x + (rnd() - 0.5) * 6, oy + st.len * (0.55 + rnd() * 0.45), 2.2 + rnd() * 2, rnd, mask);
  }
}

function drawFern(ctx: Ctx, ox: number, oy: number, w: number, h: number, mask: boolean): void {
  const rnd = seeded(71);
  const bx = ox + w / 2;
  const by = oy + h;
  const fronds = 11;
  for (let i = 0; i < fronds; i++) {
    const a = -Math.PI / 2 + ((i / (fronds - 1)) - 0.5) * 2.6 + (rnd() - 0.5) * 0.15;
    const len = h * (0.62 + rnd() * 0.34) * (1 - Math.abs(i / (fronds - 1) - 0.5) * 0.35);
    const pts: [number, number][] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const droop = t * t * 0.55 * Math.sign(Math.cos(a)) * (Math.abs(Math.cos(a)) + 0.1);
      const aa = a + droop;
      pts.push([bx + Math.cos(aa) * len * t * (w / h) * 0.95, by + Math.sin(aa) * len * t + t * t * len * 0.25]);
    }
    if (!mask) {
      ctx.strokeStyle = 'rgba(112,124,82,1)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
    for (let k = 1; k < pts.length; k++) {
      const t = k / 12;
      const [x, y] = pts[k];
      const [px, py] = pts[k - 1];
      const dir = Math.atan2(y - py, x - px);
      const ll = h * 0.075 * (1 - t * 0.7);
      for (const side of [-1, 1]) paintLeaf(ctx, x, y, ll, ll * 0.42, dir - Math.PI / 2 + side * 1.05, leafTone(rnd, 0.1 + t * 0.1), 1.1, mask);
    }
    const tip = pts[pts.length - 1];
    if (rnd() < 0.8) bud(ctx, tip[0], tip[1], 3 + rnd() * 2.5, rnd, mask);
  }
}

function drawBlossom(ctx: Ctx, ox: number, oy: number, s: number, mask: boolean): void {
  // A clump of small glowing bell flowers on short stems (top-down-ish card).
  const rnd = seeded(13);
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * s * 0.42;
    paintLeaf(ctx, ox + s / 2 + Math.cos(a) * r, oy + s / 2 + Math.sin(a) * r, s * 0.09, s * 0.04, a - Math.PI / 2, leafTone(rnd, 0.2), 1.1, mask);
  }
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * s * 0.34;
    bud(ctx, ox + s / 2 + Math.cos(a) * r, oy + s / 2 + Math.sin(a) * r, 4 + rnd() * 4, rnd, mask);
  }
}

function drawClover(ctx: Ctx, ox: number, oy: number, s: number, mask: boolean): void {
  // Ground creeper / moss cushion seen from above: small round leaves.
  const rnd = seeded(29);
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * s * (0.4 + 0.06 * Math.sin(a * 4));
    const x = ox + s / 2 + Math.cos(a) * r;
    const y = oy + s / 2 + Math.sin(a) * r;
    paintLeaf(ctx, x, y, s * 0.045, s * 0.035, rnd() * Math.PI * 2, leafTone(rnd, 0.2 + (r / (s * 0.45)) * 0.2), 1.15, mask);
  }
  for (let i = 0; i < 10; i++) bud(ctx, ox + s * (0.2 + rnd() * 0.6), oy + s * (0.2 + rnd() * 0.6), 2 + rnd() * 2, rnd, mask);
}

function drawAtlas(ctx: Ctx, mask: boolean): void {
  ctx.clearRect(0, 0, AW, AW);
  if (mask) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, AW, AW);
  }
  drawLeafClump(ctx, CARD.leaf[0], CARD.leaf[1], 512, mask);
  drawIvy(ctx, CARD.ivy[0], CARD.ivy[1], 512, mask);
  drawFringe(ctx, CARD.fringe[0], CARD.fringe[1], 512, mask);
  drawFern(ctx, CARD.fern[0], CARD.fern[1], 512, 256, mask);
  drawBlossom(ctx, CARD.blossom[0], CARD.blossom[1], 256, mask);
  drawClover(ctx, CARD.clover[0], CARD.clover[1], 256, mask);
}

// ── Batch ───────────────────────────────────────────────────────────────────

const _n = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();

export interface CardOpts {
  /** Per-corner tint (A, B, C, D = bottom-left, bottom-right, top-right, top-left). */
  colors: [RGB, RGB, RGB, RGB] | RGB;
  /** Spherical normals radiating from this point (canopies, bushes). */
  sphere?: THREE.Vector3;
  /** Sway weights at the bottom / top edge (default 0 / 0). */
  sway?: [number, number];
  /** Mirror the texture horizontally. */
  flip?: boolean;
  /** Sub-rectangle of the region (u0, u1, v0, v1 in 0..1, v down). */
  sub?: [number, number, number, number];
}

export class CardBatch {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly sw: number[] = [];

  get count(): number {
    return this.pos.length / 18;
  }

  /** A card from four corners (A bottom-left, B bottom-right, C top-right, D top-left). */
  quad(region: CardRegion, A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3, D: THREE.Vector3, o: CardOpts): void {
    const [rx, ry, rw, rh] = region;
    const s = o.sub ?? [0, 1, 0, 1];
    let u0 = (rx + rw * s[0]) / AW;
    let u1 = (rx + rw * s[1]) / AW;
    const vTop = 1 - (ry + rh * s[2]) / AW;
    const vBot = 1 - (ry + rh * s[3]) / AW;
    if (o.flip) [u0, u1] = [u1, u0];
    const corners = [A, B, C, D];
    const uvs: [number, number][] = [
      [u0, vBot],
      [u1, vBot],
      [u1, vTop],
      [u0, vTop],
    ];
    _n.crossVectors(_e1.subVectors(B, A), _e2.subVectors(D, A)).normalize();
    const cols = Array.isArray(o.colors[0]) ? (o.colors as [RGB, RGB, RGB, RGB]) : [o.colors as RGB, o.colors as RGB, o.colors as RGB, o.colors as RGB];
    const sway = o.sway ?? [0, 0];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = corners[i];
      this.pos.push(p.x, p.y, p.z);
      if (o.sphere) {
        _e1.subVectors(p, o.sphere).normalize();
        // A touch of "up" keeps the crown's belly from going fully dark.
        _e1.y += 0.25;
        _e1.normalize();
        this.nor.push(_e1.x, _e1.y, _e1.z);
      } else this.nor.push(_n.x, _n.y, _n.z);
      this.uv.push(uvs[i][0], uvs[i][1]);
      const c = cols[i];
      this.col.push(c[0], c[1], c[2]);
      this.sw.push(i === 0 || i === 1 ? sway[0] : sway[1]);
    }
  }

  /**
   * Card centred at `c`, spanning `right` (half-width vector) and `up`
   * (half-height vector).
   */
  card(region: CardRegion, c: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, o: CardOpts): void {
    const A = c.clone().sub(right).sub(up);
    const B = c.clone().add(right).sub(up);
    const C = c.clone().add(right).add(up);
    const D = c.clone().sub(right).add(up);
    this.quad(region, A, B, C, D, o);
  }

  /** Card standing on a wall: bottom edge centre `base`, wall normal `n`, size w × h. */
  wall(region: CardRegion, base: THREE.Vector3, n: THREE.Vector3, w: number, h: number, o: CardOpts): void {
    const right = new THREE.Vector3(n.z, 0, -n.x).normalize().multiplyScalar(w / 2);
    const up = new THREE.Vector3(0, h / 2, 0);
    this.card(region, base.clone().add(up), right, up, o);
  }

  /** Card hanging from a top edge centre `top` (fringe), facing `n`. */
  hang(region: CardRegion, top: THREE.Vector3, n: THREE.Vector3, w: number, h: number, o: CardOpts): void {
    const right = new THREE.Vector3(n.z, 0, -n.x).normalize().multiplyScalar(w / 2);
    const up = new THREE.Vector3(0, h / 2, 0);
    this.card(region, top.clone().sub(up), right, up, o);
  }

  /** Flat card lying on a surface at height y (moss cushions, creepers, blossoms). */
  flat(region: CardRegion, x: number, y: number, z: number, w: number, d: number, rot: number, o: CardOpts): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const right = new THREE.Vector3(c * w * 0.5, 0, -s * w * 0.5);
    const fwd = new THREE.Vector3(s * d * 0.5, 0, c * d * 0.5);
    const p = new THREE.Vector3(x, y, z);
    this.quad(region, p.clone().sub(right).add(fwd), p.clone().add(right).add(fwd), p.clone().add(right).sub(fwd), p.clone().sub(right).sub(fwd), o);
  }

  /** Builds the single foliage-card mesh (empty → null). */
  build(kit: DecorKit, lib: MaterialLibrary): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const res = kit.low ? 512 : 1024;
    const draw = (mask: boolean) => (ctx: Ctx, w: number) => {
      ctx.save();
      ctx.scale(w / AW, w / AW);
      drawAtlas(ctx, mask);
      ctx.restore();
    };
    const tex = lib.canvasTexture(`pastel.cards.${res}`, res, res, draw(false));
    const buds = lib.canvasTexture(`pastel.cards.buds.${res}`, res, res, draw(true));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(this.sw, 1));
    g.computeBoundingSphere();
    kit.ownGeometry(g);
    const common = { map: tex, alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, emissive: new THREE.Color('#ffffff'), emissiveMap: buds, emissiveIntensity: kit.low ? 1.15 : 1.3 };
    const base = kit.low ? new THREE.MeshLambertMaterial(common) : new THREE.MeshStandardMaterial({ ...common, roughness: 0.92 });
    const mat = kit.ownMaterial(noFlipNormals(swayMaterial(base, kit.time)));
    mat.name = 'pastel.cards';
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'pastel.cards';
    const sh = kit.q.shadows !== 'off';
    mesh.castShadow = sh;
    mesh.receiveShadow = sh;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.customDepthMaterial = kit.ownMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.42 }));
    return kit.add(mesh);
  }
}

/**
 * Double-sided cards keep their authored normal on both faces (three flips it
 * for back faces): spherical crown normals stay coherent from any side.
 * Chains after swayMaterial's onBeforeCompile.
 */
function noFlipNormals<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n\tnormal *= faceDirection;\n#endif');
  };
  m.customProgramCacheKey = () => 'pastel-sway-card';
  return m;
}
