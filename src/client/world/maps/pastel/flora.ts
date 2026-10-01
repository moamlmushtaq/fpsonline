// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel flora: painterly trees, bushes, wall ivy, roof-edge
// fringes and bioluminescent undergrowth.
//
// Built from three cheap ingredients that all batch into existing draw calls:
//   • dark inner "core" blobs ('foliage' kit batch) give each crown / bush its
//     mass so the leaf cards never read as see-through paper,
//   • painted leaf cards (cards.ts, one draw) with spherical normals and
//     top-lit / cool-belly vertex colours make the soft painted silhouette,
//   • stems ('stem') and bulbs ('glow') for the glowing plants (sway in the
//     vertex shader through the shared wind uniform).
// Density scales with kit.detail (quality.decor).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV } from '../../../engine/palette';
import { CARD, type CardBatch } from './cards';
import { type DecorKit, type RGB, mix, rgb } from './kit';
import { glowColor, haloColor } from './vines';

/** Card tint gain: the painted atlas is a light neutral green (≈ 0.5 linear). */
const G = 1.55;
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

export const LEAF = {
  sunBleached: mix(rgb(ENV.sage), rgb(ENV.sand), 0.3),
  sage: rgb(ENV.sage),
  olive: mix(rgb(ENV.olive), rgb(ENV.sage), 0.35),
  deep: mix(rgb(ENV.olive), rgb(ENV.shadowCool), 0.18),
  mustard: mix(rgb('#d9c28b'), rgb(ENV.sage), 0.35),
  blossom: mix(rgb(ENV.pastelPink), rgb(ENV.bone), 0.25),
  warmTop: rgb(ENV.pastelYellow),
  coolBelly: mix(rgb(ENV.olive), rgb(ENV.skyBlue), 0.25),
  /** Wall ivy: muted sage-olive (sits on pastel stucco without going inky). */
  ivy: mix(mix(rgb(ENV.sage), rgb(ENV.olive), 0.45), rgb(ENV.boneShade), 0.12),
};

const UP = new THREE.Vector3(0, 1, 0);
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();

/** Random unit direction, biased upward by `bias` (0 = uniform sphere). */
function dir(rng: () => number, bias: number, out = new THREE.Vector3()): THREE.Vector3 {
  const y = THREE.MathUtils.clamp(-1 + 2 * rng() + bias, -0.75, 1);
  const a = rng() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - y * y));
  return out.set(Math.cos(a) * s, y, Math.sin(a) * s);
}

/** Card basis facing `n` with a random roll. */
function basis(n: THREE.Vector3, roll: number, w: number, h: number): [THREE.Vector3, THREE.Vector3] {
  const ref = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP;
  _r.crossVectors(ref, n).normalize();
  _u.crossVectors(n, _r).normalize();
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const right = _r.clone().multiplyScalar(c).addScaledVector(_u, s).multiplyScalar(w / 2);
  const up = _u.clone().multiplyScalar(c).addScaledVector(_r, -s).multiplyScalar(h / 2);
  return [right, up];
}

export interface CrownOpts {
  /** Base leaf tint. */
  tint: RGB;
  /** Cards per unit radius (scaled by detail). */
  density?: number;
  /** Sway at the outer crown. */
  sway?: number;
  /** Upward bias of card placement. */
  bias?: number;
}

/**
 * One leafy volume: a dark core ellipsoid + leaf cards around it, lit as one
 * soft volume (spherical normals from `center`).
 */
