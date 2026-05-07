import { create } from 'zustand'
import type { KeyValuePair, SseEvent } from '../types'
import { useEnvironmentStore } from './environment.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { makeId } from '../lib/utils'

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export type SseHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type SseBodyType = 'json' | 'text'

/** Shape of payloads emitted by the main process on the `sse:event` channel. */
interface SsePayload {
  connectionId: string
  type: 'open' | 'event' | 'error'
  eventType?: string
  data?: string
  id?: string
  retry?: number
  /** Present on `error` payloads when the SSE handshake returned an HTTP status. */
  httpStatus?: number
  timestamp: number
}

interface SseApi {
  connect: (options: {
    url: string
    headers?: Record<string, string>
    lastEventId?: string
    withCredentials?: boolean
    method?: SseHttpMethod
    body?: string
  }) => Promise<{
    success: boolean
    data?: { connectionId: string }
    error?: string
  }>
  disconnect: (
    connectionId: string,
  ) => Promise<{ success: boolean; data?: boolean; error?: string }>
  onEvent: (cb: (event: SsePayload) => void) => () => void
}

function getSseApi(): SseApi | undefined {
  const w = window as unknown as { api?: { sse?: SseApi } }
  return w.api?.sse
}

/** Snapshot of SSE state for per-tab caching. */
interface TabSseState {
  url: string
  method: SseHttpMethod
  body: string
  bodyType: SseBodyType
  customHeaders: KeyValuePair[]
  lastEventId: string
  eventTypeFilter: string
  autoScroll: boolean
  connectionId: string | null
  connectionState: ConnectionState
  errorMessage: string | null
  events: SseEvent[]
  connectedAt: number | null
  /** Per-tab subscription returned by `sse.onEvent`. */
  _unsubscribe?: () => void
}

interface SseStore extends TabSseState {
  /** Per-tab state cache */
  _tabStates: Map<string, TabSseState>
  _currentTabId: string | null

  setUrl: (url: string) => void
  setMethod: (method: SseHttpMethod) => void
  setBody: (body: string) => void
  setBodyType: (bodyType: SseBodyType) => void
  setLastEventId: (id: string) => void
  setEventTypeFilter: (filter: string) => void
  setAutoScroll: (auto: boolean) => void

  connect: () => Promise<void>
  disconnect: () => Promise<void>
  reconnect: () => Promise<void>
  clearEvents: () => void

  addHeader: () => void
  updateHeader: (id: string, updates: Partial<KeyValuePair>) => void
  removeHeader: (id: string) => void

  addEvent: (event: SseEvent) => void
  setConnectionState: (state: ConnectionState) => void
  setErrorMessage: (msg: string | null) => void

  getFilteredEvents: () => SseEvent[]
  getEventTypes: () => string[]

  /** Switch active tab — saves current state and loads target tab state. */
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab. Tears down its `_unsubscribe`. */
  removeTabState: (tabId: string) => void

  reset: () => void
}

function emptyTabState(): TabSseState {
  return {
    url: 'https://stream.wikimedia.org/v2/stream/recentchange',
    method: 'GET',
    body: '',
    bodyType: 'json',
    customHeaders: [defaultKv()],
    lastEventId: '',
    eventTypeFilter: '',
    autoScroll: true,
    connectionId: null,
    connectionState: 'disconnected',
    errorMessage: null,
    events: [],
    connectedAt: null,
    _unsubscribe: undefined,
  }
}

function extractState(s: SseStore): TabSseState {
  return {
    url: s.url,
    method: s.method,
    body: s.body,
    bodyType: s.bodyType,
    customHeaders: s.customHeaders,
    lastEventId: s.lastEventId,
    eventTypeFilter: s.eventTypeFilter,
    autoScroll: s.autoScroll,
    connectionId: s.connectionId,
    connectionState: s.connectionState,
    errorMessage: s.errorMessage,
    events: s.events,
    connectedAt: s.connectedAt,
    _unsubscribe: s._unsubscribe,
  }
}

const STORAGE_KEY = 'testnizer-sse'
const persisted = loadTabbedState<TabSseState>(STORAGE_KEY, emptyTabState)

