import { create } from 'zustand'
import type { KeyValuePair, SseEvent } from '../types'
import { useEnvironmentStore } from './environment.store'
import { useWorkspaceStore } from './workspace.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { reloadWithheldBeforeSend } from '../lib/withheld-before-send'
import { cloneTabSlice } from '../lib/tab-clone'
import {
  credentialRows,
  trackCredentialEdits,
  withholdCredentials,
  type CredentialSpec,
  type WithheldState,
} from '../lib/credential-withhold'
import { urlCredentialText } from '../lib/credential-text'
import { makeId } from '../lib/utils'
import { t } from '../lib/i18n'
import { connectErrorText } from '../lib/connection-error'
// Shared dirty-flag helper — flags the active tab's blue dot on a user edit so
// the unsaved-change indicator works for SSE, not just HTTP (issue #8).
import { markActiveTabDirty } from '../lib/mark-dirty'

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export type SseHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type SseBodyType = 'json' | 'text'

function getSseApi() {
  return window.api?.sse
}

/** Snapshot of SSE state for per-tab caching. */
interface TabSseState extends WithheldState {
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
  /**
   * Still connected, but the client is reconnecting on its own: the server
   * ended the response (a finite stream does so just before its reconnect
   * gets HTTP 204) or a transient network error (issue #226). Cleared by the
   * next `open`, a terminal close and Connect / Disconnect.
   */
  reconnecting: boolean
  events: SseEvent[]
  connectedAt: number | null
  /** Per-tab subscription returned by `sse.onEvent`. */
  _unsubscribe?: () => void
  /**
   * Renderer-supplied id used to cancel an in-flight handshake before the
   * `open` event fires. Cleared on success / failure.
   */
  _pendingConnectId?: string
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
  /** Replace the header list outright. Used by snapshot/restore paths. */
  setHeaders: (headers: KeyValuePair[]) => void

  addEvent: (event: SseEvent) => void
  setConnectionState: (state: ConnectionState) => void
  setErrorMessage: (msg: string | null) => void

  getFilteredEvents: () => SseEvent[]
  getEventTypes: () => string[]

  /** Switch active tab — saves current state and loads target tab state. */
  /** Duplicate Tab: copy a tab's slice onto a new tab id, disconnected. */
  cloneTabState: (srcTabId: string, dstTabId: string) => void
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab. Tears down its `_unsubscribe`. */
  removeTabState: (tabId: string) => void

  reset: () => void
}

function emptyTabState(): TabSseState {
  return {
    withheldCredentials: [],
    // Empty like Socket.IO / MCP (issue #257): no third-party host the user
    // did not type. The field shows an example placeholder instead.
    url: '',
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
    reconnecting: false,
    events: [],
    connectedAt: null,
    _unsubscribe: undefined,
    _pendingConnectId: undefined,
  }
}

function extractState(s: SseStore): TabSseState {
  return {
    withheldCredentials: s.withheldCredentials,
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
    reconnecting: s.reconnecting,
    events: s.events,
    connectedAt: s.connectedAt,
    _unsubscribe: s._unsubscribe,
    _pendingConnectId: s._pendingConnectId,
  }
}

/**
 * On-disk view of a tab: what the user set up, never what the server sent.
 * Received events are server output (a stream may echo a token or personal
 * data) and the error text can quote them — like a response body they stay
 * in memory for the session and are not written to localStorage. The
 * connection itself does not survive a reload either, so it is stored as
 * disconnected instead of pointing at a connection that no longer exists.
 */
/**
 * Issue #244: credential-named SSE custom headers rows never hold a literal value in
 * the snapshot (the row and its name stay; `{{var}}`-only values are kept).
 * The saved row keeps the value — `lib/withheld-credentials.ts` reloads it.
 */
// Issue #247: `?token=…` / `user:pass@` in the stream URL too.
export const SSE_CREDENTIALS: CredentialSpec = {
  fields: [],
  rows: [credentialRows('customHeaders')],
  texts: [urlCredentialText('url')],
}

function persistableSse(st: TabSseState): TabSseState {
  return idleSse(withholdCredentials(st, SSE_CREDENTIALS))
}

/** A tab with no live connection or events — what is stored and what Duplicate Tab copies. */
function idleSse(st: TabSseState): TabSseState {
  const idle = emptyTabState()
  return {
    ...st,
    events: idle.events,
    errorMessage: idle.errorMessage,
    connectionId: idle.connectionId,
    connectionState: idle.connectionState,
    reconnecting: idle.reconnecting,
    connectedAt: idle.connectedAt,
    _unsubscribe: undefined,
    _pendingConnectId: undefined,
  }
}

const STORAGE_KEY = 'testnizer-sse'
const persisted = loadTabbedState<TabSseState>(STORAGE_KEY, emptyTabState, persistableSse)

