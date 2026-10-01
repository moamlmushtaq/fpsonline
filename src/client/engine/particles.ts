// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — GPU-friendly particle pools.
//
// One pool = ONE instanced draw call: a unit quad instanced N times, all
// per-particle data in preallocated typed arrays (no allocation per frame).
// Billboarding, rotation, velocity stretching (tracers / sparks) and a fake
// 3D tumble ("flip", for shards and petals) happen in the vertex shader; an
// 8×4 procedural sprite atlas provides the shapes. Fog fades particles into
// the haze (additive → toward black, alpha → toward the fog color).
//
// Dissolve support: a particle can HOLD in place for `delay` seconds before it
// starts to live (eliminations build the body's silhouette out of held petals /
// flakes and release them from the feet up), ORBIT a vertical axis (spiral
// drift) and shift its colour over its life (`r1 g1 b1`).
//
// Slots are fixed (free-list), so effects can hold "managed" particles (smoke
// puffs, beam sparkles) and move them every frame through `set*` accessors.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { particleAtlas } from './particle-textures';

// Sprite cells + textures live in particle-textures.ts (re-exported for callers).
export { FLASH_CELL, flashAtlas, glowTexture, particleAtlas, SPRITE } from './particle-textures';

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Seconds. */
  life: number;
  size: number;
  /** Size at end of life (default = size). */
  size1?: number;
  rot?: number;
  spin?: number;
  r: number;
  g: number;
  b: number;
  /** Start alpha (default 1). */
  a?: number;
  /** End alpha (default 0). */
  a1?: number;
  /** Fraction of life spent fading in (default 0). */
  fadeIn?: number;
  /** Velocity damping per second (0 = none, 1 = strong). */
  drag?: number;
  /** Downward acceleration (m/s²). */
  gravity?: number;
  sprite?: number;
  /** Stretch along screen-space velocity: quad length = size + stretch·|v|. */
  stretch?: number;
  /** Tumble rate (rad/s) for the fake 3D flip (0 = none). */
  flip?: number;
  /** Swirl strength (m/s) — gentle curl around the vertical axis. */
  swirl?: number;
  /** Seconds held motionless (age < 0) before the particle starts to live. */
  delay?: number;
  /** Alpha multiplier while held (default 1). */
  holdA?: number;
  /** Spiral drift: rad/s around the vertical axis through (ox, oz). */
  orbit?: number;
  ox?: number;
  oz?: number;
  /** End-of-life colour (default = start colour). */
  r1?: number;
  g1?: number;
  b1?: number;
}

