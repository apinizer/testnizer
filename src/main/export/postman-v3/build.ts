/**
 * Testnizer project / test suite → ONE Postman v3 collection document in the
 * monolith shape the public v3 JSON Schema describes (issue #277). The JSON
 * export serialises it as-is; the folder writer (`folder-writer.ts`) splits
 * the SAME document into Native Git files, so the schema test on the JSON
 * vouches for the folder content too.
 *
 * Protocol → kind (research 01-formats §7.4): http / soap / sse →
 * `http-request`, graphql → `graphql-request`, grpc → `grpc-request`,
 * websocket → `websocket-request`, socketio → `socket.io-request`, mqtt →
 * `mqtt-request`, mcp →
 * `mcp-request`, ai → `llm-request`. Every field mirrors what the importer
 * (`src/main/import/postman/v3/`) reads back, so Testnizer → v3 → Testnizer
 * keeps the request. What v3 cannot hold is listed in `notes`.
 *
 * Secrets (issues #177 / #239): this module never reads a variable value or
 * the project auth itself — `index.ts` hands it rows that went through
 * `stripLocalSecrets`; request-level auth travels like every other export
 * (Postman / Bruno norm; use `{{secretVar}}`).
 */
import { readRequestSettings } from '../../../shared/request-settings'
import { readPathVariables } from '../../../shared/path-variables'
import { withAssertionScript } from '../../../shared/assertions-to-script'
import { readMqttMeta, readSioMeta, readWsMeta } from '../../../shared/realtime-meta'
import {
  DEFAULT_MQTT_SETTINGS,
  emptyConnectProperties,
  emptyLastWill,
  emptyPublishDraft,
  type MqttContentType,
  type MqttKeyValue,
  type MqttMessageProperties,
  type MqttWillProperties,
} from '../../../shared/mqtt'
import { parseJsonWithVars } from '../../../shared/json-with-vars'
import {
  soapTransportFromMeta,
  withSoapTransportHeaders,
  type SoapTransportMeta,
} from '../../../shared/soap-transport'
import type { ExportSkippedItem } from '../../../shared/collection-export'
import { authToV3 } from './auth'
import type { ExampleRow, ExportFolder, ExportRequest, ExportTree, Json } from './rows'

const isRecord = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export interface V3BuildContext {
  /** Saved examples of a request (`saved_responses`). */
  examplesOf: (req: ExportRequest) => ExampleRow[]
  /** Collection-level auth / scripts (the project's; for a suite, its project's scripts). */
  collectionAuth?: unknown
  collectionScripts?: { preScript?: string; testScript?: string }
  /** Collection variables (already stripped of secrets) — the JSON form only. */
  variables?: Array<{ key: string; value: string; secret: boolean; enabled: boolean }>
}

export interface V3Document {
  doc: Json
  skipped: ExportSkippedItem[]
  notes: string[]
}

interface Kv {
  key?: unknown
  value?: unknown
  enabled?: unknown
  description?: unknown
  type?: unknown
  filePath?: unknown
}

/** Editor rows → v3 key/value rows (`disabled` only when off, `description` only when set). */
function rows(list: unknown): Json[] {
  if (!Array.isArray(list)) return []
  const out: Json[] = []
  for (const r of list as Kv[]) {
    if (!r || typeof r !== 'object') continue
    const key = str(r.key)
    const value = str(r.value)
    if (!key && !value) continue
    const row: Json = { key, value }
    if (r.enabled === false) row.disabled = true
    if (typeof r.description === 'string' && r.description) row.description = r.description
    out.push(row)
  }
  return out
}

const RAW_TYPES = new Set(['json', 'xml', 'html', 'javascript', 'text'])

