/**
 * Write a result into the tab that started the work. Pure (no store imports),
 * like `lib/tab-clone.ts`.
 *
 * A tab-scoped store keeps the tab on screen in its root fields and the others
 * in `_tabStates`, so a plain `set()` after an `await` lands on whichever tab
 * the user moved to. The owner is captured before the first await and every
 * write after it goes through here. An owner that is neither current nor cached
 * was closed meanwhile: the write is dropped, the slice is not brought back.
 */
import type { TabbedRoot } from './tab-clone'

export function patchTabSlice<T extends object, S extends T & TabbedRoot<T>>(
  store: { getState: () => S; setState: (patch: Partial<S>) => void },
  ownerTabId: string | null,
  patch: Partial<T>,
): void {
  const s = store.getState()
  if (s._currentTabId === ownerTabId) {
    store.setState(patch as unknown as Partial<S>)
    return
  }
  if (ownerTabId === null) return
  const existing = s._tabStates.get(ownerTabId)
  if (!existing) return
  const tabStates = new Map(s._tabStates)
  tabStates.set(ownerTabId, { ...existing, ...patch })
  store.setState({ _tabStates: tabStates } as Partial<S>)
}

/** `patchTabSlice` for a patch computed from the owner's slice as it stands now. */
export function updateTabSlice<T extends object, S extends T & TabbedRoot<T>>(
  store: { getState: () => S; setState: (patch: Partial<S>) => void },
  ownerTabId: string | null,
  patch: (slice: T) => Partial<T>,
): void {
  const slice = readTabSlice<T, S>(store, ownerTabId)
  if (slice) patchTabSlice<T, S>(store, ownerTabId, patch(slice))
}

/**
 * The store state with a tab's slice gone. Closing the tab on screen leaves no
 * current tab, so the next `switchToTab` has nothing to store under its id.
 */
export function withoutTab<T>(
  s: TabbedRoot<T>,
  tabId: string,
): Pick<TabbedRoot<T>, '_tabStates' | '_currentTabId'> {
  const tabStates = new Map(s._tabStates)
  tabStates.delete(tabId)
  return {
    _tabStates: tabStates,
    _currentTabId: s._currentTabId === tabId ? null : s._currentTabId,
  }
}

/** The owner's slice as it stands now, or `undefined` when the tab was closed. */
export function readTabSlice<T extends object, S extends T & TabbedRoot<T>>(
  store: { getState: () => S },
  ownerTabId: string | null,
): T | undefined {
  const s = store.getState()
  if (s._currentTabId === ownerTabId) return s
  return ownerTabId === null ? undefined : s._tabStates.get(ownerTabId)
}