export const useSseStore = create<SseStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,

  setUrl: (url) => {
    set({ url })
    markActiveTabDirty()
  },
  setMethod: (method) => {
    set({ method })
    markActiveTabDirty()
  },
  setBody: (body) => {
    set({ body })
    markActiveTabDirty()
  },
  setBodyType: (bodyType) => {
    set({ bodyType })
    markActiveTabDirty()
  },
  setLastEventId: (id) => {
    set({ lastEventId: id })
    markActiveTabDirty()
  },
  setEventTypeFilter: (filter) => {
    set({ eventTypeFilter: filter })
    markActiveTabDirty()
  },
  setAutoScroll: (auto) => {
    set({ autoScroll: auto })
    markActiveTabDirty()
  },

  connect: async () => {
    // Issue #244: a credential still withheld after a restart is reloaded first.
    if (get().withheldCredentials.length > 0) await reloadWithheldBeforeSend()
    const { url, customHeaders, lastEventId, method, body, bodyType } = get()
    if (!url.trim()) return

    const pendingConnectId = makeId()
    set({
      connectionState: 'connecting',
      errorMessage: null,
      reconnecting: false,
      events: [],
      _pendingConnectId: pendingConnectId,
    })

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
    /** Set once a terminal close has settled this connection's final state. */
    let closedByServer = false
    const unsub = sse.onEvent((evt) => {
      const expected = getOwnerConnectionId()
      if (expected && evt.connectionId !== expected) return

      switch (evt.type) {
        case 'open':
          applyToOwner({
            connectionState: 'connected',
            connectedAt: Date.now(),
            errorMessage: null,
            reconnecting: false,
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
          // Terminal (`closed`): nothing reconnects — leave "connected" for good.
          // A 204 (SSE spec: "stop reconnecting") or a clean end of stream is
          // the server finishing → disconnected; any other failure → error.
          if (evt.closed && getOwnerConnectionState() === 'connected') {
            closedByServer = true
            unsub()
            const ended = evt.closed === 'ended'
            applyToOwner({
              connectionState: ended ? 'disconnected' : 'error',
              reconnecting: false,
              connectionId: null,
              _unsubscribe: undefined,
              _pendingConnectId: undefined,
              errorMessage:
                evt.httpStatus === 204
                  ? t('sse.closedByServerStatus').replace('{status}', '204')
                  : ended
                    ? t('sse.closedByServer')
                    : connectErrorText(
                        { error: evt.data, errorInfo: evt.errorInfo },
                        t('sse.connectionError'),
                      ),
            })
            break
          }
          // The eventsource library reconnects automatically on transient
          // failures, so we only escalate to `error` while still connecting.
          // Once connected, the state stays (Disconnect keeps working) and the
          // tab reads "Reconnecting…" until the next open or a terminal close
          // (issue #226). The server ending the response is not a failure:
          // no message. A network error keeps its text for the record.
          if (getOwnerConnectionState() !== 'connected') {
            // Issue #253: `errorInfo` → the active locale's text with host:port.
            applyToOwner({
              connectionState: 'error',
              reconnecting: false,
              errorMessage: connectErrorText(
                { error: evt.data, errorInfo: evt.errorInfo },
                'SSE connection error',
              ),
            })
          } else {
            applyToOwner({
              reconnecting: true,
              errorMessage: evt.streamEnded
                ? null
                : connectErrorText({ error: evt.data, errorInfo: evt.errorInfo }, 'SSE error'),
            })
          }
          break
      }
    })
    set({ _unsubscribe: unsub })

    try {
      const wsStore = useWorkspaceStore.getState()
      const result = await sse.connect({
        url: resolvedUrl,
        headers: headerMap,
        lastEventId: resolvedLastEventId.trim() || undefined,
        method,
        body: sendBody ? resolvedBody : undefined,
        _workspaceId: wsStore.activeWorkspaceId || undefined,
        _projectId: wsStore.activeProjectId || undefined,
        _pendingId: pendingConnectId,
        // Editor state with `{{var}}` kept — the History row reopens from it
        // (issues #182, #195). Same shape `snapshotProtocol` saves.
        _configured: {
          url,
          meta: {
            sse: {
              url,
              method,
              body,
              bodyType,
              customHeaders,
              lastEventId,
              eventTypeFilter: get().eventTypeFilter,
            },
          },
        },
      })
      if (closedByServer) {
        // The stream already opened AND ended (a short finite stream can beat
        // this IPC reply) — the close handler set the final state.
      } else if (result?.success && result.data) {
        const newId = result.data.connectionId
        const current = get()
        if (current._currentTabId === ownerTabId) {
          set({
            connectionId: newId,
            // Keep the state set by the 'open' event when it has already fired.
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
          errorMessage: connectErrorText(result, 'SSE connection failed'),
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
    const sse = getSseApi()
    if (sse) {
      if (connectionState === 'connecting' && _pendingConnectId) {
        try {
          await sse.cancelConnect(_pendingConnectId)
        } catch {
          // Engine already finished the handshake — disconnect catches it.
        }
      }
      if (connectionId) {
        try {
          await sse.disconnect(connectionId)
        } catch {
          // engine already cleaned up — proceed to local reset
        }
      }
    }
    if (_unsubscribe) _unsubscribe()
    set({
      connectionState: 'disconnected',
      connectionId: null,
      // A user Disconnect clears the last reconnect / close message too.
      errorMessage: null,
      reconnecting: false,
      _unsubscribe: undefined,
      _pendingConnectId: undefined,
    })
  },

  reconnect: async () => {
    await get().disconnect()
    await get().connect()
  },

  clearEvents: () => set({ events: [] }),

  addHeader: () => {
    set((state) => ({ customHeaders: [...state.customHeaders, defaultKv()] }))
    markActiveTabDirty()
  },

  updateHeader: (id, updates) => {
    set((state) => ({
      customHeaders: state.customHeaders.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    }))
    markActiveTabDirty()
  },

  removeHeader: (id) => {
    set((state) => ({
      customHeaders: state.customHeaders.filter((h) => h.id !== id),
    }))
    markActiveTabDirty()
  },

  setHeaders: (headers) => {
    set({ customHeaders: headers })
    markActiveTabDirty()
  },

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

  cloneTabState: (srcTabId, dstTabId) =>
    cloneTabSlice(useSseStore, extractState, srcTabId, dstTabId, idleSse),

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

attachTabbedPersist(
  useSseStore,
  STORAGE_KEY,
  extractState,
  (s) => ({ _tabStates: s._tabStates, _currentTabId: s._currentTabId }),
  persistableSse,
)
// Issue #244: a user edit to a withheld value drops its marker.
trackCredentialEdits(useSseStore, SSE_CREDENTIALS)
