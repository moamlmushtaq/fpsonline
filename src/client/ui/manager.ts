// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — UI manager: screen router, overlay stack, back handling,
// toasts, confirm modal, spatial keyboard/gamepad navigation and UI sounds.
//
// Layers (bottom → top): base screen · overlays (pause, in-match settings) ·
// modal · toasts. Transitions are CSS animations (220–380 ms, ease
// cubic-bezier(.2,.8,.2,1)); they are serialized so rapid input never leaves
// two screens half-mounted. Back comes from Escape, gamepad B and the Android
// back button (one history "guard" entry is kept while not on the root menu).
// ─────────────────────────────────────────────────────────────────────────────

import type { Screen, ScreenId, UIManager, UiSound } from '../contracts';
import type { App } from '../app';
import { captureState, h } from './components';
import { i18n, setText } from './i18n';
import { icon } from './icons';
import { MenuScreen } from './screens/menu';
import { PlayScreen } from './screens/play';
import { MatchmakingScreen } from './screens/matchmaking';
import { RoomScreen } from './screens/room';
import { LoadoutScreen } from './screens/loadout';
import { CustomizeScreen } from './screens/customize';
import { SettingsScreen } from './screens/settings';
import { ProfileScreen } from './screens/profile';
import { LoadingScreen } from './screens/loading';
import { ResultsScreen } from './screens/results';
import { PauseScreen } from './screens/pause';
import { MatchScreen } from './screens/match';

type Transition = 'fwd' | 'back' | 'fade' | 'none';

const FACTORIES: Record<ScreenId, (app: App) => Screen> = {
  menu: (a) => new MenuScreen(a),
  play: (a) => new PlayScreen(a),
  matchmaking: (a) => new MatchmakingScreen(a),
  room: (a) => new RoomScreen(a),
  loadout: (a) => new LoadoutScreen(a),
  customize: (a) => new CustomizeScreen(a),
  settings: (a) => new SettingsScreen(a),
  profile: (a) => new ProfileScreen(a),
  loading: (a) => new LoadingScreen(a),
  results: (a) => new ResultsScreen(a),
  pause: (a) => new PauseScreen(a),
  match: (a) => new MatchScreen(a),
};

/** Navigation depth: moving to a deeper screen slides forward, shallower slides back. */
const DEPTH: Partial<Record<ScreenId, number>> = {
  menu: 0,
  play: 1,
  loadout: 1,
  customize: 1,
  settings: 1,
  profile: 1,
  matchmaking: 2,
  room: 2,
};

const FADE_SCREENS = new Set<ScreenId>(['loading', 'match', 'results']);
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

interface ModalState {
  el: HTMLElement;
  resolve: (ok: boolean) => void;
}

export class UI implements UIManager {
  private readonly app: App;
  private readonly root: HTMLElement;
  private readonly baseLayer: HTMLElement;
  private readonly overlayLayer: HTMLElement;
  private readonly toastLayer: HTMLElement;
  private readonly screens = new Map<ScreenId, Screen>();
  private base: ScreenId | null = null;
  private overlays: ScreenId[] = [];
  private queue: Promise<void> = Promise.resolve();
  private modal: ModalState | null = null;
  private listeners = new Set<(base: ScreenId | null, top: ScreenId | null) => void>();
  private lastHover: Element | null = null;
  private lastHoverAt = 0;
  private guardActive = false;
  private pad = { prev: new Map<number, boolean>(), repeatAt: 0, dirHeld: '' as '' | 'up' | 'down' | 'left' | 'right' };
  private lastInputWasPointer = true;

