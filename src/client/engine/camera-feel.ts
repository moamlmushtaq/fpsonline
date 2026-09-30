// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — camera feel: head bob, sprint FOV kick, slide roll/lower,
// landing dip, strafe roll, fire kick, smooth-noise shake and damage flinch.
//
// Everything is spring / exponential based with sub-stepping, so the feel is
// identical at 30, 60 or 144 fps. Amplitudes are deliberately small ("never
// nauseating"); `setShakeScale` (reduced screen shake) scales shake, flinch,
// landing dip and bob.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { CameraFeel, CameraFeelInput, CameraFeelOutput } from '../contracts';
import type { WeaponId } from '../../shared/types';

/** Damped spring (semi-implicit Euler, sub-stepped at ≤ 1/240 s). */
export class Spring {
  x = 0;
  v = 0;
  constructor(
    public stiffness = 180,
    public damping = 20,
  ) {}
  step(dt: number, target = 0): number {
    const n = Math.min(16, Math.max(1, Math.ceil(dt * 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -this.stiffness * (this.x - target) - this.damping * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  impulse(v: number): void {
    this.v += v;
  }
  reset(): void {
    this.x = 0;
    this.v = 0;
  }
}

/** Frame-rate independent exponential approach. */
export function damp(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

/** Smooth 1D noise in [-1, 1] (sum of incommensurate sines — no jitter). */
export function smoothNoise(t: number, seed: number): number {
  return (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.17 + seed * 3.1) * 0.2);
}

const FIRE_KICK: Record<WeaponId, { pitch: number; back: number }> = {
  meridian: { pitch: 0.0022, back: 0.004 },
  swift: { pitch: 0.0015, back: 0.003 },
  longline: { pitch: 0.012, back: 0.012 },
  breaker: { pitch: 0.014, back: 0.016 },
  pulse: { pitch: 0.004, back: 0.005 },
  sunspear: { pitch: 0.016, back: 0.018 },
};

export class CameraFeelController implements CameraFeel {
  private readonly out: CameraFeelOutput = { pos: new THREE.Vector3(), pitch: 0, yaw: 0, roll: 0, fov: 0 };
  private shakeScale = 1;
  private bobPhase = 0;
  private bobAmp = 0;
  private fov = 0;
  private slide = 0;
  private strafeRoll = 0;
  private readonly landY = new Spring(170, 16);
  private readonly landPitch = new Spring(150, 15);
  private readonly kickPitch = new Spring(260, 24);
  private readonly kickBack = new Spring(300, 28);
  private readonly flinchYaw = new Spring(120, 14);
  private readonly flinchPitch = new Spring(120, 14);
  private readonly flinchRoll = new Spring(120, 14);
  private trauma = 0;
  private traumaDecay = 1.5;
  private time = 0;

  constructor() {}

  update(dt: number, s: CameraFeelInput): CameraFeelOutput {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    const o = this.out;
    const k = this.shakeScale;

    // Head bob: frequency follows speed, amplitude eases in/out, reduced in ADS.
    const moving = s.onGround && !s.sliding && s.speed > 0.6;
    const targetAmp = moving ? Math.min(s.speed / 5.4, 1.5) * (s.sprinting ? 1.25 : 1) * (1 - 0.8 * s.ads) * (1 - 0.4 * s.crouch) : 0;
    this.bobAmp = damp(this.bobAmp, targetAmp, 8, dt);
    this.bobPhase += dt * (s.sprinting ? 11 : 8.6) * THREE.MathUtils.clamp(s.speed / 5.4, 0.55, 1.5);
    const bk = this.bobAmp * (0.6 + 0.4 * k);
    const bobY = -Math.abs(Math.sin(this.bobPhase)) * 0.018 * bk + 0.009 * bk;
    const bobX = Math.sin(this.bobPhase) * 0.01 * bk;
    const bobRoll = Math.sin(this.bobPhase) * 0.0035 * bk;

    // Sprint FOV kick (+6°) and a smaller one while sliding.
    const fovTarget = s.sprinting && s.speed > 5.8 ? 6 : s.sliding ? 3.5 : 0;
    this.fov = damp(this.fov, fovTarget * (1 - s.ads), s.sprinting ? 5 : 7, dt);

    // Slide: small roll + lowered view; strafe roll ±0.8°.
    this.slide = damp(this.slide, s.sliding ? 1 : 0, 9, dt);
    this.strafeRoll = damp(this.strafeRoll, -THREE.MathUtils.clamp(s.strafe, -1, 1) * THREE.MathUtils.degToRad(0.8) * (s.onGround ? 1 : 0.5), 6, dt);

    const landY = this.landY.step(dt);
    const landP = this.landPitch.step(dt);
    const kp = this.kickPitch.step(dt);
    const kb = this.kickBack.step(dt);
    const fy = this.flinchYaw.step(dt);
    const fp = this.flinchPitch.step(dt);
    const fr = this.flinchRoll.step(dt);

    // Shake: trauma² × smooth noise (≈ 9 Hz), never white noise.
    this.trauma = Math.max(0, this.trauma - dt * this.traumaDecay);
    const sh = this.trauma * this.trauma * k;
    const st = this.time * 9;
    const shYaw = smoothNoise(st, 1.3) * 0.02 * sh;
    const shPitch = smoothNoise(st, 7.1) * 0.02 * sh;
    const shRoll = smoothNoise(st, 3.7) * 0.03 * sh;

    o.pos.set(bobX, bobY + Math.max(-0.06, landY) - this.slide * 0.06, kb);
    o.pitch = landP + kp + fp + shPitch;
    o.yaw = fy + shYaw;
    o.roll = bobRoll + this.strafeRoll + this.slide * THREE.MathUtils.degToRad(2.2) + fr + shRoll;
    o.fov = this.fov;
    return o;
  }

  land(impactSpeed: number): void {
    const v = Math.max(0, impactSpeed);
    if (v < 1.5) return;
    const k = 0.5 + 0.5 * this.shakeScale;
    // Max ~6 cm dip for hard landings; the spring overshoots gently.
    this.landY.impulse(-Math.min(0.9, v * 0.075) * k);
    this.landPitch.impulse(-Math.min(0.5, v * 0.03) * k);
  }

  fire(weapon: WeaponId): void {
    const f = FIRE_KICK[weapon] ?? FIRE_KICK.meridian;
    this.kickPitch.impulse(f.pitch * 25);
    this.kickBack.impulse(f.back * 25);
  }

  shake(amount: number, duration = 0.4): void {
    this.trauma = Math.min(1, this.trauma + Math.max(0, amount));
    this.traumaDecay = 1 / Math.max(0.1, duration);
  }

  damage(fromAngle: number, amount: number): void {
    // fromAngle: 0 = hit from the front, +left. Flinch away from the hit.
    const a = THREE.MathUtils.clamp(amount / 40, 0.15, 1) * (0.4 + 0.6 * this.shakeScale);
    this.flinchYaw.impulse(-Math.sin(fromAngle) * 0.35 * a);
    this.flinchPitch.impulse(Math.cos(fromAngle) * 0.3 * a);
    this.flinchRoll.impulse(Math.sin(fromAngle) * 0.4 * a);
    this.shake(0.25 * a, 0.3);
  }

  setShakeScale(k: number): void {
    this.shakeScale = THREE.MathUtils.clamp(Number.isFinite(k) ? k : 1, 0, 1);
  }

  reset(): void {
    for (const s of [this.landY, this.landPitch, this.kickPitch, this.kickBack, this.flinchYaw, this.flinchPitch, this.flinchRoll]) s.reset();
    this.trauma = 0;
    this.bobAmp = 0;
    this.fov = 0;
    this.slide = 0;
    this.strafeRoll = 0;
  }
}
