/**
 * "MCP Security Scan" on the Security page (issue #229) — a second door to the
 * scan that lives in the MCP request tab's right pane (Explorer | Security).
 * The scan itself stays in one place; this only gets the user there:
 *
 *   1. the active tab is an MCP request → its right pane switches to Security;
 *   2. else an MCP tab is open → the last one in the strip is activated and
 *      switched to Security;
 *   3. else → a new MCP request tab opens (as "New → MCP" does) on Security,
 *      ready for the server URL.
 *
 * The section is per tab (`TabMcpState.section`, issue #76), so it is set only
 * after the MCP store's live slice belongs to the target tab — `openTab` /
 * `setActiveTab` alone just flip `activeTabId`, and a setter called then would
 * land on the tab the user just left (same ordering as `openMockInMcpTab`). The
 * Workbench effect that activates the same id again afterwards is idempotent.
 */
import { useTabsStore } from '../stores/tabs.store'
import { MCP_SECURITY_SECTION, useMcpStore } from '../stores/mcp.store'
import { activateTabStores, switchActiveTab } from './activate-tab'
import { makeTabId } from './utils'
import { t } from './i18n'

export function openMcpSecurityScan(): string {
  const tabs = useTabsStore.getState()
  const active = tabs.tabs.find((x) => x.id === tabs.activeTabId)
  let id: string
  if (active?.protocol === 'mcp') {
    id = active.id
    activateTabStores(id)
  } else {
    const open = tabs.tabs.filter((x) => x.protocol === 'mcp').at(-1)
    if (open) {
      id = open.id
      switchActiveTab(id)
    } else {
      id = makeTabId()
      tabs.openTab({ id, name: t('welcome.mcp'), protocol: 'mcp', url: '' })
      activateTabStores(id)
    }
  }
  useMcpStore.getState().setSection(MCP_SECURITY_SECTION)
  return id
}
