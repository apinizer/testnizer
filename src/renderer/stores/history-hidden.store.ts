import { create } from 'zustand'

/**
 * Per-tab list of credentials a History reopen had to leave EMPTY (issue #195):
 * main never stores a literal credential, so the restored request has a blank
 * where it was. `HistoryHiddenNote` shows the list — the HTTP / SOAP /
 * WebSocket / gRPC / GraphQL / SSE / Socket.IO twin of MCP's `hiddenArgs`.
 * In memory only.
 */
interface HistoryHiddenStore {
  byTab: Record<string, string[]>
  setHidden: (tabId: string, hidden: string[]) => void
  clear: (tabId: string) => void
}

export const useHistoryHiddenStore = create<HistoryHiddenStore>((set) => ({
  byTab: {},
  setHidden: (tabId, hidden) =>
    set((s) => {
      const next = { ...s.byTab }
      if (hidden.length > 0) next[tabId] = [...new Set(hidden)]
      else delete next[tabId]
      return { byTab: next }
    }),
  clear: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s
      const next = { ...s.byTab }
      delete next[tabId]
      return { byTab: next }
    }),
}))
