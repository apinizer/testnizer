/**
 * Tab helpers for Mock MCP servers (issue #140).
 *
 * `openMockMcpServerTab` opens (or refocuses — the stable id hits the tabs
 * store's singleton-id guard) the server's editor tab.
 *
 * `openMockInMcpTab` — "Open in MCP tab": a new MCP request tab
 * prefilled with transport http + the server URL (+ Bearer Token on the
 * Authorization tab, shown, when the mock requires one), ready to Connect.
 *
 * Ordering matters: `openTab` only flips `activeTabId`; the MCP store's live
 * slice still belongs to the PREVIOUS tab until the stores are activated. The
 * setters are therefore called after `activateTabStores(id)`, otherwise the
 * URL would land in the tab the user just left. The Workbench effect that
 * activates the same id again afterwards is idempotent.
 */
import { useTabsStore } from '../../stores/tabs.store'
import { useMcpStore } from '../../stores/mcp.store'
import { activateTabStores } from '../../lib/activate-tab'
import { makeTabId } from '../../lib/utils'
import type { MockMcpServer } from '../../types/mock-mcp'

export function mockMcpTabId(serverId: string): string {
  return `mockmcp-${serverId}`
}

export function openMockMcpServerTab(server: Pick<MockMcpServer, 'id' | 'name'>): void {
  useTabsStore.getState().openTab({
    id: mockMcpTabId(server.id),
    name: server.name,
    protocol: 'mockMcpServer',
    mockMcpServerId: server.id,
    isPreview: false,
  })
}

/** Close the server's editor tab, if open (after a delete). */
export function closeMockMcpServerTab(serverId: string): void {
  const tabs = useTabsStore.getState()
  const id = mockMcpTabId(serverId)
  if (tabs.tabs.some((t) => t.id === id)) tabs.closeTab(id)
}

export function openMockInMcpTab(opts: {
  name: string
  url: string
  bearerToken?: string
}): string {
  const id = makeTabId()
  const tabs = useTabsStore.getState()
  tabs.openTab({ id, name: opts.name, protocol: 'mcp', url: '' })
  activateTabStores(id)
  const mcp = useMcpStore.getState()
  mcp.setTransport('http')
  mcp.setUrl(opts.url)
  if (opts.bearerToken) {
    // The Authorization tab (MCP Auth), not a raw header row — and selected,
    // so the user sees where the credential went.
    mcp.setAuth({ type: 'bearer', bearer: { token: opts.bearerToken } })
    mcp.setConfigTab('auth')
  }
  // A prefilled scratch tab holds nothing the user typed — no dirty dot.
  useTabsStore.getState().markDirty(id, false)
  return id
}
