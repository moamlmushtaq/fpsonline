// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — in-match HUD (implements contracts.Hud).
//
// Built once, mounted into the match screen. update() is called every frame
// with the full HudState but only touches the DOM when a displayed value
// changes (cached per field), and only through textContent / transform /
// opacity / class toggles — no layout reads, no allocation-heavy work.
// One-shot feedback (hit markers, elimination icon, damage arcs, toasts,
// banners) uses the Web Animations API so restarts never force reflow.
// ─────────────────────────────────────────────────────────────────────────────

import type { Hud, HudState, KillFeedEntry, ScoreboardEntry, Settings } from '../../contracts';
import type { ModeId, Team, WeaponId } from '../../../shared/types';
import { WEAPON_IDS } from '../../../shared/types';
import { WEAPONS } from '../../../shared/weapons';
import { teamColors } from '../../engine/palette';
import { h } from '../components';
import { clock, i18n, setText } from '../i18n';
import { icon, weaponIcon } from '../icons';
import { Compass, ObjectiveMarkers, ScoreboardView } from './parts';

const EASE = 'cubic-bezier(.2,.8,.2,1)';
const FEED_MAX = 5;
const FEED_TTL = 6000;
const HM_LINES = '<line x1="-12" y1="-12" x2="-5" y2="-5"/><line x1="12" y1="-12" x2="5" y2="-5"/><line x1="-12" y1="12" x2="-5" y2="5"/><line x1="12" y1="12" x2="5" y2="5"/>';

function anim(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): void {
  if (typeof (el as HTMLElement).animate === 'function') {
    (el as HTMLElement).animate(frames, { fill: 'forwards', ...opts });
  } else {
    const last = frames[frames.length - 1];
    if (last.opacity !== undefined) (el as HTMLElement).style.opacity = String(last.opacity);
  }
}

export class GameHud implements Hud {
  readonly root: HTMLElement;
  private mounted = false;

  // Parts
  private readonly compass = new Compass();
  private readonly objectives = new ObjectiveMarkers();
  private readonly sb = new ScoreboardView();

  // Elements
  private readonly vignette: HTMLElement;
  private readonly dmgLayer: HTMLElement;
  private readonly arcs: HTMLElement[] = [];
  private arcIdx = 0;
  private readonly scope: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly phaseEl: HTMLElement;
  private readonly teamA: { num: HTMLElement; bar: HTMLElement; wrap: HTMLElement };
  private readonly teamB: { num: HTMLElement; bar: HTMLElement; wrap: HTMLElement };
  private readonly zonesEl: HTMLElement;
  private readonly ffaEl: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly perf: HTMLElement;
  private readonly xh: HTMLElement;
  private readonly xhCircle: SVGCircleElement;
  private readonly hm: SVGSVGElement;
  private readonly elim: HTMLElement;
  private readonly elimName: HTMLElement;
  private readonly elimTag: HTMLElement;
  private readonly protect: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly subs: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly bannerTitle: HTMLElement;
  private readonly bannerSub: HTMLElement;
  private readonly health: HTMLElement;
  private readonly hhNum: HTMLElement;
  private readonly hhFill: HTMLElement;
  private readonly hhGhost: HTMLElement;
  private readonly ammo: HTMLElement;
  private readonly haName: HTMLElement;
  private readonly haIcon: HTMLElement;
  private readonly haMag: HTMLElement;
  private readonly haRes: HTMLElement;
  private readonly haStatus: HTMLElement;
  private readonly haArc: SVGCircleElement;
  private readonly haNeedle: SVGLineElement;
  private readonly haCharge: HTMLElement;
  private readonly haThrow: HTMLElement;
  private readonly respawn: HTMLElement;
  private readonly respawnNum: HTMLElement;
  private readonly respawnRing: SVGCircleElement;
  private readonly respawnBy: HTMLElement;

