/**
 * `ParsedCurl` → the request shape the HTTP editor and the endpoint row use
 * (issue #279). ONE converter for the `import:curl` importer (main) and the
 * URL-bar paste (renderer), so an imported and a pasted command land the same.
 *
 * Decisions (documented in the issue):
 *  - body type: the explicit Content-Type decides (json / xml / html /
 *    javascript / urlencoded / text); without one a JSON-looking body is
 *    `json`, an XML-looking one `xml`, `k=v` data `urlencoded`, anything else
 *    `text` — never the invalid `'raw'` the old importer wrote. curl's implicit
 *    `Content-Type: application/x-www-form-urlencoded` is written as a header
 *    only when the body is urlencoded or text (what curl really sends); a
 *    JSON / XML body gets its type from the engine instead.
 *  - a single `@file` data part / `-T file` becomes a `binary` body pointing
 *    at that path (the engine streams it at Send) — nothing is read here.
 *  - `-u` → basic (or digest / ntlm with `--digest` / `--ntlm`, `DOMAIN\user`
 *    splits the NTLM domain); `--oauth2-bearer` → bearer. An `Authorization`
 *    header stays a header (as typed).
 *  - `-b` → `Cookie` header; `--compressed` → `Accept-Encoding`.
 *  - settings only when the command says so: `-k` → sslVerification false,
 *    `-L` → followRedirects, `--max-redirs`, `-m` (else `--connect-timeout`)
 *    → timeout in ms — through `readRequestSettings`, the one settings reader.
 */
import { readRequestSettings, type RequestSettings } from '../request-settings'
import type { CurlWarning, ParsedCurl } from './types'

/** The methods the HTTP editor can select (renderer `HttpMethod`). */
export const CURL_HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'QUERY',
] as const

export type CurlBodyType =
  | 'none'
  | 'json'
  | 'xml'
  | 'text'
  | 'html'
  | 'javascript'
  | 'form-data'
  | 'urlencoded'
  | 'binary'

export interface CurlKv {
  id: string
  key: string
  value: string
  enabled: boolean
}

export interface CurlFormKv extends CurlKv {
  type: 'text' | 'file'
  filePath?: string
}

export interface CurlRequestBody {
  type: CurlBodyType
  content?: string
  formData?: CurlFormKv[]
  urlEncoded?: CurlKv[]
  binaryPath?: string
}

export interface CurlRequestAuth {
  type: 'basic' | 'digest' | 'ntlm' | 'bearer'
  basic?: { username: string; password: string }
  digest?: { username: string; password: string }
  ntlm?: { username: string; password: string; domain?: string }
  bearer?: { token: string }
}

export interface CurlRequest {
  method: (typeof CURL_HTTP_METHODS)[number]
  url: string
  params: CurlKv[]
  headers: CurlKv[]
  body: CurlRequestBody
  /** Absent = the command carries no auth flag (the caller keeps its default). */
  auth?: CurlRequestAuth
  settings: RequestSettings
  warnings: CurlWarning[]
}

export interface CurlToRequestOptions {
  /** Row id factory — `randomUUID` in main, `makeId` in the renderer. */
  makeId: () => string
}

const FORM_CT = 'application/x-www-form-urlencoded'

/** Decode one urlencoded component (`+` is a space); a malformed `%` stays as typed. */
function formDecode(s: string): string {
  const spaced = s.replace(/\+/g, ' ')
  try {
    return decodeURIComponent(spaced)
  } catch {
    return spaced
  }
}

/** The URL's query split into rows — raw, exactly like the editor's URL ⇄ Params sync (issue #22). */
export function paramsFromUrl(url: string, makeId: () => string): CurlKv[] {
  const q = url.indexOf('?')
  if (q === -1) return []
  const qs = url.slice(q + 1).split('#')[0]
  const rows: CurlKv[] = []
  for (const pair of qs.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    rows.push({
      id: makeId(),
      key: eq === -1 ? pair : pair.slice(0, eq),
      value: eq === -1 ? '' : pair.slice(eq + 1),
      enabled: true,
    })
  }
  return rows
}

function looksJson(s: string): boolean {
  const t = s.trim()
  if (!/^[[{]/.test(t)) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    // `{"id":"{{id}}"}` style templates are still meant as JSON.
    return /^\{[\s\S]*\}$|^\[[\s\S]*\]$/.test(t) && /\{\{[^}]+\}\}/.test(t)
  }
}

function typeFromContentType(ct: string): CurlBodyType | null {
  const c = ct.toLowerCase()
  if (c.includes('x-www-form-urlencoded')) return 'urlencoded'
  if (c.includes('json')) return 'json'
  if (c.includes('xml')) return 'xml'
  if (c.includes('html')) return 'html'
  if (c.includes('javascript') || c.includes('ecmascript')) return 'javascript'
  if (c.startsWith('multipart/form-data')) return null
  return 'text'
}

