import { create } from 'zustand'
import type { ApiResponse } from '../types'

// ─────────────────────────────────────────────────────────────
// Postman-style detailed console log model.
//
// A single ConsoleLogEntry represents one observable network event:
//   - HTTP/SOAP/GraphQL request+response cycle (one entry)
//   - WebSocket connect / disconnect / message-sent / message-received
//     (each one is its own entry)
//   - gRPC unary call (one entry); each streamed chunk an extra entry
//   - SSE connect / event / error / disconnect (each its own entry)
//
// The renderer accumulates these in a rolling buffer (FIFO, MAX_ENTRIES)
// and renders them with virtualization so a busy session does not
// degrade UI performance.
// ─────────────────────────────────────────────────────────────

export type ConsoleProtocol =
  | 'http'
  | 'soap'
  | 'grpc'
  | 'websocket'
  | 'graphql'
  | 'sse'
  | 'mcp'
  | 'socketio'
  | 'ai'

export type ConsoleLevel = 'info' | 'success' | 'warning' | 'error'
export type ConsoleCategory = 'request' | 'response' | 'event' | 'connection' | 'system'

export interface ConsoleLogDirection {
  /** 'in' = received from server, 'out' = sent to server */
  direction?: 'in' | 'out'
  eventName?: string
}

export interface ConsoleLogDetails extends ConsoleLogDirection {
  requestHeaders?: Record<string, string>
  requestBody?: string
  responseHeaders?: Record<string, string>
  responseBody?: string
  error?: { message: string; stack?: string }
  /** Free-form metadata (e.g. gRPC metadata, WS protocols) */
  meta?: Record<string, string | number | boolean>
}

export interface ConsoleLogEntry {
  id: string
  timestamp: number
  protocol: ConsoleProtocol
  level: ConsoleLevel
  category: ConsoleCategory
  /** Renderer tab the event was triggered from (if known). */
  tabId?: string

  // Request fields
  method?: string
  url?: string

  // Response fields
  status?: number
  statusText?: string
  durationMs?: number
  sizeBytes?: number

  /** Short single-line message used as the row's primary label. */
  message?: string

  /** Detailed body — collapsed by default, lazy-rendered. */
  details?: ConsoleLogDetails

  // ── Legacy / script log support ─────────────────────────────
  /** pre-/post-response script logs (kept for back-compat). */
  scriptLogs?: Array<{
    level: 'log' | 'warn' | 'error'
    message: string
    timestamp: number
  }>
}

/**
 * Back-compat alias for older code paths that imported `ConsoleEntry`.
 * Same shape as `ConsoleLogEntry`.
 */
export type ConsoleEntry = ConsoleLogEntry

export type ConsoleLogFilter =
  | 'all'
  | 'network'
  | 'log'
  | 'warn'
  | 'error'
  // Protocol-specific
  | 'http'
  | 'websocket'
  | 'grpc'
  | 'graphql'
  | 'soap'
  | 'sse'
  | 'mcp'
  | 'socketio'
  | 'ai'

interface ConsoleStore {
  entries: ConsoleLogEntry[]
  filter: ConsoleLogFilter
  searchTerm: string
  expandedIds: Set<string>
  isOnline: boolean
  /** When set, ConsoleTab uses this to filter to a single tab's entries. */
  activeTabIdFilter: string | null
  /** When true, list auto-scrolls to newest entry. */
  autoScroll: boolean

  addEntry: (
    entry: Omit<ConsoleLogEntry, 'id' | 'timestamp'> & {
      id?: string
      timestamp?: number
    },
  ) => void
  /** Convenience: push an entry from a just-completed ApiResponse. */
  addFromResponse: (
    req: {
      method: string
      url: string
      headers?: Record<string, string>
      body?: string
      tabId?: string
      protocol?: ConsoleProtocol
    },
    res: ApiResponse,
  ) => void
  clear: () => void
  setFilter: (f: ConsoleLogFilter) => void
  setSearchTerm: (s: string) => void
  toggleExpanded: (id: string) => void
  setOnline: (online: boolean) => void
  setActiveTabIdFilter: (tabId: string | null) => void
  setAutoScroll: (v: boolean) => void
}