const VERT = /* glsl */ `
uniform float uHalfH;
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec4 iMisc;   // size, rot, sprite, flip
attribute vec4 iVel;    // velocity xyz, stretch
varying vec2 vUv;
varying vec4 vColor;
varying float vFogDepth;
void main() {
  float size = iMisc.x;
  float rot = iMisc.y;
  float sprite = iMisc.z;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  vec2 c = position.xy;
  vec2 off;
  if (iVel.w > 0.0) {
    vec3 vv = mat3(viewMatrix) * iVel.xyz;
    float l = length(vv.xy);
    vec2 dir = l > 1e-4 ? vv.xy / l : vec2(0.0, 1.0);
    float len = size + iVel.w * l;
    // Minimum on-screen width (~1.2 px) so far tracers stay readable.
    float pxW = size * projectionMatrix[1][1] * uHalfH / max(-mv.z, 0.05);
    float w = size * max(1.0, 1.2 / max(pxW, 1e-4));
    off = dir * c.y * len + vec2(-dir.y, dir.x) * c.x * w;
  } else {
    float cs = cos(rot), sn = sin(rot);
    vec2 q = vec2(c.x * iMisc.w, c.y);
    off = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs) * size;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  float col = mod(sprite, 8.0);
  float row = floor(sprite / 8.0);
  vUv = (vec2(col, 3.0 - row) + (c + 0.5)) * vec2(0.125, 0.25);
  vColor = iColor;
  vFogDepth = -mv.z;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float uAdditive;
uniform float uGain;
varying vec2 vUv;
varying vec4 vColor;
varying float vFogDepth;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  vec3 col = t.rgb * vColor.rgb;
  float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  if (uAdditive > 0.5) {
    gl_FragColor = vec4(col * a * (1.0 - fogF) * uGain, 1.0);
  } else {
    gl_FragColor = vec4(mix(col, fogColor, fogF), a);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function markRange(attr: THREE.InstancedBufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count);
  attr.needsUpdate = true;
}

export class ParticlePool {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private cap: number;
  // Simulation state (SoA).
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private s1: Float32Array;
  private rot: Float32Array; private spin: Float32Array; private flip: Float32Array;
  private cr: Float32Array; private cg: Float32Array; private cb: Float32Array;
  private a0: Float32Array; private a1: Float32Array; private fin: Float32Array;
  private drag: Float32Array; private grav: Float32Array; private swirl: Float32Array;
  private sprite: Float32Array; private stretch: Float32Array;
  private holdA: Float32Array;
  private orb: Float32Array; private ox: Float32Array; private oz: Float32Array;
  private cr1: Float32Array; private cg1: Float32Array; private cb1: Float32Array;
  private alive: Uint8Array;
  private managed: Uint8Array;
  /** Spawned since the last update: shown once before it starts aging, so short-lived
   *  particles (tracers, sparks) still reach the screen when dt > life (low fps). */
  private fresh: Uint8Array;
  private free: Int32Array;
  private freeTop = 0;
  // GPU buffers.
  private iPos: THREE.InstancedBufferAttribute;
  private iColor: THREE.InstancedBufferAttribute;
  private iMisc: THREE.InstancedBufferAttribute;
  private iVel: THREE.InstancedBufferAttribute;
  private live = 0;

  constructor(scene: THREE.Scene, capacity: number, readonly additive: boolean, name: string) {
    this.cap = Math.max(16, capacity | 0);
    const n = this.cap;
    const F = (): Float32Array => new Float32Array(n);
    this.px = F(); this.py = F(); this.pz = F();
    this.vx = F(); this.vy = F(); this.vz = F();
    this.age = F(); this.life = F();
    this.s0 = F(); this.s1 = F();
    this.rot = F(); this.spin = F(); this.flip = F();
    this.cr = F(); this.cg = F(); this.cb = F();
    this.a0 = F(); this.a1 = F(); this.fin = F();
    this.drag = F(); this.grav = F(); this.swirl = F();
    this.sprite = F(); this.stretch = F();
    this.holdA = F();
    this.orb = F(); this.ox = F(); this.oz = F();
    this.cr1 = F(); this.cg1 = F(); this.cb1 = F();
    this.alive = new Uint8Array(n);
    this.managed = new Uint8Array(n);
    this.fresh = new Uint8Array(n);
    this.free = new Int32Array(n);
    for (let i = 0; i < n; i++) this.free[i] = n - 1 - i;
    this.freeTop = n;

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iMisc = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iVel = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iColor', this.iColor);
    g.setAttribute('iMisc', this.iMisc);
    g.setAttribute('iVel', this.iVel);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: particleAtlas() },
        uAdditive: { value: additive ? 1 : 0 },
        uGain: { value: 1 },
        fogColor: { value: new THREE.Color() },
        fogDensity: { value: 0 },
        uHalfH: { value: 360 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = `particles.${name}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 30 : 25;
    scene.add(this.mesh);
  }

  get capacity(): number {
    return this.cap;
  }

  get count(): number {
    return this.live;
  }

  /** Spawns a particle; returns its slot or −1 when the pool is full. */
  spawn(p: Particle, managed = false): number {
    if (this.freeTop <= 0) return -1;
    const i = this.free[--this.freeTop];
    this.alive[i] = 1;
    this.managed[i] = managed ? 1 : 0;
    this.fresh[i] = 1;
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.vx[i] = p.vx ?? 0; this.vy[i] = p.vy ?? 0; this.vz[i] = p.vz ?? 0;
    this.age[i] = -Math.max(0, p.delay ?? 0);
    this.life[i] = Math.max(0.001, p.life);
    this.s0[i] = p.size;
    this.s1[i] = p.size1 ?? p.size;
    this.rot[i] = p.rot ?? 0;
    this.spin[i] = p.spin ?? 0;
    this.flip[i] = p.flip ?? 0;
    this.cr[i] = p.r; this.cg[i] = p.g; this.cb[i] = p.b;
    this.a0[i] = p.a ?? 1;
    this.a1[i] = p.a1 ?? 0;
    this.fin[i] = p.fadeIn ?? 0;
    this.drag[i] = p.drag ?? 0;
    this.grav[i] = p.gravity ?? 0;
    this.swirl[i] = p.swirl ?? 0;
    this.sprite[i] = p.sprite ?? 0;
    this.stretch[i] = p.stretch ?? 0;
    this.holdA[i] = p.holdA ?? 1;
    this.orb[i] = p.orbit ?? 0;
    this.ox[i] = p.ox ?? p.x;
    this.oz[i] = p.oz ?? p.z;
    this.cr1[i] = p.r1 ?? p.r;
    this.cg1[i] = p.g1 ?? p.g;
    this.cb1[i] = p.b1 ?? p.b;
    return i;
  }

  kill(i: number): void {
    if (i < 0 || i >= this.cap || !this.alive[i]) return;
    this.alive[i] = 0;
    this.managed[i] = 0;
    this.free[this.freeTop++] = i;
  }

  /** Managed particle accessors (positions/size/alpha driven by the caller). */
  setPos(i: number, x: number, y: number, z: number): void {
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
  }
  setSize(i: number, s: number): void {
    this.s0[i] = s;
    this.s1[i] = s;
  }
  setAlpha(i: number, a: number): void {
    this.a0[i] = a;
    this.a1[i] = a;
  }
  setColor(i: number, r: number, g: number, b: number): void {
    this.cr[i] = r;
    this.cg[i] = g;
    this.cb[i] = b;
    this.cr1[i] = r;
    this.cg1[i] = g;
    this.cb1[i] = b;
  }
  setRot(i: number, r: number): void {
    this.rot[i] = r;
  }

  clear(): void {
    for (let i = 0; i < this.cap; i++) if (this.alive[i]) this.kill(i);
  }

  update(dt: number, fog: THREE.Fog | THREE.FogExp2 | null): void {
    const u = this.mat.uniforms;
    if (fog && (fog as THREE.FogExp2).isFogExp2) {
      (u.fogColor.value as THREE.Color).copy(fog.color);
      u.fogDensity.value = (fog as THREE.FogExp2).density;
    } else u.fogDensity.value = 0;

    const P = this.iPos.array as Float32Array;
    const C = this.iColor.array as Float32Array;
    const M = this.iMisc.array as Float32Array;
    const V = this.iVel.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      const managed = this.managed[i] === 1;
      let t = 0;
      let held = false;
      const fdt = this.fresh[i] ? 0 : dt;
      this.fresh[i] = 0;
      if (!managed) {
        const age0 = this.age[i];
        this.age[i] += fdt;
        if (this.age[i] < 0) {
          // Still holding its place (dissolve silhouettes): no motion yet.
          held = true;
        } else {
          // Only the part of this frame after the release moves the particle.
          const dt = age0 < 0 ? this.age[i] : fdt;
          t = this.age[i] / this.life[i];
          if (t >= 1) {
            this.kill(i);
            continue;
          }
          const d = this.drag[i];
          if (d > 0) {
            const k = Math.exp(-d * dt);
            this.vx[i] *= k;
            this.vy[i] *= k;
            this.vz[i] *= k;
          }
          this.vy[i] -= this.grav[i] * dt;
          const sw = this.swirl[i];
          if (sw !== 0) {
            const ph = this.age[i] * 2.1 + i;
            this.vx[i] += Math.cos(ph) * sw * dt;
            this.vz[i] += Math.sin(ph) * sw * dt;
          }
          this.px[i] += this.vx[i] * dt;
          this.py[i] += this.vy[i] * dt;
          this.pz[i] += this.vz[i] * dt;
          const ob = this.orb[i];
          if (ob !== 0) {
            // Spiral: position and velocity co-rotate about the vertical axis.
            const a = ob * dt;
            const cs = Math.cos(a), sn = Math.sin(a);
            const rx = this.px[i] - this.ox[i], rz = this.pz[i] - this.oz[i];
            this.px[i] = this.ox[i] + rx * cs - rz * sn;
            this.pz[i] = this.oz[i] + rx * sn + rz * cs;
            const vx = this.vx[i], vz = this.vz[i];
            this.vx[i] = vx * cs - vz * sn;
            this.vz[i] = vx * sn + vz * cs;
          }
          this.rot[i] += this.spin[i] * dt;
        }
      }
      const fi = this.fin[i];
      let alpha = this.a0[i] + (this.a1[i] - this.a0[i]) * t;
      if (held) alpha *= this.holdA[i];
      else if (fi > 0 && t < fi) alpha *= t / fi;
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      P[n * 3] = this.px[i];
      P[n * 3 + 1] = this.py[i];
      P[n * 3 + 2] = this.pz[i];
      C[n * 4] = this.cr[i] + (this.cr1[i] - this.cr[i]) * t;
      C[n * 4 + 1] = this.cg[i] + (this.cg1[i] - this.cg[i]) * t;
      C[n * 4 + 2] = this.cb[i] + (this.cb1[i] - this.cb[i]) * t;
      C[n * 4 + 3] = alpha;
      M[n * 4] = size;
      M[n * 4 + 1] = this.rot[i];
      M[n * 4 + 2] = this.sprite[i];
      // Held pieces face the camera; the tumble starts at the release (cos 0 = 1).
      M[n * 4 + 3] = this.flip[i] !== 0 && !held ? Math.cos(this.age[i] * this.flip[i]) : 1;
      V[n * 4] = held ? 0 : this.vx[i];
      V[n * 4 + 1] = held ? 0 : this.vy[i];
      V[n * 4 + 2] = held ? 0 : this.vz[i];
      V[n * 4 + 3] = this.stretch[i];
      n++;
    }
    this.live = n;
    this.geo.instanceCount = n;
    if (n > 0) {
      // (No array literal here: this runs every frame.)
      markRange(this.iPos, n * 3);
      markRange(this.iColor, n * 4);
      markRange(this.iMisc, n * 4);
      markRange(this.iVel, n * 4);
    }
    // Nothing alive → skip the draw entirely (an empty instanced draw still
    // costs a draw call + state changes in three).
    this.mesh.visible = n > 0;
  }

  /**
   * Additive brightness gain. Without the post pipeline (Low) every particle is
   * tone-mapped on its own and the sum clips to white where they overlap, so
   * the effects pass a lower gain there to keep the same perceived brightness.
   */
  setGain(k: number): void {
    this.mat.uniforms.uGain.value = k;
  }

  /**
   * Viewport height in device pixels: streaks (tracers, sparks) are kept at
   * least ~1.2 px wide so distant tracers stay readable instead of vanishing
   * into sub-pixel shimmer.
   */
  setViewportHeight(px: number): void {
    this.mat.uniforms.uHalfH.value = Math.max(1, px) * 0.5;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
