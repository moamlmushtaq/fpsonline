// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — procedural stylized soldiers (CharacterFactory).
//
// Silhouettes readable at 80 m by shape alone (art bible §5):
//  • HALCYON — tall, clean, symmetric; rounded ceramic-white helmet with a
//    horizontal visor line, broad smooth pauldrons, backpack + antenna, team
//    accent stripes, calm upright posture.
//  • THE BLOOM — hunched & asymmetric; layered organic plates, leaf fronds and
//    glowing bulbs on the left shoulder, a hood with a crest, loose fabric
//    wraps, emissive visor + secondary (violet) accents.
//
// Rendering: every character is ONE SkinnedMesh (rigid parts bound to 20
// bones, per-vertex colors) with 3 material groups (ceramic armor, fabric,
// emissive) — 3 draw calls + the merged world weapon. Geometry is cached per
// (faction, colors, cosmetics, detail) and shared between characters.
//
// Animation is fully procedural: gait from velocity relative to facing
// (forward / backpedal / strafe), crouch, slide, airborne, mantle, aim pitch
// through spine/chest/head, 2-bone arm IK onto the weapon's grips, sprint
// run-carry, ADS raise, reload gesture, fire kick, flinch and idle breathing —
// all blended with frame-rate independent smoothing.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CharacterAnim, CharacterFactory, CharacterOptions, CharacterView, MaterialLibrary, WeaponModelFactory } from '../contracts';
import type { Faction, Team, Vec3, WeaponId } from '../../shared/types';
import { findArmor, findVisor, type VisorStyle } from '../../shared/cosmetics';
import { ENV, getColorblindMode, teamColors } from '../engine/palette';
import { damp, Spring } from '../engine/camera-feel';
import { proceduralTexture } from '../engine/textures';
import type { WeaponModelView } from './weapon-models';

type V3 = [number, number, number];
type Slot = 'armor' | 'suit' | 'glow';

const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'forearmL', 'handL',
  'shoulderR', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'pack',
] as const;
type BoneName = (typeof BONES)[number];

const PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', upperArmL: 'shoulderL', forearmL: 'upperArmL', handL: 'forearmL',
  shoulderR: 'chest', upperArmR: 'shoulderR', forearmR: 'upperArmR', handR: 'forearmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR', pack: 'chest',
};

const UPPER = 0.28;
const FORE = 0.26;
const SHIN = 0.43;
const THIGH = 0.43;

interface Rest {
  pos: V3;
  rot: V3;
}

function restPose(f: Faction): Record<BoneName, Rest> {
  const bloom = f === 1;
  const r = (pos: V3, rot: V3 = [0, 0, 0]): Rest => ({ pos, rot });
  return {
    hips: r([0, bloom ? 0.95 : 0.98, 0]),
    spine: r([0, 0.12, 0], bloom ? [0.2, 0, 0.03] : [0, 0, 0]),
    chest: r([0, 0.2, 0], bloom ? [0.12, 0, 0.02] : [0, 0, 0]),
    neck: r([0, 0.2, bloom ? -0.02 : 0], bloom ? [-0.22, 0, 0] : [0, 0, 0]),
    head: r([0, 0.08, 0], bloom ? [-0.08, 0, 0] : [0, 0, 0]),
    shoulderL: r([-0.21, bloom ? 0.15 : 0.13, 0]),
    upperArmL: r([-0.02, -0.02, 0]),
    forearmL: r([0, -UPPER, 0]),
    handL: r([0, -FORE, 0]),
    shoulderR: r([0.21, bloom ? 0.11 : 0.13, 0]),
    upperArmR: r([0.02, -0.02, 0]),
    forearmR: r([0, -UPPER, 0]),
    handR: r([0, -FORE, 0]),
    thighL: r([-0.105, -0.06, 0]),
    shinL: r([0, -THIGH, 0]),
    footL: r([0, -SHIN, 0]),
    thighR: r([0.105, -0.06, 0]),
    shinR: r([0, -THIGH, 0]),
    footR: r([0, -SHIN, 0]),
    pack: r([0, 0.03, 0.17]),
  };
}

// ── Geometry assembly ───────────────────────────────────────────────────────

interface Part {
  bone: BoneName;
  geo: THREE.BufferGeometry;
  slot: Slot;
  color: THREE.Color;
  m: THREE.Matrix4;
}

class Assembler {
  readonly parts: Part[] = [];
  private readonly tmpE = new THREE.Euler();
  private readonly tmpQ = new THREE.Quaternion();
  constructor(readonly seg: number) {}

