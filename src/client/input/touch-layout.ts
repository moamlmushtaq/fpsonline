// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — touch control definitions, default layout and visuals.
//
// Shared by the live controls (input/touch.ts) and the layout editor
// (ui/touch-layout-editor.ts) so both place and draw every control exactly
// the same way.
//
// Layout model: settings.touchLayout stores, per control id, a position
// normalised to the SAFE AREA (0..1) plus a scale. Controls the player never
// moved use the default layout, which is anchored to the screen corners in
// thumb-sized units (not stretched percentages): the right-hand cluster sits
// around FIRE within reach of a resting thumb on any aspect ratio, from a
// 16:9 phone to a 4:3 tablet, and stays below the HUD's top band.
// ─────────────────────────────────────────────────────────────────────────────

import type { Action } from '../contracts';
import { t } from '../ui/i18n';

export type TouchButtonId = 'fire' | 'ads' | 'jump' | 'crouch' | 'reload' | 'swap' | 'throw' | 'interact' | 'pause' | 'scoreboard';

export interface TouchButtonDef {
  id: TouchButtonId;
  action: Action;
  /** Diameter in CSS px at scale 1 (all ≥ 48 px touch targets). */
  size: number;
  /**
   * hold   — down while touched;
   * toggle — each tap flips a latch;
   * hybrid — tap toggles, press-and-hold is momentary (crouch / aim);
   * swap   — tap cycles weapons, hold opens the slot radial.
   */
  mode: 'hold' | 'toggle' | 'hybrid' | 'swap';
  /** i18n key for the accessible label (English fallback below). */
  labelKey: string;
  label: string;
}

export const TOUCH_BUTTONS: readonly TouchButtonDef[] = [
  { id: 'fire', action: 'fire', size: 88, mode: 'hold', labelKey: 'touch.fire', label: 'Fire' },
  { id: 'ads', action: 'ads', size: 60, mode: 'hybrid', labelKey: 'touch.ads', label: 'Aim' },
  { id: 'jump', action: 'jump', size: 64, mode: 'hold', labelKey: 'touch.jump', label: 'Jump' },
  { id: 'crouch', action: 'crouch', size: 58, mode: 'hybrid', labelKey: 'touch.crouch', label: 'Crouch / slide' },
  { id: 'reload', action: 'reload', size: 52, mode: 'hold', labelKey: 'touch.reload', label: 'Reload' },
  { id: 'swap', action: 'nextWeapon', size: 52, mode: 'swap', labelKey: 'touch.swap', label: 'Swap weapon' },
  { id: 'throw', action: 'throw', size: 52, mode: 'hold', labelKey: 'touch.throw', label: 'Throw' },
  { id: 'interact', action: 'interact', size: 52, mode: 'hold', labelKey: 'touch.interact', label: 'Interact' },
  { id: 'pause', action: 'pause', size: 48, mode: 'hold', labelKey: 'touch.pause', label: 'Pause' },
  { id: 'scoreboard', action: 'scoreboard', size: 48, mode: 'toggle', labelKey: 'touch.scoreboard', label: 'Scoreboard' },
];

/** Every layout entry: the buttons plus the joystick's idle home. */
export const LAYOUT_IDS: readonly string[] = [...TOUCH_BUTTONS.map((b) => b.id), 'stick'];

/** Joystick ring radius (CSS px at base scale 1). */
export const STICK_RADIUS = 62;

export interface SafeInsets {
  l: number;
  r: number;
  t: number;
  b: number;
}

export const NO_INSETS: SafeInsets = { l: 0, r: 0, t: 0, b: 0 };

type Anchor = { h: 'l' | 'r'; v: 't' | 'b'; x: number; y: number };

/**
 * Default placement in base units (px at base scale 1), measured from the
 * safe-area corner named by h/v to the control's centre.
 */
