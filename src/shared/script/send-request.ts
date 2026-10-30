/**
 * `pm.sendRequest` input normalizer and response wrapper — shared by Send and
 * Run (issue #281, research D9/D10). Each path used to keep its own copy
 * (`normalizePmSendInput` in test-runner.ts, `normalizeRunnerSendInput` +
 * `buildResponseShim` in runner.handler.ts) with slightly different response
 * objects; only the transport (IPC vs engine call) is per path now.
 *
 * CERT SCOPE (R5): the normalized options carry no project id of any kind, so
 * a script-issued request never attaches a project client certificate — on
 * either path. Hosts add only the engine-level cookie-jar `projectId`
 * (issue #104), which does not load certificates.
 */
import { createPmResponse, type PmResponse } from './response'

/** A request a script fires: a URL string or a Postman request object. */
export type PmSendInput =
  | string
  | {
      url?: string | { raw?: string; toString?: () => string }
      method?: string
      header?: Array<{ key: string; value: string; disabled?: boolean }> | Record<string, string>
      body?: string | PmSendBodyInput
    }

/** A Postman request-body row (`urlencoded` / `formdata`). */
interface PmSendBodyRow {
  key?: string
  value?: unknown
  disabled?: boolean
  /** formdata: 'text' (default) or 'file'. */
  type?: string
  src?: unknown
}

/** Postman `RequestBody` definition accepted by `pm.sendRequest`. */
interface PmSendBodyInput {
  mode?: string
  raw?: string
  urlencoded?: PmSendBodyRow[] | Record<string, unknown>
  formdata?: PmSendBodyRow[] | Record<string, unknown>
  /** `mode: 'graphql'` — `variables` is a JSON string (Postman) or an object. */
  graphql?: { query?: unknown; variables?: unknown; operationName?: unknown }
  /** `mode: 'file'` — refused (no file sandbox for scripts). */
  file?: { src?: unknown }
  options?: { raw?: { language?: string } }
}

/** Engine key/value row (`KeyValuePair` on both paths). */
export interface PmSendKeyValue {
  id: string
  key: string
  value: string
  enabled: boolean
}

/** What the transport receives. Same shape on both paths. */
export interface PmSendOptions {
  method: string
  url: string
  headers: Array<{ key: string; value: string; enabled: boolean }>
  body?: {
    type: string
    content?: string
    urlEncoded?: PmSendKeyValue[]
    formData?: Array<PmSendKeyValue & { type: 'text' }>
  }
}

/** What the transport returns: the engine's response fields. */
export interface PmSendRawResponse {
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  bodySize?: number
  cookies?: Array<{ name: string; value: string }>
  timing?: { total?: number }
}

/** Per-path transport: IPC `request:send` on Send, `executeHttpRequest` on Run. */
export type PmSendTransport = (opts: PmSendOptions) => Promise<PmSendRawResponse>

/** The response a script gets: the full `pm.response` surface. */
export type PmSendResponse = PmResponse

function urlOf(u: unknown): string {
  if (typeof u === 'string') return u
  if (u && typeof u === 'object') {
    const raw = (u as { raw?: unknown }).raw
    if (typeof raw === 'string') return raw
    // A Url-like object (e.g. `pm.request.url`) passed straight through.
    const s = String(u)
    if (s !== '[object Object]') return s
  }
  return ''
}

export function normalizePmSendInput(req: unknown): PmSendOptions {
  if (typeof req === 'string') return { method: 'GET', url: req, headers: [] }
  const r = (req ?? {}) as Exclude<PmSendInput, string>
  const url = urlOf(r.url)
  const method = (r.method ?? 'GET').toUpperCase()
  let headers: PmSendOptions['headers'] = []
  if (Array.isArray(r.header)) {
    headers = r.header.map((h) => ({ key: h.key, value: h.value, enabled: h.disabled !== true }))
  } else if (r.header && typeof r.header === 'object') {
    headers = Object.entries(r.header).map(([key, value]) => ({
      key,
      value: String(value),
      enabled: true,
    }))
  }
  const body = normalizeBody(r.body)
  return body ? { method, url, headers, body } : { method, url, headers }
}

const RAW_TYPES: Record<string, string> = {
  json: 'json',
  xml: 'xml',
  html: 'html',
  javascript: 'javascript',
  text: 'text',
}

