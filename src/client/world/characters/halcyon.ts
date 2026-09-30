// ─────────────────────────────────────────────────────────────────────────────
// HALCYON — ceramic-white armour, warm orange accents, calm and disciplined.
//
// Silhouette read at 80 m: tall white rounded figure, broad smooth shoulders,
// a glowing horizontal visor line and an antenna. Design language: 1970s NASA
// industrial — rounded ceramic shells in two tiers, dark charcoal undersuit
// showing at every joint (clean panel seams), secondary panels in the armour
// tint, orange accent stripes on pauldrons, forearms, shins, pack and helmet.
//
// Detail tiers: `lo` (low preset) keeps silhouette + accents only; the default
// gameplay tier adds panel breakup; `fine` (menu showcase) adds greebles —
// jaw grille, chevrons, pack vents, pouches, fingers.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { VisorStyle } from '../../../shared/cosmetics';
import { bend, cyl, FRONT, sq, sqPatch, tube, type Kit, type SqParams } from './kit';
import { addVisor } from './visor';
import type { RigDef } from './rig';

const CERAMIC = '#efebe2';
const CERAMIC_2 = '#dcd6ca';
const SUIT = '#373430';
const SUIT_MID = '#4b4741';
const DARK = '#252321';
const GLOVE = '#2f2d2a';
const GLASS = '#16181d';

export const HALCYON_HELMET: SqParams = { rx: 0.128, ry: 0.148, rz: 0.15, p: 0.86, q: 0.9, top: 0.9, bot: 1.0 };
export const HALCYON_HELMET_AT: [number, number, number] = [0, 0.105, 0.005];

