// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Settings: Gameplay, Controls (rebinding, controller diagram,
// touch layout), Graphics, Audio, Accessibility, Language. Works as a full
// screen from the menu and as an overlay inside a match (pushed from Pause).
// Every control writes through settings.update(); the App applies changes live.
// ─────────────────────────────────────────────────────────────────────────────

import type { Action, QualityPreset, Settings } from '../../contracts';
import type { App } from '../../app';
import { teamColors, type ColorblindMode } from '../../engine/palette';
import { ACTIONS, keyLabel } from '../../state/settings';
import { button, h, keybind, screenHeader, sectionLabel, segmented, settingRow, slider, stagger, tabs, toggle } from '../components';
import { i18n, refreshDom, setText } from '../i18n';
import { BaseScreen } from './base';
// Controls (input engineer): rebinding swaps on conflict instead of silently stealing.
import { rebindWithSwap } from '../../input/rebind';
import { cmPer360 } from '../../input/input';

type Tab = 'gameplay' | 'controls' | 'graphics' | 'audio' | 'accessibility' | 'language';

const CROSSHAIR_COLORS = ['#f3ece0', '#b9e07a', '#ffd166', '#7fe7ff', '#ff8ad8', '#ff5a5f'];

const PAD_SVG = `<svg class="pad-diagram" viewBox="0 0 520 250" dir="ltr" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M180 60h160c30 0 52 18 60 48l20 76c7 26-22 44-42 26l-34-32H176l-34 32c-20 18-49 0-42-26l20-76c8-30 30-48 60-48z" stroke-opacity=".8"/>
  <path d="M176 44h44M300 44h44" stroke-width="3" stroke-opacity=".6"/>
  <circle cx="200" cy="112" r="16"/><circle cx="200" cy="112" r="7" fill="currentColor" fill-opacity=".25"/>
  <circle cx="300" cy="152" r="16"/><circle cx="300" cy="152" r="7" fill="currentColor" fill-opacity=".25"/>
  <path d="M222 150h-10v-10h-10v10h-10v10h10v10h10v-10h10z" stroke-opacity=".8"/>
  <circle cx="338" cy="96" r="7"/><circle cx="356" cy="112" r="7"/><circle cx="320" cy="112" r="7"/><circle cx="338" cy="128" r="7"/>
  <path d="M244 100h8M268 100h8" stroke-width="3"/>
  <g stroke-opacity=".35" stroke-width="1">
    <path d="M200 112H120M300 152 L300 222 L420 222M338 128 L430 170M356 112 L440 112M338 96 L430 64M320 112 L300 80 L440 36M180 44 L110 44 L80 30M340 44 L410 30M212 150 L120 170M248 100 L160 80M272 100 L300 60 L360 60"/>
  </g>
  <g stroke="none">
    <text x="112" y="116" text-anchor="end" data-i18n="settings.pad.move"></text>
    <text x="112" y="130" text-anchor="end" class="pad-key">L</text>
    <text x="428" y="226" data-i18n="settings.pad.look"></text>
    <text x="436" y="174" data-i18n="settings.pad.jump"></text><text x="436" y="186" class="pad-key">A</text>
    <text x="446" y="116" data-i18n="settings.pad.crouch"></text><text x="446" y="128" class="pad-key">B</text>
    <text x="436" y="68" data-i18n="settings.pad.swap"></text><text x="436" y="80" class="pad-key">Y</text>
    <text x="446" y="40" data-i18n="settings.pad.reload"></text><text x="446" y="52" class="pad-key">X</text>
    <text x="72" y="26" text-anchor="end" data-i18n="settings.pad.ads"></text><text x="72" y="38" text-anchor="end" class="pad-key">LT</text>
    <text x="416" y="26" data-i18n="settings.pad.fire"></text><text x="416" y="38" class="pad-key">RT</text>
    <text x="112" y="174" text-anchor="end" data-i18n="settings.pad.throw"></text><text x="112" y="186" text-anchor="end" class="pad-key">LB</text>
    <text x="152" y="76" text-anchor="end" data-i18n="settings.pad.scores"></text>
    <text x="366" y="56" data-i18n="settings.pad.pause"></text>
    <text x="200" y="146" text-anchor="middle" class="pad-key" transform="translate(-86 64)" data-i18n="settings.pad.sprint"></text>
  </g>
</svg>`;

export class SettingsScreen extends BaseScreen {
  readonly id = 'settings' as const;
  private tab: Tab = 'gameplay';
  private pane: HTMLElement | null = null;

