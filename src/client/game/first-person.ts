// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — the local player's first-person rig.
//
//  • Pose: predicted eye interpolated between the last two sim ticks (smooth
//    at any refresh rate), plus the decaying reconciliation correction, plus
//    CameraFeel offsets; view angles are the zero-latency look + interpolated
//    recoil + feel. FOV: settings.fov is horizontal → vertical for the current
//    aspect, zoomed by the weapon's adsZoom (eased) plus the feel's sprint kick.
//  • Viewmodel state derived from the predicted combat/move state.
//  • Touch aim assist provider (InputSystem calls it; pure math in aim-assist.ts).
// Allocation-free per frame.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { CameraFeelInput, ViewModelState } from '../contracts';
import { activeWeapon, reloadProgress } from '../../shared/combat';
import { clamp } from '../../shared/math';
import { horizontalSpeed } from '../../shared/movement';
import { BTN_ADS, BTN_FIRE } from '../../shared/types';
import type { Vec3 } from '../../shared/types';
import { fireInterval, WEAPONS } from '../../shared/weapons';
import { computeAimAssist, type AimAssistQuery, type AimAssistResult } from './aim-assist';
import type { MatchContext } from './context';
import type { FirstPersonPose } from './deathcam';
import { WorldState } from './world-state';

/** Reconciliation error decay rate (1/s): ~95 % gone in 130 ms. */
const CORRECTION_RATE = 22;
const DEG = Math.PI / 180;

