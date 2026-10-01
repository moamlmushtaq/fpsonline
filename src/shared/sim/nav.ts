// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — NavGraph: 2.5D walkable graph auto-generated from the
// CollisionWorld, A* search and path smoothing. Used by bots.
//
// Build:
//  1. Sample a 1 m grid over the map bounds. For every column gather each solid
//     top (boxes) / slope height (ramps) under the column center → candidate
//     surfaces (multi-level: floors, roofs, catwalks, tunnels).
//  2. Keep candidates with standing clearance (PLAYER_HEIGHT box). If the column
//     center is blocked, nudge the node by ±0.25 m (so narrow doors still get a
//     node).
//  3. Link 8-neighbours: WALK when |Δy| ≤ STEP_HEIGHT and the midpoint is
//     supported & clear (diagonals must not cut corners); MANTLE (4-neighbours,
//     higher cost) when the rise is ≤ MANTLE_MAX_HEIGHT with room to climb; DROP
//     (one-way) when walking off an edge onto the surface below. Plus map.navLinks.
//  4. Connected components → bots only pick goals in the main component.
// The graph is immutable and cached per MapDef, so rooms share it.
//
// Search: A* over CSR adjacency with a binary heap and generation-stamped
// scratch arrays (no per-search allocation of the big arrays).
// Smoothing: greedy string-pulling over WALK links using 'move' raycasts and a
// ground-continuity probe (no smoothing across holes or drops).
// ─────────────────────────────────────────────────────────────────────────────

import { MANTLE_MAX_HEIGHT, PLAYER_HEIGHT, STEP_HEIGHT } from '../constants';
import type { MapDef } from '../maps/types';
import type { CollisionWorld } from '../physics';
import type { Vec3 } from '../types';

export const LINK_WALK = 0;
export const LINK_MANTLE = 1;
export const LINK_DROP = 2;
export const LINK_JUMP = 3;

export interface NavPath {
  /** Waypoints (feet positions on walkable surfaces). */
  points: Vec3[];
  /** Link kind used to reach points[i] from the previous point. */
  kinds: number[];
}

const CELL = 1;
/** Clearance half-width used for nodes (slightly under PLAYER_RADIUS). */
const NAV_R = 0.34;
const CLEAR_H = PLAYER_HEIGHT - 0.05;
/** Straight-line sweeps use the full player radius (+margin) so bots never scrape corners. */
const SWEEP_R = 0.42;
const MAX_DROP = 9;
const MANTLE_COST = 3;
const DROP_COST = 0.6;
const NUDGES: [number, number][] = [
  [0, 0],
  [0.25, 0],
  [-0.25, 0],
  [0, 0.25],
  [0, -0.25],
  [0.25, 0.25],
  [-0.25, 0.25],
  [0.25, -0.25],
  [-0.25, -0.25],
];
const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const cache = new WeakMap<MapDef, NavGraph>();

export class NavGraph {
  readonly count: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  /** Component id per node: `mainComp` (0) = strongly connected with the spawns, 1 = elsewhere. */
  readonly comp: Int32Array;
  readonly mainComp: number;

  private readonly world: CollisionWorld;
  private readonly x0: number;
  private readonly z0: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly colStart: Int32Array;
  private readonly adjStart: Int32Array;
  private readonly adjTo: Int32Array;
  private readonly adjCost: Float32Array;
  private readonly adjKind: Uint8Array;
  /** Main-component nodes (for random goal picking). */
  readonly mainNodes: Int32Array;

  // A* scratch.
  private gen = 0;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly gScore: Float32Array;
  private readonly parent: Int32Array;
  private readonly parentKind: Uint8Array;
  private heapN: Int32Array;
  private heapF: Float32Array;

  /** Builds (or returns the cached) graph for a map. */
  static build(world: CollisionWorld, map: MapDef): NavGraph {
    const c = cache.get(map);
    if (c) return c;
    const g = new NavGraph(world, map);
    cache.set(map, g);
    return g;
  }

