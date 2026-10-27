/**
 * Postman v3 non-HTTP request kinds → Testnizer endpoints of their own
 * protocol (issue #276 part 2). Called by the shared walker in `v2.ts` for
 * the items `to-v2.ts` marked native.
 *
 * Each kind writes `request_schema.metadata.<protocol>` in exactly the shape
 * the editor's Ctrl+S writes (`snapshotProtocol` in
 * `src/renderer/lib/save-active-request.ts`) so the opened tab restores it
 * (`restoreProtocolFromMetadata`). WebSocket / Socket.IO / MQTT go through the ONE
 * realtime writer (`src/shared/realtime-meta.ts`), which also writes the keys
 * older builds read.
 *
 * Safety:
 *  - MCP stdio: the command line is saved like any other request; nothing is
 *    trusted. Run spawns it only after the user connects it once from its tab
 *    (`src/main/lib/mcp-stdio-trust.ts` — the gate lives in `mcp:connect`).
 *  - LLM (AI Chat): `savedKeyDisabled: true` on every imported request — a
 *    collection naming a built-in provider with its own URL would otherwise
 *    receive the user's saved key for that provider (`aiKeyScope` keys
 *    built-in providers by name). Credentials in the file are never imported.
 */
import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { extractPath, genKvId, toText } from '../normalize'
import { mapPostmanAuth, type AuthConfigLike } from '../auth'
import {
  readSioSettings,
  readWsSettings,
  isRtContentType,
  isSioArgContentType,
  type SioClientVersion,
} from '../../../../shared/realtime'
import { mqttMetaOf, sioMetaOf, wsMetaOf, type RtKeyValue } from '../../../../shared/realtime-meta'
import {
  emptyPublishDraft,
  isMqttVersion,
  normalizeMqttSaved,
  normalizeTopics,
  readConnectProperties,
  readLastWill,
  readMqttSettings,
} from '../../../../shared/mqtt'
import { normalizeMcpProtocolOption, type McpSavedCall } from '../../../../shared/mcp-call'
import { parseJsonWithVars } from '../../../../shared/json-with-vars'
import { resolveProviderUrl, type AiProvider } from '../../../protocols/ai-chat.engine'
import { isRecord, kvList, queryFromUrl, str, urlWithQuery, type Doc, type V3Kv } from './shapes'
import { nativeScripts, v3Auth, type NativeV3Item } from './to-v2'

export interface NativeWriteArgs {
  db: Database
  projectId: string
  parentFolderId: string | null
  name: string
  description: string | null
  native: NativeV3Item
  /** What a request without its own auth gets (`inherit` with a carrier, a baked auth, or null). */
  inheritedAuth: AuthConfigLike | null
  /** An ancestor (folder / collection) defines auth. */
  ancestorAuth: boolean
  sortOrder: number
  now: number
  warnings: string[]
}

function rows(list: V3Kv[]): RtKeyValue[] {
  return list.map((r) => ({
    id: genKvId(),
    key: r.key,
    value: r.value,
    enabled: !r.disabled,
    ...(r.description ? { description: r.description } : {}),
  }))
}

function insertEndpoint(
  a: NativeWriteArgs,
  protocol: string,
  method: string,
  path: string,
  schema: Record<string, unknown>,
): string {
  const id = randomUUID()
  a.db
    .prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      a.projectId,
      a.parentFolderId,
      a.name,
      a.description,
      protocol,
      method,
      path || '/',
      'developing',
      JSON.stringify(schema),
      null,
      a.sortOrder,
      a.now,
      a.now,
    )
  return id
}

function reportExamples(doc: Doc, label: string, warnings: string[]): void {
  if (Array.isArray(doc.examples) && doc.examples.length > 0) {
    warnings.push(
      `"${label}": ${doc.examples.length} saved example(s) were not imported (Testnizer keeps examples for HTTP requests).`,
    )
  }
}

