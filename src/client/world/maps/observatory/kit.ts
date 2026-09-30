// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Observatory decor kit: batched static geometry + shape helpers.
//
// Every static prop is appended in WORLD space to a batch keyed by a material
// "kind". Vertex colors carry the palette color × a cheap baked light model:
// dark feet (contact AO), dark undersides, and — this is a snowy summit — an
// optional snow blanket that whitens every upward-facing surface above a
// threshold (props get snow caps for free). Textured kinds get world-scale box
// UVs. `build()` turns each kind into ONE mesh (≈ 15 draw calls for the whole
// map's dressing). Groups that animate (dome, dishes, cabin…) use their own kit
// instance built into their own group.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { DecorContext } from '../../../contracts';
import { ENV } from '../../../engine/palette';
import { TEX_TILE, type TexName } from '../../../engine/textures';

export type Kind =
  | 'concrete'
  | 'metal'
  | 'corrugated'
  | 'wood'
  | 'rock'
  | 'snow'
  | 'plaster'
  | 'fabric'
  | 'paint'
  | 'gloss'
  | 'satin'
  | 'interior'
  | 'interiorWood'
  | 'interiorMetal'
  | 'interiorFabric'
  | 'glow'
  | 'glass'
  | 'sign'
  | 'signGlow'
  | 'pool';

const KIND_TEX: Partial<Record<Kind, { tag: 'concrete' | 'metal' | 'wood' | 'rock' | 'snow' | 'plaster' | 'fabric'; style?: string; tex: TexName }>> = {
  concrete: { tag: 'concrete', tex: 'concrete' },
  metal: { tag: 'metal', tex: 'metal' },
  corrugated: { tag: 'metal', style: 'container', tex: 'corrugated' },
  wood: { tag: 'wood', tex: 'wood' },
  rock: { tag: 'rock', tex: 'rock' },
  snow: { tag: 'snow', tex: 'snow' },
  plaster: { tag: 'plaster', tex: 'plaster' },
  fabric: { tag: 'fabric', tex: 'fabric' },
  interior: { tag: 'plaster', tex: 'plaster' },
  interiorWood: { tag: 'wood', tex: 'wood' },
  interiorMetal: { tag: 'metal', tex: 'metal' },
  interiorFabric: { tag: 'fabric', tex: 'fabric' },
};

export type ShadeFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

export interface AddOpts {
  /** Floor height for the baked foot darkening (default 0). */
  base?: number;
  /** No baked AO (flat color). */
  flat?: boolean;
  /** Custom multiplier per vertex (replaces the default AO). */
  shade?: ShadeFn;
  /** Brightness multiplier (HDR for glow kinds). */
  k?: number;
  /** Snow blanket on upward faces (0..1 amount, default from kit.snowDefault for opaque kinds). */
  snow?: number;
  /** Multiply by the geometry's own `color` attribute (baked gradients). */
  vc?: boolean;
}

class Batch {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
}

const _c = new THREE.Color();
const _snow = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

