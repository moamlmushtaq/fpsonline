// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — admin console DOM: the drop-down retro terminal, the cheat
// panel (toggles/buttons mirroring the commands, usable by touch) and the
// "ADMIN" HUD tag listing active cheats. Pure view: every decision lives in
// admin/admin.ts. Styles are injected once (scoped .hf-adm-* classes, design
// tokens from styles/tokens.css, logical properties for RTL; the terminal
// itself — commands and log — stays LTR because command words are English).
// ─────────────────────────────────────────────────────────────────────────────

import type { UiSound } from '../contracts';
import { GAME_VERSION } from '../../shared/constants';
import { button, h, segmented, slider, toggle } from '../ui/components';
import { i18n, setAttr, setText } from '../ui/i18n';
import type { ClientBoolKey, ClientCheats, ClientNumKey } from './admin';
import type { AimBone } from './flags';

export type LineKind = 'in' | 'out' | 'ok' | 'err' | 'sys';

export interface PanelModel {
  /** Where host cheats go: offline host, online server, or nowhere (menus). */
  source: 'local' | 'online' | 'none';
  /** The host authorized this connection. */
  hostOk: boolean;
  inMatch: boolean;
  god: boolean;
  ammo: boolean;
  speed: number;
  freezeBots: boolean;
  noRecoil: boolean;
  noSpread: boolean;
  rapidFire: boolean;
  /** radar-all + chams + ESP all on. */
  wallhack: boolean;
  /** Client cheats (combat assist / visuals) and their settings. */
  client: ClientCheats;
  /** Zone ids available for teleport in this match. */
  zones: string[];
}

export type PanelAction =
  | { a: 'god' | 'ammo' | 'freezebots' | 'wallhack' | 'norecoil' | 'nospread' | 'rapidfire'; on: boolean }
  | { a: 'client'; key: ClientBoolKey; on: boolean }
  /** Slider: `commit` = released (persist + panel refresh); otherwise a live drag value. */
  | { a: 'clientNum'; key: ClientNumKey; v: number; commit: boolean }
  | { a: 'aimBone'; v: AimBone }
  | { a: 'speed'; v: number }
  | { a: 'sunspear' | 'killbots' | 'unlockall' | 'xp' | 'console' }
  | { a: 'teleport'; where: string }
  | { a: 'endmatch'; win: boolean };

export interface AdminUiHandlers {
  exec(line: string): void;
  panel(action: PanelAction): void;
  /** The console / panel was opened or closed (the App captures input meanwhile). */
  visibility(): void;
  tagTap(): void;
  sfx(s: UiSound): void;
  /** Touch device: the console shows Send/Close buttons and the panel uses big targets. */
  touch(): boolean;
}

const MAX_LINES = 160;
const SPEEDS = [1, 1.5, 2, 3] as const;

