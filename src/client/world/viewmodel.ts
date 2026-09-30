// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — first-person viewmodel.
//
// Own overlay scene + camera (fov 54, near 0.01) rendered after the world with
// a cleared depth buffer. Warm golden-hour key + cool sky fill + a team-colored
// rim light and a small procedural reflection environment make the ceramic and
// metal read beautifully in every map.
//
// Motion layers (summed each frame): per-weapon hip ↔ ADS pose (sight aligned
// to screen centre), idle breathing, movement bob, sprint "run carry", look
// sway lag, landing dip, crouch/slide tilt, fire kick springs, swap lower/raise,
// throw gesture, and REAL reload animations driving the model's moving parts:
//   Meridian / Swift / Longline  mag out → new mag in → bolt/charging handle
//   Longline                     bolt cycle after every shot (s.cycle)
//   Breaker                      pump after every shot; shell-by-shell loading
//   Pulse                        cylinder swings out, cell pack swap, flick shut
//   Sunspear                     coil glow ramps with charge, vents after a shot
// Simple ceramic-gloved hands with sleeves follow the grips (the left hand
// fetches the magazine during reloads).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { RenderEngine, ViewModel, ViewModelState, WeaponModelFactory } from '../contracts';
import type { ThrowableId, WeaponId } from '../../shared/types';
import { WEAPONS } from '../../shared/weapons';
import { CYCLE_DELAY } from '../../shared/combat';
import { ENV, DANGER_COLOR } from '../engine/palette';
import { damp, Spring } from '../engine/camera-feel';
import type { WeaponModelView } from './weapon-models';

type V3 = [number, number, number];

interface Pose {
  hip: V3;
  hipRot: V3;
  /** Eye relief when aiming (m from the eye to the sight anchor). */
  ads: number;
  /** Fire kick: back (m), pitch, yaw jitter, roll jitter (rad). */
  kick: [number, number, number, number];
}

const POSES: Record<WeaponId, Pose> = {
  meridian: { hip: [0.16, -0.265, -0.48], hipRot: [0.035, 0.1, -0.02], ads: 0.2, kick: [0.026, 0.05, 0.012, 0.016] },
  swift: { hip: [0.15, -0.27, -0.45], hipRot: [0.035, 0.1, -0.02], ads: 0.19, kick: [0.016, 0.03, 0.012, 0.012] },
  longline: { hip: [0.165, -0.26, -0.48], hipRot: [0.03, 0.09, -0.02], ads: 0.12, kick: [0.07, 0.12, 0.01, 0.02] },
  breaker: { hip: [0.165, -0.275, -0.47], hipRot: [0.04, 0.1, -0.02], ads: 0.24, kick: [0.085, 0.17, 0.02, 0.035] },
  pulse: { hip: [0.15, -0.145, -0.43], hipRot: [-0.04, 0.08, -0.03], ads: 0.3, kick: [0.035, 0.1, 0.012, 0.02] },
  sunspear: { hip: [0.17, -0.29, -0.5], hipRot: [0.035, 0.1, -0.02], ads: 0.24, kick: [0.08, 0.12, 0.01, 0.02] },
};

const UP = new THREE.Vector3(0, 1, 0);
const ELBOW_R = new THREE.Vector3(0.3, -0.42, 0.02);
const ELBOW_L = new THREE.Vector3(-0.22, -0.45, 0.0);

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (p: number, a: number, b: number): number => clamp01((p - a) / (b - a));
const easeInOut = (t: number): number => t * t * (3 - 2 * t);
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const bump = (t: number): number => Math.sin(clamp01(t) * Math.PI);

interface Rest {
  pos: THREE.Vector3;
  rot: THREE.Euler;
}

// ── Reflection environment (warm studio-at-golden-hour) ─────────────────────

