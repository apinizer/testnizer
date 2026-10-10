/**
 * Where does a History mask (`HISTORY_MASK`, `••••••`) still sit in a request?
 * (issue #195)
 *
 * A History row never stores a literal credential: main replaces it with the
 * mask. Reopening empties every masked value and names it in the "enter them
 * again" note — but the mask can also sit INSIDE a text field (GraphQL
 * variables, a WebSocket composer, a Socket.IO payload, an HTTP JSON body, a
 * SOAP envelope), and a user may paste one back. Two uses, one scanner:
 *
 *  - `maskedPathsInText` — the leaf paths inside one text (`variables.password`,
 *    `body.password`, `envelope.Password`) for the History note;
 *  - `findMaskedCredentials` — the credential-named fields of an OUTGOING
 *    request that still hold the mask; Send refuses while any is left
 *    (`maskedCredentialsError`), for HTTP / GraphQL / WebSocket / Socket.IO /
 *    SOAP alike, instead of putting the dots on the wire.
 *
 * Pure TS, no imports beyond the shared name rules — compiled into both bundles.
 */
import { HISTORY_MASK, isCredentialArgName, isCredentialHeaderName } from './credential-headers'

type Json = Record<string, unknown>

const isRecord = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

const MAX_DEPTH = 64

/** Credential-named by either shared rule (header names are the broader one). */
function isCredName(name: string): boolean {
  return isCredentialArgName(name) || isCredentialHeaderName(name)
}

/** `body.content` / `body.raw` → `body`: the note names the field, not the editor slot. */
function basePath(path: string): string {
  return path.replace(/\.(content|raw)$/, '')
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

/** `{ key | name, value }` row name, or undefined. */
function rowName(v: Json): string | undefined {
  const n = typeof v.key === 'string' ? v.key : typeof v.name === 'string' ? v.name : undefined
  return n && 'value' in v ? n : undefined
}

/**
 * Masked leaves of a parsed JSON value. `credOnly`: only leaves whose own name
 * is credential-bearing (or that sit under one) count.
 */
function walkJson(
  value: unknown,
  path: string,
  credOnly: boolean,
  underCred: boolean,
  out: string[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) return
  if (typeof value === 'string') {
    if (!value.includes(HISTORY_MASK)) return
    const inner = scanText(value, path, credOnly && !underCred)
    if (inner.length > 0) out.push(...inner)
    else if (!credOnly || underCred) out.push(path)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      const name = isRecord(v) ? rowName(v) : undefined
      if (name !== undefined && isRecord(v)) {
        walkJson(v.value, join(path, name), credOnly, underCred || isCredName(name), out, depth + 1)
      } else {
        walkJson(v, `${path}[${i}]`, credOnly, underCred, out, depth + 1)
      }
    })
    return
  }
  if (!isRecord(value)) return
  const name = rowName(value)
  if (name !== undefined) {
    walkJson(value.value, join(path, name), credOnly, underCred || isCredName(name), out, depth + 1)
    return
  }
  for (const [k, v] of Object.entries(value)) {
    walkJson(v, join(path, k), credOnly, underCred || isCredName(k), out, depth + 1)
  }
}

const JSON_MASKED_FIELD = new RegExp(
  `"((?:[^"\\\\]|\\\\.)*)"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*${HISTORY_MASK}`,
  'g',
)
const XML_MASKED_LEAF = new RegExp(
  `<((?:[\\w.-]+:)?([\\w.-]+))(?:\\s[^<>]*)?>[^<]*${HISTORY_MASK}[^<]*</\\1\\s*>`,
  'g',
)
const PAIR_MASKED = new RegExp(`(?:^|[?&\\s])([^=&#?\\s]+)=[^&#\\s]*${HISTORY_MASK}`, 'g')
const USERINFO_MASKED = `//${HISTORY_MASK}@`

/**
 * The masked leaves inside one text at `path`: a JSON object / array (parsed,
 * or field-matched when it does not parse — a templated body), XML leaves,
 * `name=value` pairs (query / form), URL userinfo. Falls back to `[path]` when
 * the text holds the mask but none of those shapes names it — unless
 * `credOnly`, where only credential-named leaves count.
 */
export function maskedPathsInText(text: string, path: string, credOnly = false): string[] {
  const found = scanText(text, path, credOnly)
  if (found.length === 0 && !credOnly && text.includes(HISTORY_MASK)) return [path || '(value)']
  return found
}

/** `maskedPathsInText` without the whole-field fallback. */
function scanText(text: string, path: string, credOnly: boolean): string[] {
  if (!text.includes(HISTORY_MASK)) return []
  const base = basePath(path)
  const out: string[] = []
  const t = text.trimStart()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object') {
        walkJson(parsed, base, credOnly, false, out, 0)
        return dedupe(out)
      }
    } catch {
      /* not valid JSON (a `{{var}}` template) — match fields below */
    }
  }
  for (const m of text.matchAll(JSON_MASKED_FIELD)) {
    if (!credOnly || isCredName(m[1])) out.push(join(base, m[1]))
  }
  for (const m of text.matchAll(XML_MASKED_LEAF)) {
    if (!credOnly || isCredName(m[2])) out.push(join(base, m[2]))
  }
  if (out.length === 0) {
    for (const m of text.matchAll(PAIR_MASKED)) {
      let name = m[1]
      try {
        name = decodeURIComponent(name.replace(/\+/g, ' '))
      } catch {
        /* keep raw */
      }
      if (!credOnly || isCredName(name)) out.push(join(base, name))
    }
  }
  if (text.includes(USERINFO_MASKED)) out.push(`${base} (user:password@)`)
  return dedupe(out)
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)]
}

/**
 * The credential-named fields of an outgoing request (any shape: `url`,
 * `headers` / `params` rows or records, a `body`, `auth`, a payload text …)
 * that still hold the History mask. Everything under `auth` counts.
 */
export function findMaskedCredentials(request: unknown, path = ''): string[] {
  const out: string[] = []
  const walk = (v: unknown, p: string, cred: boolean, depth: number): void => {
    if (depth > MAX_DEPTH) return
    if (typeof v === 'string') {
      if (!v.includes(HISTORY_MASK)) return
      if (cred) out.push(p)
      else out.push(...maskedPathsInText(v, p, true))
      return
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        const name = isRecord(x) ? rowName(x) : undefined
        if (name !== undefined && isRecord(x)) {
          if (x.enabled === false) return
          walk(x.value, join(p, name), cred || isCredName(name), depth + 1)
        } else {
          walk(x, `${p}[${i}]`, cred, depth + 1)
        }
      })
      return
    }
    if (!isRecord(v)) return
    for (const [k, x] of Object.entries(v)) {
      walk(x, join(p, k), cred || k === 'auth' || isCredName(k), depth + 1)
    }
  }
  walk(request, path, false, 0)
  return dedupe(out)
}

/** The inline error Send shows instead of sending, or null when nothing is masked. */
export function maskedCredentialsError(paths: readonly string[]): string | null {
  if (paths.length === 0) return null
  const one = paths.length === 1
  return (
    `Not sent: ${paths.join(', ')} still ${one ? 'holds' : 'hold'} the History mask ` +
    `"${HISTORY_MASK}" — enter the real ${one ? 'value' : 'values'} first.`
  )
}

/** `findMaskedCredentials` + `maskedCredentialsError` in one call. */
export function maskedCredentialsGuard(request: unknown): string | null {
  return maskedCredentialsError(findMaskedCredentials(request))
}
