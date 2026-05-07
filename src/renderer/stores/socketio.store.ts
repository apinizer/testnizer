import { create } from 'zustand'
import { useConsoleStore } from './console.store'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SocketIOEvent {
  direction: 'in' | 'out'
  event: string
  data: unknown
  timestamp: number
}

interface SocketIOApi {
  connect: (
    options: unknown,
  ) => Promise<{ success: boolean; data?: { connectionId: string }; error?: string }>
  disconnect: (id: string) => Promise<{ success: boolean; error?: string }>
  emit: (id: string, event: string, data: unknown) => Promise<{ success: boolean; error?: string }>
  subscribe: (id: string, event: string) => Promise<{ success: boolean; error?: string }>
  unsubscribe: (id: string, event: string) => Promise<{ success: boolean; error?: string }>
  onEvent: (cb: (e: unknown) => void) => () => void
}

function getSioApi(): SocketIOApi | undefined {
  return (window as unknown as { api?: { socketio?: SocketIOApi } }).api?.socketio
}

interface TabSioState {
  url: string
  namespace: string
  bearerToken: string
  connectionId: string | null
  connectionState: ConnectionState
  errorMessage: string | null
  events: SocketIOEvent[]
  subscriptions: string[]
  emitEvent: string
  emitPayload: string
  newSubscription: string
}

interface SocketIOStore extends TabSioState {
  _tabStates: Map<string, TabSioState>
  _currentTabId: string | null
  _unsubscribePush?: () => void

  setUrl: (url: string) => void
  setNamespace: (ns: string) => void
  setBearerToken: (token: string) => void
  setEmitEvent: (name: string) => void
  setEmitPayload: (payload: string) => void
  setNewSubscription: (name: string) => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  emit: () => Promise<void>
  subscribe: () => Promise<void>
  unsubscribe: (eventName: string) => Promise<void>
  clearEvents: () => void
  switchToTab: (tabId: string) => void
  removeTabState: (tabId: string) => void
}

function emptyState(): TabSioState {
  return {
    url: '',
    namespace: '/',
    bearerToken: '',
    connectionId: null,
    connectionState: 'disconnected',
    errorMessage: null,
    events: [],
    subscriptions: [],
    emitEvent: 'message',
    emitPayload: '{}',
    newSubscription: '',
  }
}

function extractState(s: SocketIOStore): TabSioState {
  return {
    url: s.url,
    namespace: s.namespace,
    bearerToken: s.bearerToken,
    connectionId: s.connectionId,
    connectionState: s.connectionState,
    errorMessage: s.errorMessage,
    events: s.events,
    subscriptions: s.subscriptions,
    emitEvent: s.emitEvent,
    emitPayload: s.emitPayload,
    newSubscription: s.newSubscription,
  }
}

const STORAGE_KEY = 'testnizer-socketio'
const persisted = loadTabbedState<TabSioState>(STORAGE_KEY, emptyState)

