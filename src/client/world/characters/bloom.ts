// ─────────────────────────────────────────────────────────────────────────────
// THE BLOOM — scavengers fused with bioluminescent plant life.
//
// Silhouette read at 80 m: hunched, asymmetric, dark green; a leafy overgrown
// LEFT shoulder rising to head height with glowing teal/violet bulbs; a hooded
// head with a swept-back crest and a teal visor. Design language: layered
// bark/chitin plates (lumpy, graded dark-to-light), dusty fabric wraps, one
// armoured arm (right) and one wrapped arm (left), trailing scarf & loincloth
// flaps (spring-driven bones), teal glowing veins and nodules.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { VisorStyle } from '../../../shared/cosmetics';
import { band, bend, cyl, leaf, sq, sqCut, sqPatch, sqPoint, tube, tubeThrough, type Kit, type SqParams } from './kit';
import { addVisor } from './visor';
import type { RigDef } from './rig';

const BARK = '#7a8a6b';
const BARK_DK = '#56634b';
const BARK_LT = '#a7b595';
const WRAP = '#6c6d5a';
const WRAP_DK = '#4f5445';
const HOOD = '#4d5843';
const SUIT = '#3d4237';
const LEATHER = '#4a4b3d';
const MOSS = '#4a6440';
// Fronds: deep teal-green → sage (kept off the environment's chartreuse).
const LEAF = '#2e5545';
const LEAF_TIP = '#71a088';
const SCARF = '#6e6a55';

export const BLOOM_MASK: SqParams = { rx: 0.098, ry: 0.104, rz: 0.085, p: 0.72, q: 0.78, top: 0.85, bot: 0.62, shear: -0.015 };
export const BLOOM_MASK_AT: [number, number, number] = [0, 0.078, -0.078];