const CSS = `
.hf-adm-con{position:fixed;inset-inline:0;top:0;z-index:2100;display:flex;flex-direction:column;height:min(48vh,27rem);min-height:11rem;
  padding:calc(env(safe-area-inset-top,0px) + .55rem) calc(env(safe-area-inset-right,0px) + 1rem) .6rem calc(env(safe-area-inset-left,0px) + 1rem);
  background:linear-gradient(180deg,#0f0d0c,#1a1613);border-bottom:1px solid var(--c-accent-line);
  box-shadow:0 18px 50px -20px rgba(0,0,0,.7),0 1px 0 rgba(240,179,91,.18) inset;color:var(--c-text);font:500 .82rem/1.45 var(--f-mono);
  transform:translateY(-104%);opacity:0;visibility:hidden;transition:transform 300ms var(--ease),opacity 220ms var(--ease),visibility 0s linear 300ms;pointer-events:auto}
.hf-adm-con.is-open{transform:none;opacity:1;visibility:visible;transition:transform 300ms var(--ease),opacity 220ms var(--ease)}
.hf-adm-con::after{content:'';position:absolute;inset:0;pointer-events:none;border-radius:inherit;opacity:.5;
  background:repeating-linear-gradient(180deg,rgba(255,255,255,.025) 0 1px,transparent 1px 3px)}
.hf-adm-con__head{display:flex;align-items:center;gap:.7rem;padding-bottom:.45rem;border-bottom:1px solid var(--c-line-soft);font:600 .64rem/1 var(--f-mono);letter-spacing:var(--track-caps);text-transform:uppercase;color:var(--c-text-dim)}
.hf-adm-con__lamp{width:.5rem;height:.5rem;border-radius:50%;background:var(--c-accent);box-shadow:0 0 10px rgba(240,179,91,.9);animation:hf-adm-blink 2.4s steps(1) infinite}
.hf-adm-con__title{color:var(--c-accent-hi);font-family:var(--f-ui);letter-spacing:var(--track-caps)}
.hf-adm-con__ticks{flex:1;height:.4rem;opacity:.5;background:repeating-linear-gradient(90deg,var(--c-line) 0 1px,transparent 1px 9px)}
.hf-adm-con__build{direction:ltr;unicode-bidi:isolate}
.hf-adm-con__x{min-width:2.2rem;height:2.2rem;border-radius:var(--r-sm);border:1px solid var(--c-line);background:rgba(243,236,224,.04);color:var(--c-text);font:600 .75rem/1 var(--f-ui);display:grid;place-items:center;cursor:pointer;padding:0 .7rem;letter-spacing:.04em;text-transform:none}
.hf-adm-con__x:hover{border-color:var(--c-accent-line);background:var(--c-accent-soft)}
.hf-adm-con__x:active{transform:scale(.97)}
.hf-adm-con__x:focus-visible{outline:2px solid var(--c-accent);outline-offset:2px}
.hf-adm-con__x[hidden]{display:none}
.hf-adm-con__log{flex:1;overflow-y:auto;padding:.5rem .1rem .3rem;direction:ltr;text-align:left;scrollbar-width:thin;scrollbar-color:rgba(243,236,224,.2) transparent}
.hf-adm-con__l{white-space:pre-wrap;word-break:break-word;color:var(--c-text)}
.hf-adm-con__l[dir=rtl]{text-align:right;font-family:var(--f-arabic),var(--f-mono)}
.hf-adm-con__l--in{color:var(--c-accent-hi)}
.hf-adm-con__l--ok{color:var(--c-good)}
.hf-adm-con__l--err{color:#ff9a8a}
.hf-adm-con__l--sys{color:var(--c-text-dim)}
.hf-adm-con__l--h{color:var(--c-accent);margin-top:.25rem;text-transform:uppercase;letter-spacing:var(--track-caps);font-size:.68rem}
.hf-adm-con__l--help{display:grid;grid-template-columns:minmax(12.5rem,max-content) 1fr;gap:1rem}
.hf-adm-con__l--help>span{text-align:start}
.hf-adm-con__l--help>span[dir=rtl]{font-family:var(--f-arabic),var(--f-mono)}
.hf-adm-con__row{display:flex;align-items:center;gap:.6rem;margin-top:.2rem;padding:.35rem .6rem;border:1px solid var(--c-line);border-radius:var(--r-sm);background:rgba(0,0,0,.28);direction:ltr}
.hf-adm-con__row:focus-within{border-color:var(--c-accent-line);box-shadow:0 0 0 1px rgba(240,179,91,.25),0 0 18px -6px rgba(240,179,91,.5)}
.hf-adm-con__prompt{color:var(--c-accent);font-weight:700}
.hf-adm-con__in{flex:1;min-width:0;background:transparent;border:0;outline:0;color:var(--c-text);font:500 .9rem/1.6 var(--f-mono);caret-color:var(--c-accent);direction:ltr;text-align:left}
.hf-adm-con__in::placeholder{color:var(--c-text-faint)}
.hf-adm-con__hint{margin-top:.3rem;color:var(--c-text-faint);font:500 .62rem/1.3 var(--f-ui);letter-spacing:.03em}
@keyframes hf-adm-blink{50%{opacity:.25}}
@keyframes hf-adm-in{from{opacity:0;transform:translateY(3px)}}

.hf-adm-pan{position:fixed;z-index:2050;top:50%;inset-inline-end:calc(env(safe-area-inset-right,0px) + 1.1rem);width:min(23rem,calc(100vw - 2rem));max-height:calc(100vh - 2.4rem);
  display:flex;flex-direction:column;border:1px solid var(--c-line);border-radius:var(--r-lg);background:linear-gradient(180deg,#201d1a,#181512);box-shadow:var(--shadow-panel),0 0 0 1px rgba(240,179,91,.12);color:var(--c-text);font-family:var(--f-ui);
  transform:translateY(-50%) translateX(calc(14px * var(--dir)));opacity:0;visibility:hidden;transition:transform 320ms var(--ease),opacity 240ms var(--ease),visibility 0s linear 320ms;pointer-events:auto}
.hf-adm-pan.is-open{transform:translateY(-50%);opacity:1;visibility:visible;transition:transform 320ms var(--ease),opacity 240ms var(--ease)}
.hf-adm-pan__head{display:flex;align-items:center;gap:.6rem;padding:.8rem .9rem .65rem;border-bottom:1px solid var(--c-line-soft)}
.hf-adm-pan__badge{padding:.22rem .5rem;border-radius:var(--r-xs);background:var(--c-danger);color:#1d1210;font:700 .62rem/1 var(--f-mono);letter-spacing:.14em}
.hf-adm-pan__title{flex:1;font-weight:600;font-size:.95rem;letter-spacing:.02em}
.hf-adm-pan__src{font:500 .62rem/1 var(--f-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--c-text-dim);border:1px solid var(--c-line);border-radius:var(--r-pill);padding:.25rem .5rem}
.hf-adm-pan__src.is-ok{color:var(--c-good);border-color:rgba(185,224,122,.45)}
.hf-adm-pan__body{overflow-y:auto;padding:.35rem .9rem .8rem;scrollbar-width:thin;scrollbar-color:rgba(243,236,224,.2) transparent}
.hf-adm-pan__note{margin:.5rem 0 .1rem;padding:.45rem .6rem;border-radius:var(--r-sm);background:rgba(240,179,91,.08);border:1px solid rgba(240,179,91,.25);color:var(--c-text-dim);font-size:.72rem;line-height:1.35}
.hf-adm-pan__note[hidden]{display:none}
.hf-adm-pan__sec{margin-top:.7rem;font:600 .6rem/1 var(--f-ui);letter-spacing:var(--track-caps);text-transform:uppercase;color:var(--c-text-faint);display:flex;align-items:center;gap:.5rem}
.hf-adm-pan__sec::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--c-line),transparent)}
[dir=rtl] .hf-adm-pan__sec::after{background:linear-gradient(270deg,var(--c-line),transparent)}
.hf-adm-pan__row{display:flex;align-items:center;justify-content:space-between;gap:.8rem;min-height:2.4rem;padding:.15rem 0}
.hf-adm-pan__row+.hf-adm-pan__row{border-top:1px solid var(--c-line-soft)}
.hf-adm-pan__lbl{font-size:.84rem}
.hf-adm-pan__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.4rem;margin-top:.45rem}
.hf-adm-pan__grid--4{grid-template-columns:repeat(4,minmax(0,1fr))}
.hf-adm-pan__grid .btn{min-height:2.35rem;justify-content:center;padding-inline:.5rem;font-size:.78rem}
.hf-adm-pan .seg{font-size:.74rem}
.hf-adm-pan__row .slider{flex:0 1 11.5rem;min-width:0;width:auto;gap:.5rem}
.hf-adm-pan__row .slider__input{min-width:0;width:100%}
.hf-adm-pan__row .slider__value{flex:none;min-width:3rem;text-align:end;font:500 .72rem/1 var(--f-mono);color:var(--c-text-dim);direction:ltr;unicode-bidi:isolate}
.hf-adm-pan__sub{padding-inline-start:.7rem;border-inline-start:2px solid var(--c-line-soft);margin-inline-start:.15rem}
.hf-adm-pan__sub.is-off,.hf-adm-pan__grid.is-off{opacity:.45}
.hf-adm-pan__grid--3{grid-template-columns:repeat(3,minmax(0,1fr))}
.hf-adm-pan__chip[aria-pressed=true]{border-color:rgba(255,90,95,.6);background:rgba(255,90,95,.16);color:var(--c-text)}
.hf-adm-pan__chip[aria-pressed=false]{opacity:.7}
.hf-adm-pan__foot{display:flex;gap:.4rem;padding:.6rem .9rem .8rem;border-top:1px solid var(--c-line-soft)}
.hf-adm-pan__foot .btn{flex:1;justify-content:center}
.hf-adm-pan.is-disabled .hf-adm-pan__host{opacity:.42;pointer-events:none}
@media (pointer:coarse),(max-height:520px){
  .hf-adm-pan{top:calc(env(safe-area-inset-top,0px) + .5rem);transform:translateX(calc(14px * var(--dir)));max-height:calc(100vh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 1rem);width:min(25rem,calc(100vw - 1.5rem))}
  .hf-adm-pan.is-open{transform:none}
  .hf-adm-pan__head{padding:.55rem .8rem .5rem}
  .hf-adm-pan__body{padding:.2rem .8rem .6rem}
  .hf-adm-pan__row{min-height:3rem}
  .hf-adm-pan__grid .btn{min-height:3rem}
  .hf-adm-pan__foot{padding:.5rem .8rem .6rem}
  .hf-adm-pan__foot .btn{min-height:3rem}
}

.hf-adm-tag{position:fixed;z-index:60;inset-inline-start:calc(var(--safe-l,0px) + 1.4rem);bottom:calc(var(--safe-b,0px) + 6.4rem);display:none;align-items:center;gap:.45rem;
  padding:.3rem .55rem .3rem .35rem;border-radius:var(--r-sm);border:1px solid rgba(255,90,95,.55);background:rgba(28,14,14,.62);color:var(--c-text);
  font:500 .66rem/1.2 var(--f-mono);letter-spacing:.04em;pointer-events:auto;cursor:pointer;max-width:min(26rem,60vw);animation:hf-adm-in 260ms var(--ease) both}
.hf-adm-tag.is-on{display:flex}
.hf-adm-tag__b{padding:.18rem .4rem;border-radius:4px;background:var(--c-danger);color:#1d1210;font-weight:700;letter-spacing:.14em;font-size:.6rem}
.hf-adm-tag__l{color:var(--c-text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* Arabic letters must join: no tracking, the Arabic face. */
:lang(ar) .hf-adm-tag,:lang(ar) .hf-adm-tag__b,:lang(ar) .hf-adm-pan__badge{letter-spacing:0;font-family:var(--f-arabic)}
:lang(ar) .hf-adm-con__title,:lang(ar) .hf-adm-pan__sec,:lang(ar) .hf-adm-pan__src{letter-spacing:0}
/* Touch HUD never mirrors (radar + health stay top-left): the tag sits under them on the left. */
body.touch-ui .hf-adm-tag{bottom:auto;top:calc(var(--safe-t,0px) + 9.6rem);inset-inline:auto;left:calc(var(--safe-l,0px) + 1rem);min-height:2.6rem;max-width:min(26rem,46vw)}
`;

