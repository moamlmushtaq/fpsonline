// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — on-screen touch controls (live layer).
//
//  • Floating left joystick: appears where the thumb lands (left ~42 % of the
//    screen). Radial dead zone + response curve (input/curves.ts), a light
//    snap to straight-ahead, and a SPRINT ZONE past the ring edge (the ring's
//    top arc and chevron light up). Double-tap-and-hold locks sprint until
//    the thumb lifts. Dragging far past the ring drags the base along, so the
//    stick never "runs out".
//  • Right side: drag anywhere free to aim (the hub shapes it with an
//    acceleration curve + adaptive smoothing). FIRE also aims while held and
//    dragged. With several aim fingers down, the newest one owns the view.
//  • Buttons (positions from settings.touchLayout, see touch-layout.ts):
//      FIRE (hold) · AIM (tap = toggle, hold = momentary) · JUMP
//      CROUCH (tap = toggle, hold = momentary, tap while sprinting = slide)
//      RELOAD · SWAP (tap = next weapon, hold = slot radial) · THROW
//      INTERACT (dimmed unless the HUD shows a prompt) · PAUSE · SCOREBOARD.
//  • Robust multi-touch: tracked by Touch.identifier, touchcancel handled,
//    touches whose end event was lost are reconciled on the next touchstart,
//    everything releases on blur / app switch. No scroll, zoom, selection or
//    callouts. No layout reads in the move path (120 Hz friendly).
// ─────────────────────────────────────────────────────────────────────────────

import type { Action, Settings } from '../contracts';
import { t } from '../ui/i18n';
import { shapeStick, TOUCH_STICK, type Shaped } from './curves';
import {
  buttonMarkup,
  controlLabel,
  createSafeProbe,
  ensureTouchCss,
  readSafe,
  resolveLayout,
  stickMarkup,
  TOUCH_BUTTONS,
  type SafeInsets,
  type TouchButtonDef,
  type TouchButtonId,
} from './touch-layout';

export { DEFAULT_TOUCH_LAYOUT, TOUCH_BUTTONS } from './touch-layout';
export type { TouchButtonDef, TouchButtonId } from './touch-layout';

/** Hybrid buttons: a press longer than this is momentary instead of a toggle. */
const HOLD_MS = 260;
/** Swap: holding this long opens the weapon-slot radial. */
const SWAP_RADIAL_MS = 300;
/** A slide tap keeps crouch down at least this long (s) so the sim sees it. */
const SLIDE_MIN_S = 0.3;
/** Thumb distance (in ring radii) that enters the sprint zone. */
const SPRINT_ZONE = 1.12;
/** Beyond this many radii the joystick base follows the thumb. */
const FOLLOW = 1.6;
/** Directions within this angle of straight ahead snap to it (running straight is easy). */
const SNAP_FWD = (9 * Math.PI) / 180;
/** Share of the screen width (left) that spawns the joystick. */
const STICK_ZONE = 0.42;

const SLOTS: readonly { action: Action; key: string; fallback: string; n: string }[] = [
  { action: 'primary', key: 'controls.slot.primary', fallback: 'Primary', n: '1' },
  { action: 'secondary', key: 'controls.slot.secondary', fallback: 'Sidearm', n: '2' },
  { action: 'pickupSlot', key: 'controls.slot.pickup', fallback: 'Pickup', n: '3' },
];

const CSS = `
.hf-touch{position:absolute;inset:0;z-index:25;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;overflow:hidden;contain:strict;overscroll-behavior:none}
`;

interface ButtonView {
  def: TouchButtonDef;
  el: HTMLDivElement;
  x: number;
  y: number;
  r: number;
  /** Fingers currently on the button. */
  pressed: number;
  latched: boolean;
  /** Contextual button currently dimmed (not hittable). */
  ctxOff: boolean;
}

interface Press {
  b: ButtonView;
  t0: number;
  wasLatched: boolean;
  slide: boolean;
}