/** URL + query rows the way the realtime editors keep them (URL carries the enabled query). */
function urlAndParams(
  doc: Doc,
  label: string,
  warnings: string[],
): { url: string; params: V3Kv[] } {
  const url = str(doc.url) ?? ''
  const has = doc.queryParams !== undefined && doc.queryParams !== null
  const params = has ? kvList(doc.queryParams) : queryFromUrl(url)
  const r = urlWithQuery(url, has ? params : null)
  if (r.rebuilt)
    warnings.push(
      `"${label}": the URL's query string and its query parameters disagreed; the parameter list was used.`,
    )
  return { url: r.url, params }
}

function ownAuth(doc: Doc, label: string, warnings: string[]): AuthConfigLike | null {
  return mapPostmanAuth(v3Auth(doc.auth, label, warnings), label, warnings)
}

/** Auth for protocols that store it like HTTP (`request_schema.auth`, inheritance resolved on Send / Run). */
function httpLikeAuth(a: NativeWriteArgs, doc: Doc): AuthConfigLike | null {
  return ownAuth(doc, a.native.label, a.warnings) ?? a.inheritedAuth
}

function warnNoInherit(a: NativeWriteArgs, doc: Doc, what: string): void {
  const t = isRecord(doc.auth) ? str(doc.auth.type) : undefined
  if ((t === undefined || t === 'inherit') && a.ancestorAuth) {
    a.warnings.push(
      `"${a.native.label}": inherits the folder / collection auth in Postman; ${what} requests in Testnizer do not inherit auth — set it on the request.`,
    )
  }
}

// ─── GraphQL ──────────────────────────────────────────────────────────

function writeGraphql(a: NativeWriteArgs): string {
  const { doc, label } = a.native
  const url = str(doc.url) ?? ''
  const query = str(doc.query) ?? ''
  const variables =
    typeof doc.variables === 'string'
      ? doc.variables
      : doc.variables !== undefined && doc.variables !== null
        ? JSON.stringify(doc.variables, null, 2)
        : '{}'
  const headers = rows(kvList(doc.headers))
  if (typeof doc.operationName === 'string' && doc.operationName.trim()) {
    a.warnings.push(
      `"${label}": the GraphQL operation name "${doc.operationName}" was not imported (the query is kept).`,
    )
  }
  if (isRecord(doc.schema) && !['none', 'auto', undefined].includes(str(doc.schema.source))) {
    a.warnings.push(
      `"${label}": the GraphQL schema source (${str(doc.schema.source)}) was not imported; Testnizer reads the schema by introspection.`,
    )
  }
  reportExamples(doc, label, a.warnings)
  const scripts = nativeScripts(doc.scripts, 'beforeQuery', 'afterResponse', label, a.warnings)
  const auth = httpLikeAuth(a, doc)
  const schema: Record<string, unknown> = {
    url,
    method: 'POST',
    params: [],
    headers,
    body: { type: 'graphql', content: query },
    ...(auth ? { auth } : {}),
    ...scripts,
    metadata: { graphql: { url, query, variables, headers } },
  }
  return insertEndpoint(a, 'graphql', 'POST', extractPath(url), schema)
}

// ─── gRPC ─────────────────────────────────────────────────────────────

