// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — tutorial DOM layer.
//
//  • a thin segmented progress bar (one tick per drill) under the compass;
//  • the prompt card: ONE short verb + the device's input glyphs (key caps /
//    pad glyphs), a sub-progress row (● ● ○) and, only when stuck, a hint line;
//    completing a drill draws a check mark and flashes the card green;
//  • the Skip chip (always available: tap/click, Esc when the cursor is free,
//    hold ⧉ on a gamepad — the chip shows the hold ring);
//  • an edge arrow + distance toward the current beacon when it is off-screen;
//  • touch: pulse-highlights the real on-screen control (or the look area);
//  • the summary card (time, accuracy, targets, personal best) with
//    "Play now" / "Keep practicing".
// Everything lives in one fixed layer above the HUD and the touch controls
// (z-index 27); only the chip and the summary take pointer events. Logical
// CSS properties keep it RTL-correct; numbers and key caps stay LTR.
// ─────────────────────────────────────────────────────────────────────────────

import type { GlyphToken, TouchTarget } from './glyphs';
import type { StepId } from './steps';

const CSS = `
.hf-tut { position: fixed; inset: 0; z-index: 27; pointer-events: none; font-family: var(--f-ui); color: var(--c-text, #f3ece0); }
.hf-tut__bar { position: absolute; left: 50%; top: calc(var(--safe-t, 0px) + 4.6rem); transform: translateX(-50%); display: flex; gap: 4px; direction: ltr; }
[dir='rtl'] .hf-tut__bar { flex-direction: row-reverse; }
.hf-tut__seg { width: 20px; height: 3px; border-radius: 2px; background: rgba(243,236,224,.18); transition: background-color 280ms var(--ease), transform 280ms var(--ease); }
.hf-tut__seg.is-done { background: var(--c-accent, #f0b35b); }
.hf-tut__seg.is-cur { background: rgba(240,179,91,.45); animation: hf-tut-seg 1.4s ease-in-out infinite; }
@keyframes hf-tut-seg { 50% { background: rgba(240,179,91,.9); } }
.hf-tut__card { position: absolute; left: 50%; top: calc(var(--safe-t, 0px) + 5.4rem); transform: translate(-50%, -6px); min-width: 12rem; max-width: min(30rem, 88vw); padding: .7rem 1.2rem .75rem;
  border-radius: 12px; background: linear-gradient(180deg, rgba(26,23,20,.7), rgba(22,20,18,.5)); border: 1px solid rgba(243,236,224,.2);
  box-shadow: 0 10px 40px rgba(0,0,0,.25); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); text-align: center; opacity: 0;
  transition: opacity 260ms var(--ease), transform 260ms var(--ease), border-color 200ms, box-shadow 200ms; }
body.q-low .hf-tut__card { backdrop-filter: none; -webkit-backdrop-filter: none; background: rgba(24,22,20,.86); }
.hf-tut__card.is-on { opacity: 1; transform: translate(-50%, 0); }
.hf-tut__card.is-done { border-color: rgba(185,224,122,.8); box-shadow: 0 0 0 1px rgba(185,224,122,.35), 0 10px 40px rgba(0,0,0,.25); }
.hf-tut__row { display: flex; align-items: center; justify-content: center; gap: .65rem; }
.hf-tut__verb { font-size: 1.5rem; font-weight: 600; letter-spacing: .01em; line-height: 1.2; white-space: nowrap; }
.hf-tut__keys { display: inline-flex; align-items: center; gap: .3rem; direction: ltr; unicode-bidi: isolate; }
.hf-tut__keys kbd { font-family: var(--f-mono); font-size: .8rem; min-width: 1.7em; padding: .18em .5em; border: 1px solid rgba(243,236,224,.55); border-bottom-width: 2px; border-radius: 6px; background: rgba(243,236,224,.08); text-align: center; }
.hf-tut__keys kbd.pad { border-radius: 999px; min-width: 1.9em; border-color: rgba(240,179,91,.7); color: #fbe3bd; }
.hf-tut__keys .join { font-size: .72rem; color: rgba(243,236,224,.6); }
.hf-tut__check { width: 1.6rem; height: 1.6rem; flex: none; display: none; }
.hf-tut__card.is-done .hf-tut__check { display: block; }
.hf-tut__card.is-done .hf-tut__keys { display: none; }
.hf-tut__check circle { fill: none; stroke: rgba(185,224,122,.35); stroke-width: 2; }
.hf-tut__check path { fill: none; stroke: #b9e07a; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 24; stroke-dashoffset: 24; }
.hf-tut__card.is-done .hf-tut__check path { animation: hf-tut-check 360ms var(--ease) forwards; }
@keyframes hf-tut-check { to { stroke-dashoffset: 0; } }
.hf-tut__dots { display: flex; justify-content: center; gap: .35rem; margin-top: .4rem; direction: ltr; }
.hf-tut__dots i { width: 7px; height: 7px; border-radius: 50%; border: 1px solid rgba(243,236,224,.55); transition: background-color 200ms, transform 200ms; }
.hf-tut__dots i.on { background: var(--c-accent, #f0b35b); border-color: var(--c-accent, #f0b35b); transform: scale(1.15); }
.hf-tut__hint { font-size: .85rem; color: rgba(243,236,224,.72); margin-top: .35rem; max-height: 0; opacity: 0; overflow: hidden; transition: max-height 300ms var(--ease), opacity 300ms var(--ease); }
.hf-tut__card.is-hint .hf-tut__hint { max-height: 3em; opacity: 1; }
.hf-tut__card.is-hint { animation: hf-tut-nudge 2.4s var(--ease) infinite; }
@keyframes hf-tut-nudge { 0%, 70%, 100% { transform: translate(-50%, 0); } 78% { transform: translate(calc(-50% - 5px), 0); } 86% { transform: translate(calc(-50% + 5px), 0); } 94% { transform: translate(calc(-50% - 2px), 0); } }
.hf-tut__pct { font-family: var(--f-mono); font-size: .8rem; color: var(--c-accent, #f0b35b); margin-top: .3rem; direction: ltr; unicode-bidi: isolate; }
.hf-tut__skip { position: absolute; inset-inline-end: calc(var(--safe-r, 0px) + 1rem); top: calc(var(--safe-t, 0px) + .9rem); pointer-events: auto; display: inline-flex; align-items: center; gap: .45rem;
  min-height: 40px; padding: .35rem .8rem .35rem .9rem; border-radius: 999px; border: 1px solid rgba(243,236,224,.3); background: rgba(24,22,20,.5); color: var(--c-text, #f3ece0);
  font: 500 .82rem var(--f-ui); letter-spacing: .06em; text-transform: uppercase; cursor: pointer; transition: transform 140ms var(--ease), background-color 160ms, border-color 160ms; }
.hf-tut__skip:hover { background: rgba(243,236,224,.14); border-color: rgba(243,236,224,.6); }
.hf-tut__skip:active { transform: scale(.97); }
.hf-tut__skip:focus-visible { outline: 2px solid var(--c-accent, #f0b35b); outline-offset: 2px; }
.hf-tut__skip kbd { font-family: var(--f-mono); font-size: .72rem; padding: .05em .4em; border: 1px solid rgba(243,236,224,.45); border-radius: 5px; }
.hf-tut__skip kbd.pad { border-radius: 999px; }
.hf-tut__skip svg { width: 1.1rem; height: 1.1rem; direction: ltr; }
.hf-tut__skip svg circle { fill: none; stroke: var(--c-accent, #f0b35b); stroke-width: 3; stroke-dasharray: 50.3; stroke-dashoffset: 50.3; transform: rotate(-90deg); transform-origin: 50% 50%; }
body.touch-ui .hf-tut__skip { min-height: 48px; top: calc(var(--safe-t, 0px) + .6rem); }
.hf-tut.is-paused .hf-tut__skip { background: var(--c-accent, #f0b35b); color: var(--c-ink, #1d1712); border-color: transparent; transform: scale(1.06); }
.hf-tut.is-paused .hf-tut__card, .hf-tut.is-paused .hf-tut__arrow { opacity: 0 !important; }
.hf-tut__arrow { position: absolute; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px; opacity: 0; transition: opacity 200ms; display: grid; place-items: center; }
.hf-tut__arrow.is-on { opacity: 1; }
.hf-tut__arrow svg { width: 26px; height: 26px; filter: drop-shadow(0 1px 3px rgba(0,0,0,.5)); }
.hf-tut__arrow svg path { fill: var(--c-accent, #f0b35b); }
.hf-tut__arrow b { position: absolute; top: 100%; font: 500 .7rem var(--f-mono); color: #fbe3bd; text-shadow: 0 1px 2px rgba(0,0,0,.6); direction: ltr; white-space: nowrap; }
.hf-tut__look { position: absolute; inset-inline-end: 12%; top: 46%; width: 120px; height: 60px; opacity: 0; transition: opacity 300ms; }
.hf-tut__look.is-on { opacity: 1; }
.hf-tut__look i { position: absolute; left: 0; top: 18px; width: 26px; height: 26px; border-radius: 50%; background: rgba(243,236,224,.35); border: 2px solid rgba(255,250,240,.9); animation: hf-tut-drag 1.6s var(--ease) infinite; }
@keyframes hf-tut-drag { 0% { transform: translateX(0); opacity: 0; } 15% { opacity: 1; } 70% { transform: translateX(90px); opacity: 1; } 100% { transform: translateX(90px); opacity: 0; } }
.hf-touch .b.hf-tut-pulse, .hf-touch .stick.hf-tut-pulse { animation: hf-tut-pulse 1.1s ease-in-out infinite; border-color: #f0b35b !important; }
.hf-touch .stick.hf-tut-pulse { opacity: 1 !important; }
@keyframes hf-tut-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(240,179,91,.65), inset 0 0 0 5px rgba(240,179,91,.18); } 60% { box-shadow: 0 0 0 14px rgba(240,179,91,0), inset 0 0 0 5px rgba(240,179,91,.32); } }
.hf-tut__sum { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -46%) scale(.98); width: min(24rem, 90vw); padding: 1.3rem 1.4rem 1.2rem; border-radius: 14px; pointer-events: auto;
  background: linear-gradient(180deg, rgba(30,26,22,.9), rgba(22,20,18,.84)); border: 1px solid rgba(240,179,91,.45); box-shadow: 0 24px 60px rgba(0,0,0,.4); text-align: center; opacity: 0;
  transition: opacity 320ms var(--ease), transform 320ms var(--ease); }
.hf-tut__sum.is-on { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.hf-tut__sum svg { width: 3rem; height: 3rem; }
.hf-tut__sum svg circle { fill: none; stroke: #b9e07a; stroke-width: 2; }
.hf-tut__sum svg path { fill: none; stroke: #b9e07a; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 24; stroke-dashoffset: 24; animation: hf-tut-check 500ms 200ms var(--ease) forwards; }
.hf-tut__sum h2 { margin: .35rem 0 .1rem; font-size: 1.35rem; font-weight: 600; letter-spacing: .02em; }
.hf-tut__sum p { margin: 0 0 .9rem; color: rgba(243,236,224,.66); font-size: .88rem; }
.hf-tut__stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; margin-bottom: 1rem; }
.hf-tut__stats div { padding: .5rem .3rem; border-radius: 10px; background: rgba(243,236,224,.05); border: 1px solid rgba(243,236,224,.1); }
.hf-tut__stats b { display: block; font: 500 1.2rem var(--f-mono); direction: ltr; unicode-bidi: isolate; }
.hf-tut__stats span { font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: rgba(243,236,224,.6); }
.hf-tut__pb { display: inline-block; margin: -.4rem 0 .9rem; padding: .15rem .6rem; border-radius: 999px; font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; color: var(--c-ink, #1d1712); background: var(--c-xp, #f6d58e); }
.hf-tut__btns { display: flex; gap: .6rem; }
.hf-tut__btns button { flex: 1; min-height: 48px; border-radius: 10px; font: 600 .9rem var(--f-ui); letter-spacing: .06em; text-transform: uppercase; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: .45rem;
  border: 1px solid rgba(243,236,224,.35); background: rgba(243,236,224,.06); color: var(--c-text, #f3ece0); transition: transform 140ms var(--ease), background-color 160ms, border-color 160ms; }
.hf-tut__btns button:hover { background: rgba(243,236,224,.14); }
.hf-tut__btns button:active { transform: scale(.97); }
.hf-tut__btns button:focus-visible { outline: 2px solid var(--c-accent, #f0b35b); outline-offset: 2px; }
.hf-tut__btns button.primary { background: var(--c-accent, #f0b35b); border-color: transparent; color: var(--c-ink, #1d1712); }
.hf-tut__btns button.primary:hover { background: var(--c-accent-hi, #f8cc80); }
.hf-tut__btns kbd { font: 500 .68rem var(--f-mono); padding: .05em .35em; border-radius: 4px; border: 1px solid currentColor; opacity: .75; }
@media (max-height: 460px) { .hf-tut__bar { top: calc(var(--safe-t, 0px) + 3.3rem); } .hf-tut__card { top: calc(var(--safe-t, 0px) + 3.9rem); padding: .5rem .9rem; } .hf-tut__verb { font-size: 1.2rem; } }
`;

