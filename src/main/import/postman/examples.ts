/**
 * Postman saved examples (`item.response[]`) → Testnizer saved responses
 * (`saved_responses`, issue #125 model), attached to the imported endpoint so
 * the APIs tree lists them under it (`savedResponse:listByProject`).
 *
 * `request_json.configured` is the example's `originalRequest` in the editor
 * shape (`{{var}}` kept); there is no `sent` (nothing was sent by Testnizer),
 * so the example view falls back to method + URL. Secret headers are masked
 * by `maskRequestJson`, like every other example write.
 */
import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import {
  SAVED_RESPONSE_BODY_LIMIT,
  SAVED_RESPONSE_COLUMNS,
  maskRequestJson,
} from '../../db/saved-response.repo'
import type { PostmanResponse } from './types'
import { parseHeaderString, toText } from './normalize'

export interface ExampleRequestSide {
  method: string
  url: string
  params: unknown[]
  headers: unknown[]
  body: unknown
  authType?: string
}

/** `_postman_previewlanguage` → a Content-Type for examples that carry none. */
const PREVIEW_CONTENT_TYPE: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  text: 'text/plain',
  javascript: 'application/javascript',
}

function responseHeaders(h: PostmanResponse['header']): Record<string, string> {
  const out: Record<string, string> = {}
  const rows = typeof h === 'string' ? parseHeaderString(h) : Array.isArray(h) ? h : []
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.key !== 'string' || !row.key) continue
    const v = toText(row.value)
    // Repeated headers (Set-Cookie) collapse into one comma-joined value, the
    // same shape the HTTP engine reports.
    out[row.key] = row.key in out ? `${out[row.key]}, ${v}` : v
  }
  return out
}

/** Postman example cookies → the response viewer's cookie rows (undefined when none). */
function exampleCookies(c: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(c) || c.length === 0) return undefined
  const out: Array<Record<string, unknown>> = []
  for (const raw of c) {
    if (!raw || typeof raw !== 'object') continue
    const k = raw as Record<string, unknown>
    const name = toText(k.name ?? k.key)
    if (!name) continue
    out.push({
      name,
      value: toText(k.value),
      domain: k.domain ? toText(k.domain) : undefined,
      path: k.path ? toText(k.path) : undefined,
      expires: k.expires ? toText(k.expires) : undefined,
      httpOnly: k.httpOnly === true ? true : undefined,
      secure: k.secure === true ? true : undefined,
    })
  }
  return out.length > 0 ? out : undefined
}

function statusCode(r: PostmanResponse): number | null {
  const n = typeof r.code === 'number' ? r.code : parseInt(String(r.code ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export interface InsertExamplesArgs {
  db: Database
  projectId: string
  endpointId: string
  responses: PostmanResponse[]
  /** Maps an example's originalRequest (or the item's request) to the editor shape. */
  requestSide: (r: PostmanResponse) => ExampleRequestSide
  label: string
  warnings: string[]
  /** Monotonic clock so examples keep their array order (the tree sorts by created_at). */
  clock: () => number
}

/** Insert every example of one request; returns how many were written. */
export function insertExamples(a: InsertExamplesArgs): number {
  const insert = a.db.prepare(
    `INSERT INTO saved_responses (${SAVED_RESPONSE_COLUMNS.join(', ')})
     VALUES (${SAVED_RESPONSE_COLUMNS.map(() => '?').join(', ')})`,
  )
  let n = 0
  for (const r of a.responses) {
    if (!r || typeof r !== 'object') continue
    const code = statusCode(r)
    const statusText = typeof r.status === 'string' ? r.status : undefined
    const headers = responseHeaders(r.header)
    const lang = typeof r._postman_previewlanguage === 'string' ? r._postman_previewlanguage : ''
    const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')
    if (!hasContentType && PREVIEW_CONTENT_TYPE[lang.toLowerCase()]) {
      headers['Content-Type'] = PREVIEW_CONTENT_TYPE[lang.toLowerCase()]
    }
    let body = toText(r.body)
    if (body.length > SAVED_RESPONSE_BODY_LIMIT) {
      a.warnings.push(
        `"${a.label}": the body of example "${r.name ?? ''}" is larger than ${SAVED_RESPONSE_BODY_LIMIT} characters and was not kept.`,
      )
      body = ''
    }
    const time = Number(r.responseTime)
    const req = a.requestSide(r)
    const name =
      toText(r.name).trim() || (code ? `${code}${statusText ? ' ' + statusText : ''}` : 'Example')
    insert.run(
      randomUUID(),
      a.projectId,
      'endpoint',
      a.endpointId,
      name,
      'http',
      req.method || null,
      req.url || null,
      code,
      JSON.stringify({
        protocol: 'http',
        status: code ?? undefined,
        statusText,
        headers,
        body: body || undefined,
        bodySize: body ? Buffer.byteLength(body, 'utf8') : 0,
        timing: { total: Number.isFinite(time) && time > 0 ? time : 0 },
        cookies: exampleCookies(r.cookie),
      }),
      a.clock(),
      maskRequestJson(JSON.stringify({ configured: req })),
    )
    n++
  }
  return n
}
