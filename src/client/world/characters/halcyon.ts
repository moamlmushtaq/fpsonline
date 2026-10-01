// ─────────────────────────────────────────────────────────────────────────────
// HALCYON — ceramic-white armour, warm orange accents, calm and disciplined.
//
// Silhouette read at 80 m ("castle" outline): a tall upright figure with BROAD
// SQUARE pauldrons, a crested helmet flanked by two rocket-pack pods that rise
// above the shoulders with team-coloured tip lights, a V-shaped torso over a
// narrow waist and straight armoured legs. Design language: 1970s NASA
// industrial — tapered ceramic plates (squarish superquadrics, never pills)
// layered over a dark charcoal undersuit with anatomical muscle profiles;
// undersuit shows at every joint; panel seams, bevel wear and scuffs come from
// the shader (material.ts); orange accents on pauldrons, crest, forearms,
// shins, pack and pods.
//
// Far readability: the visor, the pod tip lights and the chest status light
// are flagged to grow with distance (kit PartOpts.visor / farGrow).
//
// Detail tiers: `lo` (low preset AND the far LOD) keeps the silhouette markers
// + accents; the gameplay tier adds panel breakup, gloves and boots detail;
// `fine` (menu showcase) adds greebles.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { VisorStyle } from '../../../shared/cosmetics';
import { band, bend, cyl, FRONT, limb, sq, sqPatch, type Kit, type SqParams } from './kit';
import { addVisor } from './visor';
import type { RigDef } from './rig';

const CERAMIC = '#efebe2';
const CERAMIC_2 = '#d8d2c5';
const SUIT = '#373430';
const SUIT_MID = '#4b4741';
const DARK = '#252321';
const GLOVE = '#2f2d2a';
const GLASS = '#16181d';

