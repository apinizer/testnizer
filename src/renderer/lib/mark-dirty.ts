import { useTabsStore } from '../stores/tabs.store'
import { isToolProtocol } from '../types'
import type { Tab } from '../types'

/**
 * Can this tab hold unsaved request edits at all?
 *
 * True for any tab backed by a persisted row (endpoint / saved request /
 * test-suite item — those have an in-place save path), and for scratch tabs
 * whose protocol is a regular request protocol (http, soap, websocket,
 * graphql, grpc, sse, ai, mcp, socketio — those save via the "Save As"
 * EndpointSaveModal). False for Tools tabs, the Runner tab and the Mock
 * Server editor: they carry no request to be dirty against (the mock editor
 * has its own save flow).
 *
 * Shared with the Ctrl+S handler in `keyboard-shortcuts.ts` — keep ONE
 * request-tab predicate so the dirty dot, the close confirm and the save
 * routing can never disagree about what counts as a request tab.
 */
export function isRequestLikeTab(
  tab: Pick<Tab, 'protocol' | 'endpointId' | 'savedRequestId' | 'testSuiteItemId'>,
): boolean {
  if (tab.endpointId || tab.savedRequestId || tab.testSuiteItemId) return true
  return !isToolProtocol(tab.protocol) && tab.protocol !== 'runner' && tab.protocol !== 'mockServer'
}

/**
 * Flag the active tab as having unsaved changes (the blue dirty dot in the tab
 * strip / tree). Shared by the HTTP request store and every protocol store so
 * the indicator behaves consistently across request types — previously only the
 * HTTP editor was wired in, so SOAP / WebSocket / Socket.IO / GraphQL / gRPC /
 * SSE edits showed no unsaved-change signal (issue #8).
 *
 * Applies to every request-like tab, INCLUDING brand-new tabs with no backing
 * row yet (New → HTTP etc.). The old gate — "only endpoint / saved-request
 * backed tabs" — meant a fresh tab could never turn dirty, so closing it
 * silently discarded the edits with no dot and no confirm dialog (issue #101).
 * Non-request tabs (Tools / Runner / Mock Server) are still never flagged.
 *
 * Lives in lib/ (not request.store) so the protocol stores can import it without
 * pulling in the whole request store — it only depends on the tabs store.
 */
export function markActiveTabDirty(): void {
  const { activeTabId, tabs, markDirty } = useTabsStore.getState()
  if (!activeTabId) return
  const tab = tabs.find((t) => t.id === activeTabId)
  if (tab && isRequestLikeTab(tab)) {
    markDirty(activeTabId, true)
  }
}
