// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — elimination dissolves (stylized, no gore).
//
// The character model is hidden the instant a player is eliminated; this module
// rebuilds that body's SILHOUETTE out of pieces (glowing petals, ceramic shards,
// paper, crystals, ash…) sampled on a stylized body template, holds it for a
// beat and releases it from the FEET UP over ≈ 1 s — so the body visibly breaks
// apart instead of popping into confetti.
//
//  • Bloom (default): luminous teal→violet petals spiral upward, an inner glow
//    fades band by band, a soft bloom of light at the core.
//  • Halcyon (default): real 3D ceramic shards (instanced, sun-lit, with glowing
//    orange seams that flash as each shard cracks free) tumble, bounce and
//    settle, with bone-white dust and sun glints; a soft white flash.
//  • Unlockables: embers (charred flakes with burning rims lifting on the heat),
//    origami (folded pastel paper fluttering away), starfall (falling stars, a
//    constellation body twinkling away), prism (glowing crystals + refractions).
//
// Budget: piece / particle counts scale with quality.particles (pieces get a
// little bigger when there are fewer, so the silhouette keeps its coverage).
// Each 3D piece kind is ONE InstancedMesh (drawn only while alive); sprites go
// through the shared particle pools. No allocation per frame or per event.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { Faction, Team, Vec3 } from '../../shared/types';
import { ENV, teamColors } from './palette';
import { type ParticlePool, SPRITE } from './particles';

const rnd = Math.random;
const rr = (a: number, b: number): number => a + (b - a) * rnd();

export type DissolveStyle = 'petals' | 'shards' | 'embers' | 'origami' | 'starfall' | 'prism';

// ── Body template ───────────────────────────────────────────────────────────
// Surface samples of a stylized soldier (local space: feet at y 0, forward −Z,
// ~1.82 m), area-weighted and shuffled so ANY stride subset is evenly spread.

const TEMPLATE_N = 384;

interface BodyTemplate {
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  /** Normalized height 0 (feet) … 1 (crown). */
  hn: Float32Array;
}

type Part =
  | { k: 'e'; c: [number, number, number]; r: [number, number, number] }
  | { k: 'c'; a: [number, number, number]; b: [number, number, number]; r: number };

function bodyParts(faction: Faction): Part[] {
  const e = (c: [number, number, number], r: [number, number, number]): Part => ({ k: 'e', c, r });
  const c = (a: [number, number, number], b: [number, number, number], r: number): Part => ({ k: 'c', a, b, r });
  const parts: Part[] = [
    e([0, 1.69, -0.01], [0.13, 0.15, 0.14]), // head / helmet
    e([0, 1.3, 0], [0.24, 0.23, 0.15]), // chest
    e([0, 1.0, 0], [0.19, 0.15, 0.13]), // abdomen / pelvis
    e([0, 1.32, 0.2], [0.15, 0.17, 0.08]), // backpack
    e([0.24, 1.46, 0], [0.11, 0.08, 0.11]), // pauldrons
    e([-0.24, 1.46, 0], [0.11, 0.08, 0.11]),
    c([0.25, 1.43, 0], [0.27, 1.17, -0.1], 0.06), // upper arms
    c([-0.25, 1.43, 0], [-0.27, 1.17, -0.1], 0.06),
    c([0.27, 1.17, -0.1], [0.07, 1.26, -0.4], 0.05), // forearms (aiming)
    c([-0.27, 1.17, -0.1], [-0.04, 1.24, -0.52], 0.05),
    c([0.05, 1.27, -0.18], [0.0, 1.27, -0.78], 0.045), // weapon
    c([0.1, 0.93, 0], [0.12, 0.5, -0.03], 0.085), // thighs
    c([-0.1, 0.93, 0], [-0.12, 0.5, -0.03], 0.085),
    c([0.12, 0.5, -0.03], [0.125, 0.1, 0.0], 0.065), // shins
    c([-0.12, 0.5, -0.03], [-0.125, 0.1, 0.0], 0.065),
    e([0.125, 0.05, -0.06], [0.06, 0.05, 0.12]), // boots
    e([-0.125, 0.05, -0.06], [0.06, 0.05, 0.12]),
  ];
  if (faction === 1) parts.push(e([-0.27, 1.52, 0.02], [0.13, 0.12, 0.12])); // Bloom: frond cluster on one shoulder
  return parts;
}

function partArea(p: Part): number {
  if (p.k === 'c') return 2 * Math.PI * p.r * Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) + 4 * Math.PI * p.r * p.r * 0.5;
  const [a, b, c] = p.r;
  const q = 1.6075; // Knud Thomsen's ellipsoid surface approximation
  return 4 * Math.PI * Math.pow((Math.pow(a * b, q) + Math.pow(a * c, q) + Math.pow(b * c, q)) / 3, 1 / q);
}

