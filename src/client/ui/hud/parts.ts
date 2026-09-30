// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — HUD parts: compass bar, world-anchored objective markers and
// the scoreboard overlay. Each part owns its DOM and only writes when a value
// actually changed (no layout reads in the hot path, transforms only).
// ─────────────────────────────────────────────────────────────────────────────

import type { HudCompassMarker, HudObjective, ScoreboardEntry } from '../../contracts';
import type { ModeId, Team } from '../../../shared/types';
import { teamColors } from '../../engine/palette';
import { h } from '../components';
import { i18n, setText } from '../i18n';
import { icon } from '../icons';

const RAD = 180 / Math.PI;
/** em per degree on the compass strip (26em shows ±75°). */
const EM_PER_DEG = 26 / 150;
const COMPASS_HALF_FOV = 72;

function wrapDeg(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

// ── Compass ─────────────────────────────────────────────────────────────────

interface MarkerSlot {
  el: HTMLElement;
  key: string;
  x: number;
  visible: boolean;
}

export class Compass {
  readonly el: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly headingEl: HTMLElement;
  private readonly slots: MarkerSlot[] = [];
  private lastHeading = Number.NaN;
  private lastHeadingText = '';

  constructor() {
    this.el = h('div', { class: 'hud-compass', attrs: { dir: 'ltr' } });
    this.strip = h('div', { class: 'hc-strip' });
    const cardinals: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let deg = -180; deg <= 540; deg += 15) {
      const d = ((deg % 360) + 360) % 360;
      const major = d % 45 === 0;
      const tick = h('i', { class: `hc-tick ${major ? 'is-major' : ''}` });
      tick.style.left = `${deg * EM_PER_DEG}em`;
      this.strip.append(tick);
      if (major) {
        const card = cardinals[d];
        const label = h('span', { class: `hc-label ${card ? 'is-cardinal' : ''} ${d === 0 ? 'is-north' : ''}` });
        if (card) setText(label, `hud.compass.${card}`);
        else label.textContent = String(d);
        label.style.left = `${deg * EM_PER_DEG}em`;
        this.strip.append(label);
      }
    }
    this.el.append(this.strip, h('i', { class: 'hc-center' }));
    this.headingEl = h('div', { class: 'hc-heading' });
  }

  get heading(): HTMLElement {
    return this.headingEl;
  }

  /** yaw: local camera yaw (radians; 0 = north/−Z, + = left). */
  update(yaw: number, markers: HudCompassMarker[]): void {
    const heading = ((-yaw * RAD) % 360 + 360) % 360;
    if (!(Math.abs(heading - this.lastHeading) <= 0.05)) {
      this.lastHeading = heading;
      this.strip.style.transform = `translateX(${(-heading * EM_PER_DEG).toFixed(3)}em)`;
      const txt = String(Math.round(heading) % 360).padStart(3, '0');
      if (txt !== this.lastHeadingText) {
        this.lastHeadingText = txt;
        this.headingEl.textContent = txt;
      }
    }
    // Markers.
    while (this.slots.length < markers.length && this.slots.length < 16) {
      const el = h('div', { class: 'hc-marker' });
      el.style.display = 'none';
      this.el.append(el);
      this.slots.push({ el, key: '', x: Number.NaN, visible: false });
    }
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const m = markers[i];
      if (!m) {
        if (slot.visible) {
          slot.el.style.display = 'none';
          slot.visible = false;
        }
        continue;
      }
      // Relative angle: + = marker to the left of view (yaw convention), screen x grows right.
      const rel = wrapDeg((m.yaw - yaw) * RAD);
      const inView = Math.abs(rel) <= COMPASS_HALF_FOV;
      if (!inView) {
        if (slot.visible) {
          slot.el.style.display = 'none';
          slot.visible = false;
        }
        continue;
      }
      const key = `${m.kind}|${m.label}|${m.color}`;
      if (key !== slot.key) {
        slot.key = key;
        slot.el.className = `hc-marker ${m.kind === 'zone' ? 'hc-marker--zone' : ''}`;
        slot.el.style.setProperty('--mc', m.color);
        if (m.kind === 'zone') slot.el.textContent = m.label;
        else slot.el.innerHTML = icon(m.kind === 'pickup' ? 'pickup' : m.kind === 'ping' ? 'target' : iconForLandmark(m.label));
        slot.el.title = m.label;
      }
      if (!slot.visible) {
        slot.el.style.display = '';
        slot.visible = true;
      }
      const x = -rel * EM_PER_DEG;
      // (NaN-safe: the first write always happens.)
      if (!(Math.abs(x - slot.x) <= 0.01)) {
        slot.x = x;
        slot.el.style.transform = `translateX(${x.toFixed(3)}em)`;
      }
    }
  }
}

