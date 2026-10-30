/**
 * The snippet URL (issue #280): the URL as typed plus the Params table, with
 * the characters a URL cannot carry percent-encoded — while every `{{name}}`
 * placeholder stays readable, so a secret left out of the snippet is still
 * visible as `{{name}}` (`placeholdersIn` in the renderer looks for it).
 */
import type { CodegenKv } from './types'

const PLACEHOLDER = /\{\{[^{}]*\}\}/g

/**
 * Run `encode` over the text between `{{…}}` placeholders, leaving each
 * placeholder exactly as typed.
 */
function keepPlaceholders(s: string, encode: (part: string) => string): string {
  let out = ''
  let last = 0
  for (const m of s.matchAll(PLACEHOLDER)) {
    const at = m.index ?? 0
    out += encode(s.slice(last, at)) + m[0]
    last = at + m[0].length
  }
  return out + encode(s.slice(last))
}

/** UTF-8 percent-encoding of one character. */
function pct(ch: string): string {
  return encodeURIComponent(ch).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)
}

/**
 * Characters RFC 3986 allows in a URL (unreserved + reserved) and `%` itself.
 * A `%` that does not start a valid `%XX` escape is encoded (`%25`), an
 * existing `%XX` is left alone — never double-encoded.
 */
const URL_SAFE = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]/

function encodeUnsafe(part: string): string {
  let out = ''
  for (let i = 0; i < part.length; i++) {
    const c = part[i]
    if (c === '%') {
      out += /^[0-9A-Fa-f]{2}$/.test(part.slice(i + 1, i + 3)) ? '%' : '%25'
      continue
    }
    if (URL_SAFE.test(c)) {
      out += c
      continue
    }
    // Surrogate pair → one code point.
    const cp = part.codePointAt(i) ?? 0
    const ch = String.fromCodePoint(cp)
    out += pct(ch)
    i += ch.length - 1
  }
  return out
}

/** Percent-encode the unsafe characters of a whole URL, keeping `{{name}}`. */
export function encodeSnippetUrl(url: string): string {
  return keepPlaceholders(url, encodeUnsafe)
}

/** `encodeURIComponent` for a query key / value, keeping `{{name}}`. */
export function encodeQueryPart(s: string): string {
  return keepPlaceholders(s, encodeURIComponent)
}

/** Query keys the URL's own query string carries (raw, as typed). */
function urlQueryKeys(query: string): Set<string> {
  const keys = new Set<string>()
  for (const pair of query.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    keys.add(eq === -1 ? pair : pair.slice(0, eq))
  }
  return keys
}

/**
 * The URL plus the Params rows the URL's query does not already carry (the
 * editor keeps URL and Params in sync — issue #22; the engine's rule, issue
 * #17: the URL's query wins and a repeated `?id=1&id=2` survives), inserted
 * BEFORE any `#fragment` (they used to land after it and were lost), then
 * encoded for the snippet.
 */
export function buildSnippetUrl(url: string, params: readonly CodegenKv[]): string {
  const hashAt = url.indexOf('#')
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt)
  const fragment = hashAt === -1 ? '' : url.slice(hashAt)
  const qAt = beforeHash.indexOf('?')
  const query = qAt === -1 ? '' : beforeHash.slice(qAt + 1)
  const inUrl = urlQueryKeys(query)
  const extra = params.filter((p) => p.enabled !== false && p.key && !inUrl.has(p.key))
  let base = beforeHash
  if (extra.length > 0) {
    const qs = extra.map((p) => `${encodeQueryPart(p.key)}=${encodeQueryPart(p.value)}`).join('&')
    if (qAt === -1) base = `${beforeHash}?${qs}`
    else base = query === '' ? `${beforeHash}${qs}` : `${beforeHash}&${qs}`
  }
  return encodeSnippetUrl(base + fragment)
}
