// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range: a 30 × 90 m firing range in warm golden light.
//
//  • Firing line at z = 0 (a waist-high counter with walk-around gaps); the
//    player spawns just behind it facing downrange (−Z).
//  • Four target rows at 10 / 25 / 50 / 75 m, each with two static and two
//    moving humanoid targets (16 total).
//  • Movement course behind the firing line for the tutorial: a mantle ledge,
//    a low slide tunnel (1.3 m ceiling: crouch/slide only), a raised shooting
//    platform with a ramp, and a small capture zone (A).
// ─────────────────────────────────────────────────────────────────────────────

import { MapKit, spawn, v } from '../sim/map-kit';
import type { MapDef, TargetDef } from './types';

const k = new MapKit();

// Ground, side walls, back wall and the far berm.
k.box(-20, -1, -90, 20, 0, 20, 'sand', 'ground');
k.box(-17, 0, -90, -15, 5, 20, 'concrete', 'wall');
k.box(15, 0, -90, 17, 5, 20, 'concrete', 'wall');
k.box(-17, 0, 14, 17, 5, 16, 'concrete', 'wall');
k.box(-17, 0, -90, 17, 8, -84, 'dirt', 'berm');

// Firing line counter (1 m, mantle-able) with gaps at both ends.
k.box(-10, 0, -0.5, 10, 1.0, 0, 'wood', 'counter');
// Lane markers between rows (low, do not block shots at standing height).
k.box(-12, 0, -18.2, -11, 0.5, -17.8, 'concrete', 'marker');
k.box(11, 0, -18.2, 12, 0.5, -17.8, 'concrete', 'marker');

// Movement course.
k.box(-13, 0, 8, -9, 1.0, 12, 'concrete', 'ledge');
k.box(6, 1.3, 5.5, 13, 3, 8.5, 'concrete', 'tunnel');
k.box(6, 0, 5, 13, 3, 5.5, 'concrete', 'tunnel');
k.box(6, 0, 8.5, 13, 3, 9, 'concrete', 'tunnel');
k.box(-14.5, 0, -4.5, -11, 2.4, -0.8, 'concrete', 'platform');
k.ramp(-14.5, 0, -0.8, -11, 2.4, 5.2, 'z', -1, 'concrete');

function row(z: number, distance: number, xs: [number, number], moving: [number, number, number][], firstId: number): TargetDef[] {
  const out: TargetDef[] = [];
  let id = firstId;
  for (const x of xs) out.push({ id: id++, pos: v(x, 0, z), yaw: Math.PI, distance });
  for (const [x, len, period] of moving) out.push({ id: id++, pos: v(x, 0, z), yaw: Math.PI, path: v(len, 0, 0), period, distance });
  return out;
}

const targets: TargetDef[] = [
  ...row(-10, 10, [-9, 9], [[-6, 4, 3], [2, 4, 3.6]], 1),
  ...row(-25, 25, [-8, 8], [[-5, 4, 4], [1, 4, 4.6]], 5),
  ...row(-50, 50, [-7, 7], [[-4, 3, 5], [1, 3, 5.5]], 9),
  ...row(-75, 75, [-6, 6], [[-3, 3, 6], [0.5, 2.5, 6.5]], 13),
];

export const RANGE: MapDef = {
  id: 'range',
  nameKey: 'map.range.name',
  descKey: 'map.range.desc',
  bounds: { min: v(-15, -10, -84), max: v(15, 30, 14) },
  killY: -8,
  solids: k.solids,
  spawns: [spawn(0, 0, 3, 0, 2), spawn(-3, 0, 3, 0, 2), spawn(3, 0, 3, 0, 2)],
  zones: [{ id: 'A', center: v(-3, 0, 9), radius: 2.5, height: 3, nameKey: 'zone.range.A' }],
  pickups: [],
  targets,
  landmarks: [
    { nameKey: 'landmark.range.berm', pos: v(0, 8, -86), icon: 'antenna' },
    { nameKey: 'landmark.range.sun', pos: v(-200, 80, -160), icon: 'sun' },
  ],
  lighting: {
    mood: 'golden',
    sunDir: v(-0.62, 0.36, -0.7),
    sunColor: '#ffd79a',
    sunIntensity: 2.3,
    skyZenith: '#8fb4d0',
    skyHorizon: '#f3d6a6',
    sunGlow: '#ffe6b0',
    hemiSky: '#f5e3c0',
    hemiGround: '#8e877b',
    hemiIntensity: 0.7,
    fogColor: '#efd8ae',
    fogDensity: 0.006,
    exposure: 1.06,
    bloom: 0.7,
    stars: 0,
    weather: 'dust',
  },
  audio: {
    reverb: 'open',
    echo: 0.35,
    ambience: 'range',
    emitters: [{ kind: 'radio', pos: v(12, 1, 12), radius: 8 }],
  },
  rocket: { pos: v(0, -5, -220), scale: 1.5 },
};
