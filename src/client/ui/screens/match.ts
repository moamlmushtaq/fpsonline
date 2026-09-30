// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — in-match screen: a transparent, click-through layer hosting
// the HUD root. Back (Escape / gamepad B / Android back) opens the pause menu.
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../../app';
import { BaseScreen } from './base';

export class MatchScreen extends BaseScreen {
  readonly id = 'match' as const;

  constructor(app: App) {
    super(app, '');
  }

  protected build(): void {
    try {
      this.app.hud.mount(this.el);
    } catch (err) {
      console.error('[ui] HUD mount failed', err);
    }
  }

  override leave(): void {
    super.leave();
    try {
      this.app.hud.unmount();
    } catch {
      /* already unmounted */
    }
  }

  back(): boolean {
    this.app.pause();
    return true;
  }
}
