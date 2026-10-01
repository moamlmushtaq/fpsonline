// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — touch layout editor (Settings → Controls → Customize layout).
//
// A full-screen editor over a blurred, in-style backdrop (the live match or
// the menu scene shows through, softly). Every on-screen control — the ten
// buttons and the joystick's home — is drawn exactly as in play (shared
// visuals from input/touch-layout.ts) and can be:
//   • dragged anywhere inside the safe area, with snap guides to the other
//     controls' centres and the screen's centre lines;
//   • resized by pinching (two fingers), the − / + chip, the mouse wheel or
//     the keyboard (+/−; arrows nudge, Shift = bigger steps);
//   • checked: overlapping controls or controls over the HUD glow red, and
//     ghost boxes show where the HUD lives.
// Reset restores the default layout; Save writes settings.touchLayout (and
// the opacity) — Cancel / Escape / gamepad B discard. Works in RTL (the
// toolbar mirrors; control positions are spatial and never mirror) and is
// safe-area aware (positions are stored normalised to the safe area).
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../app';
import { button, captureState, h, slider } from './components';
import { i18n, setText, t } from './i18n';
import {
  buttonMarkup,
  clampToSafe,
  controlLabel,
  controlRadius,
  baseScale,
  createSafeProbe,
  ensureTouchCss,
  LAYOUT_IDS,
  readSafe,
  resolveLayout,
  stickMarkup,
  toStored,
  type SafeInsets,
  type TouchButtonId,
} from '../input/touch-layout';

const SNAP_PX = 8;

