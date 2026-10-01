// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — combat: weapon state machine (fire modes, ADS, swap, reload,
// recoil, spread, Sunspear charge, throwables) + hitboxes.
//
// Shared verbatim by the host simulation and client prediction. Deterministic:
// spread/pellet directions come from hashFloat(playerId, seq, pellet, k), never
// from Math.random, so predicted tracers match the host.
//
// Per-command order (use `stepPlayer`): stepCombat(c, m, cmd) → stepMovement.
// Combat runs first so it sees `m.prevButtons` of the previous tick for edge
// detection (throw/reload) and shoots from the pre-move eye position.
//
// Notes on state fields (see types.ts CombatState):
//  • fireCd may go slightly negative (down to -1): ≤ 0 means ready; its magnitude
//    measures how long the weapon has been idle, which drives the spray reset.
//  • While sprinting, fireCd is held at ≥ sprintOutTime → sprint-to-fire delay.
//  • cycleT is set to the fire interval on a pump/bolt shot; `cycled` is reported
//    CYCLE_DELAY seconds later (when the pump/bolt animation & sound begin).
// ─────────────────────────────────────────────────────────────────────────────

import {
  ADS_SPEED_MULT,
  CROUCH_EYE_HEIGHT,
  EYE_HEIGHT,
  PITCH_LIMIT,
  SIM_DT,
  SPRINT_SPEED,
  THROW_COOLDOWN,
} from './constants';
import { approach, clamp, hashFloat4, lerp } from './math';
import { eyeHeight, horizontalSpeed, stepMovement } from './movement';
import type { CollisionWorld } from './physics';
import type { CombatState, InputCmd, Loadout, MoveState, PrimaryWeaponId, ThrowableId, Vec3, WeaponId, WeaponSlotState } from './types';
import { BTN_ADS, BTN_FIRE, BTN_RELOAD, BTN_THROW, PRIMARY_WEAPON_IDS } from './types';
import { WEAPONS, fireInterval, type WeaponDef } from './weapons';

export interface ShotRequest {
  weapon: WeaponId;
  origin: Vec3;
  /** One normalized direction per pellet. */
  dirs: Vec3[];
}

export interface CombatStepResult {
  /** Fired this tick (host resolves hits; client predicts FX). */
  shot: ShotRequest | null;
  dryFire: boolean;
  reloadStarted: boolean;
  reloadEmpty: boolean;
  swappedTo: WeaponId | null;
  /** Host spawns the throwable. */
  throwRequested: boolean;
  chargeStarted: boolean;
  /** Pump/bolt cycle began (CYCLE_DELAY after the shot). */
  cycled: boolean;
}

export interface Hitboxes {
  head: { c: Vec3; r: number };
  body: { min: Vec3; max: Vec3 };
}

/** Delay between a pump/bolt shot and the start of the cycle animation/sound. */
export const CYCLE_DELAY = 0.16;
/** Head sphere radius and offset above the eye. */
export const HEAD_RADIUS = 0.23;
export const HEAD_OFFSET = 0.07;
/** Body box half-width. */
export const BODY_HALF_WIDTH = 0.34;
/** Maximum accumulated recoil (radians). */
const MAX_RECOIL_PITCH = 0.26;
const MAX_RECOIL_YAW = 0.12;
/** Non-automatic weapons start settling this long after a shot. */
const RECOIL_SETTLE = 0.08;
/** Throwing blocks firing for this long. */
const THROW_FIRE_BLOCK = 0.3;
/** Sunspear: charge bleeds off this much faster than it builds when released. */
const CHARGE_DECAY_MULT = 2;

// ── State ───────────────────────────────────────────────────────────────────

export function sanitizeLoadout(l: Partial<Loadout> | undefined | null): Loadout {
  const primary: PrimaryWeaponId =
    l && PRIMARY_WEAPON_IDS.includes(l.primary as PrimaryWeaponId) ? (l.primary as PrimaryWeaponId) : 'meridian';
  const throwable: ThrowableId = l && (l.throwable === 'smoke' || l.throwable === 'grenade') ? l.throwable : 'grenade';
  return { primary, throwable };
}