export const useSocketIOStore = create<SocketIOStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,
  // transient — never restored from disk
  connectionId: null,
  connectionState: 'disconnected',
  errorMessage: null,
  events: [],

  setUrl: (url) => set({ url }),
  setNamespace: (namespace) => set({ namespace }),
  setBearerToken: (bearerToken) => set({ bearerToken }),
  setEmitEvent: (emitEvent) => set({ emitEvent }),
  setEmitPayload: (emitPayload) => set({ emitPayload }),
  setNewSubscription: (newSubscription) => set({ newSubscription }),

  connect: async () => {
    const { url, namespace, bearerToken } = get()
    if (!url.trim()) return
    set({ connectionState: 'connecting', errorMessage: null })
    const api = getSioApi()
    if (!api) {
      set({ connectionState: 'error', errorMessage: 'API not available' })
      return
    }

    const res = await api.connect({
      url,
      namespace: namespace || '/',
      auth: bearerToken ? { token: bearerToken } : undefined,
    })

    if (res.success && res.data) {
      const connId = res.data.connectionId
      // Wire event push
      const unsub = api.onEvent((raw: unknown) => {
        const e = raw as { connectionId: string } & SocketIOEvent
        if (e.connectionId !== connId) return
        set((s) => ({
          events: [
            ...s.events,
            { direction: e.direction, event: e.event, data: e.data, timestamp: e.timestamp },
          ],
        }))
      })
      set({
        connectionId: connId,
        connectionState: 'connected',
        errorMessage: null,
        _unsubscribePush: unsub,
      })
      useConsoleStore.getState().addEntry({
        protocol: 'socketio',
        level: 'success',
        category: 'request',
        url,
        message: `Socket.IO bağlandı: ${url}${namespace !== '/' ? namespace : ''}`,
      })
    } else {
      const errMsg = res.error ?? 'Connection failed'
      set({ connectionState: 'error', errorMessage: errMsg })
      useConsoleStore.getState().addEntry({
        protocol: 'socketio',
        level: 'error',
        category: 'request',
        url,
        message: `Socket.IO bağlantı hatası: ${errMsg}`,
        details: { error: { message: errMsg } },
      })
    }
  },

  disconnect: async () => {
    const { connectionId, url, _unsubscribePush } = get()
    if (connectionId) await getSioApi()?.disconnect(connectionId)
    _unsubscribePush?.()
    useConsoleStore.getState().addEntry({
      protocol: 'socketio',
      level: 'info',
      category: 'request',
      url,
      message: `Socket.IO bağlantısı kesildi`,
    })
    set({
      ...emptyState(),
      url: get().url,
      namespace: get().namespace,
      bearerToken: get().bearerToken,
    })
  },

  emit: async () => {
    const { connectionId, emitEvent, emitPayload, url } = get()
    if (!connectionId || !emitEvent.trim()) return
    let data: unknown = emitPayload
    try {
      data = JSON.parse(emitPayload)
    } catch {
      /* send as string */
    }
    const res = await getSioApi()?.emit(connectionId, emitEvent, data)
    if (res && !res.success) {
      useConsoleStore.getState().addEntry({
        protocol: 'socketio',
        level: 'error',
        category: 'event',
        url,
        message: `Socket.IO emit hatası (${emitEvent}): ${res.error}`,
        details: { error: { message: res.error ?? 'emit failed' } },
      })
    }
  },

  subscribe: async () => {
    const { connectionId, newSubscription, subscriptions } = get()
    const name = newSubscription.trim()
    if (!connectionId || !name || subscriptions.includes(name)) return
    const res = await getSioApi()?.subscribe(connectionId, name)
    if (res?.success) {
      set({ subscriptions: [...subscriptions, name], newSubscription: '' })
    }
  },

  unsubscribe: async (eventName) => {
    const { connectionId, subscriptions } = get()
    if (connectionId) await getSioApi()?.unsubscribe(connectionId, eventName)
    set({ subscriptions: subscriptions.filter((s) => s !== eventName) })
  },

  clearEvents: () => set({ events: [] }),

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)
    if (state._currentTabId) tabStates.set(state._currentTabId, extractState(state))
    const target = tabStates.get(tabId) ?? emptyState()
    set({ ...target, _tabStates: tabStates, _currentTabId: tabId })
  },

  removeTabState: (tabId) => {
    const state = get()
    if (state._currentTabId === tabId) {
      if (state.connectionId)
        getSioApi()
          ?.disconnect(state.connectionId)
          .catch(() => {})
      state._unsubscribePush?.()
    }
    const tabStates = new Map(get()._tabStates)
    tabStates.delete(tabId)
    set({ _tabStates: tabStates })
  },
}))

attachTabbedPersist(useSocketIOStore, STORAGE_KEY, extractState, (s) => ({
  _tabStates: s._tabStates,
  _currentTabId: s._currentTabId,
}))