export const useSseStore = create<SseStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,

  setUrl: (url) => set({ url }),
  setMethod: (method) => set({ method }),
  setBody: (body) => set({ body }),
  setBodyType: (bodyType) => set({ bodyType }),
  setLastEventId: (id) => set({ lastEventId: id }),
  setEventTypeFilter: (filter) => set({ eventTypeFilter: filter }),
  setAutoScroll: (auto) => set({ autoScroll: auto }),

  connect: async () => {
    const { url, customHeaders, lastEventId, method, body, bodyType } = get()
    if (!url.trim()) return

    set({ connectionState: 'connecting', errorMessage: null, events: [] })

    const activeVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedUrl = resolveVariables(url, activeVars)
    const resolvedLastEventId = resolveVariables(lastEventId, activeVars)
    const resolvedBody = resolveVariables(body, activeVars)
    const resolvedHeaderRows = resolveKeyValuePairs(
      customHeaders.filter((h) => h.enabled && h.key.trim()),
      activeVars,
    )
    const headerMap: Record<string, string> = {}
    for (const row of resolvedHeaderRows) headerMap[row.key] = row.value
    // For non-GET methods carrying a body, default Content-Type unless the
    // user already supplied one (case-insensitive). Mirrors what curl/Postman do.
    const sendBody = method !== 'GET' && resolvedBody.trim().length > 0
    if (sendBody) {
      const hasContentType = Object.keys(headerMap).some((k) => k.toLowerCase() === 'content-type')
      if (!hasContentType) {
        headerMap['Content-Type'] = bodyType === 'json' ? 'application/json' : 'text/plain'
      }
    }

    const sse = getSseApi()
    if (!sse) {
      set({ connectionState: 'error', errorMessage: 'SSE bridge unavailable' })
      return
    }

    // Owner tab — events for this connection always route into this tab's
    // state (live or cached), not the currently-active tab.
    const ownerTabId = get()._currentTabId

    const applyToOwner = (patch: Partial<TabSseState>): void => {
      const current = get()
      if (current._currentTabId === ownerTabId) {
        set(patch as Partial<SseStore>)
      } else if (ownerTabId !== null) {
        const map = new Map(current._tabStates)
        const existing = map.get(ownerTabId) ?? emptyTabState()
        map.set(ownerTabId, { ...existing, ...patch })
        set({ _tabStates: map })
      }
    }

    const appendEventToOwner = (event: SseEvent): void => {
      const current = get()
      if (current._currentTabId === ownerTabId) {
        set({ events: [...current.events, event] })
      } else if (ownerTabId !== null) {
        const map = new Map(current._tabStates)
        const existing = map.get(ownerTabId) ?? emptyTabState()
        map.set(ownerTabId, { ...existing, events: [...existing.events, event] })
        set({ _tabStates: map })
      }
    }

    const getOwnerConnectionState = (): ConnectionState => {
      const current = get()
      if (current._currentTabId === ownerTabId) return current.connectionState
      if (ownerTabId !== null) {
        return current._tabStates.get(ownerTabId)?.connectionState ?? 'disconnected'
      }
      return current.connectionState
    }

    const getOwnerConnectionId = (): string | null => {
      const current = get()
      if (current._currentTabId === ownerTabId) return current.connectionId
      if (ownerTabId !== null) {
        return current._tabStates.get(ownerTabId)?.connectionId ?? null
      }
      return current.connectionId
    }

    // Subscribe BEFORE awaiting connect — main fires the 'open' event from
    // inside `connect()`, attaching after would race against the event.
    const prevUnsub = get()._unsubscribe
    if (prevUnsub) prevUnsub()
    const unsub = sse.onEvent((evt) => {
      const expected = getOwnerConnectionId()
      if (expected && evt.connectionId !== expected) return

      switch (evt.type) {
        case 'open':
          applyToOwner({
            connectionState: 'connected',
            connectedAt: Date.now(),
            errorMessage: null,
          })
          break
        case 'event':
          appendEventToOwner({
            id: evt.id ?? makeId(),
            type: evt.eventType || 'message',
            data: evt.data ?? '',
            timestamp: evt.timestamp,
          })
          break
        case 'error':
          // The eventsource library reconnects automatically on transient
          // failures, so we only escalate to `error` while still connecting.
          // Once connected, we surface the error string but keep the state
          // until an explicit close/disconnect arrives.
          if (getOwnerConnectionState() !== 'connected') {
            applyToOwner({
              connectionState: 'error',
              errorMessage: evt.data || 'SSE connection error',
            })
          } else {
            applyToOwner({ errorMessage: evt.data || 'SSE error' })
          }
          break
      }
    })
    set({ _unsubscribe: unsub })

    try {
      const result = await sse.connect({
        url: resolvedUrl,
        headers: headerMap,
        lastEventId: resolvedLastEventId.trim() || undefined,
        method,
        body: sendBody ? resolvedBody : undefined,
      })
      if (result?.success && result.data) {
        const newId = result.data.connectionId
        const current = get()
        if (current._currentTabId === ownerTabId) {
          set({
            connectionId: newId,
            // Keep the state set by the 'open' event when it has already fired.
            connectionState: current.connectionState === 'connected' ? 'connected' : 'connecting',
          })
        } else if (ownerTabId !== null) {
          const map = new Map(current._tabStates)
          const existing = map.get(ownerTabId) ?? emptyTabState()
          map.set(ownerTabId, {
            ...existing,
            connectionId: newId,
            connectionState: existing.connectionState === 'connected' ? 'connected' : 'connecting',
          })
          set({ _tabStates: map })
        }
      } else {
        unsub()
        applyToOwner({
          _unsubscribe: undefined,
          connectionState: 'error',
          errorMessage: result?.error || 'SSE connection failed',
        })
      }
    } catch (e) {
      unsub()
      applyToOwner({
        _unsubscribe: undefined,
        connectionState: 'error',
        errorMessage: (e as Error).message,
      })
    }
  },

  disconnect: async () => {
    const { connectionId, _unsubscribe } = get()
    const sse = getSseApi()
    if (sse && connectionId) {
      try {
        await sse.disconnect(connectionId)
      } catch {
        // engine already cleaned up — proceed to local reset
      }
    }
    if (_unsubscribe) _unsubscribe()
    set({
      connectionState: 'disconnected',
      connectionId: null,
      _unsubscribe: undefined,
    })
  },

  reconnect: async () => {
    await get().disconnect()
    await get().connect()
  },

  clearEvents: () => set({ events: [] }),

  addHeader: () => set((state) => ({ customHeaders: [...state.customHeaders, defaultKv()] })),

  updateHeader: (id, updates) =>
    set((state) => ({
      customHeaders: state.customHeaders.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    })),

  removeHeader: (id) =>
    set((state) => ({
      customHeaders: state.customHeaders.filter((h) => h.id !== id),
    })),

  addEvent: (event) => set((state) => ({ events: [...state.events, event] })),

  setConnectionState: (connectionState) => set({ connectionState }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),

  getFilteredEvents: () => {
    const { events, eventTypeFilter } = get()
    if (!eventTypeFilter) return events
    return events.filter((e) => e.type === eventTypeFilter)
  },

  getEventTypes: () => {
    const { events } = get()
    const types = new Set(events.map((e) => e.type))
    return Array.from(types).sort()
  },

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)

    const currentKey = state._currentTabId === null ? '__null__' : state._currentTabId
    tabStates.set(currentKey, extractState(state))

    const target = tabStates.get(tabId) || emptyTabState()

    set({
      ...target,
      _tabStates: tabStates,
      _currentTabId: tabId,
    })
  },

  removeTabState: (tabId) => {
    const tabStates = new Map(get()._tabStates)
    const removed = tabStates.get(tabId)
    if (removed?._unsubscribe) {
      removed._unsubscribe()
    }
    tabStates.delete(tabId)
    set({ _tabStates: tabStates })

    if (get()._currentTabId === tabId) {
      const liveUnsub = get()._unsubscribe
      if (liveUnsub && liveUnsub !== removed?._unsubscribe) liveUnsub()
      set({ _unsubscribe: undefined })
    }
  },

  reset: () => {
    const { _unsubscribe } = get()
    if (_unsubscribe) _unsubscribe()
    set({ ...emptyTabState() })
  },
}))

attachTabbedPersist(useSseStore, STORAGE_KEY, extractState, (s) => ({
  _tabStates: s._tabStates,
  _currentTabId: s._currentTabId,
}))