/** Editor body → v3 http body (undefined = none). */
function body(b: unknown): Json | undefined {
  if (!isRecord(b)) return undefined
  const type = str(b.type)
  if (type === 'json' && typeof b.content === 'string') {
    // A GraphQL-over-HTTP body imported from Postman is stored as JSON
    // `{query, variables}` — give it back as the graphql body type.
    try {
      const parsed = JSON.parse(b.content) as { query?: unknown; variables?: unknown }
      if (parsed && typeof parsed.query === 'string') {
        return {
          type: 'graphql',
          content: {
            query: parsed.query,
            variables: parsed.variables !== undefined ? JSON.stringify(parsed.variables) : '{}',
          },
        }
      }
    } catch {
      /* plain JSON */
    }
  }
  if (RAW_TYPES.has(type)) return { type, content: str(b.content) }
  if (type === 'form-data') {
    const parts = (Array.isArray(b.formData) ? b.formData : []) as Kv[]
    return {
      type: 'formdata',
      content: parts
        .filter((p) => p && (str(p.key) || str(p.value)))
        .map((p) =>
          p.type === 'file'
            ? {
                type: 'file',
                key: str(p.key),
                src: str(p.filePath) || str(p.value),
                ...(p.enabled === false ? { disabled: true } : {}),
              }
            : {
                type: 'text',
                key: str(p.key),
                value: str(p.value),
                ...(p.enabled === false ? { disabled: true } : {}),
              },
        ),
    }
  }
  if (type === 'urlencoded') return { type: 'urlencoded', content: rows(b.urlEncoded) }
  if (type === 'binary') {
    const src = str(b.binaryPath) || str(b.content)
    return { type: 'file', content: src ? { src } : {} }
  }
  return undefined
}

/** Request settings (issue #185) → v3 http `settings`. */
function httpSettings(schema: Json): Json | undefined {
  const s = readRequestSettings(schema)
  const out: Json = {}
  if (s.followRedirects !== undefined) out.followRedirects = s.followRedirects
  if (s.maxRedirects !== undefined) out.maxRedirects = s.maxRedirects
  if (s.sslVerification !== undefined) out.strictSSL = s.sslVerification
  return Object.keys(out).length > 0 ? out : undefined
}

function scripts(
  pre: unknown,
  post: unknown,
  preType: string,
  postType: string,
): Json[] | undefined {
  const out: Json[] = []
  if (typeof pre === 'string' && pre.trim())
    out.push({ type: preType, code: pre, language: 'text/javascript' })
  if (typeof post === 'string' && post.trim())
    out.push({ type: postType, code: post, language: 'text/javascript' })
  return out.length > 0 ? out : undefined
}

const HTTP_AUTH = new Set([
  'inherit',
  'noauth',
  'basic',
  'bearer',
  'apikey',
  'oauth1',
  'oauth2',
  'jwt',
  'ntlm',
  'digest',
  'edgegrid',
  'hawk',
  'asap',
  'awsv4',
])
const GRPC_AUTH = new Set(['inherit', 'noauth', 'basic', 'bearer', 'apikey', 'oauth2'])
const MCP_AUTH = new Set(['inherit', 'noauth', 'basic', 'bearer', 'oauth2'])
const FOLDER_AUTH = new Set([
  'noauth',
  'basic',
  'bearer',
  'apikey',
  'oauth1',
  'oauth2',
  'jwt',
  'ntlm',
  'digest',
  'edgegrid',
  'hawk',
  'asap',
  'awsv4',
])

class Builder {
  readonly skipped: ExportSkippedItem[] = []
  readonly notes: string[] = []
  constructor(private readonly ctx: V3BuildContext) {}

  note(label: string, what: string): void {
    this.notes.push(`"${label}": ${what}`)
  }

  auth(raw: unknown, allowed: Set<string>, label: string): Json | undefined {
    const a = authToV3(raw)
    if (!a) {
      if (isRecord(raw) && typeof raw.type === 'string' && raw.type !== 'none')
        this.note(label, `${raw.type} auth has no Postman counterpart and was not exported.`)
      return undefined
    }
    if (!allowed.has(String(a.type))) {
      this.note(
        label,
        `${String(a.type)} auth is not available for this request type in Postman and was not exported.`,
      )
      return undefined
    }
    return a
  }

