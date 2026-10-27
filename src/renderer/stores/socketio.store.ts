import { create } from 'zustand'
import type { KeyValuePair } from '../types'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { reloadWithheldBeforeSend } from '../lib/withheld-before-send'
import { useWorkspaceStore } from './workspace.store'
import { useEnvironmentStore } from './environment.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { makeId } from '../lib/utils'
import { socketioMaskedSendError } from '../lib/masked-send-guard'
// Shared dirty-flag helper — flags the active tab's blue dot on a user edit so
// the unsaved-change indicator works for Socket.IO, not just HTTP (issue #8).
import { markActiveTabDirty } from '../lib/mark-dirty'
import { isTemplateOnlyValue } from '../lib/ai-chat-config'
import {
  credentialRows,
  trackCredentialEdits,
  withholdCredentials,
  type CredentialSpec,
  type WithheldState,
} from '../lib/credential-withhold'
import { urlCredentialText } from '../lib/credential-text'
import { isCredentialArgName } from '../../shared/credential-headers'
import { applyParamsToUrl, mergeParamsFromUrl } from '../lib/url-query-sync'
import {
  DEFAULT_SIO_SETTINGS,
  type SioArg,
  type SioListenConfig,
  type SioListener,
  type SioSavedMessage,
  type SioSettings,
} from '../../shared/realtime'
import { readSioMeta, sioMetaOf, type SioRequestFields } from '../lib/realtime-meta'
import { savedMessageFromTimeline } from '../lib/socketio-timeline'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * One timeline row. `in` / `out` events, `ack` (the server's acknowledgement
 * of an emit, `error` when none came in time) and `system` rows: `connected`,
 * `disconnected` (data = reason), `error` (data = message) written here, and
 * `reconnecting` / `reconnect_attempt` / `reconnected` from the engine.
 */
export interface SocketIOEvent {
  id: string
  direction: 'in' | 'out' | 'ack' | 'system'
  event: string
  data: unknown
  /** Set when the event carried other than exactly one argument. */
  args?: unknown[]
  error?: string
  timestamp: number
}

function getSioApi() {
  return window.api?.socketio
}

interface TabSioState extends WithheldState, SioRequestFields {
  /**
   * Issue #243: the literal bearer token was left out of the localStorage
   * snapshot this tab was restored from. Distinct from "the user cleared it":
   * the token may still be on the saved row, and an untouched empty field
   * must not overwrite it on Ctrl+S (`lib/withheld-credentials.ts` reloads it
   * from the row). Any explicit set clears the flag.
   */
  bearerTokenWithheld: boolean
  connectionId: string | null
  connectionState: ConnectionState
  errorMessage: string | null
  events: SocketIOEvent[]
  /** The Events tab's "add event" text box — not part of the saved request. */
  newListener: string
  /** The saved message the composer was loaded from; Save updates it in place. */
  activeSavedMessageId: string | null
  /** Renderer-supplied id so a stalled handshake can be cancelled. */
  _pendingConnectId?: string
  /** Push subscriptions of this tab's connection (events + closed). */
  _unsubscribe?: () => void
}

interface SocketIOStore extends TabSioState {
  _tabStates: Map<string, TabSioState>
  _currentTabId: string | null

  setUrl: (url: string) => void
  setNamespace: (ns: string) => void
  setBearerToken: (token: string) => void
  setEmitEvent: (name: string) => void
  setEmitAck: (ack: boolean) => void
  addArg: () => void
  updateArg: (id: string, patch: Partial<Omit<SioArg, 'id'>>) => void
  removeArg: (id: string) => void
  setHeaders: (rows: KeyValuePair[]) => void
  addHeader: () => void
  updateHeader: (id: string, patch: Partial<KeyValuePair>) => void
  removeHeader: (id: string) => void
  setParams: (rows: KeyValuePair[]) => void
  addParam: () => void
  updateParam: (id: string, patch: Partial<KeyValuePair>) => void
  removeParam: (id: string) => void
  setSettings: (patch: Partial<SioSettings>) => void
  setNewListener: (name: string) => void
  addListener: () => void
  updateListener: (id: string, patch: Partial<Omit<SioListener, 'id'>>) => void
  removeListener: (id: string) => void
  setListenAll: (all: boolean) => void
  saveCurrentMessage: () => void
  /** `name`: the new message's name (the editor passes a translated default). */
  addSavedMessage: (name?: string) => void
  loadSavedMessage: (id: string) => void
  renameSavedMessage: (id: string, name: string) => void
  deleteSavedMessage: (id: string) => void
  saveTimelineEntry: (entryId: string) => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  emit: () => Promise<void>
  clearEvents: () => void
  switchToTab: (tabId: string) => void
  removeTabState: (tabId: string) => void
  /** Whether `tabId`'s slice still waits for its withheld token (issue #243). */
  isTokenWithheld: (tabId: string) => boolean
  /**
   * Put a token reloaded from the saved row on `tabId`'s slice (live or
   * cached) and clear the withheld flag. A no-op when the flag is no longer
   * set — the user typed (or cleared) the field meanwhile, and that wins.
   * Not a user edit: the dirty dot is left alone.
   */
  applyRestoredToken: (tabId: string, token: string) => void
}

