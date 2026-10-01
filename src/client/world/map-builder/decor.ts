// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — map builder: per-map decor module loading (lazy chunks).
// ─────────────────────────────────────────────────────────────────────────────

import type { DecorBuilder } from '../../contracts';
import type { BackdropOptions } from './backdrop';

// world/maps/<id>.ts (contract) — or world/maps/<id>/index.ts for multi-file decor.
const DECOR_MODULES = import.meta.glob(['../maps/*.ts', '../maps/*/index.ts']);

export interface DecorModule {
  default?: DecorBuilder;
  backdrop?: BackdropOptions;
}

/**
 * Idle-time prefetch of every map's decor chunk (called once the menu is up): keeps the
 * download off the loading screen's critical path, and an offline fallback match still
 * gets its full decor when the page's origin has gone away (server stopped mid-session).
 */
export function prefetchDecorModules(): void {
  for (const load of Object.values(DECOR_MODULES)) void load().catch(() => undefined);
}

export async function loadDecor(id: string): Promise<DecorModule | null> {
  const loader = DECOR_MODULES[`../maps/${id}.ts`] ?? DECOR_MODULES[`../maps/${id}/index.ts`];
  if (!loader) return null;
  try {
    return (await loader()) as DecorModule;
  } catch (err) {
    console.error(`[map] decor module for '${id}' failed to load`, err);
    return null;
  }
}
