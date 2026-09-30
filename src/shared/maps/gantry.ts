// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — "Gantry" (BLOCKOUT): coastal rocket launch site at sunset.
//
// Layout (mirror-symmetric across z = 0; Halcyon spawns south +Z, Bloom north −Z):
//  • Middle lane: raised launch pad (y 3) with the huge launch tower on top and
//    two crossing maintenance tunnels through it (Sunspear at the crossing).
//    Ramps + stairs from both spawns; jump-mantle crates on the east/west faces.
//  • West lane (A): fuel depot — tanks, pipe runs (mantle), an elevated catwalk
//    along the cliff with ramps at both ends.
//  • East lane (C): docks — containers, a 1.2 m timber pier along the seawall
//    (mantle / ramps / short stairs), the crane base as a landmark.
//  • Hangars between the lanes; lanes interconnect across the centre line and
//    near each spawn. Sea and sun to the east (+X).
// Level designers: keep solids ≤ ~120 and validate with tests/shared/nav.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { MapKit, mirrorSpawnsZ, spawn, v, yawToward } from '../sim/map-kit';
import type { MapDef, SpawnPoint } from './types';

const k = new MapKit();

// ── Ground & perimeter ──────────────────────────────────────────────────────
k.box(-60, -1, -60, -24, 0, 60, 'sand', 'ground');
k.box(-24, -1, -60, 60, 0, 60, 'concrete', 'ground');
k.box(-62, 0, -60, -55, 12, 60, 'rock', 'cliff');
k.box(55, 0, -60, 58, 1.6, 60, 'concrete', 'seawall');
k.box(-60, 0, -58, 60, 5, -55, 'concrete', 'wall');
k.box(-60, 0, 55, 60, 5, 58, 'concrete', 'wall');

// ── Centre: launch pad, tunnels, tower ─────────────────────────────────────
// Pad corners (tunnels run between them along X and Z; 2.6 m wide, 2.5 m tall).
let m = k.mark();
k.box(-10, 0, 1.3, -1.3, 3, 10, 'concrete', 'pad');
k.box(1.3, 0, 1.3, 10, 3, 10, 'concrete', 'pad');
// Z-tunnel ceiling (south half).
k.box(-1.3, 2.5, 1.3, 1.3, 3, 10, 'metal', 'tunnel');
// Tower legs (south pair).
k.box(-5, 3, 3.6, -3.6, 38, 5, 'metal', 'pillar');
k.box(3.6, 3, 3.6, 5, 38, 5, 'metal', 'pillar');
// Pad cover (1.1 m, mantle-able).
k.box(-8, 3, 6.6, -6, 4.1, 7.2, 'metal', 'cover');
k.box(6, 3, 6.6, 8, 4.1, 7.2, 'metal', 'cover');
// Pad access: ramp (west side) and stairs (east side).
k.ramp(-8.5, 0, 10, -4.5, 3, 17.5, 'z', -1, 'concrete');
k.stairs(4.5, 10, 8.5, 13.6, 0, 3, 'z', -1, 'concrete');
// Jump-mantle crates against the pad's east and west faces.
k.box(10, 0, 2.5, 11.4, 1.2, 4.5, 'wood', 'crate');
k.box(-11.4, 0, 2.5, -10, 1.2, 4.5, 'wood', 'crate');
k.mirrorZ(m);
// X-tunnel ceiling (spans both halves) and the tower core above the pad (4 m headroom).
k.box(-10, 2.5, -1.3, 10, 3, 1.3, 'metal', 'tunnel');
k.box(-2.6, 7, -2.6, 2.6, 44, 2.6, 'metal', 'tower');

// ── Lane dividers: hangars ──────────────────────────────────────────────────
m = k.mark();
k.box(-24, 0, 9, -18, 7.5, 30, 'metal', 'hangar');
k.box(18, 0, 9, 24, 7.5, 30, 'metal', 'hangar');
k.mirrorZ(m);

// ── West lane (A): fuel depot ───────────────────────────────────────────────
k.box(-54.5, 3.4, -22, -50, 3.8, 22, 'metal', 'catwalk');
m = k.mark();
k.ramp(-54.5, 0, 22, -50.5, 3.8, 31.5, 'z', -1, 'metal');
k.box(-50.3, 3.8, 5, -50, 4.8, 22, 'metal', 'railing');
k.box(-50.5, 0, 7.8, -50, 3.4, 8.3, 'metal', 'pillar');
k.box(-50.5, 0, 17.8, -50, 3.4, 18.3, 'metal', 'pillar');
k.box(-41, 0, 14, -35, 8, 20, 'metal', 'tank');
k.box(-47, 0, 9.5, -38, 0.95, 10.5, 'metal', 'pipe');
k.box(-33, 0, 3, -31.6, 1.2, 4.4, 'wood', 'crate');
k.box(-31, 0, 22, -28.5, 2.6, 28, 'metal', 'container');
k.mirrorZ(m);
k.box(-39.5, 0, -2, -38.5, 1.1, 2, 'concrete', 'barrier');

