// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — gentle touch-only aim assist.
//
// Two effects, both deliberately subtle (the brief: "gentle, optional"):
//  • Slowdown ("friction"): look sensitivity eases down (≤ 35 %) while the
//    crosshair is over / just around a visible enemy's body — fine tracking on
//    a phone feels precise, and the view never moves on its own because of it.
//    The acceptance cone follows the target's ANGULAR SIZE (a body is big on
//    screen up close, tiny far away), clamped to [1.4°, 6.5°]; the current
//    target keeps a slightly wider cone (hysteresis) so the friction does not
//    flicker on the edge; the slow value itself eases in/out over ~80 ms.
//  • Magnetism: only while firing or aiming down sights, the view drifts
//    toward the chest of the assisted target at ≤ 2°/s (less with distance),
//    and never past it. No snap, no lock-on.
// Never through walls or smoke (the caller's `visible` test), never on
// targets behind the player or beyond ASSIST_RANGE.
// The InputSystem applies the result only for touch input with the setting on.
//
// Pure logic (no DOM / three.js). State (eased slow, last target) is carried
// in the caller-owned result object, which must be reused between frames.
// ─────────────────────────────────────────────────────────────────────────────

import { wrapAngle } from '../../shared/math';
import type { Vec3 } from '../../shared/types';

const DEG = Math.PI / 180;
/** Nominal cone (kept for API compatibility: the cone at ~12 m). */
export const ASSIST_CONE = 4 * DEG;
export const ASSIST_CONE_MIN = 1.4 * DEG;
export const ASSIST_CONE_MAX = 6.5 * DEG;
/** Half-width of the assist "body" used for the angular-size cone (m). */
export const ASSIST_BODY_RADIUS = 0.42;
/** Cone multiplier around the body's angular radius. */
export const ASSIST_CONE_SCALE = 2.1;
/** Hysteresis: the current target keeps a wider cone. */
export const ASSIST_STICKY = 1.25;
export const ASSIST_MAX_RATE = 2 * DEG;
export const ASSIST_MAX_SLOW = 0.35;
export const ASSIST_RANGE = 70;
/** Time constant (s) of the slow ease. */
export const ASSIST_SLOW_TAU = 0.08;

export interface AimAssistQuery {
  eye: Vec3;
  yaw: number;
  pitch: number;
  /** Firing or ADS (magnetism only applies then). */
  engaged: boolean;
  /** Candidate chest points (enemies, alive). */
  targets: readonly Vec3[];
  count: number;
  /** Line of sight (walls + smoke) from the eye to a point. */
  visible(target: Vec3, index: number): boolean;
}

export interface AimAssistResult {
  /** Look nudge in radians (+dx = turn right, +dy = look up). */
  dx: number;
  dy: number;
  /** 0..1 sensitivity reduction (eased between frames). */
  slow: number;
  /** Index of the assisted target (-1 = none). */
  target: number;
}

/** Acceptance cone for a target at `dist` metres. */
export function assistCone(dist: number): number {
  const ang = Math.atan2(ASSIST_BODY_RADIUS, Math.max(0.5, dist)) * ASSIST_CONE_SCALE;
  return Math.max(ASSIST_CONE_MIN, Math.min(ASSIST_CONE_MAX, ang));
}

export function computeAimAssist(q: AimAssistQuery, dt: number, out: AimAssistResult): AimAssistResult {
  // Previous frame's state (the caller reuses `out`).
  const prevSlow = Number.isFinite(out.slow) ? out.slow : 0;
  const prevTarget = out.target;
  out.dx = 0;
  out.dy = 0;
  out.target = -1;
  let best = Infinity;
  let bestScore = Infinity;
  let bestYaw = 0;
  let bestPitch = 0;
  let bestDist = 0;
  let targetSlow = 0;
  const cp = Math.cos(q.pitch);
  for (let i = 0; i < q.count; i++) {
    const t = q.targets[i];
    const dx = t.x - q.eye.x;
    const dy = t.y - q.eye.y;
    const dz = t.z - q.eye.z;
    const hd = Math.sqrt(dx * dx + dz * dz);
    const dist = Math.sqrt(hd * hd + dy * dy);
    if (dist < 1 || dist > ASSIST_RANGE) continue;
    const tyaw = Math.atan2(-dx, -dz);
    const tpitch = Math.atan2(dy, hd);
    const dYaw = wrapAngle(tyaw - q.yaw);
    const dPitch = tpitch - q.pitch;
    // Behind the player (or far off to the side): never.
    if (Math.abs(dYaw) > Math.PI / 2) continue;
    const ang = Math.sqrt(dYaw * cp * (dYaw * cp) + dPitch * dPitch);
    const cone = assistCone(dist) * (i === prevTarget ? ASSIST_STICKY : 1);
    if (ang > cone) continue;
    // Rank by how centred the target is relative to its own cone (a near body
    // slightly off-centre loses to a far one under the crosshair).
    const score = ang / cone;
    if (score >= bestScore) continue;
    if (!q.visible(t, i)) continue;
    bestScore = score;
    best = ang;
    bestYaw = dYaw;
    bestPitch = dPitch;
    bestDist = dist;
    // Smooth falloff: full friction over the inner half of the cone.
    const k = Math.min(1, Math.max(0, (1 - score) * 2));
    targetSlow = ASSIST_MAX_SLOW * k * k * (3 - 2 * k);
    out.target = i;
  }
  const e = dt > 0 ? 1 - Math.exp(-dt / ASSIST_SLOW_TAU) : 1;
  out.slow = prevSlow + (targetSlow - prevSlow) * e;
  if (out.slow < 1e-3) out.slow = 0;
  if (out.target >= 0 && q.engaged && best > 1e-4 && dt > 0) {
    const k = Math.max(0.35, Math.min(1, 1 - bestDist / (ASSIST_RANGE + 10)));
    const step = Math.min(ASSIST_MAX_RATE * k * dt, best);
    // + dYaw = target is to the LEFT → yaw must increase → look dx negative.
    const yawRate = bestYaw * cp;
    out.dx = (-yawRate / best) * step;
    out.dy = (bestPitch / best) * step;
  }
  return out;
}
