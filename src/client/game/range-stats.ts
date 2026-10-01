// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range stats panel + range runtime (MatchExtension).
//
// Stats come from the shared RangeSession: predicted trigger pulls (onShot,
// keyed by the InputCmd seq + weapon) and authoritative 'target' events (the
// host echoes the shot's seq, so pellets of one shot count once and misses
// are detected for streaks). The panel shows accuracy, hits/shots, headshot
// %, targets down, best streak, session time, average time-to-eliminate per
// distance band (10/25/50/75/100 m) and a per-weapon breakdown, plus touch-
// friendly Reset and Target speed (Slow / Normal / Fast) controls. Personal
// bests persist in profile.rangeBest (accuracy with ≥ 20 shots, streak,
// targets, band TTK with ≥ 3 eliminations) with a toast when beaten.
// It also runs the in-world range pieces: floating hit numbers + distance
// (tutorial/floaters.ts) and the armory stations (tutorial/range-stations.ts).
// Layout: a fixed card on the physical left (above the HUD and the pause
// overlay, so it is clickable whenever the cursor is free) — the HUD's toasts
// ("new personal best", "tutorial skipped") grow rightwards from the crosshair
// in both reading directions and were hidden under a right-side card; on
// touch a small pill in the top bar, beside the corner HUD box (below it sit the
// pause / menu touch buttons, which the pill must never cover). Hidden during the intro,
// the tutorial (body.hf-tutorial-active) and when the HUD is hidden.
// ─────────────────────────────────────────────────────────────────────────────

import { profile } from '../state/profile';
import { RANGE_SPEEDS, RangeSession, type RangeSessionSummary, type RangeSummary } from '../../shared/sim/range';
import type { GameEvent, WeaponId } from '../../shared/types';
import { WEAPONS } from '../../shared/weapons';
import type { MatchApi, MatchExtension } from './extensions';
import { Floaters } from './tutorial/floaters';
import { RangeStations } from './tutorial/range-stations';

