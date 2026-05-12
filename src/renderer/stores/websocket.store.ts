import { create } from 'zustand'
import type { WsMessage, KeyValuePair } from '../types'
import { useEnvironmentStore } from './environment.store'
import { useWorkspaceStore } from './workspace.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { makeId } from '../lib/utils'

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Shape of payloads emitted by the main process on the `ws:event` channel. */
interface WsEvent {
  connectionId: string
  type: 'open' | 'message' | 'close' | 'error'
  data?: string
  code?: number
  reason?: string
  timestamp: number
  messageId?: string
  contentType?: 'text' | 'json' | 'binary'
}

interface WsApi {
  connect: (options: {
    url: string
    headers?: Record<string, string>
    protocols?: string[]
    _workspaceId?: string
    _projectId?: string
    _endpointId?: string
    _pendingId?: string
  }) => Promise<{
    success: boolean
    data?: { connectionId: string }
    error?: string
  }>
  cancelConnect: (
    pendingId: string,
  ) => Promise<{ success: boolean; data?: { canceled: boolean }; error?: string }>
  disconnect: (
    connectionId: string,
  ) => Promise<{ success: boolean; data?: boolean; error?: string }>
  send: (
    connectionId: string,
    message: string,
  ) => Promise<{ success: boolean; data?: boolean; error?: string }>
  onEvent: (cb: (event: WsEvent) => void) => () => void
}

function getWsApi(): WsApi | undefined {
  const w = window as unknown as { api?: { ws?: WsApi } }
  return w.api?.ws
}

/** Snapshot of WebSocket state for per-tab caching. */
interface TabWsState {
  url: string
  customHeaders: KeyValuePair[]
  composerContent: string
  composerMode: 'json' | 'text'
  autoScroll: boolean
  messages: WsMessage[]
  connectionId: string | null
  connectionState: ConnectionState
  errorMessage: string | null
  connectedAt: number | null
  /** Per-tab subscription handle returned by `ws.onEvent`. */
  _unsubscribe?: () => void
  /**
   * Renderer-generated id sent to the engine before connect so a stalled
   * handshake can be cancelled by calling `ws.cancelConnect(id)`. Cleared
   * once the connection opens or fails.
   */
  _pendingConnectId?: string
}

interface WebSocketStore extends TabWsState {
  /** Per-tab state cache */
  _tabStates: Map<string, TabWsState>
  _currentTabId: string | null

  setUrl: (url: string) => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  sendMessage: () => Promise<void>
  clearMessages: () => void
  setComposerContent: (content: string) => void
  setComposerMode: (mode: 'json' | 'text') => void
  setAutoScroll: (auto: boolean) => void
  addHeader: () => void
  updateHeader: (id: string, updates: Partial<KeyValuePair>) => void
  removeHeader: (id: string) => void
  setHeaders: (headers: KeyValuePair[]) => void
  addMessage: (msg: WsMessage) => void
  setConnectionState: (state: ConnectionState) => void
  setErrorMessage: (msg: string | null) => void

  /** Switch active tab — saves current state and loads target tab state. */
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab. Tears down its `_unsubscribe`. */
  removeTabState: (tabId: string) => void

  reset: () => void
}

function emptyTabState(): TabWsState {
  return {
    url: 'wss://echo.websocket.org',
    customHeaders: [defaultKv()],
    composerContent: '{\n  "type": "ping",\n  "payload": "hello"\n}',
    composerMode: 'json',
    autoScroll: true,
    messages: [],
    connectionId: null,
    connectionState: 'disconnected',
    errorMessage: null,
    connectedAt: null,
    _unsubscribe: undefined,
    _pendingConnectId: undefined,
  }
}

function extractState(s: WebSocketStore): TabWsState {
  return {
    url: s.url,
    customHeaders: s.customHeaders,
    composerContent: s.composerContent,
    composerMode: s.composerMode,
    autoScroll: s.autoScroll,
    messages: s.messages,
    connectionId: s.connectionId,
    connectionState: s.connectionState,
    errorMessage: s.errorMessage,
    connectedAt: s.connectedAt,
    _unsubscribe: s._unsubscribe,
    _pendingConnectId: s._pendingConnectId,
  }
}

const STORAGE_KEY = 'testnizer-websocket'
const persisted = loadTabbedState<TabWsState>(STORAGE_KEY, emptyTabState)

