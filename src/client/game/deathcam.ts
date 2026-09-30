// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — camera director: every non-first-person camera of a match.
//
//  • intro  — fly-in from the map's showcase('intro') pose into the player's
//             eyes (eased position arc, quaternion slerp, FOV blend). Cut short
//             as soon as the match is live and the player moves or looks.
//  • death  — pulls back and up from where you fell, turns to find your killer
//             and keeps them framed with a slow drift; collision-clamped so it
//             never ends up inside walls. (Desaturation is applied by the match.)
//  • outro  — Launch Control: a slow dolly on showcase('outro') while the
//             winners' rocket lifts off. Other modes: a gentle orbit around the
//             MVP / final elimination.
// First person is computed by the match every frame and passed in; the
// director blends from/into it. Allocation-free per frame.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { ShowcasePose } from '../contracts';
import type { CollisionWorld } from '../../shared/physics';

export type CamMode = 'fp' | 'intro' | 'death' | 'outro';

export interface FirstPersonPose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Vertical FOV (degrees). */
  fov: number;
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

export class CameraDirector {
  mode: CamMode = 'intro';
  /** Seconds in the current mode. */
  t = 0;
  private dur = 1;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();
  private fromFov = 60;
  private readonly pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 55 };
  // death
  private readonly deathEye = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private deathYaw = 0;
  private readonly back = new THREE.Vector3();
  // outro
  private outroKind: 'rocket' | 'orbit' = 'orbit';
  private readonly center = new THREE.Vector3();
  private orbitA = 0;
  // scratch
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly m4 = new THREE.Matrix4();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly world: CollisionWorld) {}

  get cinematic(): boolean {
    return this.mode !== 'fp';
  }

  /** Intro fly-in from a showcase pose, lasting `duration` seconds. */
  startIntro(pose: ShowcasePose, duration: number): void {
    this.mode = 'intro';
    this.t = 0;
    this.dur = Math.max(0.4, duration);
    this.pose.pos.set(pose.pos.x, pose.pos.y, pose.pos.z);
    this.pose.target.set(pose.target.x, pose.target.y, pose.target.z);
    this.pose.fov = pose.fov;
  }

  /** Shortens the remaining intro (player took control). */
  hurryIntro(remaining = 0.35): void {
    if (this.mode !== 'intro') return;
    const left = this.dur - this.t;
    if (left <= remaining) return;
    // Keep the eased progress continuous: rescale time.
    const k = this.t / this.dur;
    this.dur = this.t + remaining;
    this.t = k * this.dur;
  }

  startDeath(camera: THREE.PerspectiveCamera, eye: THREE.Vector3, yaw: number): void {
    this.captureFrom(camera);
    this.mode = 'death';
    this.t = 0;
    this.deathEye.copy(eye);
    this.deathYaw = yaw;
    // Default look: where we were facing.
    this.lookAt.set(eye.x - Math.sin(yaw) * 6, eye.y, eye.z - Math.cos(yaw) * 6);
  }

  startOutro(camera: THREE.PerspectiveCamera, kind: 'rocket' | 'orbit', pose: ShowcasePose | null, center: THREE.Vector3 | null): void {
    this.captureFrom(camera);
    this.mode = 'outro';
    this.t = 0;
    this.outroKind = kind;
    if (kind === 'rocket' && pose) {
      this.pose.pos.set(pose.pos.x, pose.pos.y, pose.pos.z);
      this.pose.target.set(pose.target.x, pose.target.y, pose.target.z);
      this.pose.fov = pose.fov;
    } else {
      this.outroKind = 'orbit';
      this.center.copy(center ?? camera.position);
      this.orbitA = Math.atan2(camera.position.x - this.center.x, camera.position.z - this.center.z);
    }
  }

  toFirstPerson(): void {
    this.mode = 'fp';
    this.t = 0;
  }

  private captureFrom(camera: THREE.PerspectiveCamera): void {
    this.fromPos.copy(camera.position);
    this.fromQuat.copy(camera.quaternion);
    this.fromFov = camera.fov;
  }

  /**
   * Places the camera. `fp` is the first-person pose (always valid), `killer`
   * the killer's head position for the death cam (null if unknown/gone),
   * `orbitCenter` an updated center for the outro orbit (e.g. the MVP moving).
   */
  apply(dt: number, camera: THREE.PerspectiveCamera, fp: FirstPersonPose, killer: THREE.Vector3 | null, orbitCenter: THREE.Vector3 | null): void {
    this.t += dt;
    switch (this.mode) {
      case 'fp':
        camera.position.copy(fp.pos);
        camera.quaternion.copy(fp.quat);
        camera.fov = fp.fov;
        break;
      case 'intro':
        this.applyIntro(camera, fp);
        break;
      case 'death':
        this.applyDeath(dt, camera, killer);
        break;
      case 'outro':
        this.applyOutro(dt, camera, orbitCenter);
        break;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  private lookQuat(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
    this.m4.lookAt(from, to, this.up);
    return out.setFromRotationMatrix(this.m4);
  }

  private applyIntro(camera: THREE.PerspectiveCamera, fp: FirstPersonPose): void {
    const k = easeInOut(clamp01(this.t / this.dur));
    const start = this.pose.pos;
    // Arc: rise a little above the straight line mid-flight.
    this.p.lerpVectors(start, fp.pos, k);
    this.p.y += Math.sin(k * Math.PI) * Math.min(6, start.distanceTo(fp.pos) * 0.08);
    camera.position.copy(this.p);
    this.lookQuat(start, this.pose.target, this.q);
    camera.quaternion.slerpQuaternions(this.q, fp.quat, easeInOut(clamp01((this.t / this.dur - 0.25) / 0.75)));
    camera.fov = THREE.MathUtils.lerp(this.pose.fov, fp.fov, k);
    if (this.t >= this.dur) this.mode = 'fp';
  }

  private applyDeath(dt: number, camera: THREE.PerspectiveCamera, killer: THREE.Vector3 | null): void {
    const e = this.deathEye;
    // Look target: the killer if known, eased (no whip-pans).
    if (killer) this.lookAt.lerp(killer, 1 - Math.exp(-dt * 3.2));
    // Pull back away from what we look at, and up; drift slowly sideways.
    this.back.set(e.x - this.lookAt.x, 0, e.z - this.lookAt.z);
    if (this.back.lengthSq() < 1e-4) this.back.set(Math.sin(this.deathYaw), 0, Math.cos(this.deathYaw));
    this.back.normalize();
    const pull = easeOut(clamp01(this.t / 1.1));
    const drift = Math.sin(this.t * 0.35) * 0.35;
    const cs = Math.cos(drift);
    const sn = Math.sin(drift);
    const bx = this.back.x * cs - this.back.z * sn;
    const bz = this.back.x * sn + this.back.z * cs;
    const dist = 3.4 * pull;
    const rise = 1.7 * pull;
    // Collision: keep the camera in open space.
    let dx = bx * dist;
    let dy = rise;
    let dz = bz * dist;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 1e-3) {
      const hit = this.world.rayDist(e.x, e.y, e.z, dx / len, dy / len, dz / len, len + 0.3, 'sight');
      if (hit !== Infinity) {
        const k = Math.max(0, hit - 0.3) / len;
        dx *= k;
        dy *= k;
        dz *= k;
      }
    }
    this.p.set(e.x + dx, e.y + dy, e.z + dz);
    // Blend in from the first-person pose over the first 0.4 s.
    const b = easeInOut(clamp01(this.t / 0.4));
    camera.position.lerpVectors(this.fromPos, this.p, b);
    this.lookQuat(this.p, this.lookAt, this.q);
    camera.quaternion.slerpQuaternions(this.fromQuat, this.q, b);
    camera.fov = THREE.MathUtils.lerp(this.fromFov, 62, b);
  }

  private applyOutro(dt: number, camera: THREE.PerspectiveCamera, orbitCenter: THREE.Vector3 | null): void {
    const b = easeInOut(clamp01(this.t / 0.9));
    if (this.outroKind === 'rocket') {
      // Slow dolly toward the rocket; tilt up as it climbs.
      const k = easeOut(clamp01(this.t / 8));
      this.p.lerpVectors(this.pose.pos, this.pose.target, 0.12 * k);
      this.lookAt.copy(this.pose.target);
      this.lookAt.y += Math.max(0, this.t - 1.2) * 2.4;
      this.lookQuat(this.p, this.lookAt, this.q);
      camera.position.lerpVectors(this.fromPos, this.p, b);
      camera.quaternion.slerpQuaternions(this.fromQuat, this.q, b);
      camera.fov = THREE.MathUtils.lerp(this.fromFov, this.pose.fov, b);
      return;
    }
    if (orbitCenter) this.center.lerp(orbitCenter, 1 - Math.exp(-dt * 2));
    this.orbitA += dt * 0.22;
    const r = 5.2;
    const h = 2.1;
    const dx = Math.sin(this.orbitA) * r;
    const dz = Math.cos(this.orbitA) * r;
    const c = this.center;
    const len = Math.sqrt(dx * dx + h * h + dz * dz);
    const hit = this.world.rayDist(c.x, c.y + 1.2, c.z, dx / len, (h - 1.2) / len, dz / len, len, 'sight');
    const k = hit === Infinity ? 1 : Math.max(0.25, (hit - 0.3) / len);
    this.p.set(c.x + dx * k, c.y + 1.2 + (h - 1.2) * k, c.z + dz * k);
    this.lookAt.set(c.x, c.y + 1.1, c.z);
    this.lookQuat(this.p, this.lookAt, this.q);
    camera.position.lerpVectors(this.fromPos, this.p, b);
    camera.quaternion.slerpQuaternions(this.fromQuat, this.q, b);
    camera.fov = THREE.MathUtils.lerp(this.fromFov, 50, b);
  }
}
