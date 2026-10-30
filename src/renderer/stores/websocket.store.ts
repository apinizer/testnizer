import { create } from 'zustand'
import type { WsMessage, KeyValuePair } from '../types'
import { useEnvironmentStore } from './environment.store'
import { useWorkspaceStore } from './workspace.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { afterWithheldReloaded, reloadWithheldBeforeSend } from '../lib/withheld-before-send'
import { cloneTabSlice } from '../lib/tab-clone'
import { connectErrorText } from '../lib/connection-error'
import {
  credentialRows,
  trackCredentialEdits,
  withholdCredentials,
  type CredentialSpec,
  type WithheldState,
} from '../lib/credential-withhold'
import { messageCredentialText, urlCredentialText } from '../lib/credential-text'
import { isCredentialArgName } from '../../shared/credential-headers'
import { makeId } from '../lib/utils'
import { wsMaskedSendError } from '../lib/masked-send-guard'
// Shared dirty-flag helper — flags the active tab's blue dot on a user edit so
// the unsaved-change indicator works for WebSocket, not just HTTP (issue #8).
import { markActiveTabDirty } from '../lib/mark-dirty'
import { applyParamsToUrl, mergeParamsFromUrl } from '../lib/url-query-sync'
import {
  DEFAULT_WS_SETTINGS,
  bytesToBase64,
  decodeBinary,
  isBinaryContentType,
  type RtContentType,
  type WsSavedMessage,
  type WsSettings,
} from '../../shared/realtime'
import { wsMetaOf, type WsRequestFields } from '../lib/realtime-meta'
import { bindConnectionsToProject, releaseConnection } from '../lib/realtime-connections'

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

function getWsApi() {
  return window.api?.ws
}

/** Snapshot of WebSocket state for per-tab caching. */
interface TabWsState extends WithheldState, WsRequestFields {
  /** The saved message the composer was loaded from; Save updates it in place. */
  activeSavedMessageId: string | null
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
  /** The project the connection was opened in (closed on leaving it). */
  _projectId?: string | null
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
  setComposerMode: (mode: RtContentType) => void
  setAutoScroll: (auto: boolean) => void
  addHeader: () => void
  updateHeader: (id: string, updates: Partial<KeyValuePair>) => void
  removeHeader: (id: string) => void
  setHeaders: (headers: KeyValuePair[]) => void
  setParams: (params: KeyValuePair[]) => void
  addParam: () => void
  updateParam: (id: string, updates: Partial<KeyValuePair>) => void
  removeParam: (id: string) => void
  setSettings: (patch: Partial<WsSettings>) => void
  /** `name`: the new message's name (the editor passes a translated default). */
  saveCurrentMessage: (name?: string) => void | Promise<void>
  addSavedMessage: (name?: string) => void
  loadSavedMessage: (id: string) => void | Promise<void>
  renameSavedMessage: (id: string, name: string) => void
  deleteSavedMessage: (id: string) => void
  saveLoggedMessage: (messageId: string, name?: string) => void
  addMessage: (msg: WsMessage) => void
  setConnectionState: (state: ConnectionState) => void
  setErrorMessage: (msg: string | null) => void

  /** Switch active tab — saves current state and loads target tab state. */
  /** Duplicate Tab: copy a tab's slice onto a new tab id, disconnected. */
  cloneTabState: (srcTabId: string, dstTabId: string) => void
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab. Tears down its `_unsubscribe`. */
  removeTabState: (tabId: string) => void

  reset: () => void
}

function emptyTabState(): TabWsState {
  return {
    withheldCredentials: [],
    // Empty like Socket.IO / MCP (issue #257): no third-party host the user
    // did not type. The field shows an example placeholder instead.
    url: '',
    customHeaders: [defaultKv()],
    params: [],
    settings: { ...DEFAULT_WS_SETTINGS },
    composerContent: '{\n  "type": "ping",\n  "payload": "hello"\n}',
    composerMode: 'json',
    autoScroll: true,
    savedMessages: [],
    activeSavedMessageId: null,
    messages: [],
    connectionId: null,
    connectionState: 'disconnected',
    errorMessage: null,
    connectedAt: null,
    _unsubscribe: undefined,
    _pendingConnectId: undefined,
    _projectId: null,
  }
}

