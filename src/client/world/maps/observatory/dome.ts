// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Observatory: the telescope building (center landmark).
//
//  • Static (main kit): the 24 m brutalist base (board-formed bone concrete,
//    ribbed facades, deep door portals with canopies, slit windows, cornice),
//    the ceramic drum, the TELESCOPE HALL (terrazzo floor with a brass meridian
//    line, gallery ring on cantilever brackets, see-through railings, four
//    steel stairs, the observing podium with the observer's desk — thermos and
//    lunch box — star charts, the chalkboard of orbital math, warm pendant
//    lamps) and the two glazed arcades.
//  • Rotating group (own kit): the dome shell with its open slit (shutters slid
//    back over the crown), the bogie skirt, a crown beacon, and the telescope
//    (fork + Serrurier truss tube) that turns with the slit. The cold starlight
//    shaft through the slit is parented to it, so it sweeps with the dome.
// Collision lives in src/shared/maps/observatory.ts (OBS constants).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { OBS } from '../../../../shared/maps/observatory';
import { createLightShaft } from '../../../engine/atmosphere';
import { ENV } from '../../../engine/palette';
import { rect } from './atlas';
import { beam, box, cyl, cylAB, floorQuad, invert, lathe, ObsKit, quad, rbox, smooth, sphere, trs, tube } from './kit';

const G = OBS.gallery;
const B = OBS.baseHalf;
const TOP = OBS.baseTop;
const HD = OBS.doorHalf;
const DT = OBS.doorTop;
const HE = OBS.hallHalfEW;
const HH = OBS.hallHalf;
const PH = OBS.podiumHalf;

const BONE = ENV.bone;
const CONCRETE = '#d6cdbd';
const STEEL = '#6d7076';
const DARK = '#3a3a40';
/** Hall steelwork (lamp-lit interior kind): warm greys so the hall reads lit, not sky-blue. */
const STEEL_IN = '#7a7068';
const GRATE = '#958a7e';

export interface DomeParts {
  /** Rotating group (dome shell + telescope + shaft). Its origin is the map origin. */
  rotor: THREE.Group;
  kit: ObsKit;
  beacon: THREE.MeshBasicMaterial;
  shafts: THREE.Object3D[];
  /** Invisible shadow caster for the open drum (see buildDome). */
  caster: THREE.Mesh | null;
}

// ── Static: base, drum, hall, arcades ───────────────────────────────────────