export class FirstPersonRig {
  readonly pose: FirstPersonPose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 70 };
  /** Visual offset hiding prediction corrections (decays to zero). */
  readonly correction = new THREE.Vector3();
  /** Final first-person yaw (view − recoil + feel). */
  yaw = 0;
  lookDx = 0;
  lookDy = 0;
  /** Aim assist only runs while this is set (first person, alive). */
  assistEnabled = false;
  private readonly eye = { x: 0, y: 0, z: 0 };
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly off = new THREE.Vector3();
  private readonly feelIn: CameraFeelInput = { speed: 0, sprinting: false, sliding: false, crouch: 0, onGround: true, ads: 0, lookDx: 0, lookDy: 0, strafe: 0 };
  private readonly vm: ViewModelState = {
    weapon: 'meridian', skin: 'factory', ads: 0, sprinting: false, sliding: false, crouch: 0, speed: 0, onGround: true,
    reload: -1, raise: 1, charge: 0, cycle: 1, mag: 0, magSize: 1, lookDx: 0, lookDy: 0, scoped: false,
  };
  // Aim assist scratch.
  private readonly aimTargets: THREE.Vector3[] = [];
  private readonly aimOut: AimAssistResult = { dx: 0, dy: 0, slow: 0, target: -1 };
  private readonly zero = { dx: 0, dy: 0, slow: 0 };
  private readonly query: AimAssistQuery;

  constructor(private readonly ctx: MatchContext) {
    this.query = {
      eye: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      engaged: false,
      targets: this.aimTargets,
      count: 0,
      visible: (t: Vec3) => this.visible(t),
    };
  }

  addCorrection(err: Vec3): void {
    this.correction.x += err.x;
    this.correction.y += err.y;
    this.correction.z += err.z;
    if (this.correction.lengthSq() > 4) this.correction.set(0, 0, 0);
  }

  /** Computes the first-person pose for this frame. `alpha` = tick interpolation factor. */
  compute(dt: number, alpha: number): FirstPersonPose {
    const ctx = this.ctx;
    const p = ctx.predictor;
    const m = p.move;
    const c = p.combat;
    const fp = this.pose;
    this.correction.multiplyScalar(Math.exp(-dt * CORRECTION_RATE));
    if (m) {
      p.eye(this.eye);
      fp.pos.set(
        p.prevEye.x + (this.eye.x - p.prevEye.x) * alpha,
        p.prevEye.y + (this.eye.y - p.prevEye.y) * alpha,
        p.prevEye.z + (this.eye.z - p.prevEye.z) * alpha,
      );
      fp.pos.add(this.correction);
    }
    const fi = this.feelIn;
    fi.speed = m ? horizontalSpeed(m) : 0;
    fi.sprinting = !!m?.sprint;
    fi.sliding = !!m && m.slideT > 0;
    fi.crouch = m?.crouchT ?? 0;
    fi.onGround = m?.onGround ?? true;
    fi.ads = c?.adsT ?? 0;
    fi.lookDx = this.lookDx;
    fi.lookDy = this.lookDy;
    fi.strafe = ctx.local.moveX;
    const feel = ctx.view ? ctx.view.feel.update(dt, fi) : null;
    const rp = c ? p.prevRecoilPitch + (c.recoilPitch - p.prevRecoilPitch) * alpha : 0;
    const ry = c ? p.prevRecoilYaw + (c.recoilYaw - p.prevRecoilYaw) * alpha : 0;
    this.yaw = ctx.local.yaw - ry + (feel?.yaw ?? 0);
    const pitch = clamp(ctx.local.pitch + rp, -1.5, 1.5) + (feel?.pitch ?? 0);
    this.euler.set(pitch, this.yaw, feel?.roll ?? 0, 'YXZ');
    fp.quat.setFromEuler(this.euler);
    if (feel) fp.pos.add(this.off.copy(feel.pos).applyQuaternion(fp.quat));

    const app = ctx.app;
    const aspect = app.engine.size.aspect || 16 / 9;
    const hfov = app.settings.value.fov * DEG;
    const vfov = clamp(2 * Math.atan(Math.tan(hfov / 2) / aspect), 42 * DEG, 100 * DEG);
    let zoom = 1;
    if (c) {
      const w = WEAPONS[activeWeapon(c)];
      const a = c.adsT * c.adsT * (3 - 2 * c.adsT);
      zoom = 1 + (w.adsZoom - 1) * a;
      app.input.setAimState(c.adsT, w.adsZoom);
    }
    fp.fov = (2 * Math.atan(Math.tan(vfov / 2) / zoom)) / DEG + (feel?.fov ?? 0);
    return fp;
  }

  /** Drives the viewmodel from the predicted state. */
  updateViewModel(dt: number): void {
    const ctx = this.ctx;
    const view = ctx.view;
    const c = ctx.predictor.combat;
    const m = ctx.predictor.move;
    if (!view || !c || !m) return;
    const s = this.vm;
    const wid = activeWeapon(c);
    const w = WEAPONS[wid];
    s.weapon = wid;
    s.skin = ctx.players.get(ctx.localId)?.cosmetics.skins[wid] ?? 'factory';
    s.ads = c.adsT;
    s.sprinting = m.sprint;
    s.sliding = m.slideT > 0;
    s.crouch = m.crouchT;
    s.speed = horizontalSpeed(m);
    s.onGround = m.onGround;
    s.reload = reloadProgress(c);
    s.raise = c.swapT > 0 && w.swapTime > 0 ? clamp(1 - c.swapT / w.swapTime, 0, 1) : 1;
    s.charge = w.chargeTime ? clamp(c.chargeT / w.chargeTime, 0, 1) : 0;
    s.cycle = c.cycleT > 0 ? clamp(1 - c.cycleT / fireInterval(wid), 0, 1) : 1;
    const slot = c.slots[c.active] ?? c.slots[0];
    s.mag = slot.mag;
    s.magSize = w.magSize;
    s.lookDx = this.lookDx;
    s.lookDy = this.lookDy;
    s.scoped = w.scoped && c.adsT > 0.9;
    view.vm.update(dt, s);
  }

  /**
   * Debug / e2e: turns the view toward the nearest enemy (or range target)
   * with a clear line of fire. Returns its id (targets: 1000 + id) or -1.
   */
  faceNearestEnemy(): number {
    const ctx = this.ctx;
    const view = ctx.view;
    if (!view || !ctx.predictor.move || !ctx.predictor.alive) return -1;
    const eye = ctx.predictor.eye({ x: 0, y: 0, z: 0 });
    let best = -1;
    let bestD = Infinity;
    const aim = { x: 0, y: 0, z: 0 };
    const consider = (id: number, x: number, y: number, z: number) => {
      const d = Math.hypot(x - eye.x, y - eye.y, z - eye.z);
      if (d >= bestD || !ctx.world.segmentClear(eye.x, eye.y, eye.z, x, y, z, 'bullet')) return;
      best = id;
      bestD = d;
      aim.x = x;
      aim.y = y;
      aim.z = z;
    };
    for (const e of view.remotes.entries.values()) if (!e.isLocal && e.alive && ctx.isEnemy(e.ident.id)) consider(e.ident.id, e.pos.x, e.pos.y + 1.2, e.pos.z);
    for (const t of ctx.targets) if (t.alive) consider(1000 + t.id, t.x, t.y + 1.3, t.z);
    if (best < 0) return -1;
    const dx = aim.x - eye.x;
    const dz = aim.z - eye.z;
    ctx.local.setAngles(Math.atan2(-dx, -dz), Math.atan2(aim.y - eye.y, Math.hypot(dx, dz)));
    return best;
  }

  // ── Touch aim assist ──

  private visible(t: Vec3): boolean {
    const e = this.query.eye;
    return this.ctx.world.segmentClear(e.x, e.y, e.z, t.x, t.y, t.z, 'sight') && !WorldState.smokeBlocks(this.ctx.smokes, e, t);
  }

  private target(n: number): THREE.Vector3 {
    return this.aimTargets[n] ?? (this.aimTargets[n] = new THREE.Vector3());
  }

  /** InputSystem hook: look nudge / slowdown for touch players. */
  readonly aimAssist = (dt: number): { dx: number; dy: number; slow: number } => {
    const ctx = this.ctx;
    const view = ctx.view;
    const c = ctx.predictor.combat;
    if (!view || !c || !ctx.predictor.alive || !this.assistEnabled) return this.zero;
    let n = 0;
    for (const e of view.remotes.entries.values()) {
      if (e.isLocal || !e.alive || !ctx.isEnemy(e.ident.id)) continue;
      this.target(n++).set(e.pos.x, e.pos.y + 1.25 - (e.s.c / 100) * 0.45, e.pos.z);
    }
    for (const t of ctx.targets) if (t.alive) this.target(n++).set(t.x, t.y + 1.25, t.z);
    const q = this.query;
    q.eye.x = ctx.camPos.x;
    q.eye.y = ctx.camPos.y;
    q.eye.z = ctx.camPos.z;
    q.yaw = ctx.local.yaw;
    q.pitch = ctx.local.pitch;
    q.engaged = (ctx.local.heldNow & (BTN_FIRE | BTN_ADS)) !== 0 || c.adsT > 0.5;
    q.count = n;
    return computeAimAssist(q, dt, this.aimOut);
  };
}
