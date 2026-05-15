import { create } from 'zustand'
import type { Tab, ToolProtocol } from '../types'
import { loadJson, saveJson } from '../lib/persist-helpers'

type SidebarPageId = 'apis' | 'tests' | 'docs' | 'history' | 'tools' | 'mocks' | 'settings'

interface TabsStore {
  tabs: Tab[]
  activeTabId: string | null
  /**
   * The last active tab per sidebar page. setActiveSidebarPage in ui.store
   * calls `rememberAndRestoreForPage` so APIs ↔ Tests ↔ Mocks round-trips
   * land back on the same tab the user had focused (v1.3.1 B13 / R-6).
   */
  lastActiveByPage: Partial<Record<SidebarPageId, string | null>>

  openTab: (tab: Omit<Tab, 'isDirty' | 'isLoading'>) => void
  /** Open in a preview (temporary) tab — replaces existing preview tab */
  openPreviewTab: (tab: Omit<Tab, 'isDirty' | 'isLoading' | 'isPreview'>) => void
  /** Open a tool tab (JWT, JSON formatter, etc). If a tab of the same tool
   *  type already exists, activate it instead of opening a duplicate. */
  openToolTab: (toolType: ToolProtocol, label: string) => void
  /** Pin (persist) the current preview tab so it won't be replaced */
  pinTab: (id: string) => void
  closeTab: (id: string) => void
  /** Drop every open tab — used on project switch to prevent stale endpoint
   * references from leaking across project boundaries. */
  closeAllTabs: () => void
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
  /**
   * Remember the current activeTabId under the OUTGOING page and restore the
   * one stored for the incoming page. Called from setActiveSidebarPage.
   */
  rememberAndRestoreForPage: (incoming: SidebarPageId) => void
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

function pageOfTab(tab: Tab): SidebarPageId {
  if (tab.protocol === 'mockServer' || tab.mockServerId) return 'mocks'
  if (tab.testSuiteItemId || tab.protocol === 'runner') return 'tests'
  return 'apis'
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: initialTabs,
  activeTabId: initialActiveTabId,
  lastActiveByPage: {},

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
        // Replace the existing (clean) preview tab's content. Identity
        // fields (endpointId / savedRequestId / mockServerId /
        // testSuiteItemId / folderId) are mutually exclusive, so we
        // ALWAYS overwrite each one with the new tab's value — even
        // when that value is undefined. Without the explicit overrides
        // a previous suite-item preview would leave `testSuiteItemId`
        // behind, making the flask icon stick on an APIs-tree preview
        // that opened in the same slot (and the Save router would still
        // try to write to test_suite_items).
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === existingPreview.id
              ? {
                  ...t,
                  ...tab,
                  id: existingPreview.id,
                  endpointId: tab.endpointId,
                  savedRequestId: tab.savedRequestId,
                  mockServerId: tab.mockServerId,
                  testSuiteItemId: tab.testSuiteItemId,
                  folderId: tab.folderId,
                  isDirty: false,
                  isLoading: false,
                  isPreview: true,
                }
              : t,
          ),
          activeTabId: existingPreview.id,
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

  rememberAndRestoreForPage: (incoming) =>
    set((state) => {
      // Bookmark the outgoing page using the current active tab's page.
      const next = { ...state.lastActiveByPage }
      const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
      if (activeTab) {
        const outgoing = pageOfTab(activeTab)
        next[outgoing] = state.activeTabId
      }
      // If the incoming page has a remembered tab AND that tab still exists,
      // restore it. Otherwise pick the first tab that belongs to the new page
      // so the workbench never lands on the welcome screen when there's still
      // a usable tab open.
      const remembered = next[incoming] ?? null
      const stillExists = remembered && state.tabs.some((t) => t.id === remembered)
      const fallback = state.tabs.find((t) => pageOfTab(t) === incoming)?.id ?? null
      return {
        lastActiveByPage: next,
        activeTabId: stillExists ? remembered : fallback,
      }
    }),
}))

// Persist on every change. `isLoading` is dropped so a tab that was mid-flight
// when the app closed does not come back stuck in a loading spinner.
useTabsStore.subscribe((state) => {
  saveJson(STORAGE_KEY, {
    tabs: state.tabs.map((t) => ({ ...t, isLoading: false })),
    activeTabId: state.activeTabId,
  })
})
