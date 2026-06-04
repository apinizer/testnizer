import { XMLParser, XMLBuilder } from 'fast-xml-parser'

export type ConvertResult = { ok: true; output: string } | { ok: false; error: string }

export type Json2XmlOptions = {
  /** Root element name when the JSON document is a primitive or an array. */
  rootName?: string
  /** Indent for pretty output. Default '  '. */
  indent?: string
  /** Skip null / undefined fields. Default false. */
  ignoreNulls?: boolean
  /** Skip empty string fields. Default false. */
  ignoreEmpty?: boolean
}

export type Xml2JsonOptions = {
  /** Skip XML elements that have only `xsi:nil="true"`. Default false. */
  treatNilAsNull?: boolean
  /** Write numeric-looking strings as strings (don't auto-parse). Default false. */
  numbersAsStrings?: boolean
  /** Skip empty (no-children, no-text) elements. Default false. */
  ignoreEmpty?: boolean
  /** When the root has a single child element, drop the wrapper and return its content. Default true. */
  unwrapRoot?: boolean
  /** Element paths (#-separated, e.g. `bookstore#book`) that must always be arrays. */
  arrayPaths?: string[]
}

// ───────────────────────────────────────────────────────────────────
// JSON → XML
// ───────────────────────────────────────────────────────────────────

export function jsonToXml(json: string, opts: Json2XmlOptions = {}): ConvertResult {
  const root = opts.rootName ?? 'root'
  const indent = opts.indent ?? '  '
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    return { ok: false, error: 'Invalid JSON: ' + (e instanceof Error ? e.message : String(e)) }
  }
  const sanitized = sanitize(parsed, opts.ignoreNulls ?? false, opts.ignoreEmpty ?? false)
  const wrapped =
    sanitized === undefined
      ? { [root]: '' }
      : typeof sanitized === 'object' && sanitized !== null && !Array.isArray(sanitized)
        ? sanitized
        : { [root]: sanitized }

  try {
    const builder = new XMLBuilder({
      format: true,
      indentBy: indent,
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      suppressEmptyNode: false,
    })
    const xml = builder.build(wrapped) as string
    const decl = '<?xml version="1.0" encoding="UTF-8"?>\n'
    return { ok: true, output: decl + (xml ?? '').trimEnd() }
  } catch (e) {
    return { ok: false, error: 'XML build error: ' + (e instanceof Error ? e.message : String(e)) }
  }
}

function sanitize(value: unknown, ignoreNulls: boolean, ignoreEmpty: boolean): unknown {
  if (value === null) return ignoreNulls ? undefined : null
  if (value === '') return ignoreEmpty ? undefined : ''
  if (Array.isArray(value)) {
    const out = value
      .map((v) => sanitize(v, ignoreNulls, ignoreEmpty))
      .filter((v) => v !== undefined)
    return out
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = sanitize(v, ignoreNulls, ignoreEmpty)
      if (cleaned !== undefined) out[k] = cleaned
    }
    return out
  }
  return value
}

// ───────────────────────────────────────────────────────────────────
// XML → JSON
// ───────────────────────────────────────────────────────────────────

export function xmlToJson(xml: string, opts: Xml2JsonOptions = {}): ConvertResult {
  const numbersAsStrings = opts.numbersAsStrings ?? false
  const ignoreEmpty = opts.ignoreEmpty ?? false
  const treatNilAsNull = opts.treatNilAsNull ?? false
  const unwrapRoot = opts.unwrapRoot ?? true
  const arrayPaths = (opts.arrayPaths ?? []).filter(Boolean)

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: !numbersAsStrings,
      parseAttributeValue: !numbersAsStrings,
      trimValues: true,
      jPath: true,
      isArray: (_name, jpath) => (typeof jpath === 'string' ? arrayPaths.includes(jpath) : false),
    })
    let parsed = parser.parse(xml) as unknown

    if (treatNilAsNull) parsed = applyNilToNull(parsed)
    if (ignoreEmpty) parsed = removeEmpty(parsed) ?? null
    if (unwrapRoot && typeof parsed === 'object' && parsed !== null) {
      const keys = Object.keys(parsed as Record<string, unknown>).filter((k) => !k.startsWith('?'))
      if (keys.length === 1) {
        // Drop the root wrapper but keep ?xml/?prolog if present.
        parsed = (parsed as Record<string, unknown>)[keys[0]]
      }
    }
    return { ok: true, output: JSON.stringify(parsed, null, 2) }
  } catch (e) {
    return { ok: false, error: 'XML parse error: ' + (e instanceof Error ? e.message : String(e)) }
  }
}

function applyNilToNull(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(applyNilToNull)
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (obj['@_xsi:nil'] === 'true' || obj['@_xsi:nil'] === true) return null
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = applyNilToNull(v)
    return out
  }
  return node
}

function removeEmpty(node: unknown): unknown {
  if (Array.isArray(node)) {
    const out = node.map(removeEmpty).filter((v) => v !== undefined)
    return out.length === 0 ? undefined : out
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    let kept = 0
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const cleaned = removeEmpty(v)
      if (cleaned !== undefined) {
        out[k] = cleaned
        kept++
      }
    }
    return kept === 0 ? undefined : out
  }
  if (node === '' || node === null || node === undefined) return undefined
  return node
}
