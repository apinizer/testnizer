// Per-tab state cleanup helper, shared by every code path that closes a
// tab. Workbench's Ctrl+W handler / tab-X button / bulk-close action and
// AppShell's File → Close Tab menu must all route through this — otherwise
// closing via one path leaks the protocol-store slice (and any live
// WebSocket / SSE / gRPC subscription) while closing via another path
// cleans up correctly. Was previously a private function inside
// Workbench.tsx, but the v1.4.4 menu fix needs it from AppShell too.

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
 * Tear down state belonging to a tab being closed. Every protocol store
 * keeps a per-tab cache keyed on `tabId`; calling `removeTabState(tabId)`
 * disposes any live subscription/connection that tab owns.
 */
export function cleanupTabState(tabId: string): void {
  const allTabs = useTabsStore.getState().tabs
  const closing = allTabs.find((t) => t.id === tabId)
  if (!closing) return

  useRequestStore.getState().removeTabState(tabId)
  useSoapStore.getState().removeTabState(tabId)
  useWebSocketStore.getState().removeTabState(tabId)
  useSseStore.getState().removeTabState(tabId)
  useGrpcStore.getState().removeTabState(tabId)
  useGraphQLStore.getState().removeTabState(tabId)
  useAiChatStore.getState().removeTabState(tabId)
  useMcpStore.getState().removeTabState(tabId)
  useSocketIOStore.getState().removeTabState(tabId)
}

/**
 * Close a tab the safe way: prompt to confirm when there are unsaved
 * edits, tear down per-tab protocol state, then remove the tab. Returns
 * `true` if the tab was closed, `false` if the user cancelled.
 *
 * The dirty prompt is intentionally `window.confirm` (matching
 * Workbench's existing Ctrl+W path) — we don't want a custom modal here
 * because the user is closing a tab and probably wants instant feedback,
 * not another modal-on-modal interaction.
 */
export function closeTabSafely(tabId: string, options?: { force?: boolean }): boolean {
  const tabs = useTabsStore.getState()
  const target = tabs.tabs.find((t) => t.id === tabId)
  if (!target) return false
  if (!options?.force && target.isDirty) {
    const ok = window.confirm('This tab has unsaved changes. Close anyway?')
    if (!ok) return false
  }
  cleanupTabState(tabId)
  tabs.closeTab(tabId)
  return true
}
