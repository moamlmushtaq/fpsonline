// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — first-person reload / cycle choreography.
//
// Each weapon's reload is a small hand-authored timeline over the reload
// progress p ∈ [0,1] (the Breaker is clock + shell-count driven because its
// progress is not linear). A timeline writes:
//   • a presentation offset for the whole weapon (tilt toward the camera),
//   • the transforms of the real moving parts (magazine, drum, bolt, pump,
//     crane, loose shell) relative to their rest pose,
//   • where each hand is: a blend between two anchors ('support' foregrip,
//     'grip', 'mag' on the magazine, 'bolt' knob, 'shell', 'pocket' off-screen),
//   • one-shot events (slap jolt, glow flare).
// All work is allocation-free (outputs are reused objects).
// ─────────────────────────────────────────────────────────────────────────────

import type * as THREE from 'three';
import type { WeaponId } from '../../../shared/types';

export type HandKey = 'grip' | 'support' | 'mag' | 'bolt' | 'shell' | 'pocket';

export interface HandPlan {
  a: HandKey;
  b: HandKey;
  k: number;
}

export interface VmPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  left: HandPlan;
  right: HandPlan;
  /** Events raised this frame. */
  slap: number;
  flare: number;
}

export interface Rest {
  pos: THREE.Vector3;
  rot: THREE.Euler;
}

