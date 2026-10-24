/**
 * Path variables — Postman's `:name` URL path segments (issue #276).
 *
 * A request URL like `{{baseUrl}}/users/:id/posts/:postId` has two path
 * variables. Their values live in a table next to the query params (the
 * Params tab), are stored with the request as `pathVariables` (top level of
 * `request_schema`; top level of `metadata` on saved_requests, next to the
 * request settings of issue #185) and are substituted into the URL right
 * before `{{var}}` resolution — the SAME helper on every path that sends or
 * renders a request: Send (`request.store.ts`), Run (`runner.handler.ts`),
 * Generate Code and `export:curl`. A value may itself hold `{{var}}`; it is
 * resolved with the rest of the URL afterwards.
 *
 * Compatibility: a `:name` segment with no row, or a row with an EMPTY value,
 * stays literal — exactly what every request sent before this field existed.
 *
 * Pure TS, zero runtime imports: compiled into both bundles.
 */

/** The stored / edited shape. `id` is the editor row id (kept when saved). */
export interface PathVariableLike {
  id?: string
  key: string
  value: string
  description?: string
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** Start / end (exclusive) of the path part of a URL template; `null` = no path. */
function pathBounds(url: string): { start: number; end: number } | null {
  let end = url.length
  for (const stop of ['?', '#']) {
    const i = url.indexOf(stop)
    if (i !== -1 && i < end) end = i
  }
  const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.exec(url)
  const authorityStart = scheme ? scheme[0].length : 0
  const start = url.indexOf('/', authorityStart)
  if (start === -1 || start >= end) return null
  return { start, end }
}

/** The variable name of one path segment (`:id` → `id`), or null. */
function segmentName(segment: string): string | null {
  return segment.length > 1 && segment.startsWith(':') ? segment.slice(1) : null
}

/** `:name` segments of the URL's path, in order, each name once. */
export function pathVariableNames(url: string): string[] {
  const bounds = pathBounds(url ?? '')
  if (!bounds) return []
  const names: string[] = []
  for (const segment of url.slice(bounds.start, bounds.end).split('/')) {
    const name = segmentName(segment)
    if (name !== null && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * The rows the URL calls for, in URL order: an existing row (same key) is
 * kept with its value, description and id; a new name gets an empty row; a
 * name no longer in the URL drops its row. Returns `rows` itself when nothing
 * changed, so a store can skip the update.
 */
export function syncPathVariables<T extends PathVariableLike>(
  url: string,
  rows: readonly T[],
  create: (key: string) => T,
): T[] {
  const names = pathVariableNames(url)
  const same = names.length === rows.length && names.every((n, i) => rows[i]?.key === n)
  if (same) return rows as T[]
  return names.map((name) => rows.find((r) => r.key === name) ?? create(name))
}

/**
 * The URL with every `:name` path segment that has a non-empty row value
 * replaced by that value. Host, port, query and fragment are never touched.
 */
export function applyPathVariables(
  url: string,
  rows: readonly PathVariableLike[] | null | undefined,
): string {
  if (!url || !rows || rows.length === 0) return url
  const bounds = pathBounds(url)
  if (!bounds) return url
  const values = new Map<string, string>()
  for (const r of rows) {
    if (r && typeof r.key === 'string' && typeof r.value === 'string' && r.value !== '') {
      if (!values.has(r.key)) values.set(r.key, r.value)
    }
  }
  if (values.size === 0) return url
  const path = url
    .slice(bounds.start, bounds.end)
    .split('/')
    .map((segment) => {
      const name = segmentName(segment)
      return name !== null && values.has(name) ? (values.get(name) as string) : segment
    })
    .join('/')
  return url.slice(0, bounds.start) + path + url.slice(bounds.end)
}

/** Tolerant reader of `src.pathVariables` (a request_schema / metadata object). */
export function readPathVariables(src: unknown): PathVariableLike[] {
  if (!isRecord(src) || !Array.isArray(src.pathVariables)) return []
  const out: PathVariableLike[] = []
  for (const r of src.pathVariables) {
    if (!isRecord(r) || typeof r.key !== 'string' || !r.key) continue
    const row: PathVariableLike = {
      key: r.key,
      value: typeof r.value === 'string' ? r.value : r.value == null ? '' : String(r.value),
    }
    if (typeof r.id === 'string' && r.id) row.id = r.id
    if (typeof r.description === 'string' && r.description) row.description = r.description
    out.push(row)
  }
  return out
}

/** `readPathVariables` over a JSON column (saved_requests.metadata); malformed → `[]`. */
export function readPathVariablesJson(json: string | null | undefined): PathVariableLike[] {
  if (!json) return []
  try {
    return readPathVariables(JSON.parse(json))
  } catch {
    return []
  }
}

/** The stored form: `{pathVariables}` when there are rows, `{}` otherwise. */
export function pathVariablesField(rows: readonly PathVariableLike[] | null | undefined): {
  pathVariables?: PathVariableLike[]
} {
  if (!rows || rows.length === 0) return {}
  return {
    pathVariables: rows.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      key: r.key,
      value: r.value,
      ...(r.description ? { description: r.description } : {}),
    })),
  }
}
