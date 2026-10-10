/**
 * Pure helpers for the AI Chat editor's saved / persisted configuration
 * (issues #187, #188, #189). No store imports — the store and the save path
 * both use these.
 */
import { isCredentialHeaderName } from '../../shared/credential-headers'
import { AI_MAX_TOKENS_CAP } from '../../shared/ai-limits'
import type { KeyValuePair } from '../types'

/**
 * Where a provider API key is kept in main's encrypted store (issue #188):
 * one key per provider, and per base URL for the Custom provider (two
 * gateways do not share a key). The base URL is the origin of the endpoint
 * URL — editing the path keeps the key — or the trimmed raw text when it is
 * not a parseable URL yet (`{{baseUrl}}/v1/chat`). The unresolved template is
 * used on purpose, so the lookup does not depend on the active environment.
 */
export function aiKeyScope(provider: string, customUrl: string): string {
  if (provider !== 'custom') return provider
  const raw = (customUrl ?? '').trim()
  try {
    const u = new URL(raw)
    if (u.protocol === 'http:' || u.protocol === 'https:') return `custom:${u.origin}`
  } catch {
    /* not a URL (yet) — fall through to the raw text */
  }
  return `custom:${raw}`
}

/** Whether a key scope names a real gateway origin (`custom:https://host`). */
export function isOriginKeyScope(scope: string): boolean {
  if (!scope.startsWith('custom:')) return false
  const rest = scope.slice('custom:'.length)
  try {
    const u = new URL(rest)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === rest
  } catch {
    return false
  }
}

/** The Custom provider's scope while the endpoint URL is still blank. */
const BLANK_CUSTOM_SCOPE = 'custom:'

/**
 * May a key entered for scope `origin` follow a Custom URL edit to `toScope`
 * (issue #188)? The caller tracks the key's original scope through a chain of
 * edits (`https://a` → `https:/` → `https://b` keeps `origin` = `https://a`).
 *  - a key typed for a real gateway origin never moves anywhere else;
 *  - a key typed for a templated / unparseable URL (`{{baseUrl}}/v1`) follows
 *    path edits that stay templated, but never lands on a real origin — the
 *    template may have meant another gateway;
 *  - a key typed while the URL was still blank follows the URL being typed
 *    (it was entered for whatever gateway comes next).
 * Never across providers. The carry is in memory only — never persisted.
 */
export function canCarryAiKey(origin: string, toScope: string): boolean {
  if (origin === toScope) return true
  if (!origin.startsWith('custom:') || !toScope.startsWith('custom:')) return false
  if (origin === BLANK_CUSTOM_SCOPE) return true
  return !isOriginKeyScope(origin) && !isOriginKeyScope(toScope)
}

/**
 * A credential header whose value is only `{{variable}}` references — with an
 * optional auth-scheme word in front (`Bearer {{token}}`) — carries no secret:
 * the secret lives in the environment variable. Such rows are kept when a
 * request is saved or the tab snapshot is written.
 */
const TEMPLATE_ONLY_CREDENTIAL =
  /^\s*(?:(?:Bearer|Basic|Token|Digest|ApiKey|Api-Key|Key|SSWS)\s+)?(?:\{\{[^{}]+\}\}\s*)+$/i

export function isTemplateOnlyValue(value: string): boolean {
  return TEMPLATE_ONLY_CREDENTIAL.test(value ?? '')
}

/**
 * Custom headers minus the ones that carry a credential (issue #188 / #187):
 * a row whose NAME is credential-bearing (`isCredentialHeaderName` — the one
 * rule every masking path uses) and whose value holds a literal secret is
 * dropped — not blanked: a blank but enabled `Authorization` row would still
 * be sent and replace the generated `Bearer <key>` header. Used for the
 * localStorage tab snapshot and for the saved request.
 */
export function stripCredentialHeaders(rows: KeyValuePair[] | undefined): KeyValuePair[] {
  return (rows ?? []).filter((h) => !isUnsavedCredentialRow(h))
}

/** The one rule `stripCredentialHeaders` drops a row by. */
function isUnsavedCredentialRow(h: KeyValuePair): boolean {
  return isCredentialHeaderName(h.key ?? '') && !isTemplateOnlyValue(h.value ?? '')
}

/**
 * Whether the headers hold a credential header with a literal value (issue
 * #187) — the row works for this session but is not saved with the request
 * or kept after a restart. A blank value is not a literal secret.
 */
export function hasSessionOnlyCredentialHeader(rows: KeyValuePair[] | undefined): boolean {
  return (rows ?? []).some((h) => isUnsavedCredentialRow(h) && (h.value ?? '').trim() !== '')
}

/** Valid sampling temperature (0–2 covers every supported provider). */
export function isValidTemperature(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 2
}

/** Valid `max_tokens`: a positive integer up to the cap main enforces. */
export function isValidMaxTokens(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= AI_MAX_TOKENS_CAP
}

/** Settings-field text → value: '' = provider default (null), invalid = undefined. */
export function parseTemperatureInput(text: string): number | null | undefined {
  if (text.trim() === '') return null
  const n = Number(text)
  return isValidTemperature(n) ? n : undefined
}

export function parseMaxTokensInput(text: string): number | null | undefined {
  if (text.trim() === '') return null
  const n = Number(text)
  return isValidMaxTokens(n) ? n : undefined
}
