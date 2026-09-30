// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — player movement (walk, sprint, crouch, jump, slide, mantle,
// step-up, ramps). Shared verbatim by host simulation and client prediction.
//
// Determinism: stepMovement is a pure function of (MoveState, InputCmd,
// speedMult, dt, CollisionWorld). No randomness, no clocks, fixed iteration
// order — client replays reproduce host results exactly on the same JS engine.
//
// Feel targets
//  • Ground: "accelerate toward target velocity" (60 m/s²) for snappy starts and
//    direction changes; Quake-style friction with a stop-speed floor when there
//    is no input (stop from sprint ≈ 0.18 s). Overspeed (after a slide or a
//    landing) bleeds off smoothly instead of snapping.
//  • Air: limited control (AIR_ACCEL) that can steer but never ADD horizontal
//    speed beyond max(take-off speed, AIR_CONTROL_MAX) → no strafe-jump gains.
//    Jumps cap horizontal speed → no bunny-hop chains.
//  • Slide: from sprint on crouch press; commits for SLIDE_DURATION with low
//    friction and gentle steering; downhill ramps extend it; slide-jump keeps
//    momentum (capped).
//  • Mantle: scripted ease-out arc onto ledges between MANTLE_MIN/MAX height.
//  • Collision: player = AABB (half-width PLAYER_RADIUS). Movement is split into
//    sub-steps so no sub-step travels more than ~0.45·radius (no tunnelling
//    through 0.2 m walls at any speed), resolved per axis with step-up.
//
// Call order per InputCmd (see combat.ts `stepPlayer`): stepCombat → stepMovement.
// stepMovement updates `prevButtons` at the end, so edge detection in combat
// (which runs first) sees the previous tick's buttons.
// ─────────────────────────────────────────────────────────────────────────────

import {
  AIR_ACCEL,
  AIR_CONTROL_MAX,
  COYOTE_TIME,
  CROUCH_EYE_HEIGHT,
  CROUCH_SPEED,
  CROUCH_SPEED_T,
  EYE_HEIGHT,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_VELOCITY,
  MANTLE_DURATION,
  MANTLE_MAX_HEIGHT,
  MANTLE_MIN_HEIGHT,
  MANTLE_REACH,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SLIDE_COOLDOWN,
  SLIDE_DURATION,
  SLIDE_FRICTION,
  SLIDE_MIN_SPEED,
  SLIDE_SPEED,
  SPRINT_SPEED,
  STEP_HEIGHT,
  STRIDE_LENGTH,
  WALK_SPEED,
} from './constants';
import { approach, clamp, easeOutQuad, lerp, smoothstep } from './math';
import type { CollisionWorld } from './physics';
import type { InputCmd, MoveState, Vec3 } from './types';
import { BTN_ADS, BTN_CROUCH, BTN_FIRE, BTN_JUMP, BTN_SPRINT } from './types';

// ── Local tuning (not part of the shared constants contract) ────────────────
/** Friction floor so low speeds stop crisply instead of creeping. */
const STOP_SPEED = 3;
/** Exponential rate (1/s) at which speed above the current target bleeds off while holding input. */
const OVERSPEED_BLEED = 6;
/** Reversing direction (ADAD strafing) accelerates this much harder. */
const REVERSE_ACCEL_MULT = 1.5;
/** Backpedal speed factor at full reverse input. */
const BACKPEDAL_MULT = 0.9;
/** Horizontal speed cap applied on a slide-jump (keeps momentum, bounded). */
const SLIDE_JUMP_CAP = 9.2;
/** Slide steering: max turn rate of the slide direction (rad/s). */
const SLIDE_STEER_RATE = 1.5;
/** Hard cap for slide speed (downhill). */
const SLIDE_MAX_SPEED = SLIDE_SPEED * 1.3;
/** Collision skin kept between the player box and walls. */
const SKIN = 1e-3;
/** Max vertical terminal speed. */
const TERMINAL_VY = 45;
/** Small steps allowed while falling (smooths landing on edges). */
const AIR_STEP = 0.25;
/** Minimum ledge rise for an airborne (jump) mantle. */
const AIR_MANTLE_MIN_RISE = 0.2;

const R = PLAYER_RADIUS;

// ── Public API ──────────────────────────────────────────────────────────────

