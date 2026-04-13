import { create } from 'zustand'
import type { Tab } from '../types'

interface TabsStore {
  tabs: Tab[]
  activeTabId: string | null

  openTab: (tab: Omit<Tab, 'isDirty' | 'isLoading'>) => void
  /** Open in a preview (temporary) tab — replaces existing preview tab */
  openPreviewTab: (tab: Omit<Tab, 'isDirty' | 'isLoading' | 'isPreview'>) => void
  /** Pin (persist) the current preview tab so it won't be replaced */
  pinTab: (id: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string | null) => void
  updateTab: (id: string, updates: Partial<Tab>) => void
  markDirty: (id: string, dirty: boolean) => void
  markLoading: (id: string, loading: boolean) => void
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (tab) => {
    // Only match existing tabs if the incoming tab references a specific endpoint/savedRequest
    if (tab.endpointId || tab.savedRequestId) {
      const existing = get().tabs.find(
        (t) =>
          (tab.endpointId && t.endpointId === tab.endpointId) ||
          (tab.savedRequestId && t.savedRequestId === tab.savedRequestId)
      )
      if (existing) {
        // If found an existing preview tab, pin it
        set((state) => ({
          activeTabId: existing.id,
          tabs: state.tabs.map((t) => t.id === existing.id ? { ...t, isPreview: false } : t),
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
          (tab.savedRequestId && t.savedRequestId === tab.savedRequestId)
      )
      if (existing) {
        set({ activeTabId: existing.id })
        return
      }
    }

    const state = get()
    const existingPreview = state.tabs.find((t) => t.isPreview)

    if (existingPreview) {
      // Replace the existing preview tab's content
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === existingPreview.id
            ? { ...t, ...tab, id: existingPreview.id, isDirty: false, isLoading: false, isPreview: true }
            : t
        ),
        activeTabId: existingPreview.id,
      }))
    } else {
      // Create a new preview tab
      const newTab: Tab = { ...tab, isDirty: false, isLoading: false, isPreview: true }
      set((s) => ({
        tabs: [...s.tabs, newTab],
        activeTabId: newTab.id,
      }))
    }
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