function writeGrpc(a: NativeWriteArgs): string {
  const { doc, label } = a.native
  const rawUrl = (str(doc.url) ?? '').trim()
  const settings = isRecord(doc.settings) ? doc.settings : {}
  let useTls = settings.secureConnection === true
  let address = rawUrl
  const scheme = /^(grpcs?|https?):\/\//i.exec(rawUrl)
  if (scheme) {
    const s = scheme[1].toLowerCase()
    if (s === 'grpcs' || s === 'https') useTls = true
    address = rawUrl.slice(scheme[0].length).replace(/\/+$/, '')
  }
  const methodPath = (str(doc.methodPath) ?? '').trim().replace(/^\/+/, '')
  const slash = methodPath.lastIndexOf('/')
  const selectedService = slash > 0 ? methodPath.slice(0, slash) : null
  const selectedMethod = slash > 0 ? methodPath.slice(slash + 1) : methodPath || null
  const message = isRecord(doc.message) ? str(doc.message.content) : str(doc.message)
  const requestBody = message ?? '{}'
  const metadata = rows(kvList(doc.metadata))
  let protoSource: 'reflection' | 'url' | 'file' = 'reflection'
  let protoUrl = ''
  if (isRecord(doc.schema)) {
    const src = str(doc.schema.source)
    if (src === 'url' && str(doc.schema.url)) {
      protoSource = 'url'
      protoUrl = str(doc.schema.url) ?? ''
    } else if (src === 'file') {
      protoSource = 'file'
      a.warnings.push(
        `"${label}": the method uses the proto file "${str(doc.schema.location) ?? ''}" — load it in the gRPC tab ("Load proto") to call ${methodPath || 'the method'}.`,
      )
    } else if (src && src !== 'none' && src !== 'auto') {
      a.warnings.push(
        `"${label}": the proto schema comes from a Postman ${src}; use server reflection or load the proto file in the gRPC tab.`,
      )
    }
  }
  if (methodPath) {
    a.warnings.push(
      `"${label}": pick ${methodPath} in the gRPC tab after loading the service definition (reflection or proto).`,
    )
  }
  const extras = [
    'strictSSL',
    'serverNameOverride',
    'maxResponseMessageSize',
    'includeDefaultFields',
    'connectionTimeout',
  ]
    .filter((k) => settings[k] !== undefined)
    .map((k) => `${k}=${JSON.stringify(settings[k])}`)
  if (extras.length > 0) {
    a.warnings.push(
      `"${label}": gRPC settings Testnizer has no field for were not imported: ${extras.join(', ')}.`,
    )
  }
  // gRPC scripts (beforeInvoke / onIncomingMessage / afterResponse) have no
  // step in Testnizer's gRPC client: every one is reported.
  nativeScripts(doc.scripts, '', '', label, a.warnings)
  reportExamples(doc, label, a.warnings)
  const auth = httpLikeAuth(a, doc)
  const schema: Record<string, unknown> = {
    url: address,
    method: 'POST',
    params: [],
    headers: [],
    body: { type: 'json', content: requestBody },
    ...(auth ? { auth } : {}),
    metadata: {
      grpc: {
        address,
        useTls,
        protoSource,
        protoUrl,
        protoPath: null,
        selectedService,
        selectedMethod,
        requestBody,
        metadata,
      },
    },
  }
  return insertEndpoint(a, 'grpc', 'POST', methodPath || address, schema)
}

// ─── WebSocket ────────────────────────────────────────────────────────

/** Own handshake auth → header / query rows (bearer, API key); other types are reported. */
function realtimeAuthRows(
  a: NativeWriteArgs,
  doc: Doc,
  headers: RtKeyValue[],
  params: RtKeyValue[],
): void {
  const auth = ownAuth(doc, a.native.label, a.warnings)
  if (!auth || auth.type === 'none') return
  if (auth.type === 'bearer') {
    const token = (auth.bearer as { token?: string } | undefined)?.token ?? ''
    if (!headers.some((h) => h.key.toLowerCase() === 'authorization'))
      headers.push({ id: genKvId(), key: 'Authorization', value: `Bearer ${token}`, enabled: true })
    return
  }
  if (auth.type === 'api-key') {
    const k = auth.apiKey as { key?: string; value?: string; in?: string } | undefined
    if (k?.key) {
      ;(k.in === 'query' ? params : headers).push({
        id: genKvId(),
        key: k.key,
        value: k.value ?? '',
        enabled: true,
      })
    }
    return
  }
  a.warnings.push(
    `"${a.native.label}": ${auth.type} auth of the handshake was not imported; add the header it needs.`,
  )
}

/** v3 `maxPayload` is bytes; the Settings field is MB (0 = unlimited). */
function maxPayloadMb(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  if (!Number.isFinite(n) || n < 0) return undefined
  if (n === 0) return 0
  return Math.max(1, Math.round(n / (1024 * 1024)))
}

