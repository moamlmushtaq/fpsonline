// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — body geometry cache. One skinned geometry per
// (faction, armour tint, visor, detail), shared by every instance using it.
// Team colours are NOT baked in (they are material uniforms), so teams and
// colour-blind modes share geometry.
//
// Lifetime: entries are reference counted. `bodyGeometry()` acquires a
// reference; `releaseBodyGeometry(geo, owner)` (called from
// CharacterInstance.dispose) drops it. Unreferenced entries stay cached as
// "idle" (a bot that respawns or the next match reuses them without a build
// hitch), but at most IDLE_KEEP of them: beyond that the least recently used
// idle geometry is disposed. Random bot cosmetics therefore no longer grow the
// GPU geometry count match after match (QA measured ~7 per match before).
// ─────────────────────────────────────────────────────────────────────────────

import type * as THREE from 'three';
import type { Faction } from '../../../shared/types';
import { findArmor, findVisor } from '../../../shared/cosmetics';
import { buildBloom } from './bloom';
import { buildHalcyon } from './halcyon';
import { Kit, type Detail } from './kit';
import { rigFor } from './rig';

/** Idle (unreferenced) geometries kept warm for reuse before LRU disposal. */
const IDLE_KEEP = 6;

interface Entry {
  key: string;
  geo: THREE.BufferGeometry;
  refs: number;
  /** Monotonic use stamp (LRU order among idle entries). */
  used: number;
}

const cache = new Map<string, Entry>();
const byGeo = new WeakMap<THREE.BufferGeometry, Entry>();
/** Owners that already released a geometry (makes a repeated dispose() harmless). */
const released = new WeakMap<object, Set<THREE.BufferGeometry>>();
let clock = 0;

export function bodyGeometry(faction: Faction, armorId: string, visorId: string, detail: Detail): THREE.BufferGeometry {
  const armor = findArmor(armorId);
  const visor = findVisor(visorId);
  const key = `${faction}|${armor.id}|${visor.id}|${detail}`;
  let e = cache.get(key);
  if (!e) {
    const k = new Kit(detail);
    const rig = rigFor(faction);
    if (faction === 0) buildHalcyon(k, rig, armor.color, visor);
    else buildBloom(k, rig, armor.color, visor);
    const geo = k.build(rig);
    geo.name = `character.${faction === 0 ? 'halcyon' : 'bloom'}.${armor.id}.${visor.id}.d${detail}`;
    e = { key, geo, refs: 0, used: 0 };
    cache.set(key, e);
    byGeo.set(geo, e);
  }
  e.refs++;
  e.used = ++clock;
  return e.geo;
}

/**
 * Drops one reference taken by `bodyGeometry()`. `owner` (the instance) makes
 * the call idempotent per owner/geometry pair. Unknown geometries are ignored.
 */
export function releaseBodyGeometry(geo: THREE.BufferGeometry | null | undefined, owner: object): void {
  if (!geo) return;
  const e = byGeo.get(geo);
  if (!e || cache.get(e.key) !== e) return;
  let set = released.get(owner);
  if (!set) released.set(owner, (set = new Set()));
  if (set.has(geo)) return;
  set.add(geo);
  e.refs = Math.max(0, e.refs - 1);
  e.used = ++clock;
  if (e.refs === 0) pruneBodyGeometries(IDLE_KEEP);
}

/**
 * Disposes unreferenced geometries beyond the `keep` most recently used idle
 * ones (keep = 0 → drop every idle entry). Referenced entries are never touched.
 */
export function pruneBodyGeometries(keep = IDLE_KEEP): number {
  const idle: Entry[] = [];
  for (const e of cache.values()) if (e.refs === 0) idle.push(e);
  if (idle.length <= keep) return 0;
  idle.sort((a, b) => b.used - a.used);
  let n = 0;
  for (let i = Math.max(0, keep); i < idle.length; i++) {
    const e = idle[i];
    cache.delete(e.key);
    e.geo.dispose();
    n++;
  }
  return n;
}

/** Number of cached body geometries (live + idle); for diagnostics/tests. */
export function bodyGeometryCacheSize(): { total: number; idle: number } {
  let idle = 0;
  for (const e of cache.values()) if (e.refs === 0) idle++;
  return { total: cache.size, idle };
}

/** Releases every cached body geometry (e.g. on WebGL context teardown). Live instances must be gone. */
export function disposeBodyGeometries(): void {
  for (const e of cache.values()) e.geo.dispose();
  cache.clear();
}

export function triangleCount(g: THREE.BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}
