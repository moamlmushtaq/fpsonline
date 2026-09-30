// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — weapon geometry kit.
//
// Designs are written as a list of pieces (rounded boxes, lathes, side-profile
// extrusions…) placed under transform nodes. `Build.finalize()` merges every
// piece of a "bucket" into ONE indexed geometry carrying:
//   position, normal, uv (weapon-space box projection, 4 repeats / m, used by
//   the skin pattern), aFin = (finish palette index, baked AO).
// A bucket is the static body (root) or one moving part (magazine, bolt, pump,
// dial needle…) in the first-person LOD; the world LOD folds everything into
// the root bucket (moving parts become empty anchors), so a third-person gun
// is exactly one draw call.
//
// Merged geometries are cached per (weapon, detail level, bucket) and shared
// by every instance and every skin — never dispose them per instance.
// Piece makers only run on a cache miss, so creating the 2nd…Nth instance only
// rebuilds the (cheap) transform hierarchy.
//
// Quality levels: q = 2 first person, 1 third person (med/high), 0 third person (low).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponModel } from '../../contracts';
import type { WeaponId } from '../../../shared/types';
import { remapUV, type Rect } from './surface';

export type Q = 0 | 1 | 2;
export type GeoMaker = (q: Q) => THREE.BufferGeometry;

// ── Geometry makers ─────────────────────────────────────────────────────────

const segs = (q: Q, hi: number, mid: number, lo: number): number => (q === 2 ? hi : q === 1 ? mid : lo);

/**
 * Rounded box. Tessellation follows the corner radius (a 3-segment RoundedBox
 * is ~590 triangles — only worth it for big first-person shells); small or
 * third-person pieces fall back to 1 segment or a plain 12-triangle box.
 */
export const rbox = (w: number, h: number, d: number, r: number): GeoMaker => (q) => {
  const rr = Math.max(1e-4, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  if (q === 0 || (q === 1 && rr < 0.006) || (q === 2 && rr < 0.0012)) return new THREE.BoxGeometry(w, h, d);
  const s = q === 2 ? (rr >= 0.008 ? 3 : rr >= 0.0035 ? 2 : 1) : 1;
  return new RoundedBoxGeometry(w, h, d, s, rr);
};

const radial = (q: Q, rs: number): number => segs(q, rs, Math.max(6, Math.round(rs * 0.4)), Math.max(5, Math.round(rs * 0.25)));

/** Cylinder along Z (rFront = radius toward −Z / muzzle end, rBack = toward +Z). */
export const cylZ = (rFront: number, rBack: number, len: number, rs = 20): GeoMaker => (q) =>
  new THREE.CylinderGeometry(rFront, rBack, len, radial(q, rs), 1).rotateX(-Math.PI / 2);
export const cylX = (r: number, len: number, rs = 14): GeoMaker => (q) => new THREE.CylinderGeometry(r, r, len, radial(q, rs), 1).rotateZ(Math.PI / 2);
export const cylY = (rTop: number, rBot: number, len: number, rs = 20): GeoMaker => (q) => new THREE.CylinderGeometry(rTop, rBot, len, radial(q, rs), 1);
/** Torus around the Z axis (ring facing forward). */
export const torusZ = (r: number, tube: number, arc = Math.PI * 2, rs = 28): GeoMaker => (q) =>
  new THREE.TorusGeometry(r, tube, segs(q, 6, 3, 3), segs(q, rs, Math.max(8, Math.round(rs * 0.36)), Math.max(6, rs >> 2)), arc);
/** Torus around the Y axis (ring lying flat). */
export const torusY = (r: number, tube: number, arc = Math.PI * 2, rs = 28): GeoMaker => (q) => torusZ(r, tube, arc, rs)(q).rotateX(Math.PI / 2);
export const sphere = (r: number, rs = 14): GeoMaker => (q) => new THREE.SphereGeometry(r, segs(q, rs, 8, 6), segs(q, Math.max(6, rs >> 1), 5, 4));
export const capsuleZ = (r: number, len: number): GeoMaker => (q) => new THREE.CapsuleGeometry(r, len, segs(q, 4, 2, 2), segs(q, 12, 8, 6)).rotateX(Math.PI / 2);

/** Lathe around Z from (radius, u) points where u is the FORWARD distance (−Z). */
export const latheZ = (pts: [number, number][], rs = 24): GeoMaker => (q) => {
  const ordered = pts[0][1] > pts[pts.length - 1][1] ? [...pts].reverse() : pts;
  return new THREE.LatheGeometry(
    ordered.map(([r, u]) => new THREE.Vector2(Math.max(r, 1e-5), u)),
    radial(q, rs),
  ).rotateX(-Math.PI / 2);
};
/** Lathe around Y from (radius, y) points (bottom → top). */
export const latheY = (pts: [number, number][], rs = 32): GeoMaker => (q) => {
  const ordered = pts[0][1] > pts[pts.length - 1][1] ? [...pts].reverse() : pts;
  return new THREE.LatheGeometry(ordered.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)), radial(q, rs));
};

