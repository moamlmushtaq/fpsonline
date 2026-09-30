// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — brand marks: the sun-over-launch-tower emblem and wordmark.
// The same emblem is used by public/favicon.svg and the inline boot splash.
// ─────────────────────────────────────────────────────────────────────────────

import { h } from './components';

let uid = 0;

/** Emblem: a striped 1970s sunset disc cut by the horizon, a lattice launch tower in front. */
export function logoMarkSvg(cls = 'wordmark__mark'): string {
  const u = `lm${++uid}`;
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${u}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe6b0"/><stop offset=".55" stop-color="#f6ad5e"/><stop offset="1" stop-color="#df6f45"/></linearGradient>
    <mask id="${u}m"><rect width="64" height="64" fill="#fff"/><rect x="0" y="30" width="64" height="1.6" fill="#000"/><rect x="0" y="34.4" width="64" height="2.2" fill="#000"/><rect x="0" y="39.2" width="64" height="2.8" fill="#000"/><rect x="0" y="44.6" width="64" height="30" fill="#000"/></mask>
  </defs>
  <circle cx="32" cy="44" r="22" fill="url(#${u}s)" mask="url(#${u}m)"/>
  <path d="M6 45.6h52" stroke="#f3ece0" stroke-opacity=".55" stroke-width="1.2" stroke-linecap="round"/>
  <g fill="#f3ece0">
    <path d="M28.6 45.6 30.9 10h2.2l2.3 35.6h-2.2L32 20.6l-1.2 25z"/>
    <path d="M26.4 45.6h11.2v1.4H26.4z" opacity=".8"/>
  </g>
  <g stroke="#f3ece0" stroke-width="1" stroke-linecap="round" fill="none" opacity=".9">
    <path d="M30.2 22h3.6M29.9 28h4.2M29.5 34h5M29.2 40h5.6"/>
    <path d="M30.2 22 33.9 28M33.8 22 30.1 28M29.9 28l4.6 6M34.1 28l-4.6 6M29.5 34l5.3 6M34.5 34l-5.3 6"/>
  </g>
  <path d="M40.5 45.6V27.5c0-2.6 1-4.8 2.4-6.2 1.4 1.4 2.4 3.6 2.4 6.2v18.1z" fill="#f3ece0" opacity=".92"/>
  <path d="M35.1 17.5h5.6" stroke="#f3ece0" stroke-width="1" stroke-linecap="round"/>
</svg>`;
}

/** Full wordmark (emblem + HALCYON / FRONT). Always LTR — it is the brand. */
export function wordmark(): HTMLElement {
  const el = h('div', { class: 'wordmark', attrs: { dir: 'ltr', role: 'img', 'aria-label': 'HALCYON FRONT' } });
  el.innerHTML = `${logoMarkSvg()}<div class="wordmark__text"><div class="wordmark__top">HALCYON</div><div class="wordmark__bottom">FRONT</div></div>`;
  return el;
}