const CSS = `
.hf-tle{position:fixed;inset:0;z-index:1000;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;
  background:radial-gradient(120% 90% at 50% 125%,rgba(150,86,54,.42),rgba(20,18,16,.2) 62%),linear-gradient(180deg,rgba(20,18,17,.66),rgba(24,20,19,.56));
  backdrop-filter:blur(20px) saturate(.8);-webkit-backdrop-filter:blur(20px) saturate(.8);opacity:0;transition:opacity 260ms cubic-bezier(.2,.8,.2,1);color:var(--c-text,#f3ece0);font-family:var(--f-ui,'Space Grotesk',system-ui,sans-serif)}
body.q-low .hf-tle{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(22,20,18,.9)}
.hf-tle.is-vis{opacity:1}
.hf-tle__zone{position:absolute;top:0;bottom:0;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 10px);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:rgba(243,236,224,.36)}
html[lang='ar'] .hf-tle__zone{letter-spacing:0;text-transform:none;font-size:12px}
.hf-tle__zone--stick{left:0;background:linear-gradient(90deg,rgba(243,236,224,.035),rgba(243,236,224,0));border-right:1px dashed rgba(243,236,224,.14)}
.hf-tle__zone--aim{right:0}
.hf-tle__zone span{padding:0 12px;max-width:90%;text-align:center}
.hf-tle__ghost{position:absolute;border:1px dashed rgba(243,236,224,.28);border-radius:10px;background:rgba(243,236,224,.04);pointer-events:none;display:grid;place-items:center;font:500 10px/1 var(--f-mono,'JetBrains Mono',monospace);letter-spacing:.16em;color:rgba(243,236,224,.38)}
.hf-tle__stage{position:absolute;inset:0}
.hf-tle__stage .b,.hf-tle__stage .stick{cursor:grab;pointer-events:auto;outline:none}
.hf-tle__stage .b,.hf-tle__stage .stick,.hf-tle__stage .knob{transition:border-color 140ms,box-shadow 140ms}
.hf-tle__stage .b:focus-visible,.hf-tle__stage .stick:focus-visible{box-shadow:0 0 0 2px var(--c-accent,#f0b35b)}
.hf-tle__stage .stick{background:radial-gradient(circle,rgba(24,22,20,.18),rgba(24,22,20,.42))}
.hf-tle__stage .stick .ring{opacity:.9}
.hf-tle__stage .knob{pointer-events:none}
.hf-tle__stage .sel{border-color:var(--c-accent,#f0b35b)!important;box-shadow:0 0 0 1px rgba(240,179,91,.5),0 0 22px rgba(240,179,91,.35)!important}
.hf-tle__stage .sel.drag{cursor:grabbing}
.hf-tle__stage .bad{border-color:var(--c-danger,#ff5a5f)!important;box-shadow:0 0 0 1px rgba(255,90,95,.55),0 0 18px rgba(255,90,95,.35)!important}
.hf-tle__g{position:absolute;pointer-events:none;background:rgba(240,179,91,.75);opacity:0;transition:opacity 90ms}
.hf-tle__g.on{opacity:1}
.hf-tle__g--v{top:0;bottom:0;width:1px;left:0}
.hf-tle__g--h{left:0;right:0;height:1px;top:0}
.hf-tle__bar{position:absolute;top:calc(env(safe-area-inset-top,0px) + 8px);left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 16px - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px));box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:7px 8px 7px 14px;border-radius:14px;
  background:linear-gradient(180deg,rgba(30,27,24,.86),rgba(24,22,20,.78));border:1px solid rgba(243,236,224,.18);box-shadow:0 12px 40px -18px rgba(0,0,0,.7);transition:opacity 160ms}
.hf-tle.dragging .hf-tle__bar{opacity:.18;pointer-events:none}
.hf-tle__titles{flex:0 1 auto;min-width:8rem;max-width:22rem}
.hf-tle__eyebrow{font:500 10px/1.2 var(--f-mono,'JetBrains Mono',monospace);letter-spacing:.2em;text-transform:uppercase;color:var(--c-accent,#f0b35b)}
html[lang='ar'] .hf-tle__eyebrow{letter-spacing:0;font-family:var(--f-arabic,'IBM Plex Sans Arabic',sans-serif);font-size:11px}
.hf-tle__title{font-size:15px;font-weight:700;line-height:1.25}
.hf-tle__hint{font-size:11.5px;line-height:1.35;color:rgba(243,236,224,.62);margin-top:1px}
.hf-tle__hint.warn{color:#ff9a9d}
.hf-tle__op{display:flex;align-items:center;gap:8px;flex:0 0 auto;width:15rem;max-width:34vw;font-size:11px;color:rgba(243,236,224,.62)}
.hf-tle__op .slider{flex:1;min-width:0;gap:6px}
.hf-tle__op .slider__value{min-width:3.2rem;flex:0 0 auto}
.hf-tle__op .slider__input{min-width:0;width:100%}
.hf-tle__op>span{flex:0 0 auto}
.hf-tle__acts{display:flex;gap:6px;flex-wrap:nowrap;justify-content:flex-end;margin-inline-start:auto}
.hf-tle__acts .btn{min-height:40px}
.hf-tle__chip{position:absolute;left:0;top:0;display:none;align-items:center;gap:4px;padding:4px;border-radius:999px;background:rgba(24,22,20,.9);border:1px solid rgba(240,179,91,.45);box-shadow:0 8px 24px -10px rgba(0,0,0,.7);white-space:nowrap}
.hf-tle__chip.on{display:inline-flex}
.hf-tle__chip button{width:48px;height:48px;border-radius:50%;border:1px solid rgba(243,236,224,.3);background:rgba(243,236,224,.06);color:var(--c-text,#f3ece0);font:600 20px/1 var(--f-mono,'JetBrains Mono',monospace);display:grid;place-items:center;padding:0;cursor:pointer;touch-action:manipulation;transition:transform 120ms cubic-bezier(.2,.8,.2,1),background-color 120ms}
.hf-tle__chip button:active{transform:scale(.94);background:rgba(240,179,91,.2)}
.hf-tle__chip .lbl{display:flex;flex-direction:column;align-items:center;padding:0 8px;min-width:4.5rem}
.hf-tle__chip .lbl b{font:600 13px/1.1 var(--f-mono,'JetBrains Mono',monospace);color:var(--c-accent-hi,#f8cc80)}
.hf-tle__chip .lbl i{font-style:normal;font-size:10px;color:rgba(243,236,224,.6);max-width:8rem;overflow:hidden;text-overflow:ellipsis}
@media (max-height:430px){.hf-tle__hint{display:none}.hf-tle__bar{padding:5px 6px 5px 12px}.hf-tle__title{font-size:13px}}
@media (max-width:760px){.hf-tle__acts .btn--ghost .btn__label{display:none}.hf-tle__eyebrow{display:none}}
`;

