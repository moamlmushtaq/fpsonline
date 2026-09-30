// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — procedural key art (2D canvas "paintings").
//
// Each map gets a book-cover illustration built from layered silhouettes with
// aerial perspective, a mood-specific gradient sky, sun/glow, haze bands, the
// map's landmark, and a brush-stroke + grain finish. Deterministic (seeded).
// Results are cached per (map, size) as object URLs; generation is async and
// yields between maps so it never blocks a frame for long.
// ─────────────────────────────────────────────────────────────────────────────

import type { MapId } from '../../shared/types';
import { paint } from './keyart-scenes';

export type KeyArtSize = 'thumb' | 'full';

const cache = new Map<string, Promise<string>>();
const ready = new Map<string, string>();

/** Object URL of the painting (cached). */
export function keyArt(map: MapId, size: KeyArtSize = 'full'): Promise<string> {
  const key = `${map}:${size}`;
  let p = cache.get(key);
  if (!p) {
    p = new Promise<string>((resolve) => {
      // Let the current frame finish before painting.
      const run = () => {
        try {
          const { w, h } = dims(size);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve('');
          paint(ctx, map, w, h);
          const done = (url: string) => {
            ready.set(key, url);
            resolve(url);
          };
          if (canvas.toBlob) canvas.toBlob((b) => done(b ? URL.createObjectURL(b) : canvas.toDataURL('image/jpeg', 0.9)), 'image/jpeg', 0.9);
          else done(canvas.toDataURL('image/jpeg', 0.9));
        } catch (err) {
          console.warn('[keyart] paint failed', err);
          resolve('');
        }
      };
      if ('requestIdleCallback' in window) (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback(run, { timeout: 120 });
      else setTimeout(run, 16);
    });
    cache.set(key, p);
  }
  return p;
}

/** Cached URL if already painted. */
export function keyArtReady(map: MapId, size: KeyArtSize = 'full'): string | null {
  return ready.get(`${map}:${size}`) ?? null;
}

/** Paints thumbnails (and optionally full art) in the background. */
export function prewarmKeyArt(maps: MapId[] = ['gantry', 'pastel', 'observatory'], full = false): void {
  let chain = Promise.resolve();
  for (const m of maps) {
    chain = chain.then(() => keyArt(m, 'thumb')).then(() => undefined);
    if (full) chain = chain.then(() => keyArt(m, 'full')).then(() => undefined);
  }
}

/** Sets an element's background to the key art once ready. */
export function applyKeyArt(el: HTMLElement, map: MapId, size: KeyArtSize = 'thumb'): void {
  const now = keyArtReady(map, size);
  if (now) {
    el.style.backgroundImage = `url("${now}")`;
    return;
  }
  void keyArt(map, size).then((url) => {
    if (url) el.style.backgroundImage = `url("${url}")`;
  });
}

function dims(size: KeyArtSize): { w: number; h: number } {
  if (size === 'thumb') return { w: 560, h: 340 };
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.round(Math.min(1920, Math.max(1024, window.innerWidth * dpr * 0.9)));
  return { w, h: Math.round((w * 9) / 16) };
}
