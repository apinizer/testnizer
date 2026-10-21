import { create } from 'zustand'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { reloadWithheldBeforeSend } from '../lib/withheld-before-send'
import { useWorkspaceStore } from './workspace.store'
import { useEnvironmentStore } from './environment.store'
import { resolveVariables } from '../lib/variable-resolver'
import { makeId } from '../lib/utils'
import { socketioMaskedSendError } from '../lib/masked-send-guard'
// Shared dirty-flag helper — flags the active tab's blue dot on a user edit so
// the unsaved-change indicator works for Socket.IO, not just HTTP (issue #8).
import { markActiveTabDirty } from '../lib/mark-dirty'
import { isTemplateOnlyValue } from '../lib/ai-chat-config'
import {
  trackCredentialEdits,
  withholdCredentials,
  type CredentialSpec,
  type WithheldState,
} from '../lib/credential-withhold'
import { urlCredentialText } from '../lib/credential-text'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SocketIOEvent {
  direction: 'in' | 'out'
  event: string
  data: unknown
  timestamp: number
}

function getSioApi() {
  return window.api?.socketio
}

interface TabSioState extends WithheldState {
  url: string
  namespace: string
  bearerToken: string
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

function emptyState(): TabSioState {
  return {
    url: '',
    namespace: '/',
    bearerToken: '',
    bearerTokenWithheld: false,
    withheldCredentials: [],
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
    bearerTokenWithheld: s.bearerTokenWithheld,
    withheldCredentials: s.withheldCredentials,
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

/**
 * On-disk view of a tab: URL, namespace, subscriptions and the emit draft —
 * never the event timeline (server output, and resolved outgoing payloads)
 * or the error text. Both stay in memory for the session. The connection
 * does not survive a reload, so it is stored as disconnected.
 *
 * The bearer token is write-only on disk (issue #243), like the key-material
 * passwords: a literal token stays in memory for the session (a tab switch
 * keeps it) but is stored as `''` plus `bearerTokenWithheld`. A token that is
 * only `{{variable}}` references carries no secret and is stored as typed —
 * the same rule as AI Chat's credential headers. Also applied on load, so a
 * snapshot an older build wrote with the token is cleaned at once.
 */
function persistableSio(st: TabSioState): TabSioState {
  const idle = emptyState()
  const literalToken = st.bearerToken !== '' && !isTemplateOnlyValue(st.bearerToken)
  return {
    // Issue #247: `?token=…` / `user:pass@` in the connection URL — the
    // generic marker (`lib/credential-withhold.ts`); the bearer token keeps
    // its own flag (issue #243).
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
  }
}

export const SIO_CREDENTIALS: CredentialSpec = {
  fields: [],
  rows: [],
  texts: [urlCredentialText('url')],
}

const STORAGE_KEY = 'testnizer-socketio'
const persisted = loadTabbedState<TabSioState>(STORAGE_KEY, emptyState, persistableSio)

export const useSocketIOStore = create<SocketIOStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,
  // transient — never restored from disk
  connectionId: null,
  connectionState: 'disconnected',
  errorMessage: null,
  events: [],

  setUrl: (url) => {
    set({ url })
    markActiveTabDirty()
  },
  setNamespace: (namespace) => {
    set({ namespace })
    markActiveTabDirty()
  },
  setBearerToken: (bearerToken) => {
    set({ bearerToken, bearerTokenWithheld: false })
    markActiveTabDirty()
  },
  setEmitEvent: (emitEvent) => {
    set({ emitEvent })
    markActiveTabDirty()
  },
  setEmitPayload: (emitPayload) => {
    set({ emitPayload })
    markActiveTabDirty()
  },
  // `newSubscription` is the in-progress text box — not part of the saved
  // snapshot (only confirmed `subscriptions` are), so it doesn't dirty the tab.
  setNewSubscription: (newSubscription) => set({ newSubscription }),

  connect: async () => {
    // Issue #244: a credential still withheld after a restart is reloaded first.
    if (get().bearerTokenWithheld || get().withheldCredentials.length > 0) {
      await reloadWithheldBeforeSend()
    }
    const { url, namespace, bearerToken } = get()
    if (!url.trim()) return
    // Issue #195: a History mask left in a credential field is never sent.
    const maskedConnect = socketioMaskedSendError({ url, bearerToken })
    if (maskedConnect) {
      set({ connectionState: 'error', errorMessage: maskedConnect })
      return
    }
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
      // Editor state with `{{var}}` kept — the History row reopens from it
      // (issues #182, #195). Same shape `snapshotProtocol` saves.
      _configured: {
        url,
        meta: {
          socketio: {
            url,
            namespace,
            bearerToken,
            subscriptions: get().subscriptions,
            emitEvent: get().emitEvent,
            emitPayload: get().emitPayload,
          },
        },
      },
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
    // Disconnect tears down the connection, not the request configuration.
    // Previously this reset to emptyState() and only kept url/namespace/
    // bearerToken, so the configured emit event/payload and subscriptions were
    // wiped on every connect→disconnect cycle (issue #21). Preserve all the
    // request-model fields; only the transient connection state is cleared.
    const cur = get()
    set({
      ...emptyState(),
      url: cur.url,
      namespace: cur.namespace,
      bearerToken: cur.bearerToken,
      bearerTokenWithheld: cur.bearerTokenWithheld,
      withheldCredentials: cur.withheldCredentials,
      emitEvent: cur.emitEvent,
      emitPayload: cur.emitPayload,
      subscriptions: cur.subscriptions,
      newSubscription: cur.newSubscription,
    })
  },

  emit: async () => {
    const { connectionId, emitEvent, emitPayload } = get()
    if (!connectionId || !emitEvent.trim()) return
    // Issue #195: a History mask left in a credential field is never sent.
    const maskedEmit = socketioMaskedSendError({ emitPayload })
    if (maskedEmit) {
      set({ errorMessage: maskedEmit })
      return
    }
    set({ errorMessage: null })
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

  isTokenWithheld: (tabId) => {
    const state = get()
    if (state._currentTabId === tabId) return state.bearerTokenWithheld
    return state._tabStates.get(tabId)?.bearerTokenWithheld ?? false
  },

  applyRestoredToken: (tabId, token) => {
    const state = get()
    if (state._currentTabId === tabId) {
      if (state.bearerTokenWithheld) set({ bearerToken: token, bearerTokenWithheld: false })
      return
    }
    const cached = state._tabStates.get(tabId)
    if (!cached?.bearerTokenWithheld) return
    const tabStates = new Map(state._tabStates)
    tabStates.set(tabId, { ...cached, bearerToken: token, bearerTokenWithheld: false })
    set({ _tabStates: tabStates })
  },
}))

attachTabbedPersist(
  useSocketIOStore,
  STORAGE_KEY,
  extractState,
  (s) => ({ _tabStates: s._tabStates, _currentTabId: s._currentTabId }),
  persistableSio,
)
// Issue #247: a user edit to a withheld URL drops its marker.
trackCredentialEdits(useSocketIOStore, SIO_CREDENTIALS)
