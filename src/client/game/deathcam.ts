// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — camera director: every non-first-person camera of a match.
//
//  • intro  — fly-in from the map's showcase('intro') pose into the player's
//             eyes (eased Bézier arc, quaternion slerp, FOV blend). The path is
//             checked against the CollisionWorld first: the plain arc, a higher
//             arc, a drop-in from above the spawn — and if every path would clip
//             a wall, an establishing hold on the showcase pose, then a CUT to a
//             clear crane pose behind the player that flies into their eyes.
//             Cut short as soon as the match is live and the player moves or looks.
//  • death  — pulls back and up from where you fell, turns to find your killer
//             and keeps them framed with a slow drift; collision-clamped so it
//             never ends up inside walls. (Desaturation is applied by the match.)
//  • outro  — Launch Control: the map's showcase('outro') pose, then a slow
//             crane-up + sideways dolly (collision-clamped) while the view tilts
//             to follow the climb (looking a little low at ignition to catch the
//             flash and the steam ring), the FOV opening up; a distance-scaled
//             rumble at ignition (honours reduced shake). Other modes: a gentle
//             orbit around the MVP / final elimination.
// First person is computed by the match every frame and passed in; the
// director blends from/into it. Allocation-free per frame.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { ShowcasePose } from '../contracts';
import type { CollisionWorld } from '../../shared/physics';
import type { Vec3 } from '../../shared/types';
import { smoothNoise } from '../engine/camera-feel';
import { rocketAltitude, rocketFlash, ROCKET_LIFTOFF_T, ROCKET_MOUNT_H } from '../world/rocket';

