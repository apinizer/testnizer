/**
 * Request editor state → the normalised `CodegenRequest` every variant renders
 * (issue #280). The ONE place that decides what the snippet sends, following
 * the HTTP engine's rules (`http-auto-headers.ts` is the shared source):
 *
 *  - path variables first (`applyPathVariables`), then the Params table merged
 *    into the query before any `#fragment`, unsafe characters encoded;
 *  - the user's header rows (enabled, non-empty key, last one wins);
 *  - auth: bearer / API key in a header / OAuth2 token become a header unless
 *    the user typed that header; an API key "in query" is appended to the
 *    URL; Basic / Digest / NTLM are kept as credentials (`auth`) for the
 *    variant's language API — a user `Authorization` header wins over all;
 *  - the Content-Type the body implies (`defaultContentTypeForBody`) unless
 *    the user set one; form-data never carries one (the library writes the
 *    boundary — the engine drops a user value too);
 *  - GraphQL: a JSON `{query, variables}` body, variables parsed like Send
 *    (unparseable → `{}`).
 *
 * Variable resolution is NOT done here — the renderer facade resolves
 * `{{var}}` (secret variables stay as placeholders) before calling this.
 */
import { applyPathVariables } from '../path-variables'
import {
  defaultContentTypeForBody,
  hasHeaderIgnoreCase,
  hasUserContentType,
  userHeaderRecord,
} from '../http-auto-headers'
import { buildSnippetUrl, encodeQueryPart } from './url'
import type {
  CodegenBody,
  CodegenHeader,
  CodegenInput,
  CodegenInputBody,
  CodegenKv,
  CodegenRawFormat,
  CodegenRequest,
} from './types'

const RAW_FORMATS = new Set<string>(['json', 'xml', 'text', 'html', 'javascript'])

const enabledRows = (rows: readonly CodegenKv[] | undefined): CodegenKv[] =>
  (rows ?? []).filter((r) => r.enabled !== false && r.key)

/** GraphQL tab → the JSON body Send posts (`graphql.store.executeQuery`). */
export function graphqlJson(query: string, variables: string): string {
  let parsed: unknown = {}
  try {
    parsed = JSON.parse(variables.trim() || '{}')
  } catch {
    parsed = {}
  }
  return JSON.stringify({ query, variables: parsed })
}

function normalizeBody(body: CodegenInputBody | undefined): CodegenBody | undefined {
  if (!body || body.type === 'none') return undefined
  if (body.type === 'graphql' && body.graphql) {
    return {
      mode: 'raw',
      format: 'json',
      content: graphqlJson(body.graphql.query, body.graphql.variables),
    }
  }
  if (RAW_FORMATS.has(body.type)) {
    return body.content
      ? { mode: 'raw', format: body.type as CodegenRawFormat, content: body.content }
      : undefined
  }
  if (body.type === 'urlencoded') {
    const fields = enabledRows(body.urlEncoded).map((r) => ({ key: r.key, value: r.value }))
    if (fields.length === 0) return undefined
    const encoded = fields
      .map((f) => `${encodeQueryPart(f.key)}=${encodeQueryPart(f.value)}`)
      .join('&')
    return { mode: 'urlencoded', fields, encoded }
  }
  if (body.type === 'form-data') {
    const parts = enabledRows(body.formData).map((r) =>
      r.type === 'file'
        ? {
            kind: 'file' as const,
            key: r.key,
            path: r.filePath || r.value || '/path/to/file',
            fileName: r.value || (r.filePath ?? '').split(/[\\/]/).pop() || 'file',
          }
        : { kind: 'text' as const, key: r.key, value: r.value },
    )
    return parts.length > 0 ? { mode: 'form-data', parts } : undefined
  }
  if (body.type === 'binary') {
    return body.binaryPath ? { mode: 'binary', path: body.binaryPath } : undefined
  }
  return undefined
}

function impliedContentType(body: CodegenBody | undefined, inputType: string): string | undefined {
  if (!body || body.mode === 'form-data') return undefined
  if (body.mode === 'raw') return defaultContentTypeForBody(body.format)
  return defaultContentTypeForBody(body.mode === 'urlencoded' ? 'urlencoded' : inputType)
}

export function normalizeRequest(input: CodegenInput): CodegenRequest {
  const method = (input.method || 'GET').toUpperCase()
  const rawUrl = input.pathVariables?.length
    ? applyPathVariables(input.url, input.pathVariables)
    : input.url
  const params = [...(input.params ?? [])]
  const userRecord = userHeaderRecord(input.headers)
  const headers: CodegenHeader[] = Object.entries(userRecord).map(([key, value]) => ({
    key,
    value,
  }))
  const userHas = (name: string): boolean => hasHeaderIgnoreCase(userRecord, name)

  let auth: CodegenRequest['auth']
  const a = input.auth
  const addAuthHeader = (key: string, value: string): void => {
    if (!userHas(key)) headers.push({ key, value })
  }
  if (a?.type === 'bearer' && a.bearer?.token) {
    addAuthHeader('Authorization', `${a.bearer.prefix || 'Bearer'} ${a.bearer.token}`)
  } else if (a?.type === 'oauth2' && a.oauth2?.token?.trim()) {
    addAuthHeader('Authorization', `Bearer ${a.oauth2.token}`)
  } else if (a?.type === 'api-key' && a.apiKey?.key) {
    if (a.apiKey.in === 'query') {
      params.push({ key: a.apiKey.key, value: a.apiKey.value, enabled: true })
    } else {
      addAuthHeader(a.apiKey.key, a.apiKey.value)
    }
  } else if (!userHas('Authorization')) {
    if (a?.type === 'basic' && a.basic) {
      auth = { scheme: 'basic', username: a.basic.username, password: a.basic.password }
    } else if (a?.type === 'digest' && a.digest) {
      auth = { scheme: 'digest', username: a.digest.username, password: a.digest.password }
    } else if (a?.type === 'ntlm' && a.ntlm) {
      const { username, password, domain } = a.ntlm
      auth = { scheme: 'ntlm', username: domain ? `${domain}\\${username}` : username, password }
    }
  }

  const body = normalizeBody(input.body)
  let finalHeaders = headers
  if (body?.mode === 'form-data') {
    finalHeaders = headers.filter((h) => h.key.toLowerCase() !== 'content-type')
  } else {
    const ct = impliedContentType(body, input.body?.type ?? '')
    if (ct && !hasUserContentType(userRecord))
      finalHeaders = [...headers, { key: 'Content-Type', value: ct }]
  }

  const s = input.settings ?? {}
  const settings: CodegenRequest['settings'] = {}
  if (typeof s.timeout === 'number' && s.timeout > 0) settings.timeoutMs = s.timeout
  if (s.followRedirects === false) settings.followRedirects = false
  if (s.sslVerification === false) settings.insecure = true

  return {
    method,
    url: buildSnippetUrl(rawUrl, params),
    headers: finalHeaders,
    ...(auth ? { auth } : {}),
    ...(body ? { body } : {}),
    settings,
  }
}
