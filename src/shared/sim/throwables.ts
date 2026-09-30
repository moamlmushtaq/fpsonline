// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — throwables: projectile physics (gravity, bouncing off solids),
// pulse-grenade detonation timing and smoke clouds.
//
// Damage application is delegated to the GameSim through `onExplode` so all
// damage/kill bookkeeping stays in one place. Smoke clouds only block SIGHT
// (bots use `smokeBlocks`); bullets pass through smoke.
// ─────────────────────────────────────────────────────────────────────────────

import { GRAVITY, GRENADE_FUSE, SMOKE_DURATION, SMOKE_FUSE, SMOKE_RADIUS, THROWABLE_BOUNCE } from '../constants';
import type { AABB } from '../maps/types';
import { q2, smoothstep } from '../math';
import type { CollisionWorld } from '../physics';
import type { GameEvent, ProjectileSnap, SmokeSnap, Team, ThrowableId, Vec3 } from '../types';

export interface Projectile {
  id: number;
  kind: ThrowableId;
  owner: number;
  team: Team;
  pos: Vec3;
  vel: Vec3;
  fuse: number;
  resting: boolean;
  lastBounceTick: number;
}

export interface SmokeCloud {
  id: number;
  pos: Vec3;
  /** Current radius. */
  r: number;
  /** Seconds remaining. */
  t: number;
  age: number;
}

/** Collision radius of a thrown canister. */
const PROJ_RADIUS = 0.09;
/** Tangential velocity kept on each bounce: floors grip (predictable landings), walls glance. */
const FLOOR_FRICTION = 0.5;
const WALL_FRICTION = 0.72;
/** Seconds for a smoke cloud to reach full size, and to fade at the end. */
const SMOKE_GROW = 1.6;
const SMOKE_FADE = 1.5;

/** True if the segment a→b passes through any active smoke cloud (sight blocking). */
export function smokeBlocks(smokes: readonly SmokeCloud[], a: Vec3, b: Vec3): boolean {
  if (smokes.length === 0) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const ll = dx * dx + dy * dy + dz * dz;
  for (const s of smokes) {
    const r = s.r * 0.85;
    if (r <= 0.3) continue;
    // Closest point on the segment to the sphere center.
    let t = ll > 0 ? ((s.pos.x - a.x) * dx + (s.pos.y - a.y) * dy + (s.pos.z - a.z) * dz) / ll : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = a.x + dx * t - s.pos.x;
    const cy = a.y + dy * t - s.pos.y;
    const cz = a.z + dz * t - s.pos.z;
    if (cx * cx + cy * cy + cz * cz < r * r) return true;
  }
  return false;
}

export class ThrowableSystem {
  readonly projectiles: Projectile[] = [];
  readonly smokes: SmokeCloud[] = [];
  private nextId = 1;

  spawn(owner: number, team: Team, kind: ThrowableId, origin: Vec3, vel: Vec3, tick: number): Projectile {
    const p: Projectile = {
      id: this.nextId++,
      kind,
      owner,
      team,
      pos: { x: origin.x, y: origin.y, z: origin.z },
      vel: { x: vel.x, y: vel.y, z: vel.z },
      fuse: kind === 'grenade' ? GRENADE_FUSE : SMOKE_FUSE,
      resting: false,
      lastBounceTick: tick - 100,
    };
    this.projectiles.push(p);
    return p;
  }

  /** Removes every projectile owned by `owner` (e.g. the player left). */
  removeOwner(owner: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (this.projectiles[i].owner === owner) this.projectiles.splice(i, 1);
  }

  clear(): void {
    this.projectiles.length = 0;
    this.smokes.length = 0;
  }

