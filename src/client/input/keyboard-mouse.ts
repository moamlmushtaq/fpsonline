// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — keyboard + mouse device.
//
// Forwards raw "codes" (KeyboardEvent.code, 'Mouse0..4', 'Wheel+'/'Wheel-') and
// raw mouse deltas to the Input hub, which owns bindings, edges and toggles.
//
// Mouse code convention (matches the settings defaults / key labels):
//   Mouse0 = left, Mouse1 = RIGHT, Mouse2 = middle, Mouse3 = back, Mouse4 = forward.
// 'Wheel+' = scroll down (deltaY > 0), 'Wheel-' = scroll up.
//
// Pointer lock with graceful fallback: when the browser refuses/ lacks pointer
// lock (iframes, some mobile browsers with a mouse), looking works by dragging
// with any mouse button held. Once a lock has worked, a later refusal (Chrome's
// ~1 s re-lock cooldown after Esc) never drops into drag-look: the click that
// re-captures the mouse is swallowed instead of firing a shot.
//
// Edge cases handled here: raw deltas (unadjustedMovement) with a plain retry,
// lock-engage spikes, emulated mouse events after touches, mouse back/forward
// buttons (no browser history navigation mid-match), smooth-scrolling
// trackpads (wheel deltas are accumulated into notches and rate-limited),
// Alt/Tab default actions, and a leave-page confirmation while in gameplay
// (Ctrl+W with the default crouch-on-Ctrl binding).
// ─────────────────────────────────────────────────────────────────────────────

import type { InputDevice } from '../../shared/types';

/** DOM MouseEvent.button → binding code. */
export function mouseButtonCode(button: number): string {
  switch (button) {
    case 0:
      return 'Mouse0';
    case 2:
      return 'Mouse1';
    case 1:
      return 'Mouse2';
    default:
      return `Mouse${button}`;
  }
}

