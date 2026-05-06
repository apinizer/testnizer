import { create } from 'zustand'
import type { KeyValuePair, SseEvent } from '../types'
import { useEnvironmentStore } from './environment.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'

function makeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

interface SseStore {
  url: string
  connectionState: ConnectionState
  connectionId: string | null
  errorMessage: string | null
  events: SseEvent[]
  customHeaders: KeyValuePair[]
  lastEventId: string
  eventTypeFilter: string
  autoScroll: boolean
  connectedAt: number | null

  setUrl: (url: string) => void
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

  reset: () => void
}

export const useSseStore = create<SseStore>((set, get) => ({
  url: 'https://example.com/events',
  connectionState: 'disconnected',
  connectionId: null,
  errorMessage: null,
  events: [],
  customHeaders: [defaultKv()],
  lastEventId: '',
  eventTypeFilter: '',
  autoScroll: true,
  connectedAt: null,

  setUrl: (url) => set({ url }),
  setLastEventId: (id) => set({ lastEventId: id }),
  setEventTypeFilter: (filter) => set({ eventTypeFilter: filter }),
  setAutoScroll: (auto) => set({ autoScroll: auto }),

  connect: async () => {
    const { url, customHeaders, lastEventId } = get()
    if (!url.trim()) return

    set({ connectionState: 'connecting', errorMessage: null })

    const activeVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedUrl = resolveVariables(url, activeVars)
    const resolvedLastEventId = resolveVariables(lastEventId, activeVars)
    const baseHeaders = customHeaders.filter((h) => h.enabled && h.key.trim())
    const resolvedHeaders = resolveKeyValuePairs(baseHeaders, activeVars)
    if (resolvedLastEventId.trim()) {
      resolvedHeaders.push({
        id: makeId(),
        key: 'Last-Event-ID',
        value: resolvedLastEventId,
        enabled: true,
      } as KeyValuePair)
    }

    try {
      const result = await window.api?.request?.send({
        method: 'SSE_CONNECT',
        url: resolvedUrl,
        headers: resolvedHeaders,
      })

      if (result?.success && result.data) {
        const connId = (result.data as unknown as { connectionId: string }).connectionId
        set({ connectionId: connId, connectionState: 'connected', connectedAt: Date.now() })
      } else {
        set({
          connectionState: 'error',
          errorMessage: result?.error || 'SSE connection failed',
        })
      }
    } catch {
      // Demo mode: simulate SSE connection
      const connId = `sse-${makeId()}`
      set({ connectionId: connId, connectionState: 'connected', connectedAt: Date.now() })

      // Simulate events
      const eventTypes = ['message', 'update', 'notification', 'heartbeat']
      let eventIndex = 0

      const interval = setInterval(() => {
        const state = get()
        if (state.connectionState !== 'connected') {
          clearInterval(interval)
          return
        }

        const type = eventTypes[eventIndex % eventTypes.length]
        let data: string
        if (type === 'heartbeat') {
          data = 'ping'
        } else {
          data = JSON.stringify({
            id: makeId(),
            type,
            message: `Demo ${type} event #${eventIndex + 1}`,
            timestamp: new Date().toISOString(),
          })
        }

        state.addEvent({
          id: String(eventIndex + 1),
          type,
          data,
          timestamp: Date.now(),
        })
        eventIndex++
      }, 2500)

      // Cleanup check
      const cleanupCheck = setInterval(() => {
        if (get().connectionState !== 'connected') {
          clearInterval(interval)
          clearInterval(cleanupCheck)
        }
      }, 500)
    }
  },

  disconnect: async () => {
    const { connectionId } = get()

    try {
      if (connectionId) {
        await window.api?.request?.cancel(connectionId)
      }
    } catch {
      // Ignore
    }

    set({ connectionState: 'disconnected', connectionId: null })
  },

  reconnect: async () => {
    await get().disconnect()
    await get().connect()
  },

  clearEvents: () => set({ events: [] }),

  addHeader: () =>
    set((state) => ({ customHeaders: [...state.customHeaders, defaultKv()] })),

  updateHeader: (id, updates) =>
    set((state) => ({
      customHeaders: state.customHeaders.map((h) =>
        h.id === id ? { ...h, ...updates } : h
      ),
    })),

  removeHeader: (id) =>
    set((state) => ({
      customHeaders: state.customHeaders.filter((h) => h.id !== id),
    })),

  addEvent: (event) =>
    set((state) => ({ events: [...state.events, event] })),

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

  reset: () =>
    set({
      url: 'https://example.com/events',
      connectionState: 'disconnected',
      connectionId: null,
      errorMessage: null,
      events: [],
      customHeaders: [defaultKv()],
      lastEventId: '',
      eventTypeFilter: '',
      autoScroll: true,
      connectedAt: null,
    }),
}))