export function buildObservatoryStatic(kit: ObsKit, rnd: () => number, decor: number): void {
  kit.section = 'dome.base';
  const board = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
    // Board-formed concrete: faint horizontal pour lines + darker foot.
    let s = 0.64 + 0.36 * smooth(0, 1.6, y);
    if (Math.abs(ny) < 0.5) s *= 0.97 + 0.03 * Math.sign(Math.sin(y * 7.9));
    if (ny < -0.4) s *= 0.7;
    void x;
    void z;
    void nx;
    void nz;
    return s;
  };
  // Four walls with door openings (outer shell drawn at the collision faces).
  for (const sgn of [-1, 1]) {
    // South / north walls (z = ±10 … ±12).
    const z0 = sgn > 0 ? HH : -B;
    const z1 = sgn > 0 ? B : -HH;
    kit.add('concrete', rbox(-B, 0, z0, -HD, TOP, z1, 0.06), CONCRETE, { shade: board });
    kit.add('concrete', rbox(HD, 0, z0, B, TOP, z1, 0.06), CONCRETE, { shade: board });
    kit.add('concrete', rbox(-HD, DT, z0, HD, TOP, z1, 0.04), CONCRETE, { shade: board });
    // East / west walls (x = ±10 … ±12) between the corners.
    const x0 = sgn > 0 ? HH : -B;
    const x1 = sgn > 0 ? B : -HH;
    kit.add('concrete', rbox(x0, 0, -HH, x1, TOP, -HD, 0.06), CONCRETE, { shade: board });
    kit.add('concrete', rbox(x0, 0, HD, x1, TOP, HH, 0.06), CONCRETE, { shade: board });
    kit.add('concrete', rbox(x0, DT, -HD, x1, TOP, HD, 0.04), CONCRETE, { shade: board });
  }
  // Plinth band, cornice, vertical ribs, slit windows, door portals.
  const sides: { nx: number; nz: number }[] = [
    { nx: 0, nz: 1 },
    { nx: 0, nz: -1 },
    { nx: 1, nz: 0 },
    { nx: -1, nz: 0 },
  ];
  for (const { nx, nz } of sides) {
    const along = (a0: number, a1: number, y0: number, y1: number, d0: number, d1: number): THREE.BufferGeometry =>
      nz !== 0 ? box(a0, y0, nz * (B + d0), a1, y1, nz * (B + d1)) : box(nx * (B + d0), y0, a0, nx * (B + d1), y1, a1);
    // Plinth (dark foot) + cornice.
    kit.add('concrete', along(-B - 0.12, -HD, 0, 0.55, -0.05, 0.12), ENV.concreteDark, { flat: true, snow: 0.6 });
    kit.add('concrete', along(HD, B + 0.12, 0, 0.55, -0.05, 0.12), ENV.concreteDark, { flat: true, snow: 0.6 });
    kit.add('concrete', along(-B - 0.3, B + 0.3, TOP - 0.45, TOP + 0.05, -0.1, 0.3), BONE, { flat: true });
    kit.add('paint', along(-B - 0.02, B + 0.02, TOP - 0.85, TOP - 0.62, -0.02, 0.03), ENV.terracottaFaded, { flat: true, snow: 0 });
    // Ribs every 3.3 m, skipping the door.
    for (let a = -9.9; a <= 9.9; a += 3.3) {
      if (Math.abs(a) < 3) continue;
      kit.add('concrete', along(a - 0.28, a + 0.28, 0.5, TOP - 0.45, -0.02, 0.16), CONCRETE, { shade: board });
    }
    // Slit windows between the ribs (glowing warm behind frosted glass).
    for (let a = -8.25; a <= 8.25; a += 3.3) {
      if (Math.abs(a) < 3) continue;
      const g = nz !== 0 ? quad(a, 5.5, nz * (B + 0.02), 0.5, 2.6, 0, nz, rect('window', 4)) : quad(nx * (B + 0.02), 5.5, a, 0.5, 2.6, nx, 0, rect('window', 4));
      kit.add('signGlow', g, '#ffffff', { k: 1.25 });
      kit.add('metal', along(a - 0.34, a + 0.34, 4.12, 4.24, -0.02, 0.1), DARK, { flat: true });
    }
    // Door portal: deep frame + cantilever canopy (above reach) + threshold.
    kit.add('concrete', along(-HD - 0.55, -HD, 0, DT + 0.35, -0.02, 0.14), BONE, { flat: true });
    kit.add('concrete', along(HD, HD + 0.55, 0, DT + 0.35, -0.02, 0.14), BONE, { flat: true });
    kit.add('concrete', along(-HD - 1.6, HD + 1.6, DT + 0.35, DT + 0.62, -0.02, 1.7), BONE, { flat: true });
    kit.add('metal', along(-HD - 1.6, HD + 1.6, DT + 0.3, DT + 0.35, 1.2, 1.7), STEEL, { flat: true });
    // Canopy lamp.
    kit.add('glow', along(-0.3, 0.3, DT + 0.24, DT + 0.3, 0.9, 1.3), ENV.glowGold, { k: 2.6, flat: true });
    kit.add('pool', nz !== 0 ? floorQuad(0, 0.03, nz * (B + 1.4), 4.5, 3.4) : floorQuad(nx * (B + 1.4), 0.03, 0, 3.4, 4.5), ENV.glowGold, { k: 0.45, flat: true });
  }
  // Roof deck corners (a square with the drum's round opening) with snow.
  const R = OBS.domeRadius;
  {
    const sq = new THREE.Shape();
    sq.moveTo(-B + 0.1, -B + 0.1);
    sq.lineTo(B - 0.1, -B + 0.1);
    sq.lineTo(B - 0.1, B - 0.1);
    sq.lineTo(-B + 0.1, B - 0.1);
    sq.lineTo(-B + 0.1, -B + 0.1);
    const hole = new THREE.Path();
    hole.absarc(0, 0, R - 0.25, 0, Math.PI * 2, true);
    sq.holes.push(hole);
    const deck = new THREE.ExtrudeGeometry(sq, { depth: 0.3, bevelEnabled: false, curveSegments: kit.low ? 16 : 32 });
    deck.rotateX(-Math.PI / 2);
    deck.translate(0, TOP - 0.2, 0);
    kit.add('concrete', deck, CONCRETE, { flat: true });
  }
  // The drum: open ceramic cylinder (outer + inner faces), so the hall opens up into the dome.
  const drumH = OBS.domeSpring - 0.35 - TOP;
  kit.add('plaster', cyl(0, TOP, 0, R - 0.1, drumH, kit.seg(48), R - 0.1, true), BONE, { base: TOP, shade: (x, y) => 0.84 + 0.16 * smooth(TOP, OBS.domeSpring, y) });
  kit.add('glow', invert(cyl(0, TOP - 0.2, 0, R - 0.35, drumH + 0.2, kit.seg(48), R - 0.35, true)), '#7d6a5e', { snow: 0, shade: (x, y) => 0.75 + 0.3 * smooth(TOP, OBS.domeSpring, y) });
  // Warm cove lights along the top of the hall walls (light the dome from below).
  for (const s of [-1, 1]) {
    kit.add('glow', box(-HH + 0.3, TOP - 0.55, s * (HH - 0.08), HH - 0.3, TOP - 0.45, s * (HH - 0.02)), ENV.glowGold, { k: 1.8, flat: true });
    kit.add('glow', box(s * (HH - 0.08), TOP - 0.55, -HH + 0.3, s * (HH - 0.02), TOP - 0.45, HH - 0.3), ENV.glowGold, { k: 1.8, flat: true });
  }
  // Drum panel joints + little service hatch lights.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    kit.add('metal', cylAB(c * (R - 0.02), TOP + 0.1, s * (R - 0.02), c * (R - 0.02), OBS.domeSpring - 0.4, s * (R - 0.02), 0.06, 0.06, 4), STEEL, { flat: true });
  }
  kit.add('metal', cyl(0, OBS.domeSpring - 0.4, 0, R + 0.05, 0.12, kit.seg(48), R + 0.05, true), DARK, { flat: true });
  // Snow drifts piled against the base (visual, low).
  kit.section = 'dome.snow';
  const drifts = decor > 0.5 ? 10 : 5;
  for (let i = 0; i < drifts; i++) {
    const side = sides[i % 4];
    const a = (rnd() - 0.5) * 16;
    if (Math.abs(a) < 3.5) continue;
    const len = 2 + rnd() * 3;
    const cx = side.nz !== 0 ? a : side.nx * (B + 0.5);
    const cz = side.nz !== 0 ? side.nz * (B + 0.5) : a;
    const g = sphere(cx, 0, cz, 1, 10, 6, 0.26);
    g.scale(side.nz !== 0 ? len : 0.9, 1, side.nz !== 0 ? 0.9 : len);
    g.translate(cx - cx * (side.nz !== 0 ? len : 0.9), 0, cz - cz * (side.nz !== 0 ? 0.9 : len));
    kit.add('snow', g, ENV.snow, { flat: true });
  }

  buildHall(kit, rnd, decor);
  buildArcades(kit, decor);
  buildPlaque(kit);
}

function buildPlaque(kit: ObsKit): void {
  kit.section = 'dome.plaque';
  // "HALCYON DEEP SKY SURVEY — 1981" brass plaque beside the south door.
  kit.add('sign', quad(-4.2, 1.75, B + 0.03, 2.2, 0.55, 0, 1, rect('plaque', 2)), '#ffffff', { flat: true, k: 1.05 });
  kit.add('metal', box(-5.35, 1.43, B, -3.05, 2.07, B + 0.02), '#6e5028', { flat: true });
  // Dome rotation warning at the north door, stencil beside the east door.
  kit.add('sign', quad(3.9, 2.2, -B - 0.03, 2.4, 0.3, 0, -1, rect('signDome', 2)), '#ffffff', { flat: true });
  kit.add('sign', quad(B + 0.03, 6.2, 5.5, 4, 0.5, 1, 0, rect('stencil', 2)), '#ffffff', { flat: true, k: 0.9 });
  kit.add('sign', quad(-B - 0.03, 6.2, -5.5, 4, 0.5, -1, 0, rect('stencil', 2)), '#ffffff', { flat: true, k: 0.9 });
}