  // Cached values (NaN / '' = unknown, forces the first write).
  private c = {
    health: -1,
    healthFrac: -1,
    low: false,
    regen: false,
    lastHealth: 100,
    regenHold: 0,
    weapon: '' as WeaponId | '',
    mag: -1,
    res: -1,
    status: '',
    reloadK: -2,
    needle: -1,
    charge: -1,
    throwKey: '',
    ammoCls: '',
    time: '',
    phase: '',
    finalMin: false,
    scoreA: -1,
    scoreB: -1,
    barA: -1,
    barB: -1,
    localTeam: -1 as number,
    zonesKey: '',
    ffaKey: '',
    perf: '',
    spread: -1,
    xhOpacity: -1,
    scoped: false,
    protect: false,
    prompt: '',
    alive: true,
    respawnText: '',
    respawnK: -1,
    vignette: -1,
    mode: '' as ModeId | '',
  };
  private teamScores: [number, number] = [0, 0];
  private mode: ModeId = 'tdm';
  private killerName = '';
  private subsTimer = 0;
  private scale = 1;
  private crosshair: Settings['crosshair'] = 'cross';
  private crosshairColor = '#f3ece0';

  constructor() {
    this.root = h('div', { class: 'hud', attrs: { 'aria-hidden': 'true' } });

    // Low-health vignette + damage arcs + scope (behind everything else).
    this.vignette = h('div', { class: 'hud-vignette' });
    this.dmgLayer = h('div', { class: 'hud-dmg', attrs: { dir: 'ltr' } });
    for (let i = 0; i < 6; i++) {
      const arc = h('div', { class: 'hud-arc' });
      arc.innerHTML =
        '<svg viewBox="-100 -20 200 60"><defs><linearGradient id="hf-arc-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6a4a" stop-opacity=".95"/><stop offset="1" stop-color="#ff3a3f" stop-opacity="0"/></linearGradient></defs><path d="M-92 18 Q0 -26 92 18 L80 30 Q0 -8 -80 30 Z" fill="url(#hf-arc-g)"/></svg>';
      this.dmgLayer.append(arc);
      this.arcs.push(arc);
    }
    this.scope = h('div', { class: 'hud-scope' });
    this.scope.innerHTML = `<div class="hud-scope__mask"></div><div class="hud-scope__lens"></div>${scopeReticle()}`;

    // Top: compass + score strip.
    this.teamA = this.teamBlock('a');
    this.teamB = this.teamBlock('b');
    this.timeEl = h('span', { class: 'hs-time', text: '0:00' });
    this.phaseEl = h('span', { class: 'hs-phase' });
    const clockEl = h('div', { class: 'hs-clock' }, this.timeEl, this.phaseEl);
    this.zonesEl = h('div', { class: 'hs-zones' });
    this.ffaEl = h('div', { class: 'hud-ffa' });
    this.scoreEl = h('div', { class: 'hud-score hud-panel' }, this.teamA.wrap, clockEl, this.teamB.wrap);
    const top = h('div', { class: 'hud-top' }, this.compass.el, this.compass.heading, this.scoreEl, this.zonesEl);

    // Kill feed + perf.
    this.feed = h('div', { class: 'hud-feed' });
    this.perf = h('div', { class: 'hud-perf' });

    // Center.
    this.xh = h('div', { class: 'xh' });
    this.xh.innerHTML = '<i class="xh-dot"></i><i class="xh-l xh-t"></i><i class="xh-l xh-b"></i><i class="xh-l xh-lf"></i><i class="xh-l xh-r"></i><svg class="xh-circle" viewBox="-40 -40 80 80"><circle r="10"/></svg>';
    this.xhCircle = this.xh.querySelector('circle') as SVGCircleElement;
    this.hm = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.hm.setAttribute('class', 'hm');
    this.hm.setAttribute('viewBox', '-20 -20 40 40');
    this.hm.innerHTML = `${HM_LINES}<circle r="15"/>`;
    this.elimName = h('span', { class: 'hud-elim__name' });
    this.elimTag = h('span', { class: 'hud-elim__tag', t: 'hud.toast.headshot' });
    this.elim = h('div', { class: 'hud-elim', html: icon('elim') }, this.elimName, this.elimTag);
    this.protect = h('div', { class: 'hud-protect', html: icon('shield') }, h('span', { t: 'hud.protected' }));
    const center = h('div', { class: 'hud-center', attrs: { dir: 'ltr' } }, this.xh, this.hm, this.elim, this.protect);

    this.prompt = h('div', { class: 'hud-prompt hud-panel' });
    this.subs = h('div', { class: 'hud-subs' });
    this.toasts = h('div', { class: 'hud-toasts' });
    this.bannerTitle = h('div', { class: 'hb-title' });
    this.bannerSub = h('div', { class: 'hb-sub' });
    this.bannerEl = h('div', { class: 'hud-banner' }, this.bannerTitle, h('div', { class: 'hb-rule' }), this.bannerSub);

    // Health.
    this.hhNum = h('span', { class: 'hh-num', text: '100' });
    this.hhFill = h('div', { class: 'hh-fill' });
    this.hhGhost = h('div', { class: 'hh-ghost' });
    this.health = h(
      'div',
      { class: 'hud-health hud-panel' },
      h('div', { class: 'hh-top' }, h('i', { class: 'hh-icon' }), this.hhNum, h('span', { class: 'hh-max', text: '/100' })),
      h('div', { class: 'hh-bar' }, this.hhGhost, this.hhFill, h('div', { class: 'hh-shimmer' }), h('div', { class: 'hh-segs' })),
      h('div', { class: 'hh-ticks' }),
    );

    // Ammo.
    this.haName = h('span');
    this.haIcon = h('span');
    const dial = h('div', { class: 'ha-dial' });
    dial.innerHTML =
      '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="none" stroke="rgba(243,236,224,.18)" stroke-width="1.5"/><circle class="ha-arc" cx="20" cy="20" r="17" stroke-dasharray="106.8" stroke-dashoffset="106.8"/><g stroke="rgba(243,236,224,.5)" stroke-width="1.2"><line x1="20" y1="3" x2="20" y2="7"/><line x1="37" y1="20" x2="33" y2="20"/><line x1="20" y1="37" x2="20" y2="33"/><line x1="3" y1="20" x2="7" y2="20"/></g><line class="ha-needle" x1="20" y1="20" x2="20" y2="8"/><circle cx="20" cy="20" r="2.2" fill="#f3ece0"/></svg>';
    this.haArc = dial.querySelector('.ha-arc') as SVGCircleElement;
    this.haNeedle = dial.querySelector('.ha-needle') as SVGLineElement;
    this.haMag = h('span', { class: 'ha-mag', text: '0' });
    this.haRes = h('span', { class: 'ha-res', text: '/0' });
    this.haStatus = h('div', { class: 'ha-status' });
    this.haCharge = h('div', { class: 'ha-charge' }, h('i'));
    this.haThrow = h('div', { class: 'ha-throw' });
    this.ammo = h(
      'div',
      { class: 'hud-ammo hud-panel' },
      h('div', { class: 'ha-weapon' }, this.haName, this.haIcon),
      h('div', { class: 'ha-main' }, dial, this.haMag, this.haRes),
      this.haStatus,
      h('div', { class: 'ha-foot' }, this.haCharge, this.haThrow),
    );

    // Respawn.
    this.respawnNum = h('span', { class: 'hr-num' });
    const rd = h('div', { class: 'hr-dial' });
    rd.innerHTML =
      '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" fill="none" stroke="rgba(243,236,224,.15)" stroke-width="3"/><circle class="hr-ring" cx="40" cy="40" r="34" fill="none" stroke="#f0b35b" stroke-width="3" stroke-linecap="round" stroke-dasharray="213.6" stroke-dashoffset="0" transform="rotate(-90 40 40)"/></svg>';
    rd.append(this.respawnNum);
    this.respawnRing = rd.querySelector('.hr-ring') as SVGCircleElement;
    this.respawnBy = h('div', { class: 'hr-by' });
    this.respawn = h('div', { class: 'hud-respawn' }, h('div', { class: 'hr-card' }, this.respawnBy, rd, h('div', { class: 'hr-label', t: 'hud.redeploying' })));

    this.root.append(
      this.vignette,
      this.dmgLayer,
      this.objectives.el,
      this.scope,
      top,
      this.feed,
      this.perf,
      center,
      this.prompt,
      this.toasts,
      this.bannerEl,
      this.subs,
      this.health,
      this.ammo,
      this.respawn,
      this.sb.el,
    );
    this.applyCrosshair();
    i18n.onChange(() => this.onLang());
  }

