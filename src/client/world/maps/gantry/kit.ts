// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry decor kit: batched static geometry + shape helpers.
//
// Every static prop is appended (already in WORLD space) to a Batch keyed by a
// material "kind". Vertex colors carry the palette color × a cheap baked AO
// (dark feet, dark undersides, bright tops), textured kinds get world-scale
// box-projected UVs. At the end each kind becomes ONE mesh → the whole map's
// dressing costs ~15 draw calls regardless of prop count.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { DecorContext } from '../../../contracts';
import { contactShadowGeometry, contactShadowMaterial } from '../../../engine/materials';
import { ENV } from '../../../engine/palette';
import { TEX_TILE, type TexName } from '../../../engine/textures';

function mixHex(a: string, b: string, t: number): string {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}
/** Foliage greens derived from the palette (olive/sage cooled toward the violet shadow tone). */
export const GREENS = [mixHex(mixHex(ENV.olive, ENV.shadowCool, 0.3), ENV.skyBlue, 0.12), mixHex(mixHex(ENV.olive, ENV.sage, 0.35), ENV.skyBlue, 0.12), mixHex(mixHex(ENV.sage, ENV.shadowCool, 0.2), ENV.skyBlue, 0.1)] as const;

export type Kind =
  | 'concrete'
  | 'metal'
  | 'corrugated'
  | 'wood'
  | 'sand'
  | 'rock'
  | 'fabric'
  | 'paint'
  | 'gloss'
  | 'glow'
  | 'glass'
  | 'foliage'
  | 'sign'
  | 'signGlow'
  | 'pool'
  | 'leaf'
  /** Soft alpha-blended ground/wall decals from the decal atlas (lit, no depth write). */
  | 'decal'
  /** Cut-out plates (safety signs, gauges, notice boards) from the decal atlas. */
  | 'sign2'
  /** Unlit foam lace on the water (decal atlas, drawn after the sea). */
  | 'foam'
  /** Glossy soft-edged wet film (puddles; medium/high: specular sun glints). */
  | 'wet'
  /** Engine contact-shadow blobs (shared material, one draw). */
  | 'contact';

const KIND_TEX: Partial<Record<Kind, { tag: 'concrete' | 'metal' | 'wood' | 'sand' | 'rock' | 'fabric'; style?: string; tex: TexName }>> = {
  concrete: { tag: 'concrete', tex: 'concrete' },
  metal: { tag: 'metal', tex: 'metal' },
  corrugated: { tag: 'metal', style: 'container', tex: 'corrugated' },
  wood: { tag: 'wood', tex: 'wood' },
  sand: { tag: 'sand', tex: 'sand' },
  rock: { tag: 'rock', tex: 'rock' },
  fabric: { tag: 'fabric', tex: 'fabric' },
};

export type ShadeFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

export interface AddOpts {
  /** Floor height for the baked foot-darkening (default 0). */
  base?: number;
  /** Disable baked AO (flat color). */
  flat?: boolean;
  /** Custom multiplier per vertex (replaces the default AO). */
  shade?: ShadeFn;
  /** Brightness multiplier (HDR for 'glow'). */
  k?: number;
}

