/**
 * Postman v3 collection (monolith shape — a v3 JSON file, or a folder read by
 * `folder-reader.ts`) → the v2.1 collection shape the existing importer walks
 * (issue #276 part 2).
 *
 * Reusing `importCollectionTx` keeps ONE importer: folders, collection auth
 * placement (inherit + carrier), collection scripts, variables (incl. secret
 * / vault rows), saved examples, request settings and the import report work
 * the same for v2.1 and v3. The mapping follows research 01-formats §3.4:
 *  - `items[]` → `item[]` (folders = `$kind: collection`);
 *  - `auth {type, credentials}` → `{type, [type]: [{key, value}]}`; a
 *    multi-auth array → its first entry (the rest reported); `inherit` → no
 *    block (= inherit);
 *  - `scripts [{type, code}]` → `event[]` (`beforeRequest` / `http:beforeRequest`
 *    → prerequest, `afterResponse` → test; other protocol prefixes reported);
 *  - `settings` → `protocolProfileBehavior` (same key names);
 *  - `url` + `queryParams` + `pathVariables` → `url {raw, query, variable}`;
 *  - `examples[] (http-example)` → `response[]`.
 * Non-HTTP kinds (GraphQL, gRPC, WebSocket, Socket.IO, MQTT, MCP, LLM) become
 * items WITHOUT a request; their v3 document rides in `nativeOf` (a WeakMap,
 * never a JSON key, so a v2 file cannot smuggle one in) and `native.ts`
 * writes them. Kafka / Data / unknown kinds are skipped and reported.
 */
import type {
  PostmanAuth,
  PostmanBody,
  PostmanCollection,
  PostmanEvent,
  PostmanItem,
  PostmanRequest,
  PostmanResponse,
  PostmanVariable,
} from '../types'
import { descriptionText, itemLabel, toText } from '../normalize'
import { isRecord, kvList, queryFromUrl, str, urlWithQuery, type Doc, type V3Kv } from './shapes'

/** Kinds Testnizer imports as their own protocol (see `native.ts`). */
export const NATIVE_KINDS = new Set([
  'graphql-request',
  'grpc-request',
  'websocket-request',
  'socket.io-request',
  'mqtt-request',
  'mcp-request',
  'llm-request',
])

export interface NativeV3Item {
  kind: string
  doc: Doc
  label: string
}

export interface V3Conversion {
  collection: PostmanCollection
  nativeOf: WeakMap<object, NativeV3Item>
  /** Requests skipped because Testnizer has no such protocol. */
  skipped: number
}

const SCHEMA_V3 = 'https://schema.postman.com/collection/json/v3.0.0/draft-07/collection.json'

/** v3 `variables` (list or map) → v2 `variable[]` (secret / vault kept for `toVariableRow`). */
export function v3Variables(raw: unknown): PostmanVariable[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const out: PostmanVariable[] = []
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (!isRecord(v) || typeof v.key !== 'string' || !v.key) continue
      const row: PostmanVariable = {
        key: v.key,
        value: v.value === undefined ? '' : toText(v.value),
      }
      if (v.disabled === true) row.disabled = true
      if (v.secret === true) {
        row.secret = true
        row.type = 'secret'
      }
      if (v.source !== undefined) row.source = v.source
      const d = descriptionText(v.description)
      if (d) row.description = d
      out.push(row)
    }
  } else if (isRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (isRecord(value)) {
        const row: PostmanVariable = { key, value: toText(value.value) }
        if (value.disabled === true) row.disabled = true
        if (value.secret === true) {
          row.secret = true
          row.type = 'secret'
        }
        if (value.source !== undefined) row.source = value.source
        out.push(row)
      } else {
        out.push({ key, value: toText(value) })
      }
    }
  }
  return out
}

/** One v3 auth object (not an array) → the v2.1 block; undefined = inherit. */
function singleAuth(a: Doc): PostmanAuth | undefined {
  const type = str(a.type)?.trim()
  if (!type || type === 'inherit') return undefined
  if (type === 'noauth') return { type: 'noauth' }
  const creds = kvList(a.credentials).map((c) => ({ key: c.key, value: c.value, type: 'string' }))
  return { type, [type]: creds }
}