function slotFor(id: WeaponId): WeaponSlotState {
  const w = WEAPONS[id];
  return { id, mag: w.magSize, reserve: w.reserve };
}

export function createCombatState(loadout: Loadout): CombatState {
  const l = sanitizeLoadout(loadout);
  return {
    slots: [slotFor(l.primary), slotFor('pulse'), null],
    active: 0,
    swapT: 0,
    reloadT: 0,
    fireCd: 0,
    recoilIdx: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    bloom: 0,
    adsT: 0,
    chargeT: 0,
    cycleT: 0,
    throwables: 1,
    throwCd: 0,
    fireHeld: false,
  };
}

/** Deep copy (prediction history / snapshots). */
export function cloneCombatState(c: CombatState): CombatState {
  const s = (x: WeaponSlotState | null): WeaponSlotState | null => (x ? { id: x.id, mag: x.mag, reserve: x.reserve } : null);
  return {
    slots: [s(c.slots[0]) as WeaponSlotState, s(c.slots[1]) as WeaponSlotState, s(c.slots[2])],
    active: c.active,
    swapT: c.swapT,
    reloadT: c.reloadT,
    fireCd: c.fireCd,
    recoilIdx: c.recoilIdx,
    recoilPitch: c.recoilPitch,
    recoilYaw: c.recoilYaw,
    bloom: c.bloom,
    adsT: c.adsT,
    chargeT: c.chargeT,
    cycleT: c.cycleT,
    throwables: c.throwables,
    throwCd: c.throwCd,
    fireHeld: c.fireHeld,
    // Admin cheats: copied only when present so ordinary states stay field-for-field identical.
    ...(c.cheatAmmo ? { cheatAmmo: true } : {}),
    ...(c.cheatSpeed !== undefined && c.cheatSpeed !== 1 ? { cheatSpeed: c.cheatSpeed } : {}),
  };
}

/** Admin speed cheat multiplier (1 when off; clamped to 1..3). */
export function cheatSpeedMult(c: CombatState): number {
  const k = c.cheatSpeed;
  return k === undefined || !(k > 1) ? 1 : Math.min(3, k);
}

export function activeSlot(c: CombatState): WeaponSlotState {
  return (c.slots[c.active] ?? c.slots[0]) as WeaponSlotState;
}

export function activeWeapon(c: CombatState): WeaponId {
  return activeSlot(c).id;
}

/** Puts a fresh Sunspear in the pickup slot. Returns false if the player already has a full one. */
export function giveSunspear(c: CombatState): boolean {
  const cur = c.slots[2];
  if (cur && cur.mag >= WEAPONS.sunspear.magSize) return false;
  c.slots[2] = slotFor('sunspear');
  return true;
}

/** Full reload duration for a weapon given the rounds currently in the magazine (and reserve). */
export function reloadDuration(id: WeaponId, mag: number, reserve = Infinity): number {
  const w = WEAPONS[id];
  const empty = mag <= 0 ? w.reloadEmptyExtra : 0;
  if (w.reloadPerRound) {
    const missing = Math.max(0, Math.min(w.magSize - mag, reserve));
    return w.reloadTime * 0.25 + w.reloadPerRound * missing + empty;
  }
  return w.reloadTime + empty;
}

/** Reload progress 0..1 for UI (−1 when not reloading). */
export function reloadProgress(c: CombatState): number {
  if (c.reloadT <= 0) return -1;
  const slot = activeSlot(c);
  const total = reloadDuration(slot.id, slot.mag, slot.reserve);
  return total > 0 ? clamp(1 - c.reloadT / total, 0, 1) : 1;
}

// ── Derived values ──────────────────────────────────────────────────────────

/** Weapon move-speed multiplier × ADS slow. */
export function speedMultiplier(c: CombatState): number {
  const w = WEAPONS[activeWeapon(c)];
  const k = w.moveSpeedMult * lerp(1, ADS_SPEED_MULT, c.adsT);
  return c.cheatSpeed === undefined ? k : k * cheatSpeedMult(c);
}

