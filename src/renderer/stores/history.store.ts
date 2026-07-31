import { create } from 'zustand'
import type { HistoryEntry } from '../types'

/**
 * History store — hydrates the list of recent requests from `history:list`.
 * Unlike the in-session Console store, this persists across app restarts and
 * is scoped by project.
 */

/**
 * Did a delete actually happen? The bridge RESOLVES `{success:false, error}` on
 * failure instead of throwing, so a plain `await` inside try/catch reads every
 * refusal as success. Mirrors the helper in `environment.store.ts`; both stores
 * stay UI-agnostic, so a failure simply leaves the rows listed — the truth.
 */
async function deleted(call: Promise<unknown> | undefined): Promise<boolean> {
  try {
    const res = (await call) as { success?: boolean } | undefined
    return !(res && res.success === false)
  } catch {
    return false
  }
}
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
    // `{success:false}` is how the bridge reports failure — it resolves rather
    // than throwing, so the old try/catch let a refused clear empty the list on
    // screen while every row was still in the database.
    if (!(await deleted(window.api?.history?.clear(workspaceId)))) return
    set({ entries: [] })
  },

  deleteEntry: async (id) => {
    if (!(await deleted(window.api?.history?.delete(id)))) return
    set((state) => ({ entries: state.entries.filter((e) => e.id !== id) }))
  },

  setSearchTerm: (term) => set({ searchTerm: term }),
}))
