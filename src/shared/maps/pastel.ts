// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — "Pastel" (BLOCKOUT): an abandoned 1970s suburb overgrown with
// glowing vines, in warm golden late-afternoon light. Close-range and vertical.
//
// Layout (mirror-symmetric across z = 0; Halcyon south +Z, Bloom north −Z):
//  • Middle (B): the flooded shopping mall — sunken tiled floor (water), two
//    mezzanines reached by interior ramps, a broken skylight over the centre
//    (Sunspear on the flooded floor), doors on all four sides.
//  • West lane (A): backyards — houses (roof access via bin → carport → roof
//    mantle chain), fences (mantle), hedges (see/shoot through), a raised pool.
//  • East lane (C): the street — parked cars (mantle cover), houses, a bus shelter.
//  • Rows of houses/garages separate the lanes; lanes interconnect at the centre
//    line and near the spawn cul-de-sacs.
// ─────────────────────────────────────────────────────────────────────────────

import { MapKit, mirrorSpawnsZ, spawn, v, yawToward } from '../sim/map-kit';
import type { MapDef, SpawnPoint } from './types';

const k = new MapKit();

// ── Ground with the mall's sunken floor ─────────────────────────────────────
let m = k.mark();
k.box(-60, -1, 8.5, 60, 0, 60, 'grass', 'ground');
k.mirrorZ(m);
k.box(-60, -1, -8.5, -11.5, 0, 8.5, 'grass', 'ground');
k.box(11.5, -1, -8.5, 60, 0, 8.5, 'concrete', 'ground');
k.box(-11.5, -1.4, -8.5, 11.5, -0.4, 8.5, 'tile', 'floor');

// ── Perimeter ───────────────────────────────────────────────────────────────
k.box(-60, 0, -58, 60, 4, -55, 'plaster', 'wall');
k.box(-60, 0, 55, 60, 4, 58, 'plaster', 'wall');
k.box(-58, 0, -55, -55, 4, 55, 'plaster', 'wall');
k.box(55, 0, -55, 58, 4, 55, 'plaster', 'wall');

// ── The mall (x −12..12, z −9..9, walls 0.5 m, 6.2 m tall) ─────────────────
m = k.mark();
// South wall with two 3.5 m doors (3 m tall).
k.box(-12, -1, 8.5, -8.5, 6.2, 9, 'plaster', 'wall');
k.box(-5, -1, 8.5, 5, 6.2, 9, 'plaster', 'wall');
k.box(8.5, -1, 8.5, 12, 6.2, 9, 'plaster', 'wall');
k.box(-8.5, 3, 8.5, -5, 6.2, 9, 'plaster', 'lintel');
k.box(5, 3, 8.5, 8.5, 6.2, 9, 'plaster', 'lintel');
// West/east wall halves (door at |z| < 1.75).
k.box(-12, -1, 1.75, -11.5, 6.2, 8.5, 'plaster', 'wall');
k.box(11.5, -1, 1.75, 12, 6.2, 8.5, 'plaster', 'wall');
// Roof around the broken skylight.
k.box(-12, 6.2, 3, 12, 6.7, 9, 'concrete', 'roof');
// Mezzanine + railing + interior ramp (rises toward −x to 3.0 at x = −9).
k.box(-11.5, 2.7, 5.5, 11.5, 3.0, 8.5, 'tile', 'mezzanine');
k.box(-7.5, 3.0, 5.5, 11.5, 4.0, 5.75, 'metal', 'railing');
k.ramp(-9, -0.4, 3.5, -0.5, 3.0, 5.5, 'x', -1, 'tile');
k.mirrorZ(m);
// Lintels over the side doors, roof sides of the skylight.
k.box(-12, 3, -1.75, -11.5, 6.2, 1.75, 'plaster', 'lintel');
k.box(11.5, 3, -1.75, 12, 6.2, 1.75, 'plaster', 'lintel');
k.box(-12, 6.2, -3, -4, 6.7, 3, 'concrete', 'roof');
k.box(4, 6.2, -3, 12, 6.7, 3, 'concrete', 'roof');
// Kiosks (1.2 m, mantle cover) on the flooded floor.
k.box(-7, -0.4, -1.2, -5, 0.8, 1.2, 'plaster', 'kiosk');
k.box(5, -0.4, -1.2, 7, 0.8, 1.2, 'plaster', 'kiosk');

// ── Lane dividers: houses & garages ─────────────────────────────────────────
m = k.mark();
k.box(-24, 0, 12, -16, 5, 22, 'plaster', 'house');
k.box(16, 0, 12, 24, 5, 22, 'plaster', 'house');
k.box(-24, 0, 26, -18, 3, 32, 'wood', 'garage');
k.box(18, 0, 26, 24, 3, 32, 'wood', 'garage');
k.mirrorZ(m);

// ── West lane (A): backyards ────────────────────────────────────────────────
m = k.mark();
k.box(-46, 0, 14, -36, 4.2, 24, 'plaster', 'house');
k.box(-36, 2.2, 18, -32, 2.5, 23, 'wood', 'carport');
k.box(-32, 0, 19, -30.8, 1.2, 20.2, 'metal', 'bin');
k.box(-55, 0, 9.8, -40, 1.1, 10.2, 'wood', 'fence');
k.box(-30, 0, 9.8, -25, 1.1, 10.2, 'wood', 'fence');
k.box(-50, 0, 22.8, -46, 1.6, 24, 'foliage', 'hedge', { shootThrough: true });
k.box(-33, 0, 3, -30, 2.4, 6, 'wood', 'shed');
k.mirrorZ(m);
k.box(-45, 0, -2.5, -41, 1.0, 2.5, 'tile', 'pool');