export function createMoveState(pos: Vec3): MoveState {
  return {
    pos: { x: pos.x, y: pos.y, z: pos.z },
    vel: { x: 0, y: 0, z: 0 },
    onGround: true,
    crouch: false,
    crouchT: 0,
    sprint: false,
    slideT: 0,
    slideCooldown: 0,
    mantleT: 0,
    mantleFrom: { x: pos.x, y: pos.y, z: pos.z },
    mantleTo: { x: pos.x, y: pos.y, z: pos.z },
    prevButtons: 0,
    airTime: 0,
    landImpact: 0,
    ground: 'concrete',
    stride: 0,
  };
}

/** Deep copy of a MoveState (prediction history, snapshots). */
export function cloneMoveState(m: MoveState): MoveState {
  return {
    pos: { x: m.pos.x, y: m.pos.y, z: m.pos.z },
    vel: { x: m.vel.x, y: m.vel.y, z: m.vel.z },
    onGround: m.onGround,
    crouch: m.crouch,
    crouchT: m.crouchT,
    sprint: m.sprint,
    slideT: m.slideT,
    slideCooldown: m.slideCooldown,
    mantleT: m.mantleT,
    mantleFrom: { x: m.mantleFrom.x, y: m.mantleFrom.y, z: m.mantleFrom.z },
    mantleTo: { x: m.mantleTo.x, y: m.mantleTo.y, z: m.mantleTo.z },
    prevButtons: m.prevButtons,
    airTime: m.airTime,
    landImpact: m.landImpact,
    ground: m.ground,
    stride: m.stride,
  };
}

/** Current collision height: lerp(PLAYER_HEIGHT, PLAYER_CROUCH_HEIGHT, crouchT). */
export function playerHeight(m: MoveState): number {
  return lerp(PLAYER_HEIGHT, PLAYER_CROUCH_HEIGHT, m.crouchT);
}

/** Eye height above the feet: lerp(EYE_HEIGHT, CROUCH_EYE_HEIGHT, crouchT). */
export function eyeHeight(m: MoveState): number {
  return lerp(EYE_HEIGHT, CROUCH_EYE_HEIGHT, m.crouchT);
}

/** Horizontal speed (m/s). */
export function horizontalSpeed(m: MoveState): number {
  return Math.sqrt(m.vel.x * m.vel.x + m.vel.z * m.vel.z);
}

/**
 * Advances one movement tick. `speedMult` comes from combat (weapon handling ×
 * ADS slow). Deterministic.
 */
