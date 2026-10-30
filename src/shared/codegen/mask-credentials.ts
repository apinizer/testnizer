/**
 * Generate Code with "Include secret values" OFF (issue #256): the LITERAL
 * credentials the user typed into the request are replaced with a mask, the
 * way secret VARIABLES already stay `{{name}}`.
 *
 * Applied by the renderer facade (`src/renderer/lib/code-generator.ts`
 * `prepare`) BEFORE `{{var}}` resolution and only when the toggle is OFF — so
 * a "literal" is only text the user typed; a non-secret variable still
 * resolves to its value. The one application point: no variant and no regex
 * over generated output.
 *
 * What is masked (and nothing else):
 *  - headers whose NAME is credential-bearing (`isCredentialHeaderName`);
 *    `Authorization` / `Proxy-Authorization` keep the scheme word
 *    (`Bearer ***`);
 *  - Params rows and the URL's own query pairs whose name is a credential
 *    argument name (`isCredentialArgName`, whole words — `author`, `page`
 *    stay); the URL is edited lexically (it may start with `{{baseUrl}}`, so
 *    it is never parsed with `new URL`);
 *  - the password of URL userinfo (`https://ada:***@host`; the user name
 *    stays, a userinfo without `:` stays);
 *  - the Authorization tab: bearer / OAuth2 token, API key VALUE, Basic /
 *    Digest / NTLM password (user name and domain stay);
 *  - urlencoded and form-data body rows with a credential argument name
 *    (file parts stay). JSON / raw / GraphQL bodies are NOT scrubbed: the
 *    format-preserving JSON scrubbers live in the renderer
 *    (`credential-text.ts`) and main (`sensitive-scrub.ts`), not in
 *    `src/shared`.
 * A value that is only `{{var}}` references (plus an optional scheme word)
 * carries no secret and stays as typed; a value mixing
 * literal text and references is masked whole. Empty values and disabled rows
 * stay as they are.
 *
 * Pure TS — returns a new request, never mutates the input.
 */
import { isCredentialArgName, isCredentialHeaderName } from '../credential-headers'
import { INLINE_MASK } from '../mcp-call'

/** The placeholder a masked literal becomes: URL-safe and base64-able (not `HISTORY_MASK`). */
export const CODEGEN_MASK = INLINE_MASK

interface MaskableKv {
  key: string
  value: string
  enabled?: boolean
  type?: string
}

interface MaskableAuth {
  type: string
  basic?: { password: string }
  bearer?: { token: string }
  apiKey?: { value: string }
  oauth2?: { token?: string }
  digest?: { password: string }
  ntlm?: { password: string }
}

interface MaskableBody {
  type: string
  formData?: readonly MaskableKv[]
  urlEncoded?: readonly MaskableKv[]
}

export interface MaskableRequest {
  url: string
  params?: readonly MaskableKv[]
  headers?: readonly MaskableKv[]
  auth?: MaskableAuth
  body?: MaskableBody
}

/** Auth scheme words (the renderer's `isTemplateOnlyValue` set, plus a few header schemes). */
const SCHEMES =
  'Bearer|Basic|Digest|Token|ApiKey|Api-Key|Key|SSWS|NTLM|Negotiate|Hawk|OAuth|DPoP|JWT|AWS4-HMAC-SHA256'

/**
 * Only `{{var}}` references, with an optional scheme word in front
 * (`Token {{key}}`) — the same shape the renderer's `isTemplateOnlyValue`
 * (withhold, AI Chat) treats as carrying no secret.
 */
const ONLY_REFERENCES = new RegExp(`^\\s*(?:(?:${SCHEMES})\\s+)?(?:\\{\\{[^{}]+\\}\\}\\s*)+$`, 'i')

/** A scheme word that stays readable in an Authorization header (`Bearer ***`). */
const SCHEME_WORD = new RegExp(`^(\\s*(?:${SCHEMES})\\s+)(\\S.*)$`, 'i')

const isAuthorizationHeader = (name: string): boolean =>
  /^(?:proxy-)?authorization$/i.test(name.trim())

