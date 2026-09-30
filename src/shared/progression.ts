// HALCYON FRONT — player progression (architecture contract, see ARCHITECTURE.md).
// XP → level curve, match XP awards and the unlock track. Cosmetic only.

import {
  ARMOR_TINTS,
  ELIM_EFFECTS,
  NAMECARDS,
  VISOR_STYLES,
  WEAPON_SKINS,
  skinUnlockLevel,
} from './cosmetics';
import type { ModeId, PlayerMatchStats, WeaponId } from './types';
import { WEAPON_IDS } from './types';

export const MAX_LEVEL = 50;

/** XP required to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return Math.round(900 + level * 140 + Math.pow(level, 1.35) * 22);
}

/** Total XP required to reach `level` (level 1 = 0 XP). */
export function totalXpForLevel(level: number): number {
  let t = 0;
  for (let l = 1; l < level; l++) t += xpForLevel(l);
  return t;
}

export function levelFromXp(xp: number): { level: number; into: number; needed: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL && rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  return { level, into: level >= MAX_LEVEL ? 0 : rest, needed: level >= MAX_LEVEL ? 0 : xpForLevel(level) };
}

export interface XpLine {
  key: string; // i18n key, e.g. 'xp.eliminations'
  amount: number;
}

export interface MatchXp {
  lines: XpLine[];
  total: number;
}

/** XP earned from a match. Rewards playing (completion), performance and objectives; bots matches give 60%. */
export function computeMatchXp(
  stats: PlayerMatchStats,
  opts: { mode: ModeId; won: boolean; draw: boolean; mvp: boolean; secondsPlayed: number; botMatch: boolean; firstMatchOfDay?: boolean },
): MatchXp {
  if (opts.mode === 'range') {
    const t = Math.min(250, Math.round(stats.hits * 2 + stats.headshots * 3));
    return { lines: [{ key: 'xp.training', amount: t }], total: t };
  }
  const lines: XpLine[] = [];
  lines.push({ key: 'xp.completion', amount: Math.round(Math.min(1, opts.secondsPlayed / 300) * 300) });
  if (stats.kills) lines.push({ key: 'xp.eliminations', amount: stats.kills * 50 });
  if (stats.assists) lines.push({ key: 'xp.assists', amount: stats.assists * 20 });
  if (stats.headshots) lines.push({ key: 'xp.headshots', amount: stats.headshots * 15 });
  if (stats.objectiveTime >= 1) lines.push({ key: 'xp.objective', amount: Math.round(stats.objectiveTime * 3 + stats.captures * 75) });
  if (opts.won) lines.push({ key: 'xp.victory', amount: 400 });
  else if (opts.draw) lines.push({ key: 'xp.draw', amount: 200 });
  if (opts.mvp) lines.push({ key: 'xp.mvp', amount: 250 });
  if (opts.firstMatchOfDay) lines.push({ key: 'xp.daily', amount: 500 });
  let total = lines.reduce((s, l) => s + l.amount, 0);
  if (opts.botMatch) {
    const reduced = Math.round(total * 0.6);
    lines.push({ key: 'xp.botPenalty', amount: reduced - total });
    total = reduced;
  }
  return { lines, total };
}

export type UnlockKind = 'armor' | 'visor' | 'namecard' | 'elimFx' | 'skin';

export interface Unlock {
  level: number;
  kind: UnlockKind;
  id: string;
  /** For weapon skins. */
  weapon?: WeaponId;
  nameKey: string;
}

/** Full unlock track, sorted by level. */
export function unlockTrack(): Unlock[] {
  const out: Unlock[] = [];
  for (const a of ARMOR_TINTS) if (a.unlockLevel > 1) out.push({ level: a.unlockLevel, kind: 'armor', id: a.id, nameKey: a.nameKey });
  for (const v of VISOR_STYLES) if (v.unlockLevel > 1) out.push({ level: v.unlockLevel, kind: 'visor', id: v.id, nameKey: v.nameKey });
  for (const n of NAMECARDS) if (n.unlockLevel > 1) out.push({ level: n.unlockLevel, kind: 'namecard', id: n.id, nameKey: n.nameKey });
  for (const e of ELIM_EFFECTS) if (e.unlockLevel > 1) out.push({ level: e.unlockLevel, kind: 'elimFx', id: e.id, nameKey: e.nameKey });
  for (const w of WEAPON_IDS) {
    for (const s of WEAPON_SKINS) {
      if (s.id === 'factory') continue;
      out.push({ level: skinUnlockLevel(w, s.id), kind: 'skin', id: s.id, weapon: w, nameKey: s.nameKey });
    }
  }
  return out.sort((a, b) => a.level - b.level);
}

/** Unlocks gained when going from level `from` (exclusive) to `to` (inclusive). */
export function unlocksBetween(from: number, to: number): Unlock[] {
  return unlockTrack().filter((u) => u.level > from && u.level <= to);
}

export function isUnlocked(level: number, kind: UnlockKind, id: string, weapon?: WeaponId): boolean {
  switch (kind) {
    case 'armor':
      return (ARMOR_TINTS.find((a) => a.id === id)?.unlockLevel ?? Infinity) <= level;
    case 'visor':
      return (VISOR_STYLES.find((a) => a.id === id)?.unlockLevel ?? Infinity) <= level;
    case 'namecard':
      return (NAMECARDS.find((a) => a.id === id)?.unlockLevel ?? Infinity) <= level;
    case 'elimFx':
      return (ELIM_EFFECTS.find((a) => a.id === id)?.unlockLevel ?? Infinity) <= level;
    case 'skin':
      return weapon ? skinUnlockLevel(weapon, id) <= level : false;
  }
}

/** Simple Elo-style rating update used by the matchmaker for skill-based matching. */
export function ratingDelta(rating: number, opponentAvg: number, result: 1 | 0.5 | 0, performance: number): number {
  const expected = 1 / (1 + Math.pow(10, (opponentAvg - rating) / 400));
  const k = 28;
  // performance in [-1, 1] nudges the change by up to ±8 points.
  return Math.round(k * (result - expected) + Math.max(-1, Math.min(1, performance)) * 8);
}
