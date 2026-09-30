// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — "Gantry": a coastal rocket launch site at sunset.
//
// Top-down plan (x → east / the sea, z → north). Mirror-symmetric across z = 0
// for fairness (MapKit.mirrorZ); the decor module varies props per half.
// HALCYON spawns at −Z (vehicle assembly hangar), BLOOM at +Z (tracking station).
//
//  z=+60 ┌───────────────────────────────────────────────────────────────────┐
//        │ yard   [ BLOOM TRACKING STATION  (spawns inside) ]  yard          │≈
//  z=+46 │  WD2 gap      ═══ baffle ═══        crawler      containers  pier │≈
//        │ S2◯  ┌──┐ cat   ▲gantry stair   ▲ramp  stack    ┌┐ ┌┐ alley     │≈
//  z=+19 │ tanks│WD│ walk  │               │    :         │ED2│    C  C    │≈ S
//  z=+11 │ ▬▬▬  └──┘  ║    ┌──── LAUNCH PAD (deck y 3.6) ─┐ └┘ └┘          │≈ E
//        │ skid       ║    │ W▼stair   ╔tower╗  (ROCKET)   │ ┌─────┐  crane │≈ A
//  z= 0  │ [BUNKER]◁ (C)   │ L1 (8.4)  ║core ║ ◎ mount     │ │ ED1 │  (A) ▯▯│≈
//        │ window     ║    │  ░ trench / tunnels below ░  ═╡ │shed │ portal │≈
//  z=-11 │ ▬▬▬  ┌──┐  ║    └──────────────────────────────┘ └─────┘        │≈
//        │ S1◯  │WD│ cat   ▼gantry stair   ▼ramp  stack    ┌┐ ┌┐ alley     │≈
//  z=-46 │  WD2 gap      ═══ baffle ═══        crawler      containers  pier │≈
//        │ yard   [ HALCYON ASSEMBLY HANGAR (spawns inside) ]  yard          │≈
//  z=-60 └───────────────────────────────────────────────────────────────────┘
//        x=-64   WEST: tank farm    x=-34  CENTER: pad  x=22  EAST: docks  x=64
//
// Lanes (all run along Z, ~88 m between the spawn fronts):
//  • WEST  (x −64…−34) tank farm: sphere tanks on plinths, a horizontal bullet
//    tank, low pipe runs (mantle), pump skids; a 4.8 m catwalk along the west
//    edge that runs over the half-buried mission-control bunker. Zone C sits in
//    front of the bunker's slanted firing window. Mid-range, cover-rich.
//  • CENTER (x −24…22) the raised launch pad (deck 3.6 m): the rocket on its
//    mount, the lattice tower with its service platform L1 (8.4 m, reached by
//    the long gantry stairs on the pad's west face), crawlerway ramps from both
//    forecourts, kerb parapets around the stair slots. Zone B is on the deck
//    between the tower and the rocket. BELOW: the flame trench (3 m tall) with
//    the flame deflector, a valve housing, tight 2.4 m maintenance tunnels to
//    both forecourts, stair ramps popping up on each half of the deck, the
//    trench mouth on the east face (sunset pours in), and a broken grate in the
//    deck over the junction — the Sunspear lies right under it (drop in!).
//  • EAST (x 34…64) docks: containers, the harbor crane portal over Zone A, the
//    upper quay (y 0) and the lower timber pier (y −1.2, mantle up anywhere);
//    long sightlines along the seawall.
//  Dividers: WD (fuel transfer station + compressor houses) and ED (transit
//  shed + container stacks with a CQB alley). Cross-connectors at z ≈ ±15
//  (1/3 and 2/3 of the lanes) and along each spawn front; tunnels under the pad.
//  Spawns: 8 per team inside their hangar behind a rocket stage on its cradle
//  (3 exits: main door behind a blast baffle + two corner doors); never visible
//  from the mid-map (tested).
//
// Heights: ground 0 · pier −1.2 · crawler 2.4 · deck 3.6 · catwalk / bunker
// roof 4.8 · L1 8.4 · tower 64. Walls meant to block players are ≥ 2.6 m.
// Collision is kept lean (all detail lives in src/client/world/maps/gantry.ts);
// 'hidden' solids are drawn by that decor module.
// ─────────────────────────────────────────────────────────────────────────────

