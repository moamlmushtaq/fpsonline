// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Profile: editable callsign (+ random generator), level/XP
// ring, rating tier, lifetime service record, next unlocks and the optional
// account (sign in / create / sign out; online only).
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../../app';
import { unlockTrack, type Unlock } from '../../../shared/progression';
import { NAME_MAX } from '../../../shared/names';
import { WEAPONS } from '../../../shared/weapons';
import { button, h, iconButton, namecard, progressRing, screenHeader, sectionLabel, stagger } from '../components';
import { i18n, setAttr, setText } from '../i18n';
import { icon, type IconName } from '../icons';
import { ratingTier } from '../../state/profile';
import { BaseScreen } from './base';

const UNLOCK_ICON: Record<Unlock['kind'], IconName> = { armor: 'customize', visor: 'visor', namecard: 'card', elimFx: 'sparkle', skin: 'palette' };

function playTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export class ProfileScreen extends BaseScreen {
  readonly id = 'profile' as const;
  private body: HTMLElement | null = null;

  constructor(app: App) {
    super(app, 'screen--sub');
  }

  protected build(): void {
    const head = screenHeader({ title: 'profile.title', onBack: () => void this.app.ui.show('menu') });
    this.body = h('div', { class: 'profile-body scroll content-col' });
    this.el.append(head, this.body);
    this.render(true);
    stagger([head]);
    this.track(this.app.profile.onChange(() => this.render(false)));
    this.track(this.app.net?.onStatus?.(() => this.render(false)));
  }

  private render(animate: boolean): void {
    const body = this.body;
    if (!body) return;
    // Keep the name field untouched while the user is typing in it.
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && body.contains(active)) return;
    const scroll = body.scrollTop;
    body.replaceChildren();
    const p = this.app.profile.value;
    const info = this.app.profile.levelInfo();

    // Hero
    const ring = progressRing(112, 6, info.needed > 0 ? info.into / info.needed : 1);
    const ringWrap = h('div', { class: 'profile-ring' }, ring.el, h('div', { class: 'profile-ring__center' }, h('span', { class: 'profile-ring__lv', t: 'profile.level' }), h('span', { class: 'profile-ring__num', text: String(info.level) })));
    const input = h('input', { class: 'input', attrs: { maxlength: String(NAME_MAX), autocomplete: 'nickname', spellcheck: 'false' } });
    setAttr(input, 'aria-label', 'profile.callsign');
    input.value = p.name;
    const save = () => {
      if (input.value.trim() === p.name) return;
      if (this.app.profile.setName(input.value)) {
        input.classList.remove('is-invalid');
        this.app.ui.toast('profile.nameSaved', 'good');
      } else {
        input.classList.add('is-invalid');
        this.app.ui.toast('profile.nameInvalid', 'error');
        input.value = p.name;
      }
    };
    input.addEventListener('change', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
    const dice = iconButton({ icon: 'dice', label: 'profile.randomName', onClick: () => this.app.profile.randomizeName() });
    const tier = h('span', { class: 'tier', html: icon('star') });
    tier.append(h('span', { t: `profile.tier.${ratingTier(p.rating)}` }), h('span', { class: 'faint', text: '·' }), h('span', { class: 'mono faint', text: String(Math.round(p.rating)) }));
    const xpText = h('div', { class: 'profile-hero__xp' });
    if (info.needed > 0) setText(xpText, 'profile.xpToNext', { n: info.needed - info.into, level: info.level + 1 });
    else setText(xpText, 'profile.maxLevel');
    const hero = h(
      'div',
      { class: 'profile-hero panel ticks' },
      ringWrap,
      h('div', { class: 'profile-hero__main' }, h('div', { class: 'field__label', t: 'profile.callsign' }), h('div', { class: 'name-edit' }, input, dice), tier, xpText, h('div', { class: 'faint', style: 'font-size:.7rem', t: 'profile.totalXp', params: { n: p.xp } })),
    );
    const card = namecard({ id: p.cosmetics.namecard, name: p.name, level: info.level, sub: `profile.tier.${ratingTier(p.rating)}` });

    // Stats
    const L = p.lifetime;
    const stat = (k: string, v: string) => h('div', { class: 'stat' }, h('span', { class: 'stat__v', text: v }), h('span', { class: 'stat__k', t: k }));
    const acc = L.shots > 0 ? L.hits / L.shots : 0;
    const grid = h(
      'div',
      { class: 'stat-grid' },
      stat('profile.stat.matches', i18n.num(L.matches)),
      stat('profile.stat.wins', i18n.num(L.wins)),
      stat('profile.stat.winRate', L.matches ? `${Math.round((L.wins / L.matches) * 100)}%` : '—'),
      stat('profile.stat.kd', (L.kills / Math.max(1, L.deaths)).toFixed(2)),
      stat('profile.stat.kills', i18n.num(L.kills)),
      stat('profile.stat.headshots', i18n.num(L.headshots)),
      stat('profile.stat.accuracy', `${Math.round(acc * 100)}%`),
      stat('profile.stat.playTime', playTime(L.playSeconds)),
    );
    if (p.rangeBest) grid.append(stat('profile.stat.rangeBest', i18n.num(p.rangeBest.score)));

    // Unlock track
    const next = unlockTrack()
      .filter((u) => u.level > info.level)
      .slice(0, 5);
    const track = h('div', { class: 'unlock-track' });
    if (!next.length) track.append(h('p', { class: 'dim', t: 'profile.allUnlocked' }));
    for (const u of next) {
      const kind = h('span', { class: 'unlock__kind' });
      if (u.kind === 'skin' && u.weapon) setText(kind, 'profile.unlock.skin', { weapon: i18n.t(WEAPONS[u.weapon].nameKey) });
      else setText(kind, `profile.unlock.${u.kind}`);
      track.append(
        h(
          'div',
          { class: 'unlock' },
          h('span', { class: 'unlock__lv', t: 'common.levelN', params: { n: u.level } }),
          h('span', { class: 'unlock__icon', html: icon(UNLOCK_ICON[u.kind]) }),
          h('span', { class: 'unlock__name', t: u.nameKey }),
          kind,
        ),
      );
    }

    body.append(hero, card, h('div', {}, sectionLabel('profile.stats'), grid), h('div', {}, sectionLabel('profile.nextUnlocks'), track), this.accountPanel());
    if (animate) stagger(Array.from(body.children));
    else body.scrollTop = scroll;
  }

  private accountPanel(): HTMLElement {
    const p = this.app.profile.value;
    const online = this.app.net?.status === 'online';
    const panel = h('div', { class: 'account panel' }, sectionLabel('profile.account'));
    if (this.app.profile.signedIn) {
      panel.append(h('div', { class: 'row__label', t: 'profile.signedIn', params: { name: p.name } }), h('div', { class: 'row__desc', t: 'profile.signedInDesc' }));
      panel.append(
        h(
          'div',
          { class: 'account__row' },
          button({
            label: 'profile.signOut',
            icon: 'exit',
            variant: 'ghost',
            onClick: () => {
              this.app.profile.logout();
              this.app.ui.toast('profile.signedOut', 'info');
            },
          }),
        ),
      );
      return panel;
    }
    panel.append(h('div', { class: 'row__label', t: 'profile.guest' }), h('div', { class: 'row__desc', t: 'profile.guestDesc' }));
    if (!online) {
      panel.append(h('div', { class: 'note', html: icon('offline') }, h('span', { t: 'profile.offline' })));
      return panel;
    }
    const name = h('input', { class: 'input', attrs: { maxlength: String(NAME_MAX), autocomplete: 'username' } });
    name.value = p.name;
    const pass = h('input', { class: 'input', attrs: { type: 'password', autocomplete: 'current-password', maxlength: '128' } });
    const err = h('div', { class: 'account__err' });
    const busy = (b: boolean) => panel.querySelectorAll('button').forEach((x) => x.toggleAttribute('disabled', b));
    const run = async (kind: 'login' | 'register') => {
      busy(true);
      err.textContent = '';
      const res = kind === 'login' ? await this.app.profile.login(name.value, pass.value) : await this.app.profile.register(name.value, pass.value);
      busy(false);
      if (res.ok) {
        this.app.ui.toast(i18n.t('profile.welcome', { name: this.app.profile.value.name }), 'good');
        this.app.onAccountChanged();
      } else setText(err, `profile.err.${res.error}`);
    };
    panel.append(
      h(
        'div',
        { class: 'account__row' },
        h('label', { class: 'field' }, h('span', { class: 'field__label', t: 'profile.username' }), name),
        h('label', { class: 'field' }, h('span', { class: 'field__label', t: 'profile.password' }), pass),
      ),
      err,
      h(
        'div',
        { class: 'account__row' },
        button({ label: 'profile.signIn', icon: 'profile', variant: 'primary', onClick: () => void run('login') }),
        button({ label: 'profile.register', icon: 'plus', onClick: () => void run('register') }),
      ),
    );
    return panel;
  }
}
