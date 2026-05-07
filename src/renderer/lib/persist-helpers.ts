/**
 * Lightweight session-persistence helpers for Zustand stores.
 *
 * Why we don't use `zustand/middleware`'s `persist`: TypeScript inference for
 * the curried `create<T>()(persist(...))` form is brittle when stores carry
 * `Map` fields, and we already have a uniform pattern across stores. A pair
 * of `loadJson` + `saveJson` plus the optional Map ↔ entries helpers is
 * enough to express what every store needs.
 *
 * Storage backend: `window.localStorage`. Renderer-only — never imported
 * from main.
 */

export function loadJson<T>(key: string): T | null {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(key)
    if (raw == null || raw === '') return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // QuotaExceeded / serialisation errors are silently swallowed —
    // the in-memory state continues to work.
  }
}

export function mapToEntries<K, V>(m: Map<K, V> | undefined | null): [K, V][] {
  if (!m) return []
  return Array.from(m.entries())
}

export function entriesToMap<K, V>(entries: [K, V][] | undefined | null): Map<K, V> {
  return new Map(entries ?? [])
}

/**
 * Per-tab Zustand store helper. Every protocol store has the same shape:
 *   - the active tab's editable state is flattened onto the root
 *   - `_tabStates: Map<tabId, TState>` caches state for non-active tabs
 *   - `_currentTabId: string | null` identifies the active tab
 *
 * `loadTabbedState` reads a previously-saved snapshot and merges it onto the
 * caller's `emptyTabState()` so that any newly-added fields gracefully fall
 * back to defaults (forward-compatible across releases).
 */
export interface PersistedTabbed<TState> {
  current: Partial<TState>
  _currentTabId: string | null
  _tabStates: [string, TState][]
}

export function loadTabbedState<TState>(
  storageKey: string,
  emptyTabState: () => TState,
): { current: TState; _tabStates: Map<string, TState>; _currentTabId: string | null } {
  const empty = emptyTabState()
  const persisted = loadJson<PersistedTabbed<TState>>(storageKey)
  if (!persisted) {
    return { current: empty, _tabStates: new Map(), _currentTabId: null }
  }
  // Make sure cached per-tab states also have any new fields filled in.
  const tabStates = new Map<string, TState>()
  for (const [id, st] of persisted._tabStates ?? []) {
    tabStates.set(id, { ...empty, ...(st as object) } as TState)
  }
  return {
    current: { ...empty, ...(persisted.current as object) } as TState,
    _tabStates: tabStates,
    _currentTabId: persisted._currentTabId ?? null,
  }
}

/**
 * Subscribes to the given Zustand store and writes a `PersistedTabbed`
 * snapshot to localStorage on every change. Pass an `extractCurrent` that
 * returns just the *editable* state (excludes connection ids, in-flight
 * flags, response bodies — anything transient).
 */
export function attachTabbedPersist<TStore, TState>(
  store: { subscribe: (cb: (s: TStore) => void) => () => void },
  storageKey: string,
  extractCurrent: (s: TStore) => TState,
  extractTabMap: (s: TStore) => { _tabStates: Map<string, TState>; _currentTabId: string | null },
): void {
  store.subscribe((state) => {
    const tabbed = extractTabMap(state)
    saveJson(storageKey, {
      current: extractCurrent(state),
      _currentTabId: tabbed._currentTabId,
      _tabStates: mapToEntries(tabbed._tabStates),
    })
  })
}
