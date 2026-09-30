// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — gentle touch-only aim assist.
//
// Two effects, both deliberately subtle (the brief: "gentle, optional"):
//  • Slowdown: look sensitivity is reduced (≤ 40 %) while the crosshair is
//    within a 4° cone of a visible enemy's chest — makes fine tracking on a
//    phone feel precise without moving the view on its own.
//  • Magnetism: only while firing or aiming down sights, the view drifts
//    toward the nearest visible enemy chest inside the cone at ≤ 1.5°/s,
//    scaled down with distance. Never through walls or smoke (the caller's
//    `visible` test), never a snap (rate-limited, stops at the target).
// The InputSystem applies the result only for touch input with the setting on.
//
// Pure logic (no DOM / three.js).
// ─────────────────────────────────────────────────────────────────────────────

import { wrapAngle } from '../../shared/math';
import type { Vec3 } from '../../shared/types';

const DEG = Math.PI / 180;
export const ASSIST_CONE = 4 * DEG;
export const ASSIST_MAX_RATE = 1.5 * DEG;
export const ASSIST_MAX_SLOW = 0.4;
export const ASSIST_RANGE = 70;

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
  /** 0..1 sensitivity reduction. */
  slow: number;
  /** Index of the assisted target (-1 = none). */
  target: number;
}

export function computeAimAssist(q: AimAssistQuery, dt: number, out: AimAssistResult): AimAssistResult {
  out.dx = 0;
  out.dy = 0;
  out.slow = 0;
  out.target = -1;
  let best = Infinity;
  let bestYaw = 0;
  let bestPitch = 0;
  let bestDist = 0;
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
    const ang = Math.sqrt(dYaw * cp * (dYaw * cp) + dPitch * dPitch);
    // Slightly wider acceptance up close (bodies are big on screen).
    const cone = ASSIST_CONE * (dist < 8 ? 1.5 : 1);
    if (ang > cone || ang >= best) continue;
    if (!q.visible(t, i)) continue;
    best = ang;
    bestYaw = dYaw;
    bestPitch = dPitch;
    bestDist = dist;
    out.slow = Math.max(out.slow, ASSIST_MAX_SLOW * (1 - ang / cone));
    out.target = i;
  }
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
