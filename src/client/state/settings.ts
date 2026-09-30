// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — player settings store.
//
// Persisted in localStorage as { v: SCHEMA_VERSION, data: Settings }. Loading is
// defensive: unknown/invalid fields fall back to defaults field-by-field, and
// older schema versions are migrated forward, so a corrupted or stale save can
// never break boot. All writes go through update(), which notifies listeners
// (the App applies quality/volume/language/etc. from there).
// ─────────────────────────────────────────────────────────────────────────────

import type { Action, KeyBinding, QualityPreset, Settings } from '../contracts';
import type { ColorblindMode } from '../engine/palette';
import type { Lang } from '../../shared/types';

const STORAGE_KEY = 'hf.settings';
const SCHEMA_VERSION = 2;

export const ACTIONS: readonly Action[] = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'crouch',
  'sprint',
  'fire',
  'ads',
  'reload',
  'throw',
  'interact',
  'nextWeapon',
  'primary',
  'secondary',
  'pickupSlot',
  'scoreboard',
  'pause',
];

/** Default key bindings (KeyboardEvent.code values; Mouse0/1/2; Wheel+ / Wheel-). */
export function defaultBindings(): Record<Action, KeyBinding> {
  return {
    forward: { keys: ['KeyW', 'ArrowUp'] },
    back: { keys: ['KeyS', 'ArrowDown'] },
    left: { keys: ['KeyA', 'ArrowLeft'] },
    right: { keys: ['KeyD', 'ArrowRight'] },
    jump: { keys: ['Space'] },
    crouch: { keys: ['KeyC', 'ControlLeft'] },
    sprint: { keys: ['ShiftLeft'] },
    fire: { keys: ['Mouse0'] },
    ads: { keys: ['Mouse1'] },
    reload: { keys: ['KeyR'] },
    throw: { keys: ['KeyG'] },
    interact: { keys: ['KeyE'] },
    nextWeapon: { keys: ['KeyQ', 'Wheel+'] },
    primary: { keys: ['Digit1'] },
    secondary: { keys: ['Digit2'] },
    pickupSlot: { keys: ['Digit3'] },
    scoreboard: { keys: ['Tab'] },
    pause: { keys: ['Escape'] },
  };
}

function detectLang(): Lang {
  try {
    const langs = [...(navigator.languages ?? []), navigator.language];
    return langs.some((l) => typeof l === 'string' && l.toLowerCase().startsWith('ar')) ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function defaultSettings(): Settings {
  return {
    lang: detectLang(),
    quality: 'auto',
    renderScale: 1,
    fov: 90,
    mouseSensitivity: 1,
    adsSensitivity: 0.85,
    touchSensitivity: 1,
    gamepadSensitivity: 1,
    invertY: false,
    toggleCrouch: false,
    toggleAds: false,
    autoSprint: false,
    bindings: defaultBindings(),
    aimAssist: true,
    haptics: true,
    touchLayout: {},
    touchOpacity: 0.7,
    volumes: { master: 0.85, music: 0.55, sfx: 0.9, voice: 0.85, ui: 0.6 },
    subtitles: true,
    colorblind: 'off',
    hudScale: 1,
    reducedShake: false,
    showFps: false,
    crosshair: 'cross',
    crosshairColor: '#f3ece0',
  };
}

// ── Validation helpers ─────────────────────────────────────────────────────

const QUALITIES: readonly QualityPreset[] = ['auto', 'low', 'medium', 'high'];
const COLORBLIND: readonly ColorblindMode[] = ['off', 'protanopia', 'deuteranopia', 'tritanopia'];
const CROSSHAIRS: readonly Settings['crosshair'][] = ['dot', 'cross', 'circle'];

function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}
function oneOf<T>(v: unknown, list: readonly T[], def: T): T {
  return list.includes(v as T) ? (v as T) : def;
}

function sanitizeBindings(raw: unknown): Record<Action, KeyBinding> {
  const def = defaultBindings();
  if (!raw || typeof raw !== 'object') return def;
  const src = raw as Record<string, unknown>;
  for (const a of ACTIONS) {
    const b = src[a] as { keys?: unknown } | undefined;
    if (b && Array.isArray(b.keys)) {
      const keys = b.keys.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length < 32).slice(0, 2);
      def[a] = { keys };
    }
  }
  return def;
}

function sanitizeTouchLayout(raw: unknown): Settings['touchLayout'] {
  const out: Settings['touchLayout'] = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const p = v as { x?: unknown; y?: unknown; s?: unknown };
    if (!p || typeof p !== 'object') continue;
    out[id] = { x: num(p.x, 0.5, 0, 1), y: num(p.y, 0.5, 0, 1), s: num(p.s, 1, 0.5, 2) };
  }
  return out;
}

