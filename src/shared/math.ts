// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — shared math: vectors on plain `Vec3` objects, angles, scalar
// helpers, deterministic integer hashing and a seeded RNG.
//
// Everything here is deterministic and allocation-aware: every vector helper
// takes an explicit `out` parameter so hot paths (movement, raycasts, bots) can
// reuse scratch vectors instead of allocating per call.
//
// Angle convention (see types.ts): yaw 0 looks toward -Z, positive yaw turns
// LEFT (counter-clockwise seen from above); positive pitch looks UP.
// ─────────────────────────────────────────────────────────────────────────────

import type { Vec3 } from './types';

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

// ── Vectors ─────────────────────────────────────────────────────────────────

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function clone(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function scale(out: Vec3, a: Vec3, s: number): Vec3 {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

/** out = a + b * s */
export function addScaled(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  out.z = a.z + b.z * s;
  return out;
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function lenSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function len(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

/** Horizontal (XZ-plane) length. */
export function lenXZ(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.z * a.z);
}

export function distSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function dist(a: Vec3, b: Vec3): number {
  return Math.sqrt(distSq(a, b));
}

/** Horizontal (XZ-plane) distance. */
export function distXZ(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Normalizes `a` into `out`. A zero vector stays zero (never NaN). */
export function normalize(out: Vec3, a: Vec3): Vec3 {
  const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  if (l < 1e-12) return set(out, 0, 0, 0);
  const k = 1 / l;
  out.x = a.x * k;
  out.y = a.y * k;
  out.z = a.z * k;
  return out;
}

export function lerpV(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

export function equalsV(a: Vec3, b: Vec3, eps = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;
}

// ── Scalars ─────────────────────────────────────────────────────────────────

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp, unclamped. */
export function invLerp(a: number, b: number, x: number): number {
  return a === b ? 0 : (x - a) / (b - a);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01(edge0 === edge1 ? (x >= edge1 ? 1 : 0) : (x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Moves `cur` toward `target` by at most `maxDelta`. */
export function approach(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return Math.min(cur + maxDelta, target);
  if (cur > target) return Math.max(cur - maxDelta, target);
  return cur;
}

/** Quadratic ease-out (fast start, gentle arrival). */
export function easeOutQuad(t: number): number {
  const u = clamp01(t);
  return 1 - (1 - u) * (1 - u);
}

/** Rounds to a multiple of `step` (network quantization). */
export function quantize(x: number, step: number): number {
  return Math.round(x / step) * step;
}

/** Round to 2 decimals (positions, 0.01 m). */
export function q2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Round to 3 decimals (angles, 0.001 rad). */
export function q3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ── Angles ──────────────────────────────────────────────────────────────────

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  if (a > -Math.PI && a <= Math.PI) return a;
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}

/** Signed shortest difference `b - a` in (-π, π]. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Moves angle `a` toward `b` by at most `maxDelta` along the shortest arc. */
export function approachAngle(a: number, b: number, maxDelta: number): number {
  const d = wrapAngle(b - a);
  if (Math.abs(d) <= maxDelta) return b;
  return wrapAngle(a + Math.sign(d) * maxDelta);
}

/** View forward vector (see types.ts): x = -sin(yaw)cos(p), y = sin(p), z = -cos(yaw)cos(p). */
export function forwardFromAngles(yaw: number, pitch: number, out: Vec3 = v3()): Vec3 {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}

/** Horizontal right vector for a yaw (yaw 0 → +X). */
export function rightFromYaw(yaw: number, out: Vec3 = v3()): Vec3 {
  out.x = Math.cos(yaw);
  out.y = 0;
  out.z = -Math.sin(yaw);
  return out;
}

/** Yaw that looks along the horizontal direction (dx, dz). */
export function yawFromDir(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Pitch that looks along a direction with horizontal length `h` and vertical component `dy`. */
export function pitchFromDir(h: number, dy: number): number {
  return Math.atan2(dy, h);
}

// ── Deterministic hashing & RNG ─────────────────────────────────────────────

/** Converts any number into a 32-bit integer key (non-integers are scaled so fractions still matter). */
function toInt(n: number): number {
  if (Number.isInteger(n)) return n | 0;
  return Math.round(n * 65536) | 0;
}

function mix(h: number, k: number): number {
  k = Math.imul(k, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

function fmix(h: number, n: number): number {
  h ^= n;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic 32-bit hash (MurmurHash3-style) of a list of integers. Returns an unsigned int. */
export function hash32(...ints: number[]): number {
  let h = 0x9747b28c;
  for (let i = 0; i < ints.length; i++) h = mix(h, toInt(ints[i]));
  return fmix(h, ints.length);
}

/** Allocation-free 3-argument variant of hash32 (same result as hash32(a, b, c)). */
export function hash3(a: number, b: number, c: number): number {
  let h = 0x9747b28c;
  h = mix(h, toInt(a));
  h = mix(h, toInt(b));
  h = mix(h, toInt(c));
  return fmix(h, 3);
}

/** Deterministic float in [0, 1) from a list of integers. */
export function hashFloat(...ints: number[]): number {
  return hash32(...ints) / 4294967296;
}

/** Allocation-free 4-argument variant of hashFloat (same result as hashFloat(a, b, c, d)). */
export function hashFloat4(a: number, b: number, c: number, d: number): number {
  let h = 0x9747b28c;
  h = mix(h, toInt(a));
  h = mix(h, toInt(b));
  h = mix(h, toInt(c));
  h = mix(h, toInt(d));
  return fmix(h, 4) / 4294967296;
}

/** Hash of a string (FNV-1a 32-bit), e.g. to seed per-map RNGs from a map id. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random float in [lo, hi) from an RNG. */
export function randRange(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

/** Random integer in [lo, hi] (inclusive) from an RNG. */
export function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Picks a random element (array must be non-empty). */
export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}
