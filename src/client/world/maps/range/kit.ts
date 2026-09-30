// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range decor kit: batched static geometry.
//
// Every static piece is appended to a per-kind batch (world positions,
// normals, world-scale box-projected UVs and baked vertex colors = palette
// color × contact AO × painterly drift). build() turns each batch into ONE
// mesh, so the whole proving ground costs about one draw call per kind.
// Textured kinds reuse the MaterialLibrary's vertex-color surfaces (same
// procedural textures as the map builder); untextured kinds (ceramic, paint,
// metal trim, glow) are owned here and disposed with the kit.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { DecorContext, MaterialLibrary, QualitySettings } from '../../../contracts';
import type { SurfaceTag } from '../../../../shared/types';
import { TEX_TILE } from '../../../engine/textures';

export type Kind = 'concrete' | 'plaster' | 'wood' | 'metal' | 'fabric' | 'sand' | 'grass' | 'ceramic' | 'paint' | 'trim' | 'glow' | 'glass';

const KIND_TAG: Partial<Record<Kind, { tag: SurfaceTag; tile: number }>> = {
  concrete: { tag: 'concrete', tile: TEX_TILE.concrete },
  plaster: { tag: 'plaster', tile: TEX_TILE.plaster },
  wood: { tag: 'wood', tile: TEX_TILE.wood },
  metal: { tag: 'metal', tile: TEX_TILE.metal },
  fabric: { tag: 'fabric', tile: TEX_TILE.fabric },
  sand: { tag: 'sand', tile: TEX_TILE.sand ?? 4 },
  grass: { tag: 'grass', tile: TEX_TILE.grass },
};

const NO_SHADOW: Partial<Record<Kind, boolean>> = { glow: true, glass: true };

export type RGB = [number, number, number];