const MAX_ENTRIES = 1000

function makeId(): string {
  return `ce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// (levelFromStatus moved to main/lib/console-logger.ts; renderer adds
// pre-classified entries that already carry a level, so a duplicate
// implementation is no longer needed here.)

export const useConsoleStore = create<ConsoleStore>((set) => ({
  entries: [],
  filter: 'all',
  searchTerm: '',
  expandedIds: new Set(),
  isOnline: true,
  activeTabIdFilter: null,
  autoScroll: true,

  addEntry: (entry) =>
    set((state) => {
      const newEntry: ConsoleLogEntry = {
        id: entry.id || makeId(),
        timestamp: entry.timestamp || Date.now(),
        protocol: entry.protocol,
        level: entry.level,
        category: entry.category,
        tabId: entry.tabId,
        method: entry.method,
        url: entry.url,
        status: entry.status,
        statusText: entry.statusText,
        durationMs: entry.durationMs,
        sizeBytes: entry.sizeBytes,
        message: entry.message,
        details: entry.details,
        scriptLogs: entry.scriptLogs,
      }
      const next =
        state.entries.length >= MAX_ENTRIES
          ? [...state.entries.slice(state.entries.length - MAX_ENTRIES + 1), newEntry]
          : [...state.entries, newEntry]
      return { entries: next }
    }),

  /**
   * Convenience used by `request.store.ts`. The main process already
   * broadcasts a `console:log` response entry; this method only adds a
   * supplementary "script logs" entry (when pre-/post-request scripts
   * produced any output) so that information — which never reaches
   * main — is still surfaced to the user.
   */
  addFromResponse: (req, res) =>
    set((state) => {
      if (!res.consoleLogs || res.consoleLogs.length === 0) {
        return { entries: state.entries }
      }
      const protocol: ConsoleProtocol =
        req.protocol ?? (res.protocol as ConsoleProtocol | undefined) ?? 'http'
      const entry: ConsoleLogEntry = {
        id: makeId(),
        timestamp: Date.now(),
        protocol,
        level: 'info',
        category: 'system',
        tabId: req.tabId,
        method: req.method,
        url: req.url,
        message: `Script logs (${res.consoleLogs.length}) — ${req.method} ${req.url}`,
        scriptLogs: res.consoleLogs.map((l) => ({
          level: l.level,
          message: l.message,
          timestamp: l.timestamp,
        })),
      }
      const next =
        state.entries.length >= MAX_ENTRIES
          ? [...state.entries.slice(state.entries.length - MAX_ENTRIES + 1), entry]
          : [...state.entries, entry]
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
  setActiveTabIdFilter: (tabId) => set({ activeTabIdFilter: tabId }),
  setAutoScroll: (v) => set({ autoScroll: v }),
}))

// ─── Selectors ────────────────────────────────────────────────

/**
 * Apply protocol/level + free-text filtering to the entries list.
 * Pure function so it can be unit-tested in isolation.
 */
export function selectFilteredEntries(
  entries: ConsoleLogEntry[],
  opts: {
    filter: ConsoleLogFilter
    searchTerm: string
    activeTabIdFilter?: string | null
  },
): ConsoleLogEntry[] {
  const { filter, searchTerm, activeTabIdFilter } = opts
  let list = entries

  if (activeTabIdFilter) {
    list = list.filter((e) => e.tabId === activeTabIdFilter)
  }

  switch (filter) {
    case 'error':
      list = list.filter((e) => e.level === 'error' || (e.status != null && e.status >= 400))
      break
    case 'warn':
      list = list.filter(
        (e) => e.level === 'warning' || (e.status != null && e.status >= 300 && e.status < 400),
      )
      break
    case 'http':
    case 'websocket':
    case 'grpc':
    case 'graphql':
    case 'soap':
    case 'sse':
    case 'mcp':
    case 'socketio':
    case 'ai':
      list = list.filter((e) => e.protocol === filter)
      break
    case 'log':
    case 'network':
    case 'all':
    default:
      // no extra filter
      break
  }

  if (searchTerm.trim()) {
    const q = searchTerm.toLowerCase()
    list = list.filter((e) => {
      const haystack = [
        e.method,
        e.url,
        e.message,
        e.details?.requestBody,
        e.details?.responseBody,
        e.details?.eventName,
      ]
        .filter((v) => typeof v === 'string')
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }

  return list
}

// ─── IPC bootstrap ────────────────────────────────────────────

interface ConsoleApi {
  onLog?: (cb: (entry: unknown) => void) => () => void
}

interface WindowApi {
  console?: ConsoleApi
  ws?: { onEvent?: (cb: (event: unknown) => void) => () => void }
  sse?: { onEvent?: (cb: (event: unknown) => void) => () => void }
  grpc?: { onStreamEvent?: (cb: (event: unknown) => void) => () => void }
  graphql?: { onSubscriptionEvent?: (cb: (event: unknown) => void) => () => void }
}

interface WsEventPayload {
  connectionId?: string
  type?: 'open' | 'message' | 'close' | 'error'
  data?: string
  code?: number
  reason?: string
  contentType?: 'text' | 'json' | 'binary'
}

interface SseEventPayload {
  connectionId?: string
  type?: 'open' | 'event' | 'error'
  eventType?: string
  data?: string
  id?: string
}

interface GrpcStreamEventPayload {
  streamId?: string
  type?: 'data' | 'end' | 'error' | 'status'
  data?: string
  error?: string
  grpcStatus?: number
  grpcStatusMessage?: string
}

interface GraphqlSubscriptionEventPayload {
  subscriptionId?: string
  type?: 'data' | 'error' | 'complete'
  data?: string
  error?: string
}

/**
 * Wire up the renderer to receive `console:log` entries from main and to
 * mirror real-time event streams (WS messages, SSE events, gRPC stream
 * chunks, GraphQL subscriptions) into the console store.
 *
 * Returns a teardown function that removes every listener — call it in
 * the App effect cleanup.
 */
export function initConsoleListeners(): () => void {
  const api: WindowApi | undefined =
    typeof window !== 'undefined' ? (window as unknown as { api?: WindowApi }).api : undefined
  const cleanups: Array<() => void> = []
  if (!api) return () => {}

  // 1) Direct console:log feed
  if (api.console?.onLog) {
    cleanups.push(
      api.console.onLog((data: unknown) => {
        const entry = data as Partial<ConsoleLogEntry>
        if (!entry || !entry.protocol) return
        useConsoleStore.getState().addEntry({
          id: entry.id,
          timestamp: entry.timestamp,
          protocol: entry.protocol,
          level: entry.level ?? 'info',
          category: entry.category ?? 'system',
          tabId: entry.tabId,
          method: entry.method,
          url: entry.url,
          status: entry.status,
          statusText: entry.statusText,
          durationMs: entry.durationMs,
          sizeBytes: entry.sizeBytes,
          message: entry.message,
          details: entry.details,
        })
      }),
    )
  }

  // 2) WebSocket events: pipe inbound messages, open/close/error to console
  if (api.ws?.onEvent) {
    cleanups.push(
      api.ws.onEvent((data: unknown) => {
        const ev = data as WsEventPayload
        if (!ev || !ev.type) return
        const add = useConsoleStore.getState().addEntry
        if (ev.type === 'message') {
          add({
            protocol: 'websocket',
            level: 'info',
            category: 'event',
            message: `WS ← ${truncate(ev.data ?? '', 80)}`,
            details: {
              direction: 'in',
              eventName: ev.contentType,
              responseBody: ev.data,
            },
          })
        }
        // Note: 'open'/'close'/'error' are already logged from main
        // (ws.handler.ts) so we skip them here to avoid duplicates.
      }),
    )
  }

  // 3) SSE events
  if (api.sse?.onEvent) {
    cleanups.push(
      api.sse.onEvent((data: unknown) => {
        const ev = data as SseEventPayload
        if (!ev || !ev.type) return
        const add = useConsoleStore.getState().addEntry
        if (ev.type === 'event') {
          add({
            protocol: 'sse',
            level: 'info',
            category: 'event',
            message: `SSE event ${ev.eventType ?? 'message'}${ev.id ? ` #${ev.id}` : ''}`,
            details: {
              direction: 'in',
              eventName: ev.eventType,
              responseBody: ev.data,
            },
          })
        } else if (ev.type === 'error') {
          add({
            protocol: 'sse',
            level: 'error',
            category: 'event',
            message: 'SSE error',
            details: { error: { message: ev.data ?? 'SSE error' } },
          })
        }
      }),
    )
  }

  // 4) gRPC stream events
  if (api.grpc?.onStreamEvent) {
    cleanups.push(
      api.grpc.onStreamEvent((data: unknown) => {
        const ev = data as GrpcStreamEventPayload
        if (!ev || !ev.type) return
        const add = useConsoleStore.getState().addEntry
        if (ev.type === 'data') {
          add({
            protocol: 'grpc',
            level: 'info',
            category: 'event',
            message: `gRPC chunk: ${truncate(ev.data ?? '', 80)}`,
            details: { direction: 'in', responseBody: ev.data },
          })
        } else if (ev.type === 'end') {
          add({
            protocol: 'grpc',
            level: 'success',
            category: 'event',
            message: 'gRPC stream ended',
          })
        } else if (ev.type === 'error') {
          add({
            protocol: 'grpc',
            level: 'error',
            category: 'event',
            message: ev.error || 'gRPC stream error',
            status: ev.grpcStatus,
            details: { error: { message: ev.error || 'gRPC stream error' } },
          })
        } else if (ev.type === 'status') {
          add({
            protocol: 'grpc',
            level: ev.grpcStatus === 0 ? 'success' : 'warning',
            category: 'event',
            message: `gRPC status: ${ev.grpcStatusMessage ?? ev.grpcStatus}`,
            status: ev.grpcStatus,
          })
        }
      }),
    )
  }

  // 5) GraphQL subscription events
  if (api.graphql?.onSubscriptionEvent) {
    cleanups.push(
      api.graphql.onSubscriptionEvent((data: unknown) => {
        const ev = data as GraphqlSubscriptionEventPayload
        if (!ev || !ev.type) return
        const add = useConsoleStore.getState().addEntry
        if (ev.type === 'data') {
          add({
            protocol: 'graphql',
            level: 'info',
            category: 'event',
            message: `GraphQL sub ← ${truncate(ev.data ?? '', 80)}`,
            details: { direction: 'in', responseBody: ev.data },
          })
        } else if (ev.type === 'error') {
          add({
            protocol: 'graphql',
            level: 'error',
            category: 'event',
            message: ev.error || 'GraphQL subscription error',
            details: { error: { message: ev.error || 'GraphQL subscription error' } },
          })
        } else if (ev.type === 'complete') {
          add({
            protocol: 'graphql',
            level: 'info',
            category: 'event',
            message: 'GraphQL subscription complete',
          })
        }
      }),
    )
  }

  // 6) Socket.IO events
  if (
    (api as unknown as Record<string, { onEvent?: (cb: (e: unknown) => void) => () => void }>)
      .socketio?.onEvent
  ) {
    const sioApi = (
      api as unknown as Record<string, { onEvent: (cb: (e: unknown) => void) => () => void }>
    ).socketio
    cleanups.push(
      sioApi.onEvent((data: unknown) => {
        const ev = data as {
          direction?: string
          event?: string
          data?: unknown
          connectionId?: string
        }
        if (!ev || !ev.event) return
        const add = useConsoleStore.getState().addEntry
        add({
          protocol: 'socketio',
          level: 'info',
          category: 'event',
          message: `Socket.IO ${ev.direction === 'in' ? '←' : '→'} ${ev.event}: ${truncate(JSON.stringify(ev.data), 80)}`,
          details: {
            direction: ev.direction === 'in' ? 'in' : 'out',
            eventName: ev.event,
            responseBody: JSON.stringify(ev.data),
          },
        })
      }),
    )
  }

  return () => {
    for (const c of cleanups) {
      try {
        c()
      } catch {
        // ignore
      }
    }
  }
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}