function writeWebsocket(a: NativeWriteArgs): string {
  const { doc, label } = a.native
  const { url, params } = urlAndParams(doc, label, a.warnings)
  const headers = rows(kvList(doc.headers))
  const paramRows = rows(params)
  realtimeAuthRows(a, doc, headers, paramRows)
  warnNoInherit(a, doc, 'WebSocket')
  const s = isRecord(doc.settings) ? doc.settings : {}
  const mb = maxPayloadMb(s.maxPayload)
  const settings = readWsSettings({
    ...s,
    ...(mb !== undefined ? { maxPayload: mb } : { maxPayload: undefined }),
  })
  const savedMessages = (Array.isArray(doc.messages) ? doc.messages : [])
    .filter(isRecord)
    .map((m, i) => ({
      id: genKvId(),
      name: str(m.name)?.trim() || `Message ${i + 1}`,
      content: str(m.content) ?? '',
      contentType: isRtContentType(m.contentType) ? m.contentType : 'text',
    }))
  reportExamples(doc, label, a.warnings)
  const meta = wsMetaOf({
    url,
    customHeaders: headers,
    params: paramRows,
    settings,
    composerContent: savedMessages[0]?.content ?? '',
    composerMode: savedMessages[0]?.contentType ?? 'text',
    autoScroll: true,
    savedMessages,
  })
  const schema: Record<string, unknown> = {
    url,
    method: 'GET',
    params: [],
    headers: [],
    body: { type: 'none' },
    metadata: { websocket: meta },
  }
  return insertEndpoint(a, 'websocket', 'GET', extractPath(url), schema)
}

// ─── Socket.IO ────────────────────────────────────────────────────────

/**
 * v3 has no namespace field: Postman keeps it in the URL path. Testnizer's
 * engine appends the namespace to the URL, so a path on a URL WITHOUT a query
 * becomes the namespace (the export folds it back). With a query string the
 * URL is kept whole (namespace "/") — the engine would append the namespace
 * after the query.
 */
export function splitSocketIoNamespace(url: string): { url: string; namespace: string } {
  if (url.includes('?') || url.includes('#')) return { url, namespace: '/' }
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/]+|\{\{[^{}]+\}\})(\/.*)?$/i.exec(url)
  if (!m || !m[2] || m[2] === '/') return { url, namespace: '/' }
  return { url: m[1], namespace: m[2].replace(/\/+$/, '') || '/' }
}

function writeSocketIo(a: NativeWriteArgs): string {
  const { doc, label } = a.native
  const { url: fullUrl, params } = urlAndParams(doc, label, a.warnings)
  const { url, namespace } = splitSocketIoNamespace(fullUrl)
  const headers = rows(kvList(doc.headers))
  const s = isRecord(doc.settings) ? doc.settings : {}
  const settings = readSioSettings(s)
  const version = str(s.version) as SioClientVersion | undefined
  if (version && version !== '4') {
    a.warnings.push(
      `"${label}": Socket.IO client v${version} is not available yet; the request connects after you switch it to v4 in Settings.`,
    )
  }
  const listeners = (Array.isArray(doc.events) ? doc.events : [])
    .filter(isRecord)
    .filter((e) => str(e.name)?.trim())
    .map((e) => ({
      id: genKvId(),
      name: str(e.name) ?? '',
      description: str(e.description) ?? '',
      listen: e.subscribeOnConnect !== false,
    }))
  const savedMessages = (Array.isArray(doc.messages) ? doc.messages : [])
    .filter(isRecord)
    .map((m, i) => ({
      id: genKvId(),
      name: str(m.name)?.trim() || `Message ${i + 1}`,
      ...(str(m.description) ? { description: str(m.description) } : {}),
      eventName: str(m.eventName)?.trim() || 'message',
      acknowledgement: m.acknowledgement === true,
      args: (Array.isArray(m.args) ? m.args : []).filter(isRecord).map((arg) => ({
        id: genKvId(),
        content: str(arg.content) ?? '',
        contentType: isSioArgContentType(arg.contentType) ? arg.contentType : ('text' as const),
      })),
    }))
  reportExamples(doc, label, a.warnings)
  const first = savedMessages[0]
  const meta = sioMetaOf({
    url,
    namespace,
    bearerToken: '',
    customHeaders: headers,
    params: rows(params),
    settings,
    listeners,
    listenAll: false,
    emitEvent: first?.eventName ?? 'message',
    emitArgs: first?.args ?? [{ id: genKvId(), content: '{}', contentType: 'json' }],
    emitAck: first?.acknowledgement ?? false,
    savedMessages,
  })
  const schema: Record<string, unknown> = {
    url,
    method: 'GET',
    params: [],
    headers: [],
    body: { type: 'none' },
    metadata: { socketio: meta },
  }
  return insertEndpoint(a, 'socketio', 'GET', extractPath(url), schema)
}

