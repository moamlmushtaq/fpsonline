// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — rotate-device prompt + landscape lock.
//
//  • Touch devices held in portrait get a full-screen, in-style prompt: an
//    analog dial with a phone that turns to landscape, a short line of text
//    (en/ar through i18n), and — mid-match — a "controls paused" chip. Phones
//    see it everywhere; tablets (whose menus work in portrait) only in a match.
//    While it is up, gameplay input is suspended (Input.setSuspended), so a
//    thumb resting on the glass never fires or walks.
//  • On the first tap of a touch-first device we try requestFullscreen() and
//    then screen.orientation.lock('landscape') (Android Chrome). iOS has no
//    element fullscreen on iPhone / no orientation lock: everything is feature-
//    detected and fails silently; the prompt does the job there.
//  • Replaces the static CSS-only prompt of index.html (hidden via a root
//    class, so the markup can stay as the no-JS fallback).
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../app';
import { i18n, t } from './i18n';

const CSS = `
html.hf-rotate-js .rotate-prompt{display:none!important}
.hf-rotate{position:fixed;inset:0;z-index:1200;display:none;place-items:center;text-align:center;padding:calc(env(safe-area-inset-top,0px) + 24px) calc(env(safe-area-inset-right,0px) + 24px) calc(env(safe-area-inset-bottom,0px) + 24px) calc(env(safe-area-inset-left,0px) + 24px);
  background:radial-gradient(120% 70% at 50% 108%,rgba(214,132,78,.42) 0%,rgba(92,54,52,.35) 34%,rgba(0,0,0,0) 62%),linear-gradient(180deg,#1a171c 0%,#231c22 55%,#2f2227 100%);
  color:var(--c-text,#f3ece0);touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;opacity:0;transition:opacity 280ms cubic-bezier(.2,.8,.2,1);font-family:var(--f-ui,'Space Grotesk',system-ui,sans-serif)}
.hf-rotate.is-on{display:grid}
.hf-rotate.is-vis{opacity:1}
.hf-rotate::before{content:'';position:absolute;inset:auto 0 18% 0;height:1px;background:linear-gradient(90deg,transparent,rgba(243,236,224,.14),transparent)}
.hf-rotate__card{position:relative;max-width:22rem;transform:translateY(8px);transition:transform 380ms cubic-bezier(.2,.8,.2,1)}
.hf-rotate.is-vis .hf-rotate__card{transform:none}
.hf-rotate__dial{position:relative;width:9.5rem;height:9.5rem;margin:0 auto 1.6rem}
.hf-rotate__dial svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.hf-rotate__ticks{stroke:rgba(243,236,224,.36);stroke-width:1;fill:none;animation:hf-rot-spin 24s linear infinite}
.hf-rotate__arc{fill:none;stroke:var(--c-accent,#f0b35b);stroke-width:1.6;stroke-linecap:round;stroke-dasharray:60 200;animation:hf-rot-arc 3.2s cubic-bezier(.2,.8,.2,1) infinite}
.hf-rotate__arrow{fill:var(--c-accent,#f0b35b);animation:hf-rot-fade 3.2s cubic-bezier(.2,.8,.2,1) infinite}
.hf-rotate__phone{transform-origin:50px 50px;animation:hf-rot-phone 3.2s cubic-bezier(.65,0,.35,1) infinite}
.hf-rotate__phone rect{fill:rgba(243,236,224,.05);stroke:var(--c-text,#f3ece0);stroke-width:1.6}
.hf-rotate__phone .scr{fill:none;stroke:rgba(243,236,224,.28);stroke-width:1}
.hf-rotate__phone .dot{fill:var(--c-accent,#f0b35b)}
.hf-rotate__eyebrow{font-family:var(--f-mono,'JetBrains Mono',monospace);font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;color:var(--c-accent,#f0b35b);margin-bottom:.5rem}
html[lang='ar'] .hf-rotate__eyebrow{letter-spacing:0;font-family:var(--f-arabic,'IBM Plex Sans Arabic',sans-serif);font-size:.8rem}
.hf-rotate h2{font-size:1.45rem;font-weight:700;letter-spacing:.01em;margin:0 0 .5rem}
.hf-rotate p{margin:0 auto;max-width:19rem;font-size:.95rem;line-height:1.45;color:var(--c-text-dim,rgba(243,236,224,.62))}
.hf-rotate__chip{display:none;margin:1.1rem auto 0;width:max-content;align-items:center;gap:.5rem;padding:.35rem .8rem;border-radius:999px;border:1px solid rgba(243,236,224,.22);background:rgba(24,22,20,.5);font-size:.78rem;color:var(--c-text-dim,rgba(243,236,224,.62))}
.hf-rotate__chip i{width:.45rem;height:.45rem;border-radius:50%;background:var(--c-accent,#f0b35b);box-shadow:0 0 8px rgba(240,179,91,.7);animation:hf-rot-blink 1.4s ease-in-out infinite}
.hf-rotate.in-match .hf-rotate__chip{display:inline-flex}
.hf-rotate__fs{display:none;margin:1.4rem auto 0;min-height:48px;padding:0 1.4rem;border-radius:999px;border:1px solid rgba(240,179,91,.6);background:linear-gradient(180deg,rgba(240,179,91,.2),rgba(240,179,91,.08));color:var(--c-accent-hi,#f8cc80);font:600 .9rem/1 var(--f-ui,'Space Grotesk',sans-serif);letter-spacing:.04em;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:transform 140ms cubic-bezier(.2,.8,.2,1),background-color 140ms}
.hf-rotate__fs:active{transform:scale(.97);background:rgba(240,179,91,.28)}
.hf-rotate.can-fs .hf-rotate__fs{display:inline-flex;align-items:center;gap:.55rem}
.hf-rotate__fs svg{width:1.05rem;height:1.05rem;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
@keyframes hf-rot-phone{0%,18%{transform:rotate(0deg)}48%,78%{transform:rotate(-90deg)}100%{transform:rotate(0deg)}}
@keyframes hf-rot-arc{0%,14%{stroke-dashoffset:60;opacity:0}24%{opacity:1}48%{stroke-dashoffset:0;opacity:1}70%,100%{stroke-dashoffset:0;opacity:0}}
@keyframes hf-rot-fade{0%,40%{opacity:0}50%,66%{opacity:1}80%,100%{opacity:0}}
@keyframes hf-rot-spin{to{transform:rotate(360deg)}}
@keyframes hf-rot-blink{0%,100%{opacity:1}50%{opacity:.35}}
.hf-rotate__ticks{transform-origin:50px 50px}
@media (prefers-reduced-motion: reduce){.hf-rotate__phone{animation:none;transform:rotate(-90deg)}.hf-rotate__ticks,.hf-rotate__arc,.hf-rotate__arrow,.hf-rotate__chip i{animation:none}.hf-rotate__arc,.hf-rotate__arrow{opacity:1;stroke-dashoffset:0}}
`;