  add(bone: BoneName, geo: THREE.BufferGeometry, slot: Slot, color: THREE.Color | string, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      this.tmpQ.setFromEuler(this.tmpE.set(rot[0], rot[1], rot[2])),
      new THREE.Vector3(...scale),
    );
    this.parts.push({ bone, geo, slot, color: typeof color === 'string' ? new THREE.Color(color) : color, m });
  }

  box(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
    return new RoundedBoxGeometry(w, h, d, this.seg > 1 ? 2 : 1, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  }
  sphere(r: number): THREE.BufferGeometry {
    return new THREE.SphereGeometry(r, this.seg > 1 ? 14 : 9, this.seg > 1 ? 10 : 6);
  }
  capsule(r: number, len: number): THREE.BufferGeometry {
    return new THREE.CapsuleGeometry(r, len, this.seg > 1 ? 3 : 2, this.seg > 1 ? 10 : 7);
  }
  cyl(rt: number, rb: number, h: number, radial = 12): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(rt, rb, h, this.seg > 1 ? radial : Math.max(6, radial >> 1), 1);
  }
  /** Curved band on a cylinder (visors, collars), centred on −Z. */
  arc(r: number, h: number, span: number): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(r, r, h, this.seg > 1 ? 16 : 8, 1, true, Math.PI - span / 2, span);
  }
  torus(r: number, tube: number): THREE.BufferGeometry {
    return new THREE.TorusGeometry(r, tube, this.seg > 1 ? 6 : 4, this.seg > 1 ? 18 : 10);
  }
  /** Closed lathe profile (radius, y) around Y. */
  lathe(pts: [number, number][]): THREE.BufferGeometry {
    return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), this.seg > 1 ? 14 : 8);
  }
}

interface Palette {
  armor: THREE.Color;
  tint: THREE.Color;
  suit: THREE.Color;
  accent: THREE.Color;
  accent2: THREE.Color;
  glow: THREE.Color;
  dark: THREE.Color;
}

function palette(f: Faction, team: Team, armorId: string): Palette {
  const tc = teamColors(team);
  const tint = new THREE.Color(findArmor(armorId).color);
  if (f === 0) {
    return {
      armor: new THREE.Color('#f1ece2'),
      tint,
      suit: new THREE.Color('#3a3835'),
      accent: new THREE.Color(tc.primary),
      accent2: new THREE.Color(tc.primary).lerp(new THREE.Color('#ffffff'), 0.25),
      glow: new THREE.Color(tc.emissive),
      dark: new THREE.Color('#2a2826'),
    };
  }
  return {
    armor: new THREE.Color(ENV.sage).lerp(new THREE.Color(ENV.bone), 0.45),
    tint: tint.clone().lerp(new THREE.Color(ENV.olive), 0.25),
    suit: new THREE.Color('#5c5548'),
    accent: new THREE.Color(tc.secondary),
    accent2: new THREE.Color(tc.primary),
    glow: new THREE.Color(tc.emissive),
    dark: new THREE.Color('#2c2a26'),
  };
}

function addVisor(a: Assembler, style: VisorStyle, glow: THREE.Color, recess: THREE.Color, y: number, r: number): void {
  const shape = style.shape;
  const add = (g: THREE.BufferGeometry, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): void => a.add('head', g, 'glow', glow, pos, rot, scale);
  // Dark glass recess behind the emissive line.
  a.add('head', a.arc(r - 0.004, 0.05, shape === 'halo' ? Math.PI * 2 : 2.2), 'suit', recess, [0, y, 0]);
  switch (shape) {
    case 'band':
      add(a.arc(r, 0.026, 2.0), [0, y, 0]);
      break;
    case 'slit':
      add(a.arc(r, 0.012, 1.3), [0, y + 0.004, 0]);
      break;
    case 'twin':
      add(a.arc(r, 0.022, 0.55), [0, y, 0], [0, 0.42, 0]);
      add(a.arc(r, 0.022, 0.55), [0, y, 0], [0, -0.42, 0]);
      break;
    case 'cross':
      add(a.arc(r, 0.018, 1.6), [0, y, 0]);
      add(a.box(0.016, 0.09, 0.012, 0.005), [0, y + 0.005, -r - 0.002]);
      break;
    case 'halo':
      add(a.torus(r + 0.006, 0.008), [0, y + 0.01, 0], [Math.PI / 2, 0, 0]);
      break;
    case 'mono':
      add(new THREE.CircleGeometry(0.03, 16), [0, y, -r - 0.004], [0, Math.PI, 0]);
      add(a.torus(0.034, 0.005), [0, y, -r - 0.002]);
      break;
  }
}

