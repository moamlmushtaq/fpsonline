// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — character IK + weapon-hold tables (allocation free).
//
// twoBone() solves a limb in its PARENT's local frame and returns absolute
// local quaternions for the upper and lower bones. The upper bone gets a full
// basis (−Y along the limb, ±Z facing the pole) so knees/elbows hinge cleanly
// around their local X without twist drift.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { WeaponId } from '../../../shared/types';

const NEG_Y = new THREE.Vector3(0, -1, 0);
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Vector3();
const _u = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qi = new THREE.Quaternion();

/**
 * @param base   upper-bone origin (parent frame)
 * @param target end-effector position (parent frame) — wrist / ankle
 * @param pole   direction the middle joint should point (parent frame)
 * @param zSign  −1: bone −Z faces the pole (knees); +1: bone +Z faces it (elbows)
 */
export function twoBone(
  base: THREE.Vector3,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  l1: number,
  l2: number,
  zSign: number,
  outUpper: THREE.Quaternion,
  outLower: THREE.Quaternion,
): void {
  _d.subVectors(target, base);
  let dist = _d.length();
  if (dist < 1e-5) _d.set(0, -1, 0);
  _d.normalize();
  dist = THREE.MathUtils.clamp(dist, Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.0015);
  const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.set(0, 0, -zSign).addScaledVector(_d, -_d.z * -zSign);
  if (_p.lengthSq() < 1e-8) _p.set(1, 0, 0);
  _p.normalize();
  // Middle joint and the upper bone direction.
  _e.copy(base).addScaledVector(_d, cosA * l1).addScaledVector(_p, sinA * l1);
  _u.subVectors(_e, base).normalize();
  _y.copy(_u).negate();
  _z.copy(_p).addScaledVector(_u, -_p.dot(_u));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1);
  _z.normalize().multiplyScalar(zSign);
  _x.crossVectors(_y, _z).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  outUpper.setFromRotationMatrix(_m);
  // Lower bone: from the middle joint to the (clamped) end point, in upper-local space.
  _w.copy(base).addScaledVector(_d, dist).sub(_e).normalize();
  _qi.copy(outUpper).invert();
  _w.applyQuaternion(_qi);
  outLower.setFromUnitVectors(NEG_Y, _w);
}

/** Quaternion whose local −Z maps to `fwd` and +Y (knuckles) toward `up`. */
export function lookBasis(fwd: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _z.copy(fwd).normalize().negate();
  _y.copy(up).addScaledVector(_z, -up.dot(_z));
  if (_y.lengthSq() < 1e-8) _y.set(0, 1, 0);
  _y.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

// ── Weapon holds ─────────────────────────────────────────────────────────

export interface Hold {
  /** Weapon origin (grip) relative to the shoulder pivot, in the aim frame. */
  hip: [number, number, number];
  /** Eye → sight distance when aiming down sights. */
  ads: number;
  /** Two hands on the grip (sidearm). */
  pistol: boolean;
  /** Fire kick strength (third person). */
  kick: number;
  /** Chest yaw toward the weapon side (bladed stance). */
  blade: number;
  /** Fallback anchors (weapon space) if the model lacks them. */
  gripR: [number, number, number];
  gripL: [number, number, number];
}

export const HOLDS: Record<WeaponId, Hold> = {
  meridian: { hip: [-0.04, -0.105, -0.27], ads: 0.13, pistol: false, kick: 1, blade: -0.36, gripR: [0, -0.06, 0.02], gripL: [0, -0.02, -0.38] },
  swift: { hip: [-0.035, -0.1, -0.26], ads: 0.16, pistol: false, kick: 0.6, blade: -0.3, gripR: [0, -0.06, 0.02], gripL: [0, -0.06, -0.15] },
  longline: { hip: [-0.04, -0.105, -0.27], ads: 0.08, pistol: false, kick: 2.2, blade: -0.4, gripR: [0, -0.06, 0.02], gripL: [0, -0.02, -0.44] },
  breaker: { hip: [-0.04, -0.11, -0.26], ads: 0.14, pistol: false, kick: 2.6, blade: -0.38, gripR: [0, -0.06, 0.02], gripL: [0, -0.02, -0.34] },
  pulse: { hip: [-0.125, -0.07, -0.44], ads: 0.34, pistol: true, kick: 0.9, blade: -0.08, gripR: [0, -0.02, 0], gripL: [-0.01, -0.03, 0.01] },
  sunspear: { hip: [-0.035, -0.13, -0.24], ads: 0.14, pistol: false, kick: 3, blade: -0.38, gripR: [0, -0.06, 0.02], gripL: [0, -0.04, -0.28] },
};

/** Palm centre relative to the wrist (hand bone origin) in hand-local space. */
export const PALM = new THREE.Vector3(0, -0.008, -0.056);