interface Item {
  id: string;
  el: HTMLElement;
  knob?: HTMLElement;
  x: number;
  y: number;
  s: number;
  r: number;
}

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

let open: TouchLayoutEditor | null = null;

/** Opens the editor (no-op when already open). Installed as App.openTouchLayoutEditor. */
export function openTouchLayoutEditor(app: App): void {
  if (open) return;
  open = new TouchLayoutEditor(app, () => (open = null));
}

class TouchLayoutEditor {
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly ghosts: HTMLDivElement;
  private readonly zoneStick: HTMLDivElement;
  private readonly zoneAim: HTMLDivElement;
  private readonly gv: HTMLDivElement;
  private readonly gh: HTMLDivElement;
  private readonly chip: HTMLDivElement;
  private readonly chipPct: HTMLElement;
  private readonly chipName: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly probe: HTMLDivElement;
  private readonly items = new Map<string, Item>();
  private hud: Box[] = [];
  private w = 1;
  private h = 1;
  private base = 1;
  private safe: SafeInsets = { l: 0, r: 0, t: 0, b: 0 };
  private selected: Item | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private drag: { item: Item; id: number; ox: number; oy: number } | null = null;
  private pinch: { item: Item; d0: number; s0: number } | null = null;
  private opacity: number;
  private hintTimer = 0;
  private readonly offLang: () => void;
  private closing = false;

