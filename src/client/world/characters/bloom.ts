// ─────────────────────────────────────────────────────────────────────────────
// THE BLOOM — scavengers fused with bioluminescent plant life.
//
// Silhouette read at 80 m (organic, ASYMMETRIC, hunched):
//  • a big fan of broad fronds erupting from the LEFT shoulder, rising past
//    the head and arching outward — a lopsided mass no Halcyon outline has;
//  • a deep hood that tapers into a swept-back point (a bud, not a helmet,
//    not a horn) set low and forward on a hunched spine;
//  • a ragged cloak hanging from the shoulders (A-line; flares when running).
// Design language: smooth layered chitin/bark plates (overlapping scales with
// light-graded upper edges — no lumpy noise), dusty fabric wraps over an
// anatomical undersuit, one armoured arm (right) and one wrapped arm (left),
// a glowing vine bandolier and bioluminescent bulbs in teal / violet.
//
// Far readability: visor, frond tips, the shoulder / pack bulbs grow with
// distance (kit PartOpts.visor / farGrow) so the team colour stays visible.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { VisorStyle } from '../../../shared/cosmetics';
import { band, bend, cloth, leaf, limb, sq, sqCut, sqPoint, tubeThrough, type Kit, type SqParams } from './kit';
import { addVisor } from './visor';
import type { BoneName, RigDef, V3 } from './rig';

const BARK = '#7a8a6b';
const BARK_DK = '#4f5c45';
const BARK_LT = '#aebb9b';
const WRAP = '#6c6d5a';
const WRAP_DK = '#545848';
const HOOD = '#4d5843';
const CLOAK = '#56604a';
const CLOAK_DK = '#3c4436';
const SUIT = '#3d4237';
const LEATHER = '#4a4b3d';
const MOSS = '#4a6440';
// Fronds: deep teal-green → sage (kept off the environment's chartreuse).
const LEAF = '#2b5243';
const LEAF_TIP = '#6f9f87';

export const BLOOM_MASK: SqParams = { rx: 0.098, ry: 0.104, rz: 0.085, p: 0.72, q: 0.78, top: 0.85, bot: 0.62, shear: -0.015 };
export const BLOOM_MASK_AT: [number, number, number] = [0, 0.078, -0.078];

