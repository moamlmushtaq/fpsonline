// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — UI component kit (plain DOM).
//
// Every factory returns ready-to-append elements with i18n bindings, a11y
// attributes and `data-sfx` hints (the UIManager plays hover/click sounds via
// event delegation, so components stay free of audio plumbing).
// Controls expose `{ el, set }` so screens can sync them without re-creating.
// ─────────────────────────────────────────────────────────────────────────────

import type { UiSound } from '../contracts';
import { findNamecard } from '../../shared/cosmetics';
import { i18n, setAttr, setText } from './i18n';
import { icon, type IconName } from './icons';
import { mouseButtonCode } from '../input/input';

// ── DOM helper ──────────────────────────────────────────────────────────────

type Child = Node | string | null | undefined | false;

export interface HProps {
  class?: string;
  /** i18n key for textContent. */
  t?: string;
  params?: Record<string, string | number>;
  text?: string;
  html?: string;
  attrs?: Record<string, string>;
  style?: string;
  dataset?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: HProps = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.style) el.setAttribute('style', props.style);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) el.dataset[k] = v;
  if (props.t) setText(el, props.t, props.params);
  else if (props.text !== undefined) el.textContent = props.text;
  else if (props.html !== undefined) el.innerHTML = props.html;
  if (props.on) {
    for (const [ev, fn] of Object.entries(props.on)) el.addEventListener(ev, fn as EventListener);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Parses an SVG/HTML string into a single element. */
export function frag(html: string): Element {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as Element;
}

/** Marks children for the staggered entrance animation. */
export function stagger(els: Iterable<Element>, start = 0): void {
  let i = start;
  for (const el of els) {
    el.classList.add('stg');
    (el as HTMLElement).style.setProperty('--i', String(i++));
  }
}

/** Global flag: a keybind control is capturing input (the UI manager must not treat keys as navigation). */
export const captureState = { active: false };

// ── Buttons ─────────────────────────────────────────────────────────────────

export interface ButtonOpts {
  /** i18n key. */
  label?: string;
  params?: Record<string, string | number>;
  text?: string;
  icon?: IconName;
  iconEnd?: IconName;
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'lg';
  caps?: boolean;
  block?: boolean;
  sfx?: UiSound;
  /** i18n key for a tooltip. */
  tip?: string;
  kbd?: string;
  cls?: string;
  onClick?: (e: MouseEvent) => void;
}

export function button(o: ButtonOpts): HTMLButtonElement {
  const cls = ['btn'];
  if (o.variant) cls.push(`btn--${o.variant}`);
  if (o.size) cls.push(`btn--${o.size}`);
  if (o.caps) cls.push('btn--caps');
  if (o.block) cls.push('btn--block');
  if (o.cls) cls.push(o.cls);
  const b = h('button', { class: cls.join(' '), attrs: { type: 'button' } });
  b.dataset.sfx = o.sfx ?? (o.variant === 'primary' ? 'confirm' : 'click');
  if (o.icon) b.insertAdjacentHTML('beforeend', icon(o.icon));
  if (o.label || o.text !== undefined) {
    const span = h('span', { class: 'btn__label' });
    if (o.label) setText(span, o.label, o.params);
    else span.textContent = o.text ?? '';
    b.append(span);
  }
  if (o.iconEnd) b.insertAdjacentHTML('beforeend', icon(o.iconEnd));
  if (o.kbd) b.append(h('span', { class: 'btn__kbd', text: o.kbd }));
  if (o.tip) setAttr(b, 'data-tip', o.tip);
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

/** Square icon-only button; the label is announced and shown as a tooltip. */
export function iconButton(o: { icon: IconName; label: string; onClick?: (e: MouseEvent) => void; variant?: 'ghost' | 'primary'; size?: 'sm' | 'lg'; sfx?: UiSound; tipPos?: 'below'; cls?: string }): HTMLButtonElement {
  const cls = ['btn', 'btn--icon'];
  if (o.variant) cls.push(`btn--${o.variant}`);
  if (o.size) cls.push(`btn--${o.size}`);
  if (o.cls) cls.push(o.cls);
  const b = h('button', { class: cls.join(' '), attrs: { type: 'button' }, html: icon(o.icon) });
  b.dataset.sfx = o.sfx ?? 'click';
  setAttr(b, 'aria-label', o.label);
  setAttr(b, 'data-tip', o.label);
  if (o.tipPos) b.dataset.tipPos = o.tipPos;
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

// ── Segmented control ───────────────────────────────────────────────────────

export interface Option<T> {
  value: T;
  /** i18n key (or literal text when `raw` is set). */
  label: string;
  raw?: boolean;
  icon?: IconName;
}

export function segmented<T extends string | number>(o: { options: Option<T>[]; value: T; onChange: (v: T) => void; label?: string }) {
  const el = h('div', { class: 'seg', attrs: { role: 'radiogroup' } });
  if (o.label) setAttr(el, 'aria-label', o.label);
  const btns = o.options.map((opt) => {
    const b = h('button', { class: 'seg__opt', attrs: { type: 'button', role: 'radio' } });
    b.dataset.sfx = 'toggle';
    b.dataset.navLr = 'group';
    if (opt.icon) b.insertAdjacentHTML('beforeend', icon(opt.icon));
    const s = h('span');
    if (opt.raw) s.textContent = opt.label;
    else setText(s, opt.label);
    b.append(s);
    b.addEventListener('click', () => {
      if (current === opt.value) return;
      set(opt.value);
      o.onChange(opt.value);
    });
    el.append(b);
    return b;
  });
  let current = o.value;
  function set(v: T) {
    current = v;
    o.options.forEach((opt, i) => {
      const on = opt.value === v;
      btns[i].classList.toggle('is-active', on);
      btns[i].setAttribute('aria-checked', String(on));
    });
  }
  set(o.value);
  return { el, set };
}

// ── Slider ──────────────────────────────────────────────────────────────────

export function slider(o: {
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  /** Continuous feedback while dragging (defaults to onChange). */
  onInput?: (v: number) => void;
  label?: string;
}) {
  const input = h('input', {
    class: 'slider__input',
    attrs: { type: 'range', min: String(o.min), max: String(o.max), step: String(o.step) },
  });
  input.dataset.navLr = 'own';
  if (o.label) setAttr(input, 'aria-label', o.label);
  const readout = h('span', { class: 'slider__value' });
  const el = h('div', { class: 'slider' }, input, readout);
  const fmt = o.format ?? ((v: number) => String(v));
  let lastTick = 0;
  function paint(v: number) {
    const k = (v - o.min) / (o.max - o.min || 1);
    input.style.setProperty('--fill', `${Math.round(k * 1000) / 10}%`);
    readout.textContent = fmt(v);
  }
  function set(v: number) {
    input.value = String(v);
    paint(v);
  }
  input.addEventListener('input', () => {
    const v = Number(input.value);
    paint(v);
    (o.onInput ?? o.onChange)(v);
    const now = performance.now();
    if (now - lastTick > 45) {
      lastTick = now;
      input.dispatchEvent(new CustomEvent('hf-sfx', { bubbles: true, detail: 'xpTick' }));
    }
  });
  input.addEventListener('change', () => o.onChange(Number(input.value)));
  set(o.value);
  return { el, set, input };
}

// ── Toggle ──────────────────────────────────────────────────────────────────

export function toggle(o: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  const el = h('button', { class: 'toggle', attrs: { type: 'button', role: 'switch' } });
  el.dataset.sfx = 'toggle';
  if (o.label) setAttr(el, 'aria-label', o.label);
  let v = o.value;
  function set(nv: boolean) {
    v = nv;
    el.classList.toggle('is-on', v);
    el.setAttribute('aria-checked', String(v));
  }
  el.addEventListener('click', () => {
    set(!v);
    o.onChange(v);
  });
  set(v);
  return { el, set };
}

// ── Cycler select  ‹ value › (gamepad friendly) ────────────────────────────

export function cycler<T>(o: { options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  const val = h('span', { class: 'cycler__value' });
  const prev = h('button', { class: 'cycler__arrow', attrs: { type: 'button' }, html: icon('back') });
  const next = h('button', { class: 'cycler__arrow', attrs: { type: 'button' }, html: icon('forward') });
  setAttr(prev, 'aria-label', 'common.back');
  setAttr(next, 'aria-label', 'common.continue');
  prev.dataset.sfx = 'toggle';
  next.dataset.sfx = 'toggle';
  const el = h('div', { class: 'cycler' }, prev, val, next);
  let idx = Math.max(0, o.options.findIndex((x) => x.value === o.value));
  function paint() {
    const opt = o.options[idx];
    if (opt.raw) {
      delete val.dataset.i18n;
      val.textContent = opt.label;
    } else setText(val, opt.label);
  }
  function step(d: number) {
    idx = (idx + d + o.options.length) % o.options.length;
    paint();
    o.onChange(o.options[idx].value);
  }
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  paint();
  return {
    el,
    set(v: T) {
      const i = o.options.findIndex((x) => x.value === v);
      if (i >= 0) {
        idx = i;
        paint();
      }
    },
  };
}

// ── Tabs ────────────────────────────────────────────────────────────────────

export function tabs<T extends string>(o: { tabs: { id: T; label: string; icon?: IconName }[]; value: T; onChange: (id: T) => void }) {
  const el = h('div', { class: 'tabs', attrs: { role: 'tablist' } });
  const btns = new Map<T, HTMLButtonElement>();
  for (const tb of o.tabs) {
    const b = h('button', { class: 'tab', attrs: { type: 'button', role: 'tab' } });
    b.dataset.sfx = 'toggle';
    b.dataset.navLr = 'group';
    if (tb.icon) b.insertAdjacentHTML('beforeend', icon(tb.icon));
    b.append(h('span', { t: tb.label }));
    b.addEventListener('click', () => {
      if (current === tb.id) return;
      set(tb.id);
      o.onChange(tb.id);
    });
    btns.set(tb.id, b);
    el.append(b);
  }
  let current = o.value;
  function set(id: T) {
    current = id;
    for (const [k, b] of btns) {
      const on = k === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }
  set(o.value);
  return { el, set, get value() { return current; } };
}

// ── Cards ───────────────────────────────────────────────────────────────────

export function card(o: {
  title?: string;
  titleRaw?: string;
  sub?: string;
  selected?: boolean;
  /** Level required, or null/undefined if unlocked. */
  lockedLevel?: number | null;
  cls?: string;
  onClick?: () => void;
  children?: Child[];
}): HTMLButtonElement {
  const el = h('button', { class: `card ticks ${o.cls ?? ''}`, attrs: { type: 'button' } });
  el.dataset.sfx = 'click';
  for (const c of o.children ?? []) if (c) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  if (o.title || o.titleRaw) {
    const tt = h('div', { class: 'card__title' });
    if (o.title) setText(tt, o.title);
    else tt.textContent = o.titleRaw ?? '';
    el.append(tt);
  }
  if (o.sub) el.append(h('div', { class: 'card__sub', t: o.sub }));
  el.append(h('span', { class: 'card__check', html: icon('check') }));
  setLocked(el, o.lockedLevel ?? null);
  el.classList.toggle('is-selected', !!o.selected);
  if (o.onClick) {
    el.addEventListener('click', () => {
      if (el.classList.contains('is-locked')) {
        el.dispatchEvent(new CustomEvent('hf-sfx', { bubbles: true, detail: 'error' }));
        return;
      }
      o.onClick?.();
    });
  }
  return el;
}

export function setLocked(el: HTMLElement, level: number | null): void {
  el.querySelector('.card__lock')?.remove();
  el.classList.toggle('is-locked', level !== null);
  el.setAttribute('aria-disabled', String(level !== null));
  if (level !== null) {
    const badge = h('span', { class: 'card__lock', html: icon('lock') });
    badge.append(h('span', { t: 'customize.lockedAt', params: { level } }));
    el.prepend(badge);
  }
}

// ── Setting row / labels ────────────────────────────────────────────────────

export function settingRow(label: string, control: HTMLElement, desc?: string): HTMLElement {
  const text = h('div', {}, h('div', { class: 'row__label', t: label }), desc ? h('div', { class: 'row__desc', t: desc }) : null);
  return h('div', { class: 'row' }, text, h('div', { class: 'row__control' }, control));
}

export function sectionLabel(key: string): HTMLElement {
  return h('h3', { class: 'section-label', t: key });
}

export function statBar(label: string, value01: number, display: string): HTMLElement {
  const fill = h('div', { class: 'statbar__fill' });
  fill.style.setProperty('--v', `${Math.round(Math.max(0, Math.min(1, value01)) * 100)}%`);
  return h('div', { class: 'statbar' }, h('span', { t: label }), h('div', { class: 'statbar__track' }, fill), h('span', { class: 'statbar__num', text: display }));
}

// ── Dial decoration (analog instrument) ─────────────────────────────────────

export function dialSvg(o: { size?: number; value?: number; ticks?: number; spin?: boolean; cls?: string; needle?: boolean } = {}): string {
  const ticks = o.ticks ?? 36;
  const v = o.value ?? 0;
  let marks = '';
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    const major = i % (ticks / 4) === 0;
    const r1 = major ? 36 : 40;
    const x1 = 50 + Math.sin(a) * r1;
    const y1 = 50 - Math.cos(a) * r1;
    const x2 = 50 + Math.sin(a) * 45;
    const y2 = 50 - Math.cos(a) * 45;
    marks += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke-opacity="${major ? 0.95 : 0.45}"/>`;
  }
  const deg = v * 360;
  return `<svg class="dial ${o.spin ? 'dial--spin' : ''} ${o.cls ?? ''}" viewBox="0 0 100 100" width="${o.size ?? 64}" height="${o.size ?? 64}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
    <circle cx="50" cy="50" r="48" stroke-opacity=".25"/>
    <g>${marks}</g>
    <circle cx="50" cy="50" r="30" stroke-opacity=".2"/>
    ${o.needle === false ? '' : `<g class="dial__needle" style="transform:rotate(${deg}deg)"><line x1="50" y1="50" x2="50" y2="14" stroke-width="2"/><circle cx="50" cy="50" r="3.5" fill="currentColor"/></g>`}
  </svg>`;
}

/** SVG progress ring; `set(frac)` animates via stroke-dashoffset. */
export function progressRing(size: number, stroke: number, frac: number, cls = '') {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const el = frag(
    `<svg class="ring ${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="ring__track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/><circle class="ring__fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c}"/></svg>`,
  ) as SVGSVGElement;
  const fill = el.querySelector('.ring__fill') as SVGCircleElement;
  function set(f: number) {
    fill.style.strokeDashoffset = String(c * (1 - Math.max(0, Math.min(1, f))));
  }
  set(frac);
  return { el, set };
}

// ── Namecards ───────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const MOTIFS: Record<string, string> = {
  sun: '<circle cx="250" cy="70" r="46" fill="url(#m)"/><g fill="#000" fill-opacity=".14"><rect x="190" y="58" width="130" height="5"/><rect x="190" y="72" width="130" height="7"/><rect x="190" y="88" width="130" height="9"/></g><rect x="0" y="100" width="320" height="20" fill="#000" fill-opacity=".1"/>',
  rings:
    '<circle cx="250" cy="60" r="26" fill="#fff" fill-opacity=".28"/><ellipse cx="250" cy="60" rx="62" ry="14" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="3" transform="rotate(-14 250 60)"/><ellipse cx="250" cy="60" rx="76" ry="19" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1.5" transform="rotate(-14 250 60)"/>',
  grid:
    '<g stroke="#fff" stroke-opacity=".18" stroke-width="1">' +
    Array.from({ length: 12 }, (_, i) => `<line x1="${160 + i * 20}" y1="120" x2="${240 + (i - 6) * 6}" y2="40"/>`).join('') +
    Array.from({ length: 6 }, (_, i) => `<line x1="140" y1="${48 + i * i * 2.6}" x2="320" y2="${48 + i * i * 2.6}"/>`).join('') +
    '</g><path d="M150 96 C200 90 220 60 320 58" stroke="#b9e07a" stroke-opacity=".6" fill="none" stroke-width="1.5"/>',
  vines:
    '<g fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"><path d="M180 120 C200 80 240 90 250 50 S300 20 320 10"/><path d="M230 120 C240 100 270 96 290 70"/></g><g fill="#fffbe0" fill-opacity=".55"><ellipse cx="214" cy="84" rx="8" ry="4" transform="rotate(-30 214 84)"/><ellipse cx="252" cy="56" rx="9" ry="4" transform="rotate(30 252 56)"/><ellipse cx="282" cy="30" rx="7" ry="3.5" transform="rotate(-20 282 30)"/><circle cx="268" cy="86" r="3.5"/><circle cx="296" cy="64" r="2.5"/></g>',
  rocket:
    '<g transform="translate(262 18) rotate(18)"><path d="M0 0 C10 10 12 30 12 52 L-12 52 C-12 30 -10 10 0 0Z" fill="#fff" fill-opacity=".55"/><path d="M-12 40 L-22 56 L-12 52Z M12 40 L22 56 L12 52Z" fill="#000" fill-opacity=".2"/><path d="M-7 56 L0 96 L7 56Z" fill="#ffd166" fill-opacity=".7"/></g><path d="M150 118 Q230 110 262 80" stroke="#fff" stroke-opacity=".25" stroke-dasharray="4 6" fill="none"/>',
  stars:
    '<g fill="#fff">' +
    [
      [180, 30, 1.6],
      [210, 70, 1.2],
      [236, 22, 2.2],
      [262, 90, 1.4],
      [290, 44, 1.8],
      [306, 96, 1.1],
      [200, 104, 1.3],
      [158, 60, 1],
      [274, 14, 1],
    ]
      .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill-opacity=".8"/>`)
      .join('') +
    '<path d="M250 46 L253 57 L264 60 L253 63 L250 74 L247 63 L236 60 L247 57Z" fill-opacity=".85"/></g>',
  waves:
    '<g fill="none" stroke="#fff" stroke-width="2">' +
    Array.from({ length: 5 }, (_, i) => `<path stroke-opacity="${0.5 - i * 0.08}" d="M140 ${50 + i * 14} q15 -8 30 0 t30 0 t30 0 t30 0 t30 0 t30 0"/>`).join('') +
    '</g>',
  dial:
    '<g transform="translate(262 60)" stroke="#f6d58e" fill="none">' +
    Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      const r1 = i % 5 === 0 ? 34 : 39;
      return `<line x1="${(Math.sin(a) * r1).toFixed(1)}" y1="${(-Math.cos(a) * r1).toFixed(1)}" x2="${(Math.sin(a) * 44).toFixed(1)}" y2="${(-Math.cos(a) * 44).toFixed(1)}" stroke-opacity="${i % 5 === 0 ? 0.8 : 0.35}"/>`;
    }).join('') +
    '<circle r="26" stroke-opacity=".3"/><line x1="0" y1="0" x2="18" y2="-18" stroke-width="2.5" stroke-opacity=".9"/></g>',
};

/** Namecard banner background (gradient + motif) as an SVG string. */
let svgUid = 0;

export function namecardSvg(id: string): string {
  const nc = findNamecard(id);
  // Unique gradient ids per instance: duplicated ids break when the first copy is hidden.
  const u = `nc${++svgUid}`;
  const motif = (MOTIFS[nc.motif] ?? '').replace(/url\(#m\)/g, `url(#${u}m)`);
  // Motif only (the gradient is the element's CSS background) so wide banners never crop it.
  return `<svg viewBox="140 0 180 120" preserveAspectRatio="xMaxYMid meet" aria-hidden="true"><defs><radialGradient id="${u}m" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff6dc" stop-opacity=".95"/><stop offset="1" stop-color="#ffb46b" stop-opacity=".7"/></radialGradient></defs>${motif}</svg>`;
}

/** CSS background for a namecard banner. */
export function namecardBackground(id: string): string {
  const nc = findNamecard(id);
  return `linear-gradient(115deg, ${nc.from} 0%, ${nc.from} 35%, ${nc.to} 100%)`;
}

export function namecardIsDark(id: string): boolean {
  const nc = findNamecard(id);
  return (luminance(nc.from) + luminance(nc.to)) / 2 < 0.55;
}

export function namecard(o: { id: string; name: string; level: number; sub?: string; subRaw?: string; cls?: string }): HTMLElement {
  const el = h('div', { class: `namecard ${namecardIsDark(o.id) ? 'namecard--dark' : ''} ${o.cls ?? ''}` });
  const bg = h('div', { class: 'namecard__bg', html: namecardSvg(o.id) });
  bg.style.background = namecardBackground(o.id);
  el.append(bg);
  el.append(h('div', { class: 'namecard__lvl', text: String(o.level) }));
  const text = h('div', { class: 'namecard__text' }, h('div', { class: 'namecard__name', text: o.name }));
  if (o.sub) text.append(h('div', { class: 'namecard__sub', t: o.sub }));
  else if (o.subRaw) text.append(h('div', { class: 'namecard__sub', text: o.subRaw }));
  el.append(text);
  return el;
}

// ── Keybind capture ─────────────────────────────────────────────────────────

export function keybind(o: { code: string | null; format: (code: string) => string; onCapture: (code: string | null) => void }) {
  const el = h('button', { class: 'kb', attrs: { type: 'button' } });
  el.dataset.sfx = 'click';
  let code = o.code;
  let capturing = false;
  function paint() {
    el.classList.toggle('is-empty', !code && !capturing);
    el.classList.toggle('is-capturing', capturing);
    if (capturing) setText(el, 'settings.bind.press');
    else {
      delete el.dataset.i18n;
      el.textContent = code ? o.format(code) : i18n.t('settings.bind.unbound');
    }
  }
  function finish(next: string | null | undefined) {
    capturing = false;
    captureState.active = false;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('contextmenu', onCtx, true);
    if (next !== undefined) {
      code = next;
      o.onCapture(next);
    }
    paint();
  }
  const onKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') return finish(undefined);
    if (e.code === 'Backspace' || e.code === 'Delete') return finish(null);
    finish(e.code);
  };
  const onMouse = (e: MouseEvent) => {
    if (e.target === el && e.button === 0 && performance.now() - startedAt < 250) return;
    e.preventDefault();
    e.stopPropagation();
    // Browser button numbering (0 left, 1 middle, 2 right) → binding codes (Mouse1 = right).
    finish(mouseButtonCode(e.button));
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    finish(e.deltaY > 0 ? 'Wheel+' : 'Wheel-');
  };
  const onCtx = (e: Event) => e.preventDefault();
  let startedAt = 0;
  el.addEventListener('click', (e) => {
    if (capturing) return;
    e.stopPropagation();
    capturing = true;
    captureState.active = true;
    startedAt = performance.now();
    paint();
    // Defer so the click that started capture is not captured itself.
    setTimeout(() => {
      if (!capturing) return;
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onMouse, true);
      window.addEventListener('wheel', onWheel, { capture: true, passive: false });
      window.addEventListener('contextmenu', onCtx, true);
    }, 0);
  });
  el.addEventListener('blur', () => {
    if (capturing) finish(undefined);
  });
  paint();
  return {
    el,
    set(c: string | null) {
      code = c;
      paint();
    },
  };
}

// ── Misc ────────────────────────────────────────────────────────────────────

/** Screen header: back button + eyebrow + title (+ optional right-side slot). */
export function screenHeader(o: { title: string; eyebrow?: string; sub?: string; onBack?: () => void; right?: HTMLElement }): HTMLElement {
  const left = h('div', { class: 'scr-head__titles' });
  if (o.eyebrow) left.append(h('div', { class: 'eyebrow', t: o.eyebrow }));
  left.append(h('h1', { class: 'scr-head__title', t: o.title }));
  if (o.sub) left.append(h('p', { class: 'scr-head__sub', t: o.sub }));
  const head = h('header', { class: 'scr-head' });
  if (o.onBack) {
    const back = iconButton({ icon: 'back', label: 'common.back', onClick: o.onBack, sfx: 'back', tipPos: 'below', cls: 'scr-head__back' });
    head.append(back);
  }
  head.append(left);
  if (o.right) head.append(h('div', { class: 'scr-head__right' }, o.right));
  return head;
}

/** Formats a number for mono readouts (always Western digits). */
export function fmt(n: number, digits = 0): string {
  return i18n.num(n, digits);
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
