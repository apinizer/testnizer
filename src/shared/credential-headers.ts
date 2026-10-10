/**
 * ONE rule for "is this HTTP header name credential-bearing?" across every
 * MCP diagnostic that shows or logs headers: the OAuth debugger's step
 * records (`mcp-oauth.engine.ts` `redactHeaders`), the Security Scan's
 * evidence, value scrub, anonymous-probe header set and HTML report
 * (`mcp-security/wire.ts`, `mcp-security/redact.ts`), and the MCP console log
 * (`mcp.handler.ts`).
 *
 * Gateway credentials rarely use the standard names (`Ocp-Apim-Subscription-Key`,
 * `X-Gateway-Key`, `X-Access-Key`, `X-Client-Secret`, … — issue #137), so the
 * rule is deliberately broad: any name containing one of the words below.
 * Over-masking a harmless header costs a `••••` in a report; under-masking
 * leaks a key into an exported file. `WWW-Authenticate` is the server's
 * challenge, not a credential — it stays visible (that is what users debug).
 *
 * Pure TS, zero imports: compiled into both bundles (`src/shared/mcp-call.ts`
 * masks Send and Run displays with it), and `mcp.handler.ts` must not pull in the MCP SDK
 * through `mcp-oauth.engine.ts` (its tests mock the engine wholesale).
 */
export const CREDENTIAL_HEADER_NAME =
  /auth|token|secret|key|password|passwd|cookie|session|signature/i

export function isCredentialHeaderName(name: string): boolean {
  return name.toLowerCase() !== 'www-authenticate' && CREDENTIAL_HEADER_NAME.test(name)
}

/**
 * The value a credential is replaced with in History rows and saved examples
 * (`saved-response.repo.ts` `MASKED_VALUE`, the MCP History snapshot). Shared
 * so the renderer can recognise a masked value when it restores a row.
 */
export const HISTORY_MASK = '••••••'

/**
 * Words that make a tool / prompt ARGUMENT name credential-bearing. Arguments
 * are not headers: `author`, `keyword`, `authority`, `max_tokens` are ordinary
 * inputs, and masking them broke History restore (it re-sent the mask). So the
 * argument rule matches WHOLE words of the name — split on `_` / `-` / `.` /
 * spaces and camelCase (`APIKey` → api + key) — never substrings.
 */
const CREDENTIAL_ARG_WORDS = new Set([
  'token',
  'password',
  'passwd',
  'passphrase',
  'secret',
  'key',
  'auth',
  'authorization',
  'cookie',
  'session',
  'signature',
  'credential',
  'credentials',
  'bearer',
])

/** Credential names written as one lowercase word (`apikey`, `accesstoken`). */
const CREDENTIAL_ARG_COMPOUNDS = new Set([
  'apikey',
  'accesstoken',
  'authtoken',
  'refreshtoken',
  'idtoken',
  'clientsecret',
  'privatekey',
  'secretkey',
  'accesskey',
])

/** `apiKey` / `API_KEY` / `x-api-key` / `APIKey` → lowercase words. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}

/** Is this tool / prompt argument name credential-bearing? (whole-word rule, see above) */
export function isCredentialArgName(name: string): boolean {
  const words = nameWords(name)
  if (words.some((w) => CREDENTIAL_ARG_WORDS.has(w) || CREDENTIAL_ARG_COMPOUNDS.has(w))) {
    return true
  }
  return CREDENTIAL_ARG_COMPOUNDS.has(words.join(''))
}