function kv(): KeyValuePair {
  return { id: makeId(), key: '', value: '', enabled: true }
}

function emptyState(): TabSioState {
  return {
    url: '',
    namespace: '/',
    bearerToken: '',
    bearerTokenWithheld: false,
    withheldCredentials: [],
    customHeaders: [kv()],
    params: [],
    settings: { ...DEFAULT_SIO_SETTINGS },
    listeners: [],
    // A NEW request follows Postman: only listened events are shown. A
    // request saved before listeners existed reopens with `listenAll: true`
    // (`readSioMeta`) — what it did then.
    listenAll: false,
    emitEvent: 'message',
    emitArgs: [{ id: makeId(), content: '{}', contentType: 'json' }],
    emitAck: false,
    savedMessages: [],
    activeSavedMessageId: null,
    connectionId: null,
    connectionState: 'disconnected',
    errorMessage: null,
    events: [],
    newListener: '',
    _pendingConnectId: undefined,
    _unsubscribe: undefined,
  }
}

function extractState(s: SocketIOStore): TabSioState {
  return {
    url: s.url,
    namespace: s.namespace,
    bearerToken: s.bearerToken,
    bearerTokenWithheld: s.bearerTokenWithheld,
    withheldCredentials: s.withheldCredentials,
    customHeaders: s.customHeaders,
    params: s.params,
    settings: s.settings,
    listeners: s.listeners,
    listenAll: s.listenAll,
    emitEvent: s.emitEvent,
    emitArgs: s.emitArgs,
    emitAck: s.emitAck,
    savedMessages: s.savedMessages,
    activeSavedMessageId: s.activeSavedMessageId,
    connectionId: s.connectionId,
    connectionState: s.connectionState,
    errorMessage: s.errorMessage,
    events: s.events,
    newListener: s.newListener,
    _pendingConnectId: s._pendingConnectId,
    _unsubscribe: s._unsubscribe,
  }
}

/**
 * Issue #247 / #283: credential-named handshake headers and query params, and
 * `?token=…` / `user:pass@` in the connection URL, never reach the snapshot —
 * the generic marker (`lib/credential-withhold.ts`). The bearer token keeps
 * its own flag (issue #243).
 */
export const SIO_CREDENTIALS: CredentialSpec = {
  fields: [],
  rows: [
    credentialRows('customHeaders'),
    { list: 'params', isCredentialName: isCredentialArgName },
  ],
  texts: [urlCredentialText('url')],
}

/**
 * A tab snapshot an older build wrote (`subscriptions`, `emitPayload`) →
 * today's fields, with that build's behaviour: every event shown.
 */
function migrateLegacyTab(st: TabSioState): TabSioState {
  const raw = st as unknown as Record<string, unknown>
  if (!('subscriptions' in raw) && !('emitPayload' in raw)) return st
  // Only the legacy keys: the loader already merged today's defaults in.
  const read = readSioMeta({ subscriptions: raw.subscriptions, emitPayload: raw.emitPayload })
  const { subscriptions: _s, emitPayload: _p, newSubscription: _n, ...rest } = raw
  void _s
  void _p
  void _n
  return {
    ...(rest as unknown as TabSioState),
    listeners: read.listeners ?? [],
    listenAll: true,
    ...(read.emitArgs ? { emitArgs: read.emitArgs } : {}),
  }
}

