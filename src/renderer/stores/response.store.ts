import { create } from 'zustand'
import type { ApiResponse } from '../types'
import { useTabsStore } from './tabs.store'

/**
 * Response state, keyed by TAB (issue #76).
 *
 * This used to be one `response` and one `isLoading` for the whole window, so
 * every tab shared the state of whichever request last ran:
 *
 *   - fire a slow request in tab A, switch to tab B, and B's Send button was a
 *     red **Cancel** — pressing it aborted A's request;
 *   - B's response pane showed A's spinner, then A's response;
 *   - A's response arrived and overwrote whatever B was showing.
 *
 * The per-tab truth already existed on `Tab.isLoading`; this store was a second,
 * contradicting source. Now each tab owns a slice and the store mirrors the
 * ACTIVE tab's slice into `response` / `isLoading`, so the fifty-odd readers
 * (`useResponseStore((s) => s.response)`) are unchanged and simply see the tab
 * they are looking at.
 *
 * Writers are the part that had to change: they pass the tab they STARTED in.
 * Defaulting to "whatever is active when the write lands" would reintroduce the
 * bug from the other end — a slow response would land in whichever tab the user
 * had switched to by the time it arrived.
 */
export interface TabResponseState {
  response: ApiResponse | null
  isLoading: boolean
}

const EMPTY: TabResponseState = { response: null, isLoading: false }

/**
 * Slice used when there is no tab context at all — the Quick Test shell and the
 * very first render before a tab exists. Without it a write with no active tab
 * would be dropped on the floor, which is the silent-swallow class this codebase
 * keeps paying for; the store simply behaves like the old global one until tabs
 * come into play.
 */
const DETACHED = '__detached__'
const keyFor = (tabId: string | null): string => tabId ?? DETACHED

interface ResponseStore {
  /** Per-tab slices. Absent key ⇒ nothing has run in that tab yet. */
  byTab: Record<string, TabResponseState>
  /** Which tab the mirrored fields below describe. */
  activeTabId: string | null

  /** Mirror of `byTab[activeTabId]` — the surface every reader already uses. */
  response: ApiResponse | null
  isLoading: boolean

  /**
   * `tabId` is optional so callers that genuinely mean "the tab in front of the
   * user right now" (opening an endpoint, clicking a history row) stay simple.
   * Anything asynchronous must pass the id it captured before awaiting.
   */
  setResponse: (response: ApiResponse, tabId?: string | null) => void
  clearResponse: (tabId?: string | null) => void
  setLoading: (loading: boolean, tabId?: string | null) => void
  /** Drop a closed tab's slice so responses don't accumulate for the session. */
  forgetTab: (tabId: string) => void
  /** Re-point the mirror; called when the active tab changes. */
  syncActiveTab: (tabId: string | null) => void
}

/** Recompute the mirrored fields from a byTab map + the active tab. */
function mirror(byTab: Record<string, TabResponseState>, activeTabId: string | null) {
  const slice = byTab[keyFor(activeTabId)] ?? EMPTY
  return { response: slice.response, isLoading: slice.isLoading }
}

export const useResponseStore = create<ResponseStore>((set, get) => {
  /** Which tab a write belongs to: explicit id, else the active tab. */
  const target = (tabId?: string | null): string | null =>
    tabId !== undefined ? tabId : get().activeTabId

  const write = (tabId: string | null, patch: Partial<TabResponseState>): void => {
    const key = keyFor(tabId)
    set((s) => {
      const byTab = { ...s.byTab, [key]: { ...(s.byTab[key] ?? EMPTY), ...patch } }
      return { byTab, ...mirror(byTab, s.activeTabId) }
    })
  }

  return {
    byTab: {},
    activeTabId: null,
    response: null,
    isLoading: false,

    // A response always ends the loading state OF ITS OWN TAB.
    setResponse: (response, tabId) => write(target(tabId), { response, isLoading: false }),
    clearResponse: (tabId) => write(target(tabId), { response: null }),
    setLoading: (loading, tabId) => write(target(tabId), { isLoading: loading }),

    forgetTab: (tabId) =>
      set((s) => {
        if (!(tabId in s.byTab)) return s
        const byTab = { ...s.byTab }
        delete byTab[tabId]
        return { byTab, ...mirror(byTab, s.activeTabId) }
      }),

    syncActiveTab: (tabId) =>
      set((s) => (s.activeTabId === tabId ? s : { activeTabId: tabId, ...mirror(s.byTab, tabId) })),
  }
})

/*
 * Follow the active tab.
 *
 * Subscribing here rather than calling into this store from `tabs.store` keeps
 * the dependency one-way — `tabs.store` imports nothing from the store layer,
 * and several stores already import this one, so the reverse edge would close a
 * cycle. Fires immediately so the first render is already pointed at a tab.
 */
useTabsStore.subscribe((state, prev) => {
  if (state.activeTabId !== prev.activeTabId) {
    useResponseStore.getState().syncActiveTab(state.activeTabId)
  }
  // A closed tab's response is dead weight; drop it once it is gone.
  if (state.tabs !== prev.tabs) {
    const live = new Set(state.tabs.map((t) => t.id))
    for (const id of Object.keys(useResponseStore.getState().byTab)) {
      if (id !== DETACHED && !live.has(id)) useResponseStore.getState().forgetTab(id)
    }
  }
})
useResponseStore.getState().syncActiveTab(useTabsStore.getState().activeTabId)
