// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — key rebinding with conflict handling.
//
// Binding a key that another action already uses SWAPS instead of silently
// stealing: the other action receives the key this slot had before (when
// there was one), so no action is left unbound by accident. The caller gets
// what happened back so it can tell the player ("R swapped with Reload").
// ─────────────────────────────────────────────────────────────────────────────

// Pure (no DOM, generic over the action names) so it is unit-tested in node.

type Bindings<A extends string> = Record<A, { keys: string[] }>;

/** The part of SettingsStore this needs (settings.bind removes `code` from every other action). */
export interface BindingStore<A extends string> {
  readonly value: { bindings: Bindings<A> };
  bind(action: A, slot: number, code: string | null): void;
}

export interface RebindResult<A extends string> {
  /** Action that previously used the key (null = no conflict). */
  from: A | null;
  /** Key handed to `from` in exchange (null = it simply lost the key). */
  swapped: string | null;
}

/** Which other action uses `code` (null if none). */
export function bindingConflict<A extends string>(bindings: Bindings<A>, action: A, code: string): A | null {
  for (const a of Object.keys(bindings) as A[]) {
    if (a !== action && bindings[a]?.keys.includes(code)) return a;
  }
  return null;
}

export function rebindWithSwap<A extends string>(store: BindingStore<A>, action: A, slot: number, code: string | null): RebindResult<A> {
  if (!code) {
    store.bind(action, slot, null);
    return { from: null, swapped: null };
  }
  const before = store.value.bindings;
  const from = bindingConflict(before, action, code);
  const old = before[action]?.keys[slot] ?? null;
  // Snapshot what the displaced action had, with the stolen key replaced by ours.
  const wanted = from && old && old !== code ? before[from].keys.map((k) => (k === code ? old : k)) : null;
  store.bind(action, slot, code);
  if (!from) return { from: null, swapped: null };
  if (wanted && old && !bindingConflict(store.value.bindings, from, old)) {
    // Re-apply slot by slot so the key order (primary key = prompt glyph) is kept.
    wanted.forEach((k, i) => store.bind(from, i, k));
    return { from, swapped: old };
  }
  return { from, swapped: null };
}
