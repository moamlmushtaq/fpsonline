// HALCYON FRONT — map data contract (architecture contract, see ARCHITECTURE.md).
//
// A MapDef is pure data shared by host (collision, spawns, bots, objectives) and
// client (rendering). Collision is built ONLY from `solids`. Visual-only detail is
// produced by the per-map decor module on the client (src/client/world/maps/<id>.ts).

import type { MapId, SurfaceTag, Team, Vec3, ZoneId } from '../types';

export interface AABB {
  min: Vec3;
  max: Vec3;
}

/**
 * An axis-aligned collision solid.
 * If `ramp` is set, the solid's TOP surface is sloped: its height rises linearly
 * from min.y at the low edge to max.y at the high edge along `ramp.axis`, rising
 * toward +axis when dir = 1, or toward -axis when dir = -1. Players walk up ramps.
 */
export interface Solid {
  min: Vec3;
  max: Vec3;
  tag: SurfaceTag;
  ramp?: { axis: 'x' | 'z'; dir: 1 | -1 };
  /**
   * Visual style key for the client map builder / decor (e.g. 'wall', 'floor', 'crate',
   * 'pillar', 'trim', 'roof', 'stairs', 'glass', 'hidden'). 'hidden' = invisible collision
   * (clip brush) — the decor module draws its own visuals for it.
   */
  style?: string;
  /** Optional explicit color override (hex string) — should stay within the environment palette. */
  color?: string;
  /** Bullets pass through (e.g. chain-link fence, foliage clip). Players still collide. */
  shootThrough?: boolean;
  /** Players pass through (e.g. hanging vines); bullets & sight still blocked. */
  walkThrough?: boolean;
}

export interface SpawnPoint {
  pos: Vec3;
  yaw: number;
  /** Team that may use it. TEAM_NONE (2) spawns are used for FFA (all spawns are used by FFA). */
  team: Team;
}

export interface ZoneDef {
  id: ZoneId;
  center: Vec3;
  radius: number;
  /** Vertical extent above center.y that counts as "inside". */
  height: number;
  /** i18n key for the zone's name (e.g. 'zone.gantry.A'). */
  nameKey: string;
}

export interface PickupDef {
  id: string;
  kind: 'sunspear';
  pos: Vec3;
  /** Seconds before it respawns after being taken. */
  respawn: number;
}

/** Named landmark shown on the compass bar and in orientation hints. */
export interface LandmarkDef {
  /** i18n key (e.g. 'landmark.gantry.tower'). */
  nameKey: string;
  pos: Vec3;
  icon: 'tower' | 'dome' | 'mall' | 'sun' | 'sea' | 'crane' | 'house' | 'antenna' | 'rocket';
}

/** Training range moving target spawns. */
export interface TargetDef {
  id: number;
  pos: Vec3;
  yaw: number;
  /** Movement path: oscillates between pos and pos+path (seconds per full cycle = period). */
  path?: Vec3;
  period?: number;
  /** Distance label for stats (meters). */
  distance: number;
}

/** One signature lighting mood per map. Colors are hex strings. */
export interface MapLighting {
  mood: 'sunset' | 'golden' | 'dusk';
  /** Direction TOWARD the sun (normalized). Low elevation = long golden shadows. */
  sunDir: Vec3;
  sunColor: string;
  sunIntensity: number;
  /** Sky gradient. */
  skyZenith: string;
  skyHorizon: string;
  /** Color of the sun glow / halo in the sky. */
  sunGlow: string;
  /** Hemisphere fill light. */
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  /** Atmospheric haze deepening with distance. */
  fogColor: string;
  fogDensity: number;
  /** Tone mapping exposure. */
  exposure: number;
  /** Bloom strength for emissives (0..1.5). */
  bloom: number;
  /** Stars fade in over the match (0 = none). */
  stars: number;
  /** Weather particles. */
  weather: 'none' | 'dust' | 'snow' | 'spores';
}

export interface MapAudioDef {
  /** Reverb character of the open areas. */
  reverb: 'open' | 'coastal' | 'suburb' | 'mountain' | 'indoor';
  /** Echo amount for gunshots in open maps (0..1). */
  echo: number;
  /** Ambient bed. */
  ambience: 'coast' | 'suburb' | 'wind' | 'range';
  /** Positional ambient emitters (e.g. an old radio still playing). */
  emitters: { kind: 'radio' | 'wind_chime' | 'waves' | 'machinery' | 'drip' | 'hum'; pos: Vec3; radius: number }[];
}

export interface MapDef {
  id: MapId;
  /** i18n key for the map name. */
  nameKey: string;
  /** i18n key for the one-line description. */
  descKey: string;
  /** Playable bounds (players are clamped inside; outside is backdrop). */
  bounds: AABB;
  /** Falling below this Y kills the player. */
  killY: number;
  solids: Solid[];
  spawns: SpawnPoint[];
  zones: ZoneDef[];
  pickups: PickupDef[];
  landmarks: LandmarkDef[];
  targets?: TargetDef[];
  lighting: MapLighting;
  audio: MapAudioDef;
  /** Where the Launch Control finale rocket stands (can be outside bounds as a backdrop). */
  rocket: { pos: Vec3; scale: number };
  /** Water plane height if the map has water (visual + footstep surface), else undefined. */
  waterY?: number;
  /** Optional hints for bot navigation generation: extra walkable links (e.g. jump-downs, ladders not representable). */
  navLinks?: { from: Vec3; to: Vec3 }[];
}
