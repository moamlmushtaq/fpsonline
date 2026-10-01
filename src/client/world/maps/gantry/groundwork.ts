// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry ground detail (art pass 2): the apron reads as a
// weathered, used launch site at every distance —
//  • slab-by-slab tone patchwork + hairline cracks across the concrete,
//  • the scorched blast fan around the trench mouth and the launch mount,
//  • faded hazard bands and KEEP CLEAR stencils, oil stains, damp puddles,
//  • sand drifting in from the dunes over the west edge, with dune grass,
//  • cable trays along the pad, tyre tracks down the docks, wind-blown debris,
//  • contact-shadow blobs under every free-standing prop (engine helper).
// Everything is flat or ankle-high (walk-over, no collision), batched into the
// kit's 'decal' / existing kinds, and thinned by `decor` on lower presets.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { GANTRY_DECK as D, GANTRY_PIER_Y as PY, GANTRY_ROCKET } from '../../../../shared/maps/gantry';
import { ENV } from '../../../engine/palette';
import { bush, nearSolid } from './compounds';
import { box, contact, DecorKit, floorQuad } from './kit';
import { cableTray, floorDecal, rock } from './props';
import { uvD } from './decals';

const SLAB_TINTS = ['#ece4d4', '#9a9282', '#ddd2bd', '#918a7c', '#f0e6d4', '#aaa08d'];

/** Tyre-track decal chain along a polyline (one quad per segment, ≤ 6 m each). */
export function tyreTrack(kit: DecorKit, pts: [number, number][], y = 0, width = 1.7): void {
  const [u0, v0, u1, v1] = uvD('tyre');
  const natural = width * 4; // the region is 4:1
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / natural));
    for (let k = 0; k < n; k++) {
      const f0 = k / n;
      const f1 = (k + 1) / n;
      const x0 = ax + (bx - ax) * f0;
      const z0 = az + (bz - az) * f0;
      const x1 = ax + (bx - ax) * f1;
      const z1 = az + (bz - az) * f1;
      const l = len / n;
      const g = floorQuad((x0 + x1) / 2, y + 0.007, (z0 + z1) / 2, l + 0.05, width, [u0, v0, u0 + (u1 - u0) * Math.min(1, l / natural), v1], Math.atan2(-(z1 - z0), x1 - x0));
      kit.add('decal', g, '#ffffff', { flat: true });
    }
  }
}

/** Low sand hump (ankle-high), half sunk into the ground. */
export function sandHump(kit: DecorKit, x: number, z: number, rx: number, rz: number, h: number, rot = 0, y = 0): void {
  // A gaussian-ish mound (tangent to the ground at its rim, so it never reads
  // as a disc), with a soft drift decal feathering the edge.
  const seg = kit.low ? 10 : 14;
  const rings = new THREE.RingGeometry(0.0001, 1, seg, 3);
  const p = rings.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i);
    const py = p.getY(i);
    const r = Math.min(1, Math.hypot(px, py));
    p.setXYZ(i, px, py, Math.pow(Math.cos((r * Math.PI) / 2), 2));
  }
  rings.rotateX(-Math.PI / 2);
  rings.computeVertexNormals();
  rings.scale(rx, h, rz);
  rings.rotateY(rot);
  rings.translate(x, y - 0.01, z);
  kit.add('sand', rings, ENV.sand, { shade: (_x, yy) => 0.97 + 0.07 * Math.min(1, (yy - y) / Math.max(0.05, h)) });
}


/**
 * A rain puddle: the damp, darkened concrete (soft decal), a thin glossy
 * film (sharp sun glints on medium/high) and the evening sky mirrored in it as
 * a soft additive sheen — soft-edged on every preset, never a hard disc.
 */
export function puddle(kit: DecorKit, rnd: () => number, x: number, y: number, z: number, r: number): void {
  const rot = rnd() * Math.PI;
  const sq = 0.65 + rnd() * 0.3;
  floorDecal(kit, 'damp', x, y, z, r * 3.0, r * 3.0 * sq, rot);
  if (!kit.low) kit.add('wet', floorQuad(x, y + 0.012, z, r * 2.3, r * 2.3 * sq, uvD('damp'), rot + 0.7), '#9aa6ad', { flat: true });
  kit.add('pool', floorQuad(x, y + 0.03, z, r * 2.2, r * 2.2 * sq, undefined, rot), '#d9c2c4', { flat: true, k: kit.low ? 0.3 : 0.22 });
}