export interface AnimModel {
  id: WeaponId;
  part(name: 'mag' | 'bolt' | 'pump' | 'slide' | 'shell' | 'coil'): THREE.Object3D | null;
  rest(o: THREE.Object3D): Rest | undefined;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const seg = (p: number, a: number, b: number): number => clamp01((p - a) / (b - a));
export const ease = (t: number): number => t * t * (3 - 2 * t);
export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
export const easeIn = (t: number): number => t * t * t;
export const bump = (t: number): number => Math.sin(clamp01(t) * Math.PI);

export function resetPose(o: VmPose): VmPose {
  o.x = o.y = o.z = o.rx = o.ry = o.rz = 0;
  o.left.a = o.left.b = 'support';
  o.left.k = 0;
  o.right.a = o.right.b = 'grip';
  o.right.k = 0;
  o.slap = 0;
  o.flare = 0;
  return o;
}

export function newPose(): VmPose {
  return resetPose({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, left: { a: 'support', b: 'support', k: 0 }, right: { a: 'grip', b: 'grip', k: 0 }, slap: 0, flare: 0 });
}

function hand(h: HandPlan, a: HandKey, b: HandKey, k: number): void {
  h.a = a;
  h.b = b;
  h.k = k;
}

/** Sets a part to rest + offsets. */
function place(m: AnimModel, name: 'mag' | 'bolt' | 'pump' | 'slide' | 'shell' | 'coil', x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Object3D | null {
  const o = m.part(name);
  if (!o) return null;
  const r = m.rest(o);
  if (!r) return o;
  o.position.set(r.pos.x + x, r.pos.y + y, r.pos.z + z);
  o.rotation.set(r.rot.x + rx, r.rot.y + ry, r.rot.z + rz);
  return o;
}

/** Magazine-change presentation: raised, pulled toward centre, canted clockwise. */
function magPresent(o: VmPose, k: number): void {
  o.rz += -0.8 * k;
  o.rx += 0.1 * k;
  o.ry += 0.06 * k;
  o.x += -0.1 * k;
  o.y += 0.1 * k;
  o.z += 0.05 * k;
}

/** Presentation tilt that eases in over [0,a] and out over [b,1]. */
function present(p: number, a: number, b: number): number {
  return ease(seg(p, 0, a)) * (1 - ease(seg(p, b, 1)));
}

/**
 * Blends a trip of the left hand support → X, holding X, then X → support.
 * Returns the plan in `h`.
 */
function trip(h: HandPlan, p: number, key: HandKey, t0: number, t1: number, t2: number, t3: number): void {
  if (p < t1) hand(h, 'support', key, ease(seg(p, t0, t1)));
  else if (p < t2) hand(h, key, key, 1);
  else hand(h, key, 'support', ease(seg(p, t2, t3)));
}

// ── Box / curved magazines (Meridian, Longline) ─────────────────────────────

/** Magazine swap path in weapon space: out → pocket → back → seat. Sets mag + hand. */
function magSwap(m: AnimModel, o: VmPose, p: number, t: [number, number, number, number, number], outDrop: number, curve: number): boolean {
  const [tOut, tAway, tBack, tSeat, tDone] = t;
  const out = ease(seg(p, tOut, tAway));
  const away = ease(seg(p, tAway, tBack - 0.02));
  const back = ease(seg(p, tBack, tSeat));
  const seat = easeOut(seg(p, tSeat, tDone));
  let x = 0, y = 0, z = 0, rx = 0;
  if (p < tBack) {
    y = -outDrop * out - 0.3 * away;
    z = 0.03 * out + 0.2 * away;
    x = -0.12 * away;
    rx = curve * out + 0.6 * away;
  } else {
    // New magazine rises from below, lines up, then clicks in.
    const k = 1 - back;
    y = -0.3 * k - 0.06 * (1 - seat);
    z = 0.2 * k + 0.012 * (1 - seat);
    x = -0.12 * k;
    rx = 0.6 * k + curve * 0.5 * (1 - seat);
  }
  const mag = place(m, 'mag', x, y, z, rx, 0, 0);
  if (mag) mag.visible = !(p > tAway + (tBack - tAway) * 0.6 && p < tBack + (tSeat - tBack) * 0.15);
  return p >= tDone;
}

export function reloadMeridian(m: AnimModel, p: number, empty: boolean, o: VmPose, st: { slapped: boolean; racked: boolean }): void {
  const end = empty ? 0.9 : 0.84;
  const k = present(p, 0.12, end);
  // Lift toward centre and cant clockwise: the magwell swings up into view so
  // the drop and the insert both happen on screen.
  magPresent(o, k);
  magSwap(m, o, p, [0.16, 0.3, 0.42, 0.55, 0.62], 0.12, 0.3);
  if (!st.slapped && p >= 0.62) {
    st.slapped = true;
    o.slap = 1;
  }
  if (!empty) {
    trip(o.left, p, 'mag', 0.05, 0.16, 0.64, 0.78);
    place(m, 'bolt', 0, 0, 0);
    return;
  }
  // Empty: the support hand racks the charging handle after the new mag.
  if (p < 0.64) trip(o.left, p, 'mag', 0.05, 0.16, 1, 1);
  else if (p < 0.72) hand(o.left, 'mag', 'bolt', ease(seg(p, 0.64, 0.72)));
  else if (p < 0.8) hand(o.left, 'bolt', 'bolt', 1);
  else hand(o.left, 'bolt', 'support', ease(seg(p, 0.8, 0.9)));
  const pull = ease(seg(p, 0.72, 0.785));
  const snap = easeIn(seg(p, 0.785, 0.8));
  place(m, 'bolt', 0, 0, 0.065 * pull * (1 - snap));
  if (!st.racked && p >= 0.8) {
    st.racked = true;
    o.slap = 0.7;
  }
  o.rz += -0.08 * bump(seg(p, 0.7, 0.86));
}

export function reloadLongline(m: AnimModel, p: number, empty: boolean, o: VmPose, st: { slapped: boolean; racked: boolean }): void {
  // Present the bolt (roll left) to open it, the mag well (roll right) for the
  // swap, then the bolt again to close it.
  const kb = Math.max(ease(seg(p, 0.02, 0.12)) * (1 - ease(seg(p, 0.26, 0.34))), ease(seg(p, 0.6, 0.68)) * (1 - ease(seg(p, 0.84, 0.94))));
  const km = ease(seg(p, 0.26, 0.36)) * (1 - ease(seg(p, 0.6, 0.7)));
  boltPresent(o, kb);
  magPresent(o, km);
  // Right hand works the bolt: open → (mag swap) → close.
  if (p < 0.14) hand(o.right, 'grip', 'bolt', ease(seg(p, 0.03, 0.14)));
  else if (p < 0.8) hand(o.right, 'bolt', 'bolt', 1);
  else hand(o.right, 'bolt', 'grip', ease(seg(p, 0.8, 0.9)));
  const lift = ease(seg(p, 0.12, 0.2)) * (1 - ease(seg(p, 0.74, 0.8)));
  const back = ease(seg(p, 0.2, 0.28)) * (1 - ease(seg(p, 0.67, 0.73)));
  place(m, 'bolt', 0, 0, 0.075 * back, 0, 0, 1.15 * lift);
  magSwap(m, o, p, [0.28, 0.38, 0.47, 0.57, 0.63], 0.1, 0.1);
  trip(o.left, p, 'mag', 0.2, 0.28, 0.64, 0.76);
  if (!st.slapped && p >= 0.63) {
    st.slapped = true;
    o.slap = 0.8;
  }
  if (!st.racked && p >= 0.74) {
    st.racked = true;
    o.slap = empty ? 0.9 : 0.6;
  }
}

// ── Swift pan drum ──────────────────────────────────────────────────────────

export function reloadSwift(m: AnimModel, p: number, empty: boolean, o: VmPose, st: { slapped: boolean; racked: boolean }): void {
  const end = empty ? 0.9 : 0.84;
  const k = present(p, 0.1, end);
  o.rz += 0.36 * k;
  o.rx += 0.02 * k;
  o.ry += 0.14 * k;
  o.x += -0.06 * k;
  o.y += 0.07 * k;
  o.z += 0.02 * k;
  const unclip = ease(seg(p, 0.18, 0.26));
  // Out: lift and swing left (on screen), then swoop down out of frame — the
  // hand is never seen holding nothing while the drums are swapped.
  const side = ease(seg(p, 0.26, 0.31));
  const down = ease(seg(p, 0.3, 0.38));
  // In: rise from below on the left, then slide over onto the neck.
  const rise = ease(seg(p, 0.41, 0.48));
  const over = ease(seg(p, 0.47, 0.53));
  const drop = easeOut(seg(p, 0.53, 0.58));
  const lock = ease(seg(p, 0.58, 0.63));
  let x = 0, y = 0, z = 0, spin = 0, rz = 0;
  if (p < 0.4) {
    x = -0.17 * side - 0.1 * down;
    y = 0.035 * unclip + 0.04 * side - 0.34 * down;
    z = 0.09 * down;
    spin = -0.5 * unclip - 1.2 * down;
    rz = 0.6 * side + 0.4 * down;
  } else {
    const kd = 1 - rise, ks = 1 - over;
    x = -0.17 * ks - 0.1 * kd;
    y = 0.04 * ks - 0.34 * kd + 0.03 * (1 - drop);
    z = 0.09 * kd;
    spin = 1.2 * kd + 0.5 * ks + 0.35 * (1 - lock);
    rz = 0.6 * ks + 0.4 * kd;
  }
  const drum = place(m, 'mag', x, y, z, 0, spin, rz);
  if (drum) drum.visible = !(p > 0.37 && p < 0.42);
  if (!st.slapped && p >= 0.63) {
    st.slapped = true;
    o.slap = -1.2;
  }
  if (!empty) {
    trip(o.left, p, 'mag', 0.07, 0.18, 0.66, 0.8);
    place(m, 'bolt', 0, 0, 0);
    return;
  }
  if (p < 0.66) trip(o.left, p, 'mag', 0.07, 0.18, 1, 1);
  else if (p < 0.73) hand(o.left, 'mag', 'bolt', ease(seg(p, 0.66, 0.73)));
  else if (p < 0.81) hand(o.left, 'bolt', 'bolt', 1);
  else hand(o.left, 'bolt', 'support', ease(seg(p, 0.81, 0.9)));
  const pull = ease(seg(p, 0.73, 0.795));
  const snap = easeIn(seg(p, 0.795, 0.81));
  place(m, 'bolt', 0, 0, 0.05 * pull * (1 - snap));
  if (!st.racked && p >= 0.81) {
    st.racked = true;
    o.slap = 0.6;
  }
}

// ── Pulse capacitor cartridge ───────────────────────────────────────────────

export function reloadPulse(m: AnimModel, p: number, _empty: boolean, o: VmPose, st: { slapped: boolean; racked: boolean }): void {
  const k = present(p, 0.12, 0.86);
  o.rx += 0.42 * k;
  o.rz += 0.34 * k;
  o.ry += 0.22 * k;
  o.x += -0.08 * k;
  o.y += 0.07 * k;
  o.z += 0.04 * k;
  // Crane swings out left, flicks shut.
  const open = easeOut(seg(p, 0.1, 0.24)) * (1 - easeIn(seg(p, 0.66, 0.71)));
  place(m, 'mag', 0, 0, 0, 0, 0, 1.3 * open);
  // Cartridge: slides back out, goes to the pocket, the fresh one comes back.
  const cyl = m.part('coil');
  const r = cyl ? m.rest(cyl) : undefined;
  if (cyl && r) {
    const out = ease(seg(p, 0.28, 0.35));
    const away = ease(seg(p, 0.35, 0.45));
    const back = ease(seg(p, 0.47, 0.57));
    const seat = easeOut(seg(p, 0.57, 0.62));
    let x = 0, y = 0, z = 0;
    if (p < 0.46) {
      z = 0.08 * out + 0.12 * away;
      y = -0.28 * away;
      x = -0.06 * away;
    } else {
      const kk = 1 - back;
      z = 0.2 * kk + 0.08 * (1 - seat) * (1 - kk);
      y = -0.28 * kk;
      x = -0.06 * kk;
    }
    cyl.position.set(r.pos.x + x, r.pos.y + y, r.pos.z + z);
    cyl.visible = !(p > 0.43 && p < 0.49);
  }
  trip(o.left, p, 'mag', 0.18, 0.28, 0.63, 0.76);
  if (!st.racked && p >= 0.62) {
    st.racked = true;
    o.flare = 1;
  }
  if (!st.slapped && p >= 0.71) {
    st.slapped = true;
    o.slap = 1.2;
  }
  o.rz += 0.12 * bump(seg(p, 0.66, 0.8));
}

// ── Breaker: shell-by-shell ─────────────────────────────────────────────────

export interface ShellState {
  /** Seconds since reload start. */
  clock: number;
  /** Seconds since the current shell cycle started. */
  shellClock: number;
  lead: number;
  per: number;
  empty: boolean;
  /** Rounds still missing (0 → no more shells to fetch). */
  missing: number;
}

export function reloadBreaker(m: AnimModel, s: ShellState, o: VmPose): void {
  const k = ease(clamp01(s.clock / 0.3));
  o.rz += -1.2 * k;
  o.rx += 0.32 * k;
  o.ry += 0.28 * k;
  o.x += -0.1 * k;
  o.y += 0.13 * k;
  o.z += 0.02 * k;
  const shellsStarted = s.clock >= s.lead;
  // Empty: rack the pump during the lead-in (chambering the first shell).
  let pump = 0;
  if (s.empty) pump = bump(seg(s.clock, s.lead - 0.6, s.lead - 0.12));
  place(m, 'pump', 0, 0, 0.09 * pump);
  const shell = m.part('shell');
  const r = shell ? m.rest(shell) : undefined;
  if (!shellsStarted) {
    // Hand leaves the pump for the pocket once the lead-in is under way.
    const t0 = s.empty ? s.lead - 0.12 : 0.12;
    hand(o.left, 'support', 'pocket', ease(seg(s.clock, t0, Math.min(s.lead, t0 + 0.28))));
    if (shell) shell.visible = false;
    return;
  }
  const phi = clamp01(s.shellClock / s.per);
  const bring = ease(seg(phi, 0.0, 0.46));
  const push = ease(seg(phi, 0.5, 0.8));
  if (shell && r) {
    const kk = 1 - bring;
    shell.position.set(r.pos.x - 0.06 * kk, r.pos.y - 0.2 * kk + 0.02 * (1 - kk) + 0.045 * push, r.pos.z + 0.12 * kk - 0.07 * push);
    shell.rotation.set(r.rot.x + 0.9 * kk, 0, 0.4 * kk);
    shell.visible = s.missing > 0 && phi < 0.8;
  }
  if (s.missing <= 0) hand(o.left, 'pocket', 'pocket', 1);
  else if (phi < 0.8) hand(o.left, 'shell', 'shell', 1);
  else hand(o.left, 'shell', 'pocket', ease(seg(phi, 0.8, 1)));
  o.rx += -0.025 * bump(seg(phi, 0.62, 0.86));
}

// ── Cycles after a shot (pump / bolt) ───────────────────────────────────────

/** c = 0..1 through the cycle window (after CYCLE_DELAY). */
export function cycleBreaker(m: AnimModel, c: number, o: VmPose): void {
  const back = ease(seg(c, 0, 0.42));
  const fwd = ease(seg(c, 0.48, 0.86));
  place(m, 'pump', 0, 0, 0.095 * back * (1 - fwd));
  const b = bump(c);
  o.y += -0.012 * b;
  o.rz += -0.07 * b;
  o.rx += 0.02 * b;
  o.z += 0.012 * b;
}

export function cycleLongline(m: AnimModel, c: number, o: VmPose): void {
  if (c < 0.2) hand(o.right, 'grip', 'bolt', ease(seg(c, 0, 0.2)));
  else if (c < 0.82) hand(o.right, 'bolt', 'bolt', 1);
  else hand(o.right, 'bolt', 'grip', ease(seg(c, 0.82, 1)));
  const lift = ease(seg(c, 0.16, 0.34)) * (1 - ease(seg(c, 0.7, 0.84)));
  const back = ease(seg(c, 0.34, 0.5)) * (1 - ease(seg(c, 0.55, 0.7)));
  place(m, 'bolt', 0, 0, 0.075 * back, 0, 0, 1.15 * lift);
  boltPresent(o, ease(seg(c, 0, 0.22)) * (1 - ease(seg(c, 0.78, 1))));
}

/** Longline: lifts and rolls the rifle so the bolt (right side, rear) is in view. */
function boltPresent(o: VmPose, k: number): void {
  o.x += -0.04 * k;
  o.y += 0.07 * k;
  o.z += 0.02 * k;
  o.rx += 0.12 * k;
  o.ry += 0.1 * k;
  o.rz += 0.25 * k;
}