/** Profile point: (u = forward along −Z, v = up, optional corner radius). */
export type PP = [number, number, number?];

/**
 * `inset` = how far the extrusion caps are pulled inside the contour (the
 * rounded bevel). A rounded corner tighter than the inset folds over itself on
 * the cap (the "crumpled paper" triangles at shell corners), so corners are
 * widened to clear it, or made sharp (mitred) when the edges are too short.
 */
function roundedShape(pts: PP[], holes: PP[][], inset = 0): THREE.Shape {
  const minR = inset * 1.12;
  const trace = (path: THREE.Path, list: PP[]): void => {
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const [x, y, r0 = 0] = list[i];
      const p = list[(i - 1 + n) % n];
      const nx = list[(i + 1) % n];
      const d1 = Math.hypot(p[0] - x, p[1] - y) || 1;
      const d2 = Math.hypot(nx[0] - x, nx[1] - y) || 1;
      const cap = Math.min(d1 * 0.48, d2 * 0.48);
      let r = r0;
      if (r > 0 && r < minR) r = cap >= minR ? minR : 0;
      if (r <= 0) {
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
        continue;
      }
      const rr = Math.min(r, cap);
      const ax = x + ((p[0] - x) / d1) * rr, ay = y + ((p[1] - y) / d1) * rr;
      const bx = x + ((nx[0] - x) / d2) * rr, by = y + ((nx[1] - y) / d2) * rr;
      if (i === 0) path.moveTo(ax, ay);
      else path.lineTo(ax, ay);
      path.quadraticCurveTo(x, y, bx, by);
    }
    path.closePath();
  };
  const shape = new THREE.Shape();
  trace(shape, pts);
  for (const h of holes) {
    const hp = new THREE.Path();
    trace(hp, h);
    shape.holes.push(hp);
  }
  return shape;
}

/**
 * Side-profile extrusion: the silhouette is drawn in (u, v) = (forward, up) and
 * extruded across X (`width`) with a rounded bevel of `bevel` — bevel ≈ width/2
 * gives the pillowy pill cross-section of a ceramic shell. Caps keep flat
 * normals; bevel + walls are smoothed.
 */
export const profile = (pts: PP[], width: number, bevel = 0.006, holes: PP[][] = []): GeoMaker => (q) => {
  const b = Math.min(bevel, width / 2 - 5e-4);
  const depth = Math.max(0.0008, width - b * 2);
  // Lightening cuts only pay off up close; the low third-person LOD keeps solid shells.
  const g = new THREE.ExtrudeGeometry(roundedShape(pts, q === 0 ? [] : holes, b * 0.92), {
    depth,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b * 0.92,
    bevelOffset: -b * 0.92,
    bevelSegments: segs(q, 3, 1, 1),
    curveSegments: segs(q, 5, 2, 1),
  });
  // (u, v, extrude) → (x = extrude − depth/2, y = v, z = −u)
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -depth / 2, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
  const capCount = g.groups[0]?.count ?? 0;
  const pos = g.attributes.position as THREE.BufferAttribute;
  // Caps: flat. Walls/bevel: smooth.
  const cap = new THREE.BufferGeometry();
  cap.setAttribute('position', new THREE.BufferAttribute((pos.array as Float32Array).slice(0, capCount * 3), 3));
  cap.computeVertexNormals();
  const wall = new THREE.BufferGeometry();
  wall.setAttribute('position', new THREE.BufferAttribute((pos.array as Float32Array).slice(capCount * 3), 3));
  const wallM = mergeVertices(wall, 1e-6);
  wallM.computeVertexNormals();
  const capM = mergeVertices(cap, 1e-6);
  g.dispose();
  wall.dispose();
  cap.dispose();
  const out = joinIndexed([capM, wallM]);
  capM.dispose();
  wallM.dispose();
  return out;
};

/** Plane (decal) facing +Z, with UVs mapped into a print-atlas region. */
export const decalPlane = (w: number, h: number, region: Rect): GeoMaker => () => remapUV(new THREE.PlaneGeometry(w, h), region);
/** Disc (dial face) facing +Z mapped into a print-atlas region. */
export const decalDisc = (r: number, region: Rect): GeoMaker => (q) => remapUV(new THREE.CircleGeometry(r, segs(q, 32, 16, 12)), region);

