// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — gamepad device (Standard Gamepad mapping).
//
//   Left stick  move (radial dead zone, linear)       L3  sprint (latched)
//   Right stick look (dead zone + curve + rim boost)  R3  pickup slot
//   RT fire · LT aim · A jump · B crouch/slide · X reload · Y swap
//   LB throw · RB interact · View/Back scoreboard · Start pause
//   D-pad: ↑ primary · ↓ sidearm · → pickup slot · ← interact
// (glyphs.ts mirrors this table for prompts, per controller family.)
//
// Shaping lives in curves.ts (PAD_MOVE / PAD_LOOK): radial dead zones with
// rescale, outer saturation, a blended power curve for look, and a turn
// boost after ~0.2 s at the rim so 180° turns are quick without making fine
// aim twitchy. Triggers get their own threshold with hysteresis.
// With several pads connected, the one used most recently drives input.
// Rumble through `vibrationActuator` (dual-rumble), tuned per event.
// ─────────────────────────────────────────────────────────────────────────────

import type { Action } from '../contracts';
import { PAD_LOOK, PAD_MOVE, shapeStick, type Shaped } from './curves';
import { detectPadStyle, type PadStyle } from './glyphs';

const BUTTON_ACTIONS: [number, Action][] = [
  [0, 'jump'],
  [1, 'crouch'],
  [2, 'reload'],
  [3, 'nextWeapon'],
  [4, 'throw'],
  [5, 'interact'],
  [8, 'scoreboard'],
  [9, 'pause'],
  [11, 'pickupSlot'],
  [12, 'primary'],
  [13, 'secondary'],
  [14, 'interact'],
  [15, 'pickupSlot'],
];

/** Trigger press / release thresholds (hysteresis: no chatter on a half-pulled trigger). */
const TRIGGER_ON = 0.3;
const TRIGGER_OFF = 0.18;
/** Base turn rates (rad/s) at full deflection, before sensitivity. */
const YAW_RATE = 3.5;
const PITCH_RATE = 2.4;
/** Rim boost: after RIM_DELAY s at ≥ RIM deflection, turn rate ramps up to ×BOOST. */
const RIM = 0.94;
const RIM_DELAY = 0.2;
const BOOST = 1.75;

export interface PadFrame {
  /** Any meaningful activity this poll (for device switching). */
  active: boolean;
  move: { x: number; y: number };
  /** Look delta this poll in radians: +x right, +y up (before invert/ADS scaling). */
  look: { x: number; y: number };
  actions: Map<Action, boolean>;
}

type RumbleKind = 'hit' | 'kill' | 'damage' | 'light';

/** [strong, weak, ms] steps; a 0-magnitude step is a gap. */
const RUMBLE: Record<RumbleKind, [number, number, number][]> = {
  hit: [[0.05, 0.3, 45]],
  kill: [
    [0.5, 0.55, 80],
    [0, 0, 55],
    [0.35, 0.45, 70],
  ],
  damage: [[0.75, 0.35, 150]],
  light: [[0, 0.18, 35]],
};

export class GamepadInput {
  private index = -1;
  private lastStamp = -1;
  private sprintLatch = false;
  private prevL3 = false;
  private rimT = 0;
  private boost = 1;
  private fireOn = false;
  private adsOn = false;
  private padId = '';
  private styleCache: PadStyle = 'generic';
  private rumbleTimer = 0;
  private readonly mv: Shaped = { x: 0, y: 0, m: 0 };
  private readonly lk: Shaped = { x: 0, y: 0, m: 0 };
  private readonly frame: PadFrame = { active: false, move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, actions: new Map() };
  private readonly onConnect = (e: GamepadEvent): void => {
    if (this.index < 0) this.index = e.gamepad.index;
  };
  private readonly onDisconnect = (e: GamepadEvent): void => {
    if (e.gamepad.index === this.index) {
      this.index = -1;
      this.reset();
    }
  };

  constructor() {
    window.addEventListener('gamepadconnected', this.onConnect);
    window.addEventListener('gamepaddisconnected', this.onDisconnect);
  }

  private pads(): (Gamepad | null)[] {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
    try {
      return Array.from(navigator.getGamepads());
    } catch {
      return [];
    }
  }