import { MapKit, mirrorSpawnsZ, spawn, v, yawToward } from '../sim/map-kit';
import type { MapDef, SpawnPoint } from './types';

/** Launch pad deck height. */
export const GANTRY_DECK = 3.6;
/** Rocket position (on the mount at the pad center, next to the tower). */
export const GANTRY_ROCKET = { x: 3, z: 0 };
/** Lower pier deck height (east edge). */
export const GANTRY_PIER_Y = -1.2;
/** Tower service platform L1. */
export const GANTRY_L1 = 8.4;
/** Catwalk / bunker roof height. */
export const GANTRY_CATWALK = 4.8;
/**
 * Spawn-forecourt blast baffles (south half; mirrored north). The main baffle
 * (|x| ≤ mainHalfW, centred on z = −mainZ) overlaps the corner walls
 * (cornerX0 ≤ |x| ≤ cornerX1, centred on z = −cornerZ); all 1 m thick, h tall.
 */
/** The broken grate in the deck over the trench junction (x0..x1, |z| ≤ hz): wide enough to drop through cleanly. */
export const GANTRY_GRATE = { x0: -4.6, x1: -1.8, hz: 1.4 } as const;
export const GANTRY_BAFFLE = { mainZ: 37.5, mainHalfW: 11, cornerZ: 40.5, cornerX0: 9.5, cornerX1: 24, h: 4.5 } as const;

const D = GANTRY_DECK;
const k = new MapKit();

// ── Ground ──────────────────────────────────────────────────────────────────
k.box(-64, -1, -60, -35, 0, 60, 'sand', 'ground');
k.box(-35, -3, -60, 56, 0, 60, 'concrete', 'ground');
// The lower timber pier runs the full length of the seawall (one solid).
k.box(56, -3.2, -60, 64, GANTRY_PIER_Y, 60, 'wood', 'pier');

// ── Center: launch pad (south half, mirrored) ──────────────────────────────
let m = k.mark();
k.box(-16, 0, -17, -9.3, D, -3.5, 'concrete', 'pad');
k.box(-9.3, 2.4, -17, -6.7, D, -3.5, 'concrete', 'pad'); // tunnel roof
k.box(-6.7, 0, -17, 7, D, -3.5, 'concrete', 'pad');
k.box(7, 0, -17, 9.6, D, -12.5, 'concrete', 'pad');
k.box(9.6, 0, -17, 16, D, -3.5, 'concrete', 'pad');
// Pop-up stair from the trench to the deck (drawn as steel stairs by the decor).
k.ramp(7, 0, -12.5, 9.6, D, -3.5, 'z', -1, 'metal', 'hidden');
// Kerb parapets around the stair slot (1 m: cover, mantle-able).
k.box(6.6, D, -12.5, 7, D + 1, -3.5, 'concrete', 'parapet');
k.box(9.6, D, -12.5, 10, D + 1, -3.5, 'concrete', 'parapet');
// Crawlerway ramp from the forecourt to the deck (in line with the rocket).
k.ramp(0, 0, -26, 6, D, -17, 'z', 1, 'concrete');
// Gantry stair along the pad's west face: ground → deck level → L1 (8.4).
k.ramp(-18.6, 0, -26, -16, GANTRY_L1, -5, 'z', 1, 'metal', 'hidden');
// East-face climb: 1.2 m crate → 2.4 m cable housing → deck. The housing
// reaches 2.6 m out from the pad so that, with the deluge valve house at z = 0,
// no straight line runs down the east apron from one spawn front to the other.
k.box(16, 0, -14, 17.6, 1.2, -12, 'wood', 'hidden');
k.box(16, 0, -12, 18.6, 2.4, -8, 'metal', 'hidden');
// West apron: a nitrogen bottle rack against the gantry stair. With the fuel
// valve station at z = 0 it forms a chicane (breaks the forecourt-to-forecourt line).
k.box(-21.6, 0, -12, -18.6, 2.6, -10, 'metal', 'hidden');
// Tower legs (lattice drawn by decor) and L1 railings (see-through).
k.box(-13, D, -3.5, -12, 64, -2.5, 'metal', 'hidden');
k.box(-7, D, -3.5, -6, 64, -2.5, 'metal', 'hidden');
k.box(-16, GANTRY_L1, -5.2, -5, GANTRY_L1 + 1, -5, 'metal', 'hidden', { shootThrough: true });
// Pad valve housing in the trench (breaks the straight tunnel-to-tunnel line)
// and the deck around the broken grate.
k.box(GANTRY_GRATE.x0, 3, -3.5, GANTRY_GRATE.x1, D, -GANTRY_GRATE.hz, 'concrete', 'pad');
k.mirrorZ(m);

