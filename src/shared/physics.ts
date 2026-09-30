// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — CollisionWorld.
//
// Static world collision built from MapDef.solids (axis-aligned boxes, some with
// a sloped top = "ramp" wedge). Used by movement (player box vs world), hitscan
// (bullet rays), bots (line of sight) and nav generation.
//
// Design notes
//  • Broadphase: uniform XZ grid (4 m cells) storing solid indices in CSR form.
//    Queries mark visited solids with a per-query stamp so a solid spanning many
//    cells is tested once. Raycasts walk the grid with a 2D DDA and stop as soon
//    as the best hit is closer than the next cell boundary.
//  • Solid data is flattened into typed arrays for cache-friendly hot loops.
//  • Ramps are wedges: the box intersected with the half-space under the sloped
//    plane. Rays can hit the slope. For player collision the ramp's surface height
//    is evaluated at the player's CENTER clamped into the ramp's XZ extent, which
//    gives smooth walking on slopes and solid vertical side/back faces.
//  • The player is an axis-aligned box of half-width PLAYER_RADIUS (square
//    footprint): simple, robust and bit-for-bit deterministic.
//  • Rays that START inside a solid ignore that solid (a player grazing a wall
//    can still shoot out of it; no self-blocking).
//  • The hot query methods return primitives and publish extra results through
//    public "last query" fields to stay allocation-free. The world is only ever
//    used from one thread, so this is safe.
// ─────────────────────────────────────────────────────────────────────────────

import { PLAYER_RADIUS } from './constants';
import type { AABB, Solid } from './maps/types';
import type { Vec3 } from './types';

export interface RayHit {
  dist: number;
  point: Vec3;
  normal: Vec3;
  solid: Solid;
}

/** bullet/sight: ignore `shootThrough` solids. move: ignore `walkThrough` solids. */
export type RayMode = 'bullet' | 'sight' | 'move';

const CELL = 4;
/** Contact tolerance: touching surfaces do not count as overlapping. */
export const COLLISION_EPS = 1e-4;

const F_SHOOT_THROUGH = 1;
const F_WALK_THROUGH = 2;

function skipFlagsFor(mode: RayMode): number {
  return mode === 'move' ? F_WALK_THROUGH : F_SHOOT_THROUGH;
}

export class CollisionWorld {
  readonly solids: readonly Solid[];
  readonly bounds: AABB;
  /** Water plane height (footstep surface), if the map has water. */
  readonly waterY: number | undefined;

  // Flattened solid data.
  private readonly mnx: Float64Array;
  private readonly mny: Float64Array;
  private readonly mnz: Float64Array;
  private readonly mxx: Float64Array;
  private readonly mxy: Float64Array;
  private readonly mxz: Float64Array;
  /** 0 = box, 1 = ramp along x, 2 = ramp along z. */
  private readonly rampAxis: Int8Array;
  private readonly rampDir: Int8Array;
  private readonly flags: Uint8Array;

  // Grid (CSR).
  private readonly gx0: number;
  private readonly gz0: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;

  private readonly stamp: Uint32Array;
  private query = 0;

  // ── "Last query" outputs (valid right after the corresponding call) ──
  /** Solid providing the support found by supportHeight()/groundAt(). */
  supportSolid: Solid | null = null;
  /** Results of overlapInfo(). */
  ovCount = 0;
  ovMaxTop = -Infinity;
  ovMinBottom = Infinity;
  ovMinX = Infinity;
  ovMaxX = -Infinity;
  ovMinZ = Infinity;
  ovMaxZ = -Infinity;
  /** Results of rayDist(). */
  hitSolidIndex = -1;
  hitNx = 0;
  hitNy = 0;
  hitNz = 0;

