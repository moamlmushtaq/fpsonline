// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — instanced 3D dissolve pieces (ceramic shards, folded paper,
// crystals). One InstancedMesh per kind, drawn only while pieces are alive:
// hold in place (the body's silhouette), release, tumble, bounce on the ground
// plane, settle, shrink away. Per-instance albedo tint + a seam / body glow
// (aGlow × aEdge → emissive). Zero allocation per frame.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';

const rnd = Math.random;

// ── Instanced 3D pieces ─────────────────────────────────────────────────────

export type PieceKind = 'shard' | 'paper' | 'crystal';

/** Spawn parameters (fill the shared scratch PIECE, then call PiecePool.spawn). */
export interface PieceSpec {
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

export const PIECE: PieceSpec = {
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

export class PiecePool {
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
