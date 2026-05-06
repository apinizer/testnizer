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

  setUrl: (url) => set({ url }),

  connect: async () => {
    const { url, customHeaders } = get()
    if (!url.trim()) return

    set({ connectionState: 'connecting', errorMessage: null })

    const activeVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedUrl = resolveVariables(url, activeVars)
    const resolvedHeaders = resolveKeyValuePairs(
      customHeaders.filter((h) => h.enabled && h.key.trim()),
      activeVars,
    )

    try {
      const result = await window.api?.request?.send({
        method: 'WS_CONNECT',
        url: resolvedUrl,
        headers: resolvedHeaders,
      })

      if (result?.success && result.data) {
        const connId = (result.data as unknown as { connectionId: string }).connectionId
        set({ connectionId: connId, connectionState: 'connected' })
      } else {
        set({
          connectionState: 'error',
          errorMessage: result?.error || 'Connection failed',
        })
      }
    } catch {
      // Demo mode: simulate connection
      const connId = `ws-${makeId()}`
      set({ connectionId: connId, connectionState: 'connected' })

      // Simulate a welcome message after short delay
      setTimeout(() => {
        const state = get()
        if (state.connectionState === 'connected') {
          state.addMessage({
            id: makeId(),
            direction: 'received',
            content: JSON.stringify({ type: 'welcome', message: 'Connected to WebSocket server' }),
            contentType: 'json',
            timestamp: Date.now(),
          })
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
      // Ignore disconnect errors
    }

    set({ connectionState: 'disconnected', connectionId: null, errorMessage: null })
  },

  sendMessage: async () => {
    const { connectionId, composerContent, composerMode, connectionState } = get()
    if (connectionState !== 'connected' || !composerContent.trim()) return

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

    try {
      await window.api?.request?.send({
        method: 'WS_SEND',
        url: `__internal__:ws:send:${connectionId}`,
        body: { type: 'text', content: resolvedContent },
      })
    } catch {
      // Demo mode: echo the message back
      setTimeout(() => {
        get().addMessage({
          id: makeId(),
          direction: 'received',
          content: resolvedContent,
          contentType,
          timestamp: Date.now(),
        })
      }, 200)
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

  reset: () =>
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
    }),
}))
