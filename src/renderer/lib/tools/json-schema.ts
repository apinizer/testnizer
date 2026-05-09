/**
 * Infer a JSON Schema (draft-07) from an example JSON document.
 *
 * Heuristics:
 *   - Primitive types map directly (string, number, integer, boolean, null).
 *   - Objects: every observed key becomes a property; required = (all keys observed
 *     across all samples) when `requiredAll`, else empty.
 *   - Arrays: schema is the union of all item schemas. If only one shape was seen
 *     it becomes a single `items` schema; otherwise `items` is `oneOf`.
 *   - Strings get a `format` hint (date, date-time, email, uri, uuid, ipv4) when
 *     a strong regex match is found.
 */

export type InferOptions = {
  /** Treat all observed keys on each object as required. Default true. */
  requiredAll?: boolean
  /** Detect string formats (email/uri/etc.). Default true. */
  detectFormats?: boolean
  /** JSON Schema $id to embed. Optional. */
  schemaId?: string
  /** Title to embed. Optional. */
  title?: string
}

export type InferResult = { ok: true; schema: unknown } | { ok: false; error: string }

const FORMAT_PATTERNS: { name: string; regex: RegExp }[] = [
  {
    name: 'date-time',
    regex: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/,
  },
  { name: 'date', regex: /^\d{4}-\d{2}-\d{2}$/ },
  { name: 'time', regex: /^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/ },
  { name: 'email', regex: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
  {
    name: 'uuid',
    regex:
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
  },
  { name: 'uri', regex: /^https?:\/\/[^\s]+$/ },
  { name: 'ipv4', regex: /^(\d{1,3}\.){3}\d{1,3}$/ },
]

export function generateJsonSchema(json: string, opts: InferOptions = {}): InferResult {
  const requiredAll = opts.requiredAll ?? true
  const detectFormats = opts.detectFormats ?? true
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    return { ok: false, error: 'Invalid JSON: ' + (e instanceof Error ? e.message : String(e)) }
  }
  const schema = inferNode(parsed, { requiredAll, detectFormats })
  const wrapped: Record<string, unknown> = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    ...(opts.schemaId ? { $id: opts.schemaId } : {}),
    ...(opts.title ? { title: opts.title } : {}),
    ...(typeof schema === 'object' && schema !== null
      ? (schema as Record<string, unknown>)
      : { type: 'null' }),
  }
  return { ok: true, schema: wrapped }
}

function inferNode(
  value: unknown,
  opts: Required<Pick<InferOptions, 'requiredAll' | 'detectFormats'>>,
): unknown {
  if (value === null) return { type: 'null' }
  if (Array.isArray(value)) return inferArray(value, opts)
  if (typeof value === 'object') return inferObject(value as Record<string, unknown>, opts)
  if (typeof value === 'string') {
    const out: Record<string, unknown> = { type: 'string' }
    if (opts.detectFormats) {
      for (const p of FORMAT_PATTERNS) {
        if (p.regex.test(value)) {
          out.format = p.name
          break
        }
      }
    }
    return out
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' }
  }
  if (typeof value === 'boolean') return { type: 'boolean' }
  return {}
}

function inferObject(
  obj: Record<string, unknown>,
  opts: Required<Pick<InferOptions, 'requiredAll' | 'detectFormats'>>,
): unknown {
  const properties: Record<string, unknown> = {}
  const keys = Object.keys(obj)
  for (const k of keys) {
    properties[k] = inferNode(obj[k], opts)
  }
  const out: Record<string, unknown> = {
    type: 'object',
    properties,
  }
  if (opts.requiredAll && keys.length > 0) out.required = keys
  return out
}

function inferArray(
  arr: unknown[],
  opts: Required<Pick<InferOptions, 'requiredAll' | 'detectFormats'>>,
): unknown {
  if (arr.length === 0) return { type: 'array', items: {} }
  const itemSchemas = arr.map((v) => inferNode(v, opts))
  // Deduplicate by JSON stringification — good enough for typical inputs.
  const seen = new Map<string, unknown>()
  for (const s of itemSchemas) {
    const key = JSON.stringify(s)
    if (!seen.has(key)) seen.set(key, s)
  }
  const unique = Array.from(seen.values())
  if (unique.length === 1) return { type: 'array', items: unique[0] }
  return { type: 'array', items: { oneOf: unique } }
}
