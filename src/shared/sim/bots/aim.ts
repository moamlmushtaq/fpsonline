// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — BotAim: a human aiming model for bots.
//
// Engaging a target is a Fitts'-law "flick": a minimum-jerk movement whose
// duration grows with the angle to cover (fittsA + fittsB·log2(1 + A/W)) that
// ends slightly PAST the target (overshoot) with scatter proportional to the
// amplitude, followed by corrective settling (exponential decay of the offset)
// under continuous pursuit noise (an Ornstein–Uhlenbeck wobble). The aim point
// itself comes from a lagged, partially extrapolated perception of the target
// (bots.ts), so a strafing target is genuinely hard to track and a direction
// change costs a moment. Recoil is pulled down by a fraction of the kick, and
// the "hand" reacts to the kick with a lag. The view never turns faster than
// the profile's turn rate: no snaps.
// ─────────────────────────────────────────────────────────────────────────────

import { PITCH_LIMIT } from '../../constants';
import { angleDiff, clamp, wrapAngle } from '../../math';
import type { BotProfile } from '../bot-profiles';

/** Standard normal sample from a uniform RNG (Box–Muller). */
export function gauss(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export class BotAim {
  yaw = 0;
  pitch = 0;
  /** True while tracking an enemy (between flickTo() and release()). */
  engaged = false;
  private offY = 0;
  private offP = 0;
  private flickT = 0;
  private flickDur = 0;
  private f0Y = 0;
  private f0P = 0;
  private f1Y = 0;
  private f1P = 0;
  private recY = 0;
  private recP = 0;

  constructor(
    private readonly prof: BotProfile,
    private readonly rng: () => number,
  ) {}

  reset(yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0;
    this.engaged = false;
    this.recY = 0;
    this.recP = 0;
  }

  /** Angular aim offset from the perceived aim point (rad). */
  get offset(): number {
    return Math.hypot(this.offY, this.offP);
  }

  get flicking(): boolean {
    return this.engaged && this.flickT < this.flickDur;
  }

  /**
   * Starts a flick from the current view toward the aim point (tYaw, tPitch).
   * `width` is the target's angular width (rad); `errScale` scales the scatter.
   */
  flickTo(tYaw: number, tPitch: number, width: number, errScale = 1): void {
    const p = this.prof;
    const oy = angleDiff(tYaw, this.yaw);
    const op = this.pitch - tPitch;
    const amp = Math.hypot(oy, op);
    this.flickDur = p.fittsA + p.fittsB * Math.log2(1 + amp / Math.max(0.004, width));
    // Overshoot along the movement (the movement goes from +off toward 0 → past it is -off).
    const ov = p.overshoot * (0.4 + this.rng() * 1.2);
    const sd = (p.endErr * amp + p.baseErr) * errScale;
    this.f0Y = oy;
    this.f0P = op;
    this.f1Y = -oy * ov + gauss(this.rng) * sd;
    this.f1P = -op * ov + gauss(this.rng) * sd * 0.6;
    this.flickT = 0;
    this.offY = oy;
    this.offP = op;
    this.engaged = true;
  }

  release(): void {
    this.engaged = false;
  }

  /**
   * Tracks the perceived aim point while engaged. `recoilYaw/Pitch` are the
   * weapon's current recoil (view = aim − recoil); `noise` scales pursuit noise.
   */
  track(tYaw: number, tPitch: number, recoilYaw: number, recoilPitch: number, dt: number, noise = 1): void {
    const p = this.prof;
    if (this.flickT < this.flickDur) {
      this.flickT += dt;
      const s = Math.min(1, this.flickT / this.flickDur);
      const e = s * s * s * (10 - 15 * s + 6 * s * s); // minimum-jerk profile
      this.offY = this.f0Y + (this.f1Y - this.f0Y) * e;
      this.offP = this.f0P + (this.f1P - this.f0P) * e;
    } else {
      const k = Math.exp(-p.settle * dt);
      const sq = Math.sqrt(dt) * p.pursuitNoise * noise;
      this.offY = this.offY * k + gauss(this.rng) * sq;
      this.offP = this.offP * k + gauss(this.rng) * sq * 0.6;
    }
    // The hand feels the kick late and only corrects part of it.
    const kr = 1 - Math.exp(-dt / Math.max(0.01, p.recoilLag));
    this.recY += (recoilYaw - this.recY) * kr;
    this.recP += (recoilPitch - this.recP) * kr;
    const wantY = wrapAngle(tYaw + this.offY + this.recY * p.recoilComp);
    const wantP = tPitch + this.offP - this.recP * p.recoilComp;
    const maxTurn = p.turnRate * dt;
    const dy = angleDiff(this.yaw, wantY);
    const dp = wantP - this.pitch;
    const cy = clamp(dy, -maxTurn, maxTurn);
    const cp = clamp(dp, -maxTurn, maxTurn);
    this.yaw = wrapAngle(this.yaw + cy);
    this.pitch = clamp(this.pitch + cp, -PITCH_LIMIT, PITCH_LIMIT);
    if (cy !== dy || cp !== dp) {
      // Turn-rate limited: the real offset is whatever we could not cover.
      this.offY -= dy - cy;
      this.offP -= dp - cp;
    }
  }

  /** Relaxed look toward a direction (not tracking an enemy). */
  look(tYaw: number, tPitch: number, dt: number, rate = this.prof.smooth): void {
    this.engaged = false;
    const p = this.prof;
    const s = Math.min(1, rate * dt);
    const maxTurn = p.turnRate * dt * 0.8;
    this.yaw = wrapAngle(this.yaw + clamp(angleDiff(this.yaw, tYaw) * s, -maxTurn, maxTurn));
    this.pitch = clamp(this.pitch + clamp((tPitch - this.pitch) * s, -maxTurn, maxTurn), -PITCH_LIMIT, PITCH_LIMIT);
    const kr = 1 - Math.exp(-dt / Math.max(0.01, p.recoilLag));
    this.recY -= this.recY * kr;
    this.recP -= this.recP * kr;
  }
}