  constructor(private readonly app: App, private readonly onClosed: () => void) {
    ensureTouchCss();
    if (!document.getElementById('hf-tle-css')) {
      const st = document.createElement('style');
      st.id = 'hf-tle-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const s = app.settings.value;
    this.opacity = s.touchOpacity;
    this.root = h('div', { class: 'hf-tle', attrs: { role: 'dialog', 'aria-modal': 'true' } });
    this.zoneStick = h('div', { class: 'hf-tle__zone hf-tle__zone--stick' }, setText(h('span'), 'controls.editor.stickZone'));
    this.zoneAim = h('div', { class: 'hf-tle__zone hf-tle__zone--aim' }, setText(h('span'), 'controls.editor.aimZone'));
    this.ghosts = h('div');
    this.stage = h('div', { class: 'hf-tle__stage hf-tc' });
    this.gv = h('div', { class: 'hf-tle__g hf-tle__g--v' });
    this.gh = h('div', { class: 'hf-tle__g hf-tle__g--h' });

    // Toolbar.
    this.hint = h('div', { class: 'hf-tle__hint' });
    const titles = h(
      'div',
      { class: 'hf-tle__titles' },
      setText(h('div', { class: 'hf-tle__eyebrow' }), 'controls.editor.eyebrow'),
      setText(h('div', { class: 'hf-tle__title', attrs: { id: 'hf-tle-title' } }), 'controls.editor.title'),
      this.hint,
    );
    this.root.setAttribute('aria-labelledby', 'hf-tle-title');
    const op = slider({
      min: 0.2,
      max: 1,
      step: 0.05,
      value: this.opacity,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => this.setOpacity(v),
      label: 'controls.editor.opacity',
    });
    const opWrap = h('label', { class: 'hf-tle__op' }, setText(h('span'), 'controls.editor.opacity'), op.el);
    const sfx = (k: 'click' | 'confirm' | 'back') => {
      try {
        app.audio.ui(k);
      } catch {
        /* audio locked */
      }
    };
    const reset = button({ label: 'controls.editor.reset', icon: 'refresh', size: 'sm', variant: 'ghost', onClick: () => (sfx('click'), this.reset()) });
    const cancel = button({ label: 'controls.editor.cancel', size: 'sm', onClick: () => (sfx('back'), this.close(false)) });
    const save = button({ label: 'controls.editor.save', icon: 'check', size: 'sm', variant: 'primary', onClick: () => (sfx('confirm'), this.close(true)) });
    const bar = h('div', { class: 'hf-tle__bar' }, titles, opWrap, h('div', { class: 'hf-tle__acts' }, reset, cancel, save));

    // Size chip for the selected control.
    this.chipPct = h('b', { attrs: { dir: 'ltr' } });
    this.chipName = h('i');
    const minus = h('button', { attrs: { type: 'button' }, text: '−' });
    const plus = h('button', { attrs: { type: 'button' }, text: '+' });
    minus.addEventListener('click', () => this.resizeSelected(-0.1));
    plus.addEventListener('click', () => this.resizeSelected(0.1));
    this.chip = h('div', { class: 'hf-tle__chip', attrs: { dir: 'ltr' } }, minus, h('div', { class: 'lbl' }, this.chipPct, this.chipName), plus);
    for (const [b, k] of [
      [minus, 'controls.editor.smaller'],
      [plus, 'controls.editor.larger'],
    ] as const) {
      b.setAttribute('aria-label', t(k));
      b.title = t(k);
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    this.root.append(this.zoneStick, this.zoneAim, this.ghosts, this.stage, this.gv, this.gh, this.chip, bar);
    this.probe = createSafeProbe();
    this.buildItems();
    document.body.appendChild(this.root);
    this.measure();
    this.load(s.touchLayout);
    this.setOpacity(this.opacity);
    this.setHint();

    this.stage.addEventListener('pointerdown', this.onDown);
    this.stage.addEventListener('pointermove', this.onMoveP);
    this.stage.addEventListener('pointerup', this.onUp);
    this.stage.addEventListener('pointercancel', this.onUp);
    this.stage.addEventListener('lostpointercapture', this.onUp);
    this.stage.addEventListener('wheel', this.onWheel, { passive: false });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('touchmove', (e) => e.cancelable && e.preventDefault(), { passive: false });
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onResize);
    this.offLang = i18n.onChange(() => {
      this.relabel();
      this.setHint();
    });
    // While open, the UI manager must not treat Escape / gamepad B as "back" for the screen underneath.
    captureState.active = true;
    requestAnimationFrame(() => this.root.classList.add('is-vis'));
    requestAnimationFrame(() => save.focus({ preventScroll: true }));
  }

  // ── Build / layout ───────────────────────────────────────────────────────

  private buildItems(): void {
    for (const id of LAYOUT_IDS) {
      let el: HTMLElement;
      let knob: HTMLElement | undefined;
      if (id === 'stick') {
        el = h('div', { class: 'stick' });
        el.innerHTML = stickMarkup();
        knob = h('div', { class: 'knob' });
      } else {
        el = h('div', { class: `b b-${id}` });
        el.innerHTML = buttonMarkup(id as TouchButtonId);
      }
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.dataset.id = id;
      el.addEventListener('focus', () => this.select(this.items.get(id) ?? null));
      this.stage.append(el);
      if (knob) this.stage.append(knob);
      this.items.set(id, { id, el, knob, x: 0, y: 0, s: 1, r: 24 });
    }
    this.relabel();
  }

  private relabel(): void {
    for (const it of this.items.values()) it.el.setAttribute('aria-label', controlLabel(it.id));
    if (this.selected) this.chipName.textContent = controlLabel(this.selected.id);
  }

  private measure(): void {
    this.w = Math.max(1, window.innerWidth);
    this.h = Math.max(1, window.innerHeight);
    this.base = baseScale(this.w, this.h);
    this.safe = readSafe(this.probe);
    this.zoneStick.style.width = `${Math.round(this.w * 0.42)}px`;
    this.zoneAim.style.width = `${Math.round(this.w * 0.58)}px`;
    this.hud = this.measureHud();
    this.ghosts.replaceChildren();
    for (const b of this.hud) {
      const g = h('div', { class: 'hf-tle__ghost' });
      setText(g, 'controls.editor.hud');
      g.style.cssText = `left:${b.l}px;top:${b.t}px;width:${b.r - b.l}px;height:${b.b - b.t}px`;
      this.ghosts.append(g);
    }
  }

  /**
   * HUD footprint for overlap checks: the real HUD when it is on screen
   * (editing from a match), else the touch HUD's layout estimated from its
   * em-based CSS (vitals and ammo at the top corners, score + compass centre).
   */
  private measureHud(): Box[] {
    const sel = ['.hud .hud-health', '.hud .hud-ammo', '.hud .hud-top', '.hud .hud-compass'];
    const real: Box[] = [];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && document.body.classList.contains('touch-ui')) real.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    if (real.length >= 2) return real;
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 12;
    const scale = this.app.settings.value.hudScale || 1;
    const em = rootPx * (this.h <= 540 ? 0.92 : 1) * scale;
    const s = this.safe;
    const padX = Math.max(s.l + 1.4 * em, 1.4 * em);
    const padR = Math.max(s.r + 1.4 * em, 1.4 * em);
    const out: Box[] = [
      { l: padX, t: s.t + 2.4 * em, r: padX + 12 * em, b: s.t + 5.4 * em }, // health
      { l: this.w - padR - 11 * em, t: s.t + 0.8 * em, r: this.w - padR, b: s.t + 5.6 * em }, // ammo
      { l: this.w / 2 - 8 * em, t: s.t + 0.6 * em, r: this.w / 2 + 8 * em, b: s.t + 4.4 * em }, // compass + score
    ];
    return out;
  }