let cssInstalled = false;
function installCss(): void {
  if (cssInstalled || typeof document === 'undefined') return;
  cssInstalled = true;
  const st = document.createElement('style');
  st.dataset.hf = 'admin';
  st.textContent = CSS;
  document.head.append(st);
}

export class AdminUi {
  readonly con: HTMLElement;
  readonly pan: HTMLElement;
  readonly tag: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly hint: HTMLElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly panelBtn: HTMLButtonElement;
  private readonly tagList: HTMLElement;
  private readonly history: string[] = [];
  private histIdx = -1;
  private draft = '';
  private conOpen = false;
  private panOpen = false;
  private panBody: HTMLElement | null = null;
  private panSig = '';
  private model: PanelModel | null = null;
  private tagSig = '';

  constructor(private readonly hd: AdminUiHandlers) {
    installCss();
    // ── Console ──
    this.log = h('div', { class: 'hf-adm-con__log', attrs: { role: 'log', 'aria-live': 'polite' } });
    this.input = h('input', {
      class: 'hf-adm-con__in',
      attrs: { type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'send', dir: 'ltr', 'aria-label': 'command' },
    });
    setAttr(this.input, 'placeholder', 'admin.console.placeholder');
    setAttr(this.input, 'aria-label', 'admin.console.placeholder');
    this.sendBtn = h('button', { class: 'hf-adm-con__x', t: 'admin.console.send', attrs: { type: 'button' } });
    this.sendBtn.addEventListener('click', () => this.submit());
    this.panelBtn = h('button', { class: 'hf-adm-con__x', t: 'admin.console.panel', attrs: { type: 'button' } });
    this.panelBtn.addEventListener('click', () => this.hd.exec('menu'));
    const close = h('button', { class: 'hf-adm-con__x', text: '✕', attrs: { type: 'button' } });
    setAttr(close, 'aria-label', 'admin.console.close');
    setAttr(close, 'title', 'admin.console.close');
    close.addEventListener('click', () => this.closeConsole());
    this.hint = h('div', { class: 'hf-adm-con__hint' });
    this.con = h(
      'section',
      { class: 'hf-adm-con', attrs: { 'aria-hidden': 'true' } },
      h(
        'div',
        { class: 'hf-adm-con__head' },
        h('span', { class: 'hf-adm-con__lamp' }),
        h('span', { class: 'hf-adm-con__title', t: 'admin.console.title' }),
        h('span', { class: 'hf-adm-con__ticks' }),
        h('span', { class: 'hf-adm-con__build', text: `HF ${GAME_VERSION}` }),
        this.panelBtn,
        close,
      ),
      this.log,
      h('div', { class: 'hf-adm-con__row' }, h('span', { class: 'hf-adm-con__prompt', text: '▸' }), this.input, this.sendBtn),
      this.hint,
    );
    // Keys typed here are routed by the controller's capture listener (onInputKey), which also
    // stops them before menu navigation / gameplay bindings see them.

    // ── Panel ──
    this.pan = h('section', { class: 'hf-adm-pan', attrs: { 'aria-hidden': 'true', role: 'dialog' } });

    // ── HUD tag ──
    this.tagList = h('span', { class: 'hf-adm-tag__l' });
    this.tag = h('div', { class: 'hf-adm-tag', attrs: { role: 'button', tabindex: '-1' } }, h('span', { class: 'hf-adm-tag__b', t: 'admin.tag' }), this.tagList);
    setAttr(this.tag, 'title', 'admin.tag.open');
    this.tag.addEventListener('click', () => this.hd.tagTap());

    document.body.append(this.con, this.pan, this.tag);
    i18n.onChange(() => {
      this.panSig = '';
      if (this.model) this.renderPanel(this.model);
      this.tagSig = '';
    });
  }