  /** Common keys of every request kind. */
  head(req: ExportRequest, kind: string): Json {
    const doc: Json = { $kind: kind, name: req.name || '(unnamed)' }
    if (req.description) doc.description = req.description
    return doc
  }

  http(req: ExportRequest): Json {
    const s = req.schema
    const doc = this.head(req, 'http-request')
    doc.method = (str(s.method) || req.method || 'GET').toUpperCase()
    doc.url = str(s.url)
    let headers = Array.isArray(s.headers) ? (s.headers as Kv[]) : []
    if (req.protocol === 'soap') {
      const t = soapTransportFromMeta(req.meta.soap as SoapTransportMeta | undefined)
      if (t)
        headers = withSoapTransportHeaders(
          headers.map((h) => ({
            ...h,
            key: str(h.key),
            value: str(h.value),
            enabled: h.enabled !== false,
          })),
          t.version,
          t.action,
        )
    } else if (req.protocol === 'sse') {
      const custom = (req.meta.sse as { customHeaders?: unknown } | undefined)?.customHeaders
      if (Array.isArray(custom)) {
        const have = new Set(headers.map((h) => str(h.key).toLowerCase()))
        headers = [
          ...headers,
          ...(custom as Kv[]).filter((h) => str(h.key) && !have.has(str(h.key).toLowerCase())),
        ]
      }
    }
    const h = rows(headers)
    if (h.length > 0) doc.headers = h
    const q = rows(s.params)
    if (q.length > 0) doc.queryParams = q
    const pv = readPathVariables(s).map((v) => ({
      key: v.key,
      value: v.value,
      ...(v.description ? { description: v.description } : {}),
    }))
    if (pv.length > 0) doc.pathVariables = pv
    const b = body(s.body)
    if (b) doc.body = b
    const a = this.auth(s.auth, HTTP_AUTH, req.name)
    if (a) doc.auth = a
    const set = httpSettings(s)
    if (set) doc.settings = set
    const timeout = readRequestSettings(s).timeout
    if (timeout !== undefined)
      this.note(req.name, 'the request timeout has no Postman v3 field and was not exported.')
    const sc = scripts(
      s.preScript,
      withAssertionScript(str(s.postScript), req.assertions as never, 'pm'),
      'beforeRequest',
      'afterResponse',
    )
    if (sc) doc.scripts = sc
    const ex = this.examples(req)
    if (ex.length > 0) doc.examples = ex
    return doc
  }