export function buildHalcyon(k: Kit, rig: RigDef, tintHex: string, visor: VisorStyle): void {
  const T = new THREE.Color(tintHex);
  const lo = k.detail === 0;
  const fine = k.detail === 2;
  const BIG: [number, number] = [k.n(7, 11, 22), k.n(5, 8, 16)];
  const MED: [number, number] = [k.n(6, 8, 16), k.n(4, 5, 12)];
  const SM: [number, number] = [k.n(5, 6, 12), k.n(3, 4, 8)];
  const TN: [number, number] = [k.n(4, 5, 8), k.n(3, 3, 6)];
  const shell = (s: SqParams, seg: [number, number]): THREE.BufferGeometry => sq(s, seg[0], seg[1]);
  const radial = k.n(5, 7, 14);
  const rings = k.n(1, 2, 4);
  const C = 0.85; // ceramic gloss
  const { upper, fore, thigh, shin } = rig;

  // ── Head ──────────────────────────────────────────────────────────────
  const H = HALCYON_HELMET;
  const HA = HALCYON_HELMET_AT;
  k.add('head', shell(H, BIG), CERAMIC, { pos: HA, gloss: C });
  // Visor: dark glass faceplate band recessed under a ceramic brow.
  const eyeTh = 1.68;
  k.add('head', sqPatch(H, 0.004, FRONT - 1.5, 3.0, eyeTh - 0.25, 0.46, k.n(9, 14, 24), k.n(1, 2, 4)), GLASS, { pos: HA, gloss: 1, ao: 0.3 });
  if (!lo) k.add('head', sqPatch(H, 0.011, FRONT - 1.55, 3.1, eyeTh - 0.37, 0.12, k.n(9, 12, 24), 1), CERAMIC, { pos: HA, gloss: C });
  addVisor(k, visor, { bone: 'head', surf: H, at: HA, eyeTheta: eyeTh + 0.02 });
  // Chin guard: one smooth ceramic piece flowing out of the helmet sides (no
  // mouth grille / nose seam — those read as a cartoon face at any distance).
  k.add('head', shell({ rx: 0.114, ry: 0.058, rz: 0.098, p: 0.62, q: 0.7, top: 1, bot: 0.7 }, MED), CERAMIC, { pos: [0, 0.02, -0.046], gloss: C });
  // Ear pods (comms): tinted ring + ceramic cap, set behind the visor line so
  // the profile stays clean (a dark centre read as an eye from behind).
  for (const sx of [-1, 1]) {
    k.add('head', cyl(0.04, 0.044, 0.028, radial + 2), T, { pos: [sx * 0.122, 0.07, 0.032], rot: [0, 0, Math.PI / 2], gloss: 0.7 });
    if (!lo) k.add('head', cyl(0.026, 0.03, 0.036, radial), CERAMIC_2, { pos: [sx * 0.124, 0.07, 0.032], rot: [0, 0, Math.PI / 2], gloss: C });
  }
  // Neck guard + NASA stripe over the crown (front and back halves).
  if (!lo) k.add('head', shell({ rx: 0.108, ry: 0.045, rz: 0.058, p: 0.6 }, SM), CERAMIC_2, { pos: [0, 0.035, 0.088], rot: [0.3, 0, 0], gloss: C });
  k.add('head', sqPatch(H, 0.0035, FRONT - 0.07, 0.14, 0.12, 1.02, 1, k.n(3, 4, 8)), '#ffffff', { pos: HA, paint: 1, gloss: C });
  k.add('head', sqPatch(H, 0.0035, FRONT - Math.PI - 0.07, 0.14, 0.12, 1.25, 1, k.n(3, 4, 8)), '#ffffff', { pos: HA, paint: 1, gloss: C });
  k.add('neck', tube(0.058, 0.066, 0.12, radial, 1), SUIT, { pos: [0, 0.1, 0], gloss: 0.15, blend: [{ bone: 'chest', y: -0.02, w: 0.05 }] });

  // ── Torso ─────────────────────────────────────────────────────────────
  k.add('chest', shell({ rx: 0.19, ry: 0.162, rz: 0.13, p: 0.5, q: 0.6, top: 1, bot: 0.8 }, BIG), CERAMIC, { pos: [0, 0.075, 0], gloss: C });
  for (const sx of [-1, 1]) {
    k.add('chest', shell({ rx: 0.086, ry: 0.078, rz: 0.028, p: 0.4, q: 0.5 }, MED), CERAMIC, { pos: [sx * 0.089, 0.108, -0.112], rot: [-0.14, sx * 0.28, 0], gloss: C });
  }
  if (!lo) {
    k.add('chest', shell({ rx: 0.012, ry: 0.082, rz: 0.02, p: 0.5 }, TN), SUIT, { pos: [0, 0.11, -0.118], gloss: 0.2 });
    k.add('chest', shell({ rx: 0.135, ry: 0.032, rz: 0.108, p: 0.5, q: 0.6 }, SM), T, { pos: [0, 0.222, 0.0], gloss: 0.7 });
  }
  k.add('chest', cyl(0.082, 0.1, 0.05, radial + 2), SUIT_MID, { pos: [0, 0.248, 0], gloss: 0.25 });
  k.add('chest', shell({ rx: 0.165, ry: 0.128, rz: 0.045, p: 0.5 }, MED), CERAMIC_2, { pos: [0, 0.095, 0.108], gloss: C });
  // Status light + accent chevrons.
  k.add('chest', shell({ rx: 0.022, ry: 0.0075, rz: 0.006, p: 0.4 }, TN), '#ffffff', { pos: [-0.105, 0.165, -0.15], rot: [-0.14, -0.3, 0], glow: 1 });
  if (fine) for (let i = 0; i < 2; i++) k.add('chest', shell({ rx: 0.034, ry: 0.0075, rz: 0.006, p: 0.4 }, TN), '#ffffff', { pos: [0.1, 0.078 + i * 0.022, -0.146], rot: [-0.14, 0.3, 0], paint: 1, gloss: C });

  k.add('spine', shell({ rx: 0.148, ry: 0.12, rz: 0.108, p: 0.8 }, MED), SUIT_MID, {
    pos: [0, 0.07, 0.0], gloss: 0.2,
    blend: [{ bone: 'hips', y: -0.02, w: 0.07 }, { bone: 'chest', y: 0.2, w: 0.06 }],
  });
  // One smooth abdominal plate wrapped round the belly (stacked bands read as ribs).
  k.add('spine', bend(shell({ rx: 0.118, ry: 0.078, rz: 0.03, p: 0.45, q: 0.62, top: 1.06, bot: 0.84 }, SM), 3.2), CERAMIC, { pos: [0, 0.072, -0.096], rot: [-0.08, 0, 0], gloss: C });
  if (!lo) k.add('spine', shell({ rx: 0.009, ry: 0.058, rz: 0.012, p: 0.5 }, TN), SUIT, { pos: [0, 0.07, -0.124], rot: [-0.08, 0, 0], gloss: 0.2 });
  if (!lo) for (const sx of [-1, 1]) k.add('spine', shell({ rx: 0.034, ry: 0.075, rz: 0.07, p: 0.5 }, SM), T, { pos: [sx * 0.136, 0.07, 0.0], gloss: 0.7 });

  // ── Pelvis ────────────────────────────────────────────────────────────
  if (!lo) k.add('hips', shell({ rx: 0.16, ry: 0.095, rz: 0.11, p: 0.7 }, MED), SUIT, { pos: [0, -0.03, 0], gloss: 0.15 });
  k.add('hips', shell({ rx: 0.176, ry: lo ? 0.06 : 0.03, rz: 0.126, p: 0.35, q: 0.5 }, SM), DARK, { pos: [0, lo ? 0.01 : 0.04, 0], gloss: 0.45 });
  if (fine) k.add('hips', shell({ rx: 0.042, ry: 0.026, rz: 0.012, p: 0.4 }, TN), CERAMIC, { pos: [0, 0.04, -0.13], gloss: C });
  k.add('hips', shell({ rx: 0.028, ry: 0.004, rz: 0.004, p: 0.4 }, TN), '#ffffff', { pos: [0, 0.04, -0.143], glow: 0.8 });
  k.add('hips', shell({ rx: 0.07, ry: 0.068, rz: 0.03, p: 0.5, bot: 0.65 }, SM), CERAMIC, { pos: [0, -0.06, -0.103], rot: [0.12, 0, 0], gloss: C });
  if (!lo) k.add('hips', shell({ rx: 0.12, ry: 0.058, rz: 0.03, p: 0.5 }, SM), CERAMIC_2, { pos: [0, -0.035, 0.108], rot: [-0.15, 0, 0], gloss: C });
  for (const sx of [-1, 1]) {
    k.add('hips', shell({ rx: 0.034, ry: 0.088, rz: 0.086, p: 0.5 }, SM), T, { pos: [sx * 0.172, -0.055, 0], rot: [0, 0, sx * 0.14], gloss: 0.7 });
    if (fine) k.add('hips', shell({ rx: 0.04, ry: 0.04, rz: 0.028, p: 0.45 }, TN), T, { pos: [sx * 0.105, 0.0, 0.125], gloss: 0.5 });
  }

  // ── Legs ──────────────────────────────────────────────────────────────
  k.both((s, sx) => {
    const TH = `thigh${s}` as const;
    const SH = `shin${s}` as const;
    const FT = `foot${s}` as const;
    k.add(TH, tube(0.078, 0.062, thigh, radial, rings), SUIT, {
      gloss: 0.15, blend: [{ bone: 'hips', y: 0.0, w: 0.09 }, { bone: SH, y: -thigh, w: 0.07 }],
    });
    // Thigh plate hugs the front and sides (undersuit shows behind → layered
    // armour, not a pill); an outer hip-to-knee panel keeps the silhouette broad.
    // (Plate surface stays ≥1.5 cm outside the suit tube everywhere — no poke-through.)
    k.add(TH, bend(shell({ rx: 0.1, ry: 0.15, rz: 0.028, p: 0.55, q: 0.7, top: 1.06, bot: 0.84 }, MED), 5.5), T, { pos: [sx * 0.01, -0.195, -0.064], rot: [0.03, 0, 0], gloss: 0.7 });
    if (!lo) k.add(TH, shell({ rx: 0.018, ry: 0.11, rz: 0.058, p: 0.5, bot: 0.8 }, SM), CERAMIC_2, { pos: [sx * 0.086, -0.16, 0.016], rot: [0, 0, sx * 0.05], gloss: C });
    k.add(SH, shell({ rx: 0.068, ry: 0.068, rz: 0.05, p: 0.6 }, SM), CERAMIC, { pos: [0, -0.012, -0.062], gloss: C });
    k.add(SH, tube(0.058, 0.048, shin, radial, rings), SUIT, { gloss: 0.15, blend: [{ bone: TH, y: 0.0, w: 0.07 }] });
    // Shin guard wraps the front; the calf stays undersuit.
    k.add(SH, bend(shell({ rx: 0.08, ry: 0.162, rz: 0.026, p: 0.55, q: 0.7, top: 1.06, bot: 0.84 }, MED), 7), CERAMIC, { pos: [0, -0.205, -0.05], gloss: C });
    k.add(SH, shell({ rx: 0.015, ry: 0.12, rz: 0.008, p: 0.4 }, TN), '#ffffff', { pos: [0, -0.2, -0.075], rot: [-0.04, 0, 0], paint: 1, gloss: C });
    // Boot: dark foot, ceramic toe cap, heavy sole, tinted ankle cuff.
    if (!lo) k.add(FT, shell({ rx: 0.07, ry: 0.065, rz: 0.08, p: 0.55 }, SM), '#3b3834', { pos: [0, -0.012, -0.01], gloss: 0.35 });
    k.add(FT, shell({ rx: 0.07, ry: lo ? 0.06 : 0.048, rz: 0.13, p: 0.45, q: 0.6 }, SM), SUIT_MID, { pos: [0, lo ? -0.03 : -0.043, -0.058], gloss: 0.3 });
    k.add(FT, shell({ rx: 0.066, ry: 0.044, rz: 0.06, p: 0.5 }, SM), CERAMIC, { pos: [0, -0.04, -0.135], gloss: C });
    k.add(FT, shell({ rx: 0.075, ry: 0.018, rz: 0.145, p: 0.3, q: 0.5 }, SM), '#1f1d1b', { pos: [0, -0.068, -0.055], gloss: 0.2 });
    if (fine) k.add(FT, cyl(0.07, 0.072, 0.05, radial), T, { pos: [0, 0.025, 0], gloss: 0.6 });
  });

  // ── Arms ──────────────────────────────────────────────────────────────
  k.both((s, sx) => {
    const CL = `clav${s}` as const;
    const UA = `upperArm${s}` as const;
    const FA = `forearm${s}` as const;
    const HD = `hand${s}` as const;
    const P: SqParams = { rx: 0.108, ry: 0.074, rz: 0.118, p: 0.62, q: 0.78, top: 0.88 };
    const pAt: [number, number, number] = [sx * 0.05, 0.045, 0];
    const pRot: [number, number, number] = [0, 0, -sx * 0.3];
    k.add(CL, shell(P, BIG), CERAMIC, { pos: pAt, rot: pRot, gloss: C });
    k.add(CL, sqPatch(P, 0.003, 0, Math.PI * 2, 1.2, 0.2, k.n(8, 12, 24), 1), '#ffffff', { pos: pAt, rot: pRot, paint: 1, gloss: C });
    k.add(CL, shell({ rx: 0.098, ry: 0.05, rz: 0.104, p: 0.6 }, SM), T, { pos: [sx * 0.078, -0.022, 0], rot: [0, 0, -sx * 0.46], gloss: 0.7 });
    if (fine) k.add(UA, shell({ rx: 0.06, ry: 0.06, rz: 0.06, p: 0.9 }, SM), SUIT_MID, { pos: [0, -0.02, 0], gloss: 0.2 });
    k.add(UA, tube(0.054, 0.048, upper, radial, rings), SUIT, { gloss: 0.15, blend: [{ bone: FA, y: -upper, w: 0.06 }] });
    k.add(UA, shell({ rx: 0.058, ry: 0.085, rz: 0.058, p: 0.55 }, SM), T, { pos: [sx * 0.008, -0.145, 0], gloss: 0.7 });
    if (!lo) k.add(FA, shell({ rx: 0.04, ry: 0.04, rz: 0.035, p: 0.6 }, TN), CERAMIC_2, { pos: [0, -0.005, 0.03], gloss: C });
    k.add(FA, tube(0.05, 0.043, fore, radial, rings), SUIT, { gloss: 0.15, blend: [{ bone: UA, y: 0, w: 0.06 }] });
    k.add(FA, shell({ rx: 0.053, ry: 0.095, rz: 0.053, p: 0.55, top: 1.08, bot: 0.9 }, MED), CERAMIC, { pos: [0, -0.15, 0], gloss: C });
    k.add(FA, cyl(0.054, 0.054, 0.022, radial + 2), '#ffffff', { pos: [0, -0.214, 0], paint: 1, gloss: C });
    // Glove (grip-anchor convention: fingers −Z, knuckles +Y, wrist +Z).
    k.add(HD, shell({ rx: 0.027, ry: 0.038, rz: 0.05, p: 0.55 }, SM), GLOVE, { pos: [0, -0.008, -0.058], gloss: 0.3 });
    if (!lo) k.add(HD, shell({ rx: 0.028, ry: 0.012, rz: 0.03, p: 0.5 }, TN), T, { pos: [0, 0.028, -0.058], gloss: 0.6 });
    if (fine) k.add(HD, shell({ rx: 0.025, ry: 0.028, rz: 0.02, p: 0.6 }, TN), GLOVE, { pos: [0, -0.038, -0.088], gloss: 0.3 });
    if (!lo) k.add(HD, shell({ rx: 0.012, ry: 0.012, rz: 0.028, p: 0.7 }, TN), GLOVE, { pos: [-sx * 0.026, -0.004, -0.042], rot: [0.5, 0, 0], gloss: 0.3 });
  });

  // ── Backpack + antenna ─────────────────────────────────────────────────
  k.add('pack', shell({ rx: 0.14, ry: 0.16, rz: 0.07, p: 0.45, q: 0.55 }, MED), CERAMIC, { pos: [0, 0, 0.04], gloss: C });
  k.add('pack', shell({ rx: 0.141, ry: 0.013, rz: 0.071, p: 0.45, q: 0.4 }, SM), '#ffffff', { pos: [0, 0.055, 0.04], paint: 1, gloss: C });
  if (!lo) for (const sx of [-1, 1]) k.add('pack', shell({ rx: 0.026, ry: 0.13, rz: 0.056, p: 0.5 }, SM), T, { pos: [sx * 0.14, -0.005, 0.04], gloss: 0.7 });
  k.add('pack', shell({ rx: 0.12, ry: 0.026, rz: 0.062, p: 0.5 }, SM), T, { pos: [0, 0.158, 0.035], gloss: 0.7 });
  if (fine) for (let i = 0; i < 3; i++) k.add('pack', shell({ rx: 0.08, ry: 0.008, rz: 0.01, p: 0.4 }, TN), DARK, { pos: [0, -0.1 + i * 0.026, 0.108], gloss: 0.3 });
  k.add('pack', shell({ rx: 0.012, ry: 0.012, rz: 0.006, p: 0.8 }, TN), '#ffffff', { pos: [-0.09, 0.11, 0.109], glow: 1 });
  if (!lo) k.add('pack', cyl(0.018, 0.022, 0.05, radial), DARK, { pos: [0.105, 0.172, 0.05], gloss: 0.4 });
  k.add('antenna', cyl(0.005, 0.0075, 0.42, lo ? 3 : 5), DARK, { pos: [0, 0.2, 0], gloss: 0.4 });
  if (fine) k.add('antenna', cyl(0.012, 0.012, 0.022, radial), CERAMIC, { pos: [0, 0.1, 0], gloss: C });
  k.add('antenna', shell({ rx: 0.011, ry: 0.02, rz: 0.011, p: 1 }, TN), '#ffffff', { pos: [0, 0.415, 0], glow: 1.1 });
}
