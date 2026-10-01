// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — bot aim, trigger and throwables.
//  • updateAim: engages the target through BotAim (Fitts flick with overshoot,
//    settle, lagged + partially predicted tracking, partial recoil control);
//    otherwise looks where a player would: toward damage, pre-aimed at the last
//    known spot, along a held angle, or down the path / lane.
//  • shouldFire: first-shot confirmation, angular tolerance, weapon discipline
//    (bursts by range, shotgun patience, scoped bolt shots, Sunspear charge).
//  • planThrow: grenades into clusters / behind cover, smokes to cover a
//    retreat, revive a push onto a held objective or cross a watched lane.
// ─────────────────────────────────────────────────────────────────────────────

import { SIM_DT, SIM_HZ } from '../../constants';
import { activeSlot, activeWeapon, aimAngles, currentSpread } from '../../combat';
import { angleDiff, clamp, forwardFromAngles, wrapAngle, yawFromDir } from '../../math';
import { playerHeight } from '../../movement';
import type { Vec3 } from '../../types';
import { WEAPONS } from '../../weapons';
import { ballisticPitch } from '../bot-profiles';
import type { BotController } from '../bots';
import type { SimPlayer } from '../game';
import { throwLaneClear } from './tactics';

const TMP: RewoundState = { pos: { x: 0, y: 0, z: 0 }, crouchT: 0, alive: true };
const EYE: Vec3 = { x: 0, y: 0, z: 0 };
const FWD: Vec3 = { x: 0, y: 0, z: 0 };
const AIM = { yaw: 0, pitch: 0 };
const AIM_CMD: InputCmd = { seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0, viewTick: 0 };

export function planThrow(b: BotController, p: SimPlayer): void {
  const sim = b.sim;
  if (b.throwAt || b.throwCd > 0 || p.combat.throwables <= 0 || sim.currentPhase !== 'live') return;
  const pos = p.move.pos;
  const eye = sim.eyeOf(p, EYE);
  const prof = b.prof;
  const tick = sim.tick;
  if (p.ident.loadout.throwable === 'grenade') {
    // Two or more enemies bunched up in view.
    const v = b.vis;
    for (let i = 0; i + 3 < v.length && !b.throwAt; i += 3) {
      for (let j = i + 3; j < v.length; j += 3) {
        if (Math.hypot(v[i] - v[j], v[i + 2] - v[j + 2]) > 5.5 || Math.abs(v[i + 1] - v[j + 1]) > 2) continue;
        const c = { x: (v[i] + v[j]) / 2, y: (v[i + 1] + v[j + 1]) / 2, z: (v[i + 2] + v[j + 2]) / 2 };
        const d = Math.hypot(c.x - pos.x, c.z - pos.z);
        if (d < 8 || d > 26 || teammateNear(b, p, c, 6) || !throwLaneClear(sim.world, eye, c)) continue;
        if (b.rng() < 0.55 * prof.grenadeSkill) queueThrow(b, c, 0.15);
        break;
      }
    }
    // Flush someone who ducked behind cover.
    const age = (tick - b.lastKnownTick) * SIM_DT;
    if (!b.throwAt && !b.targetVisible && b.hasLastKnown && b.knownBySight && age > 0.4 && age < 3) {
      const d = Math.hypot(b.lastKnown.x - pos.x, b.lastKnown.z - pos.z);
      if (d > 8 && d < 24 && !teammateNear(b, p, b.lastKnown, 5) && throwLaneClear(sim.world, eye, b.lastKnown) && b.rng() < 0.05 * prof.grenadeSkill) {
        queueThrow(b, b.lastKnown, 0.25);
      }
    }
    return;
  }
  // Smoke: cover a retreat…
  if (b.goalKind === 'cover' && b.path && b.pathIdx < b.path.points.length && b.targetVisible) {
    const t = sim.player(b.target);
    if (t && b.rng() < 0.3 * prof.smokeSkill) {
      queueThrow(b, { x: (pos.x * 2 + t.move.pos.x) / 3, y: pos.y, z: (pos.z * 2 + t.move.pos.z) / 3 }, 0.1);
      return;
    }
  }
  // …revive a stalled push onto an objective the enemy holds…
  const zone = b.assignedZone();
  if (zone && zone.owner !== p.ident.team && !b.targetVisible) {
    const c = zone.def.center;
    const d = Math.hypot(c.x - pos.x, c.z - pos.z);
    const enemyThere = b.hasLastKnown && Math.hypot(b.lastKnown.x - c.x, b.lastKnown.z - c.z) < zone.def.radius + 8 && (tick - b.lastKnownTick) * SIM_DT < 6;
    if (d > 12 && d < 28 && (zone.contested || enemyThere) && b.rng() < 0.08 * prof.smokeSkill) {
      const k = (d - 6) / d;
      const at = { x: pos.x + (c.x - pos.x) * k, y: c.y, z: pos.z + (c.z - pos.z) * k };
      if (throwLaneClear(sim.world, eye, at)) queueThrow(b, at, 0.2);
      return;
    }
  }
  // …or cross open ground under a watching long gun.
  const moving = b.goalKind === 'lane' || b.goalKind === 'rotate' || b.goalKind === 'objective' || b.goalKind === 'pickup';
  if (moving && !b.targetVisible && b.hasLastKnown && b.knownBySight && (tick - b.lastKnownTick) * SIM_DT < 4) {
    const d = Math.hypot(b.lastKnown.x - pos.x, b.lastKnown.z - pos.z);
    if (d > 24 && b.rng() < 0.06 * prof.smokeSkill) {
      const k = Math.min(10, d * 0.35) / d;
      const at = { x: pos.x + (b.lastKnown.x - pos.x) * k, y: pos.y, z: pos.z + (b.lastKnown.z - pos.z) * k };
      if (throwLaneClear(sim.world, eye, at)) queueThrow(b, at, 0.15);
    }
  }
}