class Batch {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
}

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class DecorKit {
  private readonly batches = new Map<Kind, Batch>();
  readonly owned: THREE.Material[] = [];
  readonly meshes: THREE.Mesh[] = [];
  readonly low: boolean;
  readonly shadows: boolean;
  signTexture: THREE.Texture | null = null;
  /** Dev stats: triangles added per section label. */
  section = '';
  readonly sectionTris = new Map<string, number>();
  leafTexture: THREE.Texture | null = null;
  decalTexture: THREE.Texture | null = null;

  constructor(readonly ctx: DecorContext) {
    this.low = ctx.quality.preset === 'low';
    this.shadows = ctx.quality.shadows !== 'off';
    PIPE_DETAIL = this.low ? 0.6 : 1;
  }

  /** Segment count for THREE geometries built directly (not through the shape helpers). */
  segRaw(n: number): number {
    return Math.max(6, Math.round(n * (this.low ? 0.55 : 1)));
  }

  /** Radial segment count for hero shapes (the shape helpers apply the Low factor 0.6 on top → ≈ 0.55 overall). */
  seg(n: number): number {
    return Math.max(10, Math.round(n * (this.low ? 0.92 : 1)));
  }

  /**
   * Adds a geometry (consumed; disposed here). `m` (optional) transforms it into
   * world space first. Color = palette hex (or THREE.Color) × baked shading.
   */
  add(kind: Kind, geo: THREE.BufferGeometry, color: string | THREE.Color, opts: AddOpts = {}, m?: THREE.Matrix4): void {
    let b = this.batches.get(kind);
    if (!b) this.batches.set(kind, (b = new Batch()));
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (m) g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const uvA = g.attributes.uv as THREE.BufferAttribute | undefined;
    if (typeof color === 'string') _c.set(color);
    else _c.copy(color);
    const r = _c.r * (opts.k ?? 1);
    const gg = _c.g * (opts.k ?? 1);
    const bb = _c.b * (opts.k ?? 1);
    const base = opts.base ?? 0;
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
        s = 0.62 + 0.38 * smooth(base, base + 1.5, y);
        if (ny < -0.4) s *= 0.7;
        else if (ny > 0.6) s *= 1.06;
      }
      b.col.push(r * s, gg * s, bb * s);
    }
    if (tex) {
      // World-scale box projection per triangle (dominant normal axis).
      for (let i = 0; i < n; i += 3) {
        _v.set(0, 0, 0);
        for (let k = 0; k < 3; k++) {
          _n.set(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
          _v.add(_n);
        }
        const ax = Math.abs(_v.x);
        const ay = Math.abs(_v.y);
        const az = Math.abs(_v.z);
        for (let k = 0; k < 3; k++) {
          const x = pos.getX(i + k);
          const y = pos.getY(i + k);
          const z = pos.getZ(i + k);
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

  private material(kind: Kind): THREE.Material {
    const lib = this.ctx.materials as DecorContext['materials'] & { surfaceVC?: (tag: string, o?: { style?: string; color?: string }) => THREE.Material };
    const t = KIND_TEX[kind];
    if (t && lib.surfaceVC) return lib.surfaceVC(t.tag, { style: t.style, color: '#ffffff' });
    const own = <T extends THREE.Material>(mm: T): T => {
      this.owned.push(mm);
      return mm;
    };
    const std = (rough: number, metal: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.Material => {
      if (!this.low) return own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, ...extra }));
      // Lambert on Low: pass only the parameters that are actually set (three warns on undefined).
      const p: THREE.MeshLambertMaterialParameters = { vertexColors: true, map: extra.map ?? null };
      if (extra.side !== undefined) p.side = extra.side;
      if (extra.transparent !== undefined) p.transparent = extra.transparent;
      if (extra.opacity !== undefined) p.opacity = extra.opacity;
      return own(new THREE.MeshLambertMaterial(p));
    };
    switch (kind) {
      case 'gloss':
        return std(0.38, 0.35);
      case 'glow':
        return own(new THREE.MeshBasicMaterial({ vertexColors: true }));
      case 'glass': {
        const m = std(0.08, 0.2, { transparent: true, opacity: 0.38, side: THREE.DoubleSide });
        m.depthWrite = false;
        return m;
      }
      case 'foliage':
        return std(0.95, 0, { side: THREE.DoubleSide });
      case 'sign': {
        // Cut-out decals (stencils, facade lettering, deck roundels) share the atlas.
        const m = std(0.8, 0, { map: this.signTexture });
        m.alphaTest = 0.35;
        return m;
      }
      case 'signGlow':
        return own(new THREE.MeshBasicMaterial({ vertexColors: true, map: this.signTexture, alphaTest: 0.35 }));
      case 'leaf': {
        const m = std(0.95, 0, { map: this.leafTexture, side: THREE.DoubleSide });
        (m as THREE.MeshStandardMaterial).alphaTest = 0.5;
        return m;
      }
      case 'pool': {
        // Additive soft light pools / halos (fake local lights).
        const tex = this.ctx.materials.canvasTexture('gantry.pool', 64, 64, (c, w, h) => {
          const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
          g.addColorStop(0, 'rgba(255,255,255,1)');
          g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          c.fillStyle = g;
          c.fillRect(0, 0, w, h);
        });
        return own(new THREE.MeshBasicMaterial({ vertexColors: true, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      }
      case 'decal': {
        const m = std(0.92, 0, { map: this.decalTexture, transparent: true });
        m.depthWrite = false;
        m.polygonOffset = true;
        m.polygonOffsetFactor = -1;
        m.polygonOffsetUnits = -4;
        return m;
      }
      case 'wet': {
        const m = std(0.1, 0.3, { map: this.decalTexture, transparent: true });
        m.depthWrite = false;
        m.polygonOffset = true;
        m.polygonOffsetFactor = -2;
        m.polygonOffsetUnits = -6;
        m.userData.noPaint = true;
        return m;
      }
      case 'sign2': {
        const m = std(0.7, 0.05, { map: this.decalTexture });
        m.alphaTest = 0.4;
        return m;
      }
      case 'foam':
        return own(new THREE.MeshBasicMaterial({ vertexColors: true, map: this.decalTexture, transparent: true, depthWrite: false }));
      case 'contact':
        return contactShadowMaterial(); // shared engine material (not owned)
      case 'paint':
      default:
        return std(0.82, 0.02);
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
      mesh.name = `gantry.${kind}`;
      const glowy = kind === 'glow' || kind === 'glass' || kind === 'signGlow' || kind === 'pool' || kind === 'foam' || kind === 'contact';
      const flatCard = kind === 'sign' || kind === 'leaf' || kind === 'decal' || kind === 'sign2' || kind === 'wet';
      mesh.castShadow = this.shadows && !glowy && !flatCard;
      mesh.receiveShadow = !glowy;
      if (kind === 'decal' || kind === 'contact' || kind === 'wet') {
        mesh.renderOrder = kind === 'wet' ? 2 : 1;
        mesh.userData.noShadow = true; // never a caster in the baked Low shadow
      }
      if (kind === 'glass') mesh.renderOrder = 3;
      if (kind === 'pool') mesh.renderOrder = 4;
      if (kind === 'foam') {
        mesh.renderOrder = 6;
        mesh.userData.noShadow = true;
      }
      root.add(mesh);
      this.meshes.push(mesh);
    }
    this.batches.clear();
  }

  /** Adds several geometries with the same color/options. */
  addAll(kind: Kind, geos: THREE.BufferGeometry[], color: string | THREE.Color, opts: AddOpts = {}, m?: THREE.Matrix4): void {
    for (const g of geos) this.add(kind, g, color, opts, m);
  }

  /** Triangle count of the built meshes (stats). */
  triangles(): number {
    let t = 0;
    for (const m of this.meshes) t += (m.geometry.attributes.position.count / 3) | 0;
    return t;
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
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

/** Axis-aligned box from min/max corners. */
export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Box by center + size (optionally rotated about Y). */
export function boxC(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rotY) g.rotateY(rotY);
  g.translate(cx, cy, cz);
  return g;
}

/** Chamfered/rounded box from corners. */
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
  const g = new THREE.CylinderGeometry(r1, r0, len, lod(seg, 5), 1, open);
  _q.setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
  _m4.compose(_a.clone().add(_b).multiplyScalar(0.5), _q, _s);
  g.applyMatrix4(_m4);
  return g;
}

/** Vertical cylinder standing on (x, y0, z). */
export function cyl(x: number, y0: number, z: number, r: number, h: number, seg = 12, rTop = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, r, h, lod(seg, 6));
  g.translate(x, y0 + h / 2, z);
  return g;
}

/** Square-section beam between two points. */
export function beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, t2 = t): THREE.BufferGeometry {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  const len = _a.distanceTo(_b);
  const g = new THREE.BoxGeometry(t, len, t2);
  _q.setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
  _m4.compose(_a.clone().add(_b).multiplyScalar(0.5), _q, _s);
  g.applyMatrix4(_m4);
  return g;
}

export function sphere(x: number, y: number, z: number, r: number, ws = 16, hs = 10, sy = 1): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, lod(ws, 5), lod(hs, 3));
  if (sy !== 1) g.scale(1, sy, 1);
  g.translate(x, y, z);
  return g;
}

