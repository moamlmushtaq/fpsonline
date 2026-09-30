// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — gameplay effects (stylized, no gore).
//
// Two particle pools (additive + alpha, one draw call each) carry sparks,
// tracers, dust, petals, shards, embers, smoke puffs… plus a few pooled
// meshes: crossed-card starburst muzzle flashes, camera-facing Sunspear beam
// ribbons with afterglow, and throwable projectiles with blinking lights.
// Budgets scale with quality.particles; a single pooled point light adds
// muzzle/explosion light on the high preset only.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { Effects, QualitySettings } from '../contracts';
import type { Faction, SurfaceTag, Team, ThrowableId, Vec3, WeaponId } from '../../shared/types';
import { findElimFx } from '../../shared/cosmetics';
import { DANGER_COLOR, ENV, PICKUP_COLOR, teamColors } from './palette';
import { glowTexture, ParticlePool, particleAtlas, SPRITE } from './particles';

const rnd = Math.random;
const rr = (a: number, b: number): number => a + (b - a) * rnd();

const SURFACE_DUST: Partial<Record<SurfaceTag, string>> = {
  concrete: ENV.concrete,
  sand: ENV.sand,
  dirt: '#b59d82',
  rock: ENV.rock,
  snow: ENV.snow,
  plaster: ENV.sandLight,
  wood: '#b39a7f',
  grass: ENV.sage,
  fabric: ENV.boneShade,
  tile: ENV.bone,
  foliage: ENV.olive,
};

const MUZZLE: Record<WeaponId, { size: number; len: number; color: string }> = {
  meridian: { size: 0.34, len: 0.55, color: '#ffe2b0' },
  swift: { size: 0.26, len: 0.4, color: '#ffe6bb' },
  longline: { size: 0.5, len: 0.9, color: '#ffdca0' },
  breaker: { size: 0.6, len: 0.8, color: '#ffd29a' },
  pulse: { size: 0.24, len: 0.32, color: '#ffe9c4' },
  sunspear: { size: 0.7, len: 0.6, color: PICKUP_COLOR },
};

const TRACER: Record<'bullet' | 'heavy' | 'pellet', { speed: number; width: number; len: number; k: number }> = {
  bullet: { speed: 380, width: 0.022, len: 3.4, k: 2.6 },
  heavy: { speed: 520, width: 0.045, len: 6.5, k: 3.4 },
  pellet: { speed: 300, width: 0.018, len: 1.3, k: 2.2 },
};

const TRACER_OF: Record<WeaponId, 'bullet' | 'heavy' | 'pellet'> = {
  meridian: 'bullet',
  swift: 'bullet',
  longline: 'heavy',
  breaker: 'pellet',
  pulse: 'bullet',
  sunspear: 'heavy',
};

const _tc = new THREE.Color();

function col(hex: string, k = 1): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}

// ── Muzzle flash cards ──────────────────────────────────────────────────────