/** How the intro reaches the player's eyes (see planIntro). */
export type IntroPlan = 'arc' | 'high' | 'drop' | 'cut';

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
const smooth = (a: number, b: number, t: number): number => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};
/** Fraction of the intro spent holding the establishing shot before a cut. */
const CUT_HOLD = 0.42;

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
  /** The straight swoop to the finale pose would fly through walls: cut instead. */
  private outroCut = false;
  private readonly center = new THREE.Vector3();
  private orbitA = 0;
  /** Rocket finale: pad position + scale (null = unknown → plain dolly). */
  private readonly rocketBase = new THREE.Vector3();
  private rocketScale = 0;
  /** Crane-up + sideways dolly offset (collision-clamped at outro start). */
  private readonly craneOff = new THREE.Vector3();
  private shakeScale = 1;
  // intro path
  plan: IntroPlan = 'arc';
  private planned = false;
  private readonly ctrl = new THREE.Vector3();
  private readonly cutPos = new THREE.Vector3();
  private readonly planFp = new THREE.Vector3();
  private readonly planQuat = new THREE.Quaternion();
  private planner: Generator<void, void, void> | null = null;
  /** Visible map geometry (opaque meshes) for intro path checks: collision alone
   *  misses decor-only volumes (hangar roofs above 12 m walls, facades…). */
  private occluders: { mesh: THREE.Mesh; box: THREE.Box3 }[] = [];
  private readonly ray = new THREE.Raycaster();
  private readonly hits: THREE.Intersection[] = [];
  private readonly segBox = new THREE.Box3();
  private readonly rayDir = new THREE.Vector3();
  private readonly rayOrg = new THREE.Vector3();
  /** Milliseconds the last intro plan took (dev readout). */
  planMs = 0;
  // scratch
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly qs = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
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
    this.planned = false;
    this.planner = null;
  }

  /** 0..1 multiplier from the "reduced screen shake" option (finale rumble). */
  setShakeScale(k: number): void {
    this.shakeScale = clamp01(Number.isFinite(k) ? k : 1);
  }

  /**
   * Map scene whose opaque meshes the intro fly-in must not pass through (in
   * addition to the collision world). Pass null to use collision only.
   */
  setOccluders(scene: THREE.Object3D | null): void {
    this.occluders = [];
    if (!scene) return;
    scene.updateMatrixWorld(true);
    const walk = (o: THREE.Object3D): void => {
      // Players (teammates standing in the spawn yard), effects and particles never block.
      if (!o.visible || /^(player|character|fx|particles)\./.test(o.name)) return;
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && m.frustumCulled && m.geometry?.attributes?.position) {
        const mat = m.material as THREE.Material | THREE.Material[];
        const mats = Array.isArray(mat) ? mat : [mat];
        // Glows, smoke, shafts, water sheets, the sky: see-through or not a surface.
        if (!mats.some((x) => x.transparent || !x.depthWrite || !x.depthTest || x.blending !== THREE.NormalBlending)) {
          const box = new THREE.Box3().setFromObject(m);
          // Ground sheets / decals never block a flight.
          if (!box.isEmpty() && box.max.y > 0.5) this.occluders.push({ mesh: m, box });
        }
      }
      for (const c of o.children) walk(c);
    };
    walk(scene);
  }

  /** Distance along a→dir to the first visible map surface (Infinity if none within len). */
  private visualDist(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, len: number, any = false): number {
    if (!this.occluders.length || len < 1e-4) return Infinity;
    const sb = this.segBox;
    sb.min.set(Math.min(ax, ax + dx * len), Math.min(ay, ay + dy * len), Math.min(az, az + dz * len));
    sb.max.set(Math.max(ax, ax + dx * len), Math.max(ay, ay + dy * len), Math.max(az, az + dz * len));
    this.ray.set(this.rayOrg.set(ax, ay, az), this.rayDir.set(dx, dy, dz));
    this.ray.near = 0;
    this.ray.far = len;
    let best = Infinity;
    for (const o of this.occluders) {
      if (!o.box.intersectsBox(sb)) continue;
      this.hits.length = 0;
      o.mesh.raycast(this.ray, this.hits);
      for (const h of this.hits) if (h.distance < best) best = h.distance;
      if (any && best !== Infinity) return best;
    }
    return best;
  }

  /** Does the segment a→b pass through visible map geometry? */
  private visualHit(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    if (len < 1e-4) return false;
    return this.visualDist(ax, ay, az, (bx - ax) / len, (by - ay) / len, (bz - az) / len, len, true) !== Infinity;
  }

  // ── Intro path planning ──────────────────────────────────────────────────

  /** Is the quadratic Bézier a → c → b clear (collision + visible geometry)? Yields per segment. */
  private *bezierClear(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3): Generator<void, boolean, void> {
    const N = 28;
    let px = a.x, py = a.y, pz = a.z;
    for (let i = 1; i <= N; i++) {
      const k = i / N;
      const u = 1 - k;
      const x = u * u * a.x + 2 * u * k * c.x + k * k * b.x;
      const y = u * u * a.y + 2 * u * k * c.y + k * k * b.y;
      const z = u * u * a.z + 2 * u * k * c.z + k * k * b.z;
      // The last few cm end in the player's head: never count the spawn itself.
      if (i < N && (!this.world.segmentClear(px, py, pz, x, y, z, 'move') || this.visualHit(px, py, pz, x, y, z))) return false;
      px = x;
      py = y;
      pz = z;
      yield;
    }
    return true;
  }

  /**
   * Picks a fly-in that never clips a wall: the plain arc, a higher arc, a
   * drop-in from above the spawn, else an establishing hold + cut to a clear
   * crane pose behind the player. A generator: applyIntro runs it in ~6 ms
   * slices (mesh raycasts on a big map would otherwise hitch the first frame),
   * holding the opening shot until it is done.
   */
  private *planIntro(): Generator<void, void, void> {
    const a = this.pose.pos;
    const b = this.planFp;
    const d = a.distanceTo(b);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2;
    // Control point raised 2·h gives a peak h above the chord at the middle.
    const tries: [IntroPlan, number][] = [
      ['arc', Math.min(6, d * 0.08)],
      ['high', Math.max(12, d * 0.22)],
    ];
    for (const [plan, h] of tries) {
      this.ctrl.set(mx, my + 2 * h, mz);
      if (yield* this.bezierClear(a, this.ctrl, b)) {
        this.plan = plan;
        return;
      }
    }
    // Drop-in: swing over to a point high above the spawn, then descend into it.
    for (const up of [16, 26]) {
      this.ctrl.set(b.x, Math.max(b.y + up, a.y), b.z);
      if (!this.world.segmentClear(b.x, b.y, b.z, b.x, this.ctrl.y, b.z, 'move') || this.visualHit(b.x, b.y, b.z, b.x, this.ctrl.y, b.z)) continue;
      yield;
      if (yield* this.bezierClear(a, this.ctrl, b)) {
        this.plan = 'drop';
        return;
      }
    }
    // Cut: the longest clear crane offset behind / beside / above the player.
    this.plan = 'cut';
    const f = this.back.set(0, 0, -1).applyQuaternion(this.planQuat);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    let best = -1;
    for (const turn of [0, 0.7, -0.7, 1.4, -1.4, Math.PI]) {
      const cs = Math.cos(turn), sn = Math.sin(turn);
      // Behind the player (−forward), rotated by `turn`, and up.
      const dx = -(f.x * cs - f.z * sn) * 6.5;
      const dz = -(f.x * sn + f.z * cs) * 6.5;
      const dy = 2.6;
      const len = Math.hypot(dx, dy, dz);
      const hit = Math.min(this.world.rayDist(b.x, b.y, b.z, dx / len, dy / len, dz / len, len + 0.5, 'move'), this.visualDist(b.x, b.y, b.z, dx / len, dy / len, dz / len, len + 0.5));
      const reach = hit === Infinity ? len : Math.max(0, hit - 0.5);
      if (reach > best + 0.5) {
        best = reach;
        const k = reach / len;
        this.cutPos.set(b.x + dx * k, b.y + dy * k, b.z + dz * k);
      }
      if (reach >= len - 1e-3) break;
      yield;
    }
    if (best < 1) {
      // Boxed in: rise straight up as far as possible.
      const hit = Math.min(this.world.rayDist(b.x, b.y, b.z, 0, 1, 0, 4.5, 'move'), this.visualDist(b.x, b.y, b.z, 0, 1, 0, 4.5));
      this.cutPos.set(b.x, b.y + (hit === Infinity ? 4 : Math.max(0.3, hit - 0.4)), b.z);
    }
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

  startOutro(camera: THREE.PerspectiveCamera, kind: 'rocket' | 'orbit', pose: ShowcasePose | null, center: THREE.Vector3 | null, rocket?: { pos: Vec3; scale: number }): void {
    this.captureFrom(camera);
    this.mode = 'outro';
    this.t = 0;
    this.outroKind = kind;
    if (kind === 'rocket' && pose) {
      this.pose.pos.set(pose.pos.x, pose.pos.y, pose.pos.z);
      this.pose.target.set(pose.target.x, pose.target.y, pose.target.z);
      this.pose.fov = pose.fov;
      const f = this.fromPos;
      const dx = pose.pos.x - f.x, dy = pose.pos.y - f.y, dz = pose.pos.z - f.z;
      const len = Math.hypot(dx, dy, dz);
      this.outroCut = len > 0.01 && this.world.rayDist(f.x, f.y, f.z, dx / len, dy / len, dz / len, len, 'sight') < len;
      this.rocketScale = rocket ? rocket.scale : 0;
      if (rocket) this.rocketBase.set(rocket.pos.x, rocket.pos.y, rocket.pos.z);
      this.planCrane();
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
        this.applyIntro(dt, camera, fp);
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

  private applyIntro(dt: number, camera: THREE.PerspectiveCamera, fp: FirstPersonPose): void {
    // Plan once the destination is known (re-plan only early on, e.g. a late spawn
    // move — never mid-flight, where switching paths would jump).
    if (!this.planned || (this.t < this.dur * 0.1 && this.planFp.distanceToSquared(fp.pos) > 4)) {
      this.planned = true;
      this.planFp.copy(fp.pos);
      this.planQuat.copy(fp.quat);
      this.planner = this.planIntro();
      this.planMs = 0;
    }
    const start = this.pose.pos;
    if (this.planner) {
      const t0 = performance.now();
      let done = false;
      while (performance.now() - t0 < 6) {
        if (this.planner.next().done) {
          done = true;
          break;
        }
      }
      this.planMs += performance.now() - t0;
      if (done) this.planner = null;
      else {
        // Still planning: hold the opening shot (the intro clock waits).
        this.t = Math.max(0, this.t - dt);
        camera.position.copy(start);
        this.lookQuat(start, this.pose.target, camera.quaternion);
        camera.fov = this.pose.fov;
        return;
      }
    }
    const u = clamp01(this.t / this.dur);
    if (this.plan === 'cut') {
      if (u < CUT_HOLD) {
        // Establishing shot: a slow push-in on the showcase pose.
        const k = easeInOut(u / CUT_HOLD);
        camera.position.lerpVectors(start, this.pose.target, 0.04 * k);
        this.lookQuat(start, this.pose.target, this.q);
        camera.quaternion.copy(this.q);
        camera.fov = this.pose.fov;
      } else {
        // Cut to the clear crane pose behind the player, then fly into the eyes.
        const k = easeInOut((u - CUT_HOLD) / (1 - CUT_HOLD));
        camera.position.lerpVectors(this.cutPos, fp.pos, k);
        this.lookAt.set(0, 0, -10).applyQuaternion(fp.quat).add(fp.pos);
        this.lookQuat(this.cutPos, this.lookAt, this.q);
        camera.quaternion.slerpQuaternions(this.q, fp.quat, k);
        camera.fov = THREE.MathUtils.lerp(fp.fov + 6, fp.fov, k);
      }
      if (this.t >= this.dur) this.mode = 'fp';
      return;
    }
    const k = easeInOut(u);
    // Quadratic Bézier start → ctrl → eyes (the planned, collision-checked path).
    const w = 1 - k;
    const c = this.ctrl;
    const b = fp.pos;
    this.p.set(
      w * w * start.x + 2 * w * k * c.x + k * k * b.x,
      w * w * start.y + 2 * w * k * c.y + k * k * b.y,
      w * w * start.z + 2 * w * k * c.z + k * k * b.z,
    );
    camera.position.copy(this.p);
    this.lookQuat(start, this.pose.target, this.q);
    camera.quaternion.slerpQuaternions(this.q, fp.quat, easeInOut(clamp01((u - 0.25) / 0.75)));
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

  /**
   * Finale camera move: a crane-up (to see over the foreground at the pad) and a
   * sideways dolly for parallax, both clamped against the collision world.
   */
  private planCrane(): void {
    const p = this.pose.pos;
    const t = this.pose.target;
    const dist = Math.hypot(t.x - p.x, t.z - p.z) || 1;
    // Side vector (right of the view), horizontal.
    const sx = -(t.z - p.z) / dist;
    const sz = (t.x - p.x) / dist;
    const side = Math.min(5, dist * 0.04);
    let up = Math.min(8, 2 + dist * 0.09);
    if (this.rocketScale > 0) {
      // Rise further if the engines (their camera-side edge) would still be hidden
      // behind collision geometry — decor below that is covered by the margin above.
      const b = this.rocketBase;
      const ey = b.y + (ROCKET_MOUNT_H + 1) * this.rocketScale;
      const bx = p.x - b.x, bz = p.z - b.z;
      const bl = Math.hypot(bx, bz) || 1;
      const ex = b.x + (bx / bl) * 4.8 * this.rocketScale, ez = b.z + (bz / bl) * 4.8 * this.rocketScale;
      for (let h = up; h <= 14.01; h += 1) {
        if (this.world.segmentClear(p.x + sx * side, p.y + h, p.z + sz * side, ex, ey, ez, 'sight')) {
          up = h;
          break;
        }
      }
    }
    this.craneOff.set(sx * side, up, sz * side);
    const len = this.craneOff.length();
    const hit = this.world.rayDist(p.x, p.y, p.z, this.craneOff.x / len, this.craneOff.y / len, this.craneOff.z / len, len + 0.6, 'move');
    if (hit !== Infinity) this.craneOff.multiplyScalar(Math.max(0, hit - 0.6) / len);
  }

  private applyOutro(dt: number, camera: THREE.PerspectiveCamera, orbitCenter: THREE.Vector3 | null): void {
    if (this.outroKind === 'rocket') {
      const t = this.t;
      const b = this.outroCut ? 1 : easeInOut(clamp01(t / 0.9));
      // Crane up + sideways dolly + a slow push toward the rocket.
      const k = easeInOut(clamp01(t / 7));
      this.p.lerpVectors(this.pose.pos, this.pose.target, 0.07 * easeOut(clamp01(t / 7)));
      // The crane starts mostly up (the engines must be in view for the ignition
      // flash), then keeps rising slowly for the rest of the climb.
      this.p.addScaledVector(this.craneOff, 0.8 + 0.2 * k);
      this.lookAt.copy(this.pose.target);
      let fov = this.pose.fov;
      if (this.rocketScale > 0) {
        // Tilt: a little low at ignition (flash + steam ring at the pad), then follow
        // the climb — aim between the pad and the nose so the column stays in frame.
        const s = this.rocketScale;
        const base = this.rocketBase.y;
        const climb = rocketAltitude(t) * s;
        const ign = 1 - smooth(ROCKET_LIFTOFF_T, ROCKET_LIFTOFF_T + 2.2, t);
        const farPad = clamp01((this.pose.pos.distanceTo(this.rocketBase) - 150) / 250);
        const low = (this.pose.target.y - base) * (0.5 - 0.35 * farPad) * ign;
        const follow = smooth(ROCKET_LIFTOFF_T + 0.3, ROCKET_LIFTOFF_T + 2.5, t);
        const mid = base + (ROCKET_MOUNT_H + 24) * s + climb * 0.72;
        const rest = this.pose.target.y - low;
        this.lookAt.y = THREE.MathUtils.lerp(rest, Math.max(rest, mid), follow);
        // Near pads: the frame opens up as the rocket climbs. Horizon pads: a slow
        // telephoto push-in instead (the launch fills more of the frame).
        const far = clamp01((this.p.distanceTo(this.rocketBase) - 150) / 250);
        fov *= 1 - 0.42 * far * smooth(0.6, 5.5, t);
        fov += 6 * (1 - far) * smooth(ROCKET_LIFTOFF_T, 6.5, t);
      } else {
        this.lookAt.y += Math.max(0, t - 1.2) * 2.4;
      }
      this.lookQuat(this.p, this.lookAt, this.q);
      // Ignition rumble, scaled by distance to the pad (reduced-shake aware).
      if (this.rocketScale > 0 && this.shakeScale > 0) {
        const d = this.p.distanceTo(this.rocketBase);
        const near = THREE.MathUtils.clamp(60 / Math.max(1, d), 0.12, 1);
        const env = Math.max(rocketFlash(t), smooth(0.3, 1.2, t) * 0.55) * (1 - smooth(4, 6.5, t));
        const a = 0.006 * near * env * this.shakeScale;
        if (a > 1e-5) {
          const st = t * 11;
          this.e.set(smoothNoise(st, 2.1) * a, smoothNoise(st, 5.3) * a, smoothNoise(st, 8.9) * a * 0.4, 'YXZ');
          this.q.multiply(this.qs.setFromEuler(this.e));
        }
      }
      camera.position.lerpVectors(this.fromPos, this.p, b);
      camera.quaternion.slerpQuaternions(this.fromQuat, this.q, b);
      camera.fov = THREE.MathUtils.lerp(this.fromFov, fov, b);
      return;
    }
    const b = easeInOut(clamp01(this.t / 0.9));
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
