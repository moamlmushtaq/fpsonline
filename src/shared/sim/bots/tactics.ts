// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — bot tactics helpers (pure queries over the nav graph, lane
// skeleton and collision world): cover search, lane station picks, throwable
// placement checks. Kept separate from the BotController's state machine.
// ─────────────────────────────────────────────────────────────────────────────

import type { CollisionWorld } from '../../physics';
import type { Vec3 } from '../../types';
import type { NavGraph } from '../nav';
import type { LaneInfo } from './lanes';

const CANDS: number[] = [];

/**
 * A nearby nav node hidden from `threatEye` (sight ray to chest height blocked),
 * not closer to the threat than we are, preferring short hops. -1 if none.
 */
export function findCoverNode(
  nav: NavGraph,
  world: CollisionWorld,
  rng: () => number,
  pos: Vec3,
  threatEye: Vec3,
  radius: number,
  tries: number,
): number {
  CANDS.length = 0;
  nav.forNodesNear(pos, radius, (k) => {
    if (CANDS.length < 500) CANDS.push(k);
  });
  if (CANDS.length === 0) return -1;
  const myThreatD = Math.hypot(pos.x - threatEye.x, pos.z - threatEye.z);
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < tries; i++) {
    const k = CANDS[Math.floor(rng() * CANDS.length) % CANDS.length];
    const x = nav.px[k];
    const y = nav.py[k];
    const z = nav.pz[k];
    const d = Math.hypot(x - pos.x, z - pos.z);
    if (d < 1.5) continue;
    if (Math.abs(y - pos.y) > 3.2) continue;
    const td = Math.hypot(x - threatEye.x, z - threatEye.z);
    if (td < 7 || td < myThreatD - 2) continue;
    // Chest and head hidden from the threat.
    if (world.segmentClear(threatEye.x, threatEye.y, threatEye.z, x, y + 1.1, z, 'sight')) continue;
    if (world.segmentClear(threatEye.x, threatEye.y, threatEye.z, x, y + 1.55, z, 'sight')) continue;
    const score = d - td * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

/**
 * Picks a node at a lane station. `sightPref` (0..1) biases toward nodes with a
 * long view of the enemy half (marksmen ~1, shotguns ~0). Returns the node and
 * the yaw to hold, or null.
 */
export function pickStationNode(
  info: LaneInfo,
  lane: number,
  station: number,
  team: number,
  rng: () => number,
  sightPref: number,
): { node: number; holdYaw: number; sight: number } | null {
  const st = info.stations[lane]?.[station];
  if (!st || st.nodes.length === 0) return null;
  const t = team === 1 ? 1 : 0;
  const sight = st.sight[t];
  let best = -1;
  let bestScore = -Infinity;
  const n = st.nodes.length;
  for (let tries = 0; tries < 6; tries++) {
    const i = Math.floor(rng() * n) % n;
    // Everyone wants some view (holding an angle), marksmen want a long one;
    // close-range weapons prefer tight spots.
    const s = sight[i];
    const view = Math.min(s, 60) / 60;
    const score = view * (sightPref * 2 - 0.5) + (s > 10 ? 0.4 : 0) + rng() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return { node: st.nodes[best], holdYaw: st.holdYaw[t][best], sight: sight[best] };
}

/** True if a throw toward `to` has a clear arc start (nothing right in front of the face). */
export function throwLaneClear(world: CollisionWorld, eye: Vec3, to: Vec3): boolean {
  const dx = to.x - eye.x;
  const dz = to.z - eye.z;
  const d = Math.hypot(dx, dz);
  if (d < 1) return false;
  // Check the first part of the arc: eye → a point a third of the way, raised.
  const k = Math.min(1, 6 / d);
  return world.segmentClear(eye.x, eye.y, eye.z, eye.x + dx * k, eye.y + 1.2, eye.z + dz * k, 'bullet');
}
