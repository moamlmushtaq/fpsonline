// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — "Observatory": a mountaintop observatory above the clouds at
// blue-violet dusk. Wind-blown snow, the first stars appearing over the match,
// the telescope dome slowly turning in the middle of the summit.
//
// Top-down plan (x → east / the last light, z → south). Mirror-symmetric across
// z = 0 (MapKit.mirrorZ) for fairness; the decor module varies every prop per
// half. HALCYON spawns at +Z (upper tram terminal), BLOOM at −Z (winter
// quarters + generator hut). ≈ 114 × 120 m, all edges are sheer cliffs down
// into the cloud sea (the play space is clamped to the bounds; parapets and
// rocks along the rim, the drop is backdrop).
//
//  z=-60 ┌────────────────────────────────────────────────────────────────────┐
//        │      [ BLOOM: WINTER QUARTERS + GENERATOR HUT (beyond the rim) ]   │
//  z=-46 │▬▬baffle▬           ▬▬baffle▬▬                         ▬baffle▬▬│
//  z=-42 │WG████████████████████ CG ███████████████████████████████████ EG│
//  z=-38 │ ▲ramp                 ▬porch▬                   ▓tarp cabin▓  │
//        │ ║     rock◆                              ◆reel                   │
//  z=-30 │ ║path  ▓▓boulder  crates▪  ▪sled▪  ▪crates   shed▓▓▓   ramp▲     │
//        │ ║     ░       ▓▓rib     snowcat▪        ▓▓boiler  │            │
//  z=-13 │ ║hut  ░under-                                      ├─DORM─┐ ▲ramp│
//        │ ┌PLATEAU┐ ridge  ┌──────┐  ┌──── DOME ────┐        │bunks │┌DECK┐│
//        │ │◎dish ▲│ yard  │ HUT  │══│ ▒gallery ring▒ │═arcade═│radio ▣│ C  ││→ stuck
//  z=0   │ │ (A)  ▲│ ramps │spect.│W │▒ ◉ telescope B▒│E       │common││wheel│  cabin
//        │ │◎dish ▲│       └──────┘══│ ▒ (Sunspear on podium) ▒ │  xfmr││ ▣  ││  + pylon
//  z=+13 │ └───────┘                  └────────────────┘        │bunks │└────┘│
//        │ ║     ░       ▓▓rib     snowcat▪        ▓▓generator│            │
//  z=+30 │ ║path  ▓▓boulder  crates▪  ▪sled▪  ▪crates   shed▓▓▓            │
//        │ ║     rock◆                              ◆reel                   │
//  z=+38 │ ▼ramp                 ▬porch▬                   ▓tarp cabin▓  │
//  z=+42 │WG████████████████████ CG ███████████████████████████████████ EG│
//  z=+46 │▬▬baffle▬           ▬▬baffle▬▬                         ▬baffle▬▬│
//        │      [ HALCYON: UPPER TRAM TERMINAL (beyond the rim) ]   cables→S  │
//  z=+60 └────────────────────────────────────────────────────────────────────┘
//        x=-57  WEST: signal array   x=-24  CENTER: dome      x=24  EAST: pylon  x=57
//
// Lanes (all run along Z, ~84 m between the spawn walls):
//  • WEST — Signal Array. A rocky ridge along the west cliff: a narrow 8 m path
//    (y 3) from each spawn ramp to the array PLATEAU (y 3, 17 × 26 m) with two
//    big radio dishes on pedestals, receiver cabinets and cable reels (Zone A).
//    Long sightlines broken by the dish pedestals and a signal hut on each path.
//    Below the ridge: the under-ridge yard (y 0) with boulders and the
//    spectrograph hut; ramps climb onto the plateau at its inner corners.
//  • CENTER — the Observatory. A 24 m brutalist base (walls 7.5 m) carrying the
//    rotating dome (decor; ~22 m tall, visible from everywhere). Inside, the
//    TELESCOPE HALL (Zone B): a raised gallery ring at 3.6 m reached by four
//    stairs, and in the middle the observing podium (same height — the inner
//    catwalk ring around the telescope's fork) joined to the gallery by two
//    bridges: vertical fights on three levels, four doors. The Sunspear waits on
//    the podium beside the telescope (solid below, equidistant for both teams).
//    Covered glazed arcades (parapets 1.1 m, mantle over) run east to the
//    dormitory and west to the spectrograph hut. Courtyards N & S: snowcat / fuel sled,
//    snow-covered crate stacks, an equipment sled blocking the door axis.
//  • EAST — Cable Pylon Station. The observers' DORMITORY (enclosed, 10 × 30 m,
//    common room with the radio + bunk wings, 5 doors) and the station DECK
//    (y 2.6, Zone C) with the bullwheel house, control booths and the pylon
//    anchor on the east rim; a freight cabin hangs stuck off the pylon over the
//    void (decor). Ramps N & S, a mantle crate from the dorm alley.
//  Dividers: rock ribs (6.2 m) between the under-ridge yard and the courtyards,
//  the generator / boiler house + maintenance shed between the courtyards and
//  the east lane; a transformer cabinet breaks the dorm alley's long sightline.
//  Cross-connectors: the arcades through the dome (z 0), the forecourts along
//  each spawn wall, the gaps at z ≈ ±28.
//  Spawns: 8 per team in a walled yard (6 m wind walls) in front of their
//  building (just outside the bounds, cantilevered over the cliff), 3 gates
//  4 m wide, each with a blast baffle behind it. The W gate opens at the foot
//  of the ridge ramp (the crest hides it from the array), the centre gate has a
//  wind-break porch (exits split left / right), the E gate sits behind a
//  tarp-covered spare cabin: no gate exit is visible from the enemy half, no
//  spawn from anywhere in the mid map, and no jump+mantle chain reaches a wall
//  top, roof or pedestal (all tested).
//
// Heights: ground 0 · deck 2.6 · plateau / ridge 3 · gallery 3.6 · arcade roof
// 3.7 · dorm roof 4.5 · generator 5.4 · yard walls 6 · rib 6.2 · base 7.5 · dome
// apex ≈ 22. Walls meant to block players ≥ 2.6 m; roofs with dressing on top
// sit > 2.45 m above anything climbable within jumping distance (tested).
// Collision is lean (119 of the 120-solid budget); 'hidden' solids are drawn by
// the decor module src/client/world/maps/observatory.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { MapKit, mirrorSpawnsZ, spawn, v, yawToward } from '../sim/map-kit';
import type { MapDef, SpawnPoint } from './types';

