// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — pure hitscan tracing: one pellet against the world, a set of
// (already lag-compensated) player hitboxes and optional training targets.
// No side effects, so the client can use it to predict tracer end points for
// its own shots exactly like the host resolves them.
// ─────────────────────────────────────────────────────────────────────────────

import { rayVsHitboxes, type Hitboxes } from '../combat';
import { q2, q3 } from '../math';
import type { CollisionWorld } from '../physics';
import type { ShotImpact, Vec3 } from '../types';
import type { RangeSim, RangeTarget } from './range';

export interface PelletTrace {
  /** Distance to the first thing hit (or `range`). */
  dist: number;
  /** Index into the candidate hitbox list, or -1. */
  candidate: number;
  /** Training target hit, if any. */
  target: RangeTarget | null;
  head: boolean;
  /** Network impact record (quantized); `pl` / `tg` are filled in by the caller. */
  impact: ShotImpact;
}

/**
 * Traces one pellet from `o` along normalized `d` up to `range`. World geometry is
 * tested in 'bullet' mode (shoot-through solids ignored). The nearest of world /
 * candidate hitboxes / range targets wins.
 */
export function tracePellet(
  world: CollisionWorld,
  o: Vec3,
  d: Vec3,
  range: number,
  candidates: readonly Hitboxes[],
  candidateCount: number,
  targets: RangeSim | null,
): PelletTrace {
  const wd = world.rayDist(o.x, o.y, o.z, d.x, d.y, d.z, range, 'bullet');
  const solid = wd !== Infinity ? world.hitSolidIndex : -1;
  const nx = world.hitNx;
  const ny = world.hitNy;
  const nz = world.hitNz;
  let dist = Math.min(wd, range);
  let candidate = -1;
  let head = false;
  for (let i = 0; i < candidateCount; i++) {
    const h = rayVsHitboxes(o, d, dist, candidates[i]);
    if (h && h.dist <= dist) {
      dist = h.dist;
      candidate = i;
      head = h.head;
    }
  }
  let target: RangeTarget | null = null;
  if (targets) {
    const t = targets.hitTest(o, d, dist);
    if (t) {
      candidate = -1;
      target = t.target;
      dist = t.dist;
      head = t.head;
    }
  }
  const impact: ShotImpact = { e: { x: q2(o.x + d.x * dist), y: q2(o.y + d.y * dist), z: q2(o.z + d.z * dist) } };
  if (candidate < 0 && !target && solid >= 0 && dist === wd) {
    impact.n = { x: q3(nx), y: q3(ny), z: q3(nz) };
    impact.s = world.solids[solid].tag;
  }
  if (head) impact.head = true;
  return { dist, candidate, target, head, impact };
}