export interface TouchSink {
  touchAction(a: Action, down: boolean): void;
  /** Look delta in CSS px (+x right, +y down). */
  touchLookPx(dx: number, dy: number): void;
  noteTouch(): void;
  settings(): Settings;
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly buttons: ButtonView[] = [];
  private readonly stick: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly radial: HTMLDivElement;
  private readonly petals: HTMLDivElement[] = [];
  private readonly probe: HTMLDivElement;
  private visible = false;
  private enabled = false;
  private layoutKey: unknown = null;
  private w = 1;
  private h = 1;
  private ox = 0;
  private oy = 0;
  private safe: SafeInsets = { l: 0, r: 0, t: 0, b: 0 };
  private stickHome = { x: 0, y: 0, r: 62 };
  // Joystick.
  private stickId: number | null = null;
  private stickCx = 0;
  private stickCy = 0;
  private dirX = 0;
  private dirY = 0;
  private stickMag = 0;
  private stickDist = 0;
  private sprintLock = false;
  private lastLeftTap = 0;
  private readonly shaped: Shaped = { x: 0, y: 0, m: 0 };
  private stickCls = '';
  // Aim fingers (id → last position); `lookId` owns the view.
  private readonly aims = new Map<number, { x: number; y: number }>();
  private lookId: number | null = null;
  private readonly presses = new Map<number, Press>();
  private slideHold = 0;
  // Swap radial.
  private swapId: number | null = null;
  private swapTimer = 0;
  private radialOpen = false;
  private radialSel = -1;
  private readonly petalPos = [0, 0, 0, 0, 0, 0];
  // Contextual interact.
  private ctxTimer = 0;
  private hudPrompt: Element | null = null;

  constructor(private readonly parent: HTMLElement, private readonly sink: TouchSink) {
    ensureTouchCss();
    if (!document.getElementById('hf-touch-live-css')) {
      const st = document.createElement('style');
      st.id = 'hf-touch-live-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.root = document.createElement('div');
    this.root.className = 'hf-touch hf-tc';
    this.root.style.display = 'none';
    this.stick = document.createElement('div');
    this.stick.className = 'stick idle';
    this.stick.innerHTML = stickMarkup();
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.root.append(this.stick, this.knob);
    for (const def of TOUCH_BUTTONS) {
      const el = document.createElement('div');
      el.className = `b b-${def.id}`;
      el.setAttribute('role', 'button');
      el.innerHTML = buttonMarkup(def.id);
      this.root.appendChild(el);
      this.buttons.push({ def, el, x: 0, y: 0, r: def.size / 2, pressed: 0, latched: false, ctxOff: false });
    }
    this.radial = document.createElement('div');
    this.radial.className = 'radial';
    for (const s of SLOTS) {
      const p = document.createElement('div');
      p.className = 'pet';
      p.innerHTML = `<b dir="ltr">${s.n}</b><i></i>`;
      this.radial.appendChild(p);
      this.petals.push(p);
    }
    this.root.appendChild(this.radial);
    this.relabel();
    this.probe = createSafeProbe();
    parent.appendChild(this.root);
    const opt: AddEventListenerOptions = { passive: false };
    this.root.addEventListener('touchstart', this.onStart, opt);
    this.root.addEventListener('touchmove', this.onMove, opt);
    this.root.addEventListener('touchend', this.onEnd, opt);
    this.root.addEventListener('touchcancel', this.onEnd, opt);
    this.root.addEventListener('gesturestart', this.prevent as EventListener, opt);
    this.root.addEventListener('contextmenu', this.prevent);
    this.root.addEventListener('selectstart', this.prevent);
    window.addEventListener('resize', this.relayout);
    window.addEventListener('orientationchange', this.relayout);
    window.visualViewport?.addEventListener('resize', this.relayout);
    // App switch / notification shade / call: fingers "vanish" without touchend.
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
    window.addEventListener('pagehide', this.onBlur);
  }

  private readonly prevent = (e: Event): void => e.preventDefault();

  private readonly onBlur = (e: Event): void => {
    // Window blur (system dialog, notification shade) or the page going hidden.
    if (e.type !== 'visibilitychange' || document.visibilityState === 'hidden') this.releaseAll();
  };

  /** Re-applies localised labels (called on show; labels are aria-only). */
  private relabel(): void {
    for (const b of this.buttons) {
      const label = controlLabel(b.def.id);
      b.el.setAttribute('aria-label', label);
      b.el.title = label;
    }
    SLOTS.forEach((s, i) => {
      const txt = t(s.key);
      const el = this.petals[i].querySelector('i');
      if (el) el.textContent = txt !== s.key ? txt : s.fallback;
    });
  }

  // ── Visibility / layout ──────────────────────────────────────────────────

  /** Shown only while `enabled` (gameplay) and the device is touch. */
  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.style.display = v ? 'block' : 'none';
    if (v) {
      this.relabel();
      this.relayout();
    } else this.releaseAll();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.releaseAll();
  }