const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
function viewmodelEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  const hit = envCache.get(renderer);
  if (hit) return hit;
  try {
    const scene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 24, 12);
    const col = new Float32Array(geo.attributes.position.count * 3);
    const top = new THREE.Color('#f6e2c4');
    const hor = new THREE.Color('#d9b99a');
    const bot = new THREE.Color('#2e2a2c');
    const c = new THREE.Color();
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const y = geo.attributes.position.getY(i) / 10;
      if (y > 0) c.copy(hor).lerp(top, Math.pow(y, 0.6));
      else c.copy(hor).lerp(bot, Math.pow(-y, 0.5));
      c.toArray(col, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    // Soft boxes: warm sun panel upper-left, cool sky panel right.
    const panel = (color: string, k: number, x: number, y: number, z: number, w: number, h: number): void => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      scene.add(m);
    };
    panel('#ffd8a8', 6, -6, 5, 3, 4, 3);
    panel('#b9d4e6', 2.5, 7, 2, -2, 3, 5);
    panel('#fff4e0', 2, 0, 8, 0, 6, 6);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tex = pmrem.fromScene(scene, 0.02).texture;
    pmrem.dispose();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    envCache.set(renderer, tex);
    return tex;
  } catch {
    return null;
  }
}

// ── Hands ───────────────────────────────────────────────────────────────────

class Glove {
  readonly group = new THREE.Group();
  readonly sleeve: THREE.Mesh;
  constructor(mats: { glove: THREE.Material; plate: THREE.Material; sleeve: THREE.Material; stripe: THREE.Material }, left: boolean) {
    const palm = new THREE.Mesh(new RoundedBoxGeometry(0.052, 0.08, 0.098, 3, 0.022), mats.glove);
    palm.position.set(left ? -0.004 : 0.004, -0.012, 0.01);
    const plate = new THREE.Mesh(new RoundedBoxGeometry(0.056, 0.03, 0.06, 2, 0.01), mats.plate);
    plate.position.set(0, 0.022, 0.02);
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.04, 4, 8), mats.glove);
    thumb.position.set(left ? 0.024 : -0.024, 0.012, -0.018);
    thumb.rotation.x = 1.2;
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.036, 0.05, 14), mats.stripe);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, -0.012, 0.07);
    this.group.add(palm, plate, thumb, cuff);
    this.sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.05, 1, 12, 1, true).translate(0, 0.5, 0), mats.sleeve);
    for (const m of [palm, plate, thumb, cuff, this.sleeve]) m.renderOrder = 1;
  }
}

// ── Viewmodel ───────────────────────────────────────────────────────────────

