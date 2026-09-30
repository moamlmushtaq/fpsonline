// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — map authoring kit: tiny helpers used by the map data modules
// (src/shared/maps/*.ts) to author solids, ramps, stairs and mirrored halves.
// Pure data helpers; no runtime state.
// ─────────────────────────────────────────────────────────────────────────────

import type { Solid, SpawnPoint } from '../maps/types';
import type { SurfaceTag, Team, Vec3 } from '../types';

/** Maximum rise of one stair step (must stay under STEP_HEIGHT). */
export const STAIR_RISE = 0.4;

export type SolidExtra = Pick<Solid, 'color' | 'shootThrough' | 'walkThrough'>;

export class MapKit {
  readonly solids: Solid[] = [];

  /** Axis-aligned box from two corners (any order). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tag: SurfaceTag, style?: string, extra?: SolidExtra): Solid {
    const s: Solid = {
      min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
      max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
      tag,
    };
    if (style) s.style = style;
    if (extra) Object.assign(s, extra);
    this.solids.push(s);
    return s;
  }

  /** Ramp wedge: top rises from y0 to y1 toward +axis (dir 1) or −axis (dir −1). */
  ramp(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    axis: 'x' | 'z',
    dir: 1 | -1,
    tag: SurfaceTag,
    style = 'ramp',
  ): Solid {
    const s = this.box(x0, y0, z0, x1, y1, z1, tag, style);
    s.ramp = { axis, dir };
    return s;
  }

  /**
   * Solid stairs filling the rectangle [x0,x1]×[z0,z1], rising from y0 to y1 toward
   * +axis (dir 1) or −axis (dir −1). Each step rises ≤ STAIR_RISE.
   */
  stairs(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, axis: 'x' | 'z', dir: 1 | -1, tag: SurfaceTag, style = 'stairs'): Solid[] {
    const n = Math.max(1, Math.ceil((y1 - y0) / STAIR_RISE - 1e-9));
    const rise = (y1 - y0) / n;
    const lo = axis === 'x' ? Math.min(x0, x1) : Math.min(z0, z1);
    const hi = axis === 'x' ? Math.max(x0, x1) : Math.max(z0, z1);
    const depth = (hi - lo) / n;
    const out: Solid[] = [];
    for (let i = 0; i < n; i++) {
      // Step i (0 = lowest) sits at the low end of the run.
      const a = dir > 0 ? lo + i * depth : hi - (i + 1) * depth;
      const b = a + depth;
      const top = y0 + rise * (i + 1);
      out.push(
        axis === 'x'
          ? this.box(a, y0, Math.min(z0, z1), b, top, Math.max(z0, z1), tag, style)
          : this.box(Math.min(x0, x1), y0, a, Math.max(x0, x1), top, b, tag, style),
      );
    }
    return out;
  }

  /** Mark the current solid count (start of a group to mirror). */
  mark(): number {
    return this.solids.length;
  }

  /** Adds mirrored copies (z → −z) of every solid added since `from`. */
  mirrorZ(from: number): void {
    const end = this.solids.length;
    for (let i = from; i < end; i++) this.solids.push(mirrorSolid(this.solids[i], 'z'));
  }

  /** Adds mirrored copies (x → −x) of every solid added since `from`. */
  mirrorX(from: number): void {
    const end = this.solids.length;
    for (let i = from; i < end; i++) this.solids.push(mirrorSolid(this.solids[i], 'x'));
  }
}

export function mirrorSolid(s: Solid, axis: 'x' | 'z'): Solid {
  const out: Solid = {
    ...s,
    min: { ...s.min },
    max: { ...s.max },
  };
  if (axis === 'z') {
    out.min.z = -s.max.z;
    out.max.z = -s.min.z;
  } else {
    out.min.x = -s.max.x;
    out.max.x = -s.min.x;
  }
  if (s.ramp) out.ramp = { axis: s.ramp.axis, dir: s.ramp.axis === axis ? (-s.ramp.dir as 1 | -1) : s.ramp.dir };
  return out;
}

export function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function spawn(x: number, y: number, z: number, yaw: number, team: Team): SpawnPoint {
  return { pos: { x, y, z }, yaw, team };
}

/** Yaw that faces from (x, z) toward (tx, tz). */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

/** Mirrors spawn points across z = 0 (and swaps team 0 ↔ 1). */
export function mirrorSpawnsZ(list: SpawnPoint[]): SpawnPoint[] {
  return list.map((s) => ({
    pos: { x: s.pos.x, y: s.pos.y, z: -s.pos.z },
    yaw: wrap(Math.PI - s.yaw),
    team: s.team === 0 ? 1 : s.team === 1 ? 0 : s.team,
  }));
}

function wrap(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  else if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}