// Unmirrored center pieces (straddle z = 0).
k.box(-16, 0, -3.5, -12, D, 3.5, 'concrete', 'pad'); // trench west end
k.box(-12, 3, -3.5, GANTRY_GRATE.x0, D, 3.5, 'concrete', 'pad'); // deck over the trench (west of the hole)
k.box(GANTRY_GRATE.x1, 3, -3.5, 16, D, 3.5, 'concrete', 'pad'); // deck over the trench (east, to the mouth)
k.box(1, 0, -2, 5, 3, 2, 'metal', 'hidden'); // flame deflector (under the rocket)
k.box(-10.4, 0, -1.1, -6, 3, 1.1, 'metal', 'hidden'); // valve / pump housing
k.box(-10.5, D, -1, -8.5, 64, 1, 'metal', 'hidden'); // tower elevator core
k.box(-18.6, GANTRY_L1 - 0.4, -5, -5, GANTRY_L1, 5, 'metal', 'hidden'); // L1 service platform
k.box(-5.2, GANTRY_L1, -5, -5, GANTRY_L1 + 1, 5, 'metal', 'hidden', { shootThrough: true }); // L1 rail (rocket side)
// Outer railing of both gantry stairs + L1's west rail in one see-through
// solid (the drawn railing is solid to walk into); it also closes the dead-end
// pocket under L1 (drawn as a riveted service wall).
k.box(-18.8, 0, -21, -18.6, GANTRY_L1 + 1, 21, 'metal', 'hidden', { shootThrough: true });
// Launch mount + the fin skirt (y to 18.2): nobody stands on the mount among
// the fins (a sprint-jump from L1 used to land there). Then the rocket body.
k.box(GANTRY_ROCKET.x - 3.6, D, -3.6, GANTRY_ROCKET.x + 3.6, D + 14.6, 3.6, 'concrete', 'hidden');
k.box(GANTRY_ROCKET.x - 2.6, D + 14.6, -2.6, GANTRY_ROCKET.x + 2.6, 52, 2.6, 'ceramic', 'hidden');
// Apron chicane pieces at z = 0 (see the bottle rack / cable housing above):
// the fuel-line valve station (west) and the deluge water valve house (east).
k.box(-24, 0, -1.5, -21, 3.2, 1.5, 'concrete', 'hidden');
k.box(18.4, 0, -1.5, 22, 3.2, 1.5, 'concrete', 'hidden');

// ── Forecourts & spawn hangars (south, mirrored) ───────────────────────────
m = k.mark();
k.box(-18.5, 0, -60, -18, 12, -46, 'metal', 'hangar');
k.box(18, 0, -60, 18.5, 12, -46, 'metal', 'hangar');
k.box(-14.5, 0, -46.5, -6, 12, -46, 'metal', 'hangar'); // corner doors x ±[14.5, 18]
k.box(6, 0, -46.5, 14.5, 12, -46, 'metal', 'hangar');
k.box(-6, 6, -46.5, 6, 12, -46, 'metal', 'hangar'); // door lintel
k.box(-14.5, 0, -53.5, 14.5, 4.5, -48.5, 'metal', 'hidden'); // rocket stage on its cradle / fallen dish (hides the spawns)
// Blast baffles, staggered: the main baffle stands proud of the two corner
// walls and overlaps them, so every way out of the spawn forecourt is a 2 m
// dog-leg (plus both outer ends) and no straight line from the mid-map, the
// tower platform or the docks reaches any of the three hangar doors.
const B = GANTRY_BAFFLE;
k.box(-B.mainHalfW, 0, -B.mainZ - 0.5, B.mainHalfW, B.h, -B.mainZ + 0.5, 'concrete', 'wall');
k.box(-B.cornerX1, 0, -B.cornerZ - 0.5, -B.cornerX0, B.h, -B.cornerZ + 0.5, 'concrete', 'wall');
k.box(B.cornerX0, 0, -B.cornerZ - 0.5, B.cornerX1, B.h, -B.cornerZ + 0.5, 'concrete', 'wall');
k.box(6, 0, -35, 16, 2.4, -28, 'metal', 'hidden'); // derelict crawler / tracked antenna trailer
k.box(-6, 0, -31, -3.6, 1.2, -29.2, 'wood', 'hidden'); // cable drums
k.box(-30, 0, -53, -22, 3, -50.6, 'metal', 'hidden'); // fuel tanker truck

