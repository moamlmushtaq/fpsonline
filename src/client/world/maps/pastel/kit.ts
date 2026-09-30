// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel decor kit: batched static geometry.
//
// Every static decor piece is appended into a per-material Batch (positions,
// normals, world-scale box-projected UVs, baked vertex colors = palette color ×
// cheap AO × painterly drift). At the end each batch becomes ONE mesh, so the
// whole suburb costs roughly one draw call per material (~15).
//
// Textured kinds reuse the shared MaterialLibrary vertex-color surfaces (same
// procedural textures as the map builder → consistent look, owned by the
// library). Untextured kinds (paint, chrome, windows, glass, glow) are created
// here and disposed in dispose().
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { DecorContext, MaterialLibrary, QualitySettings } from '../../../contracts';
import type { SurfaceTag } from '../../../../shared/types';
import { TEX_TILE } from '../../../engine/textures';

export type Kind =
  | 'plaster'
  | 'concrete'
  | 'asphalt'
  | 'wood'
  | 'metal'
  | 'tile'
  | 'grass'
  | 'foliage'
  | 'fabric'
  | 'corrugated'
  | 'paint'
  | 'chrome'
  | 'window'
  | 'glass'
  | 'glow'
  | 'stem';

/** Shared texture tag per textured kind. */
const KIND_TAG: Partial<Record<Kind, { tag: SurfaceTag; style?: string; tile: number }>> = {
  plaster: { tag: 'plaster', tile: TEX_TILE.plaster },
  concrete: { tag: 'concrete', tile: TEX_TILE.concrete },
  asphalt: { tag: 'concrete', tile: 6 },
  wood: { tag: 'wood', tile: TEX_TILE.wood },
  metal: { tag: 'metal', tile: TEX_TILE.metal },
  tile: { tag: 'tile', tile: TEX_TILE.tile },
  grass: { tag: 'grass', tile: TEX_TILE.grass },
  foliage: { tag: 'foliage', tile: TEX_TILE.foliage },
  fabric: { tag: 'fabric', tile: TEX_TILE.fabric },
  corrugated: { tag: 'metal', style: 'shed', tile: TEX_TILE.corrugated },
};

/** Kinds that cast sun shadows (big opaque masses). */
const CASTS: Partial<Record<Kind, boolean>> = {
  plaster: true,
  concrete: true,
  wood: true,
  metal: true,
  paint: true,
  chrome: true,
  foliage: true,
  corrugated: true,
  tile: true,
  fabric: true,
};

export type RGB = [number, number, number];

/** sRGB hex → linear RGB triple (vertex colors are linear). */
export function rgb(hex: string, k = 1): RGB {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ── Tiny deterministic value noise (painterly drift) ───────────────────────

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

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
  /** Y of the ground the object stands on (contact darkening below baseY + 1.3). -Infinity = no AO. */
  base?: number;
  /** Strength of the contact AO band (0..1, default 0.4). */
  ao?: number;
  /** Painterly drift amount (default 0.1). */
  drift?: number;
  /** Extra per-vertex shading hook: returns a multiplier. */
  shade?: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;
  /** Per-vertex sway weight (glow/stem vines animate in the vertex shader). */
  sway?: number | ((x: number, y: number, z: number) => number);
}

class Batch {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly sway: number[] = [];
  hasSway = false;
  constructor(readonly tile: number) {}
}

/** Non-indexed copy (disposes the indexed source). */
function flat(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!g.index) return g;
  const n = g.toNonIndexed();
  g.dispose();
  return n;
}

const TMP_V = new THREE.Vector3();
const TMP_N = new THREE.Vector3();
const TMP_M3 = new THREE.Matrix3();

/** Cache of unit primitives (built once per kit). */
interface Prims {
  box: THREE.BufferGeometry;
  chamfer: Map<string, THREE.BufferGeometry>;
  cyl: Map<string, THREE.BufferGeometry>;
  sphere: Map<number, THREE.BufferGeometry>;
}

