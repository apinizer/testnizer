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
