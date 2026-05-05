import { XMLParser, XMLBuilder, XMLValidator } from 'fast-xml-parser'

export type XmlFormatOptions = {
  /** Indent: number of spaces, '\t' for tab, '' for minify. Default 2. */
  indent?: number | '\t' | ''
  /** Sort attributes alphabetically per element. Default false (preserve original order). */
  sortAttributes?: boolean
  /** Self-close empty elements (`<a/>` instead of `<a></a>`). Default true. */
  selfCloseEmpty?: boolean
}

export type XmlFormatResult =
  | { ok: true; output: string }
  | { ok: false; error: string; line?: number; column?: number }

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
  parseAttributeValue: false,
  parseTagValue: false,
  cdataPropName: '__cdata',
  commentPropName: '__comment',
  allowBooleanAttributes: true,
  ignoreDeclaration: false,
  ignorePiTags: false,
  processEntities: false,
} as const

/**
 * Pretty-print or minify XML. Preserves CDATA, comments, processing instructions,
 * namespaces, and attribute order (unless sortAttributes: true).
 */
export function formatXml(input: string, opts: XmlFormatOptions = {}): XmlFormatResult {
  if (input == null) return { ok: false, error: 'Input is null' }
  const trimmed = stripBom(input).trim()
  if (trimmed === '') return { ok: false, error: 'Input is empty' }

  const validation = XMLValidator.validate(trimmed, { allowBooleanAttributes: true })
  if (validation !== true) {
    return {
      ok: false,
      error: validation.err.msg,
      line: validation.err.line,
      column: validation.err.col,
    }
  }

  const parser = new XMLParser(PARSER_OPTIONS)
  let parsed: unknown
  try {
    parsed = parser.parse(trimmed)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  if (opts.sortAttributes) {
    parsed = sortAttributesDeep(parsed)
  }

  const indent = opts.indent ?? 2
  const isMinify = indent === 0 || indent === ''
  const indentBy = isMinify ? '' : indent === '\t' ? '\t' : ' '.repeat(indent as number)

  const builder = new XMLBuilder({
    ...PARSER_OPTIONS,
    format: !isMinify,
    indentBy,
    suppressEmptyNode: opts.selfCloseEmpty ?? true,
  })
  let output: string
  try {
    output = builder.build(parsed)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  if (isMinify) {
    // fast-xml-parser keeps inter-tag whitespace from the original text nodes
    // even with format:false. Strip whitespace-only runs between tags so
    // minify is actually minified. Preserves whitespace inside text content.
    output = stripInterTagWhitespace(output)
  }

  return { ok: true, output: output.trimEnd() }
}

function stripInterTagWhitespace(xml: string): string {
  return xml.replace(/>\s+</g, '><')
}

/**
 * Minify XML — equivalent to formatXml(input, { indent: 0 }).
 */
export function minifyXml(input: string): XmlFormatResult {
  return formatXml(input, { indent: 0 })
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? (s.slice(1) === '' ? '' : s.slice(1)) : s
}

function sortAttributesDeep(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(sortAttributesDeep)
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    const result: Record<string, unknown> = {}
    if (':@' in obj && obj[':@'] && typeof obj[':@'] === 'object') {
      const attrs = obj[':@'] as Record<string, unknown>
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(attrs).sort()) sorted[k] = attrs[k]
      result[':@'] = sorted
    }
    for (const key of Object.keys(obj)) {
      if (key === ':@') continue
      result[key] = sortAttributesDeep(obj[key])
    }
    return result
  }
  return node
}