export function crown(kit: DecorKit, cards: CardBatch, center: THREE.Vector3, rx: number, ry: number, rz: number, rng: () => number, o: CrownOpts, lightCenter = center): void {
  const r = (rx + ry + rz) / 3;
  // Core: well inside the crown (mass + depth between the cards), darker and cooler.
  // (Mostly hidden by the cards: a 20-tri icosahedron unless it is a big crown
  // on high.)
  kit.ball('foliage', center.x, center.y, center.z, rx * 0.56, ry * 0.54, rz * 0.56, mix(scale(o.tint, 0.8), LEAF.coolBelly, 0.2), kit.detail >= 1 && r > 1.2 ? 1 : 0, {
    drift: 0.2,
    shade: (_x, _y, _z, _nx, ny) => (ny > 0.35 ? 1.15 : ny < -0.3 ? 0.8 : 0.97),
  });
  const n = Math.max(4, Math.round((o.density ?? 9) * r * (0.45 + 0.55 * kit.detail)));
  const sway = o.sway ?? 0.25;
  const d = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    dir(rng, o.bias ?? 0.35, d);
    const out = 0.42 + rng() * 0.4;
    const p = new THREE.Vector3(center.x + d.x * rx * out, center.y + d.y * ry * out, center.z + d.z * rz * out);
    const size = r * (0.95 + rng() * 0.45);
    // Cards cross at varied angles (a leafy volume, not a shell of plates).
    const nrm = d.clone().lerp(dir(rng, 0, q), 0.55).lerp(UP, 0.15).normalize();
    const [right, up] = basis(nrm, rng() * Math.PI * 2, size, size);
    // Per-corner tint: top-lit warm, belly cool and darker.
    const col = (corner: THREE.Vector3): RGB => {
      const h = THREE.MathUtils.clamp((corner.y - (center.y - ry)) / (2 * ry), 0, 1);
      const out = THREE.MathUtils.clamp(corner.clone().sub(center).length() / r, 0, 1.4);
      const k = (0.62 + 0.5 * h) * (0.86 + 0.14 * out);
      let c = mix(o.tint, LEAF.coolBelly, (1 - h) * 0.35);
      c = mix(c, LEAF.warmTop, h * h * 0.12);
      return scale(c, k * G);
    };
    const A = p.clone().sub(right).sub(up);
    const B = p.clone().add(right).sub(up);
    const C = p.clone().add(right).add(up);
    const D = p.clone().sub(right).add(up);
    cards.quad(CARD.leaf, A, B, C, D, { colors: [col(A), col(B), col(C), col(D)], sphere: lightCenter, sway: [sway * 0.6, sway], flip: rng() < 0.5 });
  }
}

export interface TreeOpts {
  tint?: RGB;
  /** Hanging glowing vine strands from the crown. */
  vines?: number;
  lean?: number;
}

/**
 * Stylised painterly street tree: a leaning, tapering trunk splitting into
 * limbs that carry 3–6 overlapping crown lobes.
 */
export function canopyTree(kit: DecorKit, cards: CardBatch, x: number, z: number, h: number, r: number, rng: () => number, o: TreeOpts = {}, hang?: (p: THREE.Vector3, len: number) => void): void {
  const tint = o.tint ?? mix(LEAF.sunBleached, LEAF.olive, rng() * 0.6);
  const trunkCol = mix(rgb('#6e6052'), rgb(ENV.shadowWarm), 0.2);
  const la = rng() * Math.PI * 2;
  const lean = o.lean ?? 0.25 + rng() * 0.35;
  const top = new THREE.Vector3(x + Math.cos(la) * lean, h * 0.5, z + Math.sin(la) * lean);
  const mid = new THREE.Vector3(x + Math.cos(la) * lean * 0.3 + (rng() - 0.5) * 0.15, h * 0.26, z + Math.sin(la) * lean * 0.3 + (rng() - 0.5) * 0.15);
  kit.cyl('wood', x, 0, z, 0.2, 0.34, 0.35, trunkCol, 8, { ao: 0.3 });
  // Soft pool of shade under the crown + a dense contact at the trunk.
  kit.contact(top.x, 0.03, top.z, r * 1.1, r * 1.0, la, 0.45);
  kit.contact(x, 0.03, z, 0.75, 0.75, 0, 0.9);
  kit.tube('wood', new THREE.Vector3(x, 0.2, z), mid, 0.2, trunkCol, 7, { drift: 0.15 });
  kit.tube('wood', mid, top, 0.16, trunkCol, 7, { drift: 0.15 });
  const center = new THREE.Vector3(top.x, h * 0.7, top.z);
  const lobes = 3 + Math.floor(rng() * 3) + (r > 2.9 ? 1 : 0);
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + rng() * 0.8;
    const d = i === 0 ? 0 : r * (0.35 + rng() * 0.25);
    const lc = new THREE.Vector3(center.x + Math.cos(a) * d, center.y + (i === 0 ? h * 0.1 : (rng() - 0.35) * h * 0.14), center.z + Math.sin(a) * d);
    const lr = r * (i === 0 ? 0.62 : 0.46 + rng() * 0.16);
    // Limb to the lobe.
    kit.tube('wood', top, new THREE.Vector3(lc.x, lc.y - lr * 0.4, lc.z), 0.07 + lr * 0.025, trunkCol, 5, { drift: 0.1 });
    crown(kit, cards, lc, lr, lr * 0.78, lr, rng, { tint: mix(tint, LEAF.sunBleached, rng() * 0.25), sway: 0.3 }, center);
  }
  // Glowing strands spilling from the shaded underside.
  const strands = Math.round((o.vines ?? 3) * (0.5 + 0.5 * kit.detail));
  if (hang) {
    for (let i = 0; i < strands; i++) {
      const a = rng() * Math.PI * 2;
      hang(new THREE.Vector3(center.x + Math.cos(a) * r * 0.65, center.y - r * 0.35, center.z + Math.sin(a) * r * 0.65), 0.8 + rng() * 1.6);
    }
  }
}

