// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — pause overlay (in-match): resume, settings, leave (confirm).
// The match keeps running underneath (it is online); the App ducks audio and
// releases pointer lock while this is open.
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../../app';
import { button, h, stagger } from '../components';
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
    const card = h(
      'div',
      { class: 'pause-card panel panel--strong ticks' },
      h('div', { class: 'pause-card__title', t: 'hud.pause.title' }),
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