export function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash2(x: number, y: number): number {
  let h = Math.imul(Math.floor(x * 7.13) | 0, 374761393) ^ Math.imul(Math.floor(y * 5.71) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class ObsKit {
  private readonly batches = new Map<Kind, Batch>();
  readonly owned: THREE.Material[] = [];
  readonly meshes: THREE.Mesh[] = [];
  readonly low: boolean;
  readonly shadows: boolean;
  /** Default snow amount for opaque kinds (props get snowy tops). */
  snowDefault = 1;
  signTexture: THREE.Texture | null = null;
  section = '';
  readonly sectionTris = new Map<string, number>();

  constructor(readonly ctx: DecorContext, readonly name = 'obs') {
    this.low = ctx.quality.preset === 'low';
    this.shadows = ctx.quality.shadows !== 'off';
    _snow.set(ENV.snow);
  }

  /** Radial segment count scaled by quality. */
  seg(n: number): number {
    return Math.max(6, Math.round(n * (this.low ? 0.55 : 1)));
  }

  /** Adds a geometry (consumed & disposed). `m` optionally transforms it to world space first. */
  add(kind: Kind, geo: THREE.BufferGeometry, color: string | THREE.Color, opts: AddOpts = {}, m?: THREE.Matrix4): void {
    let b = this.batches.get(kind);
    if (!b) this.batches.set(kind, (b = new Batch()));
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (m) g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const uvA = g.attributes.uv as THREE.BufferAttribute | undefined;
    const vcA = opts.vc ? (g.attributes.color as THREE.BufferAttribute | undefined) : undefined;
    if (typeof color === 'string') _c.set(color);
    else _c.copy(color);
    const kk = opts.k ?? 1;
    const base = opts.base ?? 0;
    const glowy = kind === 'glow' || kind === 'signGlow' || kind === 'pool' || kind === 'glass' || kind === 'sign';
    const snow = glowy ? 0 : opts.snow ?? (kind === 'snow' ? 0 : this.snowDefault);
    const tex = KIND_TEX[kind];
    const tile = tex ? TEX_TILE[tex.tex] : 1;
    const n = pos.count;
    const key = `${this.section}.${kind}`;
    this.sectionTris.set(key, (this.sectionTris.get(key) ?? 0) + n / 3);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const nx = nor.getX(i);
      const ny = nor.getY(i);
      const nz = nor.getZ(i);
      b.pos.push(x, y, z);
      b.nor.push(nx, ny, nz);
      let s = 1;
      if (opts.shade) s = opts.shade(x, y, z, nx, ny, nz);
      else if (!opts.flat) {
        s = 0.6 + 0.4 * smooth(base, base + 1.4, y);
        if (ny < -0.4) s *= 0.68;
        else if (ny > 0.6) s *= 1.05;
      }
      let r = _c.r * kk * s;
      let gg = _c.g * kk * s;
      let bb = _c.b * kk * s;
      if (vcA) {
        r *= vcA.getX(i);
        gg *= vcA.getY(i);
        bb *= vcA.getZ(i);
      }
      if (snow > 0 && ny > 0.55) {
        // Snow blanket: soft-edged by slope with a little painterly patchiness.
        const f = snow * smooth(0.55, 0.85, ny) * (0.8 + 0.2 * hash2(x, z));
        const sk = 0.97 + 0.05 * hash2(z + 3.1, x);
        r += (_snow.r * sk - r) * f;
        gg += (_snow.g * sk - gg) * f;
        bb += (_snow.b * sk - bb) * f;
      }
      b.col.push(r, gg, bb);
    }
    if (tex) {
      for (let i = 0; i < n; i += 3) {
        _v.set(0, 0, 0);
        for (let k2 = 0; k2 < 3; k2++) {
          _n.set(nor.getX(i + k2), nor.getY(i + k2), nor.getZ(i + k2));
          _v.add(_n);
        }
        const ax = Math.abs(_v.x);
        const ay = Math.abs(_v.y);
        const az = Math.abs(_v.z);
        for (let k2 = 0; k2 < 3; k2++) {
          const x = pos.getX(i + k2);
          const y = pos.getY(i + k2);
          const z = pos.getZ(i + k2);
          if (ay >= ax && ay >= az) b.uv.push(x / tile, z / tile);
          else if (ax >= az) b.uv.push(z / tile, y / tile);
          else b.uv.push(x / tile, y / tile);
        }
      }
    } else if (uvA) {
      for (let i = 0; i < n; i++) b.uv.push(uvA.getX(i), uvA.getY(i));
    } else {
      for (let i = 0; i < n; i++) b.uv.push(0, 0);
    }
    if (g !== geo) geo.dispose();
    g.dispose();
  }

  addAll(kind: Kind, geos: THREE.BufferGeometry[], color: string | THREE.Color, opts: AddOpts = {}, m?: THREE.Matrix4): void {
    for (const g of geos) this.add(kind, g, color, opts, m);
  }

  private material(kind: Kind): THREE.Material {
    const lib = this.ctx.materials as DecorContext['materials'] & { surfaceVC?: (tag: string, o?: { style?: string; color?: string }) => THREE.Material };
    const t = KIND_TEX[kind];
    const own = <T extends THREE.Material>(mm: T): T => {
      this.owned.push(mm);
      return mm;
    };
    if ((kind === 'interior' || kind === 'interiorWood' || kind === 'interiorMetal' || kind === 'interiorFabric') && t) {
      // Interiors: the sky hemisphere light reaches them too (no GI), so they get a
      // warm self-illumination proportional to their albedo — reads as lamp-lit rooms.
      const base = lib.surfaceVC ? lib.surfaceVC(t.tag, { color: '#ffffff' }) : null;
      const m = own(base ? base.clone() : new THREE.MeshLambertMaterial({ vertexColors: true }));
      // The sky fill + the shadowless bounce light would otherwise tint every
      // room lavender: interiors are mostly self-lit, the outside light only grazes in.
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.55;')
          .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n\treflectedLight.indirectDiffuse *= 0.32;\n\treflectedLight.directDiffuse *= 0.45;');
      };
      m.customProgramCacheKey = () => `obs.interior.${kind}.${this.low ? 1 : 0}`;
      return m;
    }
    if (t && lib.surfaceVC) return lib.surfaceVC(t.tag, { style: t.style, color: '#ffffff' });
    const std = (rough: number, metal: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.Material =>
      own(
        this.low
          ? new THREE.MeshLambertMaterial({ vertexColors: true, side: extra.side ?? THREE.FrontSide, map: extra.map ?? null, transparent: !!extra.transparent, opacity: extra.opacity ?? 1 })
          : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, ...extra }),
      );
    switch (kind) {
      case 'gloss':
        return std(0.34, 0.45);
      case 'satin':
        return std(0.55, 0.08);
      case 'glow':
        return own(new THREE.MeshBasicMaterial({ vertexColors: true }));
      case 'glass': {
        const m = std(0.1, 0.2, { transparent: true, opacity: 0.42, side: THREE.DoubleSide });
        m.depthWrite = false;
        return m;
      }
      case 'sign': {
        const m = std(0.75, 0, { map: this.signTexture, side: THREE.DoubleSide });
        m.alphaTest = 0.35;
        return m;
      }
      case 'signGlow':
        return own(new THREE.MeshBasicMaterial({ vertexColors: true, map: this.signTexture, alphaTest: 0.35, side: THREE.DoubleSide }));
      case 'pool': {
        const tex = this.ctx.materials.canvasTexture('obs.pool', 64, 64, (c, w, h) => {
          const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
          g.addColorStop(0, 'rgba(255,255,255,1)');
          g.addColorStop(0.35, 'rgba(255,255,255,0.42)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          c.fillStyle = g;
          c.fillRect(0, 0, w, h);
        });
        return own(new THREE.MeshBasicMaterial({ vertexColors: true, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      }
      case 'paint':
      default:
        return std(0.8, 0.02);
    }
  }

  /** Builds one mesh per kind under `root`. */
  build(root: THREE.Object3D): void {
    for (const [kind, b] of this.batches) {
      if (b.pos.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.material(kind));
      mesh.name = `${this.name}.${kind}`;
      const glowy = kind === 'glow' || kind === 'glass' || kind === 'signGlow' || kind === 'pool';
      mesh.castShadow = this.shadows && !glowy && kind !== 'sign';
      mesh.receiveShadow = !glowy;
      if (kind === 'glass') mesh.renderOrder = 3;
      if (kind === 'pool') mesh.renderOrder = 4;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
      this.meshes.push(mesh);
    }
    this.batches.clear();
  }

  triangles(): number {
    let t = 0;
    for (const m of this.meshes) t += (m.geometry.attributes.position.count / 3) | 0;
    return t;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    for (const m of this.owned) m.dispose();
  }
}

// ── Shape helpers (all return world-space geometry) ─────────────────────────

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();

/** Axis-aligned box from corners. */
export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Box by center + size, optionally rotated about Y. */
export function boxC(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rotY) g.rotateY(rotY);
  g.translate(cx, cy, cz);
  return g;
}

/** Rounded (chamfered) box from corners. */
export function rbox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r = 0.08, seg = 1): THREE.BufferGeometry {
  const sx = Math.abs(x1 - x0);
  const sy = Math.abs(y1 - y0);
  const sz = Math.abs(z1 - z0);
  const rr = Math.min(r, sx * 0.49, sy * 0.49, sz * 0.49);
  const g = new RoundedBoxGeometry(sx, sy, sz, seg, rr);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Cylinder between two points. */
export function cylAB(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r0: number, r1 = r0, seg = 10, open = false): THREE.BufferGeometry {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  const len = _a.distanceTo(_b);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open);
  _q.setFromUnitVectors(_up, _d.subVectors(_b, _a).normalize());
  _m4.compose(_a.clone().add(_b).multiplyScalar(0.5), _q, _s);
  g.applyMatrix4(_m4);
  return g;
}

/** Vertical cylinder standing on (x, y0, z). */
export function cyl(x: number, y0: number, z: number, r: number, h: number, seg = 12, rTop = r, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, r, h, seg, 1, open);
  g.translate(x, y0 + h / 2, z);
  return g;
}