  constructor(app: App) {
    super(app, 'screen--sub screen--wide');
  }

  protected build(params?: unknown): void {
    const p = (params ?? {}) as { tab?: Tab };
    if (p.tab) this.tab = p.tab;
    const overlay = this.el.classList.contains('is-overlay');
    const head = screenHeader({
      title: 'settings.title',
      onBack: () => (overlay ? void this.app.ui.pop() : void this.app.ui.show('menu')),
    });
    const t = tabs<Tab>({
      tabs: [
        { id: 'gameplay', label: 'settings.tab.gameplay', icon: 'target' },
        { id: 'controls', label: 'settings.tab.controls', icon: 'gamepad' },
        { id: 'graphics', label: 'settings.tab.graphics', icon: 'eye' },
        { id: 'audio', label: 'settings.tab.audio', icon: 'speaker' },
        { id: 'accessibility', label: 'settings.tab.accessibility', icon: 'contrast' },
        { id: 'language', label: 'settings.tab.language', icon: 'globe' },
      ],
      value: this.tab,
      onChange: (id) => {
        this.tab = id;
        this.renderPane(true);
      },
    });
    this.pane = h('div', { class: 'settings-pane scroll' });
    const reset = button({
      label: 'settings.resetAll',
      icon: 'refresh',
      variant: 'ghost',
      size: 'sm',
      onClick: async () => {
        const ok = await this.app.ui.confirm('settings.resetConfirm.title', 'settings.resetConfirm.body', 'common.reset', 'common.cancel');
        if (ok) {
          this.app.settings.reset();
          this.renderPane(false);
        }
      },
    });
    const body = h('div', { class: 'settings-body panel ticks' }, t.el, this.pane, h('div', { class: 'scr-foot', style: 'padding:.5rem .9rem 0' }, reset));
    this.el.append(head, body);
    stagger([head, body]);
    this.renderPane(false);
    this.track(i18n.onChange(() => this.renderPane(false)));
  }

  private get s(): Settings {
    return this.app.settings.value;
  }

  private set(patch: Partial<Settings>): void {
    this.app.settings.update(patch);
  }