export function queueThrow(b: BotController, at: Vec3, delay: number): void {
  b.throwAt = { x: at.x, y: at.y, z: at.z };
  b.throwT = delay;
  b.throwCd = 1.5; // give up if the aim never lines up
}

export function teammateNear(b: BotController, p: SimPlayer, at: Vec3, r: number): boolean {
  for (const q of b.sim.players) {
    if (!q.alive || (q !== p && b.sim.isEnemy(p, q))) continue;
    if (Math.hypot(q.move.pos.x - at.x, q.move.pos.z - at.z) < r) return true;
  }
  return false;
}

/** Updates view angles; returns true when the aim is on the intended throw point. */
export function updateAim(b: BotController, p: SimPlayer): boolean {
  const sim = b.sim;
  const aim = b.aim;
  const eye = sim.eyeOf(p, EYE);
  const dt = SIM_DT;
  const t = b.target >= 0 ? sim.player(b.target) : undefined;
  if (b.throwAt) {
    const dx = b.throwAt.x - eye.x;
    const dz = b.throwAt.z - eye.z;
    const ty = yawFromDir(dx, dz);
    const tp = ballisticPitch(Math.hypot(dx, dz), b.throwAt.y + 0.3 - eye.y);
    aim.look(ty, tp, dt, b.prof.smooth * 1.5);
    return Math.abs(angleDiff(aim.yaw, ty)) < 0.05 && Math.abs(tp - aim.pitch) < 0.05;
  }
  if (t && t.alive && b.targetVisible && b.reactionT <= 0) {
    // Delayed perception of the target, with partial velocity prediction.
    const prof = b.prof;
    const lagTicks = Math.round(prof.trackLag * SIM_HZ);
    if (!sim.sampleHistory(t.ident.id, sim.tick - 1 - lagTicks, TMP)) {
      TMP.pos.x = t.move.pos.x;
      TMP.pos.y = t.move.pos.y;
      TMP.pos.z = t.move.pos.z;
      TMP.crouchT = t.move.crouchT;
    }
    const lead = prof.trackLag * prof.predict;
    const ax = TMP.pos.x + t.move.vel.x * lead;
    const az = TMP.pos.z + t.move.vel.z * lead;
    const eyeT = 1.62 - 0.57 * TMP.crouchT;
    const ay = TMP.pos.y + (b.aimHead ? eyeT + 0.05 : eyeT * 0.72);
    const dx = ax - eye.x;
    const dz = az - eye.z;
    const hd = Math.hypot(dx, dz);
    const ty = yawFromDir(dx, dz);
    const tp = Math.atan2(ay - eye.y, hd);
    if (b.engagedWith !== b.target || !aim.engaged) {
      aim.flickTo(ty, tp, Math.atan2(0.5, hd) * 2, 1 + 0.5 * b.mercyK);
      b.engagedWith = b.target;
      b.fireReadyT = prof.fireDelay * b.rand(0.8, 1.3) * (1 + b.mercyK);
    }
    aim.track(ty, tp, p.combat.recoilYaw, p.combat.recoilPitch, dt, 1 + 0.6 * b.mercyK);
    return true;
  }
  if (!(t && t.alive && b.targetVisible)) b.engagedWith = -1;
  if (t && t.alive && b.targetVisible) {
    // Still reacting: the eyes have it, the hands have not moved yet.
    aim.look(aim.yaw, aim.pitch, dt);
    return true;
  }
  let ty = aim.yaw;
  let tp = 0;
  let rate = b.prof.smooth;
  const age = (sim.tick - b.lastKnownTick) * SIM_DT;
  const moving = Math.hypot(b.moveX, b.moveZ) > 0.1;
  if (b.hurtLookT > 0 && b.hurtT <= 0) {
    // Turn toward where the shots came from.
    ty = b.hurtYaw;
    rate *= 1.6;
  } else if (b.hurtLookT > 0) {
    ty = aim.yaw;
    tp = aim.pitch;
  } else if (b.searchT > 0) {
    ty = wrapAngle(aim.yaw + Math.sin(sim.tick * 0.07 + b.id) * 0.9);
  } else if (b.hasLastKnown && age < 4 && (b.prof.tactics >= 0.5 || !moving)) {
    // Pre-aim where they were (chest height).
    const dx = b.lastKnown.x - eye.x;
    const dz = b.lastKnown.z - eye.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.5) {
      ty = yawFromDir(dx, dz);
      tp = Math.atan2(b.lastKnown.y + 1.25 - eye.y, d) * (b.knownBySight ? 1 : 0.5);
    }
  } else if (b.goalKind === 'hold') {
    const sweep = b.prof.tactics >= 0.5 ? 0.3 : 0.6;
    ty = wrapAngle(b.holdYaw + Math.sin(sim.tick * 0.018 + b.id * 1.7) * sweep);
    rate *= 0.6;
  } else if (moving) {
    ty = yawFromDir(b.moveX, b.moveZ);
    // Veterans glance down the lane toward the enemy side while advancing.
    if (b.prof.tactics >= 0.5 && b.goalKind === 'lane' && Math.abs(angleDiff(ty, b.holdYaw)) < 1.2) ty = wrapAngle(ty + angleDiff(ty, b.holdYaw) * 0.5);
    if (b.path && b.pathIdx < b.path.points.length) {
      const wp = b.path.points[b.pathIdx];
      const hd = Math.hypot(wp.x - eye.x, wp.z - eye.z);
      if (hd > 1) tp = clamp(Math.atan2(wp.y + 1.5 - eye.y, hd), -0.5, 0.5) * 0.6;
    }
  }
  aim.look(ty, tp, dt, rate);
  return true;
}