function dialSvg(): string {
  let ticks = '';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const r0 = i % 5 === 0 ? 43 : 45.5;
    ticks += `M${(50 + Math.cos(a) * r0).toFixed(2)} ${(50 + Math.sin(a) * r0).toFixed(2)}L${(50 + Math.cos(a) * 48).toFixed(2)} ${(50 + Math.sin(a) * 48).toFixed(2)}`;
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
  <path class="hf-rotate__ticks" d="${ticks}"/>
  <path class="hf-rotate__arc" pathLength="60" d="M68 22A32 32 0 0 0 26 30"/>
  <path class="hf-rotate__arrow" d="M26 30l-1.2-6.2 6.1 2.4z"/>
  <g class="hf-rotate__phone"><rect x="38" y="27" width="24" height="46" rx="4.5"/><path class="scr" d="M41 32.5h18v33H41z"/><circle class="dot" cx="50" cy="69.3" r="1.1"/></g>
</svg>`;
}

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsDocument = Document & { webkitFullscreenElement?: Element | null };
type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

function fullscreenSupported(): boolean {
  const el = document.documentElement as FsElement;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

function isFullscreen(): boolean {
  const d = document as FsDocument;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Enters fullscreen (from a user gesture) and locks landscape where supported. Never throws. */
export async function enterLandscapeFullscreen(): Promise<boolean> {
  try {
    if (!isFullscreen()) {
      const el = document.documentElement as FsElement;
      if (typeof el.requestFullscreen === 'function') await el.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
      else if (typeof el.webkitRequestFullscreen === 'function') await el.webkitRequestFullscreen();
      else return false;
    }
  } catch {
    return false;
  }
  try {
    const o = (screen.orientation ?? null) as LockableOrientation | null;
    if (o && typeof o.lock === 'function') await o.lock('landscape');
  } catch {
    /* orientation lock unsupported (desktop, iOS) or refused: the prompt covers it */
  }
  return true;
}

/** Touch-first device (phone / tablet), as opposed to a laptop with a touchscreen. */
function touchFirst(app: App): boolean {
  try {
    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) return true;
  } catch {
    /* no matchMedia */
  }
  return app.input.device === 'touch' && (navigator.maxTouchPoints ?? 0) > 0;
}

function isPhone(): boolean {
  const sw = Math.min(screen.width || innerWidth, screen.height || innerHeight);
  return sw < 600 || Math.min(innerWidth, innerHeight) < 600;
}

export class RotatePrompt {
  private readonly el: HTMLDivElement;
  private shown = false;
  private hideTimer = 0;
  private readonly timer: number;
  private triedFs = false;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly app: App) {
    if (!document.getElementById('hf-rotate-css')) {
      const st = document.createElement('style');
      st.id = 'hf-rotate-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    document.documentElement.classList.add('hf-rotate-js');
    this.el = document.createElement('div');
    this.el.className = 'hf-rotate';
    this.el.setAttribute('role', 'alertdialog');
    this.el.setAttribute('aria-live', 'assertive');
    this.el.innerHTML = `<div class="hf-rotate__card">
      <div class="hf-rotate__dial">${dialSvg()}</div>
      <div class="hf-rotate__eyebrow" data-k="controls.rotate.eyebrow"></div>
      <h2 data-k="controls.rotate.title"></h2>
      <p data-k="controls.rotate.body"></p>
      <div class="hf-rotate__chip"><i></i><span data-k="controls.rotate.paused"></span></div>
      <button type="button" class="hf-rotate__fs"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg><span data-k="controls.rotate.fullscreen"></span></button>
    </div>`;
    this.el.id = 'hf-rotate';
    this.el.setAttribute('aria-labelledby', 'hf-rotate-title');
    this.el.querySelector('h2')?.setAttribute('id', 'hf-rotate-title');
    this.el.querySelector('.hf-rotate__fs')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.audio.ui('confirm');
      void enterLandscapeFullscreen().then(() => this.evaluate());
    });
    // Swallow touches so nothing underneath reacts (and no scroll / zoom).
    const block = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.('.hf-rotate__fs')) return;
      if (e.cancelable) e.preventDefault();
    };
    this.el.addEventListener('touchstart', block, { passive: false });
    this.el.addEventListener('touchmove', block, { passive: false });
    document.body.appendChild(this.el);
    this.translate();
    this.offs.push(i18n.onChange(() => this.translate()));
    this.offs.push(app.input.onDeviceChange(() => this.evaluate()));
    const onChange = () => this.evaluate();
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    this.offs.push(() => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
    });
    // First tap on a touch-first device: fullscreen + landscape lock (Android).
    const firstTap = () => {
      if (this.triedFs) return;
      if (!touchFirst(this.app) || !fullscreenSupported()) return;
      this.triedFs = true;
      window.removeEventListener('touchend', firstTap, true);
      void enterLandscapeFullscreen().then(() => this.evaluate());
    };
    window.addEventListener('touchend', firstTap, { capture: true, passive: true });
    this.offs.push(() => window.removeEventListener('touchend', firstTap, true));
    // Match start/end changes whether tablets need the prompt: a cheap poll keeps this decoupled.
    this.timer = window.setInterval(() => this.evaluate(), 400);
    this.evaluate();
  }

  private translate(): void {
    this.el.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => {
      n.textContent = t(n.dataset.k as string);
    });
  }

  /** Whether the prompt should be up right now. */
  private wanted(): boolean {
    if (!touchFirst(this.app)) return false;
    const portrait = innerHeight > innerWidth * 1.05;
    if (!portrait) return false;
    return isPhone() || this.app.inMatch;
  }

  evaluate(): void {
    const want = this.wanted();
    const inMatch = this.app.inMatch;
    this.el.classList.toggle('in-match', inMatch);
    this.el.classList.toggle('can-fs', fullscreenSupported() && !isFullscreen());
    if (want === this.shown) {
      this.app.input.setSuspended(want);
      return;
    }
    this.shown = want;
    this.app.input.setSuspended(want);
    window.clearTimeout(this.hideTimer);
    if (want) {
      this.el.classList.add('is-on');
      requestAnimationFrame(() => this.el.classList.add('is-vis'));
    } else {
      this.el.classList.remove('is-vis');
      this.hideTimer = window.setTimeout(() => this.el.classList.remove('is-on'), 300);
    }
  }

  get visible(): boolean {
    return this.shown;
  }

  dispose(): void {
    window.clearInterval(this.timer);
    window.clearTimeout(this.hideTimer);
    for (const off of this.offs) off();
    this.app.input.setSuspended(false);
    this.el.remove();
    document.documentElement.classList.remove('hf-rotate-js');
  }
}

let instance: RotatePrompt | null = null;

/** Installs the prompt once (App constructor hook). */
export function installRotatePrompt(app: App): RotatePrompt {
  if (!instance) instance = new RotatePrompt(app);
  return instance;
}