/** Concatenates indexed geometries that only carry position + normal (+ optional uv). */
function joinIndexed(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
  const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    P.set(g.attributes.position.array as Float32Array, vo * 3);
    N.set(g.attributes.normal.array as Float32Array, vo * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) I[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < c; i++) I[io++] = i + vo;
    vo += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setIndex(new THREE.BufferAttribute(I, 1));
  return out;
}

// ── Caches ──────────────────────────────────────────────────────────────────

// Base (unmerged) piece geometries, keyed "<builder>:<piece key>|q". The
// builder namespace matters: designs reuse piece names ('receiver', 'stock',
// 'butt'…) for different shapes, and a global key would hand one weapon
// another's parts depending on creation order.
const baseCache = new Map<string, THREE.BufferGeometry>();
const mergedCache = new Map<string, THREE.BufferGeometry | null>();

function base(key: string, q: Q, make: GeoMaker): THREE.BufferGeometry {
  const k = `${key}|${q}`;
  let g = baseCache.get(k);
  if (!g) {
    g = make(q);
    if (!g.attributes.normal) g.computeVertexNormals();
    baseCache.set(k, g);
  }
  return g;
}

// ── Builder ─────────────────────────────────────────────────────────────────

interface PieceRec {
  key: string;
  make: GeoMaker;
  fin: number;
  ao: number;
  parent: THREE.Object3D;
  local: THREE.Matrix4;
  decal: boolean;
}

interface Bucket {
  owner: THREE.Object3D;
  pieces: PieceRec[];
}

