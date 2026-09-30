// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — "Pastel": an abandoned 1970s suburb (Halcyon Heights) swallowed
// by glowing vines, in warm golden late-afternoon light. Close-range, vertical.
//
// Collision is deliberately lean (≤ 120 solids, see tests/shared/nav.test.ts):
// every box is a gameplay decision; all rounded / angled / fine detail is drawn
// by the client decor (src/client/world/maps/pastel.ts), which also draws every
// solid styled 'hidden' (ground, pool, cars, stairs, escalators, fountain…).
//
// TOP-DOWN PLAN (x → east, z ↓ south). Mirror-symmetric across z = 0 for the
// collision; the two spawn ends are dressed differently by the decor.
//
//   z=-54 ┌───────────────────────── BLOOM SPAWN (−Z) ───────────────────────────┐
//         │  overgrown yards    ▒ MOONBEAM DINER + STARLIGHT GAS forecourt ▒ cul-de-sac │
//   z=-40 │══════════╗   exit W   ════════╗  exit C  ╔════════   exit E   ╔═══════│ 2.8–3.2 m walls
//         │ W1'+carport         [W2' 2-st.]   [sign]   [E2' 2-st.]    car  E1'+carport│
//         │  shed   fence       balcony→W    parking   balcony→E      ┃street┃        │
//   z=-12 │    sheets ≈≈   ▓alley▓  ┏━━━━━━━━ STARLIGHT MALL ━━━━━━━━┓ ▓alley▓ wagon │
//         │ cabana ┌─POOL─┐  grand ┃gal│esc  kiosk      │gal┃ grand   ┌truck┐ corner│
//   z=  0 │   (A)  │~deep~│/ stair→┃ W │ ══ bridge ◆ ══ │ E ┃←stair   │ (C) │ house │
//         │        └──────┘        ┃   │esc  fountain   │   ┃         └─────┘       │
//   z=+12 │    sheets ≈≈   ▓alley▓  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ▓alley▓ wagon │
//         │  shed   fence       [W2 2-st.]  planter    [E2 2-st.]          car       │
//         │ W1+carport          balcony→W   parking    balcony→E    ┃street┃ E1+carport│
//   z=+40 │══════════╝   exit W   ════════╝  exit C  ╚════════   exit E   ╚═══════│
//         │  back gardens     ▒ HALCYON HEIGHTS COMMUNITY CHAPEL lot ▒      turnaround │
//   z=+54 └──────────────────────── HALCYON SPAWN (+Z) ───────────────────────────┘
//         x=-54      -45   -30   -17  -15          0          15  17   30 31   43  54
//
// LANES   West = BACKYARDS (fences to mantle, shed, carport → roof chain, laundry
//         sheets that block sight but not movement, the drained kidney pool dip).
//         Centre = STARLIGHT MALL (parking lot → two doors per end → flooded
//         atrium, fountain island, escalators → bridge → galleries).
//         East = MAIN STREET (station wagons, crashed ice-cream truck across the
//         intersection, carport → roof chain on the far side).
// ZONES   A pool (−39, 0) · B atrium fountain (0, 0) · C intersection (37, 0).
// PICKUP  Sunspear on the mall bridge, 3.2 m above the fountain.
// HEIGHTS ground 0 · mall floor −0.35 (water −0.2) · pool −1.25 · car roofs 1.3 ·
//         carports 2.55 · 1-storey roofs 2.95 · house upper floors/balconies 2.7 ·
//         house roofs 5.1 (jump-mantle from the balcony) · mall galleries 3.2 ·
//         mall parapet 8 (decor roof 8.4, skylight peak ~12).
// ROUTES  Rotations mid-map: pool ↔ west alley ↔ mall side doors ↔ atrium ↔ east
//         alley ↔ intersection; upper: grand stairs (W/E) → galleries → bridge.
//         Near spawn: W2/E2 ground floors connect yards ↔ parking ↔ street.
// ─────────────────────────────────────────────────────────────────────────────

import { MapKit, mirrorSpawnsZ, spawn, v, yawToward } from '../sim/map-kit';
import type { MapDef, SpawnPoint } from './types';

const k = new MapKit();

/** Mall gallery / bridge walking height. */
const GAL = 3.2;
/** Mall floor (sunken one step below the street so its water stays inside). */
const MALL_Y = -0.35;
/** House upper floor / balcony and roof heights. */
const UP = 2.7;
const ROOF = 5.1;