export function stepMovement(world: CollisionWorld, m: MoveState, cmd: InputCmd, speedMult: number, dt: number): void {
  const buttons = cmd.buttons | 0;
  const pressed = buttons & ~m.prevButtons;
  m.landImpact = 0;
  sanitizeState(m);
  if (m.slideCooldown > 0) m.slideCooldown = Math.max(0, m.slideCooldown - dt);
  if (!(speedMult > 0)) speedMult = 1;

  // ── Scripted mantle in progress ──
  if (m.mantleT > 0) {
    advanceMantle(world, m, dt);
    updateCrouchT(m, dt);
    m.prevButtons = buttons;
    return;
  }

  // ── Input → world-space wish vector (magnitude ≤ 1) ──
  const mx = finiteOr(clamp(cmd.mx, -1, 1), 0);
  const mz = finiteOr(clamp(cmd.mz, -1, 1), 0);
  const yaw = finiteOr(cmd.yaw, 0);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const fx = -sy;
  const fz = -cy;
  const rx = cy;
  const rz = -sy;
  let wx = rx * mx + fx * mz;
  let wz = rz * mx + fz * mz;
  let wl = Math.sqrt(wx * wx + wz * wz);
  if (wl > 1) {
    wx /= wl;
    wz /= wl;
    wl = 1;
  }
  const wdx = wl > 1e-4 ? wx / wl : 0;
  const wdz = wl > 1e-4 ? wz / wl : 0;
  const ads = (buttons & BTN_ADS) !== 0;
  const fire = (buttons & BTN_FIRE) !== 0;
  const crouchHeld = (buttons & BTN_CROUCH) !== 0;
  const wasGround = m.onGround;

  // ── Slide start (crouch pressed while sprinting on the ground) ──
  if (m.slideT <= 0 && (pressed & BTN_CROUCH) && m.sprint && m.onGround && m.slideCooldown <= 0) {
    const hs = Math.sqrt(m.vel.x * m.vel.x + m.vel.z * m.vel.z);
    if (hs >= SLIDE_MIN_SPEED) {
      const ns = Math.max(hs, SLIDE_SPEED);
      m.vel.x = (m.vel.x / hs) * ns;
      m.vel.z = (m.vel.z / hs) * ns;
      m.slideT = SLIDE_DURATION;
      m.sprint = false;
      m.crouch = true;
    }
  }

  // ── Crouch (held); standing up requires headroom ──
  if (crouchHeld || m.slideT > 0) m.crouch = true;
  else if (m.crouch && !world.boxOverlaps(m.pos.x, m.pos.y, m.pos.z, R, PLAYER_HEIGHT)) m.crouch = false;
  updateCrouchT(m, dt);

  // ── Sprint: mostly-forward input, no ADS / fire / crouch / slide ──
  const sprintOk = (buttons & BTN_SPRINT) !== 0 && mz > 0.5 && !ads && !fire && !m.crouch && m.slideT <= 0;
  m.sprint = m.onGround ? sprintOk : m.sprint && sprintOk;

  // ── Jump / mantle ──
  let jumped = false;
  if (pressed & BTN_JUMP) {
    const coyote = !m.onGround && m.airTime < COYOTE_TIME && m.vel.y <= 0;
    if (mz > 0.3 && tryMantle(world, m, fx, fz, false)) {
      m.prevButtons = buttons;
      return;
    }
    if (m.onGround || coyote) {
      const hs = Math.sqrt(m.vel.x * m.vel.x + m.vel.z * m.vel.z);
      let cap = SPRINT_SPEED * Math.max(1, speedMult);
      if (m.slideT > 0) {
        cap = SLIDE_JUMP_CAP;
        endSlide(m);
      }
      if (hs > cap) {
        m.vel.x *= cap / hs;
        m.vel.z *= cap / hs;
      }
      m.vel.y = JUMP_VELOCITY;
      m.onGround = false;
      m.airTime = COYOTE_TIME;
      jumped = true;
    }
  } else if (!m.onGround && mz > 0.5 && m.vel.y < 3 && tryMantle(world, m, fx, fz, true)) {
    // Airborne auto-mantle when pressing forward into a ledge.
    m.prevButtons = buttons;
    return;
  }

  // ── Horizontal acceleration ──
  if (m.onGround && !jumped) {
    if (m.slideT > 0) slidePhysics(world, m, wdx, wdz, wl, dt);
    else {
      let target = lerp(WALK_SPEED, CROUCH_SPEED, m.crouchT);
      if (m.sprint) target = SPRINT_SPEED;
      if (mz < 0) target *= lerp(1, BACKPEDAL_MULT, -mz);
      groundAccel(m, wdx, wdz, target * speedMult * wl, dt);
    }
  } else {
    const target = (m.sprint ? SPRINT_SPEED : lerp(WALK_SPEED, CROUCH_SPEED, m.crouchT)) * speedMult * wl;
    airAccel(m, wdx, wdz, Math.min(target, AIR_CONTROL_MAX), dt);
    if (m.slideT > 0) endSlide(m);
  }

  // ── Gravity ──
  if (!m.onGround) {
    m.vel.y -= GRAVITY * dt;
    if (m.vel.y < -TERMINAL_VY) m.vel.y = -TERMINAL_VY;
  } else if (!jumped) m.vel.y = 0;

  // ── Integrate with collision (sub-stepped) ──
  const startX = m.pos.x;
  const startZ = m.pos.z;
  const h = playerHeight(m);
  depenetrate(world, m, h);
  const maxComp = Math.max(Math.abs(m.vel.x), Math.abs(m.vel.y), Math.abs(m.vel.z)) * dt;
  const n = clamp(Math.ceil(maxComp / (R * 0.45)), 1, 32);
  const sdt = dt / n;
  const stepLimit = wasGround || m.slideT > 0 ? STEP_HEIGHT : 0;
  let landVy = 0;
  let landed = false;
  for (let i = 0; i < n; i++) {
    const airStep = m.vel.y <= 0 ? AIR_STEP : 0;
    moveHoriz(world, m, 0, m.vel.x * sdt, h, stepLimit > 0 ? stepLimit : airStep);
    moveHoriz(world, m, 2, m.vel.z * sdt, h, stepLimit > 0 ? stepLimit : airStep);
    const vyBefore = m.vel.y;
    if (moveVert(world, m, m.vel.y * sdt, h)) {
      landed = true;
      landVy = vyBefore;
    }
  }

  // ── Bounds ──
  clampToBounds(world, m);

  // ── Ground probe (snap down stairs / ramps while grounded) ──
  if (m.vel.y <= 0) {
    const snap = wasGround && !jumped ? STEP_HEIGHT + 0.05 : 0.02;
    const g = world.supportHeight(m.pos.x, m.pos.z, R, m.pos.y + 1e-3, snap);
    if (!Number.isNaN(g) && (!world.boxOverlaps(m.pos.x, g, m.pos.z, R, h) || g >= m.pos.y - 1e-3)) {
      const solid = world.supportSolid;
      if (!wasGround) m.landImpact = Math.max(0, -(landed ? landVy : m.vel.y));
      m.pos.y = g;
      m.vel.y = 0;
      m.onGround = true;
      m.airTime = 0;
      if (solid) m.ground = solid.tag;
    } else {
      m.onGround = false;
    }
  } else {
    m.onGround = false;
  }
  if (!m.onGround) {
    m.airTime += dt;
    if (m.slideT > 0) endSlide(m);
  }
  if (world.waterY !== undefined && m.onGround && m.pos.y < world.waterY + 0.05) m.ground = 'water';

  // ── Footstep stride (ground travel only; slides are silent here) ──
  if (m.onGround && m.slideT <= 0) {
    const ddx = m.pos.x - startX;
    const ddz = m.pos.z - startZ;
    m.stride += Math.sqrt(ddx * ddx + ddz * ddz);
    if (m.stride > STRIDE_LENGTH * 10000) m.stride -= STRIDE_LENGTH * 10000;
  }

  m.prevButtons = buttons;
}