export function buildBloom(k: Kit, rig: RigDef, tintHex: string, visor: VisorStyle): void {
  // Armour tint, pulled toward bark and darkened: a light cosmetic tint must
  // never turn the Bloom into a pale (Halcyon-valued) figure.
  const T = new THREE.Color(tintHex).lerp(new THREE.Color(BARK), 0.55).multiplyScalar(0.72);
  const lo = k.detail === 0;
  const fine = k.detail === 2;
  const BIG: [number, number] = [k.n(7, 11, 20), k.n(5, 8, 14)];
  const MED: [number, number] = [k.n(6, 8, 16), k.n(4, 5, 12)];
  const SM: [number, number] = [k.n(5, 6, 12), k.n(3, 4, 8)];
  const TN: [number, number] = [k.n(4, 5, 8), k.n(3, 3, 6)];
  const shell = (s: SqParams, seg: [number, number]): THREE.BufferGeometry => sq(s, seg[0], seg[1]);
  const radial = k.n(5, 7, 14);
  const B = 0.5; // chitin gloss (below the ceramic seam threshold)
  const barkGrad = (ry: number): { color: string; from: number; to: number } => ({ color: BARK_LT, from: ry * 0.35, to: ry * 1.1 });
  const { upper, fore, thigh, shin } = rig;
  const ROOT = '#3a3328';
  // A root / vine spiralling down a limb segment (bone-local, along −Y).
  const vine = (bone: BoneName, r0: number, r1: number, y0: number, y1: number, turns: number, phase: number, rad = 0.0085): void => {
    const pts: THREE.Vector3[] = [];
    const n = k.n(5, 8, 14);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = phase + t * turns * Math.PI * 2;
      const r = r0 + (r1 - r0) * t;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y0 + (y1 - y0) * t, Math.sin(a) * r));
    }
    k.add(bone, tubeThrough(pts, rad, n + 2, 3, false), ROOT, { gloss: 0.3, ao: 0.6 });
  };
  const prof = (pts: [number, number][]): [number, number][] =>
    lo ? [pts[0], pts[1], pts[pts.length - 1]] : !fine && pts.length > 4 ? [pts[0], pts[1], pts[2], pts[pts.length - 1]] : pts;
  const LIMB = (pts: [number, number][], len: number, flat = 1): THREE.BufferGeometry => limb(prof(pts), len, radial, flat);
  const bulb = (bone: BoneName, r: number, pos: V3, secondary = false, grow = 0): void =>
    k.add(bone, shell({ rx: r, ry: r * 1.15, rz: r, p: 1 }, TN), '#ffffff', { pos, glow: secondary ? 0 : 1, glow2: secondary ? 1 : 0, farGrow: grow || undefined });
  // A chitin scale: smooth, slightly cupped, pointed lower edge, light upper rim.
  const scale = (bone: BoneName, rx: number, ry: number, rz: number, pos: V3, rot: V3, color: THREE.Color | string = BARK, seg = SM): void =>
    k.add(bone, bend(shell({ rx, ry, rz, p: 0.6, q: 0.62, top: 1.04, bot: 0.55 }, seg), 2.2 / Math.max(rx, 0.05) * 0.1), color, { pos, rot, gloss: B, grad: barkGrad(ry) });

  // ── Head: bud-shaped hood, bark mask, swept point ───────────────────────
  k.add('head', shell(BLOOM_MASK, MED), new THREE.Color(BARK_LT).lerp(T, 0.35), { pos: BLOOM_MASK_AT, gloss: 0.6, grad: { color: BARK_DK, from: 0.02, to: -0.1 } });
  addVisor(k, visor, { bone: 'head', surf: BLOOM_MASK, at: BLOOM_MASK_AT, eyeTheta: 1.42, width: 0.78 });
  // One smooth beetle brow over the visor.
  k.add('head', bend(shell({ rx: 0.088, ry: 0.017, rz: 0.03, p: 0.6, q: 0.8, top: 0.8 }, SM), 4), BARK_DK, { pos: [0, 0.134, -0.132], rot: [0.28, 0, 0], gloss: B });
  // Hood: a deep cowl whose crown tapers and leans back into a swept point —
  // from the front a rounded bud, in profile a hooked tip trailing behind.
  const HOODS: SqParams = { rx: 0.158, ry: 0.172, rz: 0.165, p: 0.88, q: 0.82, top: 0.62, shear: 0.045 };
  const hoodAt: [number, number, number] = [0, 0.1, 0.05];
  const fy = -0.15, fz = -0.989; // forward axis (unit sphere)
  const OPEN = Math.cos(0.8);
  k.add('head', sqCut(HOODS, BIG[0], BIG[1], (x, y, z) => y * fy + z * fz < OPEN && y > -0.74 + Math.max(0, -z) * 0.2), HOOD, { pos: hoodAt, gloss: 0.08 });
  // Lining: fills the inside of the opening (dark, so the mask pops).
  k.add('head', sq({ rx: 0.13, ry: 0.14, rz: 0.12, p: 0.9 }, fine ? MED[0] : SM[0], fine ? MED[1] : SM[1]), WRAP_DK, { pos: [0, 0.1, 0.06], gloss: 0.05 });
  {
    const pts: THREE.Vector3[] = [];
    const n = k.n(10, 14, 22);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = Math.sin(0.8), c = OPEN;
      const ux = Math.cos(a) * s, uv = Math.sin(a) * s;
      v.set(ux, fy * c + -fz * uv, fz * c + fy * uv);
      v.normalize();
      sqPoint(HOODS, v.x, v.y, v.z, 0.004, v);
      pts.push(new THREE.Vector3(v.x + hoodAt[0], v.y + hoodAt[1], v.z + hoodAt[2]));
    }
    k.add('head', tubeThrough(pts, 0.016, n * k.n(1, 1, 2), k.n(3, 5, 8), true), WRAP, { gloss: 0.06 });
  }
  // Swept hood point (continues the tapered crown backwards and down a little).
  k.add('head', shell({ rx: 0.05, ry: 0.11, rz: 0.042, p: 0.85, q: 0.8, top: 0.12, bot: 1 }, SM), HOOD, { pos: [0, 0.27, 0.15], rot: [1.15, 0, 0], gloss: 0.08 });
  // Violet bud tip on the point (team secondary).
  k.add('head', shell({ rx: 0.012, ry: 0.022, rz: 0.012, p: 1 }, TN), '#ffffff', { pos: [0, 0.305, 0.245], rot: [1.15, 0, 0], glow2: 1 });
  // Cowl tail hanging down the back of the neck.
  if (!lo) k.add('head', shell({ rx: 0.075, ry: 0.1, rz: 0.03, p: 0.7, bot: 0.35 }, SM), HOOD, { pos: [0, -0.02, 0.17], rot: [0.32, 0, 0], gloss: 0.08 });
  k.add('neck', limb([[0.064, 0], [0.06, 0.5], [0.072, 1]], 0.12, radial), SUIT, { pos: [0, 0.1, 0], gloss: 0.2, blend: [{ bone: 'chest', y: -0.02, w: 0.05 }] });

  // ── Torso: layered chitin over leather ─────────────────────────────────
  k.add('chest', shell({ rx: 0.178, ry: 0.15, rz: 0.125, p: 0.75, q: 0.8, bot: 0.8 }, lo ? MED : BIG), LEATHER, { pos: [0, 0.08, 0], gloss: 0.3 });
  // Pangolin breastplate: rows of overlapping pointed scales, each tilted so
  // its lower edge lifts off the one below (asymmetric — the left side is
  // the vine and frond root). Low tier merges them into two big plates.
  if (lo) {
    scale('chest', 0.12, 0.095, 0.04, [0.058, 0.118, -0.102], [-0.22, 0.3, -0.16], BARK, MED);
    scale('chest', 0.1, 0.08, 0.038, [-0.068, 0.05, -0.108], [0.06, -0.3, 0.2], T, MED);
  } else {
    const rows: [number, number, number, number, string | THREE.Color][] = [
      // x, y, z, rx, colour
      [0.1, 0.165, -0.098, 0.07, BARK],
      [0.02, 0.17, -0.112, 0.068, T],
      [0.075, 0.1, -0.118, 0.066, BARK_DK],
      [-0.03, 0.095, -0.124, 0.064, BARK],
      [0.03, 0.03, -0.122, 0.062, T],
      [-0.075, 0.03, -0.108, 0.058, BARK_DK],
    ];
    for (const [x, y, z, rx, c] of rows) scale('chest', rx, rx * 0.78, 0.026, [x, y, z], [0.28, x * 2.2, -x * 0.8], c);
  }
  k.add('chest', shell({ rx: 0.15, ry: 0.125, rz: 0.05, p: 0.65, q: 0.7, bot: 0.75 }, MED), BARK, { pos: [0, 0.1, 0.1], gloss: B, grad: barkGrad(0.125) });
  if (!lo) scale('chest', 0.09, 0.07, 0.03, [0, 0.03, 0.142], [-0.25, 0, 0], BARK_DK);
  // Glowing vine bandolier: left shoulder → across the scales → right flank.
  {
    const vine: THREE.Vector3[] = [
      new THREE.Vector3(-0.15, 0.2, -0.04),
      new THREE.Vector3(-0.12, 0.15, -0.115),
      new THREE.Vector3(-0.03, 0.085, -0.142),
      new THREE.Vector3(0.07, 0.02, -0.135),
      new THREE.Vector3(0.15, -0.04, -0.07),
    ];
    k.add('chest', tubeThrough(vine, 0.0075, k.n(6, 10, 18), k.n(3, 4, 6), false), '#ffffff', { glow: 0.85 });
  }
  bulb('chest', 0.015, [-0.03, 0.09, -0.148], false, 1.2);
  if (!lo) bulb('chest', 0.011, [0.09, 0.012, -0.135], true);
  // Mantle over the shoulders + neck scarf.
  k.add('chest', shell({ rx: 0.17, ry: 0.066, rz: 0.15, p: 0.85 }, MED), HOOD, { pos: [0, 0.215, 0.012], gloss: 0.08 });
  k.add('chest', new THREE.TorusGeometry(0.1, 0.042, k.n(4, 5, 8), k.n(8, 11, 16)), WRAP, { pos: [0, 0.255, -0.012], rot: [Math.PI / 2 + 0.28, 0, 0.08], gloss: 0.08 });
  // Ragged cloak hanging from the shoulder blades (scarf bone: swings back
  // when running) — wraps round the back, the hem is torn.
  {
    const capeLen = 0.72;
    const g = bend(cloth(0.46, capeLen, k.n(3, 5, 8), k.n(2, 3, 6), 0.13, 0.06, 0.72), -1.6);
    k.add('scarf', g, CLOAK, { pos: [-0.06, 0.03, 0.05], rot: [0.28, 0, 0], gloss: 0.05, grad: { color: CLOAK_DK, from: -0.1, to: -capeLen } });
  }

  k.add('spine', shell({ rx: 0.135, ry: 0.115, rz: 0.102, p: 0.8, top: 1.06, bot: 0.92 }, lo ? SM : MED), SUIT, {
    pos: [0, 0.075, 0], gloss: 0.2, blend: [{ bone: 'hips', y: -0.02, w: 0.07 }, { bone: 'chest', y: 0.19, w: 0.06 }],
  });
  k.add('spine', band(0.145, 0.05, radial + 2), WRAP, { pos: [0, 0.03, 0], rot: [0, 0, 0.22], scale: [1, 1, 0.78], gloss: 0.08 });
  for (let i = 0; i < (lo ? 1 : 2); i++) scale('spine', 0.095 - i * 0.012, 0.042, 0.03, [0.01, 0.05 + i * 0.058, -0.094], [0.1, 0, 0], BARK_DK);

  // ── Pelvis + cloth flaps ─────────────────────────────────────────────────
  if (!lo) k.add('hips', shell({ rx: 0.155, ry: 0.095, rz: 0.112, p: 0.75 }, MED), SUIT, { pos: [0, -0.03, 0], gloss: 0.2 });
  k.add('hips', shell({ rx: 0.168, ry: 0.03, rz: 0.125, p: 0.6 }, SM), LEATHER, { pos: [0, 0.035, 0], rot: [0, 0, 0.08], gloss: 0.35 });
  if (fine) k.add('hips', shell({ rx: 0.045, ry: 0.05, rz: 0.035, p: 0.6 }, SM), WRAP, { pos: [0.15, -0.01, -0.07], rot: [0, 0.6, 0], gloss: 0.08 });
  if (!lo) k.add('hips', shell({ rx: 0.042, ry: 0.07, rz: 0.042, p: 1, top: 0.55 }, SM), T, { pos: [-0.165, -0.04, 0.06], gloss: B, grad: barkGrad(0.07) });
  scale('hips', 0.04, 0.09, 0.088, [0.172, -0.06, 0], [0, 0, 0.18], BARK);
  k.add('flapF', bend(shell({ rx: 0.09, ry: 0.14, rz: 0.012, p: 0.6, top: 0.9, bot: 1.1 }, SM), 4.5), WRAP, { pos: [0, -0.13, -0.004], gloss: 0.06 });
  if (fine) k.add('flapF', shell({ rx: 0.05, ry: 0.1, rz: 0.01, p: 0.6, bot: 0.5 }, TN), WRAP_DK, { pos: [0.045, -0.17, -0.012], rot: [0, 0, 0.12], gloss: 0.06 });
  k.add('flapB', bend(cloth(0.24, 0.36, k.n(2, 3, 5), k.n(1, 2, 3), 0.14, 0.02, 0.9), -4.5), WRAP_DK, { pos: [0, -0.02, 0.012], gloss: 0.06 });

  // ── Legs (mismatched: left wrapped, right plated) ───────────────────────
  k.both((s, sx) => {
    const TH = `thigh${s}` as const;
    const SH = `shin${s}` as const;
    const FT = `foot${s}` as const;
    const left = sx < 0;
    k.add(TH, LIMB([[0.08, 0], [0.085, 0.22], [0.073, 0.62], [0.06, 0.93], [0.058, 1]], thigh, 0.94), left ? WRAP : SUIT, {
      gloss: left ? 0.08 : 0.2, blend: [{ bone: 'hips', y: 0, w: 0.09 }, { bone: SH, y: -thigh, w: 0.07 }],
    });
    if (left) {
      // Two diagonal straps over the wrapped thigh.
      for (let i = 0; i < (lo ? 1 : 2); i++) k.add(TH, band(0.084 - i * 0.008, 0.03, radial), WRAP_DK, { pos: [0, -0.12 - i * 0.16, 0], rot: [0.28 * (i % 2 ? -1 : 1), 0, 0.12], gloss: 0.06 });
      if (!lo) vine(TH, 0.09, 0.07, -0.02, -0.4, 0.75, 3.6, 0.01);
    } else {
      scale(TH, 0.085, 0.15, 0.04, [0.02, -0.19, -0.04], [0.04, -0.25, 0], BARK, MED);
      if (!lo) scale(TH, 0.05, 0.09, 0.03, [0.07, -0.12, 0.03], [0, 0.9, 0.05], BARK_DK);
    }
    // Knee: a dark chitin cap.
    scale(SH, 0.058, 0.066, 0.042, [0, -0.008, -0.056], [-0.1, 0, 0], BARK_DK);
    k.add(SH, LIMB([[0.056, 0], [0.064, 0.26], [0.052, 0.62], [0.044, 0.85], [0.042, 1]], shin, 0.95), left ? WRAP : SUIT, { gloss: left ? 0.08 : 0.2, blend: [{ bone: TH, y: 0, w: 0.07 }] });
    if (left) {
      k.add(SH, band(0.06, 0.035, radial, 0.064), WRAP_DK, { pos: [0, -0.14, 0], rot: [-0.25, 0, 0], gloss: 0.06 });
      if (!lo) k.add(SH, band(0.052, 0.03, radial, 0.056), WRAP_DK, { pos: [0, -0.3, 0], rot: [0.2, 0, 0], gloss: 0.06 });
      if (!lo) bulb(SH, 0.011, [0.05, -0.2, -0.03]);
      if (!lo) vine(SH, 0.068, 0.05, -0.04, -0.36, 1.1, 1.0);
    } else {
      scale(SH, 0.07, 0.15, 0.036, [0, -0.19, -0.04], [0.03, 0, 0], BARK, MED);
      if (!lo) k.add(SH, band(0.05, 0.04, radial), WRAP, { pos: [0, -0.36, 0], gloss: 0.06 });
    }
    // Foot wraps + sole.
    k.add(FT, shell({ rx: 0.064, ry: 0.06, rz: 0.13, p: 0.75, q: 0.8 }, SM), WRAP_DK, { pos: [0, -0.035, -0.05], gloss: 0.08 });
    k.add(FT, shell({ rx: 0.066, ry: 0.016, rz: 0.138, p: 0.4, q: 0.5 }, SM), '#26231f', { pos: [0, -0.07, -0.05], gloss: 0.2 });
    if (!left && !lo) scale(FT, 0.052, 0.04, 0.05, [0, -0.03, -0.13], [-0.6, 0, 0], BARK_DK, TN);
  });

  // ── Left shoulder: the frond mantle (THE silhouette signature) ──────────
  k.add('clavL', shell({ rx: 0.105, ry: 0.07, rz: 0.115, p: 0.85, q: 0.75 }, MED), MOSS, { pos: [-0.04, 0.03, 0], gloss: 0.1, grad: { color: '#2f4535', from: 0.0, to: -0.07 } });
  if (!lo) scale('clavL', 0.1, 0.05, 0.11, [-0.075, -0.02, 0], [0, 0, 0.45], BARK_DK);
  // Broad fronds fanning from upright-back to out-sideways: they arch over
  // and droop at the tips (curl turned to the ground) and are rolled ±40°
  // about their spine so the spray shows leaf area from every side. Authored
  // by elevation above horizontal and azimuth (0 = out over the shoulder,
  // +90° = back, −90° = forward). The first four carry the low preset / far
  // LOD; together they form one lopsided mass rising past the head.
  const fronds: [number, number, number, number, number][] = [
    // len, width, elevation°, azimuth°, curl
    [0.62, 0.13, 72, 25, 0.38],
    [0.54, 0.12, 48, 5, 0.55],
    [0.56, 0.12, 58, 70, 0.45],
    [0.46, 0.11, 30, 35, 0.66],
    [0.44, 0.1, 64, -22, 0.45],
    [0.42, 0.1, 24, 100, 0.66],
    [0.36, 0.09, 80, 120, 0.5],
    [0.32, 0.08, 18, -18, 0.72],
    [0.3, 0.08, 40, 140, 0.6],
  ];
  const nLeaves = k.n(4, 6, 9);
  const D2R = Math.PI / 180;
  const fY = new THREE.Vector3(), fZ = new THREE.Vector3(), fX = new THREE.Vector3();
  const fM = new THREE.Matrix4(), fE = new THREE.Euler();
  for (let i = 0; i < nLeaves; i++) {
    const [len, w, el, az, curl] = fronds[i];
    fY.set(-Math.cos(el * D2R) * Math.cos(az * D2R), Math.sin(el * D2R), Math.cos(el * D2R) * Math.sin(az * D2R)).applyAxisAngle(fX.set(1, 0, 0), 0.35).normalize();
    fZ.set(0, -1, 0).addScaledVector(fY, fY.y).normalize();
    fX.crossVectors(fY, fZ).normalize();
    const tw = i % 2 ? 0.6 : -0.6;
    fX.applyAxisAngle(fY, tw);
    fZ.applyAxisAngle(fY, tw);
    fE.setFromRotationMatrix(fM.makeBasis(fX, fY, fZ));
    // Low tier (also the far LOD) carries fewer, broader leaves.
    k.add('fronds', leaf(len, w * (lo ? 1.3 : 1), k.n(3, 4, 8), curl, 0.3, 0.55), LEAF, {
      pos: [-0.012 * (i % 4), 0.004 * (i % 3), 0.012 * (i % 3) - 0.012], rot: [fE.x, fE.y, fE.z], gloss: 0.35, ao: 0.35,
      grad: { color: LEAF_TIP, from: len * 0.2, to: len * 0.9 }, glow: 0.6, glowY: { from: len * 0.74, to: len },
      // Silhouette exaggeration at range: the spray grows from its root.
      farGrow: 0.5, growAt: [0, 0, 0],
    });
  }
  // Bulb cluster at the frond root (grows with distance: the team colour
  // still reads as a glowing knot on the shoulder at 60–80 m).
  bulb('fronds', 0.036, [-0.03, 0.12, 0.035], false, 1.3);
  bulb('fronds', 0.028, [0.01, 0.09, 0.08], true, 1.0);
  if (!lo) {
    bulb('fronds', 0.021, [-0.12, 0.085, -0.02]);
    bulb('fronds', 0.019, [-0.08, 0.2, 0.07], true);
    if (fine) bulb('fronds', 0.016, [-0.07, 0.05, -0.07], true);
  }
  // Right shoulder: three overlapping chitin scales (armadillo pauldron) with
  // a violet edge glow on the top one.
  scale('clavR', 0.125, 0.06, 0.13, [0.055, 0.03, 0], [0, 0, -0.42], T, MED);
  scale('clavR', 0.11, 0.05, 0.115, [0.085, -0.015, 0], [0, 0, -0.62], BARK);
  if (!lo) scale('clavR', 0.09, 0.045, 0.1, [0.11, -0.055, 0], [0, 0, -0.85], BARK_DK);
  k.add('clavR', shell({ rx: 0.008, ry: 0.006, rz: 0.11, p: 0.6 }, TN), '#ffffff', { pos: [0.14, 0.035, 0], rot: [0, 0, -0.42], glow2: 0.9 });

  // ── Arms (left wrapped + overgrown, right armoured) ──────────────────────
  k.both((s, sx) => {
    const UA = `upperArm${s}` as const;
    const FA = `forearm${s}` as const;
    const HD = `hand${s}` as const;
    const left = sx < 0;
    if (fine) k.add(UA, shell({ rx: 0.062, ry: 0.062, rz: 0.062, p: 0.9 }, SM), SUIT, { pos: [0, -0.02, 0], gloss: 0.2 });
    k.add(UA, LIMB([[0.057, 0], [0.062, 0.3], [0.051, 0.75], [0.048, 1]], upper), left ? WRAP : SUIT, { gloss: left ? 0.08 : 0.2, blend: [{ bone: FA, y: -upper, w: 0.06 }] });
    k.add(FA, LIMB([[0.051, 0], [0.056, 0.25], [0.045, 0.75], [0.04, 1]], fore), left ? WRAP : SUIT, { gloss: left ? 0.08 : 0.2, blend: [{ bone: UA, y: 0, w: 0.06 }] });
    if (left) {
      k.add(UA, band(0.062, 0.03, radial, 0.064), WRAP_DK, { pos: [0, -0.12, 0], rot: [0.25, 0, 0.1], gloss: 0.06 });
      k.add(FA, band(0.054, 0.03, radial, 0.057), WRAP_DK, { pos: [0, -0.08, 0], rot: [-0.25, 0, 0], gloss: 0.06 });
      if (!lo) k.add(FA, band(0.046, 0.026, radial, 0.049), WRAP_DK, { pos: [0, -0.2, 0], rot: [0.22, 0, 0], gloss: 0.06 });
      bulb(FA, 0.012, [-0.047, -0.12, -0.02]);
      if (!lo) {
        vine(UA, 0.064, 0.056, -0.02, -0.26, 0.9, 0.4);
        vine(FA, 0.06, 0.047, -0.02, -0.24, -0.8, 2.2);
      }
      if (fine) bulb(UA, 0.011, [-0.05, -0.12, 0.02]);
      k.add(HD, shell({ rx: 0.028, ry: 0.038, rz: 0.05, p: 0.7 }, SM), WRAP, { pos: [0, -0.008, -0.055], gloss: 0.08 });
      if (!lo) k.add(HD, shell({ rx: 0.025, ry: 0.028, rz: 0.02, p: 0.7 }, TN), WRAP_DK, { pos: [0, -0.034, -0.09], rot: [0.3, 0, 0], gloss: 0.08 });
    } else {
      scale(UA, 0.06, 0.1, 0.06, [0.012, -0.14, 0], [0, 0, 0], BARK);
      scale(FA, 0.058, 0.11, 0.058, [0, -0.14, 0], [0, 0, 0], T, MED);
      if (!lo) for (const vx of [-1, 1]) k.add(FA, shell({ rx: 0.004, ry: 0.07, rz: 0.004, p: 0.8 }, TN), '#ffffff', { pos: [vx * 0.03, -0.14, -0.054], rot: [0.05, 0, vx * 0.12], glow: 0.9 });
      k.add(HD, shell({ rx: 0.027, ry: 0.038, rz: 0.048, p: 0.55 }, SM), '#2c2a25', { pos: [0, -0.008, -0.055], gloss: 0.3 });
      if (!lo) k.add(HD, shell({ rx: 0.029, ry: 0.013, rz: 0.03, p: 0.6 }, TN), BARK, { pos: [0, 0.028, -0.058], gloss: B });
      if (!lo) k.add(HD, shell({ rx: 0.025, ry: 0.028, rz: 0.02, p: 0.6 }, TN), '#2c2a25', { pos: [0, -0.034, -0.09], rot: [0.3, 0, 0], gloss: 0.3 });
    }
    if (!lo) k.add(HD, shell({ rx: 0.012, ry: 0.012, rz: 0.028, p: 0.7 }, TN), left ? WRAP_DK : '#2c2a25', { pos: [-sx * 0.026, -0.004, -0.042], rot: [0.5, 0, 0], gloss: 0.2 });
  });

  // ── Seed-pod pack with a glowing sprout ─────────────────────────────────
  k.add('pack', shell({ rx: 0.12, ry: 0.15, rz: 0.085, p: 0.95, top: 0.72, bot: 0.9 }, MED), T, { pos: [0, -0.02, 0.05], gloss: B, grad: barkGrad(0.15) });
  if (!lo) k.add('pack', band(0.046, 0.3, radial), WRAP, { pos: [0, 0.14, 0.06], rot: [0, 0, Math.PI / 2], gloss: 0.06 });
  k.add('pack', band(0.01, 0.22, 4, 0.006), LEAF, { pos: [-0.07, 0.2, 0.05], rot: [0, 0, 0.3], gloss: 0.3 });
  bulb('pack', 0.03, [-0.104, 0.305, 0.05], false, 1.4);
  if (fine) k.add('pack', leaf(0.14, 0.04, 3, 0.4), LEAF, { pos: [-0.085, 0.24, 0.05], rot: [0.3, 0.5, 0.9], gloss: 0.35, ao: 0.4, grad: { color: LEAF_TIP, from: 0, to: 0.14 } });
}