// Environment colors (ENV palette values; team colors never appear here).
const C_SAND = '#e8dcc4';
const C_PINK = '#e9c3b5';
const C_MINT = '#c9dcc1';
const C_YELLOW = '#efdca6';
const C_BLUE = '#b9cfda';
const C_BONE = '#efe6d6';
const C_TERRA = '#c99a82';
const C_CONCRETE = '#bdb5a6';

// ── Ground (drawn by decor: streets, lawns, parking lines, sidewalks) ───────
let m = k.mark();
k.box(-54, -1, 12, 54, 0, 54, 'concrete', 'hidden');
k.mirrorZ(m);
k.box(-54, -1, -12, -45, 0, 12, 'grass', 'hidden');
k.box(-33, -1, -12, -15, 0, 12, 'concrete', 'hidden');
k.box(15, -1, -12, 54, 0, 12, 'concrete', 'hidden');
m = k.mark();
k.box(-45, -1, 5, -33, 0, 12, 'tile', 'hidden'); // pool deck
k.mirrorZ(m);
// Drained kidney pool: deep end west, sloped floor up to the shallow east end.
k.box(-45, -2, -5, -38, -1.25, 5, 'tile', 'hidden');
k.ramp(-38, -1.25, -5, -33, 0, 5, 'x', 1, 'tile', 'hidden');
// Flooded mall floor.
k.box(-15, -1.5, -12, 15, MALL_Y, 12, 'tile', 'hidden');

// ── STARLIGHT MALL (x ±15, z ±12) ───────────────────────────────────────────
m = k.mark();
// South facade: two 4 m doors either side of a central pier.
k.box(-15, MALL_Y, 11.5, -8, 8, 12, 'plaster', 'hidden');
k.box(-4, MALL_Y, 11.5, 4, 8, 12, 'plaster', 'hidden');
k.box(8, MALL_Y, 11.5, 15, 8, 12, 'plaster', 'hidden');
// Bridge parapet (1 m, solid cover around the Sunspear).
k.box(-3.6, GAL, 1.45, 3.6, GAL + 1, 1.75, 'plaster', 'hidden');
k.mirrorZ(m);

m = k.mark();
// Double escalator in line with each door (blocks the through-mall sightline).
k.ramp(3.9, MALL_Y, 1.75, 8.1, GAL, 9.3, 'z', -1, 'metal', 'hidden');
k.mirrorZ(m);
k.mirrorX(m);

m = k.mark();
// Side wall: a 10 m two-storey opening around the grand stair (ground passages
// either side of the stair, gallery-level opening above).
k.box(-15, MALL_Y, 5, -14.5, 8, 12, 'plaster', 'hidden');
k.box(-15, MALL_Y, -12, -14.5, 8, -5, 'plaster', 'hidden');
// Gallery (runs the full depth).
k.box(-15, GAL - 0.3, -11.5, -10, GAL, 11.5, 'tile', 'hidden');
// Grand stair from the alley up to the gallery (its high face closes the wall).
k.ramp(-24, 0, -2, -15, GAL, 2, 'x', 1, 'concrete', 'hidden');
k.mirrorX(m);

// Bridge across the atrium (Sunspear above the fountain).
k.box(-10, GAL - 0.3, -1.75, 10, GAL, 1.75, 'tile', 'hidden');
// Dry fountain island + the 'Sunrise' sculpture screen that carries the bridge
// (every diagonal from a north door to the opposite south door crosses it).
k.box(-2.6, MALL_Y, -2.6, 2.6, 0.45, 2.6, 'tile', 'hidden');
k.box(-2.4, 0.45, -0.35, 2.4, GAL - 0.3, 0.35, 'ceramic', 'hidden');