/** v3 auth (object or multi-auth array) → v2.1 block; extra sets are reported. */
export function v3Auth(raw: unknown, label: string, warnings: string[]): PostmanAuth | undefined {
  if (Array.isArray(raw)) {
    const sets = raw.filter(isRecord)
    if (sets.length === 0) return undefined
    if (sets.length > 1) {
      const names = sets.map((s, i) => `"${str(s.name) || str(s.type) || `#${i + 1}`}"`)
      warnings.push(
        `"${label}": Postman multi-auth — only the first credential set ${names[0]} was imported; ${names
          .slice(1)
          .join(
            ', ',
          )} ${sets.length > 2 ? 'were' : 'was'} not (Testnizer applies one auth per level).`,
      )
    }
    if (Array.isArray(sets[0].rules) && sets[0].rules.length > 0) {
      warnings.push(
        `"${label}": the URL rules of credential set ${str(sets[0].name) ? `"${str(sets[0].name)}"` : '#1'} were not imported; it applies to every request.`,
      )
    }
    return singleAuth(sets[0])
  }
  return isRecord(raw) ? singleAuth(raw) : undefined
}

/** v3 script `type` → v2 `listen` at a level; null = not an HTTP script. */
function listenOf(type: string, level: 'request' | 'container'): 'prerequest' | 'test' | null {
  const t = level === 'container' ? type.replace(/^http:/, '') : type
  if (t === 'beforeRequest') return 'prerequest'
  if (t === 'afterResponse') return 'test'
  return null
}

/** v3 scripts → v2 events; non-HTTP lifecycle scripts are reported. */
export function v3Events(
  raw: unknown,
  level: 'request' | 'container',
  label: string,
  warnings: string[],
): PostmanEvent[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: PostmanEvent[] = []
  for (const s of raw) {
    if (!isRecord(s)) continue
    const type = str(s.type) ?? ''
    const code = typeof s.code === 'string' ? s.code : undefined
    const listen = listenOf(type, level)
    if (!listen) {
      if (code && code.trim())
        warnings.push(
          `"${label}": the "${type}" script was not imported (Testnizer runs pre-request and post-response scripts of HTTP requests).`,
        )
      continue
    }
    if (code === undefined) continue
    const script: PostmanEvent['script'] = { type: 'text/javascript', exec: code }
    if (isRecord(s.packages)) script.packages = s.packages
    out.push({ listen, script })
  }
  return out.length > 0 ? out : undefined
}

/** Request-level scripts of a non-HTTP kind → `{pre, post}` (types per kind). */
export function nativeScripts(
  raw: unknown,
  pre: string,
  post: string,
  label: string,
  warnings: string[],
): { preScript?: string; postScript?: string } {
  if (!Array.isArray(raw)) return {}
  const preParts: string[] = []
  const postParts: string[] = []
  for (const s of raw) {
    if (!isRecord(s)) continue
    const type = str(s.type) ?? ''
    const code = typeof s.code === 'string' ? s.code : ''
    if (type === pre) preParts.push(code)
    else if (type === post) postParts.push(code)
    else if (code.trim())
      warnings.push(
        `"${label}": the "${type}" script was not imported (Testnizer has no such step).`,
      )
  }
  return {
    ...(preParts.length > 0 ? { preScript: preParts.join('\n') } : {}),
    ...(postParts.length > 0 ? { postScript: postParts.join('\n') } : {}),
  }
}

const RAW_LANGS = new Set(['text', 'json', 'xml', 'html', 'javascript'])

/** v3 request body → v2 body. */
export function v3Body(raw: unknown): PostmanBody | undefined {
  if (!isRecord(raw)) return undefined
  const type = str(raw.type) ?? ''
  const c = raw.content
  switch (type) {
    case '':
    case 'none':
      return undefined
    case 'formdata': {
      const parts = Array.isArray(c) ? c.filter(isRecord) : []
      return {
        mode: 'formdata',
        formdata: parts.map((p) => {
          const isFile = str(p.type) === 'file'
          const src = Array.isArray(p.src) ? p.src.map((x) => toText(x)) : str(p.src)
          return {
            key: toText(p.key),
            ...(isFile ? { type: 'file', src } : { type: 'text', value: toText(p.value) }),
            ...(p.disabled === true ? { disabled: true } : {}),
            ...(descriptionText(p.description)
              ? { description: descriptionText(p.description) ?? '' }
              : {}),
            ...(str(p.contentType) ? { contentType: str(p.contentType) } : {}),
          }
        }),
      }
    }
    case 'urlencoded':
      return {
        mode: 'urlencoded',
        urlencoded: kvList(c).map((r) => ({
          key: r.key,
          value: r.value,
          ...(r.disabled ? { disabled: true } : {}),
          ...(r.description ? { description: r.description } : {}),
        })),
      }
    case 'file':
      return { mode: 'file', file: { src: isRecord(c) ? str(c.src) : str(c) } }
    case 'graphql': {
      const g = isRecord(c) ? c : {}
      return {
        mode: 'graphql',
        graphql: {
          query: toText(g.query),
          variables:
            typeof g.variables === 'string'
              ? g.variables
              : g.variables
                ? JSON.stringify(g.variables)
                : '',
          ...(typeof g.operationName === 'string' ? { operationName: g.operationName } : {}),
        },
      }
    }
    default:
      if (RAW_LANGS.has(type)) {
        const text =
          typeof c === 'string'
            ? c
            : c === undefined || c === null
              ? ''
              : JSON.stringify(c, null, 2)
        return { mode: 'raw', raw: text, options: { raw: { language: type } } }
      }
      // An unknown type: the v2 body mapper reports it.
      return { mode: type }
  }
}

/** URL + query rows + path variables → a v2 url object (raw keeps the query in sync). */
function v2Url(
  doc: Doc,
  label: string,
  warnings: string[],
): { raw: string; query: V3Kv[]; variable: V3Kv[] } {
  const url = str(doc.url) ?? ''
  const hasParams = doc.queryParams !== undefined && doc.queryParams !== null
  const params = hasParams ? kvList(doc.queryParams) : queryFromUrl(url)
  const { url: raw, rebuilt } = urlWithQuery(url, hasParams ? params : null)
  if (rebuilt) {
    warnings.push(
      `"${label}": the URL's query string and its query parameters disagreed; the parameter list was used.`,
    )
  }
  return { raw, query: params, variable: kvList(doc.pathVariables) }
}

function v2Request(doc: Doc, label: string, warnings: string[], withAuth = true): PostmanRequest {
  const u = v2Url(doc, label, warnings)
  const req: PostmanRequest = {
    method: (str(doc.method) || 'GET').toUpperCase(),
    url: {
      raw: u.raw,
      query: u.query.map((q) => ({
        key: q.key,
        value: q.value,
        ...(q.disabled ? { disabled: true } : {}),
        ...(q.description ? { description: q.description } : {}),
      })),
      ...(u.variable.length > 0
        ? {
            variable: u.variable.map((v) => ({
              key: v.key,
              value: v.value,
              ...(v.description ? { description: v.description } : {}),
            })),
          }
        : {}),
    },
    header: kvList(doc.headers).map((h) => ({
      key: h.key,
      value: h.value,
      ...(h.disabled ? { disabled: true } : {}),
      ...(h.description ? { description: h.description } : {}),
    })),
  }
  const body = v3Body(doc.body)
  if (body) req.body = body
  if (withAuth) {
    const auth = v3Auth(doc.auth, label, warnings)
    if (auth) req.auth = auth
  }
  return req
}

/** http-example[] → v2 response[]. */
function v2Responses(
  raw: unknown,
  label: string,
  warnings: string[],
): PostmanResponse[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: PostmanResponse[] = []
  for (const ex of raw) {
    if (!isRecord(ex)) continue
    const res = isRecord(ex.response) ? ex.response : {}
    const body = isRecord(res.body) ? res.body : {}
    const r: PostmanResponse = {
      name: str(ex.name),
      code:
        typeof res.statusCode === 'number' ? res.statusCode : Number(res.statusCode) || undefined,
      status: str(res.statusText),
      header: kvList(res.headers).map((h) => ({ key: h.key, value: h.value })),
      body:
        typeof body.content === 'string'
          ? body.content
          : body.content === undefined
            ? ''
            : JSON.stringify(body.content),
      _postman_previewlanguage: str(body.type) ?? null,
    }
    // The example's own request goes through the same URL check; a rewrite of
    // its query is reported under the example's name, not the request's.
    if (isRecord(ex.request)) {
      const exLabel = `${label} (example ${r.name ?? '(unnamed)'})`
      r.originalRequest = v2Request(ex.request, exLabel, warnings, false)
    }
    out.push(r)
  }
  return out.length > 0 ? out : undefined
}

function kindLabel(kind: string): string {
  return kind.replace(/-request$/, '')
}

/** Convert one v3 collection document. */
export function convertV3Collection(root: Doc, warnings: string[]): V3Conversion {
  const nativeOf = new WeakMap<object, NativeV3Item>()
  let skipped = 0
  const collName = str(root.name)?.trim() || 'Postman collection'

  const convertItems = (list: unknown, path: string[]): PostmanItem[] => {
    const out: PostmanItem[] = []
    if (!Array.isArray(list)) return out
    for (const raw of list) {
      if (!isRecord(raw)) continue
      const kind = str(raw.$kind) ?? ''
      const name = str(raw.name)?.trim() || '(unnamed)'
      const label = itemLabel(path, name)
      if (kind === 'collection' || (kind === '' && Array.isArray(raw.items))) {
        const folder: PostmanItem = {
          name,
          item: convertItems(raw.items, [...path, name]),
        }
        const d = descriptionText(raw.description)
        if (d) folder.description = d
        const auth = v3Auth(raw.auth, label, warnings)
        if (auth) folder.auth = auth
        const ev = v3Events(raw.scripts, 'container', label, warnings)
        if (ev) folder.event = ev
        const vars = v3Variables(raw.variables)
        if (vars && vars.length > 0) folder.variable = vars
        out.push(folder)
        continue
      }
      if (kind === 'http-request') {
        const item: PostmanItem = { name, request: v2Request(raw, label, warnings) }
        const d = descriptionText(raw.description)
        if (d) item.description = d
        const ev = v3Events(raw.scripts, 'request', label, warnings)
        if (ev) item.event = ev
        if (isRecord(raw.settings)) item.protocolProfileBehavior = raw.settings
        const responses = v2Responses(raw.examples, label, warnings)
        if (responses) item.response = responses
        out.push(item)
        continue
      }
      if (NATIVE_KINDS.has(kind)) {
        const item: PostmanItem = { name }
        const d = descriptionText(raw.description)
        if (d) item.description = d
        nativeOf.set(item, { kind, doc: raw, label })
        out.push(item)
        continue
      }
      skipped++
      if (kind === 'kafka-request' || kind === 'data-request') {
        warnings.push(
          `"${label}": ${kind === 'kafka-request' ? 'Kafka' : 'Data (database / file)'} request skipped — Testnizer does not support ${kindLabel(kind)} requests.`,
        )
      } else {
        warnings.push(`"${label}": unknown request kind "${kind || '(none)'}" skipped.`)
      }
    }
    return out
  }

  const collection: PostmanCollection = {
    info: { name: collName, schema: SCHEMA_V3 },
    item: convertItems(root.items, []),
  }
  const d = descriptionText(root.description)
  if (d) collection.info.description = d
  const vars = v3Variables(root.variables)
  if (vars && vars.length > 0) collection.variable = vars
  const auth = v3Auth(root.auth, `Collection "${collName}"`, warnings)
  if (auth) collection.auth = auth
  const ev = v3Events(root.scripts, 'container', `Collection "${collName}"`, warnings)
  if (ev) collection.event = ev
  return { collection, nativeOf, skipped }
}
