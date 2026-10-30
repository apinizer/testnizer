/**
 * JSON text that may hold bare `{{variable}}` placeholders outside strings
 * (`{"id": {{userId}}}` — how Testnizer and Postman let a number come from a
 * variable). `parseJsonWithVars` swaps each bare placeholder for a unique
 * string token, parses, and gives back a `restore` that turns the tokens in
 * re-serialised text into the placeholders again. Placeholders INSIDE
 * strings are ordinary string content and stay untouched.
 *
 * Used by the Postman v3 MCP mapping (issues #276 / #277): a v3
 * `mcp-request` carries one JSON-RPC `message` string, a Testnizer MCP tool
 * call keeps its arguments as raw JSON text.
 *
 * Pure TS: compiled into both bundles.
 */

export interface ParsedJsonWithVars {
  value: unknown
  /** Re-insert the placeholders into JSON text produced from `value`. */
  restore: (json: string) => string
}

const TOKEN = (n: number): string => `__TNZ_VAR_${n}__`

/** Parse; null when the text is not JSON even with placeholders swapped. */
export function parseJsonWithVars(text: string): ParsedJsonWithVars | null {
  const vars: string[] = []
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += text[i + 1] ?? ''
        i++
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '{' && text[i + 1] === '{') {
      const end = text.indexOf('}}', i + 2)
      if (end > 0) {
        vars.push(text.slice(i, end + 2))
        out += `"${TOKEN(vars.length - 1)}"`
        i = end + 1
        continue
      }
    }
    out += ch
  }
  let value: unknown
  try {
    value = JSON.parse(out)
  } catch {
    return null
  }
  return {
    value,
    restore: (json: string) =>
      json.replace(/"__TNZ_VAR_(\d+)__"/g, (m, n: string) => vars[Number(n)] ?? m),
  }
}
