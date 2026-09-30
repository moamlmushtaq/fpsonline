// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — InputSystem hub: keyboard/mouse + gamepad + touch.
//
// Semantics (per rendered frame):
//  • down(a)    — held on any device (a press+release within one frame still
//                 reads as down for that frame, so quick taps/clicks never get
//                 lost). Toggle-crouch / toggle-ADS latches are applied here
//                 for keyboard & gamepad; touch has its own toggles.
//  • pressed(a) — true once, on the frame the action went down.
//  • endFrame() — clears edges; call once per rendered frame.
//  • consumeLook() → { dx, dy } radians: +dx = turn RIGHT, +dy = look UP
//    (sensitivity, invert-Y and ADS-by-zoom scaling applied). A match does
//    `yaw -= dx; pitch += dy` (yaw is positive to the left, see types.ts).
//  • moveAxes()  → x = strafe (+right), y = forward (+forward), |v| ≤ 1.
// Mouse: 1.0 sensitivity ≈ 0.0022 rad per raw pixel.
// Device switching follows the last device actually used.
// ─────────────────────────────────────────────────────────────────────────────

import type { Action, InputSystem, Settings } from '../contracts';
import type { InputDevice } from '../../shared/types';
import { KeyboardMouse, mouseButtonCode } from './keyboard-mouse';
import { GamepadInput } from './gamepad';
import { DEFAULT_TOUCH_LAYOUT, TOUCH_BUTTONS, TouchControls } from './touch';

export { DEFAULT_TOUCH_LAYOUT, TOUCH_BUTTONS, mouseButtonCode };

/** Radians per raw mouse pixel at sensitivity 1.0. */
export const MOUSE_RAD_PER_PX = 0.0022;
/** Radians per CSS px of touch drag at touch sensitivity 1.0. */
export const TOUCH_RAD_PER_PX = 0.0052;

const ACTIONS: readonly Action[] = [
  'forward', 'back', 'left', 'right', 'jump', 'crouch', 'sprint', 'fire', 'ads', 'reload', 'throw',
  'interact', 'nextWeapon', 'primary', 'secondary', 'pickupSlot', 'scoreboard', 'pause',
];

const KBM = 0;
const PAD = 1;
const TOUCH = 2;

interface ActionState {
  src: [boolean, boolean, boolean];
  pressed: boolean;
  /** Went down at some point this frame (tap latch). */
  tapped: boolean;
  /** Toggle latch (kbm/pad toggle-crouch / toggle-ADS). */
  latch: boolean;
}

export class Input implements InputSystem {
  device: InputDevice;
  private readonly states = {} as Record<Action, ActionState>;
  private readonly km: KeyboardMouse;
  private readonly pad: GamepadInput;
  private readonly touch: TouchControls;
  private active = false;
  private touchWanted = false;
  private lookPxX = 0;
  private lookPxY = 0;
  private lookRadX = 0;
  private lookRadY = 0;
  private touchSmoothX = 0;
  private touchSmoothY = 0;
  private touchRawX = 0;
  private touchRawY = 0;
  private adsAmount = 0;
  private zoom = 1;
  private aimAssist: ((dt: number) => { dx: number; dy: number; slow: number }) | null = null;
  private lastTouch = -1e9;
  private polledFrame = -1;
  private frame = 0;
  private lastPoll = 0;
  private lastLook = 0;
  private padMove = { x: 0, y: 0 };
  private readonly deviceListeners = new Set<(d: InputDevice) => void>();
  private codeMapKey: unknown = null;
  private codeMap = new Map<string, Action[]>();
  private readonly heldCodes = new Set<string>();

  constructor(private readonly target: HTMLElement, private readonly getSettings: () => Settings) {
    for (const a of ACTIONS) this.states[a] = { src: [false, false, false], pressed: false, tapped: false, latch: false };
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const touchCapable = typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0;
    this.device = coarse && touchCapable ? 'touch' : 'kbm';

    this.km = new KeyboardMouse(target, {
      isActive: () => this.active,
      code: (c, d) => this.onCode(c, d),
      isBound: (c) => this.actionsFor(c).length > 0,
      lookPx: (dx, dy) => {
        this.lookPxX += dx;
        this.lookPxY += dy;
      },
      noteDevice: (d) => this.setDevice(d),
      sinceTouch: () => performance.now() - this.lastTouch,
    });
    this.pad = new GamepadInput();
    this.touch = new TouchControls(target.parentElement ?? document.body, {
      touchAction: (a, d) => this.setSource(a, TOUCH, d),
      touchLookPx: (dx, dy) => {
        this.touchRawX += dx;
        this.touchRawY += dy;
      },
      noteTouch: () => {
        this.lastTouch = performance.now();
        this.setDevice('touch');
      },
      settings: () => this.getSettings(),
    });
    // Touches anywhere (menus included) mark the device as touch.
    window.addEventListener('touchstart', this.onAnyTouch, { passive: true, capture: true });
  }