function buildHall(kit: ObsKit, rnd: () => number, decor: number): void {
  kit.section = 'dome.hall';
  // Terrazzo floor + door tunnel floors, brass meridian line and a compass rose.
  kit.add('interior', box(-HH, 0.0, -HH, HH, 0.025, HH), '#cdb89c', { flat: true, snow: 0 });
  kit.add('concrete', box(-HD, 0.0, HH, HD, 0.025, B), '#bfb8aa', { flat: true, snow: 0 });
  kit.add('concrete', box(-HD, 0.0, -B, HD, 0.025, -HH), '#bfb8aa', { flat: true, snow: 0 });
  kit.add('concrete', box(HE, 0.0, -HD, B, 0.025, HD), '#bfb8aa', { flat: true, snow: 0 });
  kit.add('concrete', box(-B, 0.0, -HD, -HE, 0.025, HD), '#bfb8aa', { flat: true, snow: 0 });
  kit.add('gloss', box(-0.05, 0.025, PH, 0.05, 0.035, HH - 0.2), '#c7a364', { flat: true, snow: 0 });
  kit.add('gloss', box(-0.05, 0.025, -HH + 0.2, 0.05, 0.035, -PH), '#c7a364', { flat: true, snow: 0 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const len = i % 2 === 0 ? 1.4 : 0.8;
    kit.add('gloss', beam(Math.cos(a) * 0.2, 0.03, 6.2 + Math.sin(a) * 0.2, Math.cos(a) * len, 0.03, 6.2 + Math.sin(a) * len, 0.05, 0.02), '#c7a364', { flat: true, snow: 0 });
  }
  // Interior wall skin: whitewash above a darker dado.
  const inner = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, c: string): void => kit.add('interior', box(x0, y0, z0, x1, y1, z1), c, { flat: true, snow: 0 });
  for (const s of [-1, 1]) {
    inner(-HH, s * (HH - 0.02), -HD, s * HH, 0, 1.2, '#a88b70');
    inner(HD, s * (HH - 0.02), HH, s * HH, 0, 1.2, '#a88b70');
    inner(-HH, s * (HH - 0.02), -HD, s * HH, 1.2, TOP, '#ecdcc4');
    inner(HD, s * (HH - 0.02), HH, s * HH, 1.2, TOP, '#ecdcc4');
    inner(-HD, s * (HH - 0.02), HD, s * HH, DT, TOP, '#ecdcc4');
    inner(s * (HH - 0.02), -HH, s * HH, -HD, G, TOP, '#ecdcc4');
    inner(s * (HH - 0.02), HD, s * HH, HH, G, TOP, '#ecdcc4');
    inner(s * (HH - 0.02), -HD, s * HH, HD, DT, TOP, '#ecdcc4');
  }

  kit.section = 'dome.gallery';
  // Plinths under the E/W gallery (concrete) + bridges over the side doors.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const z0 = sz > 0 ? HD : -HE;
      const z1 = sz > 0 ? HE : -HD;
      kit.add('interior', box(sx > 0 ? HE : -HH, 0, z0, sx > 0 ? HH : -HE, G - 0.3, z1), '#c2ad95', { shade: (x, y) => 0.62 + 0.38 * smooth(0, 1.5, y), snow: 0 });
    }
    kit.add('interiorMetal', box(sx > 0 ? HE : -HH, G - 0.3, -HD, sx > 0 ? HH : -HE, G - 0.05, HD), STEEL_IN, { flat: true, snow: 0 });
  }
  // Grating floor (all four sides of the ring) + fascia with hazard stripes.
  const grate = (x0: number, z0: number, x1: number, z1: number): void => {
    kit.add('interiorMetal', box(x0, G - 0.06, z0, x1, G, z1), GRATE, { flat: true, snow: 0 });
  };
  for (const s of [-1, 1]) {
    grate(-HH, s > 0 ? HE : -HH, HH, s > 0 ? HH : -HE);
    grate(s > 0 ? HE : -HH, -HE, s > 0 ? HH : -HE, HE);
    kit.add('interiorMetal', box(-HH, G - 0.3, s > 0 ? HE : -HH, HH, G - 0.06, s > 0 ? HH : -HE), STEEL_IN, { flat: true, snow: 0 });
    // Fascia (inner edge) with a painted stripe.
    kit.add('sign', quad(-3.4, G - 0.17, s * (HE - 0.012), 4.4, 0.22, 0, -s, rect('hazard', 2)), '#ffffff', { flat: true });
    kit.add('sign', quad(3.4, G - 0.17, s * (HE - 0.012), 4.4, 0.22, 0, -s, rect('hazard', 2)), '#ffffff', { flat: true });
    kit.add('sign', quad(s * (HE - 0.012), G - 0.17, 0, 2.6, 0.22, -s, 0, rect('hazard', 2)), '#ffffff', { flat: true });
    // Joists + an edge beam under the strip (the soffit reads as steelwork, not a flat slab).
    const [ja, jb] = s > 0 ? [HE, HH] : [-HH, -HE];
    kit.add('interiorMetal', box(-HH, G - 0.56, s > 0 ? HE : -HE - 0.22, HH, G - 0.3, s > 0 ? HE + 0.22 : -HE), STEEL_IN, { snow: 0, shade: (_x, _y, _z, _nx, ny) => (ny < -0.5 ? 0.62 : 0.85) });
    for (let x = -9.1; x <= 9.11; x += 1.4) kit.add('interiorMetal', box(x - 0.06, G - 0.5, ja, x + 0.06, G - 0.3, jb), '#8c8479', { flat: true, snow: 0 });
    // Cantilever brackets under the N/S strips (no posts in the aisle).
    for (let x = -8.5; x <= 8.5; x += 2.8) {
      kit.add('interiorMetal', beam(x, 1.9, s * (HH - 0.05), x, G - 0.3, s * (HE + 0.25), 0.12), STEEL_IN, { flat: true, snow: 0 });
      // Warm pendant lamps under the gallery.
      if (Math.abs(x) > 1 && decor > 0.3) {
        kit.add('metal', cylAB(x, G - 0.3, s * (HE + 0.8), x, G - 0.9, s * (HE + 0.8), 0.015, 0.015, 4), DARK, { flat: true, snow: 0 });
        kit.add('metal', lathe([[0, 0], [0.22, -0.02], [0.3, -0.2], [0.02, -0.2]], 10, x, G - 0.9, s * (HE + 0.8)), DARK, { flat: true, snow: 0 });
        kit.add('glow', sphere(x, G - 1.12, s * (HE + 0.8), 0.1, 8, 6), ENV.glowGold, { k: 3.2, flat: true });
        kit.add('pool', floorQuad(x, 0.04, s * (HE + 0.9), 3.2, 3.2), ENV.glowGold, { k: 0.55, flat: true });
      }
    }
  }
  // See-through railings (match the shootThrough collision) along the N/S strips.
  for (const s of [-1, 1]) {
    for (const [a0, a1] of [
      [-OBS.stairInner, -OBS.bridgeHalf],
      [OBS.bridgeHalf, OBS.stairInner],
    ]) {
      const z = s * (HE + 0.06);
      kit.add('gloss', cylAB(a0, G + 1.02, z, a1, G + 1.02, z, 0.035, 0.035, 6), BONE, { flat: true, snow: 0 });
      kit.add('gloss', cylAB(a0, G + 0.55, z, a1, G + 0.55, z, 0.02, 0.02, 5), BONE, { flat: true, snow: 0 });
      for (let x = a0; x <= a1 + 0.01; x += (a1 - a0) / 4) kit.add('gloss', cylAB(x, G, z, x, G + 1.02, z, 0.025, 0.025, 5), BONE, { flat: true, snow: 0 });
    }
  }
  // Kerbs on the plinth edges and bridges (no rails: you can drop into the hall).
  for (const sx of [-1, 1]) kit.add('metal', box(sx * (HE - 0.02), G, -HE, sx * (HE + 0.1), G + 0.12, HE), '#c9b27a', { flat: true, snow: 0 });

  kit.section = 'dome.stairs';
  // Four steel stairs (treads + stringers) over the ramp collision.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const xa = sx > 0 ? OBS.stairInner : -HE;
      const xb = sx > 0 ? HE : -OBS.stairInner;
      const n = 12;
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const za = sz * (1.8 + t0 * 6);
        const zb = sz * (1.8 + (t0 + 1 / n) * 6);
        const yTop = G * (t0 + 0.5 / n) + 0.02;
        kit.add('interiorMetal', box(xa + 0.05, yTop - 0.06, Math.min(za, zb), xb - 0.05, yTop, Math.max(za, zb)), '#b3a898', { flat: true, snow: 0 });
      }
      // Stringer on the open (hall) side.
      const xs = sx * OBS.stairInner;
      kit.add('interiorMetal', beam(xs, 0.12, sz * 1.8, xs, G - 0.1, sz * HE, 0.14, 0.34), STEEL_IN, { flat: true, snow: 0 });
    }
  }

  kit.section = 'dome.podium';
  // The observing podium (concrete, lip + kerb) and bridges to the gallery.
  const PW = PH + OBS.deskDepth;
  const podShade = (x: number, y: number): number => 0.62 + 0.38 * smooth(0, 1.4, y);
  kit.add('interior', rbox(-PW, 0, -PH, PH, G - 0.35, -1.3, 0.05), '#c2ad95', { shade: podShade, snow: 0 });
  kit.add('interior', rbox(-PW, 0, 1.3, PH, G - 0.35, PH, 0.05), '#c2ad95', { shade: podShade, snow: 0 });
  kit.add('interior', rbox(-PH, 0, -1.3, PH, G - 0.35, 1.3, 0.05), '#c2ad95', { shade: podShade, snow: 0 });
  kit.add('interior', rbox(-PW, 2.2, -1.3, -PH, G - 0.35, 1.3, 0.03), '#c2ad95', { flat: true, snow: 0 });
  kit.add('interiorMetal', box(-PW - 0.02, G - 0.35, -PH - 0.02, PH + 0.02, G, PH + 0.02), GRATE, { flat: true, snow: 0 });
  kit.add('metal', box(-PW - 0.04, G - 0.34, -PH - 0.04, PH + 0.04, G - 0.3, PH + 0.04), '#c9b27a', { flat: true, snow: 0 });
  for (const s of [-1, 1]) {
    kit.add('interiorMetal', box(-OBS.bridgeHalf, G - 0.3, s > 0 ? PH : -HE, OBS.bridgeHalf, G, s > 0 ? HE : -PH), GRATE, { flat: true, snow: 0 });
    kit.add('metal', box(-OBS.bridgeHalf - 0.05, G - 0.1, s > 0 ? PH : -HE, -OBS.bridgeHalf, G + 0.1, s > 0 ? HE : -PH), '#c9b27a', { flat: true, snow: 0 });
    kit.add('metal', box(OBS.bridgeHalf, G - 0.1, s > 0 ? PH : -HE, OBS.bridgeHalf + 0.05, G + 0.1, s > 0 ? HE : -PH), '#c9b27a', { flat: true, snow: 0 });
  }
  // Observer's desk in the west niche: dial panel, shelf, thermos, lunch box, logbook.
  kit.add('metal', box(-PW + 0.02, 0, -1.25, -PH, 0.85, 1.25), '#8e968a', { flat: false, snow: 0 });
  const panel = new THREE.PlaneGeometry(2.3, 0.62);
  const uv = rect('dials', 2);
  const pa = panel.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pa.count; i++) pa.setXY(i, uv[0] + pa.getX(i) * (uv[2] - uv[0]), uv[1] + pa.getY(i) * (uv[3] - uv[1]));
  panel.rotateX(-0.5);
  panel.rotateY(-Math.PI / 2);
  // Everything sits inside the recess (collision face x = −PW): the shelf lip is flush with it.
  panel.translate(-PH - 0.12, 1.45, 0);
  kit.add('sign', panel, '#ffffff', { flat: true });
  const SX = -PW + 0.2; // shelf centre line (inside the recess)
  kit.add('wood', box(-PW - 0.05, 0.86, -1.25, -PH, 0.92, 1.25), '#8a6a4c', { flat: true, snow: 0 });
  kit.add('gloss', cyl(SX, 0.92, -0.85, 0.055, 0.3, 10), '#a3ad8f', { flat: true, snow: 0 });
  kit.add('metal', cyl(SX, 1.22, -0.85, 0.06, 0.05, 10), '#34302c', { flat: true, snow: 0 });
  kit.add('gloss', rbox(SX - 0.12, 0.92, -0.55, SX + 0.12, 1.08, -0.2, 0.03), '#9cc3d5', { flat: true, snow: 0 });
  kit.add('gloss', cylAB(SX, 1.1, -0.55, SX, 1.1, -0.2, 0.012, 0.012, 4), '#55585c', { flat: true, snow: 0 });
  kit.add('paint', box(SX - 0.1, 0.92, 0.3, SX + 0.1, 0.95, 0.62), '#6b3d2e', { flat: true, snow: 0 });
  kit.add('paint', box(SX - 0.09, 0.95, 0.31, SX + 0.09, 0.955, 0.61), '#efe6d6', { flat: true, snow: 0 });
  kit.add('glow', box(SX - 0.06, 1.2, 0.8, SX + 0.06, 1.24, 1.0), '#ffb3c7', { flat: true, k: 2.2 });
  kit.add('pool', quad(-PW - 0.02, 1.4, 0, 2.6, 1.4, -1, 0), ENV.glowGold, { k: 0.3, flat: true });
  // Podium N/S faces (seen from the door axes): drive-room hatch, the declination
  // drive panel, a brass band and conduits climbing to the mount.
  for (const s of [-1, 1]) {
    const f = s * PH;
    const zb = (d0: number, d1: number): [number, number] => (s > 0 ? [f + d0, f + d1] : [f - d1, f - d0]);
    let [a, b] = zb(0, 0.05);
    kit.add('interiorMetal', box(-0.75, 0.12, a, 0.75, 2.05, b), '#34302c', { flat: true, snow: 0 });
    [a, b] = zb(0.05, 0.07);
    kit.add('interiorMetal', box(-0.65, 0.2, a, 0.65, 1.97, b), '#8e968a', { snow: 0, shade: (_x, y) => 0.75 + 0.25 * Math.min(1, y / 1.6) });
    [a, b] = zb(0.07, 0.13);
    kit.add('gloss', box(0.4, 1.0, a, 0.48, 1.25, b), '#c7a364', { flat: true, snow: 0 });
    kit.add('sign', quad(0, 1.8, f + s * 0.075, 1.12, 0.14, 0, s, rect('stencil', 2)), '#ffffff', { flat: true });
    [a, b] = zb(0, 0.06);
    kit.add('interiorMetal', box(1.3, 0.95, a, 2.9, 1.85, b), '#55585c', { flat: true, snow: 0 });
    kit.add('sign', quad(2.1, 1.4, f + s * 0.065, 1.45, 0.72, 0, s, rect('dials', 2)), '#ffffff', { flat: true });
    kit.add('glow', box(2.72, 1.72, a, 2.8, 1.78, b + 0.01), s > 0 ? ENV.glowChartreuse : ENV.glowSoftPink, { k: 2.4, flat: true });
    [a, b] = zb(0, 0.03);
    kit.add('gloss', box(-PW, 2.75, a, PH, 2.88, b), '#c7a364', { flat: true, snow: 0 });
    for (const x of [-2.55, -2.3]) kit.add('interiorMetal', cylAB(x, 0, f + s * 0.07, x, G - 0.35, f + s * 0.07, 0.045, 0.045, 6), '#6d7076', { flat: true, snow: 0 });
  }

  kit.section = 'dome.story';
  // Star charts pinned under the gallery; the chalkboard of orbital math.
  kit.add('sign', quad(-5, 1.85, HH - 0.04, 3.2, 1.6, 0, -1, rect('chalk', 2)), '#ffffff', { flat: true });
  kit.add('sign', quad(4.2, 1.9, HH - 0.04, 1.1, 1.1, 0, -1, rect('chart1', 2)), '#ffffff', { flat: true });
  kit.add('sign', quad(6.1, 1.75, HH - 0.04, 1.1, 1.1, 0, -1, rect('chart2', 2)), '#ffffff', { flat: true });
  kit.add('sign', quad(-4.4, 1.9, -HH + 0.04, 1.1, 1.1, 0, 1, rect('chart2', 2)), '#ffffff', { flat: true });
  kit.add('sign', quad(-6.3, 1.8, -HH + 0.04, 0.75, 0.75, 0, 1, rect('calendar', 2)), '#ffffff', { flat: true });
  kit.add('sign', quad(4.8, 1.9, -HH + 0.04, 1.2, 1.8, 0, 1, rect('poster', 2)), '#ffffff', { flat: true });
  // Instrument cabinets (flush, frozen dials) in the gallery corners.
  for (const [x, z, nx, nz] of [
    [HH - 0.1, 8.9, -1, 0],
    [-HH + 0.1, -8.9, 1, 0],
  ] as const) {
    kit.add('metal', box(x - 0.1, 0, z - 0.8, x + 0.1, 2.1, z + 0.8), '#8e968a', { snow: 0 });
    kit.add('sign', quad(x + nx * 0.11, 1.5, z, 1.4, 0.7, nx, nz, rect('dials', 2)), '#ffffff', { flat: true });
  }
  void rnd;
}

