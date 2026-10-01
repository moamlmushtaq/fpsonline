// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Customize: faction preference, armor tint, visor, name card,
// elimination effect and weapon skins. Locked items show their unlock level.
// The live 3D character is the menu scene: hovering / focusing any item (locked
// ones included) previews it on the character — elimination effects play on
// it, weapon skins float in the foreground — and a tag names the item and its
// unlock level. Tapping a locked item pins its preview (touch has no hover).
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../../app';
import { ARMOR_TINTS, ELIM_EFFECTS, NAMECARDS, VISOR_STYLES, WEAPON_SKINS, skinUnlockLevel, type VisorStyle, type WeaponSkin } from '../../../shared/cosmetics';
import type { Faction, WeaponId } from '../../../shared/types';
import { WEAPON_IDS } from '../../../shared/types';
import { WEAPONS } from '../../../shared/weapons';
import { card, h, namecard, screenHeader, segmented, stagger, tabs } from '../components';
import { icon, weaponIcon } from '../icons';
import { setText } from '../i18n';
import type { MenuPreview } from '../menu-scene';
import { BaseScreen } from './base';

interface PreviewItem {
  preview: MenuPreview;
  /** i18n key of the item name. */
  name: string;
  locked: number | null;
  elimFx?: string;
  selected?: boolean;
}

type Tab = 'faction' | 'armor' | 'visor' | 'namecard' | 'elim' | 'skins';

function visorSvg(shape: VisorStyle['shape']): string {
  const helmet =
    '<path d="M10 34c0-13 9.5-24 22-24s22 11 22 24v2.5c0 1.4-1.1 2.5-2.5 2.5h-39A2.5 2.5 0 0 1 10 36.5z" fill="#e8e1d4"/><path d="M42 12.5c6.5 3.6 11 11 11 21.5v2.5c0 1.4-1.1 2.5-2.5 2.5H46c1.4-8.2.2-18.4-4-26.5z" fill="#b8b0a4"/>';
  let v = '';
  switch (shape) {
    case 'band':
      v = '<rect x="13" y="24" width="38" height="5" rx="2.5"/>';
      break;
    case 'slit':
      v = '<rect x="19" y="25" width="26" height="2.4" rx="1.2"/>';
      break;
    case 'twin':
      v = '<circle cx="24" cy="26.5" r="4"/><circle cx="40" cy="26.5" r="4"/>';
      break;
    case 'cross':
      v = '<rect x="15" y="25" width="34" height="3" rx="1.5"/><rect x="30.5" y="17" width="3" height="18" rx="1.5"/>';
      break;
    case 'mono':
      v = '<circle cx="36" cy="26" r="5.5"/><rect x="14" y="25.4" width="16" height="1.6" rx=".8" opacity=".6"/>';
      break;
    case 'halo':
      v = '<path d="M13 27a19 16 0 0 1 38 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><rect x="20" y="26" width="24" height="3" rx="1.5"/>';
      break;
  }
  return `<svg class="cust-visor" viewBox="0 0 64 44" aria-hidden="true">${helmet}<g fill="currentColor" style="filter:drop-shadow(0 0 3px currentColor)">${v}</g></svg>`;
}

function elimSvg(style: string): string {
  switch (style) {
    case 'embers':
      return `<svg class="cust-elim" viewBox="0 0 40 40" fill="currentColor" aria-hidden="true"><circle cx="12" cy="30" r="2"/><circle cx="20" cy="22" r="1.6"/><circle cx="27" cy="28" r="2.4"/><circle cx="16" cy="14" r="1.2"/><circle cx="26" cy="12" r="1.4"/><circle cx="31" cy="19" r="1"/><circle cx="9" cy="20" r="1"/></svg>`;
    case 'origami':
      return `<svg class="cust-elim" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M8 26 18 12l6 14z"/><path d="M18 12l4 8"/><path d="M24 30 32 18l2 12z"/><path d="M12 32l4-4 3 5z"/></svg>`;
    case 'starfall':
      return `<svg class="cust-elim" viewBox="0 0 40 40" fill="currentColor" aria-hidden="true"><path d="M20 6l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/><path d="M30 22l1.2 3.4 3.4 1.2-3.4 1.2L30 31.2l-1.2-3.4-3.4-1.2 3.4-1.2z"/><path d="M10 24l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z"/></svg>`;
    case 'prism':
      return `<svg class="cust-elim" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M20 8 32 30H8z"/><path d="M26 19l10-4M27 22l9 1M26 25l8 5" stroke-opacity=".7"/><path d="M4 21l12-1" stroke-opacity=".7"/></svg>`;
    default:
      return `<svg class="cust-elim" viewBox="0 0 40 40" fill="currentColor" aria-hidden="true"><path d="M14 26c-3-4-2-9 2-11-1 4 2 6 4 6-2-3 0-8 4-9-1 3 1 5 3 7 2 3 1 7-2 9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 12l3 1-1 3zM28 30l3-1 0 3zM30 10l2 2-3 1z" opacity=".7"/></svg>`;
  }
}

