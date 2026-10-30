/**
 * JSON body → a native literal (issue #280). Send posts the body text as
 * typed, so a snippet may only swap it for a JS object / Python dict when that
 * is LOSSLESS: re-serialising the parsed value gives back the same JSON (no
 * `1.50` → `1.5`, no rounded big integer, no duplicate key collapsing, no
 * escape rewritten). Anything else — including a body with an unquoted
 * `{{var}}`, which is not JSON at all — stays a string literal.
 */

/** The JSON text without the whitespace between tokens. */
function minify(text: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === '\\') {
        out += text[i + 1] ?? ''
        i++
      } else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
    } else if (!/\s/.test(c)) out += c
  }
  return out
}

/** Parsed value, or `undefined` when the text is not JSON. */
function tryParse(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) }
  } catch {
    return undefined
  }
}

/** True when the body is an object / array whose literal form sends the same JSON. */
export function isLosslessJson(text: string): boolean {
  const parsed = tryParse(text)
  if (!parsed || typeof parsed.value !== 'object' || parsed.value === null) return false
  return JSON.stringify(parsed.value) === minify(text)
}

/**
 * JSON text → Python literal, lexically (the formatting is kept): `true` /
 * `false` / `null` outside strings become `True` / `False` / `None`. JSON
 * string escapes are valid Python escapes. Call only on `isLosslessJson` text
 * (which never contains `\/` — `JSON.stringify` does not write it).
 */
export function jsonToPython(text: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === '\\') {
        out += text[i + 1] ?? ''
        i++
      } else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      continue
    }
    const word = /^(true|false|null)/.exec(text.slice(i))
    if (word) {
      out += word[1] === 'true' ? 'True' : word[1] === 'false' ? 'False' : 'None'
      i += word[1].length - 1
      continue
    }
    out += c
  }
  return out
}

/** Indent every line after the first by `prefix` (a multi-line literal nested in code). */
export function reindent(text: string, prefix: string): string {
  return text.replace(/\r?\n/g, `\n${prefix}`)
}