const CSS = `
.hf-range { position: fixed; z-index: 26; left: max(calc(var(--safe-l, 0px) + 1.2rem), 1.2rem); top: 30%; width: 15.5rem; padding: .7rem .85rem .75rem; border-radius: 12px;
  background: linear-gradient(180deg, rgba(22,20,18,.62), rgba(22,20,18,.42)); border: 1px solid rgba(243,236,224,.18); color: var(--c-text, #f3ece0); font: .78rem var(--f-ui);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); transition: opacity 300ms var(--ease), transform 300ms var(--ease); pointer-events: auto; }
body.q-low .hf-range { backdrop-filter: none; -webkit-backdrop-filter: none; background: rgba(22,20,18,.78); }
.hf-range.is-hidden { opacity: 0; transform: translateX(-8px); pointer-events: none; }
.hf-range__head { display: flex; align-items: center; gap: .5rem; margin-bottom: .45rem; }
.hf-range__title { flex: 1; font-size: .7rem; letter-spacing: .18em; text-transform: uppercase; color: var(--c-accent, #f0b35b); }
.hf-range__clock { font-family: var(--f-mono); font-size: .75rem; color: rgba(243,236,224,.66); direction: ltr; unicode-bidi: isolate; }
.hf-range__grid { display: grid; grid-template-columns: 1fr auto; gap: .18rem .8rem; }
.hf-range__grid b { font-family: var(--f-mono); font-weight: 500; text-align: end; direction: ltr; unicode-bidi: isolate; }
.hf-range__grid b small { font-size: .78em; color: rgba(243,236,224,.45); font-weight: 400; margin-inline-start: .35em; }
.hf-range__rule { height: 1px; background: rgba(243,236,224,.14); margin: .55rem 0 .45rem; }
.hf-range__sub { font-size: .66rem; letter-spacing: .14em; text-transform: uppercase; color: rgba(243,236,224,.55); margin-bottom: .3rem; }
.hf-range__ttk { display: grid; grid-template-columns: 2.6em 1fr 3.4em; gap: .16rem .55rem; align-items: center; }
.hf-range__ttk i { height: 3px; border-radius: 2px; background: rgba(243,236,224,.12); position: relative; overflow: hidden; }
.hf-range__ttk i::after { content: ''; position: absolute; inset: 0; background: rgba(240,179,91,.85); transform-origin: 0 50%; transform: scaleX(var(--k, 0)); transition: transform 300ms var(--ease); }
[dir='rtl'] .hf-range__ttk i::after { transform-origin: 100% 50%; }
.hf-range__ttk span, .hf-range__ttk b { font-family: var(--f-mono); font-weight: 500; direction: ltr; unicode-bidi: isolate; font-size: .92em; }
.hf-range__ttk b { text-align: end; }
.hf-range__ttk .dim { color: rgba(243,236,224,.35); }
.hf-range__wpn { display: grid; grid-template-columns: 1fr auto auto; gap: .14rem .6rem; font-size: .92em; }
.hf-range__wpn b { font-family: var(--f-mono); font-weight: 500; text-align: end; direction: ltr; unicode-bidi: isolate; }
.hf-range__empty { color: rgba(243,236,224,.5); font-size: .92em; }
.hf-range__ctl { display: flex; gap: .4rem; margin-top: .6rem; align-items: stretch; }
.hf-range__ctl button { min-height: 32px; border-radius: 8px; border: 1px solid rgba(243,236,224,.28); background: rgba(243,236,224,.05); color: inherit; font: 500 .7rem var(--f-ui);
  letter-spacing: .06em; text-transform: uppercase; cursor: pointer; padding: 0 .55rem; transition: transform 140ms var(--ease), background-color 160ms, border-color 160ms; }
.hf-range__ctl button:hover { background: rgba(243,236,224,.14); }
.hf-range__ctl button:active { transform: scale(.97); }
.hf-range__ctl button:focus-visible { outline: 2px solid var(--c-accent, #f0b35b); outline-offset: 2px; }
.hf-range__seg { flex: 1; display: flex; border-radius: 8px; overflow: hidden; border: 1px solid rgba(243,236,224,.28); }
.hf-range__seg button { flex: 1; border: 0; border-radius: 0; padding: 0 .2rem; min-height: 32px; }
.hf-range__seg button + button { border-inline-start: 1px solid rgba(243,236,224,.2); }
.hf-range__seg button.on { background: var(--c-accent, #f0b35b); color: var(--c-ink, #1d1712); }
.hf-range__speedlbl { font-size: .62rem; letter-spacing: .12em; text-transform: uppercase; color: rgba(243,236,224,.5); margin-top: .5rem; }
.hf-range__toggle { display: none; }
body.touch-ui .hf-range { left: calc(var(--safe-l, 0px) + 12.2rem); top: calc(var(--safe-t, 0px) + .55rem); width: auto; max-width: 16rem; padding: .4rem .55rem; font-size: .72rem; }
body.touch-ui .hf-range__toggle { display: inline-grid; place-items: center; min-width: 48px; min-height: 40px; border-radius: 8px; border: 1px solid rgba(243,236,224,.28); background: rgba(243,236,224,.06); color: inherit; font: 600 .78rem var(--f-mono); direction: ltr; }
body.touch-ui .hf-range:not(.is-open) .hf-range__body, body.touch-ui .hf-range:not(.is-open) .hf-range__title, body.touch-ui .hf-range:not(.is-open) .hf-range__clock { display: none; }
body.touch-ui .hf-range:not(.is-open) .hf-range__head { margin: 0; }
body.touch-ui .hf-range.is-open { max-height: calc(100vh - 2rem); overflow: auto; width: 15rem; }
body.touch-ui .hf-range__ctl button, body.touch-ui .hf-range__seg button { min-height: 48px; }
body.hf-tutorial-active .hf-range { opacity: 0; pointer-events: none; }
@media (max-height: 520px) { .hf-range { top: 18%; } body:not(.touch-ui) .hf-range .hf-range__wpnwrap { display: none; } }
`;

