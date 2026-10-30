/**
 * Postman collection v1 → the v2 model the importer reads (issue #276).
 *
 * Ported from postmanlabs/postman-collection-transformer v4.1.14,
 * `lib/converters/v1.0.0/converter-v1-to-v2.js`, `lib/common/v1.js` and the
 * legacy auth mappers in `lib/util.js`:
 *   https://github.com/postmanlabs/postman-collection-transformer
 *   Copyright Postman, Inc. — Licensed under the Apache License, Version 2.0
 *   (http://www.apache.org/licenses/LICENSE-2.0). Changes: rewritten in
 *   TypeScript without lodash; only the v1 → v2 direction; id retention and
 *   "retain empty values" options dropped; requests that no `order` lists are
 *   appended at the root with a warning instead of being dropped; URL query
 *   parsing is a plain split (no decoding) so `{{variables}}` stay intact.
 *
 * Output is the v2.0 shape (auth attributes as objects), which the v2
 * importer accepts next to the v2.1 array form.
 */
import type {
  PostmanAuth,
  PostmanBody,
  PostmanCollection,
  PostmanEvent,
  PostmanHeader,
  PostmanItem,
  PostmanRequest,
  PostmanResponse,
  PostmanUrl,
  PostmanVariable,
} from './types'
import { parseHeaderString } from './normalize'

type Obj = Record<string, unknown>
const isRecord = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export const SCHEMA_V2_URL = 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json'

/** v1 `currentHelper` → v2 auth type (`common/v1.js authMap`). */
const AUTH_MAP: Record<string, string> = {
  apikeyAuth: 'apikey',
  basicAuth: 'basic',
  bearerAuth: 'bearer',
  digestAuth: 'digest',
  hawkAuth: 'hawk',
  oAuth1: 'oauth1',
  oAuth2: 'oauth2',
  ntlmAuth: 'ntlm',
  awsSigV4: 'awsv4',
  jwtAuth: 'jwt',
  asapAuth: 'asap',
  edgegridAuth: 'edgegrid',
}

/** `util.authMappersFromLegacy` — renamed helper attributes per type. */
function legacyAuthParams(helper: string, a: Obj): Obj {
  switch (helper) {
    case 'apikeyAuth':
      return { key: a.key, value: a.value, in: a.in }
    case 'basicAuth':
      return { username: a.username, password: a.password }
    case 'bearerAuth':
      return { token: a.token }
    case 'digestAuth':
      return {
        algorithm: a.algorithm,
        username: a.username,
        realm: a.realm,
        password: a.password,
        nonce: a.nonce,
        nonceCount: a.nonceCount,
        clientNonce: a.clientNonce,
        opaque: a.opaque,
        qop: a.qop,
        disableRetryRequest: a.disableRetryRequest,
      }
    case 'oAuth1':
      return {
        consumerKey: a.consumerKey,
        consumerSecret: a.consumerSecret,
        token: a.token,
        tokenSecret: a.tokenSecret,
        signatureMethod: a.signatureMethod,
        timestamp: a.timestamp,
        nonce: a.nonce,
        version: a.version,
        realm: a.realm,
        addParamsToHeader: a.header,
        autoAddParam: a.auto,
        addEmptyParamsToSign: a.includeEmpty,
      }
    case 'hawkAuth':
      return {
        authId: a.hawk_id,
        authKey: a.hawk_key,
        algorithm: a.algorithm,
        user: a.user,
        nonce: a.nonce,
        extraData: a.ext,
        appId: a.app,
        delegation: a.dlg,
        timestamp: a.timestamp,
      }
    case 'ntlmAuth':
      return {
        username: a.username,
        password: a.password,
        domain: a.domain,
        workstation: a.workstation,
        disableRetryRequest: a.disableRetryRequest,
      }
    case 'oAuth2':
      return {
        accessToken: a.accessToken,
        addTokenTo: a.addTokenTo,
        callBackUrl: a.callBackUrl,
        authUrl: a.authUrl,
        accessTokenUrl: a.accessTokenUrl,
        clientId: a.clientId,
        clientSecret: a.clientSecret,
        clientAuth: a.clientAuth,
        grantType: a.grantType,
        scope: a.scope,
        username: a.username,
        password: a.password,
        tokenType: a.tokenType,
        redirectUri: a.redirectUri,
        refreshToken: a.refreshToken,
      }
    default:
      return { ...a }
  }
}

