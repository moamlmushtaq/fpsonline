// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Loadout: primary weapon (4) with stat bars, throwable choice,
// sidearm + map pickup info. The 3D scene shows the character holding the
// selected weapon and a large turntable model beside them.
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../../app';
import { THROWABLES, WEAPONS, type WeaponDef } from '../../../shared/weapons';
import type { PrimaryWeaponId, ThrowableId, WeaponId } from '../../../shared/types';
import { PRIMARY_WEAPON_IDS } from '../../../shared/types';
import { card, h, screenHeader, sectionLabel, stagger, statBar } from '../components';
import { i18n } from '../i18n';
import { icon, weaponIcon } from '../icons';
import { BaseScreen } from './base';

const DEG = 180 / Math.PI;

/** Normalized 0..1 stats for the bars (hand-shaped so differences read clearly). */
export function weaponStats(w: WeaponDef): { damage: number; fireRate: number; range: number; mobility: number; control: number } {
  const perShot = w.damage * w.pellets;
  const damage = 0.25 + 0.75 * Math.sqrt(Math.max(0, perShot - 8) / 117);
  const fireRate = Math.max(0.08, Math.min(1, w.rpm / 900));
  const range = Math.min(1, Math.sqrt(w.falloffEnd / 160));
  const mobility = Math.max(0.1, Math.min(1, (w.moveSpeedMult - 0.8) / 0.3));
  const kicks = w.recoil.pattern.slice(0, 10);
  const kick = (kicks.reduce((s, k) => s + Math.abs(k[0]), 0) / Math.max(1, kicks.length)) * DEG;
  const control = Math.max(0.08, Math.min(1, 1 - ((kick / 4) * 0.6 + ((w.hipSpread * DEG) / 5) * 0.4)));
  return { damage: Math.min(1, damage), fireRate, range, mobility, control };
}

export class LoadoutScreen extends BaseScreen {
  readonly id = 'loadout' as const;
  private detail: HTMLElement | null = null;
  private weaponCards = new Map<PrimaryWeaponId, HTMLElement>();
  private throwCards = new Map<ThrowableId, HTMLElement>();

  constructor(app: App) {
    super(app, 'screen--sub');
  }

  protected build(): void {
    const lo = this.app.profile.value.loadout;
    const head = screenHeader({ title: 'loadout.title', sub: 'loadout.subtitle', onBack: () => void this.app.ui.show('menu') });

    const grid = h('div', { class: 'weapon-grid' });
    this.weaponCards.clear();
    for (const id of PRIMARY_WEAPON_IDS) {
      const w = WEAPONS[id];
      const c = card({ title: w.nameKey, sub: w.roleKey, cls: 'weapon-card', selected: id === lo.primary, onClick: () => this.pickPrimary(id), children: [iconNode(weaponIcon(id))] });
      if (id === lo.primary) c.dataset.autofocus = '';
      this.weaponCards.set(id, c);
      grid.append(c);
    }

    this.detail = h('div', { class: 'weapon-detail panel ticks' });
    this.renderDetail(lo.primary);

    const throws = h('div', { class: 'throw-cards' });
    this.throwCards.clear();
    for (const t of ['grenade', 'smoke'] as ThrowableId[]) {
      const def = THROWABLES[t];
      const c = card({ title: def.nameKey, sub: def.descKey, cls: 'throw-card', selected: t === lo.throwable, onClick: () => this.pickThrowable(t), children: [iconNode(icon(t === 'smoke' ? 'smoke' : 'grenade'))] });
      wrapText(c);
      this.throwCards.set(t, c);
      throws.append(c);
    }

    const sidearm = this.infoCard('pulse', 'loadout.sidearmNote');
    const pickup = this.infoCard('sunspear', 'loadout.pickupNote');
    pickup.classList.add('info-card--gold');

    const row = h(
      'div',
      { class: 'loadout-row' },
      h('div', {}, sectionLabel('loadout.throwable'), throws),
      h('div', { style: 'display:flex;flex-direction:column;gap:.5rem' }, sectionLabel('loadout.sidearm'), sidearm, pickup),
    );

    const body = h('div', { class: 'loadout-body scroll content-col' }, h('div', {}, sectionLabel('loadout.primary'), grid), this.detail, row);
    this.el.append(head, body);
    stagger([head, ...Array.from(grid.children), this.detail, row]);
    this.track(i18n.onChange(() => this.renderDetail(this.app.profile.value.loadout.primary)));
  }

  private infoCard(id: WeaponId, note: string): HTMLElement {
    const w = WEAPONS[id];
    return h(
      'div',
      { class: 'info-card panel', html: weaponIcon(id) },
      h('div', {}, h('div', { class: 'info-card__title', t: w.nameKey }), h('div', { class: 'info-card__sub', t: w.roleKey }), h('div', { class: 'info-card__sub faint', t: note })),
    );
  }

  private renderDetail(id: PrimaryWeaponId): void {
    const d = this.detail;
    if (!d) return;
    const w = WEAPONS[id];
    const s = weaponStats(w);
    const left = h(
      'div',
      {},
      h('div', { class: 'eyebrow', t: 'loadout.primary' }),
      h('div', { class: 'weapon-detail__name', t: w.nameKey }),
      h('div', { class: 'weapon-detail__role', t: w.roleKey }),
      h('p', { class: 'weapon-detail__desc', t: `weapon.${id}.desc` }),
      h(
        'div',
        { class: 'weapon-detail__facts' },
        h('span', { t: 'loadout.mag', params: { n: w.magSize } }),
        h('span', { t: 'loadout.rpm', params: { n: w.rpm } }),
      ),
    );
    const n = (v: number) => String(Math.round(v * 100));
    const stats = h(
      'div',
      { class: 'weapon-detail__stats' },
      statBar('loadout.stat.damage', s.damage, n(s.damage)),
      statBar('loadout.stat.fireRate', s.fireRate, n(s.fireRate)),
      statBar('loadout.stat.range', s.range, n(s.range)),
      statBar('loadout.stat.mobility', s.mobility, n(s.mobility)),
      statBar('loadout.stat.control', s.control, n(s.control)),
    );
    d.replaceChildren(left, stats);
  }

  private pickPrimary(id: PrimaryWeaponId): void {
    for (const [k, c] of this.weaponCards) c.classList.toggle('is-selected', k === id);
    this.app.profile.setLoadout({ primary: id });
    this.app.audio?.swap(id);
    this.renderDetail(id);
    this.detail?.animate?.([{ opacity: 0.5 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
  }

  private pickThrowable(t: ThrowableId): void {
    for (const [k, c] of this.throwCards) c.classList.toggle('is-selected', k === t);
    this.app.profile.setLoadout({ throwable: t });
  }
}

function iconNode(svg: string): Element {
  const tpl = document.createElement('template');
  tpl.innerHTML = svg;
  return tpl.content.firstElementChild as Element;
}

/** Puts a card's title/sub in a column next to its leading icon. */
function wrapText(c: HTMLElement): void {
  const title = c.querySelector('.card__title');
  const sub = c.querySelector('.card__sub');
  const text = document.createElement('div');
  if (title) text.append(title);
  if (sub) text.append(sub);
  c.append(text);
}