export function buildGroundDetail(kit: DecorKit, rnd: () => number, decor: number): void {
  const blocked = (x: number, z: number, m: number): boolean => nearSolid(kit, x, z, m);

  // ── Slab patchwork: each 6 m slab cast on its own day, some re-poured ──────
  const xs = [-35, -30];
  for (let x = -24; x <= 54; x += 6) xs.push(x);
  xs.push(56);
  const zs: number[] = [];
  for (let z = -60; z <= 60; z += 6) zs.push(z);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      if (rnd() > 0.5) continue;
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      if (blocked(cx, cz, -1.5)) continue;
      const w = xs[i + 1] - xs[i] - 0.12;
      const d = zs[j + 1] - zs[j] - 0.12;
      floorDecal(kit, 'slab', cx, -0.004, cz, w, d, rnd() < 0.5 ? 0 : Math.PI, SLAB_TINTS[Math.floor(rnd() * SLAB_TINTS.length)]);
    }
  }

  // Dried water marks and sun-bleached patches: low-frequency tonal variation
  // that keeps the big apron from reading as one flat plane at player height.
  for (let i = 0; i < Math.round(26 + 40 * decor); i++) {
    const x = -34 + rnd() * 89;
    const z = -59 + rnd() * 118;
    if (blocked(x, z, 1)) continue;
    const s = 3 + rnd() * 4;
    floorDecal(kit, 'damp', x, -0.002, z, s, s * (0.6 + rnd() * 0.4), rnd() * Math.PI, rnd() < 0.6 ? '#c9c0b2' : '#ffffff');
  }

  // ── Hairline cracks across the apron, the deck and the forecourts ─────────
  const nCracks = Math.round(130 * decor);
  for (let i = 0; i < nCracks; i++) {
    const x = -34 + rnd() * 89;
    const z = -59 + rnd() * 118;
    if (blocked(x, z, 0.4)) continue;
    const s = 2.2 + rnd() * 3.2;
    floorDecal(kit, rnd() < 0.5 ? 'crackA' : 'crackB', x, 0, z, s, s, rnd() * Math.PI * 2);
  }
  // Weeds pushing up through the cracks (small tufts, never on walk lines' cover).
  for (let i = 0; i < Math.round(60 * decor); i++) {
    const x = -34 + rnd() * 89;
    const z = -58 + rnd() * 116;
    if (blocked(x, z, 0.5) || (x > -16.5 && x < 16.5 && Math.abs(z) < 17.5)) continue;
    bush(kit, x, 0, z, 0.28 + rnd() * 0.3, rnd() * Math.PI, true);
    if (rnd() < 0.5) floorDecal(kit, rnd() < 0.5 ? 'crackA' : 'crackB', x, 0, z, 1.4, 1.4, rnd() * 6);
  }
  for (let i = 0; i < Math.round(14 * decor); i++) {
    const x = -15 + rnd() * 30;
    const z = (rnd() - 0.5) * 33;
    if (Math.abs(z) < 4.5 && x > -14 && x < 8) continue; // mount / tower / grate
    const s = 1.6 + rnd() * 1.8;
    floorDecal(kit, rnd() < 0.5 ? 'crackA' : 'crackB', x, D + 0.004, z, s, s, rnd() * Math.PI * 2);
  }

  // ── Blast scorch: trench mouth fan, launch mount, trench floor ────────────
  floorDecal(kit, 'scorch', 17.4, 0.001, 0, 8, 12, Math.PI / 2, '#ffffff');
  floorDecal(kit, 'scorch', 17.2, 0.0012, 0, 5, 9, Math.PI / 2 + 0.2, '#ffffff');
  floorDecal(kit, 'soot', 16.8, 0.0015, 0, 2.6, 8.5, Math.PI / 2);
  floorDecal(kit, 'scorch', GANTRY_ROCKET.x, D + 0.004, 0, 16, 16, 0.3);
  floorDecal(kit, 'scorch', 3, 0.012, 0, 9, 6.6, 0);
  floorDecal(kit, 'scorch', 11, 0.012, 0, 8, 6.4, 1.2);

  // ── Faded floor paint: hazard bands, KEEP CLEAR, door thresholds ──────────
  floorDecal(kit, 'hazardFaded', 16.6, 0.003, 0, 8.6, 0.55, Math.PI / 2);
  for (const s of [-1, 1]) {
    floorDecal(kit, 'keepClear', 17.55, 0.003, s * 6.4, 4.4, 0.55, Math.PI / 2);
    floorDecal(kit, 'hazardFaded', 3, 0.003, s * 26.45, 6, 0.5, 0);
    floorDecal(kit, 'keepClear', -8, 0.003, s * 18.45, 2.5, 0.34, s > 0 ? Math.PI : 0);
    floorDecal(kit, 'hazardFaded', 0, 0.003, s * 45.35, 12, 0.5, 0);
    floorDecal(kit, 'hazardFaded', s * 16.25, 0.003, s < 0 ? -45.35 : 45.35, 3.5, 0.45, 0);
    // Pad perimeter keep-out band on the apron faces around the crawler ramps.
    floorDecal(kit, 'hazardFaded', 11.5, 0.003, s * 17.6, 8, 0.4, 0);
    floorDecal(kit, 'hazardFaded', -13, 0.003, s * 17.6, 5.5, 0.4, 0);
  }

  // ── Oil stains (vehicle bays, pumps, the old tanker's spot) ───────────────
  const oil: [number, number, number][] = [
    [-26, -51, 1.6],
    [-25, 50, 1.4],
    [10, -33, 2.4],
    [12, 34, 2.0],
    [-44, -8.5, 1.3],
    [-43, 8.4, 1.1],
    [50, -22, 1.8],
    [41, 26, 1.5],
    [28, 14, 1.2],
    [-27.8, -48.2, 1.1],
    [8.5, 27.3, 1.3],
    [44, -44, 1.1],
    [33.5, -26, 1.0],
  ];
  for (const [x, z, r] of oil) floorDecal(kit, 'oil', x, 0.001, z, r * 2, r * 1.6, rnd() * Math.PI);

  // ── Puddles (drains, low spots by the seawall, the forecourts) ────────────
  const puddles: [number, number, number][] = [
    [-12.7, -21.5, 1.0],
    [-12.4, 22.1, 0.9],
    [20.7, -31.2, 0.9],
    [40.8, 9.4, 1.1],
    [47.5, -41, 1.2],
    [35, 44.5, 1.0],
    [-30.5, -40.5, 0.8],
    [-27.5, 38.5, 1.1],
    [-2.5, 42.6, 0.9],
    [53, -36, 1.4],
    [50.5, 31, 1.2],
    [43, 3, 1.0],
    [27, 33, 0.8],
  ];
  for (const [x, z, r] of puddles) {
    if (blocked(x, z, r * 0.6)) continue;
    puddle(kit, rnd, x, 0, z, r);
  }

  // ── Sand pushing in from the dunes over the west edge of the apron ────────
  for (let z = -58; z <= 58; z += 3.6) {
    const zz = z + (rnd() - 0.5) * 2;
    if (blocked(-34, zz, 0.3)) continue;
    // (Drift decals sit on the concrete side only: on sand they read as discs.)
    floorDecal(kit, 'drift', -33.6 + rnd() * 0.8, 0.002, zz, 3.0 + rnd() * 2.4, 2.4 + rnd() * 1.6, rnd() * Math.PI);
  }
  // Wind ripples break up the tank farm's sand.
  for (let i = 0; i < Math.round(30 * decor); i++) {
    const x = -63 + rnd() * 27;
    const z = -58 + rnd() * 116;
    if (blocked(x, z, 0.5)) continue;
    floorDecal(kit, 'sandRipple', x, 0.001, z, 3 + rnd() * 3, 3 + rnd() * 3, rnd() * Math.PI, rnd() < 0.5 ? '#ffffff' : '#efe2c8');
  }
  // Drifts banked against the fences and the tank plinths.
  for (const s of [-1, 1]) {
    for (let x = -62; x < -36; x += 4.5 + rnd() * 2) sandHump(kit, x, s * 59.7, 2.6 + rnd() * 1.4, 1.0 + rnd() * 0.4, 0.34 + rnd() * 0.2, 0);
  }
  // Dune grass at the drift edges and in the lee of the tanks.
  for (let i = 0; i < Math.round(46 * decor); i++) {
    const west = rnd() < 0.6;
    const x = west ? -36.4 + rnd() * 2.4 : -63.5 + rnd() * 27;
    const z = -58 + rnd() * 116;
    if (blocked(x, z, 0.5)) continue;
    bush(kit, x, 0, z, 0.45 + rnd() * 0.55, rnd() * Math.PI, true);
  }

  // ── Cable trays along the pad's long faces (into the wall at each end) ────
  for (const s of [-1, 1]) {
    for (const [x0, x1] of [
      [-15.6, -10.1],
      [-6.1, -0.3],
      [6.3, 15.6],
    ] as [number, number][]) {
      cableTray(kit, x0, s * 17.36, x1, s * 17.36);
      kit.add('metal', box(x0 - 0.05, 0, s * 17.05, x0 + 0.12, 0.6, s * 17.55), '#6d6a64', { flat: true });
    }
  }

  // ── Tyre tracks down the dock lane and from the tanker into the sand ──────
  tyreTrack(kit, [
    [36, -48],
    [40.6, -44.5],
    [42.4, -35],
    [42.6, -24],
    [42.3, -11],
    [41.4, 0],
    [42.3, 11],
    [42.6, 24],
    [42.4, 35],
    [40.6, 44.5],
    [36, 48],
  ]);
  tyreTrack(kit, [
    [-25, -48.8],
    [-30, -45.6],
    [-35, -43.4],
  ]);
  tyreTrack(kit, [
    [-25, 48.8],
    [-30.6, 45.2],
    [-35, 43.2],
  ]);

  // ── Wind-blown debris, leaf litter and broken concrete along wall feet ────
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < Math.round(70 * decor); tries++) {
    const x = -62 + rnd() * 117;
    const z = -59 + rnd() * 118;
    if (!blocked(x, z, 1.4) || blocked(x, z, 0.25)) continue;
    placed++;
    const t = rnd();
    if (t < 0.4) floorDecal(kit, 'debris', x, 0.001, z, 1 + rnd() * 1.2, 1 + rnd() * 1.2, rnd() * Math.PI);
    else if (t < 0.6 || (z > 0 && t < 0.75)) floorDecal(kit, 'leaves', x, 0.001, z, 0.9 + rnd() * 1.1, 0.9 + rnd() * 1.1, rnd() * Math.PI);
    else for (let k = 0; k < 3; k++) rock(kit, rnd, x + (rnd() - 0.5) * 0.8, 0.03, z + (rnd() - 0.5) * 0.8, 0.05 + rnd() * 0.09, '#b8b0a2', 'concrete');
  }

  // ── Contact shadows under the existing free-standing props ────────────────
  for (const s of [-1, 1]) {
    contact(kit, -43.5, 0, s * 8.5, 2.1, 1.4);
    contact(kit, -4.8, 0, s * 30.1, 1.6, 1.1);
    contact(kit, -26, 0, s * 51.8, 4.8, 1.7);
    contact(kit, 11, 0, s * 31.5, 5.8, 4.4);
    contact(kit, -20.1, 0, s * 11, 2.0, 1.5);
    contact(kit, 16.8, 0, s * 13, 1.2, 1.3);
    contact(kit, 17.3, 0, s * 10, 1.8, 2.6);
    contact(kit, 61, PY, s * 14, 1.4, 1.4);
    contact(kit, -44.5, 0, s * 18.2, 5.8, 2.4);
  }
  contact(kit, -43.2, 0, 0, 1.3, 1.5);
  contact(kit, 50, 0, 0, 3.8, 1.4);
  wallBaseAO(kit);
}