/** Key dimensions shared with the decor module (keep collision and art in sync). */
export const OBS = {
  /** Observatory base: outer half-size, wall top, hall half-size at ground level on E/W (plinths) and N/S. */
  baseHalf: 12,
  baseTop: 7.5,
  hallHalfEW: 7.8,
  hallHalf: 10,
  /** Door half-width and door (lintel) height. */
  doorHalf: 1.4,
  doorTop: 3.2,
  /** Gallery ring floor height (slab 0.3 thick). */
  gallery: 3.6,
  /** Observing podium (inner ring around the telescope, top = gallery), fork mount, podium bridges. */
  podiumHalf: 3.4,
  forkHalf: 2,
  forkTop: 7,
  bridgeHalf: 1.2,
  deskDepth: 0.35,
  /** Inner (hall-side) edge of the four gallery stairs (they run x ±stairInner…±hallHalfEW, 2.8 m wide). */
  stairInner: 5,
  /** Dome: drum radius, springline (top of the drum), shell radius. */
  domeRadius: 11.4,
  domeSpring: 10,
  /** Arcades (dome ↔ dorm / hut): x-range and roof. */
  arcadeHalf: 1.9,
  arcadeRoof: 3.4,
  arcadeRoofTop: 3.7,
  /** Signal array plateau / ridge path height. */
  ridge: 3,
  /** Pylon station deck height. */
  deck: 2.6,
  /** Dormitory footprint; `bay` = inner face of the thick west wall (built-in bunk bays, benches). */
  dorm: { x0: 24.5, x1: 34.5, z: 15, h: 3.4, roofTop: 4.5, bay: 25.9 },
  /** Generator / boiler house: tall enough that no crate stack reaches its roof (no roof route). */
  genTop: 5.4,
  /** Spawn-yard wall height: nothing climbable within jumping distance reaches the coping. */
  yardWall: 6,
  /** Tops of the rock rib (west | courtyard divider) and the forecourt outcrop. */
  ribTop: 6.2,
  outcropTop: 3.2,
  /** Dish pedestal height above the plateau; bullwheel house top. */
  pedestal: 3.8,
  wheelTop: 7.6,
  /** Spawn-yard gates (x ranges): W and E sit at the cliff edges behind the ridge ramp / forecourt cover. */
  gates: [
    [-57, -53],
    [-2, 2],
    [53, 57],
  ] as readonly (readonly [number, number])[],
} as const;

