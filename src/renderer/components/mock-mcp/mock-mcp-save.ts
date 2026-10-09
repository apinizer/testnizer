/**
 * Save a Mock MCP server's unsaved editor draft — the ONE save path (issue
 * #154), shared by the editor's Save button / Ctrl+S and the Workbench's
 * unsaved-changes dialog ("Save" on a dirty Mock MCP tab's ×). Before this
 * the dialog went through `saveActiveRequestInPlace`, which does not know
 * Mock MCP tabs, so its Save silently did nothing.
 *
 * Works from the server id alone — no tab activation needed — and never
 * throws: the caller gets a readable error (or `null` while another save of
 * the same server is still in flight).
 */
import { useMockMcpStore } from '../../stores/mock-mcp.store'
import { useTabsStore } from '../../stores/tabs.store'
import { t } from '../../lib/i18n'
import { draftToPatch } from './mock-mcp-draft'
import { mockMcpTabId } from './mock-mcp-tabs'

export type MockMcpSaveResult =
  | { ok: true; /** false = there was no draft to save */ saved: boolean }
  | { ok: false; /** null = a save of this server is already in flight */ error: string | null }

/**
 * Synchronous in-flight guard per server: a second Ctrl+S dispatched before
 * the re-render (or the dialog's Save racing the editor's) would otherwise
 * send two updates.
 */
const inFlight = new Set<string>()

export function isMockMcpSaving(serverId: string): boolean {
  return inFlight.has(serverId)
}

export async function saveMockMcpDraft(serverId: string): Promise<MockMcpSaveResult> {
  const snapshot = useMockMcpStore.getState().drafts[serverId]
  if (!snapshot) return { ok: true, saved: false }
  const built = draftToPatch(snapshot)
  if (!built.patch) {
    const p = built.problem
    return { ok: false, error: t(p.key).replace('{tool}', p.tool).replace('{detail}', p.detail) }
  }
  if (inFlight.has(serverId)) return { ok: false, error: null }
  inFlight.add(serverId)
  let err: string | null
  try {
    err = await useMockMcpStore.getState().updateServer(serverId, built.patch)
  } catch (e) {
    err = e instanceof Error && e.message ? e.message : 'Save failed'
  } finally {
    inFlight.delete(serverId)
  }
  if (err) return { ok: false, error: err }
  const store = useMockMcpStore.getState()
  // Keep edits typed while the save was in flight.
  if (store.drafts[serverId] === snapshot) store.discardDraft(serverId)
  // A rename shows up in the Workbench tab strip too.
  const tabs = useTabsStore.getState()
  const tabId = mockMcpTabId(serverId)
  const name = built.patch.name
  if (name && tabs.tabs.some((x) => x.id === tabId && x.name !== name)) {
    tabs.updateTab(tabId, { name })
  }
  return { ok: true, saved: true }
}
