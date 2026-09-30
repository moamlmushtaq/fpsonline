// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — on-screen touch controls.
//
//  • Floating left joystick: appears where the thumb lands (left 45 % of the
//    screen). Pushing past the ring sprints (settings.autoSprint), otherwise a
//    double-tap on the left side locks sprint until the thumb lifts.
//  • Right side: drag anywhere free to aim (smoothed). FIRE also aims while
//    held and dragged.
//  • Buttons: FIRE, ADS (toggle), JUMP, CROUCH/SLIDE (toggle; a tap while
//    sprinting slides), RELOAD, SWAP, THROW, INTERACT and a small PAUSE.
//    Positions come from settings.touchLayout (normalised inside the
//    safe-area) with DEFAULT_TOUCH_LAYOUT as fallback; opacity from settings.
//  • Multi-touch by Touch.identifier; page scroll/zoom/gestures suppressed.
// Look: thin warm off-white rings, translucent warm-dark fills, dial ticks.
// ─────────────────────────────────────────────────────────────────────────────

import type { Action, Settings } from '../contracts';
import { t } from '../ui/i18n';

export type TouchButtonId = 'fire' | 'ads' | 'jump' | 'crouch' | 'reload' | 'swap' | 'throw' | 'interact' | 'pause';

export interface TouchButtonDef {
  id: TouchButtonId;
  action: Action;
  /** Diameter in CSS px at scale 1 (all ≥ 48 px touch targets). */
  size: number;
  mode: 'hold' | 'toggle';
  /** i18n key for the accessible label (English fallback below). */
  labelKey: string;
  label: string;
}

export const TOUCH_BUTTONS: readonly TouchButtonDef[] = [
  { id: 'fire', action: 'fire', size: 88, mode: 'hold', labelKey: 'touch.fire', label: 'Fire' },
  { id: 'ads', action: 'ads', size: 60, mode: 'toggle', labelKey: 'touch.ads', label: 'Aim' },
  { id: 'jump', action: 'jump', size: 64, mode: 'hold', labelKey: 'touch.jump', label: 'Jump' },
  { id: 'crouch', action: 'crouch', size: 58, mode: 'toggle', labelKey: 'touch.crouch', label: 'Crouch / slide' },
  { id: 'reload', action: 'reload', size: 52, mode: 'hold', labelKey: 'touch.reload', label: 'Reload' },
  { id: 'swap', action: 'nextWeapon', size: 52, mode: 'hold', labelKey: 'touch.swap', label: 'Swap weapon' },
  { id: 'throw', action: 'throw', size: 52, mode: 'hold', labelKey: 'touch.throw', label: 'Throw' },
  { id: 'interact', action: 'interact', size: 52, mode: 'hold', labelKey: 'touch.interact', label: 'Interact' },
  { id: 'pause', action: 'pause', size: 48, mode: 'hold', labelKey: 'touch.pause', label: 'Pause' },
];

/**
 * Default layout (normalised 0..1 inside the safe area; s = scale). 'stick' is
 * where the idle joystick hint rests. Tuned for landscape phones (≈ 19.5:9)
 * and still comfortable on tablets.
 */
export const DEFAULT_TOUCH_LAYOUT: Readonly<Record<string, { x: number; y: number; s: number }>> = {
  fire: { x: 0.86, y: 0.64, s: 1 },
  ads: { x: 0.955, y: 0.42, s: 1 },
  jump: { x: 0.945, y: 0.85, s: 1 },
  crouch: { x: 0.815, y: 0.89, s: 1 },
  reload: { x: 0.725, y: 0.7, s: 1 },
  swap: { x: 0.9, y: 0.21, s: 1 },
  throw: { x: 0.79, y: 0.4, s: 1 },
  interact: { x: 0.675, y: 0.47, s: 1 },
  // Below the vitals (touch HUD puts health top-left), above the thumb's joystick zone.
  pause: { x: 0.035, y: 0.31, s: 1 },
  stick: { x: 0.17, y: 0.68, s: 1 },
};