  private constructor(world: CollisionWorld, map: MapDef) {
    this.world = world;
    const b = map.bounds;
    this.x0 = b.min.x;
    this.z0 = b.min.z;
    this.nx = Math.max(1, Math.floor((b.max.x - b.min.x) / CELL));
    this.nz = Math.max(1, Math.floor((b.max.z - b.min.z) / CELL));
    const cols = this.nx * this.nz;

    // 1. Candidate surfaces per column.
    const cand: number[][] = new Array(cols);
    for (let i = 0; i < cols; i++) cand[i] = [];
    const solids = world.solids;
    for (let si = 0; si < solids.length; si++) {
      const s = solids[si];
      if (s.walkThrough) continue;
      const mnx = Math.min(s.min.x, s.max.x);
      const mxx = Math.max(s.min.x, s.max.x);
      const mnz = Math.min(s.min.z, s.max.z);
      const mxz = Math.max(s.min.z, s.max.z);
      const ix0 = Math.max(0, Math.ceil((mnx - this.x0) / CELL - 0.5));
      const ix1 = Math.min(this.nx - 1, Math.floor((mxx - this.x0) / CELL - 0.5));
      const iz0 = Math.max(0, Math.ceil((mnz - this.z0) / CELL - 0.5));
      const iz1 = Math.min(this.nz - 1, Math.floor((mxz - this.z0) / CELL - 0.5));
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const cx = this.x0 + (ix + 0.5) * CELL;
          const cz = this.z0 + (iz + 0.5) * CELL;
          const top = world.topAt(si, cx, cz);
          if (top <= map.killY + 0.5 || top > b.max.y) continue;
          cand[iz * this.nx + ix].push(top);
        }
      }
    }

    // 2. Nodes with clearance.
    const nodeX: number[] = [];
    const nodeY: number[] = [];
    const nodeZ: number[] = [];
    this.colStart = new Int32Array(cols + 1);
    for (let col = 0; col < cols; col++) {
      this.colStart[col] = nodeX.length;
      const list = cand[col];
      if (list.length === 0) continue;
      list.sort((a, c) => a - c);
      const ix = col % this.nx;
      const iz = (col - ix) / this.nx;
      const cx = this.x0 + (ix + 0.5) * CELL;
      const cz = this.z0 + (iz + 0.5) * CELL;
      let last = -Infinity;
      for (const top of list) {
        for (const [ox, oz] of NUDGES) {
          const x = cx + ox;
          const z = cz + oz;
          // Standing height = highest surface under the player's footprint within a step
          // of this surface (stairs: the player stands on the upper step edge).
          const y = world.supportHeight(x, z, NAV_R, top + STEP_HEIGHT, STEP_HEIGHT + 0.06);
          if (Number.isNaN(y) || y < top - 0.05) continue;
          if (y - last < 0.05) break;
          if (world.boxOverlaps(x, y + 0.02, z, NAV_R, CLEAR_H)) continue;
          nodeX.push(x);
          nodeY.push(y);
          nodeZ.push(z);
          last = y;
          break;
        }
      }
    }
    this.colStart[cols] = nodeX.length;
    const n = nodeX.length;
    this.count = n;
    this.px = Float32Array.from(nodeX);
    this.py = Float32Array.from(nodeY);
    this.pz = Float32Array.from(nodeZ);

    // 3. Links.
    const lTo: number[] = [];
    const lCost: number[] = [];
    const lKind: number[] = [];
    const lFrom: number[] = [];
    const addLink = (a: number, c: number, cost: number, kind: number) => {
      lFrom.push(a);
      lTo.push(c);
      lCost.push(cost);
      lKind.push(kind);
    };
    for (let col = 0; col < cols; col++) {
      const ix = col % this.nx;
      const iz = (col - ix) / this.nx;
      for (let a = this.colStart[col]; a < this.colStart[col + 1]; a++) {
        const ax = nodeX[a];
        const ay = nodeY[a];
        const az = nodeZ[a];
        for (const [dx, dz] of DIRS) {
          const jx = ix + dx;
          const jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
          const diag = dx !== 0 && dz !== 0;
          const ncol = jz * this.nx + jx;
          for (let c = this.colStart[ncol]; c < this.colStart[ncol + 1]; c++) {
            const bx = nodeX[c];
            const by = nodeY[c];
            const bz = nodeZ[c];
            const dy = by - ay;
            const hd = Math.hypot(bx - ax, bz - az);
            if (Math.abs(dy) <= STEP_HEIGHT + 0.02) {
              if (diag && !(this.hasWalkNeighbor(ix + dx, iz, ay) && this.hasWalkNeighbor(ix, iz + dz, ay))) continue;
              const mx = (ax + bx) * 0.5;
              const mz = (az + bz) * 0.5;
              const top = Math.max(ay, by);
              const g = world.supportHeight(mx, mz, 0.15, top + 0.05, STEP_HEIGHT + 0.3);
              if (Number.isNaN(g) || g < Math.min(ay, by) - 0.3) continue;
              if (world.boxOverlaps(mx, g + 0.02, mz, NAV_R, CLEAR_H)) continue;
              addLink(a, c, Math.hypot(hd, dy), LINK_WALK);
            } else if (!diag && Math.abs(dy) <= 1.6 && this.fineWalkable(ax, ay, az, bx, by, bz)) {
              // Steep stairs: walkable by consecutive step-ups.
              addLink(a, c, Math.hypot(hd, dy) * 1.1, LINK_WALK);
            } else if (!diag && dy > 0 && dy <= MANTLE_MAX_HEIGHT) {
              // Mantle up: room to rise in place and to move over the lip at the top.
              if (world.boxOverlaps(ax, by + 0.02, az, NAV_R, CLEAR_H)) continue;
              if (world.boxOverlaps((ax + bx) * 0.5, by + 0.02, (az + bz) * 0.5, NAV_R, CLEAR_H)) continue;
              addLink(a, c, hd + dy + MANTLE_COST, LINK_MANTLE);
            } else if (!diag && dy < 0 && dy >= -MAX_DROP) {
              // Walk off the edge at our height (nothing in the way), fall onto the surface below.
              if (world.boxOverlaps((ax + bx) * 0.5, ay + 0.02, (az + bz) * 0.5, NAV_R, CLEAR_H)) continue;
              if (world.boxOverlaps(bx, ay + 0.02, bz, NAV_R, CLEAR_H)) continue;
              // The first surface met when falling from our height must be b's (no floor in between).
              const g = world.supportHeight(bx, bz, 0.1, ay + 0.05, MAX_DROP + 0.5);
              if (Number.isNaN(g) || Math.abs(g - by) > 0.08) continue;
              if (dy >= -MANTLE_MAX_HEIGHT) addLink(a, c, hd + DROP_COST, LINK_DROP);
              else addLink(a, c, hd - dy * 0.3 + DROP_COST, LINK_DROP);
            }
          }
        }
      }
    }
    // Hand-authored links (ladders, jump-downs).
    for (const l of map.navLinks ?? []) {
      const a = this.nearestIn(nodeX, nodeY, nodeZ, l.from, 3);
      const c = this.nearestIn(nodeX, nodeY, nodeZ, l.to, 3);
      if (a >= 0 && c >= 0 && a !== c) {
        const d = Math.hypot(nodeX[c] - nodeX[a], nodeY[c] - nodeY[a], nodeZ[c] - nodeZ[a]);
        addLink(a, c, d * 1.2 + 1, LINK_JUMP);
      }
    }
    // CSR.
    this.adjStart = new Int32Array(n + 1);
    for (const f of lFrom) this.adjStart[f + 1]++;
    for (let i = 0; i < n; i++) this.adjStart[i + 1] += this.adjStart[i];
    const m = lFrom.length;
    this.adjTo = new Int32Array(m);
    this.adjCost = new Float32Array(m);
    this.adjKind = new Uint8Array(m);
    const fill = this.adjStart.slice(0, n);
    for (let k = 0; k < m; k++) {
      const at = fill[lFrom[k]]++;
      this.adjTo[at] = lTo[k];
      this.adjCost[at] = lCost[k];
      this.adjKind[at] = lKind[k];
    }

    // 4. Main component = nodes that are reachable FROM the spawn area AND can get BACK
    //    to it (strongly connected with a spawn). Roofs only reachable by one-way drops
    //    are excluded, so bots never pick unreachable goals or cover.
    this.comp = new Int32Array(n).fill(1);
    const rev: number[][] = Array.from({ length: n }, () => []);
    for (let k = 0; k < m; k++) rev[lTo[k]].push(lFrom[k]);
    let seed = -1;
    for (const sp of map.spawns) {
      seed = this.nearestIn(nodeX, nodeY, nodeZ, sp.pos, 3);
      if (seed >= 0) break;
    }
    if (seed < 0 && n > 0) seed = 0;
    const fwd = new Uint8Array(n);
    const bwd = new Uint8Array(n);
    const stack: number[] = [];
    if (seed >= 0) {
      fwd[seed] = 1;
      stack.push(seed);
      while (stack.length) {
        const u = stack.pop() as number;
        for (let e = this.adjStart[u]; e < this.adjStart[u + 1]; e++) {
          const v = this.adjTo[e];
          if (!fwd[v]) {
            fwd[v] = 1;
            stack.push(v);
          }
        }
      }
      bwd[seed] = 1;
      stack.push(seed);
      while (stack.length) {
        const u = stack.pop() as number;
        for (const v of rev[u]) {
          if (!bwd[v]) {
            bwd[v] = 1;
            stack.push(v);
          }
        }
      }
    }
    this.mainComp = 0;
    const main: number[] = [];
    for (let i = 0; i < n; i++) {
      if (fwd[i] && bwd[i]) {
        this.comp[i] = 0;
        main.push(i);
      }
    }
    this.mainNodes = Int32Array.from(main);

    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gScore = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.parentKind = new Uint8Array(n);
    this.heapN = new Int32Array(1024);
    this.heapF = new Float32Array(1024);
  }

  /**
   * Per-node reachability relative to the main component (computed on demand,
   * for map validation — bots never need it): `fromMain[i]` = a player in the
   * main component can get to node i (walk / mantle / drop / jump links);
   * `toMain[i]` = from node i a player can get back into the main component.
   * A node with fromMain && !toMain is a trapped pocket (a pit you can fall
   * into but not climb out of); !fromMain && !toMain is an unreachable perch.
   */
  reachability(): { fromMain: Uint8Array; toMain: Uint8Array } {
    const n = this.count;
    const fromMain = new Uint8Array(n);
    const toMain = new Uint8Array(n);
    const stack: number[] = [];
    for (const k of this.mainNodes) {
      fromMain[k] = 1;
      stack.push(k);
    }
    while (stack.length) {
      const u = stack.pop() as number;
      for (let e = this.adjStart[u]; e < this.adjStart[u + 1]; e++) {
        const v = this.adjTo[e];
        if (!fromMain[v]) {
          fromMain[v] = 1;
          stack.push(v);
        }
      }
    }
    // Reverse CSR for the backward search.
    const m = this.adjTo.length;
    const rStart = new Int32Array(n + 1);
    for (let e = 0; e < m; e++) rStart[this.adjTo[e] + 1]++;
    for (let i = 0; i < n; i++) rStart[i + 1] += rStart[i];
    const rFrom = new Int32Array(m);
    const fill = rStart.slice(0, n);
    for (let u = 0; u < n; u++) for (let e = this.adjStart[u]; e < this.adjStart[u + 1]; e++) rFrom[fill[this.adjTo[e]]++] = u;
    for (const k of this.mainNodes) {
      toMain[k] = 1;
      stack.push(k);
    }
    while (stack.length) {
      const v = stack.pop() as number;
      for (let e = rStart[v]; e < rStart[v + 1]; e++) {
        const u = rFrom[e];
        if (!toMain[u]) {
          toMain[u] = 1;
          stack.push(u);
        }
      }
    }
    return { fromMain, toMain };
  }

  /** Fine traversal check (0.2 m samples): every sub-step rises ≤ STEP_HEIGHT with clearance. */
  private fineWalkable(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const w = this.world;
    let prev = ay;
    const n = 5;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const g = w.supportHeight(x, z, NAV_R, prev + STEP_HEIGHT, STEP_HEIGHT * 2);
      if (Number.isNaN(g) || Math.abs(g - prev) > STEP_HEIGHT + 0.01) return false;
      if (w.boxOverlaps(x, g + 0.02, z, NAV_R, CLEAR_H)) return false;
      prev = g;
    }
    return Math.abs(by - prev) <= STEP_HEIGHT + 0.01;
  }

  private hasWalkNeighbor(ix: number, iz: number, y: number): boolean {
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return false;
    const col = iz * this.nx + ix;
    // colStart is fully built only up to the current column during construction, but
    // neighbour columns are always finished because nodes are created before links.
    for (let k = this.colStart[col]; k < this.colStart[col + 1]; k++) {
      if (Math.abs(this.pyAt(k) - y) <= STEP_HEIGHT + 0.02) return true;
    }
    return false;
  }

  private pyAt(k: number): number {
    return this.py[k];
  }

  private nearestIn(xs: number[], ys: number[], zs: number[], p: Vec3, maxD: number): number {
    let best = -1;
    let bd = maxD * maxD;
    for (let i = 0; i < xs.length; i++) {
      const d = (xs[i] - p.x) ** 2 + (ys[i] - p.y) ** 2 * 2 + (zs[i] - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  nodePos(i: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    out.x = this.px[i];
    out.y = this.py[i];
    out.z = this.pz[i];
    return out;
  }

  /**
   * Nearest node to a position, preferring nodes at or slightly below the feet on the
   * same level. Searches columns within `radius` meters. Returns -1 if none.
   */
  nearestNode(pos: Vec3, radius = 3, mainOnly = false): number {
    const ix = Math.floor((pos.x - this.x0) / CELL);
    const iz = Math.floor((pos.z - this.z0) / CELL);
    const r = Math.ceil(radius / CELL);
    let best = -1;
    let bd = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      const jz = iz + dz;
      if (jz < 0 || jz >= this.nz) continue;
      for (let dx = -r; dx <= r; dx++) {
        const jx = ix + dx;
        if (jx < 0 || jx >= this.nx) continue;
        const col = jz * this.nx + jx;
        for (let k = this.colStart[col]; k < this.colStart[col + 1]; k++) {
          if (mainOnly && this.comp[k] !== this.mainComp) continue;
          const ddy = this.py[k] - pos.y;
          // Heavily penalize nodes above the feet (other floors) and far below.
          const vy = ddy > 0.6 ? ddy * 6 : ddy < -2.5 ? -ddy * 3 : Math.abs(ddy) * 0.8;
          const d = (this.px[k] - pos.x) ** 2 + (this.pz[k] - pos.z) ** 2 + vy * vy;
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
      }
    }
    return best;
  }

  /** Random node of the main component, optionally within `radius` of `near`. */
  randomNode(rng: () => number, near?: Vec3, radius = 20): number {
    const nodes = this.mainNodes;
    if (nodes.length === 0) return -1;
    if (!near) return nodes[Math.floor(rng() * nodes.length) % nodes.length];
    for (let tries = 0; tries < 24; tries++) {
      const ang = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * radius;
      const k = this.nearestNode({ x: near.x + Math.cos(ang) * d, y: near.y, z: near.z + Math.sin(ang) * d }, 2.5, true);
      if (k >= 0) return k;
    }
    return this.nearestNode(near, radius, true);
  }

  /** Iterates main-component nodes within `radius` (horizontal) of `pos`, calling fn(k). */
  forNodesNear(pos: Vec3, radius: number, fn: (k: number) => void): void {
    const ix0 = Math.max(0, Math.floor((pos.x - radius - this.x0) / CELL));
    const ix1 = Math.min(this.nx - 1, Math.floor((pos.x + radius - this.x0) / CELL));
    const iz0 = Math.max(0, Math.floor((pos.z - radius - this.z0) / CELL));
    const iz1 = Math.min(this.nz - 1, Math.floor((pos.z + radius - this.z0) / CELL));
    const r2 = radius * radius;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const col = iz * this.nx + ix;
        for (let k = this.colStart[col]; k < this.colStart[col + 1]; k++) {
          if (this.comp[k] !== this.mainComp) continue;
          const dx = this.px[k] - pos.x;
          const dz = this.pz[k] - pos.z;
          if (dx * dx + dz * dz <= r2) fn(k);
        }
      }
    }
  }

  /**
   * A* path from `from` to `to`. Returns smoothed waypoints (the start position is not
   * included; the last point is the goal node) or null if unreachable.
   */
  findPath(from: Vec3, to: Vec3, maxExpand = 40000): NavPath | null {
    const s = this.nearestNode(from, 3);
    const g = this.nearestNode(to, 4);
    if (s < 0 || g < 0) return null;
    const nodes = this.search(s, g, maxExpand);
    if (!nodes) return null;
    return this.smooth(from, nodes.list, nodes.kinds);
  }

  /** Path node indices (including start and goal), or null. */
  searchNodes(s: number, g: number, maxExpand = 40000): number[] | null {
    const r = this.search(s, g, maxExpand);
    return r ? r.list : null;
  }

  private search(s: number, g: number, maxExpand: number): { list: number[]; kinds: number[] } | null {
    if (s === g) return { list: [s], kinds: [LINK_WALK] };
    if (this.comp[g] !== this.mainComp && this.comp[s] === this.mainComp) {
      // Goal outside the main component: usually unreachable (roofs); cap the work.
      maxExpand = Math.min(maxExpand, 6000);
    }
    this.gen = (this.gen + 1) >>> 0;
    if (this.gen === 0) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const gx = this.px[g];
    const gy = this.py[g];
    const gz = this.pz[g];
    let heapSize = 0;
    const push = (node: number, f: number) => {
      if (heapSize >= this.heapN.length) {
        const nn = new Int32Array(this.heapN.length * 2);
        nn.set(this.heapN);
        const nf = new Float32Array(this.heapF.length * 2);
        nf.set(this.heapF);
        this.heapN = nn;
        this.heapF = nf;
      }
      const hn = this.heapN;
      const hf = this.heapF;
      let i = heapSize++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hf[p] <= f) break;
        hn[i] = hn[p];
        hf[i] = hf[p];
        i = p;
      }
      hn[i] = node;
      hf[i] = f;
    };
    const pop = (): number => {
      const hn = this.heapN;
      const hf = this.heapF;
      const top = hn[0];
      const lastN = hn[--heapSize];
      const lastF = hf[heapSize];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= heapSize) break;
        const r = l + 1;
        const c = r < heapSize && hf[r] < hf[l] ? r : l;
        if (hf[c] >= lastF) break;
        hn[i] = hn[c];
        hf[i] = hf[c];
        i = c;
      }
      hn[i] = lastN;
      hf[i] = lastF;
      return top;
    };
    const h = (k: number) => Math.hypot(this.px[k] - gx, this.py[k] - gy, this.pz[k] - gz);
    this.stamp[s] = gen;
    this.gScore[s] = 0;
    this.parent[s] = -1;
    push(s, h(s));
    let expanded = 0;
    while (heapSize > 0) {
      const u = pop();
      if (this.closed[u] === gen) continue;
      this.closed[u] = gen;
      if (u === g) break;
      if (++expanded > maxExpand) return null;
      const gu = this.gScore[u];
      for (let e = this.adjStart[u]; e < this.adjStart[u + 1]; e++) {
        const v = this.adjTo[e];
        if (this.closed[v] === gen) continue;
        const ng = gu + this.adjCost[e];
        if (this.stamp[v] !== gen || ng < this.gScore[v]) {
          this.stamp[v] = gen;
          this.gScore[v] = ng;
          this.parent[v] = u;
          this.parentKind[v] = this.adjKind[e];
          push(v, ng + h(v));
        }
      }
    }
    if (this.closed[g] !== gen) return null;
    const list: number[] = [];
    const kinds: number[] = [];
    for (let k = g; k !== -1; k = this.parent[k]) {
      list.push(k);
      kinds.push(k === s ? LINK_WALK : this.parentKind[k]);
    }
    list.reverse();
    kinds.reverse();
    return { list, kinds };
  }

  /** Greedy string-pulling over WALK segments. */
  private smooth(from: Vec3, list: number[], kinds: number[]): NavPath {
    const points: Vec3[] = [];
    const outKinds: number[] = [];
    const MAX_LOOK = 14;
    let ax = from.x;
    let ay = from.y;
    let az = from.z;
    let i = -1; // -1 = the start position
    const last = list.length - 1;
    while (i < last) {
      let j = i + 1;
      if (kinds[j] === LINK_WALK) {
        for (let c = i + 2; c <= Math.min(last, i + MAX_LOOK); c++) {
          if (kinds[c] !== LINK_WALK) break;
          if (!this.straightWalkable(ax, ay, az, this.px[list[c]], this.py[list[c]], this.pz[list[c]])) break;
          j = c;
        }
      }
      const k = list[j];
      points.push({ x: this.px[k], y: this.py[k], z: this.pz[k] });
      outKinds.push(kinds[j]);
      ax = this.px[k];
      ay = this.py[k];
      az = this.pz[k];
      i = j;
    }
    return { points, kinds: outKinds };
  }

  /**
   * Can a player walk in a straight line from a to b? Sweeps the player box along the
   * segment (0.4 m samples, overlapping footprints) following the ground: every sample
   * needs support within a step of the previous one and full standing clearance.
   */
  straightWalkable(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const hd = Math.hypot(dx, dz);
    if (hd < 0.05) return Math.abs(by - ay) <= STEP_HEIGHT + 0.01;
    const w = this.world;
    const steps = Math.ceil(hd / 0.4);
    let prev = ay;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = ax + dx * t;
      const z = az + dz * t;
      const g = w.supportHeight(x, z, SWEEP_R, prev + STEP_HEIGHT, STEP_HEIGHT * 2 + 0.2);
      if (Number.isNaN(g) || Math.abs(g - prev) > STEP_HEIGHT + 0.01) return false;
      if (w.boxOverlaps(x, g + 0.03, z, SWEEP_R, CLEAR_H)) return false;
      prev = g;
    }
    return Math.abs(by - prev) <= STEP_HEIGHT + 0.01;
  }
}
