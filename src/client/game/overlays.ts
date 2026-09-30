// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — match-owned DOM overlays that sit with the HUD:
//  • cinematic mode (intro/outro): hides every HUD element except the banner
//    and subtitles, with a soft fade;
//  • the instruction card extensions use (tutorial steps: big text, key hint,
//    step counter, progress bar, success pulse);
//  • a ≥ 48 px scoreboard button for touch play (the touch-controls layer
//    covers the HUD, so this lives above it).
// Styles are injected once (UI bible: thin lines, warm-dark translucent
// panels, JetBrains Mono numbers, logical properties for RTL).
// ─────────────────────────────────────────────────────────────────────────────

import { h } from '../ui/components';
import { i18n, setAttr } from '../ui/i18n';
import type { InstructionOptions } from './extensions';

const CSS = `
.hud.hf-cine > :not(.hud-banner):not(.hud-subs):not(.hf-instr) { opacity: 0 !important; transition: opacity 380ms cubic-bezier(.2,.8,.2,1); }
.hud > * { transition: opacity 380ms cubic-bezier(.2,.8,.2,1); }
.hf-instr { position: absolute; left: 50%; top: 21%; transform: translateX(-50%); min-width: min(34em, 86vw); max-width: 92vw; padding: .9em 1.3em 1em; border-radius: 12px;
  background: linear-gradient(180deg, rgba(26,23,20,.72), rgba(22,20,18,.52)); border: 1px solid rgba(243,236,224,.22); box-shadow: 0 10px 40px rgba(0,0,0,.28);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); color: var(--c-text, #f3ece0); text-align: center; opacity: 0; pointer-events: none;
  transition: opacity 320ms cubic-bezier(.2,.8,.2,1), transform 320ms cubic-bezier(.2,.8,.2,1); }
body.q-low .hf-instr { backdrop-filter: none; -webkit-backdrop-filter: none; background: rgba(24,22,20,.86); }
.hf-instr.is-on { opacity: 1; transform: translateX(-50%) translateY(0); }
.hf-instr__step { font-family: var(--f-mono, 'JetBrains Mono', monospace); font-size: .72em; letter-spacing: .18em; color: var(--c-accent, #f0b35b); text-transform: uppercase; }
.hf-instr__text { font-size: 1.45em; font-weight: 600; letter-spacing: .01em; margin-top: .2em; line-height: 1.25; }
.hf-instr__keys { display: inline-flex; gap: .3em; margin-inline-end: .5em; vertical-align: .12em; }
.hf-instr__keys kbd { font-family: var(--f-mono, 'JetBrains Mono', monospace); font-size: .62em; padding: .15em .45em; border: 1px solid rgba(243,236,224,.5); border-radius: 6px; background: rgba(243,236,224,.08); }
.hf-instr__sub { font-size: .9em; color: rgba(243,236,224,.66); margin-top: .35em; }
.hf-instr__bar { height: 2px; margin-top: .75em; background: rgba(243,236,224,.14); border-radius: 2px; overflow: hidden; }
.hf-instr__bar i { display: block; height: 100%; background: var(--c-accent, #f0b35b); transform-origin: 0 50%; transform: scaleX(0); transition: transform 220ms linear; }
[dir='rtl'] .hf-instr__bar i { transform-origin: 100% 50%; }
.hf-instr.is-done { border-color: rgba(185,224,122,.75); box-shadow: 0 0 0 1px rgba(185,224,122,.35), 0 10px 40px rgba(0,0,0,.28); }
.hf-instr.is-done .hf-instr__step { color: #b9e07a; }
.hf-sbbtn { position: fixed; z-index: 26; inset-inline-start: calc(env(safe-area-inset-left, 0px) + 12px); top: calc(env(safe-area-inset-top, 0px) + 43%); width: 48px; height: 48px; border-radius: 50%;
  border: 1.5px solid rgba(243,236,224,.6); background: radial-gradient(circle at 50% 38%, rgba(52,47,42,.44), rgba(24,22,20,.58)); color: #f3ece0; display: none; place-items: center;
  touch-action: none; -webkit-tap-highlight-color: transparent; padding: 0; }
.hf-sbbtn.is-on { display: grid; }
.hf-sbbtn.is-active { background: radial-gradient(circle at 50% 38%, rgba(243,236,224,.34), rgba(243,236,224,.14)); border-color: #fffaf0; }
.hf-sbbtn svg { width: 46%; height: 46%; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; }
`;

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  const st = document.createElement('style');
  st.dataset.owner = 'match-overlays';
  st.textContent = CSS;
  document.head.append(st);
}