// ── West lane: tank farm ────────────────────────────────────────────────────
k.box(-58.5, 0, -39.5, -47.5, 15.5, -28.5, 'metal', 'hidden'); // sphere tank on its plinth
k.box(-50, 0, -20, -39, 3.6, -16.4, 'metal', 'hidden'); // horizontal bullet tank
k.box(-37.5, 0, -30, -36, 1, -12, 'metal', 'hidden'); // low pipe run
k.box(-45, 0, -9.5, -42, 1.2, -7.5, 'metal', 'hidden'); // pump skid
k.ramp(-64, 0, -38, -61, GANTRY_CATWALK, -26, 'z', 1, 'metal', 'hidden'); // catwalk stair (the walkway itself is one solid, below)
k.box(-64, 0, -6, -56.4, 3.2, -5.6, 'concrete', 'hidden'); // bunker side wall (door at the east corner)
// West divider: compressor house.
k.box(-34, 0, -33, -24, 5.5, -19, 'concrete', 'wall');

// ── East lane: docks ────────────────────────────────────────────────────────
k.box(44.5, 0, -5.5, 45.5, 16, -4.5, 'metal', 'hidden'); // crane portal legs
k.box(60, GANTRY_PIER_Y, -5.5, 61, 16, -4.5, 'metal', 'hidden');
k.box(36, 0, -40, 38.4, 2.6, -34, 'metal', 'container');
k.box(45, 0, -31, 51, 5.2, -28.6, 'metal', 'container');
k.box(38, 0, -21, 40.4, 2.6, -15, 'metal', 'container');
k.box(48, 0, -16, 54, 2.6, -13.6, 'metal', 'container');
k.box(60, GANTRY_PIER_Y, -15, 62, 0, -13, 'wood', 'hidden'); // net crates on the pier
k.box(26, 0, -53, 32, 2.6, -50.6, 'metal', 'container');
k.box(40, 0, -56, 46, 5.2, -53.6, 'metal', 'container');
// East divider: container stacks with a CQB alley between them. The outer one
// sits far enough south to cut the pier's diagonal into the spawn forecourt.
k.box(22.5, 0, -30, 25.1, 5.2, -18, 'metal', 'container');
k.box(28.5, 0, -34.2, 30.9, 2.6, -22, 'metal', 'container');
k.mirrorZ(m);

// Unmirrored lane pieces (straddle z = 0).
k.box(-34, 0, -11, -24, 7, 11, 'concrete', 'wall'); // fuel transfer station (west divider)
k.box(22, 0, -10, 32, 7, 10, 'metal', 'hangar'); // transit shed (east divider)
k.box(-64, 3.2, -6, -54, GANTRY_CATWALK, 6, 'concrete', 'hidden'); // bunker roof (= catwalk level)
k.box(-64, GANTRY_CATWALK - 0.4, -26, -61, GANTRY_CATWALK, 26, 'metal', 'hidden'); // west catwalk (runs over the bunker roof)
k.box(-54.6, 0, -6, -54, 1.1, 6, 'concrete', 'hidden'); // bunker window sill
k.box(-54.6, 2.2, -6, -54, 3.2, 6, 'concrete', 'hidden'); // bunker window lintel
k.box(-60.2, 0, -3.6, -59, 0.95, 3.6, 'metal', 'hidden'); // mission control console row
k.box(-44, 0, -1, -42.4, 1.3, 1, 'metal', 'hidden'); // valve tree (Zone C cover)
k.box(47, 0, -1, 53, 1.1, 1, 'metal', 'hidden'); // container spreader (Zone A cover)

// Bloom's half reads as an overgrown tracking station: tint its buildings.
// Containers get a curated faded palette (mirrored copies differ, so the two
// halves never read as copies).
const CONTAINER_COLORS = ['#a3ad8f', '#9fb4be', '#d9c7a7', '#b9a5a0', '#efe6d6', '#8e9aa0', '#7d8566'];
let ci = 0;
for (const s of k.solids) {
  if (s.style === 'hangar' && s.min.z > 40) s.color = '#b9bfa6';
  if (s.style === 'container') s.color = CONTAINER_COLORS[(ci++ * 3) % CONTAINER_COLORS.length];
}

