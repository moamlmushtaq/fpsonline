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
// with any mouse button held.
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
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  /** True when look must use drag-to-look (no pointer lock available). */
  get fallback(): boolean {
    return !this.lockSupported || this.lockFailed;
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
    if (!this.held.has(e.code)) return;
    this.held.delete(e.code);
    this.sink.code(e.code, false);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (this.sink.sinceTouch() < 900) return; // emulated mouse after a touch
    this.sink.noteDevice('kbm');
    if (!this.sink.isActive()) return;
    // Only clicks on the game surface (or while locked) count as gameplay input.
    if (!this.pointerLocked && e.target !== this.target) return;
    const code = mouseButtonCode(e.button);
    if (this.fallback) this.dragLook = true;
    if (this.held.has(code)) return;
    this.held.add(code);
    this.sink.code(code, true);
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
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
    if (Math.abs(e.deltaY) < 1) return;
    const code = e.deltaY > 0 ? 'Wheel+' : 'Wheel-';
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
  }
}
