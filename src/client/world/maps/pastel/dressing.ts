// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel set dressing: the suburb "half-swallowed by glowing
// overgrowth", and the ground that tells what happened here.
//
//  • groundStory(): decals (cracks with weeds, oil stains, wet patches, leaf
//    litter, paper litter, skid marks, sand drifts, manholes, drain grates,
//    worn parking paint, moss) + sky-reflecting puddles (geometry handed to
//    the flood-water mesh: no extra draw call).
//  • lotProps(): shopping carts (some toppled) + a cart corral, overgrown
//    planters, wheel stops, extra lamp posts with dead bulbs, a bus stop with
//    bench, the toppled STARLIGHT parking sign.
//  • yardProps(): toys, lawn furniture, a swing set, picnic blanket, another
//    laundry line, extra mailboxes.
//  • overgrowth(): ivy masses up the mall / houses / garages / walls, fringes
//    spilling over roof edges, moss and creeper cushions on the roofs, and
//    bioluminescent ground cover concentrated in the shade (north / east faces,
//    carports, pergolas, under trees).
//
// Nothing here collides: everything is flat, thin, low (≤ ~0.7 m in the
// lanes) or hugs a wall / sits overhead, so the collision stays truthful.
// Density scales with kit.detail (quality.decor).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV } from '../../../engine/palette';
import { type CardBatch } from './cards';
import { DECAL, type DecalBatch, type RGBA } from './decals';
import { LEAF, blossomBed, bush, crown, cushion, fern, fringe, glowPatch, ivy, lanternPlant } from './flora';
import { tuft } from './ground';
import { type DecorKit, type RGB, mix, rgb } from './kit';
import { cart } from './mall';
import type { SignBatch } from './signs';
import { hangingVine } from './vines';

type Signs = { board: SignBatch; lit: SignBatch };

export interface Dress {
  kit: DecorKit;
  cards: CardBatch;
  decals: DecalBatch;
  signs: Signs;
  rng: () => number;
}

const K = {
  bone: rgb(ENV.bone),
  boneShade: rgb(ENV.boneShade),
  concrete: rgb(ENV.concrete),
  concreteDark: rgb(ENV.concreteDark),
  terra: rgb(ENV.terracotta),
  terraF: rgb(ENV.terracottaFaded),
  sage: rgb(ENV.sage),
  olive: rgb(ENV.olive),
  mint: rgb(ENV.pastelMint),
  pink: rgb(ENV.pastelPink),
  yellow: rgb(ENV.pastelYellow),
  blue: rgb(ENV.pastelBlue),
  sand: rgb(ENV.sand),
  mustard: rgb('#d9c28b'),
  wood: rgb('#b39a7f'),
  woodDark: rgb('#8a7560'),
  dark: rgb('#3a3634'),
  chrome: rgb('#c9c6bf'),
  rust: rgb(ENV.rust),
};

// ── Where is what ───────────────────────────────────────────────────────────

export type Pave = 'asphalt' | 'concrete' | 'tile' | 'lawn' | 'none';

/** Ground surface kind + its top height at (x, z) (mirrors ground.ts / the collision). */
export function surfaceAt(x: number, z: number): { kind: Pave; y: number } {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const none = { kind: 'none' as const, y: 0 };
  if (ax < 15.4 && az < 12.3) return none; // mall
  if (x > -45.3 && x < -32.7 && az < 5.3) return none; // pool
  // Buildings / solid masses.
  if (ax > 14.8 && ax < 30.2 && az > 11.8 && az < 15.8) return none; // garages
  if (ax > 16.8 && ax < 30.2 && az > 15.8 && az < 27.2) return none; // houses
  if (ax > 44.8 && az > 14.8 && az < 25.2) return none; // bungalows
  if (x > 43.8 && az < 6.2) return none; // corner house
  if (x < -47.3 && az < 3.7) return none; // cabana
  if (x > -42.2 && x < -38.8 && az > 18.8 && az < 22.2) return none; // shed
  if (Math.hypot(x - 37, az - 47) < 8.4) return { kind: 'asphalt', y: 0.031 };
  if (x >= 31 && x <= 43) return { kind: 'asphalt', y: 0.031 };
  if (x > 43 && x <= 45) return { kind: 'concrete', y: 0.035 };
  if (x >= 30 && x < 31) return { kind: 'concrete', y: 0.035 };
  if (ax <= 17 && az >= 15.6 && az <= 40) return { kind: 'asphalt', y: 0.03 };
  if (ax <= 15 && az >= 12 && az < 15.6) return { kind: 'concrete', y: 0.037 };
  if (x >= -36 && x <= 30 && az >= 40.4) return { kind: 'asphalt', y: 0.03 };
  if (x >= 15 && x <= 31 && az < 6.5) return { kind: 'asphalt', y: 0.03 };
  if (x >= 15 && x <= 31 && az < 12) return { kind: 'concrete', y: 0.03 };
  if (x >= -33 && x <= -15 && az < 12) return { kind: 'concrete', y: 0.03 };
  if (x >= -47.5 && x <= -30 && az < 12) return { kind: 'tile', y: 0.035 };
  if (ax > 54 || az > 54) return none;
  return { kind: 'lawn', y: 0 };
}

const paved = (k: Pave): boolean => k === 'asphalt' || k === 'concrete' || k === 'tile';

/** Decal height over a surface (above the painted lines at 0.05). */
const DY = 0.058;

function tint(rng: () => number, a0: number, a1: number, v = 0.12): RGBA {
  const k = 1 - v / 2 + rng() * v;
  return [k, k, k * (0.97 + rng() * 0.06), a0 + rng() * (a1 - a0)];
}

// ── Puddles (geometry for the shared water mesh) ────────────────────────────

/**
 * Irregular puddle: an inner opaque disc + a feathered rim (attribute aEdge:
 * 1 inside → 0 at the rim) so the water melts into the asphalt.
 */
function puddleGeo(cx: number, cz: number, y: number, rx: number, rz: number, rot: number, rng: () => number, seg: number): { pos: number[]; edge: number[] } {
  const pos: number[] = [];
  const edge: number[] = [];
  const ph = [rng() * 6, rng() * 6, rng() * 6];
  const R = (a: number): number => 1 + 0.18 * Math.sin(a * 2 + ph[0]) + 0.1 * Math.sin(a * 3 + ph[1]) + 0.06 * Math.sin(a * 5 + ph[2]);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const P = (a: number, k: number): [number, number, number] => {
    const lx = Math.cos(a) * rx * R(a) * k;
    const lz = Math.sin(a) * rz * R(a) * k;
    return [cx + lx * c - lz * s, y, cz + lx * s + lz * c];
  };
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const i0 = P(a0, 0.72);
    const i1 = P(a1, 0.72);
    const o0 = P(a0, 1);
    const o1 = P(a1, 1);
    // Centre fan (CCW from above: centre, a1, a0).
    pos.push(cx, y, cz, ...i1, ...i0);
    edge.push(1, 1, 1);
    // Rim quad.
    pos.push(...i0, ...i1, ...o1, ...i0, ...o1, ...o0);
    edge.push(1, 1, 0, 1, 0, 0);
  }
  return { pos, edge };
}

export interface PuddleSet {
  pos: number[];
  edge: number[];
}

// ── Ground storytelling ─────────────────────────────────────────────────────

