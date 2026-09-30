// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — end-of-match results: winner banner in team colors, MVP card,
// personal stats, team scoreboard, XP lines animating in, then an animated XP
// bar with level-up bursts and unlock reveals. Play again / Menu.
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../../app';
import { teamColors } from '../../engine/palette';
import type { MatchResults, PlayerResult, Team } from '../../../shared/types';
import { levelFromXp, xpForLevel, type Unlock } from '../../../shared/progression';
import { WEAPONS } from '../../../shared/weapons';
import type { MatchApplication } from '../../state/profile';
import { button, h, namecard, sectionLabel, stagger } from '../components';
import { i18n, setText } from '../i18n';
import { icon } from '../icons';
import { BaseScreen } from './base';

export interface ResultsParams {
  results: MatchResults;
  you: number;
  applied: MatchApplication;
  ratingDelta: number;
}

type Phase = 'lines' | 'bar' | 'unlocks' | 'done';

export class ResultsScreen extends BaseScreen {
  readonly id = 'results' as const;
  private anim: {
    phase: Phase;
    t: number;
    lines: HTMLElement[];
    lineIdx: number;
    xpFrom: number;
    xpTo: number;
    xpNow: number;
    level: number;
    fill: HTMLElement;
    lvEl: HTMLElement;
    meta: HTMLElement;
    tag: HTMLElement;
    unlocks: Unlock[];
    unlockEl: HTMLElement;
    unlockIdx: number;
    tickAt: number;
  } | null = null;

  constructor(app: App) {
    super(app, '');
  }

  protected build(params?: unknown): void {
    const p = params as ResultsParams | undefined;
    if (!p?.results) {
      this.el.append(h('div', { class: 'panel', style: 'padding:2rem' }, button({ label: 'results.menu', onClick: () => void this.app.ui.show('menu') })));
      return;
    }
    const { results: r, you, applied: a } = p;
    const me = r.players.find((x) => x.id === you) ?? null;
    const teams = r.mode === 'tdm' || r.mode === 'control';
    const range = r.mode === 'range';
    const myTeam: Team = me?.team ?? 0;

    // ── Banner
    let titleKey = 'results.draw';
    let subKey = '';
    let subParams: Record<string, string | number> | undefined;
    let color = '#f3ece0';
    if (range) {
      titleKey = 'results.trainingDone';
      color = '#f0b35b';
    } else if (teams) {
      if (r.draw) titleKey = 'results.draw';
      else {
        titleKey = a.won ? 'results.victory' : 'results.defeat';
        color = teamColors(r.winner === 2 ? myTeam : r.winner).primary;
        subKey = 'results.teamWins';
        subParams = { team: i18n.t(`common.team.${r.winner}`) };
      }
    } else {
      const sorted = [...r.players].sort((x, y) => y.stats.score - x.stats.score || y.stats.kills - x.stats.kills);
      const place = sorted.findIndex((x) => x.id === you) + 1;
      if (place === 1) {
        titleKey = 'results.ffaWin';
        color = teamColors(0).primary;
      } else {
        titleKey = 'results.ffaPlace';
        color = '#c8bfb2';
        const winner = r.players.find((x) => x.id === r.winnerPlayer) ?? sorted[0];
        if (winner) {
          subKey = 'results.ffaWinner';
          subParams = { name: winner.name };
        }
      }
      if (place > 0 && place !== 1) subParams = { ...subParams, n: place, total: r.players.length };
    }
    this.el.style.setProperty('--rc', color);
    const title = h('div', { class: 'res-banner__title', t: titleKey, params: subParams });
    const bannerText = h('div', {}, title);
    if (subKey) bannerText.append(h('div', { class: 'res-banner__sub', t: subKey, params: subParams }));
    const dur = h(
      'div',
      { class: 'res-banner__sub' },
      `${i18n.t(`mode.${r.mode}.name`)} · ${i18n.t(`map.${r.map}.name`)} · `,
      h('span', { class: 'mono', text: `${Math.floor(r.duration / 60)}:${String(Math.floor(r.duration % 60)).padStart(2, '0')}` }),
    );
    bannerText.append(dur);
    const banner = h('div', { class: 'res-banner' }, bannerText);
    if (teams) {
      const c0 = teamColors(0).primary;
      const c1 = teamColors(1).primary;
      banner.append(
        h('div', { class: 'res-score' }, h('span', { style: `color:${c0}`, text: String(r.teamScores[0]) }), h('span', { class: 'res-score__sep', text: '—' }), h('span', { style: `color:${c1}`, text: String(r.teamScores[1]) })),
      );
    }
    if (!range && a.ratingAfter !== a.ratingBefore) {
      const d = Math.round(a.ratingAfter - a.ratingBefore);
      banner.append(h('div', { class: 'pill', style: 'align-self:center' }, h('span', { html: icon('star') }), h('span', { t: 'results.rating', params: { delta: `${d > 0 ? '+' : ''}${d}` } })));
    }

    // ── Personal stats
    const s = a.stats;
    const stat = (k: string, v: string) => h('div', { class: 'stat' }, h('span', { class: 'stat__v', text: v }), h('span', { class: 'stat__k', t: k }));
    const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) : 0;
    const stats = h('div', { class: 'res-stats' });
    if (range) {
      stats.append(stat('results.stat.hits', String(s.hits)), stat('results.stat.headshots', String(s.headshots)), stat('results.stat.accuracy', `${acc}%`), stat('results.stat.score', String(s.score)));
    } else {
      stats.append(
        stat('results.stat.elims', String(s.kills)),
        stat('results.stat.deaths', String(s.deaths)),
        stat('results.stat.assists', String(s.assists)),
        stat('results.stat.accuracy', `${acc}%`),
        stat('results.stat.headshots', String(s.headshots)),
        r.mode === 'control' ? stat('results.stat.objective', `${Math.round(s.objectiveTime)}s`) : stat('results.stat.damage', String(Math.round(s.damage))),
        stat('results.stat.score', String(s.score)),
        stat('results.stat.streak', String(s.bestStreak)),
      );
    }