let injected = false;
function inject(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const st = document.createElement('style');
  st.dataset.owner = 'tutorial';
  st.textContent = CSS;
  document.head.append(st);
}

const CHECK_SVG = '<svg class="hf-tut__check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5"/><path d="M7 12.5l3.2 3.2L17.2 8.6"/></svg>';
const ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 14h-5v6H9v-6H4z"/></svg>';
const RING_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/></svg>';

export interface SummaryData {
  time: string;
  accuracy: string;
  targets: string;
  best: boolean;
  /** Button hint glyphs per device ('' = none). */
  playKey: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class TutorialUI {
  readonly root = el('div', 'hf-tut');
  private readonly bar = el('div', 'hf-tut__bar');
  private readonly segs: HTMLElement[] = [];
  private readonly card = el('div', 'hf-tut__card');
  private readonly verb = el('div', 'hf-tut__verb');
  private readonly keys = el('span', 'hf-tut__keys');
  private readonly dots = el('div', 'hf-tut__dots');
  private readonly hintEl = el('div', 'hf-tut__hint');
  private readonly pct = el('div', 'hf-tut__pct');
  readonly skipBtn = el('button', 'hf-tut__skip');
  private readonly skipLabel = el('span');
  private readonly skipGlyph = el('kbd');
  private readonly skipRing: SVGCircleElement;
  private readonly arrow = el('div', 'hf-tut__arrow');
  private readonly arrowDist = el('b');
  private readonly look = el('div', 'hf-tut__look');
  private sum: HTMLElement | null = null;
  private pulsed: Element | null = null;
  private doneTimer = 0;
  private dotsSig = '';

  constructor(steps: readonly StepId[], onSkip: () => void) {
    inject();
    for (let i = 0; i < steps.length; i++) {
      const s = el('i', 'hf-tut__seg');
      this.segs.push(s);
      this.bar.append(s);
    }
    this.bar.setAttribute('role', 'progressbar');
    this.bar.setAttribute('aria-valuemin', '0');
    this.bar.setAttribute('aria-valuemax', String(steps.length));
    const row = el('div', 'hf-tut__row');
    row.append(this.keys, this.verb);
    row.insertAdjacentHTML('afterbegin', CHECK_SVG);
    this.card.append(row, this.dots, this.pct, this.hintEl);
    this.card.setAttribute('role', 'status');
    this.card.setAttribute('aria-live', 'polite');
    this.skipBtn.type = 'button';
    this.skipBtn.insertAdjacentHTML('beforeend', RING_SVG);
    this.skipRing = this.skipBtn.querySelector('circle') as SVGCircleElement;
    this.skipBtn.append(this.skipLabel, this.skipGlyph);
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      onSkip();
    };
    this.skipBtn.addEventListener('click', stop);
    this.skipBtn.addEventListener('touchstart', stop, { passive: false });
    this.look.append(el('i'));
    this.arrow.innerHTML = ARROW_SVG;
    this.arrow.append(this.arrowDist);
    this.root.append(this.bar, this.card, this.skipBtn, this.arrow, this.look);
    document.body.append(this.root);
  }