const k = new MapKit();
const R = OBS.ridge;
const D = OBS.deck;
const G = OBS.gallery;

// ── Ground (snowfield on the summit) ────────────────────────────────────────
k.box(-58.5, -1, -61.5, 58.5, 0, 61.5, 'snow', 'ground'); // = the visual rim (decor cliffs start here)

// ── Center: the observatory base + telescope hall ──────────────────────────
// Thick walls (2 m) of a 24 × 24 m base; doors on all four axes.
let m = k.mark();
k.box(10, 0, 1.4, 12, OBS.baseTop, 12, 'concrete', 'hidden'); // east wall (+ SE corner)
k.box(1.4, 0, 10, 10, OBS.baseTop, 12, 'concrete', 'hidden'); // south wall
// Gallery plinth: solid mass under the east gallery (no dead-end nooks), stairs against it.
k.box(7.8, 0, 1.4, 10, G, 7.8, 'concrete', 'hidden');
// Stairs (drawn by decor) from the hall floor up to the south gallery strip.
k.ramp(OBS.stairInner, 0, 1.8, 7.8, G, 7.8, 'z', 1, 'metal', 'hidden');
k.mirrorX(m);
k.mirrorZ(m);
// Lintels over the doors, gallery strips N/S (x −10…10), bridges over the E/W doors.
m = k.mark();
k.box(-OBS.doorHalf, OBS.doorTop, 10, OBS.doorHalf, OBS.baseTop, 12, 'concrete', 'hidden');
k.box(-10, G - 0.3, 7.8, 10, G, 10, 'metal', 'hidden');
k.mirrorZ(m);
m = k.mark();
k.box(10, OBS.doorTop, -OBS.doorHalf, 12, OBS.baseTop, OBS.doorHalf, 'concrete', 'hidden');
k.box(7.8, G - 0.3, -OBS.doorHalf, 10, G, OBS.doorHalf, 'metal', 'hidden');
k.mirrorX(m);
// The telescope: a raised observing podium (the inner catwalk ring around the
// fork mount, same height as the gallery) with the fork above it (the tube is
// decor and turns with the dome). The podium's west face is 0.35 m deeper: the
// observer's desk (thermos, lunch box, frozen dials) sits in a recess under its lip.
k.box(-OBS.podiumHalf - OBS.deskDepth, 0, -OBS.podiumHalf, OBS.podiumHalf, G, OBS.podiumHalf, 'concrete', 'hidden');
k.box(-OBS.forkHalf, G, -OBS.forkHalf, OBS.forkHalf, OBS.forkTop, OBS.forkHalf, 'metal', 'hidden');
// Bridges gallery ↔ podium (N/S) and see-through railings along the gallery's inner edge.
m = k.mark();
k.box(-OBS.bridgeHalf, G - 0.3, OBS.podiumHalf, OBS.bridgeHalf, G, OBS.hallHalfEW, 'metal', 'hidden');
k.box(-OBS.stairInner, G, OBS.hallHalfEW, -OBS.bridgeHalf, G + 1.05, OBS.hallHalfEW + 0.12, 'metal', 'hidden', { shootThrough: true });
k.box(OBS.bridgeHalf, G, OBS.hallHalfEW, OBS.stairInner, G + 1.05, OBS.hallHalfEW + 0.12, 'metal', 'hidden', { shootThrough: true });
k.mirrorZ(m);

// ── Arcades: glazed walkways dome ↔ dormitory (E) and dome ↔ spectrograph hut (W) ──
m = k.mark();
k.box(12, 0, OBS.doorHalf, OBS.dorm.x0, 1.1, OBS.arcadeHalf, 'concrete', 'hidden');
k.mirrorZ(m);
k.box(12, OBS.arcadeRoof, -OBS.arcadeHalf, OBS.dorm.x0, OBS.arcadeRoofTop, OBS.arcadeHalf, 'metal', 'hidden');
m = k.mark();
k.box(-24, 0, OBS.doorHalf, -12, 1.1, OBS.arcadeHalf, 'concrete', 'hidden');
k.mirrorZ(m);
k.box(-24, OBS.arcadeRoof, -OBS.arcadeHalf, -12, OBS.arcadeRoofTop, OBS.arcadeHalf, 'metal', 'hidden');