// ─── MQTT (issue #284) ────────────────────────────────────────────────

/** v3 user-property rows → editor rows (`disabled` kept for the CONNECT list). */
function userPropRows(raw: unknown): RtKeyValue[] {
  return rows(kvList(raw))
}

/**
 * The v3 `mqtt-request` keys are the editor's own (`src/shared/mqtt.ts`), so
 * the readers there do the work; only the nested shapes differ: a topic's
 * MQTT 5 options sit under `settings` (or `0` = none), user properties are
 * key / value lists. What Testnizer has no field for is reported.
 */
function writeMqtt(a: NativeWriteArgs): string {
  const { doc, label } = a.native
  const url = str(doc.url) ?? ''
  if (doc.version !== undefined && !isMqttVersion(doc.version)) {
    a.warnings.push(`"${label}": MQTT version ${JSON.stringify(doc.version)} is imported as 5.0.`)
  }
  let username = ''
  let password = ''
  const auth = ownAuth(doc, label, a.warnings)
  if (auth?.type === 'basic') {
    const b = auth.basic as { username?: string; password?: string } | undefined
    username = b?.username ?? ''
    password = b?.password ?? ''
  } else if (auth && auth.type !== 'none') {
    a.warnings.push(`"${label}": ${auth.type} auth is not available for MQTT; imported as no auth.`)
  }
  warnNoInherit(a, doc, 'MQTT')
  const props = isRecord(doc.properties) ? doc.properties : {}
  const properties = readConnectProperties({
    ...props,
    userProperties: userPropRows(props.userProperties),
  })
  const will = isRecord(doc.lastWill) ? doc.lastWill : {}
  const willProps = isRecord(will.properties) ? will.properties : {}
  const lastWill = readLastWill({
    ...will,
    properties: { ...willProps, userProperties: userPropRows(willProps.userProperties) },
  })
  const dropped = new Set<string>()
  const topics = normalizeTopics(
    (Array.isArray(doc.topics) ? doc.topics : [])
      .filter(isRecord)
      .filter((t) => str(t.name)?.trim())
      .map((t) => {
        const opts = isRecord(t.settings) ? t.settings : {}
        if (opts.subscriptionIdentifier !== undefined) dropped.add('subscription identifiers')
        if (Array.isArray(t.userProperties) && t.userProperties.length > 0)
          dropped.add('subscription user properties')
        return {
          name: str(t.name),
          qos: t.qos,
          subscribe: t.subscribe !== false,
          description: str(t.description) ?? '',
          noLocal: opts.noLocal,
          retainAsPublished: opts.retainAsPublished,
          retainHandling: opts.retainHandling,
        }
      }),
  )
  const savedMessages = normalizeMqttSaved(
    (Array.isArray(doc.messages) ? doc.messages : []).filter(isRecord).map((m, i) => {
      const mp = isRecord(m.properties) ? m.properties : {}
      if (mp.subscriptionIdentifier !== undefined) dropped.add('message subscription identifiers')
      return {
        name: str(m.name)?.trim() || `Message ${i + 1}`,
        ...(str(m.description) ? { description: str(m.description) } : {}),
        topic: str(m.topic) ?? '',
        content: str(m.content) ?? '',
        contentType: m.contentType,
        qos: m.qos,
        retain: m.retain === true,
        properties: { ...mp, userProperties: userPropRows(mp.userProperties) },
      }
    }),
  )
  if (dropped.size > 0)
    a.warnings.push(`"${label}": MQTT ${[...dropped].join(', ')} were not imported.`)
  reportExamples(doc, label, a.warnings)
  const first = savedMessages[0]
  const meta = mqttMetaOf({
    url,
    clientId: str(doc.clientId) ?? '',
    version: doc.version === 4 ? 4 : 5,
    username,
    password,
    settings: readMqttSettings(doc.settings),
    properties,
    lastWill,
    topics,
    composer: first
      ? {
          topic: first.topic,
          content: first.content,
          contentType: first.contentType,
          qos: first.qos,
          retain: first.retain,
          properties: first.properties,
        }
      : emptyPublishDraft(),
    savedMessages,
  })
  const schema: Record<string, unknown> = {
    url,
    method: 'GET',
    params: [],
    headers: [],
    body: { type: 'none' },
    metadata: { mqtt: meta },
  }
  return insertEndpoint(a, 'mqtt', 'GET', extractPath(url), schema)
}