  setProgress(done: readonly boolean[], current: number): void {
    let n = 0;
    for (let i = 0; i < this.segs.length; i++) {
      this.segs[i].classList.toggle('is-done', !!done[i]);
      this.segs[i].classList.toggle('is-cur', i === current && !done[i]);
      if (done[i]) n++;
    }
    this.bar.setAttribute('aria-valuenow', String(n));
  }

  setBarLabel(label: string): void {
    this.bar.setAttribute('aria-label', label);
  }

  /** Shows the card for a drill (verb + glyphs). */
  prompt(verb: string, glyphs: readonly GlyphToken[]): void {
    window.clearTimeout(this.doneTimer);
    this.card.classList.remove('is-done', 'is-hint');
    this.verb.textContent = verb;
    this.keys.replaceChildren();
    for (const g of glyphs) {
      if (g.kind === 'join') this.keys.append(el('span', 'join', g.text));
      else this.keys.append(el('kbd', g.kind === 'pad' ? 'pad' : '', g.text));
    }
    this.keys.style.display = glyphs.length ? '' : 'none';
    this.dots.replaceChildren();
    this.dotsSig = '';
    this.pct.textContent = '';
    this.pct.style.display = 'none';
    this.card.classList.add('is-on');
  }

  /** Sub-progress dots (null hides). */
  setDots(sub: { n: number; total: number } | null): void {
    const sig = sub ? `${sub.n}/${sub.total}` : '';
    if (sig === this.dotsSig) return;
    this.dotsSig = sig;
    this.dots.replaceChildren();
    this.dots.style.display = sub ? '' : 'none';
    if (!sub) return;
    for (let i = 0; i < sub.total; i++) this.dots.append(el('i', i < sub.n ? 'on' : ''));
  }