  private readonly relayout = (): void => {
    if (!this.visible) return;
    const rect = this.root.getBoundingClientRect();
    this.ox = rect.left;
    this.oy = rect.top;
    this.w = Math.max(1, rect.width || window.innerWidth);
    this.h = Math.max(1, rect.height || window.innerHeight);
    this.safe = readSafe(this.probe);
    this.applyLayout(true);
  };

  private applyLayout(force = false): void {
    const s = this.sink.settings();
    if (!force && s.touchLayout === this.layoutKey) return;
    this.layoutKey = s.touchLayout;
    this.root.style.opacity = String(Math.max(0.15, Math.min(1, s.touchOpacity)));
    const placed = resolveLayout(s.touchLayout, this.w, this.h, this.safe);
    for (const b of this.buttons) {
      const p = placed.get(b.def.id);
      if (!p) continue;
      b.r = p.r;
      b.x = p.x;
      b.y = p.y;
      b.el.style.width = b.el.style.height = `${p.r * 2}px`;
      this.paintButton(b);
    }
    const sp = placed.get('stick');
    const r = sp ? sp.r : 62;
    this.stickHome = { x: sp?.x ?? 150, y: sp?.y ?? this.h - 120, r };
    this.stick.style.width = this.stick.style.height = `${r * 2}px`;
    const kr = r * 0.46;
    this.knob.style.width = this.knob.style.height = `${kr * 2}px`;
    if (this.stickId === null) this.placeStick(this.stickHome.x, this.stickHome.y, 0, 0, true);
  }

  private paintButton(b: ButtonView): void {
    // Position via left/top (changes only on layout); only the press scale animates.
    b.el.style.left = `${(b.x - b.r).toFixed(1)}px`;
    b.el.style.top = `${(b.y - b.r).toFixed(1)}px`;
    b.el.style.transform = b.pressed > 0 ? 'scale(0.93)' : '';
    b.el.classList.toggle('on', b.pressed > 0);
    b.el.classList.toggle('latched', b.latched);
    b.el.classList.toggle('ctx-off', b.ctxOff);
  }

  private placeStick(cx: number, cy: number, kx: number, ky: number, idle: boolean): void {
    const r = this.stickHome.r;
    this.stick.style.transform = `translate(${(cx - r).toFixed(1)}px, ${(cy - r).toFixed(1)}px)`;
    const kr = r * 0.46;
    this.knob.style.transform = `translate(${(cx + kx - kr).toFixed(1)}px, ${(cy + ky - kr).toFixed(1)}px)`;
    this.knob.style.opacity = idle ? '0.32' : '1';
    this.paintStickState(idle);
  }

  private paintStickState(idle: boolean): void {
    const cls = idle ? 'stick idle' : `stick live${this.sprinting ? ' sprint' : ''}${this.sprintLock ? ' locked' : ''}`;
    if (cls !== this.stickCls) {
      this.stickCls = cls;
      this.stick.className = cls;
    }
  }

  // ── State exposed to the hub ─────────────────────────────────────────────

  /** Movement axes (x right, y forward), magnitude ≤ 1. */
  move(): { x: number; y: number } {
    return { x: this.dirX * this.stickMag, y: -this.dirY * this.stickMag };
  }

  get sprinting(): boolean {
    if (this.stickId === null) return false;
    const fwd = -this.dirY;
    if (this.sprintLock) return this.stickMag > 0.3 && fwd > 0.5;
    return this.stickDist > SPRINT_ZONE && fwd > 0.7;
  }

  get joystickActive(): boolean {
    return this.stickId !== null;
  }

  /** An aim finger is down (the hub flushes look smoothing when it lifts). */
  get aiming(): boolean {
    return this.lookId !== null;
  }

