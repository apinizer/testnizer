/**
 * History row → editor state (issues #182, #195). Pure — no stores.
 *
 * From issue #195 on, a row's `request_snapshot` carries `configured`: the
 * request as the editor held it (`{{var}}` kept). Reopening reads THAT, so a
 * re-send resolves the variables again and auth keeps working; the flat
 * fields beside it are the masked copy of what was sent. Rows written before
 * have no `configured` and reopen from the flat fields, as before.
 *
 * Values main masked (`HISTORY_MASK`, a literal credential) come back EMPTY —
 * never as the dots, which a re-send would put on the wire — and their
 * location is reported in `hidden`, like MCP's `hiddenArgs`.
 *
 * WebSocket, gRPC and GraphQL rows (issue #182) map onto the same
 * `protocolMeta` shape an endpoint saves (`snapshotProtocol`), so reopening
 * reuses `restoreProtocolFromMetadata`.
 */
import type { AuthConfig, HistoryEntry, HttpMethod, KeyValuePair, RequestBody } from '../types'
import { HISTORY_MASK } from '../../shared/credential-headers'
import type { HistoryConfigured } from '../../shared/history-snapshot'
import { maskedPathsInText } from '../../shared/masked-credentials'

type Json = Record<string, unknown>
type Row = Pick<HistoryEntry, 'url' | 'method' | 'protocol' | 'request_snapshot'>

const isRecord = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** The parsed snapshot (`history.store` parses the column; a raw string is parsed here). */
export function historySnapshot(entry: Row): Json {
  let raw: unknown = entry.request_snapshot
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = {}
    }
  }
  return isRecord(raw) ? raw : {}
}

/** The row's `configured` template, or null for a row written before issue #195. */
export function historyConfigured(entry: Row): HistoryConfigured | null {
  const c = historySnapshot(entry).configured
  return isRecord(c) ? (c as HistoryConfigured) : null
}

/**
 * `value` with every masked string emptied (recursively). A string that IS
 * the mask becomes '' and its path goes to `hidden`; a mask inside a longer
 * string (`?api_key=••••••`) is cut out, and `hidden` names the field INSIDE
 * it — `variables.password`, `body.password`, `composerContent.token`,
 * `url.api_key` — not just the text slot (`maskedPathsInText`).
 */
export function unmaskHistoryValue(value: unknown, path = '', hidden: string[] = []): unknown {
  if (typeof value === 'string') {
    if (!value.includes(HISTORY_MASK)) return value
    hidden.push(...maskedPathsInText(value, path))
    return value === HISTORY_MASK ? '' : cutMask(value)
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => {
      const label =
        isRecord(v) && typeof v.key === 'string' && v.key ? `${path}.${v.key}` : `${path}[${i}]`
      return unmaskHistoryValue(v, label, hidden)
    })
  }
  if (!isRecord(value)) return value
  // A `{key, value}` row is named by its key alone ("headers.X-API-Key").
  const isRow = typeof value.key === 'string' && value.key !== ''
  const out: Json = {}
  for (const [k, v] of Object.entries(value)) {
    const at = isRow && k === 'value' ? path : path ? `${path}.${k}` : k
    out[k] = unmaskHistoryValue(v, at, hidden)
  }
  return out
}

let kvSeq = 0
function kvId(): string {
  kvSeq += 1
  return `hist-kv-${Date.now().toString(36)}-${kvSeq}`
}

/**
 * Headers / params / metadata in either stored form — a `Record<name, value>`
 * (WS, gRPC and engine-reported headers) or a `[{key, value, enabled}]` list —
 * as editor rows.
 */
export function toKeyValueRows(v: unknown): KeyValuePair[] {
  if (Array.isArray(v)) {
    return v.filter(isRecord).map((r) => ({
      ...(r as Partial<KeyValuePair>),
      id: typeof r.id === 'string' && r.id ? r.id : kvId(),
      key: str(r.key) ?? str(r.name) ?? '',
      value: r.value == null ? '' : String(r.value),
      enabled: r.enabled !== false,
    }))
  }
  if (isRecord(v)) {
    return Object.entries(v).map(([key, value]) => ({
      id: kvId(),
      key,
      value: value == null ? '' : String(value),
      enabled: true,
    }))
  }
  return []
}

/**
 * The URL a reopened row's TAB carries: the template's (masks emptied) when
 * the row has one, else the stored URL — never a masked `?api_key=••••••`.
 */
export function historyTabUrl(entry: Row): string {
  const c = historyConfigured(entry)
  const url = c && typeof c.url === 'string' ? c.url : (entry.url ?? '')
  return cutMask(url)
}

/**
 * A mask cut out of a longer string. A masked URL userinfo
 * (`https://••••••@host`) goes with its `@` — `https://@host` is not a URL
 * anyone typed.
 */
function cutMask(value: string): string {
  return value.split(`//${HISTORY_MASK}@`).join('//').split(HISTORY_MASK).join('')
}

export interface HttpHistoryRestore {
  method: HttpMethod
  url: string
  params: KeyValuePair[]
  headers: KeyValuePair[]
  body?: RequestBody
  auth?: AuthConfig
  /** Where a masked credential was emptied ("headers.X-API-Key", "auth.bearer.token"). */
  hidden: string[]
  /** True when the row carried the `{{var}}` template (issue #195). */
  fromTemplate: boolean
}