export function groundStory(d: Dress): PuddleSet {
  const { kit, decals, rng } = d;
  const det = kit.detail;
  const puddles: PuddleSet = { pos: [], edge: [] };
  const seg = kit.low ? 10 : 18;
  // Tar repair patches (lots, street, alley) — big, low-contrast value shapes
  // that break up the asphalt.
  for (let i = 0, n = 0; i < 200 && n < Math.round(34 * det); i++) {
    const x = -50 + rng() * 100;
    const z = -53 + rng() * 106;
    const s = surfaceAt(x, z);
    if (s.kind !== 'asphalt' && s.kind !== 'concrete') continue;
    n++;
    const w = 2 + rng() * 4.5;
    const along = rng() < 0.5 ? 0 : Math.PI / 2;
    decals.ground(DECAL.patch, x, z, s.y + DY - 0.008, w, w * (0.3 + rng() * 0.35), along + (rng() - 0.5) * 0.06, tint(rng, 0.7, 1));
  }
  const puddle = (x: number, z: number, rx: number, rz: number): void => {
    const s = surfaceAt(x, z);
    if (!paved(s.kind)) return;
    const rot = rng() * Math.PI;
    const g = puddleGeo(x, z, s.y + 0.03, rx * 0.8, rz * 0.8, rot, rng, seg);
    puddles.pos.push(...g.pos);
    puddles.edge.push(...g.edge);
    // Wet rim darkening the asphalt around it.
    decals.ground(DECAL.damp, x, z, s.y + DY - 0.004, rx * 3.0, rz * 3.0, rot, [1, 1, 1, 0.75]);
  };
  for (const sz of [1, -1]) {
    // Parking lot: puddles in the sunken drive lanes.
    for (const [x, z, rx, rz] of [
      [-5.5, 26.5, 1.6, 0.9],
      [4.8, 33.5, 2.2, 1.2],
      [-12.5, 35.8, 1.2, 0.8],
      [11.2, 18.6, 1.4, 0.9],
      [-2.6, 37.4, 1.0, 0.7],
    ] as const) puddle(x + (rng() - 0.5), z * sz, rx, rz);
    // Street gutters.
    for (const [x, z, rx, rz] of [
      [32.2, 17, 0.8, 2.2],
      [41.8, 29, 0.7, 1.8],
      [32.4, 36, 0.9, 2.6],
      [37.5, 44.5, 2.0, 1.3],
    ] as const) puddle(x, z * sz, rx, rz);
    // Plaza: flood water seeping out under the mall doors.
    puddle(-6 + (rng() - 0.5), 13.6 * sz, 1.6, 0.9);
    puddle(6.3, 14.2 * sz, 1.2, 0.7);
  }
  puddle(-24.5, -3.5, 1.4, 2.2);
  puddle(-19.8, 8.6, 1.0, 1.4);
  puddle(22, 2.5, 1.8, 1.0);
  puddle(-31.2, -8.6, 0.8, 1.2);

  // The lots get their own pass: the asphalt there is the most exposed ground
  // of the map (cracks with weeds, stains, leaf drifts, litter).
  for (const sz of [1, -1]) {
    for (let i = 0; i < Math.round(26 * det); i++) {
      const x = -16.5 + rng() * 33;
      const z = (16 + rng() * 23.5) * sz;
      if (Math.abs(x) < 1.2 && Math.abs(z) > 18.3 && Math.abs(z) < 24.7) continue; // pylon
      const r = rng();
      const ang = rng() * Math.PI;
      if (r < 0.45) {
        const len = 1.4 + rng() * 2.6;
        decals.ground(rng() < 0.5 ? DECAL.crackA : DECAL.crackB, x, z, 0.03 + DY, len, len * 0.6, ang, tint(rng, 0.7, 0.95));
        decals.ground(DECAL.weeds, x, z, 0.03 + DY + 0.001, len * 0.5, len * 0.5, rng() * 6, [1, 1, 1, 0.95]);
        for (let k = 0; k < 2; k++) tuft(kit, x + (rng() - 0.5) * len * 0.6, z + (rng() - 0.5) * len * 0.3, 0.18 + rng() * 0.22, mix(rgb(ENV.sage), rgb(ENV.olive), rng() * 0.4), rng, 0.03);
      } else if (r < 0.65) decals.ground(DECAL.leaves, x, z, 0.03 + DY + 0.001, 1.2 + rng() * 1.6, 1.2 + rng() * 1.6, ang, [1, 1, 1, 1]);
      else if (r < 0.85) decals.ground(DECAL.oil, x, z, 0.03 + DY - 0.002, 1 + rng() * 1.4, 1 + rng() * 1.2, ang, tint(rng, 0.45, 0.8));
      else decals.ground(DECAL.paper, x, z, 0.03 + DY + 0.002, 0.9 + rng() * 0.4, 0.9 + rng() * 0.4, ang, [0.82, 0.8, 0.78, 0.9]);
    }
  }

  // Weeds and grass along the lot's curbs and the spawn-wall foot.
  for (const sz of [1, -1]) {
    for (let i = 0; i < Math.round(30 * det); i++) {
      const edge = rng();
      let x: number;
      let z: number;
      if (edge < 0.6) {
        x = (rng() < 0.5 ? -1 : 1) * (16.75 - rng() * 0.3);
        z = (27.4 + rng() * 12.2) * sz;
      } else {
        x = -25.5 + rng() * 51;
        z = (39.75 - rng() * 0.3) * sz;
      }
      tuft(kit, x, z, 0.25 + rng() * 0.35, mix(mix(rgb(ENV.sage), rgb(ENV.sand), 0.3), rgb(ENV.olive), rng() * 0.5), rng, 0.03);
      if (rng() < 0.18) fern(d.cards, x, 0.03, z, 0.3 + rng() * 0.2, rng);
    }
  }

  // Main street: heaved asphalt along the wheel ruts, weeds at the gutters,
  // leaves banked against the curbs.
  for (const sz of [1, -1]) {
    // Long tar seams / repair strips down the lanes (big value shapes that
    // read even at grazing angles).
    for (let i = 0; i < 4; i++) {
      const x = 33.5 + rng() * 7;
      const z = (15 + i * 9.5 + rng() * 4) * sz;
      decals.ground(DECAL.patch, x, z, 0.031 + DY - 0.008, 4 + rng() * 4, 1.2 + rng() * 1.2, Math.PI / 2 + (rng() - 0.5) * 0.08, tint(rng, 0.75, 1));
    }
    for (let i = 0; i < Math.round(22 * det); i++) {
      const gutter = rng() < 0.45;
      const x = gutter ? (rng() < 0.5 ? 31.5 + rng() * 0.8 : 41.7 + rng() * 0.8) : 32.5 + rng() * 9;
      const z = (13.5 + rng() * 38) * sz;
      const ang = rng() * Math.PI;
      if (gutter) {
        decals.ground(rng() < 0.6 ? DECAL.leaves : DECAL.sand, x, z, 0.031 + DY, 1.2 + rng(), 2 + rng() * 1.5, Math.PI / 2 + (rng() - 0.5) * 0.4, [1, 1, 1, 0.95]);
        for (let k = 0; k < 2; k++) tuft(kit, x + (rng() - 0.5) * 0.5, z + (rng() - 0.5) * 1.5, 0.2 + rng() * 0.3, mix(rgb(ENV.sage), rgb(ENV.olive), rng() * 0.5), rng, 0.031);
      } else {
        const len = 1.6 + rng() * 2.8;
        decals.ground(rng() < 0.5 ? DECAL.crackA : DECAL.crackB, x, z, 0.031 + DY, len, len * 0.6, ang, tint(rng, 0.7, 0.95));
        if (rng() < 0.6) {
          decals.ground(DECAL.weeds, x, z, 0.031 + DY + 0.001, len * 0.5, len * 0.5, rng() * 6, [1, 1, 1, 0.95]);
          tuft(kit, x, z, 0.2 + rng() * 0.25, mix(rgb(ENV.sage), rgb(ENV.glowChartreuse), 0.15), rng, 0.031);
        }
      }
    }
  }

  // Worn parking paint (replaces crisp slabs): stall lines, skipped / broken.
  const line = (x: number, z0: number, z1: number, w = 0.14): void => {
    if (rng() < 0.1) return; // long gone
    const len = Math.abs(z1 - z0);
    let a = Math.min(z0, z1);
    const b = Math.max(z0, z1);
    // Broken into 1–3 pieces with gaps.
    const pieces = 1 + Math.floor(rng() * 2.5);
    for (let i = 0; i < pieces && a < b; i++) {
      const l = Math.min(b - a, len / pieces + (rng() - 0.5) * len * 0.25);
      const s = surfaceAt(x, (a + a + l) / 2);
      decals.ground(DECAL.line, x, a + l / 2, s.y + DY - 0.006, l, w, Math.PI / 2, [1, 1, 0.97, 0.55 + rng() * 0.35], rng() < 0.5);
      a += l + rng() * 0.6;
    }
  };
  for (const sz of [1, -1]) {
    const Z = (a: number, b: number): [number, number] => (sz > 0 ? [a, b] : [-b, -a]);
    for (let x = -14; x <= 14; x += 2.8) {
      if (Math.abs(x) < 3) continue;
      const [p, q] = Z(29.5, 34.5);
      line(x, p, q);
      const [p2, q2] = Z(17.5, 21);
      if (Math.abs(x) > 4) line(x, p2, q2);
      // Wheel stop at the head of the stall + an oil stain in most stalls.
      if (rng() < 0.6) {
        const zc = sz > 0 ? 34.0 : -34.0;
        const xs = x + 1.4 + (rng() - 0.5) * 0.3;
        if (Math.abs(xs) < 15.5) {
          kit.boxR('concrete', xs, 0.085, zc, 1.3, 0.11, 0.16, (rng() - 0.5) * 0.25, mix(K.concreteDark, K.concrete, 0.4 + rng() * 0.3), 0.03, { ao: 0.3, base: 0.03 });
          if (rng() < 0.7) decals.ground(DECAL.oil, xs + (rng() - 0.5) * 0.6, (sz > 0 ? 32 : -32) + (rng() - 0.5), 0.03 + DY, 1.3 + rng() * 0.8, 1.6 + rng() * 0.8, rng() * Math.PI, tint(rng, 0.55, 0.85));
        }
      }
    }
    for (let x = -32; x <= 26; x += 3) {
      const [p, q] = Z(49.5, 53.5);
      line(x, p, q);
    }
    // Faded lane arrows.
    for (const [x, z, r] of [
      [-11, 26.5, 0],
      [11, 25.5, Math.PI],
      [-20, 46.5, Math.PI / 2],
    ] as const) decals.ground(DECAL.arrow, x, z * sz, 0.03 + DY, 1.6, 2.6, sz > 0 ? r : r + Math.PI, [1, 1, 0.97, 0.6]);
  }
  // Road centre dashes (worn) on the main street.
  for (const sz of [1, -1]) {
    for (let z = 13; z < 42; z += 6) line(37, z * sz, (z + 3) * sz, 0.16);
  }

  // Cracks (with weeds), oil, litter, skid marks, sand — spread over paving.
  const cracks = Math.round(150 * det);
  const weed = mix(mix(rgb(ENV.sage), rgb(ENV.sand), 0.2), rgb(ENV.glowChartreuse), 0.22);
  for (let i = 0, n = 0; i < cracks * 4 && n < cracks; i++) {
    const x = -53 + rng() * 106;
    const z = -53 + rng() * 106;
    const s = surfaceAt(x, z);
    if (!paved(s.kind)) continue;
    n++;
    const big = rng() < 0.35;
    const len = big ? 2.4 + rng() * 2.6 : 1.2 + rng() * 1.4;
    const ang = rng() * Math.PI;
    decals.ground(big ? DECAL.crackB : DECAL.crackA, x, z, s.y + DY, len, big ? len * 0.5 : len, ang, tint(rng, 0.65, 0.95), rng() < 0.5);
    // Weeds pushing through.
    if (rng() < 0.75) {
      decals.ground(DECAL.weeds, x, z, s.y + DY + 0.001, len * 0.55, len * 0.55, rng() * 6, [1, 1, 1, 0.95]);
      const t = 1 + Math.floor(rng() * (big ? 4 : 2.5));
      for (let k = 0; k < t; k++) {
        const u = (rng() - 0.5) * len * 0.8;
        tuft(kit, x + Math.cos(ang) * u, z - Math.sin(ang) * u, 0.16 + rng() * 0.24, mix(weed, rgb(ENV.olive), rng() * 0.35), rng, s.y);
      }
    }
  }
  const scatter = (count: number, f: (x: number, z: number, y: number, k: Pave) => void, ok: (k: Pave) => boolean = paved): void => {
    for (let i = 0, n = 0; i < count * 5 && n < count; i++) {
      const x = -53 + rng() * 106;
      const z = -53 + rng() * 106;
      const s = surfaceAt(x, z);
      if (!ok(s.kind)) continue;
      n++;
      f(x, z, s.y, s.kind);
    }
  };
  scatter(Math.round(40 * det), (x, z, y, k) => decals.ground(k === 'asphalt' ? DECAL.oil : DECAL.damp, x, z, y + DY - 0.002, 1 + rng() * 1.6, 0.8 + rng() * 1.2, rng() * Math.PI, tint(rng, 0.4, 0.75)));
  scatter(Math.round(26 * det), (x, z, y) => decals.ground(DECAL.paper, x, z, y + DY + 0.002, 0.9 + rng() * 0.5, 0.9 + rng() * 0.5, rng() * Math.PI, [0.82, 0.8, 0.78, 0.9]));
  scatter(Math.round(24 * det), (x, z, y) => decals.ground(DECAL.drips, x, z, y + DY, 1 + rng(), 1 + rng(), rng() * Math.PI, tint(rng, 0.5, 0.8)));
  scatter(Math.round(30 * det), (x, z, y) => decals.ground(DECAL.leaves, x, z, y + DY + 0.001, 1.4 + rng() * 1.4, 1.4 + rng() * 1.4, rng() * Math.PI, [1, 1, 1, 1]), (k) => k !== 'none');
  // Skid marks.
  for (const [x, z, r] of [
    [36, 24, 0.3],
    [38.5, -31, -0.5],
    [34.5, 6.5, 1.2],
    [-3, 30.5, 2.4],
    [6, -24, 0.8],
    [22, -3.5, 0.1],
  ] as const) decals.ground(DECAL.tire, x, z, 0.031 + DY - 0.003, 4.5 + rng() * 2, 2.2, r, [1, 1, 1, 0.75]);
  // Sand drifts along curbs and the lot edges.
  for (const sz of [1, -1]) {
    for (const [x, z, w, r] of [
      [31.6, 22, 3.4, Math.PI / 2],
      [42.4, 34, 3.0, Math.PI / 2],
      [31.6, 46, 2.8, Math.PI / 2],
      [-16.3, 27, 3.6, Math.PI / 2],
      [16.3, 33, 3.2, Math.PI / 2],
      [-8, 39.4, 4.2, 0],
      [9, 39.4, 3.4, 0],
      [-12, 15.9, 3.0, 0],
    ] as const) decals.ground(DECAL.sand, x, z * sz, 0.03 + DY - 0.001, w, 1.3, r, [1, 1, 1, 0.85]);
  }
  // Manholes down the street centre + in the lots; drain grates at the curbs
  // (with a little cast curb inlet).
  for (const sz of [1, -1]) {
    for (const z of [8, 22, 37]) decals.ground(DECAL.manhole, 36.2, z * sz, 0.031 + DY - 0.002, 0.95, 0.95, rng() * 6, [1, 1, 1, 1]);
    decals.ground(DECAL.manhole, -6.5, 22.6 * sz, 0.03 + DY - 0.002, 0.95, 0.95, 1, [1, 1, 1, 1]);
    for (const [x, z, rot] of [
      [31.45, 14, 0],
      [42.55, 25, Math.PI],
      [31.45, 31, 0],
      [42.55, 41, Math.PI],
    ] as const) {
      decals.ground(DECAL.grate, x, z * sz, 0.031 + DY - 0.002, 0.9, 1.2, Math.PI / 2, [1, 1, 1, 1]);
      const cx = rot === 0 ? 31.0 : 43.0;
      kit.box('concrete', cx - 0.1, 0.1, z * sz - 0.55, cx + 0.1, 0.16, z * sz + 0.55, K.boneShade, 0, { ao: 0 });
      decals.ground(DECAL.leaves, x + (rot === 0 ? 0.6 : -0.6), z * sz, 0.031 + DY, 1.2, 1.6, rng() * 6, [1, 1, 1, 1]);
    }
    for (const [x, z] of [
      [-16.2, 25],
      [16.2, 36],
      [0, 39.2],
    ] as const) decals.ground(DECAL.grate, x, z * sz, 0.03 + DY - 0.002, 0.9, 1.2, Math.abs(x) > 1 ? Math.PI / 2 : 0, [1, 1, 1, 1]);
  }
  return puddles;
}

