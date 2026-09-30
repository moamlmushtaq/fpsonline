// HALCYON FRONT — the color bible (architecture contract, see ARCHITECTURE.md).
//
// Rules:
//  • Environments use warm, dusty neutrals (sand, bone, faded terracotta, sky blue).
//  • ONLY gameplay-relevant things are saturated: players, objectives, pickups, danger.
//  • Team colors (orange / teal / violet) are NEVER used in environment art.
//  • Environmental bioluminescence uses CHARTREUSE + PALE GOLD, never teal.
//  • Colorblind modes remap team colors; always read team colors through teamColors().

import type { Team } from '../../shared/types';

export const ENV = {
  sand: '#d9c7a7',
  sandLight: '#e8dcc4',
  bone: '#efe6d6',
  boneShade: '#cfc4b0',
  concrete: '#bdb5a6',
  concreteDark: '#8e877b',
  terracotta: '#c9785b',
  terracottaFaded: '#c99a82',
  rust: '#9a6a4f',
  skyBlue: '#9cc3d5',
  skyPale: '#cfe0e6',
  sage: '#a3ad8f',
  olive: '#7d8566',
  pastelPink: '#e9c3b5',
  pastelMint: '#c9dcc1',
  pastelYellow: '#efdca6',
  pastelBlue: '#b9cfda',
  shadowWarm: '#4a4038',
  shadowCool: '#3b4150',
  metalDark: '#55585c',
  metalLight: '#9a9b98',
  snow: '#eef1f4',
  rock: '#8b8580',
  water: '#6f95a0',
  /** Environmental bioluminescence (never teal). */
  glowChartreuse: '#c6f06b',
  glowGold: '#ffe3a1',
  glowSoftPink: '#ffb3c7',
} as const;

export const UI = {
  text: '#f3ece0',
  textDim: 'rgba(243,236,224,0.62)',
  textFaint: 'rgba(243,236,224,0.38)',
  line: 'rgba(243,236,224,0.22)',
  panel: 'rgba(24,22,20,0.56)',
  panelSolid: '#1b1917',
  accent: '#f0b35b', // warm amber UI accent (brass dials) — distinct from Halcyon orange
  good: '#b9e07a',
  danger: '#ff5a5f',
  headshot: '#ffd166',
  xp: '#f6d58e',
} as const;

export type ColorblindMode = 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export interface TeamColorSet {
  /** Main saturated team color (visor, HUD, objectives). */
  primary: string;
  /** Secondary accent (Bloom violet / Halcyon warm white). */
  secondary: string;
  /** Emissive color for visors/lights. */
  emissive: string;
  /** Light UI tint of the team color for text on dark backgrounds. */
  light: string;
}

const TEAM_SETS: Record<ColorblindMode, [TeamColorSet, TeamColorSet, TeamColorSet]> = {
  off: [
    { primary: '#ff8a3d', secondary: '#f4f1ea', emissive: '#ff9a4a', light: '#ffc08e' },
    { primary: '#20d0c2', secondary: '#9b5cf6', emissive: '#3ff2e1', light: '#98efe6' },
    { primary: '#ff5a5f', secondary: '#f4f1ea', emissive: '#ff6a6a', light: '#ffb0b0' },
  ],
  protanopia: [
    { primary: '#ffb000', secondary: '#f4f1ea', emissive: '#ffc233', light: '#ffd98a' },
    { primary: '#3d8bff', secondary: '#9fb6ff', emissive: '#5aa0ff', light: '#a8c8ff' },
    { primary: '#f0e442', secondary: '#f4f1ea', emissive: '#f7ec6a', light: '#faf3a8' },
  ],
  deuteranopia: [
    { primary: '#ff9f1c', secondary: '#f4f1ea', emissive: '#ffb347', light: '#ffd49a' },
    { primary: '#2f7bff', secondary: '#a4b8ff', emissive: '#4d90ff', light: '#a9c6ff' },
    { primary: '#f0e442', secondary: '#f4f1ea', emissive: '#f7ec6a', light: '#faf3a8' },
  ],
  tritanopia: [
    { primary: '#ff4f7a', secondary: '#f4f1ea', emissive: '#ff6b8f', light: '#ffb0c4' },
    { primary: '#00b3a4', secondary: '#7fd8d0', emissive: '#19d6c5', light: '#8fe6de' },
    { primary: '#ffd166', secondary: '#f4f1ea', emissive: '#ffdb85', light: '#ffeab8' },
  ],
};

let currentMode: ColorblindMode = 'off';

export function setColorblindMode(mode: ColorblindMode): void {
  currentMode = mode;
}
export function getColorblindMode(): ColorblindMode {
  return currentMode;
}

/**
 * Colors for a team. Team 2 (TEAM_NONE) returns the "hostile" set used for FFA enemies.
 * Faction 0 = Halcyon (orange), faction 1 = Bloom (teal).
 */
export function teamColors(team: Team, mode: ColorblindMode = currentMode): TeamColorSet {
  return TEAM_SETS[mode][team];
}

/** Neutral objective color (unowned zones, neutral pickups). */
export const NEUTRAL_OBJECTIVE = '#f3ece0';
/** Pickups (Sunspear) glow gold. */
export const PICKUP_COLOR = '#ffd166';
/** Danger (grenades, low health). */
export const DANGER_COLOR = '#ff5a5f';
