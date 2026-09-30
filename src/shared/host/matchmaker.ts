// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — quick-play matchmaker: skill-banded queue with bot fill.
//
// Every update, entries are considered oldest-first:
//  1. Drop-in: the host may place the entry into a running public room that has
//     a bot to replace and enough time left (callback).
//  2. Otherwise gather compatible entries (same mode, compatible map, rating
//     within each other's band). The band starts at ±150 and widens by 100 per
//     second waited, so nobody waits long.
//  3. Start when the group reaches the mode's lobby size, or once the oldest
//     entry has waited QUEUE_BOT_FILL_AFTER seconds (bots fill the rest).
// Pure logic: time comes from the caller (nowMs); no clocks, no randomness.
// ─────────────────────────────────────────────────────────────────────────────

import { QUEUE_BOT_FILL_AFTER } from '../constants';
import { MODES } from '../modes';
import type { BotDifficulty, MapId, ModeId } from '../types';

export interface QueueEntry<C> {
  client: C;
  mode: ModeId;
  map: MapId | 'any';
  rating: number;
  botDifficulty: BotDifficulty;
  /** Time the entry was queued (host ms). */
  since: number;
}

export const RATING_BAND_START = 150;
export const RATING_BAND_GROWTH = 100;

export function ratingBand(waitedSec: number): number {
  return RATING_BAND_START + RATING_BAND_GROWTH * Math.max(0, waitedSec);
}

export function mapsCompatible(a: MapId | 'any', b: MapId | 'any'): boolean {
  return a === 'any' || b === 'any' || a === b;
}

export interface MatchmakerCallbacks<C> {
  /** Try to place the entry into a running room (drop-in). Return true if placed. */
  tryDropIn(entry: QueueEntry<C>): boolean;
  /** Start a new match for this group. `map` may be 'any' (host picks). */
  start(group: QueueEntry<C>[], mode: ModeId, map: MapId | 'any'): void;
}

export class Matchmaker<C> {
  private entries: QueueEntry<C>[] = [];

  get size(): number {
    return this.entries.length;
  }

  list(): readonly QueueEntry<C>[] {
    return this.entries;
  }

  has(client: C): boolean {
    return this.entries.some((e) => e.client === client);
  }

  enqueue(entry: QueueEntry<C>): void {
    this.remove(entry.client);
    this.entries.push(entry);
  }

  remove(client: C): boolean {
    const n = this.entries.length;
    this.entries = this.entries.filter((e) => e.client !== client);
    return this.entries.length !== n;
  }

  /** Size of the lobby a mode fills (humans + bots). */
  static lobbySize(mode: ModeId): number {
    return MODES[mode]?.maxPlayers ?? 10;
  }

  /** Humans currently compatible with `entry` (including itself), for status messages. */
  compatibleCount(entry: QueueEntry<C>, nowMs: number): number {
    const bandA = ratingBand((nowMs - entry.since) / 1000);
    let n = 0;
    for (const f of this.entries) {
      if (f.mode !== entry.mode || !mapsCompatible(entry.map, f.map)) continue;
      const bandB = ratingBand((nowMs - f.since) / 1000);
      if (Math.abs(f.rating - entry.rating) <= Math.min(bandA, bandB)) n++;
    }
    return Math.min(n, Matchmaker.lobbySize(entry.mode));
  }

  update(nowMs: number, cb: MatchmakerCallbacks<C>): void {
    if (this.entries.length === 0) return;
    const ordered = [...this.entries].sort((a, b) => a.since - b.since);
    const used = new Set<QueueEntry<C>>();
    for (const e of ordered) {
      if (used.has(e)) continue;
      if (cb.tryDropIn(e)) {
        used.add(e);
        continue;
      }
      const waited = (nowMs - e.since) / 1000;
      const bandA = ratingBand(waited);
      const size = Matchmaker.lobbySize(e.mode);
      const group: QueueEntry<C>[] = [e];
      let map: MapId | 'any' = e.map;
      for (const f of ordered) {
        if (group.length >= size) break;
        if (f === e || used.has(f) || f.mode !== e.mode || !mapsCompatible(map, f.map)) continue;
        const bandB = ratingBand((nowMs - f.since) / 1000);
        if (Math.abs(f.rating - e.rating) > Math.min(bandA, bandB)) continue;
        group.push(f);
        if (map === 'any') map = f.map;
      }
      if (group.length >= size || waited >= QUEUE_BOT_FILL_AFTER) {
        for (const g of group) used.add(g);
        cb.start(group, e.mode, map);
      }
    }
    if (used.size) this.entries = this.entries.filter((e) => !used.has(e));
  }
}