// ── Parking lot props ───────────────────────────────────────────────────────

/** Overgrown concrete planter (low curb box; plants ≤ ~0.8 m). */
function planter(d: Dress, x: number, z: number, w: number, dd: number, ry: number, glow: boolean): void {
  const { kit, cards, rng } = d;
  kit.boxR('concrete', x, 0.2, z, w, 0.4, dd, ry, mix(K.bone, K.concrete, 0.4), 0.05, { base: 0, ao: 0.3 });
  kit.boxR('grass', x, 0.39, z, w - 0.2, 0.02, dd - 0.2, ry, rgb('#8f8a6a'), 0, { base: -Infinity });
  const n = Math.max(1, Math.round(w / 1.1));
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (w - 0.7);
    const px = x + Math.cos(ry) * t;
    const pz = z - Math.sin(ry) * t;
    if (glow && rng() < 0.5) lanternPlant(kit, cards, px, 0.4, pz, 0.55 + rng() * 0.25, rng);
    else bush(kit, cards, px, 0.35, pz, 0.48 + rng() * 0.15, 0.32 + rng() * 0.1, 0.48 + rng() * 0.15, rng);
  }
  if (glow) blossomBed(cards, x, 0.4, z, Math.min(w, dd) * 0.9, rng);
  // Weeds spilling over the rim.
  for (let i = 0; i < 3; i++) tuft(kit, x + (rng() - 0.5) * w, z + (rng() - 0.5) * dd, 0.2 + rng() * 0.2, mix(K.sage, K.olive, rng()), rng, 0.4);
}