// ── Courtyards (south half, mirrored): snowcat / sled, crate stacks ────────
m = k.mark();
k.box(-17.5, 0, 17, -12, 2.3, 20, 'metal', 'hidden'); // snowcat (N: fuel sled)
k.box(-23, 0, 27.5, -16, 2.8, 30.5, 'wood', 'hidden'); // crate stack W
k.box(-3, 0, 25.5, 3, 2.8, 27.6, 'metal', 'hidden'); // equipment sled (blocks the door axis)
k.box(12.5, 0, 27, 18, 2.8, 29.6, 'wood', 'hidden'); // crate stack E
k.box(12.5, 0, 13.5, 16.5, 2.2, 15.5, 'wood', 'hidden'); // instrument crates (jump-mantle)
k.box(-8, 0, 17, -5.4, 1.2, 19.4, 'wood', 'hidden'); // low crates (mantle)
k.box(4, 0, 19, 9, 2.6, 21.5, 'wood', 'hidden'); // mirror-blank crate (tarp)
k.box(-21, 0, 7, -16.5, 2.8, 10.5, 'metal', 'hidden'); // west court: spare dome segments

// ── West lane: ridge paths, signal-array plateau, under-ridge yard ─────────
k.box(-57, 0, 13, -49, R, 30, 'rock', 'hidden'); // ridge path
k.ramp(-57, 0, 30, -49, R, 38, 'z', -1, 'rock', 'hidden'); // path ramp down to the forecourt
k.box(-57, R, 21, -52.5, R + 2.8, 25, 'metal', 'hidden'); // signal hut on the path
k.ramp(-40, 0, 8.5, -33, R, 12.5, 'x', -1, 'rock', 'hidden'); // plateau access ramp
k.box(-44, R, 5.5, -42.4, R + 1.1, 7.6, 'metal', 'hidden'); // cable reel at the ramp head
k.box(-53, R, 4, -48, R + OBS.pedestal, 8, 'concrete', 'hidden'); // dish pedestal
k.box(-42, 0, 20, -34, 3.2, 25, 'rock', 'hidden'); // under-ridge boulder
k.box(-28, 0, 7, -23, OBS.ribTop, 27, 'rock', 'hidden'); // divider rib (west | courtyard)
k.box(-31, 0, 30.5, -25, OBS.outcropTop, 40.5, 'rock', 'hidden'); // forecourt outcrop

// ── East lane (south half): dormitory walls, deck ramp, shed, generator ────
const dm = OBS.dorm;
// Dorm west wall, 1.4 m deep: its inner face is the front of the built-in bunk
// bays / window benches, so the bunks have real collision.
k.box(dm.x0, 0, OBS.doorHalf, dm.bay, dm.h, dm.z, 'plaster', 'hidden');
k.box(dm.x1 - 0.9, 0, 9.4, dm.x1, dm.h, dm.z, 'plaster', 'hidden'); // dorm east wall (south end; its inner face = the locker fronts)
k.box(dm.bay, 0, dm.z - 0.5, 28, dm.h, dm.z, 'plaster', 'hidden'); // dorm south wall (door x 28…31)
k.box(31, 0, dm.z - 0.5, dm.x1, dm.h, dm.z, 'plaster', 'hidden');
k.box(dm.bay, 0, 5, 31, dm.h, 5.4, 'plaster', 'hidden'); // partition common room | bunk wing
k.ramp(42, 0, 9, 47, D, 16, 'z', -1, 'concrete', 'hidden'); // deck ramp
k.box(47.5, D, 5, 50, D + 2.4, 7.5, 'metal', 'hidden'); // control booth
k.box(34.5, 0, 20, 43, 3.4, 27.5, 'metal', 'hidden'); // maintenance shed (N: fuel store)
k.box(18, 0, 15, 26, OBS.genTop, 24, 'concrete', 'hidden'); // generator / boiler house (divider)
k.box(25, 0, 31, 31, 3, 40, 'metal', 'hidden'); // forecourt cable reels
// Tarp-covered spare cabin on its sled: shields the east gate from the deck and the alley.
k.box(49.5, 0, 27.5, 57, 2.8, 30.5, 'fabric', 'hidden');