/** Lathe from (radius, y) pairs, placed at (x, y, z). */
export function lathe(profile: [number, number][], seg: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, yy]) => new THREE.Vector2(r, yy)),
    lod(seg, 6),
  );
  g.translate(x, y, z);
  return g;
}

/** Tessellation factor for pipes and round props (set by DecorKit from the quality preset). */
let PIPE_DETAIL = 1;

/** Segment count scaled by the quality tessellation factor (never below `min`). */
function lod(seg: number, min: number): number {
  return PIPE_DETAIL >= 1 ? seg : Math.max(min, Math.round(seg * PIPE_DETAIL));
}

/** Pipe along a polyline with rounded bends. */
export function pipe(points: [number, number, number][], r: number, seg = 8, bend = 0.6): THREE.BufferGeometry {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  if (pts.length === 2) path.add(new THREE.LineCurve3(pts[0], pts[1]));
  else {
    let start = pts[0].clone();
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const inDir = p.clone().sub(pts[i - 1]).normalize();
      const outDir = pts[i + 1].clone().sub(p).normalize();
      const b = Math.min(bend, p.distanceTo(pts[i - 1]) * 0.45, p.distanceTo(pts[i + 1]) * 0.45);
      const e0 = p.clone().addScaledVector(inDir, -b);
      const e1 = p.clone().addScaledVector(outDir, b);
      path.add(new THREE.LineCurve3(start, e0));
      path.add(new THREE.QuadraticBezierCurve3(e0, p.clone(), e1));
      start = e1;
    }
    path.add(new THREE.LineCurve3(start, pts[pts.length - 1]));
  }
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
  return new THREE.TubeGeometry(path as unknown as THREE.Curve<THREE.Vector3>, Math.max(2, Math.min(64, Math.round((len / 1.2 + pts.length * 3) * PIPE_DETAIL))), r, Math.max(5, Math.round(seg * PIPE_DETAIL)), false);
}