  step(
    world: CollisionWorld,
    dt: number,
    tick: number,
    killY: number,
    emit: (ev: GameEvent) => void,
    onExplode: (p: Projectile) => void,
  ): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.fuse -= dt;
      if (!p.resting) this.integrate(world, p, dt, tick, emit);
      if (p.pos.y < killY) {
        this.projectiles.splice(i, 1);
        continue;
      }
      if (p.fuse <= 0) {
        this.projectiles.splice(i, 1);
        if (p.kind === 'grenade') {
          emit({ t: 'explode', id: p.id, pos: { x: q2(p.pos.x), y: q2(p.pos.y), z: q2(p.pos.z) } });
          onExplode(p);
        } else {
          const c: SmokeCloud = { id: p.id, pos: { x: p.pos.x, y: p.pos.y + 0.6, z: p.pos.z }, r: 0.5, t: SMOKE_DURATION, age: 0 };
          this.smokes.push(c);
          emit({ t: 'smoke', id: p.id, pos: { x: q2(c.pos.x), y: q2(c.pos.y), z: q2(c.pos.z) } });
        }
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.age += dt;
      s.t -= dt;
      if (s.t <= 0) {
        this.smokes.splice(i, 1);
        continue;
      }
      const grow = smoothstep(0, SMOKE_GROW, s.age);
      const fade = s.t < SMOKE_FADE ? s.t / SMOKE_FADE : 1;
      s.r = Math.max(0.5, SMOKE_RADIUS * grow * (0.35 + 0.65 * fade));
    }
  }

  private integrate(world: CollisionWorld, p: Projectile, dt: number, tick: number, emit: (ev: GameEvent) => void): void {
    p.vel.y -= GRAVITY * dt;
    let remaining = dt;
    for (let iter = 0; iter < 3 && remaining > 1e-6; iter++) {
      const sp = Math.sqrt(p.vel.x * p.vel.x + p.vel.y * p.vel.y + p.vel.z * p.vel.z);
      if (sp < 1e-6) break;
      const dx = p.vel.x / sp;
      const dy = p.vel.y / sp;
      const dz = p.vel.z / sp;
      const travel = sp * remaining;
      const hit = world.rayDist(p.pos.x, p.pos.y, p.pos.z, dx, dy, dz, travel + PROJ_RADIUS, 'bullet');
      if (hit === Infinity) {
        p.pos.x += dx * travel;
        p.pos.y += dy * travel;
        p.pos.z += dz * travel;
        remaining = 0;
        break;
      }
      const moveD = Math.max(0, hit - PROJ_RADIUS);
      p.pos.x += dx * moveD;
      p.pos.y += dy * moveD;
      p.pos.z += dz * moveD;
      remaining -= moveD / sp;
      const nx = world.hitNx;
      const ny = world.hitNy;
      const nz = world.hitNz;
      const vn = p.vel.x * nx + p.vel.y * ny + p.vel.z * nz;
      if (vn < 0) {
        // Reflect the normal component with restitution, damp the tangential one.
        const tx = p.vel.x - vn * nx;
        const ty = p.vel.y - vn * ny;
        const tz = p.vel.z - vn * nz;
        const rn = -vn * THROWABLE_BOUNCE;
        const f = ny > 0.7 ? FLOOR_FRICTION : WALL_FRICTION;
        p.vel.x = tx * f + nx * rn;
        p.vel.y = ty * f + ny * rn;
        p.vel.z = tz * f + nz * rn;
        if (-vn > 2.2 && tick - p.lastBounceTick > 5) {
          p.lastBounceTick = tick;
          emit({ t: 'bounce', id: p.id, pos: { x: q2(p.pos.x), y: q2(p.pos.y), z: q2(p.pos.z) } });
        }
        if (ny > 0.7) {
          const s2 = p.vel.x * p.vel.x + p.vel.y * p.vel.y + p.vel.z * p.vel.z;
          if (s2 < 1.2 * 1.2) {
            p.vel.x = 0;
            p.vel.y = 0;
            p.vel.z = 0;
            p.resting = true;
            break;
          }
        }
      } else {
        // Grazing contact: nudge out along the normal to avoid sticking.
        p.pos.x += nx * 0.01;
        p.pos.y += ny * 0.01;
        p.pos.z += nz * 0.01;
      }
    }
    this.keepInBounds(world.bounds, p);
  }

  private keepInBounds(b: AABB, p: Projectile): void {
    if (p.pos.x < b.min.x) {
      p.pos.x = b.min.x;
      p.vel.x = Math.abs(p.vel.x) * THROWABLE_BOUNCE;
    } else if (p.pos.x > b.max.x) {
      p.pos.x = b.max.x;
      p.vel.x = -Math.abs(p.vel.x) * THROWABLE_BOUNCE;
    }
    if (p.pos.z < b.min.z) {
      p.pos.z = b.min.z;
      p.vel.z = Math.abs(p.vel.z) * THROWABLE_BOUNCE;
    } else if (p.pos.z > b.max.z) {
      p.pos.z = b.max.z;
      p.vel.z = -Math.abs(p.vel.z) * THROWABLE_BOUNCE;
    }
  }

  projectileSnaps(): ProjectileSnap[] {
    return this.projectiles.map((p) => ({ id: p.id, kind: p.kind, owner: p.owner, x: q2(p.pos.x), y: q2(p.pos.y), z: q2(p.pos.z) }));
  }

  smokeSnaps(): SmokeSnap[] {
    return this.smokes.map((s) => ({ id: s.id, x: q2(s.pos.x), y: q2(s.pos.y), z: q2(s.pos.z), r: q2(s.r), t: q2(s.t) }));
  }
}
