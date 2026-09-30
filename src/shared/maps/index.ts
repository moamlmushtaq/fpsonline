// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — map registry. Pure data; shared by host (collision, spawns,
// bots, objectives) and client (rendering).
// ─────────────────────────────────────────────────────────────────────────────

import type { MapId } from '../types';
import { GANTRY } from './gantry';
import { OBSERVATORY } from './observatory';
import { PASTEL } from './pastel';
import { RANGE } from './range';
import type { MapDef } from './types';

export const MAPS: Record<MapId, MapDef> = {
  gantry: GANTRY,
  pastel: PASTEL,
  observatory: OBSERVATORY,
  range: RANGE,
};

/** Map definition by id (falls back to Gantry for unknown ids). */
export function getMap(id: MapId): MapDef {
  return MAPS[id] ?? MAPS.gantry;
}

export { GANTRY, OBSERVATORY, PASTEL, RANGE };
