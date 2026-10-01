// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel decals: ground & wall storytelling in ONE draw call.
//
// A hand-painted canvas atlas (cracks, oil stains, wet patches, leaf litter,
// moss, paper litter, rain streaks, skid marks, sand drifts, weed cushions,
// manhole / drain covers, worn parking paint) mapped onto thin quads laid on
// the ground, roofs and walls. All quads share one transparent, depth-tested,
// polygon-offset material (no z-fighting, no depth writes) and carry a per-
// vertex RGBA tint (value / warmth variation and per-decal opacity).
//
// Colours stay in the ENV family: warm greys and violet-browns for grime
// (never black), sage / olive mosses, mustard / terracotta leaves.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MaterialLibrary } from '../../../contracts';
import type { DecorKit } from './kit';

const AW = 1024;
const C = 256;
const cell = (col: number, row: number, w = 1, h = 1): [number, number, number, number] => [col * C, row * C, w * C, h * C];

/** Atlas cells (4 × 4 grid of 256 px). */
export const DECAL = {
  crackA: cell(0, 0),
  crackB: cell(1, 0),
  oil: cell(2, 0),
  drips: cell(3, 0),
  leaves: cell(0, 1),
  moss: cell(1, 1),
  damp: cell(2, 1),
  paper: cell(3, 1),
  streak: cell(0, 2),
  tire: cell(1, 2),
  sand: cell(2, 2),
  weeds: cell(3, 2),
  manhole: cell(0, 3),
  grate: cell(1, 3),
  line: [2 * C, 3 * C + 104, C, 48] as [number, number, number, number],
  /** Rectangular tar repair patch (top of the line cell). */
  patch: [2 * C, 3 * C, C, 96] as [number, number, number, number],
  arrow: cell(3, 3),
} as const;
export type DecalRegion = readonly [number, number, number, number];