  private teamBlock(side: 'a' | 'b') {
    const num = h('span', { class: 'hs-num', text: '0' });
    const bar = h('i');
    const wrap = h('div', { class: `hs-team hs-team--${side}` }, num, h('div', { class: 'hs-bar' }, bar));
    return { num, bar, wrap };
  }

  // ── Contract: lifecycle ──────────────────────────────────────────────────

  mount(parent: HTMLElement): void {
    parent.append(this.root);
    this.mounted = true;
    this.root.style.setProperty('--hud-scale', String(this.scale));
  }

  unmount(): void {
    this.root.remove();
    this.mounted = false;
    // Reset transient feedback so the next match starts clean.
    this.feed.replaceChildren();
    this.toasts.replaceChildren();
    this.zonesEl.replaceChildren();
    this.ffaEl.replaceChildren();
    this.objectives.clear();
    this.sb.show(false, [], this.mode, this.teamScores);
    this.subs.classList.remove('is-on');
    this.killerName = '';
    for (const k of Object.keys(this.c) as (keyof typeof this.c)[]) {
      const v = this.c[k];
      (this.c as Record<string, unknown>)[k] = typeof v === 'number' ? -1 : typeof v === 'string' ? '' : v;
    }
    this.c.alive = true;
    this.c.lastHealth = 100;
  }