/** Drop undefined / null attribute values so the v2 reader sees only set keys. */
function compact(o: Obj): Obj {
  const out: Obj = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v
  return out
}

/** `Builders.auth` — the v2 `auth` array form, or the legacy helper fields. */
function convertAuth(e: Obj): PostmanAuth | undefined {
  const auth = e.auth
  const legacy = 'currentHelper' in e || !!e.helperAttributes
  if (!legacy && isRecord(auth) && typeof auth.type === 'string') {
    if (auth.type === 'noauth') return { type: 'noauth' }
    const attrs = auth[auth.type]
    if (Array.isArray(attrs)) {
      const map: Obj = {}
      for (const p of attrs) if (isRecord(p) && typeof p.key === 'string') map[p.key] = p.value
      return { type: auth.type, [auth.type]: map }
    }
    return auth as PostmanAuth
  }
  const helper = str(e.currentHelper)
  if (!helper || helper === 'normal') return undefined
  const type = AUTH_MAP[helper] ?? helper
  let attrs = e.helperAttributes
  if (typeof attrs === 'string') {
    try {
      attrs = JSON.parse(attrs)
    } catch {
      return undefined
    }
  }
  const out: PostmanAuth = { type }
  if (isRecord(attrs)) out[type] = compact(legacyAuthParams(helper, attrs))
  return out
}

/** `Builders.event` — `events[]` wins, else `tests` / `preRequestScript`. */
function convertEvents(e: Obj): PostmanEvent[] | undefined {
  const legacy = !!(e.tests || e.preRequestScript)
  if (!legacy && Array.isArray(e.events) && e.events.length > 0) {
    return e.events.filter(isRecord).map((ev) => {
      const script = isRecord(ev.script) ? { ...ev.script } : undefined
      if (script && typeof script.exec === 'string') script.exec = script.exec.split('\n')
      return { ...ev, listen: str(ev.listen) ?? 'test', script } as PostmanEvent
    })
  }
  const out: PostmanEvent[] = []
  const lines = (v: unknown): string[] =>
    typeof v === 'string' ? v.split('\n') : Array.isArray(v) ? v.map(String) : []
  if (e.tests)
    out.push({ listen: 'test', script: { type: 'text/javascript', exec: lines(e.tests) } })
  if (e.preRequestScript)
    out.push({
      listen: 'prerequest',
      script: { type: 'text/javascript', exec: lines(e.preRequestScript) },
    })
  return out.length > 0 ? out : undefined
}

/** `util.handleVars` for `variables` / `variable`. */
function convertVariables(e: Obj): PostmanVariable[] | undefined {
  const src = Array.isArray(e.variables)
    ? e.variables
    : Array.isArray(e.variable)
      ? e.variable
      : null
  if (!src) return undefined
  const out: PostmanVariable[] = []
  for (const v of src) {
    if (!isRecord(v)) continue
    const key = str(v.key) ?? str(v.id)
    if (!key) continue
    const row: PostmanVariable = { key, value: v.value }
    if (typeof v.type === 'string') row.type = v.type === 'text' ? 'string' : v.type
    if (v.disabled) row.disabled = true
    if (v.secret) row.secret = true
    if (v.source) row.source = v.source
    if (v.description) row.description = v.description as string
    out.push(row)
  }
  return out.length > 0 ? out : undefined
}

/** `{key, value}` pairs of a raw query string — split only, never decoded. */
function parseQuery(raw: string): Array<{ key: string; value: string | null }> {
  const q = raw.split('#')[0]
  const idx = q.indexOf('?')
  if (idx < 0) return []
  return q
    .slice(idx + 1)
    .split('&')
    .filter((p) => p.length > 0)
    .map((p) => {
      const eq = p.indexOf('=')
      return eq < 0 ? { key: p, value: null } : { key: p.slice(0, eq), value: p.slice(eq + 1) }
    })
}