export class DecorKit {
  readonly q: QualitySettings;
  readonly lib: MaterialLibrary;
  readonly root: THREE.Group;
  /** Detail density 0.35..1 (props, vines, clutter). */
  readonly detail: number;
  readonly low: boolean;
  private readonly batches = new Map<Kind, Batch>();
  private readonly ownedMats: THREE.Material[] = [];
  private readonly ownedGeos: THREE.BufferGeometry[] = [];
  private readonly prims: Prims;
  /** Shared uniform driving vine sway / flutter. */
  readonly time = { value: 0 };
  /** Built meshes by kind (for stats / tweaks). */
  readonly meshes = new Map<Kind, THREE.Mesh>();
  /** Objects added outside batches (signs, water, animated parts) — disposed by dispose(). */
  private readonly extras: THREE.Object3D[] = [];

  constructor(ctx: DecorContext) {
    this.q = ctx.quality;
    this.lib = ctx.materials;
    this.root = ctx.root;
    this.detail = Math.max(0.35, Math.min(1, ctx.quality.decor));
    this.low = ctx.quality.preset === 'low';
    const box = flat(new THREE.BoxGeometry(1, 1, 1));
    this.prims = { box, chamfer: new Map(), cyl: new Map(), sphere: new Map() };
    this.ownedGeos.push(box);
  }

  // ── Primitive geometry (unit-sized, cached) ─────────────────────────────