  examples(req: ExportRequest): Json[] {
    const out: Json[] = []
    for (const e of this.ctx.examplesOf(req)) {
      const r = e.response
      const code =
        typeof e.statusCode === 'number'
          ? e.statusCode
          : typeof r.status === 'number'
            ? r.status
            : null
      if (code === null) {
        this.note(req.name, `the example "${e.name}" has no status code and was not exported.`)
        continue
      }
      const headers = isRecord(r.headers)
        ? Object.entries(r.headers).map(([key, value]) => ({ key, value: str(value) }))
        : []
      const ct =
        headers.find((x) => x.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? ''
      const type = ct.includes('json')
        ? 'json'
        : ct.includes('xml')
          ? 'xml'
          : ct.includes('html')
            ? 'html'
            : ct.includes('javascript')
              ? 'javascript'
              : ct.includes('yaml')
                ? 'yaml'
                : 'text'
      const c = e.configured ?? {}
      const request: Json = {
        url: str(c.url) || str(e.url) || str(req.schema.url),
        method: (str(c.method) || str(e.method) || req.method || 'GET').toUpperCase(),
      }
      const rh = rows(c.headers)
      if (rh.length > 0) request.headers = rh
      const rq = rows(c.params)
      if (rq.length > 0) request.queryParams = rq
      const rb = body(c.body)
      if (rb) request.body = rb
      out.push({
        $kind: 'http-example',
        name: e.name || String(code),
        request,
        response: {
          statusCode: code,
          statusText: str(r.statusText),
          ...(headers.length > 0 ? { headers } : {}),
          body: { type, content: str(r.body) },
        },
      })
    }
    return out
  }

  graphql(req: ExportRequest): Json {
    const s = req.schema
    const g = isRecord(req.meta.graphql) ? req.meta.graphql : {}
    const doc = this.head(req, 'graphql-request')
    let query = str(g.query)
    let variables =
      typeof g.variables === 'string'
        ? g.variables
        : g.variables !== undefined
          ? JSON.stringify(g.variables)
          : ''
    if (!query && isRecord(s.body)) {
      // A row without the GraphQL block: the body holds the query (or `{query, variables}` JSON).
      const content = str(s.body.content)
      if (s.body.type === 'graphql') query = content
      else {
        try {
          const p = JSON.parse(content) as { query?: unknown; variables?: unknown }
          if (typeof p.query === 'string') {
            query = p.query
            if (p.variables !== undefined) variables = JSON.stringify(p.variables)
          }
        } catch {
          /* not GraphQL */
        }
      }
    }
    doc.url = str(g.url) || str(s.url)
    doc.query = query
    if (variables) doc.variables = variables
    const h = rows(Array.isArray(g.headers) ? g.headers : s.headers)
    if (h.length > 0) doc.headers = h
    const a = this.auth(s.auth, HTTP_AUTH, req.name)
    if (a) doc.auth = a
    const sc = scripts(
      s.preScript,
      withAssertionScript(str(s.postScript), req.assertions as never, 'pm'),
      'beforeQuery',
      'afterResponse',
    )
    if (sc) doc.scripts = sc
    return doc
  }

  grpc(req: ExportRequest): Json {
    const s = req.schema
    const g = isRecord(req.meta.grpc) ? req.meta.grpc : {}
    // Rows from the proto importer keep their call under `request_schema.grpc`.
    const legacy = isRecord(s.grpc) ? s.grpc : {}
    const doc = this.head(req, 'grpc-request')
    doc.url = str(g.address) || str(legacy.serverAddress) || str(s.url)
    const service = str(g.selectedService) || str(legacy.serviceName)
    const method = str(g.selectedMethod) || str(legacy.methodName)
    if (service && method) doc.methodPath = `${service}/${method}`
    else if (method) doc.methodPath = method
    const content =
      typeof g.requestBody === 'string'
        ? g.requestBody
        : isRecord(s.body) && typeof s.body.content === 'string'
          ? s.body.content
          : ''
    if (content) doc.message = { content }
    const md = rows(g.metadata)
    if (md.length > 0) doc.metadata = md
    doc.settings = { secureConnection: g.useTls === true }
    if (g.protoSource === 'url' && str(g.protoUrl))
      doc.schema = { source: 'url', url: str(g.protoUrl) }
    else if (g.protoSource === 'file' || str(legacy.protoPath)) {
      const p = str(g.protoPath) || str(legacy.protoPath)
      // Only the file name: a local absolute path means nothing on another machine.
      doc.schema = { source: 'file', location: p ? p.split(/[\\/]/).pop() || p : '' }
    }
    const a = this.auth(s.auth, GRPC_AUTH, req.name)
    if (a) doc.auth = a
    return doc
  }

  websocket(req: ExportRequest): Json {
    const w = readWsMeta(req.meta.websocket)
    const doc = this.head(req, 'websocket-request')
    doc.url = w.url ?? str(req.schema.url)
    const h = rows(w.customHeaders)
    if (h.length > 0) doc.headers = h
    const q = rows(w.params)
    if (q.length > 0) doc.queryParams = q
    const st = w.settings
    if (st) {
      doc.settings = {
        handshakeTimeout: st.handshakeTimeout,
        retryCount: st.retryCount,
        retryDelay: st.retryDelay,
        strictSSL: st.strictSSL,
        // MB (the Settings field) → bytes (v3).
        maxPayload: st.maxPayload > 0 ? st.maxPayload * 1024 * 1024 : 0,
      }
    }
    const msgs = (w.savedMessages ?? []).map((m) => ({
      $kind: 'websocket-message',
      name: m.name || 'message',
      content: m.content,
      contentType: m.contentType,
    }))
    if (msgs.length > 0) doc.messages = msgs
    return doc
  }

  socketio(req: ExportRequest): Json {
    const s = readSioMeta(req.meta.socketio)
    const doc = this.head(req, 'socket.io-request')
    // v3 has no namespace field: Postman keeps it in the URL path.
    doc.url = joinNamespace(s.url ?? str(req.schema.url), s.namespace ?? '/')
    const h = rows(s.customHeaders)
    if (h.length > 0) doc.headers = h
    const q = rows(s.params)
    if (q.length > 0) doc.queryParams = q
    const events = (s.listeners ?? [])
      .filter((l) => l.name.trim())
      .map((l) => ({
        name: l.name,
        ...(l.description ? { description: l.description } : {}),
        subscribeOnConnect: l.listen,
      }))
    if (events.length > 0) doc.events = events
    const st = s.settings
    if (st) {
      doc.settings = {
        version: st.version,
        path: st.path,
        handshakeTimeout: st.handshakeTimeout,
        retryCount: st.retryCount,
        retryDelay: st.retryDelay,
        strictSSL: st.strictSSL,
      }
      if (st.transport !== 'auto')
        this.note(req.name, `the Socket.IO transport "${st.transport}" has no Postman v3 field.`)
    }
    if (s.listenAll === true && (s.listeners ?? []).length === 0)
      this.note(
        req.name,
        'shows every incoming event in Testnizer; Postman listens only to the events in its list.',
      )
    if (typeof s.bearerToken === 'string' && s.bearerToken.trim())
      this.note(
        req.name,
        'the Socket.IO handshake token has no Postman v3 field and was not exported.',
      )
    const msgs = (s.savedMessages ?? []).map((m) => ({
      $kind: 'socket.io-message',
      name: m.name || 'message',
      ...(m.description ? { description: m.description } : {}),
      eventName: m.eventName || 'message',
      acknowledgement: m.acknowledgement,
      args: m.args.map((a) => ({ content: a.content, contentType: a.contentType })),
    }))
    if (msgs.length > 0) doc.messages = msgs
    return doc
  }

  /**
   * MQTT (issue #284): the editor block already uses the v3 key names
   * (`src/shared/mqtt.ts`); only empty / default values are left out so an
   * import of the file restores the same block. v3 has no field for the
   * composer draft (the importer opens the first saved message in it), XML /
   * HTML payload formats, or disabled message user properties — noted.
   */
  mqtt(req: ExportRequest): Json {
    const m = readMqttMeta(req.meta.mqtt)
    const doc = this.head(req, 'mqtt-request')
    doc.url = m.url ?? str(req.schema.url)
    if (m.clientId) doc.clientId = m.clientId
    doc.version = m.version ?? 5
    const encoding = (t: MqttContentType, what: string): string => {
      if (t === 'xml' || t === 'html') {
        this.note(req.name, `the ${what} format ${t.toUpperCase()} is exported as text.`)
        return 'text'
      }
      return t
    }
    const plainRows = (list: MqttKeyValue[], what: string): Json[] => {
      if (list.some((r) => !r.enabled && r.key.trim()))
        this.note(req.name, `disabled ${what} user properties were not exported.`)
      return list
        .filter((r) => r.enabled && r.key.trim())
        .map((r) => ({ key: r.key, value: r.value }))
    }
    const msgProps = (
      p: Partial<MqttMessageProperties & MqttWillProperties>,
      what: string,
    ): Json | undefined => {
      const out: Json = {}
      if (p.payloadFormatIndicator) out.payloadFormatIndicator = true
      if (p.messageExpiryInterval != null) out.messageExpiryInterval = p.messageExpiryInterval
      if (p.willDelayInterval != null) out.willDelayInterval = p.willDelayInterval
      if (p.topicAlias != null) out.topicAlias = p.topicAlias
      if (p.responseTopic) out.responseTopic = p.responseTopic
      if (p.correlationData) out.correlationData = p.correlationData
      if (p.contentType) out.contentType = p.contentType
      const up = plainRows(p.userProperties ?? [], what)
      if (up.length > 0) out.userProperties = up
      return Object.keys(out).length > 0 ? out : undefined
    }
    const topics = (m.topics ?? [])
      .filter((t) => t.name.trim())
      .map((t) => {
        const topic: Json = { name: t.name, qos: t.qos, subscribe: t.subscribe }
        if (t.description) topic.description = t.description
        if (t.noLocal || t.retainAsPublished || t.retainHandling !== 0)
          topic.settings = {
            noLocal: t.noLocal,
            retainAsPublished: t.retainAsPublished,
            retainHandling: t.retainHandling,
          }
        return topic
      })
    if (topics.length > 0) doc.topics = topics
    const will = m.lastWill ?? emptyLastWill()
    if (will.topic.trim()) {
      const w: Json = {
        topic: will.topic,
        payload: will.payload,
        type: encoding(will.type, 'Last Will payload'),
        qos: will.qos,
        retain: will.retain,
      }
      const wp = msgProps(will.properties, 'Last Will')
      if (wp) w.properties = wp
      doc.lastWill = w
    }
    const cp = m.properties ?? emptyConnectProperties()
    const props: Json = {}
    if (cp.sessionExpiryInterval != null) props.sessionExpiryInterval = cp.sessionExpiryInterval
    if (cp.receiveMaximum != null) props.receiveMaximum = cp.receiveMaximum
    if (cp.maximumPacketSize != null) props.maximumPacketSize = cp.maximumPacketSize
    if (cp.requestResponseInformation) props.requestResponseInformation = true
    const cup = rows(cp.userProperties)
    if (cup.length > 0) props.userProperties = cup
    if (Object.keys(props).length > 0) doc.properties = props
    if (m.username || m.password) {
      const a = authToV3({
        type: 'basic',
        basic: { username: m.username ?? '', password: m.password ?? '' },
      })
      if (a) doc.auth = a
    }
    const st = m.settings ?? DEFAULT_MQTT_SETTINGS
    doc.settings = {
      cleanSession: st.cleanSession,
      keepAlive: st.keepAlive,
      autoReconnect: st.autoReconnect,
      connectionTimeout: st.connectionTimeout,
      strictSSL: st.strictSSL,
    }
    const saved = m.savedMessages ?? []
    const msgs = saved.map((msg) => {
      const out: Json = {
        $kind: 'mqtt-message',
        name: msg.name || 'message',
        ...(msg.description ? { description: msg.description } : {}),
        content: msg.content,
        topic: msg.topic,
        qos: msg.qos,
        retain: msg.retain,
        contentType: encoding(msg.contentType, 'message'),
      }
      const p = msgProps(msg.properties, 'message')
      if (p) out.properties = p
      return out
    })
    if (msgs.length > 0) doc.messages = msgs
    const c = m.composer ?? emptyPublishDraft()
    const first = saved[0]
    const draftOf = (d: typeof c): string =>
      JSON.stringify([d.topic, d.content, d.contentType, d.qos, d.retain, d.properties])
    const composerEmpty = !c.topic.trim() && !c.content.trim()
    if (!composerEmpty && (!first || draftOf(first) !== draftOf(c)))
      this.note(
        req.name,
        'the unsaved message in the composer has no Postman v3 field; save it as a saved message to export it.',
      )
    return doc
  }

  mcp(req: ExportRequest): Json {
    const m = isRecord(req.meta.mcp) ? req.meta.mcp : {}
    const doc = this.head(req, 'mcp-request')
    const transport = str(m.transport)
    const url = typeof m.url === 'string' ? m.url : str(req.schema.url)
    if (transport === 'stdio') {
      doc.transport = 'stdio'
      doc.command = url
      const env = rows(m.envVars)
      if (env.length > 0) doc.env = env
    } else {
      doc.transport = 'sse'
      doc.url = url
      const h = rows(m.customHeaders)
      if (h.length > 0) doc.headers = h
      if (transport === 'http' && /\/sse\/?(?:[?#].*)?$/i.test(url))
        this.note(
          req.name,
          'uses Streamable HTTP on a URL ending in /sse; Postman v3 records one transport ("sse").',
        )
    }
    const message = mcpMessage(m.call, (what) => this.note(req.name, what))
    if (message) doc.message = message
    const auth = isRecord(m.auth) ? m.auth : null
    if (auth && auth.type === 'oauth2') doc.auth = { type: 'oauth2', credentials: [] }
    else if (auth && auth.type !== 'none') {
      const a = this.auth(auth, MCP_AUTH, req.name)
      if (a) doc.auth = a
    }
    const settings: Json = {}
    const proto = str(m.protocol) || 'auto'
    if (proto === 'auto' || proto === 'legacy' || proto === '2026-07-28') settings.version = proto
    else {
      settings.version = 'legacy'
      this.note(
        req.name,
        `the MCP protocol pin ${proto} is exported as "legacy" (Postman offers auto / legacy / 2026-07-28).`,
      )
    }
    const timeout = readRequestSettings(req.schema).timeout
    if (timeout !== undefined) settings.requestTimeout = timeout
    doc.settings = settings
    return doc
  }

  llm(req: ExportRequest): Json {
    const a = isRecord(req.meta.ai) ? req.meta.ai : {}
    const doc = this.head(req, 'llm-request')
    const url = str(a.customUrl)
    if (url) doc.url = url
    doc.config = { model: str(a.model), provider: str(a.provider) || 'custom' }
    const settings: Json = {}
    if (typeof a.temperature === 'number') settings.temperature = a.temperature
    if (typeof a.maxTokens === 'number' && Number.isInteger(a.maxTokens))
      settings.maxToken = a.maxTokens
    if (Object.keys(settings).length > 0) doc.settings = settings
    if (str(a.systemPrompt).trim()) {
      doc.systemPrompts = [
        { id: 'system-1', value: str(a.systemPrompt), active: true, contentType: 'text' },
      ]
    }
    const headers = Array.isArray(a.customHeaders)
      ? (a.customHeaders as Kv[]).filter((h) => str(h.key).trim())
      : []
    if (headers.length > 0)
      this.note(req.name, 'AI Chat custom headers have no Postman v3 field and were not exported.')
    if (Array.isArray(a.toolServers) && a.toolServers.length > 0)
      this.note(req.name, 'AI Chat MCP tool servers were not exported.')
    return doc
  }

  request(req: ExportRequest): Json | null {
    switch (req.protocol) {
      case 'http':
      case 'https':
      case 'rest':
      case 'soap':
      case 'sse':
        return this.http(req)
      case 'graphql':
        return this.graphql(req)
      case 'grpc':
        return this.grpc(req)
      case 'websocket':
        return this.websocket(req)
      case 'socketio':
        return this.socketio(req)
      case 'mqtt':
        return this.mqtt(req)
      case 'mcp':
        return this.mcp(req)
      case 'ai':
        return this.llm(req)
      default:
        this.skipped.push({
          name: req.name,
          protocol: req.protocol,
          reason: 'unsupported-protocol',
        })
        return null
    }
  }

  folder(f: ExportFolder, items: Json[]): Json {
    const doc: Json = { $kind: 'collection', name: f.name || 'Folder' }
    const a = this.auth(f.auth, FOLDER_AUTH, f.name)
    if (a) doc.auth = a
    const sc = scripts(f.preScript, f.postScript, 'http:beforeRequest', 'http:afterResponse')
    if (sc) doc.scripts = sc
    doc.items = items
    return doc
  }
}

/** URL + namespace → the URL Postman stores (namespace in the path, before any query). */
export function joinNamespace(url: string, namespace: string): string {
  const ns =
    namespace && namespace !== '/' ? (namespace.startsWith('/') ? namespace : `/${namespace}`) : ''
  if (!ns) return url
  const q = url.search(/[?#]/)
  const base = (q >= 0 ? url.slice(0, q) : url).replace(/\/+$/, '')
  return base + ns + (q >= 0 ? url.slice(q) : '')
}

/** The saved MCP call → one JSON-RPC message (raw tool arguments kept, `{{var}}` included). */
export function mcpMessage(rawCall: unknown, note: (what: string) => void): string | undefined {
  if (!isRecord(rawCall)) return undefined
  const tab = str(rawCall.capabilityTab)
  const envelope = (method: string, params?: string): string =>
    `{"jsonrpc":"2.0","id":1,"method":${JSON.stringify(method)}${params !== undefined ? `,"params":${params}` : ''}}`
  if (tab === 'tools') {
    const tool = str(rawCall.selectedTool)
    if (!tool) return envelope('tools/list')
    let args = str(rawCall.toolArgs).trim() || '{}'
    if (!parseJsonWithVars(args)) {
      note('the tool arguments are not JSON and were exported as {}.')
      args = '{}'
    }
    return envelope('tools/call', `{"name":${JSON.stringify(tool)},"arguments":${args}}`)
  }
  if (tab === 'resources') {
    const uri = str(rawCall.resourceUriDraft) || str(rawCall.selectedResourceUri)
    return uri ? envelope('resources/read', JSON.stringify({ uri })) : envelope('resources/list')
  }
  if (tab === 'prompts') {
    const name = str(rawCall.selectedPrompt)
    if (!name) return envelope('prompts/list')
    const args = isRecord(rawCall.promptArgs) ? rawCall.promptArgs : {}
    return envelope('prompts/get', JSON.stringify({ name, arguments: args }))
  }
  return undefined
}

/** Build the v3 collection document of a tree. */
export function buildV3Document(tree: ExportTree, ctx: V3BuildContext): V3Document {
  const b = new Builder(ctx)
  const byParent = new Map<string | null, ExportFolder[]>()
  const ids = new Set(tree.folders.map((f) => f.id))
  for (const f of tree.folders) {
    const key = f.parentId && ids.has(f.parentId) ? f.parentId : null
    byParent.set(key, [...(byParent.get(key) ?? []), f])
  }
  const reqsOf = new Map<string | null, ExportRequest[]>()
  for (const r of tree.requests) {
    const key = r.folderId && ids.has(r.folderId) ? r.folderId : null
    reqsOf.set(key, [...(reqsOf.get(key) ?? []), r])
  }
  const level = (parent: string | null): Json[] => {
    const folders = (byParent.get(parent) ?? []).map((f) => b.folder(f, level(f.id)))
    const requests = (reqsOf.get(parent) ?? [])
      .map((r) => b.request(r))
      .filter((x): x is Json => x !== null)
    return tree.requestsFirst ? [...requests, ...folders] : [...folders, ...requests]
  }
  const doc: Json = { $kind: 'collection', name: tree.name || 'Collection' }
  if (tree.description) doc.description = tree.description
  if (ctx.variables && ctx.variables.length > 0) {
    doc.variables = ctx.variables.map((v) =>
      v.secret
        ? { key: v.key, secret: true, ...(v.enabled ? {} : { disabled: true }) }
        : { key: v.key, value: v.value, ...(v.enabled ? {} : { disabled: true }) },
    )
  }
  const sc = scripts(
    ctx.collectionScripts?.preScript,
    ctx.collectionScripts?.testScript,
    'http:beforeRequest',
    'http:afterResponse',
  )
  if (sc) doc.scripts = sc
  const a = b.auth(ctx.collectionAuth, FOLDER_AUTH, tree.name)
  if (a) doc.auth = a
  doc.items = level(null)
  return { doc, skipped: b.skipped, notes: b.notes }
}
