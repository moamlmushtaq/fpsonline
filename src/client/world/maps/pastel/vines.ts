// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel's glowing overgrowth.
//
//  • hangingVine / climbingVine / drapedVine: thin stems + leaf cards ('stem'
//    batch) with chartreuse / pale-gold / soft-pink bulbs ('glow' batch). A
//    per-vertex sway weight (0 at the anchor → 1 at the tip) lets ONE shared
//    time uniform animate every strand in the vertex shader.
//  • Vine curtains (the walk-through sight blockers of the collision data): a
//    timber pergola + dense alpha-tested foliage sheets that also sway, so the
//    player instantly reads "soft cover I can push through but not see
//    through". All curtains share one draw call.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MaterialLibrary } from '../../../contracts';
import { ENV } from '../../../engine/palette';
import { type DecorKit, type RGB, mix, rgb, swayMaterial } from './kit';

const STEM = rgb('#6f7a55');
const STEM_DARK = rgb('#55603f');
const LEAF = rgb(ENV.olive);
const LEAF_LIGHT = rgb(ENV.sage);
const SUNLIT = rgb(ENV.pastelYellow);
const GLOWS = [ENV.glowChartreuse, ENV.glowGold, ENV.glowSoftPink] as const;

export function glowColor(rng: () => number, k = 1): RGB {
  const r = rng();
  const hex = r < 0.55 ? GLOWS[0] : r < 0.85 ? GLOWS[1] : GLOWS[2];
  return rgb(hex, (1.6 + rng() * 0.9) * k);
}

function leaf(kit: DecorKit, p: THREE.Vector3, size: number, rng: () => number, sway: number, tint = 0): void {
  const a = rng() * Math.PI * 2;
  const tilt = 0.4 + rng() * 0.6;
  const w = size * (0.6 + rng() * 0.5);
  const h = size * (1 + rng() * 0.6);
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt, a, 0)).setPosition(p);
  const pts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(w * 0.5, -h * 0.45, 0),
    new THREE.Vector3(0, -h, 0),
    new THREE.Vector3(-w * 0.5, -h * 0.45, 0),
  ].map((v) => v.applyMatrix4(m));
  const col = mix(mix(LEAF, LEAF_LIGHT, rng()), rgb(ENV.glowChartreuse, 1.1), tint);
  kit.quad('stem', pts[0], pts[1], pts[2], pts[3], col, { drift: 0.1, sway });
}

/**
 * A strand hanging from `anchor` down `length` meters, with leaves and glowing
 * bulbs. `glow` scales the bulb count (0 = plain ivy).
 */
export function hangingVine(kit: DecorKit, anchor: THREE.Vector3, length: number, rng: () => number, glow = 1): void {
  const segs = kit.low ? 3 : 5;
  const amp = Math.min(1, length / 3);
  const bend = new THREE.Vector3((rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5);
  let prev = anchor.clone();
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const p = anchor.clone().add(new THREE.Vector3(bend.x * Math.sin(t * 2.4), -length * t, bend.z * Math.sin(t * 2.1)));
    kit.tube('stem', prev, p, 0.018 * (1.2 - t * 0.5), STEM, 4, { drift: 0.1, sway: (_x, y) => Math.max(0, (anchor.y - y) / length) ** 1.5 * amp });
    prev = p;
  }
  const leaves = Math.round((kit.low ? 2 : 6) * Math.min(2, length / 1.5) * Math.max(0.5, kit.detail));
  for (let i = 0; i < leaves; i++) {
    const t = 0.1 + rng() * 0.9;
    const p = anchor.clone().add(new THREE.Vector3(bend.x * Math.sin(t * 2.4), -length * t, bend.z * Math.sin(t * 2.1)));
    leaf(kit, p, 0.16, rng, t ** 1.5 * Math.min(1, length / 3), 0.1);
  }
  const bulbs = Math.round(glow * (1 + length * 0.8) * kit.detail);
  for (let i = 0; i < bulbs; i++) {
    const t = 0.25 + rng() * 0.75;
    const p = anchor.clone().add(new THREE.Vector3(bend.x * Math.sin(t * 2.4) + (rng() - 0.5) * 0.08, -length * t, bend.z * Math.sin(t * 2.1) + (rng() - 0.5) * 0.08));
    const r = 0.03 + rng() * 0.04;
    kit.ball('glow', p.x, p.y, p.z, r, r * 1.3, r, glowColor(rng), 0, { drift: 0, sway: t ** 1.5 * Math.min(1, length / 3) });
  }
}

