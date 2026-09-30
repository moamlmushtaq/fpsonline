// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — first-person viewmodel.
//
// Own overlay scene + camera (fixed 50° vertical FOV so framing is identical
// whatever the player's world FOV; near 0.01) rendered after the world with a
// cleared depth buffer. Warm golden-hour key + cool sky fill + a team-colored
// rim light + a small studio reflection environment; setLighting() tints the
// key/fill to the current map.
//
// Framing: the weapon sits lower-right (grip ≈ 12 cm right / 18 cm below /
// 33 cm ahead of the eye → receiver top ≈ 27% up the screen), yawed a touch
// toward the crosshair so the dial + ammo screen on its left face read. ADS
// puts the weapon's sight anchor exactly on the view axis at its eye relief.
//
// Motion layers (summed each frame, springs sub-stepped, no allocations):
// idle breathing, look sway with lag + spring return, figure-8 movement bob,
// sprint carry, slide tilt, landing dip, crouch settle, per-weapon fire kick,
// swap lower/raise, dry-fire click, throw (a canister leaves the left hand),
// Sunspear charge shake + vents + steam, and REAL reloads that move the
// weapon's parts with gloved hands attached to them (weapons/vm-anims.ts).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { RenderEngine, ViewModel, ViewModelState, WeaponModelFactory } from '../contracts';
import type { MapLighting } from '../../shared/maps/types';
import type { ThrowableId, WeaponId } from '../../shared/types';
import { WEAPONS } from '../../shared/weapons';
import { CYCLE_DELAY } from '../../shared/combat';
import { damp, Spring } from '../engine/camera-feel';
import type { WeaponModelView } from './weapon-models';
import { Gloves } from './weapons/hands';
import {
  bump,
  clamp01,
  cycleBreaker,
  cycleLongline,
  ease,
  easeOut,
  newPose,
  reloadBreaker,
  reloadLongline,
  reloadMeridian,
  reloadPulse,
  reloadSwift,
  resetPose,
  seg,
  type AnimModel,
  type HandKey,
  type HandPlan,
  type Rest,
  type ShellState,
  type VmPose,
} from './weapons/vm-anims';

type V3 = [number, number, number];

interface Pose {
  /**
   * Hip framing: where the weapon's sight anchor lands on screen (NDC x, y) and
   * how far it is from the eye (m). The grip position is solved from it, so all
   * six weapons frame consistently whatever their size.
   */
  hip: V3;
  hipRot: V3;
  /** Fire kick: back (m), pitch, yaw jitter, roll jitter (rad). */
  kick: [number, number, number, number];
  /** Kick spring stiffness multiplier (snappier for light guns). */
  snap: number;
  /** Sprint carry rotation + offset. */
  sprint: V3;
  sprintPos: V3;
}

/**
 * Hip poses. Tuned for a presentation "product shot": the gun sits lower-right,
 * yawed in toward the crosshair and canted outward so its left flank (dial,
 * ammo screen, label, magazine) faces the eye. Exported (mutable) so the dev
 * preview can tune it live (&hip=x,y,d&rot=rx,ry,rz).
 */
export const VM_POSES: Record<WeaponId, Pose> = {
  meridian: { hip: [0.52, -0.42, 0.68], hipRot: [0.04, 0.15, -0.17], kick: [0.02, 0.034, 0.008, 0.012], snap: 1, sprint: [-0.2, 0.42, 0.3], sprintPos: [-0.015, -0.02, 0.02] },
  swift: { hip: [0.47, -0.3, 0.6], hipRot: [0.05, 0.25, -0.2], kick: [0.011, 0.018, 0.009, 0.01], snap: 1.45, sprint: [-0.18, 0.4, 0.28], sprintPos: [-0.015, -0.02, 0.02] },
  longline: { hip: [0.52, -0.44, 0.72], hipRot: [0.04, 0.13, -0.16], kick: [0.062, 0.1, 0.012, 0.03], snap: 0.8, sprint: [-0.2, 0.42, 0.3], sprintPos: [-0.015, -0.025, 0.02] },
  breaker: { hip: [0.5, -0.44, 0.7], hipRot: [0.04, 0.15, -0.17], kick: [0.07, 0.13, 0.016, 0.04], snap: 0.85, sprint: [-0.22, 0.42, 0.32], sprintPos: [-0.015, -0.025, 0.02] },
  pulse: { hip: [0.38, -0.27, 0.55], hipRot: [0.04, 0.2, -0.1], kick: [0.028, 0.095, 0.01, 0.022], snap: 1.1, sprint: [-0.5, 0.22, 0.22], sprintPos: [0.0, -0.02, 0.03] },
  sunspear: { hip: [0.5, -0.4, 0.72], hipRot: [0.04, 0.14, -0.16], kick: [0.075, 0.09, 0.008, 0.02], snap: 0.75, sprint: [-0.2, 0.42, 0.3], sprintPos: [-0.015, -0.025, 0.02] },
};
const POSES = VM_POSES;