  get consoleOpen(): boolean {
    return this.conOpen;
  }

  get panelOpen(): boolean {
    return this.panOpen;
  }

  get inputEl(): HTMLInputElement {
    return this.input;
  }

  // ── Console ───────────────────────────────────────────────────────────────

  openConsole(unlocked: boolean): void {
    this.panelBtn.hidden = !unlocked;
    const touch = this.hd.touch();
    this.sendBtn.hidden = !touch;
    setText(this.hint, touch ? 'admin.console.hintTouch' : 'admin.console.hint');
    if (!this.conOpen) {
      this.conOpen = true;
      this.con.classList.add('is-open');
      this.con.setAttribute('aria-hidden', 'false');
      this.hd.sfx('toggle');
      this.hd.visibility();
    }
    // Focus synchronously: on touch this runs inside the tap gesture, so the keyboard opens.
    try {
      this.input.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  closeConsole(): void {
    if (!this.conOpen) return;
    this.conOpen = false;
    this.con.classList.remove('is-open');
    this.con.setAttribute('aria-hidden', 'true');
    this.input.blur();
    this.hd.sfx('back');
    this.hd.visibility();
  }

  setUnlocked(on: boolean): void {
    this.panelBtn.hidden = !on;
  }

  print(text: string, kind: LineKind = 'out'): void {
    const l = h('div', { class: `hf-adm-con__l hf-adm-con__l--${kind}`, text });
    // Localized prose follows the UI language; echoed commands stay LTR.
    if (kind !== 'in' && i18n.dir === 'rtl' && /[؀-ۿ]/.test(text)) l.setAttribute('dir', 'rtl');
    this.log.append(l);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  /** A help row: command usage (LTR) | description (UI language). */
  helpRow(usage: string, desc: string): void {
    const d = h('span', { text: desc });
    if (/[\u0600-\u06ff]/.test(desc)) d.setAttribute('dir', 'rtl');
    this.log.append(h('div', { class: 'hf-adm-con__l hf-adm-con__l--help' }, h('span', { text: usage }), d));
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  heading(text: string): void {
    this.print(text, 'sys');
    (this.log.lastElementChild as HTMLElement | null)?.classList.add('hf-adm-con__l--h');
  }

  clear(): void {
    this.log.replaceChildren();
  }

  /** Commands typed (passwords are never stored). */
  remember(line: string): void {
    if (this.history[this.history.length - 1] !== line) this.history.push(line);
    if (this.history.length > 40) this.history.shift();
  }

  private submit(): void {
    const v = this.input.value;
    this.input.value = '';
    this.histIdx = -1;
    this.draft = '';
    if (v.trim()) this.hd.exec(v);
    try {
      this.input.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }

  /** Keys typed into the console input (the controller routes them here from its capture listener). */
  onInputKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.submit();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!this.history.length) return;
      if (this.histIdx < 0) this.draft = this.input.value;
      let i = this.histIdx < 0 ? this.history.length : this.histIdx;
      i += e.key === 'ArrowUp' ? -1 : 1;
      if (i >= this.history.length) {
        this.histIdx = -1;
        this.input.value = this.draft;
      } else {
        this.histIdx = Math.max(0, i);
        this.input.value = this.history[this.histIdx];
      }
      const n = this.input.value.length;
      this.input.setSelectionRange(n, n);
    }
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  openPanel(model: PanelModel): void {
    // One modal at a time: the panel replaces the terminal (its footer leads back).
    if (this.conOpen) {
      this.conOpen = false;
      this.con.classList.remove('is-open');
      this.con.setAttribute('aria-hidden', 'true');
      this.input.blur();
    }
    this.renderPanel(model);
    if (this.panOpen) return;
    this.panOpen = true;
    this.pan.classList.add('is-open');
    this.pan.setAttribute('aria-hidden', 'false');
    this.hd.sfx('confirm');
    this.hd.visibility();
  }

  closePanel(): void {
    if (!this.panOpen) return;
    this.panOpen = false;
    this.pan.classList.remove('is-open');
    this.pan.setAttribute('aria-hidden', 'true');
    this.hd.sfx('back');
    this.hd.visibility();
  }

  /** Rebuilds the panel when its model changed (cheap: a few dozen nodes). */
  renderPanel(model: PanelModel): void {
    this.model = model;
    const sig = JSON.stringify(model);
    if (sig === this.panSig && this.panBody) return;
    this.panSig = sig;
    const keepScroll = this.panBody?.scrollTop ?? 0;
    const act = (a: PanelAction) => () => this.hd.panel(a);
    const row = (label: string, ctl: HTMLElement) => h('div', { class: 'hf-adm-pan__row' }, h('span', { class: 'hf-adm-pan__lbl', t: label }), ctl);
    const tg = (label: string, value: boolean, a: 'god' | 'ammo' | 'freezebots' | 'wallhack' | 'norecoil' | 'nospread' | 'rapidfire') =>
      row(label, toggle({ value, label, onChange: (v) => this.hd.panel({ a, on: v }) }).el);
    const cl = model.client;
    const ctg = (label: string, key: ClientBoolKey) => row(label, toggle({ value: cl[key], label, onChange: (v) => this.hd.panel({ a: 'client', key, on: v }) }).el);
    const sl = (label: string, key: ClientNumKey, min: number, max: number, step: number, scale: number, format: (v: number) => string) =>
      row(
        label,
        slider({
          min,
          max,
          step,
          value: Math.round(cl[key] * scale * 1000) / 1000,
          format,
          label,
          onInput: (v) => this.hd.panel({ a: 'clientNum', key, v: v / scale, commit: false }),
          onChange: (v) => this.hd.panel({ a: 'clientNum', key, v: v / scale, commit: true }),
        }).el,
      );
    const chip = (label: string, key: ClientBoolKey) => {
      const b = button({ label, size: 'sm', variant: 'ghost', cls: 'hf-adm-pan__chip', onClick: () => this.hd.panel({ a: 'client', key, on: !cl[key] }) });
      b.setAttribute('aria-pressed', String(cl[key]));
      return b;
    };
    const btn = (label: string, onClick: () => void, variant?: 'primary' | 'ghost' | 'danger') => button({ label, onClick, size: 'sm', variant });
    const sec = (label: string) => h('div', { class: 'hf-adm-pan__sec', t: label });

    const src = h('span', {
      class: `hf-adm-pan__src${model.hostOk ? ' is-ok' : ''}`,
      t: model.source === 'local' ? 'admin.panel.srcLocal' : model.source === 'online' ? 'admin.panel.srcOnline' : 'admin.panel.srcNone',
    });
    const closeBtn = h('button', { class: 'hf-adm-con__x', text: '✕', attrs: { type: 'button' } });
    setAttr(closeBtn, 'aria-label', 'admin.panel.close');
    setAttr(closeBtn, 'title', 'admin.panel.close');
    closeBtn.addEventListener('click', () => this.closePanel());
    const head = h(
      'div',
      { class: 'hf-adm-pan__head' },
      h('span', { class: 'hf-adm-pan__badge', t: 'admin.tag' }),
      h('span', { class: 'hf-adm-pan__title', t: 'admin.panel.title' }),
      src,
      closeBtn,
    );

    const note = h('div', { class: 'hf-adm-pan__note' });
    if (model.source === 'online' && !model.hostOk) setText(note, 'admin.panel.notAuthorized');
    else if (!model.inMatch) setText(note, 'admin.panel.noMatch');
    else note.hidden = true;

    const speed = segmented<number>({
      options: SPEEDS.map((v) => ({ value: v, label: `×${v}`, raw: true })),
      value: (SPEEDS as readonly number[]).includes(model.speed) ? model.speed : 1,
      onChange: (v) => this.hd.panel({ a: 'speed', v }),
      label: 'admin.cheat.speed',
    });

    const host = h(
      'div',
      { class: 'hf-adm-pan__host' },
      sec('admin.panel.player'),
      tg('admin.cheat.god', model.god, 'god'),
      tg('admin.cheat.ammo', model.ammo, 'ammo'),
      row('admin.cheat.speed', speed.el),
      sec('admin.panel.weapon'),
      tg('admin.cheat.norecoil', model.noRecoil, 'norecoil'),
      tg('admin.cheat.nospread', model.noSpread, 'nospread'),
      tg('admin.cheat.rapidfire', model.rapidFire, 'rapidfire'),
      sec('admin.panel.world'),
      tg('admin.cheat.freezebots', model.freezeBots, 'freezebots'),
      h('div', { class: 'hf-adm-pan__grid' }, btn('admin.cheat.sunspear', act({ a: 'sunspear' })), btn('admin.cheat.killbots', act({ a: 'killbots' }))),
      sec('admin.panel.teleport'),
      h(
        'div',
        { class: 'hf-adm-pan__grid hf-adm-pan__grid--4' },
        ...model.zones.map((z) => button({ text: z, onClick: act({ a: 'teleport', where: z }), size: 'sm' })),
        btn('admin.cheat.spawn', act({ a: 'teleport', where: 'spawn' })),
      ),
      sec('admin.panel.match'),
      h('div', { class: 'hf-adm-pan__grid' }, btn('admin.cheat.endwin', act({ a: 'endmatch', win: true }), 'primary'), btn('admin.cheat.endmatch', act({ a: 'endmatch', win: false }), 'ghost')),
    );
    const bone = segmented<AimBone>({
      options: [
        { value: 'head', label: 'admin.bone.head' },
        { value: 'chest', label: 'admin.bone.chest' },
      ],
      value: cl.aimBone,
      onChange: (v) => this.hd.panel({ a: 'aimBone', v }),
      label: 'admin.set.aimBone',
    });
    const aimSub = h(
      'div',
      { class: `hf-adm-pan__sub${cl.aimbot ? '' : ' is-off'}` },
      sl('admin.set.aimFov', 'aimFov', 5, 180, 1, 1, (v) => `${Math.round(v)}°`),
      sl('admin.set.aimSmooth', 'aimSmooth', 0, 1, 0.05, 1, (v) => v.toFixed(2)),
      row('admin.set.aimBone', bone.el),
      ctg('admin.cheat.aimwalls', 'aimWalls'),
      ctg('admin.cheat.aimalways', 'aimAlways'),
    );
    const trigSub = h('div', { class: `hf-adm-pan__sub${cl.trigger ? '' : ' is-off'}` }, sl('admin.set.triggerDelay', 'triggerDelay', 0, 500, 10, 1000, (v) => `${Math.round(v)} ms`));
    const assist = h('div', {}, sec('admin.panel.assist'), ctg('admin.cheat.aimbot', 'aimbot'), aimSub, ctg('admin.cheat.trigger', 'trigger'), trigSub);
    const visuals = h(
      'div',
      {},
      sec('admin.panel.visuals'),
      ctg('admin.cheat.esp', 'esp'),
      h(
        'div',
        { class: `hf-adm-pan__grid hf-adm-pan__grid--3${cl.esp ? '' : ' is-off'}` },
        chip('admin.esp.boxes', 'espBoxes'),
        chip('admin.esp.skeleton', 'espSkeleton'),
        chip('admin.esp.names', 'espNames'),
        chip('admin.esp.health', 'espHealth'),
        chip('admin.esp.distance', 'espDistance'),
        chip('admin.esp.lines', 'espLines'),
        chip('admin.esp.team', 'espTeam'),
      ),
      ctg('admin.cheat.radarall', 'radarAll'),
      ctg('admin.cheat.chams', 'chams'),
      tg('admin.cheat.wallhack', model.wallhack, 'wallhack'),
    );
    const client = h(
      'div',
      {},
      sec('admin.panel.profile'),
      h('div', { class: 'hf-adm-pan__grid' }, btn('admin.cheat.unlockall', act({ a: 'unlockall' })), btn('admin.cheat.xp', act({ a: 'xp' }))),
    );
    const body = h('div', { class: 'hf-adm-pan__body' }, note, host, assist, visuals, client);
    const foot = h('div', { class: 'hf-adm-pan__foot' }, button({ label: 'admin.panel.console', icon: 'keyboard', onClick: act({ a: 'console' }), size: 'sm', variant: 'ghost' }));
    this.pan.classList.toggle('is-disabled', model.source === 'none' || (model.source === 'online' && !model.hostOk) || !model.inMatch);
    this.pan.replaceChildren(head, body, foot);
    this.panBody = body;
    body.scrollTop = keepScroll;
  }

  // ── HUD tag ───────────────────────────────────────────────────────────────

  /**
   * `anchor` = the HUD health panel's box. Desktop: the tag sits just above it, on
   * whichever side the HUD put it. Touch (health top-left, controls below): beside it.
   */
  setTag(visible: boolean, items: string[], anchor: DOMRect | null, beside: boolean): void {
    const st = this.tag.style;
    if (visible && anchor && anchor.width > 0) {
      const vw = window.innerWidth;
      if (beside) {
        st.left = `${Math.round(anchor.right + 10)}px`;
        st.right = 'auto';
        st.top = `${Math.round(anchor.top + anchor.height / 2)}px`;
        st.bottom = 'auto';
        st.transform = 'translateY(-50%)';
      } else {
        const right = anchor.left + anchor.width / 2 > vw / 2;
        st.left = right ? 'auto' : `${Math.round(anchor.left)}px`;
        st.right = right ? `${Math.round(vw - anchor.right)}px` : 'auto';
        st.top = 'auto';
        st.bottom = `${Math.round(window.innerHeight - anchor.top + 8)}px`;
        st.transform = '';
      }
    } else if (st.left || st.top) {
      st.left = st.right = st.top = st.bottom = st.transform = '';
    }
    const sig = `${visible ? 1 : 0}|${items.join('·')}|${i18n.lang}`;
    if (sig === this.tagSig) return;
    this.tagSig = sig;
    this.tag.classList.toggle('is-on', visible);
    this.tagList.textContent = items.join(' · ');
  }
}