function skinSvg(w: WeaponId, s: WeaponSkin): string {
  const pattern =
    s.pattern === 'stripes'
      ? `<pattern id="p-${w}-${s.id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="8" height="8" fill="${s.shell}"/><rect width="3" height="8" fill="${s.accent}" opacity=".55"/></pattern>`
      : s.pattern === 'gradient'
        ? `<linearGradient id="p-${w}-${s.id}" x1="0" x2="1"><stop offset="0" stop-color="${s.shell}"/><stop offset="1" stop-color="${s.metal}"/></linearGradient>`
        : s.pattern === 'patina'
          ? `<radialGradient id="p-${w}-${s.id}" cx=".3" cy=".4" r=".8"><stop offset="0" stop-color="${s.shell}"/><stop offset=".7" stop-color="${s.metal}" stop-opacity=".9"/><stop offset="1" stop-color="${s.shell}"/></radialGradient>`
          : `<linearGradient id="p-${w}-${s.id}"><stop offset="0" stop-color="${s.shell}"/><stop offset="1" stop-color="${s.shell}"/></linearGradient>`;
  const icon = weaponIcon(w).replace('<svg class="wic ', `<svg style="width:100%;height:2.6rem;display:block" class="wic `).replace('fill="currentColor"', `fill="url(#p-${w}-${s.id})"`);
  return icon.replace('aria-hidden="true" focusable="false">', `aria-hidden="true" focusable="false"><defs>${pattern}</defs>`);
}

export class CustomizeScreen extends BaseScreen {
  readonly id = 'customize' as const;
  private tab: Tab = 'faction';
  private pane: HTMLElement | null = null;
  private skinWeapon: WeaponId = 'meridian';
  private tag: HTMLElement | null = null;
  private pinned: PreviewItem | null = null;
  private hoverTimer = 0;
  private lastElimAt = 0;

  constructor(app: App) {
    super(app, 'screen--sub');
  }

  override leave(): void {
    super.leave();
    window.clearTimeout(this.hoverTimer);
    this.pinned = null;
    this.app.menuScene?.setPreview(null);
    this.app.menuScene?.setWeaponShowcase(false);
  }