const ANCHORS: Record<string, Anchor> = {
  fire: { h: 'r', v: 'b', x: 114, y: 118 },
  jump: { h: 'r', v: 'b', x: 44, y: 52 },
  crouch: { h: 'r', v: 'b', x: 152, y: 40 },
  ads: { h: 'r', v: 'b', x: 40, y: 156 },
  reload: { h: 'r', v: 'b', x: 226, y: 62 },
  throw: { h: 'r', v: 'b', x: 232, y: 146 },
  swap: { h: 'r', v: 'b', x: 150, y: 204 },
  interact: { h: 'r', v: 'b', x: 320, y: 124 },
  // Below the vitals (the touch HUD puts health top-left), above the joystick zone.
  pause: { h: 'l', v: 't', x: 36, y: 116 },
  scoreboard: { h: 'l', v: 't', x: 94, y: 116 },
  stick: { h: 'l', v: 'b', x: 150, y: 120 },
};

/** Base scale for a viewport: small phones get slightly larger relative targets, tablets bigger ones. */
export function baseScale(w: number, h: number): number {
  return Math.max(0.9, Math.min(1.3, Math.min(w, h) / 400));
}

/** The default layout for a viewport, normalised to its safe area. */
export function defaultLayoutFor(w: number, h: number, safe: SafeInsets = NO_INSETS): Record<string, { x: number; y: number; s: number }> {
  const base = baseScale(w, h);
  const sw = Math.max(1, w - safe.l - safe.r);
  const sh = Math.max(1, h - safe.t - safe.b);
  const out: Record<string, { x: number; y: number; s: number }> = {};
  for (const id of LAYOUT_IDS) {
    const a = ANCHORS[id];
    const px = a.h === 'l' ? a.x * base : sw - a.x * base;
    const py = a.v === 't' ? a.y * base : sh - a.y * base;
    out[id] = { x: Math.max(0, Math.min(1, px / sw)), y: Math.max(0, Math.min(1, py / sh)), s: 1 };
  }
  return out;
}

/** Default layout on a reference 844×390 landscape phone (kept for API compatibility). */
export const DEFAULT_TOUCH_LAYOUT: Readonly<Record<string, { x: number; y: number; s: number }>> = Object.freeze(defaultLayoutFor(844, 390));

export interface PlacedControl {
  id: string;
  /** Centre in CSS px (viewport space). */
  x: number;
  y: number;
  /** Radius in CSS px (buttons: ≥ 24, i.e. ≥ 48 px targets). */
  r: number;
  /** Stored scale. */
  s: number;
}

export function defFor(id: string): TouchButtonDef | undefined {
  return TOUCH_BUTTONS.find((b) => b.id === id);
}

/** Radius of a control at a stored scale (clamped to the 48 px minimum target). */
export function controlRadius(id: string, s: number, base: number): number {
  if (id === 'stick') return Math.max(52, STICK_RADIUS * base * s);
  const def = defFor(id);
  return Math.max(48, (def?.size ?? 52) * base * s) / 2;
}

/** Keeps a control fully inside the safe area. */
export function clampToSafe(x: number, y: number, r: number, w: number, h: number, safe: SafeInsets, margin = 4): { x: number; y: number } {
  return {
    x: Math.max(safe.l + r + margin, Math.min(w - safe.r - r - margin, x)),
    y: Math.max(safe.t + r + margin, Math.min(h - safe.b - r - margin, y)),
  };
}

/** Resolves every control's pixel placement from the (partial) custom layout. */
export function resolveLayout(custom: Settings_TouchLayout, w: number, h: number, safe: SafeInsets): Map<string, PlacedControl> {
  const base = baseScale(w, h);
  const def = defaultLayoutFor(w, h, safe);
  const sw = Math.max(1, w - safe.l - safe.r);
  const sh = Math.max(1, h - safe.t - safe.b);
  const out = new Map<string, PlacedControl>();
  for (const id of LAYOUT_IDS) {
    const p = custom[id] ?? def[id];
    const s = Number.isFinite(p.s) ? Math.max(0.5, Math.min(2, p.s)) : 1;
    const r = controlRadius(id, s, base);
    const c = clampToSafe(safe.l + p.x * sw, safe.t + p.y * sh, r, w, h, safe);
    out.set(id, { id, x: c.x, y: c.y, r, s });
  }
  return out;
}

type Settings_TouchLayout = Readonly<Record<string, { x: number; y: number; s: number }>>;

