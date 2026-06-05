import { useTabsStore } from '../stores/tabs.store'

/**
 * Flag the active tab as having unsaved changes (the blue dirty dot in the tab
 * strip / tree). Shared by the HTTP request store and every protocol store so
 * the indicator behaves consistently across request types — previously only the
 * HTTP editor was wired in, so SOAP / WebSocket / Socket.IO / GraphQL / gRPC /
 * SSE edits showed no unsaved-change signal (issue #8).
 *
 * Gated on the active tab being backed by a saved request / endpoint: a scratch
 * tab with no backing row has nothing to be "dirty" against, matching the HTTP
 * store's original behaviour.
 *
 * Lives in lib/ (not request.store) so the protocol stores can import it without
 * pulling in the whole request store — it only depends on the tabs store.
 */
export function markActiveTabDirty(): void {
  const { activeTabId, tabs, markDirty } = useTabsStore.getState()
  if (!activeTabId) return
  const tab = tabs.find((t) => t.id === activeTabId)
  if (tab?.endpointId || tab?.savedRequestId) {
    markDirty(activeTabId, true)
  }
}