  private readonly onAnyTouch = (): void => {
    this.lastTouch = performance.now();
    this.setDevice('touch');
  };

  // ── Device ───────────────────────────────────────────────────────────────

  private setDevice(d: InputDevice): void {
    if (d === this.device) return;
    this.device = d;
    this.touch.setVisible(this.touchWanted && d === 'touch');
    for (const cb of this.deviceListeners) {
      try {
        cb(d);
      } catch (err) {
        console.error('[input] device listener failed', err);
      }
    }
  }

  onDeviceChange(cb: (d: InputDevice) => void): () => void {
    this.deviceListeners.add(cb);
    return () => this.deviceListeners.delete(cb);
  }

  // ── Bindings ─────────────────────────────────────────────────────────────

  private actionsFor(code: string): Action[] {
    const b = this.getSettings().bindings;
    if (b !== this.codeMapKey) {
      this.codeMapKey = b;
      this.codeMap = new Map();
      for (const a of ACTIONS) {
        for (const k of b[a]?.keys ?? []) {
          const list = this.codeMap.get(k) ?? [];
          list.push(a);
          this.codeMap.set(k, list);
        }
      }
    }
    return this.codeMap.get(code) ?? [];
  }

  private onCode(code: string, down: boolean): void {
    if (down) this.heldCodes.add(code);
    else this.heldCodes.delete(code);
    for (const a of this.actionsFor(code)) {
      // An action is held while ANY of its bound codes is held.
      const keys = this.getSettings().bindings[a]?.keys ?? [];
      this.setSource(a, KBM, keys.some((k) => this.heldCodes.has(k)));
    }
  }

  private isToggle(a: Action, src: number): boolean {
    if (src === TOUCH) return false;
    const s = this.getSettings();
    return (a === 'crouch' && s.toggleCrouch) || (a === 'ads' && s.toggleAds);
  }

  private setSource(a: Action, src: number, down: boolean): void {
    if (!this.active && down) return;
    const st = this.states[a];
    const before = st.src[0] || st.src[1] || st.src[2];
    if (down && !st.src[src] && this.isToggle(a, src)) st.latch = !st.latch;
    st.src[src] = down;
    const after = st.src[0] || st.src[1] || st.src[2];
    if (after && !before) {
      st.pressed = true;
      st.tapped = true;
    }
  }

  // ── Polling ──────────────────────────────────────────────────────────────

  private poll(): void {
    if (this.polledFrame === this.frame) return;
    this.polledFrame = this.frame;
    const now = performance.now();
    const dt = this.lastPoll > 0 ? Math.min(0.1, (now - this.lastPoll) / 1000) : 1 / 60;
    this.lastPoll = now;
    const s = this.getSettings();
    const f = this.pad.poll(dt, s.gamepadSensitivity);
    if (f.active) this.setDevice('gamepad');
    this.padMove.x = f.move.x;
    this.padMove.y = f.move.y;
    if (this.active) {
      this.lookRadX += f.look.x;
      this.lookRadY += f.look.y;
      for (const [a, d] of f.actions) this.setSource(a, PAD, d);
    }
    this.touch.update(dt);
  }

  // ── InputSystem ──────────────────────────────────────────────────────────

  setGameplayActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.touch.setEnabled(active);
    if (!active) this.releaseAll();
  }

  private releaseAll(): void {
    for (const a of ACTIONS) {
      const st = this.states[a];
      st.src[0] = st.src[1] = st.src[2] = false;
      st.pressed = st.tapped = st.latch = false;
    }
    this.heldCodes.clear();
    this.km.releaseAll();
    this.pad.reset();
    this.touch.releaseAll();
    this.lookPxX = this.lookPxY = this.lookRadX = this.lookRadY = 0;
    this.touchRawX = this.touchRawY = this.touchSmoothX = this.touchSmoothY = 0;
  }

  moveAxes(): { x: number; y: number } {
    this.poll();
    if (!this.active) return { x: 0, y: 0 };
    const k = (a: Action): number => (this.effective(a) ? 1 : 0);
    let x = k('right') - k('left') + this.padMove.x;
    let y = k('forward') - k('back') + this.padMove.y;
    if (this.touch.joystickActive) {
      const m = this.touch.move();
      x += m.x;
      y += m.y;
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  consumeLook(): { dx: number; dy: number } {
    this.poll();
    const now = performance.now();
    const dt = this.lastLook > 0 ? Math.min(0.1, (now - this.lastLook) / 1000) : 1 / 60;
    this.lastLook = now;
    const s = this.getSettings();
    const adsMult = 1 + (s.adsSensitivity / Math.max(1, this.zoom) - 1) * this.adsAmount;
    // Touch: light exponential smoothing of the finger path (no added latency on
    // short flicks: most of the delta lands within ~2 frames).
    const kS = 1 - Math.exp(-dt * 38);
    this.touchSmoothX += this.touchRawX;
    this.touchSmoothY += this.touchRawY;
    this.touchRawX = this.touchRawY = 0;
    const tx = this.touchSmoothX * kS;
    const ty = this.touchSmoothY * kS;
    this.touchSmoothX -= tx;
    this.touchSmoothY -= ty;
    let dx = this.lookPxX * MOUSE_RAD_PER_PX * s.mouseSensitivity + this.lookRadX + tx * TOUCH_RAD_PER_PX * s.touchSensitivity;
    let dy = -this.lookPxY * MOUSE_RAD_PER_PX * s.mouseSensitivity + this.lookRadY - ty * TOUCH_RAD_PER_PX * s.touchSensitivity;
    this.lookPxX = this.lookPxY = this.lookRadX = this.lookRadY = 0;
    if (!this.active) return { dx: 0, dy: 0 };
    dx *= adsMult;
    dy *= adsMult;
    if (s.invertY) dy = -dy;
    if (this.device === 'touch' && s.aimAssist && this.aimAssist) {
      try {
        const a = this.aimAssist(dt);
        const slow = Math.max(0, Math.min(0.9, a.slow || 0));
        dx = dx * (1 - slow) + (a.dx || 0);
        dy = dy * (1 - slow) + (a.dy || 0);
      } catch (err) {
        console.error('[input] aim assist failed', err);
      }
    }
    return { dx, dy };
  }

  private effective(a: Action): boolean {
    const st = this.states[a];
    const any = st.src[0] || st.src[1] || st.src[2];
    if (a === 'crouch' || a === 'ads') {
      const s = this.getSettings();
      const toggled = (a === 'crouch' && s.toggleCrouch) || (a === 'ads' && s.toggleAds);
      if (toggled) return st.latch || st.src[TOUCH];
    }
    return any || st.tapped;
  }

  down(a: Action): boolean {
    this.poll();
    if (!this.active) return false;
    if (a === 'sprint') {
      if (this.effective('sprint') || this.touch.sprinting) return true;
      // Auto-sprint (keyboard / gamepad): full forward input sprints.
      const s = this.getSettings();
      if (s.autoSprint && this.device !== 'touch') {
        const fwd = (this.states.forward.src[KBM] ? 1 : 0) + this.padMove.y;
        return fwd > 0.9 && !this.effective('ads') && !this.effective('crouch');
      }
      return false;
    }
    return this.effective(a);
  }

  pressed(a: Action): boolean {
    this.poll();
    return this.active && this.states[a].pressed;
  }

  endFrame(): void {
    this.frame++;
    for (const a of ACTIONS) {
      const st = this.states[a];
      st.pressed = false;
      st.tapped = false;
    }
  }

  lockPointer(): void {
    this.km.lockPointer();
  }

  get pointerLocked(): boolean {
    return this.km.pointerLocked;
  }

  setAimState(adsAmount: number, zoom: number): void {
    this.adsAmount = Math.max(0, Math.min(1, Number.isFinite(adsAmount) ? adsAmount : 0));
    this.zoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  }

  setAimAssist(fn: ((dt: number) => { dx: number; dy: number; slow: number }) | null): void {
    this.aimAssist = fn;
  }

  haptic(kind: 'hit' | 'kill' | 'damage' | 'light'): void {
    const s = this.getSettings();
    if (!s.haptics) return;
    if (this.device === 'gamepad') {
      const r = { hit: [0.15, 0.35, 60], kill: [0.55, 0.6, 140], damage: [0.7, 0.3, 160], light: [0, 0.2, 40] }[kind];
      this.pad.rumble(r[0], r[1], r[2]);
      return;
    }
    if (this.device !== 'touch' || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const pattern = { hit: 12, kill: [18, 45, 30], damage: 32, light: 8 }[kind];
    try {
      navigator.vibrate(pattern);
    } catch {
      /* unsupported / blocked */
    }
  }

  setTouchControlsVisible(v: boolean): void {
    this.touchWanted = v;
    this.touch.setVisible(v && this.device === 'touch');
  }

  dispose(): void {
    window.removeEventListener('touchstart', this.onAnyTouch, { capture: true } as EventListenerOptions);
    this.km.dispose();
    this.pad.dispose();
    this.touch.dispose();
    this.deviceListeners.clear();
  }
}
