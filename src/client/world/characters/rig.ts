// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — character rig: bone list, hierarchy and per-faction rest pose.
//
// Conventions (root space = character local space, feet at y = 0, facing −Z):
//  • Limb bones (upperArm, forearm, thigh, shin) point along their local −Y and
//    have NO rest rotation, so the IK can set their quaternions absolutely.
//  • Hands use the weapon grip-anchor convention: fingers toward −Z, wrist
//    toward +Z, knuckles toward +Y (see WeaponModelView.handR/handL).
//  • `weapon`, `weaponMag`, `weaponPump` are extra bones (children of the root,
//    not of the hips) that carry the baked third-person weapon; they sit at the
//    origin at bind time so weapon geometry can be baked in weapon space.
//  • Positive X rotation pitches a bone BACK (looks up); a forward hunch is −X.
// ─────────────────────────────────────────────────────────────────────────────

import type { Faction } from '../../../shared/types';

export type V3 = [number, number, number];

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'clavL', 'upperArmL', 'forearmL', 'handL',
  'clavR', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
  'pack', 'antenna', 'fronds', 'scarf', 'flapF', 'flapB',
  'weapon', 'weaponMag', 'weaponPump',
] as const;
export type BoneName = (typeof BONES)[number];

export const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

/** null = child of the character root group. */
export const PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  clavL: 'chest', upperArmL: 'clavL', forearmL: 'upperArmL', handL: 'forearmL',
  clavR: 'chest', upperArmR: 'clavR', forearmR: 'upperArmR', handR: 'forearmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
  pack: 'chest', antenna: 'pack', fronds: 'clavL', scarf: 'chest', flapF: 'hips', flapB: 'hips',
  weapon: null, weaponMag: 'weapon', weaponPump: 'weapon',
};

export interface Rest {
  pos: V3;
  rot: V3;
}

export interface RigDef {
  faction: Faction;
  upper: number;
  fore: number;
  thigh: number;
  shin: number;
  /** Ankle height above the sole when the foot is flat. */
  ankle: number;
  rest: Record<BoneName, Rest>;
  /** Idle foot placements (root space, sole on the ground). */
  stanceL: V3;
  stanceR: V3;
  /** Head centre relative to the head bone. */
  headCenter: V3;
  /** Eye point relative to the head bone (ADS sight alignment). */
  eye: V3;
  /** Right-shoulder weapon pivot relative to the chest bone. */
  pivot: V3;
  /** Hips drop at full crouch. */
  crouchDrop: number;
}

const r = (pos: V3, rot: V3 = [0, 0, 0]): Rest => ({ pos, rot });

function halcyonRig(): RigDef {
  const upper = 0.29, fore = 0.27, thigh = 0.43, shin = 0.42;
  return {
    faction: 0,
    upper, fore, thigh, shin,
    ankle: 0.085,
    rest: {
      hips: r([0, 0.975, 0]),
      spine: r([0, 0.115, 0]),
      chest: r([0, 0.2, 0]),
      neck: r([0, 0.235, 0]),
      head: r([0, 0.075, 0]),
      clavL: r([-0.17, 0.17, 0.0]),
      upperArmL: r([-0.035, -0.02, 0]),
      forearmL: r([0, -upper, 0]),
      handL: r([0, -fore, 0], [-Math.PI / 2, 0, 0]),
      clavR: r([0.17, 0.17, 0.0]),
      upperArmR: r([0.035, -0.02, 0]),
      forearmR: r([0, -upper, 0]),
      handR: r([0, -fore, 0], [-Math.PI / 2, 0, 0]),
      thighL: r([-0.1, -0.055, 0]),
      shinL: r([0, -thigh, 0]),
      footL: r([0, -shin, 0]),
      thighR: r([0.1, -0.055, 0]),
      shinR: r([0, -thigh, 0]),
      footR: r([0, -shin, 0]),
      pack: r([0, 0.07, 0.15]),
      antenna: r([0.105, 0.2, 0.05]),
      fronds: r([-0.05, 0.08, 0.0]),
      scarf: r([0.05, 0.19, 0.12]),
      flapF: r([0, -0.03, -0.13]),
      flapB: r([0, -0.03, 0.14]),
      weapon: r([0, 0, 0]),
      weaponMag: r([0, 0, 0]),
      weaponPump: r([0, 0, 0]),
    },
    stanceL: [-0.12, 0, 0.0],
    stanceR: [0.125, 0, 0.07],
    headCenter: [0, 0.1, 0.0],
    eye: [0.03, 0.085, -0.12],
    pivot: [0.13, 0.15, -0.03],
    crouchDrop: 0.42,
  };
}

function bloomRig(): RigDef {
  const upper = 0.28, fore = 0.27, thigh = 0.42, shin = 0.42;
  return {
    faction: 1,
    upper, fore, thigh, shin,
    ankle: 0.085,
    rest: {
      hips: r([0, 0.925, 0], [0.08, 0, 0]),
      spine: r([0, 0.11, 0], [-0.26, 0.03, 0.05]),
      chest: r([0, 0.195, 0], [-0.18, 0.06, 0.04]),
      neck: r([0, 0.22, 0.03], [0.44, 0, -0.05]),
      head: r([0, 0.07, 0], [0.12, -0.05, 0.08]),
      clavL: r([-0.17, 0.2, 0.0], [0, 0, 0.1]),
      upperArmL: r([-0.035, -0.02, 0]),
      forearmL: r([0, -upper, 0]),
      handL: r([0, -fore, 0], [-Math.PI / 2, 0, 0]),
      clavR: r([0.17, 0.15, 0.01], [0, 0, -0.06]),
      upperArmR: r([0.035, -0.02, 0]),
      forearmR: r([0, -upper, 0]),
      handR: r([0, -fore, 0], [-Math.PI / 2, 0, 0]),
      thighL: r([-0.11, -0.05, 0]),
      shinL: r([0, -thigh, 0]),
      footL: r([0, -shin, 0]),
      thighR: r([0.11, -0.05, 0]),
      shinR: r([0, -thigh, 0]),
      footR: r([0, -shin, 0]),
      pack: r([0, 0.05, 0.15]),
      antenna: r([0.1, 0.18, 0.04]),
      fronds: r([-0.06, 0.07, 0.01]),
      scarf: r([0.06, 0.2, 0.11]),
      flapF: r([0, -0.02, -0.13]),
      flapB: r([0, -0.02, 0.14]),
      weapon: r([0, 0, 0]),
      weaponMag: r([0, 0, 0]),
      weaponPump: r([0, 0, 0]),
    },
    stanceL: [-0.165, 0, -0.08],
    stanceR: [0.16, 0, 0.11],
    headCenter: [0, 0.09, -0.01],
    eye: [0.03, 0.08, -0.12],
    pivot: [0.13, 0.14, -0.03],
    crouchDrop: 0.38,
  };
}

const RIGS: [RigDef, RigDef] = [halcyonRig(), bloomRig()];

export function rigFor(f: Faction): RigDef {
  return RIGS[f];
}