  /** Small mono percentage line (capture progress); null hides. */
  setPercent(k: number | null): void {
    if (k === null) {
      this.pct.style.display = 'none';
      return;
    }
    this.pct.style.display = '';
    this.pct.textContent = `${Math.round(k * 100)}%`;
  }

  setHint(text: string | null): void {
    if (text) this.hintEl.textContent = text;
    this.card.classList.toggle('is-hint', !!text);
  }

  /** Check-mark + green flash on the current card. */
  done(): void {
    this.card.classList.remove('is-hint');
    this.card.classList.add('is-done');
  }

  hideCard(): void {
    this.card.classList.remove('is-on', 'is-done', 'is-hint');
  }

  setSkip(label: string, glyph: GlyphToken | null, hold: number): void {
    this.skipLabel.textContent = label;
    this.skipGlyph.style.display = glyph ? '' : 'none';
    if (glyph) {
      this.skipGlyph.textContent = glyph.text;
      this.skipGlyph.className = glyph.kind === 'pad' ? 'pad' : '';
    }
    const svg = this.skipRing.ownerSVGElement;
    if (svg) svg.style.display = hold > 0 ? '' : 'none';
    this.skipRing.style.strokeDashoffset = String(50.3 * (1 - Math.max(0, Math.min(1, hold))));
  }