/** Normalises a pixel placement back into the stored layout format. */
export function toStored(x: number, y: number, s: number, w: number, h: number, safe: SafeInsets): { x: number; y: number; s: number } {
  const sw = Math.max(1, w - safe.l - safe.r);
  const sh = Math.max(1, h - safe.t - safe.b);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { x: r3(Math.max(0, Math.min(1, (x - safe.l) / sw))), y: r3(Math.max(0, Math.min(1, (y - safe.t) / sh))), s: r3(Math.max(0.5, Math.min(2, s))) };
}

// ── Safe-area probe ─────────────────────────────────────────────────────────

/** A hidden element whose padding resolves env(safe-area-inset-*). */
export function createSafeProbe(): HTMLDivElement {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  return probe;
}

export function readSafe(probe: HTMLElement): SafeInsets {
  const cs = getComputedStyle(probe);
  return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
}

// ── Visuals ─────────────────────────────────────────────────────────────────

export const ICONS: Record<TouchButtonId, string> = {
  fire: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  ads: '<circle cx="12" cy="12" r="8"/><path d="M12 6.5v3.2M12 14.3v3.2M6.5 12h3.2M14.3 12h3.2"/><circle cx="12" cy="12" r="0.9" fill="currentColor"/>',
  jump: '<path d="M6 14l6-6 6 6M6 19l6-6 6 6"/>',
  crouch: '<path d="M6 6l6 6 6-6M5 18h14"/>',
  reload: '<path d="M18.5 9A7 7 0 1 0 19 13"/><path d="M19 4.5V9h-4.5"/>',
  swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  throw: '<rect x="9" y="11" width="6" height="9" rx="1.6"/><path d="M10.5 11V9h3v2M6 7c2-3 7-4 11-1"/><path d="M17 3.5V6h-2.5"/>',
  interact: '<path d="M12 4v10M8 10l4 4 4-4"/><rect x="5" y="16" width="14" height="4" rx="1.2"/>',
  pause: '<path d="M9.5 6.5v11M14.5 6.5v11"/>',
  scoreboard: '<path d="M5 7h14M5 12h14M5 17h9"/>',
};

export function ticksSvg(n: number, inner: number, outer: number, major = 4, cls = 'ticks'): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r0 = i % (n / major) === 0 ? inner - 3 : inner;
    d += `M${(50 + Math.cos(a) * r0).toFixed(2)} ${(50 + Math.sin(a) * r0).toFixed(2)}L${(50 + Math.cos(a) * outer).toFixed(2)} ${(50 + Math.sin(a) * outer).toFixed(2)}`;
  }
  return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true"><path d="${d}"/></svg>`;
}

/** Localised label of a control (falls back to English). */
export function controlLabel(id: string): string {
  if (id === 'stick') {
    const s = t('controls.editor.stick');
    return s !== 'controls.editor.stick' ? s : 'Joystick';
  }
  const def = defFor(id);
  if (!def) return id;
  const s = t(def.labelKey);
  return s && s !== def.labelKey ? s : def.label;
}

