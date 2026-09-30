// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Play screen: mode cards + per-mode options (map picker, bot
// difficulty, tutorial toggle, private room create/join) and the launch button.
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../../app';
import { MODES } from '../../../shared/modes';
import { ROOM_CODE_LENGTH } from '../../../shared/constants';
import type { BotDifficulty, MapId, ModeId } from '../../../shared/types';
import { button, card, h, screenHeader, sectionLabel, segmented, stagger, toggle } from '../components';
import { setAttr, setText } from '../i18n';
import { icon, type IconName } from '../icons';
import { applyKeyArt } from '../keyart';
import { BaseScreen } from './base';

export type PlayMode = 'tdm' | 'control' | 'ffa' | 'bots' | 'range' | 'room';

const MODE_ITEMS: { id: PlayMode; name: string; icon: IconName; art: MapId }[] = [
  { id: 'tdm', name: 'mode.tdm.name', icon: 'users', art: 'gantry' },
  { id: 'control', name: 'mode.control.name', icon: 'zone', art: 'observatory' },
  { id: 'ffa', name: 'mode.ffa.name', icon: 'crown', art: 'pastel' },
  { id: 'bots', name: 'mode.bots.name', icon: 'gamepad', art: 'pastel' },
  { id: 'range', name: 'mode.range.name', icon: 'target', art: 'range' },
  { id: 'room', name: 'mode.room.name', icon: 'link', art: 'gantry' },
];

const PVP_MODES: { value: ModeId; label: string }[] = [
  { value: 'tdm', label: 'mode.tdm.name' },
  { value: 'control', label: 'mode.control.name' },
  { value: 'ffa', label: 'mode.ffa.name' },
];

const DIFFICULTIES: { value: BotDifficulty; label: string }[] = [
  { value: 'recruit', label: 'common.difficulty.recruit' },
  { value: 'veteran', label: 'common.difficulty.veteran' },
  { value: 'elite', label: 'common.difficulty.elite' },
];

const MAPS: MapId[] = ['gantry', 'pastel', 'observatory'];

export class PlayScreen extends BaseScreen {
  readonly id = 'play' as const;
  private mode: PlayMode = 'tdm';
  private botMode: ModeId = 'tdm';
  private botMap: MapId | 'any' = 'any';
  private difficulty: BotDifficulty = 'veteran';
  private tutorial = false;
  private roomMode: ModeId = 'tdm';
  private roomMap: MapId = 'gantry';
  private roomBots = true;
  private detail: HTMLElement | null = null;
  private cards = new Map<PlayMode, HTMLElement>();

  constructor(app: App) {
    super(app, 'screen--sub');
  }

  protected build(params?: unknown): void {
    const p = (params ?? {}) as { mode?: PlayMode };
    if (p.mode) this.mode = p.mode;
    this.tutorial = !this.app.profile.value.seenTutorial;

    const head = screenHeader({ title: 'play.title', sub: 'play.subtitle', onBack: () => void this.app.ui.show('menu') });
    const list = h('div', { class: 'mode-list scroll' });
    this.cards.clear();
    for (const m of MODE_ITEMS) {
      const facts = m.id === 'bots' || m.id === 'room' ? `mode.${m.id}.desc` : `mode.${m.id}.desc`;
      const c = card({ title: m.name, cls: 'mode-card', onClick: () => this.select(m.id), children: [h('span', { html: icon(m.icon) }).firstElementChild as Element] });
      const sub = h('div', { class: 'card__sub', t: facts });
      c.querySelector('.card__title')?.after(sub);
      // Wrap title + sub so the icon sits beside them.
      const text = h('div', {});
      text.append(c.querySelector('.card__title') as Element, sub);
      c.append(text);
      if (m.id === this.mode) c.dataset.autofocus = '';
      this.cards.set(m.id, c);
      list.append(c);
    }
    this.detail = h('div', { class: 'mode-detail panel ticks scroll' });
    const grid = h('div', { class: 'play-grid' }, list, this.detail);
    this.el.append(head, grid);
    stagger([head, ...Array.from(list.children), this.detail]);
    this.select(this.mode, true);
    this.track(this.app.net?.onStatus?.(() => this.renderDetail()));
  }