  constructor(root: HTMLElement, app: App) {
    this.app = app;
    this.root = root;
    root.classList.add('ui-root');
    this.baseLayer = h('div', { class: 'layer layer--base' });
    this.overlayLayer = h('div', { class: 'layer layer--overlay' });
    this.toastLayer = h('div', { class: 'toasts', attrs: { 'aria-live': 'polite' } });
    root.append(this.baseLayer, this.overlayLayer, this.toastLayer);

    window.addEventListener('keydown', (e) => this.onKey(e));
    root.addEventListener('pointerover', (e) => this.onPointerOver(e));
    root.addEventListener('click', (e) => this.onClickSfx(e));
    root.addEventListener('hf-sfx', (e) => this.sfx((e as CustomEvent<UiSound>).detail));
    window.addEventListener('pointerdown', () => (this.lastInputWasPointer = true), true);
    window.addEventListener('popstate', () => this.onPopState());
    try {
      history.replaceState({ hf: 'root' }, '');
    } catch {
      /* sandboxed iframes */
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get current(): ScreenId | null {
    return this.overlays.length ? this.overlays[this.overlays.length - 1] : this.base;
  }

  get baseScreen(): ScreenId | null {
    return this.base;
  }

  get overlayCount(): number {
    return this.overlays.length;
  }

  /** Subscribe to screen changes (base screen, top-most screen). */
  onChange(cb: (base: ScreenId | null, top: ScreenId | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** The screen instance (created lazily). */
  screen<T extends Screen = Screen>(id: ScreenId): T {
    let s = this.screens.get(id);
    if (!s) {
      s = FACTORIES[id](this.app);
      s.el.classList.add('screen', `screen--${id}`);
      s.el.dataset.screen = id;
      this.screens.set(id, s);
    }
    return s as T;
  }

  show(id: ScreenId, params?: unknown): Promise<void> {
    return this.enqueue(() => this.doShow(id, params));
  }

  push(id: ScreenId, params?: unknown): Promise<void> {
    return this.enqueue(() => this.doPush(id, params));
  }

  pop(): Promise<void> {
    return this.enqueue(() => this.doPop());
  }

  toast(text: string, kind: 'info' | 'good' | 'error' = 'info'): void {
    const ic = kind === 'good' ? 'check' : kind === 'error' ? 'warning' : 'info';
    const el = h('div', { class: `toast toast--${kind}`, attrs: { role: 'status' }, html: icon(ic) });
    el.append(h('span', { text: i18n.has(text) ? i18n.t(text) : text }));
    this.toastLayer.append(el);
    while (this.toastLayer.children.length > 4) this.toastLayer.firstElementChild?.remove();
    if (kind === 'error') this.sfx('error');
    window.setTimeout(() => {
      el.classList.add('is-leaving');
      window.setTimeout(() => el.remove(), 300);
    }, kind === 'error' ? 4200 : 3000);
  }

  confirm(title: string, body: string, ok: string, cancel: string): Promise<boolean> {
    if (this.modal) this.closeModal(false);
    const tr = (s: string) => (i18n.has(s) ? i18n.t(s) : s);
    return new Promise<boolean>((resolve) => {
      const okBtn = h('button', { class: 'btn btn--primary', attrs: { type: 'button' }, text: tr(ok) });
      okBtn.dataset.sfx = 'confirm';
      const cancelBtn = h('button', { class: 'btn', attrs: { type: 'button' }, text: tr(cancel) });
      cancelBtn.dataset.sfx = 'back';
      const dialog = h(
        'div',
        { class: 'modal panel panel--strong ticks', attrs: { role: 'alertdialog', 'aria-modal': 'true' } },
        h('h2', { class: 'modal__title', text: tr(title) }),
        h('p', { class: 'modal__body', text: tr(body) }),
        h('div', { class: 'modal__actions' }, cancelBtn, okBtn),
      );
      const layer = h('div', { class: 'modal-layer' }, dialog);
      layer.addEventListener('click', (e) => this.onClickSfx(e));
      layer.addEventListener('pointerover', (e) => this.onPointerOver(e));
      layer.addEventListener('pointerdown', (e) => {
        if (e.target === layer) this.closeModal(false);
      });
      okBtn.addEventListener('click', () => this.closeModal(true));
      cancelBtn.addEventListener('click', () => this.closeModal(false));
      document.body.append(layer);
      this.modal = { el: layer, resolve };
      this.app.input?.setGameplayActive?.(false);
      requestAnimationFrame(() => (this.lastInputWasPointer ? okBtn.focus({ preventScroll: true }) : cancelBtn.focus({ preventScroll: true })));
    });
  }

  update(dt: number): void {
    const top = this.current;
    if (top) this.screens.get(top)?.update?.(dt);
    if (this.base && top !== this.base) this.screens.get(this.base)?.update?.(dt);
    this.pollGamepad();
  }

  /** Handles a back request (Escape, gamepad B, Android back). Returns true if consumed. */
  back(): boolean {
    if (captureState.active) return true;
    if (this.modal) {
      this.closeModal(false);
      return true;
    }
    const top = this.current;
    if (!top) return false;
    const s = this.screens.get(top);
    if (s?.back?.()) return true;
    if (this.overlays.length) {
      this.sfx('back');
      void this.pop();
      return true;
    }
    if (top === 'menu' || top === 'match' || top === 'loading') return false;
    this.sfx('back');
    void this.show('menu');
    return true;
  }

  /** Plays a UI sound (safe if audio is unavailable). */
  sfx(s: UiSound): void {
    try {
      this.app.audio?.ui(s);
    } catch {
      /* audio unavailable */
    }
  }

  // ── Transitions ───────────────────────────────────────────────────────────

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(job, job).catch((err) => console.error('[ui] transition failed', err));
    this.queue = run;
    return run;
  }

  private async doShow(id: ScreenId, params?: unknown): Promise<void> {
    // Showing a base screen closes every overlay.
    while (this.overlays.length) await this.doPop(true);
    const prev = this.base;
    const next = this.screen(id);
    const kind = this.transitionKind(prev, id);
    if (prev) {
      const out = this.screens.get(prev);
      if (out) {
        await out.leave();
        if (prev === id) {
          out.el.remove();
        } else {
          await this.animate(out.el, kind === 'none' ? 'none' : `leave-${kind}`);
          out.el.remove();
        }
      }
    }
    this.base = id;
    this.baseLayer.append(next.el);
    next.enter(params);
    this.emit();
    this.updateGuard();
    this.autofocus(next.el);
    await this.animate(next.el, kind === 'none' || prev === id ? 'enter-fade' : `enter-${kind}`);
  }

  private async doPush(id: ScreenId, params?: unknown): Promise<void> {
    if (this.overlays.includes(id)) return;
    const s = this.screen(id);
    s.el.classList.add('is-overlay');
    this.overlays.push(id);
    this.overlayLayer.append(s.el);
    s.enter(params);
    this.emit();
    this.updateGuard();
    this.autofocus(s.el);
    await this.animate(s.el, 'enter-overlay');
  }

  private async doPop(instant = false): Promise<void> {
    const id = this.overlays.pop();
    if (!id) return;
    const s = this.screens.get(id);
    if (s) {
      await s.leave();
      if (!instant) await this.animate(s.el, 'leave-overlay');
      s.el.remove();
      s.el.classList.remove('is-overlay');
    }
    this.emit();
    this.updateGuard();
    const top = this.current;
    if (top && !instant) this.autofocus(this.screens.get(top)!.el);
  }

  private transitionKind(from: ScreenId | null, to: ScreenId): Transition {
    if (!from) return 'fade';
    if (FADE_SCREENS.has(to) || FADE_SCREENS.has(from)) return 'fade';
    const a = DEPTH[from] ?? 1;
    const b = DEPTH[to] ?? 1;
    if (b > a) return 'fwd';
    if (b < a) return 'back';
    return 'fade';
  }

  /** Runs a CSS animation class and resolves when it ends (with a safety timeout). */
  private animate(el: HTMLElement, cls: string): Promise<void> {
    if (cls === 'none') return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.classList.remove(cls);
        el.removeEventListener('animationend', onEnd);
        resolve();
      };
      const onEnd = (e: AnimationEvent) => {
        if (e.target === el) finish();
      };
      el.addEventListener('animationend', onEnd);
      el.classList.add(cls);
      window.setTimeout(finish, 460);
    });
  }

