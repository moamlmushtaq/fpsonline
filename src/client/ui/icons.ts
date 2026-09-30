// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — inline SVG icon set.
//
// One consistent language: 24×24 grid, 1.5 px strokes, round caps & joins,
// currentColor. Directional icons carry `data-flip` so they mirror in RTL.
// Weapon silhouettes are filled side profiles on a 64×24 grid (muzzle → right;
// they also mirror in RTL kill feeds so the muzzle points at the victim).
// No skulls anywhere: eliminations use a crossed diamond.
// ─────────────────────────────────────────────────────────────────────────────

import type { WeaponId } from '../../shared/types';

const ICONS = {
  play: '<path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4a.8.8 0 0 0-1.2.7z"/>',
  loadout:
    '<rect x="3" y="7" width="18" height="12.5" rx="2.2"/><path d="M8.5 7V5.3A1.3 1.3 0 0 1 9.8 4h4.4a1.3 1.3 0 0 1 1.3 1.3V7"/><path d="M3 12.2h18"/><path d="M10.2 12.2v1.9h3.6v-1.9"/>',
  customize:
    '<path d="M4.8 14.5a7.2 7.2 0 0 1 14.4 0v3.2a1.8 1.8 0 0 1-1.8 1.8H6.6a1.8 1.8 0 0 1-1.8-1.8z"/><path d="M7.4 14h9.2"/><path d="M12 7.3V4.5"/><circle cx="12" cy="3.6" r=".9"/>',
  settings:
    '<circle cx="12" cy="12" r="6.2"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  profile: '<circle cx="12" cy="8.3" r="3.6"/><path d="M4.8 19.6c1.2-3.3 4-5.2 7.2-5.2s6 1.9 7.2 5.2"/>',
  back: '<path data-flip d="M14.5 5.5 8 12l6.5 6.5"/>',
  forward: '<path data-flip d="M9.5 5.5 16 12l-6.5 6.5"/>',
  chevronUp: '<path d="M5.5 14.5 12 8l6.5 6.5"/>',
  chevronDown: '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
  close: '<path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8"/>',
  lock:
    '<rect x="5" y="10.5" width="14" height="9.8" rx="2.2"/><path d="M8.3 10.5V8.1a3.7 3.7 0 0 1 7.4 0v2.4"/><path d="M12 14.4v2.2"/>',
  check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
  users:
    '<circle cx="9" cy="8.7" r="3.1"/><path d="M3.3 19.2c.9-2.9 3.1-4.5 5.7-4.5s4.8 1.6 5.7 4.5"/><circle cx="16.6" cy="8.2" r="2.5"/><path d="M15.7 13.9c2.4 0 4.2 1.4 5 3.9"/>',
  link: '<path d="M10 14.2a3.6 3.6 0 0 0 5.1 0l3.1-3.1a3.6 3.6 0 0 0-5.1-5.1l-1 1"/><path d="M14 9.8a3.6 3.6 0 0 0-5.1 0l-3.1 3.1a3.6 3.6 0 0 0 5.1 5.1l1-1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.3A1.8 1.8 0 0 0 13.7 4.5H6.3a1.8 1.8 0 0 0-1.8 1.8v7.4a1.8 1.8 0 0 0 1.8 1.8h2.2"/>',
  share: '<path d="M12 14.5V4"/><path d="M8.2 7.6 12 3.8l3.8 3.8"/><path d="M8 10.5H6.8A1.8 1.8 0 0 0 5 12.3v6.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8v-6.4a1.8 1.8 0 0 0-1.8-1.8H16"/>',
  crown: '<path d="M4.6 16.2 3.6 7.4l4.9 3.6L12 5l3.5 6 4.9-3.6-1 8.8z"/><path d="M5 19.5h14"/>',
  elim: '<path d="M12 3.2 20.8 12 12 20.8 3.2 12z"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  headshot: '<circle cx="12" cy="12" r="7.2"/><circle cx="12" cy="12" r="2.3" fill="currentColor" stroke="none"/><path d="M12 2.2v3.2M12 18.6v3.2M2.2 12h3.2M18.6 12h3.2"/>',
  smoke: '<path d="M6.8 18.8h10.6a3.6 3.6 0 0 0 .5-7.2 5 5 0 0 0-9.6-1.4 4.3 4.3 0 0 0-1.5 8.6z"/><path d="M9 15.2h5.5"/>',
  grenade: '<circle cx="12" cy="14.6" r="5.7"/><path d="M9.6 9.2V6.6h4.8v2.6"/><path d="M14.4 7.6 18 5"/><path d="M9.7 14.6h4.6"/>',
  zone: '<path d="M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z"/><circle cx="12" cy="12" r="2.4"/>',
  star: '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  trophy:
    '<path d="M8 4.5h8v5.2a4 4 0 0 1-8 0z"/><path d="M8 6.3H5.4a2.6 2.6 0 0 0 2.8 3.9M16 6.3h2.6a2.6 2.6 0 0 1-2.8 3.9"/><path d="M12 13.7v3"/><path d="M8.5 19.8h7"/><path d="M9.7 19.8l.5-3.1h3.6l.5 3.1"/>',
  wifi: '<path d="M4.3 9.9a11.2 11.2 0 0 1 15.4 0"/><path d="M7.3 13a6.9 6.9 0 0 1 9.4 0"/><path d="M10.2 16a2.7 2.7 0 0 1 3.6 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
  offline:
    '<path d="M4.3 9.9a11.2 11.2 0 0 1 4.3-2.6M13.6 6.7a11.2 11.2 0 0 1 6.1 3.2"/><path d="M7.3 13a6.9 6.9 0 0 1 3-1.7"/><path d="M10.2 16a2.7 2.7 0 0 1 3.6 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/><path d="M4 4l16 16"/>',
  gamepad:
    '<path d="M7.2 8.2h9.6a4 4 0 0 1 3.9 3.2l.9 4.6a2.3 2.3 0 0 1-3.9 2l-2.1-2.3H8.4L6.3 18a2.3 2.3 0 0 1-3.9-2l.9-4.6a4 4 0 0 1 3.9-3.2z"/><path d="M8 10.8v3.4M6.3 12.5h3.4"/><circle cx="15.6" cy="11.4" r=".9" fill="currentColor" stroke="none"/><circle cx="17.4" cy="13.4" r=".9" fill="currentColor" stroke="none"/>',
  keyboard:
    '<rect x="2.8" y="6.5" width="18.4" height="11" rx="2.2"/><path d="M6.4 10h1M9.4 10h1M12.4 10h1M15.4 10h1M7.6 14.2h8.8"/>',
  touch:
    '<path d="M9.3 12.2V6.2a1.6 1.6 0 0 1 3.2 0v5"/><path d="M12.5 10.4a1.6 1.6 0 0 1 3.2 0v1.4"/><path d="M15.7 11a1.6 1.6 0 0 1 3.2 0v3.4a6.3 6.3 0 0 1-6.3 6.3h-.8a5.2 5.2 0 0 1-4.3-2.3L4.8 14.9a1.5 1.5 0 0 1 2.3-1.9l2.2 2.2"/><path d="M6.4 6.2a4.5 4.5 0 0 1 8.9 0"/>',
  globe:
    '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2"/><path d="M12 3.4c2.5 2.3 3.8 5.2 3.8 8.6s-1.3 6.3-3.8 8.6c-2.5-2.3-3.8-5.2-3.8-8.6S9.5 5.7 12 3.4z"/>',
  speaker: '<path d="M4.5 9.4h3.1l4.6-4v13.2l-4.6-4H4.5z"/><path d="M15.6 9a4.2 4.2 0 0 1 0 6"/><path d="M18.2 6.4a7.8 7.8 0 0 1 0 11.2"/>',
  mute: '<path d="M4.5 9.4h3.1l4.6-4v13.2l-4.6-4H4.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  eye: '<path d="M2.6 12S6 5.6 12 5.6 21.4 12 21.4 12 18 18.4 12 18.4 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3"/>',
  contrast: '<circle cx="12" cy="12" r="8.6"/><path d="M12 3.4v17.2a8.6 8.6 0 0 0 0-17.2z" fill="currentColor"/>',
  sliders:
    '<path d="M4 7h8.5M16.5 7H20M4 17h2.5M10.5 17H20"/><circle cx="14.5" cy="7" r="2"/><circle cx="8.5" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  refresh: '<path d="M19.2 9.2A7.6 7.6 0 0 0 5.4 8"/><path d="M4.8 4.4V8.4h4"/><path d="M4.8 14.8A7.6 7.6 0 0 0 18.6 16"/><path d="M19.2 19.6v-4h-4"/>',
  dice: '<rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3.4"/><circle cx="8.8" cy="8.8" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.2" cy="15.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.2" cy="8.8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8.8" cy="15.2" r="1.1" fill="currentColor" stroke="none"/>',
  shield: '<path d="M12 3.2 19 6v5.4c0 4.4-2.9 7.9-7 9.4-4.1-1.5-7-5-7-9.4V6z"/><path d="M9 12l2.2 2.2L15.4 10"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.2V12l3.2 2"/>',
  target: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  bolt: '<path d="M13.2 3 5.8 13.4h5.4L10.4 21l7.8-10.6h-5.6z"/>',
  sun: '<circle cx="12" cy="13.5" r="4.2"/><path d="M3 18.5h18M12 5v1.8M5.6 7.6l1.3 1.3M18.4 7.6l-1.3 1.3M3.8 13.5h1.8M18.4 13.5h1.8"/>',
  rocket:
    '<path d="M12 2.8c2.6 2 4 5 4 8.6v5.4H8v-5.4c0-3.6 1.4-6.6 4-8.6z"/><path d="M8 13.5 5.4 16v3.2L8 17.8M16 13.5l2.6 2.5v3.2L16 17.8"/><path d="M10.4 20.6h3.2"/><circle cx="12" cy="9.4" r="1.4"/>',
  tower: '<path d="M8.5 21 11 3h2l2.5 18"/><path d="M9.3 15h5.4M9.9 10.2h4.2M5 21h14"/><path d="M9.3 15 14 10.2M14.7 15 10 10.2"/>',
  dome: '<path d="M4.5 18.5v-4a7.5 7.5 0 0 1 15 0v4"/><path d="M3 18.5h18"/><path d="M12 7v4.4"/><path d="M12.5 8.5 17 5"/>',
  mall: '<path d="M4 20V9.5h16V20"/><path d="M3 9.5 5 5h14l2 4.5"/><path d="M9.5 20v-5.5h5V20"/><path d="M3 20h18"/>',
  sea: '<path d="M3 10c1.5 0 1.5-1.2 3-1.2S7.5 10 9 10s1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2S19.5 10 21 10"/><path d="M3 14.5c1.5 0 1.5-1.2 3-1.2s1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2"/><path d="M3 19c1.5 0 1.5-1.2 3-1.2S7.5 19 9 19s1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2S19.5 19 21 19"/>',
  crane: '<path d="M7 21V4h2v17"/><path d="M9 5h11l-11 5"/><path d="M17.5 5v6"/><rect x="16" y="11" width="3" height="2.4" rx=".6"/><path d="M4.5 21h7"/>',
  house: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v10h12V10"/><circle cx="12" cy="13.5" r="1.8"/><path d="M10 20v-2.4h4V20"/>',
  antenna: '<path d="M12 10.5V21"/><path d="M8.5 21h7"/><path d="M8.4 7a5 5 0 0 1 7.2 0M6 4.6a8.5 8.5 0 0 1 12 0"/><circle cx="12" cy="9.8" r="1.2" fill="currentColor" stroke="none"/>',
  flag: '<path d="M5.5 21V3.8"/><path d="M5.5 4.5h11.8l-2.2 4 2.2 4H5.5"/>',
  pickup: '<path d="M12 3.4 20.6 12 12 20.6 3.4 12z"/><path d="M12 7.6v8.8M7.6 12h8.8"/>',
  heart: '<path d="M12 19.6s-7.5-4.4-7.5-10a4.2 4.2 0 0 1 7.5-2.6 4.2 4.2 0 0 1 7.5 2.6c0 5.6-7.5 10-7.5 10z"/>',
  info: '<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/>',
  warning: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.4"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  exit: '<path data-flip d="M14 4.5H6.8A1.8 1.8 0 0 0 5 6.3v11.4a1.8 1.8 0 0 0 1.8 1.8H14"/><path data-flip d="M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5"/>',
  edit: '<path d="M15.2 5.2l3.6 3.6L8.6 19H5v-3.6z"/><path d="M13.2 7.2l3.6 3.6"/>',
  palette: '<path d="M12 3.6a8.4 8.4 0 0 0 0 16.8c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-1 .8-1.6 1.8-1.6h2a3.8 3.8 0 0 0 3.8-3.8c0-4-3.8-7.1-8.4-7.1z"/><circle cx="8" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="10.8" cy="7.6" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="8" r="1" fill="currentColor" stroke="none"/>',
  sparkle: '<path d="M12 3.5c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.3 6.5-6.5z"/><path d="M18.5 16.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2.2"/><path d="M6.5 14.5h6M6.5 11h3"/><circle cx="16.5" cy="11" r="2"/>',
  visor: '<path d="M4 12.5a8 8 0 0 1 16 0"/><path d="M4 12.5h16"/><path d="M6.5 15.5h11"/>',
  faction: '<path d="M12 3.4 19.6 7.8v8.4L12 20.6l-7.6-4.4V7.8z"/><path d="M12 8.2v7.6M8.6 10.1l6.8 3.8M15.4 10.1l-6.8 3.8"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M7.5 16v-4.5M11.5 16V8M15.5 16v-6M19.5 16v-9"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** SVG markup for a stroke icon (inline, currentColor). */
export function icon(name: IconName, cls = ''): string {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

/** Icon as an element (for appendChild). */
export function iconEl(name: IconName, cls = ''): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = icon(name, cls);
  return tpl.content.firstElementChild as SVGSVGElement;
}

// ── Weapon silhouettes (64×24, filled, muzzle → right) ────────────────────

const WEAPON_SHAPES: Record<WeaponId, string> = {
  meridian:
    '<rect x="2" y="8.2" width="12.5" height="6" rx="2.6"/>' +
    '<rect x="12" y="6.4" width="22.5" height="8.2" rx="3.2"/>' +
    '<rect x="16.5" y="3.9" width="10.5" height="2.8" rx="1.3"/>' +
    '<rect x="33.5" y="7.9" width="14" height="4.8" rx="2.2"/>' +
    '<rect x="46" y="9.2" width="12" height="2.1" rx="1"/>' +
    '<rect x="57" y="8.5" width="4" height="3.5" rx="1.1"/>' +
    '<path d="M22.2 14.2h6.2l1.6 7.4H24z"/>' +
    '<path d="M14.6 14.2h4.6l-1.6 6.2h-4.2z"/>',
  swift:
    '<rect x="3.5" y="8.6" width="9" height="2.1" rx="1"/>' +
    '<rect x="3.5" y="8.6" width="2.2" height="6.6" rx="1.1"/>' +
    '<rect x="11" y="6.4" width="24" height="8.8" rx="3.8"/>' +
    '<rect x="16" y="4.6" width="7" height="2.4" rx="1.1"/>' +
    '<rect x="34" y="9" width="10.5" height="2.5" rx="1.2"/>' +
    '<rect x="43.5" y="8.3" width="3.4" height="3.8" rx="1.1"/>' +
    '<rect x="24" y="14.4" width="4.6" height="8" rx="1.3"/>' +
    '<path d="M14 14.6h4.6l-1.4 6h-4.3z"/>',
  longline:
    '<path d="M2 9h12.5v5.6H7.6L5 17.2H2.9A.9.9 0 0 1 2 16.3z"/>' +
    '<rect x="13" y="8" width="18.5" height="6.2" rx="2.6"/>' +
    '<rect x="15" y="3.4" width="16.5" height="3.7" rx="1.8"/>' +
    '<rect x="18.5" y="6.4" width="2" height="2.2"/>' +
    '<rect x="26" y="6.4" width="2" height="2.2"/>' +
    '<rect x="30.5" y="9.5" width="27" height="2" rx="1"/>' +
    '<rect x="57" y="8.7" width="4.6" height="3.6" rx="1.1"/>' +
    '<rect x="21.5" y="13.6" width="5" height="4.2" rx="1"/>' +
    '<circle cx="29.2" cy="15.6" r="1.5"/>' +
    '<path d="M15 13.8h4.2l-1.6 5.6h-3.6z"/>',
  breaker:
    '<path d="M2 9.4h11.5v5.2H8.8L5.2 18H3a1 1 0 0 1-1-1z"/>' +
    '<rect x="12" y="7.4" width="16.5" height="7.2" rx="2.6"/>' +
    '<rect x="27" y="7.9" width="31" height="3.2" rx="1.5"/>' +
    '<rect x="27" y="11.8" width="24" height="2.4" rx="1.2"/>' +
    '<rect x="33" y="10.8" width="11.5" height="4.6" rx="2.1"/>' +
    '<path d="M14 14.2h4.3l-1.5 5.2h-3.9z"/>',
  pulse:
    '<rect x="18" y="7" width="24.5" height="5.6" rx="2.2"/>' +
    '<rect x="41.5" y="7.9" width="3.2" height="3.6" rx="1.1"/>' +
    '<rect x="20" y="11.4" width="18" height="3.2" rx="1.2"/>' +
    '<path d="M21 13.4h7.3l-1.9 8.6h-7a1 1 0 0 1-1-1.2z"/>' +
    '<circle cx="23.2" cy="9.8" r="1.1" fill-opacity=".35"/>',
  sunspear:
    '<rect x="2" y="8.4" width="10.5" height="7.2" rx="3.2"/>' +
    '<rect x="10.5" y="5.8" width="23" height="10.4" rx="4.6"/>' +
    '<rect x="15.5" y="3.6" width="12.5" height="2.8" rx="1.3"/>' +
    '<rect x="32.5" y="9.4" width="22.5" height="3.2" rx="1.6"/>' +
    '<rect x="33.4" y="6.8" width="3" height="8.4" rx="1.5"/>' +
    '<rect x="38.2" y="7.4" width="3" height="7.2" rx="1.5"/>' +
    '<rect x="43" y="8" width="3" height="6" rx="1.5"/>' +
    '<circle cx="56.5" cy="11" r="2.6"/>' +
    '<path d="M14.8 15.8h4.6l-1.5 6h-4.2z"/>',
};

/** Filled side-profile weapon silhouette. */
export function weaponIcon(id: WeaponId, cls = ''): string {
  return `<svg class="wic ${cls}" viewBox="0 0 64 24" fill="currentColor" aria-hidden="true" focusable="false">${WEAPON_SHAPES[id] ?? WEAPON_SHAPES.meridian}</svg>`;
}

/** Icon names for landmark/compass markers. */
export function landmarkIcon(kind: string): IconName {
  switch (kind) {
    case 'tower':
      return 'tower';
    case 'dome':
      return 'dome';
    case 'mall':
      return 'mall';
    case 'sun':
      return 'sun';
    case 'sea':
      return 'sea';
    case 'crane':
      return 'crane';
    case 'house':
      return 'house';
    case 'antenna':
      return 'antenna';
    case 'rocket':
      return 'rocket';
    default:
      return 'flag';
  }
}
