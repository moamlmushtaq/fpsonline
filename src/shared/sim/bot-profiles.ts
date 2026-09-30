// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — bot tuning: per-difficulty profiles (reaction, aim error,
// turn speed, tracking lag, trigger discipline, tactics), preferred engagement
// ranges per weapon, and the throw solver. Tune feel here, logic lives in bots.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { GRAVITY, THROW_SPEED, THROW_UP } from '../constants';
import type { BotDifficulty, WeaponId } from '../types';

export interface BotProfile {
  /** Seconds before reacting to a newly seen enemy. */
  reaction: number;
  /** Initial aim error (radians) on acquisition. */
  aimErr: number;
  /** Aim error decay rate (1/s). */
  settle: number;
  /** Max turn speed (rad/s) and smoothing (1/s). */
  turnRate: number;
  smooth: number;
  /** Perception lag of the tracked target (s) and fraction of its velocity predicted. */
  trackLag: number;
  predict: number;
  /** Multiplier on the angular size of the target used as a fire tolerance. */
  fireTol: number;
  recoilComp: number;
  /** Continuous aim noise (radians). */
  jitter: number;
  headChance: number;
  strafe: number;
  crouchChance: number;
  jumpChance: number;
  slideChance: number;
  grenadeChance: number;
  hearing: number;
  fovHalf: number;
  retreatHp: number;
  burst: [number, number];
  burstPause: [number, number];
}

const DEG = Math.PI / 180;

export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  recruit: {
    reaction: 0.65, aimErr: 8 * DEG, settle: 1.8, turnRate: 3.2, smooth: 5, trackLag: 0.22, predict: 0,
    fireTol: 1.7, recoilComp: 0.3, jitter: 0.7 * DEG, headChance: 0.05, strafe: 0.35, crouchChance: 0.03,
    jumpChance: 0, slideChance: 0, grenadeChance: 0.015, hearing: 24, fovHalf: 50 * DEG, retreatHp: 0,
    burst: [0.45, 1.1], burstPause: [0.35, 0.8],
  },
  veteran: {
    reaction: 0.38, aimErr: 6 * DEG, settle: 2.4, turnRate: 5, smooth: 8, trackLag: 0.14, predict: 0.4,
    fireTol: 1.35, recoilComp: 0.6, jitter: 0.4 * DEG, headChance: 0.2, strafe: 0.7, crouchChance: 0.08,
    jumpChance: 0.03, slideChance: 0.15, grenadeChance: 0.04, hearing: 35, fovHalf: 50 * DEG, retreatHp: 32,
    burst: [0.3, 0.75], burstPause: [0.22, 0.5],
  },
  elite: {
    reaction: 0.22, aimErr: 3.5 * DEG, settle: 3.4, turnRate: 7.5, smooth: 12, trackLag: 0.09, predict: 0.75,
    fireTol: 1.1, recoilComp: 0.85, jitter: 0.25 * DEG, headChance: 0.4, strafe: 1, crouchChance: 0.12,
    jumpChance: 0.05, slideChance: 0.3, grenadeChance: 0.07, hearing: 40, fovHalf: 52 * DEG, retreatHp: 40,
    burst: [0.25, 0.6], burstPause: [0.16, 0.38],
  },
};

/** Preferred engagement distance per weapon (m). */
export const PREFERRED_RANGE: Record<WeaponId, number> = {
  meridian: 18,
  swift: 9,
  longline: 34,
  breaker: 6,
  pulse: 12,
  sunspear: 24,
};

/** Launch pitch that lands a throw `dist` meters away, `dy` meters higher (throw physics from GameSim). */
export function ballisticPitch(dist: number, dy: number): number {
  let best = 0.3;
  let bestErr = Infinity;
  for (let a = -0.35; a <= 1.05; a += 0.025) {
    const vh = THROW_SPEED * Math.cos(a);
    const vy = THROW_SPEED * Math.sin(a) + THROW_UP;
    if (vh <= 0.1) continue;
    const t = dist / vh;
    const y = vy * t - 0.5 * GRAVITY * t * t;
    const err = Math.abs(y - dy);
    if (err < bestErr) {
      bestErr = err;
      best = a;
    }
  }
  return best;
}