function buildTemplate(faction: Faction): BodyTemplate {
  let seed = faction === 1 ? 4242 : 1717;
  const R = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const parts = bodyParts(faction);
  const areas = parts.map(partArea);
  const total = areas.reduce((s, a) => s + a, 0);
  const t: BodyTemplate = {
    px: new Float32Array(TEMPLATE_N),
    py: new Float32Array(TEMPLATE_N),
    pz: new Float32Array(TEMPLATE_N),
    nx: new Float32Array(TEMPLATE_N),
    ny: new Float32Array(TEMPLATE_N),
    nz: new Float32Array(TEMPLATE_N),
    hn: new Float32Array(TEMPLATE_N),
  };
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  // Bloom stands hunched: the upper body pitches forward around the hips.
  const lean = faction === 1 ? 0.22 : 0;
  for (let i = 0; i < TEMPLATE_N; i++) {
    // Stratified pick over the cumulative area (even coverage, no clumping).
    let u = ((i + R()) / TEMPLATE_N) * total;
    let part = parts[parts.length - 1];
    for (let j = 0; j < parts.length; j++) {
      if (u < areas[j]) {
        part = parts[j];
        break;
      }
      u -= areas[j];
    }
    if (part.k === 'e') {
      n.set(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1);
      if (n.lengthSq() < 1e-4) n.set(0, 1, 0);
      n.normalize();
      p.set(n.x * part.r[0], n.y * part.r[1], n.z * part.r[2]);
      n.set(p.x / (part.r[0] * part.r[0]), p.y / (part.r[1] * part.r[1]), p.z / (part.r[2] * part.r[2])).normalize();
      p.add(_t3.set(part.c[0], part.c[1], part.c[2]));
    } else {
      const s = R();
      const ax = _t3.set(part.b[0] - part.a[0], part.b[1] - part.a[1], part.b[2] - part.a[2]);
      const len = ax.length();
      ax.divideScalar(len || 1);
      // Any vector perpendicular to the axis, rotated by a random angle.
      const side = _t4.set(0, 1, 0).cross(ax);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0).cross(ax);
      side.normalize();
      const up = _t5.copy(ax).cross(side);
      const a = R() * Math.PI * 2;
      n.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
      p.set(part.a[0], part.a[1], part.a[2]).addScaledVector(ax, s * len).addScaledVector(n, part.r);
    }
    if (lean > 0 && p.y > 0.95) {
      const dy = p.y - 0.95;
      const cs = Math.cos(lean), sn = Math.sin(lean);
      const z = p.z;
      p.y = 0.95 + dy * cs + z * sn - 0.03;
      p.z = z * cs - dy * sn;
      const ny = n.y, nz = n.z;
      n.y = ny * cs + nz * sn;
      n.z = nz * cs - ny * sn;
    }
    t.px[i] = p.x;
    t.py[i] = p.y;
    t.pz[i] = p.z;
    t.nx[i] = n.x;
    t.ny[i] = n.y;
    t.nz[i] = n.z;
  }
  // Shuffle (Fisher–Yates) so strided subsets stay uniform over the body.
  for (let i = TEMPLATE_N - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    for (const arr of [t.px, t.py, t.pz, t.nx, t.ny, t.nz]) {
      const v = arr[i];
      arr[i] = arr[j];
      arr[j] = v;
    }
  }
  let top = 0;
  for (let i = 0; i < TEMPLATE_N; i++) top = Math.max(top, t.py[i]);
  for (let i = 0; i < TEMPLATE_N; i++) t.hn[i] = Math.max(0, Math.min(1, t.py[i] / top));
  return t;
}

const _t3 = new THREE.Vector3();
const _t4 = new THREE.Vector3();
const _t5 = new THREE.Vector3();

let templates: [BodyTemplate, BodyTemplate] | null = null;
function template(f: Faction): BodyTemplate {
  if (!templates) templates = [buildTemplate(0), buildTemplate(1)];
  return templates[f === 1 ? 1 : 0];
}

/** One world-space body sample (scratch, reused). */
const S = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, hn: 0 };

// ── Instanced 3D pieces ─────────────────────────────────────────────────────

export type PieceKind = 'shard' | 'paper' | 'crystal';

/** Spawn parameters (fill the shared scratch PIECE, then call PiecePool.spawn). */
interface PieceSpec {
  x: number; y: number; z: number;
  /** Facing normal (the piece's +Z) and roll around it. */
  nx: number; ny: number; nz: number; roll: number;
  sx: number; sy: number; sz: number;
  vx: number; vy: number; vz: number;
  /** Angular velocity (rad/s) around a random axis. */
  spin: number;
  delay: number;
  life: number;
  ground: number;
  gravity: number;
  drag: number;
  bounce: number;
  /** Paper flutter: lateral sway acceleration (m/s²). */
  flutter: number;
  /** Albedo tint. */
  r: number; g: number; b: number;
  /** Seam glow colour (linear, premultiplied intensity) while held / at the release flash. */
  gr: number; gg: number; gb: number;
  holdGlow: number;
  flashGlow: number;
  glowDecay: number;
}

const PIECE: PieceSpec = {
  x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, roll: 0, sx: 0.1, sy: 0.1, sz: 0.02, vx: 0, vy: 0, vz: 0, spin: 0,
  delay: 0, life: 1, ground: -1e9, gravity: 0, drag: 0, bounce: 0, flutter: 0, r: 1, g: 1, b: 1, gr: 0, gg: 0, gb: 0, holdGlow: 0, flashGlow: 0, glowDecay: 4,
};

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _z = new THREE.Vector3(0, 0, 1);

/** Shard: a faceted ceramic plate (convex outer face, flat inner face, glowing seam edges). */
function shardGeometry(): THREE.BufferGeometry {
  const ring: [number, number][] = [[-0.5, -0.32], [0.04, -0.5], [0.5, -0.12], [0.3, 0.42], [-0.18, 0.5], [-0.46, 0.2]];
  const pos: number[] = [];
  const colr: number[] = [];
  const edge: number[] = [];
  const tri = (a: number[], b: number[], c: number[], col: number[], e: number): void => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) {
      colr.push(...col);
      edge.push(e);
    }
  };
  const front = [1, 1, 1];
  const back = [0.74, 0.71, 0.66];
  const side = [0.96, 0.93, 0.87];
  const apex = [0.04, 0.02, 0.75];
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    // Outer face: aEdge 1 on the rim, 0 at the apex → the seam glow hugs the outline.
    pos.push(...apex, ax, ay, 0.5, bx, by, 0.5);
    colr.push(...front, ...front, ...front);
    edge.push(0, 1, 1);
    tri([0, 0, -0.5], [bx, by, -0.5], [ax, ay, -0.5], back, 0);
    tri([ax, ay, 0.5], [ax, ay, -0.5], [bx, by, -0.5], side, 1);
    tri([ax, ay, 0.5], [bx, by, -0.5], [bx, by, 0.5], side, 1);
  }
  return finishPieceGeometry(pos, colr, edge);
}