function extractState(s: WebSocketStore): TabWsState {
  return {
    withheldCredentials: s.withheldCredentials,
    url: s.url,
    customHeaders: s.customHeaders,
    params: s.params,
    settings: s.settings,
    composerContent: s.composerContent,
    composerMode: s.composerMode,
    autoScroll: s.autoScroll,
    savedMessages: s.savedMessages,
    activeSavedMessageId: s.activeSavedMessageId,
    messages: s.messages,
    connectionId: s.connectionId,
    connectionState: s.connectionState,
    errorMessage: s.errorMessage,
    connectedAt: s.connectedAt,
    _unsubscribe: s._unsubscribe,
    _pendingConnectId: s._pendingConnectId,
    _projectId: s._projectId,
  }
}

/**
 * Issue #244 / #247 / #282: credential-named handshake headers and query
 * params, `?token=…` / `user:pass@` in the connection URL and
 * credential-named members of a JSON-looking composer draft or saved message
 * (issue #284 audit) never hold a literal value in the snapshot (the row, its
 * name and the rest of the text stay; `{{var}}`-only values are kept). The
 * saved row keeps the value — `lib/withheld-credentials.ts` reloads it.
 */
export const WS_CREDENTIALS: CredentialSpec = {
  fields: [],
  rows: [
    credentialRows('customHeaders'),
    { list: 'params', isCredentialName: isCredentialArgName },
  ],
  texts: [
    urlCredentialText('url'),
    messageCredentialText('composerContent'),
    messageCredentialText('savedMessages[].content'),
  ],
}

/**
 * On-disk view of a tab: URL, headers, params, settings, saved messages and
 * the composer draft — never the message timeline. Received frames are server
 * output and sent ones are the RESOLVED text (`{{secret}}` already
 * substituted), so neither is written to localStorage; they stay in memory for
 * the session. The connection does not survive a reload, so it is stored as
 * disconnected.
 */
function persistableWs(st: TabWsState): TabWsState {
  return idleWs(withholdCredentials(st, WS_CREDENTIALS))
}

/** A tab with no live connection or timeline — what is stored and what Duplicate Tab copies. */
function idleWs(st: TabWsState): TabWsState {
  const idle = emptyTabState()
  return {
    ...st,
    messages: idle.messages,
    errorMessage: idle.errorMessage,
    connectionId: idle.connectionId,
    connectionState: idle.connectionState,
    connectedAt: idle.connectedAt,
    _unsubscribe: undefined,
    _pendingConnectId: undefined,
    _projectId: null,
  }
}

const STORAGE_KEY = 'testnizer-websocket'
const persisted = loadTabbedState<TabWsState>(STORAGE_KEY, emptyTabState, persistableWs)

function systemRow(event: string, detail: string): WsMessage {
  return {
    id: makeId(),
    direction: 'system',
    content: detail,
    contentType: 'text',
    timestamp: Date.now(),
    event,
  }
}

/**
 * The composer → what goes on the wire and what the log shows. Binary
 * content is validated here too (main decodes it again) so the log row holds
 * the normalized base64 the hexdump view reads.
 */
function outgoing(
  content: string,
  mode: RtContentType,
): { ok: true; row: Pick<WsMessage, 'content' | 'contentType'> } | { ok: false; error: string } {
  if (isBinaryContentType(mode)) {
    const res = decodeBinary(content, mode)
    if (!res.ok) return { ok: false, error: res.error }
    return { ok: true, row: { content: bytesToBase64(res.bytes), contentType: 'binary' } }
  }
  if (mode === 'json') {
    try {
      JSON.parse(content)
      return { ok: true, row: { content, contentType: 'json' } }
    } catch {
      return { ok: true, row: { content, contentType: 'text' } }
    }
  }
  return { ok: true, row: { content, contentType: mode } }
}

