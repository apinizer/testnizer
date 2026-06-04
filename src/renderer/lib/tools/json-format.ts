export type JsonFormatOptions = {
  /** Indent: number of spaces, '\t' for tab, or 0/'' for minify. Default 2. */
  indent?: number | '\t' | ''
  /** Recursively sort object keys alphabetically. Default false. */
  sortKeys?: boolean
}

export type JsonFormatResult =
  | { ok: true; output: string }
  | { ok: false; error: string; line?: number; column?: number }

/**
 * Pretty-print or minify JSON. Pass indent: 0 or '' to minify.
 * Returns parsed-and-restringified output; comments/trailing commas are NOT
 * tolerated (strict JSON.parse).
 */
export function formatJson(input: string, opts: JsonFormatOptions = {}): JsonFormatResult {
  if (input == null) return { ok: false, error: 'Input is null' }
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, error: 'Input is empty' }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const pos = extractJsonErrorPosition(msg, trimmed)
    return { ok: false, error: msg, ...(pos ?? {}) }
  }

  if (opts.sortKeys) {
    parsed = sortKeysDeep(parsed)
  }

  const indent = opts.indent ?? 2
  const indentArg = indent === 0 || indent === '' ? undefined : indent
  const output = JSON.stringify(parsed, null, indentArg)
  return { ok: true, output }
}

/**
 * Minify JSON — equivalent to formatJson(input, { indent: 0 }).
 */
export function minifyJson(input: string): JsonFormatResult {
  return formatJson(input, { indent: 0 })
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep(obj[key])
    }
    return sorted
  }
  return value
}

/**
 * Best-effort: extract line/column from a `JSON.parse` error message.
 * V8: "Unexpected token x in JSON at position N"
 * Firefox: "JSON.parse: ... at line L column C of the JSON data"
 */
function extractJsonErrorPosition(
  msg: string,
  input: string,
): { line: number; column: number } | null {
  // V8 modern: "...at position 14 (line 3 column 9)" — line/column directly
  const v8ModernMatch = msg.match(/\(line (\d+) column (\d+)\)/)
  if (v8ModernMatch) {
    return { line: parseInt(v8ModernMatch[1], 10), column: parseInt(v8ModernMatch[2], 10) }
  }
  // V8 legacy: "...at position N"
  const v8Match = msg.match(/at position (\d+)/)
  if (v8Match) {
    const pos = parseInt(v8Match[1], 10)
    return positionToLineCol(input, pos)
  }
  // Firefox: "JSON.parse: ... at line L column C"
  const ffMatch = msg.match(/at line (\d+) column (\d+)/)
  if (ffMatch) {
    return { line: parseInt(ffMatch[1], 10), column: parseInt(ffMatch[2], 10) }
  }
  return null
}

function positionToLineCol(input: string, pos: number): { line: number; column: number } {
  let line = 1
  let column = 1
  for (let i = 0; i < pos && i < input.length; i++) {
    if (input[i] === '\n') {
      line++
      column = 1
    } else {
      column++
    }
  }
  return { line, column }
}
