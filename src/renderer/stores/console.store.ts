import { create } from 'zustand'
import type { ApiResponse } from '../types'
import { HISTORY_MASK } from '../../shared/credential-headers'

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
  /**
   * Per-session "Show secrets" (issue #196) — mirrors main's flag, which is
   * the source of truth (main masks every entry before sending it). Never
   * persisted: off on every app start.
   */
  showSecrets: boolean

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
  /** Ask main to stop / resume masking NEW entries for this session. */
  setShowSecrets: (on: boolean) => Promise<void>
  /** Read main's flag (a renderer reload must not show a stale toggle). */
  syncShowSecrets: () => Promise<void>
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
  showSecrets: false,

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
  addFromResponse: (req, res) => {
    if (!res.consoleLogs || res.consoleLogs.length === 0) return
    const protocol: ConsoleProtocol =
      req.protocol ?? (res.protocol as ConsoleProtocol | undefined) ?? 'http'
    addMaskedEntry({
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
    })
  },

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
  setShowSecrets: async (on) => {
    try {
      const res = (await window.api?.console?.setShowSecrets?.(on)) as
        | { success: boolean; data?: boolean }
        | undefined
      // Reflect what main actually holds — a failed call leaves masking on.
      set({ showSecrets: res?.success === true && res.data === true })
    } catch {
      set({ showSecrets: false })
    }
  },
  syncShowSecrets: async () => {
    try {
      const res = (await window.api?.console?.getShowSecrets?.()) as
        | { success: boolean; data?: boolean }
        | undefined
      set({ showSecrets: res?.success === true && res.data === true })
    } catch {
      /* keep the current (masked) state */
    }
  },
}))

// ─── Masked add (issue #196) ──────────────────────────────────

type NewConsoleEntry = Parameters<ConsoleStore['addEntry']>[0]

/**
 * Add an entry the RENDERER built — Send-path script `console.*` output,
 * which never passes through main — masked by main's helper (`console:maskEntry`)
 * exactly like every entry main emits, so `console.log(pm.environment.get(
 * 'token'))` reads the same on Send as on Run. While "Show secrets" is on main
 * returns it unchanged. If the call fails the script lines are hidden rather
 * than shown raw; without a bridge (unit tests, storybook) it is added as is.
 */
export function addMaskedEntry(
  entry: NewConsoleEntry,
  /**
   * Derive display text (the 80-char message preview) from the MASKED entry —
   * truncating before masking could cut a secret in half and leave a fragment
   * the mask no longer recognises (issue #196).
   */
  finalize: (masked: NewConsoleEntry) => NewConsoleEntry = (m) => m,
): void {
  const add = (e: NewConsoleEntry): void => useConsoleStore.getState().addEntry(finalize(e))
  const mask = typeof window !== 'undefined' ? window.api?.console?.maskEntry : undefined
  if (!mask) {
    add(entry)
    return
  }
  void mask(entry)
    .then((res) => {
      const r = res as { success?: boolean; data?: NewConsoleEntry } | undefined
      add(r?.success && r.data ? r.data : hiddenConsoleEntry(entry))
    })
    .catch(() => add(hiddenConsoleEntry(entry)))
}

const hideHeaderValues = (
  h: Record<string, string> | undefined,
): Record<string, string> | undefined =>
  h ? Object.fromEntries(Object.keys(h).map((k) => [k, HISTORY_MASK])) : h

/**
 * The entry shown when main's mask call fails: every free-text part hidden
 * rather than shown raw — message, URL, status text, event name, bodies,
 * error, script lines, and header VALUES (names stay, they are not secret).
 */
export function hiddenConsoleEntry(entry: NewConsoleEntry): NewConsoleEntry {
  return {
    ...entry,
    ...(entry.message !== undefined ? { message: HISTORY_MASK } : {}),
    ...(entry.url !== undefined ? { url: HISTORY_MASK } : {}),
    ...(entry.statusText !== undefined ? { statusText: HISTORY_MASK } : {}),
    details: entry.details
      ? {
          ...entry.details,
          ...(entry.details.requestBody !== undefined ? { requestBody: HISTORY_MASK } : {}),
          ...(entry.details.responseBody !== undefined ? { responseBody: HISTORY_MASK } : {}),
          ...(entry.details.error ? { error: { message: HISTORY_MASK } } : {}),
          ...(entry.details.eventName !== undefined ? { eventName: HISTORY_MASK } : {}),
          requestHeaders: hideHeaderValues(entry.details.requestHeaders),
          responseHeaders: hideHeaderValues(entry.details.responseHeaders),
        }
      : entry.details,
    scriptLogs: entry.scriptLogs?.map((l) => ({ ...l, message: HISTORY_MASK })),
  }
}