  /** Per-frame upkeep (slide hold, swap radial, contextual buttons, layout changes). */
  update(dt: number): void {
    if (!this.visible) return;
    this.applyLayout();
    if (this.slideHold > 0) {
      this.slideHold -= dt;
      if (this.slideHold <= 0 && !this.isHeld('crouch')) this.sink.touchAction('crouch', this.buttonById('crouch')?.latched ?? false);
    }
    this.ctxTimer -= dt;
    if (this.ctxTimer <= 0) {
      this.ctxTimer = 0.2;
      this.updateContextual();
    }
    if (this.stickId !== null) this.paintStickState(false);
  }

  private updateContextual(): void {
    const b = this.buttonById('interact');
    if (!b) return;
    if (!this.hudPrompt || !this.hudPrompt.isConnected) this.hudPrompt = document.querySelector('.hud .hud-prompt');
    // No HUD prompt element at all (e.g. a harness): keep the button live.
    const off = !!this.hudPrompt && !this.hudPrompt.classList.contains('is-on') && b.pressed === 0;
    if (off !== b.ctxOff) {
      b.ctxOff = off;
      this.paintButton(b);
    }
  }

  private buttonById(id: TouchButtonId): ButtonView | undefined {
    return this.buttons.find((b) => b.def.id === id);
  }

  private isHeld(id: TouchButtonId): boolean {
    return (this.buttonById(id)?.pressed ?? 0) > 0;
  }

  releaseAll(): void {
    for (const b of this.buttons) {
      if (b.pressed > 0 || b.latched) {
        b.pressed = 0;
        b.latched = false;
        this.sink.touchAction(b.def.action, false);
        this.paintButton(b);
      }
    }
    this.presses.clear();
    this.aims.clear();
    this.lookId = null;
    this.stickId = null;
    this.dirX = this.dirY = this.stickMag = this.stickDist = 0;
    this.sprintLock = false;
    this.slideHold = 0;
    window.clearTimeout(this.swapTimer);
    this.swapId = null;
    this.closeRadial(false);
    if (this.visible) this.placeStick(this.stickHome.x, this.stickHome.y, 0, 0, true);
  }

  // ── Touch handling ───────────────────────────────────────────────────────

