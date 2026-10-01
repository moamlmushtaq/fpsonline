// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — bot perception (20 Hz, part of BotController.deliberate):
// what a bot may legitimately know.
//  • Sight: a view cone (wider for the enemy it is already tracking), line of
//    sight to the chest or a head peeking over cover, never through smoke.
//    Far, peripheral and crouched-still enemies are noticed later (reaction).
//  • Target choice spreads attention (BotDirector claims; humans weigh more),
//    ignores spawn-protected players, prefers whoever is shooting us.
//  • Damage from an unseen attacker gives a direction, like the HUD indicator.
//  • Hearing: gunshots / explosions within min(profile, loudness) and the
//    footsteps of nearby moving enemies, with a position error growing with
//    distance. Only whole past ticks are read, so nothing is heard twice.
// ─────────────────────────────────────────────────────────────────────────────

import { EYE_HEIGHT, SIM_HZ } from '../../constants';
import { clamp, forwardFromAngles, yawFromDir } from '../../math';
import { eyeHeight, playerHeight } from '../../movement';
import type { Vec3 } from '../../types';
import { TEAM_NONE } from '../../types';
import type { BotController } from '../bots';
import type { SimPlayer } from '../game';

const EYE: Vec3 = { x: 0, y: 0, z: 0 };
const FWD: Vec3 = { x: 0, y: 0, z: 0 };
const POS: Vec3 = { x: 0, y: 0, z: 0 };

