// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — map builder: default showcase camera poses (intro / outro /
// key art) for maps whose decor module does not provide its own.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { ShowcasePose } from '../../contracts';
import type { MapDef } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/types';

/** Does the segment a→b pass through any solid (except those containing `ignore`)? */
function segmentBlocked(def: MapDef, a: Vec3, b: Vec3, ignore: Vec3): boolean {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  for (const s of def.solids) {
    if (s.style === 'ground') continue;
    if (ignore.x >= s.min.x && ignore.x <= s.max.x && ignore.z >= s.min.z && ignore.z <= s.max.z && ignore.y <= s.max.y + 0.5) continue;
    let t0 = 0;
    let t1 = 1;
    let hit = true;
    for (const ax of ['x', 'y', 'z'] as const) {
      const o = a[ax];
      const dd = d[ax];
      const lo = s.min[ax] - 0.3;
      const hi = s.max[ax] + 0.3;
      if (Math.abs(dd) < 1e-9) {
        if (o < lo || o > hi) {
          hit = false;
          break;
        }
      } else {
        let ta = (lo - o) / dd;
        let tb = (hi - o) / dd;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) {
          hit = false;
          break;
        }
      }
    }
    if (hit) return true;
  }
  return false;
}

/** Keeps the foreground clear: no solid within `clear` m of the first `len` m of the view ray. */
function nearClear(def: MapDef, a: Vec3, b: Vec3, len: number, clear: number): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const dl = Math.hypot(dx, dy, dz) || 1;
  for (let t = 0; t <= len; t += 2) {
    const x = a.x + (dx / dl) * t, y = a.y + (dy / dl) * t, z = a.z + (dz / dl) * t;
    for (const s of def.solids) {
      if (s.style === 'ground' || (s.max.x - s.min.x) * (s.max.z - s.min.z) > 4000) continue;
      const ex = Math.max(s.min.x - x, 0, x - s.max.x);
      const ey = Math.max(s.min.y - y, 0, y - s.max.y);
      const ez = Math.max(s.min.z - z, 0, z - s.max.z);
      if (Math.hypot(ex, ey, ez) < clear) return false;
    }
  }
  return true;
}

function insideSolid(def: MapDef, p: Vec3): boolean {
  return def.solids.some((s) => p.x > s.min.x - 0.5 && p.x < s.max.x + 0.5 && p.z > s.min.z - 0.5 && p.z < s.max.z + 0.5 && p.y > s.min.y - 0.5 && p.y < s.max.y + 1.2);
}

export function defaultShowcase(def: MapDef, kind: 'intro' | 'outro' | 'keyart'): ShowcasePose {
  const b = def.bounds;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const ext = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
  const sun = def.lighting.sunDir;
  const sunAz = Math.atan2(sun.z, sun.x);
  if (kind === 'outro') {
    const r = def.rocket;
    const dx = cx - r.pos.x;
    const dz = cz - r.pos.z;
    const dl = Math.hypot(dx, dz) || 1;
    const dist = 38 * r.scale + 22;
    return {
      pos: { x: r.pos.x + (dx / dl) * dist + (dz / dl) * dist * 0.35, y: r.pos.y + 10 * r.scale + 4, z: r.pos.z + (dz / dl) * dist - (dx / dl) * dist * 0.35 },
      target: { x: r.pos.x, y: r.pos.y + 16 * r.scale, z: r.pos.z },
      fov: 50,
    };
  }
  // Hero landmark: the tallest structure-type landmark near the middle.
  const heroes = def.landmarks.filter((l) => l.icon !== 'sun' && l.icon !== 'sea' && Math.abs(l.pos.x - cx) < ext && Math.abs(l.pos.z - cz) < ext);
  heroes.sort((p, q) => Math.hypot(p.pos.x - cx, p.pos.z - cz) - Math.hypot(q.pos.x - cx, q.pos.z - cz));
  const hero = heroes[0]?.pos ?? { x: cx, y: 6, z: cz };
  if (kind === 'intro') {
    const a = sunAz + Math.PI * 0.75;
    return {
      pos: { x: hero.x + Math.cos(a) * ext * 0.95, y: ext * 0.42, z: hero.z + Math.sin(a) * ext * 0.95 },
      target: { x: hero.x, y: Math.min(hero.y * 0.3, 6), z: hero.z },
      fov: 55,
    };
  }
  // Key art: low, heroic 3/4 angle with the low sun raking across the frame,
  // lots of painted sky above a low horizon. Search for an unobstructed spot.
  const target = { x: hero.x, y: THREE.MathUtils.clamp(hero.y * 0.55, 3, 16), z: hero.z };
  const offsets = [0.62, 0.52, 0.72, 0.42, 0.82, -0.62, -0.52, -0.72, 0.3, -0.3];
  const dists = [0.62, 0.5, 0.78, 0.4];
  const heights = [3.2, 6, 10, 15];
  for (const hgt of heights) {
    for (const dist of dists) {
      for (const off of offsets) {
        const a = sunAz + Math.PI * off;
        const pos = { x: hero.x + Math.cos(a) * ext * dist, y: hgt, z: hero.z + Math.sin(a) * ext * dist };
        if (Math.abs(pos.x - cx) > ext * 0.95 || Math.abs(pos.z - cz) > ext * 0.95) continue;
        if (insideSolid(def, pos) || segmentBlocked(def, pos, target, target)) continue;
        if (!nearClear(def, pos, target, 14, 2.5)) continue;
        return { pos, target, fov: 48 };
      }
    }
  }
  const a = sunAz + Math.PI * 0.62;
  return { pos: { x: hero.x + Math.cos(a) * ext * 0.6, y: 18, z: hero.z + Math.sin(a) * ext * 0.6 }, target, fov: 48 };
}