function buildArcades(kit: ObsKit, decor: number): void {
  kit.section = 'arcades';
  const x0s: [number, number][] = [
    [B, OBS.dorm.x0],
    [-24, -B],
  ];
  for (const [a, b] of x0s) {
    const xa = Math.min(a, b);
    const xb = Math.max(a, b);
    for (const s of [-1, 1]) {
      const zi = s * HD;
      const zo = s * OBS.arcadeHalf;
      // Parapet (collision 1.1 m) with a precast coping.
      kit.add('concrete', box(xa, 0, Math.min(zi, zo), xb, 1.02, Math.max(zi, zo)), CONCRETE, { base: 0 });
      kit.add('concrete', box(xa, 1.02, Math.min(zi, zo) - 0.05, xb, 1.12, Math.max(zi, zo) + 0.05), BONE, { flat: true });
      // Mullions + head beam (terracotta-painted steel), a few frosted transom panes.
      const n = Math.round((xb - xa) / 1.55);
      for (let i = 0; i <= n; i++) {
        const x = xa + ((xb - xa) * i) / n;
        kit.add('paint', box(x - 0.06, 1.1, s * 1.58, x + 0.06, OBS.arcadeRoof, s * 1.72), ENV.terracottaFaded, { flat: true });
        if (i < n && (i + (s > 0 ? 0 : 1)) % 3 !== 0) {
          kit.add('glass', quad((x + xa + ((xb - xa) * (i + 1)) / n) / 2, 3.0, s * 1.65, (xb - xa) / n - 0.14, 0.7, 0, s), '#dfe4f2', { flat: true });
        }
      }
      kit.add('paint', box(xa, 2.62, s * 1.56, xb, 2.72, s * 1.74), ENV.terracottaFaded, { flat: true });
    }
    // Roof slab + fascia, lamps inside.
    kit.add('concrete', box(xa, OBS.arcadeRoof, -OBS.arcadeHalf - 0.25, xb, OBS.arcadeRoofTop, OBS.arcadeHalf + 0.25), BONE, { flat: false, base: OBS.arcadeRoof });
    kit.add('concrete', box(xa, 0.0, -HD, xb, 0.02, HD), '#b3ac9f', { flat: true, snow: 0 });
    if (decor > 0.3) {
      for (let x = xa + 2.5; x < xb - 1; x += 4.5) {
        kit.add('glow', box(x - 0.4, OBS.arcadeRoof - 0.06, -0.12, x + 0.4, OBS.arcadeRoof - 0.02, 0.12), ENV.glowGold, { k: 2.4, flat: true });
        kit.add('pool', floorQuad(x, 0.04, 0, 3, 2.6), ENV.glowGold, { k: 0.3, flat: true });
      }
    }
    // Snow blown in against the parapets.
    for (let x = xa + 1.5; x < xb - 1; x += 3.7) {
      const g = sphere(x, 0, 1.25, 0.7, 8, 5, 0.35);
      g.scale(1.6, 1, 0.5);
      g.translate(x - x * 1.6, 0, 1.25 - 1.25 * 0.5);
      kit.add('snow', g, ENV.snow, { flat: true });
    }
  }
}