/** Current cone half-angle in radians (HUD crosshair and shot spread). */
export function currentSpread(c: CombatState, m: MoveState): number {
  const w = WEAPONS[activeWeapon(c)];
  const base = lerp(w.hipSpread, w.adsSpread, c.adsT) * (1 - 0.15 * m.crouchT);
  const move = w.moveSpread * clamp(horizontalSpeed(m) / SPRINT_SPEED, 0, 1);
  const air = m.onGround || m.mantleT > 0 ? 0 : w.airSpread;
  const slide = m.slideT > 0 ? w.moveSpread * 0.5 : 0;
  return base + move + air + slide + c.bloom;
}

/** Effective aim angles: view angles + recoil offsets (recoil yaw is "to the right"). */
export function aimAngles(cmd: InputCmd, c: CombatState, out?: { yaw: number; pitch: number }): { yaw: number; pitch: number } {
  const o = out ?? { yaw: 0, pitch: 0 };
  o.yaw = cmd.yaw - c.recoilYaw;
  o.pitch = clamp(cmd.pitch + c.recoilPitch, -PITCH_LIMIT, PITCH_LIMIT);
  return o;
}

/** Eye (shot origin) position for a move state. */
export function eyePosition(m: MoveState, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  out.x = m.pos.x;
  out.y = m.pos.y + eyeHeight(m);
  out.z = m.pos.z;
  return out;
}

/**
 * Deterministic shot directions. Single-bullet weapons sample a uniform disk of
 * radius `spread`; multi-pellet weapons use an even ring pattern with jitter so
 * shotgun spreads are readable and consistent.
 */
export function pelletDirections(
  weapon: WeaponId,
  yaw: number,
  pitch: number,
  spread: number,
  playerId: number,
  seq: number,
): Vec3[] {
  const w = WEAPONS[weapon];
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const fx = -sy * cp;
  const fy = sp;
  const fz = -cy * cp;
  const rx = cy;
  const rz = -sy;
  // up = right × forward
  const ux = 0 * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - 0 * fx;
  const n = Math.max(1, w.pellets);
  const out: Vec3[] = [];
  for (let p = 0; p < n; p++) {
    const u1 = hashFloat4(playerId, seq, p, 1);
    const u2 = hashFloat4(playerId, seq, p, 2);
    let ang: number;
    let r: number;
    if (n === 1) {
      ang = u1 * Math.PI * 2;
      r = spread * Math.sqrt(u2);
    } else if (p === 0) {
      ang = u1 * Math.PI * 2;
      r = spread * 0.18 * u2;
    } else {
      ang = ((p - 1) / (n - 1)) * Math.PI * 2 + (u1 - 0.5) * 0.6;
      r = spread * (0.5 + 0.5 * u2);
    }
    const t = Math.tan(r);
    const ox = Math.cos(ang) * t;
    const oy = Math.sin(ang) * t;
    let dx = fx + rx * ox + ux * oy;
    let dy = fy + uy * oy;
    let dz = fz + rz * ox + uz * oy;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= l;
    dy /= l;
    dz /= l;
    out.push({ x: dx, y: dy, z: dz });
  }
  return out;
}

// ── Step ────────────────────────────────────────────────────────────────────

function emptyResult(): CombatStepResult {
  return {
    shot: null,
    dryFire: false,
    reloadStarted: false,
    reloadEmpty: false,
    swappedTo: null,
    throwRequested: false,
    chargeStarted: false,
    cycled: false,
  };
}

function canReload(c: CombatState, slot: WeaponSlotState, w: WeaponDef): boolean {
  return w.fireMode !== 'charge' && c.reloadT <= 0 && c.swapT <= 0 && slot.mag < w.magSize && slot.reserve > 0;
}

function startReload(c: CombatState, slot: WeaponSlotState, res: CombatStepResult): void {
  c.reloadT = reloadDuration(slot.id, slot.mag, slot.reserve);
  c.chargeT = 0;
  res.reloadStarted = true;
  res.reloadEmpty = slot.mag <= 0;
}

