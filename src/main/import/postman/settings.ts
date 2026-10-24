/**
 * Postman `protocolProfileBehavior` → Testnizer request settings (issue #276,
 * `src/shared/request-settings.ts`, issue #185).
 *
 * Postman inherits the behaviour object down the tree (collection → folder →
 * request, nearer keys win). Testnizer has no folder-level request settings,
 * so the merged result is written onto each request's `request_schema`
 * (top-level `followRedirects` / `maxRedirects` / `sslVerification`, the keys
 * Send, Ctrl+S and Run all read). Keys with no Testnizer setting are reported
 * when they differ from Postman's default; at their default they change
 * nothing and stay quiet.
 */
import type { RequestSettings } from '../../../shared/request-settings'

type Ppb = Record<string, unknown>

/** Postman's defaults for keys Testnizer cannot carry — equal → nothing lost. */
const UNSUPPORTED_DEFAULTS: Record<string, unknown> = {
  disableCookies: false,
  disableUrlEncoding: false,
  insecureHTTPParser: false,
  followOriginalHttpMethod: false,
  followAuthorizationHeader: false,
  removeRefererHeaderOnRedirect: false,
  protocolVersion: 'auto',
  tlsPreferServerCiphers: false,
}

/** Postman always sends a GET body when one is set; Testnizer does too. */
const NO_OP_KEYS = new Set(['disableBodyPruning'])

export function mergePpb(parent: Ppb | undefined, own: unknown): Ppb | undefined {
  const o = own && typeof own === 'object' && !Array.isArray(own) ? (own as Ppb) : undefined
  if (!parent && !o) return undefined
  return { ...(parent ?? {}), ...(o ?? {}) }
}

/** The Testnizer settings a (merged) behaviour object sets. */
export function ppbToRequestSettings(ppb: Ppb | undefined): RequestSettings {
  const out: RequestSettings = {}
  if (!ppb) return out
  if (typeof ppb.followRedirects === 'boolean') out.followRedirects = ppb.followRedirects
  const max = ppb.maxRedirects
  if (typeof max === 'number' && Number.isFinite(max) && max >= 0)
    out.maxRedirects = Math.floor(max)
  if (typeof ppb.strictSSL === 'boolean') out.sslVerification = ppb.strictSSL
  return out
}

const CARRIED = new Set(['followRedirects', 'maxRedirects', 'strictSSL'])

/**
 * Report the keys of ONE level's own behaviour object that Testnizer cannot
 * carry (once, where they are declared — not again on every inheriting
 * request).
 */
export function reportUnsupportedPpb(own: unknown, label: string, warnings: string[]): void {
  if (!own || typeof own !== 'object' || Array.isArray(own)) return
  const ignored: string[] = []
  for (const [key, value] of Object.entries(own as Ppb)) {
    if (CARRIED.has(key) || NO_OP_KEYS.has(key)) continue
    if (key in UNSUPPORTED_DEFAULTS && UNSUPPORTED_DEFAULTS[key] === value) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    )
      continue
    ignored.push(`${key}=${JSON.stringify(value)}`)
  }
  if (ignored.length > 0) {
    warnings.push(
      `"${label}": request settings Testnizer does not have were not imported: ${ignored.join(', ')}.`,
    )
  }
}
