// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — gamepad device (Standard Gamepad mapping).
//
//   Left stick  move (radial deadzone, rescaled)      L3  sprint (latched)
//   Right stick look (response curve + acceleration)  R3  pickup slot
//   RT fire · LT aim · A jump · B crouch/slide · X reload · Y swap
//   LB throw · RB interact · View/Back scoreboard · Start pause
//   D-pad: ↑ primary · ↓ sidearm · → pickup slot · ← interact
// Rumble through `vibrationActuator` (dual-rumble) when available.
// ─────────────────────────────────────────────────────────────────────────────

import type { Action } from '../contracts';

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

const MOVE_DEADZONE = 0.16;
const LOOK_DEADZONE = 0.12;
const TRIGGER = 0.35;
/** Base turn rates (rad/s) at full deflection, before sensitivity. */
const YAW_RATE = 3.4;
const PITCH_RATE = 2.4;

export interface PadFrame {
  /** Any meaningful activity this poll (for device switching). */
  active: boolean;
  move: { x: number; y: number };
  /** Look delta this poll in radians: +x right, +y up (before invert/ADS scaling). */
  look: { x: number; y: number };
  actions: Map<Action, boolean>;
}

function radial(x: number, y: number, dz: number): { x: number; y: number; m: number } {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0, m: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return { x: x * k, y: y * k, m: Math.min(1, (m - dz) / (1 - dz)) };
}

export class GamepadInput {
  private index = -1;
  private sprintLatch = false;
  private prevL3 = false;
  private accelT = 0;
  private boost = 1;
  private readonly frame: PadFrame = { active: false, move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, actions: new Map() };
  private readonly onConnect = (e: GamepadEvent): void => {
    if (this.index < 0) this.index = e.gamepad.index;
  };
  private readonly onDisconnect = (e: GamepadEvent): void => {
    if (e.gamepad.index === this.index) this.index = -1;
  };

  constructor() {
    window.addEventListener('gamepadconnected', this.onConnect);
    window.addEventListener('gamepaddisconnected', this.onDisconnect);
  }

  private pad(): Gamepad | null {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    let pads: (Gamepad | null)[];
    try {
      pads = Array.from(navigator.getGamepads());
    } catch {
      return null;
    }
    if (this.index >= 0 && pads[this.index]?.connected) return pads[this.index];
    for (const p of pads) {
      if (p && p.connected) {
        this.index = p.index;
        return p;
      }
    }
    return null;
  }

  get connected(): boolean {
    return this.pad() !== null;
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
    const b = (i: number): number => {
      const btn = p.buttons[i];
      return btn ? (typeof btn.value === 'number' ? Math.max(btn.value, btn.pressed ? 1 : 0) : btn.pressed ? 1 : 0) : 0;
    };
    const ax = (i: number): number => (Number.isFinite(p.axes[i]) ? p.axes[i] : 0);

    // Move.
    const mv = radial(ax(0), ax(1), MOVE_DEADZONE);
    f.move.x = mv.x;
    f.move.y = -mv.y;
    if (mv.m > 0) f.active = true;

    // Sprint latch: click L3; releases when the stick relaxes or on crouch.
    const l3 = b(10) > 0.5;
    if (l3 && !this.prevL3) this.sprintLatch = !this.sprintLatch;
    this.prevL3 = l3;
    if (mv.m < 0.3 || b(1) > 0.5) this.sprintLatch = false;
    f.actions.set('sprint', this.sprintLatch);

    // Look: response curve + acceleration at full deflection.
    const lk = radial(ax(2), ax(3), LOOK_DEADZONE);
    if (lk.m > 0) {
      f.active = true;
      const curve = Math.pow(lk.m, 1.8) / Math.max(lk.m, 1e-6);
      if (lk.m > 0.92) this.accelT += dt;
      else this.accelT = 0;
      const target = this.accelT > 0.25 ? 1.6 : 1;
      this.boost += (target - this.boost) * Math.min(1, dt * (target > this.boost ? 2.5 : 10));
      const s = Math.max(0.1, sensitivity);
      f.look.x = lk.x * curve * YAW_RATE * s * this.boost * dt;
      f.look.y = -lk.y * curve * PITCH_RATE * s * this.boost * dt;
    } else {
      this.accelT = 0;
      this.boost = 1;
    }

    // Buttons / triggers.
    const fire = b(7) > TRIGGER;
    const ads = b(6) > TRIGGER;
    f.actions.set('fire', fire);
    f.actions.set('ads', ads);
    for (const [i, a] of BUTTON_ACTIONS) {
      const on = b(i) > 0.5;
      if (on) f.actions.set(a, true);
      else if (!f.actions.has(a)) f.actions.set(a, false);
    }
    if (fire || ads) f.active = true;
    for (let i = 0; i < p.buttons.length; i++) if (b(i) > 0.5) f.active = true;
    return f;
  }

  rumble(strong: number, weak: number, ms: number): void {
    const p = this.pad();
    const act = (p as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    if (!act?.playEffect) return;
    act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => undefined);
  }

  reset(): void {
    this.sprintLatch = false;
    this.accelT = 0;
    this.boost = 1;
  }

  dispose(): void {
    window.removeEventListener('gamepadconnected', this.onConnect);
    window.removeEventListener('gamepaddisconnected', this.onDisconnect);
  }
}
