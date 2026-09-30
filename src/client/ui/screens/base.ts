// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — base class for screens.
//
// A screen owns one root element for its whole life. Content is (re)built in
// enter() so staggered entrance animations replay every visit; everything
// registered through `track()` (listeners, timers, subscriptions) is released
// automatically in leave().
// ─────────────────────────────────────────────────────────────────────────────

import type { Screen, ScreenId } from '../../contracts';
import type { App } from '../../app';
import { h } from '../components';

export abstract class BaseScreen implements Screen {
  abstract readonly id: ScreenId;
  readonly el: HTMLElement;
  protected readonly app: App;
  private disposers: (() => void)[] = [];

  constructor(app: App, cls = '') {
    this.app = app;
    this.el = h('section', { class: cls });
  }

  enter(params?: unknown): void {
    this.el.replaceChildren();
    this.build(params);
  }

  leave(): void | Promise<void> {
    for (const d of this.disposers.splice(0)) {
      try {
        d();
      } catch (err) {
        console.error('[ui] screen cleanup failed', err);
      }
    }
  }

  /** Builds the screen content (called on every enter). */
  protected abstract build(params?: unknown): void;

  /** Registers a cleanup to run on leave. */
  protected track(off: (() => void) | undefined | null): void {
    if (off) this.disposers.push(off);
  }

  protected interval(fn: () => void, ms: number): void {
    const id = window.setInterval(fn, ms);
    this.track(() => window.clearInterval(id));
  }

  protected timeout(fn: () => void, ms: number): void {
    const id = window.setTimeout(fn, ms);
    this.track(() => window.clearTimeout(id));
  }

  protected listen<K extends keyof WindowEventMap>(target: Window, ev: K, fn: (e: WindowEventMap[K]) => void): void;
  protected listen(target: EventTarget, ev: string, fn: (e: Event) => void): void;
  protected listen(target: EventTarget, ev: string, fn: (e: never) => void): void {
    target.addEventListener(ev, fn as EventListener);
    this.track(() => target.removeEventListener(ev, fn as EventListener));
  }
}
