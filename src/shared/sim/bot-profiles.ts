// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — bot tuning: per-difficulty profiles (perception, human aim
// model, trigger discipline, tactics), preferred engagement ranges per weapon,
// and the throw solver. Tune feel here; logic lives in bots.ts / bots/*.ts.
//
// Calibration targets (measured with a human-aimer model: reaction, Fitts'-law
// flicks with endpoint error, lagged pursuit, partial recoil control):
//  • recruit — a first-time touch player wins most duels.
//  • veteran — an average desktop player wins about half.
//  • elite   — beats an average player most of the time, a good player about
//              half; never faster than a quick human (no snaps, no wallhacks).
// ─────────────────────────────────────────────────────────────────────────────

import { GRAVITY, THROW_SPEED, THROW_UP } from '../constants';
import type { BotDifficulty, WeaponId } from '../types';

export interface BotProfile {
  // ── Perception ──
  /** Visual reaction time (s) before a newly seen enemy is acted on. */
  reaction: number;
  /** Extra reaction per 50 m of distance (small, far figures are noticed later). */
  reactionFar: number;
  /** View cone half-angle (rad) in which enemies can be noticed. */
  fovHalf: number;
  /** Max distance (m) at which gunshots are heard (also capped by the shot's loudness). */
  hearing: number;
  /** Distance (m) at which a sprinting enemy's footsteps are heard (walking: half, crouched: silent). */
  footsteps: number;
  // ── Aim (see bots/aim.ts) ──
  /** Flick duration = fittsA + fittsB·log2(1 + amplitude / target width). */
  fittsA: number;
  fittsB: number;
  /** Mean overshoot of a flick (fraction of its amplitude). */
  overshoot: number;
  /** Flick endpoint scatter: sd as a fraction of the amplitude, plus a floor (rad). */
  endErr: number;
  baseErr: number;
  /** Corrective settle rate after a flick (1/s). */
  settle: number;
  /** Pursuit noise (rad per √s): hand tremor / imperfect tracking. */
  pursuitNoise: number;
  /** Perception lag of a tracked target (s) and fraction of its velocity predicted. */
  trackLag: number;
  predict: number;
  /** Max view turn rate (rad/s). */
  turnRate: number;
  /** Free-look smoothing (1/s) when not tracking an enemy. */
  smooth: number;
  /** Fraction of recoil pulled down and the lag (s) of that correction. */
  recoilComp: number;
  recoilLag: number;
  /** Chance of aiming at the head for an engagement. */
  headChance: number;
  // ── Trigger ──
  /** Confirmation time on target before the first shot of an engagement (s). */
  fireDelay: number;
  /** Fire when the error is under this × the target's angular half-size. */
  fireTol: number;
  burst: [number, number];
  burstPause: [number, number];
  // ── Movement / tactics ──
  strafe: number;
  crouchChance: number;
  jumpChance: number;
  slideChance: number;
  /** Health under which the bot breaks off to cover (0 = never). */
  retreatHp: number;
  /** 0..1 — cover use, reload discipline, pre-aiming, flanks, holding angles. */
  tactics: number;
  /** Seconds holding an angle at a lane station [min, max]. */
  hold: [number, number];
  /** Per-throw-opportunity chance scale for grenades / smokes. */
  grenadeSkill: number;
  smokeSkill: number;
  /** Eases up on humans on a long losing streak (subtle; recruit/veteran only). */
  mercy: boolean;
}

const DEG = Math.PI / 180;

export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  recruit: {
    reaction: 0.55, reactionFar: 0.3, fovHalf: 42 * DEG, hearing: 22, footsteps: 7,
    fittsA: 0.22, fittsB: 0.17, overshoot: 0.14, endErr: 0.2, baseErr: 1.4 * DEG, settle: 2.4, pursuitNoise: 2.9 * DEG,
    trackLag: 0.28, predict: 0, turnRate: 3.4, smooth: 4.5, recoilComp: 0.05, recoilLag: 0.25, headChance: 0.03,
    fireDelay: 0.18, fireTol: 2.4, burst: [0.45, 1.1], burstPause: [0.55, 1.2],
    strafe: 0.2, crouchChance: 0.02, jumpChance: 0, slideChance: 0, retreatHp: 22, tactics: 0.25, hold: [0.8, 2],
    grenadeSkill: 0.35, smokeSkill: 0.15, mercy: true,
  },
  veteran: {
    reaction: 0.24, reactionFar: 0.12, fovHalf: 48 * DEG, hearing: 32, footsteps: 11,
    fittsA: 0.1, fittsB: 0.08, overshoot: 0.08, endErr: 0.085, baseErr: 0.35 * DEG, settle: 6, pursuitNoise: 0.6 * DEG,
    trackLag: 0.1, predict: 0.5, turnRate: 6.5, smooth: 7, recoilComp: 0.6, recoilLag: 0.11, headChance: 0.22,
    fireDelay: 0.06, fireTol: 1.25, burst: [0.35, 0.8], burstPause: [0.18, 0.4],
    strafe: 0.65, crouchChance: 0.07, jumpChance: 0.02, slideChance: 0.12, retreatHp: 35, tactics: 0.65, hold: [1.2, 3],
    grenadeSkill: 0.8, smokeSkill: 0.7, mercy: true,
  },
  elite: {
    reaction: 0.19, reactionFar: 0.08, fovHalf: 52 * DEG, hearing: 40, footsteps: 14,
    fittsA: 0.075, fittsB: 0.07, overshoot: 0.05, endErr: 0.06, baseErr: 0.22 * DEG, settle: 8, pursuitNoise: 0.4 * DEG,
    trackLag: 0.08, predict: 0.75, turnRate: 9, smooth: 10, recoilComp: 0.9, recoilLag: 0.07, headChance: 0.35,
    fireDelay: 0.03, fireTol: 1.05, burst: [0.35, 0.8], burstPause: [0.1, 0.25],
    strafe: 1, crouchChance: 0.1, jumpChance: 0.04, slideChance: 0.25, retreatHp: 42, tactics: 1, hold: [1.5, 3.5],
    grenadeSkill: 1, smokeSkill: 1, mercy: false,
  },
};

/** Preferred engagement distance per weapon (m). */
export const PREFERRED_RANGE: Record<WeaponId, number> = {
  meridian: 18,
  swift: 9,
  longline: 34,
  breaker: 5,
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
