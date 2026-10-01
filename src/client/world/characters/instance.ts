// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — one animated character (CharacterView implementation).
//
// Render cost: body = ONE SkinnedMesh draw (shared geometry + shared material)
// + the third-person weapon model + (low preset) a blob shadow.
//
// Animation is procedural and allocation-free. Each update:
//  1. smooth the discrete flags into blend weights (crouch, slide, air, sprint,
//     ADS, reload, mantle, charge) and advance the gait phase by DISTANCE
//     travelled (stride length scales with speed → planted feet, no skating);
//  2. pose hips / spine / chest (aim pitch shared along the spine, bladed
//     stance, lean, breathing, weight shift, flinch) and the head, which
//     always looks exactly where the player aims;
//  3. legs: analytic foot trajectories (stance → swing with lift, toe-off and
//     heel-strike) in the movement direction, turned into bone rotations by
//     two-bone IK — crouch, slide, airborne tuck and mantle are just other
//     foot/hip targets for the same solver; the lower body lags yaw turns and
//     shuffles to catch up instead of spinning on the spot;
//  4. weapon: placed in the AIM frame around a shoulder pivot (hip ready ↔ ADS
//     with the sight on the eye line), blended toward sprint / reload / mantle
//     / showcase low-ready poses, plus fire kick; hands follow the grips by IK;
//     the reload drives the magazine part with the support hand;
//  5. secondary motion: antenna, Bloom fronds, scarf and loincloth flaps on
//     damped springs fed by body acceleration and a little wind.
// All world-space queries (muzzle, head) use cached root-space points, so they
// are exact even before the renderer updates world matrices.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { CharacterAnim, CharacterOptions, CharacterView, WeaponModelFactory } from '../../contracts';
import type { Faction, Team, Vec3, WeaponId } from '../../../shared/types';
import { WEAPONS } from '../../../shared/weapons';
import { damp, smoothNoise, Spring } from '../../engine/camera-feel';
import type { WeaponModelView } from '../weapon-models';
import { bodyGeometry, releaseBodyGeometry, triangleCount } from './body';
import { HOLDS, PALM, lookBasis, twoBone, type Hold } from './ik';
import type { Detail } from './kit';
import { CHARGE_COLOR, blobShadow, fxMaterial, releaseFxMaterial, sharedMaterial, syncColorMode, tierFor, type CharMaterial, type MatTier } from './material';
import { BONES, PARENT, rigFor, type BoneName, type RigDef } from './rig';

const WEAPON_SCALE = 1.0;
const SPAWN_TIME = 0.7;
/** Distance LOD thresholds (m) with hysteresis. */
const LOD_FAR = 26;
const LOD_NEAR = 22;
const ONE = new THREE.Vector3(1, 1, 1);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const bump = (a: number, b: number, x: number): number => (x <= a || x >= b ? 0 : Math.sin(((x - a) / (b - a)) * Math.PI));
const wrapPi = (a: number): number => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};

// Scratch (module level: single-threaded, never retained).
const _m = new THREE.Matrix4();
const _mi = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qUp = new THREE.Quaternion();
const _qLo = new THREE.Quaternion();
const _qAim = new THREE.Quaternion();
const _qW = new THREE.Quaternion();
const _qHand = new THREE.Quaternion();
const _e = new THREE.Euler();
const _eW = new THREE.Euler(0, 0, 0, 'YXZ');
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _pw = new THREE.Vector3();
const _piv = new THREE.Vector3();
const _hold = new THREE.Vector3();
const _feet = [new THREE.Vector3(), new THREE.Vector3()];
const _footPitch = [0, 0];

/** Hand orientations in WEAPON space (fingers, knuckles). */
const GRIP_R_FWD = new THREE.Vector3(0, -0.5, -1);
const GRIP_R_UP = new THREE.Vector3(1, 0.2, 0);
const SUPPORT_FWD = new THREE.Vector3(0.12, 0.12, -1);
const SUPPORT_UP = new THREE.Vector3(-0.75, -0.65, 0);
const PISTOL_L_FWD = new THREE.Vector3(0.4, -0.4, -1);
const PISTOL_L_UP = new THREE.Vector3(-0.85, 0.3, 0.1);

let instanceSerial = 0;

export class CharacterInstance implements CharacterView {
  readonly root = new THREE.Group();
  readonly faction: Faction;
  readonly showcase: boolean;
  readonly detail: Detail;
  private team: Team;
  private readonly friendly: boolean;
  private readonly tier: MatTier;
  private readonly rig: RigDef;
  private readonly bones = {} as Record<BoneName, THREE.Bone>;
  private readonly body: THREE.SkinnedMesh;
  private readonly geoNear: THREE.BufferGeometry;
  private readonly geoFar: THREE.BufferGeometry | null;
  private readonly castShadow: boolean;
  private material: CharMaterial;
  private fx: CharMaterial | null = null;
  private readonly blob: THREE.Mesh | null;
  private weapon: WeaponModelView | null = null;
  private weaponId: WeaponId | null = null;
  private weaponSkin = '';
  private hold: Hold = HOLDS.meridian;
  private readonly skins: CharacterOptions['cosmetics']['skins'];
  // Weapon anchors (weapon space, unscaled).
  private readonly gripR = new THREE.Vector3();
  private readonly gripL = new THREE.Vector3();
  private readonly sight = new THREE.Vector3();
  private readonly muzzleL = new THREE.Vector3();
  private readonly magRest = new THREE.Vector3();
  private readonly pumpRest = new THREE.Vector3();
  private magUp = false;
  // Cached root-space points.
  private readonly muzzleRoot = new THREE.Vector3(0, 1.3, -0.8);
  private readonly headRoot = new THREE.Vector3(0, 1.7, 0);
  // Root-space bone transforms (per frame).
  private readonly mHips = new THREE.Matrix4();
  private readonly mSpine = new THREE.Matrix4();
  private readonly mChest = new THREE.Matrix4();
  private readonly mNeck = new THREE.Matrix4();
  private readonly mHead = new THREE.Matrix4();
  private readonly mClav = [new THREE.Matrix4(), new THREE.Matrix4()];
  private readonly qHips = new THREE.Quaternion();
  private readonly qSpine = new THREE.Quaternion();
  private readonly qChest = new THREE.Quaternion();
  private readonly qNeck = new THREE.Quaternion();
  private readonly qClav = [new THREE.Quaternion(), new THREE.Quaternion()];