function buildHalcyon(a: Assembler, p: Palette, visor: VisorStyle): void {
  const A = p.armor, T = p.tint, S = p.suit, X = p.accent, D = p.dark;
  // Hips & legs.
  a.add('hips', a.box(0.34, 0.17, 0.24, 0.06), 'armor', T, [0, -0.02, 0]);
  a.add('hips', a.box(0.37, 0.05, 0.27, 0.02), 'suit', D, [0, 0.06, 0]);
  a.add('hips', a.box(0.12, 0.1, 0.05, 0.02), 'armor', A, [0, -0.05, -0.12]);
  for (const s of ['L', 'R'] as const) {
    const sx = s === 'L' ? -1 : 1;
    a.add(`thigh${s}`, a.capsule(0.078, 0.26), 'suit', S, [0, -0.2, 0]);
    a.add(`thigh${s}`, a.box(0.17, 0.3, 0.155, 0.06), 'armor', T, [0.01 * sx, -0.2, -0.015]);
    a.add(`shin${s}`, a.sphere(0.078), 'armor', A, [0, 0.0, -0.04], [0, 0, 0], [1, 0.95, 0.85]);
    a.add(`shin${s}`, a.capsule(0.065, 0.26), 'suit', S, [0, -0.2, 0]);
    a.add(`shin${s}`, a.box(0.145, 0.33, 0.155, 0.055), 'armor', A, [0, -0.2, -0.015]);
    a.add(`shin${s}`, a.box(0.03, 0.22, 0.02, 0.008), 'armor', X, [0, -0.19, -0.093]);
    a.add(`foot${s}`, a.box(0.13, 0.1, 0.27, 0.035), 'suit', D, [0, -0.02, -0.05]);
    a.add(`foot${s}`, a.box(0.135, 0.03, 0.28, 0.01), 'armor', T, [0, -0.07, -0.05]);
  }
  // Torso.
  a.add('spine', a.capsule(0.14, 0.12), 'suit', S, [0, 0.08, 0]);
  for (let i = 0; i < 3; i++) a.add('spine', a.box(0.25 - i * 0.02, 0.055, 0.08, 0.025), 'armor', A, [0, 0.0 + i * 0.058, -0.105]);
  a.add('chest', a.box(0.44, 0.37, 0.29, 0.11), 'armor', A, [0, 0.06, -0.01]);
  a.add('chest', a.box(0.035, 0.24, 0.02, 0.01), 'armor', X, [-0.09, 0.09, -0.157]);
  a.add('chest', a.box(0.035, 0.24, 0.02, 0.01), 'armor', X, [0.09, 0.09, -0.157]);
  a.add('chest', a.box(0.12, 0.05, 0.03, 0.015), 'suit', D, [0, 0.19, -0.15]);
  a.add('chest', a.torus(0.105, 0.03), 'suit', S, [0, 0.24, 0], [Math.PI / 2, 0, 0]);
  // Backpack + antenna.
  a.add('pack', a.box(0.34, 0.4, 0.16, 0.06), 'armor', T, [0, 0.04, 0.03]);
  a.add('pack', a.box(0.3, 0.06, 0.17, 0.02), 'armor', A, [0, 0.2, 0.03]);
  a.add('pack', a.box(0.26, 0.03, 0.02, 0.01), 'armor', X, [0, -0.05, 0.115]);
  a.add('pack', a.cyl(0.009, 0.009, 0.52, 6), 'suit', D, [0.12, 0.44, 0.06]);
  a.add('pack', a.sphere(0.018), 'glow', p.glow, [0.12, 0.71, 0.06]);
  a.add('pack', a.cyl(0.03, 0.03, 0.05), 'armor', A, [0.12, 0.2, 0.06]);
  // Shoulders: broad smooth pauldrons with accent stripe.
  for (const s of ['L', 'R'] as const) {
    const sx = s === 'L' ? -1 : 1;
    a.add(`shoulder${s}`, a.sphere(0.13), 'armor', A, [0.03 * sx, 0.02, 0], [0, 0, -0.25 * sx], [1.15, 0.78, 1.12]);
    a.add(`shoulder${s}`, a.box(0.2, 0.025, 0.24, 0.01), 'armor', X, [0.06 * sx, 0.075, 0], [0, 0, -0.32 * sx]);
    a.add(`upperArm${s}`, a.capsule(0.056, 0.18), 'suit', S, [0, -0.14, 0]);
    a.add(`upperArm${s}`, a.box(0.11, 0.15, 0.11, 0.04), 'armor', T, [0, -0.13, 0]);
    a.add(`forearm${s}`, a.box(0.105, 0.2, 0.105, 0.04), 'armor', A, [0, -0.12, 0]);
    a.add(`forearm${s}`, a.box(0.11, 0.025, 0.11, 0.01), 'armor', X, [0, -0.21, 0]);
    a.add(`hand${s}`, a.box(0.075, 0.1, 0.06, 0.025), 'suit', D, [0, -0.04, 0]);
  }
  // Neck & helmet.
  a.add('neck', a.cyl(0.06, 0.07, 0.12), 'suit', S, [0, 0.03, 0]);
  const hy = 0.1;
  a.add('head', a.sphere(0.152), 'armor', A, [0, hy, 0.005], [0, 0, 0], [1, 1.08, 1.12]);
  a.add('head', a.box(0.2, 0.07, 0.14, 0.035), 'armor', A, [0, hy - 0.1, -0.05]);
  for (const sx of [-1, 1]) a.add('head', a.cyl(0.045, 0.045, 0.04, 12), 'armor', T, [0.152 * sx, hy - 0.01, 0.01], [0, 0, Math.PI / 2]);
  addVisor(a, visor, p.glow, D, hy + 0.005, 0.159);
}