  private emit(): void {
    document.body.dataset.screen = this.base ?? '';
    document.body.dataset.top = this.current ?? '';
    for (const cb of [...this.listeners]) {
      try {
        cb(this.base, this.current);
      } catch (err) {
        console.error('[ui] listener failed', err);
      }
    }
  }

  private closeModal(ok: boolean): void {
    const m = this.modal;
    if (!m) return;
    this.modal = null;
    m.el.classList.add('is-leaving');
    window.setTimeout(() => m.el.remove(), 280);
    m.resolve(ok);
    const top = this.current;
    if (top) this.autofocus(this.screens.get(top)!.el);
  }

  // ── Back / history guard ─────────────────────────────────────────────────

  /** Keeps one extra history entry while back has something to do in-app. */
  private updateGuard(): void {
    const needs = this.overlays.length > 0 || (this.base !== null && this.base !== 'menu' && this.base !== 'loading');
    if (needs && !this.guardActive) {
      try {
        history.pushState({ hf: 'guard' }, '');
        this.guardActive = true;
      } catch {
        /* ignore */
      }
    }
  }

  private onPopState(): void {
    // The guard entry was consumed by the browser/OS back gesture.
    this.guardActive = false;
    this.back();
    this.updateGuard();
  }

  // ── Keyboard & gamepad navigation ────────────────────────────────────────

