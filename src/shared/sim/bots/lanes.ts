// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — bot lane analysis: turns a MapDef + NavGraph into the tactical
// skeleton bots play on. Built once per map (cached, immutable, shared by rooms).
//
// Every PvP map has three lanes running along Z between the team spawns, with a
// Launch Control zone in each. From that:
//  • lanes     = zones sorted west → east; lane X-ranges split halfway between them.
//  • stations  = 7 cross-sections per lane from team 0's side (index 0) to team
//                1's side (index 6). Each holds a sample of main-component nav
//                nodes in that lane slice plus, per team, the longest sightline
//                toward the enemy half from each node and its direction — where
//                a player would "hold an angle" (marksmen pick the long ones).
//  • spawnDiscs = discs around every team spawn: bots never pick goals, chase or
//                hold inside the enemy's discs (no spawn camping).
// Maps without three zones (the range) get `null` and bots just roam.
// ─────────────────────────────────────────────────────────────────────────────

import type { MapDef } from '../../maps/types';
import type { CollisionWorld } from '../../physics';
import { yawFromDir } from '../../math';
import type { NavGraph } from '../nav';

export const STATIONS = 7;
/** Candidate nodes kept per station (sightlines are computed for these). */
const PER_STATION = 28;
const SIGHT_MAX = 90;
const EYE = 1.6;
/** Radius around each team spawn that the other team's bots stay out of. */
export const SPAWN_DISC_R = 13;

export interface LaneStation {
  /** Nav node ids. */
  nodes: Int32Array;
  /** Per team (0/1): longest sightline (m) toward the enemy half from each node. */
  sight: [Float32Array, Float32Array];
  /** Per team: yaw of that sightline (where to hold the angle). */
  holdYaw: [Float32Array, Float32Array];
  z: number;
}

export interface LaneInfo {
  /** Lane center X (zone X), west → east. */
  laneX: number[];
  /** X range per lane. */
  ranges: [number, number][];
  /** Zone index (map.zones order) → lane index. */
  zoneLane: number[];
  /** Lane index → zone index. */
  laneZone: number[];
  /** [lane][station], station 0 on team 0's side. */
  stations: LaneStation[][];
  /** Spawn centroid per team (0/1). */
  spawnZ: [number, number];
  /** Exclusion discs around team spawns: [team] → flat [x, z, x, z, …]. */
  spawnDiscs: [number[], number[]];
}

const cache = new WeakMap<MapDef, LaneInfo | null>();

/** Lane index for an X coordinate. */
export function laneOfX(info: LaneInfo, x: number): number {
  if (x < info.ranges[0][1]) return 0;
  if (x < info.ranges[1][1]) return 1;
  return 2;
}