/** Visual stair treads over a ramp footprint (rising toward +axis if dir 1). */
export function stairs(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, axis: 'x' | 'z', dir: 1 | -1, rise = 0.3): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const n = Math.max(1, Math.round((y1 - y0) / rise));
  const lo = axis === 'x' ? Math.min(x0, x1) : Math.min(z0, z1);
  const hi = axis === 'x' ? Math.max(x0, x1) : Math.max(z0, z1);
  const run = (hi - lo) / n;
  const h = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const a = dir > 0 ? lo + i * run : hi - (i + 1) * run;
    const top = y0 + h * (i + 0.5); // the ramp line passes mid-tread (feet within ±rise/2)
    const bottom = top - h - 0.02;
    if (axis === 'x') out.push(box(a, bottom, Math.min(z0, z1), a + run, top, Math.max(z0, z1)));
    else out.push(box(Math.min(x0, x1), bottom, a, Math.max(x0, x1), top, a + run));
  }
  return out;
}

/** Simple railing (posts + top & mid rails) from a to b. */
export function railing(ax: number, ay: number, az: number, bx: number, by: number, bz: number, h = 1.05, spacing = 1.6, t = 0.05): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.max(1, Math.round(len / spacing));
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const x = ax + (bx - ax) * f;
    const y = ay + (by - ay) * f;
    const z = az + (bz - az) * f;
    out.push(beam(x, y, z, x, y + h, z, t));
  }
  out.push(beam(ax, ay + h, az, bx, by + h, bz, t * 1.3));
  out.push(beam(ax, ay + h * 0.5, az, bx, by + h * 0.5, bz, t));
  return out;
}

/** Flat quad (for decals/signs) centered at c, facing normal n, with UV rect. */
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

/** Horizontal quad (decal on the ground / deck). */
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

/** A baked point of light for litShade(): position, radius (m), strength, warm tint (0 = neutral, 1 = sodium). */
export interface BakedLight {
  x: number;
  y: number;
  z: number;
  r: number;
  k: number;
  warm?: number;
}

/**
 * Vertex shading that bakes light pools into the vertex colors (fake GI):
 * `ambient` everywhere (interiors < 1 read darker than the sunlit world), plus
 * a smooth falloff around each light that brightens past 1 and warms the hue.
 * Returns a ShadeFn plus a per-vertex warm factor consumer (see litColor).
 */
export function litShade(ambient: number, lights: readonly BakedLight[]): ShadeFn {
  return (x, y, z) => {
    let s = ambient;
    for (const l of lights) {
      const d2 = ((x - l.x) ** 2 + (y - l.y) ** 2 + (z - l.z) ** 2) / (l.r * l.r);
      if (d2 < 1) {
        const f = 1 - d2;
        s += l.k * f * f;
      }
    }
    return s;
  };
}

/**
 * A tessellated floor slab (top face only) at height y whose vertex colors
 * carry baked light pools; `cell` ≈ tessellation size in meters.
 */