export function rgb(hex: string, k = 1): RGB {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tiny deterministic value noise (painterly drift). */
export function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export interface AddOpts {
  /** Ground height for the contact-AO band (−Infinity = none). */
  base?: number;
  /** AO strength 0..1 (default .38). */
  ao?: number;
  /** Painterly drift (default .1). */
  drift?: number;
}

class Batch {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  constructor(readonly tile: number) {}
}

const TV = new THREE.Vector3();
const TN = new THREE.Vector3();
const TM3 = new THREE.Matrix3();

export class RangeKit {
  readonly q: QualitySettings;
  readonly lib: MaterialLibrary;
  readonly root: THREE.Group;
  readonly low: boolean;
  /** Detail density 0.35..1. */
  readonly detail: number;
  private readonly batches = new Map<Kind, Batch>();
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();
  private readonly owned: { dispose(): void }[] = [];
  private readonly extras: THREE.Object3D[] = [];
  calls = 0;

  constructor(ctx: DecorContext) {
    this.q = ctx.quality;
    this.lib = ctx.materials;
    this.root = ctx.root;
    this.low = ctx.quality.preset === 'low';
    this.detail = Math.max(0.35, Math.min(1, ctx.quality.decor));
  }

  /** Cached, non-indexed unit geometry. */
  cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) {
      const m = make();
      g = m.index ? m.toNonIndexed() : m;
      if (g !== m) m.dispose();
      this.geoCache.set(key, g);
    }
    return g;
  }

  private batch(kind: Kind): Batch {
    let b = this.batches.get(kind);
    if (!b) this.batches.set(kind, (b = new Batch(KIND_TAG[kind]?.tile ?? 2)));
    return b;
  }

  /** Appends a geometry transformed by `m`, tinted `color`. */
  geo(kind: Kind, geo: THREE.BufferGeometry, m: THREE.Matrix4, color: RGB, opts: AddOpts = {}): void {
    const b = this.batch(kind);
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute | undefined;
    TM3.getNormalMatrix(m);
    const base = opts.base ?? -Infinity;
    const ao = opts.ao ?? 0.38;
    const drift = opts.drift ?? 0.1;
    const t = b.tile;
    for (let i = 0; i < p.count; i++) {
      TV.fromBufferAttribute(p, i).applyMatrix4(m);
      if (n) TN.fromBufferAttribute(n, i).applyMatrix3(TM3).normalize();
      else TN.set(0, 1, 0);
      const { x, y, z } = TV;
      b.pos.push(x, y, z);
      b.nor.push(TN.x, TN.y, TN.z);
      const ax = Math.abs(TN.x);
      const ay = Math.abs(TN.y);
      const az = Math.abs(TN.z);
      if (ay >= ax && ay >= az) b.uv.push(x / t, z / t);
      else if (ax >= az) b.uv.push(z / t, y / t);
      else b.uv.push(x / t, y / t);
      let k = 1;
      if (TN.y < -0.5) k *= 0.64;
      else if (TN.y > 0.5) k *= 1.05;
      if (base > -1e9) {
        const hh = y - base;
        const s = hh <= 0 ? 0 : hh >= 1.2 ? 1 : (hh / 1.2) * (hh / 1.2) * (3 - (2 * hh) / 1.2);
        k *= 1 - ao + ao * s;
      }
      if (drift > 0) k *= 1 + (vnoise(x * 0.19 + 3.1, (z + y * 0.5) * 0.19 - 7.7) - 0.5) * drift * 1.4;
      const w = drift > 0 ? (vnoise(x * 0.05 - 1.3, z * 0.05 + 9.2) - 0.5) * 0.07 : 0;
      b.col.push(color[0] * k * (1 + w), color[1] * k, color[2] * k * (1 - w));
    }
    if (g !== geo) g.dispose();
  }

  /** Axis-aligned box from two corners; r > 0 = rounded edges (skipped on low when tiny). */
  box(kind: Kind, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: RGB, r = 0, opts: AddOpts = {}): void {
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const d = Math.abs(z1 - z0);
    if (w < 1e-4 || h < 1e-4 || d < 1e-4) return;
    this.boxR(kind, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, w, h, d, 0, color, r, { base: Math.min(y0, y1), ...opts });
  }

  /** Box centred at (cx, cy, cz), size (sx, sy, sz), rotated about Y. */
  boxR(kind: Kind, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry: number, color: RGB, r = 0, opts: AddOpts = {}): void {
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(cx, cy, cz);
    const round = r > 0 && (!this.low || r >= 0.12);
    if (round) {
      const rr = Math.min(r, sx * 0.49, sy * 0.49, sz * 0.49);
      const g = this.cached(`rb|${sx.toFixed(3)}|${sy.toFixed(3)}|${sz.toFixed(3)}|${rr.toFixed(3)}`, () => new RoundedBoxGeometry(sx, sy, sz, rr > 0.15 ? 2 : 1, rr));
      this.geo(kind, g, m, color, { base: cy - sy / 2, ...opts });
    } else {
      m.multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
      this.geo(kind, this.cached('box', () => new THREE.BoxGeometry(1, 1, 1)), m, color, { base: cy - sy / 2, ...opts });
    }
  }

  /** Vertical cylinder standing on (x, y, z). */
  cyl(kind: Kind, x: number, y: number, z: number, rTop: number, rBot: number, h: number, color: RGB, seg = 12, opts: AddOpts = {}): void {
    const s = this.low ? Math.max(6, Math.round(seg * 0.6)) : seg;
    const g = this.cached(`cyl|${rTop}|${rBot}|${s}`, () => new THREE.CylinderGeometry(rTop, rBot, 1, s));
    const m = new THREE.Matrix4().makeTranslation(x, y + h / 2, z).multiply(new THREE.Matrix4().makeScale(1, h, 1));
    this.geo(kind, g, m, color, { base: y, ...opts });
  }

  /** Cylinder between two points. */
  tube(kind: Kind, a: THREE.Vector3, b: THREE.Vector3, r: number, color: RGB, seg = 8, opts: AddOpts = {}): void {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return;
    const s = this.low ? Math.max(5, Math.round(seg * 0.6)) : seg;
    const g = this.cached(`tube|${r}|${s}`, () => new THREE.CylinderGeometry(r, r, 1, s, 1, true));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, len, 1));
    this.geo(kind, g, m, color, opts);
  }

  /** Any geometry placed with position / euler rotation / scale. */
  place(kind: Kind, g: THREE.BufferGeometry, pos: THREE.Vector3, rot: THREE.Euler, scale: THREE.Vector3, color: RGB, opts: AddOpts = {}): void {
    const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(rot), scale);
    this.geo(kind, g, m, color, opts);
  }

  /** Top-facing rectangle at height y. */
  slab(kind: Kind, x0: number, z0: number, x1: number, z1: number, y: number, color: RGB, opts: AddOpts = {}): void {
    const g = this.cached('slab', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const m = new THREE.Matrix4().makeTranslation((x0 + x1) / 2, y, (z0 + z1) / 2).multiply(new THREE.Matrix4().makeScale(Math.abs(x1 - x0), 1, Math.abs(z1 - z0)));
    this.geo(kind, g, m, color, { drift: 0.12, ...opts });
  }

  /** Adds an extra object (signs, animated parts); geometries disposed with the kit. */
  add<T extends THREE.Object3D>(o: T): T {
    this.root.add(o);
    this.extras.push(o);
    return o;
  }

  own<T extends { dispose(): void }>(x: T): T {
    this.owned.push(x);
    return x;
  }

  private material(kind: Kind): THREE.Material {
    const tex = KIND_TAG[kind];
    if (tex) {
      const lib = this.lib as MaterialLibrary & { surfaceVC?: (tag: SurfaceTag, opts?: { style?: string; color?: string }) => THREE.Material };
      if (lib.surfaceVC) return lib.surfaceVC(tex.tag, { color: '#ffffff' });
    }
    const low = this.low;
    const std = (o: THREE.MeshStandardMaterialParameters) => this.own(low ? new THREE.MeshLambertMaterial({ vertexColors: true, emissive: o.emissive }) : new THREE.MeshStandardMaterial({ vertexColors: true, ...o }));
    switch (kind) {
      case 'ceramic':
        return std({ roughness: 0.32, metalness: 0.02 });
      case 'trim':
        return std({ roughness: 0.38, metalness: 0.55 });
      case 'glow':
        return this.own(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true }));
      case 'glass':
        return this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
      case 'paint':
      default:
        return std({ roughness: 0.66, metalness: 0.02 });
    }
  }

  /** Merges every batch into one mesh per kind under the decor root. */
  build(): void {
    const shadows = this.q.shadows !== 'off';
    for (const [kind, b] of this.batches) {
      if (!b.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      this.own(g);
      const mesh = new THREE.Mesh(g, this.material(kind));
      mesh.name = `range.${kind}`;
      mesh.castShadow = shadows && !NO_SHADOW[kind];
      mesh.receiveShadow = shadows && !NO_SHADOW[kind];
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (kind === 'glass') mesh.renderOrder = 5;
      this.root.add(mesh);
      this.calls++;
    }
    this.batches.clear();
  }

  dispose(): void {
    for (const o of this.extras) {
      o.traverse((c) => (c as THREE.Mesh).geometry?.dispose());
      o.removeFromParent();
    }
    for (const g of this.geoCache.values()) g.dispose();
    for (const x of this.owned) x.dispose();
    this.geoCache.clear();
    this.owned.length = 0;
  }
}
