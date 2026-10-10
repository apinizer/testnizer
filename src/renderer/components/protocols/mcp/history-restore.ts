/**
 * MCP History rows → an MCP tab (issue #166, renderer half). Pure.
 *
 * Two snapshot shapes are read, tolerantly:
 *  - from #166 on, main writes `request_snapshot.mcp = { transport, url,
 *    protocol, capability: 'tool' | 'resource' | 'prompt', name, args, uri }`
 *    with the row's `url` = the server URL;
 *  - before that, `{ connectionId, toolName, args }` with the row's `url` =
 *    `${serverUrl}/${toolName}` and no transport.
 * Alternate spellings (`toolName`, `arguments`, `resourceUri`, `kind`) are
 * accepted so a field rename in main degrades to "less restored", not to a
 * broken tab.
 */
import type { HistoryEntry } from '../../../types'
import type { McpTransport } from '../../../types/mcp'
import type { McpSavedCall } from '../../../stores/mcp-call.slice'
import { HISTORY_MASK, isCredentialArgName } from '../../../../shared/credential-headers'
import { INLINE_MASK } from '../../../../shared/mcp-call'

export interface McpHistoryRestore {
  transport: McpTransport
  /** Server URL (stdio: the command line). */
  url: string
  /** The connect `protocol` choice, when the row recorded one. */
  protocol?: string
  /** Tool / prompt name or resource URI — tab title and search. */
  name: string
  call: McpSavedCall
  /**
   * Arguments History stored masked (credential-named), restored EMPTY so a
   * re-run never sends the mask: dotted paths (`api_key`, `auth.token`) the
   * tab names in its "enter it again" note. Absent when nothing was hidden.
   */
  hiddenArgs?: string[]
}

/**
 * Was this value masked when the row was written? History always writes
 * `HISTORY_MASK` — and rows from before the word rule masked plain args too
 * (`author`, `keyword`), so the mask counts whatever the key. `***` (the Run
 * row body's mask) only counts under a credential name: as a free-text value
 * it may be real.
 */
function wasMasked(key: string, value: string): boolean {
  return value === HISTORY_MASK || (value === INLINE_MASK && isCredentialArgName(key))
}

/** Blank the values History masked, recursively; `hidden` collects their paths. */
function unmaskArgs(value: unknown, path: string, hidden: string[], depth = 0): unknown {
  if (depth > 32) return value
  if (Array.isArray(value)) {
    return value.map((v, i) => unmaskArgs(v, `${path}[${i}]`, hidden, depth + 1))
  }
  if (!isRecord(value)) return value
  const out: Json = {}
  for (const [k, v] of Object.entries(value)) {
    const at = path ? `${path}.${k}` : k
    if (typeof v === 'string' && wasMasked(k, v)) {
      hidden.push(at)
      out[k] = ''
    } else {
      out[k] = unmaskArgs(v, at, hidden, depth + 1)
    }
  }
  return out
}

type Row = Pick<HistoryEntry, 'url' | 'method' | 'request_snapshot'>
type Json = Record<string, unknown>

const isRecord = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

type Capability = 'tool' | 'resource' | 'prompt'

function capabilityOf(meta: Json, method: string | undefined): Capability {
  const c = str(meta.capability) ?? str(meta.kind)
  if (c === 'tool' || c === 'resource' || c === 'prompt') return c
  if (method === 'READ_RESOURCE') return 'resource'
  if (method === 'GET_PROMPT') return 'prompt'
  return 'tool'
}

function guessTransport(url: string): McpTransport {
  return /^https?:\/\//i.test(url.trim()) ? 'http' : 'stdio'
}

/** The pieces of a row, whichever shape main wrote. */
function readRow(entry: Row): {
  meta: Json
  capability: Capability
  name: string
  uri: string
  args: unknown
} {
  // `history.store` parses the column; a raw string (another reader) is parsed here.
  let raw: unknown = entry.request_snapshot
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = {}
    }
  }
  const snap: Json = isRecord(raw) ? raw : {}
  const meta: Json = isRecord(snap.mcp) ? snap.mcp : {}
  const capability = capabilityOf(meta, entry.method)
  const uri = str(meta.uri) ?? str(meta.resourceUri) ?? str(snap.uri) ?? ''
  const name =
    str(meta.name) ??
    str(meta.toolName) ??
    str(meta.promptName) ??
    str(snap.toolName) ??
    str(snap.name) ??
    (capability === 'resource' ? uri : '')
  const args = meta.args ?? meta.arguments ?? snap.args ?? snap.arguments
  return { meta, capability, name, uri, args }
}

/** A History row → what the MCP tab restores (server + the call). */
export function mcpHistoryRestore(entry: Row): McpHistoryRestore {
  const { meta, capability, name, uri, args } = readRow(entry)
  let url = str(meta.url)
  if (url === undefined) {
    // Pre-#166 rows: `${server}/${toolName}`.
    url = entry.url ?? ''
    if (capability === 'tool' && name && url.endsWith(`/${name}`)) {
      url = url.slice(0, -(name.length + 1))
    }
  }
  const t = meta.transport
  const transport: McpTransport =
    t === 'http' || t === 'sse' || t === 'stdio' ? t : guessTransport(url)
  const protocol = str(meta.protocol)

  const hidden: string[] = []
  let call: McpSavedCall
  if (capability === 'resource') {
    call = { capabilityTab: 'resources', selectedResourceUri: uri, resourceUriDraft: uri }
  } else if (capability === 'prompt') {
    const promptArgs: Record<string, string> = {}
    const visible = unmaskArgs(args, '', hidden)
    if (isRecord(visible)) {
      for (const [k, v] of Object.entries(visible)) {
        if (v !== undefined && v !== null) promptArgs[k] = typeof v === 'string' ? v : String(v)
      }
    }
    call = { capabilityTab: 'prompts', selectedPrompt: name || null, promptArgs }
  } else {
    call = {
      capabilityTab: 'tools',
      selectedTool: name || null,
      toolArgs: JSON.stringify(isRecord(args) ? unmaskArgs(args, '', hidden) : {}, null, 2),
    }
  }
  return {
    transport,
    url,
    ...(protocol ? { protocol } : {}),
    name,
    call,
    ...(hidden.length > 0 ? { hiddenArgs: hidden } : {}),
  }
}

/**
 * How an MCP row reads in History lists (review item 10): the tool / prompt
 * name or resource URI as the label — every row of one server used to read
 * "MCP host/mcp" — and the server URL (stdio: command line) as the tooltip.
 */
export function mcpHistoryRowLabel(entry: Row): { label: string; title: string } {
  const r = mcpHistoryRestore(entry)
  return { label: r.name || r.url, title: r.url }
}

/** Extra text History search matches for an MCP row: the tool / prompt name and resource URI. */
export function mcpHistorySearchText(entry: Row): string {
  const { name, uri } = readRow(entry)
  return `${name} ${uri}`.trim()
}