/**
 * Grime / ambient occlusion along the foot of every ground-standing wall and
 * prop (the engine's contact-shadow blob laid in overlapping runs along each
 * side): the strongest single cue that grounds buildings on Low, where there
 * is no real-time shadowing, and a painterly dirt line everywhere else.
 */
function wallBaseAO(kit: DecorKit): void {
  for (const so of kit.ctx.def.solids) {
    // Drawn masses only (walls, buildings, containers, the pad); decor-drawn
    // 'hidden' props get hand-placed blobs that match their real footprint.
    if (so.style === 'ground' || so.style === 'pier' || so.style === 'hidden' || so.ramp || so.shootThrough) continue;
    if (so.min.y > 0.05 || so.max.y - so.min.y < 0.9) continue;
    aoBox(kit, so.min.x, so.min.z, so.max.x, so.max.z, so.min.y);
  }
  // Decor-drawn masses that meet the ground along their whole footprint.
  for (const s of [-1, 1]) {
    aoBox(kit, -58.45, s * 28.55, -47.55, s * 39.45, 0); // LOX sphere plinths
    aoBox(kit, -64.4, s * 5.55, -56.4, s * 6.05, 0); // bunker side walls
  }
  aoBox(kit, -54.6, -6.3, -53.95, 6.3, 0); // bunker window sill
  aoBox(kit, -60.2, -3.6, -59, 3.6, 0); // console row
  aoBox(kit, 18.42, -1.5, 22, 1.5, 0); // deluge valve house
  aoBox(kit, -24, -1.5, -21, 1.5, 0); // fuel valve station
}

/** Wall-foot AO around an axis-aligned footprint standing at height y. */
export function aoBox(kit: DecorKit, x0: number, z0: number, x1: number, z1: number, y: number): void {
  const STEP = 2.4;
  const W = 1.35; // blob half-width across the wall foot
  const OUT = 0.35; // core pushed out of the wall so the dark edge sits at its foot
  const sx = x1 - x0;
  const sz = z1 - z0;
  if (sx < 0.3 || sz < 0.3) return;
  const w = Math.min(W, 0.5 + Math.min(sx, sz) * 0.35); // small props: tighter blobs
  for (const [len, fixed, horizontal, out] of [
    [sx, z0, true, -1],
    [sx, z1, true, 1],
    [sz, x0, false, -1],
    [sz, x1, false, 1],
  ] as [number, number, boolean, number][]) {
    const n = Math.max(1, Math.round(len / STEP));
    const seg = len / n;
    const o = out * OUT * (w / W);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * seg;
      if (horizontal) contact(kit, x0 + t, y, fixed + o, seg * 0.8 + 0.5, w);
      else contact(kit, fixed + o, y, z0 + t, w, seg * 0.8 + 0.5);
    }
  }
}