// ── Internals ───────────────────────────────────────────────────────────────

function finiteOr(x: number, d: number): number {
  return Number.isFinite(x) ? x : d;
}

function sanitizeState(m: MoveState): void {
  if (!Number.isFinite(m.vel.x) || !Number.isFinite(m.vel.y) || !Number.isFinite(m.vel.z)) {
    m.vel.x = 0;
    m.vel.y = 0;
    m.vel.z = 0;
  }
  if (!Number.isFinite(m.crouchT)) m.crouchT = 0;
}

function updateCrouchT(m: MoveState, dt: number): void {
  m.crouchT = approach(m.crouchT, m.crouch ? 1 : 0, CROUCH_SPEED_T * dt);
}

function endSlide(m: MoveState): void {
  m.slideT = 0;
  m.slideCooldown = SLIDE_COOLDOWN;
}

function groundAccel(m: MoveState, wdx: number, wdz: number, wishSpeed: number, dt: number): void {
  const vx = m.vel.x;
  const vz = m.vel.z;
  const speed = Math.sqrt(vx * vx + vz * vz);
  if (wishSpeed < 1e-4) {
    if (speed > 0) {
      const drop = Math.max(speed, STOP_SPEED) * GROUND_FRICTION * dt;
      const ns = Math.max(0, speed - drop);
      const k = ns / speed;
      m.vel.x = vx * k;
      m.vel.z = vz * k;
    }
    return;
  }
  // Bleed any speed above the target smoothly (post-slide, post-landing).
  let mag = wishSpeed;
  if (speed > wishSpeed) mag = speed - (speed - wishSpeed) * Math.min(1, OVERSPEED_BLEED * dt);
  const tvx = wdx * mag;
  const tvz = wdz * mag;
  let dvx = tvx - vx;
  let dvz = tvz - vz;
  const dl = Math.sqrt(dvx * dvx + dvz * dvz);
  let maxDv = GROUND_ACCEL * dt;
  if (vx * wdx + vz * wdz < 0) maxDv *= REVERSE_ACCEL_MULT;
  if (dl > maxDv) {
    dvx *= maxDv / dl;
    dvz *= maxDv / dl;
  }
  m.vel.x = vx + dvx;
  m.vel.z = vz + dvz;
}