  private load(layout: Readonly<Record<string, { x: number; y: number; s: number }>>): void {
    const placed = resolveLayout(layout, this.w, this.h, this.safe);
    for (const it of this.items.values()) {
      const p = placed.get(it.id);
      if (!p) continue;
      it.x = p.x;
      it.y = p.y;
      it.s = p.s;
      it.r = p.r;
      this.paint(it);
    }
    this.validate();
  }

  private paint(it: Item): void {
    it.el.style.width = it.el.style.height = `${it.r * 2}px`;
    it.el.style.transform = `translate(${(it.x - it.r).toFixed(1)}px, ${(it.y - it.r).toFixed(1)}px)`;
    if (it.knob) {
      const kr = it.r * 0.46;
      it.knob.style.width = it.knob.style.height = `${kr * 2}px`;
      it.knob.style.transform = `translate(${(it.x - kr).toFixed(1)}px, ${(it.y - kr).toFixed(1)}px)`;
    }
    if (it === this.selected) this.placeChip();
  }

  private placeChip(): void {
    const it = this.selected;
    if (!it) {
      this.chip.classList.remove('on');
      return;
    }
    this.chip.classList.add('on');
    this.chipPct.textContent = `${Math.round(it.s * 100)}%`;
    this.chipName.textContent = controlLabel(it.id);
    const cw = this.chip.offsetWidth || 170;
    const ch = this.chip.offsetHeight || 52;
    let x = it.x - cw / 2;
    // Above the control, or below when there is no room (e.g. under the toolbar).
    let y = it.y - it.r - ch - 12;
    if (y < this.safe.t + 70) y = it.y + it.r + 12;
    if (y + ch > this.h - this.safe.b - 4) y = Math.max(this.safe.t + 4, it.y - ch / 2);
    x = Math.max(this.safe.l + 4, Math.min(this.w - this.safe.r - cw - 4, x));
    this.chip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  /** Flags controls that overlap each other or the HUD. */
  private validate(): boolean {
    let any = false;
    const list = [...this.items.values()];
    for (const a of list) {
      let bad = false;
      for (const b of list) {
        if (a === b) continue;
        // The joystick's home only needs clearance from buttons on its own ring.
        const need = a.r + b.r - 2;
        if (Math.hypot(a.x - b.x, a.y - b.y) < need) bad = true;
      }
      const hr = a.id === 'stick' ? a.r * 0.5 : a.r;
      for (const box of this.hud) {
        const cx = Math.max(box.l, Math.min(a.x, box.r));
        const cy = Math.max(box.t, Math.min(a.y, box.b));
        if (Math.hypot(a.x - cx, a.y - cy) < hr - 2) bad = true;
      }
      a.el.classList.toggle('bad', bad);
      any ||= bad;
    }
    this.setHint(any);
    return any;
  }

  private setHint(warn = false, flashKey?: string): void {
    window.clearTimeout(this.hintTimer);
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const key = flashKey ?? (warn ? 'controls.editor.overlap' : coarse ? 'controls.editor.hint' : 'controls.editor.hintDesktop');
    setText(this.hint, key);
    this.hint.classList.toggle('warn', warn && !flashKey);
    if (flashKey) this.hintTimer = window.setTimeout(() => this.validate(), 1800);
  }

  // ── Editing ──────────────────────────────────────────────────────────────

  private select(it: Item | null): void {
    if (this.selected === it) return;
    this.selected?.el.classList.remove('sel');
    this.selected = it;
    it?.el.classList.add('sel');
    this.placeChip();
  }

  private itemAt(x: number, y: number): Item | null {
    let best: Item | null = null;
    let bestD = Infinity;
    for (const it of this.items.values()) {
      const d = Math.hypot(x - it.x, y - it.y);
      if (d < Math.max(it.r * 1.05, 26) && d < bestD) {
        best = it;
        bestD = d;
      }
    }
    return best;
  }

  private moveTo(it: Item, x: number, y: number, snap: boolean): void {
    let gx: number | null = null;
    let gy: number | null = null;
    if (snap) {
      let bx = SNAP_PX + 1;
      let by = SNAP_PX + 1;
      const xs = [this.w / 2];
      const ys = [this.h / 2];
      for (const o of this.items.values()) {
        if (o === it) continue;
        xs.push(o.x);
        ys.push(o.y);
      }
      for (const cx of xs) {
        const d = Math.abs(x - cx);
        if (d < bx) {
          bx = d;
          gx = cx;
        }
      }
      for (const cy of ys) {
        const d = Math.abs(y - cy);
        if (d < by) {
          by = d;
          gy = cy;
        }
      }
      if (gx !== null) x = gx;
      if (gy !== null) y = gy;
    }
    const c = clampToSafe(x, y, it.r, this.w, this.h, this.safe);
    it.x = c.x;
    it.y = c.y;
    this.gv.classList.toggle('on', gx !== null && Math.abs(gx - it.x) < 0.5);
    this.gh.classList.toggle('on', gy !== null && Math.abs(gy - it.y) < 0.5);
    if (gx !== null) this.gv.style.transform = `translateX(${gx}px)`;
    if (gy !== null) this.gh.style.transform = `translateY(${gy}px)`;
    this.paint(it);
    this.validate();
  }

  private setScale(it: Item, s: number): void {
    it.s = Math.max(0.5, Math.min(2, s));
    it.r = controlRadius(it.id, it.s, this.base);
    const c = clampToSafe(it.x, it.y, it.r, this.w, this.h, this.safe);
    it.x = c.x;
    it.y = c.y;
    this.paint(it);
    this.validate();
  }

  private resizeSelected(d: number): void {
    const it = this.selected;
    if (!it) return;
    this.setScale(it, Math.round((it.s + d) * 20) / 20);
    try {
      this.app.audio.ui('toggle');
    } catch {
      /* ignore */
    }
  }

  private setOpacity(v: number): void {
    this.opacity = Math.max(0.2, Math.min(1, v));
    this.stage.style.opacity = String(Math.max(0.35, this.opacity));
  }

  private reset(): void {
    this.load({});
    this.select(null);
    this.setHint(false, 'controls.editor.resetDone');
  }

  // ── Pointer / keyboard ───────────────────────────────────────────────────

  private local(e: PointerEvent): { x: number; y: number } {
    return { x: e.clientX, y: e.clientY };
  }

  private readonly onDown = (e: PointerEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2 && (this.drag || this.selected)) {
      // Second finger: pinch-resize the dragged / selected control.
      const it = this.drag?.item ?? this.selected;
      const [a, b] = [...this.pointers.values()];
      if (it) this.pinch = { item: it, d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), s0: it.s };
      this.drag = null;
      this.gv.classList.remove('on');
      this.gh.classList.remove('on');
      return;
    }
    if (this.pointers.size > 2) return;
    const it = this.itemAt(p.x, p.y);
    if (!it) {
      this.select(null);
      return;
    }
    this.select(it);
    this.drag = { item: it, id: e.pointerId, ox: it.x - p.x, oy: it.y - p.y };
    it.el.classList.add('drag');
    this.root.classList.add('dragging');
    try {
      this.stage.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
  };