/** `Builders.url` — object form when query params or path variables exist. */
function convertUrl(r: Obj): PostmanUrl | string | undefined {
  const raw = r.url === undefined || r.url === null ? undefined : String(r.url)
  const query: Array<{
    key: string
    value: string | null
    disabled?: boolean
    description?: string
  }> = []
  if (Array.isArray(r.queryParams) && r.queryParams.length > 0) {
    for (const qp of r.queryParams) {
      if (!isRecord(qp) || typeof qp.key !== 'string') continue
      const row: { key: string; value: string | null; disabled?: boolean; description?: string } = {
        key: qp.key,
        value: qp.value === undefined || qp.value === null ? null : String(qp.value),
      }
      if (qp.enabled === false) row.disabled = true
      if (typeof qp.description === 'string' && qp.description) row.description = qp.description
      if ('equals' in qp) row.value = qp.equals ? (row.value ?? '') : row.value || null
      query.push(row)
    }
  } else if (raw) {
    query.push(...parseQuery(raw))
  }
  const variable: Array<{ key: string; value?: unknown; description?: string }> = []
  const seen = new Set<string>()
  if (Array.isArray(r.pathVariableData)) {
    for (const pv of r.pathVariableData) {
      if (!isRecord(pv) || typeof pv.key !== 'string') continue
      variable.push({
        key: pv.key,
        value: pv.value,
        ...(typeof pv.description === 'string' && pv.description
          ? { description: pv.description }
          : {}),
      })
      seen.add(pv.key)
    }
  }
  if (isRecord(r.pathVariables)) {
    for (const [key, value] of Object.entries(r.pathVariables)) {
      if (!seen.has(key)) variable.push({ key, value })
    }
  }
  if (query.length === 0 && variable.length === 0) return raw
  const out: PostmanUrl = { raw: raw ?? '' }
  if (query.length > 0) out.query = query
  if (variable.length > 0) out.variable = variable
  return out
}

/** `Builders.header` — `headerData[]` (with descriptions) plus the `headers` string. */
function convertHeaders(r: Obj): PostmanHeader[] {
  if (Array.isArray(r.headers)) return r.headers as PostmanHeader[]
  const out: PostmanHeader[] = []
  const seen = new Set<string>()
  for (const h of Array.isArray(r.headerData) ? r.headerData : []) {
    if (!isRecord(h) || typeof h.key !== 'string') continue
    let key = h.key
    let disabled = h.enabled === false
    if (key.startsWith('//')) {
      disabled = true
      key = key.slice(2).trim()
    }
    const row: PostmanHeader = { key, value: h.value === undefined ? '' : String(h.value) }
    if (disabled) row.disabled = true
    if (typeof h.description === 'string' && h.description) row.description = h.description
    out.push(row)
    seen.add(key)
  }
  if (typeof r.headers === 'string') {
    for (const h of parseHeaderString(r.headers)) if (!seen.has(h.key)) out.push(h)
  }
  return out
}

/** v1 `data[]` (params / urlencoded) → v2 rows (`parseFormData`). */
function formRows(data: unknown): Array<Obj> {
  if (!Array.isArray(data)) return []
  const out: Obj[] = []
  for (const d of data) {
    if (!isRecord(d) || d.key === undefined || d.key === null) continue
    const p: Obj = { ...d }
    if (p.type === 'file' && !p.src && p.value) {
      p.src = typeof p.value === 'string' || Array.isArray(p.value) ? p.value : null
      delete p.value
    }
    if ('enabled' in p) {
      if (p.enabled === false) p.disabled = true
      delete p.enabled
    }
    if (!p.description) delete p.description
    out.push(p)
  }
  return out
}