  setSkipLabelAria(label: string): void {
    this.skipBtn.setAttribute('aria-label', label);
    this.skipBtn.title = label;
  }

  /** Paused (pause overlay open): the skip chip becomes the obvious way out. */
  setPaused(p: boolean): void {
    this.root.classList.toggle('is-paused', p);
  }

  /** Edge arrow toward an off-screen goal (null hides). `angle` = screen-space radians (0 = up). */
  setArrow(pos: { x: number; y: number; angle: number; dist: number } | null): void {
    this.arrow.classList.toggle('is-on', !!pos);
    if (!pos) return;
    this.arrow.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
    (this.arrow.firstElementChild as SVGElement).style.transform = `rotate(${pos.angle.toFixed(3)}rad)`;
    this.arrowDist.textContent = `${Math.round(pos.dist)} m`;
  }

  /** Touch: pulse the real on-screen control for this drill. */
  highlightTouch(target: TouchTarget): void {
    const sel = target === 'stick' ? '.hf-touch .stick' : target && target !== 'look' ? `.hf-touch .b-${target}` : null;
    const next = sel ? document.querySelector(sel) : null;
    if (next !== this.pulsed) {
      this.pulsed?.classList.remove('hf-tut-pulse');
      next?.classList.add('hf-tut-pulse');
      this.pulsed = next;
    }
    this.look.classList.toggle('is-on', target === 'look');
  }