/** Paper: a square folded along its diagonal (a shallow dart), two tones. */
function paperGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const colr: number[] = [];
  const edge: number[] = [];
  const a = [0, -0.5, 0];
  const b = [0, 0.5, 0];
  const l = [-0.5, 0, 0.22];
  const r = [0.5, 0, 0.22];
  pos.push(...a, ...b, ...l, ...a, ...r, ...b);
  colr.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 0.86, 0.85, 0.82, 0.86, 0.85, 0.82, 0.86, 0.85, 0.82);
  edge.push(0, 0, 0, 0, 0, 0);
  return finishPieceGeometry(pos, colr, edge);
}

/** Crystal: an elongated hexagonal bipyramid (whole body glows). */
function crystalGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const colr: number[] = [];
  const edge: number[] = [];
  const top = [0, 0.75, 0];
  const bot = [0, -0.6, 0];
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2;
    const a1 = ((i + 1) / 6) * Math.PI * 2;
    const p0 = [Math.cos(a0) * 0.32, 0.1, Math.sin(a0) * 0.32];
    const p1 = [Math.cos(a1) * 0.32, 0.1, Math.sin(a1) * 0.32];
    const k = 0.85 + 0.15 * (i % 2);
    pos.push(...top, ...p1, ...p0, ...bot, ...p0, ...p1);
    for (let j = 0; j < 6; j++) {
      colr.push(k, k, k);
      edge.push(1);
    }
  }
  return finishPieceGeometry(pos, colr, edge);
}

function finishPieceGeometry(pos: number[], colr: number[], edge: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.computeVertexNormals(); // non-indexed → flat facets (they catch the sun one by one)
  return g;
}

/** Standard material + per-instance seam/body glow (aGlow × aEdge → emissive). */
function pieceMaterial(kind: PieceKind): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: kind === 'paper' ? 0.85 : kind === 'crystal' ? 0.18 : 0.3,
    metalness: kind === 'crystal' ? 0.1 : 0,
    side: kind === 'paper' ? THREE.DoubleSide : THREE.FrontSide,
    // Ceramic stays ceramic-white in shade (the armor it came from is self-lit a touch too).
    emissive: kind === 'shard' ? new THREE.Color('#fff4e6') : new THREE.Color(0x000000),
    emissiveIntensity: kind === 'shard' ? 0.14 : 0,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEdge;\nattribute vec3 aGlow;\nvarying vec3 vGlow;\nvarying float vEdge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;\nvEdge = aEdge;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;\nvarying float vEdge;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * (vEdge * vEdge * vEdge);');
  };
  m.customProgramCacheKey = () => 'halcyon.dissolvePiece';
  return m;
}

class PiecePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private next = 0;
  private live = 0;
  private readonly px: Float32Array; private readonly py: Float32Array; private readonly pz: Float32Array;
  private readonly vx: Float32Array; private readonly vy: Float32Array; private readonly vz: Float32Array;
  private readonly qx: Float32Array; private readonly qy: Float32Array; private readonly qz: Float32Array; private readonly qw: Float32Array;
  private readonly wx: Float32Array; private readonly wy: Float32Array; private readonly wz: Float32Array; private readonly ws: Float32Array;
  private readonly sx: Float32Array; private readonly sy: Float32Array; private readonly sz: Float32Array;
  private readonly age: Float32Array; private readonly life: Float32Array;
  private readonly ground: Float32Array; private readonly grav: Float32Array; private readonly drag: Float32Array;
  private readonly bounce: Float32Array; private readonly flutter: Float32Array; private readonly hits: Uint8Array;
  private readonly cr: Float32Array; private readonly cg: Float32Array; private readonly cb: Float32Array;
  private readonly gr: Float32Array; private readonly gg: Float32Array; private readonly gb: Float32Array;
  private readonly hold: Float32Array; private readonly flash: Float32Array; private readonly decay: Float32Array;
  private readonly alive: Uint8Array;
  private readonly glow: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;

  constructor(scene: THREE.Scene, kind: PieceKind, capacity: number) {
    const n = (this.cap = Math.max(8, capacity | 0));
    const F = (): Float32Array => new Float32Array(n);
    this.px = F(); this.py = F(); this.pz = F();
    this.vx = F(); this.vy = F(); this.vz = F();
    this.qx = F(); this.qy = F(); this.qz = F(); this.qw = F();
    this.wx = F(); this.wy = F(); this.wz = F(); this.ws = F();
    this.sx = F(); this.sy = F(); this.sz = F();
    this.age = F(); this.life = F();
    this.ground = F(); this.grav = F(); this.drag = F();
    this.bounce = F(); this.flutter = F(); this.hits = new Uint8Array(n);
    this.cr = F(); this.cg = F(); this.cb = F();
    this.gr = F(); this.gg = F(); this.gb = F();
    this.hold = F(); this.flash = F(); this.decay = F();
    this.alive = new Uint8Array(n);
    const geo = kind === 'shard' ? shardGeometry() : kind === 'paper' ? paperGeometry() : crystalGeometry();
    this.glow = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', this.glow);
    this.mesh = new THREE.InstancedMesh(geo, pieceMaterial(kind), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.color;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.name = `fx.dissolve.${kind}`;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  get count(): number {
    return this.live;
  }

  /** Spawns from the shared PIECE spec. When full, the oldest slot is recycled. */
  spawn(p: PieceSpec): void {
    let i = -1;
    for (let k = 0; k < this.cap; k++) {
      const j = (this.next + k) % this.cap;
      if (!this.alive[j]) {
        i = j;
        break;
      }
    }
    if (i < 0) i = this.next;
    this.next = (i + 1) % this.cap;
    this.alive[i] = 1;
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.vx[i] = p.vx; this.vy[i] = p.vy; this.vz[i] = p.vz;
    _v.set(p.nx, p.ny, p.nz);
    if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1);
    _q.setFromUnitVectors(_z, _v.normalize());
    _q2.setFromAxisAngle(_z, p.roll);
    _q.multiply(_q2);
    this.qx[i] = _q.x; this.qy[i] = _q.y; this.qz[i] = _q.z; this.qw[i] = _q.w;
    _v.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5);
    if (_v.lengthSq() < 1e-6) _v.set(0, 1, 0);
    _v.normalize();
    this.wx[i] = _v.x; this.wy[i] = _v.y; this.wz[i] = _v.z; this.ws[i] = p.spin;
    this.sx[i] = p.sx; this.sy[i] = p.sy; this.sz[i] = p.sz;
    this.age[i] = -Math.max(0, p.delay);
    this.life[i] = Math.max(0.05, p.life);
    this.ground[i] = p.ground; this.grav[i] = p.gravity; this.drag[i] = p.drag;
    this.bounce[i] = p.bounce; this.flutter[i] = p.flutter; this.hits[i] = 0;
    this.cr[i] = p.r; this.cg[i] = p.g; this.cb[i] = p.b;
    this.gr[i] = p.gr; this.gg[i] = p.gg; this.gb[i] = p.gb;
    this.hold[i] = p.holdGlow; this.flash[i] = p.flashGlow; this.decay[i] = p.glowDecay;
  }

  clear(): void {
    this.alive.fill(0);
  }

  update(dt: number): void {
    const G = this.glow.array as Float32Array;
    const C = this.color.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      const age0 = this.age[i];
      const age = (this.age[i] += dt);
      let gk: number;
      let scale = 1;
      if (age < 0) {
        gk = this.hold[i];
      } else {
        if (age >= this.life[i]) {
          this.alive[i] = 0;
          continue;
        }
        const h = age0 < 0 ? age : dt;
        const settled = this.hits[i] >= 3;
        if (!settled) {
          const k = Math.exp(-this.drag[i] * h);
          this.vx[i] *= k;
          this.vy[i] *= k;
          this.vz[i] *= k;
          this.vy[i] -= this.grav[i] * h;
          const fl = this.flutter[i];
          if (fl !== 0) {
            // Paper: a falling-leaf sway (lateral pendulum) + lift on the swing.
            const ph = age * 3.4 + i * 1.7;
            this.vx[i] += Math.cos(ph) * fl * h;
            this.vz[i] += Math.sin(ph * 0.8) * fl * h;
          }
          this.px[i] += this.vx[i] * h;
          this.py[i] += this.vy[i] * h;
          this.pz[i] += this.vz[i] * h;
          const g = this.ground[i];
          if (this.py[i] < g) {
            this.py[i] = g;
            if (this.vy[i] < -0.8 && this.hits[i] < 2) {
              this.vy[i] = -this.vy[i] * this.bounce[i];
              this.vx[i] *= 0.55;
              this.vz[i] *= 0.55;
              this.ws[i] *= 0.5;
              this.hits[i]++;
            } else {
              // Resting: lie down and stop.
              this.vy[i] = 0;
              this.vx[i] = 0;
              this.vz[i] = 0;
              this.hits[i] = 3;
            }
          }
          const a = this.ws[i] * h;
          if (a !== 0) {
            _v.set(this.wx[i], this.wy[i], this.wz[i]);
            _q2.setFromAxisAngle(_v, a);
            _q.set(this.qx[i], this.qy[i], this.qz[i], this.qw[i]).premultiply(_q2);
            this.qx[i] = _q.x; this.qy[i] = _q.y; this.qz[i] = _q.z; this.qw[i] = _q.w;
          }
        }
        gk = this.flash[i] * Math.exp(-age * this.decay[i]);
        // Shrink away over the last 0.45 s (opaque pieces can't fade).
        scale = Math.min(1, (this.life[i] - age) / 0.45);
      }
      _q.set(this.qx[i], this.qy[i], this.qz[i], this.qw[i]);
      _v.set(this.px[i], this.py[i], this.pz[i]);
      _s.set(this.sx[i] * scale, this.sy[i] * scale, this.sz[i] * scale);
      _m.compose(_v, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      C[n * 3] = this.cr[i];
      C[n * 3 + 1] = this.cg[i];
      C[n * 3 + 2] = this.cb[i];
      G[n * 3] = this.gr[i] * gk;
      G[n * 3 + 1] = this.gg[i] * gk;
      G[n * 3 + 2] = this.gb[i] * gk;
      n++;
    }
    this.live = n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.color.clearUpdateRanges();
      this.color.addUpdateRange(0, n * 3);
      this.color.needsUpdate = true;
      this.glow.clearUpdateRanges();
      this.glow.addUpdateRange(0, n * 3);
      this.glow.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

// ── Dissolve choreography ───────────────────────────────────────────────────

/** Release timing: feet first, crown last (≈ 1 s sweep), a little jitter. */
const D0 = 0.07;
const SWEEP = 0.92;
const delayAt = (hn: number): number => D0 + Math.pow(hn, 1.08) * SWEEP + rr(-0.03, 0.07);

/** Ghost glow bands of the body: [height, sprite size, normalized height]. */
const GHOST_BANDS: readonly (readonly [number, number, number])[] = [
  [0.22, 0.42, 0.12],
  [0.66, 0.5, 0.36],
  [1.02, 0.6, 0.55],
  [1.32, 0.75, 0.72],
  [1.68, 0.4, 0.93],
];

const ORIGAMI = [ENV.bone, ENV.pastelPink, ENV.pastelBlue, ENV.pastelYellow, ENV.pastelMint];
const PRISM_HUES = [0.0, 0.08, 0.15, 0.33, 0.52, 0.62, 0.78];

const _a = new THREE.Color();
const _b = new THREE.Color();
const _c = new THREE.Color();

export class Dissolver {
  private readonly shards: PiecePool;
  private readonly paper: PiecePool;
  private readonly crystals: PiecePool;
  /** Particle budget multiplier (0.25…1). */
  private k = 1;
  // Body transform of the current dissolve.
  private bx = 0;
  private by = 0;
  private bz = 0;
  private cy = 1;
  private sy = 1;
  private cs = 1;
  private sn = 0;
  private tpl: BodyTemplate = template(0);

  constructor(
    scene: THREE.Scene,
    private readonly add: ParticlePool,
    private readonly alpha: ParticlePool,
    particles: number,
  ) {
    this.k = Math.max(0.25, particles);
    // Capacity: ~3 simultaneous full dissolves on high (recycles the oldest beyond that).
    this.shards = new PiecePool(scene, 'shard', Math.round(340 * Math.max(0.4, this.k)));
    this.paper = new PiecePool(scene, 'paper', Math.round(220 * Math.max(0.4, this.k)));
    this.crystals = new PiecePool(scene, 'crystal', Math.round(200 * Math.max(0.4, this.k)));
  }

  setBudget(particles: number): void {
    this.k = Math.max(0.25, particles);
  }

  private n(base: number): number {
    return Math.max(1, Math.round(base * this.k));
  }

  /** Live 3D pieces (perf readouts). */
  get pieces(): number {
    return this.shards.count + this.paper.count + this.crystals.count;
  }

  private begin(pos: Vec3, yaw: number, faction: Faction, crouch: number): void {
    this.tpl = template(faction);
    this.bx = pos.x;
    this.by = pos.y;
    this.bz = pos.z;
    const c = Math.max(0, Math.min(1, crouch));
    this.sy = 1 - 0.3 * c;
    this.cy = 1.25 * this.sy;
    this.cs = Math.cos(yaw);
    this.sn = Math.sin(yaw);
  }

  /** Writes body sample `i` (strided over the template) into S, in world space. */
  private sample(i: number, n: number, offset: number): void {
    const t = this.tpl;
    const j = (Math.floor((i * TEMPLATE_N) / n) + offset) % TEMPLATE_N;
    const lx = t.px[j], lz = t.pz[j];
    S.x = this.bx + lx * this.cs + lz * this.sn;
    S.z = this.bz - lx * this.sn + lz * this.cs;
    S.y = this.by + t.py[j] * this.sy;
    const nx = t.nx[j], nz = t.nz[j];
    S.nx = nx * this.cs + nz * this.sn;
    S.nz = -nx * this.sn + nz * this.cs;
    S.ny = t.ny[j];
    S.hn = t.hn[j];
  }

  play(style: DissolveStyle, pos: Vec3, yaw: number, faction: Faction, team: Team, crouch: number): void {
    this.begin(pos, yaw, faction, crouch);
    const tc = teamColors(team);
    switch (style) {
      case 'petals':
        return this.petals(_a.set(tc.primary), _b.set(tc.secondary));
      case 'shards':
        return this.ceramic(_a.set(tc.primary));
      case 'embers':
        return this.embers();
      case 'origami':
        return this.origami();
      case 'starfall':
        return this.starfall();
      case 'prism':
        return this.prism();
    }
  }

  /** Coverage compensation: fewer pieces → slightly bigger ones. */
  private cov(n: number, base: number): number {
    return Math.min(1.7, Math.max(1, Math.sqrt(base / Math.max(1, n))));
  }

  /** Soft glowing "ghost" of the body that fades band by band from the feet up. */
  private ghost(r: number, g: number, b: number, a: number): void {
    for (const [y, s, hn] of GHOST_BANDS) {
      this.add.spawn({
        x: this.bx, y: this.by + y * this.sy, z: this.bz, life: 0.32, size: s, size1: s * 1.3, r, g, b, a, a1: 0,
        sprite: SPRITE.ghost, delay: D0 + hn * SWEEP,
      });
    }
  }

  private flash(r: number, g: number, b: number, size: number, life: number, a = 0.8): void {
    const y = this.by + this.cy;
    this.add.spawn({ x: this.bx, y, z: this.bz, life, size: size * 0.35, size1: size, r, g, b, a, a1: 0, sprite: SPRITE.glow });
  }

  // ── Bloom: petals of light ──
  private petals(a: THREE.Color, b: THREE.Color): void {
    const y = this.by + this.cy;
    // A brief bloom of light at the core + a soft ring.
    this.flash(a.r * 1.1 + 0.3, a.g * 1.1 + 0.3, a.b * 1.1 + 0.3, 1.5, 0.36, 0.55);
    this.add.spawn({ x: this.bx, y, z: this.bz, life: 0.2, size: 0.2, size1: 0.7, r: 2.2, g: 2.4, b: 2.3, a: 0.9, sprite: SPRITE.glow });
    this.add.spawn({ x: this.bx, y, z: this.bz, life: 0.5, size: 0.3, size1: 1.6, r: a.r * 1.4, g: a.g * 1.4, b: a.b * 1.4, a: 0.4, sprite: SPRITE.softRing });
    this.ghost(a.r * 0.5, a.g * 0.5, a.b * 0.5, 0.35);
    const n = this.n(150);
    const cv = this.cov(n, 150);
    const off = (rnd() * TEMPLATE_N) | 0;
    const spin = rnd() < 0.5 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      this.sample(i, n, off);
      // Teal heart with violet tips: the mix shifts per petal and over its life.
      const m = i % 5 === 0 ? 0.85 : i % 3 === 0 ? 0.45 : rr(0, 0.2);
      _c.copy(a).lerp(b, m);
      const k = rr(1.9, 2.5);
      const s = rr(0.1, 0.15) * cv;
      this.add.spawn({
        x: S.x + S.nx * 0.02, y: S.y + S.ny * 0.02, z: S.z + S.nz * 0.02,
        vx: S.nx * rr(0.2, 0.6), vy: rr(0.3, 0.8) + S.ny * 0.3, vz: S.nz * rr(0.2, 0.6),
        life: rr(0.9, 1.35), size: s, size1: s * 0.4,
        r: _c.r * k, g: _c.g * k, b: _c.b * k, r1: b.r * 1.3, g1: b.g * 1.3, b1: b.b * 1.3,
        a: 1, a1: 0, holdA: 0.72, delay: delayAt(S.hn),
        drag: 1.3, gravity: -0.25, orbit: spin * rr(0.9, 1.7), ox: this.bx, oz: this.bz,
        sprite: SPRITE.petalLight, rot: rnd() * 6.28, spin: rr(-1.6, 1.6), flip: rr(1.6, 3.8),
      });
    }
    // Motes rising from the dissolve front.
    for (let i = 0, m = this.n(36); i < m; i++) {
      this.sample(i, m, off + 7);
      this.add.spawn({
        x: S.x, y: S.y, z: S.z, vx: S.nx * 0.2, vy: rr(0.7, 1.5), vz: S.nz * 0.2, life: rr(1.1, 1.8), size: rr(0.03, 0.05), size1: 0.015,
        r: a.r * 3, g: a.g * 3, b: a.b * 3, r1: b.r * 2.4, g1: b.g * 2.4, b1: b.b * 2.4, a: 1, a1: 0, holdA: 0,
        delay: delayAt(S.hn), drag: 0.8, orbit: spin * rr(1.2, 2.2), ox: this.bx, oz: this.bz, sprite: SPRITE.ember,
      });
    }
    // Sparkles that pop exactly as each band lets go.
    for (let i = 0, m = this.n(16); i < m; i++) {
      this.sample(i, m, off + 31);
      this.add.spawn({ x: S.x, y: S.y, z: S.z, life: 0.24, size: rr(0.14, 0.22), size1: 0.03, r: 2.4, g: 2.6, b: 2.5, a: 1, a1: 0, holdA: 0, delay: delayAt(S.hn), sprite: SPRITE.glint, rot: rnd() * 0.6 });
    }
  }

  // ── Halcyon: white ceramic shards ──
  private ceramic(glint: THREE.Color): void {
    const y = this.by + this.cy;
    this.flash(1.7, 1.62, 1.48, 1.9, 0.3, 0.6);
    this.add.spawn({ x: this.bx, y, z: this.bz, life: 0.14, size: 0.7, size1: 1.0, r: 2.4, g: 2.3, b: 2.1, a: 0.9, sprite: SPRITE.flare, rot: rnd() * 3 });
    const n = this.n(140);
    const cv = this.cov(n, 140);
    const off = (rnd() * TEMPLATE_N) | 0;
    const g = this.by + 0.012;
    // Seam glow: the team's warm accent (linear, HDR) — faint while the shell
    // holds, a hot flash as each shard cracks free.
    const gr = glint.r, gg = glint.g, gb = glint.b;
    for (let i = 0; i < n; i++) {
      this.sample(i, n, off);
      const out = rr(0.6, 1.7);
      const s = rr(0.085, 0.14) * cv;
      const w = rr(0.93, 1.0);
      const P = PIECE;
      P.x = S.x; P.y = S.y; P.z = S.z;
      P.nx = S.nx; P.ny = S.ny; P.nz = S.nz; P.roll = rnd() * 6.28;
      P.sx = s; P.sy = s * rr(0.7, 1.05); P.sz = s * 0.16;
      P.vx = S.nx * out + rr(-0.3, 0.3); P.vy = rr(0.7, 2.3) + Math.max(0, S.ny) * 0.8; P.vz = S.nz * out + rr(-0.3, 0.3);
      P.spin = rr(4, 12);
      P.delay = delayAt(S.hn);
      P.life = rr(1.9, 2.9);
      P.ground = g + s * 0.06;
      P.gravity = 8.5; P.drag = 0.35; P.bounce = 0.28; P.flutter = 0;
      P.r = w; P.g = w * 0.985; P.b = w * 0.95;
      P.gr = gr * 2.2; P.gg = gg * 2.2; P.gb = gb * 2.2;
      P.holdGlow = 0.45; P.flashGlow = 2.2; P.glowDecay = 4.5;
      this.shards.spawn(P);
    }
    // Crack sparks + bone-white dust as each band lets go.
    for (let i = 0, m = this.n(18); i < m; i++) {
      this.sample(i, m, off + 11);
      const sp = rr(1.8, 3.6);
      this.add.spawn({
        x: S.x, y: S.y, z: S.z, vx: S.nx * sp, vy: rr(0.5, 2), vz: S.nz * sp, life: rr(0.12, 0.24), size: 0.016,
        r: gr * 3, g: gg * 3, b: gb * 3, a: 1, holdA: 0, delay: delayAt(S.hn), gravity: 6, drag: 2, sprite: SPRITE.streak, stretch: 0.025,
      });
    }
    const bone = _c.set(ENV.bone);
    for (let i = 0, m = this.n(12); i < m; i++) {
      this.sample(i, m, off + 23);
      this.alpha.spawn({
        x: S.x, y: S.y, z: S.z, vx: S.nx * 0.5, vy: rr(0.1, 0.5), vz: S.nz * 0.5, life: rr(0.8, 1.2), size: rr(0.16, 0.24), size1: rr(0.55, 0.8),
        r: bone.r, g: bone.g, b: bone.b, a: 0.34, holdA: 0, delay: delayAt(S.hn) + 0.02, drag: 2.5, sprite: SPRITE.dust, rot: rnd() * 6,
      });
    }
    // Sun glints flickering on the tumbling shards.
    for (let i = 0, m = this.n(16); i < m; i++) {
      this.sample(i, m, off + 47);
      const t = delayAt(S.hn) + rr(0.12, 0.7);
      this.add.spawn({
        x: S.x + S.nx * 0.4, y: S.y + rr(0.2, 0.7), z: S.z + S.nz * 0.4, vx: S.nx * 0.6, vy: -0.4, vz: S.nz * 0.6, life: rr(0.12, 0.2),
        size: rr(0.16, 0.26), size1: 0.04, r: 3, g: 2.85, b: 2.5, a: 1, holdA: 0, delay: t, sprite: SPRITE.glint, rot: rnd() * 0.5,
      });
    }
  }

  // ── Embers: the body chars into flakes with burning rims that lift on the heat ──
  private embers(): void {
    this.flash(3, 1.45, 0.5, 2.2, 0.45, 0.7);
    this.ghost(1.1, 0.42, 0.12, 0.55);
    const n = this.n(100);
    const cv = this.cov(n, 100);
    const off = (rnd() * TEMPLATE_N) | 0;
    const spin = rnd() < 0.5 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      this.sample(i, n, off);
      const s = rr(0.09, 0.14) * cv;
      const vx = S.nx * rr(0.15, 0.45), vy = rr(0.9, 1.7), vz = S.nz * rr(0.15, 0.45);
      const life = rr(1.0, 1.6);
      const delay = delayAt(S.hn);
      const rot = rnd() * 6.28, sp = rr(-1.5, 1.5), fl = rr(1.4, 3.2), ob = spin * rr(0.6, 1.1);
      const x = S.x + S.nx * 0.02, y = S.y, z = S.z + S.nz * 0.02;
      // Charcoal flake + its glowing rim, moving in lockstep (no swirl: same path).
      this.alpha.spawn({ x, y, z, vx, vy, vz, life, size: s, size1: s * 0.55, r: 0.12, g: 0.1, b: 0.09, a: 0.95, a1: 0, delay, drag: 1.1, orbit: ob, ox: this.bx, oz: this.bz, sprite: SPRITE.ash, rot, spin: sp, flip: fl });
      this.add.spawn({ x, y, z, vx, vy, vz, life, size: s, size1: s * 0.55, r: 3.2, g: 1.25, b: 0.35, r1: 1.6, g1: 0.3, b1: 0.08, a: 1, a1: 0, holdA: 0.55, delay, drag: 1.1, orbit: ob, ox: this.bx, oz: this.bz, sprite: SPRITE.emberRim, rot, spin: sp, flip: fl });
    }
    for (let i = 0, m = this.n(48); i < m; i++) {
      this.sample(i, m, off + 13);
      const hot = rnd();
      this.add.spawn({
        x: S.x, y: S.y, z: S.z, vx: rr(-0.3, 0.3), vy: rr(1.2, 2.6), vz: rr(-0.3, 0.3), life: rr(0.8, 1.5), size: rr(0.025, 0.05), size1: 0.01,
        r: 3, g: 1.1 + hot, b: 0.3, a: 1, a1: 0, holdA: 0, delay: delayAt(S.hn) + rr(0, 0.15), swirl: 2.2, sprite: SPRITE.ember,
      });
    }
  }

  // ── Origami: folded pastel paper fluttering away ──
  private origami(): void {
    this.flash(1.5, 1.45, 1.38, 2.0, 0.4, 0.55);
    const n = this.n(90);
    const cv = this.cov(n, 90);
    const off = (rnd() * TEMPLATE_N) | 0;
    for (let i = 0; i < n; i++) {
      this.sample(i, n, off);
      const c = _c.set(ORIGAMI[i % ORIGAMI.length]);
      const s = rr(0.13, 0.19) * cv;
      const out = rr(0.5, 1.3);
      const P = PIECE;
      P.x = S.x; P.y = S.y; P.z = S.z;
      P.nx = S.nx; P.ny = S.ny; P.nz = S.nz; P.roll = rnd() * 6.28;
      P.sx = s; P.sy = s; P.sz = s;
      P.vx = S.nx * out; P.vy = rr(1.3, 2.6); P.vz = S.nz * out;
      P.spin = rr(2, 5.5);
      P.delay = delayAt(S.hn);
      P.life = rr(2.2, 3.0);
      P.ground = this.by + 0.03;
      P.gravity = 2.4; P.drag = 1.7; P.bounce = 0.05; P.flutter = rr(1.6, 2.6);
      P.r = c.r; P.g = c.g; P.b = c.b;
      P.gr = 0; P.gg = 0; P.gb = 0; P.holdGlow = 0; P.flashGlow = 0; P.glowDecay = 1;
      this.paper.spawn(P);
    }
    for (let i = 0, m = this.n(14); i < m; i++) {
      this.sample(i, m, off + 5);
      this.add.spawn({ x: S.x, y: S.y, z: S.z, life: 0.22, size: rr(0.12, 0.18), size1: 0.03, r: 2.2, g: 2.1, b: 1.9, a: 1, a1: 0, holdA: 0, delay: delayAt(S.hn), sprite: SPRITE.glint });
    }
  }

  // ── Starfall: falling stars strike, the body becomes a constellation and drifts up ──
  private starfall(): void {
    const y = this.by + this.cy;
    // Shooting stars (arrive ≈ 0.12–0.32 s), each with an impact twinkle.
    for (let i = 0, m = Math.max(3, this.n(6)); i < m; i++) {
      const a = rnd() * Math.PI * 2;
      const tx = this.bx + rr(-0.25, 0.25), ty = this.by + rr(0.5, 1.6) * this.sy, tz = this.bz + rr(-0.25, 0.25);
      const dx = Math.cos(a) * rr(1.5, 3), dy = rr(5, 8), dz = Math.sin(a) * rr(1.5, 3);
      const d = Math.hypot(dx, dy, dz);
      const sp = 26;
      const t0 = rr(0, 0.18);
      this.add.spawn({ x: tx + dx, y: ty + dy, z: tz + dz, vx: (-dx / d) * sp, vy: (-dy / d) * sp, vz: (-dz / d) * sp, life: d / sp, size: 0.05, r: 3, g: 2.8, b: 2.1, a: 1, a1: 0.9, holdA: 0, delay: t0, sprite: SPRITE.streak, stretch: 0.06 });
      this.add.spawn({ x: tx, y: ty, z: tz, life: 0.3, size: 0.5, size1: 0.1, r: 3, g: 2.8, b: 2.2, a: 1, holdA: 0, delay: t0 + d / sp, sprite: SPRITE.twinkle, rot: rnd() });
    }
    this.flash(1.7, 1.75, 2.0, 2.2, 0.5, 0.6);
    this.add.spawn({ x: this.bx, y, z: this.bz, life: 0.7, size: 0.3, size1: 1.7, r: 2.2, g: 2.1, b: 1.6, a: 0.45, a1: 0, holdA: 0, sprite: SPRITE.softRing, delay: 0.25 });
    this.ghost(0.55, 0.6, 0.9, 0.45);
    const n = this.n(80);
    const off = (rnd() * TEMPLATE_N) | 0;
    for (let i = 0; i < n; i++) {
      this.sample(i, n, off);
      const big = i % 7 === 0;
      const s = big ? rr(0.16, 0.22) : rr(0.06, 0.1);
      this.add.spawn({
        x: S.x, y: S.y, z: S.z, vx: S.nx * 0.25, vy: rr(0.4, 1.0), vz: S.nz * 0.25, life: rr(1.0, 1.6), size: s, size1: s * 0.3,
        r: 3, g: 2.75, b: 2.1, r1: 1.6, g1: 1.9, b1: 3, a: 1, a1: 0, holdA: 0.8, delay: delayAt(S.hn) + 0.12, drag: 0.9,
        orbit: rr(0.4, 0.9), ox: this.bx, oz: this.bz, sprite: big ? SPRITE.twinkle : SPRITE.star, rot: rnd() * 3, spin: rr(-2, 2),
      });
    }
  }

  // ── Prism: glowing crystals break away, rainbow refractions ──
  private prism(): void {
    const y = this.by + this.cy;
    this.flash(2, 2, 2.1, 2.3, 0.45, 0.65);
    this.add.spawn({ x: this.bx, y, z: this.bz, life: 0.55, size: 0.3, size1: 1.5, r: 1.6, g: 1.3, b: 2.2, a: 0.4, sprite: SPRITE.softRing });
    const n = this.n(80);
    const cv = this.cov(n, 80);
    const off = (rnd() * TEMPLATE_N) | 0;
    for (let i = 0; i < n; i++) {
      this.sample(i, n, off);
      const c = _c.setHSL(PRISM_HUES[i % PRISM_HUES.length], 0.6, 0.72);
      const s = rr(0.07, 0.11) * cv;
      const out = rr(0.8, 2);
      const P = PIECE;
      P.x = S.x; P.y = S.y; P.z = S.z;
      P.nx = S.nx; P.ny = S.ny; P.nz = S.nz; P.roll = rnd() * 6.28;
      P.sx = s; P.sy = s * rr(1.3, 2); P.sz = s;
      P.vx = S.nx * out; P.vy = rr(0.6, 2); P.vz = S.nz * out;
      P.spin = rr(3, 9);
      P.delay = delayAt(S.hn);
      P.life = rr(1.6, 2.4);
      P.ground = this.by + s * 0.4;
      P.gravity = 5.5; P.drag = 0.6; P.bounce = 0.35; P.flutter = 0;
      P.r = c.r; P.g = c.g; P.b = c.b;
      P.gr = c.r; P.gg = c.g; P.gb = c.b; P.holdGlow = 0.6; P.flashGlow = 2.2; P.glowDecay = 2.2;
      this.crystals.spawn(P);
    }
    for (let i = 0, m = this.n(40); i < m; i++) {
      this.sample(i, m, off + 9);
      const c = _c.setHSL(PRISM_HUES[i % PRISM_HUES.length], 0.7, 0.66);
      this.add.spawn({
        x: S.x, y: S.y, z: S.z, vx: S.nx * rr(0.6, 1.6), vy: rr(0.3, 1.4), vz: S.nz * rr(0.6, 1.6), life: rr(0.5, 0.9), size: rr(0.07, 0.12), size1: 0.02,
        r: c.r * 2.4, g: c.g * 2.4, b: c.b * 2.4, a: 1, a1: 0, holdA: 0, delay: delayAt(S.hn), drag: 2, sprite: SPRITE.prism, rot: rnd() * 6, spin: rr(-5, 5), flip: rr(4, 9),
      });
    }
  }

  update(dt: number): void {
    this.shards.update(dt);
    this.paper.update(dt);
    this.crystals.update(dt);
  }

  clear(): void {
    this.shards.clear();
    this.paper.clear();
    this.crystals.clear();
  }

  dispose(): void {
    this.shards.dispose();
    this.paper.dispose();
    this.crystals.dispose();
  }
}