  constructor(solids: Solid[], bounds: AABB, opts: { waterY?: number } = {}) {
    this.solids = solids;
    this.bounds = bounds;
    this.waterY = opts.waterY;
    const n = solids.length;
    this.mnx = new Float64Array(n);
    this.mny = new Float64Array(n);
    this.mnz = new Float64Array(n);
    this.mxx = new Float64Array(n);
    this.mxy = new Float64Array(n);
    this.mxz = new Float64Array(n);
    this.rampAxis = new Int8Array(n);
    this.rampDir = new Int8Array(n);
    this.flags = new Uint8Array(n);
    this.stamp = new Uint32Array(n);

    let gx0 = bounds.min.x;
    let gz0 = bounds.min.z;
    let gx1 = bounds.max.x;
    let gz1 = bounds.max.z;
    for (let i = 0; i < n; i++) {
      const s = solids[i];
      this.mnx[i] = Math.min(s.min.x, s.max.x);
      this.mny[i] = Math.min(s.min.y, s.max.y);
      this.mnz[i] = Math.min(s.min.z, s.max.z);
      this.mxx[i] = Math.max(s.min.x, s.max.x);
      this.mxy[i] = Math.max(s.min.y, s.max.y);
      this.mxz[i] = Math.max(s.min.z, s.max.z);
      if (s.ramp) {
        this.rampAxis[i] = s.ramp.axis === 'x' ? 1 : 2;
        this.rampDir[i] = s.ramp.dir;
      }
      this.flags[i] = (s.shootThrough ? F_SHOOT_THROUGH : 0) | (s.walkThrough ? F_WALK_THROUGH : 0);
      gx0 = Math.min(gx0, this.mnx[i]);
      gz0 = Math.min(gz0, this.mnz[i]);
      gx1 = Math.max(gx1, this.mxx[i]);
      gz1 = Math.max(gz1, this.mxz[i]);
    }
    // Grid covers bounds ∪ all solids, so any ray segment that can hit a solid passes through its cells.
    gx0 -= 1;
    gz0 -= 1;
    gx1 += 1;
    gz1 += 1;
    this.gx0 = gx0;
    this.gz0 = gz0;
    this.nx = Math.max(1, Math.ceil((gx1 - gx0) / CELL));
    this.nz = Math.max(1, Math.ceil((gz1 - gz0) / CELL));
    const cells = this.nx * this.nz;
    const counts = new Int32Array(cells);
    for (let i = 0; i < n; i++) {
      const ix0 = this.cellX(this.mnx[i]);
      const ix1 = this.cellX(this.mxx[i]);
      const iz0 = this.cellZ(this.mnz[i]);
      const iz1 = this.cellZ(this.mxz[i]);
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) counts[iz * this.nx + ix]++;
    }
    this.cellStart = new Int32Array(cells + 1);
    for (let c = 0; c < cells; c++) this.cellStart[c + 1] = this.cellStart[c] + counts[c];
    this.cellItems = new Int32Array(this.cellStart[cells]);
    const fill = this.cellStart.slice(0, cells);
    for (let i = 0; i < n; i++) {
      const ix0 = this.cellX(this.mnx[i]);
      const ix1 = this.cellX(this.mxx[i]);
      const iz0 = this.cellZ(this.mnz[i]);
      const iz1 = this.cellZ(this.mxz[i]);
      for (let iz = iz0; iz <= iz1; iz++)
        for (let ix = ix0; ix <= ix1; ix++) this.cellItems[fill[iz * this.nx + ix]++] = i;
    }
  }

  private cellX(x: number): number {
    const i = Math.floor((x - this.gx0) / CELL);
    return i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
  }

  private cellZ(z: number): number {
    const i = Math.floor((z - this.gz0) / CELL);
    return i < 0 ? 0 : i >= this.nz ? this.nz - 1 : i;
  }

  private nextQuery(): number {
    this.query = (this.query + 1) >>> 0;
    if (this.query === 0) {
      this.stamp.fill(0);
      this.query = 1;
    }
    return this.query;
  }

  /** Surface height of solid `i` at (x, z) (ramps: evaluated at the point clamped into the ramp extent). */
  topAt(i: number, x: number, z: number): number {
    const axis = this.rampAxis[i];
    if (axis === 0) return this.mxy[i];
    let t: number;
    if (axis === 1) {
      const lo = this.mnx[i];
      const hi = this.mxx[i];
      const u = x < lo ? lo : x > hi ? hi : x;
      t = hi > lo ? (u - lo) / (hi - lo) : 1;
    } else {
      const lo = this.mnz[i];
      const hi = this.mxz[i];
      const u = z < lo ? lo : z > hi ? hi : z;
      t = hi > lo ? (u - lo) / (hi - lo) : 1;
    }
    if (this.rampDir[i] < 0) t = 1 - t;
    return this.mny[i] + t * (this.mxy[i] - this.mny[i]);
  }

  isRamp(i: number): boolean {
    return this.rampAxis[i] !== 0;
  }

  // ── Overlap / support queries (player box) ─────────────────────────────────

  /**
   * Gathers every solid (except walkThrough ones) overlapping the box centered at (x, z)
   * with half-width `hw`, feet at `y` and height `h`. Results in ov* fields. Returns the count.
   */
  overlapInfo(x: number, y: number, z: number, hw: number, h: number): number {
    const q = this.nextQuery();
    const x0 = x - hw;
    const x1 = x + hw;
    const z0 = z - hw;
    const z1 = z + hw;
    const y1 = y + h;
    let count = 0;
    let maxTop = -Infinity;
    let minBottom = Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const ix0 = this.cellX(x0);
    const ix1 = this.cellX(x1);
    const iz0 = this.cellZ(z0);
    const iz1 = this.cellZ(z1);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const c = iz * this.nx + ix;
        const end = this.cellStart[c + 1];
        for (let k = this.cellStart[c]; k < end; k++) {
          const i = this.cellItems[k];
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          if (this.flags[i] & F_WALK_THROUGH) continue;
          if (this.mxx[i] <= x0 + COLLISION_EPS || this.mnx[i] >= x1 - COLLISION_EPS) continue;
          if (this.mxz[i] <= z0 + COLLISION_EPS || this.mnz[i] >= z1 - COLLISION_EPS) continue;
          const top = this.topAt(i, x, z);
          if (y >= top - COLLISION_EPS || y1 <= this.mny[i] + COLLISION_EPS) continue;
          count++;
          if (top > maxTop) maxTop = top;
          if (this.mny[i] < minBottom) minBottom = this.mny[i];
          if (this.mnx[i] < minX) minX = this.mnx[i];
          if (this.mxx[i] > maxX) maxX = this.mxx[i];
          if (this.mnz[i] < minZ) minZ = this.mnz[i];
          if (this.mxz[i] > maxZ) maxZ = this.mxz[i];
        }
      }
    }
    this.ovCount = count;
    this.ovMaxTop = maxTop;
    this.ovMinBottom = minBottom;
    this.ovMinX = minX;
    this.ovMaxX = maxX;
    this.ovMinZ = minZ;
    this.ovMaxZ = maxZ;
    return count;
  }

  /** True if a box (feet at y, half-width hw, height h) intersects any solid (walkThrough ignored). */
  boxOverlaps(x: number, y: number, z: number, hw: number, h: number): boolean {
    const q = this.nextQuery();
    const x0 = x - hw;
    const x1 = x + hw;
    const z0 = z - hw;
    const z1 = z + hw;
    const y1 = y + h;
    const ix0 = this.cellX(x0);
    const ix1 = this.cellX(x1);
    const iz0 = this.cellZ(z0);
    const iz1 = this.cellZ(z1);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const c = iz * this.nx + ix;
        const end = this.cellStart[c + 1];
        for (let k = this.cellStart[c]; k < end; k++) {
          const i = this.cellItems[k];
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          if (this.flags[i] & F_WALK_THROUGH) continue;
          if (this.mxx[i] <= x0 + COLLISION_EPS || this.mnx[i] >= x1 - COLLISION_EPS) continue;
          if (this.mxz[i] <= z0 + COLLISION_EPS || this.mnz[i] >= z1 - COLLISION_EPS) continue;
          const top = this.topAt(i, x, z);
          if (y >= top - COLLISION_EPS || y1 <= this.mny[i] + COLLISION_EPS) continue;
          return true;
        }
      }
    }
    return false;
  }

  /** Does a player box at feet position `pos` with `height` intersect any solid? */
  playerOverlaps(pos: Vec3, height: number): boolean {
    return this.boxOverlaps(pos.x, pos.y, pos.z, PLAYER_RADIUS, height);
  }

  /**
   * Highest walkable surface under a square footprint (half-width hw, 0 = point) centered at
   * (x, z), at or below fromY (+ tolerance) and no lower than fromY - maxDrop. Returns NaN if
   * none; the supporting solid is left in `supportSolid`.
   */
  supportHeight(x: number, z: number, hw: number, fromY: number, maxDrop: number): number {
    const q = this.nextQuery();
    const x0 = x - hw;
    const x1 = x + hw;
    const z0 = z - hw;
    const z1 = z + hw;
    const point = hw <= 0;
    let best = -Infinity;
    let bestI = -1;
    const lim = fromY + 1e-3;
    const low = fromY - maxDrop;
    const ix0 = this.cellX(x0);
    const ix1 = this.cellX(x1);
    const iz0 = this.cellZ(z0);
    const iz1 = this.cellZ(z1);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const c = iz * this.nx + ix;
        const end = this.cellStart[c + 1];
        for (let k = this.cellStart[c]; k < end; k++) {
          const i = this.cellItems[k];
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          if (this.flags[i] & F_WALK_THROUGH) continue;
          if (point) {
            if (x < this.mnx[i] || x > this.mxx[i] || z < this.mnz[i] || z > this.mxz[i]) continue;
          } else {
            if (this.mxx[i] <= x0 + COLLISION_EPS || this.mnx[i] >= x1 - COLLISION_EPS) continue;
            if (this.mxz[i] <= z0 + COLLISION_EPS || this.mnz[i] >= z1 - COLLISION_EPS) continue;
          }
          const top = this.topAt(i, x, z);
          if (top > lim || top < low) continue;
          if (top > best) {
            best = top;
            bestI = i;
          }
        }
      }
    }
    if (bestI < 0) {
      this.supportSolid = null;
      return NaN;
    }
    this.supportSolid = this.solids[bestI];
    return best;
  }

  /** Highest walkable surface under the point (x,z) at or below fromY (within maxDrop). Handles ramps. */
  groundAt(x: number, z: number, fromY: number, maxDrop: number): { y: number; solid: Solid } | null {
    const y = this.supportHeight(x, z, 0, fromY, maxDrop);
    if (Number.isNaN(y) || !this.supportSolid) return null;
    return { y, solid: this.supportSolid };
  }

  /**
   * Slope of the support solid under a footprint in the direction (dx, dz) (normalized):
   * rise per meter travelled (negative = downhill). 0 for flat solids.
   */
  slopeAlong(solid: Solid | null, dx: number, dz: number): number {
    if (!solid || !solid.ramp) return 0;
    const run = solid.ramp.axis === 'x' ? solid.max.x - solid.min.x : solid.max.z - solid.min.z;
    if (run <= 0) return 0;
    const s = ((solid.max.y - solid.min.y) / run) * solid.ramp.dir;
    return s * (solid.ramp.axis === 'x' ? dx : dz);
  }

  // ── Raycasts ───────────────────────────────────────────────────────────────

  /**
   * Allocation-free raycast. `d` must be normalized. Returns the hit distance or Infinity.
   * On hit, `hitSolidIndex` and `hitN*` (surface normal) are set.
   */
  rayDist(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    mode: RayMode = 'bullet',
  ): number {
    const skip = skipFlagsFor(mode);
    const q = this.nextQuery();
    let best = Infinity;
    let bestI = -1;
    let bnx = 0;
    let bny = 0;
    let bnz = 0;

    // Clip the ray to the grid rectangle in XZ.
    const gx1 = this.gx0 + this.nx * CELL;
    const gz1 = this.gz0 + this.nz * CELL;
    let t0 = 0;
    let t1 = maxDist;
    if (Math.abs(dx) < 1e-12) {
      if (ox < this.gx0 || ox > gx1) return Infinity;
    } else {
      let a = (this.gx0 - ox) / dx;
      let b = (gx1 - ox) / dx;
      if (a > b) {
        const t = a;
        a = b;
        b = t;
      }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
    }
    if (Math.abs(dz) < 1e-12) {
      if (oz < this.gz0 || oz > gz1) return Infinity;
    } else {
      let a = (this.gz0 - oz) / dz;
      let b = (gz1 - oz) / dz;
      if (a > b) {
        const t = a;
        a = b;
        b = t;
      }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
    }
    if (t0 > t1) return Infinity;

    const sx = ox + dx * t0;
    const sz = oz + dz * t0;
    let ix = this.cellX(sx);
    let iz = this.cellZ(sz);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? CELL / Math.abs(dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? CELL / Math.abs(dz) : Infinity;
    let tMaxX =
      stepX > 0
        ? (this.gx0 + (ix + 1) * CELL - ox) / dx
        : stepX < 0
          ? (this.gx0 + ix * CELL - ox) / dx
          : Infinity;
    let tMaxZ =
      stepZ > 0
        ? (this.gz0 + (iz + 1) * CELL - oz) / dz
        : stepZ < 0
          ? (this.gz0 + iz * CELL - oz) / dz
          : Infinity;

    for (let guard = 0; guard < 4096; guard++) {
      const c = iz * this.nx + ix;
      const end = this.cellStart[c + 1];
      for (let k = this.cellStart[c]; k < end; k++) {
        const i = this.cellItems[k];
        if (this.stamp[i] === q) continue;
        this.stamp[i] = q;
        if (this.flags[i] & skip) continue;
        const t = this.raySolid(i, ox, oy, oz, dx, dy, dz, best < maxDist ? best : maxDist);
        if (t < best) {
          best = t;
          bestI = i;
          bnx = this.tmpNx;
          bny = this.tmpNy;
          bnz = this.tmpNz;
        }
      }
      const tNext = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      if (best <= tNext || tNext > t1) break;
      if (tMaxX < tMaxZ) {
        ix += stepX;
        if (ix < 0 || ix >= this.nx) break;
        tMaxX += tDeltaX;
      } else {
        iz += stepZ;
        if (iz < 0 || iz >= this.nz) break;
        tMaxZ += tDeltaZ;
      }
    }
    if (bestI < 0 || best > maxDist) {
      this.hitSolidIndex = -1;
      return Infinity;
    }
    this.hitSolidIndex = bestI;
    this.hitNx = bnx;
    this.hitNy = bny;
    this.hitNz = bnz;
    return best;
  }

  private tmpNx = 0;
  private tmpNy = 0;
  private tmpNz = 0;

  /** Ray vs one solid (box or wedge). Returns entry distance in [0, maxDist] or Infinity. Sets tmpN*. */
  private raySolid(
    i: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
  ): number {
    let tEnter = -Infinity;
    let tExit = Infinity;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    // X slab
    if (Math.abs(dx) < 1e-12) {
      if (ox < this.mnx[i] || ox > this.mxx[i]) return Infinity;
    } else {
      const inv = 1 / dx;
      let a = (this.mnx[i] - ox) * inv;
      let b = (this.mxx[i] - ox) * inv;
      if (a > b) {
        const t = a;
        a = b;
        b = t;
      }
      if (a > tEnter) {
        tEnter = a;
        nx = dx > 0 ? -1 : 1;
        ny = 0;
        nz = 0;
      }
      if (b < tExit) tExit = b;
    }
    // Y slab
    if (Math.abs(dy) < 1e-12) {
      if (oy < this.mny[i] || oy > this.mxy[i]) return Infinity;
    } else {
      const inv = 1 / dy;
      let a = (this.mny[i] - oy) * inv;
      let b = (this.mxy[i] - oy) * inv;
      if (a > b) {
        const t = a;
        a = b;
        b = t;
      }
      if (a > tEnter) {
        tEnter = a;
        nx = 0;
        ny = dy > 0 ? -1 : 1;
        nz = 0;
      }
      if (b < tExit) tExit = b;
    }
    // Z slab
    if (Math.abs(dz) < 1e-12) {
      if (oz < this.mnz[i] || oz > this.mxz[i]) return Infinity;
    } else {
      const inv = 1 / dz;
      let a = (this.mnz[i] - oz) * inv;
      let b = (this.mxz[i] - oz) * inv;
      if (a > b) {
        const t = a;
        a = b;
        b = t;
      }
      if (a > tEnter) {
        tEnter = a;
        nx = 0;
        ny = 0;
        nz = dz > 0 ? -1 : 1;
      }
      if (b < tExit) tExit = b;
    }
    if (tEnter > tExit) return Infinity;
    // Ramp wedge: intersect with the half-space under the sloped plane  n·p <= c.
    const axis = this.rampAxis[i];
    if (axis !== 0) {
      const lo = axis === 1 ? this.mnx[i] : this.mnz[i];
      const hi = axis === 1 ? this.mxx[i] : this.mxz[i];
      const s = hi > lo ? (this.mxy[i] - this.mny[i]) / (hi - lo) : 0;
      // dir +1: y <= mny + (u - lo) s  →  -s u + y <= mny - s lo
      // dir -1: y <= mny + (hi - u) s  →   s u + y <= mny + s hi
      const pu = this.rampDir[i] > 0 ? -s : s;
      const c = this.rampDir[i] > 0 ? this.mny[i] - s * lo : this.mny[i] + s * hi;
      const pnx = axis === 1 ? pu : 0;
      const pnz = axis === 2 ? pu : 0;
      const denom = pnx * dx + dy + pnz * dz;
      const num = c - (pnx * ox + oy + pnz * oz);
      if (Math.abs(denom) < 1e-12) {
        if (num < 0) return Infinity;
      } else {
        const t = num / denom;
        if (denom < 0) {
          if (t > tEnter) {
            tEnter = t;
            const inv = 1 / Math.sqrt(pnx * pnx + 1 + pnz * pnz);
            nx = pnx * inv;
            ny = inv;
            nz = pnz * inv;
          }
        } else if (t < tExit) tExit = t;
      }
      if (tEnter > tExit) return Infinity;
    }
    // Origin inside the solid → ignore it (no self-blocking when grazing geometry).
    if (tEnter < 0 || tEnter > maxDist) return Infinity;
    this.tmpNx = nx;
    this.tmpNy = ny;
    this.tmpNz = nz;
    return tEnter;
  }

  /** Raycast from `origin` along normalized `dir`. Returns the nearest hit within maxDist or null. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number, mode: RayMode = 'bullet'): RayHit | null {
    const d = this.rayDist(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, mode);
    if (d === Infinity) return null;
    return {
      dist: d,
      point: { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d },
      normal: { x: this.hitNx, y: this.hitNy, z: this.hitNz },
      solid: this.solids[this.hitSolidIndex],
    };
  }

  /** Segment test between two points in the given mode. True if nothing blocks it. */
  segmentClear(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    mode: RayMode = 'sight',
  ): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l < 1e-6) return true;
    const k = 1 / l;
    return this.rayDist(ax, ay, az, dx * k, dy * k, dz * k, l, mode) === Infinity;
  }

  /** Line of sight between two points (mode 'sight'). */
  visible(a: Vec3, b: Vec3): boolean {
    return this.segmentClear(a.x, a.y, a.z, b.x, b.y, b.z, 'sight');
  }
}
