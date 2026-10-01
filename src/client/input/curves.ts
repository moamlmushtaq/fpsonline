// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — input response curves (pure math, no DOM: unit-tested).
//
//  • shapeStick(): radial dead zone with rescale (no jump at the edge of the
//    dead zone), outer saturation (full output before the physical rim, so
//    worn sticks / thumbs still reach 100 %) and a blended power curve
//    (linear part keeps small deflections usable, power part gives precision).
//  • TouchLookFilter: drag-to-aim for touch. Finger speed drives both an
//    acceleration curve (slow drags are a bit finer than 1:1, fast flicks turn
//    further) and an adaptive smoother (slow drags are de-jittered over a
//    couple of frames; fast flicks pass straight through). Frame-rate
//    independent, so 60 / 90 / 120 Hz displays feel the same.
// ─────────────────────────────────────────────────────────────────────────────

export interface StickShape {
  /** Radial dead zone (0..1 of full deflection). */
  inner: number;
  /** Deflection at which output saturates to 1. */
  outer: number;
  /** Exponent of the power part of the curve. */
  exponent: number;
  /** 0..1 share of the linear part (1 = purely linear). */
  linear: number;
}

/** Gamepad movement: linear (analog walk speed maps 1:1), generous saturation. */
export const PAD_MOVE: StickShape = { inner: 0.14, outer: 0.93, exponent: 1, linear: 1 };
/** Gamepad look: precise near the centre, fast at the rim. */
export const PAD_LOOK: StickShape = { inner: 0.11, outer: 0.96, exponent: 2.1, linear: 0.2 };
/** Touch joystick: small dead zone for a resting thumb, light ease-in. */
export const TOUCH_STICK: StickShape = { inner: 0.1, outer: 0.9, exponent: 1.35, linear: 0.45 };

export interface Shaped {
  x: number;
  y: number;
  /** Shaped magnitude 0..1. */
  m: number;
}

/** Shapes a stick vector (any magnitude) into `out`. Direction is preserved. */
export function shapeStick(x: number, y: number, s: StickShape, out: Shaped = { x: 0, y: 0, m: 0 }): Shaped {
  const raw = Math.hypot(x, y);
  if (!(raw > s.inner)) {
    out.x = out.y = out.m = 0;
    return out;
  }
  const t = Math.min(1, (raw - s.inner) / Math.max(1e-6, s.outer - s.inner));
  const m = s.linear * t + (1 - s.linear) * Math.pow(t, s.exponent);
  out.m = m;
  out.x = (x / raw) * m;
  out.y = (y / raw) * m;
  return out;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/** Finger-speed thresholds (CSS px / s) of the touch acceleration curve. */
export const TOUCH_ACCEL = { v0: 90, v1: 1900, gMin: 0.84, gMax: 1.95, ref: 420 };

const rawGain = (v: number): number => TOUCH_ACCEL.gMin + (TOUCH_ACCEL.gMax - TOUCH_ACCEL.gMin) * smoothstep((v - TOUCH_ACCEL.v0) / (TOUCH_ACCEL.v1 - TOUCH_ACCEL.v0));
const GAIN_NORM = 1 / rawGain(TOUCH_ACCEL.ref);

/** Touch look gain for a finger speed (1.0 at a typical tracking speed). */
export function touchLookGain(speedPxPerS: number): number {
  return rawGain(Math.max(0, speedPxPerS)) * GAIN_NORM;
}

export class TouchLookFilter {
  private inX = 0;
  private inY = 0;
  private remX = 0;
  private remY = 0;
  /** Smoothed finger speed (px/s). */
  speed = 0;

  /** Raw finger movement (CSS px) since the last step. */
  push(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.inX += dx;
    this.inY += dy;
  }

  /**
   * Advances one rendered frame. `touching` = an aim finger is down (when it
   * lifts, the remainder is flushed so the view never drifts on its own).
   * Returns the shaped delta in CSS px (multiply by rad/px × sensitivity).
   */
  step(dt: number, touching: boolean, out: { x: number; y: number }): { x: number; y: number } {
    const d = dt > 1e-4 ? Math.min(dt, 0.1) : 1 / 60;
    const inst = Math.hypot(this.inX, this.inY) / d;
    // Speed estimate: ~45 ms time constant; rises fast so flicks get their gain on frame one.
    const kv = 1 - Math.exp(-d / (inst > this.speed ? 0.025 : 0.06));
    this.speed += (inst - this.speed) * kv;
    const g = touchLookGain(this.speed);
    this.remX += this.inX * g;
    this.remY += this.inY * g;
    this.inX = this.inY = 0;
    if (!touching) {
      out.x = this.remX;
      out.y = this.remY;
      this.remX = this.remY = 0;
      this.speed = 0;
      return out;
    }
    // Slow drags: ~33 ms smoothing (kills digitizer jitter); fast: ~9 ms.
    const rate = 30 + 80 * smoothstep(this.speed / 900);
    const k = 1 - Math.exp(-d * rate);
    out.x = this.remX * k;
    out.y = this.remY * k;
    this.remX -= out.x;
    this.remY -= out.y;
    return out;
  }

  reset(): void {
    this.inX = this.inY = this.remX = this.remY = this.speed = 0;
  }
}
