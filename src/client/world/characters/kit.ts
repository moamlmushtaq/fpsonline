// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — character geometry kit.
//
// Low-poly primitives with controllable roundness (superquadric shells,
// tapered tubes, bands, leaves, surface-conforming patches/decals for visors)
// and an assembler that bakes everything into ONE skinned BufferGeometry:
//  • position / normal / uv (box-projected per part, for the detail texture)
//  • color  — albedo × painterly AO-by-colour (downward faces and feet darker)
//  • fx     — x: team-glow weight, y: secondary-glow weight,
//             z: team paint (+1 primary, −1 secondary), w: gloss 0..1
//  • skinIndex / skinWeight — rigid parts or 2-bone blends near joints.
// All authoring happens in bone-local space; parts are moved into model space
// through the faction's rest pose.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BONE_INDEX, BONES, PARENT, type BoneName, type RigDef, type V3 } from './rig';

export type ColorLike = THREE.Color | string;

/** Detail tier: 0 = low preset, 1 = gameplay, 2 = menu showcase. */
export type Detail = 0 | 1 | 2;

export interface PartOpts {
  pos?: V3;
  rot?: V3;
  scale?: V3;
  /** 0 = matte fabric … 1 = glossy ceramic. */
  gloss?: number;
  /** Team emissive weight (visor lines, status lights). */
  glow?: number;
  /** Secondary emissive weight (Bloom violet). */
  glow2?: number;
  /** +1 → team primary paint, −1 → team secondary paint (fractions blend). */
  paint?: number;
  /** Vertical colour gradient in shape-local Y: colour at y ≥ to. */
  grad?: { color: ColorLike; from: number; to: number };
  /** Smooth skin blends toward another bone around a bone-local Y. */
  blend?: { bone: BoneName; y: number; w: number }[];
  /** Strength of painterly AO (0 = none). Default 1. */
  ao?: number;
  /** Deterministic lumpy displacement amplitude (m) — bark/moss. */
  lumps?: number;
  /**
   * Glow ramp along shape-local Y: the glow weights (glow / glow2) fade in
   * from `from` to `to` (bioluminescent frond tips, veins that brighten).
   */
  glowY?: { from: number; to: number };
  /**
   * Visor line: flagged in the fx attribute (w > 1.25, y = bind-space eye-line
   * height) so the vertex shader can thicken it with distance — a 4 cm line is
   * sub-pixel at 60 m and would otherwise vanish entirely.
   */
  visor?: boolean;
}

/** fx.w value marking visor vertices (gloss reads clamp(w, 0, 1) = 1). */
export const VISOR_FLAG = 1.5;

interface Part {
  bone: BoneName;
  geo: THREE.BufferGeometry;
  color: THREE.Color;
  o: PartOpts;
}

// ── Superquadric surface ───────────────────────────────────────────────────

export interface SqParams {
  /** Half extents. */
  rx: number;
  ry: number;
  rz: number;
  /** Horizontal roundness (1 = round, → 0 = square). */
  p?: number;
  /** Vertical roundness. */
  q?: number;
  /** Horizontal scale at the top / bottom (taper). */
  top?: number;
  bot?: number;
  /** Shift the top forward/back (+z) — leans shells. */
  shear?: number;
}

const spow = (v: number, e: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);

/** Maps a unit-sphere direction onto the superquadric surface (grow = extra radius). */
export function sqPoint(s: SqParams, x: number, y: number, z: number, grow: number, out: THREE.Vector3): THREE.Vector3 {
  const p = s.p ?? 1;
  const q = s.q ?? p;
  const rr = Math.hypot(x, z);
  const yy = spow(y, q);
  const hr = Math.pow(rr, q);
  let xx = 0;
  let zz = 0;
  if (rr > 1e-7) {
    xx = hr * spow(x / rr, p);
    zz = hr * spow(z / rr, p);
  }
  const t = (yy + 1) * 0.5;
  const sc = (s.bot ?? 1) + ((s.top ?? 1) - (s.bot ?? 1)) * t;
  return out.set(xx * sc * (s.rx + grow), yy * (s.ry + grow), zz * sc * (s.rz + grow) + (s.shear ?? 0) * yy);
}