    // ── XP panel
    const xpPanel = h('div', { class: 'xp-panel panel ticks' }, sectionLabel('results.xp'));
    const lines: HTMLElement[] = [];
    for (const l of a.xp.lines) {
      const line = h('div', { class: `xp-line ${l.amount < 0 ? 'xp-line--neg' : ''}` }, h('span', { t: l.key }), h('b', { text: `${l.amount > 0 ? '+' : ''}${i18n.num(l.amount)}` }));
      lines.push(line);
      xpPanel.append(line);
    }
    const total = h('div', { class: 'xp-line xp-line--total' }, h('span', { t: 'results.xpTotal' }), h('b', { text: `+${i18n.num(a.xp.total)}` }));
    lines.push(total);
    xpPanel.append(total);
    const lvEl = h('div', { class: 'xp-progress__lv', text: String(a.before.level) });
    const fill = h('div', { class: 'xpbar__fill' });
    const meta = h('div', { class: 'xp-progress__meta' });
    const tag = h('span', { class: 'levelup-tag', t: 'results.levelUp' });
    xpPanel.append(
      h('div', { class: 'xp-progress' }, lvEl, h('div', { class: 'xp-progress__bar' }, h('div', { class: 'xpbar' }, fill), meta)),
      tag,
    );
    const unlockEl = h('div', { class: 'unlock-reveal' });
    xpPanel.append(unlockEl);

    const left = h('div', { class: 'res-col scroll' }, h('div', {}, sectionLabel('results.yourStats'), stats), xpPanel);