// ── Spawn yard walls (south; mirrored) ─────────────────────────────────────
// Gates 4 m wide. W (x −57…−53) opens onto the foot of the ridge ramp, so the
// ridge crest hides it from the array; E (x 53…57) sits behind the tarp-covered
// cabin; the centre gate gets a wind-break porch 4 m in front of it (exits go
// left / right). Baffles 1.6 m behind each gate close the view into the yard.
k.box(-53, 0, 42, -2, OBS.yardWall, 43, 'concrete', 'hidden');
k.box(2, 0, 42, 53, OBS.yardWall, 43, 'concrete', 'hidden');
k.box(-57, 0, 44.6, -47, 3.2, 45.6, 'concrete', 'hidden'); // blast baffles behind each gate
k.box(-8.5, 0, 44.6, 8.5, 3.2, 45.6, 'concrete', 'hidden');
k.box(47, 0, 44.6, 57, 3.2, 45.6, 'concrete', 'hidden');
k.box(-5.5, 0, 37.2, 5.5, 3.2, 38.2, 'concrete', 'hidden'); // centre-gate wind-break porch
k.mirrorZ(m);

// ── Self-symmetric pieces on z = 0 ─────────────────────────────────────────
k.box(-57, 0, -13, -40, R, 13, 'rock', 'hidden'); // signal-array plateau
k.box(-46, R, -1, -44.4, R + 1.2, 1, 'metal', 'hidden'); // receiver cabinet (Zone A)
k.box(-34, 0, -3, -28, 3.2, 3, 'concrete', 'hidden'); // spectrograph hut
k.box(dm.x1 - 0.5, 0, -6.6, dm.x1, dm.h, 6.6, 'plaster', 'hidden'); // dorm east wall (middle)
k.box(dm.x0, dm.h, -dm.z, dm.x1, dm.roofTop, dm.z, 'plaster', 'hidden'); // dorm roof
k.box(28.4, 0, -0.8, 30.6, 0.9, 0.8, 'wood', 'hidden'); // common-room table (the radio)
k.box(42, 0, -9, 57, D, 9, 'concrete', 'hidden'); // pylon station deck
k.box(40.6, 0, -1.8, 42, 1.3, 1.8, 'wood', 'hidden'); // mantle crate onto the deck
k.box(36.6, 0, -1.2, 38.8, 1.9, 1.2, 'metal', 'hidden'); // transformer cabinet (breaks the alley sightline)
k.box(50, D, -3.5, 55, OBS.wheelTop, 3.5, 'metal', 'hidden'); // bullwheel house
k.box(55, D, -3, 57, 9, 3, 'concrete', 'hidden'); // pylon anchor block
k.box(44, D, -1.2, 45.6, D + 1.2, 1.2, 'metal', 'hidden'); // cable drum

// ── Spawns ──────────────────────────────────────────────────────────────────
// Spawn rows sit at the back of the yard (12–13 m from the wall, more sky over
// it) and each pilot opens their eyes looking at THEIR way out — the gate the
// paving chevrons point to — over its baffle: the gate slot, the summit beyond
// (dome cap, signal masts, the peaks) instead of a wind wall 8 m away.
const GATE_Z = 43;
const yard = (x: number, z: number, gx: number): SpawnPoint => spawn(x, 0, z, yawToward(x, z, gx, GATE_Z), 0);
const south: SpawnPoint[] = [
  yard(-46, 55.5, -55),
  yard(-35, 54.5, -55),
  yard(-23, 55, 0),
  yard(-11, 56, 0),
  yard(11, 56, 0),
  yard(23, 55, 0),
  yard(35, 54.5, 55),
  yard(46, 55.5, 55),
];
const ffaHalf: SpawnPoint[] = [
  spawn(-53, R, 16, yawToward(-53, 16, -47, 0), 2),
  spawn(-45, 0, 30, yawToward(-45, 30, -30, 0), 2),
  spawn(-3, 0, 20, yawToward(-3, 20, 0, 0), 2),
  spawn(16, 0, 8, yawToward(16, 8, 0, 0), 2),
  spawn(38, 0, 12, yawToward(38, 12, 45, 0), 2),
];