/** `Builders.body`. */
function convertBody(r: Obj): PostmanBody | undefined {
  const modes: Record<string, string> = {
    binary: 'file',
    graphql: 'graphql',
    params: 'formdata',
    raw: 'raw',
    urlencoded: 'urlencoded',
  }
  const dataMode = typeof r.dataMode === 'string' ? modes[r.dataMode] : undefined
  const isEmpty = (v: unknown): boolean =>
    v === undefined ||
    v === null ||
    v === '' ||
    (Array.isArray(v) && v.length === 0) ||
    (isRecord(v) && Object.keys(v).length === 0)
  const emptyBody = isEmpty(r.data) && isEmpty(r.rawModeData) && isEmpty(r.graphqlModeData)
  if ((!dataMode && emptyBody) || r.dataMode === null) return undefined

  let rawModeData: string | undefined
  if (typeof r.rawModeData === 'string') rawModeData = r.rawModeData
  else if (
    Array.isArray(r.rawModeData) &&
    r.rawModeData.length === 1 &&
    typeof r.rawModeData[0] === 'string'
  )
    rawModeData = r.rawModeData[0]
  let graphqlModeData: unknown
  if (!isEmpty(r.graphqlModeData)) graphqlModeData = r.graphqlModeData
  else if (isRecord(r.dataOptions) && r.dataOptions.graphql !== undefined && !isEmpty(r.data))
    graphqlModeData = r.data

  const body: PostmanBody = {}
  if (dataMode) body.mode = dataMode
  else if (!rawModeData && Array.isArray(r.data ?? r.rawModeData)) body.mode = 'formdata'
  else if (!rawModeData && graphqlModeData) body.mode = 'graphql'
  else body.mode = 'raw'

  if (body.mode === 'raw') {
    body.raw = rawModeData ?? (typeof r.data === 'string' ? r.data : '')
  } else if (body.mode === 'graphql') {
    body.graphql = graphqlModeData as PostmanBody['graphql']
  } else if (body.mode === 'file') {
    body.file = { src: rawModeData }
  } else {
    const rows = formRows(r.data ?? r.rawModeData)
    if (body.mode === 'formdata') body.formdata = rows as unknown as PostmanBody['formdata']
    else body.urlencoded = rows as unknown as PostmanBody['urlencoded']
  }
  if (isRecord(r.dataOptions)) {
    const options: Obj = {}
    for (const [m, v2] of Object.entries(modes)) {
      const o = r.dataOptions[m]
      if (o !== undefined && !isEmpty(o)) options[v2] = o
    }
    if (Object.keys(options).length > 0) body.options = options as PostmanBody['options']
  }
  if (r.dataDisabled) body.disabled = true
  return body
}

/** `Builders.request`. */
function convertRequest(r: Obj): PostmanRequest {
  const req: PostmanRequest = {
    auth: convertAuth(r),
    method: str(r.method),
    header: convertHeaders(r),
    body: convertBody(r),
    url: convertUrl(r),
  }
  if (r.description) req.description = r.description as string
  return req
}

/** `Builders.savedRequest` — inline object, JSON text, or a request id. */
function savedRequestOf(res: Obj, cache: Map<string, Obj>): Obj | undefined {
  for (const field of ['requestObject', 'request'] as const) {
    const v = res[field]
    if (isRecord(v)) return v
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v) as unknown
        if (isRecord(parsed)) return parsed
      } catch {
        const hit = cache.get(v)
        if (hit) return hit
      }
    }
  }
  return undefined
}

/** `Builders.response` + `singleResponse`, honouring `responses_order`. */
function convertResponses(r: Obj, cache: Map<string, Obj>): PostmanResponse[] {
  const list = Array.isArray(r.responses) ? r.responses.filter(isRecord) : []
  if (list.length === 0) return []
  const byId = new Map<string, Obj>()
  list.forEach((res, i) => byId.set(str(res.id) ?? `#${i}`, res))
  let order = Array.isArray(r.responses_order)
    ? (r.responses_order as unknown[]).map(String).filter((id) => byId.has(id))
    : []
  if (order.length === 0) order = [...byId.keys()]
  return order.map((id) => {
    const res = byId.get(id) as Obj
    const original = savedRequestOf(res, cache)
    const code = isRecord(res.responseCode) ? res.responseCode : undefined
    return {
      name: str(res.name) ?? 'response',
      originalRequest: original ? convertRequest(original) : undefined,
      status: code ? str(code.name) : undefined,
      code: code ? Number(code.code) || undefined : undefined,
      _postman_previewlanguage: str(res.language),
      _postman_previewtype: str(res.previewType),
      header: Array.isArray(res.headers) ? (res.headers as PostmanResponse['header']) : undefined,
      cookie: Array.isArray(res.cookies)
        ? res.cookies.filter(isRecord).map((c) => ({
            expires:
              typeof c.expirationDate === 'number'
                ? new Date(c.expirationDate * 1000).toString()
                : undefined,
            hostOnly: c.hostOnly,
            httpOnly: c.httpOnly,
            domain: str(c.domain) ?? '',
            path: str(c.path) ?? '',
            secure: c.secure,
            session: c.session,
            value: c.value,
            key: c.name,
          }))
        : undefined,
      // v1 apps wrote the time as a number or a numeric string.
      responseTime:
        typeof res.time === 'number' || typeof res.time === 'string' ? res.time : undefined,
      body: typeof res.text === 'string' ? res.text : undefined,
    }
  })
}