/** Ivy climbing a wall from `base` (on the wall face) up `height`, `normal` = wall outward normal. */
export function climbingVine(kit: DecorKit, base: THREE.Vector3, height: number, normal: THREE.Vector3, rng: () => number, glow = 0.6): void {
  const side = new THREE.Vector3(-normal.z, 0, normal.x);
  const off = normal.clone().multiplyScalar(0.05);
  let prev = base.clone().add(off);
  const segs = kit.low ? 3 : 6;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const p = base.clone().add(off).addScaledVector(side, Math.sin(t * 5 + rng()) * 0.35).add(new THREE.Vector3(0, height * t, 0));
    kit.tube('stem', prev, p, 0.022, STEM_DARK, 4, { drift: 0.1 });
    prev = p;
  }
  const leaves = Math.round((kit.low ? 5 : 12) * (height / 2.5) * Math.max(0.5, kit.detail));
  for (let i = 0; i < leaves; i++) {
    const t = rng();
    const p = base.clone().addScaledVector(normal, 0.08 + rng() * 0.08).addScaledVector(side, (rng() - 0.5) * 1.1).add(new THREE.Vector3(0, height * t, 0));
    leaf(kit, p, 0.22, rng, 0, 0.05);
  }
  const bulbs = Math.round(glow * height * 1.6 * Math.max(0.5, kit.detail));
  for (let i = 0; i < bulbs; i++) {
    const p = base.clone().addScaledVector(normal, 0.12).addScaledVector(side, (rng() - 0.5) * 0.9).add(new THREE.Vector3(0, height * (0.2 + rng() * 0.8), 0));
    const r = 0.035 + rng() * 0.04;
    kit.ball('glow', p.x, p.y, p.z, r, r, r, glowColor(rng), 0, { drift: 0 });
  }
}

/** A garland draped between points (sagging), with short hanging tendrils. */
export function drapedVine(kit: DecorKit, a: THREE.Vector3, b: THREE.Vector3, sag: number, rng: () => number, tendrils = 3): void {
  const segs = kit.low ? 4 : 8;
  let prev = a.clone();
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    kit.tube('stem', prev, p, 0.02, STEM, 4, { drift: 0.1, sway: Math.sin(t * Math.PI) * 0.3 });
    if (rng() < 0.8) leaf(kit, p, 0.2, rng, Math.sin(t * Math.PI) * 0.3, 0.05);
    prev = p;
  }
  const n = Math.round(tendrils * Math.max(0.4, kit.detail));
  for (let i = 0; i < n; i++) {
    const t = 0.15 + rng() * 0.7;
    const p = a.clone().lerp(b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    hangingVine(kit, p, 0.5 + rng() * 1.2, rng, 0.8);
  }
}

// ── Vine curtains (walk-through sight blockers) ────────────────────────────