/**
 * On-disk view of a tab: the request fields and drafts — never the event
 * timeline (server output, and resolved outgoing payloads) or the error text.
 * Both stay in memory for the session. The connection does not survive a
 * reload, so it is stored as disconnected.
 *
 * The bearer token is write-only on disk (issue #243), like the key-material
 * passwords: a literal token stays in memory for the session (a tab switch
 * keeps it) but is stored as `''` plus `bearerTokenWithheld`. A token that is
 * only `{{variable}}` references carries no secret and is stored as typed —
 * the same rule as AI Chat's credential headers. Also applied on load, so a
 * snapshot an older build wrote with the token is cleaned at once.
 */
function persistableSio(input: TabSioState): TabSioState {
  const st = migrateLegacyTab(input)
  const idle = emptyState()
  const literalToken = st.bearerToken !== '' && !isTemplateOnlyValue(st.bearerToken)
  return {
    ...withholdCredentials(st, SIO_CREDENTIALS),
    bearerToken: literalToken ? '' : st.bearerToken,
    // Still withheld when a restored tab is written again before its token
    // came back from the saved row.
    bearerTokenWithheld: literalToken || (st.bearerTokenWithheld && st.bearerToken === ''),
    events: idle.events,
    errorMessage: idle.errorMessage,
    connectionId: idle.connectionId,
    connectionState: idle.connectionState,
    _pendingConnectId: undefined,
    _unsubscribe: undefined,
  }
}

const STORAGE_KEY = 'testnizer-socketio'
const persisted = loadTabbedState<TabSioState>(STORAGE_KEY, emptyState, persistableSio)

/** What the engine forwards for this slice (names `{{var}}`-resolved). */
function listenConfigOf(s: SioRequestFields, vars: Record<string, string>): SioListenConfig {
  return {
    all: s.listenAll,
    events: s.listeners
      .filter((l) => l.listen && l.name.trim())
      .map((l) => resolveVariables(l.name.trim(), vars)),
  }
}

function systemRow(event: string, data: unknown): SocketIOEvent {
  return { id: makeId(), direction: 'system', event, data, timestamp: Date.now() }
}

