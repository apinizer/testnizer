import { create } from 'zustand'
import type { WsMessage, KeyValuePair } from '../types'
import { useEnvironmentStore } from './environment.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'

function makeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

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
  }) => Promise<{
    success: boolean
    data?: { connectionId: string }
    error?: string
  }>
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

interface WebSocketStore {
  url: string
  connectionId: string | null
  connectionState: ConnectionState
  errorMessage: string | null
  messages: WsMessage[]
  customHeaders: KeyValuePair[]
  composerContent: string
  composerMode: 'json' | 'text'
  autoScroll: boolean
  /** Subscription returned by `ws.onEvent` — call to remove the listener. */
  _unsubscribe?: () => void

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
  reset: () => void
}

export const useWebSocketStore = create<WebSocketStore>((set, get) => ({
  url: 'wss://echo.websocket.org',
  connectionId: null,
  connectionState: 'disconnected',
  errorMessage: null,
  messages: [],
  customHeaders: [defaultKv()],
  composerContent: '{\n  "type": "ping",\n  "payload": "hello"\n}',
  composerMode: 'json',
  autoScroll: true,
  _unsubscribe: undefined,

  setUrl: (url) => set({ url }),

  connect: async () => {
    const { url, customHeaders } = get()
    if (!url.trim()) return

    set({ connectionState: 'connecting', errorMessage: null, messages: [] })

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

    // Subscribe BEFORE awaiting connect — main fires the 'open' event from
    // inside `connect()`, so attaching after would race against the event.
    const prevUnsub = get()._unsubscribe
    if (prevUnsub) prevUnsub()
    const unsub = ws.onEvent((evt) => {
      const expected = get().connectionId
      // Ignore stray events from older connections (rapid reconnect).
      if (expected && evt.connectionId !== expected) return

      switch (evt.type) {
        case 'open':
          set({ connectionState: 'connected', errorMessage: null })
          break
        case 'message': {
          const contentType: WsMessage['contentType'] =
            evt.contentType === 'binary'
              ? 'text'
              : evt.contentType === 'json'
                ? 'json'
                : 'text'
          get().addMessage({
            id: evt.messageId ?? makeId(),
            direction: 'received',
            content: evt.data ?? '',
            contentType,
            timestamp: evt.timestamp,
          })
          break
        }
        case 'close':
          set({
            connectionState: 'disconnected',
            connectionId: null,
            errorMessage:
              evt.code && evt.code !== 1000
                ? `Closed (${evt.code}${evt.reason ? `: ${evt.reason}` : ''})`
                : null,
          })
          break
        case 'error':
          set({
            connectionState: 'error',
            errorMessage: evt.data || 'WebSocket error',
          })
          break
      }
    })
    set({ _unsubscribe: unsub })

    try {
      const result = await ws.connect({
        url: resolvedUrl,
        headers: headerMap,
      })

      if (result?.success && result.data) {
        // The `open` event from main may have already fired by the time the
        // promise resolves — keep `connected` state if it did, otherwise wait
        // for it. We always set the connectionId so the listener filter
        // accepts subsequent events.
        set((state) => ({
          connectionId: result.data!.connectionId,
          connectionState:
            state.connectionState === 'connected' ? 'connected' : 'connecting',
        }))
      } else {
        unsub()
        set({
          _unsubscribe: undefined,
          connectionState: 'error',
          errorMessage: result?.error || 'Connection failed',
        })
      }
    } catch (e) {
      unsub()
      set({
        _unsubscribe: undefined,
        connectionState: 'error',
        errorMessage: (e as Error).message,
      })
    }
  },

  disconnect: async () => {
    const { connectionId, _unsubscribe } = get()
    const ws = getWsApi()

    if (ws && connectionId) {
      try {
        await ws.disconnect(connectionId)
      } catch {
        // Engine already cleaned up — fall through to local state reset.
      }
    }
    if (_unsubscribe) _unsubscribe()

    set({
      connectionState: 'disconnected',
      connectionId: null,
      errorMessage: null,
      _unsubscribe: undefined,
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

  setHeaders: (headers) => set({ customHeaders: headers }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  setConnectionState: (connectionState) => set({ connectionState }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),

  reset: () => {
    const { _unsubscribe } = get()
    if (_unsubscribe) _unsubscribe()
    set({
      url: 'wss://echo.websocket.org',
      connectionId: null,
      connectionState: 'disconnected',
      errorMessage: null,
      messages: [],
      customHeaders: [defaultKv()],
      composerContent: '{\n  "type": "ping",\n  "payload": "hello"\n}',
      composerMode: 'json',
      autoScroll: true,
      _unsubscribe: undefined,
    })
  },
}))
