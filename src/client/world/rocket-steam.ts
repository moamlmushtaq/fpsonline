// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — soft, sun-shaded steam / smoke puffs (one InstancedMesh per
// pool, zero allocations per frame): the launch rocket's venting, ignition
// steam ring and climb billows, and standalone emitters for map vents.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { QualitySettings } from '../contracts';
import { PUFF_FRAG, PUFF_VERT } from './rocket-shaders';

// ── Puff pool ───────────────────────────────────────────────────────────────

export class PuffPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly n: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly peak: Float32Array;
  private readonly drag: Float32Array;
  private readonly alpha: THREE.InstancedBufferAttribute;
  private next = 0;
  private live = 0;
  private readonly mtx = new THREE.Matrix4();

  constructor(n: number, material: THREE.ShaderMaterial) {
    this.n = n;
    const g = new THREE.PlaneGeometry(1, 1);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) seed[i] = ((i * 0.61803398875) % 1 + 0.137 * i) % 1;
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aAlpha', this.alpha);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    this.mesh = new THREE.InstancedMesh(g, material, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.name = 'rocket.puffs';
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.peak = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.mtx.makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, this.mtx);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, peak: number, drag: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.peak[i] = peak;
    this.drag[i] = drag;
    this.live = this.n;
  }

  clear(): void {
    for (let i = 0; i < this.n; i++) this.age[i] = this.life[i] = 1;
    this.live = this.n;
  }

  update(dt: number, windX: number, windZ: number): void {
    if (this.live === 0) return;
    let alive = 0;
    const a = this.alpha.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) {
        if (a[i] !== 0) {
          a[i] = 0;
          this.mtx.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(i, this.mtx);
        }
        continue;
      }
      alive++;
      this.age[i] += dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vx[i] = this.vx[i] * k + windX * (1 - k);
      this.vz[i] = this.vz[i] * k + windZ * (1 - k);
      this.vy[i] *= Math.exp(-0.35 * dt);
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      const f = Math.min(1, this.age[i] / this.life[i]);
      const s = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - f) * (1 - f));
      a[i] = this.peak[i] * Math.min(1, f * 6) * (1 - f) * (1 - f * 0.4);
      this.mtx.makeScale(s, s, s);
      this.mtx.setPosition(this.px[i], this.py[i], this.pz[i]);
      this.mesh.setMatrixAt(i, this.mtx);
    }
    this.alpha.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.live = alive;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

/** `fireY`: local height (pad top) below which the engines light the steam. */
export function makePuffMaterial(fogScale: { value: number }, sunW: THREE.Vector3, fireY = 3.6): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uLit: { value: new THREE.Color('#fff4e8') },
        uShade: { value: new THREE.Color('#bca3a6') },
        uSunW: { value: sunW },
        uFire: { value: new THREE.Color(0, 0, 0) },
        uFireY: { value: fireY },
      },
    ]),
    vertexShader: PUFF_VERT,
    fragmentShader: PUFF_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  m.uniforms.uFogScale = fogScale;
  m.uniforms.uSunW.value = sunW;
  return m;
}

/**
 * A standalone pool of soft, sun-shaded steam puffs (the same look as the
 * rocket's). Maps use it for extra exhaust vents (e.g. Gantry's flame trench).
 * Positions are in the parent's space; zero allocations per frame.
 */
export interface SteamEmitter {
  readonly mesh: THREE.InstancedMesh;
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, alpha: number, drag: number): void;
  update(dt: number, windX: number, windZ: number): void;
  clear(): void;
  /** World-space direction toward the sun (defaults to a low sun from +X). */
  readonly sunDir: THREE.Vector3;
  dispose(): void;
}

export function createSteamEmitter(quality: QualitySettings, count = 48): SteamEmitter {
  const sunDir = new THREE.Vector3(0.9, 0.25, -0.3).normalize();
  const mat = makePuffMaterial({ value: 1 }, sunDir);
  const pool = new PuffPool(Math.max(8, Math.round(count * (0.4 + 0.6 * quality.particles))), mat);
  pool.mesh.name = 'steam.puffs';
  return {
    mesh: pool.mesh,
    sunDir,
    emit: (x, y, z, vx, vy, vz, life, s0, s1, alpha, drag) => pool.emit(x, y, z, vx, vy, vz, life, s0, s1, alpha, drag),
    update: (dt, wx, wz) => pool.update(dt, wx, wz),
    clear: () => pool.clear(),
    dispose: () => {
      pool.dispose();
      mat.dispose();
    },
  };
}