  setScale(k: number): void {
    this.scale = Math.max(0.6, Math.min(1.5, k));
    this.root.style.setProperty('--hud-scale', String(this.scale));
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('is-hidden', !v);
  }

  /** Crosshair style/color from settings (called by the App on settings change). */
  setCrosshair(style: Settings['crosshair'], color: string): void {
    this.crosshair = style;
    this.crosshairColor = color;
    this.applyCrosshair();
  }

  private applyCrosshair(): void {
    this.xh.dataset.style = this.crosshair;
    this.xh.style.color = this.crosshairColor;
  }

  private onLang(): void {
    // Force re-render of text cached by value.
    this.c.status = '__';
    this.c.phase = '__';
    this.c.weapon = '';
    this.c.throwKey = '';
    this.c.prompt = '__';
    this.c.ffaKey = '';
  }

  // ── Contract: per-frame state ────────────────────────────────────────────

  update(dt: number, s: HudState): void {
    if (!this.mounted) return;
    const c = this.c;
    this.mode = s.mode;
    this.teamScores = s.teamScores;
    this.updateHealth(dt, s);
    this.updateAmmo(s);
    this.updateTop(s);
    this.compass.update(s.yaw, s.compass);
    this.objectives.update(s.objectives, window.innerWidth, window.innerHeight);

    // Crosshair: spread, fades while aiming, hidden when scoped/sprinting/dead.
    const scoped = s.scoped && s.ads > 0.85;
    const xo = !s.alive || scoped || s.sprinting ? 0 : 1 - Math.min(0.7, s.ads * 0.8);
    const xoR = Math.round(xo * 20) / 20;
    if (xoR !== c.xhOpacity) {
      c.xhOpacity = xoR;
      this.xh.style.opacity = String(xoR);
    }
    const sp = Math.round(Math.max(2, 4 + s.spread) * 2) / 2;
    if (sp !== c.spread) {
      c.spread = sp;
      this.xh.style.setProperty('--sp', `${sp}px`);
      this.xhCircle.setAttribute('r', String(Math.min(36, 6 + sp)));
    }
    if (scoped !== c.scoped) {
      c.scoped = scoped;
      this.scope.classList.toggle('is-on', scoped);
    }

    // Spawn protection.
    const prot = s.alive && s.protectedT > 0;
    if (prot !== c.protect) {
      c.protect = prot;
      this.protect.classList.toggle('is-on', prot);
    }

    // Prompt.
    const pr = s.prompt ?? '';
    if (pr !== c.prompt) {
      c.prompt = pr;
      this.prompt.textContent = pr;
      this.prompt.classList.toggle('is-on', !!pr);
    }

    // Respawn overlay.
    if (s.alive !== c.alive) {
      c.alive = s.alive;
      this.respawn.classList.toggle('is-on', !s.alive);
      if (!s.alive) {
        this.respawnBy.replaceChildren();
        if (this.killerName) {
          const t = i18n.t('hud.eliminatedBy', { name: '\u0000' }).split('\u0000');
          this.respawnBy.append(t[0] ?? '', h('b', { text: this.killerName }), t[1] ?? '');
        } else setText(this.respawnBy, 'hud.eliminated');
      }
    }
    if (!s.alive) {
      const txt = s.respawnIn > 0 ? s.respawnIn.toFixed(1) : '0.0';
      if (txt !== c.respawnText) {
        c.respawnText = txt;
        this.respawnNum.textContent = txt;
      }
      const k = Math.round(Math.max(0, Math.min(1, s.respawnIn / 4)) * 200) / 200;
      if (k !== c.respawnK) {
        c.respawnK = k;
        this.respawnRing.style.strokeDashoffset = String(213.6 * (1 - k));
      }
    }

    // Perf readout.
    const perf = s.showFps ? `${Math.round(s.fps)} fps · ${Math.round(s.ping)} ms` : '';
    if (perf !== c.perf) {
      c.perf = perf;
      this.perf.textContent = perf;
    }
  }

