/**
 * Defensive readers for the loosely-typed parts of a Postman file (issue
 * #276). Real collections diverge from the schema: `description` may be an
 * object, `header` a `"K: V\n"` string, `request` a bare URL, a variable
 * value a number or an object. Every value bound into SQLite goes through
 * `toText` — better-sqlite3 treats a plain object as a named-parameter bag
 * ("Too few parameter values were provided"), which used to abort the whole
 * import.
 */
import type { PostmanDescription, PostmanHeader, PostmanRequest, PostmanUrl } from './types'

export function genKvId(): string {
  return Math.random().toString(36).slice(2, 10)
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** Any JSON value → the text SQLite stores. Objects are JSON-encoded. */
export function toText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (isRecord(v) && typeof v.content === 'string' && Object.keys(v).length <= 3) {
    // `{content, type, version}` description object.
    return v.content
  }
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** A `description` (string or `{content}`) → text, or null when empty. */
export function descriptionText(d: PostmanDescription | unknown): string | null {
  if (d === null || d === undefined) return null
  if (typeof d === 'string') return d.trim() ? d : null
  if (isRecord(d)) {
    const c = d.content
    return typeof c === 'string' && c.trim() ? c : null
  }
  const t = toText(d)
  return t.trim() ? t : null
}

/**
 * `"K: V\nK2: V2"` header block → rows. A `//` prefix marks a disabled header
 * (v1 / transformer convention, `common/v1.js parseHeaders`).
 */
export function parseHeaderString(block: string): PostmanHeader[] {
  const out: PostmanHeader[] = []
  for (const raw of block.replace(/\r\n([ \t])/g, '$1').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    let key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    let disabled = false
    if (key.startsWith('//')) {
      disabled = true
      key = key.slice(2).trim()
    }
    if (!key) continue
    out.push(disabled ? { key, value, disabled } : { key, value })
  }
  return out
}

/** `request.header` in any shape → a clean list (non-object entries dropped). */
export function normalizeHeaders(h: unknown): PostmanHeader[] {
  if (typeof h === 'string') return parseHeaderString(h)
  if (!Array.isArray(h)) return []
  const out: PostmanHeader[] = []
  for (const row of h) {
    if (typeof row === 'string') {
      out.push(...parseHeaderString(row))
      continue
    }
    if (!isRecord(row)) continue
    out.push({
      key: toText(row.key),
      value: toText(row.value),
      description: descriptionText(row.description) ?? undefined,
      disabled: row.disabled === true ? true : undefined,
    })
  }
  return out
}

/** `item.request` as a string is a URL with method GET (v2.1 schema). */
export function normalizeRequest(r: unknown): PostmanRequest | null {
  if (typeof r === 'string') return { method: 'GET', url: r }
  if (isRecord(r)) return r as PostmanRequest
  return null
}

/** Reconstruct a full URL from a Postman url object or string. Preserves
 * `{{variables}}` and template placeholders as-is — never URL-decodes them. */
export function reconstructPostmanUrl(url: PostmanUrl | string | undefined): string {
  if (!url) return ''
  if (typeof url === 'string') return url
  if (typeof url.raw === 'string' && url.raw) return url.raw

  const protocol = url.protocol ?? 'https'
  const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '')
  const port = url.port ? `:${url.port}` : ''
  const pathParts = Array.isArray(url.path)
    ? url.path.map((p) => (typeof p === 'string' ? p : (p?.value ?? '')))
    : url.path
      ? [String(url.path)]
      : []
  const path = pathParts.length > 0 ? '/' + pathParts.join('/') : ''
  return `${protocol}://${host}${port}${path}`
}

/** Best-effort path extraction for the endpoints.path column. Falls back to
 * the raw URL if the URL contains template variables that break URL parsing. */
export function extractPath(url: string): string {
  if (!url) return '/'
  // If the URL contains {{vars}} we can't reliably parse it — use a safe
  // substitution then strip back the placeholder.
  const PLACEHOLDER = '__VAR__'
  const safe = url.replace(/\{\{[^}]+\}\}/g, PLACEHOLDER)
  try {
    const parsed = new URL(safe)
    let pathname = parsed.pathname || '/'
    pathname = pathname.replace(new RegExp(PLACEHOLDER, 'g'), '*')
    return pathname
  } catch {
    // Relative URL or `{{baseUrl}}/path` form — strip protocol/host best-effort.
    const m = url.match(/(?:https?:\/\/[^/]+)?(\/.*)$/)
    return m?.[1] ?? url
  }
}

export function tryParseJson(s: string | undefined): unknown {
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** "Folder / Sub / Request" — the path a warning names an item by. */
export function itemLabel(path: string[], name: string | undefined): string {
  const n = name && name.trim() ? name.trim() : '(unnamed)'
  return [...path, n].join(' / ')
}