function airAccel(m: MoveState, wdx: number, wdz: number, wishSpeed: number, dt: number): void {
  if (wishSpeed < 1e-4) return;
  const vx = m.vel.x;
  const vz = m.vel.z;
  const before = Math.sqrt(vx * vx + vz * vz);
  const cur = vx * wdx + vz * wdz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const a = Math.min(add, AIR_ACCEL * dt);
  let nvx = vx + wdx * a;
  let nvz = vz + wdz * a;
  // Air control may steer but never add speed beyond max(take-off speed, wish speed).
  const after = Math.sqrt(nvx * nvx + nvz * nvz);
  const cap = Math.max(before, wishSpeed);
  if (after > cap && after > 0) {
    nvx *= cap / after;
    nvz *= cap / after;
  }
  m.vel.x = nvx;
  m.vel.z = nvz;
}

function slidePhysics(world: CollisionWorld, m: MoveState, wdx: number, wdz: number, wl: number, dt: number): void {
  let vx = m.vel.x;
  let vz = m.vel.z;
  const speed = Math.sqrt(vx * vx + vz * vz);
  if (speed < 1e-4) {
    endSlide(m);
    return;
  }
  let dx = vx / speed;
  let dz = vz / speed;
  // Slope under the player: downhill (negative rise) reduces friction and stretches the slide.
  world.supportHeight(m.pos.x, m.pos.z, R, m.pos.y + 0.05, 0.2);
  const slope = world.slopeAlong(world.supportSolid, dx, dz);
  const decel = SLIDE_FRICTION * (1 + speed / SLIDE_SPEED) + GRAVITY * slope * 0.6;
  const ns = clamp(speed - decel * dt, 0, SLIDE_MAX_SPEED);
  // Gentle steering toward the input direction.
  if (wl > 0.1) {
    const cross = dx * wdz - dz * wdx;
    const dotp = dx * wdx + dz * wdz;
    const ang = Math.atan2(cross, dotp);
    const turn = clamp(ang, -SLIDE_STEER_RATE * dt, SLIDE_STEER_RATE * dt);
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const ndx = dx * c - dz * s;
    const ndz = dx * s + dz * c;
    dx = ndx;
    dz = ndz;
  }
  vx = dx * ns;
  vz = dz * ns;
  m.vel.x = vx;
  m.vel.z = vz;
  m.slideT -= dt * (slope < -0.05 ? 0.5 : 1);
  if (m.slideT <= 0 || ns < CROUCH_SPEED) endSlide(m);
}

/** Moves along X (axis 0) or Z (axis 2) with step-up and face clamping. */
function moveHoriz(world: CollisionWorld, m: MoveState, axis: 0 | 2, delta: number, h: number, stepLimit: number): void {
  if (delta === 0) return;
  const p = m.pos;
  const oldC = axis === 0 ? p.x : p.z;
  const newC = oldC + delta;
  const tx = axis === 0 ? newC : p.x;
  const tz = axis === 0 ? p.z : newC;
  if (world.overlapInfo(tx, p.y, tz, R, h) === 0) {
    if (axis === 0) p.x = newC;
    else p.z = newC;
    return;
  }
  // Step up onto low obstacles / ramps.
  if (stepLimit > 0) {
    const top = world.ovMaxTop;
    const lift = top - p.y;
    if (lift > 0 && lift <= stepLimit + 1e-6 && !world.boxOverlaps(tx, top, tz, R, h)) {
      p.y = top;
      if (axis === 0) p.x = newC;
      else p.z = newC;
      return;
    }
    // Re-gather overlap extents (boxOverlaps does not touch ov* but be explicit).
    world.overlapInfo(tx, p.y, tz, R, h);
  }
  // Blocked: slide up to the face of the obstacle(s), never past the old position.
  let c: number;
  if (delta > 0) {
    const face = (axis === 0 ? world.ovMinX : world.ovMinZ) - R - SKIN;
    c = Math.max(oldC, Math.min(newC, face));
  } else {
    const face = (axis === 0 ? world.ovMaxX : world.ovMaxZ) + R + SKIN;
    c = Math.min(oldC, Math.max(newC, face));
  }
  if (c !== oldC) {
    const cx = axis === 0 ? c : p.x;
    const cz = axis === 0 ? p.z : c;
    if (world.boxOverlaps(cx, p.y, cz, R, h)) c = oldC;
  }
  if (axis === 0) {
    p.x = c;
    m.vel.x = 0;
  } else {
    p.z = c;
    m.vel.z = 0;
  }
}