/** A typed value that holds a literal secret (non-empty, not only `{{var}}`). */
function isLiteral(value: string): boolean {
  return value.trim() !== '' && !ONLY_REFERENCES.test(value)
}

const maskValue = (value: string): string => (isLiteral(value) ? CODEGEN_MASK : value)

function maskHeaderValue(name: string, value: string): string {
  if (!isAuthorizationHeader(name)) return maskValue(value)
  const m = SCHEME_WORD.exec(value)
  if (!m) return maskValue(value)
  return isLiteral(m[2]) ? `${m[1]}${CODEGEN_MASK}` : value
}

function maskRows<R extends MaskableKv>(
  rows: readonly R[],
  isCredentialName: (name: string) => boolean,
  maskOne: (row: R) => string = (row) => maskValue(row.value),
): R[] {
  return rows.map((row) => {
    if (row.enabled === false || row.type === 'file' || !isCredentialName(row.key ?? '')) {
      return row
    }
    const value = maskOne(row)
    return value === row.value ? row : { ...row, value }
  })
}

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return raw
  }
}

const URL_USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)([^/\s@?#]*)@/i

/** The URL with its userinfo password and credential query values masked, as typed otherwise. */
export function maskUrlCredentials(url: string): string {
  let out = url
  const ui = URL_USERINFO.exec(out)
  if (ui) {
    const colon = ui[2].indexOf(':')
    const pass = colon >= 0 ? ui[2].slice(colon + 1) : ''
    if (isLiteral(pass)) {
      const start = ui[1].length + colon + 1
      out = out.slice(0, start) + CODEGEN_MASK + out.slice(ui[1].length + ui[2].length)
    }
  }
  const q = out.indexOf('?')
  if (q < 0) return out
  const hashAt = out.indexOf('#', q)
  const end = hashAt < 0 ? out.length : hashAt
  const pairs = out
    .slice(q + 1, end)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=')
      if (eq < 0) return pair
      const name = decodeName(pair.slice(0, eq))
      if (!name || !isCredentialArgName(name)) return pair
      if (!isLiteral(decodeName(pair.slice(eq + 1)))) return pair
      return `${pair.slice(0, eq + 1)}${CODEGEN_MASK}`
    })
  return out.slice(0, q + 1) + pairs.join('&') + out.slice(end)
}

function maskAuth(auth: MaskableAuth): MaskableAuth {
  const a: MaskableAuth = { ...auth }
  if (a.bearer) a.bearer = { ...a.bearer, token: maskValue(a.bearer.token ?? '') }
  if (a.oauth2 && typeof a.oauth2.token === 'string')
    a.oauth2 = { ...a.oauth2, token: maskValue(a.oauth2.token) }
  if (a.apiKey) a.apiKey = { ...a.apiKey, value: maskValue(a.apiKey.value ?? '') }
  if (a.basic) a.basic = { ...a.basic, password: maskValue(a.basic.password ?? '') }
  if (a.digest) a.digest = { ...a.digest, password: maskValue(a.digest.password ?? '') }
  if (a.ntlm) a.ntlm = { ...a.ntlm, password: maskValue(a.ntlm.password ?? '') }
  return a
}

function maskBody(body: MaskableBody): MaskableBody {
  if (body.type === 'urlencoded' && body.urlEncoded)
    return { ...body, urlEncoded: maskRows(body.urlEncoded, isCredentialArgName) }
  if (body.type === 'form-data' && body.formData)
    return { ...body, formData: maskRows(body.formData, isCredentialArgName) }
  return body
}

/**
 * The request with its literal credentials replaced by `CODEGEN_MASK` (see
 * the module comment for the exact rule). A new object; `req` is untouched.
 */
export function maskCredentialLiterals<T extends MaskableRequest>(req: T): T {
  const out: MaskableRequest = { ...req, url: maskUrlCredentials(req.url ?? '') }
  if (req.headers)
    out.headers = maskRows(req.headers, isCredentialHeaderName, (h) =>
      maskHeaderValue(h.key, h.value),
    )
  if (req.params) out.params = maskRows(req.params, isCredentialArgName)
  if (req.auth) out.auth = maskAuth(req.auth)
  if (req.body) out.body = maskBody(req.body)
  return out as T
}