// ─── MCP ──────────────────────────────────────────────────────────────

/** A v3 JSON-RPC `message` → the saved call (tool / resource / prompt); null when it is none of them. */
export function mcpCallFromMessage(message: string): { call: McpSavedCall; method: string } | null {
  if (!message.trim()) return null
  const parsed = parseJsonWithVars(message)
  if (!parsed || !isRecord(parsed.value)) return null
  const msg = parsed.value
  const method = str(msg.method) ?? ''
  const params = isRecord(msg.params) ? msg.params : {}
  if (method === 'tools/call') {
    const args = params.arguments === undefined ? {} : params.arguments
    return {
      method,
      call: {
        capabilityTab: 'tools',
        selectedTool: str(params.name) ?? null,
        toolArgs: parsed.restore(JSON.stringify(args, null, 2)),
      },
    }
  }
  if (method === 'resources/read') {
    const uri = str(params.uri) ?? ''
    return {
      method,
      call: { capabilityTab: 'resources', selectedResourceUri: uri, resourceUriDraft: uri },
    }
  }
  if (method === 'prompts/get') {
    const promptArgs: Record<string, string> = {}
    if (isRecord(params.arguments)) {
      for (const [k, v] of Object.entries(params.arguments)) promptArgs[k] = toText(v)
    }
    return {
      method,
      call: { capabilityTab: 'prompts', selectedPrompt: str(params.name) ?? null, promptArgs },
    }
  }
  if (method === 'tools/list') return { method, call: { capabilityTab: 'tools' } }
  if (method === 'resources/list' || method === 'resources/templates/list')
    return { method, call: { capabilityTab: 'resources' } }
  if (method === 'prompts/list') return { method, call: { capabilityTab: 'prompts' } }
  if (method === 'initialize' || method === 'ping') return { method, call: {} }
  return null
}

