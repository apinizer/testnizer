import type { KeyValuePair } from '../types'

/**
 * Postman-style bulk-edit format for KeyValueTable rows:
 *
 *   key:value          ← enabled
 *   //key:value        ← disabled (Postman convention)
 *
 * Empty rows are skipped on serialize. Lines without `:` become a key-only
 * row with an empty value (matches Postman's "type a header name" UX).
 *
 * Round-trip preserves `description` via a positional+key-based merge in
 * `bulkTextToRows`: descriptions from the previous row list are kept when
 * the user only edits keys/values/order in the textarea.
 */

function makeRowId(): string {
  return `kv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Serialize rows into the bulk-edit text. Empty placeholder rows (no key
 * and no value) are dropped so the textarea isn't polluted.
 */
export function rowsToBulkText(rows: KeyValuePair[]): string {
  return rows
    .filter((r) => r.key.length > 0 || r.value.length > 0)
    .map((r) => `${r.enabled ? '' : '//'}${r.key}:${r.value}`)
    .join('\n')
}

/**
 * Parse bulk text back into rows. When `previous` is supplied, descriptions
 * are merged back in by matching on `key` in FIFO order — so re-ordering or
 * editing values keeps descriptions intact. Rows whose key wasn't present
 * in `previous` (or whose key was consumed already) get an empty description.
 */
export function bulkTextToRows(text: string, previous: KeyValuePair[] = []): KeyValuePair[] {
  const descByKey = new Map<string, string[]>()
  for (const r of previous) {
    if (!r.description) continue
    const queue = descByKey.get(r.key) ?? []
    queue.push(r.description)
    descByKey.set(r.key, queue)
  }

  const consumeDescription = (key: string): string => {
    const queue = descByKey.get(key)
    if (!queue || queue.length === 0) return ''
    const head = queue.shift() as string
    if (queue.length === 0) descByKey.delete(key)
    return head
  }

  const out: KeyValuePair[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.length === 0) continue
    const disabled = line.startsWith('//')
    const trimmed = disabled ? line.slice(2) : line
    const colon = trimmed.indexOf(':')
    const key = colon === -1 ? trimmed.trim() : trimmed.slice(0, colon).trim()
    const value = colon === -1 ? '' : trimmed.slice(colon + 1).trim()
    if (!key && !value) continue
    out.push({
      id: makeRowId(),
      key,
      value,
      description: consumeDescription(key),
      enabled: !disabled,
    })
  }
  return out
}