  private scope(): HTMLElement | null {
    if (this.modal) return this.modal.el;
    const top = this.current;
    return top ? this.screens.get(top)?.el ?? null : null;
  }

  private navActive(): boolean {
    // In gameplay (match screen with no overlay) the keys belong to the game.
    return !(this.current === 'match' && !this.modal);
  }

  private onKey(e: KeyboardEvent): void {
    if (captureState.active) return;
    this.lastInputWasPointer = false;
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && (target as HTMLInputElement).type !== 'range';
    if (e.key === 'Escape') {
      if (typing) {
        target.blur();
        e.preventDefault();
        return;
      }
      if (this.current === 'match' && !this.modal) {
        // Escape in gameplay opens pause (pointer-locked browsers swallow it; App also watches pointerlockchange).
        if (this.back()) e.preventDefault();
        return;
      }
      if (this.back()) e.preventDefault();
      return;
    }
    if (!this.navActive()) return;
    const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : null;
    if (!dir) return;
    if (typing && (dir === 'left' || dir === 'right')) return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.dataset.navLr === 'own' && (dir === 'left' || dir === 'right')) return;
    if (this.moveFocus(dir)) e.preventDefault();
  }

  private focusables(scope: HTMLElement): HTMLElement[] {
    const out: HTMLElement[] = [];
    scope.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
      if (el.getAttribute('aria-hidden') === 'true') return;
      if (el.closest('[inert]')) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
        // Off-screen items inside scrollers are still navigable.
        if (!el.closest('.scroll')) return;
      }
      out.push(el);
    });
    return out;
  }

  /** Spatial navigation: picks the nearest focusable in the pressed direction. */
  moveFocus(dir: 'up' | 'down' | 'left' | 'right'): boolean {
    const scope = this.scope();
    if (!scope) return false;
    const items = this.focusables(scope);
    if (!items.length) return false;
    const active = document.activeElement as HTMLElement | null;
    if (!active || !scope.contains(active) || active === document.body) {
      const first = scope.querySelector<HTMLElement>('[data-autofocus]') ?? items[0];
      first.focus({ preventScroll: false });
      this.sfx('hover');
      return true;
    }
    const a = active.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === active) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let primary: number;
      let ortho: number;
      let overlap: boolean;
      switch (dir) {
        case 'right':
          primary = r.left - a.right;
          if (cx <= ax + 1) continue;
          ortho = Math.abs(cy - ay);
          overlap = r.bottom > a.top && r.top < a.bottom;
          break;
        case 'left':
          primary = a.left - r.right;
          if (cx >= ax - 1) continue;
          ortho = Math.abs(cy - ay);
          overlap = r.bottom > a.top && r.top < a.bottom;
          break;
        case 'down':
          primary = r.top - a.bottom;
          if (cy <= ay + 1) continue;
          ortho = Math.abs(cx - ax);
          overlap = r.right > a.left && r.left < a.right;
          break;
        default:
          primary = a.top - r.bottom;
          if (cy >= ay - 1) continue;
          ortho = Math.abs(cx - ax);
          overlap = r.right > a.left && r.left < a.right;
      }
      const score = Math.max(0, primary) + ortho * (overlap ? 0.3 : 2.2);
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) return false;
    best.focus({ preventScroll: true });
    best.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    this.sfx('hover');
    return true;
  }

  private autofocus(scope: HTMLElement): void {
    // Only move focus for keyboard/gamepad users; mouse users never see stray focus rings.
    if (this.lastInputWasPointer) return;
    requestAnimationFrame(() => {
      const target = scope.querySelector<HTMLElement>('[data-autofocus]') ?? this.focusables(scope)[0];
      target?.focus({ preventScroll: true });
    });
  }

  private pollGamepad(): void {
    if (!this.navActive() || typeof navigator.getGamepads !== 'function') return;
    let pads: (Gamepad | null)[];
    try {
      pads = navigator.getGamepads();
    } catch {
      return;
    }
    const now = performance.now();
    let dir: '' | 'up' | 'down' | 'left' | 'right' = '';
    const pressedNow = new Map<number, boolean>();
    for (const p of pads) {
      if (!p || !p.connected) continue;
      p.buttons.forEach((b, i) => {
        if (b.pressed) pressedNow.set(i, true);
      });
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      if (p.buttons[12]?.pressed || ay < -0.55) dir = 'up';
      else if (p.buttons[13]?.pressed || ay > 0.55) dir = 'down';
      else if (p.buttons[14]?.pressed || ax < -0.55) dir = 'left';
      else if (p.buttons[15]?.pressed || ax > 0.55) dir = 'right';
    }
    const edge = (i: number) => pressedNow.get(i) && !this.pad.prev.get(i);
    if (pressedNow.size) this.lastInputWasPointer = false;
    if (edge(0)) {
      const active = document.activeElement as HTMLElement | null;
      const scope = this.scope();
      if (active && scope?.contains(active)) active.click();
      else this.moveFocus('down');
    }
    if (edge(1)) this.back();
    if (edge(4) || edge(5)) this.cycleTabs(edge(5) ? 1 : -1);
    if (dir) {
      if (dir !== this.pad.dirHeld) {
        this.pad.dirHeld = dir;
        this.pad.repeatAt = now + 380;
        this.padMove(dir);
      } else if (now >= this.pad.repeatAt) {
        this.pad.repeatAt = now + 110;
        this.padMove(dir);
      }
    } else this.pad.dirHeld = '';
    this.pad.prev = pressedNow;
  }

  private padMove(dir: 'up' | 'down' | 'left' | 'right'): void {
    const active = document.activeElement as HTMLElement | null;
    // Gamepad left/right on a slider nudges its value.
    if (active instanceof HTMLInputElement && active.type === 'range' && (dir === 'left' || dir === 'right')) {
      const step = Number(active.step) || 1;
      const rtl = i18n.dir === 'rtl';
      const sign = (dir === 'right') !== rtl ? 1 : -1;
      const v = Math.min(Number(active.max), Math.max(Number(active.min), Number(active.value) + sign * step));
      active.value = String(v);
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    this.moveFocus(dir);
  }

  private cycleTabs(d: number): void {
    const scope = this.scope();
    const tabs = scope ? Array.from(scope.querySelectorAll<HTMLElement>('.tabs .tab')) : [];
    if (!tabs.length) return;
    const i = tabs.findIndex((t) => t.classList.contains('is-active'));
    const step = i18n.dir === 'rtl' ? -d : d;
    tabs[(i + step + tabs.length) % tabs.length].click();
  }

  // ── Sound delegation ──────────────────────────────────────────────────────

  private onPointerOver(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as Element | null)?.closest?.('[data-sfx]');
    if (!el || el === this.lastHover) return;
    this.lastHover = el;
    if (el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled) return;
    const now = performance.now();
    if (now - this.lastHoverAt < 45) return;
    this.lastHoverAt = now;
    this.sfx('hover');
  }

  private onClickSfx(e: MouseEvent): void {
    const el = (e.target as Element | null)?.closest?.('[data-sfx]') as HTMLElement | null;
    if (!el) return;
    if (el.getAttribute('aria-disabled') === 'true') return;
    this.sfx((el.dataset.sfx as UiSound) || 'click');
  }
}

/** Convenience used by screens to label things with a translated string in one call. */
export function label(el: HTMLElement, key: string, params?: Record<string, string | number>): HTMLElement {
  return setText(el, key, params);
}