export function shouldFire(b: BotController, p: SimPlayer): boolean {
  const sim = b.sim;
  if (!b.targetVisible || b.reactionT > 0 || b.throwAt || !b.aim.engaged) return false;
  if (sim.currentPhase !== 'live') return false;
  const t = sim.player(b.target);
  if (!t || !t.alive || t.protectedT > 0) return false;
  const c = p.combat;
  const slot = activeSlot(c);
  const w = WEAPONS[slot.id];
  if (c.swapT > 0) return false;
  const eye = sim.eyeOf(p, EYE);
  const dx = t.move.pos.x - eye.x;
  const dy = t.move.pos.y + playerHeight(t.move) * (b.aimHead ? 0.92 : 0.6) - eye.y;
  const dz = t.move.pos.z - eye.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d > w.range * 0.95) return false;
  // Shotguns wait until the pellets will count (recruits are less patient).
  if (w.id === 'breaker' && d > (b.prof.tactics >= 0.5 ? 15 : 22)) return false;
  // Angular error between where the gun points and the target.
  AIM_CMD.yaw = b.aim.yaw;
  AIM_CMD.pitch = b.aim.pitch;
  const a = aimAngles(AIM_CMD, c, AIM);
  const f = forwardFromAngles(a.yaw, a.pitch, FWD);
  const err = Math.acos(clamp((f.x * dx + f.y * dy + f.z * dz) / d, -1, 1));
  const tol = Math.atan2(0.42, d) * b.prof.fireTol + currentSpread(c, p.move) * 0.4;
  if (b.fireReadyT > 0) {
    // First shot of an engagement: confirm the sight picture first.
    if (err < tol) b.fireReadyT -= SIM_DT;
    return false;
  }
  if (w.fireMode === 'charge') return err < tol * 2.2;
  if (w.fireMode === 'bolt' && c.adsT < 0.9) return false;
  if (err > tol) return false;
  if (w.fireMode === 'auto') {
    // Burst discipline: long sprays up close, controlled bursts at range.
    if (b.pauseT > 0) return false;
    if (b.burstT <= 0) {
      const k = d < 12 ? 2.2 : d < 30 ? 1.5 : 0.8;
      b.burstT = b.rand(b.prof.burst[0], b.prof.burst[1]) * k;
    }
  }
  return true;
}

export function wantAds(b: BotController, p: SimPlayer): boolean {
  if (!b.targetVisible || b.reactionT > b.prof.reaction * 0.4) {
    // Marksmen hold their angle scoped in.
    return b.goalKind === 'hold' && activeWeapon(p.combat) === 'longline' && b.prof.tactics >= 0.5;
  }
  const id = activeWeapon(p.combat);
  if (id === 'longline') return true;
  if (id === 'breaker') return b.targetDist > 9;
  if (id === 'swift') return b.targetDist > 12;
  return b.targetDist > 7;
}

export function desiredSlot(b: BotController, p: SimPlayer): number {
  const c = p.combat;
  const pickup = c.slots[2];
  if (pickup && pickup.mag > 0) return 2;
  const primary = c.slots[0];
  if (primary.mag === 0 && primary.reserve === 0) return 1;
  // Quick-draw the sidearm when the primary runs dry mid-fight at close range.
  if (b.targetVisible && c.active === 0 && primary.mag === 0 && b.targetDist < 12 && c.reloadT > 0.6) return 1;
  // Marksmen swap to the sidearm when someone gets in their face.
  if (b.targetVisible && primary.id === 'longline' && b.targetDist < 8 && b.prof.tactics >= 0.5) return 1;
  if (c.active === 1 && primary.id === 'longline' && b.targetVisible && b.targetDist < 12) return 1;
  // Back to the primary once the fight is over.
  if (c.active === 1 && !b.targetVisible) return 0;
  return c.active === 2 ? 0 : c.active;
}