/** Postman body rows (array of {key,value,disabled} or a plain object) → engine rows. */
function bodyRows(
  rows: PmSendBodyRow[] | Record<string, unknown> | undefined,
  prefix: string,
): Array<PmSendKeyValue & { file: boolean }> {
  const list: PmSendBodyRow[] = Array.isArray(rows)
    ? rows
    : Object.entries(rows ?? {}).map(([key, value]) => ({ key, value }))
  return list
    .filter((row) => row && typeof row.key === 'string' && row.key.length > 0)
    .map((row, i) => ({
      id: `${prefix}-${i}`,
      key: row.key as string,
      value: row.value === undefined || row.value === null ? '' : String(row.value),
      enabled: row.disabled !== true,
      file: row.type === 'file',
    }))
}

function normalizeBody(b: string | PmSendBodyInput | undefined): PmSendOptions['body'] {
  if (typeof b === 'string') return { type: 'text', content: b }
  if (!b || typeof b !== 'object') return undefined
  switch (b.mode) {
    case 'raw': {
      const lang = b.options?.raw?.language ?? 'text'
      return { type: RAW_TYPES[lang] ?? 'text', content: b.raw ?? '' }
    }
    case 'urlencoded':
      return {
        type: 'urlencoded',
        urlEncoded: bodyRows(b.urlencoded, 'pm-ue').map(({ file: _file, ...row }) => row),
      }
    case 'formdata': {
      const rows = bodyRows(b.formdata, 'pm-fd')
      // A script-sent file part would read any local path the (possibly
      // imported, third-party) script names, from the main process. Postman
      // confines it to a working directory; Testnizer has no such sandbox for
      // scripts yet, so it refuses loudly instead of uploading or dropping it.
      const file = rows.find((row) => row.file && row.enabled)
      if (file) {
        throw new Error(
          `pm.sendRequest: file part "${file.key}" in a formdata body is not supported in scripts`,
        )
      }
      return {
        type: 'form-data',
        formData: rows
          .filter((row) => !row.file)
          .map(({ file: _file, ...row }) => ({ ...row, type: 'text' as const })),
      }
    }
    case 'graphql':
      // Postman's wire shape: one JSON body `{query, variables}` sent as
      // `application/json` — the engine's `json` type adds that header unless
      // the script set its own Content-Type.
      return { type: 'json', content: JSON.stringify(graphqlPayload(b.graphql)) }
    case 'file': {
      // Same reason as the formdata file part: a script must not read an
      // arbitrary local path from the main process. Refused, never dropped.
      const src = typeof b.file?.src === 'string' && b.file.src ? ` (${b.file.src})` : ''
      throw new Error(`pm.sendRequest: a "file" body${src} is not supported in scripts`)
    }
    default:
      return undefined
  }
}

/**
 * `{query, operationName?, variables}` of a graphql body. A string `variables`
 * is parsed the way the GraphQL editor's Send parses it (`graphql.store.ts`):
 * empty or unparsable → `{}`; an object is used as-is.
 */
function graphqlPayload(g: PmSendBodyInput['graphql']): Record<string, unknown> {
  const query = typeof g?.query === 'string' ? g.query : ''
  const raw = g?.variables
  let variables: unknown = {}
  if (typeof raw === 'string') {
    try {
      variables = JSON.parse(raw || '{}') as unknown
    } catch {
      variables = {}
    }
  } else if (raw && typeof raw === 'object') {
    variables = raw
  }
  const op = typeof g?.operationName === 'string' && g.operationName ? g.operationName : undefined
  return { query, ...(op ? { operationName: op } : {}), variables }
}

/** Wrap a transport response as the object `pm.sendRequest` resolves with. */
export function buildPmSendResponse(raw: PmSendRawResponse): PmSendResponse {
  const body = raw.body ?? ''
  const res = createPmResponse({
    code: raw.status ?? 0,
    statusText: raw.statusText ?? '',
    headers: raw.headers ?? {},
    body,
    cookies: raw.cookies ?? [],
    responseTime: raw.timing?.total ?? 0,
    responseSize: raw.bodySize ?? body.length,
  })
  // Both paths have always answered `null` for a non-JSON body here (unlike
  // `pm.response.json()`, which throws like Postman). Kept.
  res.json = (reviver?: (k: string, v: unknown) => unknown): unknown => {
    try {
      return JSON.parse(body, reviver)
    } catch {
      return null
    }
  }
  return res
}
