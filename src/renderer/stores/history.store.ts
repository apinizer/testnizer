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
export type HistoryRange = 'all' | 'today' | '7d' | '30d'
/**
 * Status filter. `ok` / `failed` work for every protocol (the row colour's
 * rule); the HTTP classes only for protocols that answer with an HTTP code.
 */
export type HistoryStatusClass = '' | 'ok' | 'failed' | '2xx' | '3xx' | '4xx' | '5xx'
/** '' = every request; `mock` = sent to one of the project's mock servers. */
export type HistoryTarget = '' | 'mock' | 'notMock'

/** Protocols whose History status is an HTTP code (gRPC, WS, MQTT… are not). */
export const HTTP_STATUS_PROTOCOLS: readonly string[] = ['http', 'graphql', 'soap']

const HTTP_CLASSES: readonly HistoryStatusClass[] = ['2xx', '3xx', '4xx', '5xx']

/** HTTP status classes are offered only with an HTTP-like protocol picked. */
export function httpStatusClassesApply(protocol: string | null): boolean {
  return protocol !== null && HTTP_STATUS_PROTOCOLS.includes(protocol)
}

/**
 * The History page's filters — ONE set shared by the sidebar list and the
 * workbench overview (HistoryHome), so both always show the same rows. The
 * rules that apply them live in `components/history/history-overview.ts`.
 */
export interface HistoryFilters {
  /** null = every protocol ("All" card). */
  protocol: string | null
  range: HistoryRange
  /** '' = every method (overview only; the sidebar search matches methods). */
  method: string
  status: HistoryStatusClass
  target: HistoryTarget
  query: string
}

export const EMPTY_FILTERS: HistoryFilters = {
  protocol: null,
  range: 'all',
  method: '',
  status: '',
  target: '',
  query: '',
}

interface HistoryStore {
  entries: HistoryEntry[]
  isLoading: boolean
  filters: HistoryFilters

  fetch: (options?: { workspaceId?: string; projectId?: string; limit?: number }) => Promise<void>
  /**
   * Delete one PROJECT's history — what the History list shows and what
   * Settings → Data clears (one scope for both). Resolves `{ok:false, error}`
   * when the bridge refused; the rows then stay listed (the truth).
   */
  clear: (projectId: string) => Promise<{ ok: boolean; error?: string }>
  /**
   * How many rows `clear(projectId)` would delete — main counts with the
   * delete's own scope rule. `null` = unknown (the bridge refused / failed).
   */
  count: (projectId: string) => Promise<number | null>
  deleteEntry: (id: string) => Promise<void>
  setFilters: (patch: Partial<HistoryFilters>) => void
  resetFilters: () => void
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

/**
 * How many rows the History page loads: the sidebar list and the page's
 * overview (cards, filters, table) both work on these. Matches the default
 * `historyLimit` setting (500).
 */
export const HISTORY_LIST_LIMIT = 500

export const useHistoryStore = create<HistoryStore>((set) => ({
  entries: [],
  isLoading: false,
  filters: EMPTY_FILTERS,

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

  clear: async (projectId) => {
    // `{success:false}` is how the bridge reports failure — it resolves rather
    // than throwing, so the old try/catch let a refused clear empty the list on
    // screen while every row was still in the database.
    let res: { success?: boolean; error?: string } | undefined
    try {
      res = (await window.api?.history?.clear({ project_id: projectId })) as typeof res
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
    if (res && res.success === false) return { ok: false, error: res.error }
    set((state) => ({ entries: state.entries.filter((e) => e.project_id !== projectId) }))
    return { ok: true }
  },

  count: async (projectId) => {
    try {
      const res = (await window.api?.history?.count?.({ project_id: projectId })) as
        | { success?: boolean; data?: unknown }
        | undefined
      return res?.success && typeof res.data === 'number' ? res.data : null
    } catch {
      return null
    }
  },

  deleteEntry: async (id) => {
    if (!(await deleted(window.api?.history?.delete(id)))) return
    set((state) => ({ entries: state.entries.filter((e) => e.id !== id) }))
  },

  setFilters: (patch) =>
    set((s) => {
      const next = { ...s.filters, ...patch }
      // "4xx" means nothing once the protocol is gRPC / WebSocket / All.
      if (HTTP_CLASSES.includes(next.status) && !httpStatusClassesApply(next.protocol)) {
        next.status = ''
      }
      return { filters: next }
    }),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),
}))