function drawCurtain(ctx: CanvasRenderingContext2D, w: number, h: number, budsOnly = false): void {
  ctx.clearRect(0, 0, w, h);
  if (budsOnly) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
  }
  let s = 12345;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const strands = Math.round(w / 3.2);
  for (let i = 0; i < strands; i++) {
    const x = (i / strands) * w + rnd() * 3;
    const len = h * (0.72 + rnd() * 0.28);
    const sr = 84 + rnd() * 26;
    const sg = 92 + rnd() * 26;
    const sb = 62 + rnd() * 18;
    ctx.strokeStyle = budsOnly ? '#000000' : `rgba(${sr},${sg},${sb},1)`;
    ctx.lineWidth = 1.2 + rnd() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + (rnd() - 0.5) * 8, len * 0.33, x + (rnd() - 0.5) * 8, len * 0.66, x + (rnd() - 0.5) * 6, len);
    ctx.stroke();
    // Leaves along the strand.
    const leaves = 10 + Math.floor(rnd() * 12);
    for (let j = 0; j < leaves; j++) {
      const t = rnd();
      const ly = t * len;
      const lx = x + (rnd() - 0.5) * 9;
      const g = 104 + rnd() * 64;
      ctx.fillStyle = budsOnly ? '#000000' : `rgba(${g * 0.84},${g * 0.92},${g * 0.64},1)`;
      ctx.beginPath();
      ctx.ellipse(lx, ly, 2.2 + rnd() * 3, 3.5 + rnd() * 4, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Dense core band so the sheet really reads as opaque in the middle.
  for (let i = 0; i < w * 3; i++) {
    const x = rnd() * w;
    const y = h * (0.08 + rnd() * 0.7);
    const g = 92 + rnd() * 72;
    ctx.fillStyle = budsOnly ? '#000000' : `rgba(${g * 0.84},${g * 0.9},${g * 0.62},1)`;
    ctx.beginPath();
    ctx.ellipse(x, y, 2.5 + rnd() * 3.5, 4 + rnd() * 4, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Glowing buds.
  const cols = ['255,240,190', '214,246,140', '255,196,214'];
  for (let i = 0; i < w * 0.22; i++) {
    const x = rnd() * w;
    const y = h * (0.2 + rnd() * 0.75);
    const c = rnd();
    ctx.fillStyle = `rgba(${cols[c < 0.6 ? 1 : c < 0.9 ? 0 : 2]},1)`;
    ctx.beginPath();
    ctx.arc(x, y, 1.0 + rnd() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface CurtainSpec {
  /** Start / end of the curtain line (XZ) and its vertical extent. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
}

/**
 * Builds every vine curtain in one mesh (plus pergola beams into the kit's wood
 * batch and a few glowing strands in front for depth).
 */
export function buildCurtains(kit: DecorKit, lib: MaterialLibrary, specs: CurtainSpec[], rng: () => number): THREE.Mesh {
  const res = kit.low ? 1 : 2;
  const tex = lib.canvasTexture(`pastel.curtain.${res}`, 512 * res, 256 * res, (c, w, h) => drawCurtain(c, w, h));
  const buds = lib.canvasTexture(`pastel.curtain.buds.${res}`, 512 * res, 256 * res, (c, w, h) => drawCurtain(c, w, h, true));
  buds.wrapS = THREE.RepeatWrapping;
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const sway: number[] = [];
  const wood = rgb('#9c8468');
  for (const c of specs) {
    const len = Math.hypot(c.x1 - c.x0, c.z1 - c.z0);
    const dir = new THREE.Vector3((c.x1 - c.x0) / len, 0, (c.z1 - c.z0) / len);
    const n = new THREE.Vector3(-dir.z, 0, dir.x);
    // Two staggered sheets (depth) 0.08 apart.
    for (const [off, u0] of [
      [-0.05, 0],
      [0.05, 0.37],
    ] as const) {
      const ax = c.x0 + n.x * off;
      const az = c.z0 + n.z * off;
      const bx = c.x1 + n.x * off;
      const bz = c.z1 + n.z * off;
      const top = c.y1 + 0.05;
      const bot = c.y0 - 0.15;
      const reps = len / 5;
      const quad = [
        [ax, bot, az, u0, 0, 1],
        [bx, bot, bz, u0 + reps, 0, 1],
        [bx, top, bz, u0 + reps, 1, 0],
        [ax, bot, az, u0, 0, 1],
        [bx, top, bz, u0 + reps, 1, 0],
        [ax, top, az, u0, 1, 0],
      ];
      for (const [x, y, z, u, v, sw] of quad) {
        pos.push(x, y, z);
        uv.push(u, v);
        nor.push(n.x, n.y, n.z);
        sway.push(sw * 0.8);
      }
    }
    // Pergola: posts every ~3 m and a top beam (timber).
    const posts = Math.max(2, Math.round(len / 3) + 1);
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      const x = c.x0 + (c.x1 - c.x0) * t;
      const z = c.z0 + (c.z1 - c.z0) * t;
      kit.box('wood', x - 0.09, 0, z - 0.09, x + 0.09, c.y1 + 0.25, z + 0.09, wood, 0.02);
      // Cross joists.
      kit.box('wood', x - n.x * 0.7 - 0.05, c.y1 + 0.25, z - n.z * 0.7 - 0.05, x + n.x * 0.7 + 0.05, c.y1 + 0.4, z + n.z * 0.7 + 0.05, wood, 0.02, { ao: 0 });
    }
    kit.box('wood', Math.min(c.x0, c.x1) - 0.1, c.y1 + 0.1, Math.min(c.z0, c.z1) - 0.1, Math.max(c.x0, c.x1) + 0.1, c.y1 + 0.25, Math.max(c.z0, c.z1) + 0.1, wood, 0.02, { ao: 0 });
    // Sun-caught leafy mounds tumbling over the beam (lit sage tops, glowing
    // buds underneath) + a few 3D strands in front.
    const crowns = Math.round(len / 1.1);
    for (let i = 0; i < crowns; i++) {
      const t = (i + 0.2 + rng() * 0.6) / crowns;
      const x = c.x0 + (c.x1 - c.x0) * t;
      const z = c.z0 + (c.z1 - c.z0) * t;
      // Irregular, overlapping mounds (never a tidy row of balls).
      if (rng() < 0.25) continue;
      const r = 0.3 + rng() * rng() * 0.55;
      const col = mix(mix(LEAF_LIGHT, SUNLIT, 0.25 + rng() * 0.3), LEAF, rng() * 0.25);
      kit.mound(x + n.x * (rng() - 0.5) * 0.5, c.y1 + 0.3 + rng() * 0.15, z + n.z * (rng() - 0.5) * 0.5, r * 1.25, r * 0.9, r * 1.1, col, {
        drift: 0.25,
        shade: (_x, _y, _z, _nx, ny) => (ny > 0.2 ? 1.12 : ny < -0.3 ? 0.9 : 1),
      });
      for (const side of [-1, 1]) if (rng() < 0.6) hangingVine(kit, new THREE.Vector3(x + n.x * 0.16 * side, c.y1 + 0.2, z + n.z * 0.16 * side), (c.y1 - c.y0) * (0.35 + rng() * 0.5), rng, 1.2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.computeBoundingSphere();
  const mat = kit.ownMaterial(
    swayMaterial(
      kit.low
        ? new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, emissive: new THREE.Color('#ffffff'), emissiveMap: buds, emissiveIntensity: 1.6 })
        : new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, emissive: new THREE.Color('#ffffff'), emissiveMap: buds, emissiveIntensity: 1.8 }),
      kit.time,
    ),
  );
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'pastel.curtains';
  mesh.castShadow = kit.q.shadows !== 'off';
  mesh.receiveShadow = kit.q.shadows !== 'off';
  // Dappled shadows: the depth pass honours the leaf alpha.
  mesh.customDepthMaterial = kit.ownMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.45 }));
  return kit.add(mesh);
}
