// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — "Pastel": an abandoned 1970s suburb (Halcyon Heights) swallowed
// by glowing vines, in warm golden late-afternoon light. Close-range, vertical.
//
// Collision is deliberately lean (exactly at the 120-solid cap of
// tests/shared/nav.test.ts — anything new must replace something):
// every box is a gameplay decision; all rounded / angled / fine detail is drawn
// by the client decor (src/client/world/maps/pastel.ts), which also draws every
// solid styled 'hidden' (ground, pool, cars, stairs, escalators, fountain…).
//
// TOP-DOWN PLAN (x → east, z ↓ south). Mirror-symmetric across z = 0 for the
// collision; the two spawn ends are dressed differently by the decor.
//
//  z=-54 ┌─────────────── BLOOM SPAWN: Moonbeam Diner + Comet Gas (beyond −54) ───────────────┐
//        │ B·back gardens          B  B  (diner lot)  B  B               cul-de-sac bulb  B│
//  z=-40 │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ exitW ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ exitE ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ 2.8–3.2 walls
//        │ W1'+carport   fence   ¦vines¦          [pylon]        ¦vines¦   car   E1'+carport│
//        │  bungalow  shed       [W2' 2-storey]   parking lot    [E2' 2-storey] ┃street┃   │
//  z=-12 │  cabana   ≈≈≈curtain≈≈≈[garage row]┏━━━ STARLIGHT MALL ━━━┓[garage row]  van     │
//        │ ▐pool▌   ┌──POOL──┐ ▒screen▒ grand┃gal esc │ esc gal┃grand ▒shelter▒     (C)  corner│
//  z=  0 │  house   │~deep~/ │  (A)    stair→┃ W  ══bridge◆══  E ┃←stair  ████ wreck ████house │
//        │          └────────┘ ▒screen▒     ┃gal esc │ esc gal┃      ▒shelter▒            │
//  z=+12 │          ≈≈≈curtain≈≈≈[garage row]┗━━━ fountain (B) ━━━┛[garage row]  van        │
//        │  bungalow  shed       [W2 2-storey]    parking lot    [E2 2-storey]  ┃street┃   │
//        │ W1+carport    fence   ¦vines¦          [pylon]        ¦vines¦   car   E1+carport │
//  z=+40 │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ exitW ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ exitE ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
//        │ H·back gardens          H  H  (chapel lot)  H  H              turnaround       H│
//  z=+54 └─────────────── HALCYON SPAWN: Community Chapel (beyond +54) ───────────────────────┘
//        x=-54     -47  -45   -33 -30 -24 -17 -15     0      15 17  24  30 31      43 44    54
//
// LANES   West = BACKYARDS: fences to mantle, tool shed, wagon → carport → roof
//         chain, vine-curtain pergolas (walk through, no sight / bullets), the
//         drained kidney pool dip (A) with a sloped shallow end.
//         Centre = STARLIGHT MALL: parking lot (wagon, sedan, the solid 12.6 m
//         STARLIGHT pylon monolith that also closes the roof-to-roof line through
//         both houses' door slots) → two
//         doors per end, each fronted by a double escalator that blocks the
//         through-mall sightline → flooded atrium, fountain island (B) with the
//         "Sunrise" screen, bridge (Sunspear) and galleries; grand stairs from
//         both alleys up to the galleries.
//         East = MAIN STREET: parked cars, camper vans (jump-mantle), bus shelter,
//         the crashed soft-serve van (C): its wreck seals the street and both
//         sidewalks (x 29.6..44), so the lane bends through the intersection and
//         no sidewalk line runs exit-to-exit. Carport chain.
//         Garage rows close the mall corners, so the parking lots only feed the
//         mall and lanes cross mid-map through the alleys, near spawn through the
//         enterable two-storey houses (patio doors both ends, stair, balcony,
//         jump-mantle roof) and the vine pergolas behind them (4.4 m, above the
//         carport-roof eye line). Waist-high picnic table in each back garden.
// SPAWNS  Behind unmantleable screen walls; exits west and east only; every
//         spawn faces its nearest exit along the painted mural wall. Verified
//         in tests/shared/map-pastel.test.ts: never visible from the enemy half.
// ZONES   A pool (−39, 0) · B atrium fountain (0, 0) · C intersection (37, 0).
// PICKUP  Sunspear on the mall bridge (0, 3.2, 0), above the fountain.
// HEIGHTS ground 0 · mall floor −0.35 (water −0.2) · pool −1.2 · car roofs 1.3 ·
//         vans 2.2 · carports 2.55 · bungalow roofs 2.95 · house upper floors /
//         balconies 2.7 · house roofs 5.1 · garages 5 · mall galleries & bridge
//         3.2 · mall walls 8 (decor roof 8.7, glass vault peak 12.3) · picnic
//         tables 0.78 · wreck 3.2 · alley screens 3.6 / 3.9 · pergolas 4.4 · pylon 12.6.
// SIGHT   Ground-level lines ≤ ~70 m, and only as slivers through two doors of
//         the mall; nothing runs spawn-exit to spawn-exit or roof to roof across
//         the map (tests/shared/map-pastel.test.ts pins the known lanes shut).
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
k.box(-45, -2, -5, -38, -1.2, 5, 'tile', 'hidden');
k.ramp(-38, -1.2, -5, -33, 0, 5, 'x', 1, 'tile', 'hidden');
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
// Bus shelter (east, with its rooftop billboard) and loading-dock screen (west):
// break the alley diagonals. 3.6 / 3.9 m so the corner carport roofs have no line
// through the side alleys and the mall doors to the far lot (was ~96 m).
k.box(22, 0, 6, 29.5, 3.9, 6.4, 'metal', 'hidden');
k.box(-29.5, 0, 6, -22, 3.6, 6.4, 'concrete', 'breeze', { color: C_SAND });
// Garage rows closing the corners between the mall and the houses: the parking
// lots feed the mall; the alleys connect the lanes at mid.
k.box(-30, 0, 12, -15, 5.0, 15.6, 'plaster', 'house', { color: C_BLUE });
k.box(15, 0, 12, 30, 5.0, 15.6, 'plaster', 'house', { color: C_YELLOW });
k.mirrorZ(m);
// Crashed ice-cream step van across the intersection: it ploughed through the
// corner-house porch, so the wreck (van + toppled roadside sign + freezer +
// porch debris) seals the whole street and both sidewalks — the east lane
// bends through the intersection here and no sidewalk sniper line runs from
// one spawn exit to the other.
k.box(29.6, 0, -1.2, 44, 3.2, 1.2, 'metal', 'hidden');
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
// Parking lot cover: station wagon, sedan, and the STARLIGHT pylon — one solid
// terrazzo monolith (tall cover in line with the houses' patio doors; it also
// closes the roof-to-roof line that runs through both houses' door slots).
k.box(-10, 0, 21, -8, 1.3, 25.5, 'metal', 'hidden');
k.box(6, 0, 27, 10.5, 1.3, 29, 'metal', 'hidden');
k.box(-0.8, 0, 18.5, 0.8, 12.6, 24.5, 'plaster', 'hidden');
// Street: parked car (staggered against the far-curb wagon).
k.box(41.5, 0, 19, 43.5, 1.3, 23.5, 'metal', 'hidden');
// Vine-draped pergolas behind the two-storey houses (break the back-lot
// corridor; 4.4 m so the carport-roof → carport-roof line is closed too).
k.box(-24, 0.2, 27, -23.8, 4.4, 40, 'foliage', 'hidden', { walkThrough: true });
k.box(23.8, 0.2, 27, 24, 4.4, 40, 'foliage', 'hidden', { walkThrough: true });
// Picnic table in each back garden (waist-high: mantle onto it, cover when
// crouched). South: lunch boxes still laid out; north: knocked on its side.
k.box(-36.6, 0, 23.05, -34.4, 0.78, 23.95, 'wood', 'hidden');
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
// Each spawn faces its nearest exit (west or east), so the first frame after a
// respawn shows the way out along the painted mural wall.
const exitFacing = (x: number, z: number): number => yawToward(x, z, x < 0 ? -31 : 31, 38);
const south: SpawnPoint[] = [
  spawn(-50, 0, 44, exitFacing(-50, 44), 0),
  spawn(-18, 0, 45, exitFacing(-18, 45), 0),
  spawn(-10, 0, 47.5, exitFacing(-10, 47.5), 0),
  spawn(-3, 0, 50, exitFacing(-3, 50), 0),
  spawn(3, 0, 50, exitFacing(3, 50), 0),
  spawn(10, 0, 47.5, exitFacing(10, 47.5), 0),
  spawn(18, 0, 45, exitFacing(18, 45), 0),
  spawn(50, 0, 44, exitFacing(50, 44), 0),
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
    { id: 'A', center: v(-39, 0, 0), radius: 7.5, height: 3, nameKey: 'pastel.zone.A' },
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
    sunColor: '#ffc987',
    sunIntensity: 3.3,
    skyZenith: '#86b4d6',
    skyHorizon: '#f5c9b3',
    sunGlow: '#ffd59c',
    hemiSky: '#d9d7dc',
    hemiGround: '#9c8470',
    hemiIntensity: 0.68,
    fogColor: '#efcdb8',
    fogDensity: 0.0034,
    exposure: 1.0,
    bloom: 0.62,
    stars: 0,
    weather: 'spores',
  },
  audio: {
    reverb: 'suburb',
    echo: 0.35,
    ambience: 'suburb',
    emitters: [
      // The transistor radio on the corner-house porch rail (decor: houses.ts).
      { kind: 'radio', pos: v(42.8, 1.1, -3.3), radius: 12 },
      { kind: 'wind_chime', pos: v(-31, UP + 1.8, 21.5), radius: 9 },
      { kind: 'wind_chime', pos: v(31, UP + 1.8, -21.5), radius: 9 },
      { kind: 'drip', pos: v(-5, 4, 6), radius: 11 },
      { kind: 'drip', pos: v(6, 4, -5), radius: 11 },
      // The diner's OPEN neon, audible from the Bloom lot.
      { kind: 'hum', pos: v(-12, 2.4, -56), radius: 11 },
    ],
  },
  rocket: { pos: v(-330, -4, -200), scale: 1.4 },
  waterY: -0.2,
};