export class FirstPersonViewModel implements ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.01, 12);
  private readonly rig = new THREE.Group();
  private readonly models = new Map<string, WeaponModelView>();
  private model: WeaponModelView | null = null;
  private weapon: WeaponId = 'meridian';
  private skin = 'factory';
  private rest = new Map<THREE.Object3D, Rest>();
  private readonly key: THREE.DirectionalLight;
  private readonly rim: THREE.DirectionalLight;
  private readonly gloveMats: { glove: THREE.MeshStandardMaterial; plate: THREE.MeshStandardMaterial; sleeve: THREE.MeshStandardMaterial; stripe: THREE.MeshStandardMaterial };
  private readonly handR: Glove;
  private readonly handL: Glove;
  private readonly canister = new THREE.Group();
  private readonly canSmoke: THREE.Group;
  private readonly canGrenade: THREE.Group;

  // Motion state.
  private time = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private sprintK = 0;
  private slideK = 0;
  private wasGround = true;
  private airTime = 0;
  private readonly swayX = new Spring(90, 13);
  private readonly swayY = new Spring(90, 13);
  private readonly landSpring = new Spring(160, 14);
  private readonly kickBack = new Spring(320, 26);
  private readonly kickPitch = new Spring(260, 22);
  private readonly kickYaw = new Spring(260, 22);
  private readonly kickRoll = new Spring(220, 20);
  private readonly slap = new Spring(300, 20);
  private slideT = 0;
  private dryT = 0;
  private reloadActive = false;
  private reloadEmpty = false;
  private reloadClock = 0;
  private lastReloadP = -1;
  private slapDone = false;
  private throwT = -1;
  private throwKind: ThrowableId = 'smoke';
  private ventT = 0;
  private flare = 0;
  private lastMag = -1;
  private shellSeat = 0;
  private reloadExitT = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(private readonly weapons: WeaponModelFactory, private readonly engine: RenderEngine) {
    this.scene.name = 'viewmodel';
    this.camera.name = 'viewmodelCamera';
    this.scene.add(this.camera);
    this.scene.add(this.rig);
    const env = viewmodelEnvironment(engine.renderer);
    if (env) {
      this.scene.environment = env;
      this.scene.environmentIntensity = 0.55;
    }
    // Warm key from upper-left front, cool sky fill, team rim from behind-right.
    this.key = new THREE.DirectionalLight('#ffd9b0', 2.3);
    this.key.position.set(-0.6, 1.0, 0.7);
    this.scene.add(this.key);
    this.scene.add(new THREE.HemisphereLight('#c3d3e2', '#5e4f48', 0.85));
    this.rim = new THREE.DirectionalLight('#ff9a4a', 0.75);
    this.rim.position.set(1.0, 0.25, -1.2);
    this.scene.add(this.rim);

    this.gloveMats = {
      glove: new THREE.MeshStandardMaterial({ color: new THREE.Color(ENV.bone), roughness: 0.45 }),
      plate: new THREE.MeshStandardMaterial({ color: new THREE.Color(ENV.boneShade), roughness: 0.4 }),
      sleeve: new THREE.MeshStandardMaterial({ color: new THREE.Color('#3d3a36'), roughness: 0.92, side: THREE.DoubleSide }),
      stripe: new THREE.MeshStandardMaterial({ color: new THREE.Color('#ff8a3d'), roughness: 0.5 }),
    };
    this.handR = new Glove(this.gloveMats, false);
    this.handL = new Glove(this.gloveMats, true);
    this.scene.add(this.handR.sleeve, this.handL.sleeve, this.handL.group);

    // Throwable canisters (only visible during the throw gesture).
    this.canSmoke = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 16), new THREE.MeshStandardMaterial({ color: new THREE.Color(ENV.bone), roughness: 0.4 }));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.03, 16), new THREE.MeshStandardMaterial({ color: new THREE.Color(ENV.terracottaFaded), roughness: 0.5 }));
    this.canSmoke.add(body, band);
    this.canGrenade = new THREE.Group();
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 12), new THREE.MeshStandardMaterial({ color: new THREE.Color(ENV.metalDark), roughness: 0.4, metalness: 0.5 }));
    const light = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.006, 6, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(DANGER_COLOR).multiplyScalar(2) }));
    light.rotation.x = Math.PI / 2;
    this.canGrenade.add(g, light);
    this.canister.add(this.canSmoke, this.canGrenade);
    this.canister.visible = false;
    this.scene.add(this.canister);

    this.setWeapon('meridian', 'factory');
  }

  // ── API ──────────────────────────────────────────────────────────────────

  setWeapon(id: WeaponId, skin: string): void {
    if (this.model && id === this.weapon && skin === this.skin) return;
    const key = `${id}|${skin}`;
    let m = this.models.get(key);
    if (!m) {
      m = this.weapons.create(id, skin, 'view') as WeaponModelView;
      m.root.traverse((o) => (o.renderOrder = 1));
      this.models.set(key, m);
    }
    if (this.model) {
      this.rig.remove(this.model.root);
      this.model.handR.remove(this.handR.group);
    }
    this.model = m;
    this.weapon = id;
    this.skin = skin;
    this.rig.add(m.root);
    m.handR.add(this.handR.group);
    this.rest.clear();
    const save = (o: THREE.Object3D | undefined): void => {
      if (o) this.rest.set(o, { pos: o.position.clone(), rot: o.rotation.clone() });
    };
    for (const p of Object.values(m.parts)) save(p);
    for (const v of m.vents) save(v);
    const cyl = m.parts.mag?.children.find((c) => c.name === 'cylinder');
    save(cyl);
    this.reloadActive = false;
    this.lastMag = -1;
  }

  fire(): void {
    const k = POSES[this.weapon].kick;
    this.kickBack.impulse(k[0] * 22);
    this.kickPitch.impulse(k[1] * 22);
    this.kickYaw.impulse((Math.random() - 0.5) * k[2] * 40);
    this.kickRoll.impulse((Math.random() - 0.5) * k[3] * 40);
    this.slideT = 0.11;
    if (this.weapon === 'sunspear') {
      this.ventT = 0.9;
      this.flare = 1;
    }
    // A shell interrupting a Breaker reload.
    if (this.reloadActive && this.weapon === 'breaker') this.reloadActive = false;
  }

  dryFire(): void {
    this.dryT = 0.12;
  }

  reloadStart(empty: boolean): void {
    this.reloadActive = true;
    this.reloadEmpty = empty;
    this.reloadClock = 0;
    this.slapDone = false;
    this.lastReloadP = -1;
  }

  throwStart(kind: ThrowableId): void {
    this.throwT = 0;
    this.throwKind = kind;
    this.canSmoke.visible = kind === 'smoke';
    this.canGrenade.visible = kind === 'grenade';
  }

  setTeamLight(color: string): void {
    this.rim.color.set(color);
    this.gloveMats.stripe.color.set(color);
  }

  muzzleWorld(mainCamera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    const cam = mainCamera as THREE.PerspectiveCamera;
    if (!this.model) return out.setFromMatrixPosition(mainCamera.matrixWorld);
    this.rig.updateMatrixWorld(true);
    this.model.muzzle.getWorldPosition(this.tmp);
    const depth = Math.max(0.2, -this.tmp.z);
    this.tmp.project(this.camera);
    const fov = cam.isPerspectiveCamera ? cam.fov : 70;
    const aspect = cam.isPerspectiveCamera ? cam.aspect : this.camera.aspect;
    const t = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    out.set(this.tmp.x * depth * t * aspect, this.tmp.y * depth * t, -depth);
    return out.applyMatrix4(mainCamera.matrixWorld);
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  update(dt: number, s: ViewModelState): void {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    if (s.weapon !== this.weapon || s.skin !== this.skin) this.setWeapon(s.weapon, s.skin);
    const m = this.model;
    if (!m) return;
    const pose = POSES[this.weapon];

    const adsE = easeInOut(clamp01(s.ads));
    this.camera.fov = 54 - adsE * 8;
    this.camera.updateProjectionMatrix();

    // Blend weights.
    this.sprintK = damp(this.sprintK, s.sprinting && s.ads < 0.2 && s.reload < 0 ? 1 : 0, 9, dt);
    this.slideK = damp(this.slideK, s.sliding ? 1 : 0, 10, dt);
    const calm = 1 - 0.85 * adsE;

    // Landing dip from airtime (ViewModelState has no impact speed).
    if (!s.onGround) this.airTime += dt;
    else {
      if (!this.wasGround && this.airTime > 0.12) this.landSpring.impulse(-Math.min(0.45, 0.15 + this.airTime * 0.4));
      this.airTime = 0;
    }
    this.wasGround = s.onGround;

    // Bob.
    const moving = s.onGround && !s.sliding ? THREE.MathUtils.clamp(s.speed / 5.4, 0, 1.5) : 0;
    this.bobAmp = damp(this.bobAmp, moving, 7, dt);
    this.bobPhase += dt * (s.sprinting ? 10.5 : 8.4) * THREE.MathUtils.clamp(s.speed / 5.4, 0.6, 1.5);
    const ba = this.bobAmp * calm * (1 + this.sprintK * 0.8);
    const bobX = Math.sin(this.bobPhase) * 0.008 * ba;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.009 * ba + 0.004 * ba;
    const bobRoll = Math.sin(this.bobPhase) * 0.02 * ba;

    // Breathing.
    const br = (0.4 + 0.6 * calm) * (1 - this.bobAmp * 0.5);
    const breathY = Math.sin(this.time * 1.7) * 0.0018 * br;
    const breathP = Math.sin(this.time * 1.7 + 0.6) * 0.004 * br;

    // Look sway (lag against the look direction, in angular velocity).
    const inv = dt > 0 ? 1 / dt : 60;
    const tx = THREE.MathUtils.clamp(-s.lookDx * inv * 0.012, -0.07, 0.07) * (1 - 0.6 * adsE);
    const ty = THREE.MathUtils.clamp(s.lookDy * inv * 0.01, -0.05, 0.05) * (1 - 0.6 * adsE);
    const sx = this.swayX.step(dt, tx);
    const sy = this.swayY.step(dt, ty);

    const land = this.landSpring.step(dt);
    const kb = this.kickBack.step(dt) * (1 - 0.35 * adsE);
    const kp = this.kickPitch.step(dt) * (1 - 0.4 * adsE);
    const ky = this.kickYaw.step(dt);
    const kr = this.kickRoll.step(dt);
    const sl = this.slap.step(dt);

    // Base pose: hip ↔ ADS (sight anchor on the screen centre line).
    const sight = m.sight.position;
    const adsPos: V3 = [-sight.x, -sight.y, -pose.ads - sight.z];
    const px = THREE.MathUtils.lerp(pose.hip[0], adsPos[0], adsE);
    const py = THREE.MathUtils.lerp(pose.hip[1], adsPos[1], adsE);
    const pz = THREE.MathUtils.lerp(pose.hip[2], adsPos[2], adsE);
    let rx = pose.hipRot[0] * (1 - adsE);
    let ry = pose.hipRot[1] * (1 - adsE);
    let rz = pose.hipRot[2] * (1 - adsE);
    let ox = bobX + sx * 0.25;
    let oy = bobY + breathY + land * 0.06 - s.crouch * 0.008 * calm;
    let oz = kb;
    rx += breathP + kp + sy + land * 0.12;
    ry += sx + ky;
    rz += bobRoll + kr + s.crouch * 0.04 * calm;

    // Sprint "run carry": lowered, turned across the body.
    const sk = this.sprintK;
    ox += -0.03 * sk;
    oy += -0.045 * sk;
    oz += 0.03 * sk;
    rx += -0.32 * sk + Math.sin(this.bobPhase * 2) * 0.03 * sk;
    ry += 0.55 * sk;
    rz += 0.32 * sk;

    // Slide tilt.
    ox -= 0.02 * this.slideK;
    oy -= 0.03 * this.slideK;
    rz += 0.22 * this.slideK;

    // Swap: lower & raise.
    const raise = easeOut(clamp01(s.raise));
    oy -= (1 - raise) * 0.26;
    rx -= (1 - raise) * 0.75;
    rz += (1 - raise) * 0.2;

    // Dry fire twitch.
    if (this.dryT > 0) {
      this.dryT -= dt;
      rx += Math.sin(clamp01(this.dryT / 0.12) * Math.PI) * 0.015;
    }

    // Reload (weapon pose + moving parts).
    const r = this.animateReload(dt, s);
    ox += r.x;
    oy += r.y + sl * 0.02;
    oz += r.z;
    rx += r.rx - sl * 0.05;
    ry += r.ry;
    rz += r.rz;

    // Pump / bolt cycle after a shot.
    const c = this.animateCycle(s);
    oy += c.y;
    rx += c.rx;
    rz += c.rz;

    // Throw gesture: weapon dips right while the canister arcs away.
    if (this.throwT >= 0) {
      this.throwT += dt;
      const t = this.throwT;
      const d = bump(seg(t, 0, 0.75));
      oy -= d * 0.1;
      ox += d * 0.04;
      rx -= d * 0.55;
      rz -= d * 0.25;
      const a = seg(t, 0.08, 0.6);
      this.canister.visible = t > 0.08 && t < 0.6;
      const p0 = this.tmp.set(-0.16, -0.24, -0.32);
      const p1 = this.tmp2.set(-0.06, 0.12, -0.75);
      this.canister.position.lerpVectors(p0, p1, easeOut(a));
      this.canister.position.y += Math.sin(a * Math.PI) * 0.12;
      this.canister.position.z -= a * a * 1.6;
      this.canister.rotation.set(a * 6, a * 2, 0);
      if (t > 0.8) {
        this.throwT = -1;
        this.canister.visible = false;
      }
    }

    this.rig.position.set(px + ox, py + oy, pz + oz);
    this.rig.rotation.set(rx, ry, rz, 'YXZ');
    this.rig.visible = !s.scoped;

    // Part animations independent of pose.
    this.animateSlide(dt);
    this.animateCharge(dt, s);
    m.setAmmo(s.mag, s.magSize);
    this.lastMag = s.mag;
    this.updateHands(r.handToMag);
    this.handR.group.visible = this.handL.group.visible = this.handR.sleeve.visible = this.handL.sleeve.visible = !s.scoped;
  }

  // ── Reload animations ────────────────────────────────────────────────────

  private part(name: 'mag' | 'bolt' | 'pump' | 'slide' | 'shell' | 'coil'): { o: THREE.Object3D; r: Rest } | null {
    const o = this.model?.parts[name];
    if (!o) return null;
    const r = this.rest.get(o);
    return r ? { o, r } : null;
  }

  private resetPart(name: 'mag' | 'bolt' | 'pump' | 'shell'): void {
    const p = this.part(name);
    if (!p) return;
    p.o.position.copy(p.r.pos);
    p.o.rotation.copy(p.r.rot);
    if (name === 'shell') p.o.visible = false;
    else p.o.visible = true;
  }

  private animateReload(dt: number, s: ViewModelState): { x: number; y: number; z: number; rx: number; ry: number; rz: number; handToMag: number } {
    const out = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, handToMag: 0 };
    const reloading = s.reload >= 0;
    if (reloading && !this.reloadActive) this.reloadStart(s.mag <= 0);
    if (!reloading && this.reloadActive) {
      this.reloadActive = false;
      this.reloadExitT = this.weapon === 'breaker' ? 0.35 : 0;
    }
    if (!this.reloadActive) {
      for (const n of ['mag', 'bolt', 'shell'] as const) this.resetPart(n);
      const cyl = this.model?.parts.mag?.children.find((ch) => ch.name === 'cylinder');
      const cr = cyl ? this.rest.get(cyl) : undefined;
      if (cyl && cr) {
        cyl.position.copy(cr.pos);
        cyl.visible = true;
      }
      // Breaker: settle out of the loading pose.
      if (this.reloadExitT > 0) {
        this.reloadExitT = Math.max(0, this.reloadExitT - dt);
        const k = this.reloadExitT / 0.35;
        out.rz = -0.5 * k;
        out.y = -0.03 * k;
        out.rx = 0.1 * k;
      }
      return out;
    }
    this.reloadClock += dt;
    const p = clamp01(s.reload);
    switch (this.weapon) {
      case 'meridian':
      case 'swift':
      case 'longline':
        this.reloadMagazine(p, out);
        break;
      case 'breaker':
        this.reloadShells(s, out);
        break;
      case 'pulse':
        this.reloadCylinder(p, out);
        break;
      default:
        break;
    }
    this.lastReloadP = p;
    return out;
  }

  private reloadMagazine(p: number, out: { x: number; y: number; z: number; rx: number; ry: number; rz: number; handToMag: number }): void {
    const top = this.weapon === 'swift';
    const tilt = easeInOut(seg(p, 0, 0.14)) * (1 - easeInOut(seg(p, 0.84, 1)));
    out.rz = (top ? 0.3 : -0.42) * tilt;
    out.rx = 0.14 * tilt;
    out.y = -0.035 * tilt;
    out.x = -0.03 * tilt;
    const mag = this.part('mag');
    if (mag) {
      const outK = easeInOut(seg(p, 0.14, 0.34));
      const inK = easeOut(seg(p, 0.46, 0.66));
      const away = p < 0.46 ? outK : 1 - inK;
      mag.o.position.copy(mag.r.pos);
      mag.o.rotation.copy(mag.r.rot);
      if (top) {
        mag.o.position.y += Math.min(away * 2, 1) * 0.06;
        mag.o.position.x -= away * 0.2;
        mag.o.position.y -= Math.max(0, away - 0.5) * 0.2;
        mag.o.rotation.z += away * 0.7;
      } else {
        mag.o.position.y -= away * 0.3;
        mag.o.position.z += away * 0.04;
        mag.o.rotation.x += away * 0.35;
      }
      mag.o.visible = away < 0.97;
      // Left hand goes to the magazine for the swap.
      out.handToMag = easeInOut(seg(p, 0.1, 0.2)) * (1 - easeInOut(seg(p, 0.66, 0.78)));
    }
    if (!this.slapDone && p >= 0.64) {
      this.slapDone = true;
      this.slap.impulse(top ? -1.2 : 1.6);
    }
    // Charging handle / bolt.
    const bolt = this.part('bolt');
    if (bolt) {
      bolt.o.position.copy(bolt.r.pos);
      bolt.o.rotation.copy(bolt.r.rot);
      const b = seg(p, 0.68, this.reloadEmpty ? 0.86 : 0.8);
      const pull = b < 0.55 ? easeInOut(b / 0.55) : 1 - easeOut((b - 0.55) / 0.45);
      if (this.weapon === 'longline') {
        const lift = easeInOut(seg(b, 0, 0.25)) * (1 - easeInOut(seg(b, 0.75, 1)));
        bolt.o.rotation.z = bolt.r.rot.z + lift * 1.1;
        bolt.o.position.z += easeInOut(seg(b, 0.25, 0.5)) * (1 - easeInOut(seg(b, 0.5, 0.75))) * 0.09;
      } else {
        bolt.o.position.z += pull * (this.reloadEmpty ? 0.075 : 0.045);
      }
      out.rz += (this.weapon === 'longline' ? -0.12 : 0.1) * bump(b);
    }
  }

  private reloadShells(s: ViewModelState, out: { x: number; y: number; z: number; rx: number; ry: number; rz: number; handToMag: number }): void {
    const w = WEAPONS.breaker;
    const lead = w.reloadTime * 0.25 + (this.reloadEmpty ? w.reloadEmptyExtra : 0);
    const per = w.reloadPerRound ?? 0.42;
    const t = this.reloadClock;
    const tilt = easeInOut(clamp01(t / 0.3));
    out.rz = -0.5 * tilt;
    out.rx = 0.1 * tilt;
    out.y = -0.03 * tilt;
    out.x = -0.01 * tilt;
    const shell = this.part('shell');
    if (shell) {
      // Each shell: rises from below into the loading port over the per-round window.
      const k = t < lead - per * 0.9 ? -1 : ((t - (lead - per)) % per) / per;
      shell.o.visible = k >= 0 && k < 0.85 && s.mag < s.magSize;
      if (shell.o.visible) {
        const up = easeOut(seg(k, 0, 0.55));
        const push = easeInOut(seg(k, 0.55, 0.85));
        shell.o.position.set(shell.r.pos.x - 0.02 * (1 - up), shell.r.pos.y - 0.14 * (1 - up) + 0.01 * push, shell.r.pos.z - 0.045 * push);
        shell.o.rotation.set(-0.5 * (1 - up), 0, 0);
      }
      out.handToMag = shell.o.visible ? 0.85 : 0.4 * tilt;
    }
    if (s.mag > this.lastMag && this.lastMag >= 0) this.shellSeat = 1;
    this.shellSeat = Math.max(0, this.shellSeat - 1 / 0.12 / 60);
    out.rx -= this.shellSeat * 0.03;
  }

  private reloadCylinder(p: number, out: { x: number; y: number; z: number; rx: number; ry: number; rz: number; handToMag: number }): void {
    const tilt = easeInOut(seg(p, 0, 0.14)) * (1 - easeInOut(seg(p, 0.86, 1)));
    out.rz = 0.55 * tilt;
    out.rx = 0.12 * tilt;
    out.y = -0.02 * tilt;
    const crane = this.part('mag');
    if (!crane) return;
    const open = easeOut(seg(p, 0.14, 0.28)) * (1 - easeInOut(seg(p, 0.7, 0.8)));
    crane.o.rotation.z = crane.r.rot.z + open * 1.35;
    const cyl = crane.o.children.find((c) => c.name === 'cylinder');
    const cr = cyl ? this.rest.get(cyl) : undefined;
    if (cyl && cr) {
      const drop = easeInOut(seg(p, 0.3, 0.44));
      const insert = easeOut(seg(p, 0.48, 0.66));
      const away = p < 0.46 ? drop : 1 - insert;
      cyl.position.set(cr.pos.x, cr.pos.y, cr.pos.z + away * 0.16);
      cyl.visible = away < 0.95;
    }
    out.handToMag = easeInOut(seg(p, 0.24, 0.32)) * (1 - easeInOut(seg(p, 0.66, 0.74)));
    if (!this.slapDone && p >= 0.8) {
      this.slapDone = true;
      this.slap.impulse(1.4);
      this.flare = 0.8;
    }
  }

  private animateCycle(s: ViewModelState): { y: number; rx: number; rz: number } {
    const out = { y: 0, rx: 0, rz: 0 };
    if (this.weapon !== 'longline' && this.weapon !== 'breaker') return out;
    if (s.reload >= 0) return out;
    const interval = 60 / WEAPONS[this.weapon].rpm;
    const t = clamp01(s.cycle) * interval;
    const c = s.cycle >= 1 ? 0 : seg(t, CYCLE_DELAY, interval - 0.04);
    if (this.weapon === 'breaker') {
      const pump = this.part('pump');
      if (pump) {
        pump.o.position.copy(pump.r.pos);
        pump.o.position.z += bump(c) * 0.095;
      }
      out.y = -bump(c) * 0.012;
      out.rz = -bump(c) * 0.06;
    } else {
      const bolt = this.part('bolt');
      if (bolt && !this.reloadActive) {
        bolt.o.position.copy(bolt.r.pos);
        bolt.o.rotation.copy(bolt.r.rot);
        const lift = easeInOut(seg(c, 0, 0.25)) * (1 - easeInOut(seg(c, 0.75, 1)));
        bolt.o.rotation.z = bolt.r.rot.z + lift * 1.1;
        bolt.o.position.z += easeInOut(seg(c, 0.25, 0.5)) * (1 - easeInOut(seg(c, 0.5, 0.75))) * 0.09;
      }
      out.rz = -bump(c) * 0.1;
      out.rx = bump(c) * 0.03;
    }
    return out;
  }

  private animateSlide(dt: number): void {
    const slide = this.part('slide');
    if (this.slideT > 0) this.slideT = Math.max(0, this.slideT - dt);
    if (slide) {
      slide.o.position.copy(slide.r.pos);
      slide.o.position.z += bump(1 - this.slideT / 0.11) * (this.slideT > 0 ? 0.035 : 0);
    }
  }

  private animateCharge(dt: number, s: ViewModelState): void {
    const m = this.model;
    if (!m) return;
    this.flare = Math.max(0, this.flare - dt * 2.2);
    if (this.weapon === 'sunspear') {
      m.setCharge(Math.max(clamp01(s.charge), this.flare));
      const coil = this.part('coil');
      if (coil) coil.o.rotation.z = coil.r.rot.z + s.charge * this.time * 3;
    }
    if (this.ventT > 0) this.ventT = Math.max(0, this.ventT - dt);
    const v = bump(1 - this.ventT / 0.9) * (this.ventT > 0 ? 1 : 0);
    for (const vent of m.vents) {
      const r = this.rest.get(vent);
      if (r) vent.rotation.x = r.rot.x - v * 0.9;
    }
    if (this.weapon === 'pulse') {
      const coil = this.part('coil');
      if (coil) coil.o.scale.setScalar(1 + this.flare * 0.08);
    }
  }

  // ── Hands ────────────────────────────────────────────────────────────────

  private updateHands(toMag: number): void {
    const m = this.model;
    if (!m) return;
    this.rig.updateMatrixWorld(true);
    // Left glove: foregrip anchor, or the magazine / loading port while reloading.
    const target = m.handL.getWorldPosition(this.tmp);
    const mag = m.parts.shell && this.weapon === 'breaker' ? m.parts.shell : m.parts.mag;
    if (mag && toMag > 0) {
      const mp = mag.getWorldPosition(this.tmp2);
      mp.y -= this.weapon === 'swift' ? -0.02 : 0.05;
      target.lerp(mp, toMag);
    }
    this.handL.group.position.copy(target);
    m.handL.getWorldQuaternion(this.tmpQ);
    this.handL.group.quaternion.copy(this.tmpQ);
    // Sleeves from off-screen elbows to the wrists.
    const wristR = this.handR.group.getWorldPosition(this.tmp2);
    wristR.y -= 0.01;
    wristR.z += 0.06;
    this.placeSleeve(this.handR.sleeve, wristR, ELBOW_R);
    const wristL = this.tmp2.copy(this.handL.group.position);
    wristL.y -= 0.01;
    wristL.z += 0.06;
    this.placeSleeve(this.handL.sleeve, wristL, ELBOW_L);
  }

  private placeSleeve(sleeve: THREE.Mesh, wrist: THREE.Vector3, elbow: THREE.Vector3): void {
    const dir = this.tmp.subVectors(wrist, elbow);
    const len = dir.length();
    sleeve.position.copy(elbow);
    sleeve.quaternion.setFromUnitVectors(UP, dir.normalize());
    sleeve.scale.set(1, len, 1);
  }

  dispose(): void {
    for (const m of this.models.values()) m.dispose();
    this.models.clear();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !(mesh.geometry as THREE.BufferGeometry & { __shared?: boolean }).__shared) {
        // Weapon geometries are shared/cached by the factory; only glove/canister geometry is ours.
        if (mesh.parent === this.handR.group || mesh.parent === this.handL.group || mesh === this.handR.sleeve || mesh === this.handL.sleeve || mesh.parent?.parent === this.canister) {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
      }
    });
    for (const m of Object.values(this.gloveMats)) m.dispose();
    this.scene.clear();
  }
}
