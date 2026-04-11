import { create } from 'zustand'
import type { ApiResponse } from '../types'

/**
 * A single console entry — one request execution (success or failure).
 * The Postman Console panel accumulates these across the session so users
 * can inspect network traffic from multiple requests at once.
 */
export interface ConsoleEntry {
  id: string
  timestamp: number
  method: string
  url: string
  status?: number
  durationMs?: number
  error?: string
  requestHeaders?: Record<string, string>
  requestBody?: string
  responseHeaders?: Record<string, string>
  responseBody?: string
  /** Script-level logs (console.log/warn/error from pre/post scripts) */
  scriptLogs?: Array<{ level: 'log' | 'warn' | 'error'; message: string; timestamp: number }>
}

export type ConsoleLogFilter = 'all' | 'network' | 'log' | 'warn' | 'error'

interface ConsoleStore {
  entries: ConsoleEntry[]
  filter: ConsoleLogFilter
  searchTerm: string
  expandedIds: Set<string>
  isOnline: boolean

  addEntry: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => void
  /** Convenience: push an entry from a just-completed ApiResponse. */
  addFromResponse: (req: { method: string; url: string; headers?: Record<string, string>; body?: string }, res: ApiResponse) => void
  clear: () => void
  setFilter: (f: ConsoleLogFilter) => void
  setSearchTerm: (s: string) => void
  toggleExpanded: (id: string) => void
  setOnline: (online: boolean) => void
}

const MAX_ENTRIES = 500

function makeId(): string {
  return `ce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const useConsoleStore = create<ConsoleStore>((set) => ({
  entries: [],
  filter: 'all',
  searchTerm: '',
  expandedIds: new Set(),
  isOnline: true,

  addEntry: (entry) =>
    set((state) => {
      const newEntry: ConsoleEntry = {
        id: entry.id || makeId(),
        timestamp: entry.timestamp || Date.now(),
        method: entry.method,
        url: entry.url,
        status: entry.status,
        durationMs: entry.durationMs,
        error: entry.error,
        requestHeaders: entry.requestHeaders,
        requestBody: entry.requestBody,
        responseHeaders: entry.responseHeaders,
        responseBody: entry.responseBody,
        scriptLogs: entry.scriptLogs,
      }
      const next = [...state.entries, newEntry]
      // Cap length
      if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES)
      return { entries: next }
    }),

  addFromResponse: (req, res) =>
    set((state) => {
      const entry: ConsoleEntry = {
        id: res.requestId || makeId(),
        timestamp: Date.now(),
        method: req.method,
        url: req.url,
        status: res.status,
        durationMs: res.timing?.total,
        error: res.error,
        requestHeaders: req.headers,
        requestBody: req.body,
        responseHeaders: res.headers,
        responseBody: res.body,
        scriptLogs: res.consoleLogs?.map((l) => ({
          level: l.level,
          message: l.message,
          timestamp: l.timestamp,
        })),
      }
      const next = [...state.entries, entry]
      if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES)
      return { entries: next }
    }),

  clear: () => set({ entries: [], expandedIds: new Set() }),
  setFilter: (f) => set({ filter: f }),
  setSearchTerm: (s) => set({ searchTerm: s }),
  toggleExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { expandedIds: next }
    }),
  setOnline: (online) => set({ isOnline: online }),
}))