    // ── MVP + scoreboard
    const right = h('div', { class: 'res-col' });
    const mvp = r.players.find((x) => x.id === r.mvp);
    if (mvp && !range) {
      const mv = h('div', { class: 'mvp-card panel ticks' });
      const tagEl = h('div', { class: 'mvp-card__tag', html: icon('crown') });
      tagEl.append(h('span', { t: 'results.mvp' }));
      mv.append(tagEl, namecard({ id: mvp.namecard, name: mvp.name, level: mvp.level, sub: teams ? `common.team.${mvp.team}` : undefined }));
      mv.append(
        h(
          'div',
          { class: 'mvp-card__stats' },
          h('span', {}, h('b', { text: String(mvp.stats.kills) }), h('span', { t: 'results.stat.elims' })),
          h('span', {}, h('b', { text: String(mvp.stats.score) }), h('span', { t: 'results.stat.score' })),
          h('span', {}, h('b', { text: mvp.stats.shots ? `${Math.round((mvp.stats.hits / mvp.stats.shots) * 100)}%` : '—' }), h('span', { t: 'results.stat.accuracy' })),
        ),
      );
      right.append(mv);
    }
    if (!range) right.append(h('div', { class: 'sb-wrap panel scroll' }, this.scoreboard(r, you, teams)));
    else if (me) right.append(namecard({ id: me.namecard, name: me.name, level: a.after.level }));

    const grid = h('div', { class: 'res-grid' }, left, right);

    // ── Footer
    const again = button({ label: 'results.playAgain', icon: 'refresh', variant: 'primary', caps: true, onClick: () => void this.app.playAgain() });
    again.dataset.autofocus = '';
    const menu = button({ label: 'results.menu', icon: 'back', caps: true, sfx: 'back', onClick: () => void this.app.ui.show('menu') });
    const foot = h('div', { class: 'scr-foot', style: 'justify-content:flex-end' }, menu, again);

    this.el.append(banner, grid, foot);
    stagger([bannerText, ...Array.from(stats.children), xpPanel, ...Array.from(right.children), foot]);

    // XP bar starts at the "before" state.
    const frac = a.before.needed > 0 ? a.before.into / a.before.needed : 1;
    fill.style.transform = `scaleX(${frac})`;
    meta.replaceChildren(h('span', { class: 'mono', text: `${i18n.num(a.before.into)} / ${i18n.num(a.before.needed)}` }), h('span', { t: 'common.levelN', params: { n: a.before.level + 1 } }));

