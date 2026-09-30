// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — key-art painter worker. Paints one map illustration per
// request into an OffscreenCanvas and returns a JPEG Blob, so the (heavy,
// thousands of brush strokes) painting never blocks the page's main thread —
// menus stay responsive and the loading screen doesn't compete with the map
// build. keyart.ts falls back to main-thread painting when this is unavailable.
//   → { id, map, w, h }      ← { id, blob } | { id, error }
// ─────────────────────────────────────────────────────────────────────────────

import type { MapId } from '../../shared/types';
import { paint } from './keyart-scenes';

interface Req {
  id: number;
  map: MapId;
  w: number;
  h: number;
}

const scope = self as unknown as { postMessage(m: unknown): void; addEventListener(t: 'message', cb: (e: MessageEvent) => void): void };

scope.addEventListener('message', (e: MessageEvent) => {
  const r = e.data as Req;
  void (async () => {
    try {
      const canvas = new OffscreenCanvas(r.w, r.h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context in worker');
      paint(ctx, r.map, r.w, r.h);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      scope.postMessage({ id: r.id, blob });
    } catch (err) {
      scope.postMessage({ id: r.id, error: String(err) });
    }
  })();
});
