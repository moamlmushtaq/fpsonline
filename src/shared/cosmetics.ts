// HALCYON FRONT — cosmetic catalog (architecture contract, see ARCHITECTURE.md).
// Everything here is cosmetic only. Unlocks come from player level (src/shared/progression.ts).
// Colors must respect the art direction: armor tints are desaturated neutrals/pastels so that
// team accents (Halcyon orange / Bloom teal) and emissive visors always stay the most readable.

import type { CosmeticSelection, WeaponId } from './types';

export interface ArmorTint {
  id: string;
  nameKey: string;
  /** Secondary armor panel color. */
  color: string;
  unlockLevel: number;
}

export interface VisorStyle {
  id: string;
  nameKey: string;
  /** Shape used by the character builder. */
  shape: 'band' | 'slit' | 'twin' | 'cross' | 'halo' | 'mono';
  unlockLevel: number;
}

export interface Namecard {
  id: string;
  nameKey: string;
  /** Gradient stops for the banner background + motif drawn by the UI. */
  from: string;
  to: string;
  motif: 'sun' | 'rings' | 'grid' | 'vines' | 'rocket' | 'stars' | 'waves' | 'dial';
  unlockLevel: number;
}

export interface ElimEffect {
  id: string;
  nameKey: string;
  /** 'default' = faction dissolve; others override the particle style (still no gore). */
  style: 'faction' | 'starfall' | 'origami' | 'embers' | 'prism';
  unlockLevel: number;
}

export interface WeaponSkin {
  id: string;
  nameKey: string;
  /** Primary shell color, secondary metal color, accent (dials/stripes). */
  shell: string;
  metal: string;
  accent: string;
  pattern: 'plain' | 'stripes' | 'patina' | 'gradient' | 'speckle';
  unlockLevel: number;
}

export const ARMOR_TINTS: ArmorTint[] = [
  { id: 'standard', nameKey: 'cos.armor.standard', color: '#d9d4c7', unlockLevel: 1 },
  { id: 'sandstone', nameKey: 'cos.armor.sandstone', color: '#c9b08a', unlockLevel: 3 },
  { id: 'slate', nameKey: 'cos.armor.slate', color: '#6f7780', unlockLevel: 6 },
  { id: 'sage', nameKey: 'cos.armor.sage', color: '#a3ad8f', unlockLevel: 9 },
  { id: 'terracotta', nameKey: 'cos.armor.terracotta', color: '#b98a73', unlockLevel: 13 },
  { id: 'lunar', nameKey: 'cos.armor.lunar', color: '#e9ecef', unlockLevel: 17 },
  { id: 'graphite', nameKey: 'cos.armor.graphite', color: '#3d4046', unlockLevel: 22 },
  { id: 'dune', nameKey: 'cos.armor.dune', color: '#d8b98f', unlockLevel: 28 },
];

export const VISOR_STYLES: VisorStyle[] = [
  { id: 'band', nameKey: 'cos.visor.band', shape: 'band', unlockLevel: 1 },
  { id: 'slit', nameKey: 'cos.visor.slit', shape: 'slit', unlockLevel: 4 },
  { id: 'twin', nameKey: 'cos.visor.twin', shape: 'twin', unlockLevel: 8 },
  { id: 'cross', nameKey: 'cos.visor.cross', shape: 'cross', unlockLevel: 14 },
  { id: 'mono', nameKey: 'cos.visor.mono', shape: 'mono', unlockLevel: 19 },
  { id: 'halo', nameKey: 'cos.visor.halo', shape: 'halo', unlockLevel: 26 },
];

export const NAMECARDS: Namecard[] = [
  { id: 'horizon', nameKey: 'cos.card.horizon', from: '#f2c38b', to: '#8fb7c9', motif: 'sun', unlockLevel: 1 },
  { id: 'launchpad', nameKey: 'cos.card.launchpad', from: '#e7d9c1', to: '#c77b58', motif: 'rocket', unlockLevel: 2 },
  { id: 'suburbia', nameKey: 'cos.card.suburbia', from: '#f4d6c6', to: '#b8c9a3', motif: 'vines', unlockLevel: 5 },
  { id: 'aperture', nameKey: 'cos.card.aperture', from: '#40445a', to: '#b9a3c9', motif: 'stars', unlockLevel: 7 },
  { id: 'telemetry', nameKey: 'cos.card.telemetry', from: '#1f2a33', to: '#5a7d8c', motif: 'grid', unlockLevel: 11 },
  { id: 'tidewater', nameKey: 'cos.card.tidewater', from: '#9cc3d5', to: '#e9dcc3', motif: 'waves', unlockLevel: 15 },
  { id: 'chronometer', nameKey: 'cos.card.chronometer', from: '#2b2723', to: '#d2a86a', motif: 'dial', unlockLevel: 20 },
  { id: 'saturn', nameKey: 'cos.card.saturn', from: '#f6e7c8', to: '#d98b5f', motif: 'rings', unlockLevel: 30 },
];

