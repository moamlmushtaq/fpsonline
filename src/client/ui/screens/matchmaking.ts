// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — matchmaking: analog "scanning" dial, elapsed time, humans
// found (pips), bot-fill hint and cancel. Driven by queueStatus messages.
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../../app';
import type { QueueStatusMsg } from '../../../shared/protocol';
import type { ModeId } from '../../../shared/types';
import { MODES } from '../../../shared/modes';
import { button, dialSvg, h, stagger } from '../components';
import { clock, setText } from '../i18n';
import { BaseScreen } from './base';

export class MatchmakingScreen extends BaseScreen {
  readonly id = 'matchmaking' as const;
  private started = 0;
  private elapsedBase = 0;
  private timeEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private humansEl: HTMLElement | null = null;
  private pips: HTMLElement | null = null;
  private found = false;
  private size = 10;

  constructor(app: App) {
    super(app, '');
  }

  protected build(params?: unknown): void {
    const p = (params ?? {}) as { mode?: ModeId };
    const mode = p.mode ?? 'tdm';
    this.size = MODES[mode]?.maxPlayers ?? 10;
    this.started = performance.now();
    this.elapsedBase = 0;
    this.found = false;
    this.el.classList.remove('is-found');

    const dial = h('div', { class: 'mm__dial', html: dialSvg({ size: 192, ticks: 60, needle: false }) });
    dial.prepend(h('div', { class: 'mm__sweep' }));
    this.timeEl = h('div', { class: 'mm__time', text: '0:00' });
    dial.append(this.timeEl);
    this.statusEl = h('div', { class: 'mm__status', t: 'play.mm.searching' });
    const modeEl = h('div', { class: 'mm__mode', t: `mode.${mode}.name` });
    this.humansEl = h('b', { text: '1' });
    const humans = h('div', { class: 'mm__stat' }, this.humansEl, h('span', { class: 'eyebrow', t: 'play.mm.humans' }));
    this.pips = h('div', { class: 'mm__pips' });
    for (let i = 0; i < this.size; i++) this.pips.append(h('span', { class: 'mm__pip' }));
    const hint = h('p', { class: 'dim', style: 'font-size:.8rem', t: 'play.mm.fill' });
    const cancel = button({ label: 'play.mm.cancel', icon: 'close', sfx: 'back', onClick: () => this.app.cancelQueue() });
    cancel.dataset.autofocus = '';
    const wrap = h('div', { class: 'mm' }, dial, this.statusEl, modeEl, h('div', { class: 'mm__stats' }, humans), this.pips, hint, cancel);
    this.el.append(wrap);
    stagger([dial, this.statusEl, modeEl, humans, this.pips, hint, cancel]);

    const last = this.app.queueStatus;
    if (last) this.apply(last);
    else this.setHumans(1);
    this.track(this.app.on('queue', (m) => this.apply(m)));
  }

  private apply(m: QueueStatusMsg): void {
    this.elapsedBase = m.elapsed;
    this.started = performance.now();
    if (m.size > 0 && m.size !== this.size && this.pips) {
      this.size = m.size;
      this.pips.replaceChildren();
      for (let i = 0; i < this.size; i++) this.pips.append(h('span', { class: 'mm__pip' }));
    }
    this.setHumans(Math.max(1, m.humans));
    if (m.state === 'found' && !this.found) {
      this.found = true;
      this.el.classList.add('is-found');
      if (this.statusEl) setText(this.statusEl, 'play.mm.found');
      this.app.audio?.ui('matchFound');
    }
  }

  private setHumans(n: number): void {
    if (this.humansEl) this.humansEl.textContent = `${n} / ${this.size}`;
    this.pips?.querySelectorAll('.mm__pip').forEach((p, i) => p.classList.toggle('is-on', i < n));
  }

  update(): void {
    if (!this.timeEl || this.found) return;
    const t = this.elapsedBase + (performance.now() - this.started) / 1000;
    const s = clock(Math.floor(t));
    if (this.timeEl.textContent !== s) this.timeEl.textContent = s;
  }

  back(): boolean {
    this.app.cancelQueue();
    return true;
  }
}