  // ── Animation state ──
  private time: number;
  private readonly seed: number;
  private phase = 0;
  private gait = 0;
  private speed = 0;
  private mdx = 0;
  private mdz = -1;
  private mdRawX = 0;
  private mdRawZ = -1;
  private crouch = 0;
  private slide = 0;
  private air = 0;
  private airTuck = 0;
  private sprint = 0;
  private ads = 0;
  private reload = 0;
  private reloadT = -1;
  private mantle = 0;
  private charge = 0;
  private pitch = 0;
  private relaxed = 0;
  private sinceFire = 99;
  private legYaw = 0;
  private lastYaw = NaN;
  private turning = false;
  private shuffle = 0;
  private wasAir = false;
  private airVy = 0;
  private cycleT = 99;
  private spawnT = 1;
  private flashT = 0;
  private highlight = 0;
  private dt = 1 / 60;
  private kickX = 0;
  private flPX = 0;
  private flRX = 0;
  private landX = 0;
  private hipsYaw = 0;
  private gDuty = 0.58;
  private gS = 0.3;
  private gCycle = 1.2;
  private gDrop = 0;
  private gBob = 0;
  private breath = 0;
  private inspectW = 0;
  private readonly vLocal = new THREE.Vector2();
  private readonly accel = new THREE.Vector2();
  private readonly kick = new Spring(240, 18);
  private readonly flP = new Spring(120, 11);
  private readonly flR = new Spring(120, 11);
  private readonly land = new Spring(90, 11);
  private readonly sw = {
    antX: new Spring(110, 7), antZ: new Spring(110, 7),
    frX: new Spring(45, 5), frZ: new Spring(45, 5),
    scX: new Spring(22, 4.2), scZ: new Spring(22, 4.2),
    flF: new Spring(60, 7), flB: new Spring(40, 5),
  };

  constructor(private readonly weapons: WeaponModelFactory, opts: CharacterOptions) {
    this.faction = opts.faction;
    this.team = opts.team;
    this.friendly = opts.friendly;
    this.showcase = !!opts.showcase;
    this.skins = opts.cosmetics.skins ?? {};
    this.rig = rigFor(opts.faction);
    this.detail = this.showcase ? 2 : opts.quality.preset === 'low' ? 0 : 1;
    this.tier = this.showcase ? 'standard' : tierFor(opts.quality.preset);
    this.seed = ++instanceSerial * 7.31;
    this.time = (instanceSerial * 1.618) % 10;
    this.root.name = `character.${opts.faction === 0 ? 'halcyon' : 'bloom'}`;

    // Skeleton in rest pose.
    const list: THREE.Bone[] = [];
    for (const name of BONES) {
      const b = new THREE.Bone();
      b.name = name;
      const r = this.rig.rest[name];
      b.position.set(r.pos[0], r.pos[1], r.pos[2]);
      b.rotation.set(r.rot[0], r.rot[1], r.rot[2]);
      this.bones[name] = b;
      list.push(b);
      const p = PARENT[name];
      (p ? this.bones[p] : this.root).add(b);
    }
    this.root.updateMatrixWorld(true);

    const geo = bodyGeometry(opts.faction, opts.cosmetics.armor, opts.cosmetics.visor, this.detail);
    this.material = sharedMaterial(this.tier, this.team, this.friendly);
    this.body = new THREE.SkinnedMesh(geo, this.material);
    this.body.name = 'body';
    // Distance LOD (gameplay tier only): beyond ~26 m the body swaps to the
    // low-preset geometry (same skeleton, same bind space, same material) —
    // ≈55 % fewer triangles for the main AND shadow passes where the extra
    // detail is sub-pixel. Switched in onBeforeRender (takes effect next frame).
    this.geoNear = geo;
    this.geoFar = this.detail === 1 ? bodyGeometry(opts.faction, opts.cosmetics.armor, opts.cosmetics.visor, 0) : null;
    if (this.geoFar) this.body.onBeforeRender = this.pickLod;
    this.root.add(this.body);
    this.body.bind(new THREE.Skeleton(list));
    // Generous fixed bounds (animation never leaves them) → no per-frame skinned bounds.
    this.body.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.45);
    this.castShadow = this.showcase || opts.quality.shadows !== 'off';
    this.body.castShadow = this.castShadow;
    this.body.receiveShadow = opts.quality.shadows === 'high' || this.showcase;
    this.blob = !this.showcase && opts.quality.shadows === 'off' ? blobShadow() : null;
    if (this.blob) this.root.add(this.blob);

    this.setWeapon('meridian', this.skins.meridian ?? 'factory');
    if (this.showcase) this.spawnT = 0;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  setWeapon(id: WeaponId, skin: string): void {
    if (this.weapon && id === this.weaponId && skin === this.weaponSkin) return;
    this.weapon?.dispose();
    const w = this.weapons.create(id, skin, 'world') as WeaponModelView;
    w.root.scale.setScalar(WEAPON_SCALE);
    w.root.traverse((o) => {
      o.castShadow = this.castShadow;
      o.receiveShadow = false;
    });
    this.bones.weapon.add(w.root);
    this.weapon = w;
    this.weaponId = id;
    this.weaponSkin = skin;
    const h = (this.hold = HOLDS[id]);
    this.gripR.fromArray(w.handR ? [w.handR.position.x, w.handR.position.y, w.handR.position.z] : h.gripR);
    this.gripL.fromArray(w.handL ? [w.handL.position.x, w.handL.position.y, w.handL.position.z] : h.gripL);
    if (w.sight) this.sight.copy(w.sight.position);
    else this.sight.set(0, 0.15, 0.05);
    this.muzzleL.copy(w.muzzle.position);
    const mag = w.parts.mag;
    if (mag) this.magRest.copy(mag.position);
    this.magUp = !!mag && mag.position.y > 0.05;
    if (w.parts.pump) this.pumpRest.copy(w.parts.pump.position);
    this.reloadT = -1;
  }

  fire(): void {
    this.kick.impulse(3.2 * this.hold.kick);
    this.sinceFire = 0;
    this.cycleT = 0;
  }