export function curlToRequest(parsed: ParsedCurl, opts: CurlToRequestOptions): CurlRequest {
  const { makeId } = opts
  const warnings = [...parsed.warnings]
  const headers: CurlKv[] = parsed.headers.map((h) => ({
    id: makeId(),
    key: h.key,
    value: h.value,
    enabled: true,
  }))
  const findHeader = (name: string): CurlKv | undefined =>
    headers.find((h) => h.key.toLowerCase() === name)
  const addHeader = (key: string, value: string): void => {
    headers.push({ id: makeId(), key, value, enabled: true })
  }

  if (parsed.cookies.length > 0 && !findHeader('cookie')) {
    addHeader('Cookie', parsed.cookies.join('; '))
  }
  if (parsed.compressed && !findHeader('accept-encoding')) {
    addHeader('Accept-Encoding', 'deflate, gzip, br')
  }

  // ── Body ──────────────────────────────────────────────────────────────
  let body: CurlRequestBody = { type: 'none' }
  const userCt = findHeader('content-type')?.value
  if (parsed.form.length > 0) {
    body = {
      type: 'form-data',
      formData: parsed.form.map((p) =>
        p.kind === 'file'
          ? {
              id: makeId(),
              key: p.name,
              value: p.value,
              enabled: true,
              type: 'file',
              filePath: p.path,
            }
          : { id: makeId(), key: p.name, value: p.value, enabled: true, type: 'text' },
      ),
    }
  } else if (parsed.body !== undefined) {
    const fileParts = parsed.data.filter((d) => d.file !== undefined)
    if (
      parsed.data.length === 1 &&
      fileParts.length === 1 &&
      parsed.data[0].kind !== 'data-urlencode'
    ) {
      body = { type: 'binary', binaryPath: fileParts[0].file }
    } else {
      const text = parsed.body
      const allUrlencode = parsed.data.every((d) => d.kind === 'data-urlencode')
      let type: CurlBodyType
      if (userCt !== undefined) type = typeFromContentType(userCt) ?? 'text'
      else if (parsed.data.some((d) => d.kind === 'json') || looksJson(text)) type = 'json'
      else if (/^\s*</.test(text)) type = 'xml'
      else if (allUrlencode || /^[^=&\s{}[\]<>"]+=/.test(text)) type = 'urlencoded'
      else type = 'text'

      if (type === 'urlencoded') {
        body = {
          type,
          urlEncoded: text
            .split('&')
            .filter((pair) => pair !== '')
            .map((pair) => {
              const eq = pair.indexOf('=')
              return {
                id: makeId(),
                key: formDecode(eq === -1 ? pair : pair.slice(0, eq)),
                value: eq === -1 ? '' : formDecode(pair.slice(eq + 1)),
                enabled: true,
              }
            }),
        }
      } else {
        body = { type, content: text }
      }
      // What curl puts on the wire for -d without -H: the form content type.
      if (userCt === undefined && (type === 'urlencoded' || type === 'text')) {
        addHeader('Content-Type', FORM_CT)
      }
    }
  } else if (parsed.uploadFile && !parsed.get) {
    body = { type: 'binary', binaryPath: parsed.uploadFile }
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  let auth: CurlRequestAuth | undefined
  if (parsed.user) {
    const { username, password } = parsed.user
    if (parsed.authScheme === 'digest') auth = { type: 'digest', digest: { username, password } }
    else if (parsed.authScheme === 'ntlm') {
      const slash = username.indexOf('\\')
      auth =
        slash > 0
          ? {
              type: 'ntlm',
              ntlm: {
                username: username.slice(slash + 1),
                password,
                domain: username.slice(0, slash),
              },
            }
          : { type: 'ntlm', ntlm: { username, password } }
    } else {
      if (parsed.authScheme === 'negotiate' || parsed.authScheme === 'anyauth') {
        warnings.push({
          code: 'unsupported-flag',
          arg: `--${parsed.authScheme}`,
          message: `--${parsed.authScheme} has no equivalent; the credentials were set as Basic auth.`,
        })
      }
      auth = { type: 'basic', basic: { username, password } }
    }
  } else if (parsed.bearer !== undefined) {
    auth = { type: 'bearer', bearer: { token: parsed.bearer } }
  }

  // ── Method ────────────────────────────────────────────────────────────
  let method = parsed.method as CurlRequest['method']
  if (!(CURL_HTTP_METHODS as readonly string[]).includes(parsed.method)) {
    method = body.type === 'none' ? 'GET' : 'POST'
    warnings.push({
      code: 'unsupported-method',
      arg: parsed.method,
      message: `The HTTP editor has no ${parsed.method} method; ${method} was used instead.`,
    })
  }

  // ── Settings ──────────────────────────────────────────────────────────
  const rawSettings: Record<string, unknown> = {}
  if (parsed.insecure) rawSettings.sslVerification = false
  if (parsed.followRedirects !== undefined) rawSettings.followRedirects = parsed.followRedirects
  if (parsed.maxRedirects !== undefined) rawSettings.maxRedirects = parsed.maxRedirects
  const seconds = parsed.maxTimeSeconds ?? parsed.connectTimeoutSeconds
  if (seconds !== undefined) rawSettings.timeout = Math.round(seconds * 1000)

  return {
    method,
    url: parsed.url,
    params: paramsFromUrl(parsed.url, makeId),
    headers,
    body,
    auth,
    settings: readRequestSettings(rawSettings),
    warnings,
  }
}