/** Sphere-parameter direction (three.js SphereGeometry convention; front −Z at phi = 3π/2). */
function dirOf(phi: number, theta: number, out: THREE.Vector3): THREE.Vector3 {
  const st = Math.sin(theta);
  return out.set(-Math.cos(phi) * st, Math.cos(theta), Math.sin(phi) * st);
}

export const FRONT = Math.PI * 1.5;

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

function weldNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const w = mergeVertices(g, 1e-5);
  g.dispose();
  w.computeVertexNormals();
  return w;
}

/** Closed (or partial, via phi/theta ranges) superquadric shell. */
export function sq(s: SqParams, ws: number, hs: number, phi0 = 0, phiLen = Math.PI * 2, th0 = 0, thLen = Math.PI): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs, phi0, phiLen, th0, thLen);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    sqPoint(s, pos.getX(i), pos.getY(i), pos.getZ(i), 0, _v);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  return weldNormals(g);
}

/** A band/patch conforming to a superquadric (visors): phi/theta ranges around the surface. */
export function sqPatch(s: SqParams, grow: number, phi0: number, phiLen: number, th0: number, thLen: number, ws: number, hs: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs, phi0, phiLen, th0, thLen);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    sqPoint(s, pos.getX(i), pos.getY(i), pos.getZ(i), grow, _v);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  return weldNormals(g);
}

/** Projects a flat 2D geometry (x → phi, y → theta offsets in radians) onto the superquadric. */
export function sqDecal(s: SqParams, grow: number, flat: THREE.BufferGeometry, phiC: number, thC: number): THREE.BufferGeometry {
  const g = flat.index ? flat : flat;
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    dirOf(phiC + pos.getX(i), thC - pos.getY(i), _d);
    sqPoint(s, _d.x, _d.y, _d.z, grow, _v);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  return weldNormals(g);
}

/** Tube along −Y from y = 0 to y = −len (limb segments). */
export function tube(r0: number, r1: number, len: number, radial: number, rings = 1, open = true): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r0, r1, len, radial, rings, open);
  g.translate(0, -len / 2, 0);
  return g;
}

/** Thin wrap band (open ring) around Y. */
export function band(r: number, h: number, radial: number, rTop = r): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, r, h, radial, 1, true);
}

/** Closed cylinder along Y centred at the origin. */
export function cyl(r0: number, r1: number, h: number, radial: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r0, r1, h, radial, 1, false);
}

/**
 * Double-sided lanceolate leaf along +Y with a centre crease and a backward
 * curl (+Z). Width profile peaks around 35 % of the length.
 */
export function leaf(len: number, width: number, segs: number, curl: number, crease = 0.25): THREE.BufferGeometry {
  const pts: number[] = [];
  const idx: number[] = [];
  const rows = segs + 1;
  for (let side = 0; side < 2; side++) {
    const off = side === 0 ? 0.0015 : -0.0015;
    for (let i = 0; i < rows; i++) {
      const t = i / segs;
      const w = width * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.9) * (1 - t * 0.15);
      const y = t * len;
      const z = curl * t * t * len;
      const zc = z - w * crease;
      pts.push(-w, y, z + off, 0, y, zc + off, w, y, z + off);
    }
    const base = side * rows * 3;
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < 2; j++) {
        const a = base + i * 3 + j;
        const b = a + 1;
        const c = a + 3;
        const d = a + 4;
        if (side === 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Revolved profile (radius, y) around Y. */
export function lathe(profile: [number, number][], radial: number): THREE.BufferGeometry {
  return weldNormals(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), radial));
}

/**
 * Bends a (thin) part around the limb/torso it sits on: z += k·x². Positive k
 * pulls the side edges toward +Z. Turns flat slabs into plates that hug a
 * cylinder, and flat cloth into curved wraps (no blade-like side profile).
 */
export function bend(g: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, pos.getZ(i) + k * x * x);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Superquadric shell with an arbitrary opening: triangles whose centroid
 * direction (on the unit sphere, before shaping) fails `keep` are dropped.
 * Used for the Bloom cowl, whose face opening is a cone around the forward
 * axis — something the sphere's phi/theta ranges cannot express.
 */