/** Lot lamp post with a dead (cracked, unlit) head. */
function deadLamp(kit: DecorKit, x: number, z: number, ry: number, broken: boolean): void {
  kit.cyl('concrete', x, 0, z, 0.22, 0.28, 0.5, K.boneShade, 8);
  kit.cyl('chrome', x, 0.5, z, 0.08, 0.11, 6.6, mix(K.bone, K.rust, 0.25), 8);
  const ax = Math.cos(ry);
  const az = -Math.sin(ry);
  kit.tube('chrome', new THREE.Vector3(x, 6.9, z), new THREE.Vector3(x + ax * 1.1, 7.05, z + az * 1.1), 0.05, K.bone, 6);
  const hx = x + ax * 1.25;
  const hz = z + az * 1.25;
  if (broken) {
    // Head hanging by its cable.
    kit.tube('chrome', new THREE.Vector3(hx, 7.0, hz), new THREE.Vector3(hx + 0.1, 6.2, hz), 0.012, K.dark, 3);
    kit.boxE('paint', new THREE.Vector3(hx + 0.12, 6.0, hz), new THREE.Euler(0.2, ry, 1.2), new THREE.Vector3(0.6, 0.2, 0.4), K.bone, 0.05);
  } else {
    kit.boxR('paint', hx, 7.0, hz, 0.7, 0.2, 0.42, ry, K.bone, 0.05, { ao: 0 });
    // Dead bulb: grey-violet glass, not lit.
    kit.boxR('window', hx, 6.88, hz, 0.5, 0.04, 0.3, ry, mix(K.dark, rgb(ENV.shadowCool), 0.5), 0, { ao: 0 });
  }
}

function busStop(d: Dress, x: number, z: number, face: number): void {
  const { kit } = d;
  // Pole + round "BUS" plate (terracotta disc, bone ring) + timetable box.
  kit.cyl('chrome', x, 0, z, 0.045, 0.05, 2.9, K.chrome, 6);
  const disc = new THREE.CylinderGeometry(0.32, 0.32, 0.03, 16);
  disc.rotateX(Math.PI / 2);
  kit.geo('paint', disc, new THREE.Matrix4().makeRotationY(face).setPosition(x, 2.7, z), K.terraF, { drift: 0.05 });
  disc.dispose();
  const ring = new THREE.TorusGeometry(0.32, 0.025, 4, 16);
  for (const s of [-1, 1]) kit.geo('paint', ring, new THREE.Matrix4().makeRotationY(face).multiply(new THREE.Matrix4().makeTranslation(0, 0, s * 0.018)).setPosition(x, 2.7, z), K.bone, { drift: 0 });
  ring.dispose();
  kit.boxR('paint', x, 2.7, z, 0.36, 0.08, 0.04, face, K.bone, 0, { ao: 0 });
  kit.boxR('paint', x, 1.55, z, 0.32, 0.5, 0.08, face, K.bone, 0.02, { ao: 0 });
  kit.boxR('window', x, 1.55, z, 0.24, 0.38, 0.09, face, mix(K.yellow, K.bone, 0.4), 0, { ao: 0 });
}

function bench(kit: DecorKit, x: number, z: number, ry: number): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  kit.boxR('wood', x, 0.44, z, 1.8, 0.06, 0.42, ry, K.wood, 0.02);
  kit.boxR('wood', x + s * 0.2, 0.75, z + c * 0.2, 1.8, 0.3, 0.05, ry, K.wood, 0.02, { ao: 0 });
  for (const t of [-0.75, 0.75]) kit.boxR('chrome', x + c * t, 0.22, z - s * t, 0.06, 0.44, 0.4, ry, K.dark, 0);
}

export function lotProps(d: Dress): void {
  const { kit, rng } = d;
  for (const sz of [1, -1]) {
    const Z = (z: number): number => z * sz;
    // Abandoned shopping carts (one wheel-up on its side), a cart corral.
    const carts: [number, number, number, boolean][] = [
      [-3.4, 27.8, 0.7, false],
      [3.2, 36.4, 2.2, false],
      [-14.2, 37.6, 4.1, true],
      [12.6, 23.8, 5.3, false],
      [-6.8, 18.4, 1.4, true],
      [15.6, 37.8, 3.3, false],
    ];
    for (const [x, z, ry, tipped] of carts) {
      if (rng() > 0.45 + kit.detail * 0.55) continue;
      cartAt(kit, x, Z(z), sz > 0 ? ry : -ry, tipped);
    }
    // Corral along the garage end of the lot (rails only).
    const cz = Z(31.5);
    for (const s of [-1, 1]) kit.tube('chrome', new THREE.Vector3(15.9, 0.9, cz + s * 0.5 - 1.6), new THREE.Vector3(15.9, 0.9, cz + s * 0.5 + 1.6), 0.03, K.chrome, 5);
    for (const t of [-1.6, 0, 1.6]) for (const s of [-1, 1]) kit.tube('chrome', new THREE.Vector3(15.9, 0, cz + t + s * 0.5), new THREE.Vector3(15.9, 0.9, cz + t + s * 0.5), 0.03, K.chrome, 4);
    for (let i = 0; i < 3; i++) cartAt(kit, 15.9, cz - 1.0 + i * 0.55, Math.PI / 2, false);
    // Planters along the mall facade between the flutes (glowing in the shade
    // of the north side), and an island planter at the lot's head.
    planter(d, -11.2, Z(12.85), 3.4, 0.9, 0, sz < 0);
    planter(d, 11.2, Z(12.85), 3.4, 0.9, 0, sz < 0);
    planter(d, -2.6, Z(39.2), 2.6, 0.9, 0, true);
    // Extra lamp posts (dead) at the lot edges.
    deadLamp(kit, -16.4, Z(24.5), 0, false);
    deadLamp(kit, 16.4, Z(28.5), Math.PI, sz < 0);
    // Bus stop on the lot's spawn-wall edge, bench against the wall.
    busStop(d, 13.6, Z(38.6), sz > 0 ? 0 : Math.PI);
    bench(kit, 11.3, Z(39.45), sz > 0 ? 0 : Math.PI);
    signsBusStopLitter(d, 11.3, Z(39.0));
    // Toppled STARLIGHT parking sign: a blade sign lying in the stalls,
    // propped on its broken post (≤ 0.5 m high).
    if (sz > 0) toppledSign(d, -9.6, 30.2, 0.45);
    else toppledSign(d, 9.0, -19.4, 2.6);
  }
}

function signsBusStopLitter(d: Dress, x: number, z: number): void {
  d.decals.ground(DECAL.paper, x + 0.6, z + 0.2, 0.03 + DY + 0.002, 1.2, 1.2, d.rng() * 6);
  d.decals.ground(DECAL.leaves, x - 0.8, z, 0.03 + DY + 0.001, 1.8, 1.4, d.rng() * 6);
}

function toppledSign(d: Dress, x: number, z: number, ry: number): void {
  const { kit, cards, rng } = d;
  // Snapped post stub, the panel fallen face-up across the stalls, propped on
  // one long edge (top ≤ 0.45 m), its bent post lying beside it.
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  kit.cyl('chrome', x - s * 0.9 - c * 1.7, 0, z - c * 0.9 + s * 1.7, 0.07, 0.08, 0.42, K.rust, 6);
  const m = new THREE.Matrix4().makeRotationY(ry).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2 + 0.3));
  const p = new THREE.Vector3(x, 0.2, z);
  kit.geo('paint', boxGeo(2.4, 0.95, 0.08), m.clone().setPosition(p), K.bone, { drift: 0.06 });
  const face = new THREE.Vector3(0, 0, 0.045).applyMatrix4(new THREE.Matrix4().extractRotation(m));
  kit.geo('paint', boxGeo(2.15, 0.7, 0.01), m.clone().setPosition(p.clone().add(face)), K.terraF, { drift: 0.06 });
  kit.geo('paint', boxGeo(1.6, 0.12, 0.012), m.clone().setPosition(p.clone().add(face.clone().multiplyScalar(1.15))), K.bone, { drift: 0.06 });
  kit.tube('chrome', new THREE.Vector3(x - s * 0.9 - c * 1.6, 0.06, z - c * 0.9 + s * 1.6), new THREE.Vector3(x - s * 0.7 + c * 0.6, 0.06, z - c * 0.7 - s * 0.6), 0.06, K.rust, 6);
  // Creeper over its lower edge.
  cushion(cards, x - s * 0.4, 0.05, z - c * 0.4, 1.3, rng, LEAF.olive);
  for (let i = 0; i < 3; i++) tuft(kit, x + (rng() - 0.5) * 2, z + (rng() - 0.5) * 1.2, 0.2 + rng() * 0.2, mix(K.sage, K.olive, rng()), rng, 0.03);
}