/** Vertical move. Returns true when the player landed on something this call. */
function moveVert(world: CollisionWorld, m: MoveState, delta: number, h: number): boolean {
  if (delta === 0) return false;
  const p = m.pos;
  const ny = p.y + delta;
  if (world.overlapInfo(p.x, ny, p.z, R, h) === 0) {
    p.y = ny;
    return false;
  }
  if (delta < 0) {
    const top = world.ovMaxTop;
    if (top <= p.y + 1e-3) {
      p.y = Math.max(ny, top);
      m.vel.y = 0;
      return true;
    }
    // Overlapping something above the feet (should not happen): stay put.
    m.vel.y = 0;
    return false;
  }
  // Ceiling bump.
  const ceil = world.ovMinBottom - h - SKIN;
  p.y = Math.max(p.y, Math.min(ny, ceil));
  if (m.vel.y > 0) m.vel.y = 0;
  return false;
}

/** Pushes the player out of any solid it overlaps (spawns, crouch edge cases). */
function depenetrate(world: CollisionWorld, m: MoveState, h: number): void {
  const p = m.pos;
  if (world.overlapInfo(p.x, p.y, p.z, R, h) === 0) return;
  const up = world.ovMaxTop - p.y;
  const px = world.ovMaxX + R + SKIN - p.x;
  const nxp = p.x - (world.ovMinX - R - SKIN);
  const pz = world.ovMaxZ + R + SKIN - p.z;
  const nzp = p.z - (world.ovMinZ - R - SKIN);
  // Candidates ordered by preference for ties; pick the smallest push that frees the box.
  const cands: [number, number, number, number][] = [
    [up, 0, up, 0],
    [px, px, 0, 0],
    [nxp, -nxp, 0, 0],
    [pz, 0, 0, pz],
    [nzp, 0, 0, -nzp],
  ];
  cands.sort((a, b) => a[0] - b[0]);
  for (const [mag, ddx, ddy, ddz] of cands) {
    if (!(mag > 0) || mag > 2) continue;
    if (!world.boxOverlaps(p.x + ddx, p.y + ddy, p.z + ddz, R, h)) {
      p.x += ddx;
      p.y += ddy;
      p.z += ddz;
      return;
    }
  }
}

function clampToBounds(world: CollisionWorld, m: MoveState): void {
  const b = world.bounds;
  const p = m.pos;
  if (p.x < b.min.x + R) {
    p.x = b.min.x + R;
    if (m.vel.x < 0) m.vel.x = 0;
  } else if (p.x > b.max.x - R) {
    p.x = b.max.x - R;
    if (m.vel.x > 0) m.vel.x = 0;
  }
  if (p.z < b.min.z + R) {
    p.z = b.min.z + R;
    if (m.vel.z < 0) m.vel.z = 0;
  } else if (p.z > b.max.z - R) {
    p.z = b.max.z - R;
    if (m.vel.z > 0) m.vel.z = 0;
  }
}

/** Probe distances ahead of the player's front face for a mantle-able ledge. */
const MANTLE_PROBES = [0.12, 0.3, 0.5, MANTLE_REACH];

/**
 * Looks for a ledge ahead (along the view's horizontal forward) whose top is between
 * MANTLE_MIN_HEIGHT and MANTLE_MAX_HEIGHT above the feet with room to stand on it.
 * Starts the scripted mantle and returns true on success.
 */
