/**
 * How a History row reads in a list — the ONE rule for the History sidebar and
 * the new-request page's recent list (tester finding 5a).
 *
 * MCP rows label with the call (tool / prompt / resource) and title with the
 * server (`mcpHistoryRowLabel`, review item 10). Every other protocol labels
 * with `host + path` and titles with the full URL, so a truncated row can be
 * read on hover. The title is the STORED url: main masks it before writing
 * (issue #195), so it never shows a raw credential. Do not feed it through
 * `historyTabUrl` / `unmaskHistoryValue` — those cut the mask out for a
 * re-send and would make a masked value look like an empty one.
 */
import type { HistoryEntry } from '../../types'
import { mcpHistoryRowLabel } from '../protocols/mcp/history-restore'
import { shortHistoryUrl } from '../../lib/history-restore'

export { shortHistoryUrl }

type Row = Pick<HistoryEntry, 'protocol' | 'url' | 'method' | 'request_snapshot'>

export function historyRowLabel(entry: Row): { label: string; title: string } {
  if (entry.protocol === 'mcp') return mcpHistoryRowLabel(entry)
  const url = entry.url ?? ''
  return { label: shortHistoryUrl(url), title: url }
}