/** A rounded shrub / hedge ball standing on y. */
export function bush(kit: DecorKit, cards: CardBatch, x: number, y: number, z: number, rx: number, ry: number, rz: number, rng: () => number, tint?: RGB): void {
  const c = new THREE.Vector3(x, y + ry * 0.72, z);
  crown(kit, cards, c, rx, ry, rz, rng, { tint: tint ?? mix(LEAF.olive, LEAF.sage, rng() * 0.6), density: 8, sway: 0.12, bias: 0.4 });
}

/** A run of overlapping hedge bushes from (x0, z0) to (x1, z1). */
export function hedgeRow(kit: DecorKit, cards: CardBatch, x0: number, z0: number, x1: number, z1: number, h: number, rng: () => number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 1.9));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const s = 1.15 + rng() * 0.3;
    bush(kit, cards, x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t, s, h * (0.5 + rng() * 0.1), s, rng, mix(LEAF.olive, LEAF.sage, 0.2 + rng() * 0.5));
  }
}

// ── Walls & roofs ───────────────────────────────────────────────────────────

/**
 * Ivy mass climbing a wall: `base` = bottom-centre ON the wall surface, `n` =
 * outward wall normal (horizontal), w × h coverage. Overlapping cards, each a
 * hair further from the wall (no z-fight), darker at the root.
 */
export function ivy(cards: CardBatch, base: THREE.Vector3, n: THREE.Vector3, w: number, h: number, rng: () => number, tint: RGB = LEAF.ivy): void {
  const side = new THREE.Vector3(n.z, 0, -n.x).normalize();
  // A broad root mound, then irregular mounds climbing (drifting sideways,
  // barely narrowing) up to h — patchy wall ivy, never a cone or a column.
  let top = 0;
  let cw = w;
  let off = 0;
  let layer = 0;
  while (top < h - 0.25 && layer < 4) {
    const ch = Math.min(cw * (0.6 + rng() * 0.2), h * 0.7);
    // Each mound overlaps the one below by ~40 %; the last one stops at h.
    const t1 = Math.min(h, (layer ? top + ch * 0.6 : ch));
    const y0 = t1 - ch;
    const p = base.clone().addScaledVector(side, off).addScaledVector(n, 0.04 + layer * 0.014 + rng() * 0.008);
    p.y += y0;
    const c = mix(tint, LEAF.sage, rng() * 0.35);
    const k = layer / 3;
    const lo = scale(mix(c, LEAF.deep, 0.25 - k * 0.12), G * (0.82 + k * 0.08));
    const hi = scale(mix(c, LEAF.sunBleached, 0.25 + k * 0.1), G * 1.04);
    cards.wall(CARD.ivy, p, n, cw, ch, { colors: [lo, lo, hi, hi], flip: rng() < 0.5 });
    top = t1;
    off = THREE.MathUtils.clamp(off + (rng() - 0.5) * cw * 0.5, -w * 0.22, w * 0.22);
    cw *= 0.86 + rng() * 0.14;
    layer++;
  }
}

/**
 * Overgrowth spilling over an edge from `a` to `b` (top edge, horizontal),
 * hanging `drop` m down the face whose outward normal is `n`.
 */
export function fringe(cards: CardBatch, a: THREE.Vector3, b: THREE.Vector3, n: THREE.Vector3, drop: number, rng: () => number, tint: RGB = LEAF.olive): void {
  const len = a.distanceTo(b);
  const k = Math.max(1, Math.round(len / 2.2));
  for (let i = 0; i < k; i++) {
    const t = (i + 0.5) / k;
    const w = (len / k) * (1.2 + rng() * 0.3);
    const top = a.clone().lerp(b, t).addScaledVector(n, 0.07 + (i % 2) * 0.02);
    top.y += 0.18;
    const d = drop * (0.7 + rng() * 0.5);
    const c = mix(tint, LEAF.sage, rng() * 0.4);
    const hi = scale(mix(c, LEAF.sunBleached, 0.25), G);
    const lo = scale(mix(c, LEAF.deep, 0.3), G * 0.8);
    cards.hang(CARD.fringe, top, n, w, d, { colors: [lo, lo, hi, hi], sway: [0.45, 0], flip: rng() < 0.5 });
  }
}