  private updateHealth(dt: number, s: HudState): void {
    const c = this.c;
    const hp = Math.max(0, Math.round(s.health));
    const frac = Math.max(0, Math.min(1, s.health / (s.maxHealth || 100)));
    if (hp !== c.health) {
      // Regenerating = rising health without having been hit this frame.
      if (hp > c.health && c.health >= 0) c.regenHold = 0.6;
      c.health = hp;
      this.hhNum.textContent = String(hp);
    }
    const fr = Math.round(frac * 1000) / 1000;
    if (fr !== c.healthFrac) {
      c.healthFrac = fr;
      this.hhFill.style.transform = `scaleX(${fr})`;
      this.hhGhost.style.transform = `scaleX(${fr})`;
    }
    c.regenHold = Math.max(0, c.regenHold - dt);
    const regen = c.regenHold > 0 && frac < 1;
    if (regen !== c.regen) {
      c.regen = regen;
      this.health.classList.toggle('is-regen', regen);
    }
    const low = s.alive && frac < 0.35;
    if (low !== c.low) {
      c.low = low;
      this.health.classList.toggle('is-low', low);
      this.vignette.classList.toggle('is-pulse', low);
    }
    const v = s.alive ? Math.round(Math.max(0, (0.5 - frac) / 0.5) * 20) / 20 : 0;
    if (v !== c.vignette) {
      c.vignette = v;
      this.vignette.style.opacity = String(v * 0.9);
    }
  }

  private updateAmmo(s: HudState): void {
    const c = this.c;
    if (s.weapon !== c.weapon) {
      c.weapon = s.weapon;
      setText(this.haName, WEAPONS[s.weapon]?.nameKey ?? s.weapon);
      this.haIcon.innerHTML = weaponIcon(s.weapon);
    }
    if (s.mag !== c.mag) {
      c.mag = s.mag;
      this.haMag.textContent = String(s.mag);
    }
    const res = s.weapon === 'sunspear' ? -2 : s.reserve;
    if (res !== c.res) {
      c.res = res;
      this.haRes.textContent = res === -2 ? '' : `/${s.reserve}`;
    }
    const magFrac = s.magSize > 0 ? s.mag / s.magSize : 0;
    const empty = s.mag <= 0 && s.reserve <= 0 && s.weapon !== 'sunspear';
    const low = !empty && magFrac <= 0.25 && s.reloading < 0;
    const cls = `${empty || s.mag <= 0 ? 'is-empty' : low ? 'is-low' : ''} ${s.weapon === 'sunspear' ? 'is-charge' : ''}`;
    if (cls !== c.ammoCls) {
      c.ammoCls = cls;
      this.ammo.className = `hud-ammo hud-panel ${cls}`;
    }
    const status = s.reloading >= 0 ? 'hud.reloading' : empty ? 'hud.noAmmo' : s.mag <= 0 ? 'hud.reloadPrompt' : low ? 'hud.lowAmmo' : '';
    if (status !== c.status) {
      c.status = status;
      if (status) setText(this.haStatus, status);
      else {
        delete this.haStatus.dataset.i18n;
        this.haStatus.textContent = '';
      }
    }
    // Dial: reload progress arc, else a needle showing the magazine level.
    const rk = s.reloading >= 0 ? Math.round(s.reloading * 100) / 100 : -1;
    if (rk !== c.reloadK) {
      c.reloadK = rk;
      this.haArc.style.strokeDashoffset = String(106.8 * (1 - Math.max(0, rk)));
    }
    const needle = Math.round((rk >= 0 ? rk : magFrac) * 100) / 100;
    if (needle !== c.needle) {
      c.needle = needle;
      this.haNeedle.style.transform = `rotate(${(needle * 300 - 150).toFixed(1)}deg)`;
    }
    if (s.weapon === 'sunspear') {
      const ch = Math.round(s.charge * 100) / 100;
      if (ch !== c.charge) {
        c.charge = ch;
        (this.haCharge.firstElementChild as HTMLElement).style.transform = `scaleX(${ch})`;
      }
    }
    const tk = `${s.throwable}:${s.throwables}`;
    if (tk !== c.throwKey) {
      c.throwKey = tk;
      this.haThrow.className = `ha-throw ${s.throwables > 0 ? '' : 'is-empty'}`;
      this.haThrow.innerHTML = icon(s.throwable === 'smoke' ? 'smoke' : 'grenade');
      this.haThrow.append(h('span', { text: `×${s.throwables}` }));
    }
  }

