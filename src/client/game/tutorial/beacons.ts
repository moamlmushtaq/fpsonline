// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — tutorial world beacons (three.js).
//
// Small, readable world-space guides in the warm UI amber (never a team
// color): a soft additive light column with a floating ceramic-gold diamond
// (go here), an eye-level ring "sight" (look here) and a flat ground ring
// (stand here). Completed beacons flash chartreuse-green and fade out.
// A pool of a few beacons; geometries/materials are shared and disposed with
// the tutorial. update() animates bob, spin, pulse and the hint wobble.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { UI } from '../../engine/palette';
import type { Vec3 } from '../../../shared/types';

export type BeaconKind = 'column' | 'sight' | 'ring';

export interface BeaconSpec {
  key: string;
  pos: Vec3;
  kind: BeaconKind;
  /** Ground ring radius (ring kind) / column radius. */
  radius?: number;
  /** Column height (column kind). */
  height?: number;
}

const COL_VERT = /* glsl */ `
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  vT = uv.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const COL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float edge = pow(facing, 1.2);
  float fade = pow(1.0 - vT, 1.6) * smoothstep(0.0, 0.04, vT);
  float bands = 0.75 + 0.25 * sin(vT * 26.0 - uTime * 3.0);
  gl_FragColor = vec4(uColor * edge * fade * bands * uAlpha, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
uniform float uFill;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float aa = fwidth(r) * 1.5;
  float ring = 1.0 - smoothstep(0.03, 0.03 + aa, abs(r - 0.9));
  float a = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
  float ticks = step(0.5, fract(a * 24.0)) * (1.0 - smoothstep(0.02, 0.02 + aa, abs(r - 0.78))) * 0.6;
  float arc = step(a, uFill) * (1.0 - smoothstep(0.045, 0.045 + aa, abs(r - 0.9)));
  float pulse = 0.8 + 0.2 * sin(uTime * 4.0);
  float inner = (1.0 - smoothstep(0.0, 0.9, r)) * 0.12 * pulse;
  float v = max(max(ring * pulse, ticks), max(arc * 1.4, inner));
  if (v < 0.01) discard;
  gl_FragColor = vec4(uColor * v * uAlpha * 1.6, v * uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

interface Beacon {
  spec: BeaconSpec;
  group: THREE.Group;
  column: THREE.Mesh;
  diamond: THREE.Mesh;
  ring: THREE.Mesh;
  colMat: THREE.ShaderMaterial;
  ringMat: THREE.ShaderMaterial;
  diaMat: THREE.MeshBasicMaterial;
  /** 0..1 appear; <0 = fading out after done. */
  life: number;
  done: number;
  fill: number;
  phase: number;
}

const ACTIVE = new THREE.Color(UI.accent);
const DONE = new THREE.Color(UI.good);

export class Beacons {
  private readonly root = new THREE.Group();
  private readonly pool: Beacon[] = [];
  private readonly colGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true).translate(0, 0.5, 0);
  private readonly ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private readonly sightGeo = new THREE.PlaneGeometry(2, 2);
  private readonly diaGeo = new THREE.OctahedronGeometry(0.2, 0).scale(1, 1.5, 1);
  private time = 0;
  /** Hint wobble amount 0..1 (stuck > 12 s). */
  hint = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'tutorial.beacons';
    scene.add(this.root);
  }

  private make(): Beacon {
    const colMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: ACTIVE.clone() }, uAlpha: { value: 0 }, uTime: { value: 0 } },
      vertexShader: COL_VERT,
      fragmentShader: COL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const ringMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: ACTIVE.clone() }, uAlpha: { value: 0 }, uTime: { value: 0 }, uFill: { value: 0 } },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const diaMat = new THREE.MeshBasicMaterial({ color: ACTIVE.clone().multiplyScalar(2.2), transparent: true, opacity: 0, depthWrite: false });
    const group = new THREE.Group();
    const column = new THREE.Mesh(this.colGeo, colMat);
    column.renderOrder = 8;
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.renderOrder = 9;
    const diamond = new THREE.Mesh(this.diaGeo, diaMat);
    diamond.renderOrder = 9;
    group.add(column, ring, diamond);
    group.visible = false;
    this.root.add(group);
    const b: Beacon = { spec: { key: '', pos: { x: 0, y: 0, z: 0 }, kind: 'column' }, group, column, diamond, ring, colMat, ringMat, diaMat, life: 0, done: 0, fill: 0, phase: Math.random() * 6 };
    this.pool.push(b);
    return b;
  }

  /** Shows exactly these beacons (others fade out). Keys keep beacons stable across calls. */
  set(specs: readonly BeaconSpec[]): void {
    const keep = new Set(specs.map((s) => s.key));
    for (const b of this.pool) if (b.spec.key && !keep.has(b.spec.key) && b.life > 0 && b.done === 0) b.life = -Math.abs(b.life);
    for (const s of specs) {
      let b = this.pool.find((x) => x.spec.key === s.key && x.group.visible);
      if (!b) {
        b = this.pool.find((x) => !x.group.visible) ?? this.make();
        b.life = 0.001;
        b.done = 0;
        b.fill = 0;
      }
      b.spec = { ...s, pos: { ...s.pos } };
      this.layout(b);
      b.group.visible = true;
    }
  }

  /** Moves a beacon (e.g. following a strafing target). */
  move(key: string, pos: Vec3): void {
    const b = this.pool.find((x) => x.spec.key === key && x.group.visible);
    if (!b) return;
    b.spec.pos.x = pos.x;
    b.spec.pos.y = pos.y;
    b.spec.pos.z = pos.z;
    b.group.position.set(pos.x, pos.y, pos.z);
  }

  /** Ring fill 0..1 (capture progress / look dwell). */
  setFill(key: string, k: number): void {
    const b = this.pool.find((x) => x.spec.key === key && x.group.visible);
    if (b) b.fill = Math.max(0, Math.min(1, k));
  }

  /** Completion flash: green, then fade. */
  complete(key: string): void {
    const b = this.pool.find((x) => x.spec.key === key && x.group.visible);
    if (b && b.done === 0) b.done = 0.001;
  }

  clear(): void {
    for (const b of this.pool) if (b.group.visible && b.done === 0) b.life = -Math.abs(b.life || 1);
  }

  private layout(b: Beacon): void {
    const s = b.spec;
    b.group.position.set(s.pos.x, s.pos.y, s.pos.z);
    const r = s.radius ?? (s.kind === 'ring' ? 1.6 : 0.55);
    b.column.visible = s.kind === 'column';
    b.diamond.visible = s.kind !== 'ring';
    b.ring.geometry = s.kind === 'sight' ? this.sightGeo : this.ringGeo;
    if (s.kind === 'column') {
      const h = s.height ?? 3.2;
      b.column.scale.set(r, h, r);
      b.ring.scale.setScalar(r * 1.25);
      b.ring.position.y = 0.04;
      b.diamond.position.y = h * 0.62;
    } else if (s.kind === 'sight') {
      b.ring.scale.setScalar(0.8);
      b.ring.position.y = 0;
      b.diamond.position.y = 0;
      b.diamond.scale.setScalar(0.7);
    } else {
      b.ring.scale.setScalar(r);
      b.ring.position.y = 0.05;
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    for (const b of this.pool) {
      if (!b.group.visible) continue;
      if (b.done > 0) {
        b.done += dt;
        if (b.done > 0.9) {
          b.group.visible = false;
          b.spec.key = '';
          continue;
        }
      } else if (b.life > 0) b.life = Math.min(1, b.life + dt * 3);
      else {
        b.life = Math.min(0, b.life + dt * 3);
        if (b.life >= 0) {
          b.group.visible = false;
          b.spec.key = '';
          continue;
        }
      }
      let appear = b.done > 0 ? Math.max(0, 1 - (b.done - 0.25) / 0.65) : Math.abs(b.life);
      // Fade world-filling pieces when the camera is inside / right next to them.
      const dx = camera.position.x - b.spec.pos.x;
      const dz = camera.position.z - b.spec.pos.z;
      const near = Math.hypot(dx, dz);
      const rr = b.spec.radius ?? 0.6;
      const prox = b.spec.kind === 'sight' ? 1 : Math.min(1, Math.max(0, (near - rr * 0.9) / (rr * 1.6 + 1)));
      appear *= b.spec.kind === 'ring' ? 0.35 + 0.65 * prox : prox;
      const doneMix = b.done > 0 ? Math.min(1, b.done * 6) : 0;
      const pulse = 1 + this.hint * 0.35 * Math.sin(this.time * 7);
      const c = (b.colMat.uniforms.uColor.value as THREE.Color).copy(ACTIVE).lerp(DONE, doneMix);
      (b.ringMat.uniforms.uColor.value as THREE.Color).copy(c);
      b.diaMat.color.copy(c).multiplyScalar(2.2);
      b.colMat.uniforms.uAlpha.value = appear * 0.15 * pulse;
      b.colMat.uniforms.uTime.value = this.time;
      b.ringMat.uniforms.uAlpha.value = appear * pulse;
      b.ringMat.uniforms.uTime.value = this.time + b.phase;
      b.ringMat.uniforms.uFill.value = b.done > 0 ? 1 : b.fill;
      b.diaMat.opacity = appear;
      const bob = Math.sin(this.time * 2 + b.phase) * 0.08;
      if (b.spec.kind === 'column') {
        b.diamond.position.y = (b.spec.height ?? 3.2) * 0.62 + bob + b.done * 1.2;
        b.diamond.rotation.y += dt * (1.4 + this.hint * 3);
      } else if (b.spec.kind === 'sight') {
        // Face the camera; spin the diamond inside the ring.
        b.ring.quaternion.copy(camera.quaternion);
        b.diamond.rotation.y += dt * 2;
        const s = 0.8 * (1 + b.done * 0.8) * pulse;
        b.ring.scale.setScalar(s);
      }
    }
  }

  /** Any visible beacon (for the off-screen arrow): the first active spec. */
  primary(): BeaconSpec | null {
    for (const b of this.pool) if (b.group.visible && b.done === 0 && b.life > 0) return b.spec;
    return null;
  }

  dispose(): void {
    for (const b of this.pool) {
      b.colMat.dispose();
      b.ringMat.dispose();
      b.diaMat.dispose();
    }
    this.colGeo.dispose();
    this.ringGeo.dispose();
    this.sightGeo.dispose();
    this.diaGeo.dispose();
    this.root.removeFromParent();
    this.scene.remove(this.root);
  }
}