let injected = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const pct = (k: number): string => `${Math.round(k * 100)}%`;
const secs = (s: number): string => `${s.toFixed(2)}s`;
function clock(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

export class RangePanel implements MatchExtension {
  readonly session = new RangeSession();
  private readonly el = el('div', 'hf-range');
  private readonly body = el('div', 'hf-range__body');
  private readonly titleEl = el('div', 'hf-range__title');
  private readonly clockEl = el('div', 'hf-range__clock');
  private readonly toggle = el('button', 'hf-range__toggle');
  private readonly grid = el('div', 'hf-range__grid');
  private readonly ttk = el('div', 'hf-range__ttk');
  private readonly wpn = el('div', 'hf-range__wpn');
  private readonly labels: HTMLElement[] = [];
  private readonly vals: HTMLElement[] = [];
  private readonly ttkTitle = el('div', 'hf-range__sub');
  private readonly wpnTitle = el('div', 'hf-range__sub');
  private readonly speedLbl = el('div', 'hf-range__speedlbl');
  private readonly resetBtn = el('button');
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly floaters: Floaters;
  private readonly stations: RangeStations;
  private sig = '';
  private clockSig = '';
  private bestTimer = 0;
  private readonly toasted = new Set<string>();
  private speedIndex = 1;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly hudRoot: HTMLElement, private readonly api: MatchApi) {
    if (!injected) {
      injected = true;
      const st = document.createElement('style');
      st.dataset.owner = 'range-stats';
      st.textContent = CSS;
      document.head.append(st);
    }
    this.toggle.type = 'button';
    const head = el('div', 'hf-range__head');
    head.append(this.toggle, this.titleEl, this.clockEl);
    for (let i = 0; i < 5; i++) {
      const l = el('span');
      const b = el('b', '', '0');
      this.labels.push(l);
      this.vals.push(b);
      this.grid.append(l, b);
    }
    const ctl = el('div', 'hf-range__ctl');
    this.resetBtn.type = 'button';
    const seg = el('div', 'hf-range__seg');
    for (let i = 0; i < RANGE_SPEEDS.length; i++) {
      const b = el('button');
      b.type = 'button';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setSpeed(i);
        api.audio.ui('toggle');
      });
      this.speedBtns.push(b);
      seg.append(b);
    }
    ctl.append(this.resetBtn, seg);
    const wpnWrap = el('div', 'hf-range__wpnwrap');
    wpnWrap.append(el('div', 'hf-range__rule'), this.wpnTitle, this.wpn);
    this.body.append(this.grid, el('div', 'hf-range__rule'), this.ttkTitle, this.ttk, wpnWrap, this.speedLbl, ctl);
    this.el.append(head, this.body);
    this.resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      api.resetRange();
      api.audio.ui('confirm');
    });
    this.toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.el.classList.toggle('is-open');
      api.audio.ui('click');
      this.paintStatic();
    });
    // Touch: keep taps on the panel from reaching the look/fire layer.
    for (const ev of ['touchstart', 'pointerdown'] as const) this.el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    document.body.append(this.el);
    this.floaters = new Floaters(hudRoot);
    this.stations = new RangeStations(
      api,
      () => api.resetRange(),
      (i) => this.setSpeed(i),
    );
    this.offs.push(api.i18n.onChange(() => this.paintStatic()));
    this.paintStatic();
    this.render(true);
  }

  // ── Feed (from Feedback + ClientMatch) ───────────────────────────────────

  /** Local predicted trigger pull. */
  onShot(weapon: WeaponId = 'meridian'): void {
    this.session.onShot(this.api.localSeq, weapon);
    this.render();
  }

  /** Authoritative hit on a range target. */
  onTarget(ev: Extract<GameEvent, { t: 'target' }>): void {
    this.session.onTarget(ev);
    const t = this.api.targets.find((x) => x.id === ev.id);
    const cam = this.api.camera.position;
    if (t) this.floaters.hit(ev.id, t, ev.dmg, ev.head, ev.kill, Math.hypot(t.x - cam.x, t.y + 1.2 - cam.y, t.z - cam.z));
    this.render();
  }

  /** Session clock (called every frame by ClientMatch). */
  tick(dt: number): void {
    this.session.tick(dt);
  }

  reset(): void {
    this.session.reset();
    this.floaters.clear();
    this.toasted.clear();
    this.render(true);
  }

  summary(): RangeSummary {
    return this.session.summary();
  }

  private setSpeed(i: number): void {
    this.speedIndex = i;
    this.stations.speedIndex = i;
    this.api.setRangeSpeed(RANGE_SPEEDS[i]);
    this.paintSpeed();
  }

  // ── MatchExtension ───────────────────────────────────────────────────────

  onTick(dt: number): void {
    const api = this.api;
    const cine = this.hudRoot.classList.contains('hf-cine') || this.hudRoot.classList.contains('is-hidden');
    this.el.classList.toggle('is-hidden', cine);
    this.floaters.update(dt, api.camera, window.innerWidth, window.innerHeight);
    this.stations.update();
    const c = clock(this.session.seconds);
    if (c !== this.clockSig) {
      this.clockSig = c;
      this.clockEl.textContent = c;
      this.render();
    }
    this.bestTimer += dt;
    if (this.bestTimer > 1) {
      this.bestTimer = 0;
      this.checkBests(this.session.summary());
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private t(k: string, p?: Record<string, string | number>): string {
    return this.api.i18n.t(k, p);
  }

  private paintStatic(): void {
    this.titleEl.textContent = this.t('range.title');
    const keys = ['range.accuracy', 'range.hits', 'range.headshots', 'range.targets', 'range.streak'];
    keys.forEach((k, i) => (this.labels[i].textContent = this.t(k)));
    this.ttkTitle.textContent = this.t('range.ttk');
    this.wpnTitle.textContent = this.t('range.weapons');
    this.speedLbl.textContent = this.t('range.speed');
    this.resetBtn.textContent = this.t('range.reset');
    this.toggle.title = this.t(this.el.classList.contains('is-open') ? 'range.collapse' : 'range.expand');
    this.toggle.setAttribute('aria-label', this.toggle.title);
    this.paintSpeed();
    this.render(true);
  }

  private paintSpeed(): void {
    this.speedBtns.forEach((b, i) => {
      b.textContent = this.t(`range.speed.${i}`);
      b.classList.toggle('on', i === this.speedIndex);
      b.setAttribute('aria-pressed', String(i === this.speedIndex));
    });
  }

  private render(force = false): void {
    const s = this.session.summary();
    const sig = `${s.shots}|${s.hits}|${s.headshots}|${s.kills}|${s.bestStreak}|${s.bands.map((b) => `${b.count}:${b.avg.toFixed(2)}`).join(',')}|${s.weapons.map((w) => `${w.weapon}${w.shots}/${w.hits}`).join(',')}`;
    if (!force && sig === this.sig) return;
    this.sig = sig;
    const best = profile.value.rangeBest;
    const v = this.vals;
    v[0].textContent = s.shots ? pct(s.accuracy) : '—';
    // Personal bests ride along, labelled: a bare second number next to the value reads as noise.
    if (best?.bestAccuracy) v[0].append(this.pbTag(pct(best.bestAccuracy)));
    v[1].textContent = `${s.hits}/${s.shots}`;
    v[2].textContent = s.hits ? pct(s.headRate) : '—';
    v[3].textContent = String(s.kills);
    if (best?.mostTargets) v[3].append(this.pbTag(String(best.mostTargets)));
    v[4].textContent = String(s.bestStreak);
    if (best?.bestStreak) v[4].append(this.pbTag(String(best.bestStreak)));
    this.toggle.textContent = s.shots ? pct(s.accuracy) : '—';
    // Time to eliminate per band (always all five bands: empty ones dimmed).
    this.ttk.replaceChildren();
    const max = Math.max(0.5, ...s.bands.map((b) => b.avg));
    for (const b of s.bands) {
      const bar = el('i');
      bar.style.setProperty('--k', b.count ? Math.max(0.04, b.avg / max).toFixed(3) : '0');
      const label = el('span', b.count ? '' : 'dim', `${b.distance}m`);
      const val = el('b', b.count ? '' : 'dim', b.count ? secs(b.avg) : '—');
      const pb = best?.ttk?.[String(b.distance)];
      if (pb !== undefined) val.title = `${this.t('range.best')} ${secs(pb)}`;
      this.ttk.append(label, bar, val);
    }
    // Per-weapon breakdown.
    this.wpn.replaceChildren();
    if (!s.weapons.length) this.wpn.append(el('div', 'hf-range__empty', this.t('range.ttkEmpty')));
    for (const w of s.weapons) this.wpn.append(el('span', '', this.t(WEAPONS[w.weapon].nameKey)), el('b', '', `${w.hits}/${w.shots}`), el('b', '', w.shots ? pct(w.accuracy) : '—'));
  }

  /** Small "best 81%" tag after a value. */
  private pbTag(value: string): HTMLElement {
    const tag = el('small', '', `${this.t('range.best')} ${value}`);
    tag.title = `${this.t('range.best')} ${value}`;
    tag.dir = this.api.i18n.dir; // the value cell is LTR (numbers); the tag reads in the UI direction
    return tag;
  }

  /** Persists improved personal bests (and toasts each category once per session). */
  private checkBests(s: RangeSessionSummary): void {
    const cur = profile.value.rangeBest ?? { score: 0, accuracy: 0, headshots: 0 };
    const next = { ...cur, ttk: { ...(cur.ttk ?? {}) } };
    let changed = false;
    /** Records an improvement; toasts it once per session when it beats a stored best. */
    const improve = (key: string, had: number | undefined, better: boolean, label: string, shown: string): void => {
      if (!better) return;
      changed = true;
      if (had !== undefined && !this.toasted.has(key)) {
        this.toasted.add(key);
        this.api.hud.toast(this.t('range.newBest', { what: `${label} ${shown}` }), '#f6d58e');
        this.api.audio.ui('unlock');
      }
    };
    if (s.shots >= 20) {
      const had = cur.bestAccuracy;
      const better = had === undefined || s.accuracy > had + 1e-6;
      improve('acc', had, better, this.t('range.accuracy'), pct(s.accuracy));
      if (better) next.bestAccuracy = s.accuracy;
    }
    if (s.bestStreak > 0) {
      const had = cur.bestStreak;
      const better = had === undefined || s.bestStreak > had;
      improve('streak', had, better, this.t('range.streak'), String(s.bestStreak));
      if (better) next.bestStreak = s.bestStreak;
    }
    if (s.kills > 0) {
      const had = cur.mostTargets;
      const better = had === undefined || s.kills > had;
      improve('targets', had, better && s.kills >= 5, this.t('range.targets'), String(s.kills));
      if (better) next.mostTargets = s.kills;
      if (better && s.kills < 5) changed = true;
    }
    for (const b of s.bands) {
      if (b.count < 3) continue;
      const k = String(b.distance);
      const had = cur.ttk?.[k];
      const better = had === undefined || b.avg < had - 1e-3;
      improve(`ttk${k}`, had, better, `${k}m`, secs(b.avg));
      if (better) next.ttk[k] = Math.round(b.avg * 1000) / 1000;
    }
    if (!changed) return;
    try {
      profile.update({ rangeBest: next });
    } catch (err) {
      console.warn('[range] could not save personal bests', err);
    }
    this.render(true);
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.stations.dispose();
    this.floaters.dispose();
    this.el.remove();
  }
}