  /** Wires hover / focus / tap previews on a cosmetic card. */
  private bindPreview(el: HTMLElement, item: PreviewItem): void {
    const show = () => {
      window.clearTimeout(this.hoverTimer);
      this.showPreview(item);
    };
    const hide = () => {
      window.clearTimeout(this.hoverTimer);
      // Small grace period so sweeping across the grid never flickers back to the saved look.
      this.hoverTimer = window.setTimeout(() => this.showPreview(this.pinned, !!this.pinned && this.pinned.locked !== null), 140);
    };
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') show();
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') hide();
    });
    el.addEventListener('focus', () => {
      if (el.matches(':focus-visible')) show();
    });
    el.addEventListener('blur', hide);
    el.addEventListener('click', () => {
      // Locked: pin the preview (touch players have no hover). Unlocked: the pick is saved.
      this.pinned = item.locked !== null ? item : null;
      this.showPreview(item.locked !== null ? item : { ...item, selected: true });
    });
  }

  private showPreview(item: PreviewItem | null, withTag = true): void {
    const scene = this.app.menuScene;
    scene?.setPreview(item ? item.preview : null);
    if (item?.elimFx && scene && performance.now() - this.lastElimAt > 1700) {
      this.lastElimAt = performance.now();
      scene.playElimination(item.elimFx);
    }
    const tag = this.tag;
    if (!tag) return;
    if (!item || !withTag) {
      tag.classList.remove('is-on');
      return;
    }
    const name = tag.querySelector('.cust-tag__name') as HTMLElement;
    const state = tag.querySelector('.cust-tag__state') as HTMLElement;
    setText(name, item.name);
    tag.classList.toggle('is-locked', item.locked !== null);
    state.replaceChildren();
    if (item.locked !== null) {
      state.insertAdjacentHTML('beforeend', icon('lock'));
      state.append(h('span', { t: 'common.unlocksAt', params: { level: item.locked } }));
    } else {
      state.insertAdjacentHTML('beforeend', icon('check'));
      state.append(h('span', { t: item.selected ? 'common.equipped' : 'customize.previewSelect' }));
    }
    tag.classList.add('is-on');
  }

  protected build(): void {
    this.skinWeapon = this.app.profile.value.loadout.primary;
    const head = screenHeader({ title: 'customize.title', sub: 'customize.subtitle', onBack: () => void this.app.ui.show('menu') });
    const t = tabs<Tab>({
      tabs: [
        { id: 'faction', label: 'customize.tab.faction', icon: 'faction' },
        { id: 'armor', label: 'customize.tab.armor', icon: 'customize' },
        { id: 'visor', label: 'customize.tab.visor', icon: 'visor' },
        { id: 'namecard', label: 'customize.tab.namecard', icon: 'card' },
        { id: 'elim', label: 'customize.tab.elim', icon: 'sparkle' },
        { id: 'skins', label: 'customize.tab.skins', icon: 'palette' },
      ],
      value: this.tab,
      onChange: (id) => {
        this.tab = id;
        this.renderPane(true);
      },
    });
    this.pane = h('div', { class: 'scroll', style: 'flex:1;min-height:0;padding:2px' });
    const touch = this.app.input?.device === 'touch';
    const hint = h('p', { class: 'cust-hint', html: icon('eye') }, h('span', { t: touch ? 'customize.previewHint.touch' : 'customize.previewHint' }));
    const body = h('div', { class: 'cust-body content-col content-col--wide' }, t.el, hint, this.pane);
    this.tag = h(
      'div',
      { class: 'cust-tag panel', attrs: { 'aria-live': 'polite' } },
      h('div', { class: 'eyebrow', t: 'customize.preview' }),
      h('div', { class: 'cust-tag__name' }),
      h('div', { class: 'cust-tag__state' }),
    );
    this.pinned = null;
    this.el.append(head, body, this.tag);
    stagger([head, t.el, this.pane]);
    this.renderPane(false);
    this.track(this.app.profile.onChange(() => this.renderPane(false)));
  }

  private renderPane(animate: boolean): void {
    const pane = this.pane;
    if (!pane) return;
    const scroll = pane.scrollTop;
    pane.replaceChildren();
    const p = this.app.profile.value;
    const level = p.level;
    const note = (key: string) => h('p', { class: 'dim', style: 'font-size:.8rem;margin:.2rem 0 .8rem', t: key });
    this.app.menuScene?.setWeaponShowcase(this.tab === 'skins');
    if (animate) {
      this.pinned = null;
      this.showPreview(null);
    }
    switch (this.tab) {
      case 'faction': {
        pane.append(note('customize.faction.note'));
        const grid = h('div', { class: 'faction-cards' });
        for (const f of [0, 1] as const) {
          const c = card({
            title: `common.faction.${f}`,
            sub: `common.faction.${f}.desc`,
            cls: 'faction-card',
            selected: p.faction === f,
            onClick: () => this.app.profile.update({ faction: f }),
            children: [iconEl(icon('faction', 'faction-card__emblem'))],
          });
          c.style.setProperty('--tc', `var(--team${f})`);
          this.bindPreview(c, { preview: { faction: f as Faction }, name: `common.faction.${f}`, locked: null, selected: p.faction === f });
          grid.append(c);
        }
        pane.append(grid);
        break;
      }
      case 'armor': {
        pane.append(note('customize.armor.note'));
        const grid = h('div', { class: 'cust-grid' });
        for (const a of ARMOR_TINTS) {
          const sw = h('span', { class: 'cust-swatch' });
          sw.style.background = a.color;
          const locked = a.unlockLevel > level ? a.unlockLevel : null;
          const c = card({
            title: a.nameKey,
            cls: 'cust-item',
            selected: p.cosmetics.armor === a.id,
            lockedLevel: locked,
            onClick: () => this.app.profile.setCosmetics({ armor: a.id }),
            children: [sw],
          });
          this.bindPreview(c, { preview: { cosmetics: { armor: a.id } }, name: a.nameKey, locked, selected: p.cosmetics.armor === a.id });
          grid.append(c);
        }
        pane.append(grid);
        break;
      }
      case 'visor': {
        pane.append(note('customize.visor.note'));
        const grid = h('div', { class: 'cust-grid' });
        for (const v of VISOR_STYLES) {
          const vis = iconEl(visorSvg(v.shape));
          (vis as SVGElement).style.color = `var(--team${p.faction})`;
          const locked = v.unlockLevel > level ? v.unlockLevel : null;
          const c = card({
            title: v.nameKey,
            cls: 'cust-item',
            selected: p.cosmetics.visor === v.id,
            lockedLevel: locked,
            onClick: () => this.app.profile.setCosmetics({ visor: v.id }),
            children: [vis],
          });
          this.bindPreview(c, { preview: { cosmetics: { visor: v.id } }, name: v.nameKey, locked, selected: p.cosmetics.visor === v.id });
          grid.append(c);
        }
        pane.append(grid);
        break;
      }
      case 'namecard': {
        pane.append(note('customize.namecard.note'));
        const grid = h('div', { class: 'cust-grid cust-grid--wide' });
        for (const n of NAMECARDS) {
          const locked = n.unlockLevel > level ? n.unlockLevel : null;
          const c = card({
            title: n.nameKey,
            cls: 'cust-item cust-namecard',
            selected: p.cosmetics.namecard === n.id,
            lockedLevel: locked,
            onClick: () => this.app.profile.setCosmetics({ namecard: n.id }),
            children: [namecard({ id: n.id, name: p.name, level })],
          });
          this.bindPreview(c, { preview: {}, name: n.nameKey, locked, selected: p.cosmetics.namecard === n.id });
          grid.append(c);
        }
        pane.append(grid);
        break;
      }
      case 'elim': {
        pane.append(note('customize.elim.note'));
        const grid = h('div', { class: 'cust-grid' });
        for (const e of ELIM_EFFECTS) {
          const locked = e.unlockLevel > level ? e.unlockLevel : null;
          const c = card({
            title: e.nameKey,
            cls: 'cust-item cust-elim-card',
            selected: p.cosmetics.elimFx === e.id,
            lockedLevel: locked,
            onClick: () => this.app.profile.setCosmetics({ elimFx: e.id }),
            children: [iconEl(elimSvg(e.style))],
          });
          this.bindPreview(c, { preview: {}, name: e.nameKey, locked, elimFx: e.id, selected: p.cosmetics.elimFx === e.id });
          grid.append(c);
        }
        pane.append(grid);
        break;
      }
      case 'skins': {
        pane.append(note('customize.skins.note'));
        const seg = segmented<WeaponId>({
          options: WEAPON_IDS.map((w) => ({ value: w, label: WEAPONS[w].nameKey })),
          value: this.skinWeapon,
          onChange: (v) => {
            this.skinWeapon = v;
            this.renderPane(true);
          },
        });
        seg.el.classList.add('skin-weapons');
        // The showcase follows the weapon being browsed (its saved skin until an item is hovered).
        const base: PreviewItem = { preview: { weapon: { id: this.skinWeapon, skin: p.cosmetics.skins[this.skinWeapon] ?? 'factory' } }, name: WEAPONS[this.skinWeapon].nameKey, locked: null };
        if (!this.pinned || !this.pinned.preview.weapon || this.pinned.preview.weapon.id !== this.skinWeapon) this.pinned = base;
        this.app.menuScene?.setPreview(this.pinned.preview);
        pane.append(seg.el, h('div', { style: 'height:.75rem' }));
        const grid = h('div', { class: 'cust-grid cust-grid--wide' });
        const w = this.skinWeapon;
        const current = p.cosmetics.skins[w] ?? 'factory';
        for (const s of WEAPON_SKINS) {
          const req = skinUnlockLevel(w, s.id);
          const chips = h('span', { class: 'skin-chip' });
          for (const c of [s.shell, s.metal, s.accent]) {
            const i = h('i');
            i.style.background = c;
            chips.append(i);
          }
          const locked = req > level ? req : null;
          const c = card({
            title: s.nameKey,
            cls: 'cust-item',
            selected: current === s.id,
            lockedLevel: locked,
            onClick: () => this.app.profile.setCosmetics({ skins: { [w]: s.id } }),
            children: [iconEl(skinSvg(w, s))],
          });
          c.append(chips);
          this.bindPreview(c, { preview: { weapon: { id: w, skin: s.id } }, name: s.nameKey, locked, selected: current === s.id });
          grid.append(c);
        }
        pane.append(grid);
        break;
      }
    }
    if (animate) stagger(Array.from(pane.querySelectorAll('.card')));
    else pane.scrollTop = scroll;
  }
}

function iconEl(svg: string): Element {
  const tpl = document.createElement('template');
  tpl.innerHTML = svg.trim();
  return tpl.content.firstElementChild as Element;
}
