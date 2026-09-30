// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range: the Halcyon Proving Ground (~39 × 116 m).
//
// A sun-bleached 1970s weapons proving ground in warm golden-hour light.
// Downrange is −Z. Layout (x across, z along the range):
//
//   z +12  back wall ─────────────────────────────────────────────────────
//          ARMORY corner (west): weapon rack (Interact = swap primary),
//          Sunspear pedestal, RESET console, TARGET-SPEED console
//   z 0    FIRING LINE: ceramic-canopy pavilion + waist-high counter
//          (x −17…1). Player spawns just behind it facing downrange.
//   lanes  target rows at 10 / 25 / 50 / 75 / 100 m (x −17…1): static,
//          strafing and pop-up ceramic silhouettes.
//   east   MOVEMENT COURSE (x 7…19.4), used by the 60-second tutorial:
//          course entry → sprint strip → causeway with a jump gap → mantle
//          wall → slide beam → ramp to an elevated perch (3 m) → capture pad
//          below it, a close target trio in a sandbag grenade pit and one
//          50 m target at the far end. x 1…6.4 stays open as a return path.
//   z −104 far berm.
//
// Everything the tutorial needs to know about the course is exported as
// RANGE_COURSE (shared by the client tutorial, the decor and the tests).
// Collision budget: ~40 solids (the art lives in the client decor module).
// ─────────────────────────────────────────────────────────────────────────────

import { MapKit, spawn, v } from '../sim/map-kit';
import type { Vec3 } from '../types';
import type { MapDef, TargetDef } from './types';

const k = new MapKit();

// ── Ground, perimeter, far berm ─────────────────────────────────────────────
// Sand everywhere except the concrete apron under the firing-line pavilion
// (non-overlapping slabs so footsteps/impacts read the right surface).
k.box(-22, -1, -110, 22, 0, -1.2, 'sand', 'ground');
k.box(4.2, -1, -1.2, 22, 0, 9.5, 'sand', 'ground');
k.box(-22, -1, 9.5, 22, 0, 16, 'sand', 'ground');
k.box(-22, -1, -1.2, 4.2, 0, 9.5, 'concrete', 'pad');
k.box(-20, 0, -104, -19.4, 3, 12.6, 'concrete', 'wall'); // west perimeter
k.box(19.4, 0, -104, 20, 3, 12.6, 'concrete', 'wall'); // east perimeter
k.box(-20, 0, 12, 20, 1.5, 12.6, 'concrete', 'wall'); // back wall (low: the evening sun streams in under the canopy)
// Bullet berm: an earth slope rising from the 100 m row to a 7 m crest.
k.ramp(-20, 0, -106.5, 20, 7, -101.2, 'z', -1, 'dirt', 'berm');
k.box(-20, 0, -110, 20, 7, -106.5, 'dirt', 'berm');

// ── Firing line pavilion ────────────────────────────────────────────────────
k.box(-17, 0, -0.6, 1, 1.02, 0, 'wood', 'counter'); // shooting counter (walk around both ends)
// Canopy columns (slim; the ceramic shell roof is decor only).
for (const x of [-17.6, -11.2, -4.8, 1.6]) k.box(x - 0.18, 0, 8.9, x + 0.18, 3.6, 9.26, 'concrete', 'pillar');
for (const x of [-17.6, 1.6]) k.box(x - 0.18, 0, -1.0, x + 0.18, 3.6, -0.64, 'concrete', 'pillar');
// Armory corner: weapon rack, reset console, target-speed console.
k.box(-18.8, 0, 7.4, -14.4, 1.35, 8.0, 'metal', 'hidden');
k.box(-12.9, 0, 7.4, -11.7, 1.1, 8.0, 'metal', 'hidden');
k.box(-10.4, 0, 7.4, -9.2, 1.1, 8.0, 'metal', 'hidden');
// Ammo crates stacked at the pavilion's east end.
k.box(2.4, 0, 6.3, 4.0, 1.0, 8.3, 'wood', 'hidden');

// ── Distance markers along the lanes (low posts; the boards are decor) ──────
for (const z of [-10, -25, -50, -75, -100]) {
  k.box(-18.9, 0, z - 0.2, -18.5, 1.2, z + 0.2, 'concrete', 'marker');
  k.box(1.9, 0, z - 0.2, 2.3, 1.2, z + 0.2, 'concrete', 'marker');
}