export function sqCut(s: SqParams, ws: number, hs: number, keep: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
  const src = new THREE.SphereGeometry(1, ws, hs);
  const pos = src.attributes.position as THREE.BufferAttribute;
  const idx = src.index as THREE.BufferAttribute;
  const kept: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    const cx = pos.getX(a) + pos.getX(b) + pos.getX(c);
    const cy = pos.getY(a) + pos.getY(b) + pos.getY(c);
    const cz = pos.getZ(a) + pos.getZ(b) + pos.getZ(c);
    const l = Math.hypot(cx, cy, cz) || 1;
    if (keep(cx / l, cy / l, cz / l)) kept.push(a, b, c);
  }
  for (let i = 0; i < pos.count; i++) {
    sqPoint(s, pos.getX(i), pos.getY(i), pos.getZ(i), 0, _v);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  src.setIndex(kept);
  const g = src.toNonIndexed();
  src.dispose();
  return weldNormals(g);
}

/** Closed tube through points (rolled cloth edges, hood rims). */
export function tubeThrough(points: THREE.Vector3[], radius: number, tubular: number, radial: number, closed: boolean): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return weldNormals(new THREE.TubeGeometry(curve, tubular, radius, radial, closed));
}

// ── Assembler ──────────────────────────────────────────────────────────────

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

/** Deterministic 3D hash noise in [-1, 1] (for lumps and per-part tint jitter). */
function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}

export class Kit {
  readonly parts: Part[] = [];
  private seed = 1;

  constructor(readonly detail: Detail) {}

  /** Pick a segment count by detail tier. */
  n(lo: number, mid: number, hi: number): number {
    return this.detail === 0 ? lo : this.detail === 1 ? mid : hi;
  }

  add(bone: BoneName, geo: THREE.BufferGeometry, color: ColorLike, o: PartOpts = {}): void {
    this.parts.push({ bone, geo, color: typeof color === 'string' ? new THREE.Color(color) : color.clone(), o });
  }

  /** Mirror helper: calls fn for left (sx = −1) and right (sx = +1). */
  both(fn: (s: 'L' | 'R', sx: number) => void): void {
    fn('L', -1);
    fn('R', 1);
  }

  /** Bakes all parts into one skinned geometry in model (bind-pose) space. */
  build(rig: RigDef): THREE.BufferGeometry {
    const restWorld = restMatrices(rig);
    const out: THREE.BufferGeometry[] = [];
    for (const part of this.parts) out.push(this.bake(part, restWorld));
    const merged = mergeGeometries(out, false);
    for (const g of out) g.dispose();
    if (!merged) throw new Error('character geometry merge failed');
    merged.computeBoundingSphere();
    return merged;
  }