/** Front starburst card + two crossed side flame cards, UV-mapped into the atlas. */
function flashGeometry(): THREE.BufferGeometry {
  const cellUV = (cell: number, u: number, v: number): [number, number] => {
    const c = cell % 4;
    const r = Math.floor(cell / 4);
    return [(c + u) * 0.25, (3 - r + v) * 0.25];
  };
  const pos: number[] = [];
  const uv: number[] = [];
  const quad = (p: THREE.Vector3[], cell: number, uvs: [number, number][]): void => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(p[i].x, p[i].y, p[i].z);
      uv.push(...cellUV(cell, uvs[i][0], uvs[i][1]));
    }
  };
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  // Front card (faces −Z = along the shot).
  quad([V(-0.5, -0.5, 0), V(0.5, -0.5, 0), V(0.5, 0.5, 0), V(-0.5, 0.5, 0)], SPRITE.starburst, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  // Side cards along −Z (length 1), streak cell's long axis mapped along Z.
  const sideUV: [number, number][] = [[0.2, 0], [0.8, 0], [0.8, 1], [0.2, 1]];
  quad([V(-0.25, 0, 0.1), V(0.25, 0, 0.1), V(0.25, 0, -1), V(-0.25, 0, -1)], SPRITE.streak, sideUV);
  quad([V(0, -0.25, 0.1), V(0, 0.25, 0.1), V(0, 0.25, -1), V(0, -0.25, -1)], SPRITE.streak, sideUV);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

interface Flash {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
}

// ── Sunspear beam ribbon ────────────────────────────────────────────────────

const BEAM_VERT = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform float uWidth;
varying vec2 vUv;
varying float vFogDepth;
void main() {
  vec3 p = mix(uA, uB, position.y + 0.5);
  vec3 axis = normalize(uB - uA);
  vec3 side = normalize(cross(axis, p - cameraPosition));
  p += side * position.x * uWidth;
  vUv = vec2(position.x * 2.0, position.y + 0.5);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uGlow;
uniform float uCoreK;
uniform float uGlowK;
uniform float uTime;
uniform float fogDensity;
varying vec2 vUv;
varying float vFogDepth;
void main() {
  float x = abs(vUv.x);
  float core = pow(max(0.0, 1.0 - x * 3.2), 2.0) * uCoreK;
  float glow = pow(max(0.0, 1.0 - x), 2.4) * uGlowK;
  float ripple = 0.85 + 0.15 * sin(vUv.y * 90.0 - uTime * 40.0);
  float fogF = exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  vec3 c = (uCore * core + uGlow * glow * ripple) * fogF;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface Beam {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  t: number;
  active: boolean;
}

// ── Smoke / projectiles ─────────────────────────────────────────────────────

interface SmokeVolume {
  id: number;
  puffs: { slot: number; ox: number; oy: number; oz: number; ph: number; s: number }[];
  center: THREE.Vector3;
  radius: number;
  remaining: number;
  age: number;
  ending: number;
}

interface Projectile {
  id: number;
  kind: ThrowableId;
  group: THREE.Group;
  light: THREE.Sprite;
  lightMat: THREE.SpriteMaterial;
  last: THREE.Vector3;
  t: number;
  seen: boolean;
}

export class EffectsSystem implements Effects {
  private readonly add: ParticlePool;
  private readonly alpha: ParticlePool;
  private readonly flashes: Flash[] = [];
  private flashIdx = 0;
  private readonly flashGeo = flashGeometry();
  private readonly beams: Beam[] = [];
  private readonly beamGeo = new THREE.PlaneGeometry(1, 1, 1, 8);
  private readonly smokes = new Map<number, SmokeVolume>();
  private readonly projectiles = new Map<number, Projectile>();
  private readonly projGeo: Record<ThrowableId, THREE.BufferGeometry[]>;
  private readonly projMat: THREE.Material[];
  private light: THREE.PointLight | null = null;
  private lightT = 0;
  private lightK = 0;
  private q: QualitySettings;
  private time = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly qTmp = new THREE.Quaternion();

  constructor(private readonly scene: THREE.Scene, quality: QualitySettings) {
    this.q = quality;
    this.add = new ParticlePool(scene, Math.round(1800 * Math.max(0.35, quality.particles)), true, 'additive');
    this.alpha = new ParticlePool(scene, Math.round(1100 * Math.max(0.35, quality.particles)), false, 'alpha');
    const atlas = particleAtlas();
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: atlas, color: col('#ffe2b0', 3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.flashGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 40;
      scene.add(mesh);
      this.flashes.push({ mesh, mat, t: 0 });
    }
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uA: { value: new THREE.Vector3() },
          uB: { value: new THREE.Vector3() },
          uWidth: { value: 0.5 },
          uCore: { value: col('#fff6dc', 6) },
          uGlow: { value: col(PICKUP_COLOR, 2.2) },
          uCoreK: { value: 0 },
          uGlowK: { value: 0 },
          uTime: { value: 0 },
          fogDensity: { value: 0 },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.beamGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 35;
      scene.add(mesh);
      this.beams.push({ mesh, mat, t: 0, active: false });
    }
    this.projGeo = {
      smoke: [new THREE.CylinderGeometry(0.045, 0.045, 0.16, 14), new THREE.CylinderGeometry(0.047, 0.047, 0.04, 14)],
      grenade: [new THREE.SphereGeometry(0.06, 14, 10), new THREE.TorusGeometry(0.06, 0.01, 6, 18).rotateX(Math.PI / 2)],
    };
    this.projMat = [
      new THREE.MeshStandardMaterial({ color: col(ENV.bone), roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: col(ENV.terracottaFaded), roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: col(ENV.metalDark), roughness: 0.35, metalness: 0.5 }),
      new THREE.MeshBasicMaterial({ color: col(DANGER_COLOR, 2) }),
    ];
    this.setQuality(quality);
  }

  private get k(): number {
    return Math.max(0.25, this.q.particles);
  }

  private n(base: number): number {
    return Math.max(1, Math.round(base * this.k));
  }

  setQuality(q: QualitySettings): void {
    this.q = q;
    if (q.preset === 'high' && !this.light) {
      this.light = new THREE.PointLight('#ffcf94', 0, 9, 2);
      this.light.name = 'fx.light';
      this.scene.add(this.light);
    }
  }

  private pulseLight(pos: THREE.Vector3, color: string, k: number, dur: number): void {
    if (!this.light) return;
    this.light.position.copy(pos);
    this.light.color.set(color);
    this.lightK = k;
    this.lightT = dur;
  }

  // ── Weapons ──────────────────────────────────────────────────────────────

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, weapon: WeaponId, firstPerson: boolean): void {
    const f = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % this.flashes.length;
    const spec = MUZZLE[weapon] ?? MUZZLE.meridian;
    const s = spec.size * (firstPerson ? 0.55 : 1) * rr(0.85, 1.15);
    f.mesh.position.copy(pos);
    this.tmp.copy(dir).normalize();
    this.qTmp.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.tmp);
    f.mesh.quaternion.copy(this.qTmp);
    f.mesh.rotateZ(rnd() * Math.PI);
    f.mesh.scale.set(s, s, spec.len * (firstPerson ? 0.55 : 1) * rr(0.8, 1.2));
    f.mat.color.copy(col(spec.color, weapon === 'sunspear' ? 4 : 3.2));
    f.mat.opacity = 1;
    f.mesh.visible = true;
    f.t = weapon === 'breaker' || weapon === 'longline' ? 0.05 : 0.034;
    // Hot glow + a couple of sparks.
    this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 0.07, size: s * 1.4, size1: s * 1.9, r: 1, g: 0.78, b: 0.5, a: 0.6, sprite: SPRITE.glow });
    if (!firstPerson || rnd() < 0.5) {
      for (let i = 0; i < 2; i++) {
        this.add.spawn({
          x: pos.x, y: pos.y, z: pos.z,
          vx: dir.x * rr(4, 9) + rr(-1.5, 1.5), vy: dir.y * rr(4, 9) + rr(-0.5, 1.5), vz: dir.z * rr(4, 9) + rr(-1.5, 1.5),
          life: rr(0.08, 0.16), size: 0.012, r: 3, g: 2.2, b: 1.2, a: 1, gravity: 6, drag: 2, sprite: SPRITE.streak, stretch: 0.02,
        });
      }
    }
    this.pulseLight(pos, spec.color, weapon === 'breaker' ? 5 : 3, 0.06);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, weapon: WeaponId, team: Team): void {
    const kind = TRACER_OF[weapon] ?? 'bullet';
    const t = TRACER[kind];
    const d = this.tmp.subVectors(to, from);
    const dist = d.length();
    if (dist < 0.5) return;
    d.divideScalar(dist);
    // Warm-white core with just a hint of the team color.
    const tc = _tc.set(teamColors(team).primary);
    const r = (1 * 0.9 + tc.r * 0.1) * t.k;
    const g = (0.9 * 0.9 + tc.g * 0.1) * t.k;
    const b = (0.72 * 0.9 + tc.b * 0.1) * t.k;
    const start = Math.min(dist * 0.5, t.len * 0.5);
    this.add.spawn({
      x: from.x + d.x * start, y: from.y + d.y * start, z: from.z + d.z * start,
      vx: d.x * t.speed, vy: d.y * t.speed, vz: d.z * t.speed,
      life: Math.max(0.018, (dist - start - t.len * 0.5) / t.speed),
      size: t.width, r, g, b, a: 1, a1: 0.8, sprite: SPRITE.streak, stretch: t.len / t.speed,
    });
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceTag | 'player' | 'shield'): void {
    const n = normal.lengthSq() > 1e-6 ? this.tmp2.copy(normal).normalize() : this.tmp2.set(0, 1, 0);
    const p = pos;
    const cone = (speed: number, spread: number): [number, number, number] => {
      const x = n.x + rr(-spread, spread);
      const y = n.y + rr(-spread, spread);
      const z = n.z + rr(-spread, spread);
      const l = Math.hypot(x, y, z) || 1;
      return [(x / l) * speed, (y / l) * speed, (z / l) * speed];
    };
    if (surface === 'player' || surface === 'shield') {
      const shield = surface === 'shield';
      this.add.spawn({ x: p.x, y: p.y, z: p.z, life: 0.12, size: shield ? 0.5 : 0.28, size1: shield ? 0.9 : 0.5, r: 2.4, g: 2.3, b: 2.1, a: 1, sprite: shield ? SPRITE.ring : SPRITE.flare, rot: rnd() * 3 });
      for (let i = 0; i < this.n(4); i++) {
        const v = cone(rr(2, 5), 0.9);
        this.add.spawn({ x: p.x, y: p.y, z: p.z, vx: v[0], vy: v[1], vz: v[2], life: rr(0.1, 0.2), size: 0.02, r: 2.4, g: 2.3, b: 2.0, drag: 4, sprite: SPRITE.streak, stretch: 0.02 });
      }
      return;
    }
    if (surface === 'metal' || surface === 'ceramic' || surface === 'glass' || surface === 'tile') {
      this.add.spawn({ x: p.x + n.x * 0.02, y: p.y + n.y * 0.02, z: p.z + n.z * 0.02, life: 0.07, size: 0.22, size1: 0.35, r: 2.6, g: 1.9, b: 1.1, sprite: SPRITE.flare, rot: rnd() * 3 });
      for (let i = 0; i < this.n(surface === 'glass' ? 6 : 11); i++) {
        const v = cone(rr(3, 9), 0.75);
        this.add.spawn({ x: p.x, y: p.y, z: p.z, vx: v[0], vy: v[1], vz: v[2], life: rr(0.15, 0.4), size: rr(0.012, 0.022), r: 3, g: 2.1, b: 1.1, gravity: 9, drag: 1.5, sprite: SPRITE.streak, stretch: 0.018 });
      }
      if (surface === 'glass' || surface === 'ceramic') {
        for (let i = 0; i < this.n(4); i++) {
          const v = cone(rr(1.5, 4), 0.8);
          this.alpha.spawn({ x: p.x, y: p.y, z: p.z, vx: v[0], vy: v[1], vz: v[2], life: rr(0.4, 0.7), size: rr(0.03, 0.05), r: 0.95, g: 0.95, b: 0.93, a: 1, a1: 0.4, gravity: 9, sprite: SPRITE.shard, spin: rr(-8, 8), flip: rr(8, 16) });
        }
      }
      this.alpha.spawn({ x: p.x + n.x * 0.05, y: p.y + n.y * 0.05, z: p.z + n.z * 0.05, vx: n.x * 0.4, vy: n.y * 0.4 + 0.2, vz: n.z * 0.4, life: 0.5, size: 0.12, size1: 0.35, r: 0.45, g: 0.43, b: 0.42, a: 0.35, drag: 2, sprite: SPRITE.dust, rot: rnd() * 6 });
      return;
    }
    if (surface === 'water') {
      for (let i = 0; i < this.n(10); i++) {
        const v: [number, number, number] = [rr(-1.2, 1.2), rr(2.5, 5), rr(-1.2, 1.2)];
        this.alpha.spawn({ x: p.x, y: p.y, z: p.z, vx: v[0], vy: v[1], vz: v[2], life: rr(0.35, 0.6), size: rr(0.04, 0.07), r: 0.85, g: 0.93, b: 0.98, a: 0.9, gravity: 14, sprite: SPRITE.droplet, stretch: 0.012 });
      }
      this.alpha.spawn({ x: p.x, y: p.y + 0.02, z: p.z, life: 0.45, size: 0.15, size1: 0.9, r: 0.9, g: 0.96, b: 1, a: 0.6, sprite: SPRITE.ring });
      return;
    }
    if (surface === 'foliage') {
      for (let i = 0; i < this.n(6); i++) {
        const v = cone(rr(0.8, 2.2), 1);
        const c = new THREE.Color(rnd() < 0.5 ? ENV.olive : ENV.sage);
        this.alpha.spawn({ x: p.x, y: p.y, z: p.z, vx: v[0], vy: v[1] + 0.8, vz: v[2], life: rr(0.9, 1.6), size: rr(0.05, 0.09), r: c.r, g: c.g, b: c.b, a: 1, a1: 0, gravity: 1.2, drag: 2.2, swirl: 1.5, sprite: SPRITE.leaf, spin: rr(-4, 4), flip: rr(5, 10) });
      }
      const g = new THREE.Color(ENV.glowChartreuse);
      for (let i = 0; i < this.n(3); i++) this.add.spawn({ x: p.x, y: p.y, z: p.z, vx: rr(-0.4, 0.4), vy: rr(0.2, 0.7), vz: rr(-0.4, 0.4), life: rr(0.8, 1.4), size: 0.035, r: g.r * 2, g: g.g * 2, b: g.b * 2, a: 1, swirl: 1, sprite: SPRITE.ember });
      return;
    }
    // Stone / earth / wood / snow: dust puffs + a few chunks.
    const hex = SURFACE_DUST[surface] ?? ENV.concrete;
    const c = new THREE.Color(hex);
    const snow = surface === 'snow';
    for (let i = 0; i < this.n(snow ? 7 : 5); i++) {
      const v = cone(rr(0.8, 2.6), 0.5);
      this.alpha.spawn({
        x: p.x + n.x * 0.05, y: p.y + n.y * 0.05, z: p.z + n.z * 0.05, vx: v[0], vy: v[1] + 0.3, vz: v[2],
        life: rr(0.5, 0.9), size: rr(0.08, 0.14), size1: rr(0.35, 0.6), r: c.r * 1.05, g: c.g * 1.05, b: c.b * 1.05, a: snow ? 0.85 : 0.6, drag: 3.5, sprite: SPRITE.dust, rot: rnd() * 6, spin: rr(-1, 1),
      });
    }
    for (let i = 0; i < this.n(4); i++) {
      const v = cone(rr(2, 5), 0.7);
      this.alpha.spawn({ x: p.x, y: p.y, z: p.z, vx: v[0], vy: v[1] + 1, vz: v[2], life: rr(0.35, 0.6), size: rr(0.025, 0.05), r: c.r * 0.7, g: c.g * 0.7, b: c.b * 0.7, a: 1, a1: 0.6, gravity: 14, sprite: SPRITE.chunk, spin: rr(-10, 10) });
    }
    if (surface === 'wood' || surface === 'concrete' || surface === 'rock') {
      for (let i = 0; i < this.n(3); i++) {
        const v = cone(rr(3, 6), 0.6);
        this.add.spawn({ x: p.x, y: p.y, z: p.z, vx: v[0], vy: v[1], vz: v[2], life: rr(0.08, 0.16), size: 0.012, r: 2, g: 1.6, b: 1, drag: 2, sprite: SPRITE.streak, stretch: 0.015 });
      }
    }
  }

  beam(from: THREE.Vector3, to: THREE.Vector3, team: Team): void {
    let b = this.beams.find((x) => !x.active);
    if (!b) b = this.beams.reduce((m, x) => (x.t < m.t ? x : m), this.beams[0]);
    b.active = true;
    b.t = 0;
    b.mesh.visible = true;
    const u = b.mat.uniforms;
    (u.uA.value as THREE.Vector3).copy(from);
    (u.uB.value as THREE.Vector3).copy(to);
    // Gold-white always; the team only warms/cools the outer glow very slightly.
    (u.uGlow.value as THREE.Color).copy(col(PICKUP_COLOR, 2.2)).lerp(col(teamColors(team).primary, 2.2), 0.12);
    // Sparkles along the beam and a flash at the hit.
    const d = this.tmp.subVectors(to, from);
    const len = d.length();
    const count = this.n(Math.min(40, 8 + len * 0.6));
    for (let i = 0; i < count; i++) {
      const t = rnd();
      this.add.spawn({
        x: from.x + d.x * t, y: from.y + d.y * t, z: from.z + d.z * t,
        vx: rr(-0.4, 0.4), vy: rr(0, 0.6), vz: rr(-0.4, 0.4),
        life: rr(0.4, 0.9), size: rr(0.03, 0.06), r: 3, g: 2.5, b: 1.6, a: 1, drag: 1, sprite: SPRITE.ember,
      });
    }
    this.add.spawn({ x: to.x, y: to.y, z: to.z, life: 0.25, size: 0.6, size1: 1.8, r: 3, g: 2.6, b: 1.8, sprite: SPRITE.glow });
    this.add.spawn({ x: to.x, y: to.y, z: to.z, life: 0.35, size: 0.3, size1: 1.6, r: 2.6, g: 2.2, b: 1.4, sprite: SPRITE.ring });
    this.pulseLight(from, PICKUP_COLOR, 6, 0.12);
  }

  // ── Eliminations ─────────────────────────────────────────────────────────

  elimination(pos: Vec3, yaw: number, faction: Faction, team: Team, fxId: string, crouch: number): void {
    const style = findElimFx(fxId).style;
    const tc = teamColors(team);
    const h = 1.8 * (1 - 0.33 * Math.max(0, Math.min(1, crouch)));
    const body = (): [number, number, number] => {
      const y = rnd() * h;
      const w = y > h * 0.82 ? 0.14 : y < h * 0.5 ? 0.2 : 0.26;
      return [pos.x + rr(-w, w) * Math.cos(yaw), pos.y + y, pos.z + rr(-w, w) * Math.sin(yaw) + rr(-0.1, 0.1)];
    };
    const kind = style === 'faction' ? (faction === 1 ? 'petals' : 'shards') : style;
    const count = this.n(60);
    switch (kind) {
      case 'petals': {
        const a = new THREE.Color(tc.primary), b = new THREE.Color(tc.secondary);
        for (let i = 0; i < count; i++) {
          const [x, y, z] = body();
          const c = rnd() < 0.6 ? a : b;
          this.add.spawn({
            x, y, z, vx: rr(-0.5, 0.5), vy: rr(0.3, 1.2), vz: rr(-0.5, 0.5), life: rr(1.1, 1.6), size: rr(0.09, 0.15), size1: 0.04,
            r: c.r * 2.4, g: c.g * 2.4, b: c.b * 2.4, a: 1, a1: 0, fadeIn: 0.08, drag: 0.8, swirl: 1.6, sprite: SPRITE.petal, rot: rnd() * 6, spin: rr(-3, 3), flip: rr(3, 7),
          });
        }
        this.add.spawn({ x: pos.x, y: pos.y + h * 0.55, z: pos.z, life: 0.5, size: 1.2, size1: 2, r: a.r, g: a.g, b: a.b, a: 0.5, sprite: SPRITE.glow });
        break;
      }
      case 'shards': {
        const glint = new THREE.Color(tc.primary);
        for (let i = 0; i < count; i++) {
          const [x, y, z] = body();
          const dx = x - pos.x, dz = z - pos.z;
          const l = Math.hypot(dx, dz) || 1;
          const sp = rr(1.2, 3.4);
          const w = rr(0.88, 1);
          this.alpha.spawn({
            x, y, z, vx: (dx / l) * sp, vy: rr(0.5, 2.6), vz: (dz / l) * sp, life: rr(1.0, 1.6), size: rr(0.05, 0.11),
            r: w, g: w * 0.98, b: w * 0.94, a: 1, a1: 0, gravity: 5, drag: 1.2, sprite: SPRITE.shard, rot: rnd() * 6, spin: rr(-9, 9), flip: rr(6, 14),
          });
        }
        for (let i = 0; i < this.n(18); i++) {
          const [x, y, z] = body();
          this.add.spawn({ x, y, z, vx: rr(-2, 2), vy: rr(0.5, 2.5), vz: rr(-2, 2), life: rr(0.3, 0.7), size: rr(0.04, 0.08), r: glint.r * 3, g: glint.g * 3, b: glint.b * 3, gravity: 4, sprite: SPRITE.flare, rot: rnd() * 3 });
        }
        break;
      }
      case 'embers': {
        for (let i = 0; i < count; i++) {
          const [x, y, z] = body();
          const hot = rnd();
          this.add.spawn({ x, y, z, vx: rr(-0.3, 0.3), vy: rr(0.8, 2), vz: rr(-0.3, 0.3), life: rr(0.9, 1.6), size: rr(0.03, 0.06), r: 3, g: 1.2 + hot, b: 0.3, a: 1, swirl: 2.2, sprite: SPRITE.ember });
        }
        for (let i = 0; i < this.n(20); i++) {
          const [x, y, z] = body();
          this.alpha.spawn({ x, y, z, vx: rr(-0.3, 0.3), vy: rr(0.4, 1.2), vz: rr(-0.3, 0.3), life: rr(1, 1.6), size: rr(0.04, 0.07), r: 0.2, g: 0.18, b: 0.17, a: 0.9, swirl: 1.5, sprite: SPRITE.chunk, spin: rr(-3, 3), flip: 6 });
        }
        break;
      }
      case 'origami': {
        const cols = [ENV.bone, ENV.pastelPink, ENV.pastelBlue, ENV.pastelYellow].map((x) => new THREE.Color(x));
        for (let i = 0; i < Math.round(count * 0.6); i++) {
          const [x, y, z] = body();
          const c = cols[i % cols.length];
          this.alpha.spawn({ x, y, z, vx: rr(-1.5, 1.5), vy: rr(0.5, 2), vz: rr(-1.5, 1.5), life: rr(1.2, 1.7), size: rr(0.08, 0.14), r: c.r, g: c.g, b: c.b, a: 1, a1: 0, gravity: 1.5, drag: 1.8, swirl: 2.5, sprite: SPRITE.paper, rot: rnd() * 6, spin: rr(-2, 2), flip: rr(4, 9) });
        }
        break;
      }
      case 'starfall': {
        for (let i = 0; i < Math.round(count * 0.7); i++) {
          const x = pos.x + rr(-0.6, 0.6), z = pos.z + rr(-0.6, 0.6), y = pos.y + h + rr(0.5, 2.5);
          this.add.spawn({ x, y, z, vx: rr(-0.3, 0.3), vy: rr(-5, -2.5), vz: rr(-0.3, 0.3), life: rr(0.5, 1.1), size: rr(0.05, 0.1), r: 3, g: 2.7, b: 1.9, a: 1, sprite: SPRITE.star, rot: rnd() * 3, spin: rr(-4, 4) });
        }
        this.add.spawn({ x: pos.x, y: pos.y + 0.05, z: pos.z, life: 0.9, size: 0.4, size1: 2.4, r: 2.2, g: 2, b: 1.4, a: 0.8, sprite: SPRITE.ring });
        break;
      }
      case 'prism': {
        const hues = [0.0, 0.14, 0.33, 0.55, 0.75];
        for (let i = 0; i < Math.round(count * 0.7); i++) {
          const [x, y, z] = body();
          const c = new THREE.Color().setHSL(hues[i % hues.length], 0.55, 0.72);
          this.add.spawn({ x, y, z, vx: rr(-1.8, 1.8), vy: rr(0.2, 1.6), vz: rr(-1.8, 1.8), life: rr(0.9, 1.5), size: rr(0.06, 0.12), r: c.r * 2, g: c.g * 2, b: c.b * 2, a: 1, drag: 2, sprite: SPRITE.prism, rot: rnd() * 6, spin: rr(-5, 5), flip: rr(4, 10) });
        }
        break;
      }
    }
  }

  explosion(pos: THREE.Vector3): void {
    const p = pos;
    this.add.spawn({ x: p.x, y: p.y + 0.3, z: p.z, life: 0.18, size: 2.5, size1: 5.5, r: 3.2, g: 2.4, b: 1.5, sprite: SPRITE.glow });
    this.add.spawn({ x: p.x, y: p.y + 0.3, z: p.z, life: 0.12, size: 1.8, size1: 3, r: 3, g: 2.6, b: 2, sprite: SPRITE.starburst, rot: rnd() * 3 });
    this.add.spawn({ x: p.x, y: p.y + 0.15, z: p.z, life: 0.45, size: 1, size1: 10, r: 2, g: 1.7, b: 1.2, a: 0.8, sprite: SPRITE.ring });
    for (let i = 0; i < this.n(22); i++) {
      const a = rnd() * Math.PI * 2;
      const e = rr(0.1, 1);
      const sp = rr(6, 16);
      this.add.spawn({ x: p.x, y: p.y + 0.2, z: p.z, vx: Math.cos(a) * sp * (1 - e * 0.5), vy: e * sp * 0.8, vz: Math.sin(a) * sp * (1 - e * 0.5), life: rr(0.2, 0.5), size: 0.03, r: 3, g: 2, b: 1, gravity: 12, drag: 1.5, sprite: SPRITE.streak, stretch: 0.02 });
    }
    const dust = new THREE.Color('#b8a893');
    for (let i = 0; i < this.n(16); i++) {
      const a = rnd() * Math.PI * 2;
      const sp = rr(1.5, 4.5);
      this.alpha.spawn({
        x: p.x + Math.cos(a) * 0.4, y: p.y + rr(0.1, 0.8), z: p.z + Math.sin(a) * 0.4, vx: Math.cos(a) * sp, vy: rr(0.5, 2.2), vz: Math.sin(a) * sp,
        life: rr(1, 1.8), size: rr(0.6, 1), size1: rr(2, 3), r: dust.r, g: dust.g, b: dust.b, a: 0.55, drag: 2.2, sprite: SPRITE.smoke, rot: rnd() * 6, spin: rr(-0.5, 0.5),
      });
    }
    for (let i = 0; i < this.n(10); i++) {
      this.alpha.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vx: rr(-6, 6), vy: rr(3, 8), vz: rr(-6, 6), life: rr(0.6, 1.1), size: rr(0.05, 0.1), r: 0.35, g: 0.32, b: 0.3, a: 1, a1: 0.5, gravity: 16, sprite: SPRITE.chunk, spin: rr(-10, 10) });
    }
    this.pulseLight(p.clone().setY(p.y + 1), '#ffc27a', 30, 0.25);
  }

  // ── Smoke ────────────────────────────────────────────────────────────────

  smokeStart(id: number, pos: THREE.Vector3): void {
    if (this.smokes.has(id)) return;
    const v: SmokeVolume = { id, puffs: [], center: pos.clone(), radius: 0.8, remaining: 99, age: 0, ending: -1 };
    const peach = new THREE.Color(ENV.pastelPink);
    const amber = new THREE.Color('#f2c894');
    const n = this.n(22);
    for (let i = 0; i < n; i++) {
      const c = peach.clone().lerp(amber, rnd());
      const u = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd());
      const slot = this.alpha.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 1, size: 1, r: c.r, g: c.g, b: c.b, a: 0, a1: 0, sprite: SPRITE.smoke, rot: rnd() * 6 }, true);
      if (slot < 0) break;
      v.puffs.push({ slot, ox: Math.cos(u) * r, oy: rr(0.05, 0.9), oz: Math.sin(u) * r, ph: rnd() * 6, s: rr(0.8, 1.25) });
    }
    this.smokes.set(id, v);
    // Pop + ring.
    this.alpha.spawn({ x: pos.x, y: pos.y + 0.3, z: pos.z, vy: 1, life: 0.8, size: 0.5, size1: 2.5, r: amber.r, g: amber.g, b: amber.b, a: 0.8, drag: 2, sprite: SPRITE.smoke });
  }

  smokeUpdate(id: number, pos: THREE.Vector3, radius: number, remaining: number): void {
    let v = this.smokes.get(id);
    if (!v) {
      this.smokeStart(id, pos);
      v = this.smokes.get(id)!;
    }
    v.center.copy(pos);
    v.radius = Math.max(0.3, radius);
    v.remaining = remaining;
  }

  smokeEnd(id: number): void {
    const v = this.smokes.get(id);
    if (v && v.ending < 0) v.ending = 1.2;
  }

  private updateSmokes(dt: number): void {
    for (const v of this.smokes.values()) {
      v.age += dt;
      if (v.ending >= 0) v.ending -= dt;
      const fadeIn = Math.min(1, v.age / 0.8);
      const fadeOut = v.ending >= 0 ? Math.max(0, v.ending / 1.2) : Math.min(1, v.remaining / 2.5);
      const a = 0.55 * fadeIn * fadeOut;
      for (const p of v.puffs) {
        const ang = v.age * 0.12 + p.ph;
        const cs = Math.cos(ang * 0.3), sn = Math.sin(ang * 0.3);
        const ox = p.ox * cs - p.oz * sn;
        const oz = p.ox * sn + p.oz * cs;
        const r = v.radius;
        // Keep each puff's soft body above the ground: billboards that cut into
        // the floor would show a hard horizontal edge.
        const size = r * 0.8 * p.s;
        this.alpha.setPos(p.slot, v.center.x + ox * r * 0.7, v.center.y + size * 0.36 + p.oy * r * 0.55 + Math.sin(ang) * 0.1, v.center.z + oz * r * 0.7);
        this.alpha.setSize(p.slot, size);
        this.alpha.setAlpha(p.slot, a);
        this.alpha.setRot(p.slot, ang * 0.4);
      }
      if (v.ending >= 0 && v.ending <= 0) {
        for (const p of v.puffs) this.alpha.kill(p.slot);
        this.smokes.delete(v.id);
      }
    }
  }

  // ── Projectiles ──────────────────────────────────────────────────────────

  projectile(id: number, kind: ThrowableId, pos: THREE.Vector3, owner: number): void {
    void owner;
    let p = this.projectiles.get(id);
    if (!p) {
      const group = new THREE.Group();
      const [ga, gb] = this.projGeo[kind];
      const body = new THREE.Mesh(ga, kind === 'smoke' ? this.projMat[0] : this.projMat[2]);
      const band = new THREE.Mesh(gb, kind === 'smoke' ? this.projMat[1] : this.projMat[3]);
      body.castShadow = true;
      group.add(body, band);
      const lightMat = new THREE.SpriteMaterial({ map: glowTexture(), color: col(kind === 'grenade' ? DANGER_COLOR : ENV.glowGold, 2.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const light = new THREE.Sprite(lightMat);
      light.center.set(0.5, 0.5);
      light.scale.setScalar(0.35);
      group.add(light);
      this.scene.add(group);
      p = { id, kind, group, light, lightMat, last: pos.clone(), t: 0, seen: true };
      this.projectiles.set(id, p);
      group.position.copy(pos);
    }
    const moved = p.last.distanceTo(pos);
    p.group.position.copy(pos);
    p.group.rotation.x += moved * 4;
    p.group.rotation.z += moved * 2.5;
    p.last.copy(pos);
  }

  projectileEnd(id: number): void {
    const p = this.projectiles.get(id);
    if (!p) return;
    p.group.removeFromParent();
    p.lightMat.dispose();
    this.projectiles.delete(id);
  }

  // ── Movement / spawn ─────────────────────────────────────────────────────

  dust(pos: THREE.Vector3, amount: number, surface: SurfaceTag): void {
    const c = new THREE.Color(SURFACE_DUST[surface] ?? ENV.sand);
    const n = this.n(3 + Math.round(Math.max(0, Math.min(1, amount)) * 6));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const sp = rr(0.5, 1.6) * (0.5 + amount);
      this.alpha.spawn({
        x: pos.x + Math.cos(a) * 0.2, y: pos.y + 0.05, z: pos.z + Math.sin(a) * 0.2, vx: Math.cos(a) * sp, vy: rr(0.1, 0.5), vz: Math.sin(a) * sp,
        life: rr(0.5, 0.9), size: rr(0.15, 0.25), size1: rr(0.5, 0.8), r: c.r, g: c.g, b: c.b, a: surface === 'snow' ? 0.7 : 0.4, drag: 3, sprite: SPRITE.dust, rot: rnd() * 6,
      });
    }
  }

  spawnFlash(pos: Vec3, team: Team): void {
    const c = new THREE.Color(teamColors(team).primary);
    this.add.spawn({ x: pos.x, y: pos.y + 0.05, z: pos.z, life: 0.6, size: 0.4, size1: 2.2, r: c.r * 1.6, g: c.g * 1.6, b: c.b * 1.6, a: 0.8, sprite: SPRITE.ring });
    this.add.spawn({ x: pos.x, y: pos.y + 1, z: pos.z, life: 0.5, size: 1.6, size1: 2.2, r: c.r * 0.9, g: c.g * 0.9, b: c.b * 0.9, a: 0.5, sprite: SPRITE.glow });
    for (let i = 0; i < this.n(18); i++) {
      const a = rnd() * Math.PI * 2;
      const r = rr(0.2, 0.45);
      this.add.spawn({
        x: pos.x + Math.cos(a) * r, y: pos.y + rr(0, 0.6), z: pos.z + Math.sin(a) * r, vx: 0, vy: rr(1.5, 3.2), vz: 0,
        life: rr(0.5, 0.9), size: rr(0.02, 0.035), r: c.r * 2.4, g: c.g * 2.4, b: c.b * 2.4, a: 1, drag: 1.5, sprite: SPRITE.streak, stretch: 0.08,
      });
    }
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  update(dt: number, camera: THREE.Camera): void {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    void camera;
    for (const f of this.flashes) {
      if (!f.mesh.visible) continue;
      f.t -= dt;
      if (f.t <= 0) f.mesh.visible = false;
    }
    const fog = this.scene.fog as THREE.FogExp2 | null;
    for (const b of this.beams) {
      if (!b.active) continue;
      b.t += dt;
      const u = b.mat.uniforms;
      // Core flashes and dies fast; the glow lingers ~0.5 s (afterglow).
      u.uCoreK.value = Math.max(0, 1 - b.t / 0.12);
      u.uGlowK.value = Math.max(0, 1 - b.t / 0.55) * (b.t < 0.05 ? 1.4 : 1);
      u.uWidth.value = 0.35 + b.t * 0.5;
      u.uTime.value = this.time;
      u.fogDensity.value = fog && (fog as THREE.FogExp2).isFogExp2 ? fog.density : 0;
      if (b.t > 0.55) {
        b.active = false;
        b.mesh.visible = false;
      }
    }
    for (const p of this.projectiles.values()) {
      p.t += dt;
      const rate = p.kind === 'grenade' ? 4 + p.t * 6 : 1.5;
      const on = Math.sin(p.t * rate * Math.PI * 2) > 0.2;
      p.light.visible = on;
      p.light.position.set(0, 0.07, 0);
    }
    if (this.light) {
      if (this.lightT > 0) {
        this.lightT -= dt;
        this.light.intensity = this.lightK * Math.max(0, this.lightT) * 12;
      } else this.light.intensity = 0;
    }
    this.updateSmokes(dt);
    this.add.update(dt, fog);
    this.alpha.update(dt, fog);
  }

  dispose(): void {
    this.add.dispose();
    this.alpha.dispose();
    for (const f of this.flashes) {
      f.mesh.removeFromParent();
      f.mat.dispose();
    }
    this.flashGeo.dispose();
    for (const b of this.beams) {
      b.mesh.removeFromParent();
      b.mat.dispose();
    }
    this.beamGeo.dispose();
    for (const id of [...this.projectiles.keys()]) this.projectileEnd(id);
    for (const g of Object.values(this.projGeo)) for (const x of g) x.dispose();
    for (const m of this.projMat) m.dispose();
    if (this.light) {
      this.light.removeFromParent();
      this.light.dispose();
    }
    this.smokes.clear();
  }
}