  flinch(dir: Vec3): void {
    const yaw = this.root.rotation.y;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    // World → local (right, back).
    const lx = dir.x * c - dir.z * s;
    const lz = dir.x * s + dir.z * c;
    this.flP.impulse(-lz * 2.6);
    this.flR.impulse(-lx * 2.6);
    this.flashT = 0.12;
  }

  die(): void {
    this.root.visible = false;
  }

  respawn(): void {
    this.root.visible = true;
    this.kick.reset();
    this.flP.reset();
    this.flR.reset();
    this.land.reset();
    this.spawnT = 0;
    this.reloadT = -1;
    this.lastYaw = NaN;
    this.legYaw = 0;
  }

  /** Re-run the materialize sweep without toggling visibility. */
  materialize(): void {
    this.spawnT = 0;
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    return out.copy(this.muzzleRoot).applyMatrix4(this.root.matrixWorld);
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false);
    return out.copy(this.headRoot).applyMatrix4(this.root.matrixWorld);
  }

  setHighlight(k: number): void {
    this.highlight = clamp01(k);
  }

  /** Switch team (team swap / FFA) — only the material changes. */
  setTeam(team: Team): void {
    if (team === this.team) return;
    this.team = team;
    this.material = sharedMaterial(this.tier, team, this.friendly);
    if (this.fx) {
      releaseFxMaterial(this.fx);
      this.fx = null;
    }
    this.body.material = this.material;
  }

  /** Render cost of this character (body / weapon / total), for budgets and debug overlays. */
  stats(): { drawCalls: number; triangles: number; bodyTriangles: number; weaponDrawCalls: number; weaponTriangles: number } {
    let draws = 0;
    let tris = 0;
    let wDraws = 0;
    let wTris = 0;
    const wRoot = this.weapon?.root ?? null;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      const n = triangleCount(m.geometry);
      draws++;
      tris += n;
      for (let p: THREE.Object3D | null = m; p; p = p.parent) {
        if (p === wRoot) {
          wDraws++;
          wTris += n;
          break;
        }
      }
    });
    return { drawCalls: draws, triangles: Math.round(tris), bodyTriangles: Math.round(triangleCount(this.body.geometry)), weaponDrawCalls: wDraws, weaponTriangles: Math.round(wTris) };
  }

  dispose(): void {
    this.weapon?.dispose();
    this.weapon = null;
    if (this.fx) releaseFxMaterial(this.fx);
    this.fx = null;
    this.body.skeleton.dispose();
    // Rendering: return the shared body geometries to the refcounted cache
    // (characters/body.ts keeps a few idle ones warm, disposes the rest LRU).
    releaseBodyGeometry(this.geoNear, this);
    releaseBodyGeometry(this.geoFar, this);
    this.root.removeFromParent();
  }

  // ── Update ──────────────────────────────────────────────────────────────

  update(dt: number, a: CharacterAnim): void {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    syncColorMode();
    if (a.weapon !== this.weaponId) this.setWeapon(a.weapon, this.skins[a.weapon] ?? 'factory');
    this.root.rotation.y = a.yaw;
    if (!a.alive) return;
    this.dt = dt;
    this.advance(dt, a);
    this.poseBody();
    this.poseLegs();
    this.poseWeaponAndArms(a);
    this.poseSecondary();
    this.updateMaterial(a);
  }

  private advance(dt: number, a: CharacterAnim): void {
    const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
    const vf = -a.vel.x * sy - a.vel.z * cy;
    const vr = a.vel.x * cy - a.vel.z * sy;
    // Local acceleration (secondary motion) — smoothed.
    const ax = (vr - this.vLocal.x) / Math.max(dt, 1e-3);
    const az = (-vf - this.vLocal.y) / Math.max(dt, 1e-3);
    this.accel.x = damp(this.accel.x, THREE.MathUtils.clamp(ax, -40, 40), 10, dt);
    this.accel.y = damp(this.accel.y, THREE.MathUtils.clamp(az, -40, 40), 10, dt);
    this.vLocal.set(vr, -vf);

    const speed = Math.hypot(vf, vr);
    this.speed = damp(this.speed, speed, 12, dt);
    const grounded = !a.airborne && !a.sliding && !a.mantling;
    if (speed > 0.3) {
      // Smooth an unnormalized direction (so a 180° reversal passes through
      // zero and flips), then normalize for use.
      const k = 1 - Math.exp(-12 * dt);
      this.mdRawX += (vr / speed - this.mdRawX) * k;
      this.mdRawZ += (-vf / speed - this.mdRawZ) * k;
      const l = Math.hypot(this.mdRawX, this.mdRawZ);
      if (l > 1e-3) {
        this.mdx = this.mdRawX / l;
        this.mdz = this.mdRawZ / l;
      }
    }
    this.gait = damp(this.gait, grounded ? smooth(0.2, 1.5, speed) : 0, 9, dt);
    this.crouch = damp(this.crouch, clamp01(a.crouch), 14, dt);
    this.slide = damp(this.slide, a.sliding ? 1 : 0, 11, dt);
    this.air = damp(this.air, a.airborne && !a.mantling && !a.sliding ? 1 : 0, 10, dt);
    this.airTuck = damp(this.airTuck, clamp01(0.45 + a.vel.y * 0.12), 6, dt);
    this.sprint = damp(this.sprint, a.sprinting && !a.ads && !a.reloading ? 1 : 0, 8, dt);
    this.ads = damp(this.ads, a.ads && !a.sprinting ? 1 : 0, 13, dt);
    this.mantle = damp(this.mantle, a.mantling ? 1 : 0, 14, dt);
    this.charge = damp(this.charge, a.charging ? 1 : 0, a.charging ? 3.5 : 9, dt);
    this.pitch = damp(this.pitch, THREE.MathUtils.clamp(a.pitch, -1.25, 1.25), 20, dt);
    this.sinceFire += dt;
    this.cycleT += dt;
    const alert = a.ads || a.reloading || this.sinceFire < 2.5 || speed > 0.5 || a.charging || this.showcase;
    this.relaxed = damp(this.relaxed, alert ? 0 : 1, alert ? 10 : 1.5, dt);

    // Reload clock (starts on the rising edge).
    if (a.reloading) {
      if (this.reloadT < 0) this.reloadT = 0;
      else this.reloadT += dt;
    } else this.reloadT = -1;
    this.reload = damp(this.reload, a.reloading && WEAPONS[a.weapon].reloadTime > 0 ? 1 : 0, 9, dt);

    // Landing dip.
    if (a.airborne) this.airVy = Math.min(this.airVy, a.vel.y);
    if (this.wasAir && !a.airborne) {
      this.land.impulse(Math.min(2.2, Math.max(0, -this.airVy) * 0.28));
      this.airVy = 0;
    }
    this.wasAir = a.airborne;

    // Lower body lags yaw turns, then shuffles to catch up.
    if (Number.isNaN(this.lastYaw)) this.lastYaw = a.yaw;
    const dy = wrapPi(a.yaw - this.lastYaw);
    this.lastYaw = a.yaw;
    this.legYaw = THREE.MathUtils.clamp(this.legYaw - dy, -1.3, 1.3);
    if (this.gait > 0.3 || a.sliding || a.airborne || a.mantling) {
      this.legYaw = damp(this.legYaw, 0, 12, dt);
      this.turning = false;
    } else if (Math.abs(this.legYaw) > 0.7) this.turning = true;
    if (this.turning) {
      this.legYaw = damp(this.legYaw, 0, 6, dt);
      if (Math.abs(this.legYaw) < 0.06) this.turning = false;
    }
    this.shuffle = damp(this.shuffle, this.turning ? 1 : 0, 10, dt);

    // Gait phase advances by distance travelled.
    this.gaitParams(this.speed);
    this.phase = (this.phase + (this.speed * dt) / this.gCycle + this.shuffle * dt * 1.7) % 1;

    this.flashT = Math.max(0, this.flashT - dt);
    if (this.spawnT < 1) this.spawnT = Math.min(1, this.spawnT + dt / SPAWN_TIME);

    // Springs.
    this.kickX = this.kick.step(dt);
    this.flPX = this.flP.step(dt);
    this.flRX = this.flR.step(dt);
    this.landX = this.land.step(dt);

    // Showcase: occasional weapon inspect (every ~12 s).
    this.inspectW = this.showcase ? bump(7, 9.6, (this.time + this.seed) % 12.5) * (1 - this.ads) : 0;
  }

  /**
   * Stride model — cadence first. The cycle distance D (two steps) grows with
   * speed, giving ≈3.8 steps/s for an ADS walk, ≈4.8 running, ≈5.5 sprinting
   * (the old reach-first model ran at 10–11 steps/s: frantic scurrying).
   * The planted foot must still sweep 2S under the hips at exactly body speed,
   * so S is limited by the leg's reach from the hip height — the hips drop
   * into an athletic running crouch (and a bent-knee tactical ADS walk) to buy
   * reach — and the duty factor follows: duty = 2S / D (more flight when fast).
   */
  private gaitParams(speed: number): void {
    const rig = this.rig;
    const cr = this.crouch * (1 - this.slide);
    const ads = this.ads * (1 - cr);
    const D = THREE.MathUtils.clamp(0.9 + 0.25 * speed, 0.9, 3.2) * (1 - cr * 0.1);
    const drop = this.gait * (0.035 + 0.015 * Math.min(speed, 8) + ads * 0.07) + cr * rig.crouchDrop;
    const bobAmp = Math.min(0.055, 0.012 + speed * 0.0065) * this.gait * (1 - ads * 0.5);
    const legLen = (rig.thigh + rig.shin) * 0.97;
    const v = rig.rest.hips.pos[1] + rig.rest.thighL.pos[1] - drop + bobAmp - rig.ankle;
    const reach = v < legLen ? Math.sqrt(legLen * legLen - v * v) * 0.95 : 0.05;
    const dutyWanted = 0.62 - 0.3 * smooth(1, 6.5, speed);
    const S = Math.max(0.05, Math.min((dutyWanted * D) / 2, reach));
    const duty = THREE.MathUtils.clamp((2 * S) / D, 0.2, 0.7);
    this.gDuty = duty;
    this.gS = S;
    this.gCycle = (2 * S) / duty; // = D unless the duty clamp kicked in
    this.gDrop = drop - cr * rig.crouchDrop;
    this.gBob = bobAmp;
  }

  // ── Torso & head ────────────────────────────────────────────────────────

  private setRot(name: BoneName, x: number, y: number, z: number): void {
    const r = this.rig.rest[name].rot;
    this.bones[name].quaternion.setFromEuler(_e.set(r[0] + x, r[1] + y, r[2] + z));
  }

  private chain(out: THREE.Matrix4, outQ: THREE.Quaternion, parent: THREE.Matrix4 | null, parentQ: THREE.Quaternion | null, b: THREE.Bone): void {
    _m.compose(b.position, b.quaternion, ONE);
    if (parent && parentQ) {
      out.multiplyMatrices(parent, _m);
      outQ.multiplyQuaternions(parentQ, b.quaternion);
    } else {
      out.copy(_m);
      outQ.copy(b.quaternion);
    }
  }

  private poseBody(): void {
    const B = this.bones;
    const rig = this.rig;
    const t = this.time;
    const g = this.gait;
    const ph = this.phase * Math.PI * 2;
    const sl = this.slide;
    const cr = this.crouch * (1 - sl);
    const sc = this.showcase ? 1 : 0;
    const bloom = this.faction === 1 ? 1 : 0;
    const duty = this.gDuty;
    const rest = rig.rest.hips.pos;

    // Hips: running crouch, bob (low at mid-stance), sway toward the stance
    // foot, crouch, slide, landing.
    const bob = -this.gBob * Math.cos(2 * (ph - Math.PI * duty)) - this.gDrop;
    const swayX = -0.02 * g * Math.cos(ph - Math.PI * duty);
    const idleShift = Math.sin(t * 0.37 + this.seed) * 0.012 * (1 - g);
    const slideY = rest[1] - 0.47;
    B.hips.position.set(
      rest[0] + swayX + idleShift + sc * 0.028,
      rest[1] + bob - cr * rig.crouchDrop - sl * slideY - this.landX * 0.075 + this.air * 0.02,
      rest[2] + cr * 0.05 - sl * 0.05,
    );
    const strafe = -this.mdx * 0.38 * (this.mdz <= 0.25 ? 1 : -1) * g;
    const hipsYaw = this.legYaw * 0.75 + strafe + Math.sin(ph) * 0.09 * g * (1 - this.sprint * 0.3) - sc * 0.12 + sl * 0.35;
    const hipsRoll = Math.cos(ph - Math.PI * duty) * 0.045 * g + Math.sin(t * 0.37 + this.seed) * 0.02 * (1 - g) + sc * 0.05;
    const hipsPitch = -cr * 0.2 + sl * 0.32 - g * 0.05 - this.sprint * 0.07 - this.mantle * 0.2;
    this.setRot('hips', hipsPitch, hipsYaw, hipsRoll);
    this.hipsYaw = hipsYaw;

    // Spine / chest: aim pitch share, bladed stance, lean, breathing, flinch.
    const blade = this.hold.blade * (1 - this.sprint * 0.6) * (1 - sc * 0.35) * (1 - sl * 0.4);
    const pAim = this.pitch * (1 - this.sprint * 0.75) * (1 - this.mantle) * (1 - sc);
    const lean = g * 0.07 + this.sprint * 0.2 + cr * 0.24 + this.ads * 0.05 + this.mantle * 0.4 + this.air * 0.06 - sl * 0.1 + this.relaxed * 0.02;
    const breathRate = 1.55 + g * 1.2 + this.sprint * 1.1;
    this.breath += breathRate * this.dt;
    const breath = Math.sin(this.breath) * (0.012 + sc * 0.006) * (1 - g * 0.6);
    const twist = blade - hipsYaw;
    const counter = -Math.sin(ph) * 0.05 * g;
    this.setRot('spine', -lean * 0.45 - hipsPitch * 0.55 + pAim * 0.22 + this.flPX * 0.5 + breath * 0.5, twist * 0.45 + counter, this.flRX * 0.5 - hipsRoll * 0.6);
    this.setRot('chest', -lean * 0.55 + pAim * 0.33 + this.flPX * 0.3 - this.kickX * 0.025 + breath, twist * 0.55 + counter, this.flRX * 0.3 - hipsRoll * 0.3 - bloom * Math.sin(t * 0.9 + this.seed) * 0.015);
    // Shoulders: breathe; the support shoulder reaches forward for rifles.
    const reach = (this.hold.pistol ? 0.02 : 0.05) * (1 - this.sprint * 0.5);
    const lift = Math.sin(this.breath) * 0.004;
    const cl = rig.rest.clavL.pos;
    const cr2 = rig.rest.clavR.pos;
    B.clavL.position.set(cl[0], cl[1] + lift, cl[2] - reach);
    B.clavR.position.set(cr2[0], cr2[1] + lift, cr2[2] - 0.01 * (1 - this.sprint * 0.5));
    this.setRot('clavL', 0, 0, -Math.sin(this.breath) * 0.01);
    this.setRot('clavR', 0, 0, Math.sin(this.breath) * 0.01);

    // Root-space chain for the torso.
    this.chain(this.mHips, this.qHips, null, null, B.hips);
    this.chain(this.mSpine, this.qSpine, this.mHips, this.qHips, B.spine);
    this.chain(this.mChest, this.qChest, this.mSpine, this.qSpine, B.chest);
    this.chain(this.mClav[0], this.qClav[0], this.mChest, this.qChest, B.clavL);
    this.chain(this.mClav[1], this.qClav[1], this.mChest, this.qChest, B.clavR);

    // Head always looks where the player aims (plus character).
    this.setRot('neck', pAim * 0.12 + lean * 0.3, -blade * 0.35, 0);
    this.chain(this.mNeck, this.qNeck, this.mChest, this.qChest, B.neck);
    let hy = 0;
    let hp = this.pitch * (1 - this.sprint * 0.55) - this.ads * 0.05 + this.mantle * 0.35 - this.relaxed * 0.06;
    let hr = -this.ads * 0.14 + bloom * 0.07;
    if (sc) {
      const inspect = this.inspectW;
      hy = smoothNoise(t * 0.23, this.seed) * 0.28 * (1 - inspect) + inspect * 0.35;
      hp = smoothNoise(t * 0.17, this.seed + 3) * 0.06 - 0.05 - inspect * 0.4;
      hr += smoothNoise(t * 0.2, this.seed + 9) * 0.04;
    }
    if (bloom) {
      // Bloom: small, twitchy, animal head movements.
      hy += smoothNoise(t * 1.3, this.seed + 1) * 0.05 * (1 - this.ads);
      hr += smoothNoise(t * 1.1, this.seed + 5) * 0.04;
    }
    _q.setFromEuler(_eW.set(hp, hy, hr, 'YXZ'));
    B.head.quaternion.copy(_q2.copy(this.qNeck).invert().multiply(_q));
    this.chain(this.mHead, _q2, this.mNeck, this.qNeck, B.head);
    this.headRoot.fromArray(rig.headCenter).applyMatrix4(this.mHead);
  }

  // ── Legs ────────────────────────────────────────────────────────────────

  private poseLegs(): void {
    const rig = this.rig;
    const B = this.bones;
    const g = this.gait;
    const sp = this.speed;
    const cr = this.crouch * (1 - this.slide);
    const sc = this.showcase ? 1 : 0;
    const duty = this.gDuty;
    const S = this.gS;
    const liftH = Math.min(0.26, 0.07 + 0.024 * sp) * (1 - 0.35 * cr);
    const stepK = Math.max(g, this.shuffle * 0.6);
    const strideK = smooth(0.08, 0.7, sp) * smooth(0, 0.3, g);
    const back = this.mdz > 0.3 ? 1 : 0;
    const ly = this.legYaw * (1 - this.slide) + this.slide * 0.3;
    const cl = Math.cos(ly), sl = Math.sin(ly);
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      const st = i === 0 ? rig.stanceL : rig.stanceR;
      // Idle stance (crouch widens/staggers, showcase = contrapposto).
      let ix = st[0] * (1 + cr * 0.2);
      let iz = st[2] + cr * (i === 0 ? -0.1 : 0.12);
      if (sc) {
        ix = i === 0 ? -0.165 : 0.1;
        iz = i === 0 ? -0.1 : 0.05;
      }
      // Gait trajectory.
      const p = (this.phase + (i ? 0.5 : 0)) % 1;
      let d: number, lift: number, pitch: number;
      if (p < duty) {
        const s = p / duty;
        d = S * (1 - 2 * s);
        lift = 0;
        pitch = -smooth(0.62, 1, s) * 0.5;
      } else {
        const s = (p - duty) / (1 - duty);
        d = -S + 2 * S * (s * s * (3 - 2 * s));
        lift = Math.sin(Math.PI * s);
        pitch = -0.5 + 0.72 * smooth(0, 0.85, s);
      }
      if (back) pitch *= -0.4;
      // Stance base blends from idle; the stride itself ramps in faster so the
      // planted foot keeps pace with the body even at slow speeds (no skating).
      const bx = ix + (st[0] * 0.85 + sx * Math.abs(this.mdx) * 0.045 - ix) * g;
      const bz = iz * (1 - g);
      let fx = bx + this.mdx * d * strideK;
      let fz = bz + this.mdz * d * strideK;
      let fy = lift * liftH * stepK;
      let fp = pitch * stepK;
      // Rotate with the lagging lower body.
      const rx = fx * cl + fz * sl;
      const rz = -fx * sl + fz * cl;
      fx = rx;
      fz = rz;
      // Slide / airborne / mantle targets.
      if (this.slide > 0.001) {
        const k = this.slide;
        fx += ((i === 0 ? -0.1 : 0.2) - fx) * k;
        fy += ((i === 0 ? 0.1 : 0.06) - fy) * k;
        fz += ((i === 0 ? -0.62 : 0.12) - fz) * k;
        fp += ((i === 0 ? 0.55 : -0.3) - fp) * k;
      }
      if (this.air > 0.001) {
        const k = this.air * (1 - this.slide);
        const tuck = this.airTuck;
        const ax = i === 0 ? -0.1 : 0.12;
        const ay = (i === 0 ? 0.1 : 0.06) + tuck * (i === 0 ? 0.28 : 0.16);
        const az = (i === 0 ? -0.08 : 0.1) + tuck * (i === 0 ? -0.07 : 0.03);
        fx += (ax - fx) * k;
        fy += (ay - fy) * k;
        fz += (az - fz) * k;
        fp += (-0.35 - fp) * k;
      }
      if (this.mantle > 0.001) {
        const k = this.mantle;
        fx += ((i === 0 ? -0.1 : 0.11) - fx) * k;
        fy += ((i === 0 ? 0.46 : 0.12) - fy) * k;
        fz += ((i === 0 ? -0.3 : 0.14) - fz) * k;
      }
      _feet[i].set(fx, fy, fz);
      _footPitch[i] = fp;
      // Ankle target: heel lift when the toes point down.
      const heel = fp < 0 ? Math.sin(-fp) * 0.12 : 0;
      _t.set(fx - Math.sin(ly) * heel * 0.3, fy + rig.ankle + heel, fz + Math.cos(ly) * heel * 0.3);
      // IK in hips space.
      _mi.copy(this.mHips).invert();
      _t.applyMatrix4(_mi);
      const knee = i === 1 && this.slide > 0.5 ? 0.35 : 0;
      _pole.set(sx * (0.12 + cr * 0.25) + knee, -knee, -1).applyAxisAngle(Y_AXIS, ly);
      _q.copy(this.qHips).invert();
      _pole.applyQuaternion(_q);
      const thigh = i === 0 ? B.thighL : B.thighR;
      const shin = i === 0 ? B.shinL : B.shinR;
      const foot = i === 0 ? B.footL : B.footR;
      twoBone(thigh.position, _t, _pole, rig.thigh, rig.shin, -1, _qUp, _qLo);
      thigh.quaternion.copy(_qUp);
      shin.quaternion.copy(_qLo);
      // Foot: flat on the ground (plus toe-off / heel-strike), toes slightly out.
      _q2.setFromEuler(_eW.set(fp, ly + sx * 0.08, 0, 'YXZ'));
      _q.copy(this.qHips).multiply(_qUp).multiply(_qLo).invert();
      foot.quaternion.copy(_q.multiply(_q2));
    }
  }

  // ── Weapon & arms ───────────────────────────────────────────────────────

  private poseWeaponAndArms(a: CharacterAnim): void {
    const rig = this.rig;
    const B = this.bones;
    const h = this.hold;
    const t = this.time;
    const sc = this.showcase ? 1 : 0;
    const s = WEAPON_SCALE;
    const ads = this.ads * (1 - this.reload) * (1 - this.sprint);

    // Aim frame (root space: the root already carries yaw).
    const pAimW = this.pitch * (1 - this.sprint * 0.85) * (1 - this.mantle * 0.8) * (1 - sc);
    _qAim.setFromAxisAngle(X_AXIS, pAimW);
    _piv.fromArray(rig.pivot).applyMatrix4(this.mChest);

    // Hip ↔ ADS (sight on the eye line).
    _hold.fromArray(h.hip);
    if (ads > 0.001) {
      _a.fromArray(rig.eye).applyMatrix4(this.mHead);
      _b.set(0, 0, -h.ads).applyQuaternion(_qAim).add(_a);
      _c.copy(this.sight).multiplyScalar(s).applyQuaternion(_qAim);
      _b.sub(_c).sub(_piv);
      _q.copy(_qAim).invert();
      _b.applyQuaternion(_q);
      _hold.lerp(_b, ads);
    }
    let ex = 0, ey = 0, ez = 0;
    // Relaxed low-ready when idle for a while (calm, not threatening).
    _hold.y -= this.relaxed * 0.035;
    ex -= this.relaxed * 0.24;
    ey += this.relaxed * 0.1;
    // Sprint: weapon lowered across the body.
    if (this.sprint > 0.001) {
      const k = this.sprint;
      _hold.lerp(h.pistol ? SPRINT_PISTOL : SPRINT_RIFLE, k);
      ex += (h.pistol ? -0.9 : -0.6) * k;
      ey += (h.pistol ? 0.2 : 0.78) * k;
      ez += (h.pistol ? 0.1 : 0.5) * k;
    }
    // Reload: tilt the magazine well toward the support hand.
    if (this.reload > 0.001) {
      const k = this.reload;
      _hold.x -= 0.04 * k;
      _hold.y += 0.02 * k;
      _hold.z += 0.08 * k;
      ex += 0.3 * k;
      ey += 0.22 * k;
      ez += (this.magUp ? -0.3 : 0.62) * k;
    }
    // Mantle: weapon swung low to the side, support hand on the ledge.
    if (this.mantle > 0.001) {
      const k = this.mantle;
      _hold.lerp(MANTLE_POS, k);
      ex += -1.1 * k;
      ey += 0.35 * k;
      ez += 0.2 * k;
    }
    // Showcase hero idle: relaxed low ready — the rifle lies diagonally across
    // the body (stock under the right arm, muzzle toward the left knee) so it
    // reads as a clean diagonal from the menu camera instead of pointing at
    // it; occasional weapon inspect.
    if (sc) {
      const k = 1 - this.ads;
      _hold.lerp(h.pistol ? LOW_READY_PISTOL : LOW_READY, k);
      ex += (h.pistol ? -0.85 : -0.5) * k + smoothNoise(t * 0.4, this.seed) * 0.03;
      ey += (h.pistol ? 0.2 : 0.95) * k;
      ez += (h.pistol ? 0.1 : 0.3) * k;
      const w = this.inspectW;
      _hold.x -= 0.03 * w;
      _hold.y += 0.12 * w;
      _hold.z += 0.05 * w;
      ex += 0.45 * w;
      ey -= 0.3 * w;
      ez += 0.7 * w;
    }
    ex += this.air * 0.08 + this.kickX * 0.16 + this.flPX * 0.06;
    ez += this.flRX * 0.08 + Math.sin(t * 43) * 0.005 * this.charge;
    _hold.z += this.kickX * 0.075;
    _qW.setFromEuler(_eW.set(ex, ey, ez, 'YXZ')).premultiply(_qAim);
    _pw.copy(_hold).applyQuaternion(_qAim).add(_piv);
    B.weapon.position.copy(_pw);
    B.weapon.quaternion.copy(_qW);
    this.muzzleRoot.copy(this.muzzleL).multiplyScalar(s).applyQuaternion(_qW).add(_pw);

    // Weapon moving parts: magazine (reload) and pump (after a Breaker shot).
    const w = this.weapon;
    let magOff = 0;
    let magVisible = true;
    const u = this.reloadT >= 0 ? this.reloadT / Math.max(0.3, WEAPONS[a.weapon].reloadTime) : -1;
    const perRound = WEAPONS[a.weapon].reloadPerRound;
    if (u >= 0 && !perRound) {
      if (u < 0.36) magOff = -0.2 * smooth(0.14, 0.34, u);
      else if (u < 0.5) magVisible = false;
      else magOff = -0.2 * (1 - smooth(0.52, 0.72, u));
      if (this.magUp) magOff = -magOff * 0.8;
    }
    if (w?.parts.mag) {
      w.parts.mag.position.set(this.magRest.x, this.magRest.y + magOff, this.magRest.z);
      w.parts.mag.visible = magVisible;
    }
    let pumpOff = 0;
    if (w?.parts.pump) {
      pumpOff = bump(0.12, 0.55, this.cycleT) * 0.075;
      w.parts.pump.position.set(this.pumpRest.x, this.pumpRest.y, this.pumpRest.z + pumpOff);
    }

    // ── Right hand on the grip.
    _a.copy(this.gripR).multiplyScalar(s).applyQuaternion(_qW).add(_pw);
    _fwd.copy(GRIP_R_FWD).applyQuaternion(_qW);
    _up.copy(GRIP_R_UP).applyQuaternion(_qW);
    lookBasis(_fwd, _up, _qHand);
    _a.sub(_c.copy(PALM).applyQuaternion(_qHand));
    _pole.set(h.pistol ? 0.55 : 0.8, h.pistol ? -0.8 : -0.55, h.pistol ? 0.2 : 0.35);
    this.solveArm(1, _a, _pole, _qHand);

    // ── Left hand: support grip / reload / ledge.
    _a.set(this.gripL.x, this.gripL.y, this.gripL.z + pumpOff).multiplyScalar(s).applyQuaternion(_qW).add(_pw);
    _fwd.copy(h.pistol ? PISTOL_L_FWD : SUPPORT_FWD).applyQuaternion(_qW);
    _up.copy(h.pistol ? PISTOL_L_UP : SUPPORT_UP).applyQuaternion(_qW);
    lookBasis(_fwd, _up, _qHand);
    if (u >= 0 && this.reload > 0.01) {
      // Magazine position (hand grips it from below / above).
      _b.set(this.magRest.x, this.magRest.y + magOff + (this.magUp ? 0.05 : -0.06), this.magRest.z).multiplyScalar(s).applyQuaternion(_qW).add(_pw);
      // Belt pouch (left front).
      _c.set(-0.14, -0.02, -0.1).applyMatrix4(this.mHips);
      let toMag: number, toPouch: number;
      if (perRound) {
        // Shell by shell: pouch → loading port, repeatedly.
        const v = Math.max(0, this.reloadT - 0.2) / perRound;
        toMag = smooth(0, 0.2, this.reloadT) * (0.5 + 0.5 * Math.cos(v * Math.PI * 2));
        toPouch = (1 - toMag) * smooth(0, 0.2, this.reloadT);
        _b.set(0, -0.03, -0.12).multiplyScalar(s).applyQuaternion(_qW).add(_pw);
      } else {
        toMag = smooth(0.0, 0.14, u) * (1 - smooth(0.8, 0.95, u));
        toPouch = smooth(0.34, 0.46, u) * (1 - smooth(0.5, 0.64, u));
      }
      const k = this.reload;
      _a.lerp(_b, toMag * k).lerp(_c, toPouch * k);
    }
    if (this.mantle > 0.001) {
      _b.set(-0.2, 1.42, -0.46);
      _a.lerp(_b, this.mantle);
      _fwd.set(0.1, 0.25, -1);
      _up.set(0, 1, 0.3);
      lookBasis(_fwd, _up, _q2);
      _qHand.slerp(_q2, this.mantle);
    }
    _a.sub(_c.copy(PALM).applyQuaternion(_qHand));
    _pole.set(h.pistol ? -0.55 : -0.45, -0.85, h.pistol ? 0.2 : 0.15);
    this.solveArm(0, _a, _pole, _qHand);
  }

  /** Arm IK in clavicle space; `handQ` = desired root-space hand orientation. */
  private solveArm(i: 0 | 1, wrist: THREE.Vector3, poleRoot: THREE.Vector3, handQ: THREE.Quaternion): void {
    const B = this.bones;
    const up = i === 0 ? B.upperArmL : B.upperArmR;
    const fore = i === 0 ? B.forearmL : B.forearmR;
    const hand = i === 0 ? B.handL : B.handR;
    _mi.copy(this.mClav[i]).invert();
    _t.copy(wrist).applyMatrix4(_mi);
    _q.copy(this.qClav[i]).invert();
    _b.copy(poleRoot).normalize().applyQuaternion(_q);
    twoBone(up.position, _t, _b, this.rig.upper, this.rig.fore, 1, _qUp, _qLo);
    up.quaternion.copy(_qUp);
    fore.quaternion.copy(_qLo);
    _q.copy(this.qClav[i]).multiply(_qUp).multiply(_qLo).invert();
    hand.quaternion.copy(_q.multiply(handQ));
  }

  // ── Secondary motion ────────────────────────────────────────────────────

  private poseSecondary(): void {
    const dt = this.dt;
    const t = this.time;
    const g = this.gait;
    const ax = this.accel.x;
    const az = this.accel.y;
    const bounce = Math.sin(this.phase * Math.PI * 4) * g;
    // Menu showcase gets a slightly livelier breeze through fronds and cloth.
    const wind = smoothNoise(t * 0.7, this.seed + 11) * (this.showcase ? 1.8 : 1);
    const S = this.sw;
    const set = this.setSway;
    if (this.faction === 0) {
      const x = S.antX.step(dt, THREE.MathUtils.clamp(-az * 0.01, -0.35, 0.35) + bounce * 0.05 + this.kickX * 0.05);
      const z = S.antZ.step(dt, THREE.MathUtils.clamp(ax * 0.01, -0.35, 0.35) + wind * 0.02);
      set('antenna', x, z);
      return;
    }
    const fx = S.frX.step(dt, THREE.MathUtils.clamp(-az * 0.012, -0.3, 0.3) + bounce * 0.06 + wind * 0.05);
    const fz = S.frZ.step(dt, THREE.MathUtils.clamp(ax * 0.012, -0.3, 0.3) + smoothNoise(t * 0.9, this.seed + 4) * 0.05);
    set('fronds', fx, fz);
    const sp = this.speed;
    const scx = S.scX.step(dt, -Math.min(0.9, sp * 0.1) - az * 0.01 + wind * 0.08 - this.slide * 0.5 + this.air * 0.3);
    const scz = S.scZ.step(dt, ax * 0.012 + smoothNoise(t * 1.1, this.seed + 7) * 0.06);
    set('scarf', scx, scz);
    const swing = Math.max(0, -Math.min(_feet[0].z, _feet[1].z)) * 1.5;
    const ff = S.flF.step(dt, Math.min(0.9, swing + this.crouch * 0.75 + this.slide * 0.9) + wind * 0.03);
    const fb = S.flB.step(dt, -Math.min(0.7, sp * 0.06) - this.crouch * 0.35 - this.slide * 0.3 + this.air * 0.2 + wind * 0.04);
    set('flapF', ff, 0);
    set('flapB', fb, 0);
  }

  /** Distance LOD switch with hysteresis (bound once; allocation-free). */
  private readonly pickLod = (_r: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera): void => {
    const far = this.geoFar;
    if (!far) return;
    const c = camera.matrixWorld.elements;
    const m = this.root.matrixWorld.elements;
    const dx = c[12] - m[12], dy = c[13] - m[13], dz = c[14] - m[14];
    const d2 = dx * dx + dy * dy + dz * dz;
    const cur = this.body.geometry;
    if (cur === this.geoNear && d2 > LOD_FAR * LOD_FAR) this.body.geometry = far;
    else if (cur === far && d2 < LOD_NEAR * LOD_NEAR) this.body.geometry = this.geoNear;
  };

  /** Secondary-motion bone rotation on top of its rest pose (bound once — no per-frame closure). */
  private readonly setSway = (name: BoneName, x: number, z: number): void => {
    const r = this.rig.rest[name].rot;
    this.bones[name].rotation.set(r[0] + x, r[1], r[2] + z);
  };

  // ── Material effects ────────────────────────────────────────────────────

  private updateMaterial(a: CharacterAnim): void {
    const need = this.spawnT < 1 || this.flashT > 0 || this.charge > 0.02 || this.highlight > 0.001;
    if (need) {
      if (!this.fx) this.fx = fxMaterial(this.tier, this.team, this.friendly);
      const u = this.fx.userData.hf;
      const base = this.material.userData.hf;
      const sp = this.spawnT;
      u.uSpawn.value = sp >= 1 ? 1 : sp * sp * (3 - 2 * sp);
      u.uFlash.value = (this.flashT / 0.12) * 0.3;
      u.uCharge.value.copy(CHARGE_COLOR).multiplyScalar(this.charge * 2.4);
      u.uGlowK.value = 1 + this.highlight * 1.2 + this.charge * 0.35;
      u.uRim.value.copy(base.uRim.value).multiplyScalar(1 + this.highlight * 2.5);
      if (this.body.material !== this.fx) this.body.material = this.fx;
    } else if (this.body.material !== this.material) this.body.material = this.material;
    if (this.weapon && a.weapon === 'sunspear') this.weapon.setCharge(Math.max(0.15, this.charge));
    if (this.blob) {
      const k = 1 - this.air * 0.6;
      this.blob.scale.set(k, 1, k);
      this.blob.visible = this.air < 0.9;
    }
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const SPRINT_RIFLE = new THREE.Vector3(-0.1, -0.2, -0.13);
const SPRINT_PISTOL = new THREE.Vector3(-0.06, -0.24, -0.16);
const MANTLE_POS = new THREE.Vector3(0.06, -0.3, -0.06);
const LOW_READY = new THREE.Vector3(-0.07, -0.25, -0.2);
const LOW_READY_PISTOL = new THREE.Vector3(-0.06, -0.3, -0.18);