// ── East lane (C): the street ───────────────────────────────────────────────
m = k.mark();
k.box(29, 0, 12, 30.9, 1.4, 16.4, 'metal', 'car');
k.box(40, 0, 4, 41.9, 1.4, 8.4, 'metal', 'car');
k.box(34, 0, 24, 38.4, 1.4, 25.9, 'metal', 'car');
k.box(44, 0, 10, 54, 4.5, 22, 'plaster', 'house');
k.box(44, 0, 30, 52, 3.4, 40, 'plaster', 'house');
k.mirrorZ(m);
k.box(34, 2.4, -2, 38, 2.6, 2, 'metal', 'shelter');
k.box(37.8, 0, -2, 38, 2.4, 2, 'glass', 'shelter');

// ── Spawn cul-de-sacs ───────────────────────────────────────────────────────
m = k.mark();
k.box(-20, 0, 51, -8, 4, 55, 'plaster', 'house');
k.box(8, 0, 51, 20, 4, 55, 'plaster', 'house');
k.box(-10, 0, 37, 10, 2.8, 38, 'plaster', 'wall');
k.box(-32, 0, 40, -26, 2.8, 41, 'plaster', 'wall');
k.box(26, 0, 40, 32, 2.8, 41, 'plaster', 'wall');
k.mirrorZ(m);

const south: SpawnPoint[] = [
  spawn(-18, 0, 45, 0, 0),
  spawn(-10, 0, 46, 0, 0),
  spawn(-3, 0, 47, 0, 0),
  spawn(3, 0, 47, 0, 0),
  spawn(10, 0, 46, 0, 0),
  spawn(18, 0, 45, 0, 0),
  spawn(-36, 0, 46, 0, 0),
  spawn(36, 0, 46, 0, 0),
];
const ffaHalf: SpawnPoint[] = [
  spawn(0, 3.0, 7, 0, 2),
  spawn(-28, 0, 1, yawToward(-28, 1, 0, 0), 2),
  spawn(33, 0, 8, yawToward(33, 8, 0, 0), 2),
  spawn(-8, 0, 28, yawToward(-8, 28, 0, 0), 2),
  spawn(-45, 0, 34, yawToward(-45, 34, 0, 0), 2),
];

export const PASTEL: MapDef = {
  id: 'pastel',
  nameKey: 'map.pastel.name',
  descKey: 'map.pastel.desc',
  bounds: { min: v(-55, -20, -55), max: v(55, 40, 55) },
  killY: -10,
  solids: k.solids,
  spawns: [...south, ...mirrorSpawnsZ(south), ...ffaHalf, ...mirrorSpawnsZ(ffaHalf)],
  zones: [
    { id: 'A', center: v(-37, 0, 0), radius: 6, height: 4, nameKey: 'zone.pastel.A' },
    { id: 'B', center: v(0, -0.4, 0), radius: 6, height: 3, nameKey: 'zone.pastel.B' },
    { id: 'C', center: v(35, 0, 0), radius: 6, height: 4, nameKey: 'zone.pastel.C' },
  ],
  pickups: [{ id: 'sunspear-mall', kind: 'sunspear', pos: v(0, -0.4, 0), respawn: 45 }],
  landmarks: [
    { nameKey: 'landmark.pastel.mall', pos: v(0, 7, 0), icon: 'mall' },
    { nameKey: 'landmark.pastel.backyards', pos: v(-41, 4, 19), icon: 'house' },
    { nameKey: 'landmark.pastel.street', pos: v(49, 5, 16), icon: 'house' },
    { nameKey: 'landmark.pastel.antenna', pos: v(-20, 12, -40), icon: 'antenna' },
    { nameKey: 'landmark.pastel.sun', pos: v(-260, 90, 120), icon: 'sun' },
  ],
  lighting: {
    mood: 'golden',
    sunDir: v(-0.78, 0.33, 0.53),
    sunColor: '#ffd79a',
    sunIntensity: 2.4,
    skyZenith: '#8fb4d0',
    skyHorizon: '#f6d9a8',
    sunGlow: '#ffe6b0',
    hemiSky: '#f5e3c0',
    hemiGround: '#7d8566',
    hemiIntensity: 0.65,
    fogColor: '#f0d9b0',
    fogDensity: 0.007,
    exposure: 1.08,
    bloom: 0.9,
    stars: 0,
    weather: 'spores',
  },
  audio: {
    reverb: 'suburb',
    echo: 0.3,
    ambience: 'suburb',
    emitters: [
      { kind: 'radio', pos: v(-34, 0.8, 18), radius: 10 },
      { kind: 'wind_chime', pos: v(46, 3, -16), radius: 9 },
      { kind: 'drip', pos: v(0, 5, 0), radius: 12 },
      { kind: 'hum', pos: v(35, 2.4, 0), radius: 7 },
    ],
  },
  rocket: { pos: v(40, -10, -160), scale: 1.6 },
  waterY: -0.2,
};