export const useSocketIOStore = create<SocketIOStore>((set, get) => {
  /** Read `tabId`'s slice, live or cached. */
  const sliceOf = (tabId: string | null): TabSioState | undefined => {
    const s = get()
    if (s._currentTabId === tabId) return s
    return tabId === null ? undefined : s._tabStates.get(tabId)
  }
  /** Patch `tabId`'s slice wherever it lives (issue #76: async writers name their tab). */
  const patchTab = (
    tabId: string | null,
    patch: (slice: TabSioState) => Partial<TabSioState> | null,
  ): void => {
    const s = get()
    if (s._currentTabId === tabId) {
      const p = patch(s)
      if (p) set(p as Partial<SocketIOStore>)
      return
    }
    if (tabId === null) return
    const cached = s._tabStates.get(tabId)
    if (!cached) return
    const p = patch(cached)
    if (!p) return
    const map = new Map(s._tabStates)
    map.set(tabId, { ...cached, ...p })
    set({ _tabStates: map })
  }
  /** Push the live slice's listen config to its connection (Events tab edit while connected). */
  const syncListen = (): void => {
    const s = get()
    if (!s.connectionId) return
    const vars = useEnvironmentStore.getState().getActiveVariables()
    void getSioApi()?.setListen?.(s.connectionId, listenConfigOf(s, vars))
  }
  const edit = (patch: Partial<TabSioState>): void => {
    set(patch as Partial<SocketIOStore>)
    markActiveTabDirty()
  }

  return {
    ...persisted.current,
    _tabStates: persisted._tabStates,
    _currentTabId: persisted._currentTabId,
    // transient — never restored from disk
    connectionId: null,
    connectionState: 'disconnected',
    errorMessage: null,
    events: [],
    _unsubscribe: undefined,

    setUrl: (url) => edit({ url, params: mergeParamsFromUrl(url, get().params) }),
    setNamespace: (namespace) => edit({ namespace }),
    setBearerToken: (bearerToken) => edit({ bearerToken, bearerTokenWithheld: false }),
    setEmitEvent: (emitEvent) => edit({ emitEvent }),
    setEmitAck: (emitAck) => edit({ emitAck }),
    addArg: () =>
      edit({ emitArgs: [...get().emitArgs, { id: makeId(), content: '', contentType: 'text' }] }),
    updateArg: (id, patch) =>
      edit({ emitArgs: get().emitArgs.map((a) => (a.id === id ? { ...a, ...patch } : a)) }),
    removeArg: (id) => edit({ emitArgs: get().emitArgs.filter((a) => a.id !== id) }),

    setHeaders: (customHeaders) => edit({ customHeaders }),
    addHeader: () => edit({ customHeaders: [...get().customHeaders, kv()] }),
    updateHeader: (id, patch) =>
      edit({
        customHeaders: get().customHeaders.map((h) => (h.id === id ? { ...h, ...patch } : h)),
      }),
    removeHeader: (id) => edit({ customHeaders: get().customHeaders.filter((h) => h.id !== id) }),

    setParams: (params) => edit({ params, url: applyParamsToUrl(get().url, params) }),
    addParam: () => {
      const params = [...get().params, kv()]
      edit({ params, url: applyParamsToUrl(get().url, params) })
    },
    updateParam: (id, patch) => {
      const params = get().params.map((p) => (p.id === id ? { ...p, ...patch } : p))
      edit({ params, url: applyParamsToUrl(get().url, params) })
    },
    removeParam: (id) => {
      const params = get().params.filter((p) => p.id !== id)
      edit({ params, url: applyParamsToUrl(get().url, params) })
    },

    setSettings: (patch) => edit({ settings: { ...get().settings, ...patch } }),

    // The text box is a draft — it does not dirty the tab.
    setNewListener: (newListener) => set({ newListener }),
    addListener: () => {
      const name = get().newListener.trim()
      if (!name || get().listeners.some((l) => l.name === name)) return
      edit({
        listeners: [...get().listeners, { id: makeId(), name, description: '', listen: true }],
        newListener: '',
      })
      syncListen()
    },
    updateListener: (id, patch) => {
      edit({ listeners: get().listeners.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
      syncListen()
    },
    removeListener: (id) => {
      edit({ listeners: get().listeners.filter((l) => l.id !== id) })
      syncListen()
    },
    setListenAll: (listenAll) => {
      edit({ listenAll })
      syncListen()
    },

    saveCurrentMessage: () => {
      const s = get()
      const body = {
        eventName: s.emitEvent,
        acknowledgement: s.emitAck,
        args: s.emitArgs.map((a) => ({ ...a })),
      }
      const existing = s.savedMessages.find((m) => m.id === s.activeSavedMessageId)
      if (existing) {
        edit({
          savedMessages: s.savedMessages.map((m) => (m.id === existing.id ? { ...m, ...body } : m)),
        })
        return
      }
      const msg: SioSavedMessage = { id: makeId(), name: s.emitEvent.trim() || 'message', ...body }
      edit({ savedMessages: [...s.savedMessages, msg], activeSavedMessageId: msg.id })
    },
    addSavedMessage: (name) => {
      const msg: SioSavedMessage = {
        id: makeId(),
        name: name ?? `Message ${get().savedMessages.length + 1}`,
        eventName: 'message',
        acknowledgement: false,
        args: [{ id: makeId(), content: '', contentType: 'text' }],
      }
      edit({
        savedMessages: [...get().savedMessages, msg],
        activeSavedMessageId: msg.id,
        emitEvent: msg.eventName,
        emitAck: false,
        emitArgs: msg.args.map((a) => ({ ...a })),
      })
    },
    loadSavedMessage: (id) => {
      const msg = get().savedMessages.find((m) => m.id === id)
      if (!msg) return
      edit({
        activeSavedMessageId: id,
        emitEvent: msg.eventName,
        emitAck: msg.acknowledgement,
        emitArgs: msg.args.map((a) => ({ ...a, id: makeId() })),
      })
    },
    renameSavedMessage: (id, name) =>
      edit({ savedMessages: get().savedMessages.map((m) => (m.id === id ? { ...m, name } : m)) }),
    deleteSavedMessage: (id) =>
      edit({
        savedMessages: get().savedMessages.filter((m) => m.id !== id),
        activeSavedMessageId: get().activeSavedMessageId === id ? null : get().activeSavedMessageId,
      }),
    saveTimelineEntry: (entryId) => {
      const entry = get().events.find((e) => e.id === entryId)
      if (!entry || (entry.direction !== 'in' && entry.direction !== 'out')) return
      edit({ savedMessages: [...get().savedMessages, savedMessageFromTimeline(entry)] })
    },

    connect: async () => {
      // Issue #244: a credential still withheld after a restart is reloaded first.
      if (get().bearerTokenWithheld || get().withheldCredentials.length > 0) {
        await reloadWithheldBeforeSend()
      }
      const start = get()
      const { url, namespace, bearerToken } = start
      if (!url.trim()) return
      const headers = start.customHeaders.filter((h) => h.enabled && h.key.trim())
      // Issue #195: a History mask left in a credential field is never sent.
      const maskedConnect = socketioMaskedSendError({
        url,
        bearerToken,
        customHeaders: headers,
        params: start.params.filter((p) => p.enabled),
      })
      if (maskedConnect) {
        set({ connectionState: 'error', errorMessage: maskedConnect })
        return
      }
      const api = getSioApi()
      if (!api) {
        set({ connectionState: 'error', errorMessage: 'API not available' })
        return
      }
      const ownerTabId = start._currentTabId
      const pendingConnectId = makeId()
      start._unsubscribe?.()
      set({
        connectionState: 'connecting',
        errorMessage: null,
        events: [],
        _pendingConnectId: pendingConnectId,
        _unsubscribe: undefined,
      })

      // Resolve `{{var}}` in URL / namespace / token / headers so users can
      // share connection details via env (`wss://{{host}}/ws`, `Bearer
      // {{authToken}}`) — the HTTP / SOAP / GraphQL Send behaviour. Params
      // are already part of the URL (URL ⇄ Params sync).
      const vars = useEnvironmentStore.getState().getActiveVariables()
      const resolvedUrl = resolveVariables(url, vars)
      const resolvedNamespace = resolveVariables(namespace || '/', vars)
      const resolvedToken = resolveVariables(bearerToken || '', vars)
      const extraHeaders: Record<string, string> = {}
      for (const row of resolveKeyValuePairs(headers, vars)) extraHeaders[row.key] = row.value

      // Subscribe BEFORE awaiting connect: main flushes connect-time pushes
      // (a server `welcome`, an immediate kick) before the connect reply
      // arrives. Until the id is known they wait in `early`.
      let connId: string | null = null
      const early: Array<() => void> = []
      const append = (row: SocketIOEvent): void =>
        patchTab(ownerTabId, (sl) =>
          sl.connectionId === connId ? { events: [...sl.events, row] } : null,
        )
      const onEvent = (raw: unknown): void => {
        const e = raw as { connectionId: string } & Omit<SocketIOEvent, 'id'>
        const deliver = (): void => {
          if (e.connectionId !== connId) return
          append({
            id: makeId(),
            direction: e.direction,
            event: e.event,
            data: e.data,
            ...(e.args ? { args: e.args } : {}),
            ...(e.error ? { error: e.error } : {}),
            timestamp: e.timestamp,
          })
        }
        if (connId === null) early.push(deliver)
        else deliver()
      }
      const onClosed = (raw: unknown): void => {
        const c = raw as { connectionId: string; reason?: string }
        const deliver = (): void => {
          if (c.connectionId !== connId) return
          // Issue #275: the server ended the connection. The request config
          // stays (like a user disconnect, issue #21); only the connection
          // state is cleared.
          unsubscribe()
          patchTab(ownerTabId, (sl) =>
            sl.connectionId === connId
              ? {
                  connectionState: 'disconnected',
                  connectionId: null,
                  _unsubscribe: undefined,
                  events: [...sl.events, systemRow('disconnected', c.reason ?? '')],
                }
              : null,
          )
        }
        if (connId === null) early.push(deliver)
        else deliver()
      }
      const offEvent = api.onEvent(onEvent)
      const offClosed = api.onClosed?.(onClosed)
      const unsubscribe = (): void => {
        offEvent()
        offClosed?.()
      }
      patchTab(ownerTabId, () => ({ _unsubscribe: unsubscribe }))

      const ws = useWorkspaceStore.getState()
      const res = await api.connect({
        url: resolvedUrl,
        namespace: resolvedNamespace || '/',
        auth: resolvedToken ? { token: resolvedToken } : undefined,
        extraHeaders,
        settings: { ...start.settings, path: resolveVariables(start.settings.path, vars) },
        listen: listenConfigOf(start, vars),
        _workspaceId: ws.activeWorkspaceId || undefined,
        _projectId: ws.activeProjectId || undefined,
        _pendingId: pendingConnectId,
        // Editor state with `{{var}}` kept — the History row reopens from it
        // (issues #182, #195). The same block `snapshotProtocol` saves.
        _configured: { url, meta: { socketio: sioMetaOf(start) } },
      })

      if (res.success && res.data) {
        connId = res.data.connectionId
        patchTab(ownerTabId, (sl) => ({
          connectionId: connId,
          connectionState: 'connected',
          errorMessage: null,
          _pendingConnectId: undefined,
          events: [...sl.events, systemRow('connected', resolvedUrl)],
        }))
        for (const run of early.splice(0)) run()
      } else {
        unsubscribe()
        const message = res.error ?? 'Connection failed'
        // A user Cancel cleared the pending id first: the rejection it causes
        // is not an error to show.
        patchTab(ownerTabId, (sl) =>
          sl._pendingConnectId === pendingConnectId
            ? {
                connectionState: 'error',
                errorMessage: message,
                _pendingConnectId: undefined,
                _unsubscribe: undefined,
                events: [...sl.events, systemRow('error', message)],
              }
            : null,
        )
      }
      // Logging is done in main (src/main/ipc/socketio.handler.ts) so all
      // protocols funnel through the same console:log channel.
    },

    disconnect: async () => {
      const { connectionId, _unsubscribe, _pendingConnectId, connectionState } = get()
      // Cleared before the engine is told: its cancelled connect then fails
      // with nothing left to mark as an error.
      set({ _pendingConnectId: undefined })
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
      _unsubscribe?.()
      // Disconnect tears down the connection, not the request configuration
      // (issue #21): only the transient connection state is cleared. The
      // timeline stays, with a closing system row.
      const wasOpen = connectionId !== null
      set((s) => ({
        connectionId: null,
        connectionState: 'disconnected',
        errorMessage: null,
        _pendingConnectId: undefined,
        _unsubscribe: undefined,
        events: wasOpen
          ? [...s.events, systemRow('disconnected', 'io client disconnect')]
          : s.events,
      }))
    },

    emit: async () => {
      const s = get()
      const { connectionId } = s
      if (!connectionId) return
      // Issue #195: a History mask left in a credential field is never sent.
      const maskedEmit = socketioMaskedSendError({ emitArgs: s.emitArgs.map((a) => a.content) })
      if (maskedEmit) {
        set({ errorMessage: maskedEmit })
        return
      }
      set({ errorMessage: null })
      const ownerTabId = s._currentTabId
      const vars = useEnvironmentStore.getState().getActiveVariables()
      // Postman: an empty event name sends `message`.
      const eventName = resolveVariables(s.emitEvent.trim() || 'message', vars)
      const args = s.emitArgs.map((a) => ({
        content: resolveVariables(a.content, vars),
        contentType: a.contentType,
      }))
      const api = getSioApi()
      if (!api) return
      const res = await api.emitArgs(connectionId, eventName, args, { ack: s.emitAck })
      if (!res?.success) {
        patchTab(ownerTabId, () => ({ errorMessage: res?.error ?? 'Emit failed' }))
      }
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
      const slice = sliceOf(tabId)
      if (slice?.connectionId) {
        getSioApi()
          ?.disconnect(slice.connectionId)
          .catch(() => {})
      }
      slice?._unsubscribe?.()
      if (get()._currentTabId === tabId) {
        set({ connectionId: null, connectionState: 'disconnected', _unsubscribe: undefined })
      }
      const tabStates = new Map(get()._tabStates)
      tabStates.delete(tabId)
      set({ _tabStates: tabStates })
    },

    isTokenWithheld: (tabId) => sliceOf(tabId)?.bearerTokenWithheld ?? false,

    applyRestoredToken: (tabId, token) => {
      patchTab(tabId, (sl) =>
        sl.bearerTokenWithheld ? { bearerToken: token, bearerTokenWithheld: false } : null,
      )
    },
  }
})

attachTabbedPersist(
  useSocketIOStore,
  STORAGE_KEY,
  extractState,
  (s) => ({ _tabStates: s._tabStates, _currentTabId: s._currentTabId }),
  persistableSio,
)
// Issue #247: a user edit to a withheld URL / header / param drops its marker.
trackCredentialEdits(useSocketIOStore, SIO_CREDENTIALS)