export interface AddOpts {
  /** Baked AO multiplier (recessed slots ≈ 0.55). */
  ao?: number;
  scale?: [number, number, number];
  /** Only built for the first-person LOD. */
  view?: boolean;
  /** Skipped on the low third-person LOD. */
  mid?: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Build {
  readonly root = new THREE.Group();
  readonly parts: WeaponModel['parts'] = {};
  readonly muzzle = new THREE.Object3D();
  readonly sight = new THREE.Object3D();
  readonly handR = new THREE.Object3D();
  readonly handL = new THREE.Object3D();
  /** Extra hand/animation anchors (mag grab points, bolt knob, drum…). */
  readonly anchors: Record<string, THREE.Object3D> = {};
  readonly vents: THREE.Object3D[] = [];
  /** First person only: the needle of the analog dial and the ammo screen placement. */
  needle: THREE.Object3D | null = null;
  screen: { node: THREE.Object3D; w: number; h: number } | null = null;
  /** Metadata the viewmodel reads (grip radii, eye relief…). */
  readonly meta: Record<string, number> = {};
  readonly hi: boolean;
  private readonly buckets = new Map<THREE.Object3D, Bucket>();

  /** `cacheName` overrides the merge-cache namespace (non-weapon builds such as gloves). */
  constructor(readonly id: WeaponId, readonly q: Q, private readonly cacheName: string = id) {
    this.hi = q === 2;
    this.root.name = `weapon.${cacheName}.${q === 2 ? 'view' : 'world'}`;
    this.muzzle.name = 'muzzle';
    this.sight.name = 'sight';
    this.handR.name = 'handR';
    this.handL.name = 'handL';
    this.root.add(this.muzzle, this.sight, this.handR, this.handL);
    this.buckets.set(this.root, { owner: this.root, pieces: [] });
  }

  /** Plain transform node (its pieces merge into the enclosing bucket). */
  node(parent: THREE.Object3D, name: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    g.rotation.set(rx, ry, rz);
    parent.add(g);
    return g;
  }

  /**
   * Moving part: its own merged mesh in first person (an empty anchor in third
   * person, where its pieces merge into the body — or are dropped if `viewOnly`).
   */
  part(parent: THREE.Object3D, name: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, viewOnly = false): THREE.Group {
    const g = this.node(parent, name, x, y, z, rx, ry, rz);
    if (this.hi) this.buckets.set(g, { owner: g, pieces: [] });
    else if (viewOnly) g.userData.viewOnly = true;
    return g;
  }

  anchor(name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Object3D {
    const a = new THREE.Object3D();
    a.name = `anchor.${name}`;
    a.position.set(x, y, z);
    a.rotation.set(rx, ry, rz);
    parent.add(a);
    this.anchors[name] = a;
    return a;
  }

  add(parent: THREE.Object3D, key: string, make: GeoMaker, fin: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, opts?: AddOpts): void {
    if (opts?.view && !this.hi) return;
    if (opts?.mid && this.q === 0) return;
    if (!this.hi) for (let p: THREE.Object3D | null = parent; p; p = p.parent) if (p.userData.viewOnly) return;
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    const sc = opts?.scale;
    _s.set(sc ? sc[0] : 1, sc ? sc[1] : 1, sc ? sc[2] : 1);
    _p.set(x, y, z);
    this.bucketFor(parent).pieces.push({ key: `${this.cacheName}:${key}`, make, fin, ao: opts?.ao ?? 1, parent, local: new THREE.Matrix4().compose(_p, _q, _s), decal: false });
  }

  /** Printed decal (first person only) from the shared atlas; plane faces +Z before rotation. */
  decal(parent: THREE.Object3D, key: string, make: GeoMaker, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): void {
    if (!this.hi) return;
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(1, 1, 1);
    this.bucketFor(parent).pieces.push({ key: `${this.cacheName}:${key}`, make, fin: 0, ao: 1, parent, local: new THREE.Matrix4().compose(_p, _q, _s), decal: true });
  }

  private bucketFor(o: THREE.Object3D): Bucket {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      const b = this.buckets.get(p);
      if (b) return b;
    }
    return this.buckets.get(this.root)!;
  }

  /** Merges every bucket and attaches one mesh (+ one decal mesh) per bucket. */
  finalize(main: THREE.Material, print: THREE.Material | null): void {
    this.root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const tier = `${this.cacheName}|q${this.q}`;
    for (const b of this.buckets.values()) {
      const name = b.owner === this.root ? 'root' : b.owner.name;
      for (const decal of [false, true]) {
        const key = `${tier}|${name}|${decal ? 'decal' : 'body'}`;
        let g = mergedCache.get(key);
        if (g === undefined) {
          const list = b.pieces.filter((p) => p.decal === decal);
          g = list.length ? mergePieces(list, b.owner, rootInv, decal, this.q) : null;
          mergedCache.set(key, g);
        }
        if (!g) continue;
        const mat = decal ? print : main;
        if (!mat) continue;
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = `${name}.${decal ? 'print' : 'body'}`;
        mesh.matrixAutoUpdate = false;
        b.owner.add(mesh);
      }
    }
  }
}

const _w = new THREE.Matrix4();
const _own = new THREE.Matrix4();
const _rel = new THREE.Matrix4();
const _rr = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _nmr = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

function mergePieces(list: PieceRec[], owner: THREE.Object3D, rootInv: THREE.Matrix4, decal: boolean, q: Q): THREE.BufferGeometry {
  _own.copy(owner.matrixWorld).invert();
  let nv = 0, ni = 0;
  const bases: THREE.BufferGeometry[] = [];
  for (const p of list) {
    const g = base(p.key, q, p.make);
    bases.push(g);
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
  const A = decal ? null : new Float32Array(nv * 2);
  const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  list.forEach((p, k) => {
    const g = bases[k];
    _w.multiplyMatrices(p.parent.matrixWorld, p.local);
    _rel.multiplyMatrices(_own, _w);
    _rr.multiplyMatrices(rootInv, _w);
    _nm.getNormalMatrix(_rel);
    _nmr.getNormalMatrix(_rr);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
    const c = pos.count;
    for (let i = 0; i < c; i++) {
      const o = (vo + i) * 3;
      _v.fromBufferAttribute(pos, i).applyMatrix4(_rel);
      P[o] = _v.x;
      P[o + 1] = _v.y;
      P[o + 2] = _v.z;
      _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
      N[o] = _n.x;
      N[o + 1] = _n.y;
      N[o + 2] = _n.z;
      const t = (vo + i) * 2;
      if (decal) {
        U[t] = uv ? uv.getX(i) : 0;
        U[t + 1] = uv ? uv.getY(i) : 0;
        continue;
      }
      // Weapon-space box projection (continuous across pieces, rest pose).
      _v.fromBufferAttribute(pos, i).applyMatrix4(_rr);
      _n.fromBufferAttribute(nor, i).applyMatrix3(_nmr).normalize();
      const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
      if (ax >= ay && ax >= az) {
        U[t] = -_v.z * 4;
        U[t + 1] = _v.y * 4;
      } else if (ay >= az) {
        U[t] = -_v.z * 4;
        U[t + 1] = _v.x * 4;
      } else {
        U[t] = _v.x * 4;
        U[t + 1] = _v.y * 4;
      }
      // Baked AO: undersides and recesses darker, tops catch the sky.
      A![t] = p.fin;
      A![t + 1] = p.ao * (0.74 + 0.26 * (_n.y * 0.5 + 0.5));
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) I[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < c; i++) I[io++] = i + vo;
    vo += c;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  if (A) out.setAttribute('aFin', new THREE.BufferAttribute(A, 2));
  out.setIndex(new THREE.BufferAttribute(I, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Triangle count of the merged geometries of an object tree (diagnostics). */
export function countTriangles(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.visible) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  return n;
}
