import { create } from 'zustand'

/**
 * Which editor sub-tab (Params / Body / Headers …) each open request tab was
 * last showing — issue #205.
 *
 * The protocol editors are remounted on every tab switch (`key={activeTab.id}`
 * in Workbench, so local component state can't leak between tabs), which used
 * to reset the sub-tab to its default each time. Keeping the choice here, keyed
 * by tab id and then by a per-editor `scope`, survives that remount.
 *
 * In memory only — nothing here is persisted. `tabs.store` drops a tab's entry
 * when the tab is closed (or a clean preview slot is replaced), so a re-opened
 * request starts on the default sub-tab again.
 */
interface TabSubTabStore {
  /** tabId → scope → selected sub-tab key. */
  byTab: Record<string, Record<string, string>>
  setSubTab: (tabId: string, scope: string, key: string) => void
  /** Forget every remembered sub-tab of the given tabs. */
  clearTabs: (tabIds: readonly string[]) => void
}

export const useTabSubTabStore = create<TabSubTabStore>((set) => ({
  byTab: {},

  setSubTab: (tabId, scope, key) =>
    set((s) => {
      if (s.byTab[tabId]?.[scope] === key) return s
      return { byTab: { ...s.byTab, [tabId]: { ...s.byTab[tabId], [scope]: key } } }
    }),

  clearTabs: (tabIds) =>
    set((s) => {
      if (!tabIds.some((id) => id in s.byTab)) return s
      const next = { ...s.byTab }
      for (const id of tabIds) delete next[id]
      return { byTab: next }
    }),
}))