type Ctx = CanvasRenderingContext2D;

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function softBlob(ctx: Ctx, x: number, y: number, r: number, rgb: string, a: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.55, `rgba(${rgb},${a * 0.7})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Recursive jagged crack with a chipped light lip. */
function crack(ctx: Ctx, x: number, y: number, ang: number, len: number, w: number, depth: number, rnd: () => number): void {
  let px = x;
  let py = y;
  const steps = Math.max(3, Math.round(len / 9));
  for (let i = 0; i < steps; i++) {
    ang += (rnd() - 0.5) * 0.9;
    const nx = px + Math.cos(ang) * (len / steps);
    const ny = py + Math.sin(ang) * (len / steps);
    const lw = w * (1 - (i / steps) * 0.7);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(200,190,176,0.14)';
    ctx.lineWidth = lw + 2.6;
    ctx.beginPath();
    ctx.moveTo(px + 1, py + 1);
    ctx.lineTo(nx + 1, ny + 1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(62,54,56,0.85)';
    ctx.lineWidth = lw * 0.8;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    if (depth > 0 && rnd() < 0.22) crack(ctx, nx, ny, ang + (rnd() < 0.5 ? 0.9 : -0.9), len * 0.45, lw * 0.7, depth - 1, rnd);
    px = nx;
    py = ny;
  }
}

function leaf(ctx: Ctx, x: number, y: number, s: number, a: number, col: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(s * 0.55, 0, 0, s);
  ctx.quadraticCurveTo(-s * 0.55, 0, 0, -s);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,70,52,0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.9);
  ctx.lineTo(0, s * 1.15);
  ctx.stroke();
  ctx.restore();
}

function drawAtlas(ctx: Ctx): void {
  ctx.clearRect(0, 0, AW, AW);
  const rnd = seeded(7);
  const clip = (r: readonly number[], fn: (x: number, y: number, w: number, h: number) => void): void => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r[0], r[1], r[2], r[3]);
    ctx.clip();
    fn(r[0], r[1], r[2], r[3]);
    ctx.restore();
  };
  // Cracks: a branching star and a long meander.
  clip(DECAL.crackA, (x, y) => {
    for (let i = 0; i < 5; i++) crack(ctx, x + 128, y + 128, (i / 5) * Math.PI * 2 + rnd() * 0.6, 70 + rnd() * 50, 3.2, 2, rnd);
  });
  clip(DECAL.crackB, (x, y) => {
    crack(ctx, x + 10, y + 128 + (rnd() - 0.5) * 40, 0, 240, 3.6, 3, rnd);
  });
  // Oil / tar stain: layered soft violet-brown blobs with a darker heart.
  clip(DECAL.oil, (x, y) => {
    for (let i = 0; i < 9; i++) softBlob(ctx, x + 128 + (rnd() - 0.5) * 90, y + 128 + (rnd() - 0.5) * 70, 40 + rnd() * 50, '64,56,60', 0.3);
    softBlob(ctx, x + 120, y + 132, 46, '52,44,50', 0.45);
  });
  // Drips / small spatters (under cars, below gutters).
  clip(DECAL.drips, (x, y) => {
    for (let i = 0; i < 26; i++) softBlob(ctx, x + 30 + rnd() * 196, y + 30 + rnd() * 196, 6 + rnd() * 18, '60,52,56', 0.4 + rnd() * 0.3);
  });
  // Leaf litter: mustard, faded terracotta, sage and dry brown.
  clip(DECAL.leaves, (x, y) => {
    const cols = ['rgba(214,186,118,1)', 'rgba(196,132,96,1)', 'rgba(156,164,124,1)', 'rgba(170,138,98,1)', 'rgba(226,206,150,1)'];
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 0.7) * 112;
      leaf(ctx, x + 128 + Math.cos(a) * r, y + 128 + Math.sin(a) * r, 5 + rnd() * 6, rnd() * Math.PI * 2, cols[Math.floor(rnd() * cols.length)]);
    }
  });
  // Moss: soft sage/olive cushion with speckled highlights.
  clip(DECAL.moss, (x, y) => {
    for (let i = 0; i < 14; i++) softBlob(ctx, x + 128 + (rnd() - 0.5) * 120, y + 128 + (rnd() - 0.5) * 120, 30 + rnd() * 44, rnd() < 0.5 ? '120,130,86' : '146,156,104', 0.55);
    for (let i = 0; i < 260; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 0.8) * 100;
      ctx.fillStyle = rnd() < 0.2 ? 'rgba(200,226,140,0.8)' : `rgba(${90 + rnd() * 50},${104 + rnd() * 50},${66 + rnd() * 30},0.85)`;
      ctx.fillRect(x + 128 + Math.cos(a) * r, y + 128 + Math.sin(a) * r, 2 + rnd() * 2.5, 2 + rnd() * 2.5);
    }
  });
  // Wet patch / water stain: dark soft edge, slightly lighter centre.
  clip(DECAL.damp, (x, y) => {
    for (let i = 0; i < 7; i++) softBlob(ctx, x + 128 + (rnd() - 0.5) * 80, y + 128 + (rnd() - 0.5) * 80, 60 + rnd() * 40, '78,72,74', 0.32);
  });
  // Paper litter: flyers, a newspaper page, wrappers.
  clip(DECAL.paper, (x, y) => {
    const cols = ['239,230,214', '233,195,181', '239,220,166', '201,220,193', '232,220,196'];
    for (let i = 0; i < 9; i++) {
      ctx.save();
      ctx.translate(x + 40 + rnd() * 176, y + 40 + rnd() * 176);
      ctx.rotate(rnd() * Math.PI * 2);
      const w = 20 + rnd() * 34;
      const h = 14 + rnd() * 26;
      ctx.fillStyle = 'rgba(70,60,60,0.25)';
      ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w, h);
      ctx.fillStyle = `rgba(${cols[i % cols.length]},1)`;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = 'rgba(80,70,64,0.35)';
      for (let k = 0; k < 4; k++) ctx.fillRect(-w / 2 + 3, -h / 2 + 3 + k * 4, w * (0.4 + rnd() * 0.5), 1.4);
      ctx.restore();
    }
  });
  // Rain streaks (walls): grime band at the top, drips running down.
  clip(DECAL.streak, (x, y) => {
    const g = ctx.createLinearGradient(0, y, 0, y + 60);
    g.addColorStop(0, 'rgba(84,76,74,0.55)');
    g.addColorStop(1, 'rgba(84,76,74,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 256, 60);
    for (let i = 0; i < 34; i++) {
      const sx = x + rnd() * 256;
      const len = 60 + rnd() * 190;
      const w = 2 + rnd() * 7;
      const gg = ctx.createLinearGradient(0, y, 0, y + len);
      gg.addColorStop(0, `rgba(84,76,74,${0.25 + rnd() * 0.3})`);
      gg.addColorStop(1, 'rgba(84,76,74,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(sx, y, w, len);
    }
  });
  // Skid marks: two curving rubber bands.
  clip(DECAL.tire, (x, y) => {
    for (const off of [-34, 34]) {
      ctx.strokeStyle = 'rgba(56,50,52,0.42)';
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + 10, y + 128 + off);
      ctx.bezierCurveTo(x + 90, y + 128 + off - 6, x + 170, y + 128 + off + 20, x + 246, y + 128 + off + 48);
      ctx.stroke();
    }
  });
  // Sand / dirt drift: warm beige cushion with grain.
  clip(DECAL.sand, (x, y) => {
    for (let i = 0; i < 10; i++) softBlob(ctx, x + 128 + (rnd() - 0.5) * 120, y + 128 + (rnd() - 0.5) * 60, 40 + rnd() * 50, '214,196,160', 0.45);
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = `rgba(${150 + rnd() * 60},${130 + rnd() * 50},${100 + rnd() * 40},0.5)`;
      ctx.fillRect(x + 40 + rnd() * 176, y + 70 + rnd() * 116, 1.5, 1.5);
    }
  });
  // Weed cushions seen from above (cracks, curbs, kerb lines).
  clip(DECAL.weeds, (x, y) => {
    for (let k = 0; k < 7; k++) {
      const cx = x + 30 + rnd() * 196;
      const cy = y + 30 + rnd() * 196;
      const n = 6 + Math.floor(rnd() * 6);
      for (let i = 0; i < n; i++) leaf(ctx, cx + (rnd() - 0.5) * 8, cy + (rnd() - 0.5) * 8, 6 + rnd() * 8, rnd() * Math.PI * 2, rnd() < 0.15 ? 'rgba(206,232,140,1)' : `rgba(${110 + rnd() * 40},${128 + rnd() * 40},${82 + rnd() * 20},1)`);
    }
  });
  // Manhole cover: ring, radial ribs, worn letters.
  clip(DECAL.manhole, (x, y) => {
    const cx = x + 128;
    const cy = y + 128;
    ctx.fillStyle = 'rgba(92,84,82,1)';
    ctx.beginPath();
    ctx.arc(cx, cy, 112, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,140,132,1)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, 104, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 4;
    for (let r = 30; r < 100; r += 22) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30);
      ctx.lineTo(cx + Math.cos(a) * 100, cy + Math.sin(a) * 100);
      ctx.stroke();
    }
    softBlob(ctx, cx + 30, cy - 20, 80, '120,96,74', 0.35); // rust bloom
  });
  // Storm drain grate.
  clip(DECAL.grate, (x, y) => {
    ctx.fillStyle = 'rgba(86,80,78,1)';
    ctx.fillRect(x + 28, y + 70, 200, 116);
    ctx.fillStyle = 'rgba(40,36,40,1)';
    for (let i = 0; i < 9; i++) ctx.fillRect(x + 40 + i * 21, y + 82, 11, 92);
    ctx.strokeStyle = 'rgba(150,140,132,1)';
    ctx.lineWidth = 5;
    ctx.strokeRect(x + 28, y + 70, 200, 116);
    for (let i = 0; i < 5; i++) leaf(ctx, x + 40 + rnd() * 170, y + 80 + rnd() * 100, 6 + rnd() * 5, rnd() * 6, 'rgba(206,180,118,1)');
  });
  // Tar repair patch: darker rectangle, slightly ragged edges, sealed seams.
  clip(DECAL.patch, (x, y, w, h) => {
    ctx.fillStyle = 'rgba(70,64,64,0.55)';
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 8);
    for (let i = 0; i <= 10; i++) ctx.lineTo(x + 6 + ((w - 12) * i) / 10, y + 6 + rnd() * 5);
    for (let i = 0; i <= 4; i++) ctx.lineTo(x + w - 6 - rnd() * 4, y + 8 + ((h - 16) * i) / 4);
    for (let i = 10; i >= 0; i--) ctx.lineTo(x + 6 + ((w - 12) * i) / 10, y + h - 6 - rnd() * 5);
    for (let i = 4; i >= 0; i--) ctx.lineTo(x + 6 + rnd() * 4, y + 8 + ((h - 16) * i) / 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(52,46,48,0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(${90 + rnd() * 40},${84 + rnd() * 36},${80 + rnd() * 30},0.4)`;
      ctx.fillRect(x + 10 + rnd() * (w - 20), y + 12 + rnd() * (h - 24), 2, 2);
    }
  });
  // Worn paint stripe (white, chipped, with gaps).
  clip(DECAL.line, (x, y, w, h) => {
    ctx.fillStyle = 'rgba(240,234,220,0.92)';
    ctx.fillRect(x, y + h * 0.2, w, h * 0.6);
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.5 + rnd() * 0.5})`;
      ctx.beginPath();
      ctx.ellipse(x + rnd() * w, y + h * (0.15 + rnd() * 0.7), 2 + rnd() * 9, 1 + rnd() * 5, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 3; i++) ctx.fillRect(x + rnd() * w, y, 6 + rnd() * 18, h);
    ctx.globalCompositeOperation = 'source-over';
  });
  // Faded painted arrow.
  clip(DECAL.arrow, (x, y) => {
    ctx.fillStyle = 'rgba(240,234,220,0.85)';
    ctx.beginPath();
    ctx.moveTo(x + 128, y + 20);
    ctx.lineTo(x + 200, y + 100);
    ctx.lineTo(x + 152, y + 100);
    ctx.lineTo(x + 152, y + 236);
    ctx.lineTo(x + 104, y + 236);
    ctx.lineTo(x + 104, y + 100);
    ctx.lineTo(x + 56, y + 100);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.4 + rnd() * 0.6})`;
      ctx.beginPath();
      ctx.arc(x + 50 + rnd() * 160, y + 20 + rnd() * 220, 1 + rnd() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  });
}