/** The 80-char preview line for a stream entry, built from its (masked) body. */
const withPreview =
  (prefix: string, field: 'requestBody' | 'responseBody' = 'responseBody') =>
  (m: NewConsoleEntry): NewConsoleEntry => ({
    ...m,
    message: `${prefix}${truncate(m.details?.[field] ?? '', 80)}`,
  })

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

/**
 * Wire up the renderer to receive `console:log` entries from main and to
 * mirror real-time event streams (WS messages, SSE events, gRPC stream
 * chunks, GraphQL subscriptions) into the console store.
 *
 * Returns a teardown function that removes every listener — call it in
 * the App effect cleanup.
 */
export function initConsoleListeners(): () => void {
  const api = typeof window !== 'undefined' ? window.api : undefined
  const cleanups: Array<() => void> = []
  if (!api) return () => {}

  // 1) Direct console:log feed
  if (api.console?.onLog) {
    cleanups.push(
      api.console.onLog((entry) => {
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
      api.ws.onEvent((ev) => {
        if (!ev || !ev.type) return
        // Stream data never passes through main's Console logger — masked
        // through it here (issue #196).
        const add = addMaskedEntry
        if (ev.type === 'message') {
          add(
            {
              protocol: 'websocket',
              level: 'info',
              category: 'event',
              message: 'WS ←',
              sizeBytes: ev.data != null ? byteLengthUtf8(ev.data) : undefined,
              details: {
                direction: 'in',
                eventName: ev.contentType,
                responseBody: ev.data,
              },
            },
            withPreview('WS ← '),
          )
        }
        // Note: 'open'/'close'/'error' are already logged from main
        // (ws.handler.ts) so we skip them here to avoid duplicates.
      }),
    )
  }

  // 3) SSE events
  if (api.sse?.onEvent) {
    cleanups.push(
      api.sse.onEvent((ev) => {
        if (!ev || !ev.type) return
        // Stream data never passes through main's Console logger — masked
        // through it here (issue #196).
        const add = addMaskedEntry
        if (ev.type === 'event') {
          add({
            protocol: 'sse',
            level: 'info',
            category: 'event',
            message: `SSE event ${ev.eventType ?? 'message'}${ev.id ? ` #${ev.id}` : ''}`,
            sizeBytes: ev.data != null ? byteLengthUtf8(ev.data) : undefined,
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
      api.grpc.onStreamEvent((ev) => {
        if (!ev || !ev.type) return
        // Stream data never passes through main's Console logger — masked
        // through it here (issue #196).
        const add = addMaskedEntry
        if (ev.type === 'data') {
          add(
            {
              protocol: 'grpc',
              level: 'info',
              category: 'event',
              message: 'gRPC chunk:',
              sizeBytes: ev.data != null ? byteLengthUtf8(ev.data) : undefined,
              details: { direction: 'in', responseBody: ev.data },
            },
            withPreview('gRPC chunk: '),
          )
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
      api.graphql.onSubscriptionEvent((ev) => {
        if (!ev || !ev.type) return
        // Stream data never passes through main's Console logger — masked
        // through it here (issue #196).
        const add = addMaskedEntry
        if (ev.type === 'data') {
          add(
            {
              protocol: 'graphql',
              level: 'info',
              category: 'event',
              message: 'GraphQL sub ←',
              details: { direction: 'in', responseBody: ev.data },
            },
            withPreview('GraphQL sub ← '),
          )
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
  if (api.socketio?.onEvent) {
    cleanups.push(
      api.socketio.onEvent((ev) => {
        if (!ev || !ev.event) return
        // Stream data never passes through main's Console logger — masked
        // through it here (issue #196).
        const add = addMaskedEntry
        const payload = JSON.stringify(ev.data)
        add(
          {
            protocol: 'socketio',
            level: 'info',
            category: 'event',
            message: `Socket.IO ${ev.direction === 'in' ? '←' : '→'} ${ev.event}:`,
            sizeBytes: payload != null ? byteLengthUtf8(payload) : undefined,
            details: {
              direction: ev.direction === 'in' ? 'in' : 'out',
              eventName: ev.event,
              responseBody: payload,
            },
          },
          // Prefix from the MASKED entry: the event name is masked too.
          (m) => ({
            ...m,
            message: `Socket.IO ${ev.direction === 'in' ? '←' : '→'} ${m.details?.eventName ?? ''}: ${truncate(m.details?.responseBody ?? '', 80)}`,
          }),
        )
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

function byteLengthUtf8(s: string): number {
  // Renderer-side equivalent of Buffer.byteLength(s, 'utf-8'). TextEncoder is
  // a Web standard available in Electron renderer windows.
  try {
    return new TextEncoder().encode(s).length
  } catch {
    return s.length
  }
}