/**
 * Overlay camera vertical FOV (hip → ADS). Narrower than the world camera so
 * the weapon reads like a product shot instead of a fish-eye tube.
 */
export const VM_VIEW = { fov: 40, adsFov: 35 };

// ── Reflection environment (warm studio-at-golden-hour) ─────────────────────

const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
function viewmodelEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  const hit = envCache.get(renderer);
  if (hit) return hit;
  try {
    const scene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 24, 12);
    const col = new Float32Array(geo.attributes.position.count * 3);
    const top = new THREE.Color('#f3dfc2');
    const hor = new THREE.Color('#c9ab8e');
    const bot = new THREE.Color('#2c2828');
    const c = new THREE.Color();
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const y = geo.attributes.position.getY(i) / 10;
      if (y > 0) c.copy(hor).lerp(top, Math.pow(y, 0.6));
      else c.copy(hor).lerp(bot, Math.pow(-y, 0.5));
      c.toArray(col, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const panel = (color: string, k: number, x: number, y: number, z: number, w: number, h: number): void => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      scene.add(m);
    };
    panel('#ffd8a8', 5, -6, 5, 3, 4, 2.2); // warm sun softbox
    panel('#b9d4e6', 2.2, 7, 2, -2, 2.5, 5); // cool sky strip
    panel('#fff4e0', 1.6, 0, 8, 0, 7, 4); // overhead
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

// ── Steam (Sunspear vents): one Points draw, preallocated ───────────────────

const STEAM_N = 18;