export interface KbmSink {
  /** Gameplay input is being captured. */
  isActive(): boolean;
  /** A code changed state. */
  code(code: string, down: boolean): void;
  /** Codes bound to gameplay actions (for preventDefault decisions). */
  isBound(code: string): boolean;
  lookPx(dx: number, dy: number): void;
  noteDevice(d: InputDevice): void;
  /** Milliseconds since the last touch event (to ignore emulated mouse events). */
  sinceTouch(): number;
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export class KeyboardMouse {
  private readonly held = new Set<string>();
  private lockSupported: boolean;
  private lockFailed = false;
  private dragLook = false;
  private lastMove = 0;
  /** A pointer lock has engaged at least once (so it works here). */
  private everLocked = false;
  private wheelAcc = 0;
  private wheelLastT = 0;
  private wheelEmitT = 0;

  constructor(private readonly target: HTMLElement, private readonly sink: KbmSink) {
    this.lockSupported = typeof target.requestPointerLock === 'function';
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('contextmenu', this.onContext);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerlockerror', this.onLockError);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('beforeunload', this.onBeforeUnload);
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /** True when look must use drag-to-look (no pointer lock available). */
  get fallback(): boolean {
    return !this.lockSupported || (this.lockFailed && !this.everLocked);
  }

  lockPointer(): void {
    if (!this.lockSupported || this.pointerLocked) return;
    try {
      // unadjustedMovement = raw deltas (no OS acceleration) where supported.
      const req = this.target.requestPointerLock as (o?: { unadjustedMovement?: boolean }) => Promise<void> | void;
      const r = req.call(this.target, { unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => {
          try {
            const r2 = req.call(this.target);
            if (r2 && typeof (r2 as Promise<void>).catch === 'function') (r2 as Promise<void>).catch(() => (this.lockFailed = true));
          } catch {
            this.lockFailed = true;
          }
        });
      }
    } catch {
      this.lockFailed = true;
    }
  }

  releaseAll = (): void => {
    for (const c of this.held) this.sink.code(c, false);
    this.held.clear();
    this.dragLook = false;
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.releaseAll();
  };

  private readonly onLockError = (): void => {
    this.lockFailed = true;
  };

  /**
   * The first request asks for raw (unadjustedMovement) deltas; where that isn't supported
   * the browser fires pointerlockerror before the plain retry succeeds. A lock that did
   * engage proves pointer lock works: leave the drag-to-look fallback.
   */
  private readonly onLockChange = (): void => {
    if (this.pointerLocked) {
      this.lockFailed = false;
      this.everLocked = true;
    }
  };

  /** Leaving the page mid-match (Ctrl+W with crouch on Ctrl, a stray Back) asks first. */
  private readonly onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (!this.sink.isActive()) return;
    e.preventDefault();
    e.returnValue = '';
  };

  private typing(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (TYPING.has(t.tagName) || t.isContentEditable);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.typing(e)) return;
    this.sink.noteDevice('kbm');
    if (!this.sink.isActive()) return;
    // Keep the page from scrolling / focus-hopping on bound keys (never Escape / F-keys).
    if (this.sink.isBound(e.code) && e.code !== 'Escape' && !/^F\d+$/.test(e.code)) e.preventDefault();
    if (e.repeat || this.held.has(e.code)) return;
    this.held.add(e.code);
    this.sink.code(e.code, true);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    // Alt (Firefox menu bar) and similar default actions on release of a bound key.
    if (this.sink.isActive() && this.sink.isBound(e.code) && e.code !== 'Escape' && !this.typing(e)) e.preventDefault();
    if (!this.held.has(e.code)) return;
    this.held.delete(e.code);
    this.sink.code(e.code, false);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (this.sink.sinceTouch() < 900) return; // emulated mouse after a touch
    this.sink.noteDevice('kbm');
    if (!this.sink.isActive()) return;
    // Mouse back/forward buttons must never navigate away mid-match.
    if (e.button === 3 || e.button === 4) e.preventDefault();
    // Only clicks on the game surface (or while locked) count as gameplay input.
    if (!this.pointerLocked && e.target !== this.target) return;
    // Not captured yet but lock works here: this click only (re)captures the mouse
    // (the App requests the lock on pointerdown) — it must not also fire a shot.
    if (!this.pointerLocked && !this.fallback) return;
    const code = mouseButtonCode(e.button);
    if (this.fallback) this.dragLook = true;
    if (this.held.has(code)) return;
    this.held.add(code);
    this.sink.code(code, true);
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if ((e.button === 3 || e.button === 4) && this.sink.isActive()) e.preventDefault();
    const code = mouseButtonCode(e.button);
    if (e.buttons === 0) this.dragLook = false;
    if (!this.held.has(code)) return;
    this.held.delete(code);
    this.sink.code(code, false);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (this.sink.sinceTouch() < 900) return;
    const mx = e.movementX || 0;
    const my = e.movementY || 0;
    if (Math.abs(mx) + Math.abs(my) > 2) {
      const now = performance.now();
      // Only a sustained move flips the device (avoids jitter from a resting mouse).
      if (now - this.lastMove < 120) this.sink.noteDevice('kbm');
      this.lastMove = now;
    }
    if (!this.sink.isActive()) return;
    if (!(this.pointerLocked || (this.fallback && this.dragLook))) return;
    // Chrome occasionally reports a huge spike when the lock engages; drop it.
    if (Math.abs(mx) > 500 || Math.abs(my) > 500) return;
    this.sink.lookPx(mx, my);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.sink.isActive()) return;
    e.preventDefault();
    // Normalise to pixels; a classic wheel notch is ~100 px, trackpads send many tiny deltas.
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    if (Math.abs(dy) < 0.5) return;
    const now = performance.now();
    if (now - this.wheelLastT > 180 || Math.sign(dy) !== Math.sign(this.wheelAcc)) this.wheelAcc = 0;
    this.wheelLastT = now;
    this.wheelAcc += dy;
    if (Math.abs(this.wheelAcc) < 45) return;
    // At most one weapon step per 110 ms: an inertial trackpad flick is one swap, not five.
    if (now - this.wheelEmitT < 110) {
      this.wheelAcc = 0;
      return;
    }
    const code = this.wheelAcc > 0 ? 'Wheel+' : 'Wheel-';
    this.wheelAcc = 0;
    this.wheelEmitT = now;
    // A wheel notch is a press that releases in the same frame (the hub latches it).
    this.sink.code(code, true);
    this.sink.code(code, false);
  };

  private readonly onContext = (e: Event): void => {
    if (this.sink.isActive()) e.preventDefault();
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('wheel', this.onWheel);
    this.target.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('blur', this.releaseAll);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerlockerror', this.onLockError);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
  }
}