export function buildBloom(k: Kit, rig: RigDef, tintHex: string, visor: VisorStyle): void {
  const T = new THREE.Color(tintHex).lerp(new THREE.Color(BARK), 0.45);
  const hi = k.detail > 0;
  const lo = k.detail === 0;
  const wraps = k.n(1, 2, 3);
  const fine = k.detail === 2;
  const BIG: [number, number] = [k.n(7, 11, 20), k.n(5, 8, 14)];
  const MED: [number, number] = [k.n(6, 8, 16), k.n(4, 5, 12)];
  const SM: [number, number] = [k.n(5, 6, 12), k.n(3, 4, 8)];
  const TN: [number, number] = [k.n(4, 5, 8), k.n(3, 3, 6)];
  const shell = (s: SqParams, seg: [number, number]): THREE.BufferGeometry => sq(s, seg[0], seg[1]);
  const radial = k.n(5, 7, 14);
  const B = 0.5; // bark gloss
  const lump = k.detail === 0 ? 0 : 1;
  const barkGrad = (ry: number): { color: string; from: number; to: number } => ({ color: BARK_LT, from: -ry * 0.2, to: ry });
  const { upper, fore, thigh, shin } = rig;
  const bulb = (bone: Parameters<Kit['add']>[0], r: number, pos: [number, number, number], secondary = false): void =>
    k.add(bone, shell({ rx: r, ry: r * 1.15, rz: r, p: 1 }, TN), '#ffffff', { pos, glow: secondary ? 0 : 1, glow2: secondary ? 1 : 0 });

  // ── Head: cowl, bark mask, crest ────────────────────────────────────────
  k.add('head', shell(BLOOM_MASK, MED), new THREE.Color(BARK_LT).lerp(T, 0.35), { pos: BLOOM_MASK_AT, gloss: 0.6, lumps: 0.002 * lump, grad: { color: BARK_DK, from: 0.02, to: -0.1 } });
  addVisor(k, visor, { bone: 'head', surf: BLOOM_MASK, at: BLOOM_MASK_AT, eyeTheta: 1.42, width: 0.78 });
  // One smooth beetle brow over the visor (two angled brows read as a cartoon scowl).
  k.add('head', bend(shell({ rx: 0.088, ry: 0.017, rz: 0.03, p: 0.6, q: 0.8, top: 0.8 }, SM), 4), BARK_DK, { pos: [0, 0.134, -0.132], rot: [0.28, 0, 0], gloss: B, lumps: 0.0015 * lump });
  // Cowl: a hood shell with a round face opening around the (slightly lowered)
  // forward axis, wrapping under the chin and hanging to the shoulders at the
  // back, plus a thick rolled rim so the opening reads as cloth, not a wire.
  const HOODS: SqParams = { rx: 0.152, ry: 0.162, rz: 0.158, p: 0.9, q: 0.9, top: 0.92 };
  const hoodAt: [number, number, number] = [0, 0.1, 0.05];
  const fy = -0.15, fz = -0.989; // forward axis (unit sphere)
  const OPEN = Math.cos(0.8);
  k.add('head', sqCut(HOODS, BIG[0], BIG[1], (x, y, z) => y * fy + z * fz < OPEN && y > -0.74 + Math.max(0, -z) * 0.2), HOOD, { pos: hoodAt, gloss: 0.08 });
  // Lining: fills the inside of the opening (dark, so the mask pops).
  k.add('head', sq({ rx: 0.13, ry: 0.14, rz: 0.12, p: 0.9 }, lo ? SM[0] : MED[0], lo ? SM[1] : MED[1]), WRAP_DK, { pos: [0, 0.1, 0.06], gloss: 0.05 });
  {
    const pts: THREE.Vector3[] = [];
    const n = k.n(10, 14, 22);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // Unit direction at 0.8 rad from the forward axis (fwd, up-perp, right basis).
      const s = Math.sin(0.8), c = OPEN;
      const ux = Math.cos(a) * s, uv = Math.sin(a) * s;
      v.set(ux, fy * c + -fz * uv, fz * c + fy * uv);
      v.normalize();
      sqPoint(HOODS, v.x, v.y, v.z, 0.004, v);
      pts.push(new THREE.Vector3(v.x + hoodAt[0], v.y + hoodAt[1], v.z + hoodAt[2]));
    }
    k.add('head', tubeThrough(pts, lo ? 0.015 : 0.016, n * k.n(1, 2, 2), k.n(3, 5, 8), true), WRAP, { gloss: 0.06 });
  }
  // Cowl tail hanging down the back of the neck.
  if (!lo) k.add('head', shell({ rx: 0.07, ry: 0.1, rz: 0.03, p: 0.7, bot: 0.35 }, SM), HOOD, { pos: [0, -0.02, 0.17], rot: [0.32, 0, 0], gloss: 0.08 });
  // Crest: a fan of swept-back spines growing out of the cowl — a crown from
  // the front, a swept crest from the side. Tips flush violet (team secondary).
  const spines: [number, number, number, number][] = [
    // x-side, length, back tilt, out tilt
    [0, 0.2, 1.02, 0],
    [1, 0.165, 0.92, 0.42],
    [-1, 0.165, 0.92, 0.42],
    [1, 0.115, 0.78, 0.9],
    [-1, 0.115, 0.78, 0.9],
  ];
  const nSpines = lo ? 3 : 5;
  for (let i = 0; i < nSpines; i++) {
    const [sx, len, tilt, out] = spines[i];
    const base: [number, number, number] = [sx * (out > 0.6 ? 0.1 : 0.055), 0.235 - (out > 0.6 ? 0.04 : 0.008), 0.035 + (out > 0.6 ? 0.03 : 0)];
    const rot: [number, number, number] = [tilt, 0, -sx * out];
    const dir = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
    const at = (f: number): [number, number, number] => [base[0] + dir.x * len * f, base[1] + dir.y * len * f, base[2] + dir.z * len * f];
    k.add('head', shell({ rx: 0.016, ry: len / 2, rz: 0.04, p: 0.5, q: 0.8, top: 0.22, bot: 1 }, SM), i === 0 ? T : BARK, {
      pos: at(0.5), rot, gloss: B, grad: { color: BARK_LT, from: -len * 0.2, to: len * 0.5 }, lumps: 0.0015 * lump,
    });
    // Violet tip.
    const tip = at(0.86);
    k.add('head', shell({ rx: 0.0095, ry: len * 0.13, rz: 0.017, p: 0.6, top: 0.3 }, TN), '#ffffff', { pos: tip, rot, paint: -0.9, gloss: 0.6 });
    if (fine && i < 3) bulb('head', 0.013, [tip[0] - dir.x * 0.03, tip[1] - dir.y * 0.03 + 0.012, tip[2] - dir.z * 0.03], true);
  }
  k.add('neck', tube(0.06, 0.068, 0.12, radial, 1), SUIT, { pos: [0, 0.1, 0], gloss: 0.2, blend: [{ bone: 'chest', y: -0.02, w: 0.05 }] });

  // ── Torso ──────────────────────────────────────────────────────────────
  k.add('chest', shell({ rx: 0.178, ry: 0.15, rz: 0.125, p: 0.75, q: 0.8, bot: 0.85 }, lo ? MED : BIG), LEATHER, { pos: [0, 0.08, 0], gloss: 0.3 });
  k.add('chest', shell({ rx: 0.122, ry: 0.092, rz: 0.046, p: 0.7, q: 0.75 }, MED), BARK, {
    pos: [0.058, 0.118, -0.1], rot: [-0.25, 0.3, -0.18], gloss: B, lumps: 0.004 * lump, grad: barkGrad(0.09),
  });
  k.add('chest', shell({ rx: 0.1, ry: 0.076, rz: 0.042, p: 0.7, q: 0.75 }, MED), T, {
    pos: [-0.066, 0.042, -0.108], rot: [0.1, -0.3, 0.22], gloss: B, lumps: 0.004 * lump, grad: barkGrad(0.076),
  });
  if (!lo) k.add('chest', shell({ rx: 0.075, ry: 0.058, rz: 0.04, p: 0.7 }, SM), BARK_DK, { pos: [0.03, -0.03, -0.103], rot: [0.2, 0.1, 0], gloss: B, lumps: 0.003 * lump });
  k.add('chest', shell({ rx: 0.15, ry: 0.12, rz: 0.05, p: 0.7 }, MED), BARK, { pos: [0, 0.1, 0.103], gloss: B, lumps: 0.005 * lump, grad: barkGrad(0.12) });
  // Glowing veins + nodules (teal).
  if (!lo) k.add('chest', shell({ rx: 0.0045, ry: 0.055, rz: 0.0045, p: 0.8 }, TN), '#ffffff', { pos: [0.1, 0.1, -0.142], rot: [-0.2, 0.3, 0.7], glow: 0.9 });
  bulb('chest', 0.013, [-0.03, 0.1, -0.132]);
  if (fine) bulb('chest', 0.01, [0.135, 0.04, -0.1]);
  // Mantle over the shoulders + neck scarf.
  k.add('chest', shell({ rx: 0.168, ry: 0.066, rz: 0.148, p: 0.85 }, MED), HOOD, { pos: [0, 0.215, 0.012], gloss: 0.08 });
  k.add('chest', new THREE.TorusGeometry(0.1, 0.042, k.n(4, 5, 8), k.n(8, 11, 16)), SCARF, { pos: [0, 0.255, -0.012], rot: [Math.PI / 2 + 0.28, 0, 0.08], gloss: 0.08 });
  k.add('scarf', shell({ rx: 0.046, ry: 0.15, rz: 0.012, p: 0.6, bot: 0.7 }, SM), SCARF, { pos: [0, -0.14, 0.0], rot: [0.12, 0, 0.08], gloss: 0.08 });
  if (fine) k.add('scarf', shell({ rx: 0.036, ry: 0.05, rz: 0.01, p: 0.6, bot: 0.4 }, TN), WRAP_DK, { pos: [0.01, -0.3, 0.02], rot: [0.12, 0, 0.1], gloss: 0.08 });

  k.add('spine', shell({ rx: 0.14, ry: 0.115, rz: 0.105, p: 0.8 }, MED), SUIT, {
    pos: [0, 0.075, 0], gloss: 0.2, blend: [{ bone: 'hips', y: -0.02, w: 0.07 }, { bone: 'chest', y: 0.19, w: 0.06 }],
  });
  k.add('spine', band(0.15, 0.05, radial + 2), WRAP, { pos: [0, 0.03, 0], rot: [0, 0, 0.22], scale: [1, 1, 0.78], gloss: 0.08 });
  if (fine) k.add('spine', band(0.146, 0.04, radial + 2), WRAP_DK, { pos: [0, 0.1, 0], rot: [0.08, 0, -0.2], scale: [1, 1, 0.8], gloss: 0.08 });
  for (let i = 0; i < (lo ? 1 : 2); i++) k.add('spine', shell({ rx: 0.1 - i * 0.012, ry: 0.038, rz: 0.034, p: 0.7 }, SM), BARK_DK, { pos: [0.01, 0.04 + i * 0.062, -0.094], gloss: B, lumps: 0.003 * lump });

  // ── Pelvis + cloth flaps ─────────────────────────────────────────────────
  if (!lo) k.add('hips', shell({ rx: 0.16, ry: 0.095, rz: 0.115, p: 0.75 }, MED), SUIT, { pos: [0, -0.03, 0], gloss: 0.2 });
  k.add('hips', shell({ rx: 0.172, ry: 0.03, rz: 0.128, p: 0.6 }, SM), LEATHER, { pos: [0, 0.035, 0], rot: [0, 0, 0.08], gloss: 0.35 });
  if (fine) k.add('hips', shell({ rx: 0.045, ry: 0.05, rz: 0.035, p: 0.6 }, SM), WRAP, { pos: [0.15, -0.01, -0.07], rot: [0, 0.6, 0], gloss: 0.08 });
  if (!lo) k.add('hips', shell({ rx: 0.042, ry: 0.07, rz: 0.042, p: 1, top: 0.55 }, SM), T, { pos: [-0.165, -0.04, 0.06], gloss: B, grad: barkGrad(0.07) });
  k.add('hips', shell({ rx: 0.042, ry: 0.09, rz: 0.09, p: 0.7 }, SM), BARK, { pos: [0.176, -0.06, 0], rot: [0, 0, 0.18], gloss: B, lumps: 0.004 * lump, grad: barkGrad(0.09) });
  // Cloth flaps curve round the hips (a flat slab read as a blade side-on) and
  // flare toward a ragged hem.
  k.add('flapF', bend(shell({ rx: 0.09, ry: 0.14, rz: 0.012, p: 0.6, top: 0.9, bot: 1.1 }, SM), 4.5), WRAP, { pos: [0, -0.13, -0.004], gloss: 0.06 });
  if (fine) k.add('flapF', shell({ rx: 0.05, ry: 0.1, rz: 0.01, p: 0.6, bot: 0.5 }, TN), WRAP_DK, { pos: [0.045, -0.17, -0.012], rot: [0, 0, 0.12], gloss: 0.06 });
  k.add('flapB', bend(shell({ rx: 0.13, ry: 0.19, rz: 0.012, p: 0.6, top: 0.95, bot: 1.12 }, SM), -4.5), WRAP_DK, { pos: [0, -0.17, 0.006], gloss: 0.06 });
  if (!lo) k.add('flapB', bend(shell({ rx: 0.06, ry: 0.12, rz: 0.01, p: 0.6, bot: 0.55 }, TN), -3), WRAP, { pos: [-0.07, -0.26, 0.012], rot: [0, 0, -0.1], gloss: 0.06 });

  // ── Legs (mismatched: left wrapped, right plated) ───────────────────────
  k.both((s, sx) => {
    const TH = `thigh${s}` as const;
    const SH = `shin${s}` as const;
    const FT = `foot${s}` as const;
    const left = sx < 0;
    k.add(TH, tube(0.076, 0.062, thigh, radial, k.n(1, 2, 4)), SUIT, { gloss: 0.2, blend: [{ bone: 'hips', y: 0, w: 0.09 }, { bone: SH, y: -thigh, w: 0.07 }] });
    if (left) {
      for (let i = 0; i < wraps; i++) k.add(TH, band(0.079 - i * 0.004, 0.038, radial), i % 2 ? WRAP_DK : WRAP, { pos: [0, -0.1 - i * 0.1, 0], rot: [0.2 * (i % 2 ? -1 : 1), 0, 0.1], gloss: 0.06 });
    } else {
      k.add(TH, shell({ rx: 0.082, ry: 0.15, rz: 0.07, p: 0.7 }, MED), BARK, { pos: [0.012, -0.2, -0.015], gloss: B, lumps: 0.005 * lump, grad: barkGrad(0.15) });
    }
    k.add(SH, shell({ rx: 0.06, ry: 0.07, rz: 0.046, p: 0.7 }, SM), T, { pos: [0, -0.012, -0.058], gloss: B, lumps: 0.003 * lump });
    k.add(SH, tube(0.058, 0.048, shin, radial, k.n(1, 2, 3)), SUIT, { gloss: 0.2, blend: [{ bone: TH, y: 0, w: 0.07 }] });
    if (left) {
      for (let i = 0; i < wraps + 1; i++) k.add(SH, band(0.066 - i * 0.003, 0.04, radial), i % 2 ? WRAP : WRAP_DK, { pos: [0, -0.1 - i * 0.075, 0], rot: [0.18 * (i % 2 ? 1 : -1), 0, 0], gloss: 0.06 });
      if (hi) bulb(SH, 0.011, [0.05, -0.16, -0.035]);
    } else {
      k.add(SH, shell({ rx: 0.068, ry: 0.13, rz: 0.066, p: 0.7, bot: 0.85 }, MED), BARK, { pos: [0, -0.17, -0.012], gloss: B, lumps: 0.004 * lump, grad: barkGrad(0.13) });
      if (!lo) k.add(SH, band(0.058, 0.045, radial), WRAP, { pos: [0, -0.35, 0], gloss: 0.06 });
    }
    k.add(FT, shell({ rx: 0.064, ry: 0.06, rz: 0.13, p: 0.75, q: 0.8 }, SM), WRAP_DK, { pos: [0, -0.035, -0.05], gloss: 0.08 });
    k.add(FT, shell({ rx: 0.066, ry: 0.016, rz: 0.138, p: 0.4, q: 0.5 }, SM), '#26231f', { pos: [0, -0.07, -0.05], gloss: 0.2 });
    if (!left && fine) k.add(FT, shell({ rx: 0.056, ry: 0.035, rz: 0.05, p: 0.7 }, TN), BARK_DK, { pos: [0, -0.04, -0.135], gloss: B });
  });

  // ── Arms (left overgrown + wrapped, right armoured) ──────────────────────
  // Left shoulder: moss mound + fronds + bulbs (THE silhouette signature).
  k.add('clavL', shell({ rx: 0.115, ry: 0.08, rz: 0.125, p: 0.9 }, MED), MOSS, { pos: [-0.04, 0.035, 0], gloss: 0.1, lumps: 0.012 * lump });
  if (!lo) k.add('clavL', shell({ rx: 0.1, ry: 0.05, rz: 0.11, p: 0.7 }, SM), BARK_DK, { pos: [-0.07, -0.02, 0], rot: [0, 0, 0.4], gloss: B, lumps: 0.004 * lump });
  // A fern spray: narrow arching fronds fanning from upright-back to
  // out-sideways, deep teal-green fading to sage, with bioluminescent tips
  // (team glow) — reads at range as a glowing leafy mass on ONE shoulder.
  // Authored by direction: elevation above horizontal and azimuth (0 = out
  // over the shoulder, +90° = back, −90° = forward); each leaf's curl is
  // turned toward the ground so every frond arches and droops like a fern
  // instead of standing up like a horn. The first five carry the low preset.
  const fronds: [number, number, number, number, number][] = [
    // len, width, elevation°, azimuth°, curl
    [0.54, 0.064, 76, 18, 0.4],
    [0.5, 0.06, 60, 58, 0.46],
    [0.46, 0.056, 40, 2, 0.62],
    [0.44, 0.056, 60, -30, 0.45],
    [0.44, 0.054, 28, 42, 0.66],
    [0.36, 0.05, 20, -12, 0.7],
    [0.38, 0.05, 38, 112, 0.6],
    [0.3, 0.046, 68, 95, 0.55],
    [0.28, 0.044, 16, 82, 0.72],
    [0.26, 0.042, 32, -62, 0.7],
  ];
  const nLeaves = k.n(5, 8, 10);
  const D2R = Math.PI / 180;
  const fY = new THREE.Vector3(), fZ = new THREE.Vector3(), fX = new THREE.Vector3();
  const fM = new THREE.Matrix4(), fE = new THREE.Euler();
  for (let i = 0; i < nLeaves; i++) {
    const [len, w, el, az, curl] = fronds[i];
    // Direction (+0.35 rad back-tilt offsets the hunched chest), curl toward the ground.
    fY.set(-Math.cos(el * D2R) * Math.cos(az * D2R), Math.sin(el * D2R), Math.cos(el * D2R) * Math.sin(az * D2R)).applyAxisAngle(fX.set(1, 0, 0), 0.35).normalize();
    fZ.set(0, -1, 0).addScaledVector(fY, fY.y).normalize();
    fX.crossVectors(fY, fZ).normalize();
    // Roll each blade ±40° about its spine so the spray shows leaf area from
    // every side (flat-up blades vanish edge-on from the front).
    const tw = i % 2 ? 0.7 : -0.7;
    fX.applyAxisAngle(fY, tw);
    fZ.applyAxisAngle(fY, tw);
    fE.setFromRotationMatrix(fM.makeBasis(fX, fY, fZ));
    k.add('fronds', leaf(len, w, k.n(3, 5, 9), curl, 0.35), LEAF, {
      pos: [-0.012 * (i % 4), 0.004 * (i % 3), 0.012 * (i % 3) - 0.012], rot: [fE.x, fE.y, fE.z], gloss: 0.35, ao: 0.4,
      grad: { color: LEAF_TIP, from: len * 0.15, to: len * 0.85 }, glow: 0.55, glowY: { from: len * 0.72, to: len },
    });
  }
  bulb('fronds', 0.034, [-0.03, 0.13, 0.035]);
  bulb('fronds', 0.028, [0.0, 0.1, 0.075], true);
  if (hi) {
    bulb('fronds', 0.021, [-0.12, 0.085, -0.02]);
    bulb('fronds', 0.019, [-0.08, 0.2, 0.07], true);
    bulb('fronds', 0.016, [-0.07, 0.05, -0.07], true);
    if (fine) k.add('fronds', cyl(0.004, 0.006, 0.12, 4), LEAF, { pos: [-0.02, 0.07, 0.03], rot: [0.2, 0, 0.15], gloss: 0.3 });
  }
  // Right shoulder: layered chitin pauldron with a violet edge line.
  const RP: SqParams = { rx: 0.125, ry: 0.072, rz: 0.13, p: 0.7, q: 0.75, top: 0.85 };
  k.add('clavR', shell(RP, BIG), T, { pos: [0.05, 0.035, 0], rot: [0, 0, -0.35], gloss: B, lumps: 0.004 * lump, grad: barkGrad(0.07) });
  k.add('clavR', sqPatch(RP, 0.003, 0, Math.PI * 2, 1.36, 0.08, k.n(10, 14, 24), 1), '#ffffff', { pos: [0.05, 0.035, 0], rot: [0, 0, -0.35], paint: -1, gloss: 0.6 });
  k.add('clavR', shell({ rx: 0.1, ry: 0.05, rz: 0.104, p: 0.7 }, SM), BARK, { pos: [0.068, 0.085, 0.0], rot: [0, 0, -0.45], gloss: B, lumps: 0.004 * lump, grad: barkGrad(0.05) });

  k.both((s, sx) => {
    const UA = `upperArm${s}` as const;
    const FA = `forearm${s}` as const;
    const HD = `hand${s}` as const;
    const left = sx < 0;
    if (fine) k.add(UA, shell({ rx: 0.062, ry: 0.062, rz: 0.062, p: 0.9 }, SM), SUIT, { pos: [0, -0.02, 0], gloss: 0.2 });
    k.add(UA, tube(0.056, 0.05, upper, radial, k.n(1, 2, 3)), SUIT, { gloss: 0.2, blend: [{ bone: FA, y: -upper, w: 0.06 }] });
    k.add(FA, tube(0.051, 0.044, fore, radial, k.n(1, 2, 3)), SUIT, { gloss: 0.2, blend: [{ bone: UA, y: 0, w: 0.06 }] });
    if (left) {
      const n = wraps;
      for (let i = 0; i < n; i++) k.add(UA, band(0.059 - i * 0.002, 0.036, radial), i % 2 ? WRAP_DK : WRAP, { pos: [0, -0.08 - i * 0.075, 0], rot: [0.2 * (i % 2 ? 1 : -1), 0, 0.1], gloss: 0.06 });
      for (let i = 0; i < n; i++) k.add(FA, band(0.054 - i * 0.003, 0.04, radial), i % 2 ? WRAP : WRAP_DK, { pos: [0, -0.06 - i * 0.07, 0], rot: [0.22 * (i % 2 ? -1 : 1), 0, 0], gloss: 0.06 });
      bulb(FA, 0.012, [-0.045, -0.1, -0.02]);
      if (fine) bulb(UA, 0.011, [-0.05, -0.12, 0.02]);
      k.add(HD, shell({ rx: 0.028, ry: 0.038, rz: 0.05, p: 0.7 }, SM), WRAP, { pos: [0, -0.008, -0.055], gloss: 0.08 });
      if (fine) k.add(HD, shell({ rx: 0.025, ry: 0.028, rz: 0.02, p: 0.7 }, TN), WRAP_DK, { pos: [0, -0.038, -0.088], gloss: 0.08 });
    } else {
      k.add(UA, shell({ rx: 0.064, ry: 0.1, rz: 0.064, p: 0.7 }, SM), BARK, { pos: [0.008, -0.14, 0], gloss: B, lumps: 0.004 * lump, grad: barkGrad(0.1) });
      k.add(FA, shell({ rx: 0.058, ry: 0.11, rz: 0.058, p: 0.7, top: 1.12, bot: 0.9 }, MED), T, { pos: [0, -0.14, 0], gloss: B, lumps: 0.004 * lump, grad: barkGrad(0.11) });
      if (!lo) for (const vx of [-1, 1]) k.add(FA, shell({ rx: 0.004, ry: 0.07, rz: 0.004, p: 0.8 }, TN), '#ffffff', { pos: [vx * 0.03, -0.14, -0.052], rot: [0.05, 0, vx * 0.12], glow: 0.9 });
      k.add(HD, shell({ rx: 0.027, ry: 0.038, rz: 0.048, p: 0.55 }, SM), '#2c2a25', { pos: [0, -0.008, -0.055], gloss: 0.3 });
      if (!lo) k.add(HD, shell({ rx: 0.029, ry: 0.013, rz: 0.03, p: 0.6 }, TN), BARK, { pos: [0, 0.028, -0.058], gloss: B });
      if (fine) k.add(HD, shell({ rx: 0.025, ry: 0.028, rz: 0.02, p: 0.6 }, TN), '#2c2a25', { pos: [0, -0.038, -0.088], gloss: 0.3 });
    }
    if (!lo) k.add(HD, shell({ rx: 0.012, ry: 0.012, rz: 0.028, p: 0.7 }, TN), left ? WRAP_DK : '#2c2a25', { pos: [-sx * 0.026, -0.004, -0.042], rot: [0.5, 0, 0], gloss: 0.2 });
  });

  // ── Seed-pod pack with a glowing sprout ─────────────────────────────────
  k.add('pack', shell({ rx: 0.12, ry: 0.15, rz: 0.085, p: 0.95, top: 0.72, bot: 0.9 }, MED), T, { pos: [0, -0.02, 0.05], gloss: B, lumps: 0.006 * lump, grad: barkGrad(0.15) });
  if (!lo) k.add('pack', cyl(0.046, 0.046, 0.3, radial), WRAP, { pos: [0, 0.14, 0.06], rot: [0, 0, Math.PI / 2], gloss: 0.06 });
  k.add('pack', cyl(0.006, 0.01, 0.22, 5), LEAF, { pos: [-0.07, 0.2, 0.05], rot: [0, 0, 0.3], gloss: 0.3 });
  bulb('pack', 0.028, [-0.104, 0.305, 0.05]);
  if (fine) k.add('pack', leaf(0.14, 0.04, 3, 0.4), LEAF, { pos: [-0.085, 0.24, 0.05], rot: [0.3, 0.5, 0.9], gloss: 0.35, ao: 0.4, grad: { color: LEAF_TIP, from: 0, to: 0.14 } });
}