/** Builds a valid Settings object from anything (field-by-field fallback to defaults). */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const s = raw as Partial<Record<keyof Settings, unknown>>;
  const vol = (s.volumes ?? {}) as Record<string, unknown>;
  const color = typeof s.crosshairColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.crosshairColor) ? s.crosshairColor : d.crosshairColor;
  return {
    lang: s.lang === 'ar' || s.lang === 'en' ? s.lang : d.lang,
    quality: oneOf(s.quality, QUALITIES, d.quality),
    renderScale: num(s.renderScale, d.renderScale, 0.5, 1),
    fov: num(s.fov, d.fov, 70, 110),
    mouseSensitivity: num(s.mouseSensitivity, d.mouseSensitivity, 0.1, 5),
    adsSensitivity: num(s.adsSensitivity, d.adsSensitivity, 0.2, 2),
    touchSensitivity: num(s.touchSensitivity, d.touchSensitivity, 0.1, 5),
    gamepadSensitivity: num(s.gamepadSensitivity, d.gamepadSensitivity, 0.1, 5),
    invertY: bool(s.invertY, d.invertY),
    toggleCrouch: bool(s.toggleCrouch, d.toggleCrouch),
    toggleAds: bool(s.toggleAds, d.toggleAds),
    autoSprint: bool(s.autoSprint, d.autoSprint),
    bindings: sanitizeBindings(s.bindings),
    aimAssist: bool(s.aimAssist, d.aimAssist),
    haptics: bool(s.haptics, d.haptics),
    touchLayout: sanitizeTouchLayout(s.touchLayout),
    touchOpacity: num(s.touchOpacity, d.touchOpacity, 0.2, 1),
    volumes: {
      master: num(vol.master, d.volumes.master, 0, 1),
      music: num(vol.music, d.volumes.music, 0, 1),
      sfx: num(vol.sfx, d.volumes.sfx, 0, 1),
      voice: num(vol.voice, d.volumes.voice, 0, 1),
      ui: num(vol.ui, d.volumes.ui, 0, 1),
    },
    subtitles: bool(s.subtitles, d.subtitles),
    colorblind: oneOf(s.colorblind, COLORBLIND, d.colorblind),
    hudScale: num(s.hudScale, d.hudScale, 0.75, 1.3),
    reducedShake: bool(s.reducedShake, d.reducedShake),
    showFps: bool(s.showFps, d.showFps),
    crosshair: oneOf(s.crosshair, CROSSHAIRS, d.crosshair),
    crosshairColor: color,
  };
}

/** Schema migrations. Each step upgrades data from version k to k+1. */
function migrate(version: number, data: Record<string, unknown>): Record<string, unknown> {
  let v = version;
  let d = { ...data };
  if (v < 2) {
    // v1 stored a flat `volume` number and `sensitivity`; v2 split them.
    if (typeof d.volume === 'number' && !d.volumes) d.volumes = { master: d.volume };
    if (typeof d.sensitivity === 'number' && d.mouseSensitivity === undefined) d.mouseSensitivity = d.sensitivity;
    delete d.volume;
    delete d.sensitivity;
    v = 2;
  }
  return d;
}

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__hf_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export class SettingsStore {
  private _value: Settings;
  private listeners = new Set<(s: Settings) => void>();
  private storage = safeStorage();
  private saveTimer = 0;

  constructor() {
    this._value = this.load();
  }

  get value(): Settings {
    return this._value;
  }

  /** Shallow-merges a patch. Nested objects (volumes, bindings, touchLayout) must be passed whole. */
  update(patch: Partial<Settings>): void {
    const next = sanitizeSettings({ ...this._value, ...patch });
    this._value = next;
    this.scheduleSave();
    this.emit();
  }

  onChange(cb: (s: Settings) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  reset(): void {
    const lang = this._value.lang;
    this._value = { ...defaultSettings(), lang };
    this.scheduleSave();
    this.emit();
  }

  /** Re-bind one action (max two keys). A key used by another action is removed there. */
  bind(action: Action, slot: number, code: string | null): void {
    const bindings = structuredCloneBindings(this._value.bindings);
    if (code) {
      for (const a of ACTIONS) {
        if (a === action) continue;
        bindings[a].keys = bindings[a].keys.filter((k) => k !== code);
      }
    }
    const keys = [...bindings[action].keys];
    if (code) {
      const existing = keys.indexOf(code);
      if (existing >= 0) keys.splice(existing, 1);
      if (slot >= keys.length) keys.push(code);
      else keys[slot] = code;
    } else if (slot < keys.length) {
      keys.splice(slot, 1);
    }
    bindings[action] = { keys: keys.slice(0, 2) };
    this.update({ bindings });
  }

  resetBindings(): void {
    this.update({ bindings: defaultBindings() });
  }

  private emit(): void {
    for (const cb of [...this.listeners]) {
      try {
        cb(this._value);
      } catch (err) {
        console.error('[settings] listener failed', err);
      }
    }
  }

  private load(): Settings {
    if (!this.storage) return defaultSettings();
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return defaultSettings();
      const parsed = JSON.parse(raw) as { v?: number; data?: Record<string, unknown> };
      const version = typeof parsed.v === 'number' ? parsed.v : 1;
      const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : (parsed as Record<string, unknown>);
      return sanitizeSettings(migrate(version, data));
    } catch (err) {
      console.warn('[settings] could not read saved settings, using defaults', err);
      return defaultSettings();
    }
  }

  /** Debounced so slider drags don't hammer localStorage. */
  private scheduleSave(): void {
    if (!this.storage) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 250);
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, data: this._value }));
    } catch (err) {
      console.warn('[settings] save failed', err);
    }
  }
}

function structuredCloneBindings(b: Record<Action, KeyBinding>): Record<Action, KeyBinding> {
  const out = {} as Record<Action, KeyBinding>;
  for (const a of ACTIONS) out[a] = { keys: [...(b[a]?.keys ?? [])] };
  return out;
}

export const settings = new SettingsStore();

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => settings.flush());
}

/** Human-readable label for a KeyboardEvent.code / mouse / wheel binding. */
export function keyLabel(code: string): string {
  if (!code) return '';
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse1') return 'RMB';
  if (code === 'Mouse2') return 'MMB';
  if (code === 'Mouse3') return 'M4';
  if (code === 'Mouse4') return 'M5';
  if (code === 'Wheel+') return 'Wheel ↓';
  if (code === 'Wheel-') return 'Wheel ↑';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    AltRight: 'R-Alt',
    MetaLeft: 'Meta',
    MetaRight: 'Meta',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Bksp',
    CapsLock: 'Caps',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
  };
  return map[code] ?? code;
}
