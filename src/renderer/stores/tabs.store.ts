import { create } from 'zustand'
import type { Tab, ToolProtocol } from '../types'
import { loadJson, saveJson } from '../lib/persist-helpers'

interface TabsStore {
  tabs: Tab[]
  activeTabId: string | null

  openTab: (tab: Omit<Tab, 'isDirty' | 'isLoading'>) => void
  /** Open in a preview (temporary) tab — replaces existing preview tab */
  openPreviewTab: (tab: Omit<Tab, 'isDirty' | 'isLoading' | 'isPreview'>) => void
  /** Open a tool tab (JWT, JSON formatter, etc). If a tab of the same tool
   *  type already exists, activate it instead of opening a duplicate. */
  openToolTab: (toolType: ToolProtocol, label: string) => void
  /** Pin (persist) the current preview tab so it won't be replaced */
  pinTab: (id: string) => void
  closeTab: (id: string) => void
  /** Drop every open tab — used when a project/workspace is deleted. */
  closeAllTabs: () => void
  /** Replace the whole open-tab set (per-project tab snapshots, #1). */
  replaceAllTabs: (tabs: Tab[], activeTabId: string | null) => void
  /**
   * Reorder tabs by drag-drop. Moves `tabId` to the position immediately
   * before `beforeTabId`; pass `null` to move it to the end. No-op when the
   * source/target are the same id or when either id isn't currently open.
   */
  moveTab: (tabId: string, beforeTabId: string | null) => void
  setActiveTab: (id: string | null) => void
  updateTab: (id: string, updates: Partial<Tab>) => void
  markDirty: (id: string, dirty: boolean) => void
  markLoading: (id: string, loading: boolean) => void
}

const STORAGE_KEY = 'testnizer-tabs'

interface PersistedTabs {
  tabs: Tab[]
  activeTabId: string | null
}

const persisted = loadJson<PersistedTabs>(STORAGE_KEY)
const initialTabs: Tab[] = (persisted?.tabs ?? []).map((t) => ({ ...t, isLoading: false }))
const initialActiveTabId = persisted?.activeTabId ?? null

/**
 * Which workspace a tab belongs to. Used to scope the preview slot — APIs
 * and Tests are conceptually separate workspaces (independent data layer,
 * independent sidebar trees) so a preview tab in one should NOT be replaced
 * by a single click in the other. Each kind has its own preview slot.
 */
type TabKind = 'apis' | 'suite' | 'mock' | 'other'

