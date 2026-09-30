// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — private room lobby: big shareable code, players by team,
// host controls (mode / map / bots / difficulty), team switch and start.
// Rendered from the latest RoomStateMsg (app.room).
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../../app';
import { MODES } from '../../../shared/modes';
import type { RoomLobbyPlayer, RoomStateMsg } from '../../../shared/protocol';
import type { BotDifficulty, MapId, ModeId, Team } from '../../../shared/types';
import { button, cycler, h, iconButton, screenHeader, sectionLabel, segmented, stagger, toggle } from '../components';
import { i18n } from '../i18n';
import { icon } from '../icons';
import { BaseScreen } from './base';

export class RoomScreen extends BaseScreen {
  readonly id = 'room' as const;
  private body: HTMLElement | null = null;
  private lastSig = '';

  constructor(app: App) {
    super(app, 'screen--sub');
  }

  protected build(params?: unknown): void {
    const p = (params ?? {}) as { code?: string };
    const head = screenHeader({ title: 'play.room.title', onBack: () => this.app.leaveRoom() });
    this.body = h('div', { class: 'scr-body' });
    this.el.append(head, this.body);
    stagger([head]);
    this.lastSig = '';
    this.render(this.app.room, p.code);
    this.track(this.app.on('room', (r) => this.render(r)));
  }

  back(): boolean {
    this.app.leaveRoom();
    return true;
  }