function buildBloom(a: Assembler, p: Palette, visor: VisorStyle): void {
  const A = p.armor, T = p.tint, S = p.suit, X = p.accent, D = p.dark, G = p.glow;
  const leaf = new THREE.Color(ENV.olive).lerp(new THREE.Color(ENV.sage), 0.4);
  // Hips: loose layered wraps (closed lathe skirt) + belt of plates.
  a.add('hips', a.lathe([[0.19, 0.08], [0.2, 0.08], [0.27, -0.22], [0.24, -0.24], [0.17, 0.02], [0.19, 0.08]]), 'suit', S, [0, -0.02, 0], [0, 0, 0], [1, 1, 0.85]);
  a.add('hips', a.box(0.33, 0.12, 0.23, 0.05), 'armor', T, [0, 0.0, 0]);
  a.add('hips', a.box(0.36, 0.045, 0.26, 0.02), 'suit', D, [0, 0.06, 0]);
  for (const s of ['L', 'R'] as const) {
    const sx = s === 'L' ? -1 : 1;
    a.add(`thigh${s}`, a.capsule(0.082, 0.26), 'suit', S, [0, -0.2, 0]);
    a.add(`thigh${s}`, a.sphere(0.1), 'armor', A, [0.02 * sx, -0.14, -0.05], [0.2, 0, 0], [0.9, 1.3, 0.55]);
    a.add(`shin${s}`, a.capsule(0.068, 0.26), 'suit', S, [0, -0.2, 0]);
    a.add(`shin${s}`, a.sphere(0.075), 'armor', A, [0, -0.02, -0.05], [0, 0, 0], [1, 1.1, 0.8]);
    a.add(`shin${s}`, a.sphere(0.08), 'armor', T, [0, -0.2, -0.04], [0.1, 0, 0], [0.95, 1.9, 0.7]);
    for (let i = 0; i < 3; i++) a.add(`shin${s}`, a.torus(0.072, 0.012), 'suit', D, [0, -0.28 + i * 0.07, 0], [Math.PI / 2 + 0.2 * (i - 1), 0, 0]);
    a.add(`foot${s}`, a.box(0.13, 0.1, 0.26, 0.04), 'suit', D, [0, -0.02, -0.05]);
  }
  // Torso: layered organic plates, asymmetric.
  a.add('spine', a.capsule(0.145, 0.12), 'suit', S, [0, 0.08, 0]);
  a.add('spine', a.sphere(0.12), 'armor', A, [0, 0.07, -0.08], [0.2, 0, 0], [1.1, 0.8, 0.6]);
  a.add('chest', a.sphere(0.2), 'armor', A, [0, 0.07, -0.02], [0, 0, 0], [1.1, 0.95, 0.85]);
  a.add('chest', a.sphere(0.16), 'armor', T, [0.05, 0.02, -0.1], [0.3, 0.2, 0.25], [1.05, 0.8, 0.45]);
  a.add('chest', a.sphere(0.14), 'armor', A, [-0.06, 0.12, -0.12], [0.1, -0.3, -0.2], [1, 0.75, 0.4]);
  a.add('chest', a.box(0.03, 0.2, 0.02, 0.01), 'armor', X, [0.11, 0.05, -0.19], [0.1, 0, 0.25]);
  // Scarf wraps.
  a.add('chest', a.torus(0.12, 0.045), 'suit', S, [0, 0.22, 0.01], [Math.PI / 2 + 0.2, 0, 0.1]);
  a.add('chest', a.box(0.1, 0.3, 0.03, 0.015), 'suit', S, [-0.08, 0.02, 0.18], [0.2, 0, 0.15]);
  // Organic pack: seed pod with a sprout.
  a.add('pack', a.sphere(0.16), 'armor', T, [0, 0.0, 0.03], [0, 0, 0], [1, 1.2, 0.75]);
  a.add('pack', a.cyl(0.012, 0.018, 0.3, 6), 'suit', leaf, [-0.08, 0.26, 0.04], [0, 0, 0.35]);
  a.add('pack', a.sphere(0.03), 'glow', G, [-0.14, 0.4, 0.04]);
  // Left shoulder: leaf fronds + glowing bulbs (the asymmetric signature).
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    a.add('shoulderL', a.sphere(0.06), 'suit', leaf, [-0.05 - t * 0.04, 0.08 + t * 0.03, 0.06 - t * 0.12], [0.5 - t * 1.2, 0.3, -0.9 - t * 0.3], [0.5, 0.25, 2.6]);
  }
  for (let i = 0; i < 3; i++) a.add('shoulderL', a.sphere(0.028 + i * 0.006), 'glow', G, [-0.06 + i * 0.035, 0.1 + i * 0.02, 0.04 - i * 0.05]);
  a.add('shoulderL', a.sphere(0.1), 'armor', A, [-0.02, 0.02, 0], [0, 0, 0.3], [1.1, 0.8, 1]);
  // Right shoulder: one heavy plate.
  a.add('shoulderR', a.sphere(0.14), 'armor', T, [0.04, 0.02, 0], [0, 0, -0.35], [1.2, 0.72, 1.15]);
  a.add('shoulderR', a.box(0.18, 0.022, 0.2, 0.01), 'armor', X, [0.06, 0.07, 0], [0, 0, -0.42]);
  for (const s of ['L', 'R'] as const) {
    a.add(`upperArm${s}`, a.capsule(0.058, 0.18), 'suit', S, [0, -0.14, 0]);
    a.add(`forearm${s}`, a.capsule(0.056, 0.16), 'suit', S, [0, -0.12, 0]);
    for (let i = 0; i < 3; i++) a.add(`forearm${s}`, a.torus(0.06, 0.011), 'suit', D, [0, -0.05 - i * 0.06, 0], [Math.PI / 2 + 0.25, 0, 0]);
    a.add(`forearm${s}`, a.sphere(0.06), 'armor', A, [0, -0.1, -0.04], [0, 0, 0], [1, 1.6, 0.6]);
    a.add(`hand${s}`, a.box(0.075, 0.1, 0.06, 0.025), 'suit', D, [0, -0.04, 0]);
  }
  // Neck, hood and crest.
  a.add('neck', a.cyl(0.065, 0.075, 0.12), 'suit', S, [0, 0.03, 0]);
  const hy = 0.1;
  a.add('head', a.sphere(0.145), 'armor', A, [0, hy, -0.005], [0, 0, 0], [1, 1.05, 1.1]);
  a.add('head', a.sphere(0.19), 'suit', S, [0, hy + 0.025, 0.07], [-0.25, 0, 0], [1.02, 1.05, 1.0]);
  a.add('head', a.box(0.03, 0.12, 0.28, 0.012), 'armor', X, [0, hy + 0.2, 0.03], [0.5, 0, 0]);
  a.add('head', a.box(0.02, 0.08, 0.16, 0.008), 'armor', T, [0.04, hy + 0.17, 0.08], [0.6, 0, 0.3]);
  addVisor(a, visor, G, D, hy - 0.005, 0.152);
}

