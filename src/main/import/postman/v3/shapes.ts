/**
 * Tolerant readers for Postman v3 fields (issue #276 part 2). The JSON Schema
 * and Postman's own docs write lists; repositories that look Postman-saved
 * also hold `key: value` MAPS for headers, query parameters, variables and
 * auth credentials (research 01-formats §3.3). Both are accepted.
 */
import { descriptionText, toText } from '../normalize'

export type Doc = Record<string, unknown>

export const isRecord = (v: unknown): v is Doc => !!v && typeof v === 'object' && !Array.isArray(v)

export interface V3Kv {
  key: string
  value: string
  disabled?: boolean
  description?: string
}

/** A list of `{key, value, disabled?, description?}` or a `{key: value}` map → rows. */
export function kvList(raw: unknown): V3Kv[] {
  if (Array.isArray(raw)) {
    const out: V3Kv[] = []
    for (const r of raw) {
      if (!isRecord(r)) continue
      const key = r.key === null || r.key === undefined ? '' : toText(r.key)
      const row: V3Kv = { key, value: r.value === null ? '' : toText(r.value) }
      if (r.disabled === true) row.disabled = true
      const d = descriptionText(r.description)
      if (d) row.description = d
      if (!key && !row.value) continue
      out.push(row)
    }
    return out
  }
  if (isRecord(raw)) {
    return Object.entries(raw).map(([key, value]) => {
      if (isRecord(value) && ('value' in value || 'disabled' in value)) {
        const row: V3Kv = { key, value: toText(value.value) }
        if (value.disabled === true) row.disabled = true
        const d = descriptionText(value.description)
        if (d) row.description = d
        return row
      }
      return { key, value: toText(value) }
    })
  }
  return []
}

/** A string field (numbers / booleans as text), undefined when absent. */
export function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  return toText(v)
}

/** `url` + `queryParams` → one URL whose query matches the enabled parameters. */
export function urlWithQuery(
  url: string,
  params: V3Kv[] | null,
): { url: string; rebuilt: boolean } {
  if (!params) return { url, rebuilt: false }
  const hashAt = url.indexOf('#')
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url
  const qAt = noHash.indexOf('?')
  const base = qAt >= 0 ? noHash.slice(0, qAt) : noHash
  const current = qAt >= 0 ? noHash.slice(qAt + 1) : ''
  // Same rule as the Params tab (`url-query-sync.ts`): enabled rows, no
  // encoding (so `{{vars}}` survive), `key` alone for an empty value.
  const q = params
    .filter((p) => !p.disabled && p.key.trim() !== '')
    .map((p) => (p.value !== '' ? `${p.key}=${p.value}` : p.key))
    .join('&')
  if (normalizeQuery(current) === normalizeQuery(q)) return { url, rebuilt: false }
  return { url: base + (q ? `?${q}` : '') + hash, rebuilt: true }
}

function normalizeQuery(q: string): string {
  return q
    .split('&')
    .filter(Boolean)
    .map((p) => (p.includes('=') ? p : `${p}=`))
    .join('&')
}

/** Query rows parsed from a URL's query string (when a file has no `queryParams`). */
export function queryFromUrl(url: string): V3Kv[] {
  const noHash = url.split('#')[0]
  const qAt = noHash.indexOf('?')
  if (qAt < 0) return []
  return noHash
    .slice(qAt + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      return eq < 0
        ? { key: pair, value: '' }
        : { key: pair.slice(0, eq), value: pair.slice(eq + 1) }
    })
}
