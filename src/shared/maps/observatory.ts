// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — "Observatory" (BLOCKOUT): a mountaintop observatory above the
// clouds at blue-violet dusk; wind-blown snow, stars appearing over the match.
//
// Layout (mirror-symmetric across z = 0; Halcyon south +Z, Bloom north −Z):
//  • Middle (B): the telescope building — a 4 m base with the rotating dome on
//    top (terrace ring around it, reached by four ramps and two stairways) and
//    the telescope hall tunnelling through the base (Sunspear in the hall).
//  • West lane (A): radio telescope array — dish mounts, rock outcrops
//    (mantle), raised rock shelves with ramps.
//  • East lane (C): cable-car station — a roof platform reached by stairs, the
//    cable pylon landmark, snowbank cover.
//  • Rock ridges separate the lanes; lanes interconnect at the centre line and
//    near the spawn lodges.
// ─────────────────────────────────────────────────────────────────────────────

import { MapKit, mirrorSpawnsZ, spawn, v, yawToward } from '../sim/map-kit';
import type { MapDef, SpawnPoint } from './types';

const k = new MapKit();

// ── Ground & perimeter (stone parapets above the cloud sea) ─────────────────
k.box(-60, -1, -60, 60, 0, 60, 'snow', 'ground');
k.box(-60, 0, -58, 60, 1.2, -55, 'rock', 'parapet');
k.box(-60, 0, 55, 60, 1.2, 58, 'rock', 'parapet');
k.box(-58, 0, -55, -55, 1.2, 55, 'rock', 'parapet');
k.box(55, 0, -55, 58, 1.2, 55, 'rock', 'parapet');

// ── Centre: observatory base, hall, dome, terrace access ───────────────────
let m = k.mark();
k.box(-9, 0, 1.5, 9, 4, 9, 'concrete', 'base');
// Terrace parapet on the outer edge (gap in the middle for the stairs).
k.box(-9, 4, 8.7, -2.2, 4.9, 9, 'concrete', 'parapet');
k.box(2.2, 4, 8.7, 9, 4.9, 9, 'concrete', 'parapet');
// Ramps (east & west) rising toward the base, and the south stairway.
k.ramp(9, 0, 3, 19, 4, 6.5, 'x', -1, 'concrete');
k.ramp(-19, 0, 3, -9, 4, 6.5, 'x', 1, 'concrete');
k.stairs(-2, 9, 2, 14, 0, 4, 'z', -1, 'concrete');
k.mirrorZ(m);
k.box(-9, 3.2, -1.5, 9, 4, 1.5, 'concrete', 'hall');
k.box(-6, 4, -6, 6, 13, 6, 'metal', 'dome');
// Staggered telescope piers against the hall walls (cover; the centre stays clear).
k.box(-5, 0, 0.6, -3.6, 1.1, 1.5, 'metal', 'pier');
k.box(3.6, 0, -1.5, 5, 1.1, -0.6, 'metal', 'pier');

// ── Lane dividers: rock ridges ──────────────────────────────────────────────
m = k.mark();
k.box(-24, 0, 10, -18, 8, 30, 'rock', 'ridge');
k.box(18, 0, 10, 24, 8, 30, 'rock', 'ridge');
k.box(-25, 0, 13, -24, 2.2, 18, 'rock', 'rock');
k.mirrorZ(m);

// ── West lane (A): radio telescope array ────────────────────────────────────
m = k.mark();
k.box(-44, 0, 12, -40, 5, 16, 'metal', 'dish');
k.box(-34, 0, 24, -30, 5, 28, 'metal', 'dish');
k.box(-30, 0, 6, -27, 1.2, 9, 'rock', 'rock');
k.box(-55, 0, 18, -46, 2.4, 32, 'rock', 'shelf');
k.ramp(-46, 0, 20, -40, 2.4, 24, 'x', -1, 'rock');
k.box(-38, 0, 3, -36.6, 1.2, 4.4, 'wood', 'crate');
k.mirrorZ(m);
k.box(-50, 0, -4, -46, 2.2, 4, 'rock', 'rock');
k.box(-40.5, 0, -2, -39.5, 1.1, 2, 'snow', 'snowbank');

