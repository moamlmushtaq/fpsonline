// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — local player command builder.
//
// Turns the InputSystem into one InputCmd per fixed SIM_DT tick:
//  • Look is applied to yaw/pitch every RENDERED frame (zero-latency view);
//    each tick samples the current angles (quantized, yaw wrapped exactly as
//    the host's sanitizeCmd would, so prediction and host stay bit-identical).
//  • Buttons: held state OR anything that went down since the previous tick,
//    so taps shorter than a tick (high-refresh displays, quick clicks) are
//    never lost. `pressed()` edges clear every rendered frame — they are
//    latched here across ticks.
//  • Weapon slot: desired slot from primary/secondary/pickup/next presses and
//    the own 'pickup' event; follows combat.active when the desired slot is
//    empty (host auto-swap after the Sunspear runs dry).
//  • FIRE/THROW are masked outside 'live' (the range is exempt), exactly like
//    the host, so predicted and authoritative results agree.
//
// Pure logic (no DOM / three.js) — unit-tested in tests/client.
// ─────────────────────────────────────────────────────────────────────────────

import { PITCH_LIMIT } from '../../shared/constants';
import { clamp, wrapAngle } from '../../shared/math';
import type { CombatState, InputCmd } from '../../shared/types';
import {
  BTN_ADS,
  BTN_CROUCH,
  BTN_FIRE,
  BTN_INTERACT,
  BTN_JUMP,
  BTN_RELOAD,
  BTN_SPRINT,
  BTN_THROW,
} from '../../shared/types';

/** Mirrors contracts.Action (kept local so this module stays DOM-free). */
export type ActionName =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'crouch'
  | 'sprint'
  | 'fire'
  | 'ads'
  | 'reload'
  | 'throw'
  | 'interact'
  | 'nextWeapon'
  | 'primary'
  | 'secondary'
  | 'pickupSlot'
  | 'scoreboard'
  | 'pause';

/** The subset of InputSystem the builder needs. */
export interface InputLike {
  moveAxes(): { x: number; y: number };
  down(a: ActionName): boolean;
  pressed(a: ActionName): boolean;
}

const BUTTONS: readonly [ActionName, number][] = [
  ['jump', BTN_JUMP],
  ['crouch', BTN_CROUCH],
  ['sprint', BTN_SPRINT],
  ['fire', BTN_FIRE],
  ['ads', BTN_ADS],
  ['reload', BTN_RELOAD],
  ['throw', BTN_THROW],
  ['interact', BTN_INTERACT],
];

/** Quantize (and turn -0 into 0: JSON would, and the host must see the exact same numbers). */
const q = (x: number, k: number): number => Math.round(x * k) / k || 0;

export class LocalPlayer {
  /** View angles (radians; yaw + = left, pitch + = up). */
  yaw = 0;
  pitch = 0;
  /** Last command seq issued. */
  seq = 0;
  /** Desired weapon slot sent in commands. */
  desiredSlot = 0;
  /** Latest movement axes. */
  moveX = 0;
  moveZ = 0;
  /** Buttons held on the last sampled frame. */
  heldNow = 0;
  private latched = 0;
  private slotRequest = -1;
  private cycleRequest = false;

  /** Applies a look delta (+dx = turn right, +dy = look up). */
  look(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.yaw = wrapAngle(this.yaw - dx);
    this.pitch = clamp(this.pitch + dy, -PITCH_LIMIT, PITCH_LIMIT);
  }

  setAngles(yaw: number, pitch: number): void {
    this.yaw = wrapAngle(yaw);
    this.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Call once per rendered frame BEFORE running ticks. */
  sampleFrame(input: InputLike): void {
    let held = 0;
    for (const [a, bit] of BUTTONS) if (input.down(a)) held |= bit;
    this.heldNow = held;
    this.latched |= held;
    if (input.pressed('primary')) this.slotRequest = 0;
    if (input.pressed('secondary')) this.slotRequest = 1;
    if (input.pressed('pickupSlot')) this.slotRequest = 2;
    if (input.pressed('nextWeapon')) this.cycleRequest = true;
    const m = input.moveAxes();
    this.moveX = Number.isFinite(m.x) ? clamp(m.x, -1, 1) : 0;
    this.moveZ = Number.isFinite(m.y) ? clamp(m.y, -1, 1) : 0;
  }

  /** Requests a slot directly (own Sunspear pickup → 2, spawn → 0). */
  requestSlot(slot: number): void {
    this.desiredSlot = slot;
    this.slotRequest = -1;
    this.cycleRequest = false;
  }

  /** Clears held/latched buttons (pause, death). */
  releaseButtons(): void {
    this.latched = 0;
    this.heldNow = 0;
  }

  /**
   * Builds the command for one tick. `combat` = current predicted combat state
   * (slot validation), `allowFire` = phase is live (or the range).
   */
  buildCmd(viewTick: number, combat: CombatState | null, allowFire: boolean): InputCmd {
    let buttons = this.heldNow | this.latched;
    this.latched = 0;
    if (!allowFire) buttons &= ~(BTN_FIRE | BTN_THROW);
    if (combat) {
      if (this.slotRequest >= 0) {
        if (combat.slots[this.slotRequest]) this.desiredSlot = this.slotRequest;
        this.slotRequest = -1;
      }
      if (this.cycleRequest) {
        this.cycleRequest = false;
        const from = combat.slots[this.desiredSlot] ? this.desiredSlot : combat.active;
        for (let i = 1; i <= 3; i++) {
          const s = (from + i) % 3;
          if (combat.slots[s]) {
            this.desiredSlot = s;
            break;
          }
        }
      }
      if (!combat.slots[this.desiredSlot]) this.desiredSlot = combat.active;
    }
    // Quantize, then wrap/clamp: the host's sanitizeCmd is idempotent on these values,
    // so the command we predict with is bit-identical to the one the host applies.
    const yaw = wrapAngle(q(this.yaw, 1e5));
    const pitch = clamp(q(clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT), 1e5), -PITCH_LIMIT, PITCH_LIMIT);
    return {
      seq: ++this.seq,
      mx: clamp(q(this.moveX, 1e3), -1, 1),
      mz: clamp(q(this.moveZ, 1e3), -1, 1),
      yaw,
      pitch,
      buttons: buttons & 0xff,
      slot: this.desiredSlot,
      viewTick: Number.isFinite(viewTick) ? q(viewTick, 100) : 0,
    };
  }
}