class Steam {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(STEAM_N * 3);
  private readonly vel = new Float32Array(STEAM_N * 3);
  private readonly life = new Float32Array(STEAM_N);
  private readonly size = new Float32Array(STEAM_N);
  private readonly alpha = new Float32Array(STEAM_N);
  private next = 0;
  /** Any particle alive (skip buffer uploads when idle). */
  private live = false;
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uColor: { value: new THREE.Color('#fff1de') } },
      vertexShader: `attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / max(0.05, -mv.z); vA = aAlpha; }`,
      fragmentShader: `uniform vec3 uColor; varying float vA;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(uColor, a * a * vA); }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
  }

  emit(p: THREE.Vector3, n: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % STEAM_N;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.02;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.02;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.05;
      this.vel[i * 3 + 1] = 0.12 + Math.random() * 0.1;
      this.vel[i * 3 + 2] = 0.04 + Math.random() * 0.05;
      this.life[i] = 1;
    }
    this.live = true;
    this.points.visible = true;
  }

  update(dt: number, scale: number): void {
    this.mat.uniforms.uScale.value = scale;
    if (!this.live) return;
    let live = false;
    for (let i = 0; i < STEAM_N; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] = Math.max(0, this.life[i] - dt * 1.3);
      const l = this.life[i];
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = 0.02 + (1 - l) * 0.06;
      this.alpha[i] = Math.sin(l * Math.PI) * 0.35;
      live = true;
    }
    this.live = live;
    this.points.visible = live;
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

// ── Viewmodel ───────────────────────────────────────────────────────────────

const _m1 = new THREE.Matrix4();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
/** Off-screen shoulder points (camera space) the forearms aim at. */
const SHOULDER_L = new THREE.Vector3(-0.2, -0.42, 0.12);
const SHOULDER_R = new THREE.Vector3(0.26, -0.4, 0.14);
const _s = new THREE.Vector3();

export class FirstPersonViewModel implements ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(VM_VIEW.fov, 16 / 9, 0.01, 12);
  private readonly rig = new THREE.Group();
  private readonly models = new Map<string, WeaponModelView>();
  private model: WeaponModelView | null = null;
  private weapon: WeaponId = 'meridian';
  private skin = 'factory';
  private readonly rests = new Map<THREE.Object3D, Rest>();
  private readonly key: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly rim: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly gloves = new Gloves();
  private readonly steam = new Steam();
  private readonly pocket = new THREE.Object3D();
  private readonly throwHold = new THREE.Object3D();
  private readonly anim: AnimModel;
  private readonly pose: VmPose = newPose();
  private readonly shell: ShellState = { clock: 0, shellClock: 0, lead: 0, per: 0.42, empty: false, missing: 0 };

  // Motion state.
  private time = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private sprintK = 0;
  private slideK = 0;
  private crouchK = 0;
  private adsK = 0;
  private wasGround = true;
  private airTime = 0;
  private readonly swayX = new Spring(110, 12);
  private readonly swayY = new Spring(110, 12);
  private readonly swayPos = new Spring(90, 12);
  private readonly landSpring = new Spring(150, 13);
  private readonly kickBack = new Spring(340, 26);
  private readonly kickPitch = new Spring(280, 21);
  private readonly kickYaw = new Spring(260, 20);
  private readonly kickRoll = new Spring(220, 18);
  private readonly slap = new Spring(320, 19);
  private slideT = 0;
  private dryT = -1;
  private reloadActive = false;
  private reloadEmpty = false;
  private reloadExitT = 0;
  private reloadGrace = 0;
  private readonly reloadFlags = { slapped: false, racked: false };
  private lastMag = -1;
  private throwT = -1;
  private ventT = 0;
  private flare = 0;
  private drumAngle = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tA = new THREE.Vector3();
  private readonly tB = new THREE.Vector3();
  private readonly tC = new THREE.Vector3();
  private tplR: THREE.Object3D | null = null;
  private readonly hipPos = new THREE.Vector3();
  private readonly hipEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private hipWeapon: WeaponId | null = null;
  private hipAspect = 0;
  private tplL: THREE.Object3D | null = null;
  private tplFist: THREE.Object3D | null = null;

  constructor(private readonly weapons: WeaponModelFactory, private readonly engine: RenderEngine) {
    this.scene.name = 'viewmodel';
    this.camera.name = 'viewmodelCamera';
    this.scene.add(this.camera, this.rig);
    const env = viewmodelEnvironment(engine.renderer);
    if (env) {
      this.scene.environment = env;
      this.scene.environmentIntensity = 0.5;
    }
    this.key = new THREE.DirectionalLight('#ffd9b0', 2.4);
    this.key.position.set(-0.7, 1.0, 0.55);
    this.fill = new THREE.DirectionalLight('#aac6db', 0.55);
    this.fill.position.set(1.0, -0.15, 0.5);
    this.rim = new THREE.DirectionalLight('#ff9a4a', 1.3);
    this.rim.position.set(1.1, 0.5, -1.0);
    this.hemi = new THREE.HemisphereLight('#d2dbe2', '#5a4a40', 0.65);
    this.scene.add(this.key, this.fill, this.rim, this.hemi);
    this.scene.add(this.gloves.right, this.gloves.left, this.gloves.canister, this.steam.points);
    // Off-screen hand targets (camera space): where magazines / shells come from.
    this.pocket.position.set(-0.14, -0.4, -0.2);
    this.pocket.rotation.set(-0.9, 0.3, 0.5);
    this.throwHold.position.set(-0.17, -0.17, -0.44);
    this.throwHold.rotation.set(0.3, 0.2, 0.6);
    this.scene.add(this.pocket, this.throwHold);
    const self = this;
    this.anim = {
      get id(): WeaponId {
        return self.weapon;
      },
      part: (name) => (this.model?.parts[name] as THREE.Object3D | undefined) ?? null,
      rest: (o) => this.rests.get(o),
    };
    this.setWeapon('meridian', 'factory');
  }

  // ── API ──────────────────────────────────────────────────────────────────

  setWeapon(id: WeaponId, skin: string): void {
    if (this.model && id === this.weapon && skin === this.skin) return;
    const key = `${id}|${skin}`;
    let m = this.models.get(key);
    if (!m) {
      m = this.weapons.create(id, skin, 'view') as WeaponModelView;
      m.root.traverse((o) => {
        o.renderOrder = 1;
        o.frustumCulled = false;
      });
      this.models.set(key, m);
    }
    if (this.model) {
      this.restoreParts();
      this.rig.remove(this.model.root);
    }
    this.model = m;
    this.weapon = id;
    this.skin = skin;
    this.rig.add(m.root);
    this.rests.clear();
    const save = (o: THREE.Object3D | undefined): void => {
      if (o) this.rests.set(o, { pos: o.position.clone(), rot: o.rotation.clone() });
    };
    for (const k of ['mag', 'bolt', 'pump', 'slide', 'shell', 'coil'] as const) save(m.parts[k]);
    for (const v of m.vents) save(v);
    const pose = POSES[id];
    this.kickBack.stiffness = 340 * pose.snap;
    this.kickPitch.stiffness = 280 * pose.snap;
    this.reloadActive = false;
    this.reloadExitT = 0;
    this.lastMag = -1;
    this.ventT = 0;
    this.drumAngle = 0;
    // Glove templates for this weapon (cached meshes; swapped without allocation per frame).
    this.tplR = this.gloves.template('gripR', m.meta.gripR ?? 0.023);
    this.tplL = m.meta.supportGrip ? this.gloves.template('gripL', m.meta.supportR ?? 0.02) : this.gloves.template('support', m.meta.supportR ?? 0.032);
    this.tplFist = this.gloves.template('gripL', 0.018);
    this.gloves.use(this.tplR, this.tplL);
  }

  private restoreParts(): void {
    for (const [o, r] of this.rests) {
      o.position.copy(r.pos);
      o.rotation.copy(r.rot);
      o.visible = true;
    }
    const sh = this.model?.parts.shell;
    if (sh) sh.visible = false;
  }

  fire(): void {
    const k = POSES[this.weapon].kick;
    this.kickBack.impulse(k[0] * 24);
    this.kickPitch.impulse(k[1] * 24);
    this.kickYaw.impulse((Math.random() - 0.5) * k[2] * 44);
    this.kickRoll.impulse((Math.random() - 0.5) * k[3] * 44);
    this.slideT = 0.09;
    if (this.weapon === 'sunspear') {
      this.ventT = 1.2;
      this.flare = 1;
    }
    if (this.weapon === 'pulse') this.flare = Math.max(this.flare, 0.45);
    // A shell interrupts a Breaker reload.
    if (this.reloadActive && this.weapon === 'breaker') this.reloadActive = false;
  }

  dryFire(): void {
    this.dryT = 0;
  }

  reloadStart(empty: boolean): void {
    if (this.weapon === 'sunspear') return;
    this.reloadActive = true;
    this.reloadGrace = 0.12;
    this.reloadEmpty = empty;
    this.reloadFlags.slapped = false;
    this.reloadFlags.racked = false;
    this.shell.clock = 0;
    this.shell.shellClock = 0;
    this.shell.empty = empty;
    const w = WEAPONS[this.weapon];
    this.shell.per = w.reloadPerRound ?? 0.42;
    this.shell.lead = w.reloadTime * 0.25 + (empty ? w.reloadEmptyExtra : 0);
  }

  throwStart(kind: ThrowableId): void {
    this.throwT = 0;
    this.gloves.showCanister(null);
    this.throwKind = kind;
  }
  private throwKind: ThrowableId = 'smoke';

  setTeamLight(color: string): void {
    this.rim.color.set(color);
    this.gloves.setTeamColor(color);
  }

  /** Extra: gloves/armor style of the local faction (0 Halcyon, 1 Bloom). */
  setFaction(f: 0 | 1): void {
    this.gloves.setFaction(f);
  }

  /** Extra: tint the key/fill lights to the current map's mood. */
  setLighting(l: MapLighting): void {
    this.key.color.set(l.sunColor).lerp(_tint.set('#ffe6c4'), 0.45);
    this.key.intensity = 2.0 + 0.3 * Math.min(1.5, l.sunIntensity / 2.5);
    this.fill.color.set(l.hemiSky).lerp(_tint.set('#b7cbd8'), 0.5);
    this.hemi.color.set(l.hemiSky).lerp(_tint.set('#d8d8d4'), 0.4);
    this.hemi.groundColor.set(l.hemiGround).lerp(_tint.set('#4a3f38'), 0.5);
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

    this.adsK = s.ads;
    const adsE = ease(clamp01(s.ads));
    const fov = VM_VIEW.fov + (VM_VIEW.adsFov - VM_VIEW.fov) * adsE;
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const calm = 1 - 0.88 * adsE;

    // Blend weights.
    const reloading = s.reload >= 0 || this.reloadActive;
    this.sprintK = damp(this.sprintK, s.sprinting && s.ads < 0.2 && !reloading && this.throwT < 0 ? 1 : 0, 8, dt);
    this.slideK = damp(this.slideK, s.sliding ? 1 : 0, 10, dt);
    this.crouchK = damp(this.crouchK, s.crouch, 8, dt);

    // Landing dip (the state has no impact speed: scale by air time).
    if (!s.onGround) this.airTime += dt;
    else {
      if (!this.wasGround && this.airTime > 0.12) this.landSpring.impulse(-Math.min(0.5, 0.16 + this.airTime * 0.45));
      this.airTime = 0;
    }
    this.wasGround = s.onGround;

    // Figure-8 movement bob.
    const moving = s.onGround && !s.sliding ? THREE.MathUtils.clamp(s.speed / 5.4, 0, 1.5) : 0;
    this.bobAmp = damp(this.bobAmp, moving, 7, dt);
    this.bobPhase += dt * (s.sprinting ? 11 : 8.6) * THREE.MathUtils.clamp(s.speed / 5.4, 0.6, 1.5);
    const ba = this.bobAmp * calm * (1 + this.sprintK * 0.9);
    const bobX = Math.sin(this.bobPhase) * 0.0075 * ba;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.009 * ba + 0.0045 * ba;
    const bobRoll = Math.sin(this.bobPhase) * 0.018 * ba;
    const bobPitch = Math.sin(this.bobPhase * 2) * 0.01 * ba;

    // Idle breathing (fades while moving and aiming).
    const br = (0.35 + 0.65 * calm) * (1 - this.bobAmp * 0.5);
    const breathY = Math.sin(this.time * 1.6) * 0.0016 * br;
    const breathP = Math.sin(this.time * 1.6 + 0.7) * 0.0035 * br;
    const breathYaw = Math.sin(this.time * 0.9) * 0.002 * br;

    // Look sway: the weapon lags against the look direction, then springs back.
    const inv = dt > 0 ? 1 / dt : 60;
    const swayK = 1 - 0.75 * adsE;
    const tx = THREE.MathUtils.clamp(s.lookDx * inv * 0.011, -0.07, 0.07) * swayK;
    const ty = THREE.MathUtils.clamp(-s.lookDy * inv * 0.009, -0.05, 0.05) * swayK;
    const sx = this.swayX.step(dt, tx);
    const sy = this.swayY.step(dt, ty);
    const spx = this.swayPos.step(dt, -tx * 0.14);

    const land = this.landSpring.step(dt);
    const kb = this.kickBack.step(dt) * (1 - 0.3 * adsE);
    const kp = this.kickPitch.step(dt) * (1 - 0.45 * adsE);
    const ky = this.kickYaw.step(dt) * (1 - 0.5 * adsE);
    const kr = this.kickRoll.step(dt);
    const sl = this.slap.step(dt);

    // Base pose: hip ↔ ADS (sight anchor on the view axis at its eye relief).
    const eye = m.meta.eye ?? 0.12;
    const sp = m.sight.position;
    this.solveHip(pose, sp);
    const hip = this.hipPos;
    let px = hip.x + (-sp.x - hip.x) * adsE;
    let py = hip.y + (-sp.y - hip.y) * adsE;
    let pz = hip.z + (-eye - sp.z - hip.z) * adsE;
    let rx = pose.hipRot[0] * (1 - adsE);
    let ry = pose.hipRot[1] * (1 - adsE);
    let rz = pose.hipRot[2] * (1 - adsE);

    px += bobX + spx;
    py += bobY + breathY + land * 0.055 - this.crouchK * 0.01 * calm;
    pz += kb;
    rx += breathP + kp + sy + land * 0.1 + bobPitch;
    ry += sx + ky + breathYaw;
    rz += bobRoll + kr + sx * 0.6 + this.crouchK * 0.05 * calm;

    // Sprint carry: lowered, turned across the body, rolling with the stride.
    const sk = this.sprintK;
    px += pose.sprintPos[0] * sk;
    py += pose.sprintPos[1] * sk;
    pz += pose.sprintPos[2] * sk;
    rx += pose.sprint[0] * sk + Math.sin(this.bobPhase * 2) * 0.035 * sk;
    ry += pose.sprint[1] * sk + Math.sin(this.bobPhase) * 0.04 * sk;
    rz += pose.sprint[2] * sk;

    // Slide tilt.
    px -= 0.02 * this.slideK;
    py -= 0.03 * this.slideK;
    rz += 0.24 * this.slideK;

    // Swap: lower & raise (comes up from below, rotated).
    const raise = easeOut(clamp01(s.raise));
    py -= (1 - raise) * 0.24;
    rx -= (1 - raise) * 0.7;
    rz += (1 - raise) * 0.25;

    // Dry-fire click: short nose-dip + roll twitch.
    if (this.dryT >= 0) {
      this.dryT += dt;
      const d = bump(seg(this.dryT, 0, 0.16));
      rx -= d * 0.02;
      rz -= d * 0.03;
      pz += d * 0.004;
      if (this.dryT > 0.16) this.dryT = -1;
    }

    // Reload / cycle choreography (parts + hands + presentation).
    const o = resetPose(this.pose);
    this.animate(dt, s, o);
    if (o.slap) this.slap.impulse(o.slap * 1.4);
    if (o.flare) this.flare = Math.max(this.flare, o.flare);
    px += o.x;
    py += o.y + sl * 0.018;
    pz += o.z;
    rx += o.rx - sl * 0.05;
    ry += o.ry;
    rz += o.rz;

    // Sunspear charge: brace, then a rising tremor.
    if (this.weapon === 'sunspear') {
      const c = clamp01(s.charge);
      const tremor = c * c * 0.0022;
      px += Math.sin(this.time * 71) * tremor;
      py += Math.sin(this.time * 57 + 1.3) * tremor;
      pz += c * 0.014;
      rz += Math.sin(this.time * 43) * tremor * 2;
    }

    // Throw: weapon dips right while the left hand hurls the canister.
    let throwK = 0;
    if (this.throwT >= 0) {
      this.throwT += dt;
      const t = this.throwT;
      throwK = bump(seg(t, 0, 0.78));
      py -= throwK * 0.07;
      px += throwK * 0.03;
      rx -= throwK * 0.3;
      rz -= throwK * 0.22;
      if (t > 0.8) {
        this.throwT = -1;
        this.gloves.showCanister(null);
      }
    }

    this.rig.position.set(px, py, pz);
    this.rig.rotation.set(rx, ry, rz, 'YXZ');
    this.rig.visible = !s.scoped;
    this.rig.updateMatrixWorld(true);

    // Hands follow their anchors.
    this.placeHands(o, m);
    if (this.throwT >= 0) this.animateThrow(this.throwT);
    this.gloves.right.visible = this.gloves.left.visible = !s.scoped;

    // Parts independent of the pose.
    this.animateSlide(dt);
    this.animateCharge(dt, s, m);
    this.animateDrum(dt, s, m);
    m.setAmmo(s.mag, s.magSize);
    m.tick(dt);
    this.lastMag = s.mag;
    const h = this.engine.size.height || 720;
    this.steam.update(dt, (h * this.engine.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)));
  }

  /** Grip position that puts the sight anchor at the pose's screen spot (cached per weapon/aspect). */
  private solveHip(pose: Pose, sight: THREE.Vector3): void {
    const aspect = THREE.MathUtils.clamp(this.camera.aspect, 1.3, 1.95);
    if (this.hipWeapon === this.weapon && Math.abs(aspect - this.hipAspect) < 1e-4) return;
    this.hipWeapon = this.weapon;
    this.hipAspect = aspect;
    const t = Math.tan(THREE.MathUtils.degToRad(VM_VIEW.fov) / 2);
    const d = pose.hip[2];
    this.hipEuler.set(pose.hipRot[0], pose.hipRot[1], pose.hipRot[2], 'YXZ');
    _q1.setFromEuler(this.hipEuler);
    const off = _p2.copy(sight).applyQuaternion(_q1);
    this.hipPos.set(pose.hip[0] * d * t * aspect - off.x, pose.hip[1] * d * t - off.y, -d - off.z);
  }

  // ── Choreography ─────────────────────────────────────────────────────────

  private animate(dt: number, s: ViewModelState, o: VmPose): void {
    const m = this.model!;
    if (s.reload >= 0 && !this.reloadActive && this.weapon !== 'sunspear') this.reloadStart(s.mag <= 0);
    if (this.reloadGrace > 0) this.reloadGrace -= dt;
    // (A reload announced through reloadStart() survives one stale frame of state.)
    if (s.reload < 0 && this.reloadActive && this.reloadGrace <= 0) {
      this.reloadActive = false;
      this.reloadExitT = this.weapon === 'breaker' ? 0.4 : 0.001;
      this.drumAngle = 0;
    }
    if (this.reloadActive) {
      const p = clamp01(s.reload);
      switch (this.weapon) {
        case 'meridian':
          reloadMeridian(this.anim, p, this.reloadEmpty, o, this.reloadFlags);
          break;
        case 'swift':
          reloadSwift(this.anim, p, this.reloadEmpty, o, this.reloadFlags);
          break;
        case 'longline':
          reloadLongline(this.anim, p, this.reloadEmpty, o, this.reloadFlags);
          break;
        case 'pulse':
          reloadPulse(this.anim, p, this.reloadEmpty, o, this.reloadFlags);
          break;
        case 'breaker': {
          const st = this.shell;
          st.clock += dt;
          st.shellClock += dt;
          if (this.lastMag >= 0 && s.mag > this.lastMag) {
            st.shellClock = 0;
            o.slap = 0.35;
          }
          if (st.clock < st.lead) st.shellClock = 0;
          st.missing = s.magSize - s.mag;
          reloadBreaker(this.anim, st, o);
          break;
        }
        default:
          break;
      }
      return;
    }
    // Settle out of a reload (restore every part once).
    if (this.reloadExitT > 0) {
      const wasBreaker = this.weapon === 'breaker';
      this.reloadExitT = Math.max(0, this.reloadExitT - dt);
      this.restoreParts();
      if (wasBreaker) {
        const k = this.reloadExitT / 0.4;
        const e = ease(k);
        o.rz += -1.2 * e;
        o.rx += 0.32 * e;
        o.ry += 0.28 * e;
        o.x += -0.1 * e;
        o.y += 0.13 * e;
        o.z += 0.02 * e;
        o.left.a = 'pocket';
        o.left.b = 'support';
        o.left.k = ease(1 - k);
      }
    }
    // Pump / bolt cycle after a shot.
    if ((this.weapon === 'breaker' || this.weapon === 'longline') && s.cycle < 1) {
      const interval = 60 / WEAPONS[this.weapon].rpm;
      const t = clamp01(s.cycle) * interval;
      const c = seg(t, CYCLE_DELAY, interval - 0.04);
      if (this.weapon === 'breaker') cycleBreaker(this.anim, c, o);
      else cycleLongline(this.anim, c, o);
    }
  }

  private animateSlide(dt: number): void {
    const slide = this.model?.parts.slide;
    if (!slide) return;
    const r = this.rests.get(slide);
    if (!r) return;
    if (this.slideT > 0) this.slideT = Math.max(0, this.slideT - dt);
    const k = this.slideT > 0 ? bump(1 - this.slideT / 0.09) : 0;
    slide.position.set(r.pos.x, r.pos.y, r.pos.z + k * 0.022);
  }

  private animateCharge(dt: number, s: ViewModelState, m: WeaponModelView): void {
    this.flare = Math.max(0, this.flare - dt * (this.weapon === 'sunspear' ? 1.4 : 2.4));
    if (this.weapon === 'sunspear') m.setCharge(Math.max(clamp01(s.charge), this.flare));
    else if (this.weapon === 'pulse') m.setCharge(this.flare);
    // Vents: snap open after the shot, breathe steam, ease shut.
    if (this.ventT > 0) {
      const before = this.ventT;
      this.ventT = Math.max(0, this.ventT - dt);
      const t = 1.2 - this.ventT;
      if (Math.floor(before * 14) !== Math.floor(this.ventT * 14) && t > 0.08 && t < 0.95) {
        for (const v of m.vents) this.steam.emit(v.getWorldPosition(_p1), 1);
      }
    }
    const t = 1.2 - this.ventT;
    const open = this.ventT > 0 ? easeOut(seg(t, 0.02, 0.12)) * (1 - ease(seg(t, 0.8, 1.2))) : 0;
    for (const v of m.vents) {
      const r = this.rests.get(v);
      if (r) v.rotation.x = r.rot.x + open * 0.95;
    }
  }

  private animateDrum(dt: number, s: ViewModelState, m: WeaponModelView): void {
    if (this.weapon !== 'swift' || this.reloadActive) return;
    const drum = m.parts.mag;
    const r = drum ? this.rests.get(drum) : undefined;
    if (!drum || !r) return;
    // The pan turns a notch per round fed.
    const target = s.magSize > 0 ? -((s.magSize - s.mag) / s.magSize) * Math.PI * 1.8 : 0;
    this.drumAngle = damp(this.drumAngle, target, 18, dt);
    drum.rotation.set(r.rot.x, r.rot.y + this.drumAngle, r.rot.z);
  }

  // ── Hands ────────────────────────────────────────────────────────────────

  private anchor(k: HandKey, m: WeaponModelView): THREE.Object3D {
    switch (k) {
      case 'grip':
        return m.handR;
      case 'support':
        return m.handL;
      case 'pocket':
        return this.pocket;
      default:
        return m.anchors[k] ?? m.handL;
    }
  }

  /** World (= camera-space, the vm camera sits at the origin) transform of a hand plan. */
  private resolve(h: HandPlan, m: WeaponModelView, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const a = this.anchor(h.a, m);
    a.updateWorldMatrix(true, false);
    a.matrixWorld.decompose(pos, quat, _s);
    if (h.k <= 0 || h.a === h.b) return;
    const b = this.anchor(h.b, m);
    b.updateWorldMatrix(true, false);
    b.matrixWorld.decompose(_p2, _q2, _s);
    pos.lerp(_p2, h.k);
    quat.slerp(_q2, h.k);
  }

  private placeHands(o: VmPose, m: WeaponModelView): void {
    const g = this.gloves;
    // Left hand: support template on the foregrip, a fist when holding parts.
    const l = o.left;
    const k = l.k < 0.5 ? l.a : l.b;
    const holding = (k !== 'support' && k !== 'pocket') || (this.throwT >= 0 && this.throwT < 0.62);
    g.use(this.tplR, holding ? this.tplFist : this.tplL);
    this.resolve(l, m, _p1, _q1);
    this.aimForearm(g.left, _p1, _q1, SHOULDER_L, holding ? 0.85 : 0.35);
    this.resolve(o.right, m, _p1, _q1);
    const rk = o.right.k < 0.5 ? o.right.a : o.right.b;
    this.aimForearm(g.right, _p1, _q1, SHOULDER_R, rk === 'grip' ? 0.35 : 0.8);
  }

  /**
   * Places a glove, then swings it (about the wrist) so its forearm heads for
   * the shoulder — hands holding parts in odd orientations keep believable arms.
   */
  private aimForearm(hand: THREE.Group, pos: THREE.Vector3, quat: THREE.Quaternion, shoulder: THREE.Vector3, weight: number): void {
    hand.position.copy(pos);
    hand.quaternion.copy(quat);
    const f = this.gloves.forearmDir(hand);
    if (!f || weight <= 0) return;
    const cur = this.tA.copy(f).applyQuaternion(quat);
    const want = this.tB.subVectors(shoulder, pos).normalize();
    _q2.setFromUnitVectors(cur, want);
    _q3.identity().slerp(_q2, weight);
    hand.quaternion.premultiply(_q3);
  }

  private animateThrow(t: number): void {
    const g = this.gloves;
    // Left hand: leave the gun, wind up with the canister, hurl it forward.
    const wind = ease(seg(t, 0.0, 0.22));
    const hurl = ease(seg(t, 0.22, 0.36));
    const back = ease(seg(t, 0.42, 0.78));
    const rest = this.tA.copy(g.left.position);
    const reach = this.tB.set(-0.07, -0.06, -0.5);
    const hand = this.tC.copy(rest).lerp(this.throwHold.position, wind);
    if (hurl > 0) hand.lerp(reach, hurl);
    if (back > 0) hand.lerp(rest, back);
    g.left.position.copy(hand);
    g.left.quaternion.slerp(this.throwHold.quaternion, clamp01(wind - back) * 0.9);
    // Canister rides the hand, then flies (shrinking into the distance).
    const release = 0.33;
    if (t < release) {
      g.showCanister(this.throwKind);
      g.canister.position.set(hand.x + 0.01, hand.y + 0.045, hand.z - 0.02);
      g.canister.rotation.set(t * 4, 0.4, 0.2);
      g.canister.scale.setScalar(1);
    } else if (t < 0.62) {
      const f = (t - release) / 0.29;
      g.canister.position.set(-0.07 + f * 0.06, -0.04 + f * 0.16 - f * f * 0.12, -0.52 - f * 1.4);
      g.canister.rotation.set(t * 14, 0.4, t * 5);
      g.canister.scale.setScalar(1 - f * 0.55);
    } else g.showCanister(null);
  }

  dispose(): void {
    for (const m of this.models.values()) m.dispose();
    this.models.clear();
    this.gloves.dispose();
    this.steam.dispose();
    this.scene.clear();
  }
}

const _tint = new THREE.Color();