/** A v3 MCP URL ending in `/sse` is the legacy SSE transport, anything else Streamable HTTP. */
export function mcpTransportOfUrl(url: string): 'sse' | 'http' {
  return /\/sse\/?(?:[?#].*)?$/i.test(url.trim()) ? 'sse' : 'http'
}

function writeMcp(a: NativeWriteArgs): string {
  const { doc, label } = a.native
  const stdio = str(doc.transport) === 'stdio'
  const url = stdio ? (str(doc.command) ?? '') : (str(doc.url) ?? '')
  const transport = stdio ? 'stdio' : mcpTransportOfUrl(url)
  const settings = isRecord(doc.settings) ? doc.settings : {}
  let auth: Record<string, unknown> = { type: 'none' }
  const own = isRecord(doc.auth) ? doc.auth : undefined
  const ownType = own ? str(own.type) : undefined
  if (ownType === 'basic' || ownType === 'bearer') {
    const mapped = ownAuth(doc, label, a.warnings)
    if (mapped?.type === 'basic') auth = { type: 'basic', basic: mapped.basic }
    if (mapped?.type === 'bearer') {
      const b = mapped.bearer as { token?: string } | undefined
      auth = { type: 'bearer', bearer: { token: b?.token ?? '' } }
    }
  } else if (ownType === 'oauth2') {
    auth = { type: 'oauth2', oauth2: { allowHttpAuthServer: false } }
    a.warnings.push(
      `"${label}": OAuth 2.0 — Testnizer runs the MCP authorization flow when you connect; stored tokens and client settings were not imported.`,
    )
  } else if (ownType && ownType !== 'inherit' && ownType !== 'noauth') {
    a.warnings.push(`"${label}": ${ownType} auth is not available for MCP; imported as "No auth".`)
  }
  if (!stdio) warnNoInherit(a, doc, 'MCP')
  let call: McpSavedCall = {}
  const message = str(doc.message) ?? ''
  if (message.trim()) {
    const parsed = mcpCallFromMessage(message)
    if (parsed) call = parsed.call
    else
      a.warnings.push(
        `"${label}": the JSON-RPC message was not imported (Testnizer saves a tool call, resource read or prompt).`,
      )
  }
  const timeout =
    typeof settings.requestTimeout === 'number' && settings.requestTimeout >= 0
      ? Math.floor(settings.requestTimeout)
      : undefined
  const extras = ['strictSSL', 'sessionTimeout']
    .filter((k) => settings[k] !== undefined && !(k === 'strictSSL' && settings[k] === true))
    .map((k) => `${k}=${JSON.stringify(settings[k])}`)
  if (extras.length > 0)
    a.warnings.push(
      `"${label}": MCP settings Testnizer has no field for were not imported: ${extras.join(', ')}.`,
    )
  if (stdio) {
    a.warnings.push(
      `"${label}": stdio MCP server "${url}" — Testnizer runs it only after you connect it once from its MCP tab on this computer.`,
    )
  }
  const schema: Record<string, unknown> = {
    url,
    method: 'GET',
    params: [],
    headers: [],
    body: { type: 'none' },
    ...(timeout !== undefined ? { timeout } : {}),
    metadata: {
      mcp: {
        transport,
        url,
        customHeaders: stdio ? [] : rows(kvList(doc.headers)),
        envVars: stdio ? rows(kvList(doc.env)) : [],
        auth,
        protocol: normalizeMcpProtocolOption(settings.version),
        call,
      },
    },
  }
  return insertEndpoint(a, 'mcp', 'GET', url, schema)
}

// ─── LLM → AI Chat ────────────────────────────────────────────────────

const AI_PROVIDERS: ReadonlySet<string> = new Set([
  'openai',
  'anthropic',
  'openrouter',
  'google',
  'deepseek',
  'xai',
  'mistral',
  'groq',
  'perplexity',
  'cerebras',
  'cohere',
  'fireworks',
  'deepinfra',
  'together',
])

const PROVIDER_ALIASES: Record<string, string> = { gemini: 'google', 'x-ai': 'xai', grok: 'xai' }

function aiProviderOf(raw: string | undefined): AiProvider {
  const p = (raw ?? '').trim().toLowerCase()
  const mapped = PROVIDER_ALIASES[p] ?? p
  return (AI_PROVIDERS.has(mapped) ? mapped : 'custom') as AiProvider
}

function writeLlm(a: NativeWriteArgs): string {
  const { doc, label } = a.native
  const config = isRecord(doc.config) ? doc.config : {}
  const provider = aiProviderOf(str(config.provider))
  const url = (str(doc.url) ?? '').trim()
  const customUrl = url || (provider === 'custom' ? '' : resolveProviderUrl(provider))
  // `custom` itself (what a Testnizer export writes for a Custom endpoint) is
  // not a lossy mapping — no warning.
  const rawProvider = (str(config.provider) ?? '').trim().toLowerCase()
  if (provider === 'custom' && rawProvider && rawProvider !== 'custom') {
    a.warnings.push(
      `"${label}": provider "${str(config.provider)}" is imported as a Custom (OpenAI-compatible) endpoint.`,
    )
  }
  const settings = isRecord(doc.settings) ? doc.settings : {}
  const temperature =
    typeof settings.temperature === 'number' &&
    settings.temperature >= 0 &&
    settings.temperature <= 2
      ? settings.temperature
      : null
  const maxTokens =
    typeof settings.maxToken === 'number' &&
    Number.isInteger(settings.maxToken) &&
    settings.maxToken > 0
      ? settings.maxToken
      : null
  const dropped = Object.keys(settings).filter((k) => !['temperature', 'maxToken'].includes(k))
  if (dropped.length > 0)
    a.warnings.push(
      `"${label}": AI settings Testnizer has no field for were not imported: ${dropped.join(', ')}.`,
    )
  const prompts = (list: unknown): string[] =>
    (Array.isArray(list) ? list : [])
      .filter(isRecord)
      .filter(
        (p) => p.active !== false && (p.contentType === undefined || p.contentType === 'text'),
      )
      .map((p) => str(p.value) ?? '')
      .filter((t) => t.trim())
  const systemPrompt = prompts(doc.systemPrompts).join('\n\n')
  const userPrompts = prompts(doc.userPrompts)
  if (userPrompts.length > 0) {
    a.warnings.push(
      `"${label}": ${userPrompts.length} user prompt(s) were not imported — an AI Chat request starts with an empty conversation.`,
    )
  }
  const tools = [
    typeof doc.mcpConfig === 'string' && doc.mcpConfig.trim() && doc.mcpConfig.trim() !== '{}'
      ? 'MCP server configuration'
      : '',
    Array.isArray(doc.enabledTools) && doc.enabledTools.length > 0 ? 'enabled tools' : '',
    Array.isArray(doc.clientTools) && doc.clientTools.length > 0 ? 'client tools' : '',
  ].filter(Boolean)
  if (tools.length > 0)
    a.warnings.push(
      `"${label}": ${tools.join(', ')} not imported; add MCP servers in the tab's Tools section.`,
    )
  const authType = isRecord(doc.auth) ? str(doc.auth.type) : undefined
  if (authType && authType !== 'noauth' && authType !== 'inherit') {
    a.warnings.push(`"${label}": the provider credentials in the file were not imported.`)
  }
  a.warnings.push(
    `"${label}": imported with "Don't use my saved API key" on — enter a key in the tab, or turn the option off to use your saved ${provider} key.`,
  )
  const ai = {
    provider,
    customUrl,
    model: str(config.model) ?? '',
    systemPrompt,
    customHeaders: [],
    temperature,
    maxTokens,
    toolServers: [],
    savedKeyDisabled: true as const,
  }
  const schema: Record<string, unknown> = {
    url: customUrl,
    method: 'POST',
    params: [],
    headers: [],
    body: { type: 'none' },
    metadata: { ai },
  }
  return insertEndpoint(a, 'ai', 'POST', customUrl, schema)
}

/** Write one native item; returns the endpoint id. */
export function insertNativeItem(a: NativeWriteArgs): string {
  switch (a.native.kind) {
    case 'graphql-request':
      return writeGraphql(a)
    case 'grpc-request':
      return writeGrpc(a)
    case 'websocket-request':
      return writeWebsocket(a)
    case 'socket.io-request':
      return writeSocketIo(a)
    case 'mqtt-request':
      return writeMqtt(a)
    case 'mcp-request':
      return writeMcp(a)
    case 'llm-request':
      return writeLlm(a)
    default:
      throw new Error(`Unexpected native kind ${a.native.kind}`)
  }
}