function startSwap(c: CombatState, slotIndex: number, res: CombatStepResult): void {
  const slot = c.slots[slotIndex];
  if (!slot) return;
  c.active = slotIndex;
  c.swapT = WEAPONS[slot.id].swapTime;
  c.reloadT = 0;
  c.chargeT = 0;
  c.cycleT = 0;
  c.fireCd = 0;
  c.recoilIdx = 0;
  c.bloom = 0;
  c.adsT = 0;
  res.swappedTo = slot.id;
}

/** Advances timers, ADS, reload, swap and fire decisions for one command. Deterministic. */
export function stepCombat(c: CombatState, m: MoveState, cmd: InputCmd, playerId: number, dt: number): CombatStepResult {
  const res = emptyResult();
  const buttons = cmd.buttons | 0;
  const pressed = buttons & ~m.prevButtons;
  const fireDown = (buttons & BTN_FIRE) !== 0;
  const firePressed = fireDown && !c.fireHeld;
  const mantling = m.mantleT > 0;

  // ── Admin infinite ammo: every magazine is kept full, so no reload is ever needed ──
  if (c.cheatAmmo) {
    for (const s of c.slots) if (s) s.mag = WEAPONS[s.id].magSize;
    if (c.reloadT > 0) c.reloadT = 0;
  }

  // ── Timers ──
  if (c.throwCd > 0) c.throwCd = Math.max(0, c.throwCd - dt);
  c.fireCd = Math.max(-1, c.fireCd - dt);
  {
    const w0 = WEAPONS[activeWeapon(c)];
    if (c.cycleT > 0) {
      const before = c.cycleT;
      c.cycleT = Math.max(0, c.cycleT - dt);
      const mark = fireInterval(w0.id) - CYCLE_DELAY;
      if ((w0.fireMode === 'pump' || w0.fireMode === 'bolt') && before > mark && c.cycleT <= mark) res.cycled = true;
    }
  }

  // ── Swap requests (desired slot; empty slots are ignored) ──
  const desired = cmd.slot | 0;
  if (desired >= 0 && desired <= 2 && desired !== c.active && c.slots[desired]) startSwap(c, desired, res);
  if (!c.slots[c.active]) startSwap(c, 0, res);
  if (c.swapT > 0) c.swapT = Math.max(0, c.swapT - dt);

  let slot = activeSlot(c);
  let w = WEAPONS[slot.id];
  const busy = c.swapT > 0 || mantling;

  // ── ADS ──
  const wantAds = (buttons & BTN_ADS) !== 0 && !m.sprint && !busy;
  c.adsT = approach(c.adsT, wantAds ? 1 : 0, w.adsTime > 0 ? dt / w.adsTime : 1);

  // ── Sprint-to-fire gate ──
  if (m.sprint) {
    c.fireCd = Math.max(c.fireCd, w.sprintOutTime);
    c.recoilIdx = 0;
  }

  // ── Reload progress ──
  if (c.reloadT > 0) {
    c.reloadT = Math.max(0, c.reloadT - dt);
    if (w.reloadPerRound) {
      // Shell-by-shell: the k-th shell lands k·reloadPerRound after the lead-in, i.e. when the
      // remaining time drops to (shells still to load − 1)·reloadPerRound.
      while (slot.mag < w.magSize && slot.reserve > 0) {
        const toLoad = Math.min(w.magSize - slot.mag, slot.reserve);
        if (c.reloadT > (toLoad - 1) * w.reloadPerRound + 1e-9) break;
        slot.mag++;
        slot.reserve--;
      }
      if (slot.mag >= w.magSize || slot.reserve <= 0) c.reloadT = 0;
    } else if (c.reloadT <= 0) {
      const take = Math.min(w.magSize - slot.mag, slot.reserve);
      slot.mag += take;
      slot.reserve -= take;
    }
  }

  // ── Recoil recovery & spray reset ──
  const interval = fireInterval(w.id);
  const sinceShot = interval - c.fireCd;
  const settleAfter = w.fireMode === 'auto' ? interval + SIM_DT * 1.5 : RECOIL_SETTLE;
  if (sinceShot > settleAfter || c.reloadT > 0 || busy) {
    const r = Math.sqrt(c.recoilPitch * c.recoilPitch + c.recoilYaw * c.recoilYaw);
    if (r > 0) {
      const nr = Math.max(0, r - w.recoil.recover * dt);
      const k = nr / r;
      c.recoilPitch *= k;
      c.recoilYaw *= k;
    }
    c.bloom = Math.max(0, c.bloom - w.bloomRecover * dt);
  }
  if (sinceShot >= w.recoil.resetTime) c.recoilIdx = 0;

  // ── Throwable (edge) ──
  if ((pressed & BTN_THROW) && c.throwables > 0 && c.throwCd <= 0 && !mantling) {
    res.throwRequested = true;
    c.throwables--;
    c.throwCd = THROW_COOLDOWN;
    c.fireCd = Math.max(c.fireCd, THROW_FIRE_BLOCK);
    c.chargeT = 0;
    if (c.reloadT > 0 && !w.reloadPerRound) c.reloadT = 0;
  }

  // ── Manual reload (edge) ──
  if ((pressed & BTN_RELOAD) && canReload(c, slot, w)) startReload(c, slot, res);

  // ── Fire ──
  if (w.fireMode === 'charge') {
    const ready = !busy && !m.sprint && c.fireCd <= 0 && slot.mag > 0 && !res.throwRequested;
    if (fireDown && ready) {
      if (c.chargeT <= 0) res.chargeStarted = true;
      c.chargeT += dt;
      if (c.chargeT >= (w.chargeTime ?? 0.6) - 1e-9) {
        c.chargeT = 0;
        fire(c, m, cmd, playerId, w, slot, res);
        if (slot.mag <= 0) {
          // Out of charges: the pickup slot empties and we fall back to the primary.
          c.slots[2] = null;
          const shot = res.shot;
          startSwap(c, 0, res);
          res.shot = shot;
          slot = activeSlot(c);
          w = WEAPONS[slot.id];
        }
      }
    } else {
      c.chargeT = Math.max(0, c.chargeT - dt * CHARGE_DECAY_MULT);
    }
  } else {
    const trigger = w.fireMode === 'semi' ? firePressed : fireDown;
    if (trigger && !res.throwRequested) {
      if (slot.mag <= 0) {
        if (canReload(c, slot, w)) startReload(c, slot, res);
        else if (firePressed && c.reloadT <= 0) res.dryFire = true;
      } else if (!busy && !m.sprint && c.fireCd <= 0) {
        if (c.reloadT > 0 && w.reloadPerRound) c.reloadT = 0; // shells can interrupt their reload
        if (c.reloadT <= 0) fire(c, m, cmd, playerId, w, slot, res);
      }
    }
  }

  c.fireHeld = fireDown;
  return res;
}