  private bake(part: Part, restWorld: Record<BoneName, THREE.Matrix4>): THREE.BufferGeometry {
    const o = part.o;
    let g = part.geo;
    if (!g.index) g = mergeVertices(g, 1e-6);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    const count = g.attributes.position.count;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    this.seed++;
    const seed = this.seed;

    // Shape-local colour gradient + lumps (before the part transform).
    const colors = new Float32Array(count * 3);
    const base = part.color;
    const gradCol = o.grad ? (typeof o.grad.color === 'string' ? new THREE.Color(o.grad.color) : o.grad.color) : null;
    // Per-part value jitter (±3 %) so panels read as separate pieces.
    const jitter = 1 + hash3(seed, seed * 0.37, 1.7) * 0.03;
    const glowRamp = o.glowY ? new Float32Array(count) : null;
    for (let i = 0; i < count; i++) {
      if (glowRamp && o.glowY) glowRamp[i] = THREE.MathUtils.smoothstep(pos.getY(i), o.glowY.from, o.glowY.to);
      _c.copy(base);
      if (gradCol && o.grad) {
        // Works for either direction (from > to fades downward).
        const x = THREE.MathUtils.clamp((pos.getY(i) - o.grad.from) / (o.grad.to - o.grad.from), 0, 1);
        _c.lerp(gradCol, x * x * (3 - 2 * x));
      }
      _c.multiplyScalar(jitter);
      colors[i * 3] = _c.r;
      colors[i * 3 + 1] = _c.g;
      colors[i * 3 + 2] = _c.b;
      if (o.lumps) {
        const k = hash3(pos.getX(i) * 31 + seed, pos.getY(i) * 29, pos.getZ(i) * 37) * o.lumps;
        pos.setXYZ(i, pos.getX(i) + nrm.getX(i) * k, pos.getY(i) + nrm.getY(i) * k, pos.getZ(i) + nrm.getZ(i) * k);
      }
    }
    if (o.lumps) g.computeVertexNormals();

    // Part transform → bone-local space.
    const [px, py, pz] = o.pos ?? [0, 0, 0];
    const [rx, ry, rz] = o.rot ?? [0, 0, 0];
    const [sx, sy, sz] = o.scale ?? [1, 1, 1];
    _m.compose(_p.set(px, py, pz), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    g.applyMatrix4(_m);

    // Skin weights from bone-local Y, UVs (box projection), AO.
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    const uv = new Float32Array(count * 2);
    const fx = new Float32Array(count * 4);
    const bi = BONE_INDEX[part.bone];
    const uOff = hash3(seed, 2.1, 5.3) * 0.5 + 0.5;
    const vOff = hash3(seed, 7.7, 1.3) * 0.5 + 0.5;
    const glow = o.glow ?? 0;
    const glow2 = o.glow2 ?? 0;
    const paint = o.paint ?? 0;
    const gloss = o.gloss ?? 0.6;
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      skinIndex[i * 4] = bi;
      skinWeight[i * 4] = 1;
      if (o.blend) {
        let slot = 1;
        let own = 1;
        for (const b of o.blend) {
          const d = Math.abs(y - b.y);
          if (d >= b.w || slot > 3) continue;
          const t = 1 - d / b.w;
          const wt = 0.5 * t * t * (3 - 2 * t);
          skinIndex[i * 4 + slot] = BONE_INDEX[b.bone];
          skinWeight[i * 4 + slot] = wt;
          own -= wt;
          slot++;
        }
        skinWeight[i * 4] = Math.max(0, own);
      }
      const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      let u: number, v: number;
      if (ax >= ay && ax >= az) {
        u = z;
        v = y;
      } else if (ay >= az) {
        u = x;
        v = z;
      } else {
        u = x;
        v = y;
      }
      uv[i * 2] = u * 2.6 + uOff;
      uv[i * 2 + 1] = v * 2.6 + vOff;
      const ramp = glowRamp ? glowRamp[i] : 1;
      fx[i * 4] = glow * ramp;
      fx[i * 4 + 1] = glow2 * ramp;
      fx[i * 4 + 2] = paint;
      fx[i * 4 + 3] = gloss;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('fx', new THREE.BufferAttribute(fx, 4));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));

    // Into model space through the rest pose.
    g.applyMatrix4(restWorld[part.bone]);
    if (o.visor) {
      const p = g.attributes.position as THREE.BufferAttribute;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < count; i++) {
        lo = Math.min(lo, p.getY(i));
        hi = Math.max(hi, p.getY(i));
      }
      const eyeY = (lo + hi) / 2;
      for (let i = 0; i < count; i++) {
        fx[i * 4 + 1] = eyeY;
        fx[i * 4 + 3] = VISOR_FLAG;
      }
    }

    // Painterly AO by colour: faces pointing down darker, lower body slightly
    // darker overall (draws the eye up to helmet and chest). Emissives skip it.
    const ao = (glow > 0 || glow2 > 0) && !o.glowY ? 0 : (o.ao ?? 1);
    const p2 = g.attributes.position as THREE.BufferAttribute;
    const n2 = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      _n.set(n2.getX(i), n2.getY(i), n2.getZ(i));
      const up = _n.y * 0.5 + 0.5;
      const h = THREE.MathUtils.smoothstep(p2.getY(i), 0.0, 1.35);
      const k = 1 - ao * (0.22 * (1 - up) + 0.14 * (1 - h));
      _c2.setRGB(colors[i * 3] * k, colors[i * 3 + 1] * k, colors[i * 3 + 2] * k);
      colors[i * 3] = _c2.r;
      colors[i * 3 + 1] = _c2.g;
      colors[i * 3 + 2] = _c2.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }
}

/** Bone rest world matrices (root at the origin) for geometry assembly. */
export function restMatrices(rig: RigDef): Record<BoneName, THREE.Matrix4> {
  const out = {} as Record<BoneName, THREE.Matrix4>;
  for (const b of BONES) {
    const r = rig.rest[b];
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(r.pos[0], r.pos[1], r.pos[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(r.rot[0], r.rot[1], r.rot[2])),
      new THREE.Vector3(1, 1, 1),
    );
    const p = PARENT[b];
    out[b] = p ? new THREE.Matrix4().multiplyMatrices(out[p], local) : local;
  }
  return out;
}
