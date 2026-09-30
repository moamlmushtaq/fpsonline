// HALCYON FRONT — weapon definitions (architecture contract, see ARCHITECTURE.md).
// Pure data shared by the host simulation, client prediction, HUD and menus.
// Balance targets: medium time-to-eliminate (~0.45–0.6 s body shots at optimal range).

import type { WeaponId } from './types';

export type FireMode = 'auto' | 'semi' | 'pump' | 'bolt' | 'charge';

export interface RecoilDef {
  /** Per-shot kick [pitchUp, yawRight] in radians, indexed by recoilIdx (clamped to last entry). */
  pattern: [number, number][];
  /** Multiplier applied while aiming down sights. */
  adsMult: number;
  /** Radians per second the recoil offset recovers toward zero once not firing. */
  recover: number;
  /** Seconds after the last shot before the spray index resets. */
  resetTime: number;
}

export interface WeaponDef {
  id: WeaponId;
  /** i18n keys. */
  nameKey: string;
  roleKey: string;
  slot: 'primary' | 'secondary' | 'pickup';
  fireMode: FireMode;
  /** Damage per bullet/pellet at close range. */
  damage: number;
  headMult: number;
  /** Damage falloff: full damage until `falloffStart` m, lerps to damage*minDamageMult at `falloffEnd` m. */
  falloffStart: number;
  falloffEnd: number;
  minDamageMult: number;
  /** Rounds per minute (for pump/bolt: includes the cycle). */
  rpm: number;
  pellets: number;
  magSize: number;
  /** Starting reserve ammo. */
  reserve: number;
  /** Full reload time (s). */
  reloadTime: number;
  /** Extra time when reloading from an empty magazine (chambering). */
  reloadEmptyExtra: number;
  /** If set, reload time = reloadTime * 0.25 + reloadPerRound * missingRounds (shell-by-shell feel). */
  reloadPerRound?: number;
  /** Cone half-angle (radians) when hip firing, standing still. */
  hipSpread: number;
  /** Cone half-angle (radians) when fully aimed. */
  adsSpread: number;
  /** Extra spread when moving at full speed (scaled by speed / SPRINT_SPEED). */
  moveSpread: number;
  /** Extra spread while airborne. */
  airSpread: number;
  bloomPerShot: number;
  bloomMax: number;
  /** Radians per second the bloom decays. */
  bloomRecover: number;
  recoil: RecoilDef;
  /** Seconds to fully aim down sights. */
  adsTime: number;
  /** FOV zoom factor when aimed (fov / adsZoom). */
  adsZoom: number;
  /** Uses a magnified scope overlay when aimed. */
  scoped: boolean;
  moveSpeedMult: number;
  /** Seconds to raise this weapon. */
  swapTime: number;
  /** Max hitscan distance (m). */
  range: number;
  /** Seconds to charge before the beam fires (Sunspear). */
  chargeTime?: number;
  /** Visual tracer style. */
  tracer: 'bullet' | 'pellet' | 'heavy' | 'beam';
  /** Sprint-to-fire delay (s). */
  sprintOutTime: number;
}

/** Deterministic, learnable spray pattern builder. */
function spray(
  count: number,
  shape: (i: number) => [number, number],
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) out.push(shape(i));
  return out;
}

