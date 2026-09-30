// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range stats panel.
//
// Fed by the client: predicted trigger pulls (onShot) and authoritative
// 'target' events (shared RangeStats does the math: accuracy, head hits,
// eliminations, average time-to-eliminate per lane distance). A compact
// retro-futurist card on the HUD's inline-end side; re-renders only when a
// number changes. Later engineers can deepen it (per-weapon breakdowns…).
// ─────────────────────────────────────────────────────────────────────────────

import { RangeStats, type RangeSummary } from '../../shared/sim/range';
import type { GameEvent } from '../../shared/types';
import { h } from '../ui/components';
import { i18n, setText } from '../ui/i18n';

const CSS = `
.hf-range { position: absolute; inset-inline-end: max(calc(var(--safe-r, 0px) + 1.4em), 1.4em); top: 38%; width: 13.5em; padding: .75em .9em .8em; border-radius: 12px;
  background: linear-gradient(180deg, rgba(22,20,18,.58), rgba(22,20,18,.38)); border: 1px solid rgba(243,236,224,.18); color: var(--c-text, #f3ece0); font-size: .82em; }
.hf-range__title { font-size: .72em; letter-spacing: .18em; text-transform: uppercase; color: var(--c-accent, #f0b35b); margin-bottom: .45em; }
.hf-range__grid { display: grid; grid-template-columns: 1fr auto; gap: .2em .8em; }
.hf-range__grid b { font-family: var(--f-mono, 'JetBrains Mono', monospace); font-weight: 500; text-align: end; unicode-bidi: isolate; direction: ltr; }
.hf-range__rule { height: 1px; background: rgba(243,236,224,.16); margin: .55em 0 .45em; }
.hf-range__ttk { display: grid; grid-template-columns: auto 1fr auto; gap: .15em .6em; align-items: center; font-size: .92em; }
.hf-range__ttk i { height: 3px; border-radius: 2px; background: rgba(240,179,91,.8); transform-origin: 0 50%; }
[dir='rtl'] .hf-range__ttk i { transform-origin: 100% 50%; }
.hf-range__ttk span, .hf-range__ttk b { font-family: var(--f-mono, 'JetBrains Mono', monospace); font-weight: 500; direction: ltr; unicode-bidi: isolate; }
.hf-range__empty { color: rgba(243,236,224,.5); font-size: .9em; }
.hf-range__ttk.is-empty { display: block; }
.hud.hf-cine .hf-range { opacity: 0; }
@media (max-height: 460px) { .hf-range { top: 24%; font-size: .72em; } }
/* Touch: the right edge belongs to the buttons — compact strip under the compass (no score panel in the range). */
body.touch-ui .hf-range { inset-inline-end: auto; left: 50%; top: calc(var(--safe-t, 0px) + 3.6em); transform: translateX(-50%); width: auto; padding: .45em .8em; font-size: .7em; }
body.touch-ui .hf-range .hf-range__grid { grid-template-columns: repeat(4, auto auto); gap: .1em .55em; }
body.touch-ui .hf-range .hf-range__rule, body.touch-ui .hf-range .hf-range__ttk, body.touch-ui .hf-range .hf-range__title { display: none; }
`;

let injected = false;

export class RangePanel {
  readonly stats = new RangeStats();
  private readonly el: HTMLElement;
  private readonly vals: Record<'acc' | 'hits' | 'head' | 'kills', HTMLElement>;
  private readonly ttk: HTMLElement;
  private sig = '';
  private time = 0;
  private offLang: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    if (!injected) {
      injected = true;
      const st = document.createElement('style');
      st.dataset.owner = 'range-stats';
      st.textContent = CSS;
      document.head.append(st);
    }
    const row = (key: string) => {
      const b = h('b', { text: '0' });
      return { label: h('span', { t: key }), b };
    };
    const acc = row('match.range.accuracy');
    const hits = row('match.range.hits');
    const head = row('match.range.headshots');
    const kills = row('match.range.kills');
    this.vals = { acc: acc.b, hits: hits.b, head: head.b, kills: kills.b };
    this.ttk = h('div', { class: 'hf-range__ttk' });
    this.el = h(
      'div',
      { class: 'hf-range' },
      h('div', { class: 'hf-range__title', t: 'match.range.title' }),
      h('div', { class: 'hf-range__grid' }, acc.label, acc.b, hits.label, hits.b, head.label, head.b, kills.label, kills.b),
      h('div', { class: 'hf-range__rule' }),
      h('div', { class: 'hf-range__title', t: 'match.range.ttk' }),
      this.ttk,
    );
    parent.append(this.el);
    this.offLang = i18n.onChange(() => {
      this.sig = '';
      this.render();
    });
    this.render();
  }

  /** Seconds clock for time-to-kill (advanced by the match). */
  tick(dt: number): void {
    this.time += dt;
  }

  onShot(): void {
    this.stats.onShot();
    this.render();
  }

  onTarget(ev: Extract<GameEvent, { t: 'target' }>): void {
    this.stats.onTargetEvent(ev, this.time);
    this.render();
  }

  reset(): void {
    this.stats.reset();
    this.render();
  }

  summary(): RangeSummary {
    return this.stats.summary();
  }

  private render(): void {
    const s = this.stats.summary();
    const sig = `${s.shots}|${s.hits}|${s.headshots}|${s.kills}|${s.ttkByDistance.map((t) => `${t.distance}:${t.count}:${t.avg.toFixed(2)}`).join(',')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.vals.acc.textContent = s.shots ? `${Math.round(s.accuracy * 100)}%` : '—';
    this.vals.hits.textContent = `${s.hits}/${s.shots}`;
    this.vals.head.textContent = String(s.headshots);
    this.vals.kills.textContent = String(s.kills);
    this.ttk.replaceChildren();
    this.ttk.classList.toggle('is-empty', !s.ttkByDistance.length);
    if (!s.ttkByDistance.length) {
      this.ttk.append(setText(h('div', { class: 'hf-range__empty' }), 'match.range.ttkEmpty'));
      return;
    }
    const max = Math.max(0.5, ...s.ttkByDistance.map((t) => t.avg));
    for (const t of s.ttkByDistance) {
      const bar = h('i');
      bar.style.transform = `scaleX(${Math.max(0.04, t.avg / max).toFixed(3)})`;
      this.ttk.append(h('span', { text: `${t.distance}m` }), bar, h('b', { text: `${t.avg.toFixed(2)}s` }));
    }
  }

  dispose(): void {
    this.offLang?.();
    this.el.remove();
  }
}