/** Creeping cushion / moss mat lying on a roof or ground (flat clover cards). */
export function cushion(cards: CardBatch, x: number, y: number, z: number, s: number, rng: () => number, tint: RGB = LEAF.sage): void {
  const c = scale(mix(tint, LEAF.sunBleached, rng() * 0.35), G * 0.95);
  cards.flat(CARD.clover, x, y + 0.02, z, s, s * (0.8 + rng() * 0.4), rng() * Math.PI, { colors: c });
}

// ── Bioluminescent undergrowth ──────────────────────────────────────────────

/** Two or three crossed fern fans (glowing tips through the buds mask). */
export function fern(cards: CardBatch, x: number, y: number, z: number, s: number, rng: () => number, tint: RGB = LEAF.olive): void {
  const k = 2 + (rng() < 0.5 ? 1 : 0);
  const a0 = rng() * Math.PI;
  for (let i = 0; i < k; i++) {
    const a = a0 + (i / k) * Math.PI;
    const n = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const w = s * (1.6 + rng() * 0.4);
    const hh = s * (0.8 + rng() * 0.3);
    const lo = scale(mix(tint, LEAF.deep, 0.4), G * 0.75);
    const hi = scale(mix(tint, LEAF.sage, 0.3), G * 1.05);
    cards.wall(CARD.fern, new THREE.Vector3(x, y - 0.02, z), n, w, hh, { colors: [lo, lo, hi, hi], sway: [0, 0.35], flip: rng() < 0.5 });
  }
}

/** A flat bed of glowing bell flowers (shade bioluminescence on the ground). */
export function blossomBed(cards: CardBatch, x: number, y: number, z: number, s: number, rng: () => number): void {
  const c = scale(mix(LEAF.olive, LEAF.sage, rng()), G);
  cards.flat(CARD.blossom, x, y + 0.03, z, s, s, rng() * Math.PI * 2, { colors: c });
}

/**
 * "Lantern stalks": a clump of arching stems each ending in a glowing bulb
 * (chartreuse / pale gold / soft pink), a fern ruff at the base. Sways.
 */
export function lanternPlant(kit: DecorKit, cards: CardBatch, x: number, y: number, z: number, s: number, rng: () => number): void {
  const stems = 3 + Math.floor(rng() * 3) + (kit.low ? -1 : 0);
  const stem = mix(rgb('#6f7a55'), rgb(ENV.sage), 0.3);
  for (let i = 0; i < stems; i++) {
    const a = rng() * Math.PI * 2;
    const h = s * (0.55 + rng() * 0.6);
    const reach = s * (0.15 + rng() * 0.3);
    let prev = new THREE.Vector3(x, y, z);
    const segs = kit.low ? 2 : 4;
    for (let k = 1; k <= segs; k++) {
      const t = k / segs;
      const p = new THREE.Vector3(x + Math.cos(a) * reach * Math.sin(t * 1.6), y + h * Math.sin(t * 1.35) / Math.sin(1.35), z + Math.sin(a) * reach * Math.sin(t * 1.6));
      kit.tube('stem', prev, p, 0.016 * s + 0.008, stem, 4, { drift: 0.1, sway: (_x, yy) => Math.max(0, (yy - y) / h) * 0.5 });
      prev = p;
    }
    const br = (0.05 + rng() * 0.04) * (0.7 + s * 0.4);
    const gc = glowColor(rng, 1.0);
    kit.ball('glow', prev.x, prev.y - br * 0.3, prev.z, br, br * 1.25, br, gc, kit.low ? 1 : 0, { drift: 0, sway: 0.5 });
    kit.halo(prev.x, prev.y - br * 0.3, prev.z, 0.22 + br * 2.5, haloColor(gc), 0.5);
  }
  fern(cards, x, y, z, s * 0.45, rng);
}

/**
 * Glowing ground-cover patch for shaded corners: ferns, lantern stalks and
 * a blossom bed, sized `s` (m) — the shade bioluminescence unit.
 */
export function glowPatch(kit: DecorKit, cards: CardBatch, x: number, y: number, z: number, s: number, rng: () => number): void {
  blossomBed(cards, x, y, z, s * 1.3, rng);
  // The bed's buds light the ground around them (soft chartreuse / gold pool).
  kit.halo(x, y + 0.15, z, 0.3 + s * 0.25, haloColor(glowColor(rng)).map((v) => v * 0.55) as RGB, 0);
  const n = Math.max(1, Math.round(s * (kit.low ? 0.9 : 1.6)));
  for (let i = 0; i < n; i++) {
    const px = x + (rng() - 0.5) * s;
    const pz = z + (rng() - 0.5) * s;
    if (rng() < 0.55) lanternPlant(kit, cards, px, y, pz, 0.6 + rng() * 0.5, rng);
    else fern(cards, px, y, pz, 0.35 + rng() * 0.3, rng);
  }
}
