import { create } from 'zustand'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { useWorkspaceStore } from './workspace.store'
import { useEnvironmentStore } from './environment.store'
import { resolveVariables } from '../lib/variable-resolver'
import { makeId } from '../lib/utils'

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
  cancelConnect: (
    pendingId: string,
  ) => Promise<{ success: boolean; data?: { canceled: boolean }; error?: string }>
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
  /** Renderer-supplied id so a stalled handshake can be cancelled. */
  _pendingConnectId?: string
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
    _pendingConnectId: undefined,
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
    _pendingConnectId: s._pendingConnectId,
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
    const pendingConnectId = makeId()
    set({
      connectionState: 'connecting',
      errorMessage: null,
      _pendingConnectId: pendingConnectId,
    })
    const api = getSioApi()
    if (!api) {
      set({
        connectionState: 'error',
        errorMessage: 'API not available',
        _pendingConnectId: undefined,
      })
      return
    }

    const ws = useWorkspaceStore.getState()
    // Resolve `{{var}}` in URL / namespace / bearer token so users can
    // share connection details via env (`wss://{{host}}/ws`,
    // `Bearer {{authToken}}`, etc.) — matches the HTTP/SOAP/GraphQL
    // behaviour at the editor's Send moment.
    const vars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedUrl = resolveVariables(url, vars)
    const resolvedNamespace = resolveVariables(namespace || '/', vars)
    const resolvedToken = resolveVariables(bearerToken || '', vars)
    const res = await api.connect({
      url: resolvedUrl,
      namespace: resolvedNamespace || '/',
      auth: resolvedToken ? { token: resolvedToken } : undefined,
      _workspaceId: ws.activeWorkspaceId || undefined,
      _projectId: ws.activeProjectId || undefined,
      _pendingId: pendingConnectId,
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
        _pendingConnectId: undefined,
      })
    } else {
      set({
        connectionState: 'error',
        errorMessage: res.error ?? 'Connection failed',
        _pendingConnectId: undefined,
      })
    }
    // Logging is done in main (src/main/ipc/socketio.handler.ts) so all
    // protocols funnel through the same console:log channel.
  },

  disconnect: async () => {
    const { connectionId, _unsubscribePush, _pendingConnectId, connectionState } = get()
    const api = getSioApi()
    if (api) {
      if (connectionState === 'connecting' && _pendingConnectId) {
        try {
          await api.cancelConnect(_pendingConnectId)
        } catch {
          // Engine already finished — disconnect catches it.
        }
      }
      if (connectionId) await api.disconnect(connectionId)
    }
    _unsubscribePush?.()
    set({
      ...emptyState(),
      url: get().url,
      namespace: get().namespace,
      bearerToken: get().bearerToken,
    })
  },

  emit: async () => {
    const { connectionId, emitEvent, emitPayload } = get()
    if (!connectionId || !emitEvent.trim()) return
    const vars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedEvent = resolveVariables(emitEvent, vars)
    const resolvedPayload = resolveVariables(emitPayload, vars)
    let data: unknown = resolvedPayload
    try {
      data = JSON.parse(resolvedPayload)
    } catch {
      /* send as string */
    }
    await getSioApi()?.emit(connectionId, resolvedEvent, data)
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
