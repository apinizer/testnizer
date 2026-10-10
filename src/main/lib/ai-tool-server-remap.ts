/**
 * Duplicate project / Import as new (issue #180): an AI Chat request's Tools
 * config can reference the project's saved MCP requests by row id
 * (`ai.toolServers[].requestId`). The copy gets fresh row ids, so those
 * references are re-pointed at the copy's MCP requests; a reference with no
 * counterpart in the copy is dropped and the server is marked `missing` (the
 * Tools tab shows it as such — it never silently points at the SOURCE
 * project's request).
 *
 * Works on the raw JSON column: `ai` sits at the top of `saved_requests.metadata`
 * and under `metadata` in an endpoint / suite item `request_schema`. A row
 * without AI tool servers is returned byte-for-byte unchanged.
 */

type Kind = 'endpoint' | 'request'
export type ToolServerIdMap = (kind: Kind, oldId: string) => string | undefined

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

function remapServers(ai: Record<string, unknown>, map: ToolServerIdMap): boolean {
  if (!Array.isArray(ai.toolServers)) return false
  let changed = false
  ai.toolServers = ai.toolServers.map((raw: unknown) => {
    if (!isRec(raw) || raw.source !== 'saved' || typeof raw.requestId !== 'string') return raw
    changed = true
    const kind: Kind = raw.requestKind === 'endpoint' ? 'endpoint' : 'request'
    const next = map(kind, raw.requestId)
    if (next) {
      const out: Record<string, unknown> = { ...raw, requestId: next }
      delete out.missing
      return out
    }
    const out: Record<string, unknown> = { ...raw, missing: true }
    delete out.requestId
    return out
  })
  return changed
}

export function remapAiToolServerRefs(
  json: string | null | undefined,
  map: ToolServerIdMap,
): string | null | undefined {
  if (typeof json !== 'string' || !json.includes('toolServers')) return json
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return json
  }
  if (!isRec(parsed)) return json
  let changed = false
  if (isRec(parsed.ai)) changed = remapServers(parsed.ai, map) || changed
  if (isRec(parsed.metadata) && isRec(parsed.metadata.ai)) {
    changed = remapServers(parsed.metadata.ai, map) || changed
  }
  return changed ? JSON.stringify(parsed) : json
}