  showSummary(title: string, sub: string, labels: { time: string; accuracy: string; targets: string; best: string; play: string; practice: string }, d: SummaryData, onPlay: () => void, onPractice: () => void): void {
    this.hideCard();
    this.setArrow(null);
    this.highlightTouch(null);
    this.skipBtn.style.display = 'none';
    this.bar.style.opacity = '0';
    const s = el('div', 'hf-tut__sum');
    s.setAttribute('role', 'dialog');
    s.setAttribute('aria-label', title);
    s.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5"/><path d="M7 12.5l3.2 3.2L17.2 8.6"/></svg>');
    s.append(el('h2', '', title), el('p', '', sub));
    if (d.best) s.append(el('div', 'hf-tut__pb', labels.best));
    const stats = el('div', 'hf-tut__stats');
    for (const [v, l] of [
      [d.time, labels.time],
      [d.accuracy, labels.accuracy],
      [d.targets, labels.targets],
    ] as const) {
      const c = el('div');
      c.append(el('b', '', v), el('span', '', l));
      stats.append(c);
    }
    const btns = el('div', 'hf-tut__btns');
    const play = el('button', 'primary', labels.play);
    play.type = 'button';
    if (d.playKey) play.append(el('kbd', '', d.playKey));
    const practice = el('button', '', labels.practice);
    practice.type = 'button';
    const bind = (b: HTMLButtonElement, fn: () => void) => {
      const go = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      b.addEventListener('click', go);
      b.addEventListener('touchstart', go, { passive: false });
    };
    bind(play, onPlay);
    bind(practice, onPractice);
    btns.append(play, practice);
    s.append(stats, btns);
    this.root.append(s);
    this.sum = s;
    requestAnimationFrame(() => s.classList.add('is-on'));
  }

  hideSummary(): void {
    const s = this.sum;
    if (!s) return;
    this.sum = null;
    s.classList.remove('is-on');
    window.setTimeout(() => s.remove(), 360);
  }

  get summaryOpen(): boolean {
    return !!this.sum;
  }

  dispose(): void {
    window.clearTimeout(this.doneTimer);
    this.pulsed?.classList.remove('hf-tut-pulse');
    this.pulsed = null;
    this.root.remove();
  }
}
