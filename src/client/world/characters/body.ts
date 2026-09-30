// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — body geometry cache. One skinned geometry per
// (faction, armour tint, visor, detail), shared by every instance using it.
// Team colours are NOT baked in (they are material uniforms), so teams and
// colour-blind modes share geometry.
// ─────────────────────────────────────────────────────────────────────────────

import type * as THREE from 'three';
import type { Faction } from '../../../shared/types';
import { findArmor, findVisor } from '../../../shared/cosmetics';
import { buildBloom } from './bloom';
import { buildHalcyon } from './halcyon';
import { Kit, type Detail } from './kit';
import { rigFor } from './rig';

const cache = new Map<string, THREE.BufferGeometry>();

export function bodyGeometry(faction: Faction, armorId: string, visorId: string, detail: Detail): THREE.BufferGeometry {
  const armor = findArmor(armorId);
  const visor = findVisor(visorId);
  const key = `${faction}|${armor.id}|${visor.id}|${detail}`;
  let g = cache.get(key);
  if (g) return g;
  const k = new Kit(detail);
  const rig = rigFor(faction);
  if (faction === 0) buildHalcyon(k, rig, armor.color, visor);
  else buildBloom(k, rig, armor.color, visor);
  g = k.build(rig);
  g.name = `character.${faction === 0 ? 'halcyon' : 'bloom'}.${armor.id}.${visor.id}.d${detail}`;
  cache.set(key, g);
  return g;
}

/** Releases every cached body geometry (e.g. on WebGL context teardown). Live instances must be gone. */
export function disposeBodyGeometries(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}

export function triangleCount(g: THREE.BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}