  /** The pad to read: the most recently updated connected pad (Gamepad.timestamp). */
  private pad(): Gamepad | null {
    const pads = this.pads();
    let best: Gamepad | null = null;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      if (!best || (p.timestamp || 0) > (best.timestamp || 0)) best = p;
    }
    // Stick with the current pad unless another one has newer input.
    const cur = this.index >= 0 ? pads[this.index] : null;
    if (cur && cur.connected && best && best !== cur && (best.timestamp || 0) <= this.lastStamp) best = cur;
    if (best) {
      this.index = best.index;
      if (best.id !== this.padId) {
        this.padId = best.id;
        this.styleCache = detectPadStyle(best.id);
      }
    }
    return best;
  }

  get connected(): boolean {
    return this.pad() !== null;
  }

  /** Controller family of the active pad (for prompt glyphs). */
  get style(): PadStyle {
    return this.styleCache;
  }

  /** Polls the pad; `dt` seconds since the previous poll. */
  poll(dt: number, sensitivity: number): PadFrame {
    const f = this.frame;
    f.active = false;
    f.move.x = f.move.y = 0;
    f.look.x = f.look.y = 0;
    f.actions.clear();
    const p = this.pad();
    if (!p) {
      this.sprintLatch = false;
      return f;
    }
    this.lastStamp = Math.max(this.lastStamp, p.timestamp || 0);
    const b = (i: number): number => {
      const btn = p.buttons[i];
      return btn ? (typeof btn.value === 'number' ? Math.max(btn.value, btn.pressed ? 1 : 0) : btn.pressed ? 1 : 0) : 0;
    };
    const ax = (i: number): number => {
      const v = p.axes[i];
      return Number.isFinite(v) ? v : 0;
    };

    // Move.
    const mv = shapeStick(ax(0), ax(1), PAD_MOVE, this.mv);
    f.move.x = mv.x;
    f.move.y = -mv.y;
    if (mv.m > 0) f.active = true;

    // Sprint latch: click L3; releases when the stick relaxes or on crouch.
    const l3 = b(10) > 0.5;
    if (l3 && !this.prevL3) this.sprintLatch = !this.sprintLatch;
    this.prevL3 = l3;
    if (mv.m < 0.3 || b(1) > 0.5) this.sprintLatch = false;
    f.actions.set('sprint', this.sprintLatch);

    // Look: shaped + rim boost.
    const lk = shapeStick(ax(2), ax(3), PAD_LOOK, this.lk);
    if (lk.m > 0) {
      f.active = true;
      if (lk.m >= RIM) this.rimT += dt;
      else this.rimT = 0;
      const target = this.rimT > RIM_DELAY ? BOOST : 1;
      // Ramp in over ~0.35 s, drop out quickly when the stick leaves the rim.
      this.boost += (target - this.boost) * Math.min(1, dt * (target > this.boost ? 3 : 12));
      const s = Math.max(0.1, sensitivity);
      f.look.x = lk.x * YAW_RATE * s * this.boost * dt;
      f.look.y = -lk.y * PITCH_RATE * s * this.boost * dt;
    } else {
      this.rimT = 0;
      this.boost = 1;
    }

    // Triggers (hysteresis).
    const rt = b(7);
    const lt = b(6);
    this.fireOn = this.fireOn ? rt > TRIGGER_OFF : rt > TRIGGER_ON;
    this.adsOn = this.adsOn ? lt > TRIGGER_OFF : lt > TRIGGER_ON;
    f.actions.set('fire', this.fireOn);
    f.actions.set('ads', this.adsOn);
    for (const [i, a] of BUTTON_ACTIONS) {
      const on = b(i) > 0.5;
      if (on) f.actions.set(a, true);
      else if (!f.actions.has(a)) f.actions.set(a, false);
    }
    if (this.fireOn || this.adsOn) f.active = true;
    for (let i = 0; i < p.buttons.length; i++) if (b(i) > 0.5) f.active = true;
    return f;
  }

  rumble(strong: number, weak: number, ms: number): void {
    const p = this.pad();
    const act = (p as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    if (!act?.playEffect) return;
    act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => undefined);
  }

  /** Plays a tuned rumble pattern (a newer pattern replaces a running one). */
  rumblePattern(kind: RumbleKind): void {
    window.clearTimeout(this.rumbleTimer);
    const steps = RUMBLE[kind];
    let i = 0;
    const next = (): void => {
      const st = steps[i++];
      if (!st) return;
      if (st[0] > 0 || st[1] > 0) this.rumble(st[0], st[1], st[2]);
      if (i < steps.length) this.rumbleTimer = window.setTimeout(next, st[2]);
    };
    next();
  }

  reset(): void {
    this.sprintLatch = false;
    this.rimT = 0;
    this.boost = 1;
    this.fireOn = this.adsOn = false;
  }

  dispose(): void {
    window.clearTimeout(this.rumbleTimer);
    window.removeEventListener('gamepadconnected', this.onConnect);
    window.removeEventListener('gamepaddisconnected', this.onDisconnect);
  }
}
