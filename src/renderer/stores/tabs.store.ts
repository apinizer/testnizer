import { create } from 'zustand'
import type { Tab, Protocol } from '../types'

interface TabsStore {
  tabs: Tab[]
  activeTabId: string | null

  openTab: (tab: Omit<Tab, 'isDirty' | 'isLoading'>) => void
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
        set({ activeTabId: existing.id })
        return
      }
    }
    const newTab: Tab = { ...tab, isDirty: false, isLoading: false }
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }))
  },

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