let BOX: THREE.BufferGeometry | null = null;
function boxGeo(w: number, h: number, dd: number): THREE.BufferGeometry {
  BOX ??= new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const g = BOX.clone();
  g.scale(w, h, dd);
  return g;
}

function cartAt(kit: DecorKit, x: number, z: number, ry: number, tipped: boolean): void {
  if (!tipped) {
    cart(kit, x, 0.03, z, ry);
    return;
  }
  // On its side: draw the cart rotated about its long axis via a wrapper kit transform.
  cart(kit, x, 0.03, z, ry, Math.PI / 2 - 0.08);
}

// ── Back yards ──────────────────────────────────────────────────────────────

function lawnChair(kit: DecorKit, x: number, z: number, ry: number, col: RGB, folded = false): void {
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z);
  const P = (a: number, b: number, c: number): THREE.Vector3 => new THREE.Vector3(a, b, c).applyMatrix4(m);
  if (folded) {
    kit.boxE('chrome', P(0, 0.05, 0), new THREE.Euler(0, ry, 0), new THREE.Vector3(0.55, 0.06, 1.1), K.chrome);
    kit.boxE('fabric', P(0, 0.09, 0), new THREE.Euler(0, ry, 0), new THREE.Vector3(0.48, 0.02, 1.0), col);
    return;
  }
  // Aluminium frame + webbed seat/back.
  for (const s of [-0.25, 0.25]) {
    kit.tube('chrome', P(s, 0, 0.25), P(s, 0.42, -0.05), 0.016, K.chrome, 4);
    kit.tube('chrome', P(s, 0, -0.25), P(s, 0.42, 0.2), 0.016, K.chrome, 4);
    kit.tube('chrome', P(s, 0.42, 0.25), P(s, 0.88, -0.32), 0.016, K.chrome, 4);
  }
  kit.boxE('fabric', P(0, 0.42, 0.02), new THREE.Euler(0, ry, 0), new THREE.Vector3(0.5, 0.025, 0.46), col);
  kit.boxE('fabric', P(0, 0.66, -0.06), new THREE.Euler(-0.9, ry, 0, 'YXZ'), new THREE.Vector3(0.5, 0.025, 0.5), mix(col, K.bone, 0.3));
}

function swingSet(kit: DecorKit, x: number, z: number, ry: number): void {
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z);
  const P = (a: number, b: number, c: number): THREE.Vector3 => new THREE.Vector3(a, b, c).applyMatrix4(m);
  const col = mix(K.terraF, K.rust, 0.3);
  for (const s of [-1.3, 1.3]) {
    kit.tube('chrome', P(s, 0, -0.7), P(s, 2.2, 0), 0.04, col, 5);
    kit.tube('chrome', P(s, 0, 0.7), P(s, 2.2, 0), 0.04, col, 5);
  }
  kit.tube('chrome', P(-1.4, 2.2, 0), P(1.4, 2.2, 0), 0.045, col, 6);
  // One seat hanging, one dropped on the lawn.
  kit.tube('chrome', P(-0.6, 2.2, 0), P(-0.6, 0.5, 0.05), 0.008, K.dark, 3);
  kit.tube('chrome', P(-0.2, 2.2, 0), P(-0.2, 0.5, 0.05), 0.008, K.dark, 3);
  kit.boxE('paint', P(-0.4, 0.48, 0.05), new THREE.Euler(0, ry, 0), new THREE.Vector3(0.5, 0.04, 0.2), K.yellow);
  kit.tube('chrome', P(0.6, 2.2, 0), P(0.75, 0.3, 0.5), 0.008, K.dark, 3);
  kit.boxE('paint', P(0.8, 0.05, 0.6), new THREE.Euler(0, ry + 0.6, 0), new THREE.Vector3(0.5, 0.04, 0.2), K.blue);
}

function tricycle(kit: DecorKit, x: number, z: number, ry: number, col: RGB): void {
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, 0, z);
  const P = (a: number, b: number, c: number): THREE.Vector3 => new THREE.Vector3(a, b, c).applyMatrix4(m);
  const wheel = (a: number, c: number, r: number): void => {
    const g = new THREE.TorusGeometry(r, 0.025, 4, 10);
    kit.geo('paint', g, new THREE.Matrix4().makeRotationY(ry + Math.PI / 2).setPosition(P(a, r, c)), K.dark, { drift: 0 });
    g.dispose();
  };
  wheel(0, 0.35, 0.22);
  wheel(-0.2, -0.25, 0.13);
  wheel(0.2, -0.25, 0.13);
  kit.tube('paint', P(0, 0.22, 0.35), P(0, 0.6, 0.25), 0.025, col, 4);
  kit.tube('paint', P(0, 0.45, 0.28), P(0, 0.32, -0.25), 0.025, col, 4);
  kit.tube('paint', P(-0.2, 0.13, -0.25), P(0.2, 0.13, -0.25), 0.02, col, 4);
  kit.tube('chrome', P(-0.18, 0.6, 0.25), P(0.18, 0.6, 0.25), 0.015, K.chrome, 4);
  kit.boxE('fabric', P(0, 0.38, -0.12), new THREE.Euler(0, ry, 0), new THREE.Vector3(0.16, 0.04, 0.2), K.dark);
}

export function yardProps(d: Dress): void {
  const { kit, cards, decals, rng } = d;
  for (const sz of [1, -1]) {
    const Z = (z: number): number => z * sz;
    // West back gardens (x −45..−30, z 13..34).
    swingSet(kit, -42.2, Z(32.2), sz > 0 ? 0.05 : -0.08);
    tricycle(kit, -36.8, Z(28.2), sz > 0 ? 2.4 : 0.8, sz > 0 ? K.terraF : K.mint);
    // Ball + sandbox + toy wagon + hula hoop.
    kit.ball('paint', -38.2, 0.16, Z(26.7), 0.16, 0.16, 0.16, sz > 0 ? K.pink : K.yellow, 1);
    // Sandbox with a forgotten pail.
    kit.box('wood', -37.1, 0, Z(17.6) - 0.9, -35.3, 0.25, Z(17.6) + 0.9, K.woodDark, 0.02, { ao: 0.2 });
    kit.box('concrete', -36.95, 0.05, Z(17.6) - 0.75, -35.45, 0.22, Z(17.6) + 0.75, mix(K.sand, K.bone, 0.3), 0, { ao: 0.15 });
    kit.cyl('paint', -36.5, 0.22, Z(17.9), 0.1, 0.08, 0.16, sz > 0 ? K.blue : K.pink, 8);
    kit.ball('paint', -35.9, 0.24, Z(17.2), 0.18, 0.06, 0.14, K.terraF, 1);
    const hoop = new THREE.TorusGeometry(0.45, 0.02, 4, 18);
    hoop.rotateX(Math.PI / 2);
    kit.geo('paint', hoop, new THREE.Matrix4().makeTranslation(-33.8, 0.03, Z(31.2)), sz > 0 ? K.mint : K.pink, { drift: 0 });
    hoop.dispose();
    // Toy wagon (red-terracotta pull wagon).
    kit.boxR('paint', -37.4, 0.28, Z(20.6), 0.5, 0.18, 0.85, 0.5, mix(K.terraF, K.bone, 0.15), 0.03);
    for (const [a, c] of [
      [-0.22, -0.32],
      [0.22, -0.32],
      [-0.22, 0.32],
      [0.22, 0.32],
    ] as const) kit.ball('paint', -37.4 + a * Math.cos(0.5) + c * Math.sin(0.5), 0.1, Z(20.6) - a * Math.sin(0.5) + c * Math.cos(0.5), 0.1, 0.1, 0.03, K.dark, 0);
    // Lawn chairs (one folded in the grass) facing the old BBQ.
    lawnChair(kit, -37.4, Z(26.0), sz > 0 ? 2.6 : 0.6, sz > 0 ? K.yellow : K.mint);
    lawnChair(kit, -36.2, Z(26.9), sz > 0 ? 3.4 : -0.2, sz > 0 ? K.pink : K.blue, sz < 0);
    // Picnic blanket + basket (south yard), garden hose coil (north).
    if (sz > 0) {
      kit.boxR('fabric', -40.4, 0.02, Z(17.6), 1.8, 0.02, 1.5, 0.3, mix(K.pink, K.bone, 0.2), 0, { ao: 0 });
      kit.boxR('fabric', -40.4, 0.03, Z(17.6), 1.8, 0.02, 0.18, 0.3, K.terraF, 0, { ao: 0 });
      kit.boxR('fabric', -40.4, 0.03, Z(17.6), 0.18, 0.02, 1.5, 0.3, K.terraF, 0, { ao: 0 });
      kit.boxR('wood', -40.0, 0.14, Z(17.3), 0.5, 0.26, 0.34, 0.3, K.wood, 0.03);
      kit.tube('wood', new THREE.Vector3(-40.2, 0.28, Z(17.3)), new THREE.Vector3(-39.8, 0.28, Z(17.3)), 0.02, K.woodDark, 4);
      kit.ball('paint', -40.9, 0.06, Z(17.9), 0.05, 0.05, 0.05, K.terra, 1);
    } else {
      const coil = new THREE.TorusGeometry(0.3, 0.025, 4, 14);
      coil.rotateX(Math.PI / 2);
      for (let i = 0; i < 3; i++) kit.geo('paint', coil, new THREE.Matrix4().makeTranslation(-42.9, 0.03 + i * 0.045, Z(22.6)), mix(K.sage, K.mint, 0.5), { drift: 0 });
      coil.dispose();
    }
    // Leaves + flower beds along the fences; mailbox on the bungalow drive.
    decals.ground(DECAL.leaves, -38.5, Z(33.4), DY - 0.04, 3, 1.4, 0, [1, 1, 1, 1]);
    decals.ground(DECAL.leaves, -44.2, Z(24), DY - 0.04, 1.6, 2.8, 0.3, [1, 1, 1, 1]);
    mailbox(kit, -45.6, Z(36.6), Math.PI / 2, sz > 0 ? K.terraF : K.bone);
    mailbox(kit, 45.6, Z(36.6), -Math.PI / 2, sz > 0 ? K.mint : K.yellow);
    // East back lots behind the houses (x 17..30, z 27..40): lawn chairs, a
    // ball, the tricycle, glowing blossoms in the house's shade.
    lawnChair(kit, 27.2, Z(31.5), sz > 0 ? 0.9 : 2.3, K.blue);
    lawnChair(kit, 28.3, Z(32.4), sz > 0 ? 1.6 : 1.5, K.terraF, true);
    kit.ball('paint', 21.4, 0.16, Z(34.6), 0.16, 0.16, 0.16, K.mint, 1);
    tricycle(kit, 27.4, Z(37.6), 1.2, K.yellow);
    blossomBed(cards, 18.6, 0.005, Z(28.4), 1.6, rng);
  }
}