// The last light: the sun sits on the rim of the cloud sea (≈ 5°) — low enough
// for very long shadows and alpenglow on every sun-facing wall, high enough
// that the key light still carves the summit out of the blue-violet dusk.
export const OBSERVATORY_SUN = v(0.9, 0.09, -0.3);
const sunLen = Math.hypot(OBSERVATORY_SUN.x, OBSERVATORY_SUN.y, OBSERVATORY_SUN.z);
/** The launch mesa: ≈ 470 m out toward the sunset side (north of the sun), so the finale rises against the last light. */
const ROCKET_POS = v(398.6, -8, -249.1);

export const OBSERVATORY: MapDef = {
  id: 'observatory',
  nameKey: 'map.observatory.name',
  descKey: 'map.observatory.desc',
  bounds: { min: v(-57, -30, -60), max: v(57, 45, 60) },
  killY: -14,
  solids: k.solids,
  spawns: [...south, ...mirrorSpawnsZ(south), ...ffaHalf, ...mirrorSpawnsZ(ffaHalf)],
  zones: [
    { id: 'A', center: v(-47, R, 0), radius: 6, height: 4, nameKey: 'observatory.zone.A' },
    { id: 'B', center: v(0, 0, 0), radius: 8.5, height: 5.5, nameKey: 'observatory.zone.B' },
    { id: 'C', center: v(47, D, 0), radius: 5.5, height: 4, nameKey: 'observatory.zone.C' },
  ],
  pickups: [{ id: 'sunspear-podium', kind: 'sunspear', pos: v(2.7, G, 0), respawn: 45 }],
  landmarks: [
    { nameKey: 'observatory.landmark.dome', pos: v(0, 20, 0), icon: 'dome' },
    { nameKey: 'observatory.landmark.array', pos: v(-50, 12, 0), icon: 'antenna' },
    { nameKey: 'observatory.landmark.pylon', pos: v(57, 16, 0), icon: 'tower' },
    { nameKey: 'observatory.landmark.rocket', pos: v(ROCKET_POS.x, 60, ROCKET_POS.z), icon: 'rocket' },
    {
      nameKey: 'observatory.landmark.sun',
      pos: v((OBSERVATORY_SUN.x / sunLen) * 900, (OBSERVATORY_SUN.y / sunLen) * 900, (OBSERVATORY_SUN.z / sunLen) * 900),
      icon: 'sun',
    },
  ],
  lighting: {
    mood: 'dusk',
    sunDir: v(OBSERVATORY_SUN.x / sunLen, OBSERVATORY_SUN.y / sunLen, OBSERVATORY_SUN.z / sunLen),
    // Alpenglow key (rose-gold) against a cool, dim sky fill: warm lit faces,
    // luminous blue-violet shadows, haze that only swallows the far rim.
    sunColor: '#ffb08c',
    sunIntensity: 2.9,
    skyZenith: '#262a66',
    skyHorizon: '#c898b4',
    sunGlow: '#ffb27a',
    hemiSky: '#9ea3f0',
    hemiGround: '#7d6fa6',
    hemiIntensity: 1.2,
    fogColor: '#8f86bd',
    fogDensity: 0.0044,
    exposure: 1.06,
    bloom: 0.62,
    stars: 1,
    weather: 'snow',
  },
  audio: {
    reverb: 'mountain',
    echo: 0.55,
    ambience: 'wind',
    emitters: [
      { kind: 'radio', pos: v(29.5, 1.1, 0), radius: 9 },
      { kind: 'hum', pos: v(0, 5, 0), radius: 15 },
      { kind: 'wind_chime', pos: v(-53, 5, 20), radius: 11 },
      { kind: 'wind_chime', pos: v(-53, 5, -20), radius: 11 },
      { kind: 'machinery', pos: v(52, 4, 0), radius: 12 },
      { kind: 'hum', pos: v(37.7, 1.2, 0), radius: 6 },
    ],
  },
  // A distant launch mesa rising out of the cloud sea beside the last light
  // (north-east); the decor pulls it in (and scales it) on short draw distances.
  rocket: { pos: ROCKET_POS, scale: 1.8 },
};