export function perceive(b: BotController, p: SimPlayer): void {
  const sim = b.sim;
  const world = sim.world;
  const tick = sim.tick;
  const prof = b.prof;
  const eye = sim.eyeOf(p, EYE);
  const fwd = forwardFromAngles(b.aim.yaw, b.aim.pitch, FWD);
  const cosFov = Math.cos(prof.fovHalf);
  const cosTrack = Math.cos(Math.min(Math.PI * 0.85, prof.fovHalf * 1.7));
  const hurtBy = tick - p.lastAttackerTick < SIM_HZ * 1.5 ? p.lastAttacker : -1;
  let best: SimPlayer | null = null;
  let bestScore = Infinity;
  let bestDist = 0;
  let bestCos = 1;
  b.vis.length = 0;
  for (const e of sim.players) {
    if (!e.alive || !sim.isEnemy(p, e)) continue;
    const ex = e.move.pos.x;
    let ey = e.move.pos.y + playerHeight(e.move) * 0.62;
    const ez = e.move.pos.z;
    const dx = ex - eye.x;
    const dz = ez - eye.z;
    let dy = ey - eye.y;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 95 || d < 1e-3) continue;
    const cos = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d;
    const tracking = e.ident.id === b.target && tick - b.lastSeenTick < SIM_HZ * 0.6;
    if (!(cos >= cosFov || d < 2.5 || (tracking && cos >= cosTrack))) continue;
    if (!world.segmentClear(eye.x, eye.y, eye.z, ex, ey, ez, 'sight')) {
      // A head peeking over cover still counts.
      ey = e.move.pos.y + eyeHeight(e.move) + 0.05;
      dy = ey - eye.y;
      if (!world.segmentClear(eye.x, eye.y, eye.z, ex, ey, ez, 'sight')) continue;
    }
    POS.x = ex;
    POS.y = ey;
    POS.z = ez;
    if (sim.smokeBlocks(eye, POS)) continue;
    if (b.vis.length < 12) b.vis.push(ex, e.move.pos.y, ez);
    let score = d + (1 - cos) * 8 + e.health * 0.03;
    if (e.ident.id === b.target) score -= 10;
    if (e.ident.id === hurtBy) score -= 8;
    if (e.protectedT > 0) score += 30;
    if (!sim.ffa) {
      const c = b.dir.claims(p.ident.team, e.ident.id, b.id);
      score += c * (e.ident.isBot ? 3 : 8);
    }
    if (score < bestScore) {
      bestScore = score;
      best = e;
      bestDist = d;
      bestCos = cos;
    }
  }

  if (best) {
    const bid = best.ident.id;
    const sameTarget = bid === b.target;
    const lostFor = tick - b.lastSeenTick;
    if (!sameTarget || !b.targetVisible) {
      b.mercyK = prof.mercy && !best.ident.isBot ? b.dir.mercy(bid) : 0;
      const mercy = 1 + 0.35 * b.mercyK;
      if (sameTarget && lostFor <= SIM_HZ * 1.2) {
        // Re-acquiring someone we just saw duck out (we expected them).
        b.reactionT = prof.reaction * b.rand(0.3, 0.45) * mercy;
      } else {
        const periph = clamp(Math.acos(clamp(bestCos, -1, 1)) / prof.fovHalf, 0, 1.5);
        const still = best.move.crouchT > 0.5 && Math.hypot(best.move.vel.x, best.move.vel.z) < 1 ? 0.12 : 0;
        const switching = b.targetVisible ? 0.6 : 1;
        b.reactionT = ((prof.reaction * b.rand(0.85, 1.2) + (prof.reactionFar * bestDist) / 50) * (1 + periph * 0.5) + still) * switching * mercy;
        b.aimHead = b.rng() < prof.headChance * (1 - 0.6 * b.mercyK) * (bestDist < 45 ? 1 : 0.5);
        if (p.move.sprint && bestDist < 16 && b.rng() < prof.slideChance) b.slideWish = true;
      }
      b.engagedWith = -1;
    }
    b.target = bid;
    b.targetVisible = true;
    b.targetDist = bestDist;
    b.lastSeenTick = tick;
    b.lastContactTick = tick;
    b.hurtLookT = 0;
    setLastKnown(b, best.move.pos, tick, true);
    return;
  }
  b.targetVisible = false;

  // Hit by someone we cannot see: we get a direction (like a damage indicator).
  if (p.lastDamageTick > b.lastHurtTick) {
    b.lastHurtTick = p.lastDamageTick;
    if (hurtBy >= 0) {
      const f = p.lastDamageFrom;
      b.lastContactTick = tick;
      b.hurtYaw = yawFromDir(f.x - eye.x, f.z - eye.z);
      if (b.hurtLookT <= 0) b.hurtT = prof.reaction * b.rand(0.8, 1.15);
      b.hurtLookT = b.hurtT + 1.6;
      const dd = Math.hypot(f.x - eye.x, f.z - eye.z);
      const err = dd * 0.12;
      setLastKnown(b, { x: f.x + (b.rng() - 0.5) * err, y: f.y - EYE_HEIGHT, z: f.z + (b.rng() - 0.5) * err }, tick, false);
    }
  }
  // Hearing: gunshots / explosions (whole past ticks only).
  const noises = sim.noises;
  const upTo = tick - 1;
  for (let i = noises.length - 1; i >= 0; i--) {
    const n = noises[i];
    if (n.tick > upTo) continue;
    if (n.tick <= b.lastNoiseTick) break;
    if (n.id === b.id) continue;
    if (!sim.ffa && n.team === p.ident.team && n.team !== TEAM_NONE) continue;
    const r = Math.min(prof.hearing, n.radius);
    const dx = n.x - p.move.pos.x;
    const dz = n.z - p.move.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= r * r && n.tick > b.lastKnownTick) {
      const err = Math.sqrt(d2) * 0.15;
      setLastKnown(b, { x: n.x + (b.rng() - 0.5) * err, y: n.y - EYE_HEIGHT, z: n.z + (b.rng() - 0.5) * err }, n.tick, false);
      b.lastContactTick = tick;
      break;
    }
  }
  b.lastNoiseTick = upTo;
  // Footsteps of moving enemies close by (crouch-walking is silent).
  if (tick - b.lastKnownTick > SIM_HZ) {
    for (const e of sim.players) {
      if (!e.alive || !sim.isEnemy(p, e) || !e.move.onGround || e.move.crouchT > 0.5) continue;
      const sp = Math.hypot(e.move.vel.x, e.move.vel.z);
      const loud = sp > 6.5 ? 1 : sp > 3.5 ? 0.5 : 0;
      if (loud === 0) continue;
      const dx = e.move.pos.x - p.move.pos.x;
      const dz = e.move.pos.z - p.move.pos.z;
      const r = prof.footsteps * loud;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r && Math.abs(e.move.pos.y - p.move.pos.y) < 4) {
        const err = Math.sqrt(d2) * 0.2;
        setLastKnown(b, { x: e.move.pos.x + (b.rng() - 0.5) * err, y: e.move.pos.y, z: e.move.pos.z + (b.rng() - 0.5) * err }, tick, false);
        break;
      }
    }
  }
}

export function setLastKnown(b: BotController, pos: Vec3, tick: number, sight: boolean): void {
  b.lastKnown.x = pos.x;
  b.lastKnown.y = pos.y;
  b.lastKnown.z = pos.z;
  b.hasLastKnown = true;
  b.lastKnownTick = tick;
  b.knownBySight = sight;
}