  private updateTop(s: HudState): void {
    const c = this.c;
    // Clock + phase label.
    const time = s.phase === 'live' || s.phase === 'warmup' || s.phase === 'countdown' ? clock(s.phaseLeft) : '0:00';
    if (time !== c.time) {
      c.time = time;
      this.timeEl.textContent = s.mode === 'range' ? '∞' : time;
    }
    const finalMin = s.phase === 'live' && s.phaseLeft <= 60 && s.mode !== 'range';
    if (finalMin !== c.finalMin) {
      c.finalMin = finalMin;
      this.timeEl.classList.toggle('is-final', finalMin);
    }
    const phaseKey = s.phase === 'warmup' ? 'hud.warmup' : s.phase === 'countdown' ? 'hud.countdown' : s.phase === 'ended' ? 'hud.matchOver' : s.scoreLimit > 0 ? 'hud.scoreLimit' : '';
    const phaseSig = `${phaseKey}|${s.scoreLimit}`;
    if (phaseSig !== c.phase) {
      c.phase = phaseSig;
      if (phaseKey) setText(this.phaseEl, phaseKey, { n: s.scoreLimit });
      else this.phaseEl.textContent = '';
    }
    const teams = s.mode === 'tdm' || s.mode === 'control';
    if (s.mode !== c.mode) {
      c.mode = s.mode;
      this.teamA.wrap.style.display = teams ? '' : 'none';
      this.teamB.wrap.style.display = teams ? '' : 'none';
      this.scoreEl.style.display = s.mode === 'range' ? 'none' : '';
      if (!teams) {
        if (!this.ffaEl.isConnected) this.scoreEl.prepend(this.ffaEl);
      } else this.ffaEl.remove();
    }
    if (teams) {
      // Local team always on the left.
      if (s.localTeam !== c.localTeam) {
        c.localTeam = s.localTeam;
        const mine = (s.localTeam === 1 ? 1 : 0) as Team;
        const theirs = (mine === 0 ? 1 : 0) as Team;
        // CSS variables (set by the App from teamColors()) so a colour-blind switch applies live.
        this.teamA.wrap.style.setProperty('--tc', `var(--team${mine}, ${teamColors(mine).primary})`);
        this.teamB.wrap.style.setProperty('--tc', `var(--team${theirs}, ${teamColors(theirs).primary})`);
        c.scoreA = c.scoreB = c.barA = c.barB = -1;
      }
      const mine = s.localTeam === 1 ? 1 : 0;
      const a = s.teamScores[mine];
      const b = s.teamScores[mine === 0 ? 1 : 0];
      if (a !== c.scoreA) {
        c.scoreA = a;
        this.teamA.num.textContent = String(Math.floor(a));
      }
      if (b !== c.scoreB) {
        c.scoreB = b;
        this.teamB.num.textContent = String(Math.floor(b));
      }
      const lim = s.scoreLimit || 1;
      const ba = Math.round(Math.min(1, a / lim) * 100) / 100;
      const bb = Math.round(Math.min(1, b / lim) * 100) / 100;
      if (ba !== c.barA) {
        c.barA = ba;
        this.teamA.bar.style.transform = `scaleX(${ba})`;
      }
      if (bb !== c.barB) {
        c.barB = bb;
        this.teamB.bar.style.transform = `scaleX(${bb})`;
      }
    } else if (s.ffa) {
      const key = `${s.ffa.rank}|${s.ffa.mine}|${s.ffa.leader}|${i18n.lang}`;
      if (key !== c.ffaKey) {
        c.ffaKey = key;
        this.ffaEl.replaceChildren(h('span', { t: 'hud.rank' }), h('b', { text: `#${s.ffa.rank}` }), h('span', { class: 'mono', text: `${s.ffa.mine} · ` }), h('span', { t: 'hud.leader' }), h('b', { text: String(s.ffa.leader) }));
      }
    }
    // Launch Control zone pills (derived from zone objectives).
    if (s.mode === 'control') {
      let key = '';
      for (const o of s.objectives) if (o.kind === 'zone') key += `${o.label[0]}${o.color}${o.pulse ? 1 : 0};`;
      if (key !== c.zonesKey) {
        c.zonesKey = key;
        this.zonesEl.replaceChildren();
        for (const o of s.objectives) {
          if (o.kind !== 'zone') continue;
          const z = h('span', { class: `hs-zone ${o.pulse ? 'is-pulse' : ''}`, text: o.label.slice(0, 1) });
          z.style.setProperty('--zc', o.color);
          this.zonesEl.append(z);
        }
      }
    } else if (c.zonesKey) {
      c.zonesKey = '';
      this.zonesEl.replaceChildren();
    }
  }