function tryMantle(world: CollisionWorld, m: MoveState, fx: number, fz: number, airborne: boolean): boolean {
  const p = m.pos;
  const feet = p.y;
  const standH = PLAYER_HEIGHT;
  // On the ground we only mantle "real" ledges (lower ones are stepped or jumped);
  // in the air any lip we are pressing into counts (jump-mantle reach ≈ 2.4 m).
  const minRise = airborne ? AIR_MANTLE_MIN_RISE : MANTLE_MIN_HEIGHT;
  if (airborne) {
    // Airborne: only when actually pressing into an obstacle.
    if (!world.boxOverlaps(p.x + fx * 0.2, feet + 0.02, p.z + fz * 0.2, R, Math.min(playerHeight(m), MANTLE_MAX_HEIGHT))) return false;
  }
  for (let i = 0; i < MANTLE_PROBES.length; i++) {
    const d = R + MANTLE_PROBES[i];
    const px = p.x + fx * d;
    const pz = p.z + fz * d;
    const top = world.supportHeight(px, pz, 0, feet + MANTLE_MAX_HEIGHT, MANTLE_MAX_HEIGHT - minRise);
    if (Number.isNaN(top)) continue;
    const rise = top - feet;
    if (rise < minRise - 1e-6 || rise > MANTLE_MAX_HEIGHT + 1e-6) continue;
    const dx = px + fx * 0.1;
    const dz = pz + fz * 0.1;
    const y = top + 1e-3;
    // Room to stand at the destination (fall back to crouch height when already crouched).
    let h = standH;
    if (world.boxOverlaps(dx, y, dz, R, h)) {
      if (!m.crouch) continue;
      h = PLAYER_CROUCH_HEIGHT;
      if (world.boxOverlaps(dx, y, dz, R, h)) continue;
    }
    // Room to rise in place and to move over the lip.
    if (world.boxOverlaps(p.x, y, p.z, R, h)) continue;
    if (world.boxOverlaps((p.x + dx) * 0.5, y, (p.z + dz) * 0.5, R, h)) continue;
    const b = world.bounds;
    if (dx < b.min.x + R || dx > b.max.x - R || dz < b.min.z + R || dz > b.max.z - R) continue;
    m.mantleT = MANTLE_DURATION;
    m.mantleFrom.x = p.x;
    m.mantleFrom.y = p.y;
    m.mantleFrom.z = p.z;
    m.mantleTo.x = dx;
    m.mantleTo.y = y;
    m.mantleTo.z = dz;
    m.vel.x = (dx - p.x) / MANTLE_DURATION;
    m.vel.y = (y - p.y) / MANTLE_DURATION;
    m.vel.z = (dz - p.z) / MANTLE_DURATION;
    m.slideT = 0;
    m.sprint = false;
    m.onGround = false;
    return true;
  }
  return false;
}

/** Scripted mantle: rise first (ease-out), then move over the lip. */
function advanceMantle(world: CollisionWorld, m: MoveState, dt: number): void {
  const from = m.mantleFrom;
  const to = m.mantleTo;
  m.mantleT = Math.max(0, m.mantleT - dt);
  const t = 1 - m.mantleT / MANTLE_DURATION;
  const ty = easeOutQuad(Math.min(1, t / 0.6));
  const th = smoothstep(0.4, 1, t);
  const ox = m.pos.x;
  const oy = m.pos.y;
  const oz = m.pos.z;
  m.pos.x = from.x + (to.x - from.x) * th;
  m.pos.y = from.y + (to.y - from.y) * ty;
  m.pos.z = from.z + (to.z - from.z) * th;
  if (dt > 0) {
    m.vel.x = (m.pos.x - ox) / dt;
    m.vel.y = (m.pos.y - oy) / dt;
    m.vel.z = (m.pos.z - oz) / dt;
  }
  if (m.mantleT <= 0) {
    m.pos.x = to.x;
    m.pos.y = to.y;
    m.pos.z = to.z;
    // Exit with a little forward momentum so the move flows.
    const hx = to.x - from.x;
    const hz = to.z - from.z;
    const hl = Math.sqrt(hx * hx + hz * hz);
    const exit = 2.6;
    m.vel.x = hl > 1e-4 ? (hx / hl) * exit : 0;
    m.vel.z = hl > 1e-4 ? (hz / hl) * exit : 0;
    m.vel.y = 0;
    const g = world.supportHeight(m.pos.x, m.pos.z, R, m.pos.y + 1e-3, 0.1);
    m.onGround = !Number.isNaN(g);
    if (m.onGround) {
      m.pos.y = g;
      if (world.supportSolid) m.ground = world.supportSolid.tag;
    }
    m.airTime = 0;
  }
}
