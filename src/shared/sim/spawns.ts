// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — safe spawn selection (anti spawn-camping).
//
// Every candidate spawn point is scored:
//   + distance to the nearest living enemy (capped)          — keep fights away
//   − each living enemy with line of sight to the spawn      — never spawn in view
//   − recent deaths nearby                                   — don't spawn into a fight
//   − occupied by another living player                      — no stacking
//   + a living teammate within ~25 m (team modes)            — spawn with friends
//   − neutral (FFA) spawns in team modes                     — fallback only, used when
//                                                              the team's area is compromised
//   + small seeded randomness                                — variety, unpredictability
// FFA uses every spawn in the map.
// ─────────────────────────────────────────────────────────────────────────────

import { EYE_HEIGHT } from '../constants';
import type { MapDef, SpawnPoint } from '../maps/types';
import type { CollisionWorld } from '../physics';
import type { Team, Vec3 } from '../types';
import { TEAM_NONE } from '../types';

export interface SpawnActor {
  id: number;
  team: Team;
  pos: Vec3;
}

export interface SpawnContext {
  map: MapDef;
  world: CollisionWorld;
  /** Living players (excluding the one spawning). */
  living: readonly SpawnActor[];
  /** Recent deaths (positions + tick). */
  recentDeaths: readonly { pos: Vec3; tick: number }[];
  tick: number;
  tickRate: number;
  rng: () => number;
}

const ENEMY_DIST_CAP = 45;
const TOO_CLOSE = 9;
const VIS_RANGE = 75;
const DEATH_RADIUS = 10;
const DEATH_WINDOW_S = 6;

/**
 * Picks the best spawn for a player of `team`. `ffa` = every other player is an enemy
 * and every spawn is a candidate.
 */
export function pickSpawn(ctx: SpawnContext, team: Team, ffa: boolean, selfId = -1): SpawnPoint {
  const spawns = ctx.map.spawns;
  if (spawns.length === 0) {
    const b = ctx.map.bounds;
    return { pos: { x: (b.min.x + b.max.x) / 2, y: 0, z: (b.min.z + b.max.z) / 2 }, yaw: 0, team: TEAM_NONE };
  }
  let best: SpawnPoint | null = null;
  let bestScore = -Infinity;
  const deathWindow = DEATH_WINDOW_S * ctx.tickRate;
  for (const s of spawns) {
    const own = ffa || s.team === team;
    const neutral = s.team === TEAM_NONE;
    if (!own && !neutral) continue;
    let score = ctx.rng() * 6;
    if (!ffa && neutral) score -= 22;
    const eye = { x: s.pos.x, y: s.pos.y + EYE_HEIGHT, z: s.pos.z };
    let nearestEnemy = Infinity;
    let nearestFriend = Infinity;
    let seen = 0;
    for (const a of ctx.living) {
      if (a.id === selfId) continue;
      const dx = a.pos.x - s.pos.x;
      const dy = a.pos.y - s.pos.y;
      const dz = a.pos.z - s.pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1.6) score -= 200; // occupied
      const enemy = ffa || a.team !== team;
      if (!enemy) {
        if (d < nearestFriend) nearestFriend = d;
        continue;
      }
      if (d < nearestEnemy) nearestEnemy = d;
      if (d < VIS_RANGE && seen < 2) {
        if (ctx.world.segmentClear(a.pos.x, a.pos.y + EYE_HEIGHT, a.pos.z, eye.x, eye.y, eye.z, 'sight')) {
          seen++;
          score -= 45;
        }
      }
    }
    if (nearestEnemy !== Infinity) {
      score += Math.min(nearestEnemy, ENEMY_DIST_CAP);
      if (nearestEnemy < TOO_CLOSE) score -= 40;
    } else score += ENEMY_DIST_CAP;
    if (!ffa && nearestFriend < 25) score += 6;
    for (const d of ctx.recentDeaths) {
      if (ctx.tick - d.tick > deathWindow) continue;
      const dx = d.pos.x - s.pos.x;
      const dz = d.pos.z - s.pos.z;
      if (dx * dx + dz * dz < DEATH_RADIUS * DEATH_RADIUS) score -= 12;
    }
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best ?? spawns[Math.floor(ctx.rng() * spawns.length) % spawns.length];
}