function fire(
  c: CombatState,
  m: MoveState,
  cmd: InputCmd,
  playerId: number,
  w: WeaponDef,
  slot: WeaponSlotState,
  res: CombatStepResult,
): void {
  const interval = fireInterval(w.id);
  // Carry the sub-tick remainder so the average rate matches rpm exactly.
  c.fireCd = Math.max(c.fireCd, -SIM_DT) + interval;
  if (w.fireMode === 'pump' || w.fireMode === 'bolt') c.cycleT = interval;
  if (!c.cheatAmmo) slot.mag--; // admin infinite ammo: the magazine never drops
  const aim = aimAngles(cmd, c);
  const spread = currentSpread(c, m);
  const origin = eyePosition(m);
  const dirs = pelletDirections(w.id, aim.yaw, aim.pitch, spread, playerId, cmd.seq | 0);
  // Recoil kick for the NEXT shot (the first shot lands where you aim).
  const pat = w.recoil.pattern;
  const kick = pat[Math.min(c.recoilIdx, pat.length - 1)];
  const k = lerp(1, w.recoil.adsMult, c.adsT);
  c.recoilPitch = Math.min(MAX_RECOIL_PITCH, c.recoilPitch + kick[0] * k);
  c.recoilYaw = clamp(c.recoilYaw + kick[1] * k, -MAX_RECOIL_YAW, MAX_RECOIL_YAW);
  c.recoilIdx++;
  c.bloom = Math.min(w.bloomMax, c.bloom + w.bloomPerShot);
  res.shot = { weapon: w.id, origin, dirs };
}

