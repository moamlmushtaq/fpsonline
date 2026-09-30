// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — GPU-friendly particle pools.
//
// One pool = ONE instanced draw call: a unit quad instanced N times, all
// per-particle data in preallocated typed arrays (no allocation per frame).
// Billboarding, rotation, velocity stretching (tracers / sparks) and a fake
// 3D tumble ("flip", for shards and petals) happen in the vertex shader; a
// 4×4 procedural sprite atlas provides the shapes. Fog fades particles into
// the haze (additive → toward black, alpha → toward the fog color).
//
// Slots are fixed (free-list), so effects can hold "managed" particles (smoke
// puffs, beam sparkles) and move them every frame through `set*` accessors.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { makeCanvas } from './textures';

/** Atlas cells (4×4). */
export const SPRITE = {
  glow: 0,
  starburst: 1,
  streak: 2,
  petal: 3,
  shard: 4,
  ring: 5,
  smoke: 6,
  leaf: 7,
  paper: 8,
  star: 9,
  prism: 10,
  dust: 11,
  ember: 12,
  flare: 13,
  droplet: 14,
  chunk: 15,
} as const;

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
}

const VERT = /* glsl */ `
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
    off = dir * c.y * len + vec2(-dir.y, dir.x) * c.x * size;
  } else {
    float cs = cos(rot), sn = sin(rot);
    vec2 q = vec2(c.x * iMisc.w, c.y);
    off = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs) * size;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  float col = mod(sprite, 4.0);
  float row = floor(sprite / 4.0);
  vUv = (vec2(col, 3.0 - row) + (c + 0.5)) * 0.25;
  vColor = iColor;
  vFogDepth = -mv.z;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float uAdditive;
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
    gl_FragColor = vec4(col * a * (1.0 - fogF), 1.0);
  } else {
    gl_FragColor = vec4(mix(col, fogColor, fogF), a);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

let atlasTex: THREE.Texture | null = null;
let glowTex: THREE.Texture | null = null;

/** Small soft radial glow texture (sprites, blinking lights). */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = makeCanvas(64, 64);
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** The shared 512² procedural sprite atlas (white shapes; tinted per particle). */
export function particleAtlas(): THREE.Texture {
  if (atlasTex) return atlasTex;
  const S = 512;
  const C = 128;
  const cv = makeCanvas(S, S);
  const x = cv.getContext('2d') as CanvasRenderingContext2D;
  x.clearRect(0, 0, S, S);
  const cell = (i: number, draw: (cx: number, cy: number, r: number) => void): void => {
    const cx = (i % 4) * C + C / 2;
    const cy = Math.floor(i / 4) * C + C / 2;
    x.save();
    x.beginPath();
    x.rect(cx - C / 2, cy - C / 2, C, C);
    x.clip();
    draw(cx, cy, C / 2 - 2);
    x.restore();
  };
  const radial = (cx: number, cy: number, r: number, stops: [number, number][]): void => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
    x.fillStyle = g;
    x.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  let seed = 7;
  const rnd = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // 0 glow
  cell(0, (cx, cy, r) => radial(cx, cy, r, [[0, 1], [0.2, 0.7], [0.5, 0.2], [1, 0]]));
  // 1 starburst: 8 tapered spikes + hot core.
  cell(1, (cx, cy, r) => {
    x.fillStyle = '#fff';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + (i % 2) * 0.12;
      const len = r * (i % 2 ? 0.62 : 0.98);
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      x.lineTo(cx + Math.cos(a + 0.16) * r * 0.16, cy + Math.sin(a + 0.16) * r * 0.16);
      x.lineTo(cx + Math.cos(a - 0.16) * r * 0.16, cy + Math.sin(a - 0.16) * r * 0.16);
      x.closePath();
      x.fill();
    }
    radial(cx, cy, r * 0.55, [[0, 1], [0.5, 0.8], [1, 0]]);
  });
  // 2 streak (vertical): bright line with soft falloff.
  cell(2, (cx, cy, r) => {
    const g = x.createLinearGradient(cx - r * 0.18, 0, cx + r * 0.18, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    x.ellipse(cx, cy, r * 0.18, r, 0, 0, Math.PI * 2);
    x.fill();
  });
  // 3 petal (soft teardrop).
  cell(3, (cx, cy, r) => {
    const g = x.createRadialGradient(cx, cy + r * 0.2, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(cx, cy - r * 0.95);
    x.bezierCurveTo(cx + r * 0.75, cy - r * 0.2, cx + r * 0.5, cy + r * 0.8, cx, cy + r * 0.9);
    x.bezierCurveTo(cx - r * 0.5, cy + r * 0.8, cx - r * 0.75, cy - r * 0.2, cx, cy - r * 0.95);
    x.fill();
  });
  // 4 shard: crisp angular ceramic fragment with a lighter facet.
  cell(4, (cx, cy, r) => {
    x.fillStyle = 'rgba(255,255,255,1)';
    x.beginPath();
    x.moveTo(cx - r * 0.7, cy + r * 0.6);
    x.lineTo(cx + r * 0.1, cy - r * 0.9);
    x.lineTo(cx + r * 0.8, cy + r * 0.3);
    x.lineTo(cx + r * 0.1, cy + r * 0.8);
    x.closePath();
    x.fill();
    x.fillStyle = 'rgba(200,196,188,1)';
    x.beginPath();
    x.moveTo(cx + r * 0.1, cy - r * 0.9);
    x.lineTo(cx + r * 0.8, cy + r * 0.3);
    x.lineTo(cx + r * 0.1, cy + r * 0.8);
    x.closePath();
    x.fill();
  });
  // 5 ring.
  cell(5, (cx, cy, r) => {
    x.strokeStyle = 'rgba(255,255,255,1)';
    x.lineWidth = r * 0.12;
    x.shadowColor = '#fff';
    x.shadowBlur = r * 0.15;
    x.beginPath();
    x.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    x.stroke();
  });
  // 6 smoke puff: clustered soft blobs.
  cell(6, (cx, cy, r) => {
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * r * 0.4;
      radial(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.35 + rnd() * 0.25), [[0, 0.35], [1, 0]]);
    }
  });
  // 7 leaf with a vein.
  cell(7, (cx, cy, r) => {
    x.fillStyle = 'rgba(255,255,255,1)';
    x.beginPath();
    x.moveTo(cx, cy - r * 0.9);
    x.quadraticCurveTo(cx + r * 0.7, cy, cx, cy + r * 0.9);
    x.quadraticCurveTo(cx - r * 0.7, cy, cx, cy - r * 0.9);
    x.fill();
    x.strokeStyle = 'rgba(170,170,170,1)';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(cx, cy - r * 0.8);
    x.lineTo(cx, cy + r * 0.85);
    x.stroke();
  });
  // 8 paper (folded triangle, two tones).
  cell(8, (cx, cy, r) => {
    x.fillStyle = 'rgba(255,255,255,1)';
    x.beginPath();
    x.moveTo(cx - r * 0.8, cy - r * 0.7);
    x.lineTo(cx + r * 0.8, cy - r * 0.5);
    x.lineTo(cx, cy + r * 0.85);
    x.closePath();
    x.fill();
    x.fillStyle = 'rgba(215,212,205,1)';
    x.beginPath();
    x.moveTo(cx + r * 0.8, cy - r * 0.5);
    x.lineTo(cx, cy + r * 0.85);
    x.lineTo(cx + r * 0.05, cy - r * 0.6);
    x.closePath();
    x.fill();
  });
  // 9 four-point star.
  cell(9, (cx, cy, r) => {
    x.fillStyle = '#fff';
    x.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.18 : r * 0.95;
      x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.closePath();
    x.fill();
    radial(cx, cy, r * 0.5, [[0, 0.9], [1, 0]]);
  });
  // 10 prism (hexagonal crystal with facets).
  cell(10, (cx, cy, r) => {
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2;
      const a1 = ((i + 1) / 6) * Math.PI * 2;
      x.fillStyle = `rgba(255,255,255,${0.55 + (i % 3) * 0.2})`;
      x.beginPath();
      x.moveTo(cx, cy);
      x.lineTo(cx + Math.cos(a0) * r * 0.85, cy + Math.sin(a0) * r * 0.85);
      x.lineTo(cx + Math.cos(a1) * r * 0.85, cy + Math.sin(a1) * r * 0.85);
      x.closePath();
      x.fill();
    }
  });
  // 11 dust puff (soft, grainy).
  cell(11, (cx, cy, r) => {
    radial(cx, cy, r, [[0, 0.8], [0.6, 0.35], [1, 0]]);
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * r * 0.8;
      x.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.3})`;
      x.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 3, 3);
    }
  });
  // 12 ember.
  cell(12, (cx, cy, r) => radial(cx, cy, r * 0.6, [[0, 1], [0.3, 0.9], [1, 0]]));
  // 13 flare cross (for impact / spawn glints).
  cell(13, (cx, cy, r) => {
    radial(cx, cy, r * 0.4, [[0, 1], [1, 0]]);
    for (const [w, h] of [[r * 0.07, r], [r, r * 0.07]]) {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath();
      x.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2);
      x.fill();
    }
  });
  // 14 droplet.
  cell(14, (cx, cy, r) => {
    x.fillStyle = 'rgba(255,255,255,0.9)';
    x.beginPath();
    x.moveTo(cx, cy - r * 0.8);
    x.quadraticCurveTo(cx + r * 0.5, cy + r * 0.2, cx, cy + r * 0.6);
    x.quadraticCurveTo(cx - r * 0.5, cy + r * 0.2, cx, cy - r * 0.8);
    x.fill();
  });
  // 15 debris chunk (irregular polygon).
  cell(15, (cx, cy, r) => {
    x.fillStyle = 'rgba(255,255,255,1)';
    x.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rnd() * 0.5;
      const rr = r * (0.45 + rnd() * 0.4);
      x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.closePath();
    x.fill();
  });
  atlasTex = new THREE.CanvasTexture(cv);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.generateMipmaps = true;
  return atlasTex;
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
  private alive: Uint8Array;
  private managed: Uint8Array;
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
    this.alive = new Uint8Array(n);
    this.managed = new Uint8Array(n);
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
        fogColor: { value: new THREE.Color() },
        fogDensity: { value: 0 },
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
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.vx[i] = p.vx ?? 0; this.vy[i] = p.vy ?? 0; this.vz[i] = p.vz ?? 0;
    this.age[i] = 0;
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
      if (!managed) {
        this.age[i] += dt;
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
        this.rot[i] += this.spin[i] * dt;
      }
      const fi = this.fin[i];
      let alpha = this.a0[i] + (this.a1[i] - this.a0[i]) * t;
      if (fi > 0 && t < fi) alpha *= t / fi;
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      P[n * 3] = this.px[i];
      P[n * 3 + 1] = this.py[i];
      P[n * 3 + 2] = this.pz[i];
      C[n * 4] = this.cr[i];
      C[n * 4 + 1] = this.cg[i];
      C[n * 4 + 2] = this.cb[i];
      C[n * 4 + 3] = alpha;
      M[n * 4] = size;
      M[n * 4 + 1] = this.rot[i];
      M[n * 4 + 2] = this.sprite[i];
      M[n * 4 + 3] = this.flip[i] !== 0 ? Math.cos(this.age[i] * this.flip[i] + i) : 1;
      V[n * 4] = this.vx[i];
      V[n * 4 + 1] = this.vy[i];
      V[n * 4 + 2] = this.vz[i];
      V[n * 4 + 3] = this.stretch[i];
      n++;
    }
    this.live = n;
    this.geo.instanceCount = n;
    if (n > 0) {
      for (const [attr, w] of [[this.iPos, 3], [this.iColor, 4], [this.iMisc, 4], [this.iVel, 4]] as const) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n * w);
        attr.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
