/**
 * The client tab an "Open in SSE / AI Chat / MCP / request tab" button of a
 * mock server opens (PM review 1.6.0 #20), shared by `mock-open-in-tab.ts`
 * (SSE, AI, HTTP) and `mock-mcp/mock-mcp-tabs.ts` (MCP):
 *
 *  - one tab per mock target: the id starts with a stable key (kind + server
 *    id + target), so a second click on the same button finds and focuses
 *    the tab it opened instead of opening a duplicate (the key survives a
 *    restart with the tab). The rest of the id is fresh per opened tab: a
 *    protocol store may still hold the slice of a CLOSED tab under its old id
 *    (closing the active tab keeps the live slice), and reusing that id would
 *    bring back its connection state or a reply still streaming;
 *  - its title is not the server's name (that is the editor tab's title):
 *    "<name> · client", so the two tabs can be told apart.
 *
 * Auto-connect after opening lives with each protocol's open helper.
 */
import { useTabsStore } from '../../stores/tabs.store'
import { switchActiveTab } from '../../lib/activate-tab'
import { t } from '../../lib/i18n'
import { makeId } from '../../lib/utils'

export type MockClientKind = 'sse' | 'ai' | 'mcp' | 'http'

/** Small stable hash (djb2, base 36) — keeps paths and URLs out of the tab id. */
function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Stable key of the client tab for one mock target (`target`: e.g. method + path, provider). */
export function mockClientTabKey(kind: MockClientKind, serverId: string, target = ''): string {
  return `mockclient-${kind}-${serverId}-${hash(target)}`
}

/** A new tab id under `key` — fresh, so no protocol store holds state for it. */
export function newMockClientTabId(key: string): string {
  return `${key}~${makeId()}`
}

/** The open tab for `key`, if any. */
export function findMockClientTab(key: string): string | null {
  const prefix = `${key}~`
  return useTabsStore.getState().tabs.find((tab) => tab.id.startsWith(prefix))?.id ?? null
}

/** "Chat API · client" / "Chat API · istemci" — never the editor tab's bare name. */
export function mockClientTabName(name: string): string {
  return t('mock.clientTabName').replace('{name}', name)
}

/** Focus the open tab for `key` (stores first, then the tab). Its id, or null when none is open. */
export function focusMockClientTab(key: string): string | null {
  const id = findMockClientTab(key)
  if (id) switchActiveTab(id)
  return id
}
