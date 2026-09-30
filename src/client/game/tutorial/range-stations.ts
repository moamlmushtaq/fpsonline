// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range interactive stations (used by range-stats).
//
// The armory corner at the firing line: the weapon rack (one slot per
// primary, Interact swaps immediately through RangeCmd 'weapon'), the RESET
// console (targets + stats + pad) and the TARGET SPEED console (cycles Slow /
// Normal / Fast). Standing at a station shows a contextual HUD prompt with the
// Interact glyph; pressing Interact acts, with a toast + UI sound.
// ─────────────────────────────────────────────────────────────────────────────

import { RANGE_COURSE } from '../../../shared/maps/range';
import { RANGE_SPEEDS } from '../../../shared/sim/range';
import { PRIMARY_WEAPON_IDS, type WeaponId } from '../../../shared/types';
import { WEAPONS } from '../../../shared/weapons';
import type { MatchApi } from '../extensions';

const C = RANGE_COURSE;
/** Rack slots are narrow: stand in front of the weapon you want. */
const RACK_RADIUS = 0.62;
const RACK_DEPTH = 1.6;

export type StationHit = { kind: 'rack'; index: number } | { kind: 'reset' } | { kind: 'speed' } | null;

/** Which station (if any) a player standing at `p` is using. Pure (exported for tests / tutorial). */
export function stationAt(p: { x: number; y: number; z: number }): StationHit {
  if (p.y > 1.5) return null;
  for (let i = 0; i < C.rackSlots.length; i++) {
    const s = C.rackSlots[i];
    if (Math.abs(p.x - s.x) <= RACK_RADIUS && Math.abs(p.z - s.z) <= RACK_DEPTH / 2) return { kind: 'rack', index: i };
  }
  const near = (q: { x: number; z: number }) => Math.hypot(p.x - q.x, p.z - q.z) <= C.stationRadius;
  if (near(C.resetStation)) return { kind: 'reset' };
  if (near(C.speedStation)) return { kind: 'speed' };
  return null;
}

export class RangeStations {
  speedIndex = 1;
  private promptSig = '';
  private promptText: string | null = null;

  constructor(
    private readonly api: MatchApi,
    private readonly onReset: () => void,
    private readonly onSpeed: (index: number) => void,
  ) {}

  private t(key: string, params?: Record<string, string | number>): string {
    return this.api.i18n.t(key, params);
  }

  private weaponName(w: WeaponId): string {
    return this.t(WEAPONS[w].nameKey);
  }

  /** Per frame: prompt + interaction. */
  update(): void {
    const api = this.api;
    const mv = api.move;
    const hit = mv && api.controllable ? stationAt(mv.pos) : null;
    const c = api.combat;
    const current = c ? c.slots[0].id : null;
    const key = api.device === 'kbm' ? api.keyLabel('interact') : api.device === 'gamepad' ? 'RB' : '';
    let sig = `${key}|${api.i18n.lang}|${this.speedIndex}|${current}|`;
    sig += hit ? (hit.kind === 'rack' ? `rack${hit.index}` : hit.kind) : '';
    if (sig !== this.promptSig) {
      this.promptSig = sig;
      let text: string | null = null;
      if (hit?.kind === 'rack') {
        const w = PRIMARY_WEAPON_IDS[hit.index];
        text = this.t(current === w ? 'range.station.equipped' : 'range.station.rack', { weapon: this.weaponName(w) });
      } else if (hit?.kind === 'reset') text = this.t('range.station.reset');
      else if (hit?.kind === 'speed') text = this.t('range.station.speed', { speed: this.t(`range.speed.${this.speedIndex}`) });
      this.promptText = text ? (key ? `${key} · ${text}` : text) : null;
      api.setPrompt(this.promptText);
    }
    if (!hit || !api.input.pressed('interact')) return;
    if (hit.kind === 'rack') {
      const w = PRIMARY_WEAPON_IDS[hit.index];
      if (current === w) return;
      api.setRangeWeapon(hit.index);
      api.audio.swap(w);
      api.hud.toast(this.t('range.station.equipped', { weapon: this.weaponName(w) }));
      this.promptSig = '';
    } else if (hit.kind === 'reset') {
      this.onReset();
      api.audio.ui('confirm');
      api.hud.toast(this.t('range.station.resetDone'));
    } else {
      this.speedIndex = (this.speedIndex + 1) % RANGE_SPEEDS.length;
      this.onSpeed(this.speedIndex);
      api.audio.ui('toggle');
      this.promptSig = '';
    }
  }

  dispose(): void {
    this.api.setPrompt(null);
  }
}