  private select(mode: PlayMode, initial = false): void {
    this.mode = mode;
    for (const [id, c] of this.cards) c.classList.toggle('is-selected', id === mode);
    this.renderDetail();
    if (!initial) this.detail?.animate?.([{ opacity: 0.4, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  private renderDetail(): void {
    const d = this.detail;
    if (!d) return;
    d.replaceChildren();
    const item = MODE_ITEMS.find((m) => m.id === this.mode) ?? MODE_ITEMS[0];
    const online = this.app.net?.status === 'online';

    const hero = h('div', { class: 'mode-detail__hero' });
    applyKeyArt(hero, this.mode === 'bots' && this.botMap !== 'any' ? this.botMap : this.mode === 'room' ? this.roomMap : item.art, 'thumb');
    const facts = h('div', { class: 'mode-detail__facts' });
    const heading = h('div', { class: 'mode-detail__heading' }, h('div', { class: 'mode-detail__name', t: item.name }), facts);
    hero.append(heading);
    d.append(hero);

    const modeId: ModeId = this.mode === 'bots' ? this.botMode : this.mode === 'room' ? this.roomMode : this.mode === 'range' ? 'range' : this.mode;
    const def = MODES[modeId];
    if (modeId !== 'range') {
      const players = def.teams ? h('span', { html: icon('users') }) : h('span', { html: icon('users') });
      players.append(h('span', { t: def.teams ? 'play.teams' : 'play.players', params: def.teams ? { a: def.maxPlayers / 2, b: def.maxPlayers / 2 } : { n: def.maxPlayers } }));
      const time = h('span', { html: icon('clock') });
      time.append(h('span', { t: 'play.duration', params: { n: Math.round(def.timeLimit / 60) } }));
      facts.append(players, time);
    } else {
      const t = h('span', { html: icon('target') });
      t.append(h('span', { text: '16' }));
      facts.append(t);
    }

    d.append(h('p', { class: 'mode-detail__desc', t: this.mode === 'bots' ? 'mode.bots.desc' : this.mode === 'room' ? 'mode.room.desc' : `mode.${this.mode}.desc` }));

    switch (this.mode) {
      case 'tdm':
      case 'control':
      case 'ffa':
        this.quickOptions(d, online);
        break;
      case 'bots':
        this.botOptions(d);
        break;
      case 'range':
        this.rangeOptions(d);
        break;
      case 'room':
        this.roomOptions(d, online);
        break;
    }
  }

  private note(key: string, ic: IconName = 'info'): HTMLElement {
    return h('div', { class: 'note', html: icon(ic) }, h('span', { t: key }));
  }

  private quickOptions(d: HTMLElement, online: boolean): void {
    d.append(this.note(online ? 'play.quickNote' : 'play.offlineNote', online ? 'info' : 'offline'));
    const go = button({ label: 'play.findMatch', icon: 'play', variant: 'primary', size: 'lg', caps: true, onClick: () => void this.app.quickPlay(this.mode as ModeId) });
    go.dataset.autofocus = '';
    d.append(h('div', { class: 'detail-actions' }, go));
  }

  private mapPicker(value: MapId | 'any', allowAny: boolean, onPick: (m: MapId | 'any') => void): HTMLElement {
    const grid = h('div', { class: 'map-picker' });
    const cards: [MapId | 'any', HTMLElement][] = [];
    if (allowAny) {
      const any = card({ title: 'play.anyMap', cls: 'map-card map-card--any', onClick: () => pick('any'), children: [h('span', { html: icon('refresh') }).firstElementChild as Element] });
      cards.push(['any', any]);
    }
    for (const m of MAPS) {
      const c = card({ title: `map.${m}.name`, cls: 'map-card', onClick: () => pick(m) });
      applyKeyArt(c, m, 'thumb');
      cards.push([m, c]);
    }
    const paint = (v: MapId | 'any') => cards.forEach(([id, c]) => c.classList.toggle('is-selected', id === v));
    const pick = (m: MapId | 'any') => {
      paint(m);
      onPick(m);
    };
    for (const [, c] of cards) grid.append(c);
    paint(value);
    return grid;
  }

  private botOptions(d: HTMLElement): void {
    d.append(
      h(
        'div',
        { class: 'opt-block' },
        sectionLabel('play.mode'),
        segmented({ options: PVP_MODES, value: this.botMode, onChange: (v) => { this.botMode = v; this.renderDetail(); } }).el,
      ),
    );
    d.append(h('div', { class: 'opt-block' }, sectionLabel('play.map'), this.mapPicker(this.botMap, true, (m) => {
      this.botMap = m;
      const hero = d.querySelector<HTMLElement>('.mode-detail__hero');
      if (hero) applyKeyArt(hero, m === 'any' ? 'pastel' : m, 'thumb');
    })));
    const diffDesc = h('div', { class: 'note', html: icon('info') });
    const diffText = h('span', { t: `common.difficulty.${this.difficulty}.desc` });
    diffDesc.append(diffText);
    d.append(
      h(
        'div',
        { class: 'opt-block' },
        sectionLabel('play.difficulty'),
        segmented({ options: DIFFICULTIES, value: this.difficulty, onChange: (v) => { this.difficulty = v; setText(diffText, `common.difficulty.${v}.desc`); } }).el,
        diffDesc,
      ),
    );
    d.append(this.note('play.botsNote'));
    const go = button({ label: 'play.startBots', icon: 'play', variant: 'primary', size: 'lg', caps: true, onClick: () => void this.app.botMatch(this.botMode, this.botMap, this.difficulty) });
    d.append(h('div', { class: 'detail-actions' }, go));
  }

  private rangeOptions(d: HTMLElement): void {
    const tg = toggle({ value: this.tutorial, onChange: (v) => (this.tutorial = v), label: 'play.tutorial' });
    const row = h('div', { class: 'row' }, h('div', {}, h('div', { class: 'row__label', t: 'play.tutorial' }), h('div', { class: 'row__desc', t: 'play.tutorialDesc' })), h('div', { class: 'row__control' }, tg.el));
    d.append(row, this.note('play.rangeNote'));
    const go = button({ label: 'play.enterRange', icon: 'target', variant: 'primary', size: 'lg', caps: true, onClick: () => void this.app.training(this.tutorial) });
    d.append(h('div', { class: 'detail-actions' }, go));
  }

  private roomOptions(d: HTMLElement, online: boolean): void {
    if (!online) d.append(this.note('play.onlineOnly', 'offline'));
    d.append(
      h(
        'div',
        { class: 'opt-block' },
        sectionLabel('play.mode'),
        segmented({ options: PVP_MODES, value: this.roomMode, onChange: (v) => (this.roomMode = v) }).el,
      ),
    );
    d.append(h('div', { class: 'opt-block' }, sectionLabel('play.map'), this.mapPicker(this.roomMap, false, (m) => {
      if (m !== 'any') this.roomMap = m;
      const hero = d.querySelector<HTMLElement>('.mode-detail__hero');
      if (hero && m !== 'any') applyKeyArt(hero, m, 'thumb');
    })));
    const bots = toggle({ value: this.roomBots, onChange: (v) => (this.roomBots = v), label: 'play.room.botFill' });
    d.append(h('div', { class: 'row' }, h('div', { class: 'row__label', t: 'play.room.botFill' }), h('div', { class: 'row__control' }, bots.el)));
    const create = button({
      label: 'play.createRoom',
      icon: 'plus',
      variant: 'primary',
      caps: true,
      onClick: () => void this.app.createRoom({ mode: this.roomMode, map: this.roomMap, botFill: this.roomBots, botDifficulty: this.difficulty }),
    });
    if (!online) create.classList.add('is-disabled');
    d.append(h('div', { class: 'detail-actions' }, create));

    // Join by code
    const input = h('input', { class: 'input input--code', attrs: { maxlength: String(ROOM_CODE_LENGTH), autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text' } });
    setAttr(input, 'aria-label', 'play.roomCode');
    input.placeholder = 'ABCDE';
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
      input.classList.remove('is-invalid');
    });
    const join = button({
      label: 'play.join',
      icon: 'link',
      onClick: () => {
        if (input.value.length !== ROOM_CODE_LENGTH) {
          input.classList.add('is-invalid');
          this.app.ui.toast('errors.invalidCode', 'error');
          return;
        }
        void this.app.joinRoom(input.value);
      },
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join.click();
    });
    if (!online) join.classList.add('is-disabled');
    d.append(h('div', { class: 'opt-block' }, sectionLabel('play.joinRoom'), h('div', { class: 'join-row' }, input, join)));
  }
}