function tabKind(tab: { testSuiteItemId?: string; mockServerId?: string }): TabKind {
  if (tab.testSuiteItemId) return 'suite'
  if (tab.mockServerId) return 'mock'
  // endpointId / savedRequestId / folderId / fresh requests all live in the
  // APIs workspace. "other" covers Tools / Runner / Welcome — those don't
  // open as previews today, but the bucket is here as a safety net.
  return 'apis'
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: initialTabs,
  activeTabId: initialActiveTabId,

  openTab: (tab) => {
    // Match existing tabs that reference the same logical resource so we
    // don't open multiple tabs for one endpoint, saved request, mock
    // server, or test-suite item. Without the testSuiteItemId branch the
    // pinned-create path (handleAddItem) would also re-open an already-
    // present tab as a duplicate.
    if (tab.endpointId || tab.savedRequestId || tab.mockServerId || tab.testSuiteItemId) {
      const existing = get().tabs.find(
        (t) =>
          (tab.endpointId && t.endpointId === tab.endpointId) ||
          (tab.savedRequestId && t.savedRequestId === tab.savedRequestId) ||
          (tab.mockServerId && t.mockServerId === tab.mockServerId) ||
          (tab.testSuiteItemId && t.testSuiteItemId === tab.testSuiteItemId),
      )
      if (existing) {
        set((state) => ({
          activeTabId: existing.id,
          tabs: state.tabs.map((t) => (t.id === existing.id ? { ...t, isPreview: false } : t)),
        }))
        return
      }
    }
    // Singleton tab id guard: callers like openOrReuseRunnerTab and the tools
    // panel hand us a stable, well-known id (e.g. "runner-main"). When that id
    // is already present we MUST reuse the existing tab and just refocus —
    // otherwise repeated right-click "Run" pushes duplicate runner tabs into
    // the list (v1.3.1 §5.1 bug: 3 clicks → 3 phantom runner tabs).
    if (tab.id) {
      const existingById = get().tabs.find((t) => t.id === tab.id)
      if (existingById) {
        set((state) => ({
          activeTabId: existingById.id,
          tabs: state.tabs.map((t) =>
            t.id === existingById.id ? { ...t, ...tab, isPreview: false } : t,
          ),
        }))
        return
      }
    }
    const newTab: Tab = { ...tab, isDirty: false, isLoading: false, isPreview: false }
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }))
  },

  openPreviewTab: (tab) => {
    // If there's already a tab for this exact endpoint / savedRequest /
    // testSuiteItem, just activate it. Without the testSuiteItemId branch
    // two suite items collide on the generic "find any preview" fallback
    // below and end up sharing one physical tab id — closing one then
    // closes the other, and renaming one bleeds into the other.
    if (tab.endpointId || tab.savedRequestId || tab.testSuiteItemId) {
      const existing = get().tabs.find(
        (t) =>
          (tab.endpointId && t.endpointId === tab.endpointId) ||
          (tab.savedRequestId && t.savedRequestId === tab.savedRequestId) ||
          (tab.testSuiteItemId && t.testSuiteItemId === tab.testSuiteItemId),
      )
      if (existing) {
        set({ activeTabId: existing.id })
        return
      }
    }

    // Id-level dedup: never mint a second physical tab carrying an id that's
    // already open. The clean-preview-replace branch below adopts the incoming
    // payload id (to keep the `tab.id === tab-${resourceId}` invariant), so
    // without this guard the metadata-less fallback open path (TreeView's
    // "open with basic info") could land a replaced slot on an id that another
    // open tab already uses — two tabs sharing one id, both rendering as the
    // active tab (issue #24 hardening).
    const dupById = get().tabs.find((t) => t.id === tab.id)
    if (dupById) {
      set({ activeTabId: dupById.id })
      return
    }

    const state = get()
    // Scope the preview slot per workspace kind — APIs preview ≠ Tests
    // preview ≠ Mocks preview. A click in one tree never disturbs another
    // tree's preview tab.
    const newKind = tabKind(tab)
    const existingPreview = state.tabs.find((t) => t.isPreview && tabKind(t) === newKind)

    if (existingPreview) {
      if (existingPreview.isDirty) {
        // Pin the dirty preview so its changes aren't lost, then open a fresh preview
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === existingPreview.id ? { ...t, isPreview: false } : t)),
        }))
        const newTab: Tab = { ...tab, isDirty: false, isLoading: false, isPreview: true }
        set((s) => ({ tabs: [...s.tabs, newTab], activeTabId: newTab.id }))
      } else {
        // Replace the existing (clean) preview tab's content. Build the new
        // tab purely from the incoming payload — crucially ADOPTING its `id`
        // instead of keeping `existingPreview.id`. The old "keep the slot's
        // id" behaviour decoupled a physical tab id from the resource it
        // showed (`tab.id` stopped equalling `tab-${endpointId}`); a later
        // open of the original resource then minted a NEW tab whose
        // `tab-${id}` collided with this stale slot, so two tabs shared one id
        // and BOTH rendered as the active tab (issue #24). Rebuilding from the
        // payload also drops any stale identity field (endpointId /
        // savedRequestId / mockServerId / testSuiteItemId / folderId) for free
        // — those are mutually exclusive, so a fresh object carries only the
        // new resource's id and keeps the flask icon / Save router correct.
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === existingPreview.id
              ? { ...tab, isDirty: false, isLoading: false, isPreview: true }
              : t,
          ),
          activeTabId: tab.id,
        }))
      }
    } else {
      // Create a new preview tab
      const newTab: Tab = { ...tab, isDirty: false, isLoading: false, isPreview: true }
      set((s) => ({
        tabs: [...s.tabs, newTab],
        activeTabId: newTab.id,
      }))
    }
  },

  openToolTab: (toolType, label) => {
    const existing = get().tabs.find((t) => t.protocol === toolType)
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    const newTab: Tab = {
      id: `tool-${toolType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: label,
      protocol: toolType,
      isDirty: false,
      isLoading: false,
      isPreview: false,
    }
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }))
  },

  pinTab: (id) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, isPreview: false } : t)),
    })),

  closeTab: (id) =>
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === id)
      const filtered = state.tabs.filter((t) => t.id !== id)
      let nextActive = state.activeTabId
      if (state.activeTabId === id) {
        if (filtered.length === 0) {
          nextActive = null
        } else {
          nextActive = filtered[Math.min(idx, filtered.length - 1)].id
        }
      }
      return { tabs: filtered, activeTabId: nextActive }
    }),

  closeAllTabs: () => set({ tabs: [], activeTabId: null }),

  // Swap the entire open-tab set. Used by the workspace store to keep a
  // separate tab set per open project (#1): switching projects snapshots the
  // current tabs and restores the target project's, instead of wiping them.
  replaceAllTabs: (tabs, activeTabId) =>
    set({ tabs: tabs.map((t) => ({ ...t, isLoading: false })), activeTabId }),

  moveTab: (tabId, beforeTabId) =>
    set((state) => {
      if (tabId === beforeTabId) return state
      const fromIdx = state.tabs.findIndex((t) => t.id === tabId)
      if (fromIdx < 0) return state
      const moved = state.tabs[fromIdx]
      const without = state.tabs.filter((t) => t.id !== tabId)
      const insertAt =
        beforeTabId === null
          ? without.length
          : (() => {
              const idx = without.findIndex((t) => t.id === beforeTabId)
              return idx < 0 ? without.length : idx
            })()
      const next = [...without.slice(0, insertAt), moved, ...without.slice(insertAt)]
      return { tabs: next }
    }),

  setActiveTab: (id) => set({ activeTabId: id || null }),

  updateTab: (id, updates) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  markDirty: (id, dirty) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, isDirty: dirty } : t)),
    })),

  markLoading: (id, loading) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, isLoading: loading } : t)),
    })),
}))

// Persist on every change. `isLoading` is dropped so a tab that was mid-flight
// when the app closed does not come back stuck in a loading spinner.
useTabsStore.subscribe((state) => {
  saveJson(STORAGE_KEY, {
    tabs: state.tabs.map((t) => ({ ...t, isLoading: false })),
    activeTabId: state.activeTabId,
  })
})