// ── Movement course (east) ──────────────────────────────────────────────────
// Channel wall (too tall to mantle even from a jump) keeps the drills honest.
k.box(6.4, 0, -41, 7, 2.6, -13, 'concrete', 'wall');
// Causeway: ramp up, platform, jump gap, platform, drop.
k.ramp(7, 0, -17, 19.4, 1.0, -13, 'z', -1, 'concrete');
k.box(7, 0, -20.5, 19.4, 1.0, -17, 'concrete', 'platform');
k.box(7, 0, -26, 19.4, 1.0, -23, 'concrete', 'platform');
// Mantle wall (1.2 m).
k.box(7, 0, -30.8, 19.4, 1.2, -30, 'concrete', 'barrier');
// Slide beam: 1.25 m clearance (crouch height 1.2) for 2.5 m, 5 m run-up after the wall.
k.box(7, 1.25, -38.5, 19.4, 2.6, -36, 'concrete', 'beam');
// Ramp to the perch and the perch itself (3 m).
k.ramp(9, 0, -45.5, 15, 3.0, -40, 'z', -1, 'concrete');
k.box(8, 0, -50.5, 16, 3.0, -45.5, 'concrete', 'platform');
// Grenade pit: sandbag berm behind the close trio, low wings at the sides.
k.box(8.5, 0, -63, 15.5, 0.8, -62, 'fabric', 'hidden'); // sandbags (drawn by the decor)
k.box(8.5, 0, -62, 9.3, 0.55, -58.4, 'fabric', 'hidden');
k.box(14.7, 0, -62, 15.5, 0.55, -58.4, 'fabric', 'hidden');

// ── Targets ─────────────────────────────────────────────────────────────────

const Y180 = Math.PI; // targets face the firing line (+Z)
let nextId = 1;
function target(x: number, z: number, distance: number, extra: Partial<TargetDef> = {}): TargetDef {
  return { id: nextId++, pos: v(x, 0, z), yaw: Y180, distance, ...extra };
}
const strafe = (len: number, period: number): Partial<TargetDef> => ({ path: v(len, 0, 0), period });
const popup = (up: number, down: number, offset = 0): Partial<TargetDef> => ({ popup: { up, down, offset } });

// Lane rows (static first in each row: tests and stats rely on a stable order).
const lanes: TargetDef[] = [
  target(-13, -10, 10),
  target(-3, -10, 10),
  target(-10, -10, 10, strafe(4, 3.2)),
  target(-11, -25, 25),
  target(-7, -25, 25, strafe(5, 4)),
  target(-15.5, -25, 25, popup(2.2, 1.6)),
  target(-8, -50, 50),
  target(-15, -50, 50, strafe(6, 5)),
  target(-2, -50, 50, popup(2.6, 2, 1.2)),
  target(-5, -75, 75),
  target(-14, -75, 75, strafe(6, 6)),
  target(-9, -100, 100),
  target(-3, -100, 100, popup(3.4, 2.4, 0.6)),
];
// Tutorial trio (close, grenade pit) and the long 50 m target, seen from the perch.
const trio: TargetDef[] = [target(10.6, -60, 10), target(12, -60.5, 10), target(13.4, -60, 10)];
const long = target(12, -99, 50);
const targets: TargetDef[] = [...lanes, ...trio, long];

// ── Course description for the tutorial / decor / tests ─────────────────────

/** An axis-aligned trigger region on the XZ plane (optionally above a floor height). */
export interface CourseRegion {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Feet must be at or above this height (default: any). */
  minY?: number;
}

export interface RangeCourse {
  spawn: Vec3;
  spawnYaw: number;
  /** Two "look" beacons (eye-level points to put the crosshair on). */
  lookBeacons: [Vec3, Vec3];
  /** Course entry marker (move step). */
  entry: Vec3;
  entryRadius: number;
  /** Reaching this region completes each movement drill (tolerant: position, not technique). */
  sprintEnd: CourseRegion;
  jumpEnd: CourseRegion;
  mantleEnd: CourseRegion;
  slideEnd: CourseRegion;
  /** Gap floor (falling in here is recoverable by mantling onto the far platform). */
  gap: CourseRegion;
  /** Where the beacons of each drill hover. */
  sprintBeacon: Vec3;
  jumpBeacon: Vec3;
  mantleBeacon: Vec3;
  slideBeacon: Vec3;
  perch: Vec3;
  /** Close target trio ids (shoot + grenade steps) and their centre. */
  trio: number[];
  trioCenter: Vec3;
  /** Long (50 m) target id. */
  long: number;
  /** Capture pad zone id + centre. */
  pad: Vec3;
  padZone: 'A';
  /** Armory: rack slot centres (index = PRIMARY_WEAPON_IDS index), stations and pedestal. */
  rackSlots: Vec3[];
  rackFacing: number;
  resetStation: Vec3;
  speedStation: Vec3;
  pedestal: Vec3;
  /** Interaction radius around a station. */
  stationRadius: number;
  /** Target rows (distance → z of the row). */
  rows: { distance: number; z: number }[];
}