  // ── Contract: one-shot feedback ─────────────────────────────────────────

  hitMarker(kind: 'body' | 'head' | 'kill' | 'headkill'): void {
    const hm = this.hm;
    const head = kind === 'head' || kind === 'headkill';
    const kill = kind === 'kill' || kind === 'headkill';
    hm.setAttribute('class', `hm ${head ? 'is-head' : ''} ${kill ? 'is-kill' : ''}`);
    hm.getAnimations?.().forEach((a) => a.cancel());
    if (kill) {
      anim(hm, [
        { opacity: 1, transform: 'scale(1.55)', color: '#ff5a5f' },
        { opacity: 1, transform: 'scale(1.1)', color: head ? '#ffd166' : '#ffffff', offset: 0.35 },
        { opacity: 0, transform: 'scale(1.05)', color: head ? '#ffd166' : '#ffffff' },
      ], { duration: 520, easing: EASE });
    } else {
      anim(hm, [
        { opacity: 1, transform: `scale(${head ? 1.35 : 1.2})` },
        { opacity: 0.95, transform: 'scale(0.95)', offset: 0.4 },
        { opacity: 0, transform: 'scale(0.92)' },
      ], { duration: head ? 380 : 240, easing: EASE });
    }
    if (head) {
      const ring = hm.querySelector('circle');
      if (ring) anim(ring, [{ opacity: 1, transform: 'scale(0.6)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: 420, easing: EASE });
    }
  }

  eliminated(victimName: string, head: boolean): void {
    this.elimName.textContent = victimName;
    this.elim.classList.toggle('is-head', head);
    this.elimTag.style.display = head ? '' : 'none';
    this.elim.getAnimations?.().forEach((a) => a.cancel());
    anim(this.elim, [
      { opacity: 0, transform: 'translateX(-50%) scale(1.4)' },
      { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.12 },
      { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.8 },
      { opacity: 0, transform: 'translateX(-50%) translateY(-0.4em) scale(0.96)' },
    ], { duration: 1700, easing: 'ease-out' });
  }

  killFeed(e: KillFeedEntry): void {
    if (e.victim.local && e.killer && !e.killer.local) this.killerName = e.killer.name;
    const row = h('div', { class: `kf ${e.killer?.local || e.victim.local ? 'is-local' : ''}` });
    const nameEl = (p: { name: string; team: Team; local: boolean }) => {
      const n = h('span', { class: 'kf__name', text: p.name });
      n.style.color = p.local ? 'var(--c-accent-hi)' : p.team === 2 ? 'var(--c-text)' : teamColors(p.team).light;
      return n;
    };
    if (e.killer) row.append(nameEl(e.killer));
    const cause = e.cause;
    if ((WEAPON_IDS as readonly string[]).includes(cause)) row.insertAdjacentHTML('beforeend', weaponIcon(cause as WeaponId));
    else row.insertAdjacentHTML('beforeend', icon(cause === 'grenade' ? 'grenade' : 'warning'));
    if (e.head) row.insertAdjacentHTML('beforeend', `<span class="kf__head">${icon('headshot')}</span>`);
    row.append(nameEl(e.victim));
    this.feed.prepend(row);
    while (this.feed.children.length > FEED_MAX) this.feed.lastElementChild?.remove();
    window.setTimeout(() => {
      row.classList.add('is-out');
      window.setTimeout(() => row.remove(), 420);
    }, FEED_TTL);
  }

  damage(angle: number, amount: number): void {
    const arc = this.arcs[this.arcIdx];
    this.arcIdx = (this.arcIdx + 1) % this.arcs.length;
    const k = Math.max(0.35, Math.min(1, amount / 35));
    // angle: 0 = front, + = left → rotate counter-clockwise on screen.
    const deg = (-angle * 180) / Math.PI;
    arc.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    arc.getAnimations?.().forEach((a) => a.cancel());
    anim(arc, [
      { opacity: k, transform: `rotate(${deg.toFixed(1)}deg) scale(1.06)` },
      { opacity: k * 0.85, transform: `rotate(${deg.toFixed(1)}deg) scale(1)`, offset: 0.25 },
      { opacity: 0, transform: `rotate(${deg.toFixed(1)}deg) scale(1)` },
    ], { duration: 1300, easing: 'ease-out' });
  }

  banner(title: string, sub?: string, color?: string): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub ?? '';
    this.bannerEl.style.setProperty('--bc', color ?? 'var(--c-text)');
    this.bannerEl.getAnimations?.().forEach((a) => a.cancel());
    anim(this.bannerEl, [
      { opacity: 0, transform: 'translateX(-50%) scale(1.08)', letterSpacing: '0.1em' },
      { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.12 },
      { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.82 },
      { opacity: 0, transform: 'translateX(-50%) translateY(-0.6em) scale(0.98)' },
    ], { duration: 2600, easing: 'ease-out' });
  }

  subtitle(text: string, durationMs: number): void {
    this.subs.textContent = text;
    this.subs.classList.add('is-on');
    if (this.subsTimer) window.clearTimeout(this.subsTimer);
    this.subsTimer = window.setTimeout(() => this.subs.classList.remove('is-on'), durationMs);
  }

  toast(text: string, color?: string): void {
    const t = h('div', { class: 'ht' });
    // "+100 Elimination": put the number in mono.
    const m = /^([+-]\d+)\s*(.*)$/.exec(text);
    if (m) t.append(h('b', { text: m[1] }), m[2]);
    else t.textContent = text;
    if (color) t.style.setProperty('--tc', color);
    this.toasts.prepend(t);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild?.remove();
    anim(t, [
      { opacity: 0, transform: 'translateX(-0.6em)' },
      { opacity: 1, transform: 'translateX(0)', offset: 0.1 },
      { opacity: 1, transform: 'translateX(0)', offset: 0.75 },
      { opacity: 0, transform: 'translateY(-0.4em)' },
    ], { duration: 1900, easing: 'ease-out' });
    window.setTimeout(() => t.remove(), 1950);
  }

  scoreboard(visible: boolean, rows: ScoreboardEntry[], mode: ModeId): void {
    this.sb.show(visible, rows, mode, this.teamScores);
  }
}

/** Longline scope reticle: fine crosshair, mil-dot ticks and a range ladder. */
function scopeReticle(): string {
  let ticks = '';
  for (let i = 1; i <= 8; i++) {
    const d = i * 22;
    const l = i % 2 === 0 ? 7 : 4;
    ticks += `<line x1="${d}" y1="${-l}" x2="${d}" y2="${l}"/><line x1="${-d}" y1="${-l}" x2="${-d}" y2="${l}"/><line x1="${-l}" y1="${d}" x2="${l}" y2="${d}"/>`;
  }
  let ladder = '';
  for (let i = 1; i <= 4; i++) {
    const y = 40 + i * 26;
    const w = 26 - i * 4;
    ladder += `<line x1="${-w}" y1="${y}" x2="${w}" y2="${y}" stroke-opacity=".7"/><text x="${w + 6}" y="${y + 3}" font-size="8" fill="#f0b35b" stroke="none" font-family="JetBrains Mono, monospace">${i * 100}</text>`;
  }
  return `<svg viewBox="-350 -350 700 700" fill="none" stroke="#1d1a17" stroke-width="1.4" stroke-linecap="round">
    <line x1="-350" y1="0" x2="-14" y2="0"/><line x1="14" y1="0" x2="350" y2="0"/>
    <line x1="0" y1="-350" x2="0" y2="-14"/><line x1="0" y1="14" x2="0" y2="350"/>
    <line x1="-350" y1="0" x2="-210" y2="0" stroke-width="5"/><line x1="210" y1="0" x2="350" y2="0" stroke-width="5"/><line x1="0" y1="210" x2="0" y2="350" stroke-width="5"/>
    <g stroke-width="1.2">${ticks}</g>
    <g>${ladder}</g>
    <circle r="1.8" fill="#ff5a5f" stroke="none"/>
    <circle r="330" stroke="#f0b35b" stroke-opacity=".35" stroke-width="1"/>
  </svg>`;
}