// ── East lane (C): cable-car station ────────────────────────────────────────
k.box(42, 0, -8, 54, 3, 8, 'concrete', 'station');
k.stairs(38.8, -1.5, 42, 1.5, 0, 3, 'x', 1, 'concrete');
k.box(50, 3, -1, 52, 20, 1, 'metal', 'pylon');
k.box(37.5, 0, -3.5, 38.5, 1.1, -2, 'snow', 'snowbank');
m = k.mark();
k.box(42, 3, 1.5, 42.3, 4, 8, 'metal', 'railing');
k.box(32, 0, 3, 34, 1.2, 4.5, 'wood', 'crate');
k.box(30, 0, 14, 34, 2.6, 18, 'concrete', 'hut');
k.box(40, 0, 20, 46, 3.2, 26, 'rock', 'rock');
k.box(46, 0, 12, 49, 1.1, 13, 'metal', 'bench');
k.mirrorZ(m);

// ── Spawn lodges ────────────────────────────────────────────────────────────
m = k.mark();
k.box(-12, 0, 51, 12, 5, 55, 'wood', 'lodge');
k.box(-10, 0, 37, 10, 3, 38, 'concrete', 'wall');
k.box(-32, 0, 39, -26, 3, 40, 'rock', 'rock');
k.box(26, 0, 39, 32, 3, 40, 'rock', 'rock');
k.mirrorZ(m);

const south: SpawnPoint[] = [
  spawn(-18, 0, 46, 0, 0),
  spawn(-10, 0, 46.5, 0, 0),
  spawn(-3, 0, 47, 0, 0),
  spawn(3, 0, 47, 0, 0),
  spawn(10, 0, 46.5, 0, 0),
  spawn(18, 0, 46, 0, 0),
  spawn(-38, 0, 45, 0, 0),
  spawn(38, 0, 45, 0, 0),
];
const ffaHalf: SpawnPoint[] = [
  spawn(-50, 2.4, 25, yawToward(-50, 25, 0, 0), 2),
  spawn(48, 3, 4, yawToward(48, 4, 0, 0), 2),
  spawn(0, 0, 24, 0, 2),
  spawn(-12, 0, 16, yawToward(-12, 16, 0, 0), 2),
  spawn(28, 0, 6, yawToward(28, 6, 0, 0), 2),
];

export const OBSERVATORY: MapDef = {
  id: 'observatory',
  nameKey: 'map.observatory.name',
  descKey: 'map.observatory.desc',
  bounds: { min: v(-55, -30, -55), max: v(55, 45, 55) },
  killY: -20,
  solids: k.solids,
  spawns: [...south, ...mirrorSpawnsZ(south), ...ffaHalf, ...mirrorSpawnsZ(ffaHalf)],
  zones: [
    { id: 'A', center: v(-36, 0, 0), radius: 6, height: 4, nameKey: 'zone.observatory.A' },
    { id: 'B', center: v(0, 0, 0), radius: 7, height: 5, nameKey: 'zone.observatory.B' },
    { id: 'C', center: v(35, 0, 0), radius: 6, height: 4, nameKey: 'zone.observatory.C' },
  ],
  pickups: [{ id: 'sunspear-hall', kind: 'sunspear', pos: v(0, 0, 0), respawn: 45 }],
  landmarks: [
    { nameKey: 'landmark.observatory.dome', pos: v(0, 13, 0), icon: 'dome' },
    { nameKey: 'landmark.observatory.array', pos: v(-42, 6, 14), icon: 'antenna' },
    { nameKey: 'landmark.observatory.pylon', pos: v(51, 20, 0), icon: 'tower' },
    { nameKey: 'landmark.observatory.rocket', pos: v(-160, 10, -70), icon: 'rocket' },
    { nameKey: 'landmark.observatory.sun', pos: v(-220, 40, 280), icon: 'sun' },
  ],
  lighting: {
    mood: 'dusk',
    sunDir: v(-0.6, 0.12, 0.79),
    sunColor: '#ff9d7a',
    sunIntensity: 1.25,
    skyZenith: '#2c2f5a',
    skyHorizon: '#b58bb0',
    sunGlow: '#ffb48a',
    hemiSky: '#8c8fc4',
    hemiGround: '#4a4660',
    hemiIntensity: 0.75,
    fogColor: '#9c8fb8',
    fogDensity: 0.011,
    exposure: 1.12,
    bloom: 1.05,
    stars: 0.9,
    weather: 'snow',
  },
  audio: {
    reverb: 'mountain',
    echo: 0.7,
    ambience: 'wind',
    emitters: [
      { kind: 'wind_chime', pos: v(-32, 1, 26), radius: 9 },
      { kind: 'hum', pos: v(0, 5, 0), radius: 16 },
      { kind: 'radio', pos: v(48, 3, 5), radius: 8 },
      { kind: 'machinery', pos: v(51, 8, 0), radius: 14 },
    ],
  },
  rocket: { pos: v(-160, -20, -70), scale: 2 },
};
