// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Launch Control zones (A/B/C).
//
// Progress runs -1 (Halcyon owns) … 0 (neutral) … +1 (Bloom owns). A team alone
// in a zone pushes progress toward its side at (1 + ZONE_EXTRA_CAPTURER·(n-1)) /
// ZONE_CAPTURE_TIME per second: an enemy-owned zone is first neutralized (crossing
// 0), then captured (reaching ±1). Both teams inside = contested (frozen).
// Empty zones slowly settle back toward their owner's side (or neutral).
// ─────────────────────────────────────────────────────────────────────────────

import { ZONE_CAPTURE_TIME, ZONE_EXTRA_CAPTURER } from '../constants';
import type { ZoneDef } from '../maps/types';
import type { GameEvent, Team, Vec3, ZoneSnap } from '../types';
import { TEAM_NONE } from '../types';

export interface ZoneState {
  def: ZoneDef;
  owner: Team;
  progress: number;
  capturing: Team;
  contested: boolean;
}

export interface ZoneOccupant {
  id: number;
  /** Team used for capture (0 or 1). */
  team: 0 | 1;
  pos: Vec3;
}

/** Progress settle rate (per second) for empty zones. */
const SETTLE_RATE = 0.08;

export function insideZone(z: ZoneDef, pos: Vec3): boolean {
  const dx = pos.x - z.center.x;
  const dz = pos.z - z.center.z;
  if (dx * dx + dz * dz > z.radius * z.radius) return false;
  return pos.y >= z.center.y - 1.2 && pos.y <= z.center.y + z.height;
}

export class ZoneSystem {
  readonly zones: ZoneState[];
  /** Scratch lists reused every tick. */
  private readonly inside: ZoneOccupant[][];

  constructor(defs: readonly ZoneDef[]) {
    this.zones = defs.map((d) => ({ def: d, owner: TEAM_NONE, progress: 0, capturing: TEAM_NONE, contested: false }));
    this.inside = defs.map(() => []);
  }

  reset(): void {
    for (const z of this.zones) {
      z.owner = TEAM_NONE;
      z.progress = 0;
      z.capturing = TEAM_NONE;
      z.contested = false;
    }
  }

  /**
   * Advances capture state. `occupants` = living players (with capture team).
   * `onCapture(zone, team, capturerIds)` fires on capture; `onObjective(id, dt)` for each
   * player inside a zone that their team owns or is capturing.
   */
  step(
    dt: number,
    occupants: readonly ZoneOccupant[],
    emit: (ev: GameEvent) => void,
    onCapture: (z: ZoneState, team: 0 | 1, ids: number[]) => void,
    onObjective: (id: number, dt: number) => void,
  ): void {
    for (let zi = 0; zi < this.zones.length; zi++) {
      const z = this.zones[zi];
      const list = this.inside[zi];
      list.length = 0;
      let n0 = 0;
      let n1 = 0;
      for (const o of occupants) {
        if (!insideZone(z.def, o.pos)) continue;
        list.push(o);
        if (o.team === 0) n0++;
        else n1++;
      }
      const wasContested = z.contested;
      z.contested = n0 > 0 && n1 > 0;
      if (z.contested) {
        z.capturing = TEAM_NONE;
        if (!wasContested) emit({ t: 'zone', z: z.def.id, team: z.owner, ev: 'contested' });
        continue;
      }
      if (n0 === 0 && n1 === 0) {
        z.capturing = TEAM_NONE;
        const rest = z.owner === 0 ? -1 : z.owner === 1 ? 1 : 0;
        z.progress = approachTo(z.progress, rest, SETTLE_RATE * dt);
        continue;
      }
      const team: 0 | 1 = n0 > 0 ? 0 : 1;
      const n = team === 0 ? n0 : n1;
      const sign = team === 0 ? -1 : 1;
      const rate = ((1 + ZONE_EXTRA_CAPTURER * (n - 1)) / ZONE_CAPTURE_TIME) * dt;
      const before = z.progress;
      z.progress = approachTo(z.progress, sign, rate);
      z.capturing = z.owner === team && Math.abs(z.progress - sign) < 1e-9 ? TEAM_NONE : team;
      // Neutralize when crossing / reaching 0 from the other side.
      if (z.owner !== TEAM_NONE && z.owner !== team && (before * sign < 0 ? z.progress * sign >= 0 : false)) {
        emit({ t: 'zone', z: z.def.id, team, ev: 'neutralized' });
        z.owner = TEAM_NONE;
      }
      if (z.owner !== team && Math.abs(z.progress - sign) < 1e-9) {
        z.owner = team;
        z.capturing = TEAM_NONE;
        emit({ t: 'zone', z: z.def.id, team, ev: 'captured' });
        onCapture(
          z,
          team,
          list.filter((o) => o.team === team).map((o) => o.id),
        );
      }
      for (const o of list) if (o.team === team) onObjective(o.id, dt);
    }
  }

  snaps(): ZoneSnap[] {
    return this.zones.map((z) => ({
      id: z.def.id,
      owner: z.owner,
      progress: Math.round(z.progress * 1000) / 1000,
      capturing: z.capturing,
      contested: z.contested,
    }));
  }
}

function approachTo(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return Math.min(cur + maxDelta, target);
  if (cur > target) return Math.max(cur - maxDelta, target);
  return cur;
}
