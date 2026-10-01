// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — end-of-match results: winner banner in team colors, MVP card,
// personal stats, team scoreboard, XP lines animating in, then an animated XP
// bar with level-up bursts and unlock reveals. Play again / Menu.
// ─────────────────────────────────────────────────────────────────────────────

import type { App } from '../../app';
import { teamColors } from '../../engine/palette';
import type { MatchResults, PlayerResult, Team } from '../../../shared/types';
import { MAX_LEVEL, levelFromXp, xpForLevel, type Unlock } from '../../../shared/progression';
import { ARMOR_TINTS, WEAPON_SKINS } from '../../../shared/cosmetics';
import { WEAPONS } from '../../../shared/weapons';
import type { MatchApplication } from '../../state/profile';
import { button, h, namecard, namecardBackground, sectionLabel, stagger } from '../components';
import { i18n, setText } from '../i18n';
import { icon, weaponIcon, type IconName } from '../icons';
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
    lvup: HTMLElement;
    lvupNum: HTMLElement;
    totalEl: HTMLElement;
    amounts: number[];
    sum: number;
    metaInto: number;
    metaLevel: number;
  } | null = null;
  /** Wall clock for the reveal: the sequence keeps its pace even when frames are slow. */
  private lastNow = 0;

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
        // Control: the winners hold the launch towers; TDM is a straight firefight.
        subKey = r.mode === 'control' ? 'results.teamWins' : 'results.teamWins.tdm';
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

    // ── XP panel: lines tick in, then the bar fills; a level-up swaps in a reveal with the unlocks.
    // Number in mono (LTR-isolated) + the localized unit, so Arabic reads "+3,002 خبرة".
    const totalEl = h('span', { class: 'mono', text: '+0' });
    const xpHead = h('div', { class: 'xp-head' }, sectionLabel('results.xp'), h('b', { class: 'xp-head__total' }, totalEl, ' ', h('span', { class: 'xp-unit', t: 'common.xp' })));
    const xpPanel = h('div', { class: 'xp-panel panel ticks' }, xpHead);
    const lines: HTMLElement[] = [];
    const linesWrap = h('div', { class: 'xp-lines' });
    for (const l of a.xp.lines) {
      const line = h('div', { class: `xp-line ${l.amount < 0 ? 'xp-line--neg' : ''}` }, h('span', { t: l.key }), h('b', { text: `${l.amount > 0 ? '+' : ''}${i18n.num(l.amount)}` }));
      lines.push(line);
      linesWrap.append(line);
    }
    xpPanel.append(linesWrap);
    const lvEl = h('div', { class: 'xp-progress__lv', text: String(a.before.level) });
    const fill = h('div', { class: 'xpbar__fill' });
    const meta = h('div', { class: 'xp-progress__meta' });
    const tag = h('span', { class: 'levelup-tag', t: 'results.levelUp' });
    xpPanel.append(h('div', { class: 'xp-progress' }, lvEl, h('div', { class: 'xp-progress__bar' }, h('div', { class: 'xpbar' }, fill), meta)));
    const lvupNum = h('span', { class: 'lvup__num', text: String(a.after.level) });
    const unlockEl = h('div', { class: 'unlock-reveal' });
    const lvup = h(
      'div',
      { class: 'lvup' },
      h(
        'div',
        { class: 'lvup__inner' },
        h('div', { class: 'lvup__head' }, h('span', { class: 'lvup__burst', html: icon('star') }), h('div', {}, tag, h('div', { class: 'lvup__title' }, h('span', { t: 'profile.level' }), lvupNum))),
        unlockEl,
      ),
    );
    xpPanel.append(lvup);

    const left = h('div', { class: 'res-col scroll' }, h('div', {}, sectionLabel('results.yourStats'), stats), xpPanel);

    // ── MVP + scoreboard
    const right = h('div', { class: 'res-col' });
    const mvp = r.players.find((x) => x.id === r.mvp);
    if (mvp && !range) {
      const isYou = mvp.id === you;
      const mv = h('div', { class: `mvp-card panel ticks ${isYou ? 'is-you' : ''}` });
      if (teams) mv.style.setProperty('--mc', `var(--team${mvp.team})`);
      const tagEl = h('div', { class: 'mvp-card__tag', html: icon('crown') });
      tagEl.append(h('span', { t: 'results.mvp' }));
      if (isYou) tagEl.append(h('span', { class: 'mvp-card__you', t: 'common.you' }));
      mv.append(tagEl, namecard({ id: mvp.namecard, name: mvp.name, level: mvp.level, sub: teams ? `common.team.${mvp.team}` : undefined, cls: 'namecard--hero' }));
      const mstat = (v: string, k: string) => h('span', { class: 'mvp-card__stat' }, h('b', { text: v }), h('span', { t: k }));
      const stats = h(
        'div',
        { class: 'mvp-card__stats' },
        mstat(String(mvp.stats.kills), 'results.stat.elims'),
        mstat(mvp.stats.shots ? `${Math.round((mvp.stats.hits / mvp.stats.shots) * 100)}%` : '—', 'results.stat.accuracy'),
        r.mode === 'control' ? mstat(`${Math.round(mvp.stats.objectiveTime)}s`, 'results.stat.objective') : mstat(String(mvp.stats.headshots), 'results.stat.headshots'),
        mstat(i18n.num(mvp.stats.score), 'results.stat.score'),
      );
      mv.append(stats);
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
    meta.replaceChildren(...xpMeta(a.before));

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
      lvup,
      lvupNum,
      totalEl,
      amounts: a.xp.lines.map((l) => l.amount),
      sum: 0,
      metaInto: -1,
      metaLevel: a.before.level,
    };
    this.lastNow = performance.now();
    this.app.audio?.setMusic(range ? 'menu' : a.won ? 'victory' : r.draw ? 'menu' : 'defeat');
  }

  private scoreboard(r: MatchResults, you: number, teams: boolean): HTMLElement {
    const table = h('table', { class: 'sb-table' });
    const head = h('tr', {}, h('th', { t: 'results.col.name' }), h('th', { t: 'results.col.k' }), h('th', { t: 'results.col.d' }), h('th', { t: 'results.col.a' }), h('th', { t: 'results.col.score' }));
    table.append(h('thead', {}, head));
    const tbody = h('tbody');
    const row = (p: PlayerResult) => {
      const name = h('td', {}, h('bdi', { text: p.name }));
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

  update(): void {
    const A = this.anim;
    if (!A || A.phase === 'done') return;
    const now = performance.now();
    const dt = Math.min(0.5, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    A.t += dt;
    if (A.phase === 'lines') {
      if (A.t >= 0 && A.lineIdx < A.lines.length) {
        while (A.lineIdx < A.lines.length && A.t >= A.lineIdx * 0.26) {
          A.lines[A.lineIdx].classList.add('is-in');
          A.sum += A.amounts[A.lineIdx] ?? 0;
          A.totalEl.textContent = `+${i18n.num(Math.max(0, A.sum))}`;
          const total = A.totalEl.parentElement;
          total?.classList.remove('is-bump');
          void total?.offsetWidth; // restart the bump (a handful of times per results screen)
          total?.classList.add('is-bump');
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
        A.lvupNum.textContent = String(info.level);
        if (!A.lvup.classList.contains('is-in')) {
          A.lvup.classList.add('is-in');
          A.lvup.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        } else {
          A.lvupNum.classList.remove('is-pop');
          void A.lvupNum.offsetWidth; // restart the pop (once per extra level)
        }
        A.lvupNum.classList.add('is-pop');
        this.app.audio?.ui('levelUp');
      }
      const needed = info.needed || xpForLevel(info.level);
      const frac = info.needed > 0 ? info.into / needed : 1;
      A.fill.style.transform = `scaleX(${frac})`;
      // The readout counts with the bar (badge, "into / needed" and next level stay in sync).
      const into = Math.floor(info.into);
      if (into !== A.metaInto || info.level !== A.metaLevel) {
        A.metaInto = into;
        A.metaLevel = info.level;
        A.meta.replaceChildren(...xpMeta(info));
      }
      A.tickAt -= dt;
      if (A.tickAt <= 0 && A.xpNow < A.xpTo) {
        A.tickAt = 0.07;
        this.app.audio?.ui('xpTick');
      }
      if (A.xpNow >= A.xpTo) {
        A.meta.replaceChildren(...xpMeta(info));
        A.phase = A.unlocks.length ? 'unlocks' : 'done';
        A.t = 0;
      }
      return;
    }
    if (A.phase === 'unlocks') {
      if (A.t >= 0.4 * A.unlockIdx + 0.3 && A.unlockIdx < Math.min(A.unlocks.length, 8)) {
        const u = A.unlocks[A.unlockIdx++];
        const card = unlockCard(u);
        A.unlockEl.append(card);
        // The reveal lands below the fold of the stats column at 720p: bring each card into view.
        const col = A.unlockEl.closest('.res-col') as HTMLElement | null;
        requestAnimationFrame(() => col?.scrollTo?.({ top: col.scrollHeight, behavior: 'smooth' }));
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

/** "into / needed" + next level (or the max-level note). */
function xpMeta(info: { level: number; into: number; needed: number }): HTMLElement[] {
  if (info.needed <= 0 || info.level >= MAX_LEVEL) return [h('span', { t: 'common.maxLevel' }), h('span', { t: 'common.levelN', params: { n: info.level } })];
  return [
    h('span', {}, h('span', { class: 'mono', text: `${i18n.num(Math.floor(info.into))} / ${i18n.num(info.needed)}` }), ' ', h('span', { t: 'common.xp' })),
    h('span', { t: 'common.levelN', params: { n: info.level + 1 } }),
  ];
}

const UNLOCK_KIND_ICON: Record<Unlock['kind'], IconName> = { armor: 'customize', visor: 'visor', namecard: 'card', elimFx: 'sparkle', skin: 'palette' };

/** One revealed unlock: a small visual (swatch, name card, weapon, icon) + name + kind. */
function unlockCard(u: Unlock): HTMLElement {
  const vis = h('span', { class: 'unlock-card__vis' });
  if (u.kind === 'armor') {
    const a = ARMOR_TINTS.find((x) => x.id === u.id);
    const sw = h('i', { class: 'unlock-card__swatch' });
    if (a) sw.style.background = a.color;
    vis.append(sw);
  } else if (u.kind === 'namecard') {
    vis.classList.add('unlock-card__vis--card');
    vis.style.background = namecardBackground(u.id);
  } else if (u.kind === 'skin' && u.weapon) {
    vis.innerHTML = weaponIcon(u.weapon);
    const sk = WEAPON_SKINS.find((x) => x.id === u.id);
    if (sk) vis.style.color = sk.accent;
  } else vis.innerHTML = icon(UNLOCK_KIND_ICON[u.kind]);
  const name = h('span', { class: 'unlock-card__name' });
  if (u.kind === 'skin' && u.weapon) name.textContent = `${i18n.t(WEAPONS[u.weapon].nameKey)} · ${i18n.t(u.nameKey)}`;
  else setText(name, u.nameKey);
  const kind = h('span', { class: 'unlock-card__kind' });
  if (u.kind === 'skin' && u.weapon) setText(kind, 'profile.unlock.skin', { weapon: i18n.t(WEAPONS[u.weapon].nameKey) });
  else setText(kind, `profile.unlock.${u.kind}`);
  return h('div', { class: 'unlock-card' }, vis, h('span', { class: 'unlock-card__text' }, h('span', { class: 'unlock-card__eyebrow', t: 'results.unlocked' }), name, kind));
}
