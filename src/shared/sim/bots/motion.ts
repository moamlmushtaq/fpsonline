// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — bot locomotion (every tick): path following (mantles, drop
// lips), combat footwork per weapon (close in with shotguns/SMGs, keep range
// with rifles, plant the feet for bursts at range, dodge when pinned), unstick
// shuffles, and the safety checks that keep bots off lethal drops, out of
// dead-end pits and from jumping into low ceilings.
// ─────────────────────────────────────────────────────────────────────────────

import { activeWeapon } from '../../combat';
import type { Vec3 } from '../../types';
import { PREFERRED_RANGE } from '../bot-profiles';
import type { BotController } from '../bots';
import type { SimPlayer } from '../game';
import { LINK_MANTLE } from '../nav';

const POS: Vec3 = { x: 0, y: 0, z: 0 };

export function computeMove(b: BotController, p: SimPlayer): void {
  const pos = p.move.pos;
  let dx = 0;
  let dz = 0;
  b.wantSprint = false;
  if (b.path && b.pathIdx < b.path.points.length) {
    let wp = b.path.points[b.pathIdx];
    let hx = wp.x - pos.x;
    let hz = wp.z - pos.z;
    let hd = Math.hypot(hx, hz);
    const last = b.pathIdx === b.path.points.length - 1;
    if (hd < (last ? 0.5 : 0.45) && Math.abs(wp.y - pos.y) < 1.6) {
      b.pathIdx++;
      if (b.pathIdx < b.path.points.length) {
        wp = b.path.points[b.pathIdx];
        hx = wp.x - pos.x;
        hz = wp.z - pos.z;
        hd = Math.hypot(hx, hz);
      } else hd = 0;
    }
    if (hd <= 0.3 && b.pathIdx < b.path.points.length && wp.y < pos.y - 1) {
      // Standing on the lip right above a drop waypoint: step off toward what follows.
      const nx = b.path.points[b.pathIdx + 1] ?? wp;
      const px = b.pathIdx > 0 ? b.path.points[b.pathIdx - 1] : pos;
      let ex = nx.x - px.x;
      let ez = nx.z - px.z;
      if (Math.hypot(ex, ez) < 0.1) {
        ex = wp.x - px.x + 0.01;
        ez = wp.z - px.z;
      }
      hx = ex;
      hz = ez;
      hd = Math.hypot(ex, ez);
    }
    if (hd > 0.05 && b.pathIdx < b.path.points.length) {
      dx = hx / hd;
      dz = hz / hd;
      const kind = b.path.kinds[b.pathIdx];
      if (kind === LINK_MANTLE && hd < 1.4 && wp.y > pos.y + 0.3 && p.move.onGround && b.jumpCd <= 0) b.mantleJump = true;
      const calm = b.goalKind !== 'peek' && (b.goalKind !== 'objective' || hd > 6);
      if (calm && !b.targetVisible && hd > 2.5 && kind !== LINK_MANTLE) b.wantSprint = true;
      if (b.goalKind === 'peek') {
        dx *= 0.6;
        dz *= 0.6;
      }
    }
  }
  // Combat footwork: strafe + keep the weapon's range (not while retreating).
  const wid = activeWeapon(p.combat);
  const repositioning = b.goalKind === 'shift' && dx * dx + dz * dz > 0;
  if (b.targetVisible && b.goalKind !== 'cover' && b.reactionT <= b.prof.reaction * 0.5) {
    const t = b.sim.player(b.target);
    if (t) {
      const tx = t.move.pos.x - pos.x;
      const tz = t.move.pos.z - pos.z;
      const td = Math.hypot(tx, tz) || 1;
      const ux = tx / td;
      const uz = tz / td;
      const pref = PREFERRED_RANGE[wid];
      // Only a path that leads to them helps close the distance.
      const hasPath = (dx !== 0 || dz !== 0) && (b.goalKind === 'chase' || b.goalKind === 'objective' || repositioning);
      let bx = 0;
      let bz = 0;
      if (repositioning || (b.goalKind === 'objective' && hasPath && td > pref * 0.55)) {
        // Moving to a new spot / onto the objective while trading shots.
        const k = repositioning ? 1 : 0.75;
        bx = dx * k;
        bz = dz * k;
      } else if (td > pref * 1.5) {
        // Close the distance along the path when we have one (it routes around cover).
        const push = wid === 'breaker' || wid === 'swift' ? 1 : 0.8;
        bx = (hasPath ? dx : ux) * push;
        bz = (hasPath ? dz : uz) * push;
        if (wid === 'breaker' && td > 14 && b.burstT <= 0) b.wantSprint = true;
      } else if (td < pref * 0.55) {
        bx = -ux * 0.6;
        bz = -uz * 0.6;
      }
      // Close range: dance. Mid/long range with rifles: plant the feet while a burst is out.
      const planted = td > 16 && wid !== 'swift' && wid !== 'breaker';
      const steady = planted ? (b.burstT > 0 ? 0.15 : 0.6) : b.burstT > 0 ? 0.7 : 1;
      const strafe = b.dodgeT > 0 ? b.strafeDir : b.strafeDir * b.prof.strafe * steady * (repositioning ? 0.4 : 1);
      dx = bx - uz * strafe;
      dz = bz + ux * strafe;
      if (!(wid === 'breaker' && b.wantSprint)) b.wantSprint = false;
    }
  }
  if (b.unstickT > 0) {
    const l = Math.hypot(dx, dz) || 1;
    const sx = -dz / l;
    const sz = dx / l;
    dx = dx * 0.4 + sx * b.unstickDir;
    dz = dz * 0.4 + sz * b.unstickDir;
  }
  // Avoid walking off big drops / out of the map.
  const l = Math.hypot(dx, dz);
  if (l > 1e-3) {
    const k = Math.min(1, l) / l;
    dx *= k;
    dz *= k;
    if (!safeAhead(b, p, dx / Math.min(1, l), dz / Math.min(1, l))) {
      if (b.targetVisible) {
        b.strafeDir = -b.strafeDir;
        dx = -dx;
        dz = -dz;
        if (!safeAhead(b, p, dx, dz)) {
          dx = 0;
          dz = 0;
        }
      } else if (!(b.path && b.path.kinds[b.pathIdx] !== undefined && b.path.kinds[b.pathIdx] !== 0)) {
        dx = 0;
        dz = 0;
      }
    }
  }
  b.moveX = dx;
  b.moveZ = dz;
}

/** Room to jump without hitting a ceiling (standing box raised by a jump's height). */
export function headroom(b: BotController, p: SimPlayer): boolean {
  const m = p.move;
  return !b.sim.world.boxOverlaps(m.pos.x, m.pos.y + 1.1, m.pos.z, 0.34, 1.8);
}

/**
 * True if walking ~1 m in (dx,dz) keeps us over ground not far below, and any
 * drop lands somewhere we can walk out of (never into a dead-end pit).
 */
export function safeAhead(b: BotController, p: SimPlayer, dx: number, dz: number): boolean {
  const x = p.move.pos.x + dx * 1.1;
  const z = p.move.pos.z + dz * 1.1;
  const g = b.sim.world.supportHeight(x, z, 0.2, p.move.pos.y + 0.5, 6);
  if (Number.isNaN(g) || g <= b.sim.map.killY + 1) return false;
  if (g < p.move.pos.y - 1.2) {
    POS.x = x;
    POS.y = g;
    POS.z = z;
    const nav = b.sim.nav;
    const k = nav.nearestNode(POS, 1.5);
    if (k < 0 || nav.comp[k] !== nav.mainComp) return false;
  }
  return true;
}
