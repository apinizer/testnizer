/**
 * Pure helpers behind `mcp.store.ts` and the MCP editor panes (issue #139).
 * No store / IPC imports, so they unit-test without a bridge mock.
 */
import type { KeyValuePair } from '../types'
import type { McpPrompt, McpResource, McpResourceTemplate, McpTool } from '../types/mcp'
import { resolveVariables } from './variable-resolver'
import { resolveKvRows } from '../../shared/mcp-call'
import { makeId } from './utils'

/** Ring-buffer cap for the per-tab notification and frame logs. */
export const MCP_LOG_LIMIT = 500

export function pushCapped<T>(list: readonly T[], entry: T, max = MCP_LOG_LIMIT): T[] {
  if (list.length < max) return [...list, entry]
  return [...list.slice(list.length - max + 1), entry]
}

export function blankRow(key = '', value = ''): KeyValuePair {
  return { id: makeId(), key, value, enabled: true }
}

/**
 * Enabled rows with a non-blank key → `{ key: value }`, `{{var}}` resolved in
 * both key and value — Send's binding of the rule Run shares
 * (`src/shared/mcp-call.ts` `resolveKvRows`).
 */
export function kvRowsToRecord(
  rows: readonly KeyValuePair[],
  vars: Record<string, string>,
): Record<string, string> {
  return resolveKvRows(rows, (s) => resolveVariables(s, vars))
}

/** `{ key: value }` → editable rows (one blank row when empty). */
export function recordToRows(record: Record<string, string> | undefined): KeyValuePair[] {
  const rows = Object.entries(record ?? {}).map(([k, v]) => blankRow(k, v))
  return rows.length > 0 ? rows : [blankRow()]
}

/**
 * The arguments a tool selection seeds. `requiredOnly` (the Form view, #162
 * follow-up): an optional field without a schema `default` is left OUT — the
 * form shows it empty and an empty optional field is not sent (MCP Inspector
 * behaviour). The JSON view keeps the full skeleton as a typing aid; what it
 * shows is what it sends.
 */
export function generateExampleArgs(
  schema: Record<string, unknown>,
  opts: { requiredOnly?: boolean } = {},
): Record<string, unknown> {
  const props = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {}
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const result: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(props)) {
    const type = def.type as string | undefined
    if (opts.requiredOnly && !required.has(key) && def.default === undefined) continue
    // The schema's own `default` is the best example (issue #162).
    if (def.default !== undefined) result[key] = def.default
    else if (def.enum && Array.isArray(def.enum)) result[key] = def.enum[0]
    else if (type === 'string') result[key] = ''
    else if (type === 'integer' || type === 'number') result[key] = 0
    else if (type === 'boolean') result[key] = false
    else if (type === 'array') result[key] = []
    else if (type === 'object') result[key] = {}
    else result[key] = null
  }
  return result
}

/** True while a URI still holds an RFC 6570 `{name}` placeholder (shared with Run). */
export { hasUnexpandedTemplate } from '../../shared/mcp-call'

export type McpFrameKind = 'request' | 'notification' | 'result' | 'error' | 'unknown'

/** JSON-RPC frame → short list label: method, `result #id` or `error #id`. */
export function describeFrame(message: unknown): { kind: McpFrameKind; label: string } {
  if (typeof message !== 'object' || message === null) return { kind: 'unknown', label: '?' }
  const m = message as Record<string, unknown>
  const id = m.id !== undefined && m.id !== null ? String(m.id) : null
  if (typeof m.method === 'string') {
    return id !== null
      ? { kind: 'request', label: `${m.method} #${id}` }
      : { kind: 'notification', label: m.method }
  }
  if ('error' in m) return { kind: 'error', label: `error #${id ?? '?'}` }
  if ('result' in m) return { kind: 'result', label: `result #${id ?? '?'}` }
  // A truncated frame keeps only jsonrpc / id / method — an id without a
  // method is a (huge) response; in practice a result, e.g. a resource blob.
  if ('_truncated' in m && id !== null) return { kind: 'result', label: `result #${id}` }
  return { kind: 'unknown', label: '?' }
}

export function formatLogTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export type McpListItem =
  | { kind: 'tool'; key: string; item: McpTool }
  | { kind: 'resource'; key: string; item: McpResource }
  | { kind: 'template'; key: string; item: McpResourceTemplate }
  | { kind: 'prompt'; key: string; item: McpPrompt }

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  if (!query) return true
  return fields.some((f) => f?.toLowerCase().includes(query))
}

/** Search filter for the capability list — name, title, description, uri. */
export function filterCapabilityItems(
  items: readonly McpListItem[],
  search: string,
): McpListItem[] {
  const q = search.trim().toLowerCase()
  if (!q) return [...items]
  return items.filter((entry) => {
    switch (entry.kind) {
      case 'tool':
        return matches(q, entry.item.name, entry.item.title, entry.item.description)
      case 'resource':
        return matches(q, entry.item.name, entry.item.title, entry.item.description, entry.item.uri)
      case 'template':
        return matches(
          q,
          entry.item.name,
          entry.item.title,
          entry.item.description,
          entry.item.uriTemplate,
        )
      case 'prompt':
        return matches(q, entry.item.name, entry.item.title, entry.item.description)
    }
    return false
  })
}

/** Stable, selector-safe test id fragment for a URI / name. */
export function testIdSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_')
}

/** Capabilities tooltip text: "tools (listChanged), resources (subscribe, listChanged), logging". */
export function describeCapabilities(caps: Record<string, unknown> | null): string {
  if (!caps) return ''
  return Object.entries(caps)
    .map(([key, val]) => {
      const flags =
        val && typeof val === 'object'
          ? Object.entries(val as Record<string, unknown>)
              .filter(([, v]) => v === true)
              .map(([k]) => k)
          : []
      return flags.length > 0 ? `${key} (${flags.join(', ')})` : key
    })
    .join(', ')
}

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

/**
 * One-line summary shown next to a notification's method — progress
 * (`2/5 (40%) — step 2/5`), log messages (`[info] e2e: started`), resource
 * updates (the URI). Empty for anything else.
 */
export function describeNotification(method: string, params: unknown): string {
  const p = asRecord(params)
  if (method === 'notifications/progress') {
    const { progress, total } = p
    const pct =
      typeof progress === 'number' && typeof total === 'number' && total > 0
        ? ` (${Math.round((progress / total) * 100)}%)`
        : ''
    const msg = typeof p.message === 'string' ? ` — ${p.message}` : ''
    return `${String(progress ?? '?')}${total !== undefined ? `/${String(total)}` : ''}${pct}${msg}`
  }
  if (method === 'notifications/message') {
    const data = typeof p.data === 'string' ? p.data : JSON.stringify(p.data ?? '')
    const logger = typeof p.logger === 'string' ? ` ${p.logger}:` : ''
    return `[${String(p.level ?? 'info')}]${logger} ${data}`
  }
  if (method === 'notifications/resources/updated') return String(p.uri ?? '')
  return ''
}

/** `{ chars, preview }` of a frame the main process cut down (`truncated`), else null. */
export function truncatedFrameInfo(message: unknown): { chars: number; preview: string } | null {
  const info = asRecord(asRecord(message)._truncated)
  if (typeof info.preview !== 'string') return null
  return {
    chars: typeof info.chars === 'number' ? info.chars : info.preview.length,
    preview: info.preview,
  }
}