export const useWebSocketStore = create<WebSocketStore>((set, get) => {
  const edit = (patch: Partial<TabWsState>): void => {
    set(patch as Partial<WebSocketStore>)
    markActiveTabDirty()
  }

  return {
    ...persisted.current,
    _tabStates: persisted._tabStates,
    _currentTabId: persisted._currentTabId,
    // Cached `_unsubscribe` references aren't valid across reloads; force-clear
    // them so the store's idle state matches a freshly-opened renderer.
    _unsubscribe: undefined,
    connectionId: null,
    connectionState: 'disconnected',

    setUrl: (url) => edit({ url, params: mergeParamsFromUrl(url, get().params) }),

    connect: async () => {
      // Issue #244: a credential still withheld after a restart is reloaded first.
      if (get().withheldCredentials.length > 0) await reloadWithheldBeforeSend()
      const start = get()
      const { url, customHeaders } = start
      if (!url.trim()) return
      // Issue #195: a History mask left in a credential field is never sent.
      const maskedConnect = wsMaskedSendError({
        url,
        customHeaders: customHeaders.filter((h) => h.enabled),
        params: start.params.filter((p) => p.enabled),
      })
      if (maskedConnect) {
        set({ connectionState: 'error', errorMessage: maskedConnect })
        return
      }

      const pendingConnectId = makeId()
      set({
        connectionState: 'connecting',
        errorMessage: null,
        messages: [],
        _pendingConnectId: pendingConnectId,
        _projectId: useWorkspaceStore.getState().activeProjectId,
      })

      // Params are part of the URL (URL ⇄ Params sync), resolved with it.
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

      const patchOwner = (patch: (slice: TabWsState) => Partial<TabWsState>): void => {
        const current = get()
        if (current._currentTabId === ownerTabId) {
          set(patch(current) as Partial<WebSocketStore>)
        } else if (ownerTabId !== null) {
          const map = new Map(current._tabStates)
          const existing = map.get(ownerTabId) ?? emptyTabState()
          map.set(ownerTabId, { ...existing, ...patch(existing) })
          set({ _tabStates: map })
        }
      }
      const appendRow = (row: WsMessage): void =>
        patchOwner((sl) => ({ messages: [...sl.messages, row] }))

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
            patchOwner((sl) => ({
              connectionState: 'connected',
              errorMessage: null,
              connectedAt: Date.now(),
              messages: [
                ...sl.messages,
                systemRow(evt.reconnected ? 'reconnected' : 'connected', resolvedUrl),
              ],
            }))
            break
          case 'message':
            appendRow({
              id: evt.messageId ?? makeId(),
              direction: 'received',
              content: evt.data ?? '',
              // Binary stays binary (base64 content) — the log shows a hexdump.
              contentType:
                evt.contentType === 'binary'
                  ? 'binary'
                  : evt.contentType === 'json'
                    ? 'json'
                    : 'text',
              timestamp: evt.timestamp,
            })
            break
          case 'reconnecting':
            appendRow(
              systemRow(
                'reconnecting',
                `#${evt.attempt ?? 1}${evt.code ? ` (${evt.code}${evt.reason ? `: ${evt.reason}` : ''})` : ''}`,
              ),
            )
            break
          case 'close':
            patchOwner((sl) => ({
              connectionState: 'disconnected',
              connectionId: null,
              errorMessage:
                evt.code && evt.code !== 1000
                  ? `Closed (${evt.code}${evt.reason ? `: ${evt.reason}` : ''})`
                  : null,
              messages:
                sl.connectionState === 'connected'
                  ? [
                      ...sl.messages,
                      systemRow(
                        'disconnected',
                        `${evt.code ?? ''}${evt.reason ? ` ${evt.reason}` : ''}`.trim(),
                      ),
                    ]
                  : sl.messages,
            }))
            break
          case 'error': {
            // Issue #253: `errorInfo` → the active locale's text with host:port.
            const text = connectErrorText(
              { error: evt.data, errorInfo: evt.errorInfo },
              'WebSocket error',
            )
            patchOwner((sl) => ({
              connectionState: 'error',
              errorMessage: text,
              messages: [...sl.messages, systemRow('error', text)],
            }))
            break
          }
        }
      })
      set({ _unsubscribe: unsub })

      try {
        const wsStore = useWorkspaceStore.getState()
        const result = await ws.connect({
          url: resolvedUrl,
          headers: headerMap,
          settings: start.settings,
          _workspaceId: wsStore.activeWorkspaceId || undefined,
          _projectId: wsStore.activeProjectId || undefined,
          _pendingId: pendingConnectId,
          // Editor state with `{{var}}` kept — the History row reopens from it
          // (issues #182, #195). The same block `snapshotProtocol` saves.
          _configured: { url, meta: { websocket: wsMetaOf(start) } },
        })

        if (result?.success && result.data) {
          // The `open` event from main may have already fired by the time the
          // promise resolves — keep `connected` state if it did, otherwise wait
          // for it. We always set the connectionId so the listener filter
          // accepts subsequent events.
          const newId = result.data.connectionId
          patchOwner((sl) => ({
            connectionId: newId,
            connectionState: sl.connectionState === 'connected' ? 'connected' : 'connecting',
            _pendingConnectId: undefined,
          }))
        } else {
          unsub()
          patchOwner(() => ({
            _unsubscribe: undefined,
            _pendingConnectId: undefined,
            connectionState: 'error',
            errorMessage: connectErrorText(result, 'Connection failed'),
          }))
        }
      } catch (e) {
        unsub()
        patchOwner(() => ({
          _unsubscribe: undefined,
          _pendingConnectId: undefined,
          connectionState: 'error',
          errorMessage: (e as Error).message,
        }))
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

      set((s) => ({
        connectionState: 'disconnected',
        connectionId: null,
        errorMessage: null,
        _unsubscribe: undefined,
        _pendingConnectId: undefined,
        messages: connectionId ? [...s.messages, systemRow('disconnected', '1000')] : s.messages,
      }))
    },

    sendMessage: async () => {
      // Issue #284: a composer credential withheld after a restart is reloaded first.
      if (get().withheldCredentials.length > 0) await reloadWithheldBeforeSend()
      const { connectionId, composerContent, composerMode, connectionState } = get()
      if (connectionState !== 'connected' || !connectionId || !composerContent.trim()) return
      // Issue #195: a History mask left in a credential field is never sent.
      const maskedMessage = wsMaskedSendError({ composerContent })
      if (maskedMessage) {
        set({ errorMessage: maskedMessage })
        return
      }
      const activeVars = useEnvironmentStore.getState().getActiveVariables()
      const resolvedContent = resolveVariables(composerContent, activeVars)
      const out = outgoing(resolvedContent, composerMode)
      if (!out.ok) {
        set({ errorMessage: out.error })
        return
      }
      set({ errorMessage: null })

      const sentMsg: WsMessage = {
        id: makeId(),
        direction: 'sent',
        ...out.row,
        timestamp: Date.now(),
      }
      set((state) => ({ messages: [...state.messages, sentMsg] }))

      const ws = getWsApi()
      if (!ws) return
      try {
        const result = await ws.send(
          connectionId,
          resolvedContent,
          isBinaryContentType(composerMode) ? { binary: composerMode } : undefined,
        )
        if (!result?.success && result?.error) {
          set({ errorMessage: result.error })
        }
      } catch (e) {
        set({ errorMessage: (e as Error).message })
      }
    },

    clearMessages: () => set({ messages: [] }),

    setComposerContent: (content) => edit({ composerContent: content }),
    setComposerMode: (mode) => edit({ composerMode: mode }),
    setAutoScroll: (auto) => edit({ autoScroll: auto }),

    addHeader: () => edit({ customHeaders: [...get().customHeaders, defaultKv()] }),
    updateHeader: (id, updates) =>
      edit({
        customHeaders: get().customHeaders.map((h) => (h.id === id ? { ...h, ...updates } : h)),
      }),
    removeHeader: (id) => edit({ customHeaders: get().customHeaders.filter((h) => h.id !== id) }),
    setHeaders: (headers) => edit({ customHeaders: headers }),

    setParams: (params) => edit({ params, url: applyParamsToUrl(get().url, params) }),
    addParam: () => {
      const params = [...get().params, defaultKv()]
      edit({ params, url: applyParamsToUrl(get().url, params) })
    },
    updateParam: (id, updates) => {
      const params = get().params.map((p) => (p.id === id ? { ...p, ...updates } : p))
      edit({ params, url: applyParamsToUrl(get().url, params) })
    },
    removeParam: (id) => {
      const params = get().params.filter((p) => p.id !== id)
      edit({ params, url: applyParamsToUrl(get().url, params) })
    },

    setSettings: (patch) => edit({ settings: { ...get().settings, ...patch } }),

    saveCurrentMessage: (name) =>
      // Issue #284: a body still withheld after a restart is reloaded before
      // it is copied — the copy would carry no marker and Ctrl+S would save the blank.
      afterWithheldReloaded(get, 'composerContent', () => {
        const s = get()
        const body = { content: s.composerContent, contentType: s.composerMode }
        const existing = s.savedMessages.find((m) => m.id === s.activeSavedMessageId)
        if (existing) {
          edit({
            savedMessages: s.savedMessages.map((m) =>
              m.id === existing.id ? { ...m, ...body } : m,
            ),
          })
          return
        }
        const msg: WsSavedMessage = {
          id: makeId(),
          name: name ?? `Message ${s.savedMessages.length + 1}`,
          ...body,
        }
        edit({ savedMessages: [...s.savedMessages, msg], activeSavedMessageId: msg.id })
      }),
    addSavedMessage: (name) => {
      const msg: WsSavedMessage = {
        id: makeId(),
        name: name ?? `Message ${get().savedMessages.length + 1}`,
        content: '',
        contentType: 'text',
      }
      edit({
        savedMessages: [...get().savedMessages, msg],
        activeSavedMessageId: msg.id,
        composerContent: '',
        composerMode: 'text',
      })
    },
    loadSavedMessage: (id) =>
      // Issue #284: a body still withheld after a restart is reloaded before
      // it is copied — the copy would carry no marker and Ctrl+S would save the blank.
      afterWithheldReloaded(get, `savedMessages[${id}]`, () => {
        const msg = get().savedMessages.find((m) => m.id === id)
        if (!msg) return
        edit({
          activeSavedMessageId: id,
          composerContent: msg.content,
          composerMode: msg.contentType,
        })
      }),
    renameSavedMessage: (id, name) =>
      edit({ savedMessages: get().savedMessages.map((m) => (m.id === id ? { ...m, name } : m)) }),
    deleteSavedMessage: (id) =>
      edit({
        savedMessages: get().savedMessages.filter((m) => m.id !== id),
        activeSavedMessageId: get().activeSavedMessageId === id ? null : get().activeSavedMessageId,
      }),
    saveLoggedMessage: (messageId, name) => {
      const row = get().messages.find((m) => m.id === messageId)
      if (!row || row.direction === 'system') return
      const msg: WsSavedMessage = {
        id: makeId(),
        name: name ?? `Message ${get().savedMessages.length + 1}`,
        content: row.content,
        contentType: row.contentType === 'binary' ? 'base64' : row.contentType,
      }
      edit({ savedMessages: [...get().savedMessages, msg] })
    },

    addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

    setConnectionState: (connectionState) => set({ connectionState }),
    setErrorMessage: (errorMessage) => set({ errorMessage }),

    cloneTabState: (srcTabId, dstTabId) =>
      cloneTabSlice(useWebSocketStore, extractState, srcTabId, dstTabId, idleWs),

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
      const state = get()
      const live = state._currentTabId === tabId
      const cached = state._tabStates.get(tabId)
      // Closing the tab closes its connection (it used to stay open in main
      // with nothing left to disconnect it).
      releaseConnection(live ? extractState(state) : cached, getWsApi())
      if (live && cached?._unsubscribe && cached._unsubscribe !== state._unsubscribe) {
        cached._unsubscribe()
      }
      const tabStates = new Map(state._tabStates)
      tabStates.delete(tabId)
      set(
        live
          ? {
              _tabStates: tabStates,
              connectionId: null,
              connectionState: 'disconnected',
              _pendingConnectId: undefined,
              _unsubscribe: undefined,
            }
          : { _tabStates: tabStates },
      )
    },

    reset: () => {
      const { _unsubscribe } = get()
      if (_unsubscribe) _unsubscribe()
      set({ ...emptyTabState() })
    },
  }
})

attachTabbedPersist(
  useWebSocketStore,
  STORAGE_KEY,
  extractState,
  (s) => ({ _tabStates: s._tabStates, _currentTabId: s._currentTabId }),
  persistableWs,
)
// Issue #244: a user edit to a withheld value drops its marker.
trackCredentialEdits(useWebSocketStore, WS_CREDENTIALS)
// Leaving a project closes the connections opened in it (one rule for the
// realtime editors, `lib/realtime-connections.ts`).
bindConnectionsToProject({
  store: useWebSocketStore,
  extract: extractState,
  api: getWsApi,
  closed: (sl, wasConnected) => ({
    ...sl,
    connectionState: 'disconnected' as const,
    messages: wasConnected
      ? [...sl.messages, systemRow('disconnected', 'project switched')]
      : sl.messages,
  }),
})