export const useWebSocketStore = create<WebSocketStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,
  // Cached `_unsubscribe` references aren't valid across reloads; force-clear
  // them so the store's idle state matches a freshly-opened renderer.
  _unsubscribe: undefined,
  connectionId: null,
  connectionState: 'disconnected',
  events: [],

  setUrl: (url) => set({ url }),

  connect: async () => {
    const { url, customHeaders } = get()
    if (!url.trim()) return

    const pendingConnectId = makeId()
    set({
      connectionState: 'connecting',
      errorMessage: null,
      messages: [],
      _pendingConnectId: pendingConnectId,
    })

    const activeVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedUrl = resolveVariables(url, activeVars)
    const resolvedHeaderRows = resolveKeyValuePairs(
      customHeaders.filter((h) => h.enabled && h.key.trim()),
      activeVars,
    )
    const headerMap: Record<string, string> = {}
    for (const row of resolvedHeaderRows) headerMap[row.key] = row.value

    const ws = getWsApi()
    if (!ws) {
      set({ connectionState: 'error', errorMessage: 'WebSocket bridge unavailable' })
      return
    }

    // Capture the tabId at connect time. Events for this connection are routed
    // back into the *same* tab's slot even if the user has since switched
    // tabs (in which case we update the cached entry rather than the live
    // top-level state).
    const ownerTabId = get()._currentTabId

    const applyToOwner = (patch: Partial<TabWsState>): void => {
      const current = get()
      if (current._currentTabId === ownerTabId) {
        set(patch as Partial<WebSocketStore>)
      } else if (ownerTabId !== null) {
        const map = new Map(current._tabStates)
        const existing = map.get(ownerTabId) ?? emptyTabState()
        map.set(ownerTabId, { ...existing, ...patch })
        set({ _tabStates: map })
      }
    }

    // Subscribe BEFORE awaiting connect — main fires the 'open' event from
    // inside `connect()`, so attaching after would race against the event.
    const prevUnsub = get()._unsubscribe
    if (prevUnsub) prevUnsub()
    const unsub = ws.onEvent((evt) => {
      // Look up the expected connectionId from the owning tab's state
      // (live or cached) — if the user has switched tabs we still want
      // events to land in the right tab.
      const live = get()
      let expected: string | null
      if (live._currentTabId === ownerTabId) {
        expected = live.connectionId
      } else if (ownerTabId !== null) {
        expected = live._tabStates.get(ownerTabId)?.connectionId ?? null
      } else {
        expected = live.connectionId
      }
      // Ignore stray events from older connections (rapid reconnect).
      if (expected && evt.connectionId !== expected) return

      switch (evt.type) {
        case 'open':
          applyToOwner({
            connectionState: 'connected',
            errorMessage: null,
            connectedAt: Date.now(),
          })
          break
        case 'message': {
          const contentType: WsMessage['contentType'] =
            evt.contentType === 'binary' ? 'text' : evt.contentType === 'json' ? 'json' : 'text'
          const newMsg: WsMessage = {
            id: evt.messageId ?? makeId(),
            direction: 'received',
            content: evt.data ?? '',
            contentType,
            timestamp: evt.timestamp,
          }
          // Append to the owning tab's messages array.
          const current = get()
          if (current._currentTabId === ownerTabId) {
            set({ messages: [...current.messages, newMsg] })
          } else if (ownerTabId !== null) {
            const map = new Map(current._tabStates)
            const existing = map.get(ownerTabId) ?? emptyTabState()
            map.set(ownerTabId, { ...existing, messages: [...existing.messages, newMsg] })
            set({ _tabStates: map })
          }
          break
        }
        case 'close':
          applyToOwner({
            connectionState: 'disconnected',
            connectionId: null,
            errorMessage:
              evt.code && evt.code !== 1000
                ? `Closed (${evt.code}${evt.reason ? `: ${evt.reason}` : ''})`
                : null,
          })
          break
        case 'error':
          applyToOwner({
            connectionState: 'error',
            errorMessage: evt.data || 'WebSocket error',
          })
          break
      }
    })
    set({ _unsubscribe: unsub })

    try {
      const wsStore = useWorkspaceStore.getState()
      const result = await ws.connect({
        url: resolvedUrl,
        headers: headerMap,
        _workspaceId: wsStore.activeWorkspaceId || undefined,
        _projectId: wsStore.activeProjectId || undefined,
        _pendingId: pendingConnectId,
      })

      if (result?.success && result.data) {
        // The `open` event from main may have already fired by the time the
        // promise resolves — keep `connected` state if it did, otherwise wait
        // for it. We always set the connectionId so the listener filter
        // accepts subsequent events.
        const newId = result.data.connectionId
        const current = get()
        if (current._currentTabId === ownerTabId) {
          set({
            connectionId: newId,
            connectionState: current.connectionState === 'connected' ? 'connected' : 'connecting',
            _pendingConnectId: undefined,
          })
        } else if (ownerTabId !== null) {
          const map = new Map(current._tabStates)
          const existing = map.get(ownerTabId) ?? emptyTabState()
          map.set(ownerTabId, {
            ...existing,
            connectionId: newId,
            connectionState: existing.connectionState === 'connected' ? 'connected' : 'connecting',
            _pendingConnectId: undefined,
          })
          set({ _tabStates: map })
        }
      } else {
        unsub()
        applyToOwner({
          _unsubscribe: undefined,
          _pendingConnectId: undefined,
          connectionState: 'error',
          errorMessage: result?.error || 'Connection failed',
        })
      }
    } catch (e) {
      unsub()
      applyToOwner({
        _unsubscribe: undefined,
        _pendingConnectId: undefined,
        connectionState: 'error',
        errorMessage: (e as Error).message,
      })
    }
  },

  disconnect: async () => {
    const { connectionId, _unsubscribe, _pendingConnectId, connectionState } = get()
    const ws = getWsApi()

    if (ws) {
      // Two paths: a connection already opened → `disconnect`; a handshake is
      // still in flight → `cancelConnect`. Connection-state is the canonical
      // indicator; we also fall through to `disconnect` if the connectionId
      // arrived between state updates.
      if (connectionState === 'connecting' && _pendingConnectId) {
        try {
          await ws.cancelConnect(_pendingConnectId)
        } catch {
          // Engine already finished the handshake — disconnect path catches it.
        }
      }
      if (connectionId) {
        try {
          await ws.disconnect(connectionId)
        } catch {
          // Engine already cleaned up — fall through to local state reset.
        }
      }
    }
    if (_unsubscribe) _unsubscribe()

    set({
      connectionState: 'disconnected',
      connectionId: null,
      errorMessage: null,
      _unsubscribe: undefined,
      _pendingConnectId: undefined,
    })
  },

  sendMessage: async () => {
    const { connectionId, composerContent, composerMode, connectionState } = get()
    if (connectionState !== 'connected' || !connectionId || !composerContent.trim()) return

    let contentType: 'text' | 'json' = 'text'
    if (composerMode === 'json') {
      try {
        JSON.parse(composerContent)
        contentType = 'json'
      } catch {
        contentType = 'text'
      }
    }

    const activeVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedContent = resolveVariables(composerContent, activeVars)

    const sentMsg: WsMessage = {
      id: makeId(),
      direction: 'sent',
      content: resolvedContent,
      contentType,
      timestamp: Date.now(),
    }

    set((state) => ({ messages: [...state.messages, sentMsg] }))

    const ws = getWsApi()
    if (!ws) return
    try {
      const result = await ws.send(connectionId, resolvedContent)
      if (!result?.success && result?.error) {
        set({ errorMessage: result.error })
      }
    } catch (e) {
      set({ errorMessage: (e as Error).message })
    }
  },

  clearMessages: () => set({ messages: [] }),

  setComposerContent: (content) => set({ composerContent: content }),
  setComposerMode: (mode) => set({ composerMode: mode }),
  setAutoScroll: (auto) => set({ autoScroll: auto }),

  addHeader: () => set((state) => ({ customHeaders: [...state.customHeaders, defaultKv()] })),

  updateHeader: (id, updates) =>
    set((state) => ({
      customHeaders: state.customHeaders.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    })),

  removeHeader: (id) =>
    set((state) => ({
      customHeaders: state.customHeaders.filter((h) => h.id !== id),
    })),

  setHeaders: (headers) => set({ customHeaders: headers }),

  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

  setConnectionState: (connectionState) => set({ connectionState }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)

    // Save current tab state under its own key
    const currentKey = state._currentTabId === null ? '__null__' : state._currentTabId
    tabStates.set(currentKey, extractState(state))

    // Load target tab (or empty for new tabs)
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

    // If the closed tab was also the live one, also tear down live listener
    // (it may already be the same function reference, so guard with a flag).
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

attachTabbedPersist(useWebSocketStore, STORAGE_KEY, extractState, (s) => ({
  _tabStates: s._tabStates,
  _currentTabId: s._currentTabId,
}))