/** Landmark labels arrive already translated; pick a glyph from well-known words. */
function iconForLandmark(label: string): Parameters<typeof icon>[0] {
  const l = label.toLowerCase();
  if (/tower|برج الإطلاق/.test(l)) return 'tower';
  if (/dome|قبة/.test(l)) return 'dome';
  if (/mall|مركز/.test(l)) return 'mall';
  if (/sea|البحر/.test(l)) return 'sea';
  if (/crane|رافعة/.test(l)) return 'crane';
  if (/rocket|صاروخ/.test(l)) return 'rocket';
  if (/sun|غروب|الشمس|light|الضوء/.test(l)) return 'sun';
  if (/street|yard|house|شارع|حدائق/.test(l)) return 'house';
  return 'antenna';
}

// ── Objective markers (world-anchored, edge-clamped) ───────────────────────

interface ObjSlot {
  el: HTMLElement;
  ring: SVGCircleElement;
  shape: SVGElement;
  letter: HTMLElement;
  dist: HTMLElement;
  key: string;
  x: number;
  y: number;
  prog: number;
  d: number;
  visible: boolean;
}

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

export class ObjectiveMarkers {
  readonly el: HTMLElement;
  private readonly slots: ObjSlot[] = [];

  constructor() {
    this.el = h('div', { class: 'hud-objectives', attrs: { dir: 'ltr' } });
  }

  private slot(): ObjSlot {
    const el = h('div', { class: 'obj' });
    const badge = h('div', { class: 'obj__badge' });
    badge.innerHTML = `<svg viewBox="-20 -20 40 40"><polygon class="obj-shape" points="0,-13 11.3,-6.5 11.3,6.5 0,13 -11.3,6.5 -11.3,-6.5" fill="rgba(20,18,16,.55)" stroke="currentColor" stroke-width="1.6"/><circle r="${RING_R}" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="2"/><circle class="obj-ring" r="${RING_R}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" transform="rotate(-90)"/></svg>`;
    const letter = h('span', { class: 'obj__letter' });
    badge.append(letter);
    const dist = h('span', { class: 'obj__dist' });
    el.append(badge, dist);
    el.style.display = 'none';
    this.el.append(el);
    const s: ObjSlot = {
      el,
      ring: badge.querySelector('.obj-ring') as SVGCircleElement,
      shape: badge.querySelector('.obj-shape') as SVGElement,
      letter,
      dist,
      key: '',
      x: Number.NaN,
      y: Number.NaN,
      prog: -1,
      d: -1,
      visible: false,
    };
    this.slots.push(s);
    return s;
  }