// ── Rotating dome + telescope ──────────────────────────────────────────────

/** Sphere cap in "Z-pole" coordinates so the slit (|z| < w/2 on the +X side) is grid-aligned. */
function shellGeo(r: number, cy: number, slitHalf: number, slitEnd: number, na: number, nb: number, inner: boolean): THREE.BufferGeometry {
  const bS = Math.asin(slitHalf / r);
  // β samples: dense near the slit edges so the cut is clean.
  const betas: number[] = [];
  for (let j = 0; j <= nb; j++) {
    const t = j / nb;
    betas.push(-Math.PI / 2 + t * Math.PI);
  }
  betas.push(-bS, bS);
  betas.sort((a, b) => a - b);
  const alphas: number[] = [];
  for (let i = 0; i <= na; i++) alphas.push((i / na) * Math.PI);
  alphas.push(slitEnd);
  alphas.sort((a, b) => a - b);
  const P = (a: number, b: number): THREE.Vector3 => new THREE.Vector3(r * Math.cos(b) * Math.cos(a), cy + r * Math.cos(b) * Math.sin(a), r * Math.sin(b));
  const pos: number[] = [];
  const nor: number[] = [];
  const push = (v: THREE.Vector3): void => {
    pos.push(v.x, v.y, v.z);
    const n = new THREE.Vector3(v.x, v.y - cy, v.z).normalize();
    if (inner) n.negate();
    nor.push(n.x, n.y, n.z);
  };
  for (let i = 0; i < alphas.length - 1; i++) {
    for (let j = 0; j < betas.length - 1; j++) {
      const a0 = alphas[i], a1 = alphas[i + 1];
      const b0 = betas[j], b1 = betas[j + 1];
      if (a1 - a0 < 1e-5 || b1 - b0 < 1e-5) continue;
      const am = (a0 + a1) / 2;
      const bm = (b0 + b1) / 2;
      if (Math.abs(bm) < bS && am < slitEnd) continue;
      const p00 = P(a0, b0), p10 = P(a1, b0), p11 = P(a1, b1), p01 = P(a0, b1);
      // (α up, β toward +Z): p00→p10→p11 winds counter-clockwise seen from outside.
      if (!inner) {
        push(p00), push(p10), push(p11);
        push(p00), push(p11), push(p01);
      } else {
        push(p00), push(p11), push(p10);
        push(p00), push(p01), push(p11);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export function buildDome(kit: ObsKit, root: THREE.Object3D, quality: { lightShafts: boolean; preset: string; shadows: string }): DomeParts {
  const rotor = new THREE.Group();
  rotor.name = 'obs.domeRotor';
  const R = OBS.domeRadius;
  const CY = OBS.domeSpring;
  const slitHalf = 1.7;
  const slitEnd = Math.PI * 0.56; // just past the zenith
  const low = quality.preset === 'low';
  const na = low ? 24 : 40;
  const nb = low ? 28 : 48;
  // Outer shell: pale ceramic-metal gores with alternating tones + weathering.
  const panelShade = (x: number, y: number, z: number, nx: number, ny: number): number => {
    const th = Math.atan2(z, x);
    const gore = Math.floor(((th + Math.PI) / (Math.PI * 2)) * 32);
    const alt = gore % 2 === 0 ? 1.02 : 0.95;
    const streak = 0.96 + 0.04 * Math.sin(th * 97.0 + y * 0.5);
    const foot = 0.8 + 0.2 * smooth(CY, CY + 3, y);
    return alt * streak * foot * (ny > 0.9 ? 1.04 : 1);
  };
  kit.add('satin', shellGeo(R, CY, slitHalf, slitEnd, na, nb, false), '#dcdde8', { shade: panelShade, snow: 0.35 });
  // Inner shell: darker, warm toward the bottom (lamps from the hall).
  // Inner shell: baked (unlit) — warm from the cove lamps at the springline, deep violet at the crown.
  {
    const warm = new THREE.Color('#6e5a52');
    const cool = new THREE.Color('#2c2a45');
    const g = shellGeo(R - 0.18, CY, slitHalf, slitEnd, Math.round(na * 0.6), Math.round(nb * 0.6), true);
    const p = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const t = smooth(CY - 0.5, CY + R * 0.85, p.getY(i));
      const th = Math.atan2(p.getZ(i), p.getX(i));
      c.copy(warm).lerp(cool, t).multiplyScalar(0.92 + 0.08 * Math.sign(Math.sin(th * 16)));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    kit.add('glow', g, '#ffffff', { flat: true, vc: true });
  }
  // Gore ribs (meridians) and two latitude rings, skipping the slit.
  const ribs = low ? 16 : 32;
  for (let i = 0; i < ribs; i++) {
    const th = (i / ribs) * Math.PI * 2 + Math.PI / ribs;
    const pts: [number, number, number][] = [];
    for (let k = 0; k <= 8; k++) {
      const ph = (k / 8) * (Math.PI / 2) * 0.97;
      const x = (R + 0.05) * Math.cos(ph) * Math.cos(th);
      const z = (R + 0.05) * Math.cos(ph) * Math.sin(th);
      if (Math.abs(z) < slitHalf + 0.15 && x > -2.2) break;
      pts.push([x, CY + (R + 0.05) * Math.sin(ph), z]);
    }
    if (pts.length >= 2) kit.add('metal', tube(pts, 0.06, 4), '#b9b6b0', { flat: true, snow: 0.3 });
  }
  for (const ph of [Math.PI / 6, Math.PI / 3]) {
    const rr = (R + 0.04) * Math.cos(ph);
    const y = CY + (R + 0.04) * Math.sin(ph);
    const gap = Math.asin(Math.min(1, (slitHalf + 0.1) / rr));
    const n = 40;
    const pts: [number, number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const th = gap + (k / n) * (Math.PI * 2 - gap * 2);
      pts.push([rr * Math.cos(th), y, rr * Math.sin(th)]);
    }
    kit.add('metal', tube(pts, 0.07, 4), '#b9b6b0', { flat: true, snow: 0.3 });
  }
  // Slit frame rails + the shutter leaves slid back over the crown.
  for (const s of [-1, 1]) {
    const pts: [number, number, number][] = [];
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * slitEnd;
      const b = s * Math.asin((slitHalf + 0.12) / R);
      pts.push([(R + 0.12) * Math.cos(b) * Math.cos(a), CY + (R + 0.12) * Math.cos(b) * Math.sin(a), (R + 0.12) * Math.sin(b)]);
    }
    kit.add('metal', tube(pts, 0.16, 6), '#9a9b98', { flat: true, snow: 0.2 });
  }
  const shutter = shellGeo(R + 0.3, CY, 0, 0, low ? 10 : 16, low ? 6 : 8, false);
  {
    // Keep only the band |z| < slitHalf + 0.3 for α ∈ [slitEnd, 0.93π].
    const p = shutter.attributes.position as THREE.BufferAttribute;
    const keep: number[] = [];
    const nn: number[] = [];
    const nrm = shutter.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 3) {
      let ok = true;
      for (let k = 0; k < 3; k++) {
        const x = p.getX(i + k), y = p.getY(i + k) - CY, z = p.getZ(i + k);
        const a = Math.atan2(y, x);
        if (Math.abs(z) > slitHalf + 0.35 || a < slitEnd - 0.02 || a > Math.PI * 0.93) ok = false;
      }
      if (!ok) continue;
      for (let k = 0; k < 3; k++) {
        keep.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
        nn.push(nrm.getX(i + k), nrm.getY(i + k), nrm.getZ(i + k));
      }
    }
    shutter.dispose();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
    sg.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
    if (keep.length) kit.add('satin', sg, '#d9d3c7', { snow: 0.3 });
  }
  // Bogie skirt at the springline.
  kit.add('metal', cyl(0, CY - 0.35, 0, R + 0.12, 0.5, kit.seg(48), R + 0.12, true), '#55585c', { flat: true });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    kit.add('metal', box(Math.cos(a) * (R + 0.1) - 0.3, CY - 0.5, Math.sin(a) * (R + 0.1) - 0.3, Math.cos(a) * (R + 0.1) + 0.3, CY - 0.1, Math.sin(a) * (R + 0.1) + 0.3), DARK, { flat: true });
  }
  // Crown beacon housing + a whip antenna.
  kit.add('metal', cylAB(-1.2, CY + R - 0.1, 2.6, -1.2, CY + R + 1.6, 2.6, 0.03, 0.03, 4), DARK, { flat: true });

  // ── Telescope: fork + Serrurier truss tube (in the rotor, slit toward +X) ──
  const PIV = 7.4;
  kit.add('metal', cyl(0, G, 0, 1.9, 0.45, kit.seg(28)), '#55585c', { snow: 0 });
  kit.add('gloss', cyl(0, G + 0.45, 0, 1.6, 0.35, kit.seg(28), 1.5), BONE, { snow: 0 });
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-1.3, 0);
    shape.lineTo(1.3, 0);
    shape.quadraticCurveTo(0.9, 1.8, 0.55, PIV - G - 0.8);
    shape.lineTo(-0.55, PIV - G - 0.8);
    shape.quadraticCurveTo(-0.9, 1.8, -1.3, 0);
    const arm = new THREE.ExtrudeGeometry(shape, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1, curveSegments: 6 });
    arm.translate(0, G + 0.8, s > 0 ? 1.05 : -1.37);
    kit.add('gloss', arm, BONE, { snow: 0 });
    kit.add('metal', cylAB(0, PIV, s * 1.0, 0, PIV, s * 1.5, 0.28, 0.28, 12), '#55585c', { flat: true, snow: 0 });
  }
  // Tube, built along +Y then tilted to 55° elevation toward +X.
  const tubeGroup: THREE.BufferGeometry[] = [];
  const TL = 2.4; // below pivot
  const TU = 7.0; // above pivot
  tubeGroup.push(cyl(0, -TL, 0, 0.62, 1.1, 20)); // mirror cell
  tubeGroup.push(cyl(0, -TL - 0.12, 0, 0.4, 0.14, 16));
  tubeGroup.push(cyl(0, -0.7, 0, 0.72, 1.4, 20)); // center section
  const upper: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const a2 = a + Math.PI / 8;
    upper.push(cylAB(Math.cos(a) * 0.62, 0.7, Math.sin(a) * 0.62, Math.cos(a2) * 0.6, TU - 0.9, Math.sin(a2) * 0.6, 0.035, 0.035, 4));
  }
  const ring = cyl(0, TU - 0.9, 0, 0.7, 0.8, 20, 0.7, true);
  const ringIn = invert(cyl(0, TU - 0.9, 0, 0.64, 0.8, 20, 0.64, true));
  const spider = [beam(-0.64, TU - 0.4, 0, 0.64, TU - 0.4, 0, 0.03, 0.12), beam(0, TU - 0.4, -0.64, 0, TU - 0.4, 0.64, 0.12, 0.03)];
  const secondary = cyl(0, TU - 0.9, 0, 0.18, 0.7, 12);
  const tilt = new THREE.Matrix4().makeRotationZ(-(Math.PI / 2 - (55 * Math.PI) / 180));
  const place = new THREE.Matrix4().makeTranslation(0, PIV, 0).multiply(tilt);
  for (const g of tubeGroup) kit.add('gloss', g, BONE, { snow: 0, flat: true }, place);
  for (const g of upper) kit.add('metal', g, '#2e2d31', { snow: 0, flat: true }, place);
  kit.add('gloss', ring, BONE, { snow: 0, flat: true }, place);
  kit.add('paint', ringIn, '#1f1e22', { snow: 0, flat: true }, place);
  for (const g of spider) kit.add('metal', g, '#2e2d31', { snow: 0, flat: true }, place);
  kit.add('metal', secondary, '#2e2d31', { snow: 0, flat: true }, place);
  kit.add('paint', box(-0.55, -0.1, -0.74, 0.55, 0.1, 0.74), '#34302c', { flat: true, snow: 0 }, place);
  // Black roll stripe + a warm mirror glint at the bottom of the tube.
  kit.add('paint', cyl(0, -TL + 1.1, 0, 0.635, 0.12, 20), '#34302c', { flat: true, snow: 0 }, place);
  kit.add('glow', cyl(0, TU - 1.2, 0, 0.3, 0.02, 16), '#dfe6ff', { flat: true, k: 0.8 }, place);
  // Counterweights on the fork.
  kit.add('metal', box(-1.5, G + 0.9, -0.5, -1.0, G + 1.9, 0.5), '#55585c', { snow: 0 });

  kit.build(rotor);
  root.add(rotor);
  // Open shells only put their BACK faces into the shadow map (three.js default),
  // so the near half of the dome would let the low sun straight through onto the
  // telescope. The shell casts from both sides; the (open) drum gets an invisible
  // double-sided caster. The slit still lets light through, as it should.
  for (const m of kit.meshes) if (m.name.endsWith('.satin')) (m.material as THREE.Material).shadowSide = THREE.DoubleSide;
  let caster: THREE.Mesh | null = null;
  if (quality.shadows !== 'off') {
    const cm = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    cm.shadowSide = THREE.DoubleSide;
    caster = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.1, R - 0.1, CY - TOP + 0.1, 32, 1, true), cm);
    caster.position.y = (TOP + CY) / 2 - 0.05;
    caster.castShadow = true;
    caster.receiveShadow = false;
    caster.name = 'obs.drumCaster';
    caster.updateMatrix();
    caster.matrixAutoUpdate = false;
    root.add(caster);
  }

  // Crown beacon (separate material so it can blink).
  const beacon = new THREE.MeshBasicMaterial({ color: new THREE.Color(ENV.glowSoftPink) });
  const bg = sphere(-1.2, CY + R + 1.7, 2.6, 0.16, 8, 6);
  const bm = new THREE.Mesh(bg, beacon);
  bm.name = 'obs.domeBeacon';
  rotor.add(bm);

  // Cold starlight shaft through the slit onto the podium (sweeps with the dome).
  const shafts: THREE.Object3D[] = [];
  if (quality.lightShafts) {
    const top = new THREE.Vector3((R - 0.5) * Math.cos(1.13), CY + (R - 0.5) * Math.sin(1.13), 0);
    const target = new THREE.Vector3(0.6, G + 0.2, 0.4);
    const dir = target.clone().sub(top);
    const len = dir.length() + 1;
    dir.normalize();
    const shaft = createLightShaft({ pos: top, dir, length: len, radius: 2.6, color: '#c9d4ff', intensity: 0.9 });
    rotor.add(shaft);
    shafts.push(shaft);
    const glow = createLightShaft({ pos: new THREE.Vector3(top.x + 1.2, top.y - 1.8, 0), dir: new THREE.Vector3(-0.1, -1, 0).normalize(), length: 9, radius: 1.6, color: '#bfc9ff', intensity: 0.45 });
    rotor.add(glow);
    shafts.push(glow);
  }
  return { rotor, kit, beacon, shafts, caster };
}

export { trs };
