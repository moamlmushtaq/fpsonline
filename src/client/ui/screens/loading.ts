// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — loading screen: full-bleed painted key art of the map,
// map + mode title, rotating lore tips and an analog progress dial.
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../../app';
import type { MapId, ModeId } from '../../../shared/types';
import { dialSvg, h, progressRing, stagger } from '../components';
import { setText } from '../i18n';
import { keyArt, keyArtReady } from '../keyart';
import { BaseScreen } from './base';

const TIP_COUNT = 18;

export class LoadingScreen extends BaseScreen {
  readonly id = 'loading' as const;
  private target = 0;
  private shown = 0;
  private reported = false;
  private ring: { el: SVGSVGElement; set: (f: number) => void } | null = null;
  private pct: HTMLElement | null = null;

  constructor(app: App) {
    super(app, '');
  }

  protected build(params?: unknown): void {
    const p = (params ?? {}) as { map?: MapId; mode?: ModeId };
    const map = p.map ?? 'gantry';
    const mode = p.mode ?? 'tdm';
    this.target = 0;
    this.shown = 0;
    this.reported = false;

    const art = h('div', { class: 'loading__art' });
    const ready = keyArtReady(map, 'full');
    const setArt = (url: string) => {
      if (!url || !art.isConnected) return;
      art.style.backgroundImage = `url("${url}")`;
      requestAnimationFrame(() => art.classList.add('is-ready'));
    };
    if (ready) setArt(ready);
    else {
      // The full painting is made off-thread and may take a moment: show the
      // (already prewarmed) thumbnail right away, then swap in the full art.
      const thumb = keyArtReady(map, 'thumb');
      void keyArt(map, 'full').then(setArt);
      if (thumb) queueMicrotask(() => setArt(thumb));
    }

    const title = h(
      'div',
      { class: 'loading__title' },
      h('div', { class: 'eyebrow', t: 'loading.deploying' }),
      h('div', { class: 'loading__map', t: `map.${map}.name` }),
      h('div', { class: 'loading__mode', t: `mode.${mode}.name` }),
      h('p', { class: 'loading__desc', t: `map.${map}.desc` }),
    );

    let tip = 1 + Math.floor(Math.random() * TIP_COUNT);
    const tipText = h('p', { t: `tips.${tip}` });
    const tipPanel = h('div', { class: 'loading__tip panel ticks' }, h('div', { class: 'eyebrow', t: 'loading.fieldNote' }), tipText);
    this.interval(() => {
      tipText.classList.add('is-fading');
      window.setTimeout(() => {
        tip = (tip % TIP_COUNT) + 1;
        setText(tipText, `tips.${tip}`);
        tipText.classList.remove('is-fading');
      }, 400);
    }, 6000);

    this.ring = progressRing(88, 3, 0);
    this.pct = h('div', { class: 'loading__pct', text: '0%' });
    const dial = h('div', { class: 'loading__dial', html: dialSvg({ size: 88, ticks: 48, needle: false }) }, this.ring.el, this.pct);
    this.ring.el.style.position = 'absolute';
    this.ring.el.style.inset = '0';

    const content = h('div', { class: 'loading__content' }, title, tipPanel, dial);
    this.el.append(art, h('div', { class: 'loading__shade' }), content);
    stagger([title, tipPanel, dial]);
  }

  /** 0..1 real loading progress (from the match); without reports the dial creeps to 90%. */
  setProgress(k: number): void {
    this.reported = true;
    this.target = Math.max(this.target, Math.min(1, k));
  }

  update(dt: number): void {
    if (!this.reported) this.target = Math.min(0.9, this.target + dt * 0.35 * (1 - this.target));
    this.shown += (this.target - this.shown) * Math.min(1, dt * 6);
    this.ring?.set(this.shown);
    const s = `${Math.round(this.shown * 100)}%`;
    if (this.pct && this.pct.textContent !== s) this.pct.textContent = s;
  }

  back(): boolean {
    return true;
  }
}