export const HALCYON_HELMET: SqParams = { rx: 0.126, ry: 0.146, rz: 0.148, p: 0.74, q: 0.86, top: 0.86, bot: 1.0 };
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
  const C = 0.85; // ceramic gloss
  const P = 0.72; // painted panel gloss (still "hard" for seams)
  const { upper, fore, thigh, shin } = rig;
  // Limb profiles thin out by tier: low keeps joint / bulge / joint.
  const prof = (pts: [number, number][]): [number, number][] =>
    lo ? [pts[0], pts[1], pts[pts.length - 1]] : !fine && pts.length > 4 ? [pts[0], pts[1], pts[2], pts[pts.length - 1]] : pts;
  const LIMB = (pts: [number, number][], len: number, flat = 1): THREE.BufferGeometry => limb(prof(pts), len, radial, flat);

  // ── Head ──────────────────────────────────────────────────────────────
  const H = HALCYON_HELMET;
  const HA = HALCYON_HELMET_AT;
  k.add('head', shell(H, BIG), CERAMIC, { pos: HA, gloss: C });
  // Visor: dark glass faceplate band recessed under a ceramic brow.
  const eyeTh = 1.68;
  k.add('head', sqPatch(H, 0.004, FRONT - 1.5, 3.0, eyeTh - 0.25, 0.46, k.n(9, 14, 24), k.n(1, 2, 4)), GLASS, { pos: HA, gloss: 1, ao: 0.3 });
  if (!lo) k.add('head', sqPatch(H, 0.011, FRONT - 1.55, 3.1, eyeTh - 0.37, 0.12, k.n(9, 12, 24), 1), CERAMIC, { pos: HA, gloss: C });
  addVisor(k, visor, { bone: 'head', surf: H, at: HA, eyeTheta: eyeTh + 0.02 });
  // Chin guard: one smooth ceramic piece flowing out of the helmet sides.
  k.add('head', shell({ rx: 0.112, ry: 0.058, rz: 0.098, p: 0.58, q: 0.7, top: 1, bot: 0.7 }, lo ? SM : MED), CERAMIC, { pos: [0, 0.02, -0.046], gloss: C });
  // Cheek guards: angled plates framing the jaw — breaks the egg-shaped
  // helmet into faceted planes (reads as a helmet, not a mannequin head).
  if (!lo) for (const sx of [-1, 1]) k.add('head', shell({ rx: 0.018, ry: 0.052, rz: 0.062, p: 0.42, q: 0.55, bot: 0.75 }, SM), CERAMIC_2, { pos: [sx * 0.104, 0.04, -0.068], rot: [0.12, sx * 0.55, sx * 0.12], gloss: C });
  // Crest: a ceramic fin from brow to nape with an orange spine — the upright
  // "tall" marker in profile (calm 1970s capsule helmet, not a mohawk).
  k.add('head', shell({ rx: 0.015, ry: 0.05, rz: 0.142, p: 0.42, q: 0.55, top: 0.7 }, SM), CERAMIC_2, { pos: [0, HA[1] + 0.118, 0.022], rot: [-0.1, 0, 0], gloss: C });
  if (!lo) k.add('head', shell({ rx: 0.0105, ry: 0.007, rz: 0.13, p: 0.45, q: 0.6 }, TN), '#ffffff', { pos: [0, HA[1] + 0.163, 0.026], rot: [-0.1, 0, 0], paint: 1, gloss: P });
  // Ear pods (comms): tinted ring + ceramic cap.
  for (const sx of [-1, 1]) {
    k.add('head', band(0.044, 0.028, radial + 2, 0.04), T, { pos: [sx * 0.12, 0.07, 0.032], rot: [0, 0, Math.PI / 2], gloss: P });
    if (fine) k.add('head', cyl(0.026, 0.03, 0.036, radial), CERAMIC_2, { pos: [sx * 0.122, 0.07, 0.032], rot: [0, 0, Math.PI / 2], gloss: C });
  }
  // Neck guard (back of the helmet rim).
  if (!lo) k.add('head', shell({ rx: 0.106, ry: 0.045, rz: 0.058, p: 0.55 }, SM), CERAMIC_2, { pos: [0, 0.035, 0.088], rot: [0.3, 0, 0], gloss: C });
  k.add('neck', limb([[0.062, 0], [0.058, 0.5], [0.07, 1]], 0.12, radial), SUIT, { pos: [0, 0.1, 0], gloss: 0.15, blend: [{ bone: 'chest', y: -0.02, w: 0.05 }] });

  // ── Torso: V-shaped ceramic cuirass over a narrow waist ────────────────
  k.add('chest', shell({ rx: 0.2, ry: 0.165, rz: 0.13, p: 0.45, q: 0.6, top: 1, bot: 0.7 }, BIG), CERAMIC, { pos: [0, 0.075, 0], gloss: C });
  // Pectoral plates (angled, squarish) + sternum groove.
  for (const sx of [-1, 1]) {
    k.add('chest', shell({ rx: 0.09, ry: 0.078, rz: 0.028, p: 0.38, q: 0.5, bot: 0.86 }, SM), CERAMIC, { pos: [sx * 0.092, 0.11, -0.112], rot: [-0.14, sx * 0.28, 0], gloss: C });
  }
  if (!lo) k.add('chest', shell({ rx: 0.012, ry: 0.082, rz: 0.02, p: 0.5 }, TN), SUIT, { pos: [0, 0.11, -0.118], gloss: 0.2 });
  // Shoulder yoke: a tinted plate over the trapezius bridging neck and
  // pauldrons (shoulders read as one broad block, not floating balls).
  k.add('chest', shell({ rx: 0.17, ry: 0.034, rz: 0.11, p: 0.42, q: 0.55 }, SM), T, { pos: [0, 0.222, 0.005], gloss: P });
  k.add('chest', cyl(0.082, 0.1, 0.05, radial + 2), SUIT_MID, { pos: [0, 0.252, 0], gloss: 0.25 });
  // Back plate (pack mounts on it).
  k.add('chest', shell({ rx: 0.168, ry: 0.13, rz: 0.045, p: 0.45 }, MED), CERAMIC_2, { pos: [0, 0.095, 0.108], gloss: C });
  // Chest status light (team colour; grows with distance) + chevrons.
  k.add('chest', shell({ rx: 0.034, ry: 0.009, rz: 0.006, p: 0.4 }, TN), '#ffffff', { pos: [-0.105, 0.165, -0.15], rot: [-0.14, -0.3, 0], glow: 1, farGrow: 1.6 });
  if (!lo) for (let i = 0; i < 2; i++) k.add('chest', shell({ rx: 0.034, ry: 0.0075, rz: 0.006, p: 0.4 }, TN), '#ffffff', { pos: [0.1, 0.078 + i * 0.022, -0.146], rot: [-0.14, 0.3, 0], paint: 1, gloss: P });

  k.add('spine', shell({ rx: 0.13, ry: 0.12, rz: 0.1, p: 0.8, top: 1.08, bot: 0.92 }, SM), SUIT_MID, {
    pos: [0, 0.07, 0.0], gloss: 0.2,
    blend: [{ bone: 'hips', y: -0.02, w: 0.07 }, { bone: 'chest', y: 0.2, w: 0.06 }],
  });
  // One smooth abdominal plate wrapped round the belly + a centre seam.
  k.add('spine', bend(shell({ rx: 0.108, ry: 0.078, rz: 0.03, p: 0.42, q: 0.6, top: 1.06, bot: 0.84 }, SM), 3.4), CERAMIC, { pos: [0, 0.072, -0.09], rot: [-0.08, 0, 0], gloss: C });
  if (!lo) k.add('spine', shell({ rx: 0.009, ry: 0.058, rz: 0.012, p: 0.5 }, TN), SUIT, { pos: [0, 0.07, -0.118], rot: [-0.08, 0, 0], gloss: 0.2 });
  if (!lo) for (const sx of [-1, 1]) k.add('spine', shell({ rx: 0.03, ry: 0.075, rz: 0.066, p: 0.45 }, SM), T, { pos: [sx * 0.12, 0.07, 0.0], gloss: P });

  // ── Pelvis ────────────────────────────────────────────────────────────
  if (!lo) k.add('hips', shell({ rx: 0.155, ry: 0.095, rz: 0.108, p: 0.7 }, MED), SUIT, { pos: [0, -0.03, 0], gloss: 0.15 });
  k.add('hips', shell({ rx: 0.168, ry: lo ? 0.06 : 0.03, rz: 0.122, p: 0.35, q: 0.5 }, SM), DARK, { pos: [0, lo ? 0.01 : 0.04, 0], gloss: 0.45 });
  if (!lo) k.add('hips', shell({ rx: 0.028, ry: 0.004, rz: 0.004, p: 0.4 }, TN), '#ffffff', { pos: [0, 0.04, -0.139], glow: 0.8 });
  if (fine) k.add('hips', shell({ rx: 0.042, ry: 0.026, rz: 0.012, p: 0.4 }, TN), CERAMIC, { pos: [0, 0.04, -0.126], gloss: C });
  k.add('hips', shell({ rx: 0.068, ry: 0.068, rz: 0.03, p: 0.45, bot: 0.62 }, SM), CERAMIC, { pos: [0, -0.06, -0.1], rot: [0.12, 0, 0], gloss: C });
  if (!lo) k.add('hips', shell({ rx: 0.12, ry: 0.058, rz: 0.03, p: 0.45 }, SM), CERAMIC_2, { pos: [0, -0.035, 0.105], rot: [-0.15, 0, 0], gloss: C });
  // Tassets: squared hip plates angled out over the thighs.
  for (const sx of [-1, 1]) {
    k.add('hips', shell({ rx: 0.03, ry: 0.09, rz: 0.084, p: 0.4, q: 0.55, bot: 0.86 }, SM), T, { pos: [sx * 0.168, -0.06, 0], rot: [0, 0, sx * 0.16], gloss: P });
    if (fine) k.add('hips', shell({ rx: 0.04, ry: 0.04, rz: 0.028, p: 0.45 }, TN), T, { pos: [sx * 0.105, 0.0, 0.122], gloss: 0.5 });
  }

  // ── Legs ──────────────────────────────────────────────────────────────
  k.both((s, sx) => {
    const TH = `thigh${s}` as const;
    const SH = `shin${s}` as const;
    const FT = `foot${s}` as const;
    // Undersuit with a real thigh / calf profile (not a straight pill).
    k.add(TH, LIMB([[0.082, 0], [0.087, 0.22], [0.075, 0.62], [0.06, 0.93], [0.058, 1]], thigh, 0.94), SUIT, {
      gloss: 0.15, blend: [{ bone: 'hips', y: 0.0, w: 0.09 }, { bone: SH, y: -thigh, w: 0.07 }],
    });
    // Thigh plate: tapered (broad at the hip, narrow at the knee), hugs the
    // front and sides — undersuit shows behind. Outer panel keeps the leg broad.
    // Two overlapping tassets: a tinted upper plate over a ceramic lower one.
    k.add(TH, bend(shell({ rx: 0.094, ry: 0.088, rz: 0.024, p: 0.38, q: 0.5, top: 1.06, bot: 0.86 }, SM), 5.5), T, { pos: [sx * 0.008, -0.115, -0.07], rot: [0.06, 0, 0], gloss: P });
    k.add(TH, bend(shell({ rx: 0.082, ry: 0.078, rz: 0.024, p: 0.38, q: 0.5, top: 1.02, bot: 0.8 }, SM), 6.2), CERAMIC, { pos: [sx * 0.006, -0.262, -0.062], rot: [0.02, 0, 0], gloss: C });
    if (!lo) k.add(TH, shell({ rx: 0.018, ry: 0.11, rz: 0.056, p: 0.42, bot: 0.78 }, SM), CERAMIC_2, { pos: [sx * 0.086, -0.16, 0.014], rot: [0, 0, sx * 0.05], gloss: C });
    // Knee cop: squared with a raised centre ridge.
    k.add(SH, shell({ rx: 0.064, ry: 0.066, rz: 0.048, p: 0.45, q: 0.6 }, SM), CERAMIC, { pos: [0, -0.012, -0.06], gloss: C });
    if (!lo) k.add(SH, shell({ rx: 0.012, ry: 0.05, rz: 0.012, p: 0.5 }, TN), '#ffffff', { pos: [0, -0.01, -0.106], paint: 1, gloss: P });
    k.add(SH, LIMB([[0.056, 0], [0.065, 0.26], [0.052, 0.62], [0.044, 0.85], [0.042, 1]], shin, 0.95), SUIT, { gloss: 0.15, blend: [{ bone: TH, y: 0.0, w: 0.07 }] });
    // Shin guard (tapered toward the ankle) + calf plate behind, so the leg
    // stays white from the back too.
    k.add(SH, bend(shell({ rx: 0.078, ry: 0.165, rz: 0.026, p: 0.42, q: 0.6, top: 1.12, bot: 0.8 }, MED), 7), CERAMIC, { pos: [0, -0.205, -0.048], gloss: C });
    k.add(SH, shell({ rx: 0.016, ry: 0.11, rz: 0.008, p: 0.4 }, TN), '#ffffff', { pos: [0, -0.21, -0.073], rot: [-0.04, 0, 0], paint: 1, gloss: P });
    if (!lo) k.add(SH, bend(shell({ rx: 0.056, ry: 0.085, rz: 0.02, p: 0.45, q: 0.6, top: 1.1, bot: 0.8 }, SM), -7), CERAMIC_2, { pos: [0, -0.15, 0.058], gloss: C });
    // Boot: dark foot, ceramic toe cap and heel, heavy sole, tinted ankle cuff.
    if (!lo) k.add(FT, shell({ rx: 0.068, ry: 0.065, rz: 0.08, p: 0.5 }, SM), '#3b3834', { pos: [0, -0.012, -0.01], gloss: 0.35 });
    k.add(FT, shell({ rx: 0.07, ry: lo ? 0.06 : 0.048, rz: 0.13, p: 0.42, q: 0.6 }, SM), SUIT_MID, { pos: [0, lo ? -0.03 : -0.043, -0.058], gloss: 0.3 });
    k.add(FT, shell({ rx: 0.066, ry: 0.044, rz: 0.06, p: 0.45 }, SM), CERAMIC, { pos: [0, -0.04, -0.135], gloss: C });
    if (!lo) k.add(FT, shell({ rx: 0.058, ry: 0.04, rz: 0.03, p: 0.45 }, TN), CERAMIC_2, { pos: [0, -0.035, 0.045], gloss: C });
    k.add(FT, shell({ rx: 0.075, ry: 0.018, rz: 0.145, p: 0.3, q: 0.5 }, SM), '#1f1d1b', { pos: [0, -0.068, -0.055], gloss: 0.2 });
    if (!lo) k.add(FT, band(0.066, 0.04, radial, 0.062), T, { pos: [0, 0.03, 0], gloss: 0.6 });
  });

  // ── Arms ──────────────────────────────────────────────────────────────
  k.both((s, sx) => {
    const CL = `clav${s}` as const;
    const UA = `upperArm${s}` as const;
    const FA = `forearm${s}` as const;
    const HD = `hand${s}` as const;
    // Broad SQUARE pauldron: flat-topped two-tier ceramic shell with an
    // orange band, a tinted lower lip and a raised outer rim.
    const PD: SqParams = { rx: 0.12, ry: 0.06, rz: 0.12, p: 0.34, q: 0.5, top: 0.84 };
    const pAt: [number, number, number] = [sx * 0.055, 0.045, 0];
    const pRot: [number, number, number] = [0, 0, -sx * 0.24];
    // (Grows ×1.25 from the shoulder at range: the broad-shoulder read.)
    const pg = { farGrow: 0.25, growAt: [-sx * 0.02, 0, 0] as [number, number, number] };
    k.add(CL, sq(PD, k.n(6, 9, 20), k.n(4, 5, 12)), CERAMIC, { pos: pAt, rot: pRot, gloss: C, ...pg });
    k.add(CL, sqPatch(PD, 0.003, 0, Math.PI * 2, 1.12, 0.3, k.n(6, 9, 24), 1), '#ffffff', { pos: pAt, rot: pRot, paint: 1, gloss: P, ...pg });
    k.add(CL, shell({ rx: 0.104, ry: 0.048, rz: 0.108, p: 0.45 }, SM), T, { pos: [sx * 0.082, -0.024, 0], rot: [0, 0, -sx * 0.4], gloss: P, ...pg });
    if (fine) k.add(UA, shell({ rx: 0.06, ry: 0.06, rz: 0.06, p: 0.9 }, SM), SUIT_MID, { pos: [0, -0.02, 0], gloss: 0.2 });
    k.add(UA, LIMB([[0.056, 0], [0.061, 0.3], [0.051, 0.75], [0.047, 1]], upper), SUIT, { gloss: 0.15, blend: [{ bone: FA, y: -upper, w: 0.06 }] });
    // Bicep plate (tapered, outer side).
    k.add(UA, shell({ rx: 0.052, ry: 0.085, rz: 0.056, p: 0.45, q: 0.6, top: 1.1, bot: 0.84 }, SM), T, { pos: [sx * 0.012, -0.145, 0], gloss: P });
    // Elbow cop.
    if (!lo) k.add(FA, shell({ rx: 0.04, ry: 0.04, rz: 0.035, p: 0.5 }, TN), CERAMIC_2, { pos: [0, -0.005, 0.03], gloss: C });
    k.add(FA, LIMB([[0.05, 0], [0.055, 0.25], [0.044, 0.75], [0.038, 1]], fore), SUIT, { gloss: 0.15, blend: [{ bone: UA, y: 0, w: 0.06 }] });
    // Vambrace: flared at the elbow, tapering to the wrist, orange cuff.
    k.add(FA, shell({ rx: 0.054, ry: 0.098, rz: 0.054, p: 0.45, q: 0.6, top: 1.14, bot: 0.84 }, MED), CERAMIC, { pos: [0, -0.145, 0], gloss: C });
    k.add(FA, band(0.05, 0.022, radial + 2, 0.052), '#ffffff', { pos: [0, -0.214, 0], paint: 1, gloss: P });
    // Glove (grip-anchor convention: fingers −Z, knuckles +Y, wrist +Z):
    // palm block, armoured back of the hand, curled fingers, thumb.
    k.add(HD, shell({ rx: 0.027, ry: 0.036, rz: 0.048, p: 0.55 }, SM), GLOVE, { pos: [0, -0.008, -0.056], gloss: 0.3 });
    if (!lo) k.add(HD, shell({ rx: 0.029, ry: 0.012, rz: 0.032, p: 0.45 }, TN), T, { pos: [0, 0.027, -0.058], gloss: 0.6 });
    if (!lo) k.add(HD, shell({ rx: 0.025, ry: 0.03, rz: 0.02, p: 0.6 }, TN), GLOVE, { pos: [0, -0.034, -0.09], rot: [0.3, 0, 0], gloss: 0.3 });
    if (!lo) k.add(HD, shell({ rx: 0.012, ry: 0.012, rz: 0.028, p: 0.7 }, TN), GLOVE, { pos: [-sx * 0.026, -0.004, -0.042], rot: [0.5, 0, 0], gloss: 0.3 });
  });

  // ── Rocket pack: box + twin pods rising above the shoulders ─────────────
  // The pods are THE far-silhouette marker: from front or back the helmet is
  // flanked by two vertical towers with team-coloured tip lights.
  k.add('pack', shell({ rx: 0.14, ry: 0.16, rz: 0.07, p: 0.4, q: 0.5 }, MED), CERAMIC, { pos: [0, 0, 0.04], gloss: C });
  k.add('pack', shell({ rx: 0.141, ry: 0.014, rz: 0.071, p: 0.4, q: 0.4 }, SM), '#ffffff', { pos: [0, 0.055, 0.04], paint: 1, gloss: P });
  k.add('pack', shell({ rx: 0.118, ry: 0.026, rz: 0.06, p: 0.45 }, SM), T, { pos: [0, 0.158, 0.035], gloss: P });
  if (fine) for (let i = 0; i < 3; i++) k.add('pack', shell({ rx: 0.08, ry: 0.008, rz: 0.01, p: 0.4 }, TN), DARK, { pos: [0, -0.1 + i * 0.026, 0.108], gloss: 0.3 });
  // Back light bar (team colour, visible from behind at range).
  k.add('pack', shell({ rx: 0.05, ry: 0.009, rz: 0.006, p: 0.5 }, TN), '#ffffff', { pos: [0, 0.11, 0.109], glow: 1, farGrow: 1.4 });
  const podR = 0.04;
  const podH = 0.4;
  for (const sx of [-1, 1]) {
    const px = sx * 0.2;
    const py = 0.16;
    const pz = 0.06;
    // Strut from the pack to the pod.
    if (!lo) k.add('pack', shell({ rx: 0.05, ry: 0.024, rz: 0.03, p: 0.45 }, TN), SUIT_MID, { pos: [sx * 0.15, 0.02, pz], gloss: 0.3 });
    // Pods grow taller from their base at range (×1.45 at 80 m).
    const gg = { farGrow: 0.45, growAt: [px, py - podH / 2, pz] as [number, number, number] };
    k.add('pack', band(podR * 1.12, podH, radial + 1, podR * 0.94), CERAMIC, { pos: [px, py, pz], gloss: C, ...gg });
    // Orange band + dark nozzle at the bottom, glowing cap at the top.
    k.add('pack', band(podR * 1.02, 0.045, radial + 1), '#ffffff', { pos: [px, py + podH * 0.28, pz], paint: 1, gloss: P, ...gg });
    if (!lo) k.add('pack', band(podR * 1.12, 0.05, radial + 1, podR * 0.86), DARK, { pos: [px, py - podH / 2 - 0.022, pz], gloss: 0.4 });
    k.add('pack', shell({ rx: podR * 0.95, ry: 0.034, rz: podR * 0.95, p: 0.8 }, TN), '#ffffff', { pos: [px, py + podH / 2 + 0.008, pz], glow: 1.2, ...gg });
    // Stabiliser fin (outward, swept back).
    if (!lo) k.add('pack', shell({ rx: 0.006, ry: 0.09, rz: 0.05, p: 0.4, top: 0.5 }, TN), CERAMIC_2, { pos: [px + sx * 0.042, py - 0.1, pz + 0.02], rot: [0.25, 0, sx * 0.12], gloss: C });
  }
  // Comms whip on the right pod.
  k.add('antenna', cyl(0.0055, 0.008, 0.36, lo ? 3 : 5), DARK, { pos: [0.095, 0.2, 0.01], gloss: 0.4 });
  k.add('antenna', shell({ rx: 0.011, ry: 0.02, rz: 0.011, p: 1 }, TN), '#ffffff', { pos: [0.095, 0.385, 0.01], glow: 1.1 });
  if (fine) k.add('antenna', cyl(0.012, 0.012, 0.022, radial), CERAMIC, { pos: [0.095, 0.1, 0.01], gloss: C });

  // Far value lift: the dark undersuit, belt, gloves and boots drift toward
  // ceramic at range (not the visor glass — its dark band frames the visor).
  for (const part of k.parts) {
    const c = part.color;
    if (part.o.glow || part.o.visor || (part.o.gloss ?? 0) >= 1) continue;
    if (c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722 < 0.12) part.o.farLift = 1;
  }
}