export class MatchOverlays {
  private readonly instr: HTMLElement;
  private readonly instrStep: HTMLElement;
  private readonly instrText: HTMLElement;
  private readonly instrSub: HTMLElement;
  private readonly instrBar: HTMLElement;
  private readonly instrBarFill: HTMLElement;
  private readonly sbBtn: HTMLButtonElement;
  private sbHeld = false;
  private instrKey = '';
  private doneTimer = 0;
  private readonly offLang: () => void;

  constructor(private readonly hudRoot: HTMLElement) {
    injectStyle();
    this.instrStep = h('div', { class: 'hf-instr__step' });
    this.instrText = h('div', { class: 'hf-instr__text' });
    this.instrSub = h('div', { class: 'hf-instr__sub' });
    this.instrBarFill = h('i');
    this.instrBar = h('div', { class: 'hf-instr__bar' }, this.instrBarFill);
    this.instr = h('div', { class: 'hf-instr', attrs: { role: 'status', 'aria-live': 'polite' } }, this.instrStep, this.instrText, this.instrSub, this.instrBar);
    hudRoot.append(this.instr);

    this.sbBtn = document.createElement('button');
    this.sbBtn.type = 'button';
    this.sbBtn.className = 'hf-sbbtn';
    this.sbBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h9"/></svg>';
    setAttr(this.sbBtn, 'aria-label', 'touch.scoreboard');
    setAttr(this.sbBtn, 'title', 'touch.scoreboard');
    const down = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.sbHeld = !this.sbHeld;
      this.sbBtn.classList.toggle('is-active', this.sbHeld);
    };
    this.sbBtn.addEventListener('touchstart', down, { passive: false });
    this.sbBtn.addEventListener('pointerdown', (e) => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      down(e);
    });
    document.body.append(this.sbBtn);
    // The button lives outside the UI root, so re-translate it ourselves.
    this.offLang = i18n.onChange(() => {
      setAttr(this.sbBtn, 'aria-label', 'touch.scoreboard');
      setAttr(this.sbBtn, 'title', 'touch.scoreboard');
    });
  }

  /** Toggle state of the touch scoreboard button. */
  get scoreboardToggled(): boolean {
    return this.sbHeld;
  }

  setTouchScoreboardVisible(v: boolean): void {
    this.sbBtn.classList.toggle('is-on', v);
    if (!v && this.sbHeld) {
      this.sbHeld = false;
      this.sbBtn.classList.remove('is-active');
    }
  }

  setCinematic(on: boolean): void {
    this.hudRoot.classList.toggle('hf-cine', on);
  }

  instruct(text: string | null, opts: InstructionOptions = {}): void {
    if (!text) {
      this.instr.classList.remove('is-on', 'is-done');
      this.instrKey = '';
      return;
    }
    const key = `${text}|${opts.sub ?? ''}|${opts.step ?? ''}|${opts.keys ?? ''}`;
    if (key !== this.instrKey) {
      this.instrKey = key;
      this.instrStep.textContent = opts.step ?? '';
      this.instrStep.style.display = opts.step ? '' : 'none';
      this.instrText.replaceChildren();
      if (opts.keys) {
        const keys = h('span', { class: 'hf-instr__keys', attrs: { dir: 'ltr' } });
        for (const k of opts.keys.split(/\s+/).filter(Boolean)) keys.append(h('kbd', { text: k }));
        this.instrText.append(keys);
      }
      this.instrText.append(text);
      this.instrSub.textContent = opts.sub ?? '';
      this.instrSub.style.display = opts.sub ? '' : 'none';
    }
    const hasBar = typeof opts.progress === 'number';
    this.instrBar.style.display = hasBar ? '' : 'none';
    if (hasBar) this.instrBarFill.style.transform = `scaleX(${Math.max(0, Math.min(1, opts.progress ?? 0)).toFixed(3)})`;
    this.instr.classList.add('is-on');
    if (opts.done) {
      this.instr.classList.add('is-done');
      window.clearTimeout(this.doneTimer);
      this.doneTimer = window.setTimeout(() => this.instr.classList.remove('is-done'), 900);
    }
  }

  dispose(): void {
    this.offLang();
    window.clearTimeout(this.doneTimer);
    this.instr.remove();
    this.sbBtn.remove();
    this.hudRoot.classList.remove('hf-cine');
  }
}