// ── East lane (C): docks ────────────────────────────────────────────────────
k.box(44, 0, -30, 55, 1.2, 30, 'wood', 'pier');
k.stairs(42.8, -2, 44, 2, 0, 1.2, 'x', 1, 'wood');
k.box(48, 1.2, -3, 52, 7, 3, 'metal', 'crane');
k.box(38.5, 0, -2, 39.5, 1.1, 2, 'concrete', 'barrier');
m = k.mark();
k.ramp(44, 0, 30, 55, 1.2, 33, 'z', -1, 'wood');
k.box(30, 0, 12, 32.5, 2.6, 18, 'metal', 'container');
k.box(36, 0, 20, 42, 2.6, 22.5, 'metal', 'container');
k.box(38, 0, 11, 40.5, 5.2, 17, 'metal', 'container');
k.box(32.3, 0, 2.8, 33.7, 1.2, 4.2, 'wood', 'crate');
k.mirrorZ(m);

// ── Spawn areas (south = Halcyon; mirrored for Bloom) ───────────────────────
m = k.mark();
k.box(-8, 0, 52.5, 8, 4, 55, 'concrete', 'bunker');
k.box(-12, 0, 36, 12, 3.2, 37, 'concrete', 'wall');
k.box(-30, 0, 38, -24, 3.2, 39, 'concrete', 'wall');
k.box(24, 0, 38, 30, 3.2, 39, 'concrete', 'wall');
k.mirrorZ(m);

const south: SpawnPoint[] = [
  spawn(-18, 0, 47, 0, 0),
  spawn(-10, 0, 47.5, 0, 0),
  spawn(-3, 0, 48, 0, 0),
  spawn(3, 0, 48, 0, 0),
  spawn(10, 0, 47.5, 0, 0),
  spawn(18, 0, 47, 0, 0),
  spawn(-37, 0, 45, 0, 0),
  spawn(36, 0, 45, 0, 0),
];
const ffaHalf: SpawnPoint[] = [
  spawn(-45, 0, 3, yawToward(-45, 3, 0, 0), 2),
  spawn(48, 1.2, 12, yawToward(48, 12, 0, 0), 2),
  spawn(0, 0, 25, 0, 2),
  spawn(-30, 0, 15, yawToward(-30, 15, 0, 0), 2),
  spawn(14, 0, 14, yawToward(14, 14, 0, 0), 2),
];

export const GANTRY: MapDef = {
  id: 'gantry',
  nameKey: 'map.gantry.name',
  descKey: 'map.gantry.desc',
  bounds: { min: v(-55, -20, -55), max: v(55, 45, 55) },
  killY: -10,
  solids: k.solids,
  spawns: [...south, ...mirrorSpawnsZ(south), ...ffaHalf, ...mirrorSpawnsZ(ffaHalf)],
  zones: [
    { id: 'A', center: v(-36, 0, 0), radius: 6, height: 4, nameKey: 'zone.gantry.A' },
    { id: 'B', center: v(0, 3, 0), radius: 6.5, height: 4, nameKey: 'zone.gantry.B' },
    { id: 'C', center: v(36, 0, 0), radius: 6, height: 4, nameKey: 'zone.gantry.C' },
  ],
  pickups: [{ id: 'sunspear-core', kind: 'sunspear', pos: v(0, 0, 0), respawn: 45 }],
  landmarks: [
    { nameKey: 'landmark.gantry.tower', pos: v(0, 40, 0), icon: 'tower' },
    { nameKey: 'landmark.gantry.sea', pos: v(120, 0, 0), icon: 'sea' },
    { nameKey: 'landmark.gantry.crane', pos: v(50, 12, 0), icon: 'crane' },
    { nameKey: 'landmark.gantry.depot', pos: v(-38, 8, 17), icon: 'antenna' },
    { nameKey: 'landmark.gantry.sun', pos: v(300, 60, -110), icon: 'sun' },
  ],
  lighting: {
    mood: 'sunset',
    sunDir: v(0.905, 0.176, -0.387),
    sunColor: '#ffb27a',
    sunIntensity: 2.6,
    skyZenith: '#6d7aa6',
    skyHorizon: '#f4a582',
    sunGlow: '#ffcf9a',
    hemiSky: '#f2c7a5',
    hemiGround: '#6b5a55',
    hemiIntensity: 0.55,
    fogColor: '#e9a888',
    fogDensity: 0.0085,
    exposure: 1.05,
    bloom: 0.8,
    stars: 0,
    weather: 'dust',
  },
  audio: {
    reverb: 'coastal',
    echo: 0.55,
    ambience: 'coast',
    emitters: [
      { kind: 'waves', pos: v(56, 0, 25), radius: 32 },
      { kind: 'waves', pos: v(56, 0, -25), radius: 32 },
      { kind: 'machinery', pos: v(0, 6, 0), radius: 22 },
      { kind: 'radio', pos: v(-52, 3.8, 10), radius: 9 },
    ],
  },
  rocket: { pos: v(0, 7, 0), scale: 1.1 },
  waterY: -0.8,
};
