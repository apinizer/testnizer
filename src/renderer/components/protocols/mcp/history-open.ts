/**
 * ONE way to put an MCP History row on a tab — the History sidebar and the
 * welcome page's recent list both call it (review item 10; they used to
 * differ: the welcome list opened MCP rows as a blank HTTP-ish tab). The tab
 * must already be open and active; the MCP store switches to it FIRST so the
 * restore lands there, not on the previous tab (issue #76 class).
 */
import { restoreMcpCall, useMcpStore } from '../../../stores/mcp.store'
import { useResponseStore } from '../../../stores/response.store'
import { normalizeMcpProtocol } from '../../../lib/mcp-protocol'
import type { McpHistoryRestore } from './history-restore'

export function openMcpHistoryRestore(row: McpHistoryRestore, tabId: string): void {
  useResponseStore.getState().clearResponse(tabId)
  useMcpStore.getState().switchToTab(tabId)
  useMcpStore.setState({
    transport: row.transport,
    url: row.url,
    protocol: normalizeMcpProtocol(row.protocol),
    // Masked values come back empty with an "enter it again" note (item 1b).
    hiddenArgs: row.hiddenArgs ?? null,
  })
  restoreMcpCall(row.call)
}
