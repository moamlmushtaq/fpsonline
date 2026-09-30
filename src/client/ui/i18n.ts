// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — localization.
//
// Dictionaries live in ui/locales/<lang>/<namespace>.ts (one file per subsystem,
// each `export default { 'ns.key': 'text' } satisfies Record<string, string>`).
// They are merged at build time through import.meta.glob, so adding a namespace
// needs no registration. Lookup order: current language → English → the key.
//
// DOM helpers: `setText(el, key, params)` stores the key on the element
// (data-i18n) so `refreshDom()` can re-translate every bound element in place
// when the language changes — screens never need to be rebuilt for a switch.
// ─────────────────────────────────────────────────────────────────────────────

import type { I18n } from '../contracts';
import type { Lang } from '../../shared/types';

type Dict = Record<string, string>;

const modules = import.meta.glob<{ default: Dict }>('./locales/*/*.ts', { eager: true });

const DICTS: Record<Lang, Dict> = { en: {}, ar: {} };
for (const [path, mod] of Object.entries(modules)) {
  const m = /\/locales\/([a-z]{2})\//.exec(path);
  if (!m) continue;
  const lang = m[1] as Lang;
  if (!(lang in DICTS)) continue;
  Object.assign(DICTS[lang], mod.default);
}

const PARAM_RE = /\{(\w+)\}/g;
const numberFormat = new Intl.NumberFormat('en-US');

class I18nImpl implements I18n {
  private _lang: Lang = 'en';
  private listeners = new Set<(lang: Lang) => void>();

  get lang(): Lang {
    return this._lang;
  }

  get dir(): 'ltr' | 'rtl' {
    return this._lang === 'ar' ? 'rtl' : 'ltr';
  }

  /** True if the key exists in any dictionary. */
  has(key: string): boolean {
    return key in DICTS[this._lang] || key in DICTS.en;
  }

  t(key: string, params?: Record<string, string | number>): string {
    const raw = DICTS[this._lang][key] ?? DICTS.en[key] ?? key;
    if (!params) return raw;
    return raw.replace(PARAM_RE, (whole, name: string) => {
      const v = params[name];
      if (v === undefined) return whole;
      return typeof v === 'number' ? this.num(v) : v;
    });
  }

  setLang(lang: Lang): void {
    const next: Lang = lang === 'ar' ? 'ar' : 'en';
    const changed = next !== this._lang;
    this._lang = next;
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.lang = next;
      root.dir = this.dir;
      if (changed) refreshDom(document.body);
    }
    if (changed) for (const cb of [...this.listeners]) cb(next);
  }

  /** Western digits in both languages (HUD readability); grouping for large values. */
  num(n: number, digits = 0): string {
    if (!Number.isFinite(n)) return '0';
    if (digits > 0) return n.toFixed(digits);
    const r = Math.round(n);
    return Math.abs(r) >= 10000 ? numberFormat.format(r) : String(r);
  }

  onChange(cb: (lang: Lang) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const i18n = new I18nImpl();

export function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}

// ── DOM binding helpers ─────────────────────────────────────────────────────

/** Sets the element's text from a key and remembers the binding for live language switches. */
export function setText(el: HTMLElement, key: string, params?: Record<string, string | number>): HTMLElement {
  el.dataset.i18n = key;
  if (params) el.dataset.i18nParams = JSON.stringify(params);
  else delete el.dataset.i18nParams;
  el.textContent = i18n.t(key, params);
  return el;
}

/** Binds a translated attribute (title, aria-label, placeholder, data-tip). */
export function setAttr(el: HTMLElement, attr: string, key: string, params?: Record<string, string | number>): HTMLElement {
  const bound = el.dataset.i18nAttr ? (JSON.parse(el.dataset.i18nAttr) as Record<string, string>) : {};
  bound[attr] = key;
  el.dataset.i18nAttr = JSON.stringify(bound);
  el.setAttribute(attr, i18n.t(key, params));
  return el;
}

/** Re-translates every bound element below `root`. */
export function refreshDom(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n as string;
    let params: Record<string, string | number> | undefined;
    if (el.dataset.i18nParams) {
      try {
        params = JSON.parse(el.dataset.i18nParams) as Record<string, string | number>;
      } catch {
        params = undefined;
      }
    }
    el.textContent = i18n.t(key, params);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    try {
      const bound = JSON.parse(el.dataset.i18nAttr as string) as Record<string, string>;
      for (const [attr, key] of Object.entries(bound)) el.setAttribute(attr, i18n.t(key));
    } catch {
      /* ignore malformed binding */
    }
  });
}

/** Language implied by the browser (Arabic locales → 'ar'). */
export function browserLang(): Lang {
  const langs = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : [];
  return langs.some((l) => typeof l === 'string' && l.toLowerCase().startsWith('ar')) ? 'ar' : 'en';
}

/** Formats seconds as m:ss (always LTR digits). */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