function mailbox(kit: DecorKit, x: number, z: number, ry: number, col: RGB): void {
  kit.cyl('wood', x, 0, z, 0.05, 0.05, 1.0, K.woodDark, 6);
  kit.boxR('paint', x, 1.12, z, 0.26, 0.26, 0.5, ry, col, 0.1);
  kit.boxR('paint', x + Math.cos(ry) * 0.14, 1.2, z - Math.sin(ry) * 0.14, 0.03, 0.2, 0.04, ry, K.terra, 0);
}

// ── Overgrowth ──────────────────────────────────────────────────────────────

const N = {
  px: new THREE.Vector3(1, 0, 0),
  nx: new THREE.Vector3(-1, 0, 0),
  pz: new THREE.Vector3(0, 0, 1),
  nz: new THREE.Vector3(0, 0, -1),
};

/**
 * Ivy on a vertical face: from `a` to `b` (two points ON the face at ground /
 * base height), climbing up to `h`, patchy (`fill` 0..1 of the length).
 */
function ivyRun(d: Dress, a: THREE.Vector3, b: THREE.Vector3, n: THREE.Vector3, h: number, fill: number, glow = false): void {
  const { kit, cards, rng } = d;
  const len = a.distanceTo(b);
  const k = Math.max(1, Math.round(len / 3.2));
  const seg = len / k;
  for (let i = 0; i < k; i++) {
    if (rng() > fill) continue;
    // Cards stay inside the run (ivy never floats past a wall end / doorway).
    const w = Math.min(seg * 0.95, 2.2 + rng() * 1.6);
    const t = (i + 0.5) / k + ((rng() - 0.5) * 0.6 * Math.max(0, seg - w)) / len;
    const p = a.clone().lerp(b, t);
    const hh = h * (0.45 + rng() * 0.55);
    ivy(cards, p, n, w, hh, rng, mix(LEAF.ivy, LEAF.sage, rng() * 0.3));
    // Glowing ground cover at the root of shaded ivy.
    if (glow && rng() < 0.55 * (0.5 + kit.detail * 0.5)) {
      const g = p.clone().addScaledVector(n, 0.45);
      const sf = surfaceAt(g.x, g.z);
      glowPatch(kit, cards, g.x, sf.kind === 'none' ? a.y : sf.y + 0.005, g.z, 0.9 + rng() * 0.6, rng);
    }
  }
}

/** Fringe + rain streaks along a roof edge (a→b at the edge top, face normal n). */
function edgeRun(d: Dress, a: THREE.Vector3, b: THREE.Vector3, n: THREE.Vector3, drop: number, fill: number, streaks = true): void {
  const { decals, cards, rng } = d;
  const len = a.distanceTo(b);
  const k = Math.max(1, Math.round(len / 3));
  for (let i = 0; i < k; i++) {
    const t0 = i / k;
    const t1 = (i + 1) / k;
    const p0 = a.clone().lerp(b, t0);
    const p1 = a.clone().lerp(b, t1);
    if (rng() < fill) fringe(cards, p0, p1, n, drop * (0.6 + rng() * 0.6), rng, mix(LEAF.olive, LEAF.sage, rng() * 0.5));
    if (streaks && rng() < 0.6 * (0.5 + d.kit.detail * 0.5)) {
      const m = p0.clone().lerp(p1, 0.5);
      const sh = 1.8 + rng() * 1.6;
      decals.wall(DECAL.streak, new THREE.Vector3(m.x, m.y - sh / 2 - 0.05, m.z), n, 2.4 + rng() * 1.2, sh, [1, 1, 1, 0.55 + rng() * 0.3], rng() < 0.5);
    }
  }
}