/** An HTTP (or GraphQL-over-HTTP / manual SOAP) History row → request editor fields. */
export function httpHistoryRestore(entry: Row): HttpHistoryRestore {
  const snap = historySnapshot(entry)
  const configured = historyConfigured(entry)
  const src: Json = configured ? (configured as Json) : snap
  const hidden: string[] = []
  const clean = unmaskHistoryValue(
    {
      url: str(src.url) ?? entry.url ?? '',
      params: src.params,
      headers: src.headers,
      body: src.body,
      auth: src.auth,
    },
    '',
    hidden,
  ) as Json
  const method = (str(src.method) ?? entry.method ?? 'GET').toUpperCase() as HttpMethod
  return {
    method,
    url: str(clean.url) ?? '',
    params: toKeyValueRows(clean.params),
    headers: toKeyValueRows(clean.headers),
    body: isRecord(clean.body) ? (clean.body as unknown as RequestBody) : undefined,
    auth: isRecord(clean.auth) ? (clean.auth as unknown as AuthConfig) : undefined,
    hidden,
    fromTemplate: configured !== null,
  }
}

/** Protocols whose History rows reopen through `restoreProtocolFromMetadata`. */
export const HISTORY_META_PROTOCOLS = ['websocket', 'grpc', 'graphql', 'sse', 'socketio'] as const
export type HistoryMetaProtocol = (typeof HISTORY_META_PROTOCOLS)[number]

export function isHistoryMetaProtocol(p: string | undefined): p is HistoryMetaProtocol {
  return (HISTORY_META_PROTOCOLS as readonly string[]).includes(p ?? '')
}

/** `{query, variables}` from a GraphQL-over-HTTP body (`request:send` rows). */
function graphqlFromBody(body: unknown): { query?: string; variables?: string } {
  const content = isRecord(body) ? str(body.content) : str(body)
  if (!content) return {}
  try {
    const parsed: unknown = JSON.parse(content)
    if (!isRecord(parsed)) return {}
    const vars = parsed.variables
    return {
      query: str(parsed.query),
      variables:
        typeof vars === 'string'
          ? vars
          : vars === undefined
            ? undefined
            : JSON.stringify(vars, null, 2),
    }
  } catch {
    return {}
  }
}

/** Legacy (pre-#195) flat snapshot → the protocol's `protocolMeta` entry. */
function legacyMeta(protocol: HistoryMetaProtocol, snap: Json, entry: Row): Json {
  if (protocol === 'sse') {
    const method = str(snap.method) ?? entry.method
    return {
      url: str(snap.url) ?? entry.url ?? '',
      ...(method ? { method: method.toUpperCase() } : {}),
      ...(typeof snap.body === 'string' ? { body: snap.body } : {}),
      customHeaders: toKeyValueRows(snap.headers),
      ...(typeof snap.lastEventId === 'string' ? { lastEventId: snap.lastEventId } : {}),
    }
  }
  if (protocol === 'socketio') {
    return {
      url: str(snap.url) ?? entry.url ?? '',
      namespace: str(snap.namespace) ?? '/',
      // Rows before issue #195 recorded only THAT a token was sent — the
      // token itself was never stored; `hasAuth` makes the note name it.
      ...(snap.hasAuth === true ? { bearerToken: HISTORY_MASK } : {}),
    }
  }
  if (protocol === 'websocket') {
    return {
      url: str(snap.url) ?? entry.url ?? '',
      customHeaders: toKeyValueRows(snap.headers),
    }
  }
  if (protocol === 'grpc') {
    return {
      address: str(snap.serverAddress) ?? str(snap.address) ?? '',
      ...(typeof snap.useTls === 'boolean' ? { useTls: snap.useTls } : {}),
      protoPath: str(snap.protoPath),
      selectedService: str(snap.serviceName),
      selectedMethod: str(snap.methodName),
      requestBody: str(snap.requestBody) ?? '',
      metadata: toKeyValueRows(snap.metadata),
    }
  }
  // GraphQL: `graphql:execute` rows carry `query` / `variables`; GraphQL sent
  // through `request:send` (the editor's path) carries an HTTP body instead.
  const fromBody = graphqlFromBody(snap.body)
  const variables =
    typeof snap.variables === 'string'
      ? snap.variables
      : isRecord(snap.variables)
        ? JSON.stringify(snap.variables, null, 2)
        : fromBody.variables
  return {
    url: str(snap.url) ?? entry.url ?? '',
    query: str(snap.query) ?? fromBody.query ?? '',
    ...(variables !== undefined ? { variables } : {}),
    headers: toKeyValueRows(snap.headers),
  }
}

export interface ProtocolHistoryRestore {
  protocol: HistoryMetaProtocol
  /** `{ [protocol]: {...} }` — the shape `restoreProtocolFromMetadata` reads. */
  meta: Record<string, unknown>
  /** Where a masked credential was emptied. */
  hidden: string[]
  fromTemplate: boolean
}

/** A WebSocket / gRPC / GraphQL History row → the editor's protocol metadata. */
export function protocolHistoryRestore(
  entry: Row,
  protocol: HistoryMetaProtocol,
): ProtocolHistoryRestore {
  const snap = historySnapshot(entry)
  const configured = historyConfigured(entry)
  const fromTemplate = configured?.meta !== undefined && isRecord(configured.meta[protocol])
  const raw: Json = fromTemplate
    ? (configured!.meta![protocol] as Json)
    : legacyMeta(protocol, snap, entry)
  const hidden: string[] = []
  const clean = unmaskHistoryValue(raw, '', hidden) as Json
  // Editor rows need ids/enabled whichever form was stored.
  if (protocol === 'websocket') clean.customHeaders = toKeyValueRows(clean.customHeaders)
  if (protocol === 'graphql') clean.headers = toKeyValueRows(clean.headers)
  if (protocol === 'grpc') clean.metadata = toKeyValueRows(clean.metadata)
  if (protocol === 'sse') clean.customHeaders = toKeyValueRows(clean.customHeaders)
  return { protocol, meta: { [protocol]: clean }, hidden, fromTemplate }
}