/** Station index nearest to a Z coordinate. */
export function stationOfZ(info: LaneInfo, z: number): number {
  let best = 0;
  let bd = Infinity;
  const row = info.stations[1];
  for (let i = 0; i < row.length; i++) {
    const d = Math.abs(row[i].z - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** True if (x, z) lies inside the spawn area of `team` (0/1). */
export function inSpawnArea(info: LaneInfo, team: number, x: number, z: number, margin = 0): boolean {
  if (team !== 0 && team !== 1) return false;
  const d = info.spawnDiscs[team];
  const r = SPAWN_DISC_R + margin;
  for (let i = 0; i < d.length; i += 2) {
    const dx = x - d[i];
    const dz = z - d[i + 1];
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

export function laneInfoFor(map: MapDef, world: CollisionWorld, nav: NavGraph): LaneInfo | null {
  if (cache.has(map)) return cache.get(map) ?? null;
  const info = build(map, world, nav);
  cache.set(map, info);
  return info;
}

function build(map: MapDef, world: CollisionWorld, nav: NavGraph): LaneInfo | null {
  if (map.zones.length !== 3) return null;
  const s0 = map.spawns.filter((s) => s.team === 0);
  const s1 = map.spawns.filter((s) => s.team === 1);
  if (!s0.length || !s1.length) return null;
  const avgZ = (l: typeof s0) => l.reduce((a, s) => a + s.pos.z, 0) / l.length;
  const z0 = avgZ(s0);
  const z1 = avgZ(s1);
  if (Math.abs(z1 - z0) < 20) return null;

  const order = map.zones.map((z, i) => ({ i, x: z.center.x })).sort((a, b) => a.x - b.x);
  const laneX = order.map((o) => o.x);
  const laneZone = order.map((o) => o.i);
  const zoneLane: number[] = [];
  laneZone.forEach((zi, li) => (zoneLane[zi] = li));
  const b01 = (laneX[0] + laneX[1]) / 2;
  const b12 = (laneX[1] + laneX[2]) / 2;
  const ranges: [number, number][] = [
    [map.bounds.min.x, b01],
    [b01, b12],
    [b12, map.bounds.max.x],
  ];
  const spawnDiscs: [number[], number[]] = [[], []];
  for (const s of s0) spawnDiscs[0].push(s.pos.x, s.pos.z);
  for (const s of s1) spawnDiscs[1].push(s.pos.x, s.pos.z);
  const partial: LaneInfo = { laneX, ranges, zoneLane, laneZone, stations: [], spawnZ: [z0, z1], spawnDiscs };

  // Station Z: from 60 % of the way to team 0's spawn to 60 % toward team 1's.
  const zs: number[] = [];
  for (let i = 0; i < STATIONS; i++) zs.push(z0 * 0.6 + ((z1 * 0.6 - z0 * 0.6) * i) / (STATIONS - 1));
  const halfBand = Math.max(2.5, Math.abs(zs[1] - zs[0]) * 0.35);

  // Bucket main-component nodes by (lane, station).
  const buckets: number[][][] = [0, 1, 2].map(() => zs.map(() => [] as number[]));
  for (let n = 0; n < nav.mainNodes.length; n++) {
    const k = nav.mainNodes[n];
    const x = nav.px[k];
    const z = nav.pz[k];
    if (inSpawnArea(partial, 0, x, z) || inSpawnArea(partial, 1, x, z)) continue;
    const lane = laneOfX(partial, x);
    for (let s = 0; s < zs.length; s++) {
      if (Math.abs(z - zs[s]) <= halfBand) {
        buckets[lane][s].push(k);
        break;
      }
    }
  }

  // Sightline sampling toward each team's enemy side (team 0 looks toward z1).
  const dirs = [0, 0.45, -0.45, 0.9, -0.9];
  const stations: LaneStation[][] = [];
  for (let lane = 0; lane < 3; lane++) {
    const row: LaneStation[] = [];
    for (let s = 0; s < zs.length; s++) {
      let list = buckets[lane][s];
      if (list.length === 0) {
        // Fallback: nearest nodes around the lane center at this Z.
        const out: number[] = [];
        nav.forNodesNear({ x: laneX[lane], y: 0, z: zs[s] }, 10, (k) => {
          if (out.length < 200 && !inSpawnArea(partial, 0, nav.px[k], nav.pz[k]) && !inSpawnArea(partial, 1, nav.px[k], nav.pz[k])) out.push(k);
        });
        list = out;
      }
      // Deterministic, even subsample.
      const picked: number[] = [];
      const step = Math.max(1, list.length / PER_STATION);
      for (let f = 0; f < list.length && picked.length < PER_STATION; f += step) picked.push(list[Math.floor(f)]);
      const n = picked.length;
      const st: LaneStation = {
        nodes: Int32Array.from(picked),
        sight: [new Float32Array(n), new Float32Array(n)],
        holdYaw: [new Float32Array(n), new Float32Array(n)],
        z: zs[s],
      };
      for (let t = 0; t < 2; t++) {
        const fz = (t === 0 ? z1 : z0) > (t === 0 ? z0 : z1) ? 1 : -1;
        for (let i = 0; i < n; i++) {
          const k = picked[i];
          const ox = nav.px[k];
          const oy = nav.py[k] + EYE;
          const oz = nav.pz[k];
          let best = 0;
          let bestYaw = yawFromDir(0, fz);
          for (const a of dirs) {
            const dx = Math.sin(a);
            const dz = Math.cos(a) * fz;
            const d = Math.min(SIGHT_MAX, world.rayDist(ox, oy, oz, dx, 0, dz, SIGHT_MAX, 'sight'));
            if (d > best + 0.5) {
              best = d;
              bestYaw = yawFromDir(dx, dz);
            }
          }
          st.sight[t][i] = best;
          st.holdYaw[t][i] = bestYaw;
        }
      }
      row.push(st);
    }
    stations.push(row);
  }
  partial.stations = stations;
  return partial;
}
