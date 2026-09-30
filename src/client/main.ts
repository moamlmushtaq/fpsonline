// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — entry point.
//
// index.html paints the boot splash instantly (inline critical CSS). Here we:
// load fonts + styles, check WebGL, lazily import and start the App, then fade
// the splash out once the menu has rendered. Fatal problems (no WebGL, boot
// crash, unrecoverable GPU reset) get an in-style overlay with a reload button.
// ─────────────────────────────────────────────────────────────────────────────

import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import './ui/styles/tokens.css';
import './ui/styles/base.css';
import './ui/styles/components.css';
import './ui/styles/screens.css';
import './ui/styles/hud.css';

import { i18n } from './ui/i18n';
import { settings } from './state/settings';
import { logoMarkSvg } from './ui/brand';
import type { App } from './app';

declare global {
  interface Window {
    __hfBoot?: (k: number) => void;
    __hfApp?: App;
  }
}

let booted = false;
let fatalShown = false;
let lastToast = 0;

function progress(k: number): void {
  window.__hfBoot?.(k);
}

function hideSplash(): void {
  const splash = document.getElementById('boot');
  if (!splash) return;
  splash.classList.add('is-done');
  window.setTimeout(() => splash.remove(), 700);
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** In-style full-screen message with Reload (and optionally Continue). */
function showFatal(kind: 'webgl' | 'crash', detail?: unknown, canContinue = false): void {
  if (fatalShown) return;
  fatalShown = true;
  hideSplash();
  const wrap = document.createElement('div');
  wrap.className = 'fatal';
  wrap.setAttribute('role', 'alertdialog');
  const card = document.createElement('div');
  card.className = 'fatal__card';
  card.innerHTML = logoMarkSvg('fatal__mark');
  const title = document.createElement('h1');
  title.className = 'fatal__title';
  title.textContent = i18n.t(kind === 'webgl' ? 'errors.webgl.title' : 'errors.crash.title');
  const body = document.createElement('p');
  body.className = 'fatal__body';
  body.textContent = i18n.t(kind === 'webgl' ? 'errors.webgl.body' : 'errors.crash.body');
  card.append(title, body);
  if (detail && kind === 'crash') {
    const pre = document.createElement('pre');
    pre.className = 'fatal__detail';
    pre.textContent = detail instanceof Error ? `${detail.name}: ${detail.message}` : String(detail);
    card.append(pre);
  }
  const actions = document.createElement('div');
  actions.className = 'fatal__actions';
  const reload = document.createElement('button');
  reload.className = 'btn btn--primary';
  reload.type = 'button';
  reload.textContent = i18n.t('common.reload');
  reload.addEventListener('click', () => location.reload());
  actions.append(reload);
  if (canContinue) {
    const cont = document.createElement('button');
    cont.className = 'btn';
    cont.type = 'button';
    cont.textContent = i18n.t('common.continue');
    cont.addEventListener('click', () => {
      wrap.remove();
      fatalShown = false;
    });
    actions.append(cont);
  }
  card.append(actions);
  wrap.append(card);
  document.body.append(wrap);
  reload.focus();
}

function onRuntimeError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  // Benign browser noise.
  if (/ResizeObserver loop|Script error\.?$|The play\(\) request|AbortError/i.test(msg)) return;
  console.error('[halcyon] uncaught', err);
  if (!booted) {
    showFatal('crash', err);
    return;
  }
  // After boot: never interrupt play for a recoverable error — a quiet toast at most.
  const now = performance.now();
  if (now - lastToast > 15000) {
    lastToast = now;
    window.__hfApp?.ui.toast('errors.generic', 'error');
  }
}

window.addEventListener('error', (e) => onRuntimeError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => onRuntimeError(e.reason));

async function boot(): Promise<void> {
  i18n.setLang(settings.value.lang);
  const params = new URLSearchParams(location.search);
  const urlLang = params.get('lang');
  if (urlLang === 'ar' || urlLang === 'en') i18n.setLang(urlLang);
  progress(0.25);
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const root = document.getElementById('ui');
  if (!canvas || !root) throw new Error('index.html is missing #game or #ui');
  // Unrecoverable GPU resets: if the context does not come back, offer a reload.
  canvas.addEventListener('webglcontextlost', () => {
    window.setTimeout(() => {
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl || gl.isContextLost()) showFatal('crash', i18n.t('errors.contextLost'), true);
    }, 4000);
  });
  progress(0.45);
  const { App } = await import('./app');
  progress(0.75);
  let app: App;
  try {
    app = new App(canvas, root);
  } catch (err) {
    // Only probe for WebGL when the renderer could not start: a throw-away test
    // context up front costs a noticeable slice of boot time on every visit.
    if (!hasWebGL()) {
      showFatal('webgl');
      return;
    }
    throw err;
  }
  window.__hfApp = app;
  progress(0.9);
  await app.start();
  progress(1);
  booted = true;
  hideSplash();
}

boot().catch((err) => {
  console.error('[halcyon] boot failed', err);
  showFatal('crash', err);
});