const ICONS: Record<TouchButtonId, string> = {
  fire: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  ads: '<circle cx="12" cy="12" r="8"/><path d="M12 6.5v3.2M12 14.3v3.2M6.5 12h3.2M14.3 12h3.2"/><circle cx="12" cy="12" r="0.9" fill="currentColor"/>',
  jump: '<path d="M6 14l6-6 6 6M6 19l6-6 6 6"/>',
  crouch: '<path d="M6 6l6 6 6-6M5 18h14"/>',
  reload: '<path d="M18.5 9A7 7 0 1 0 19 13"/><path d="M19 4.5V9h-4.5"/>',
  swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  throw: '<rect x="9" y="11" width="6" height="9" rx="1.6"/><path d="M10.5 11V9h3v2M6 7c2-3 7-4 11-1"/><path d="M17 3.5V6h-2.5"/>',
  interact: '<path d="M12 4v10M8 10l4 4 4-4"/><rect x="5" y="16" width="14" height="4" rx="1.2"/>',
  pause: '<path d="M9.5 6.5v11M14.5 6.5v11"/>',
};

const CSS = `
.hf-touch{position:absolute;inset:0;z-index:25;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;overflow:hidden;contain:strict}
.hf-touch .b{position:absolute;left:0;top:0;border-radius:50%;box-sizing:border-box;border:1.5px solid rgba(243,236,224,.72);background:radial-gradient(circle at 50% 38%,rgba(52,47,42,.44),rgba(24,22,20,.58));box-shadow:inset 0 0 0 5px rgba(243,236,224,.05),0 3px 14px rgba(0,0,0,.22);display:grid;place-items:center;color:#f3ece0;transition:transform 140ms cubic-bezier(.2,.8,.2,1),background-color 140ms,border-color 140ms;will-change:transform}
.hf-touch .b svg{width:44%;height:44%;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;overflow:visible}
.hf-touch .b.on{background:radial-gradient(circle at 50% 38%,rgba(243,236,224,.34),rgba(243,236,224,.14));border-color:#fffaf0}
.hf-touch .b.latched{border-color:#f0b35b;color:#f7d49b;box-shadow:inset 0 0 0 5px rgba(240,179,91,.12),0 0 16px rgba(240,179,91,.25)}
.hf-touch .b .ticks{position:absolute;inset:-7px;width:calc(100% + 14px);height:calc(100% + 14px);stroke:rgba(243,236,224,.5);stroke-width:1.2}
.hf-touch .stick{position:absolute;left:0;top:0;border-radius:50%;border:1.5px solid rgba(243,236,224,.55);background:radial-gradient(circle,rgba(24,22,20,.12),rgba(24,22,20,.38));box-sizing:border-box;pointer-events:none;transition:opacity 180ms}
.hf-touch .stick svg{position:absolute;inset:-9px;width:calc(100% + 18px);height:calc(100% + 18px);stroke:rgba(243,236,224,.45);stroke-width:1.2;fill:none}
.hf-touch .stick.sprint{border-color:#f0b35b}
.hf-touch .stick.sprint svg{stroke:rgba(240,179,91,.8)}
.hf-touch .knob{position:absolute;left:0;top:0;border-radius:50%;background:radial-gradient(circle at 50% 38%,rgba(243,236,224,.55),rgba(243,236,224,.22));border:1.5px solid rgba(255,250,240,.85);box-sizing:border-box;pointer-events:none}
.hf-touch .stick.idle{opacity:.35}
`;

function ticksSvg(n: number, inner: number, outer: number, major = 4): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r0 = i % (n / major) === 0 ? inner - 3 : inner;
    d += `M${50 + Math.cos(a) * r0} ${50 + Math.sin(a) * r0}L${50 + Math.cos(a) * outer} ${50 + Math.sin(a) * outer}`;
  }
  return `<svg class="ticks" viewBox="0 0 100 100"><path d="${d}"/></svg>`;
}