/** Bone rest world matrices for geometry assembly (root at the origin). */
function restMatrices(f: Faction): Record<BoneName, THREE.Matrix4> {
  const rest = restPose(f);
  const out = {} as Record<BoneName, THREE.Matrix4>;
  for (const b of BONES) {
    const r = rest[b];
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...r.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r.rot)), new THREE.Vector3(1, 1, 1));
    const p = PARENT[b];
    out[b] = p ? new THREE.Matrix4().multiplyMatrices(out[p], local) : local;
  }
  return out;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function characterGeometry(f: Faction, team: Team, armor: string, visorId: string, detail: number): THREE.BufferGeometry {
  const key = `${f}|${team}|${getColorblindMode()}|${armor}|${visorId}|${detail}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const a = new Assembler(detail);
  const pal = palette(f, team, armor);
  const visor = findVisor(visorId);
  if (f === 0) buildHalcyon(a, pal, visor);
  else buildBloom(a, pal, visor);
  const mats = restMatrices(f);
  const bySlot: Record<Slot, THREE.BufferGeometry[]> = { armor: [], suit: [], glow: [] };
  for (const part of a.parts) {
    let g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    part.geo.dispose();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(mats[part.bone], part.m));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') g.deleteAttribute(n);
    const count = g.attributes.position.count;
    const col = new Float32Array(count * 3);
    const si = new Uint16Array(count * 4);
    const sw = new Float32Array(count * 4);
    const bi = BONES.indexOf(part.bone);
    for (let i = 0; i < count; i++) {
      col[i * 3] = part.color.r;
      col[i * 3 + 1] = part.color.g;
      col[i * 3 + 2] = part.color.b;
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    bySlot[part.slot].push(g);
  }
  const lists = (['armor', 'suit', 'glow'] as Slot[]).map((s) => (bySlot[s].length ? mergeGeometries(bySlot[s], false)! : null));
  const present = lists.filter((x): x is THREE.BufferGeometry => !!x);
  const merged = mergeGeometries(present, true)!;
  // Re-map groups to material indices 0 (armor), 1 (suit), 2 (glow).
  merged.clearGroups();
  let start = 0;
  lists.forEach((g, i) => {
    if (!g) return;
    const n = g.attributes.position.count;
    merged.addGroup(start, n, i);
    start += n;
    g.dispose();
  });
  for (const list of Object.values(bySlot)) for (const g of list) g.dispose();
  merged.computeBoundingSphere();
  geoCache.set(key, merged);
  return merged;
}

// ── Shared materials ───────────────────────────────────────────────────────

let armorMat: THREE.MeshStandardMaterial | null = null;
let suitMat: THREE.MeshStandardMaterial | null = null;
function sharedMaterials(): [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] {
  if (!armorMat) {
    armorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.02, map: proceduralTexture('wear', 256, 4) });
    armorMat.name = 'character.armor';
  }
  if (!suitMat) {
    suitMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, map: proceduralTexture('fabric', 256, 4) });
    suitMat.name = 'character.suit';
  }
  return [armorMat, suitMat];
}

// ── View ────────────────────────────────────────────────────────────────────

const DOWN = new THREE.Vector3(0, -1, 0);
// IK scratch (no per-frame allocation).
const _S = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _wrist = new THREE.Vector3();
const _seg = new THREE.Vector3();

class CharacterInstance implements CharacterView {
  readonly root = new THREE.Group();
  private readonly mesh: THREE.SkinnedMesh;
  private readonly bones = {} as Record<BoneName, THREE.Bone>;
  private readonly rest: Record<BoneName, Rest>;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly mount = new THREE.Group();
  private weapon: WeaponModelView | null = null;
  private weaponId: WeaponId | null = null;
  private highlight = 0;
  private readonly faction: Faction;
  private skins: CharacterOptions['cosmetics']['skins'] = {};

  // Animation state.
  private time = Math.random() * 10;
  private phase = 0;
  private gait = 0;
  private crouch = 0;
  private slide = 0;
  private air = 0;
  private sprint = 0;
  private ads = 0;
  private reload = 0;
  private mantle = 0;
  private pitch = 0;
  private fwdK = 1;
  private sideK = 0;
  private readonly kick = new Spring(260, 20);
  private readonly flinchX = new Spring(140, 12);
  private readonly flinchZ = new Spring(140, 12);
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();

  constructor(private readonly weapons: WeaponModelFactory, opts: CharacterOptions) {
    this.faction = opts.faction;
    this.root.name = `character.${opts.faction === 0 ? 'halcyon' : 'bloom'}`;
    this.rest = restPose(opts.faction);
    const bonesList: THREE.Bone[] = [];
    for (const name of BONES) {
      const b = new THREE.Bone();
      b.name = name;
      const r = this.rest[name];
      b.position.set(...r.pos);
      b.rotation.set(...r.rot);
      this.bones[name] = b;
      bonesList.push(b);
      const p = PARENT[name];
      if (p) this.bones[p].add(b);
    }
    this.root.add(this.bones.hips);
    this.root.updateMatrixWorld(true);
    const detail = opts.showcase || opts.quality.preset === 'high' ? 2 : 1;
    const geo = characterGeometry(opts.faction, opts.team, opts.cosmetics.armor, opts.cosmetics.visor, detail);
    const [am, sm] = sharedMaterials();
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2) });
    this.mesh = new THREE.SkinnedMesh(geo, [am, sm, this.glowMat]);
    this.mesh.name = 'body';
    this.root.add(this.mesh);
    this.mesh.bind(new THREE.Skeleton(bonesList));
    // Generous fixed bounds (animation never leaves them) → no per-frame skinned bounds.
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.4);
    this.mesh.castShadow = opts.quality.shadows !== 'off';
    this.mesh.receiveShadow = opts.quality.shadows === 'high';
    this.mount.name = 'weaponMount';
    this.bones.chest.add(this.mount);
    this.skins = opts.cosmetics.skins;
    this.setWeapon('meridian', this.skins.meridian ?? 'factory');
  }

  setWeapon(id: WeaponId, skin: string): void {
    if (this.weaponId === id && this.weapon) return;
    this.weapon?.dispose();
    const w = this.weapons.create(id, skin, 'world') as WeaponModelView;
    w.root.scale.setScalar(0.92);
    w.root.traverse((o) => {
      o.castShadow = this.mesh.castShadow;
    });
    this.mount.add(w.root);
    this.weapon = w;
    this.weaponId = id;
  }

  fire(): void {
    this.kick.impulse(2.2);
  }

  flinch(dir: Vec3): void {
    // Direction in character space → lean away from the hit.
    const yaw = this.root.rotation.y;
    const lx = dir.x * Math.cos(yaw) - dir.z * Math.sin(yaw);
    const lz = dir.x * Math.sin(yaw) + dir.z * Math.cos(yaw);
    this.flinchX.impulse(-lz * 2.2);
    this.flinchZ.impulse(lx * 2.2);
  }

  die(): void {
    this.root.visible = false;
  }

  respawn(): void {
    this.root.visible = true;
    this.kick.reset();
    this.flinchX.reset();
    this.flinchZ.reset();
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    if (!this.weapon) return this.headWorld(out);
    return this.weapon.muzzle.getWorldPosition(out);
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.bones.head.localToWorld(out.set(0, 0.1, 0));
  }

  setHighlight(k: number): void {
    this.highlight = Math.max(0, Math.min(1, k));
    this.glowMat.color.setScalar(2.2 + this.highlight * 2.5);
  }

  update(dt: number, a: CharacterAnim): void {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    if (a.weapon !== this.weaponId) this.setWeapon(a.weapon, this.skins[a.weapon] ?? 'factory');
    this.root.rotation.y = a.yaw;
    if (!a.alive) return;

    // Velocity in the character frame.
    const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
    const vf = -a.vel.x * sy - a.vel.z * cy;
    const vr = a.vel.x * cy - a.vel.z * sy;
    const speed = Math.hypot(vf, vr);
    const onGround = !a.airborne && !a.sliding;
    this.gait = damp(this.gait, onGround ? Math.min(speed / 5.4, 1.45) : 0, 10, dt);
    if (speed > 0.3) {
      this.fwdK = damp(this.fwdK, vf / speed, 8, dt);
      this.sideK = damp(this.sideK, vr / speed, 8, dt);
    }
    const back = this.fwdK < -0.2 ? -1 : 1;
    this.phase += dt * (speed / (a.sprinting ? 2.1 : 1.6)) * Math.PI * 2 * back;
    this.crouch = damp(this.crouch, THREE.MathUtils.clamp(a.crouch, 0, 1), 12, dt);
    this.slide = damp(this.slide, a.sliding ? 1 : 0, 12, dt);
    this.air = damp(this.air, a.airborne && !a.mantling ? 1 : 0, 9, dt);
    this.sprint = damp(this.sprint, a.sprinting && !a.ads ? 1 : 0, 8, dt);
    this.ads = damp(this.ads, a.ads ? 1 : 0, 12, dt);
    this.reload = damp(this.reload, a.reloading ? 1 : 0, 8, dt);
    this.mantle = damp(this.mantle, a.mantling ? 1 : 0, 14, dt);
    this.pitch = damp(this.pitch, THREE.MathUtils.clamp(a.pitch, -1.2, 1.2), 18, dt);
    const kick = this.kick.step(dt);
    const fx = this.flinchX.step(dt);
    const fz = this.flinchZ.step(dt);

    this.pose(kick, fx, fz, a);
    this.weapon?.setCharge(a.charging ? 0.9 : 0.25);
  }

  private setBone(name: BoneName, rx: number, ry: number, rz: number): void {
    const r = this.rest[name].rot;
    this.bones[name].rotation.set(r[0] + rx, r[1] + ry, r[2] + rz);
  }

  private pose(kick: number, fx: number, fz: number, a: CharacterAnim): void {
    const B = this.bones;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const g = this.gait;
    const cr = this.crouch * (1 - this.slide);
    const breath = Math.sin(this.time * 1.8) * 0.02 * (1 - g * 0.6);

    // Hips: bob, crouch, slide.
    const rest = this.rest.hips.pos;
    B.hips.position.set(rest[0], rest[1] + Math.abs(s) * 0.035 * g - cr * 0.34 - this.slide * 0.46 - this.air * 0.04, rest[2]);
    this.setBone('hips', -this.slide * 0.25, 0, Math.sin(this.phase) * 0.035 * g);

    // Legs.
    const fw = this.fwdK * g;
    const sd = this.sideK * g;
    for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
      const ph = side === 'L' ? s : -s;
      const lift = Math.max(0, side === 'L' ? -c : c) * g;
      let thX = ph * 0.55 * fw + cr * 1.05 + this.air * (side === 'L' ? 0.75 : 0.35);
      let shX = -lift * 0.95 - cr * 1.95 - this.air * (side === 'L' ? 1.2 : 0.6) - 0.04;
      let ftX = cr * 0.9 + lift * 0.3;
      const thZ = ph * 0.28 * sd * sign + cr * 0.08 * sign;
      // Slide: left leg out straight, right folded underneath.
      if (this.slide > 0.01) {
        const k = this.slide;
        thX = THREE.MathUtils.lerp(thX, side === 'L' ? 1.35 : 0.4, k);
        shX = THREE.MathUtils.lerp(shX, side === 'L' ? -0.1 : -1.7, k);
        ftX = THREE.MathUtils.lerp(ftX, side === 'L' ? -0.3 : 0.7, k);
      }
      this.setBone(`thigh${side}`, thX, 0, thZ);
      this.setBone(`shin${side}`, shX, 0, 0);
      this.setBone(`foot${side}`, ftX, 0, 0);
    }

    // Torso: aim pitch distributed spine → chest → head; sprint lean; slide lean back.
    const lean = this.sprint * 0.22 + g * 0.05 + cr * 0.2 - this.slide * 0.45 + this.mantle * 0.35;
    const p = this.pitch;
    this.setBone('spine', -p * 0.22 + lean * 0.5 + fx * 0.3, fz * 0.1, -Math.sin(this.phase) * 0.03 * g + fz * 0.25);
    this.setBone('chest', -p * 0.38 + lean * 0.5 + breath - kick * 0.05 + fx * 0.2, 0, fz * 0.15);
    this.setBone('neck', -p * 0.15, 0, 0);
    this.setBone('head', -p * 0.25 - lean * 0.6 + this.ads * 0.08, 0, this.ads * -0.12);

    // Weapon mount (chest space): hold, ADS raise, run-carry, reload tilt, kick.
    const m = this.mount;
    const ads = this.ads;
    const sp = this.sprint;
    m.position.set(0.13 - ads * 0.1 - sp * 0.08, 0.02 + ads * 0.1 - sp * 0.06 - this.reload * 0.05, -0.34 + kick * 0.03 + sp * 0.1);
    m.rotation.set(-p * 0.4 - sp * 0.55 + this.reload * 0.35 - kick * 0.12 - this.mantle * 0.6, sp * 0.8 + this.reload * 0.2, sp * 0.3 + this.reload * 0.5, 'YXZ');

    this.root.updateMatrixWorld(true);

    // Arms: IK onto the weapon grips (reload: left hand works the magazine).
    if (this.weapon) {
      const w = this.weapon;
      const tR = w.handR.getWorldPosition(this.v1);
      this.solveArm('R', tR, 1);
      const tL = w.handL.getWorldPosition(this.v2);
      if (this.reload > 0.01) {
        const mag = w.parts.mag ?? w.handL;
        const mp = mag.getWorldPosition(this.v3);
        const wob = (Math.sin(this.time * 5.2) * 0.5 + 0.5) * 0.12;
        mp.y -= 0.06 + wob;
        tL.lerp(mp, this.reload);
      }
      if (this.mantle > 0.01) {
        // Reach for the ledge.
        this.root.localToWorld(this.v3.set(-0.2, 1.75, -0.45));
        tL.lerp(this.v3, this.mantle);
      }
      this.solveArm('L', tL, -1);
    }
  }

  /** Two-bone IK in world space with an elbow pole out/down/back. */
  private solveArm(side: 'L' | 'R', target: THREE.Vector3, sx: number): void {
    const up = this.bones[`upperArm${side}`];
    const fore = this.bones[`forearm${side}`];
    const S = up.getWorldPosition(_S);
    const dir = _dir.subVectors(target, S);
    let d = dir.length();
    d = THREE.MathUtils.clamp(d, 0.08, UPPER + FORE - 0.002);
    dir.normalize();
    const cosA = THREE.MathUtils.clamp((UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    // Elbows point out, down and slightly back (character space → world).
    const pole = _pole.set(0.6 * sx, -0.7, 0.25).applyQuaternion(this.root.getWorldQuaternion(this.q1));
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-6) pole.set(sx, -1, 0);
    pole.normalize();
    const elbow = _elbow.copy(S).addScaledVector(dir, cosA * UPPER).addScaledVector(pole, sinA * UPPER);
    const wrist = _wrist.copy(S).addScaledVector(dir, d);
    // Upper arm.
    up.parent!.getWorldQuaternion(this.q1).invert();
    this.q2.setFromUnitVectors(DOWN, _seg.subVectors(elbow, S).normalize());
    up.quaternion.copy(this.q1.multiply(this.q2));
    up.updateMatrixWorld(true);
    // Forearm.
    up.getWorldQuaternion(this.q1).invert();
    this.q2.setFromUnitVectors(DOWN, _seg.subVectors(wrist, elbow).normalize());
    fore.quaternion.copy(this.q1.multiply(this.q2));
    fore.updateMatrixWorld(true);
  }

  dispose(): void {
    this.weapon?.dispose();
    this.glowMat.dispose();
    this.mesh.skeleton.dispose();
    this.root.removeFromParent();
  }
}

export class Characters implements CharacterFactory {
  constructor(private readonly materials: MaterialLibrary, private readonly weapons: WeaponModelFactory) {
    void this.materials;
  }

  create(opts: CharacterOptions): CharacterView {
    return new CharacterInstance(this.weapons, opts);
  }
}