/** Square-section beam between two points. */
export function beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, t2 = t): THREE.BufferGeometry {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  const len = _a.distanceTo(_b);
  const g = new THREE.BoxGeometry(t, len, t2);
  _q.setFromUnitVectors(_up, _d.subVectors(_b, _a).normalize());
  _m4.compose(_a.clone().add(_b).multiplyScalar(0.5), _q, _s);
  g.applyMatrix4(_m4);
  return g;
}

export function sphere(x: number, y: number, z: number, r: number, ws = 12, hs = 8, sy = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, ws, hs);
  if (sy !== 1) g.scale(1, sy, 1);
  g.translate(x, y, z);
  return g;
}

/** Lathe from (radius, y) pairs placed at (x, y, z). */
export function lathe(profile: [number, number][], seg: number, x = 0, y = 0, z = 0, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, yy]) => new THREE.Vector2(Math.max(0, r), yy)),
    seg,
    phiStart,
    phiLength,
  );
  g.translate(x, y, z);
  return g;
}

/** Tube along a polyline (straight segments). */
export function tube(points: [number, number, number][], r: number, seg = 6): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal', 0.2);
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
  return new THREE.TubeGeometry(curve, Math.max(2, Math.min(80, Math.round(len / 1.5) + points.length * 2)), r, seg, false);
}