  update(objs: HudObjective[], vw: number, vh: number): void {
    while (this.slots.length < Math.min(objs.length, 12)) this.slot();
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const o = objs[i];
      if (!o || !o.screen) {
        if (s.visible) {
          s.el.style.display = 'none';
          s.visible = false;
        }
        continue;
      }
      if (!s.visible) {
        s.el.style.display = '';
        s.visible = true;
      }
      const key = `${o.kind}|${o.label}|${o.color}|${o.offscreen ? 1 : 0}|${o.pulse ? 1 : 0}`;
      if (key !== s.key) {
        s.key = key;
        s.el.className = `obj ${o.offscreen ? 'is-off' : ''} ${o.pulse ? 'is-pulse' : ''}`;
        s.el.style.setProperty('--oc', o.color);
        s.letter.textContent = o.kind === 'zone' ? o.label.slice(0, 1) : o.kind === 'pickup' ? '◆' : '';
        const pts = o.kind === 'pickup' ? '0,-13 13,0 0,13 -13,0' : o.kind === 'friendly' ? '0,-9 9,6 -9,6' : '0,-13 11.3,-6.5 11.3,6.5 0,13 -11.3,6.5 -11.3,-6.5';
        s.shape.setAttribute('points', pts);
      }
      // Clamp inside the safe frame (the match also edge-clamps).
      const m = 28;
      const x = Math.max(m, Math.min(vw - m, o.screen.x));
      const y = Math.max(m + 40, Math.min(vh - m - 60, o.screen.y));
      if (!(Math.abs(x - s.x) <= 0.5 && Math.abs(y - s.y) <= 0.5)) {
        s.x = x;
        s.y = y;
        s.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translateX(-50%)`;
      }
      const p = Math.round(Math.max(0, Math.min(1, o.progress)) * 100) / 100;
      if (p !== s.prog) {
        s.prog = p;
        s.ring.style.strokeDashoffset = String(RING_C * (1 - p));
      }
      const d = Math.round(o.distance);
      if (d !== s.d) {
        s.d = d;
        s.dist.textContent = `${d}m`;
      }
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.el.style.display = 'none';
      s.visible = false;
    }
  }
}

// ── Scoreboard ──────────────────────────────────────────────────────────────

export class ScoreboardView {
  readonly el: HTMLElement;
  private sig = '';
  private visible = false;

  constructor() {
    this.el = h('div', { class: 'hud-sb', attrs: { role: 'dialog' } });
  }

  show(visible: boolean, rows: ScoreboardEntry[], mode: ModeId, teamScores: [number, number]): void {
    if (visible !== this.visible) {
      this.visible = visible;
      this.el.classList.toggle('is-on', visible);
    }
    if (!visible) return;
    const sig = `${mode}|${teamScores.join(',')}|${i18n.lang}|${rows.map((r) => `${r.id}:${r.kills}:${r.deaths}:${r.assists}:${r.score}:${r.ping}:${r.alive ? 1 : 0}:${r.team}`).join(';')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.render(rows, mode, teamScores);
  }

  private table(rows: ScoreboardEntry[], mode: ModeId): HTMLElement {
    const table = h('table', { class: 'sb-table' });
    const cols = ['hud.sb.pilot', 'hud.sb.k', 'hud.sb.d', 'hud.sb.a'];
    if (mode === 'control') cols.push('hud.sb.obj');
    cols.push('hud.sb.score', 'hud.sb.ping');
    table.append(h('thead', {}, h('tr', {}, ...cols.map((c) => h('th', { t: c })))));
    const body = h('tbody');
    for (const r of [...rows].sort((a, b) => b.score - a.score || b.kills - a.kills)) {
      const name = h('td', {}, h('span', { class: 'mono faint', style: 'margin-inline-end:.4em', text: String(r.level) }), r.name);
      if (r.isBot) name.append(h('span', { class: 'sb-bot', t: 'common.bot' }));
      const tr = h('tr', { class: `${r.local ? 'is-you' : ''} ${r.alive ? '' : 'is-dead'}` }, name, h('td', { text: String(r.kills) }), h('td', { text: String(r.deaths) }), h('td', { text: String(r.assists) }));
      if (mode === 'control') tr.append(h('td', { text: `${Math.round(r.objectiveTime)}s` }));
      tr.append(h('td', { text: String(r.score) }), h('td', { text: r.isBot ? '—' : String(Math.round(r.ping)) }));
      body.append(tr);
    }
    table.append(body);
    return table;
  }

  private render(rows: ScoreboardEntry[], mode: ModeId, teamScores: [number, number]): void {
    this.el.replaceChildren();
    const head = h('div', { class: 'hud-sb__head' }, h('span', { t: `mode.${mode}.name` }), h('span', { t: 'hud.sb.players' }));
    this.el.append(head);
    const teams = mode === 'tdm' || mode === 'control';
    const cols = h('div', { class: `hud-sb__cols ${teams ? '' : 'is-single'}` });
    if (teams) {
      const local = rows.find((r) => r.local);
      const order: Team[] = local && local.team === 1 ? [1, 0] : [0, 1];
      for (const t of order) {
        const col = h('div');
        const th = h('div', { class: 'sb-team-h' }, h('span', { t: `common.team.${t}` }), h('b', { text: String(teamScores[t as 0 | 1] ?? 0) }));
        th.style.setProperty('--tc', teamColors(t).primary);
        col.append(th, this.table(rows.filter((r) => r.team === t), mode));
        cols.append(col);
      }
    } else cols.append(this.table(rows, mode));
    this.el.append(cols);
  }
}
