/**
 * Duplicate Tab — copy one tab's slice of a tab-scoped store onto another tab
 * id. Pure (no store imports): every tab-scoped store's `cloneTabState`
 * calls it, and `lib/activate-tab.ts` `cloneTabStores` drives them.
 *
 * The source slice is the live one when the source tab is current (its latest
 * edits are not in the cache yet), else its cached slice. The copy lands on
 * the LIVE root when the destination is already the current tab — a bound
 * duplicate is opened (and every store switched onto it) before the copy is
 * made, and a write to the cache alone would be overwritten by the next
 * switch, which saves the live slice over it.
 */

export interface TabbedRoot<T> {
  _currentTabId: string | null
  _tabStates: Map<string, T>
}

export function cloneTabSlice<T extends object, S extends T & TabbedRoot<T>>(
  store: { getState: () => S; setState: (patch: Partial<S>) => void },
  extract: (s: S) => T,
  srcTabId: string,
  dstTabId: string,
  /** The copy as the destination starts — runtime / connection state reset. */
  prepare: (src: T) => T,
): void {
  if (srcTabId === dstTabId) return
  const s = store.getState()
  const src = s._currentTabId === srcTabId ? extract(s) : s._tabStates.get(srcTabId)
  if (!src) return
  const copy = prepare(src)
  if (s._currentTabId === dstTabId) {
    store.setState(copy as Partial<S>)
    return
  }
  const tabStates = new Map(s._tabStates)
  tabStates.set(dstTabId, copy)
  store.setState({ _tabStates: tabStates } as Partial<S>)
}