// ── Middle band: pool garden (A), alleys, intersection (C) ─────────────────
// Pool cabana (sight blocker at the west edge).
k.box(-54, 0, -3.5, -47.5, 4.4, 3.5, 'plaster', 'house', { color: C_PINK });
m = k.mark();
// Pool pergolas: curtains of glowing vines — block sight & bullets, players walk through.
k.box(-47.5, 0.2, 7.4, -30, 4.4, 7.6, 'foliage', 'hidden', { walkThrough: true });
// Camper van parked at the curb before the intersection (jump-mantle roof).
k.box(31.2, 0, 7.5, 33.4, 2.2, 12.5, 'metal', 'hidden');
// Bus shelter (east) and loading-dock screen (west): break the alley diagonals.
k.box(22, 0, 6, 29.5, 2.6, 6.4, 'metal', 'shelter', { color: C_CONCRETE });
k.box(-29.5, 0, 6, -22, 2.6, 6.4, 'concrete', 'breeze', { color: C_SAND });
// Garage rows closing the corners between the mall and the houses: the parking
// lots feed the mall; the alleys connect the lanes at mid.
k.box(-30, 0, 12, -15, 5.0, 15.6, 'plaster', 'house', { color: C_BLUE });
k.box(15, 0, 12, 30, 5.0, 15.6, 'plaster', 'house', { color: C_YELLOW });
k.mirrorZ(m);
// Crashed ice-cream step van across the intersection.
k.box(31, 0, -1.2, 42.8, 3.2, 1.2, 'metal', 'hidden');
// Two-storey corner house (the old radio still plays on its porch).
k.box(44, 0, -6, 54, 5.5, 6, 'plaster', 'house', { color: C_YELLOW });

// ── Approach band (one half, mirrored) ──────────────────────────────────────
m = k.mark();
// W1 / E1: bungalows on the outer edges (solid) + carport; wagon (1.3) →
// carport (2.55) → flat roof (2.95) overlooking the lane.
const w1 = k.mark();
k.box(-54, 0, 15, -45, 2.95, 25, 'plaster', 'house', { color: C_MINT });
k.box(-54, 2.3, 25, -46, 2.55, 31, 'wood', 'carport', { color: C_TERRA });
k.box(-53, 0, 28, -51, 1.3, 33.5, 'metal', 'hidden');
k.mirrorX(w1);
// Backyard: tool shed (jump-mantle roof), privacy fence (1.2 m mantle).
k.box(-42, 0, 19, -39, 2.3, 22, 'wood', 'shed', { color: C_BLUE });
k.box(-45, 0, 34, -37, 1.2, 34.3, 'wood', 'hidden');
// Parking lot cover: station wagon, sedan, and the STARLIGHT pylon's brick base
// (tall cover in line with the houses' patio doors).
k.box(-10, 0, 21, -8, 1.3, 25.5, 'metal', 'hidden');
k.box(6, 0, 27, 10.5, 1.3, 29, 'metal', 'hidden');
k.box(-1.3, 0, 18.5, 1.3, 3.0, 24.5, 'plaster', 'hidden');
// Street: parked car (staggered against the far-curb wagon).
k.box(41.5, 0, 19, 43.5, 1.3, 23.5, 'metal', 'hidden');
// Vine-draped pergolas behind the two-storey houses (break the back-lot corridor).
k.box(-24, 0.2, 27, -23.8, 3.6, 40, 'foliage', 'hidden', { walkThrough: true });
k.box(23.8, 0.2, 27, 24, 3.6, 40, 'foliage', 'hidden', { walkThrough: true });
// Spawn screen walls (≥ 2.8 m: cannot be mantled). Exits west and east.
k.box(-54, 0, 40, -36, 2.8, 40.4, 'concrete', 'breeze', { color: C_SAND });
k.box(-26, 0, 40, 26, 3.2, 40.4, 'plaster', 'wall', { color: C_BONE });
k.box(36, 0, 40, 54, 2.8, 40.4, 'concrete', 'breeze', { color: C_SAND });
k.mirrorZ(m);

// W2 / E2: enterable two-storey modernist houses dividing the lanes. Long walls
// along X, patio-door slots at both ends, a floating stair in the double-height
// living room, upper floor extending out as a balcony over the outer lane, flat
// roof reachable by a jump-mantle from the balcony.
m = k.mark();
k.box(-30, 0, 16, -17, ROOF - 0.2, 16.4, 'plaster', 'hidden');
k.box(-30, 0, 26.6, -17, ROOF - 0.2, 27, 'plaster', 'hidden');
k.box(-30, 0, 16.4, -29.6, ROOF - 0.2, 20, 'plaster', 'hidden');
k.box(-30, 0, 23, -29.6, ROOF - 0.2, 26.6, 'plaster', 'hidden');
k.box(-17.4, 0, 16.4, -17, ROOF - 0.2, 20, 'plaster', 'hidden');
k.box(-17.4, 0, 23, -17, ROOF - 0.2, 26.6, 'plaster', 'hidden');
k.box(-31.6, UP - 0.3, 16.4, -22, UP, 26.6, 'wood', 'hidden');
k.ramp(-22, 0, 24.4, -17.8, UP, 26.6, 'x', -1, 'wood', 'hidden');
k.box(-30, ROOF - 0.2, 16, -17, ROOF, 27, 'concrete', 'hidden');
k.mirrorX(m);
k.mirrorZ(m);