  private renderPane(animate: boolean): void {
    const pane = this.pane;
    if (!pane) return;
    const scroll = pane.scrollTop;
    pane.replaceChildren();
    const groups: HTMLElement[] = [];
    const group = (label: string | null, ...rows: HTMLElement[]) => {
      const g = h('div', { class: 'settings-group' });
      if (label) g.append(sectionLabel(label));
      g.append(...rows);
      groups.push(g);
      pane.append(g);
    };
    const tg = (key: keyof Settings, label: string, desc?: string) =>
      settingRow(label, toggle({ value: this.s[key] as boolean, onChange: (v) => this.set({ [key]: v } as Partial<Settings>), label }).el, desc);
    const sl = (key: keyof Settings, label: string, min: number, max: number, step: number, fmt: (v: number) => string, desc?: string) =>
      settingRow(label, slider({ min, max, step, value: this.s[key] as number, format: fmt, onChange: (v) => this.set({ [key]: v } as Partial<Settings>), label }).el, desc);
    const x2 = (v: number) => v.toFixed(2);
    const pct = (v: number) => `${Math.round(v * 100)}%`;

    switch (this.tab) {
      case 'gameplay': {
        // Controls polish: cm/360° readout under mouse sensitivity (helper in input/input.ts).
        const cmEl = h('div', { class: 'row__desc' });
        const paintCm = (v: number) => setText(cmEl, 'controls.cm360', { cm: cmPer360(v).toFixed(1) });
        paintCm(this.s.mouseSensitivity);
        const mouseRow = settingRow(
          'settings.mouseSensitivity',
          slider({ min: 0.1, max: 5, step: 0.05, value: this.s.mouseSensitivity, format: x2, onChange: (v) => (this.set({ mouseSensitivity: v }), paintCm(v)), label: 'settings.mouseSensitivity' }).el,
        );
        mouseRow.firstElementChild?.append(cmEl);
        group(
          'settings.group.aim',
          mouseRow,
          sl('adsSensitivity', 'settings.adsSensitivity', 0.2, 2, 0.05, x2),
          sl('touchSensitivity', 'settings.touchSensitivity', 0.1, 5, 0.05, x2),
          sl('gamepadSensitivity', 'settings.gamepadSensitivity', 0.1, 5, 0.05, x2),
          sl('fov', 'settings.fov', 70, 110, 1, (v) => `${Math.round(v)}°`),
          tg('invertY', 'settings.invertY'),
          tg('aimAssist', 'settings.aimAssist', 'settings.aimAssist.desc'),
        );
        group('settings.group.movement', tg('toggleCrouch', 'settings.toggleCrouch'), tg('toggleAds', 'settings.toggleAds'), tg('autoSprint', 'settings.autoSprint'));
        const style = segmented<Settings['crosshair']>({
          options: [
            { value: 'dot', label: 'settings.crosshair.dot' },
            { value: 'cross', label: 'settings.crosshair.cross' },
            { value: 'circle', label: 'settings.crosshair.circle' },
          ],
          value: this.s.crosshair,
          onChange: (v) => this.set({ crosshair: v }),
        });
        const dots = h('div', { class: 'color-dots', attrs: { role: 'radiogroup' } });
        for (const c of CROSSHAIR_COLORS) {
          const d = h('button', { class: `color-dot ${c === this.s.crosshairColor ? 'is-active' : ''}`, attrs: { type: 'button', 'aria-label': c } });
          d.dataset.sfx = 'toggle';
          d.dataset.navLr = 'group';
          d.style.background = c;
          d.addEventListener('click', () => {
            dots.querySelectorAll('.color-dot').forEach((x) => x.classList.remove('is-active'));
            d.classList.add('is-active');
            this.set({ crosshairColor: c });
          });
          dots.append(d);
        }
        group('settings.group.crosshair', settingRow('settings.crosshair', style.el), settingRow('settings.crosshairColor', dots));
        group('settings.group.feedback', tg('haptics', 'settings.haptics'));
        break;
      }
      case 'controls': {
        const rows: HTMLElement[] = [];
        for (const a of ACTIONS) rows.push(this.bindRow(a));
        const hint = h('p', { class: 'row__desc', style: 'padding:0 .9rem .5rem', t: 'settings.bind.hint' });
        const reset = button({
          label: 'settings.bind.reset',
          icon: 'refresh',
          size: 'sm',
          onClick: () => {
            this.app.settings.resetBindings();
            this.renderPane(false);
          },
        });
        const kbm = () => group('settings.group.keyboard', hint, ...rows, h('div', { style: 'padding:.6rem .9rem' }, reset));
        const gamepad = () => {
          const pad = h('div', { style: 'padding:.5rem .9rem', html: PAD_SVG });
          refreshDom(pad);
          group('settings.group.gamepad', pad, sl('gamepadSensitivity', 'settings.gamepadSensitivity', 0.1, 5, 0.05, x2));
        };
        const touch = () => {
          const touchRows: HTMLElement[] = [sl('touchOpacity', 'settings.touch.opacity', 0.2, 1, 0.05, pct), sl('touchSensitivity', 'settings.touchSensitivity', 0.1, 5, 0.05, x2)];
          const editor = this.app.openTouchLayoutEditor;
          if (typeof editor === 'function') {
            touchRows.unshift(settingRow('settings.touch.customize', button({ label: 'settings.touch.customize', icon: 'touch', size: 'sm', onClick: () => editor.call(this.app) })));
          }
          group('settings.group.touch', ...touchRows);
        };
        // The device in hand comes first (a phone player should not scroll past 20 key bindings).
        const dev = this.app.input?.device;
        for (const add of dev === 'touch' ? [touch, gamepad, kbm] : dev === 'gamepad' ? [gamepad, kbm, touch] : [kbm, gamepad, touch]) add();
        break;
      }
      case 'graphics': {
        const current = h('span', { class: 'mono accent', style: 'font-size:.75rem' });
        const paintCurrent = () => setText(current, 'settings.quality.current', { preset: i18n.t(`settings.quality.${this.app.engine?.quality.preset ?? 'medium'}`) });
        paintCurrent();
        this.track(this.app.engine?.onQualityChange?.(() => paintCurrent()));
        const q = segmented<QualityPreset>({
          options: [
            { value: 'auto', label: 'settings.quality.auto' },
            { value: 'low', label: 'settings.quality.low' },
            { value: 'medium', label: 'settings.quality.medium' },
            { value: 'high', label: 'settings.quality.high' },
          ],
          value: this.s.quality,
          onChange: (v) => {
            this.set({ quality: v });
            requestAnimationFrame(paintCurrent);
          },
        });
        const qRow = settingRow('settings.quality', q.el, 'settings.quality.desc');
        qRow.querySelector('.row__desc')?.after(h('div', { style: 'margin-top:.25rem' }, current));
        group(null, qRow, sl('renderScale', 'settings.renderScale', 0.5, 1, 0.05, pct), tg('showFps', 'settings.showFps'));
        break;
      }
      case 'audio': {
        const vol = (k: keyof Settings['volumes'], label: string) =>
          settingRow(
            label,
            slider({
              min: 0,
              max: 1,
              step: 0.05,
              value: this.s.volumes[k],
              format: pct,
              onChange: (v) => this.set({ volumes: { ...this.s.volumes, [k]: v } }),
              label,
            }).el,
          );
        group(null, vol('master', 'settings.vol.master'), vol('music', 'settings.vol.music'), vol('sfx', 'settings.vol.sfx'), vol('voice', 'settings.vol.voice'), vol('ui', 'settings.vol.ui'), tg('subtitles', 'settings.subtitles', 'settings.subtitles.desc'));
        break;
      }
      case 'accessibility': {
        const sw = h('div', { class: 'cb-swatches' });
        const paintSw = (m: ColorblindMode) => {
          sw.replaceChildren();
          for (const team of [0, 1, 2] as const) {
            const c = teamColors(team, m).primary;
            const d = h('span', { class: 'cb-swatch' });
            d.style.background = c;
            d.style.color = c;
            sw.append(d);
          }
        };
        paintSw(this.s.colorblind);
        const cb = segmented<ColorblindMode>({
          options: [
            { value: 'off', label: 'settings.colorblind.off' },
            { value: 'protanopia', label: 'settings.colorblind.protanopia' },
            { value: 'deuteranopia', label: 'settings.colorblind.deuteranopia' },
            { value: 'tritanopia', label: 'settings.colorblind.tritanopia' },
          ],
          value: this.s.colorblind,
          onChange: (v) => {
            this.set({ colorblind: v });
            paintSw(v);
          },
        });
        const cbRow = settingRow('settings.colorblind', cb.el, 'settings.colorblind.desc');
        cbRow.querySelector('.row__desc')?.after(h('div', { style: 'margin-top:.45rem' }, sw));
        group(
          null,
          cbRow,
          sl('hudScale', 'settings.hudScale', 0.75, 1.3, 0.05, pct),
          tg('reducedShake', 'settings.reducedShake', 'settings.reducedShake.desc'),
          tg('subtitles', 'settings.subtitles', 'settings.subtitles.desc'),
        );
        break;
      }
      case 'language': {
        const cards = h('div', { class: 'lang-cards' });
        for (const l of ['en', 'ar'] as const) {
          const c = h('button', { class: `card ticks lang-card ${this.s.lang === l ? 'is-selected' : ''}`, attrs: { type: 'button', lang: l } });
          c.dataset.sfx = 'confirm';
          c.dataset.lang = l;
          c.append(h('div', { class: 'card__title', text: l === 'en' ? 'English' : 'العربية' }), h('div', { class: 'card__sub', text: l === 'en' ? 'Left to right' : 'من اليمين إلى اليسار' }));
          c.addEventListener('click', () => this.set({ lang: l }));
          cards.append(c);
        }
        group('settings.language', h('p', { class: 'row__desc', style: 'padding:0 .9rem', t: 'settings.language.desc' }), cards);
        break;
      }
    }
    if (animate) stagger(groups);
    else pane.scrollTop = scroll;
  }

  private bindRow(a: Action): HTMLElement {
    const keys = this.s.bindings[a]?.keys ?? [];
    const ctl = h('div', { class: 'row__control' });
    for (let slot = 0; slot < 2; slot++) {
      const kb = keybind({
        code: keys[slot] ?? null,
        format: keyLabel,
        onCapture: (code) => {
          // A key taken from another action swaps with this slot's old key; tell the player.
          const r = rebindWithSwap(this.app.settings, a, slot, code);
          if (r.from && code) {
            const p = { key: keyLabel(code), action: i18n.t(`settings.action.${r.from}`), old: r.swapped ? keyLabel(r.swapped) : '' };
            this.app.ui.toast(i18n.t(r.swapped ? 'controls.bind.swapped' : 'controls.bind.moved', p), 'info');
          }
          // Another action may have lost this key: repaint the list.
          requestAnimationFrame(() => this.renderPane(false));
        },
      });
      ctl.append(kb.el);
    }
    const row = h('div', { class: 'row bind-row' }, h('div', { class: 'row__label', t: `settings.action.${a}` }), ctl);
    return row;
  }

  back(): boolean {
    if (this.el.classList.contains('is-overlay')) {
      void this.app.ui.pop();
      return true;
    }
    return false;
  }
}
