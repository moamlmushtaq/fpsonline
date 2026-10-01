// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — map builder: geometry accumulation.
//
// Bucket = one merged mesh per material (positions, flat normals, world-scale
// box UVs, baked vertex colors from a Shade callback). Plus the primitive
// emitters used by the solid renderer: chamfered boxes, ramp wedges and
// displaced "lumpy" boxes (rocks, hedges, snowbanks), and the deterministic
// value noise that drives painterly vertex variation.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Solid } from '../../../shared/maps/types';

// ── Geometry accumulation ──────────────────────────────────────────────────

export type V3 = [number, number, number];
/** Returns a linear RGB multiplier for a vertex (position, normal). */
export type Shade = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => V3;

export class Bucket {
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

export function h2(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise2(x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h2(x0, y0), b = h2(x0 + 1, y0), c = h2(x0, y0 + 1), d = h2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export function vnoise3(x: number, y: number, z: number): number {
  const a = vnoise2(x + z * 1.7, y - z * 0.6);
  const b = vnoise2(y * 1.3 - x * 0.4 + 11, z + 5.2);
  return (a + b) * 0.5;
}

/** Axis-aligned chamfered box with optional grid on the top face and a Y split on the sides. */
export function chamferBox(b: Bucket, min: V3, max: V3, chamfer: number, shade: Shade, topGrid: number, splitY: number[], skipBottom: boolean): void {
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

export function rampWedge(b: Bucket, s: Solid, shade: Shade): void {
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
export function lumpyBox(b: Bucket, s: Solid, shade: Shade, smooth: boolean, amp: number, seg: number): void {
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