/** Sagging cable between two points (catenary-ish parabola). */
export function cable(ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number, r = 0.03, n = 12, seg = 4): THREE.BufferGeometry {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([ax + (bx - ax) * t, ay + (by - ay) * t - sag * 4 * t * (1 - t), az + (bz - az) * t]);
  }
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  return new THREE.TubeGeometry(curve, n * 2, r, seg, false);
}

/** Flat quad centered at c facing +normal (nx, nz) in XZ, with optional UV rect [u0, v0, u1, v1]. */
export function quad(cx: number, cy: number, cz: number, w: number, h: number, nx: number, nz: number, uv?: [number, number, number, number], tilt = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  if (uv) {
    const a = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
  }
  if (tilt) g.rotateX(tilt);
  g.rotateY(Math.atan2(nx, nz));
  g.translate(cx, cy, cz);
  return g;
}

/** Horizontal quad (decal on the ground / floor). */
export function floorQuad(cx: number, y: number, cz: number, w: number, d: number, uv?: [number, number, number, number], rotY = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  if (uv) {
    const a = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
  }
  g.rotateX(-Math.PI / 2);
  if (rotY) g.rotateY(rotY);
  g.translate(cx, y, cz);
  return g;
}

/** Lattice mast (square section): legs + rings + X bracing, tapering from half0 to half1. */
export function lattice(cx: number, cz: number, half0: number, half1: number, y0: number, y1: number, step: number, legT: number, braceT: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const hAt = (y: number): number => half0 + (half1 - half0) * ((y - y0) / (y1 - y0));
  const corners = (h: number): [number, number][] => [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  const c0 = corners(half0);
  const c1 = corners(half1);
  for (let i = 0; i < 4; i++) out.push(beam(cx + c0[i][0], y0, cz + c0[i][1], cx + c1[i][0], y1, cz + c1[i][1], legT));
  for (let y = y0; y < y1 - 0.01; y += step) {
    const ya = y;
    const yb = Math.min(y1, y + step);
    const ca = corners(hAt(ya));
    const cb = corners(hAt(yb));
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      out.push(beam(cx + cb[i][0], yb, cz + cb[i][1], cx + cb[j][0], yb, cz + cb[j][1], braceT * 1.2));
      out.push(beam(cx + ca[i][0], ya, cz + ca[i][1], cx + cb[j][0], yb, cz + cb[j][1], braceT));
    }
  }
  return out;
}

/** Translate + rotate Y + uniform scale. */
export function trs(x: number, y: number, z: number, rotY = 0, s = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(_up, rotY), new THREE.Vector3(s, s, s));
}

/** Faceted rock: an icosahedron-ish blob stretched into a box (x0..x1 etc.), displaced by a seeded noise. */
export function rockGeo(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rng: () => number, detail = 1, jag = 0.18): THREE.BufferGeometry {
  const g0 = new THREE.IcosahedronGeometry(1, detail);
  const g = g0.index ? g0.toNonIndexed() : g0;
  const p = g.attributes.position as THREE.BufferAttribute;
  // Displace per unique direction (hash the rounded position so shared vertices move together).
  const cache = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let k = cache.get(key);
    if (k === undefined) cache.set(key, (k = 1 - jag + rng() * jag * 2));
    // Flatten the bottom so rocks sit on the ground.
    const yy = y < -0.35 ? -0.35 - (y + 0.35) * 0.15 : y;
    p.setXYZ(i, x * k, yy * k, z * k);
  }
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const sx = (x1 - x0) / (bb.max.x - bb.min.x);
  const sy = (y1 - y0) / (bb.max.y - bb.min.y);
  const sz = (z1 - z0) / (bb.max.z - bb.min.z);
  g.translate(-bb.min.x, -bb.min.y, -bb.min.z);
  g.scale(sx, sy, sz);
  g.translate(x0, y0, z0);
  g.computeVertexNormals();
  if (g !== g0) g0.dispose();
  return g;
}

/** Turns a geometry inside-out (reversed winding + negated normals) — for interior faces. */
export function invert(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  for (let i = 0; i < p.count; i += 3) {
    for (const a of [p, n, uv]) {
      if (!a) continue;
      for (let c = 0; c < a.itemSize; c++) {
        const t = a.getComponent(i + 1, c);
        a.setComponent(i + 1, c, a.getComponent(i + 2, c));
        a.setComponent(i + 2, c, t);
      }
    }
  }
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}
