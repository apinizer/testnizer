import { create } from 'zustand'
import type { HistoryEntry } from '../types'

/**
 * History store — hydrates the list of recent requests from `history:list`.
 * Unlike the in-session Console store, this persists across app restarts and
 * is scoped by project.
 */
interface HistoryStore {
  entries: HistoryEntry[]
  isLoading: boolean
  searchTerm: string

  fetch: (options?: { workspaceId?: string; projectId?: string; limit?: number }) => Promise<void>
  clear: (workspaceId?: string) => Promise<void>
  deleteEntry: (id: string) => Promise<void>
  setSearchTerm: (term: string) => void
}

interface HistoryRow {
  id: string
  workspace_id?: string | null
  project_id?: string | null
  endpoint_id?: string | null
  protocol: string
  method?: string | null
  url: string
  status_code?: number | null
  duration_ms?: number | null
  request_snapshot: string
  response_snapshot?: string | null
  executed_at: number
}

function rowToEntry(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    workspace_id: row.workspace_id ?? undefined,
    project_id: row.project_id ?? undefined,
    endpoint_id: row.endpoint_id ?? undefined,
    protocol: row.protocol as HistoryEntry['protocol'],
    method: row.method ?? undefined,
    url: row.url,
    status_code: row.status_code ?? undefined,
    duration_ms: row.duration_ms ?? undefined,
    request_snapshot: row.request_snapshot ? JSON.parse(row.request_snapshot) : {},
    response_snapshot: row.response_snapshot ? JSON.parse(row.response_snapshot) : undefined,
    executed_at: row.executed_at,
  }
}

export const useHistoryStore = create<HistoryStore>((set) => ({
  entries: [],
  isLoading: false,
  searchTerm: '',

  fetch: async (options = {}) => {
    set({ isLoading: true })
    try {
      const result = (await window.api?.history?.list({
        workspace_id: options.workspaceId,
        project_id: options.projectId,
        limit: options.limit ?? 200,
      })) as { success: boolean; data?: HistoryRow[] }
      if (result?.success && result.data) {
        set({ entries: result.data.map(rowToEntry) })
      }
    } catch {
      // ignore — empty list
    } finally {
      set({ isLoading: false })
    }
  },

  clear: async (workspaceId) => {
    try {
      await window.api?.history?.clear(workspaceId)
      set({ entries: [] })
    } catch {
      /* ignore */
    }
  },

  deleteEntry: async (id) => {
    try {
      await window.api?.history?.delete(id)
      set((state) => ({ entries: state.entries.filter((e) => e.id !== id) }))
    } catch {
      /* ignore */
    }
  },

  setSearchTerm: (term) => set({ searchTerm: term }),
}))