export function litFloor(kit: DecorKit, x0: number, z0: number, x1: number, z1: number, y: number, color: string, ambient: number, lights: readonly BakedLight[], cell = 1.5, kind: Kind = 'concrete'): void {
  const nx = Math.max(1, Math.round(Math.abs(x1 - x0) / cell));
  const nz = Math.max(1, Math.round(Math.abs(z1 - z0) / cell));
  const g = new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0), nx, nz);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  kit.add(kind, g, color, { shade: litShade(ambient, lights) });
}

/**
 * A tessellated wall liner (one face) with baked light pools: the plane sits at
 * `plane` on the axis of its normal ('x+' faces +X …), spans a0..a1 along the
 * other horizontal axis and y0..y1 vertically.
 */
export function litWall(kit: DecorKit, n: 'x+' | 'x-' | 'z+' | 'z-', plane: number, a0: number, a1: number, y0: number, y1: number, color: string, ambient: number, lights: readonly BakedLight[], cell = 1.5, kind: Kind = 'concrete'): void {
  const w = Math.abs(a1 - a0);
  const h = Math.abs(y1 - y0);
  const g = new THREE.PlaneGeometry(w, h, Math.max(1, Math.round(w / cell)), Math.max(1, Math.round(h / cell)));
  const ry = n === 'x+' ? Math.PI / 2 : n === 'x-' ? -Math.PI / 2 : n === 'z-' ? Math.PI : 0;
  g.rotateY(ry);
  const c = (a0 + a1) / 2;
  if (n[0] === 'x') g.translate(plane, (y0 + y1) / 2, c);
  else g.translate(c, (y0 + y1) / 2, plane);
  // Darker toward the floor (contact AO) on top of the baked lights.
  const lit = litShade(ambient, lights);
  kit.add(kind, g, color, { shade: (x, y, z, nx, ny, nz) => lit(x, y, z, nx, ny, nz) * (0.78 + 0.22 * Math.min(1, (y - y0) / 1.2)) });
}

/** Flat painted floor chevron (arrow head) pointing along rotY (0 = −Z), `w` wide. */
export function chevron(x: number, y: number, z: number, w: number, rotY: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  const h = w * 0.55;
  const t = w * 0.2;
  sh.moveTo(0, h / 2);
  sh.lineTo(w / 2, -h / 2);
  sh.lineTo(w / 2 - t, -h / 2);
  sh.lineTo(0, h / 2 - t * 1.3);
  sh.lineTo(-w / 2 + t, -h / 2);
  sh.lineTo(-w / 2, -h / 2);
  sh.closePath();
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2); // shape +y → world −z
  g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

/** Lattice mast segment set (square section): legs + rings + X bracing. */
export function lattice(cx: number, cz: number, half: number, y0: number, y1: number, step: number, legT: number, braceT: number, cross = true, legs4 = true): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const legs: [number, number][] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
  if (legs4) for (const [lx, lz] of legs) out.push(box(cx + lx - legT / 2, y0, cz + lz - legT / 2, cx + lx + legT / 2, y1, cz + lz + legT / 2));
  for (let y = y0; y < y1 - 0.01; y += step) {
    const ya = y;
    const yb = Math.min(y1, y + step);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i];
      const [bx, bz] = legs[(i + 1) % 4];
      out.push(beam(cx + ax, yb, cz + az, cx + bx, yb, cz + bz, braceT * 1.2));
      out.push(beam(cx + ax, ya, cz + az, cx + bx, yb, cz + bz, braceT));
      if (cross) out.push(beam(cx + bx, ya, cz + bz, cx + ax, yb, cz + az, braceT));
    }
  }
  return out;
}

/** Matrix helper: translate + rotate Y + uniform scale. */
export function trs(x: number, y: number, z: number, rotY = 0, s = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(_up, rotY), new THREE.Vector3(s, s, s));
}

/**
 * Contact shadow (engine helper): a soft cool-violet blob under a prop, merged
 * into the kit's single 'contact' draw. Radii in meters, yaw `ry`.
 */
export function contact(kit: DecorKit, x: number, y: number, z: number, rx: number, rz: number, ry = 0): void {
  kit.add('contact', contactShadowGeometry(x, y, z, rx, rz, ry), '#ffffff', { flat: true });
}

export { smooth };
