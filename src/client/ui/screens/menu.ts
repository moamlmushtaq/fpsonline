// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — main menu overlay. The 3D scene (menu-scene.ts) renders the
// player's character on a platform at sunset behind it.
// ─────────────────────────────────────────────────────────────────────────────

import type { ScreenId } from '../../contracts';
import type { App } from '../../app';
import { GAME_VERSION } from '../../../shared/constants';
import { WEAPONS } from '../../../shared/weapons';
import { wordmark } from '../brand';
import { dialSvg, h, namecard, stagger } from '../components';
import { i18n, setText } from '../i18n';
import { icon, weaponIcon, type IconName } from '../icons';
import { ratingTier } from '../../state/profile';
import { BaseScreen } from './base';
import type { PlayMode } from './play';

const CHIPS: { mode: PlayMode; label: string; icon: IconName }[] = [
  { mode: 'tdm', label: 'menu.chip.tdm', icon: 'users' },
  { mode: 'control', label: 'menu.chip.control', icon: 'zone' },
  { mode: 'ffa', label: 'menu.chip.ffa', icon: 'crown' },
  { mode: 'bots', label: 'menu.chip.bots', icon: 'gamepad' },
  { mode: 'range', label: 'menu.chip.range', icon: 'target' },
  { mode: 'room', label: 'menu.chip.room', icon: 'link' },
];

const DOCK: { screen: ScreenId; label: string; icon: IconName }[] = [
  { screen: 'loadout', label: 'menu.loadout', icon: 'loadout' },
  { screen: 'customize', label: 'menu.customize', icon: 'customize' },
  { screen: 'settings', label: 'menu.settings', icon: 'sliders' },
  { screen: 'profile', label: 'menu.profile', icon: 'profile' },
];

export class MenuScreen extends BaseScreen {
  readonly id = 'menu' as const;
  private pill: HTMLElement | null = null;
  private playSub: HTMLElement | null = null;
  private badgeSlot: HTMLElement | null = null;
  private equippedSlot: HTMLElement | null = null;

  constructor(app: App) {
    super(app, 'screen--menu');
  }