function withPpb<T extends { protocolProfileBehavior?: Record<string, unknown> }>(
  src: Obj,
  dest: T,
): T {
  const b = src.protocolProfileBehavior
  if (isRecord(b) && Object.keys(b).length > 0) dest.protocolProfileBehavior = b
  return dest
}

/** Convert a v1 collection. Warnings name requests the folder order did not reach. */
export function convertV1Collection(v1: unknown, warnings: string[]): PostmanCollection {
  if (!isRecord(v1)) throw new Error('Not a Postman v1 collection')
  const requests = Array.isArray(v1.requests) ? v1.requests.filter(isRecord) : []
  const cache = new Map<string, Obj>()
  for (const r of requests) if (typeof r.id === 'string') cache.set(r.id, r)
  const used = new Set<string>()

  const singleItem = (r: Obj): PostmanItem => {
    if (typeof r.id === 'string') used.add(r.id)
    const item: PostmanItem = { name: str(r.name) ?? '' }
    const ev = convertEvents(r)
    if (ev) item.event = ev
    withPpb(r, item)
    item.request = convertRequest(r)
    const responses = convertResponses(r, cache)
    if (responses.length > 0) item.response = responses
    const vars = convertVariables(r)
    if (vars) item.variable = vars
    return item
  }

  // Folders and their nesting (`folders_order`).
  const folders = Array.isArray(v1.folders) ? v1.folders.filter(isRecord) : []
  const groups = new Map<string, PostmanItem>()
  const subfolder = new Set<string>()
  for (const f of folders) {
    const g: PostmanItem = { name: str(f.name) ?? '', item: [] }
    if (f.description) g.description = f.description as string
    const auth = convertAuth(f)
    if (auth) g.auth = auth
    const ev = convertEvents(f)
    if (ev) g.event = ev
    const vars = convertVariables(f)
    if (vars) g.variable = vars
    withPpb(f, g)
    groups.set(String(f.id), g)
  }
  for (const f of folders) {
    const g = groups.get(String(f.id)) as PostmanItem
    for (const subId of Array.isArray(f.folders_order) ? f.folders_order : []) {
      const sub = groups.get(String(subId))
      if (!sub) continue
      subfolder.add(String(subId))
      g.item!.push(sub)
    }
    for (const reqId of Array.isArray(f.order) ? f.order : []) {
      const r = cache.get(String(reqId))
      if (r) g.item!.push(singleItem(r))
    }
  }
  const rootOrder = Array.isArray(v1.folders_order)
    ? (v1.folders_order as unknown[]).map(String)
    : folders.map((f) => String(f.id))
  const item: PostmanItem[] = []
  for (const id of [...new Set(rootOrder)]) {
    const g = groups.get(id)
    if (g && !subfolder.has(id)) item.push(g)
  }
  for (const reqId of Array.isArray(v1.order) ? v1.order : []) {
    const r = cache.get(String(reqId))
    if (r && !used.has(String(reqId))) item.push(singleItem(r))
  }
  // Postman's converter drops requests no order lists; keep them at the root.
  const orphans = requests.filter((r) => typeof r.id !== 'string' || !used.has(r.id))
  for (const r of orphans) item.push(singleItem(r))
  if (orphans.length > 0) {
    warnings.push(
      `Postman v1: ${orphans.length} request(s) not listed in any folder order were imported at the top level: ` +
        orphans.map((r) => str(r.name) ?? '(unnamed)').join(', ') +
        '.',
    )
  }

  const collection: PostmanCollection = {
    info: {
      _postman_id: str(v1.id),
      name: str(v1.name) ?? 'Postman collection',
      schema: SCHEMA_V2_URL,
    },
    item,
  }
  if (v1.description) collection.info.description = v1.description as string
  const auth = convertAuth(v1)
  if (auth && auth.type !== 'noauth') collection.auth = auth
  const ev = convertEvents(v1)
  if (ev) collection.event = ev
  const vars = convertVariables(v1)
  if (vars) collection.variable = vars
  withPpb(v1, collection)
  return collection
}