  private hit(x: number, y: number): ButtonView | null {
    let best: ButtonView | null = null;
    let bestD = Infinity;
    for (const b of this.buttons) {
      if (b.ctxOff) continue;
      const d = Math.hypot(x - b.x, y - b.y);
      // Slightly generous reach (thumbs land off-centre); the nearest button wins.
      const reach = Math.max(b.r * 1.15, 28);
      if (d < reach && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  private press(b: ButtonView, id: number): void {
    const rec: Press = { b, t0: performance.now(), wasLatched: b.latched, slide: false };
    this.presses.set(id, rec);
    b.pressed++;
    const a = b.def.action;
    switch (b.def.mode) {
      case 'hold':
        this.sink.touchAction(a, true);
        if (b.def.id === 'jump') this.unlatch('crouch');
        break;
      case 'toggle':
        b.latched = !b.latched;
        this.sink.touchAction(a, b.latched);
        break;
      case 'hybrid':
        if (b.def.id === 'crouch' && this.sprinting) {
          // Tap while sprinting = slide: a crouch press the sim turns into a slide; no latch.
          rec.slide = true;
          b.latched = false;
          this.slideHold = SLIDE_MIN_S;
        }
        this.sink.touchAction(a, true);
        break;
      case 'swap':
        // A timer (not the frame loop) so the radial opens on time even at a low frame rate.
        this.swapId = id;
        window.clearTimeout(this.swapTimer);
        this.swapTimer = window.setTimeout(() => {
          if (this.swapId === id && this.enabled) this.openRadial();
        }, SWAP_RADIAL_MS);
        break;
    }
    if (b.def.id === 'ads' || b.def.id === 'fire') this.sprintLock = false;
    this.paintButton(b);
  }

  private unlatch(id: TouchButtonId): void {
    const c = this.buttonById(id);
    if (c?.latched) {
      c.latched = false;
      if (c.pressed === 0) this.sink.touchAction(c.def.action, false);
      this.paintButton(c);
    }
  }

  private release(rec: Press): void {
    const b = rec.b;
    b.pressed = Math.max(0, b.pressed - 1);
    const a = b.def.action;
    switch (b.def.mode) {
      case 'hold':
        if (b.pressed === 0) this.sink.touchAction(a, false);
        break;
      case 'hybrid': {
        if (rec.slide) {
          if (b.pressed === 0 && this.slideHold <= 0) this.sink.touchAction(a, false);
          break;
        }
        const short = performance.now() - rec.t0 < HOLD_MS;
        // Tap: flip the latch. Hold: momentary, so it always ends released.
        b.latched = short ? !rec.wasLatched : false;
        if (b.pressed === 0) this.sink.touchAction(a, b.latched);
        break;
      }
      case 'swap':
        window.clearTimeout(this.swapTimer);
        if (this.radialOpen) this.closeRadial(true);
        else {
          // Quick tap: next weapon (press + release in one frame latches in the hub).
          this.sink.touchAction('nextWeapon', true);
          this.sink.touchAction('nextWeapon', false);
        }
        this.swapId = null;
        break;
      default:
        break;
    }
    this.paintButton(b);
  }

  private openRadial(): void {
    const b = this.buttonById('swap');
    if (!b) return;
    this.radialOpen = true;
    this.radialSel = -1;
    // Fan the petals toward the screen centre (biased downward, away from the
    // HUD's top band) and keep them inside the safe area.
    const up = b.y < this.h * 0.6 ? 0.35 : 0;
    const base = Math.atan2(this.h * 0.5 - b.y, this.w * 0.5 - b.x);
    const dist = b.r + 46;
    const side = Math.cos(base) < 0 ? -1 : 1;
    for (let i = 0; i < 3; i++) {
      const a = base + (i - 1) * 0.85 - up * side;
      const px = Math.max(this.safe.l + 34, Math.min(this.w - this.safe.r - 34, b.x + Math.cos(a) * dist));
      const py = Math.max(this.safe.t + 34, Math.min(this.h - this.safe.b - 34, b.y + Math.sin(a) * dist));
      this.petalPos[i * 2] = px;
      this.petalPos[i * 2 + 1] = py;
      const p = this.petals[i];
      p.style.left = `${px}px`;
      p.style.top = `${py}px`;
      p.classList.remove('sel');
    }
    this.radial.classList.add('open');
    b.el.classList.add('latched');
  }

  private updateRadial(x: number, y: number): void {
    const b = this.buttonById('swap');
    if (!b) return;
    let sel = -1;
    if (Math.hypot(x - b.x, y - b.y) > b.r * 0.7) {
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const d = Math.hypot(x - this.petalPos[i * 2], y - this.petalPos[i * 2 + 1]);
        if (d < best) {
          best = d;
          sel = i;
        }
      }
    }
    if (sel !== this.radialSel) {
      this.radialSel = sel;
      this.petals.forEach((p, i) => p.classList.toggle('sel', i === sel));
    }
  }

  private closeRadial(commit: boolean): void {
    if (commit && this.radialSel >= 0) {
      const a = SLOTS[this.radialSel].action;
      this.sink.touchAction(a, true);
      this.sink.touchAction(a, false);
    }
    this.radialOpen = false;
    this.radialSel = -1;
    this.radial.classList.remove('open');
    const b = this.buttonById('swap');
    if (b) this.paintButton(b);
  }

  /** Is `id` still among the touches currently on the screen? */
  private static live(id: number, list: TouchList): boolean {
    for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return true;
    return false;
  }

  /** Ends tracked touches whose touchend never arrived (system gestures, lost events). */
  private reconcile(list: TouchList): void {
    if (this.stickId !== null && !TouchControls.live(this.stickId, list)) this.endTouch(this.stickId);
    for (const id of [...this.presses.keys()]) if (!TouchControls.live(id, list)) this.endTouch(id);
    for (const id of [...this.aims.keys()]) if (!TouchControls.live(id, list)) this.endTouch(id);
  }

  private readonly onStart = (e: TouchEvent): void => {
    if (e.cancelable) e.preventDefault();
    this.sink.noteTouch();
    if (!this.enabled) return;
    this.reconcile(e.touches);
    const ch = e.changedTouches;
    for (let i = 0; i < ch.length; i++) {
      const tch = ch[i];
      const id = tch.identifier;
      const x = tch.clientX - this.ox;
      const y = tch.clientY - this.oy;
      const b = this.hit(x, y);
      if (b) {
        this.press(b, id);
        if (b.def.id === 'fire') {
          this.aims.set(id, { x, y });
          this.lookId = id;
        }
        continue;
      }
      if (x < this.w * STICK_ZONE && this.stickId === null) {
        const now = performance.now();
        // Double-tap-and-hold on the left side locks sprint until the thumb lifts.
        this.sprintLock = now - this.lastLeftTap < 320;
        this.lastLeftTap = now;
        const r = this.stickHome.r;
        this.stickId = id;
        this.stickCx = Math.max(this.safe.l + r * 0.6, Math.min(this.w * STICK_ZONE, x));
        this.stickCy = Math.max(this.safe.t + r * 0.6, Math.min(this.h - this.safe.b - r * 0.6, y));
        this.updateStick(x, y);
        continue;
      }
      if (x >= this.w * 0.28) {
        this.aims.set(id, { x, y });
        this.lookId = id;
      }
    }
  };

  private updateStick(x: number, y: number): void {
    const r = this.stickHome.r;
    let dx = x - this.stickCx;
    let dy = y - this.stickCy;
    let d = Math.hypot(dx, dy);
    if (d > r * FOLLOW) {
      // Drag the base along behind the thumb.
      const k = 1 - (r * FOLLOW) / d;
      this.stickCx += dx * k;
      this.stickCy += dy * k;
      dx = x - this.stickCx;
      dy = y - this.stickCy;
      d = r * FOLLOW;
    }
    this.stickDist = d / r;
    shapeStick(dx / r, dy / r, TOUCH_STICK, this.shaped);
    if (this.shaped.m > 0) {
      let ux = dx / d;
      let uy = dy / d;
      // Snap to straight ahead within a few degrees: long runs stay straight.
      if (uy < 0 && Math.abs(Math.atan2(ux, -uy)) < SNAP_FWD) {
        ux = 0;
        uy = -1;
      }
      this.dirX = ux;
      this.dirY = uy;
      this.stickMag = this.shaped.m;
    } else {
      this.dirX = this.dirY = this.stickMag = 0;
    }
    const travel = d > 0 ? Math.min(d, r * 1.12) / d : 0;
    this.placeStick(this.stickCx, this.stickCy, dx * travel, dy * travel, false);
  }

  private readonly onMove = (e: TouchEvent): void => {
    if (e.cancelable) e.preventDefault();
    if (!this.enabled) return;
    const ch = e.changedTouches;
    for (let i = 0; i < ch.length; i++) {
      const tch = ch[i];
      const id = tch.identifier;
      const x = tch.clientX - this.ox;
      const y = tch.clientY - this.oy;
      if (id === this.stickId) {
        this.updateStick(x, y);
        continue;
      }
      if (id === this.swapId && this.radialOpen) {
        this.updateRadial(x, y);
        continue;
      }
      const a = this.aims.get(id);
      if (a) {
        if (id === this.lookId) this.sink.touchLookPx(x - a.x, y - a.y);
        a.x = x;
        a.y = y;
      }
    }
  };

  private readonly onEnd = (e: TouchEvent): void => {
    if (e.cancelable) e.preventDefault();
    const ch = e.changedTouches;
    for (let i = 0; i < ch.length; i++) this.endTouch(ch[i].identifier);
  };

  private endTouch(id: number): void {
    if (id === this.stickId) {
      this.stickId = null;
      this.dirX = this.dirY = this.stickMag = this.stickDist = 0;
      this.sprintLock = false;
      this.placeStick(this.stickHome.x, this.stickHome.y, 0, 0, true);
    }
    const rec = this.presses.get(id);
    if (rec) {
      this.presses.delete(id);
      this.release(rec);
    }
    if (this.aims.delete(id) && this.lookId === id) {
      // Hand the view to the most recent remaining aim finger (positions are current: no jump).
      let next: number | null = null;
      for (const k of this.aims.keys()) next = k;
      this.lookId = next;
    }
  }

  dispose(): void {
    window.clearTimeout(this.swapTimer);
    this.root.removeEventListener('touchstart', this.onStart);
    this.root.removeEventListener('touchmove', this.onMove);
    this.root.removeEventListener('touchend', this.onEnd);
    this.root.removeEventListener('touchcancel', this.onEnd);
    window.removeEventListener('resize', this.relayout);
    window.removeEventListener('orientationchange', this.relayout);
    window.visualViewport?.removeEventListener('resize', this.relayout);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    window.removeEventListener('pagehide', this.onBlur);
    this.root.remove();
    this.probe.remove();
  }
}