export const ELIM_EFFECTS: ElimEffect[] = [
  { id: 'default', nameKey: 'cos.elim.default', style: 'faction', unlockLevel: 1 },
  { id: 'embers', nameKey: 'cos.elim.embers', style: 'embers', unlockLevel: 10 },
  { id: 'origami', nameKey: 'cos.elim.origami', style: 'origami', unlockLevel: 16 },
  { id: 'starfall', nameKey: 'cos.elim.starfall', style: 'starfall', unlockLevel: 24 },
  { id: 'prism', nameKey: 'cos.elim.prism', style: 'prism', unlockLevel: 32 },
];

/** Default skin + three unlockable skins per weapon. Same skin ids for every weapon, unlock level offset per weapon. */
export const WEAPON_SKINS: WeaponSkin[] = [
  { id: 'factory', nameKey: 'cos.skin.factory', shell: '#ece6da', metal: '#5b5f63', accent: '#d9a441', pattern: 'plain', unlockLevel: 1 },
  { id: 'sunburst', nameKey: 'cos.skin.sunburst', shell: '#f1d7a4', metal: '#6b4f3a', accent: '#c4552f', pattern: 'stripes', unlockLevel: 5 },
  { id: 'verdigris', nameKey: 'cos.skin.verdigris', shell: '#7fa89a', metal: '#8a6a45', accent: '#e8d9b0', pattern: 'patina', unlockLevel: 12 },
  { id: 'orbital', nameKey: 'cos.skin.orbital', shell: '#f7f7f4', metal: '#2e3a55', accent: '#b8322c', pattern: 'gradient', unlockLevel: 21 },
];

/** Per-weapon unlock level offset so skins trickle in across the whole progression. */
export const SKIN_WEAPON_OFFSET: Record<WeaponId, number> = {
  meridian: 0,
  swift: 1,
  longline: 2,
  breaker: 3,
  pulse: 1,
  sunspear: 4,
};

export function skinUnlockLevel(weapon: WeaponId, skinId: string): number {
  const s = WEAPON_SKINS.find((k) => k.id === skinId);
  if (!s) return Infinity;
  return s.id === 'factory' ? 1 : s.unlockLevel + SKIN_WEAPON_OFFSET[weapon];
}

export function defaultCosmetics(): CosmeticSelection {
  return { armor: 'standard', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: {} };
}

export function findArmor(id: string): ArmorTint {
  return ARMOR_TINTS.find((a) => a.id === id) ?? ARMOR_TINTS[0];
}
export function findVisor(id: string): VisorStyle {
  return VISOR_STYLES.find((a) => a.id === id) ?? VISOR_STYLES[0];
}
export function findNamecard(id: string): Namecard {
  return NAMECARDS.find((a) => a.id === id) ?? NAMECARDS[0];
}
export function findElimFx(id: string): ElimEffect {
  return ELIM_EFFECTS.find((a) => a.id === id) ?? ELIM_EFFECTS[0];
}
export function findSkin(id: string | undefined): WeaponSkin {
  return WEAPON_SKINS.find((a) => a.id === id) ?? WEAPON_SKINS[0];
}

/** Sanitize a cosmetic selection received over the network (unknown ids → defaults). Level gating is client-side UX. */
export function sanitizeCosmetics(c: Partial<CosmeticSelection> | undefined): CosmeticSelection {
  const d = defaultCosmetics();
  if (!c) return d;
  const skins: CosmeticSelection['skins'] = {};
  if (c.skins && typeof c.skins === 'object') {
    for (const [w, s] of Object.entries(c.skins)) {
      if (typeof s === 'string' && WEAPON_SKINS.some((k) => k.id === s)) (skins as Record<string, string>)[w] = s;
    }
  }
  return {
    armor: ARMOR_TINTS.some((a) => a.id === c.armor) ? (c.armor as string) : d.armor,
    visor: VISOR_STYLES.some((a) => a.id === c.visor) ? (c.visor as string) : d.visor,
    namecard: NAMECARDS.some((a) => a.id === c.namecard) ? (c.namecard as string) : d.namecard,
    elimFx: ELIM_EFFECTS.some((a) => a.id === c.elimFx) ? (c.elimFx as string) : d.elimFx,
    skins,
  };
}