/** Moss mats + creeper cushions + a few leafy mounds on a flat roof. */
function roofMat(d: Dress, x0: number, z0: number, x1: number, z1: number, y: number, amount: number): void {
  const { kit, cards, decals, rng } = d;
  const area = Math.abs((x1 - x0) * (z1 - z0));
  const n = Math.round((area / 14) * amount * (0.5 + kit.detail * 0.5));
  for (let i = 0; i < n; i++) {
    const x = x0 + rng() * (x1 - x0);
    const z = z0 + rng() * (z1 - z0);
    const r = rng();
    if (r < 0.4) decals.ground(DECAL.moss, x, z, y + 0.012, 1.6 + rng() * 2.2, 1.6 + rng() * 2.2, rng() * 6, [1, 1, 1, 0.9]);
    else if (r < 0.7) cushion(cards, x, y, z, 1 + rng() * 1.4, rng, mix(LEAF.sage, LEAF.olive, rng()));
    else crown(kit, cards, new THREE.Vector3(x, y + 0.3, z), 0.7 + rng() * 0.4, 0.42, 0.7 + rng() * 0.4, rng, { tint: mix(LEAF.olive, LEAF.sunBleached, rng() * 0.5), density: 6, sway: 0.15, bias: 0.6 });
  }
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export function overgrowth(d: Dress): void {
  const { kit, cards, decals, rng } = d;
  // ── STARLIGHT MALL: the shaded north + east faces are swallowed, the sunny
  // south / west faces carry patches. Facade faces sit at ±12.16 (flutes).
  for (const sz of [1, -1]) {
    const north = sz < 0;
    const zf = 12.18 * sz;
    const n = sz > 0 ? N.pz : N.nz;
    ivyRun(d, V(-15, -0.05, zf), V(-8.2, -0.05, zf), n, north ? 7.6 : 6.0, north ? 1 : 0.8, north);
    ivyRun(d, V(8.2, -0.05, zf), V(15, -0.05, zf), n, north ? 7.6 : 5.6, north ? 1 : 0.8, north);
    // Pier edges either side of the sunburst.
    ivy(cards, V(-3.6, -0.05, zf + 0.06 * sz), n, 1.6, north ? 6.5 : 3.4, rng);
    ivy(cards, V(3.6, -0.05, zf + 0.06 * sz), n, 1.6, north ? 5.5 : 2.6, rng);
    // Roof fascia (8.7) spilling over: thick on the north, broken on the south.
    edgeRun(d, V(-16.2, 8.7, 13.24 * sz), V(-8.8, 8.7, 13.24 * sz), n, north ? 2.6 : 1.8, north ? 0.95 : 0.75);
    edgeRun(d, V(-3.2, 8.7, 13.24 * sz), V(3.2, 8.7, 13.24 * sz), n, north ? 1.8 : 1.0, north ? 0.7 : 0.35);
    edgeRun(d, V(8.8, 8.7, 13.24 * sz), V(16.2, 8.7, 13.24 * sz), n, north ? 2.6 : 1.8, north ? 0.95 : 0.75);
    // Leafy mounds cresting the roof fascia (silhouettes against the sky).
    for (let i = 0; i < Math.round(5 * (0.5 + kit.detail * 0.5)); i++) {
      const x = (rng() < 0.5 ? -1 : 1) * (9.2 + rng() * 6.4);
      crown(kit, cards, V(x, 8.95, 12.6 * sz), 0.9 + rng() * 0.6, 0.55, 0.7, rng, { tint: mix(LEAF.olive, LEAF.sunBleached, rng() * 0.5), density: 7, sway: 0.15, bias: 0.6 });
    }
    // STARLIGHT pylon: ivy swallowing the plinth and creeping up the shaded
    // east face over the sign (z ends stay readable).
    const pz0 = Math.min(18.5 * sz, 24.5 * sz);
    ivy(cards, V(0.86, 0, pz0 + 1.0), N.px, 1.8, 4.2 + rng(), rng);
    ivy(cards, V(0.86, 0, pz0 + 4.6), N.px, 1.6, 2.4, rng);
    ivy(cards, V(-0.86, 0, pz0 + 3.0), N.nx, 2.2, 1.8, rng);
    // East (shaded) / west (sunny) faces.
    for (const [z0, z1] of [
      [5.2, 12],
      [-12, -5.2],
    ] as const) {
      ivyRun(d, V(15.18, -0.05, z0), V(15.18, -0.05, z1), N.px, 7.4, 1, true);
      ivyRun(d, V(-15.18, -0.05, z0), V(-15.18, -0.05, z1), N.nx, 4.4, 0.6);
    }
  }
  edgeRun(d, V(16.24, 8.7, -13.2), V(16.24, 8.7, -5.4), N.px, 2.8, 1);
  edgeRun(d, V(16.24, 8.7, 5.4), V(16.24, 8.7, 13.2), N.px, 2.8, 1);
  edgeRun(d, V(-16.24, 8.7, -13.2), V(-16.24, 8.7, 13.2), N.nx, 1.2, 0.35);
  roofMat(d, -16, -13, -10.3, 13, 8.7, 1.2);
  roofMat(d, 10.3, -13, 16, 13, 8.7, 1.4);

  // ── Garage rows (x ±15..30, z ±12..15.6, 5 m): ivy on the door faces where
  // the doors allow, the street ends, fringe off the gutter, mossy roofs.
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const zf = 11.98 * sz;
      const shaded = sz > 0; // z = +12 faces north (shade)
      const n = sz > 0 ? N.nz : N.pz;
      // Between / beside the roll-up doors (x 28.6..25.4, 24.3..21.1, 20..16.8).
      for (const [xa, w] of [
        [29.55, 0.55],
        [24.85, 0.65],
        [15.9, 0.7],
      ] as const) ivy(cards, V(xa * sx, 0, zf), n, w, shaded ? 4.6 : 3.0, rng);
      edgeRun(d, V(15 * sx, 5.0, 11.95 * sz), V(30 * sx, 5.0, 11.95 * sz), n, shaded ? 1.6 : 1.0, shaded ? 0.9 : 0.5);
      // Street end (x = ±30): faces the sidewalk, shaded on the east.
      const ne = sx > 0 ? N.px : N.nx;
      ivyRun(d, V(30.02 * sx, 0, 12.2 * sz), V(30.02 * sx, 0, 15.4 * sz), ne, 4.8, sx > 0 ? 1 : 0.6, sx > 0);
      roofMat(d, Math.min(15 * sx, 30 * sx), Math.min(12 * sz, 15.6 * sz), Math.max(15 * sx, 30 * sx), Math.max(12 * sz, 15.6 * sz), 5.0, 1.3);
      if (shaded) for (const x of [27, 22.6, 18.4]) glowPatch(kit, cards, x * sx, 0.03, 11.2 * sz, 0.8, rng);
    }
  }

  // ── Two-storey houses (|x| 17..30, |z| 16..27): ivy on the yard-facing long
  // wall and around the end-wall door slots, fringe off the roof.
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const zl = 27.02 * sz;
      const nl = sz > 0 ? N.pz : N.nz;
      ivyRun(d, V(17.4 * sx, 0, zl), V(29.6 * sx, 0, zl), nl, 4.8, sz < 0 ? 0.9 : 0.6, sz < 0);
      for (const xe of [17, 30]) {
        const ne = (xe === 17) === sx > 0 ? N.nx : N.px;
        const xx = (xe === 17 ? 16.98 : 30.02) * sx;
        ivy(cards, V(xx, 0, 17.2 * sz), ne, 1.4, 3.6 + rng() * 1.2, rng);
        ivy(cards, V(xx, 0, 25.8 * sz), ne, 1.4, 3.2 + rng() * 1.6, rng);
      }
      // Outer roof edge over the balcony: short fringes only (bottom ≥ 4.4 m,
      // above a standing player's eye on the balcony), none over the door slot.
      edgeRun(d, V(30.3 * sx, 5.1, 16 * sz), V(30.3 * sx, 5.1, 19.6 * sz), sx > 0 ? N.px : N.nx, 0.45, 0.8, false);
      edgeRun(d, V(30.3 * sx, 5.1, 23.4 * sz), V(30.3 * sx, 5.1, 27 * sz), sx > 0 ? N.px : N.nx, 0.45, 0.8, false);
      roofMat(d, Math.min(17 * sx, 30 * sx), Math.min(16 * sz, 27 * sz), Math.max(17 * sx, 30 * sx), Math.max(16 * sz, 27 * sz), 5.1, 0.9);
    }
  }

  // ── Bungalows (|x| 45..54, |z| 15..25, roof 2.95) + carports.
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const yard = sx > 0 ? N.nx : N.px;
      const xf = 44.98 * sx;
      ivy(cards, V(xf, 0, 15.6 * sz), yard, 1.2, 2.8, rng);
      ivy(cards, V(xf, 0, 24.6 * sz), yard, 1.0, 2.6, rng);
      const front = sz > 0 ? N.nz : N.pz;
      ivy(cards, V(46.4 * sx, 0, 14.98 * sz), front, 1.8, 2.7, rng);
      ivy(cards, V(53.2 * sx, 0, 14.98 * sz), front, 1.4, 2.9, rng);
      edgeRun(d, V(45 * sx, 2.95, 15 * sz), V(54 * sx, 2.95, 15 * sz), front, 0.75, 0.75);
      edgeRun(d, V(44.98 * sx, 2.95, 15.2 * sz), V(44.98 * sx, 2.95, 20.4 * sz), yard, 0.6, 0.5, false);
      roofMat(d, Math.min(45 * sx, 54 * sx), Math.min(15 * sz, 25 * sz), Math.max(45 * sx, 54 * sx), Math.max(15 * sz, 25 * sz), 2.95, 1.6);
      // Carport roof (2.55) creeper + glowing ground cover underneath (shade).
      roofMat(d, Math.min(46 * sx, 54 * sx), Math.min(25 * sz, 31 * sz), Math.max(46 * sx, 54 * sx), Math.max(25 * sz, 31 * sz), 2.56, 1.4);
      glowPatch(kit, cards, 47.2 * sx, 0.035, 26.2 * sz, 0.9, rng);
      glowPatch(kit, cards, 53.4 * sx, 0.035, 29.6 * sz, 0.8, rng);
    }
  }

  // ── Corner house (x 44..54, z ±6, 5.5): the north face is a wall of ivy.
  ivyRun(d, V(44.4, 0, -6.02), V(53.6, 0, -6.02), N.nz, 5.4, 1, true);
  ivyRun(d, V(44.4, 0, 6.02), V(53.6, 0, 6.02), N.pz, 4.0, 0.6);
  edgeRun(d, V(44, 5.5, -6.05), V(54, 5.5, -6.05), N.nz, 2.0, 1);
  roofMat(d, 44, -6, 54, 6, 5.5, 1.2);

  // ── Cabana (x −54..−47.5, z ±3.5, 4.4).
  ivyRun(d, V(-53.6, 0, -3.52), V(-47.8, 0, -3.52), N.nz, 4.2, 1, true);
  ivyRun(d, V(-53.6, 0, 3.52), V(-47.8, 0, 3.52), N.pz, 3.0, 0.5);

  // ── Spawn screen walls (lot side) + breeze walls: ivy and coping fringes.
  for (const sz of [1, -1]) {
    const zf = 39.98 * sz;
    const n = sz > 0 ? N.nz : N.pz;
    ivyRun(d, V(-25.6, 0, zf), V(-12, 0, zf), n, 3.2, sz < 0 ? 0.9 : 0.6, sz < 0);
    ivyRun(d, V(12, 0, zf), V(25.6, 0, zf), n, 3.2, sz < 0 ? 0.9 : 0.6, sz < 0);
    edgeRun(d, V(-26, 3.32, zf), V(26, 3.32, zf), n, 1.0, 0.45, false);
    ivyRun(d, V(-53.6, 0, zf), V(-36.4, 0, zf), n, 2.8, 0.55);
    ivyRun(d, V(36.4, 0, zf), V(53.6, 0, zf), n, 2.8, 0.55);
    // Loading screen in the west alley + bus shelter back.
    ivy(cards, V(-27.8, 0, 6.42 * sz), sz > 0 ? N.pz : N.nz, 2.6, 3.4, rng);
    ivy(cards, V(-23.4, 0, 5.98 * sz), sz > 0 ? N.nz : N.pz, 2.2, 3.0, rng);
    // Shed (x −42..−39, z 19..22).
    ivy(cards, V(-39.0 + 0.02, 0, 20.5 * sz), N.px, 2.4, 2.2, rng);
  }

  // ── Shade bioluminescence: pergola feet, under the trees, fence lines.
  const shadeSpots: [number, number, number][] = [
    [-24.6, 29.5, 1.1],
    [-24.6, 37.5, 0.9],
    [24.6, 30.5, 1.0],
    [24.6, 36.2, 1.2],
    [-46.2, 8.6, 1.0],
    [-31.4, 8.4, 0.9],
    [-45.6, 33.4, 1.2],
    [-37.6, 33.4, 0.9],
    [43.4, 9.6, 0.8],
    [30.5, 26.4, 0.6],
    [-30.6, 13.2, 0.8],
    [-52.4, 36.4, 1.1],
    [52.6, 36.8, 1.0],
  ];
  for (const sz of [1, -1]) {
    for (const [x, z, s] of shadeSpots) {
      // The north (Bloom) half is the more overgrown one.
      if (sz > 0 && rng() < 0.3) continue;
      const g = surfaceAt(x, z * sz);
      glowPatch(kit, cards, x, g.y + 0.005, z * sz, s * (sz < 0 ? 1.2 : 1), rng);
    }
  }
  // Ground creepers + leaf litter under each street tree, glowing strands
  // in the north alley, fern clumps along the fence lines.
  for (let i = 0; i < Math.round(18 * kit.detail); i++) {
    const x = -44.5 + rng() * 8;
    const z = (rng() < 0.5 ? 1 : -1) * (33.2 + rng() * 0.6);
    fern(cards, x, 0, z, 0.35 + rng() * 0.25, rng);
  }
  void decals;
}

