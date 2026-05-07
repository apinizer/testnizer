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

export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: initialTabs,
  activeTabId: initialActiveTabId,

  openTab: (tab) => {
    // Only match existing tabs if the incoming tab references a specific endpoint/savedRequest
    if (tab.endpointId || tab.savedRequestId) {
      const existing = get().tabs.find(
        (t) =>
          (tab.endpointId && t.endpointId === tab.endpointId) ||
          (tab.savedRequestId && t.savedRequestId === tab.savedRequestId),
      )
      if (existing) {
        // If found an existing preview tab, pin it
        set((state) => ({
          activeTabId: existing.id,
          tabs: state.tabs.map((t) => (t.id === existing.id ? { ...t, isPreview: false } : t)),
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
    // If there's already a tab for this exact endpoint/savedRequest, just activate it
    if (tab.endpointId || tab.savedRequestId) {
      const existing = get().tabs.find(
        (t) =>
          (tab.endpointId && t.endpointId === tab.endpointId) ||
          (tab.savedRequestId && t.savedRequestId === tab.savedRequestId),
      )
      if (existing) {
        set({ activeTabId: existing.id })
        return
      }
    }

    const state = get()
    const existingPreview = state.tabs.find((t) => t.isPreview)

    if (existingPreview) {
      if (existingPreview.isDirty) {
        // Pin the dirty preview so its changes aren't lost, then open a fresh preview
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === existingPreview.id ? { ...t, isPreview: false } : t)),
        }))
        const newTab: Tab = { ...tab, isDirty: false, isLoading: false, isPreview: true }
        set((s) => ({ tabs: [...s.tabs, newTab], activeTabId: newTab.id }))
      } else {
        // Replace the existing (clean) preview tab's content
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === existingPreview.id
              ? {
                  ...t,
                  ...tab,
                  id: existingPreview.id,
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
