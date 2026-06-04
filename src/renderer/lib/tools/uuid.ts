/**
 * UUID generator — v1 (timestamp + node), v4 (random), v5 (namespace + name,
 * SHA-1 based, deterministic), and v7 (Unix-epoch-prefixed, time-ordered).
 *
 * v6 is intentionally omitted — it's a re-ordered v1, rarely used in practice
 * and not in the standard `uuid` package as of v9. v3 (MD5-based) is also
 * omitted in favour of v5 which is the recommended deterministic variant.
 */

import { v1 as uuidv1, v4 as uuidv4, v5 as uuidv5, v7 as uuidv7, validate, version } from 'uuid'

export type UuidVersion = 'v1' | 'v4' | 'v5' | 'v7'

export const UUID_VERSIONS: UuidVersion[] = ['v1', 'v4', 'v5', 'v7']

/** Well-known UUID namespaces (RFC 4122 §C). */
export const UUID_NAMESPACES = {
  DNS: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  URL: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  OID: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
  X500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
} as const

export type UuidNamespaceName = keyof typeof UUID_NAMESPACES

export interface UuidGenerateOptions {
  /** Number of UUIDs to generate (1–1000). */
  count?: number
  /** Output format. `lower` is canonical; `upper` is uppercase; `noDashes`
   *  strips the four hyphens; `urn` prefixes with `urn:uuid:`; `braces`
   *  wraps in `{}`. */
  format?: 'lower' | 'upper' | 'noDashes' | 'urn' | 'braces'
  /** Required for v5: a namespace UUID (use one of UUID_NAMESPACES) and a name string. */
  namespace?: string
  name?: string
}

export type UuidResult = { ok: true; uuids: string[] } | { ok: false; error: string }

export function generateUuids(version: UuidVersion, opts: UuidGenerateOptions = {}): UuidResult {
  const count = clampCount(opts.count ?? 1)
  const format = opts.format ?? 'lower'
  const out: string[] = []
  try {
    for (let i = 0; i < count; i++) {
      let raw: string
      switch (version) {
        case 'v1':
          raw = uuidv1()
          break
        case 'v4':
          raw = uuidv4()
          break
        case 'v5': {
          if (!opts.namespace) return { ok: false, error: 'v5 requires a namespace UUID.' }
          if (!validate(opts.namespace)) {
            return { ok: false, error: `Namespace "${opts.namespace}" is not a valid UUID.` }
          }
          if (opts.name == null) return { ok: false, error: 'v5 requires a name string.' }
          raw = uuidv5(opts.name, opts.namespace)
          break
        }
        case 'v7':
          raw = uuidv7()
          break
        default:
          return { ok: false, error: `Unsupported version "${version as string}".` }
      }
      out.push(formatUuid(raw, format))
    }
    return { ok: true, uuids: out }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function isValidUuid(s: string): boolean {
  try {
    return validate(s.replace(/^urn:uuid:/i, '').replace(/^\{|\}$/g, ''))
  } catch {
    return false
  }
}

/** Detect the UUID version (1–7) of an existing UUID, or null if invalid. */
export function detectVersion(s: string): number | null {
  const cleaned = s.replace(/^urn:uuid:/i, '').replace(/^\{|\}$/g, '')
  if (!validate(cleaned)) return null
  try {
    return version(cleaned)
  } catch {
    return null
  }
}

function clampCount(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1
  if (n > 1000) return 1000
  return Math.floor(n)
}

function formatUuid(raw: string, fmt: NonNullable<UuidGenerateOptions['format']>): string {
  switch (fmt) {
    case 'lower':
      return raw.toLowerCase()
    case 'upper':
      return raw.toUpperCase()
    case 'noDashes':
      return raw.replace(/-/g, '')
    case 'urn':
      return `urn:uuid:${raw.toLowerCase()}`
    case 'braces':
      return `{${raw.toLowerCase()}}`
  }
}