    this.anim = {
      phase: 'lines',
      t: -0.7,
      lines,
      lineIdx: 0,
      xpFrom: a.before.xp,
      xpTo: a.after.xp,
      xpNow: a.before.xp,
      level: a.before.level,
      fill,
      lvEl,
      meta,
      tag,
      unlocks: a.unlocks,
      unlockEl,
      unlockIdx: 0,
      tickAt: 0,
    };
    this.app.audio?.setMusic(range ? 'menu' : a.won ? 'victory' : r.draw ? 'menu' : 'defeat');
  }

  private scoreboard(r: MatchResults, you: number, teams: boolean): HTMLElement {
    const table = h('table', { class: 'sb-table' });
    const head = h('tr', {}, h('th', { t: 'results.col.name' }), h('th', { t: 'results.col.k' }), h('th', { t: 'results.col.d' }), h('th', { t: 'results.col.a' }), h('th', { t: 'results.col.score' }));
    table.append(h('thead', {}, head));
    const tbody = h('tbody');
    const row = (p: PlayerResult) => {
      const name = h('td', { text: p.name });
      if (p.isBot) name.append(h('span', { class: 'sb-bot', t: 'common.bot' }));
      if (p.id === r.mvp) name.insertAdjacentHTML('afterbegin', `<span style="color:var(--c-headshot);margin-inline-end:.3rem">${icon('crown')}</span>`);
      return h('tr', { class: p.id === you ? 'is-you' : '' }, name, h('td', { text: String(p.stats.kills) }), h('td', { text: String(p.stats.deaths) }), h('td', { text: String(p.stats.assists) }), h('td', { text: String(p.stats.score) }));
    };
    const sortFn = (x: PlayerResult, y: PlayerResult) => y.stats.score - x.stats.score || y.stats.kills - x.stats.kills;
    if (teams) {
      for (const t of [0, 1] as const) {
        const hd = h('tr', { class: 'sb-team' }, h('td', { attrs: { colspan: '5' }, t: `common.team.${t}` }));
        hd.style.setProperty('--tc', teamColors(t).light);
        tbody.append(hd);
        for (const p of r.players.filter((x) => x.team === t).sort(sortFn)) tbody.append(row(p));
      }
    } else for (const p of [...r.players].sort(sortFn)) tbody.append(row(p));
    table.append(tbody);
    return table;
  }

  update(dt: number): void {
    const A = this.anim;
    if (!A || A.phase === 'done') return;
    A.t += dt;
    if (A.phase === 'lines') {
      if (A.t >= 0 && A.lineIdx < A.lines.length) {
        if (A.t >= A.lineIdx * 0.26) {
          A.lines[A.lineIdx].classList.add('is-in');
          this.app.audio?.ui('xpTick');
          A.lineIdx++;
        }
      } else if (A.lineIdx >= A.lines.length && A.t > A.lines.length * 0.26 + 0.35) {
        A.phase = 'bar';
        A.t = 0;
        // Make sure the bar (and upcoming unlocks) are in view on short screens.
        const col = A.fill.closest('.res-col') as HTMLElement | null;
        col?.scrollTo?.({ top: col.scrollHeight, behavior: 'smooth' });
      }
      return;
    }
    if (A.phase === 'bar') {
      // Fill speed scales with the amount so big gains still finish in ~2.5 s.
      const speed = Math.max(400, (A.xpTo - A.xpFrom) / 2.2);
      A.xpNow = Math.min(A.xpTo, A.xpNow + speed * dt);
      const info = levelFromXp(A.xpNow);
      if (info.level > A.level) {
        A.level = info.level;
        A.lvEl.textContent = String(info.level);
        A.lvEl.classList.remove('is-burst');
        void A.lvEl.offsetWidth; // restart the burst animation (rare, once per level-up)
        A.lvEl.classList.add('is-burst');
        A.tag.classList.add('is-in');
        this.app.audio?.ui('levelUp');
      }
      const needed = info.needed || xpForLevel(info.level);
      const frac = info.needed > 0 ? info.into / needed : 1;
      A.fill.style.transform = `scaleX(${frac})`;
      A.tickAt -= dt;
      if (A.tickAt <= 0 && A.xpNow < A.xpTo) {
        A.tickAt = 0.07;
        this.app.audio?.ui('xpTick');
      }
      if (A.xpNow >= A.xpTo) {
        A.meta.replaceChildren(h('span', { class: 'mono', text: info.needed > 0 ? `${i18n.num(info.into)} / ${i18n.num(info.needed)}` : 'MAX' }), h('span', { t: 'common.levelN', params: { n: Math.min(50, info.level + 1) } }));
        A.phase = A.unlocks.length ? 'unlocks' : 'done';
        A.t = 0;
      }
      return;
    }
    if (A.phase === 'unlocks') {
      if (A.t >= 0.4 * A.unlockIdx + 0.3 && A.unlockIdx < Math.min(A.unlocks.length, 8)) {
        const u = A.unlocks[A.unlockIdx++];
        const pill = h('span', { class: 'unlock-pill', html: icon('sparkle') });
        const label = h('span');
        if (u.kind === 'skin' && u.weapon) label.textContent = `${i18n.t(WEAPONS[u.weapon].nameKey)} · ${i18n.t(u.nameKey)}`;
        else setText(label, u.nameKey);
        pill.append(h('span', { class: 'faint', t: 'results.unlocked' }), label);
        A.unlockEl.append(pill);
        this.app.audio?.ui('unlock');
      }
      if (A.unlockIdx >= Math.min(A.unlocks.length, 8)) A.phase = 'done';
    }
  }

  back(): boolean {
    void this.app.ui.show('menu');
    return true;
  }
}
