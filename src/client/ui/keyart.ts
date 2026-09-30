// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — procedural key art (2D canvas "paintings").
//
// Each map gets a book-cover illustration built from layered silhouettes with
// aerial perspective, a mood-specific gradient sky, sun/glow, haze bands, the
// map's landmark, and a brush-stroke + grain finish. Deterministic (seeded).
// Results are cached per (map, size) as object URLs.
//
// Painting is heavy (thousands of brush strokes + full-canvas composites: up to
// seconds on slow devices / software canvas), so it runs in a Web Worker on an
// OffscreenCanvas (keyart.worker.ts) whenever available and never blocks the
// page: the menu stays responsive right after boot and the loading screen does
// not compete with the map build. Jobs run one at a time from a priority
// queue — art a screen is waiting for (loading screen) jumps ahead of
// background prewarming. Without worker/OffscreenCanvas support the same
// painter runs on the main thread in idle time (one map per task).
// ─────────────────────────────────────────────────────────────────────────────

import type { MapId } from '../../shared/types';
import { paint } from './keyart-scenes';

export type KeyArtSize = 'thumb' | 'full';

/** Job priority: something on screen waits for it > a visible thumbnail > background prewarm. */
const PRIO_PREWARM = 0;
const PRIO_VISIBLE = 1;
const PRIO_URGENT = 2;

interface Job {
  key: string;
  map: MapId;
  size: KeyArtSize;
  prio: number;
  resolve: (url: string) => void;
}

const cache = new Map<string, Promise<string>>();
const ready = new Map<string, string>();
const queue: Job[] = [];
let running: Job | null = null;
/** undefined = not tried yet; null = unavailable (main-thread painting). */
let worker: Worker | null | undefined;
let nextId = 1;

/** Object URL of the painting (cached). `prio` only reorders work that has not started yet. */
export function keyArt(map: MapId, size: KeyArtSize = 'full', prio = size === 'full' ? PRIO_URGENT : PRIO_VISIBLE): Promise<string> {
  const key = `${map}:${size}`;
  const queued = queue.find((j) => j.key === key);
  if (queued) queued.prio = Math.max(queued.prio, prio);
  let p = cache.get(key);
  if (!p) {
    p = new Promise<string>((resolve) => {
      queue.push({ key, map, size, prio, resolve });
    });
    cache.set(key, p);
    pump();
  }
  return p;
}

function pump(): void {
  if (running || queue.length === 0) return;
  // Highest priority first; FIFO within a priority.
  let best = 0;
  for (let i = 1; i < queue.length; i++) if (queue[i].prio > queue[best].prio) best = i;
  const job = queue.splice(best, 1)[0];
  running = job;
  const done = (url: string) => {
    if (running !== job) return;
    running = null;
    if (url) ready.set(job.key, url);
    job.resolve(url);
    pump();
  };
  const w = getWorker();
  if (w) runInWorker(w, job, done);
  else runOnMainThread(job, done);
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  try {
    const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    if (params?.get('keyartThread') === 'main') return null;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || !('convertToBlob' in OffscreenCanvas.prototype)) return null;
    worker = new Worker(new URL('./keyart.worker.ts', import.meta.url), { type: 'module', name: 'halcyon-keyart' });
  } catch {
    worker = null;
  }
  return worker;
}

function runInWorker(w: Worker, job: Job, done: (url: string) => void): void {
  const id = nextId++;
  const { w: cw, h: ch } = dims(job.size);
  const fallback = (why: string) => {
    // Worker missing a feature (e.g. no 2D OffscreenCanvas) or crashed: paint on the page from now on.
    console.info(`[keyart] worker painting unavailable (${why}); painting on the main thread`);
    w.removeEventListener('message', onMsg);
    w.removeEventListener('error', onErr);
    w.terminate();
    worker = null;
    runOnMainThread(job, done);
  };
  const onMsg = (e: MessageEvent) => {
    const m = e.data as { id: number; blob?: Blob; error?: string };
    if (!m || m.id !== id) return;
    w.removeEventListener('message', onMsg);
    w.removeEventListener('error', onErr);
    if (m.blob) done(URL.createObjectURL(m.blob));
    else fallback(m.error ?? 'no image');
  };
  const onErr = (e: ErrorEvent) => {
    e.preventDefault?.();
    fallback(e.message || 'worker error');
  };
  w.addEventListener('message', onMsg);
  w.addEventListener('error', onErr);
  w.postMessage({ id, map: job.map, w: cw, h: ch });
}

function runOnMainThread(job: Job, done: (url: string) => void): void {
  // Let the current frame finish before painting.
  const run = () => {
    try {
      const { w, h } = dims(job.size);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return done('');
      paint(ctx, job.map, w, h);
      if (canvas.toBlob) canvas.toBlob((b) => done(b ? URL.createObjectURL(b) : canvas.toDataURL('image/jpeg', 0.9)), 'image/jpeg', 0.9);
      else done(canvas.toDataURL('image/jpeg', 0.9));
    } catch (err) {
      console.warn('[keyart] paint failed', err);
      done('');
    }
  };
  if ('requestIdleCallback' in window) (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback(run, { timeout: job.prio >= PRIO_URGENT ? 120 : 1500 });
  else setTimeout(run, 16);
}

/** Cached URL if already painted. */
export function keyArtReady(map: MapId, size: KeyArtSize = 'full'): string | null {
  return ready.get(`${map}:${size}`) ?? null;
}

/** Paints thumbnails (and optionally full art) in the background. */
export function prewarmKeyArt(maps: MapId[] = ['gantry', 'pastel', 'observatory'], full = false): void {
  for (const m of maps) {
    void keyArt(m, 'thumb', PRIO_PREWARM);
    if (full) void keyArt(m, 'full', PRIO_PREWARM);
  }
}

/** Sets an element's background to the key art once ready. */
export function applyKeyArt(el: HTMLElement, map: MapId, size: KeyArtSize = 'thumb'): void {
  const now = keyArtReady(map, size);
  if (now) {
    el.style.backgroundImage = `url("${now}")`;
    return;
  }
  void keyArt(map, size, PRIO_VISIBLE).then((url) => {
    if (url) el.style.backgroundImage = `url("${url}")`;
  });
}

function dims(size: KeyArtSize): { w: number; h: number } {
  if (size === 'thumb') return { w: 560, h: 340 };
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.round(Math.min(1920, Math.max(1024, window.innerWidth * dpr * 0.9)));
  return { w, h: Math.round((w * 9) / 16) };
}
