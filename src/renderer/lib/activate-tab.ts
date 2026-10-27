import { useTabsStore } from '../stores/tabs.store'
import { useRequestStore } from '../stores/request.store'
import { useSoapStore } from '../stores/soap.store'
import { useWebSocketStore } from '../stores/websocket.store'
import { useSseStore } from '../stores/sse.store'
import { useGrpcStore } from '../stores/grpc.store'
import { useGraphQLStore } from '../stores/graphql.store'
import { useAiChatStore } from '../stores/ai-chat.store'
import { useMcpStore } from '../stores/mcp.store'
import { useSocketIOStore } from '../stores/socketio.store'
import { useMqttStore } from '../stores/mqtt.store'
import { storedBoundTabs } from './persist-helpers'

interface TabbedSlices {
  getState: () => { _currentTabId: string | null; _tabStates: Map<string, unknown> }
}

/** The store that holds each protocol's own per-tab state (HTTP has none). */
const PROTOCOL_STORES: Record<string, TabbedSlices> = {
  soap: useSoapStore,
  websocket: useWebSocketStore,
  sse: useSseStore,
  grpc: useGrpcStore,
  graphql: useGraphQLStore,
  ai: useAiChatStore,
  mcp: useMcpStore,
  socketio: useSocketIOStore,
  mqtt: useMqttStore,
}

/**
 * Saved tabs whose protocol store slice was missing from its snapshot at
 * startup (a write that never reached disk, an older build). None of the
 * protocol stores drops a slice at runtime, so this is read once. On
 * activation the tab is flagged `unloadedProtocol` and its protocol state is
 * reloaded from the row with the request store's (`lib/withheld-credentials`)
 * — an empty default (e.g. the echo WebSocket URL) must never be saved over it.
 */
const protocolLostAtStartup = new Set(
  storedBoundTabs()
    .filter((t) => {
      const store = t.protocol ? PROTOCOL_STORES[t.protocol] : undefined
      if (!store) return false
      const s = store.getState()
      return s._currentTabId !== t.id && !s._tabStates.has(t.id)
    })
    .map((t) => t.id),
)

/** A tab unbound from its (deleted) row has no protocol slice to reload (issue #269). */
export function forgetProtocolLost(tabId: string): void {
  protocolLostAtStartup.delete(tabId)
}

/**
 * Point every protocol store's live slice at `tabId`.
 *
 * Each protocol store keeps its own per-tab cache; a tab it has never seen
 * falls back to that store's empty baseline. The list used to be copy-pasted
 * in four places inside `Workbench`, which is how the tab-switch path drifted
 * away from the others (issue #112).
 */
export function activateTabStores(tabId: string): void {
  useRequestStore.getState().switchToTab(tabId)
  useSoapStore.getState().switchToTab(tabId)
  useWebSocketStore.getState().switchToTab(tabId)
  useSseStore.getState().switchToTab(tabId)
  useGrpcStore.getState().switchToTab(tabId)
  useGraphQLStore.getState().switchToTab(tabId)
  useAiChatStore.getState().switchToTab(tabId)
  useMcpStore.getState().switchToTab(tabId)
  useSocketIOStore.getState().switchToTab(tabId)
  useMqttStore.getState().switchToTab(tabId)
  if (protocolLostAtStartup.delete(tabId)) useRequestStore.setState({ unloadedProtocol: true })
}

interface CloneableSlices {
  getState: () => { cloneTabState: (srcTabId: string, dstTabId: string) => void }
}

/**
 * The protocol stores Duplicate Tab copies. AI Chat is left out on purpose:
 * its slice is a conversation (an id shared by two tabs would write one
 * conversation from both) and a duplicate starts a new chat.
 */
const CLONEABLE_STORES: Record<string, CloneableSlices> = {
  soap: useSoapStore,
  websocket: useWebSocketStore,
  sse: useSseStore,
  grpc: useGrpcStore,
  graphql: useGraphQLStore,
  mcp: useMcpStore,
  socketio: useSocketIOStore,
  mqtt: useMqttStore,
}

/**
 * Duplicate Tab: copy `srcTabId`'s editor state onto `dstTabId` — the request
 * store (every protocol) and the tab protocol's own store. Unsaved edits
 * travel with the copy; connection and runtime state do not (the duplicate
 * starts disconnected). Works whether the destination is already the current
 * tab (a bound duplicate, opened from its new row first) or not yet (a
 * scratch duplicate, switched to afterwards).
 */
export function cloneTabStores(srcTabId: string, dstTabId: string, protocol?: string): void {
  useRequestStore.getState().cloneTabState(srcTabId, dstTabId)
  const store = protocol ? CLONEABLE_STORES[protocol] : undefined
  store?.getState().cloneTabState(srcTabId, dstTabId)
}

/**
 * Switch the whole workbench to `tabId`: protocol stores first, then the tab
 * itself.
 *
 * Deliberately does NOT touch the response store. Responses are keyed by tab
 * (issue #76), so the tab being activated already owns whatever it last
 * received and the tab being left keeps its own. The old tab-strip handler
 * called `clearResponse()` here, before `setActiveTab` had run — which aimed
 * it at the tab the user was *leaving* and wiped a response they had just
 * received (issue #112).
 */
export function switchActiveTab(tabId: string): void {
  activateTabStores(tabId)
  useTabsStore.getState().setActiveTab(tabId)
}