  private readonly onMoveP = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.setScale(this.pinch.item, this.pinch.s0 * (d / this.pinch.d0));
      return;
    }
    const dr = this.drag;
    if (dr && dr.id === e.pointerId) this.moveTo(dr.item, p.x + dr.ox, p.y + dr.oy, !e.altKey);
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pinch && this.pointers.size < 2) {
      this.pinch.item.s = Math.round(this.pinch.item.s * 20) / 20;
      this.setScale(this.pinch.item, this.pinch.item.s);
      this.pinch = null;
    }
    if (this.drag && this.drag.id === e.pointerId) {
      this.drag.item.el.classList.remove('drag');
      this.drag = null;
    }
    if (this.pointers.size === 0) {
      this.root.classList.remove('dragging');
      this.gv.classList.remove('on');
      this.gh.classList.remove('on');
      this.placeChip();
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const it = this.itemAt(e.clientX, e.clientY) ?? this.selected;
    if (!it) return;
    this.select(it);
    this.setScale(it, it.s * (e.deltaY > 0 ? 0.95 : 1.05));
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    const onControl = tag === 'BUTTON' || tag === 'INPUT';
    const it = this.selected;
    const step = e.shiftKey ? 12 : 2;
    let handled = true;
    switch (e.key) {
      case 'Escape':
        this.close(false);
        break;
      case 'Enter':
        if (onControl) handled = false;
        else this.close(true);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        if (!it || tag === 'INPUT') {
          handled = false;
          break;
        }
        this.moveTo(it, it.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), it.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0), false);
        break;
      case '+':
      case '=':
        if (it) this.resizeSelected(0.05);
        break;
      case '-':
      case '_':
        if (it) this.resizeSelected(-0.05);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (e.key !== 'Tab') {
      // Keep keys away from the game / menus underneath.
      e.stopImmediatePropagation();
    }
  };

  private readonly onResize = (): void => {
    // Keep what the player arranged: re-resolve it against the new viewport.
    const stored = this.snapshot();
    this.measure();
    this.load(stored);
    this.placeChip();
  };

  private snapshot(): Record<string, { x: number; y: number; s: number }> {
    const out: Record<string, { x: number; y: number; s: number }> = {};
    for (const it of this.items.values()) out[it.id] = toStored(it.x, it.y, it.s, this.w, this.h, this.safe);
    return out;
  }

  // ── Close ────────────────────────────────────────────────────────────────

  private close(save: boolean): void {
    if (this.closing) return;
    this.closing = true;
    // Opacity is only previewed on the stage until Save, so Cancel has nothing to revert.
    if (save) this.app.settings.update({ touchLayout: this.snapshot(), touchOpacity: Math.round(this.opacity * 100) / 100 });
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    this.offLang();
    window.clearTimeout(this.hintTimer);
    // Release the UI manager's back handling on the next tick (the key that closed us must not also go "back").
    window.setTimeout(() => (captureState.active = false), 0);
    this.root.classList.remove('is-vis');
    window.setTimeout(() => {
      this.root.remove();
      this.probe.remove();
      this.onClosed();
    }, 280);
    if (save) this.app.ui.toast('controls.editor.saved', 'good');
  }
}