  private chamferGeo(w: number, h: number, d: number, r: number, seg: number): THREE.BufferGeometry {
    const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}|${seg}`;
    let g = this.prims.chamfer.get(key);
    if (!g) {
      const rr = Math.min(r, w * 0.49, h * 0.49, d * 0.49);
      g = flat(new RoundedBoxGeometry(w, h, d, seg, rr));
      this.prims.chamfer.set(key, g);
      this.ownedGeos.push(g);
    }
    return g;
  }

  cylGeo(rTop: number, rBot: number, seg: number, open = false): THREE.BufferGeometry {
    const key = `${rTop}|${rBot}|${seg}|${open ? 1 : 0}`;
    let g = this.prims.cyl.get(key);
    if (!g) {
      g = flat(new THREE.CylinderGeometry(rTop, rBot, 1, seg, 1, open));
      this.prims.cyl.set(key, g);
      this.ownedGeos.push(g);
    }
    return g;
  }

  sphereGeo(detail: number): THREE.BufferGeometry {
    let g = this.prims.sphere.get(detail);
    if (!g) {
      // detail −1 = octahedron (8 tris) for tiny glowing bulbs on Low.
      g = flat(detail < 0 ? new THREE.OctahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, detail));
      this.prims.sphere.set(detail, g);
      this.ownedGeos.push(g);
    }
    return g;
  }

  // ── Adding geometry ────────────────────────────────────────────────────

  private batch(kind: Kind): Batch {
    let b = this.batches.get(kind);
    if (!b) {
      b = new Batch(KIND_TAG[kind]?.tile ?? 2);
      // Vines sway in the vertex shader: these batches always carry a weight.
      b.hasSway = kind === 'glow' || kind === 'stem';
      this.batches.set(kind, b);
    }
    return b;
  }

  /** Appends `geo` (non-indexed preferred) transformed by `m`, tinted `color`. */
  geo(kind: Kind, geo: THREE.BufferGeometry, m: THREE.Matrix4, color: RGB, opts: AddOpts = {}): void {
    const b = this.batch(kind);
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute | undefined;
    TMP_M3.getNormalMatrix(m);
    const base = opts.base ?? -Infinity;
    const ao = opts.ao ?? 0.4;
    const drift = opts.drift ?? 0.1;
    const t = b.tile;
    const sway = b.hasSway ? opts.sway ?? 0 : undefined;
    for (let i = 0; i < p.count; i++) {
      TMP_V.fromBufferAttribute(p, i).applyMatrix4(m);
      if (n) TMP_N.fromBufferAttribute(n, i).applyMatrix3(TMP_M3).normalize();
      else TMP_N.set(0, 1, 0);
      const x = TMP_V.x;
      const y = TMP_V.y;
      const z = TMP_V.z;
      const nx = TMP_N.x;
      const ny = TMP_N.y;
      const nz = TMP_N.z;
      b.pos.push(x, y, z);
      b.nor.push(nx, ny, nz);
      const ax = Math.abs(nx);
      const ay = Math.abs(ny);
      const az = Math.abs(nz);
      if (ay >= ax && ay >= az) b.uv.push(x / t, z / t);
      else if (ax >= az) b.uv.push(z / t, y / t);
      else b.uv.push(x / t, y / t);
      let k = 1;
      if (ny < -0.5) k *= 0.62;
      else if (ny > 0.5) k *= 1.04;
      if (base > -1e9) {
        const h = y - base;
        const s = h <= 0 ? 0 : h >= 1.3 ? 1 : (h / 1.3) * (h / 1.3) * (3 - (2 * h) / 1.3);
        k *= 1 - ao + ao * s;
      }
      if (drift > 0) {
        const d = vnoise(x * 0.17 + 3.1, (z + y * 0.5) * 0.17 - 7.7) - 0.5;
        k *= 1 + d * drift * 1.4;
      }
      if (opts.shade) k *= opts.shade(x, y, z, nx, ny, nz);
      const w = drift > 0 ? (vnoise(x * 0.05 - 1.3, z * 0.05 + 9.2) - 0.5) * 0.08 : 0;
      b.col.push(color[0] * k * (1 + w), color[1] * k, color[2] * k * (1 - w));
      if (sway !== undefined) b.sway.push(typeof sway === 'number' ? sway : sway(x, y, z));
    }
    if (g !== geo) g.dispose();
  }

  /** Axis-aligned box from two corners. `r` > 0 = chamfered/rounded edges. */
  box(kind: Kind, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: RGB, r = 0, opts: AddOpts = {}): void {
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const d = Math.abs(z1 - z0);
    if (w < 1e-4 || h < 1e-4 || d < 1e-4) return;
    const m = new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    // Tiny chamfers are invisible at game distances: plain boxes (12 tris vs 108).
    if (this.low ? r >= 0.2 : r >= 0.06 || (r > 0 && Math.max(w, h, d) < 1.5)) {
      this.geo(kind, this.chamferGeo(w, h, d, r, r > 0.2 ? 2 : 1), m, color, { base: Math.min(y0, y1), ...opts });
    } else {
      m.scale(new THREE.Vector3(w, h, d));
      this.geo(kind, this.prims.box, m, color, { base: Math.min(y0, y1), ...opts });
    }
  }

  /** Box centered at (cx, cy, cz) with size (sx, sy, sz), rotated about Y by `ry`. */
  boxR(kind: Kind, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry: number, color: RGB, r = 0, opts: AddOpts = {}): void {
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(cx, cy, cz);
    if (this.low ? r >= 0.2 : r >= 0.06) this.geo(kind, this.chamferGeo(sx, sy, sz, r, r > 0.2 ? 2 : 1), m, color, { base: cy - sy / 2, ...opts });
    else {
      m.multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
      this.geo(kind, this.prims.box, m, color, { base: cy - sy / 2, ...opts });
    }
  }

  /** Box with a full transform (position, euler rotation, size). */
  boxE(kind: Kind, pos: THREE.Vector3, rot: THREE.Euler, size: THREE.Vector3, color: RGB, r = 0, opts: AddOpts = {}): void {
    const round = this.low ? r >= 0.2 : r > 0;
    const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(rot), round ? new THREE.Vector3(1, 1, 1) : size);
    if (round) this.geo(kind, this.chamferGeo(size.x, size.y, size.z, r, 1), m, color, opts);
    else this.geo(kind, this.prims.box, m, color, opts);
  }

  /** Vertical cylinder standing on (x, y, z). */
  cyl(kind: Kind, x: number, y: number, z: number, rTop: number, rBot: number, h: number, color: RGB, seg = 10, opts: AddOpts = {}): void {
    const m = new THREE.Matrix4().makeTranslation(x, y + h / 2, z).multiply(new THREE.Matrix4().makeScale(1, h, 1));
    this.geo(kind, this.cylGeo(rTop, rBot, seg), m, color, { base: y, ...opts });
  }

  /** Cylinder between two points. */
  tube(kind: Kind, a: THREE.Vector3, b: THREE.Vector3, r: number, color: RGB, seg = 6, opts: AddOpts = {}): void {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, len, 1));
    this.geo(kind, this.cylGeo(r, r, seg, true), m, color, opts);
  }

  /** Sphere / ellipsoid. */
  ball(kind: Kind, x: number, y: number, z: number, rx: number, ry: number, rz: number, color: RGB, detail = 1, opts: AddOpts = {}): void {
    const m = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeScale(rx, ry, rz));
    // Low preset: one tessellation level less (bulbs become octahedra).
    const d = this.low ? (detail === 0 && Math.max(rx, ry, rz) < 0.25 ? -1 : Math.max(0, detail - 1)) : detail;
    this.geo(kind, this.sphereGeo(d), m, color, opts);
  }

  /** Flat quad from 4 corners (counter-clockwise seen from the front). */
  quad(kind: Kind, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: RGB, opts: AddOpts = {}): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z], 3));
    g.computeVertexNormals();
    this.geo(kind, g, new THREE.Matrix4(), color, opts);
    g.dispose();
  }

  /** Horizontal rectangle (top-facing) at height y. */
  slab(kind: Kind, x0: number, z0: number, x1: number, z1: number, y: number, color: RGB, opts: AddOpts = {}): void {
    this.quad(kind, new THREE.Vector3(x0, y, z1), new THREE.Vector3(x1, y, z1), new THREE.Vector3(x1, y, z0), new THREE.Vector3(x0, y, z0), color, { drift: 0.14, ...opts });
  }

  // ── Materials ─────────────────────────────────────────────────────────

  private own<T extends THREE.Material>(m: T): T {
    this.ownedMats.push(m);
    return m;
  }

  ownGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
    this.ownedGeos.push(g);
    return g;
  }

  ownMaterial<T extends THREE.Material>(m: T): T {
    return this.own(m);
  }

  /** Adds an extra object under the decor root; its geometry is disposed with the kit. */
  add<T extends THREE.Object3D>(o: T): T {
    this.root.add(o);
    this.extras.push(o);
    return o;
  }

  /** Vertex-colored material for a kind. */
  material(kind: Kind): THREE.Material {
    const tex = KIND_TAG[kind];
    if (tex) {
      const lib = this.lib as MaterialLibrary & { surfaceVC?: (tag: SurfaceTag, opts?: { style?: string; color?: string }) => THREE.Material };
      if (lib.surfaceVC) return lib.surfaceVC(tex.tag, { style: tex.style, color: '#ffffff' });
    }
    const low = this.low;
    switch (kind) {
      case 'chrome':
        return this.own(low ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.65 }));
      case 'window':
        return this.own(
          low
            ? new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color('#3b4150').multiplyScalar(0.25) })
            : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.35, emissive: new THREE.Color('#9cc3d5').multiplyScalar(0.06) }),
        );
      case 'glass':
        return this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
      case 'glow':
        return this.own(swayMaterial(new THREE.MeshBasicMaterial({ vertexColors: true }), this.time));
      case 'stem':
        return this.own(
          swayMaterial(low ? new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), this.time),
        );
      case 'paint':
      default:
        return this.own(low ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 }));
    }
  }

  /** Merges every batch into meshes under the decor root. Returns draw calls added. */
  build(): number {
    const shadows = this.q.shadows !== 'off';
    let calls = 0;
    for (const [kind, b] of this.batches) {
      if (!b.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      if (b.hasSway) g.setAttribute('sway', new THREE.Float32BufferAttribute(b.sway, 1));
      g.computeBoundingSphere();
      this.ownedGeos.push(g);
      const mesh = new THREE.Mesh(g, this.material(kind));
      mesh.name = `pastel.${kind}`;
      mesh.castShadow = shadows && !!CASTS[kind];
      mesh.receiveShadow = shadows && kind !== 'glow' && kind !== 'glass';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (kind === 'glass') mesh.renderOrder = 5;
      this.root.add(mesh);
      this.meshes.set(kind, mesh);
      calls++;
    }
    this.batches.clear();
    return calls;
  }

  dispose(): void {
    for (const o of this.extras) {
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose();
      });
      o.removeFromParent();
    }
    for (const m of this.meshes.values()) m.removeFromParent();
    for (const g of this.ownedGeos) g.dispose();
    for (const m of this.ownedMats) m.dispose();
    this.ownedGeos.length = 0;
    this.ownedMats.length = 0;
  }
}

/** Adds a cheap wind sway to vertices carrying a `sway` weight (0 = anchored). */
export function swayMaterial<T extends THREE.Material>(m: T, time: { value: number }): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSwayTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uSwayTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float swPh = position.x * 0.37 + position.z * 0.29;
        transformed.x += sway * (sin(uSwayTime * 1.3 + swPh) * 0.12 + sin(uSwayTime * 2.9 + swPh * 1.7) * 0.04);
        transformed.z += sway * cos(uSwayTime * 1.1 + swPh * 1.3) * 0.1;`,
      );
  };
  m.customProgramCacheKey = () => 'pastel-sway';
  return m;
}