export const RANGE_COURSE: RangeCourse = {
  spawn: v(-4, 0, 3),
  spawnYaw: 0,
  lookBeacons: [v(-16, 3.2, -14), v(12, 3.4, -7)],
  entry: v(11, 0, 1),
  entryRadius: 2.2,
  sprintEnd: { minX: 6.4, maxX: 19.4, minZ: -17, maxZ: -12.5 },
  jumpEnd: { minX: 7, maxX: 19.4, minZ: -26.5, maxZ: -23.2, minY: 0.6 },
  mantleEnd: { minX: 7, maxX: 19.4, minZ: -36, maxZ: -30.8 },
  slideEnd: { minX: 7, maxX: 19.4, minZ: -42, maxZ: -38.5 },
  gap: { minX: 7, maxX: 19.4, minZ: -23, maxZ: -20.5 },
  sprintBeacon: v(12, 1.2, -13),
  jumpBeacon: v(12, 2.1, -24.5),
  mantleBeacon: v(12, 2.3, -32),
  slideBeacon: v(12, 0.9, -37.2),
  perch: v(12, 3.0, -48),
  trio: trio.map((t) => t.id),
  trioCenter: v(12, 0, -60.2),
  long: long.id,
  pad: v(12, 0, -54.6),
  padZone: 'A',
  rackSlots: [v(-18.1, 0, 6.6), v(-17.0, 0, 6.6), v(-15.9, 0, 6.6), v(-14.8, 0, 6.6)],
  rackFacing: 0,
  resetStation: v(-12.3, 0, 6.6),
  speedStation: v(-9.8, 0, 6.6),
  pedestal: v(-7, 0, 8.2),
  stationRadius: 1.5,
  rows: [
    { distance: 10, z: -10 },
    { distance: 25, z: -25 },
    { distance: 50, z: -50 },
    { distance: 75, z: -75 },
    { distance: 100, z: -100 },
  ],
};

export function inRegion(r: CourseRegion, p: Vec3): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ && (r.minY === undefined || p.y >= r.minY);
}

export const RANGE: MapDef = {
  id: 'range',
  nameKey: 'map.range.name',
  descKey: 'map.range.desc',
  bounds: { min: v(-19.4, -10, -104), max: v(19.4, 30, 12) },
  killY: -8,
  solids: k.solids,
  spawns: [spawn(-4, 0, 3, 0, 2), spawn(-7.5, 0, 3, 0, 2), spawn(-1, 0, 3.6, 0, 2)],
  zones: [{ id: 'A', center: RANGE_COURSE.pad, radius: 2.2, height: 3, nameKey: 'zone.range.A' }],
  pickups: [{ id: 'range-sunspear', kind: 'sunspear', pos: RANGE_COURSE.pedestal, respawn: 8 }],
  targets,
  landmarks: [
    { nameKey: 'landmark.range.berm', pos: v(0, 7, -107), icon: 'antenna' },
    { nameKey: 'range.landmark.tower', pos: v(-34, 14, -34), icon: 'tower' },
    { nameKey: 'range.landmark.course', pos: RANGE_COURSE.perch, icon: 'crane' },
    { nameKey: 'landmark.range.sun', pos: v(-200, 80, -160), icon: 'sun' },
  ],
  lighting: {
    mood: 'golden',
    // Low evening sun behind-left of the firing line: it streams in under the canopy
    // and throws long target shadows downrange.
    sunDir: v(-0.5, 0.3, 0.81),
    sunColor: '#ffd08a',
    sunIntensity: 2.45,
    skyZenith: '#86aecb',
    skyHorizon: '#f5d3a0',
    sunGlow: '#ffe1a8',
    hemiSky: '#f6e2bd',
    hemiGround: '#a58f72',
    hemiIntensity: 0.8,
    fogColor: '#f0d6a8',
    fogDensity: 0.0052,
    exposure: 1.05,
    bloom: 0.72,
    stars: 0,
    weather: 'dust',
  },
  audio: {
    reverb: 'open',
    echo: 0.42,
    ambience: 'range',
    emitters: [
      { kind: 'radio', pos: v(-15.1, 1.6, 7.7), radius: 9 },
      { kind: 'wind_chime', pos: v(3.4, 3.1, 8.6), radius: 7 },
      { kind: 'hum', pos: v(-11, 1, 7.8), radius: 4 },
    ],
  },
  rocket: { pos: v(40, -5, -250), scale: 1.4 },
};