// ── Batch ───────────────────────────────────────────────────────────────────

export type RGBA = [number, number, number, number];
const WHITE: RGBA = [1, 1, 1, 1];

export class DecalBatch {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];

  get count(): number {
    return this.pos.length / 18;
  }

  private push(region: DecalRegion, A: THREE.Vector3, B: THREE.Vector3, Cc: THREE.Vector3, D: THREE.Vector3, n: THREE.Vector3, tint: RGBA, flip: boolean): void {
    const [rx, ry, rw, rh] = region;
    let u0 = rx / AW;
    let u1 = (rx + rw) / AW;
    const vTop = 1 - ry / AW;
    const vBot = 1 - (ry + rh) / AW;
    if (flip) [u0, u1] = [u1, u0];
    const P = [A, B, Cc, D];
    const UV: [number, number][] = [
      [u0, vBot],
      [u1, vBot],
      [u1, vTop],
      [u0, vTop],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(P[i].x, P[i].y, P[i].z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(UV[i][0], UV[i][1]);
      this.col.push(tint[0], tint[1], tint[2], tint[3]);
    }
  }

  /** Decal lying flat at height y: centre (x, z), size w (along rot) × d, yaw rot. */
  ground(region: DecalRegion, x: number, z: number, y: number, w: number, d: number, rot: number, tint: RGBA = WHITE, flip = false): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const rx = c * w * 0.5;
    const rz = -s * w * 0.5;
    const fx = s * d * 0.5;
    const fz = c * d * 0.5;
    this.push(
      region,
      new THREE.Vector3(x - rx + fx, y, z - rz + fz),
      new THREE.Vector3(x + rx + fx, y, z + rz + fz),
      new THREE.Vector3(x + rx - fx, y, z + rz - fz),
      new THREE.Vector3(x - rx - fx, y, z - rz - fz),
      new THREE.Vector3(0, 1, 0),
      tint,
      flip,
    );
  }

  /** Decal on a vertical wall: centre `c`, outward normal `n` (horizontal), size w × h. */
  wall(region: DecalRegion, c: THREE.Vector3, n: THREE.Vector3, w: number, h: number, tint: RGBA = WHITE, flip = false): void {
    const r = new THREE.Vector3(n.z, 0, -n.x).normalize().multiplyScalar(w / 2);
    const u = new THREE.Vector3(0, h / 2, 0);
    const p = c.clone().addScaledVector(n, 0.015);
    this.push(region, p.clone().sub(r).sub(u), p.clone().add(r).sub(u), p.clone().add(r).add(u), p.clone().sub(r).add(u), n, tint, flip);
  }

  build(kit: DecorKit, lib: MaterialLibrary): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const res = kit.low ? 512 : 1024;
    const tex = lib.canvasTexture(`pastel.decals.${res}`, res, res, (ctx, w) => {
      ctx.save();
      ctx.scale(w / AW, w / AW);
      drawAtlas(ctx);
      ctx.restore();
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.computeBoundingSphere();
    kit.ownGeometry(g);
    const common = { map: tex, transparent: true, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
    const mat = kit.ownMaterial(kit.low ? new THREE.MeshLambertMaterial(common) : new THREE.MeshStandardMaterial({ ...common, roughness: 0.9 }));
    mat.name = 'pastel.decals';
    mat.userData.noPaint = true;
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'pastel.decals';
    mesh.userData.noPaint = true;
    mesh.receiveShadow = kit.q.shadows !== 'off';
    mesh.renderOrder = 1;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return kit.add(mesh);
  }
}