/** Inner markup of a button (icon + dial ticks on FIRE). */
export function buttonMarkup(id: TouchButtonId): string {
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>${id === 'fire' ? ticksSvg(48, 44, 49, 4) : ''}`;
}

/** Joystick ring markup (ticks + sprint arc + chevron). */
export function stickMarkup(): string {
  return `${ticksSvg(36, 45, 49, 4, 'ring')}<svg class="sprint-arc" viewBox="0 0 100 100" aria-hidden="true"><path d="M27 12.5A44 44 0 0 1 73 12.5"/></svg><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/><path d="M6 21l6-6 6 6" opacity=".5"/></svg>`;
}

/**
 * Shared styles. `.hf-tc` is the container class of both the live layer
 * (.hf-touch) and the editor stage, so a control looks identical in both.
 */
const CSS = `
.hf-tc .b{position:absolute;left:0;top:0;border-radius:50%;box-sizing:border-box;border:1.5px solid rgba(243,236,224,.72);background:radial-gradient(circle at 50% 36%,rgba(58,52,46,.46),rgba(22,20,18,.6));box-shadow:inset 0 0 0 5px rgba(243,236,224,.045),0 3px 14px rgba(0,0,0,.22);display:grid;place-items:center;color:#f3ece0;transition:transform 120ms cubic-bezier(.2,.8,.2,1),opacity 200ms,border-color 140ms,box-shadow 140ms;will-change:transform;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.hf-tc .b .ico{width:44%;height:44%;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;overflow:visible;pointer-events:none}
.hf-tc .b.on{background:radial-gradient(circle at 50% 38%,rgba(243,236,224,.34),rgba(243,236,224,.14));border-color:#fffaf0}
.hf-tc .b.latched{border-color:#f0b35b;color:#f7d49b;box-shadow:inset 0 0 0 5px rgba(240,179,91,.12),0 0 16px rgba(240,179,91,.28)}
.hf-tc .b .ticks{position:absolute;inset:-7px;width:calc(100% + 14px);height:calc(100% + 14px);stroke:rgba(243,236,224,.5);stroke-width:1.2;pointer-events:none}
.hf-tc .b-fire{border-width:2px}
.hf-tc .b-fire.on .ticks{stroke:rgba(240,179,91,.85)}
.hf-tc .b.ctx-off{opacity:0;transform:scale(.8)!important}
.hf-tc .stick{position:absolute;left:0;top:0;border-radius:50%;border:1.5px solid rgba(243,236,224,.55);background:radial-gradient(circle,rgba(24,22,20,.1),rgba(24,22,20,.36));box-sizing:border-box;pointer-events:none;transition:opacity 180ms,border-color 160ms}
.hf-tc .stick .ring{position:absolute;inset:-9px;width:calc(100% + 18px);height:calc(100% + 18px);stroke:rgba(243,236,224,.42);stroke-width:1.2;fill:none}
.hf-tc .stick .sprint-arc{position:absolute;inset:-9px;width:calc(100% + 18px);height:calc(100% + 18px);fill:none;stroke:#f0b35b;stroke-width:2.4;stroke-linecap:round;opacity:.0;transition:opacity 160ms}
.hf-tc .stick .chev{position:absolute;left:50%;top:-34px;width:24px;height:24px;margin-left:-12px;fill:none;stroke:rgba(243,236,224,.7);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;opacity:0;transition:opacity 160ms,transform 160ms}
.hf-tc .stick.live .sprint-arc{opacity:.35}
.hf-tc .stick.live .chev{opacity:.55}
.hf-tc .stick.sprint{border-color:#f0b35b}
.hf-tc .stick.sprint .sprint-arc{opacity:1}
.hf-tc .stick.sprint .chev{opacity:1;stroke:#f0b35b;transform:translateY(-4px)}
.hf-tc .stick.locked .chev{stroke:#f7d49b}
.hf-tc .stick.idle{opacity:.32}
.hf-tc .knob{position:absolute;left:0;top:0;border-radius:50%;background:radial-gradient(circle at 50% 38%,rgba(243,236,224,.55),rgba(243,236,224,.22));border:1.5px solid rgba(255,250,240,.85);box-sizing:border-box;pointer-events:none}
.hf-tc .radial{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;opacity:0;transition:opacity 140ms}
.hf-tc .radial.open{opacity:1}
.hf-tc .radial .pet{position:absolute;width:62px;height:62px;margin:-31px 0 0 -31px;border-radius:50%;box-sizing:border-box;border:1.5px solid rgba(243,236,224,.6);background:radial-gradient(circle at 50% 36%,rgba(58,52,46,.72),rgba(22,20,18,.82));display:grid;place-items:center;align-content:center;gap:1px;color:#f3ece0;text-align:center;transition:transform 120ms cubic-bezier(.2,.8,.2,1),border-color 120ms}
.hf-tc .radial .pet b{font:600 17px/1 'JetBrains Mono',ui-monospace,monospace}
.hf-tc .radial .pet i{font:500 9px/1.1 'Space Grotesk','IBM Plex Sans Arabic',system-ui,sans-serif;font-style:normal;letter-spacing:.06em;text-transform:uppercase;opacity:.75;max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
html[lang='ar'] .hf-tc .radial .pet i{letter-spacing:0;text-transform:none;font-size:10px}
.hf-tc .radial .pet.sel{border-color:#f0b35b;color:#f7d49b;transform:scale(1.12);box-shadow:0 0 18px rgba(240,179,91,.3)}
`;

export function ensureTouchCss(): void {
  if (typeof document === 'undefined' || document.getElementById('hf-touch-css')) return;
  const st = document.createElement('style');
  st.id = 'hf-touch-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}