const DEG = Math.PI / 180;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  meridian: {
    id: 'meridian',
    nameKey: 'weapon.meridian.name',
    roleKey: 'weapon.meridian.role',
    slot: 'primary',
    fireMode: 'auto',
    damage: 19,
    headMult: 1.6,
    falloffStart: 28,
    falloffEnd: 60,
    minDamageMult: 0.72,
    rpm: 620,
    pellets: 1,
    magSize: 30,
    reserve: 150,
    reloadTime: 2.0,
    reloadEmptyExtra: 0.4,
    hipSpread: 1.3 * DEG,
    adsSpread: 0.12 * DEG,
    moveSpread: 1.4 * DEG,
    airSpread: 3 * DEG,
    bloomPerShot: 0.22 * DEG,
    bloomMax: 1.8 * DEG,
    bloomRecover: 5 * DEG,
    recoil: {
      // Climbs straight up for 7 rounds, drifts right, then settles left: a learnable "7" shape.
      pattern: spray(30, (i) => {
        const up = i < 7 ? 0.42 : i < 16 ? 0.26 : 0.18;
        const side = i < 7 ? 0.02 : i < 16 ? 0.16 : -0.19;
        return [up * DEG, side * DEG];
      }),
      adsMult: 0.7,
      recover: 9 * DEG,
      resetTime: 0.28,
    },
    adsTime: 0.22,
    adsZoom: 1.35,
    scoped: false,
    moveSpeedMult: 0.96,
    swapTime: 0.45,
    range: 220,
    tracer: 'bullet',
    sprintOutTime: 0.16,
  },
  swift: {
    id: 'swift',
    nameKey: 'weapon.swift.name',
    roleKey: 'weapon.swift.role',
    slot: 'primary',
    fireMode: 'auto',
    damage: 15,
    headMult: 1.4,
    falloffStart: 12,
    falloffEnd: 30,
    minDamageMult: 0.58,
    rpm: 860,
    pellets: 1,
    magSize: 32,
    reserve: 160,
    reloadTime: 1.75,
    reloadEmptyExtra: 0.3,
    hipSpread: 1.6 * DEG,
    adsSpread: 0.45 * DEG,
    moveSpread: 0.6 * DEG,
    airSpread: 1.6 * DEG,
    bloomPerShot: 0.16 * DEG,
    bloomMax: 1.4 * DEG,
    bloomRecover: 6 * DEG,
    recoil: {
      // Fast gentle climb with a left-right wobble.
      pattern: spray(32, (i) => {
        const up = i < 5 ? 0.3 : 0.17;
        const side = Math.sin(i * 0.9) * 0.14;
        return [up * DEG, side * DEG];
      }),
      adsMult: 0.8,
      recover: 11 * DEG,
      resetTime: 0.22,
    },
    adsTime: 0.16,
    adsZoom: 1.25,
    scoped: false,
    moveSpeedMult: 1.05,
    swapTime: 0.35,
    range: 160,
    tracer: 'bullet',
    sprintOutTime: 0.1,
  },
  longline: {
    id: 'longline',
    nameKey: 'weapon.longline.name',
    roleKey: 'weapon.longline.role',
    slot: 'primary',
    fireMode: 'bolt',
    damage: 58,
    headMult: 2.0,
    falloffStart: 80,
    falloffEnd: 160,
    minDamageMult: 0.86,
    rpm: 110,
    pellets: 1,
    magSize: 6,
    reserve: 30,
    reloadTime: 2.5,
    reloadEmptyExtra: 0.35,
    hipSpread: 3.2 * DEG,
    adsSpread: 0,
    moveSpread: 2.5 * DEG,
    airSpread: 5 * DEG,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomRecover: 1,
    recoil: {
      pattern: [[2.6 * DEG, 0.25 * DEG]],
      adsMult: 0.75,
      recover: 6 * DEG,
      resetTime: 0.5,
    },
    adsTime: 0.3,
    adsZoom: 3.2,
    scoped: true,
    moveSpeedMult: 0.9,
    swapTime: 0.55,
    range: 320,
    tracer: 'heavy',
    sprintOutTime: 0.22,
  },
  breaker: {
    id: 'breaker',
    nameKey: 'weapon.breaker.name',
    roleKey: 'weapon.breaker.role',
    slot: 'primary',
    fireMode: 'pump',
    damage: 13,
    headMult: 1.25,
    falloffStart: 6,
    falloffEnd: 20,
    minDamageMult: 0.22,
    rpm: 70,
    pellets: 9,
    magSize: 6,
    reserve: 30,
    reloadTime: 2.6,
    reloadEmptyExtra: 0.35,
    reloadPerRound: 0.42,
    hipSpread: 4.3 * DEG,
    adsSpread: 3.1 * DEG,
    moveSpread: 0.4 * DEG,
    airSpread: 0.8 * DEG,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomRecover: 1,
    recoil: {
      pattern: [[3.2 * DEG, -0.4 * DEG]],
      adsMult: 0.85,
      recover: 8 * DEG,
      resetTime: 0.6,
    },
    adsTime: 0.2,
    adsZoom: 1.2,
    scoped: false,
    moveSpeedMult: 1.0,
    swapTime: 0.45,
    range: 60,
    tracer: 'pellet',
    sprintOutTime: 0.14,
  },
  pulse: {
    id: 'pulse',
    nameKey: 'weapon.pulse.name',
    roleKey: 'weapon.pulse.role',
    slot: 'secondary',
    fireMode: 'semi',
    damage: 26,
    headMult: 1.5,
    falloffStart: 15,
    falloffEnd: 38,
    minDamageMult: 0.68,
    rpm: 390,
    pellets: 1,
    magSize: 12,
    reserve: 60,
    reloadTime: 1.35,
    reloadEmptyExtra: 0.2,
    hipSpread: 0.9 * DEG,
    adsSpread: 0.15 * DEG,
    moveSpread: 0.7 * DEG,
    airSpread: 1.8 * DEG,
    bloomPerShot: 0.35 * DEG,
    bloomMax: 1.2 * DEG,
    bloomRecover: 6 * DEG,
    recoil: {
      pattern: [[1.1 * DEG, 0.12 * DEG], [1.0 * DEG, -0.1 * DEG]],
      adsMult: 0.8,
      recover: 10 * DEG,
      resetTime: 0.35,
    },
    adsTime: 0.14,
    adsZoom: 1.25,
    scoped: false,
    moveSpeedMult: 1.08,
    swapTime: 0.28,
    range: 140,
    tracer: 'bullet',
    sprintOutTime: 0.08,
  },
  sunspear: {
    id: 'sunspear',
    nameKey: 'weapon.sunspear.name',
    roleKey: 'weapon.sunspear.role',
    slot: 'pickup',
    fireMode: 'charge',
    damage: 135,
    headMult: 1.0,
    falloffStart: 999,
    falloffEnd: 1000,
    minDamageMult: 1,
    rpm: 60,
    pellets: 1,
    magSize: 4,
    reserve: 0,
    reloadTime: 0,
    reloadEmptyExtra: 0,
    hipSpread: 0.25 * DEG,
    adsSpread: 0,
    moveSpread: 0.2 * DEG,
    airSpread: 0.6 * DEG,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomRecover: 1,
    recoil: {
      pattern: [[3.8 * DEG, 0]],
      adsMult: 0.8,
      recover: 5 * DEG,
      resetTime: 0.8,
    },
    adsTime: 0.28,
    adsZoom: 1.8,
    scoped: false,
    moveSpeedMult: 0.86,
    swapTime: 0.55,
    range: 260,
    chargeTime: 0.6,
    tracer: 'beam',
    sprintOutTime: 0.2,
  },
};

/** Seconds between shots derived from rpm. */
export function fireInterval(id: WeaponId): number {
  return 60 / WEAPONS[id].rpm;
}

/** Damage for a single bullet/pellet at distance `dist` (before head multiplier). */
export function damageAt(id: WeaponId, dist: number): number {
  const w = WEAPONS[id];
  if (dist <= w.falloffStart) return w.damage;
  if (dist >= w.falloffEnd) return w.damage * w.minDamageMult;
  const k = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return w.damage * (1 - k * (1 - w.minDamageMult));
}

/** Throwables: one per life. */
export const THROWABLES = {
  smoke: { id: 'smoke' as const, nameKey: 'throwable.smoke.name', descKey: 'throwable.smoke.desc' },
  grenade: { id: 'grenade' as const, nameKey: 'throwable.grenade.name', descKey: 'throwable.grenade.desc' },
};