  protected build(): void {
    const app = this.app;

    // Brand
    const brand = h('div', { class: 'menu__brand' }, wordmark(), h('div', { class: 'eyebrow menu__season', t: 'menu.season' }));

    // Top-right: status, language, player badge
    this.pill = h('div', { class: 'pill' });
    const lang = h('button', { class: 'btn btn--sm', attrs: { type: 'button' } });
    lang.dataset.sfx = 'toggle';
    lang.innerHTML = icon('globe');
    lang.append(h('span', { t: 'menu.langSwitch' }));
    lang.setAttribute('lang', i18n.lang === 'ar' ? 'en' : 'ar');
    lang.addEventListener('click', () => app.settings.update({ lang: app.settings.value.lang === 'ar' ? 'en' : 'ar' }));
    this.badgeSlot = h('div');
    const top = h('div', { class: 'menu__top' }, this.pill, lang, this.badgeSlot);

    // Main column: PLAY + chips (+ tutorial nudge)
    const play = h('button', { class: 'play-btn', attrs: { type: 'button' } });
    play.dataset.sfx = 'confirm';
    play.dataset.autofocus = '';
    play.append(h('span', { class: 'play-btn__text' }, h('span', { class: 'play-btn__label', t: 'menu.play' }), (this.playSub = h('span', { class: 'play-btn__sub' }))));
    const dialWrap = h('span', { class: 'play-btn__dial', html: dialSvg({ size: 64, ticks: 40, needle: false }) });
    dialWrap.insertAdjacentHTML('beforeend', icon('play'));
    play.append(dialWrap);
    play.addEventListener('click', () => void app.quickPlay('tdm'));

    const chips = h('div', { class: 'mode-chips' });
    for (const c of CHIPS) {
      const b = h('button', { class: 'chip', attrs: { type: 'button' }, html: icon(c.icon) });
      b.dataset.sfx = 'click';
      b.append(h('span', { t: c.label }));
      b.addEventListener('click', () => void app.ui.show('play', { mode: c.mode }));
      chips.append(b);
    }
    const main = h('div', { class: 'menu__main' }, play, chips);
    if (!app.profile.value.seenTutorial) {
      const go = h('button', { class: 'btn btn--sm', attrs: { type: 'button' }, t: 'menu.tutorial' });
      go.dataset.sfx = 'confirm';
      go.addEventListener('click', () => void app.training(true));
      main.append(h('div', { class: 'nudge panel' }, h('span', { html: icon('sparkle') }), h('span', { t: 'menu.firstTime' }), go));
    }

    // Side: equipped weapon mini card (near the character)
    this.equippedSlot = h('div');
    const side = h('div', { class: 'menu__side' }, this.equippedSlot);

    // Dock
    const dock = h('nav', { class: 'menu__dock' });
    for (const d of DOCK) {
      const b = h('button', { class: 'tile', attrs: { type: 'button' }, html: icon(d.icon) });
      b.dataset.sfx = 'click';
      b.append(h('span', { t: d.label }));
      b.addEventListener('click', () => void app.ui.show(d.screen));
      dock.append(b);
    }

    // Hint
    const hint = h('div', { class: 'menu__hint' });
    const deviceHint = h('span', { class: 'hintbar' });
    const paintHint = () => {
      deviceHint.replaceChildren();
      const pad = app.input?.device === 'gamepad';
      const touch = app.input?.device === 'touch';
      if (touch) return;
      deviceHint.append(h('span', {}, h('span', { class: 'glyph', text: pad ? 'A' : '↵' }), h('span', { t: pad ? 'menu.hint.pad' : 'menu.hint.kbm' })));
    };
    paintHint();
    hint.append(deviceHint, h('span', { t: 'common.version', params: { v: GAME_VERSION } }));

    this.el.append(brand, top, main, side, dock, hint);
    stagger([brand, top, play, ...Array.from(chips.children), ...Array.from(dock.children), side]);

    this.paintStatus();
    this.paintBadge();
    this.paintEquipped();
    this.track(app.net?.onStatus?.(() => this.paintStatus()));
    this.track(app.profile.onChange(() => {
      this.paintBadge();
      this.paintEquipped();
    }));
    this.track(i18n.onChange(() => {
      lang.setAttribute('lang', i18n.lang === 'ar' ? 'en' : 'ar');
      this.paintStatus();
      this.paintBadge();
    }));
    this.track(app.input?.onDeviceChange?.(() => paintHint()));
    // Enter anywhere (nothing focused) deploys.
    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      const a = document.activeElement;
      if (!a || a === document.body) {
        e.preventDefault();
        play.click();
      }
    });
  }

  private paintStatus(): void {
    const pill = this.pill;
    if (!pill) return;
    const status = this.app.net?.status ?? 'offline';
    pill.className = `pill pill--${status}`;
    pill.replaceChildren(h('span', { class: 'pill__dot' }));
    const text = h('span');
    if (status === 'online') setText(text, 'menu.status.online', { n: this.app.net.onlineCount });
    else if (status === 'connecting') setText(text, 'menu.status.connecting');
    else setText(text, 'menu.status.offline');
    pill.append(text);
    if (this.playSub) setText(this.playSub, status === 'offline' ? 'menu.quickPlayOffline' : 'menu.quickPlaySub');
  }

  private paintBadge(): void {
    const slot = this.badgeSlot;
    if (!slot) return;
    const p = this.app.profile.value;
    const info = this.app.profile.levelInfo();
    const b = h('button', { class: 'badge', attrs: { type: 'button' } });
    b.dataset.sfx = 'click';
    b.append(namecard({ id: p.cosmetics.namecard, name: p.name, level: info.level, sub: `profile.tier.${ratingTier(p.rating)}` }));
    const fill = h('div', { class: 'xpbar__fill' });
    const frac = info.needed > 0 ? info.into / info.needed : 1;
    fill.style.transform = `scaleX(${Math.max(0.02, frac)})`;
    b.append(h('div', { class: 'xpbar' }, fill));
    b.append(
      h(
        'div',
        { class: 'badge__meta' },
        h('span', { class: 'mono', text: info.needed > 0 ? `${i18n.num(info.into)} / ${i18n.num(info.needed)} XP` : 'MAX' }),
        h('span', { t: 'common.levelN', params: { n: info.level } }),
      ),
    );
    b.addEventListener('click', () => void this.app.ui.show('profile'));
    slot.replaceChildren(b);
  }

  private paintEquipped(): void {
    const slot = this.equippedSlot;
    if (!slot) return;
    const w = WEAPONS[this.app.profile.value.loadout.primary];
    const card = h('button', { class: 'equipped panel', attrs: { type: 'button' }, html: weaponIcon(w.id) });
    card.dataset.sfx = 'click';
    card.append(h('div', {}, h('div', { class: 'eyebrow', t: 'menu.equipped' }), h('div', { class: 'equipped__name', t: w.nameKey }), h('div', { class: 'equipped__role', t: w.roleKey })));
    card.addEventListener('click', () => void this.app.ui.show('loadout'));
    slot.replaceChildren(card);
  }
}
