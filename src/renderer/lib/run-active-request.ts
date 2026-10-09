/**
 * The "run the active request" action behind Ctrl/Cmd+Enter and the command
 * palette's Send (issue #165) — ONE dispatch by the active tab's protocol, so
 * the chord and the palette can never disagree.
 *
 * MCP runs the active capability's primary action (Invoke tool / Read
 * resource / Get prompt) when connected. Every other protocol keeps the
 * request store's `sendRequest` exactly as before — it already serves the
 * HTTP / SOAP / GraphQL tabs.
 */
import { useTabsStore } from '../stores/tabs.store'
import { useRequestStore } from '../stores/request.store'
import { useMcpStore } from '../stores/mcp.store'

export function runActiveRequest(): void | Promise<void> {
  const { tabs, activeTabId } = useTabsStore.getState()
  const active = tabs.find((t) => t.id === activeTabId)
  if (active?.protocol === 'mcp') {
    useMcpStore.getState().runPrimaryAction()
    return
  }
  return useRequestStore.getState().sendRequest()
}