/** Leaf litter + creepers under one tree (called from the tree list). */
export function treeFloor(d: Dress, x: number, z: number, r: number): void {
  const { decals, cards, rng } = d;
  const s = surfaceAt(x, z);
  const y = s.kind === 'none' ? 0 : s.y;
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2;
    const rr = rng() * r * 0.8;
    decals.ground(DECAL.leaves, x + Math.cos(a) * rr, z + Math.sin(a) * rr, y + DY, r * 1.1, r * 1.1, rng() * 6, [1, 1, 1, 1]);
  }
  if (s.kind === 'lawn' || s.kind === 'none') {
    cushion(cards, x + 0.6, y, z - 0.4, r * 0.8, rng, LEAF.olive);
    if (rng() < 0.7) glowPatch(d.kit, cards, x + (rng() - 0.5) * 1.6, y, z + (rng() - 0.5) * 1.6, 0.8, rng);
  }
}

// ── Lawns & foundations ─────────────────────────────────────────────────────

function trashCan(kit: DecorKit, x: number, z: number, tipped: number | null, col: RGB): void {
  if (tipped === null) {
    kit.cyl('metal', x, 0, z, 0.27, 0.24, 0.85, col, 10, { ao: 0.3 });
    kit.cyl('metal', x, 0.85, z, 0.3, 0.3, 0.06, mix(col, K.dark, 0.2), 10);
    return;
  }
  const g = kit.cylGeo(0.27, 0.24, 10);
  kit.geo('metal', g, new THREE.Matrix4().makeTranslation(x, 0.27, z).multiply(new THREE.Matrix4().makeRotationY(tipped)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(1, 0.85, 1)), col, { drift: 0.1 });
  // Lid rolled off + spilled bags.
  kit.cyl('metal', x + Math.cos(tipped) * 1.1, 0, z - Math.sin(tipped) * 1.1, 0.3, 0.3, 0.05, mix(col, K.dark, 0.2), 10);
  for (let i = 0; i < 2; i++) kit.ball('fabric', x - Math.cos(tipped) * (0.75 + i * 0.4), 0.16, z + Math.sin(tipped) * (0.75 + i * 0.4) + (i - 0.5) * 0.3, 0.26, 0.18, 0.22, mix(K.dark, K.boneShade, 0.35), 0);
}

/**
 * Foundation plantings along house walls, shrub borders, dry / mossy lawn
 * patches, clover and glowing blossoms in the shade, trash cans by the drives.
 */
export function lawnLife(d: Dress): void {
  const { kit, cards, decals, rng } = d;
  const det = kit.detail;
  // Low shrubs (≤ 0.7 m) hugging the yard-facing house walls.
  const border = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.round((len / 2.2) * (0.5 + det * 0.5));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.3 + rng() * 0.4) / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      if (rng() < 0.6) bush(kit, cards, x, 0, z, 0.5 + rng() * 0.25, 0.32 + rng() * 0.12, 0.5 + rng() * 0.25, rng);
      else fern(cards, x, 0, z, 0.4 + rng() * 0.2, rng);
    }
  };
  for (const sz of [1, -1]) {
    for (const sx of [1, -1]) {
      // Two-storey houses, yard side (z = ±27), away from the patio doors.
      border(18 * sx, 27.55 * sz, 23.4 * sx, 27.55 * sz);
      border(25.8 * sx, 27.55 * sz, 29.4 * sx, 27.55 * sz);
      // Bungalow yard walls.
      border(44.45 * sx, 16 * sz, 44.45 * sx, 19.8 * sz);
    }
    // Corner house + cabana flanks.
    border(45, 6.55 * sz, 53.4, 6.55 * sz);
    border(-53.4, 4.05 * sz, -48, 4.05 * sz);
  }
  // Lawn texture: dry patches in the sun, deep moss in the shade, clover.
  const lawn = (n: number, f: (x: number, z: number) => void): void => {
    for (let i = 0, k = 0; i < n * 6 && k < n; i++) {
      const x = -53 + rng() * 106;
      const z = -53 + rng() * 106;
      if (surfaceAt(x, z).kind !== 'lawn') continue;
      k++;
      f(x, z);
    }
  };
  lawn(Math.round(70 * det), (x, z) => decals.ground(DECAL.sand, x, z, 0.012, 2 + rng() * 2.5, 1.6 + rng() * 2, rng() * 6, [0.95, 0.92, 0.85, 0.6 + rng() * 0.3]));
  lawn(Math.round(50 * det), (x, z) => decals.ground(DECAL.moss, x, z, 0.013, 1.8 + rng() * 2, 1.8 + rng() * 2, rng() * 6, [0.85, 0.9, 0.85, 0.8]));
  lawn(Math.round(40 * det), (x, z) => decals.ground(DECAL.leaves, x, z, 0.014, 1.4 + rng() * 1.4, 1.4 + rng() * 1.4, rng() * 6, [1, 1, 1, 0.9]));
  lawn(Math.round(60 * det), (x, z) => cushion(cards, x, 0, z, 0.9 + rng() * 1.2, rng, mix(LEAF.sage, LEAF.olive, rng())));
  // Trash cans by the drives (one knocked over, bags split).
  for (const sz of [1, -1]) {
    trashCan(kit, -45.4, 34.6 * sz, null, mix(K.concreteDark, K.blue, 0.3));
    trashCan(kit, -45.4, 35.4 * sz, sz > 0 ? 2.2 : null, mix(K.concreteDark, K.mint, 0.3));
    trashCan(kit, 45.5, 35.0 * sz, sz < 0 ? 0.6 : null, mix(K.concreteDark, K.sand, 0.3));
  }
  trashCan(kit, 30.5, -15.8, 1.4, mix(K.concreteDark, K.yellow, 0.25));
}