  private render(room: RoomStateMsg | null, pendingCode?: string): void {
    const body = this.body;
    if (!body) return;
    const sig = room ? JSON.stringify(room) + i18n.lang : `pending:${pendingCode ?? ''}`;
    if (sig === this.lastSig) return;
    const first = this.lastSig === '' || this.lastSig.startsWith('pending');
    this.lastSig = sig;
    body.replaceChildren();
    if (!room) {
      body.append(h('div', { class: 'panel', style: 'padding:1.5rem;max-width:30rem' }, h('div', { class: 'mm__status', style: 'font-size:1.1rem', t: pendingCode ? 'play.room.joining' : 'play.room.creating', params: pendingCode ? { code: pendingCode } : undefined })));
      return;
    }
    const me = room.players.find((pl) => pl.id === room.you);
    const isHost = !!me?.host;
    const teams = MODES[room.mode].teams;

    // Code block
    const code = h('div', { class: 'room-code panel ticks' });
    code.append(h('div', {}, h('div', { class: 'eyebrow', t: 'play.room.code' }), h('div', { class: 'room-code__value', text: room.code })));
    const actions = h('div', { class: 'room-code__actions' });
    actions.append(
      iconButton({ icon: 'copy', label: 'common.copy', onClick: () => this.copy(room.code, 'play.room.codeCopied') }),
      button({ label: 'play.room.copyLink', icon: 'link', size: 'sm', onClick: () => this.copy(this.app.roomLink(room.code), 'play.room.linkCopied') }),
    );
    if (typeof navigator.share === 'function') {
      actions.append(
        button({
          label: 'play.room.share',
          icon: 'share',
          size: 'sm',
          onClick: () => {
            navigator.share({ title: 'HALCYON FRONT', text: i18n.t('play.room.shareText', { code: room.code }), url: this.app.roomLink(room.code) }).catch(() => undefined);
          },
        }),
      );
    }
    code.append(actions);

    // Players
    const lists = h('div', { class: `teams ${teams ? '' : 'teams--single'}` });
    const perTeam = teams ? MODES[room.mode].maxPlayers / 2 : MODES[room.mode].maxPlayers;
    const makeList = (team: Team | null, players: RoomLobbyPlayer[]) => {
      const list = h('div', { class: 'team-list panel' });
      const head = h('div', { class: 'team-list__head', t: team === null ? 'play.room.players' : `common.team.${team}` });
      if (team !== null) head.style.setProperty('--tc', `var(--team${team})`);
      list.append(head);
      for (const pl of players) {
        const row = h('div', { class: `player-row ${pl.id === room.you ? 'is-you' : ''}` });
        row.append(h('span', { class: 'player-row__lvl', text: String(pl.level) }), h('span', { class: 'player-row__name', text: pl.name }));
        if (pl.host) row.insertAdjacentHTML('beforeend', icon('crown'));
        row.insertAdjacentHTML('beforeend', `<span class="faint">${icon(pl.platform === 'desktop' ? 'keyboard' : 'touch')}</span>`);
        list.append(row);
      }
      for (let i = players.length; i < perTeam; i++) list.append(h('div', { class: 'player-row is-open' }, h('span', { class: 'player-row__name', t: 'play.room.open' })));
      return list;
    };
    if (teams) {
      lists.append(makeList(0, room.players.filter((pl) => pl.team === 0)), makeList(1, room.players.filter((pl) => pl.team === 1)));
    } else lists.append(makeList(null, room.players));

    const left = h('div', { class: 'res-col scroll' }, code, lists);

    // Side: settings + actions
    const side = h('div', { class: 'room-side panel' });
    side.append(sectionLabel('play.room.settings'));
    const send = (patch: Partial<{ mode: ModeId; map: MapId; botFill: boolean; botDifficulty: BotDifficulty }>) =>
      this.app.updateRoom({ mode: room.mode, map: room.map, botFill: room.botFill, botDifficulty: room.botDifficulty, ...patch });
    const modeSeg = segmented({
      options: [
        { value: 'tdm' as ModeId, label: 'mode.tdm.short' },
        { value: 'control' as ModeId, label: 'mode.control.short' },
        { value: 'ffa' as ModeId, label: 'mode.ffa.short' },
      ],
      value: room.mode,
      onChange: (v) => send({ mode: v }),
    });
    const mapCyc = cycler({
      options: (['gantry', 'pastel', 'observatory'] as MapId[]).map((m) => ({ value: m, label: `map.${m}.name` })),
      value: room.map,
      onChange: (v) => send({ map: v }),
    });
    const bots = toggle({ value: room.botFill, onChange: (v) => send({ botFill: v }), label: 'play.room.botFill' });
    const diff = segmented({
      options: [
        { value: 'recruit' as BotDifficulty, label: 'common.difficulty.recruit' },
        { value: 'veteran' as BotDifficulty, label: 'common.difficulty.veteran' },
        { value: 'elite' as BotDifficulty, label: 'common.difficulty.elite' },
      ],
      value: room.botDifficulty,
      onChange: (v) => send({ botDifficulty: v }),
    });
    const controls = h(
      'div',
      { class: 'opt-block' },
      h('div', { class: 'field__label', t: 'play.mode' }),
      modeSeg.el,
      h('div', { class: 'field__label', t: 'play.map' }),
      mapCyc.el,
      h('div', { class: 'row', style: 'padding-inline:0' }, h('div', { class: 'row__label', t: 'play.room.botFill' }), h('div', { class: 'row__control' }, bots.el)),
      h('div', { class: 'field__label', t: 'play.difficulty' }),
      diff.el,
    );
    if (!isHost) controls.setAttribute('inert', '');
    if (!isHost) controls.style.opacity = '0.55';
    side.append(controls);

    const foot = h('div', { class: 'detail-actions', style: 'margin-top:auto' });
    if (teams && me) {
      foot.append(button({ label: 'play.room.switchTeam', icon: 'refresh', onClick: () => this.app.switchRoomTeam() }));
    }
    if (room.state === 'playing') foot.append(h('span', { class: 'dim', t: 'play.room.playing' }));
    else if (isHost) {
      const start = button({ label: 'play.room.start', icon: 'play', variant: 'primary', caps: true, onClick: () => this.app.startRoom() });
      start.dataset.autofocus = '';
      foot.append(start);
    } else foot.append(h('span', { class: 'dim', style: 'font-size:.82rem', t: 'play.room.waiting' }));
    side.append(foot);

    const grid = h('div', { class: 'room-grid' }, left, side);
    body.append(grid);
    if (first) stagger([code, lists, side]);
  }

  private copy(text: string, toastKey: string): void {
    const done = () => this.app.ui.toast(toastKey, 'good');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => this.fallbackCopy(text, done));
    } else this.fallbackCopy(text, done);
  }

  private fallbackCopy(text: string, done: () => void): void {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      /* ignore */
    }
    ta.remove();
  }
}