// ── Spawns ──────────────────────────────────────────────────────────────────
// Everyone faces the nearer way out around the rocket stage (toward that
// side's corner door), never the stage's flank a few meters away.
const halcyon: SpawnPoint[] = [
  [-11, -57.6],
  [-7.9, -58.5],
  [-4.7, -57.3],
  [-1.6, -58.4],
  [1.6, -57.5],
  [4.7, -58.5],
  [7.9, -57.4],
  [11, -58.3],
].map(([x, z]) => spawn(x, 0, z, yawToward(x, z, Math.sign(x) * 16.5, -52.5), 0));

const ffaHalf: SpawnPoint[] = [
  spawn(-58, 0, -20, yawToward(-58, -20, -45, 0), 2),
  spawn(60, GANTRY_PIER_Y, -24, yawToward(60, -24, 52, 0), 2),
  spawn(12.5, 0, -1.8, yawToward(12.5, -1.8, 0, 0), 2),
  spawn(-21.5, 0, -16, yawToward(-21.5, -16, -21.5, -40), 2),
  spawn(36, 0, -46, yawToward(36, -46, 40, 0), 2),
];

export const GANTRY: MapDef = {
  id: 'gantry',
  nameKey: 'map.gantry.name',
  descKey: 'map.gantry.desc',
  bounds: { min: v(-64, -20, -60), max: v(64, 70, 60) },
  killY: -10,
  solids: k.solids,
  spawns: [...halcyon, ...mirrorSpawnsZ(halcyon), ...ffaHalf, ...mirrorSpawnsZ(ffaHalf)],
  zones: [
    { id: 'A', center: v(51, 0, 0), radius: 7, height: 4, nameKey: 'gantry.zone.A' },
    { id: 'B', center: v(-4, D, 0), radius: 6.5, height: 3.6, nameKey: 'gantry.zone.B' },
    { id: 'C', center: v(-45, 0, 0), radius: 7, height: 4, nameKey: 'gantry.zone.C' },
  ],
  pickups: [{ id: 'sunspear-trench', kind: 'sunspear', pos: v(-3.2, 0, 0), respawn: 45 }],
  landmarks: [
    { nameKey: 'gantry.landmark.tower', pos: v(-9.5, 60, 0), icon: 'tower' },
    { nameKey: 'gantry.landmark.sea', pos: v(160, 0, 0), icon: 'sea' },
    { nameKey: 'gantry.landmark.crane', pos: v(53, 30, 0), icon: 'crane' },
    { nameKey: 'gantry.landmark.tanks', pos: v(-53, 10, 0), icon: 'dome' },
    { nameKey: 'gantry.landmark.sun', pos: v(400, 48, -100), icon: 'sun' },
  ],
  lighting: {
    mood: 'sunset',
    sunDir: v(0.9524, 0.1905, -0.2381),
    sunColor: '#ffbf92',
    sunIntensity: 3.1,
    skyZenith: '#7b9fc4',
    skyHorizon: '#f7ad84',
    sunGlow: '#ffd09a',
    hemiSky: '#b9bcd4',
    hemiGround: '#6a5558',
    hemiIntensity: 0.62,
    fogColor: '#e9b4a0',
    fogDensity: 0.0036,
    exposure: 1.0,
    bloom: 0.7,
    stars: 0,
    weather: 'dust',
  },
  audio: {
    reverb: 'coastal',
    echo: 0.7,
    ambience: 'coast',
    emitters: [
      { kind: 'waves', pos: v(64, -2, -34), radius: 30 },
      { kind: 'waves', pos: v(64, -2, 0), radius: 30 },
      { kind: 'waves', pos: v(64, -2, 34), radius: 30 },
      { kind: 'machinery', pos: v(-8, 1.2, -10), radius: 12 },
      { kind: 'machinery', pos: v(-8, 1.2, 10), radius: 12 },
      { kind: 'machinery', pos: v(0, 1.5, 0), radius: 14 },
      { kind: 'radio', pos: v(-63.4, 1.5, 3.4), radius: 10 },
    ],
  },
  rocket: { pos: v(GANTRY_ROCKET.x, D, GANTRY_ROCKET.z), scale: 1 },
  waterY: -3,
};