/**
 * The one true per-command player update used by both host and client prediction:
 * combat first (edge detection on the previous tick's buttons, shots from the
 * pre-move eye), then movement with the resulting speed multiplier.
 */
export function stepPlayer(
  world: CollisionWorld,
  m: MoveState,
  c: CombatState,
  cmd: InputCmd,
  playerId: number,
  dt: number,
): CombatStepResult {
  const r = stepCombat(c, m, cmd, playerId, dt);
  stepMovement(world, m, cmd, speedMultiplier(c), dt);
  return r;
}

// ── Hitboxes ────────────────────────────────────────────────────────────────

export function hitboxes(pos: Vec3, crouchT: number, out?: Hitboxes): Hitboxes {
  const o: Hitboxes = out ?? { head: { c: { x: 0, y: 0, z: 0 }, r: HEAD_RADIUS }, body: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } } };
  const eye = lerp(EYE_HEIGHT, CROUCH_EYE_HEIGHT, clamp(crouchT, 0, 1));
  const headY = pos.y + eye + HEAD_OFFSET;
  o.head.c.x = pos.x;
  o.head.c.y = headY;
  o.head.c.z = pos.z;
  o.head.r = HEAD_RADIUS;
  o.body.min.x = pos.x - BODY_HALF_WIDTH;
  o.body.min.y = pos.y;
  o.body.min.z = pos.z - BODY_HALF_WIDTH;
  o.body.max.x = pos.x + BODY_HALF_WIDTH;
  o.body.max.y = headY - HEAD_RADIUS * 0.8;
  o.body.max.z = pos.z + BODY_HALF_WIDTH;
  return o;
}

/** Nearest intersection of a ray (normalized d) with head sphere / body box within maxDist. */
export function rayVsHitboxes(o: Vec3, d: Vec3, maxDist: number, hb: Hitboxes): { dist: number; head: boolean } | null {
  let best = Infinity;
  let head = false;
  // Head sphere.
  {
    const ox = o.x - hb.head.c.x;
    const oy = o.y - hb.head.c.y;
    const oz = o.z - hb.head.c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - hb.head.r * hb.head.r;
    const disc = b * b - cc;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      let t = -b - sq;
      if (t < 0) t = cc < 0 ? 0 : Infinity;
      if (t <= maxDist && t < best) {
        best = t;
        head = true;
      }
    }
  }
  // Body box (slab test).
  const t = slab(o.x, d.x, hb.body.min.x, hb.body.max.x, 0, maxDist);
  if (t !== t) return finish(best, head);
  const t1 = slabExit;
  const u = slab(o.y, d.y, hb.body.min.y, hb.body.max.y, t, t1);
  if (u !== u) return finish(best, head);
  const u1 = slabExit;
  const v = slab(o.z, d.z, hb.body.min.z, hb.body.max.z, u, u1);
  if (v === v && v < best) {
    best = v;
    head = false;
  }
  return finish(best, head);
}

function finish(best: number, head: boolean): { dist: number; head: boolean } | null {
  return best === Infinity ? null : { dist: best, head };
}

let slabExit = 0;
/** Clips [t0, t1] against one axis slab. Returns the new entry (NaN if empty); exit in `slabExit`. */
function slab(o: number, d: number, lo: number, hi: number, t0: number, t1: number): number {
  if (Math.abs(d) < 1e-12) {
    if (o < lo || o > hi) return NaN;
    slabExit = t1;
    return t0;
  }
  let a = (lo - o) / d;
  let b = (hi - o) / d;
  if (a > b) {
    const tmp = a;
    a = b;
    b = tmp;
  }
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
  if (t0 > t1) return NaN;
  slabExit = t1;
  return t0;
}