interface ButtonView {
  def: TouchButtonDef;
  el: HTMLDivElement;
  x: number;
  y: number;
  r: number;
  pressed: number;
  latched: boolean;
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
  private visible = false;
  private enabled = false;
  private layoutKey: unknown = null;
  private w = 1;
  private h = 1;
  private safe = { l: 0, r: 0, t: 0, b: 0 };
  private stickHome = { x: 0, y: 0, r: 62 };
  // Touch tracking.
  private stickId: number | null = null;
  private stickCx = 0;
  private stickCy = 0;
  private stickVx = 0;
  private stickVy = 0;
  private stickDist = 0;
  private sprintLock = false;
  private lastLeftTap = 0;
  private readonly aims = new Map<number, { x: number; y: number; btn: ButtonView | null }>();
  private readonly btnTouches = new Map<number, ButtonView>();
  private crouchPulse = 0;
  private readonly probe: HTMLDivElement;

  constructor(private readonly parent: HTMLElement, private readonly sink: TouchSink) {
    if (!document.getElementById('hf-touch-css')) {
      const st = document.createElement('style');
      st.id = 'hf-touch-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.root = document.createElement('div');
    this.root.className = 'hf-touch';
    this.root.style.display = 'none';
    this.root.setAttribute('aria-hidden', 'false');
    this.stick = document.createElement('div');
    this.stick.className = 'stick idle';
    this.stick.innerHTML = ticksSvg(36, 45, 49, 4).replace('class="ticks"', '');
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.root.append(this.stick, this.knob);
    for (const def of TOUCH_BUTTONS) {
      const el = document.createElement('div');
      el.className = `b b-${def.id}`;
      el.setAttribute('role', 'button');
      const label = this.label(def);
      el.setAttribute('aria-label', label);
      el.title = label;
      el.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[def.id]}</svg>${def.id === 'fire' ? ticksSvg(48, 44, 49, 4) : ''}`;
      this.root.appendChild(el);
      this.buttons.push({ def, el, x: 0, y: 0, r: def.size / 2, pressed: 0, latched: false });
    }
    // Safe-area probe (env() insets resolve through computed padding).
    this.probe = document.createElement('div');
    this.probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(this.probe);
    parent.appendChild(this.root);
    const opt: AddEventListenerOptions = { passive: false };
    this.root.addEventListener('touchstart', this.onStart, opt);
    this.root.addEventListener('touchmove', this.onMove, opt);
    this.root.addEventListener('touchend', this.onEnd, opt);
    this.root.addEventListener('touchcancel', this.onEnd, opt);
    this.root.addEventListener('gesturestart', this.prevent as EventListener, opt);
    this.root.addEventListener('contextmenu', this.prevent);
    window.addEventListener('resize', this.relayout);
  }

  private label(def: TouchButtonDef): string {
    const s = t(def.labelKey);
    return s && s !== def.labelKey ? s : def.label;
  }

  private readonly prevent = (e: Event): void => e.preventDefault();

  // ── Visibility / layout ──────────────────────────────────────────────────

  /** Shown only while `enabled` (gameplay) and the device is touch. */
  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.style.display = v ? 'block' : 'none';
    if (v) this.relayout();
    else this.releaseAll();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.releaseAll();
  }

  private readonly relayout = (): void => {
    if (!this.visible) return;
    const rect = this.root.getBoundingClientRect();
    this.w = Math.max(1, rect.width || window.innerWidth);
    this.h = Math.max(1, rect.height || window.innerHeight);
    const cs = getComputedStyle(this.probe);
    this.safe = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    this.applyLayout(true);
  };

  private applyLayout(force = false): void {
    const s = this.sink.settings();
    if (!force && s.touchLayout === this.layoutKey) return;
    this.layoutKey = s.touchLayout;
    this.root.style.opacity = String(Math.max(0.15, Math.min(1, s.touchOpacity)));
    const sw = this.w - this.safe.l - this.safe.r;
    const sh = this.h - this.safe.t - this.safe.b;
    // Small screens get slightly larger relative targets.
    const base = Math.max(0.9, Math.min(1.25, Math.min(this.w, this.h) / 400));
    const pos = (id: string): { x: number; y: number; s: number } => s.touchLayout[id] ?? DEFAULT_TOUCH_LAYOUT[id] ?? { x: 0.5, y: 0.5, s: 1 };
    for (const b of this.buttons) {
      const p = pos(b.def.id);
      const size = Math.max(48, b.def.size * base * p.s);
      b.r = size / 2;
      b.x = this.safe.l + p.x * sw;
      b.y = this.safe.t + p.y * sh;
      // Keep every target fully on screen.
      b.x = Math.max(this.safe.l + b.r + 4, Math.min(this.w - this.safe.r - b.r - 4, b.x));
      b.y = Math.max(this.safe.t + b.r + 4, Math.min(this.h - this.safe.b - b.r - 4, b.y));
      b.el.style.width = b.el.style.height = `${size}px`;
      b.el.style.setProperty('--s', '1');
      this.paintButton(b);
    }
    const sp = pos('stick');
    const r = Math.max(52, 62 * base * sp.s);
    this.stickHome = { x: this.safe.l + sp.x * sw, y: this.safe.t + sp.y * sh, r };
    this.stick.style.width = this.stick.style.height = `${r * 2}px`;
    const kr = r * 0.46;
    this.knob.style.width = this.knob.style.height = `${kr * 2}px`;
    if (this.stickId === null) this.placeStick(this.stickHome.x, this.stickHome.y, 0, 0, true);
  }

  private paintButton(b: ButtonView): void {
    // Position via left/top (no transition); only the press scale animates.
    b.el.style.left = `${b.x - b.r}px`;
    b.el.style.top = `${b.y - b.r}px`;
    b.el.style.transform = b.pressed > 0 ? 'scale(0.94)' : 'scale(1)';
    b.el.classList.toggle('on', b.pressed > 0);
    b.el.classList.toggle('latched', b.latched);
  }

  private placeStick(cx: number, cy: number, kx: number, ky: number, idle: boolean): void {
    const r = this.stickHome.r;
    this.stick.style.transform = `translate(${cx - r}px, ${cy - r}px)`;
    const kr = r * 0.46;
    this.knob.style.transform = `translate(${cx + kx - kr}px, ${cy + ky - kr}px)`;
    this.stick.classList.toggle('idle', idle);
    this.knob.style.opacity = idle ? '0.35' : '1';
  }

  // ── State exposed to the hub ─────────────────────────────────────────────

  /** Movement axes (x right, y forward), magnitude ≤ 1. */
  move(): { x: number; y: number } {
    return { x: this.stickVx, y: -this.stickVy };
  }

  get sprinting(): boolean {
    if (this.stickId === null) return false;
    const fwd = -this.stickVy > 0.55;
    if (this.sprintLock) return fwd;
    return this.sink.settings().autoSprint && this.stickDist > 1.12 && fwd;
  }

  get joystickActive(): boolean {
    return this.stickId !== null;
  }

  /** Per-frame upkeep (timed crouch pulse, layout changes, sprint ring tint). */
  update(dt: number): void {
    if (!this.visible) return;
    this.applyLayout();
    if (this.crouchPulse > 0) {
      this.crouchPulse -= dt;
      if (this.crouchPulse <= 0) this.sink.touchAction('crouch', this.buttonById('crouch')?.latched ?? false);
    }
    this.stick.classList.toggle('sprint', this.sprinting);
  }

  private buttonById(id: TouchButtonId): ButtonView | undefined {
    return this.buttons.find((b) => b.def.id === id);
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
    this.btnTouches.clear();
    this.aims.clear();
    this.stickId = null;
    this.stickVx = this.stickVy = this.stickDist = 0;
    this.sprintLock = false;
    this.crouchPulse = 0;
    if (this.visible) this.placeStick(this.stickHome.x, this.stickHome.y, 0, 0, true);
  }

  // ── Touch handling ───────────────────────────────────────────────────────

  private hit(x: number, y: number): ButtonView | null {
    let best: ButtonView | null = null;
    let bestD = Infinity;
    for (const b of this.buttons) {
      const d = Math.hypot(x - b.x, y - b.y);
      const reach = Math.max(b.r * 1.18, 30);
      if (d < reach && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  private local(tch: Touch): { x: number; y: number } {
    const rect = this.root.getBoundingClientRect();
    return { x: tch.clientX - rect.left, y: tch.clientY - rect.top };
  }

  private press(b: ButtonView, id: number): void {
    this.btnTouches.set(id, b);
    b.pressed++;
    if (b.def.mode === 'toggle') {
      if (b.def.id === 'crouch' && this.sprinting) {
        // Tap while sprinting = slide: a short crouch press, no latch.
        this.sink.touchAction('crouch', true);
        this.crouchPulse = 0.28;
      } else {
        b.latched = !b.latched;
        this.sink.touchAction(b.def.action, b.latched);
      }
    } else {
      this.sink.touchAction(b.def.action, true);
      if (b.def.id === 'jump') {
        const c = this.buttonById('crouch');
        if (c?.latched) {
          c.latched = false;
          this.sink.touchAction('crouch', false);
          this.paintButton(c);
        }
      }
    }
    this.paintButton(b);
  }

  private release(b: ButtonView): void {
    b.pressed = Math.max(0, b.pressed - 1);
    if (b.def.mode === 'hold' && b.pressed === 0) this.sink.touchAction(b.def.action, false);
    this.paintButton(b);
  }

  private readonly onStart = (e: TouchEvent): void => {
    e.preventDefault();
    this.sink.noteTouch();
    if (!this.enabled) return;
    for (const tch of Array.from(e.changedTouches)) {
      const p = this.local(tch);
      const b = this.hit(p.x, p.y);
      if (b) {
        this.press(b, tch.identifier);
        if (b.def.id === 'fire') this.aims.set(tch.identifier, { x: p.x, y: p.y, btn: b });
        continue;
      }
      if (p.x < this.w * 0.45 && this.stickId === null) {
        const now = performance.now();
        if (now - this.lastLeftTap < 320) this.sprintLock = true;
        this.lastLeftTap = now;
        const r = this.stickHome.r;
        this.stickId = tch.identifier;
        this.stickCx = Math.max(this.safe.l + r + 6, Math.min(this.w * 0.45, p.x));
        this.stickCy = Math.max(this.safe.t + r + 6, Math.min(this.h - this.safe.b - r - 6, p.y));
        this.updateStick(p.x, p.y);
        continue;
      }
      if (p.x >= this.w * 0.3) this.aims.set(tch.identifier, { x: p.x, y: p.y, btn: null });
    }
  };

  private updateStick(x: number, y: number): void {
    const r = this.stickHome.r;
    const dx = x - this.stickCx;
    const dy = y - this.stickCy;
    const d = Math.hypot(dx, dy);
    this.stickDist = d / r;
    const k = d > 0 ? Math.min(d, r) / d : 0;
    this.stickVx = (dx * k) / r;
    this.stickVy = (dy * k) / r;
    // Small inner deadzone so a resting thumb doesn't creep.
    const m = Math.hypot(this.stickVx, this.stickVy);
    if (m < 0.08) this.stickVx = this.stickVy = 0;
    const travel = Math.min(d, r * 1.25) / (d || 1);
    this.placeStick(this.stickCx, this.stickCy, dx * travel, dy * travel, false);
  }

  private readonly onMove = (e: TouchEvent): void => {
    e.preventDefault();
    if (!this.enabled) return;
    for (const tch of Array.from(e.changedTouches)) {
      const p = this.local(tch);
      if (tch.identifier === this.stickId) {
        this.updateStick(p.x, p.y);
        continue;
      }
      const a = this.aims.get(tch.identifier);
      if (a) {
        this.sink.touchLookPx(p.x - a.x, p.y - a.y);
        a.x = p.x;
        a.y = p.y;
      }
    }
  };

  private readonly onEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (const tch of Array.from(e.changedTouches)) {
      const id = tch.identifier;
      if (id === this.stickId) {
        this.stickId = null;
        this.stickVx = this.stickVy = this.stickDist = 0;
        this.sprintLock = false;
        this.placeStick(this.stickHome.x, this.stickHome.y, 0, 0, true);
      }
      const b = this.btnTouches.get(id);
      if (b) {
        this.btnTouches.delete(id);
        this.release(b);
      }
      this.aims.delete(id);
    }
  };

  dispose(): void {
    this.root.removeEventListener('touchstart', this.onStart);
    this.root.removeEventListener('touchmove', this.onMove);
    this.root.removeEventListener('touchend', this.onEnd);
    this.root.removeEventListener('touchcancel', this.onEnd);
    window.removeEventListener('resize', this.relayout);
    this.root.remove();
    this.probe.remove();
  }
}
