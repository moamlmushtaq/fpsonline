// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — pause overlay (in-match): resume, settings, leave (confirm).
// The match keeps running underneath (it is online); the App ducks audio and
// releases pointer lock while this is open.
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../../app';
import { button, h, stagger } from '../components';
import { lastDeploy } from './loading';
import { BaseScreen } from './base';

export class PauseScreen extends BaseScreen {
  readonly id = 'pause' as const;

  constructor(app: App) {
    super(app, '');
  }

  protected build(): void {
    const resume = button({ label: 'hud.pause.resume', icon: 'play', variant: 'primary', size: 'lg', block: true, caps: true, onClick: () => this.app.resume() });
    resume.dataset.autofocus = '';
    const settings = button({ label: 'hud.pause.settings', icon: 'sliders', block: true, onClick: () => void this.app.ui.push('settings') });
    const leave = button({ label: 'hud.pause.leave', icon: 'exit', variant: 'danger', block: true, sfx: 'back', onClick: () => void this.app.leaveMatch() });
    // Where you are: mode · map, and (team modes) the live score and clock.
    const ctx = h('div', { class: 'pause-ctx' }, h('span', { t: `mode.${lastDeploy.mode}.name` }), h('span', { class: 'faint', text: '·' }), h('span', { t: `map.${lastDeploy.map}.name` }));
    const hud = this.app.hud as unknown as { summary?: () => { mode: string; time: string; mine: number; theirs: number; localTeam: number } };
    const sum = hud.summary?.();
    if (sum && (sum.mode === 'tdm' || sum.mode === 'control')) {
      const other = sum.localTeam === 0 ? 1 : 0;
      const score = h(
        'span',
        { class: 'pause-ctx__score' },
        h('b', { text: String(Math.floor(sum.mine)), style: `color:var(--team${sum.localTeam})` }),
        h('span', { class: 'faint', text: '–' }),
        h('b', { text: String(Math.floor(sum.theirs)), style: `color:var(--team${other})` }),
      );
      if (sum.time) score.append(h('span', { class: 'pause-ctx__time', text: sum.time }));
      ctx.append(score);
    }
    const card = h(
      'div',
      { class: 'pause-card panel panel--strong ticks' },
      h('div', { class: 'pause-card__title', t: 'hud.pause.title' }),
      ctx,
      h('div', { class: 'pause-card__sub', t: 'hud.pause.sub' }),
      resume,
      settings,
      leave,
    );
    this.el.append(card);
    stagger([resume, settings, leave]);
  }

  back(): boolean {
    this.app.resume();
    return true;
  }
}