// ── Spawns ──────────────────────────────────────────────────────────────────
// Halcyon (+Z): chapel lot and back gardens, all behind the screen walls.
const south: SpawnPoint[] = [
  spawn(-50, 0, 44, 0, 0),
  spawn(-18, 0, 45, 0, 0),
  spawn(-10, 0, 47.5, 0, 0),
  spawn(-3, 0, 50, 0, 0),
  spawn(3, 0, 50, 0, 0),
  spawn(10, 0, 47.5, 0, 0),
  spawn(18, 0, 45, 0, 0),
  spawn(50, 0, 44, 0, 0),
];
// FFA: spread over every level and lane (mirrored).
const ffaHalf: SpawnPoint[] = [
  spawn(-26, UP, 20, yawToward(-26, 20, -40, 0), 2),
  spawn(26, UP, 20, yawToward(26, 20, 40, 0), 2),
  spawn(-12.5, GAL, 7, yawToward(-12.5, 7, 0, 0), 2),
  spawn(-49, 0, 10, yawToward(-49, 10, -39, 0), 2),
  spawn(48, 0, 12, yawToward(48, 12, 37, 0), 2),
  spawn(0, 0, 25, 0, 2),
];

export const PASTEL: MapDef = {
  id: 'pastel',
  nameKey: 'map.pastel.name',
  descKey: 'map.pastel.desc',
  bounds: { min: v(-54, -20, -54), max: v(54, 40, 54) },
  killY: -10,
  solids: k.solids,
  spawns: [...south, ...mirrorSpawnsZ(south), ...ffaHalf, ...mirrorSpawnsZ(ffaHalf)],
  zones: [
    { id: 'A', center: v(-39, -0.1, 0), radius: 7.5, height: 3, nameKey: 'pastel.zone.A' },
    { id: 'B', center: v(0, MALL_Y, 0), radius: 7, height: 2.8, nameKey: 'pastel.zone.B' },
    { id: 'C', center: v(37, 0, 0), radius: 7.5, height: 3, nameKey: 'pastel.zone.C' },
  ],
  pickups: [{ id: 'sunspear-mall', kind: 'sunspear', pos: v(0, GAL, 0), respawn: 45 }],
  landmarks: [
    { nameKey: 'pastel.landmark.mall', pos: v(0, 9, 0), icon: 'mall' },
    { nameKey: 'pastel.landmark.rocket', pos: v(-330, 60, -200), icon: 'rocket' },
    { nameKey: 'pastel.landmark.mast', pos: v(78, 34, -70), icon: 'antenna' },
    { nameKey: 'pastel.landmark.sun', pos: v(-280, 98, 175), icon: 'sun' },
  ],
  lighting: {
    mood: 'golden',
    sunDir: v(-0.813, 0.2845, 0.508),
    sunColor: '#ffcf86',
    sunIntensity: 3.1,
    skyZenith: '#8fb8d6',
    skyHorizon: '#f3cbb4',
    sunGlow: '#ffd9a0',
    hemiSky: '#fbe3bd',
    hemiGround: '#b39a78',
    hemiIntensity: 0.95,
    fogColor: '#efd0b6',
    fogDensity: 0.0045,
    exposure: 1.12,
    bloom: 0.9,
    stars: 0,
    weather: 'spores',
  },
  audio: {
    reverb: 'suburb',
    echo: 0.35,
    ambience: 'suburb',
    emitters: [
      { kind: 'radio', pos: v(46.5, 1, 3.5), radius: 12 },
      { kind: 'wind_chime', pos: v(-31, UP + 1.8, 21.5), radius: 9 },
      { kind: 'wind_chime', pos: v(31, UP + 1.8, -21.5), radius: 9 },
      { kind: 'drip', pos: v(-5, 4, 6), radius: 11 },
      { kind: 'drip', pos: v(6, 4, -5), radius: 11 },
      { kind: 'hum', pos: v(0, 3, -46), radius: 10 },
    ],
  },
  rocket: { pos: v(-330, -4, -200), scale: 1.4 },
  waterY: -0.2,
};
