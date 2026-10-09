/**
 * MCP client engine (issue #139, #152) on the v2 TypeScript SDK
 * (`@modelcontextprotocol/client` 2.x). One `Client` class serves every
 * protocol era and every transport:
 *
 *   - Streamable HTTP  `StreamableHTTPClientTransport` (`@modelcontextprotocol/client`)
 *   - legacy HTTP+SSE  `SSEClientTransport` (`@modelcontextprotocol/client`, deprecated
 *                      upstream but still shipped in 2.x — so no v1 object ever
 *                      reaches the v2 Client)
 *   - stdio            `StdioClientTransport` (`@modelcontextprotocol/client/stdio`)
 *
 * Protocol eras (issue #152): `versionNegotiation` picks between the 2025-era
 * `initialize` handshake ("legacy") and the 2026-07-28 `server/discover`
 * handshake ("modern"); the default `'auto'` probes and falls back, so every
 * 2024–2025 server keeps working.
 *
 * Electron-free on purpose: the IPC handler installs the event sink, so the
 * real-SDK wire tests run this module under plain Node.
 */
import {
  CLIENT_CAPABILITIES_META_KEY,
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  createMiddleware,
  isInputRequiredResult,
  type CallToolRequestOptions,
  type ElicitResult,
  type FetchLike,
  type JSONRPCMessage,
  type McpSubscription,
  type SubscriptionFilter,
  type Tool,
  type Transport,
  type VersionNegotiationOptions,
} from '@modelcontextprotocol/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'
import { createMcpOAuthFetch } from './mcp-oauth.engine'
import { isCredentialHeaderName } from '../lib/credential-headers'
import { applyMcpAuth, type McpAuthOptions } from './mcp-auth'

export type McpTransport = 'http' | 'sse' | 'stdio'

/** The 2026-07-28 protocol revision — the first "modern era" version. */
export const MCP_MODERN_PROTOCOL_VERSION = '2026-07-28'

/**
 * Version negotiation requested on `mcp:connect` (issue #152):
 *  - `'auto'` (default) — probe with `server/discover`, fall back to `initialize`;
 *  - `'legacy'`         — the plain 2025 `initialize` handshake, no probe;
 *  - a modern revision (`'2026-07-28'`, …) — pinned modern era, no fallback;
 *  - a legacy revision (`'2025-06-18'`, …) — `initialize` offering exactly that version.
 */
export type McpProtocolOption = 'auto' | 'legacy' | string

export type McpProtocolEra = 'legacy' | 'modern'

// ─── Result shapes (issue #139 — Postman-parity MCP client surface) ─────────

export interface McpTool {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export interface McpResource {
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
}

export interface McpResourceTemplate {
  uriTemplate: string
  name: string
  title?: string
  description?: string
  mimeType?: string
}

export interface McpResourceList {
  resources: McpResource[]
  templates: McpResourceTemplate[]
}

export interface McpResourceContents {
  uri: string
  mimeType?: string
  text?: string
  /** Base64, exactly as the SDK returns it. */
  blob?: string
}

export interface McpReadResourceResult {
  contents: McpResourceContents[]
}

export interface McpPromptArgument {
  name: string
  description?: string
  required?: boolean
}

export interface McpPrompt {
  name: string
  title?: string
  description?: string
  arguments?: McpPromptArgument[]
}

export interface McpPromptMessage {
  role: 'user' | 'assistant'
  content: unknown
}

export interface McpGetPromptResult {
  description?: string
  messages: McpPromptMessage[]
}

/** `subscriptions/listen` filter (2026-07-28) as plain JSON. */
export type McpSubscriptionFilter = Record<string, unknown>

/** The connection's `subscriptions/listen` stream (modern era only). */
export interface McpSubscriptionInfo {
  /** The filter Testnizer asked for (from the server's `listChanged` capabilities). */
  requested: McpSubscriptionFilter
  /** The subset the server agreed to deliver (`notifications/subscriptions/acknowledged`). */
  honoredFilter?: McpSubscriptionFilter
  /** Why the stream could not be opened — the connection itself is still usable. */
  error?: string
}

export interface McpConnectionInfo {
  connectionId: string
  transport: McpTransport
  url: string
  serverName?: string
  serverVersion?: string
  /**
   * Negotiated MCP protocol version: the `initialize` result's on the legacy
   * era, the mutually supported `server/discover` revision on the modern era.
   */
  protocolVersion?: string
  /** `client.getServerCapabilities()` as plain JSON. */
  capabilities?: Record<string, unknown>
  /** Server-supplied usage instructions (`initialize` / `server/discover` result). */
  instructions?: string
  /** Protocol era the connection negotiated (issue #152). */
  era?: McpProtocolEra
  /** The `server/discover` result (modern era only), as plain JSON. */
  discover?: Record<string, unknown>
  /** `subscriptions/listen` state (modern era with `listChanged` capabilities only). */
  subscription?: McpSubscriptionInfo
}

/** `__mcp` marker on a `tools/call` result that asks for client input (2026-07-28 MRTR). */
export interface McpInputRequiredMarker {
  kind: 'input_required'
  /** Embedded requests keyed by server-assigned ids (`elicitation/create`, `sampling/createMessage`, `roots/list`). */
  inputRequests: Record<string, unknown>
  /** Opaque server state — echo it back verbatim through `mcpRespondInput`. */
  requestState?: string
}

// ─── Events (main → renderer; the IPC handler owns the actual broadcast) ────

export interface McpNotificationEvent {
  connectionId: string
  ts: number
  method: string
  params?: unknown
}

export interface McpFrameEvent {
  connectionId: string
  ts: number
  direction: 'in' | 'out'
  /** The JSON-RPC message — or a summary of it when `truncated` is set. */
  message: unknown
  /**
   * Set when the serialised frame exceeded `MAX_FRAME_CHARS`; `message` then
   * carries only `jsonrpc`/`id`/`method` plus `_truncated: { chars, preview }`
   * so a multi-MB resource blob is not shipped over IPC a second time.
   */
  truncated?: boolean
}

export interface McpConnectionClosedEvent {
  connectionId: string
  /** Absent for a clean, user-initiated disconnect; set when the transport died. */
  reason?: string
}

/** `subscriptions/listen` lifecycle (issue #152): `open` after the ack, `closed` when the server / link ended it. */
export interface McpSubscriptionStateEvent {
  connectionId: string
  state: 'open' | 'closed'
  honoredFilter?: McpSubscriptionFilter
  /** `'graceful'` (server ended it) or `'remote'` (stream dropped) — only on `closed`. */
  reason?: string
}

/**
 * A 2025-era server's `elicitation/create` request (issue #168), routed to the
 * owning connection. Form mode only — Testnizer declares no URL mode.
 */
export interface McpElicitationEvent {
  connectionId: string
  /** Engine-assigned; pass back to `mcpRespondElicitation`. */
  elicitationId: string
  serverName?: string
  message: string
  requestedSchema: Record<string, unknown>
  mode: 'form'
}

/** The user's answer to an `McpElicitationEvent` (a bare `ElicitResult`). */
export interface McpElicitationResult {
  action: 'accept' | 'decline' | 'cancel'
  /** Only for `accept`: the form values. */
  content?: Record<string, unknown>
}

/** `notifications/testnizer/redirect_credentials_dropped` params (issue #169) — names only. */
export interface McpRedirectCredentialDrop {
  /** Origin that answered with the redirect. */
  from: string
  /** Origin the request was redirected to. */
  to: string
  /** Names of the credential headers NOT sent to `to` (never their values). */
  headers: string[]
}

/** Method of the synthetic notification that reports a redirect credential drop (issue #169). */
export const REDIRECT_CREDENTIALS_DROPPED_METHOD =
  'notifications/testnizer/redirect_credentials_dropped'

export type McpEngineEvent =
  | { type: 'notification'; payload: McpNotificationEvent }
  | { type: 'frame'; payload: McpFrameEvent }
  | { type: 'connectionClosed'; payload: McpConnectionClosedEvent }
  | { type: 'subscriptionState'; payload: McpSubscriptionStateEvent }
  /** A 2025-era server asks the user for input (`elicitation/create`, issue #168). */
  | { type: 'elicitation'; payload: McpElicitationEvent }
  /** Transport-level error (not forwarded to the renderer; the handler logs it). */
  | { type: 'transportError'; payload: { connectionId: string; message: string } }

export type McpEventSink = (event: McpEngineEvent) => void

let eventSink: McpEventSink | null = null

/**
 * Install the single consumer of engine events. The engine stays free of
 * `electron` imports (so the real-SDK wire tests can run it under plain
 * Node); `mcp.handler.ts` installs a sink that broadcasts to every window.
 * Passing `null` detaches it.
 */
export function setMcpEventSink(sink: McpEventSink | null): void {
  eventSink = sink
}

// ─── Connection state ───────────────────────────────────────

/** Pagination guard for every list call (issue #139); also the SDK's `listMaxPages`. */
const MAX_PAGES = 50
const MAX_ITEMS = 2000
/** Frames bigger than this (serialised chars) are summarised, not shipped whole. */
const MAX_FRAME_CHARS = 1_000_000
const FRAME_PREVIEW_CHARS = 2048
/** JSON-RPC "Method not found". */
const METHOD_NOT_FOUND = -32601
/**
 * `server/discover` probe budget on stdio. A legacy stdio server that never
 * answers an unknown pre-`initialize` request is only recognised as legacy
 * when the probe times out — without this the SDK waits the full 60 s
 * request timeout before falling back.
 */
const STDIO_PROBE_TIMEOUT_MS = 10_000
/**
 * `server/discover` probe budget on Streamable HTTP `'auto'`. The SDK treats
 * an HTTP probe timeout as an outage (no fallback) and would wait the full
 * 60 s; a 2025 server that silently ignores unknown requests then falls back
 * (see `mcpConnect`'s legacy retry) within this bound instead.
 */
const HTTP_PROBE_TIMEOUT_MS = 15_000
/** How long `mcpConnect` waits for `notifications/subscriptions/acknowledged`. */
const LISTEN_ACK_TIMEOUT_MS = 10_000
/** Upper bound for the `notifications/cancelled` a subscription close sends on disconnect. */
const SUBSCRIPTION_CLOSE_TIMEOUT_MS = 2_000

/** Per-connection wire bookkeeping; exists from before `client.connect()`. */
interface WireState {
  connectionId: string
  kind: McpTransport
  /** True once `mcpConnect` resolved — only then may events reach the renderer. */
  established: boolean
  /**
   * Events are buffered until one macrotask after `mcpConnect` resolves so
   * the `mcp:connect` IPC reply (which tells the renderer the connectionId)
   * lands before the handshake frames that carry that id.
   */
  buffering: boolean
  buffer: McpEngineEvent[]
  /** The handshake failed — late frames of the dead transport are dropped. */
  discarded: boolean
  /**
   * True while `client.connect()` runs. The `'auto'` probe makes a 2025-era
   * HTTP server answer `server/discover` with an HTTP 4xx, which the SDK
   * reports through `onerror` before it falls back; those are not transport
   * errors worth logging (a real handshake failure rejects `connect()`).
   */
  handshaking: boolean
  closedByClient: boolean
  closeEmitted: boolean
  /**
   * The current transport reported `onclose`. Read by `mcpConnect` after the
   * subscription step: a close there means the "connected" result would
   * describe a dead connection (issue #154).
   */
  transportClosed: boolean
  /** Last transport error; cleared whenever an inbound frame proves the link alive. */
  lastError?: string
  /**
   * Credential headers a cross-origin redirect kept from each target origin
   * (issue #169): origin → the user's header names. Read by `mcpConnect`'s
   * failure path to explain a 401 / 403.
   */
  credentialDrops: Map<string, Set<string>>
  /** `from→to|names` keys already reported, so one drop is one notification. */
  reportedDrops: Set<string>
  /** `transport.send` promises still running — flushed before a disconnect closes the transport. */
  outbound: Set<Promise<void>>
  /**
   * In-flight POSTs that carry a JSON-RPC request, keyed by
   * `JSON.stringify(id)` (issue #163): aborted when that request is
   * cancelled, dropped once its response frame arrived.
   */
  postsById: Map<string, AbortController>
  /** Until when a stream error caused by our own POST abort is expected (not logged). */
  postAbortQuietUntil: number
}

interface Connection {
  client: Client
  info: McpConnectionInfo
  state: WireState
  /** Raw tool definitions from the last `tools/list` (MRTR `toolDefinition`, see `runToolCall`). */
  tools: Map<string, Tool>
  subscription?: McpSubscription
}

const connections = new Map<string, Connection>()
/**
 * In-flight MCP handshakes keyed by the renderer-supplied pendingId. The
 * value is a teardown closure that closes the transport so the in-flight
 * `client.connect()` rejects. Kept through the modern-era
 * `subscriptions/listen` step (up to `LISTEN_ACK_TIMEOUT_MS`), which is part
 * of the handshake (issue #154); removed once the connection is registered or
 * the attempt fails.
 */
const pendingConnects = new Map<string, () => Promise<void>>()
let nextId = 1

function makeId(): string {
  return `mcp-${nextId++}-${Date.now()}`
}

function emit(state: WireState, event: McpEngineEvent): void {
  if (state.discarded) return
  if (state.buffering) {
    state.buffer.push(event)
    return
  }
  deliver(event)
}

function deliver(event: McpEngineEvent): void {
  if (!eventSink) return
  try {
    eventSink(event)
  } catch {
    // A broken consumer must never take the transport down.
  }
}

function flushBuffered(state: WireState): void {
  state.buffering = false
  const pending = state.buffer
  state.buffer = []
  // A failed handshake never handed this connectionId to the renderer.
  if (!state.established) return
  for (const event of pending) deliver(event)
}

// ─── Frame tap ──────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function frameMessage(message: unknown): { message: unknown; truncated?: boolean } {
  let serialised: string
  try {
    serialised = JSON.stringify(message)
  } catch {
    return { message }
  }
  if (serialised.length <= MAX_FRAME_CHARS) return { message }
  const m = isObject(message) ? message : {}
  return {
    truncated: true,
    message: {
      jsonrpc: '2.0',
      ...('id' in m ? { id: m.id } : {}),
      ...('method' in m ? { method: m.method } : {}),
      _truncated: {
        chars: serialised.length,
        preview: serialised.slice(0, FRAME_PREVIEW_CHARS),
      },
    },
  }
}

function recordFrame(state: WireState, direction: 'in' | 'out', message: unknown): void {
  // A batch is recorded member by member, exactly like the server sees it.
  if (Array.isArray(message)) {
    for (const item of message) recordFrame(state, direction, item)
    return
  }
  if (!isObject(message)) return
  const ts = Date.now()
  const hasId = 'id' in message && message.id !== undefined && message.id !== null
  const method = typeof message.method === 'string' ? message.method : undefined
  if (direction === 'in') state.lastError = undefined
  if (direction === 'in' && hasId && !method && state.postsById.size > 0) {
    state.postsById.delete(JSON.stringify(message.id))
  }

  emit(state, {
    type: 'frame',
    payload: { connectionId: state.connectionId, ts, direction, ...frameMessage(message) },
  })
  // Every inbound JSON-RPC notification (method, no id). Derived from the
  // frame tap rather than `setNotificationHandler` / the fallback handler:
  // the SDK's Protocol pre-registers `notifications/cancelled` /
  // `notifications/progress` (which would shadow a fallback, and replacing
  // the progress handler breaks the SDK's progress / timeout bookkeeping),
  // and on the 2026-07-28 era the `subscriptions/listen` stream's change
  // notifications ride the same wire, so this one tap covers both eras.
  if (direction === 'in' && method && !hasId) {
    emit(state, {
      type: 'notification',
      payload: {
        connectionId: state.connectionId,
        ts,
        method,
        ...('params' in message ? { params: message.params } : {}),
      },
    })
  }
}

/** Parse a JSON body (single message or batch) and record it as inbound frames. */
function recordJsonBody(state: WireState, text: string): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return
  }
  const items = Array.isArray(parsed) ? parsed : [parsed]
  for (const item of items) {
    if (isObject(item) && item.jsonrpc === '2.0') recordFrame(state, 'in', item)
  }
}

/**
 * Minimal `text/event-stream` reader (WHATWG SSE parsing rules for the
 * fields MCP uses): `data:` lines of one event are joined with `\n`, only
 * default / `message` events carry JSON-RPC, `:` lines are comments. Reads
 * the stream to its end even when a payload fails to parse — the tap reads a
 * `Response.clone()`, and an unread tee branch would buffer the SDK's side.
 */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onMessage: (data: string) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  let event = ''
  const dispatch = (): void => {
    if (data.length > 0 && (event === '' || event === 'message')) {
      try {
        onMessage(data.join('\n'))
      } catch {
        /* a bad payload never stops the read */
      }
    }
    data = []
    event = ''
  }
  const processLine = (line: string): void => {
    if (line === '') return dispatch()
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer)
        if (!match) break
        // A lone `\r` at the end of the chunk may be the first half of `\r\n`.
        if (match[0] === '\r' && match.index === buffer.length - 1) break
        processLine(buffer.slice(0, match.index))
        buffer = buffer.slice(match.index + match[0].length)
      }
    }
    buffer += decoder.decode()
    if (buffer) processLine(buffer.replace(/\r$/, ''))
    dispatch()
  } catch {
    // Aborted / dropped stream: the SDK reports it on its own branch.
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* already released */
    }
  }
}

/**
 * Record the JSON-RPC messages carried by an HTTP response without disturbing
 * the SDK's copy. An error status is recorded only for a POST — that body
 * answers a message we sent (e.g. the 2025 server's `400` JSON-RPC error to
 * the `server/discover` probe); a stateless server's `405` to the optional
 * GET stream is not a reply to anything.
 */
function tapResponse(state: WireState, res: Response, method: string): void {
  if (!res.body) return
  if (!res.ok && method !== 'POST') return
  const mediaType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (mediaType !== 'application/json' && mediaType !== 'text/event-stream') return
  let copy: Response
  try {
    copy = res.clone()
  } catch {
    return
  }
  if (mediaType === 'application/json') {
    void copy
      .text()
      .then((text) => recordJsonBody(state, text))
      .catch(() => {})
    return
  }
  if (copy.body) {
    void readEventStream(copy.body, (payload) => recordJsonBody(state, payload))
  }
}

/**
 * HTTP frame tap (Streamable HTTP + legacy SSE), as a fetch middleware on the
 * transport's `fetch`. Inbound frames are read from the WIRE: JSON bodies,
 * SSE response streams event by event (the standalone GET stream, per-request
 * POST streams, the 2026-07-28 `subscriptions/listen` stream), and JSON-RPC
 * error bodies of 4xx answers. This is the only place the `server/discover`
 * probe's reply is visible — the SDK's probe window takes over
 * `transport.onmessage` and does not forward the reply. Outbound frames come
 * from the `send` wrap in `tapTransport` (exact message, sync ordering).
 * Composed OUTSIDE the OAuth fetch, so a 401 → refresh → retry shows as one
 * exchange.
 */
function frameTapFetch(state: WireState, base: FetchLike): FetchLike {
  return createMiddleware(async (next, input, init) => {
    const res = await next(input, init)
    tapResponse(state, res, (init?.method ?? 'GET').toUpperCase())
    return res
  })(base)
}

/** `JSON.stringify(id)` of a single JSON-RPC request body, or undefined (notification, batch, not JSON). */
function requestIdKey(body: unknown): string | undefined {
  if (typeof body !== 'string' || !body.includes('"id"')) return undefined
  try {
    const msg: unknown = JSON.parse(body)
    if (!isObject(msg) || typeof msg.method !== 'string') return undefined
    return typeof msg.id === 'number' || typeof msg.id === 'string'
      ? JSON.stringify(msg.id)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Gives every POST that carries a JSON-RPC request its own AbortController
 * (issue #163). On a 2025-era connection the SDK cancels a request only with
 * `notifications/cancelled`; a server then never answers it, so its POST
 * response stream would stay open until the session closes — one idle HTTP
 * connection per cancelled call. `abortCancelledPost` aborts that POST once
 * the cancellation went out. (On 2026-07-28 the SDK closes the stream itself
 * through the request's own signal, which is kept.)
 */
function abortablePostFetch(state: WireState, next: FetchLike): FetchLike {
  return async (input, init) => {
    const key =
      (init?.method ?? 'GET').toUpperCase() === 'POST' ? requestIdKey(init?.body) : undefined
    if (key === undefined) return next(input, init)
    const controller = new AbortController()
    state.postsById.set(key, controller)
    const signal = init?.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal
    try {
      return await next(input, { ...init, signal })
    } catch (err) {
      if (state.postsById.get(key) === controller) state.postsById.delete(key)
      throw err
    }
  }
}

/** Abort reason of `abortCancelledPost` — how its expected stream error is recognised. */
const POST_ABORT_REASON = 'MCP request stream closed after cancellation'

/** Abort the POST still streaming the answer to request `key` (it was cancelled). */
function abortCancelledPost(state: WireState, key: string): void {
  const controller = state.postsById.get(key)
  if (!controller) return
  state.postsById.delete(key)
  // The SDK reports the aborted stream through `onerror` — expected noise.
  state.postAbortQuietUntil = Date.now() + 2_000
  controller.abort(POST_ABORT_REASON)
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
/** Fetch spec's redirect limit. */
const MAX_REDIRECTS = 20
/**
 * Headers `isCredentialHeaderName` matches that a cross-origin hop still
 * KEEPS. `mcp-session-id` is protocol state issued by the redirect target
 * itself (its `initialize` was redirected there too), not a user secret —
 * stripping it breaks every stateful 2025 server behind a redirecting
 * gateway. (`mcp-protocol-version` / `last-event-id` are not matched by the
 * credential rule, so they need no entry.)
 */
const REDIRECT_KEEP_HEADERS = new Set(['mcp-session-id'])
/** Request-body headers dropped when a redirect turns the request into a GET (fetch spec). */
const REQUEST_BODY_HEADERS = [
  'content-encoding',
  'content-language',
  'content-location',
  'content-type',
]

/**
 * Same origin — or the https upgrade of the same host with both on the
 * default port (`http://h` → `https://h`), which is no new party (the SDK's
 * own `isWithinOrigin` rule).
 */
export function isSameParty(from: URL, to: URL): boolean {
  if (from.origin === to.origin) return true
  return (
    from.protocol === 'http:' &&
    to.protocol === 'https:' &&
    from.hostname === to.hostname &&
    !from.port &&
    !to.port
  )
}

/**
 * Follows redirects ITSELF (issue #154) instead of leaving them to fetch.
 * Native fetch strips only `Authorization` / `Cookie` on a cross-origin hop —
 * a gateway key (`X-API-Key`, `Ocp-Apim-Subscription-Key`, …) from the user's
 * custom headers would be replayed to the new origin. Here every hop is sent
 * with `redirect: 'manual'`; a same-origin hop keeps every header, and on a
 * hop to another origin every header `isCredentialHeaderName` matches is
 * dropped for the rest of the chain (except `REDIRECT_KEEP_HEADERS`:
 * `mcp-session-id`). 307 / 308 keep method and body; 303, and 301 / 302 after a
 * POST, continue as a body-less GET (fetch spec). `base` runs once PER HOP
 * with that hop's URL, so the OAuth fetch's audience gate (`isTokenAudience`)
 * never puts the bearer on a request to another origin. A caller asking for
 * `'manual'` / `'error'` itself gets `base` untouched.
 */
export function fetchFollowingRedirects(
  base: FetchLike,
  /**
   * Called once per cross-origin hop that dropped credential headers (issue
   * #169) — header NAMES as the Headers object spells them (lower case),
   * never values.
   */
  onCredentialsDropped?: (drop: McpRedirectCredentialDrop) => void,
): FetchLike {
  return async (input, init) => {
    if (init?.redirect === 'manual' || init?.redirect === 'error') return base(input, init)
    const headers = new Headers(init?.headers)
    let method = (init?.method ?? 'GET').toUpperCase()
    let body = init?.body
    let current = new URL(String(input))
    for (let hops = 0; ; hops++) {
      const res = await base(current, { ...init, method, body, headers, redirect: 'manual' })
      const location = REDIRECT_STATUSES.has(res.status) ? res.headers.get('location') : null
      if (!location) return res
      let target: URL
      try {
        target = new URL(location, current)
      } catch {
        return res
      }
      await res.body?.cancel().catch(() => {})
      if (hops >= MAX_REDIRECTS)
        throw new TypeError(`Too many redirects (more than ${MAX_REDIRECTS})`)
      const toGet =
        res.status === 303
          ? method !== 'GET' && method !== 'HEAD'
          : (res.status === 301 || res.status === 302) && method === 'POST'
      if (toGet) {
        method = 'GET'
        body = undefined
        for (const name of REQUEST_BODY_HEADERS) headers.delete(name)
      }
      if (!isSameParty(current, target)) {
        const credentials: string[] = []
        headers.forEach((_value, name) => {
          if (isCredentialHeaderName(name) && !REDIRECT_KEEP_HEADERS.has(name)) {
            credentials.push(name)
          }
        })
        for (const name of credentials) headers.delete(name)
        if (credentials.length > 0 && onCredentialsDropped) {
          try {
            onCredentialsDropped({ from: current.origin, to: target.origin, headers: credentials })
          } catch {
            // Reporting never breaks the request.
          }
        }
      }
      current = target
    }
  }
}

/**
 * A transport error the connection cannot recover from:
 *  - legacy SSE: `SseError` carrying an HTTP status — eventsource@3 only
 *    passes a code from `failConnection` (non-200 / 204 / wrong content
 *    type), after which it is CLOSED and never reconnects; network drops
 *    arrive code-less and are retried by eventsource itself.
 *  - Streamable HTTP: the standalone GET stream gave up reconnecting
 *    (`_scheduleReconnection`). Per-request POST failures also surface as
 *    `onerror` there — those are NOT terminal.
 */
function isTerminalTransportError(kind: McpTransport, err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  if (kind === 'sse') {
    return isObject(err) && typeof err.code === 'number' && message.startsWith('SSE error')
  }
  if (kind === 'http') return message.startsWith('Maximum reconnection attempts')
  return false
}

function defaultCloseReason(kind: McpTransport): string {
  if (kind === 'stdio') return 'Server process exited'
  if (kind === 'sse') return 'SSE stream closed'
  return 'Connection closed'
}

function handleClose(state: WireState): void {
  state.transportClosed = true
  const conn = connections.get(state.connectionId)
  if (conn && conn.state === state) connections.delete(state.connectionId)
  if (state.established) releaseConnectionWork(state.connectionId)
  if (!state.established || state.closeEmitted) return
  state.closeEmitted = true
  emit(state, {
    type: 'connectionClosed',
    payload: {
      connectionId: state.connectionId,
      ...(state.closedByClient
        ? {}
        : { reason: state.lastError ?? defaultCloseReason(state.kind) }),
    },
  })
}

function handleError(state: WireState, err: unknown): void {
  // Our own close() aborts streams; those errors are expected noise.
  if (state.closedByClient) return
  const message = err instanceof Error ? err.message : String(err)
  if (Date.now() < state.postAbortQuietUntil && message.includes(POST_ABORT_REASON)) return
  // Consecutive identical errors (e.g. an SSE reconnect loop against a dead
  // server) are reported once; handshake-time errors are the probe's.
  if (message !== state.lastError && !state.handshaking) {
    emit(state, {
      type: 'transportError',
      payload: { connectionId: state.connectionId, message },
    })
  }
  state.lastError = message
  if (state.established && isTerminalTransportError(state.kind, err)) {
    const conn = connections.get(state.connectionId)
    if (conn) {
      // client.close() → transport.close() → onclose → handleClose emits
      // `connectionClosed` with this error as the reason.
      void conn.client.close().catch(() => {})
    }
  }
}

/**
 * Wire the frame tap BEFORE `client.connect()`. `Protocol.connect` chains
 * any `onmessage` / `onclose` / `onerror` already on the transport instead of
 * dropping them, and the SDK's negotiation probe window saves and restores
 * them (forwarding close / error meanwhile), so the handshake is covered.
 * `send` is wrapped as an own property, shadowing the prototype method the
 * SDK calls — including the probe's `server/discover`. On http / sse the
 * inbound side is the fetch middleware (`frameTapFetch`); on stdio it is
 * `onmessage`.
 */
function tapTransport(
  transport: Transport,
  state: WireState,
  tapInbound: boolean,
  /** False for a transport an earlier connect attempt gave up on (see `mcpConnect`). */
  isCurrent: () => boolean = () => true,
): void {
  if (typeof transport.send === 'function') {
    const originalSend = transport.send.bind(transport)
    transport.send = (message, options) => {
      // Recorded before the send: a response can be delivered while send()
      // is still pending.
      recordFrame(state, 'out', message)
      const sending = originalSend(message, options)
      state.outbound.add(sending)
      // Issue #163: once the server was told, close the cancelled request's
      // own POST response stream (see `abortablePostFetch`).
      const sent: unknown = message
      if (
        isObject(sent) &&
        sent.method === 'notifications/cancelled' &&
        isObject(sent.params) &&
        sent.params.requestId !== undefined
      ) {
        const key = JSON.stringify(sent.params.requestId)
        void sending.finally(() => abortCancelledPost(state, key)).catch(() => {})
      }
      void sending.finally(() => state.outbound.delete(sending)).catch(() => {})
      return sending
    }
  }
  if (tapInbound) {
    transport.onmessage = (message: JSONRPCMessage) => recordFrame(state, 'in', message)
  }
  transport.onclose = () => {
    if (isCurrent()) handleClose(state)
  }
  transport.onerror = (err: Error) => {
    if (isCurrent()) handleError(state, err)
  }
}

// ─── Redirect credential drops (issue #169) ─────────────────

/**
 * Record a cross-origin redirect that kept credential headers back
 * (`fetchFollowingRedirects`) and report it ONCE per from → to / header set
 * as a synthetic `notifications/testnizer/redirect_credentials_dropped`
 * notification on the connection's own stream — so it shows up in Messages →
 * Notifications like any server notification. Header names only.
 */
function noteCredentialDrop(state: WireState, drop: McpRedirectCredentialDrop): void {
  let names = state.credentialDrops.get(drop.to)
  if (!names) {
    names = new Set()
    state.credentialDrops.set(drop.to, names)
  }
  for (const name of drop.headers) names.add(name)
  const key = `${drop.from}→${drop.to}|${[...drop.headers].sort().join(',')}`
  if (state.reportedDrops.has(key)) return
  state.reportedDrops.add(key)
  emit(state, {
    type: 'notification',
    payload: {
      connectionId: state.connectionId,
      ts: Date.now(),
      method: REDIRECT_CREDENTIALS_DROPPED_METHOD,
      params: { from: drop.from, to: drop.to, headers: [...drop.headers] },
    },
  })
}

/** HTTP 401 / 403 in any SDK 2.x / v1-transport shape (`.status`, SSE `.code`, `UnauthorizedError`). */
function isAuthRejection(err: unknown): boolean {
  if (!isObject(err)) return false
  return (
    err.status === 401 ||
    err.status === 403 ||
    err.code === 401 ||
    err.code === 403 ||
    err.name === 'UnauthorizedError'
  )
}

/** "Credential headers X, Y were not sent to <origin> after a cross-origin redirect." per target origin. */
function credentialDropHint(state: WireState): string {
  return [...state.credentialDrops]
    .map(
      ([origin, names]) =>
        `Credential headers ${[...names].join(', ')} were not sent to ${origin} after a cross-origin redirect.`,
    )
    .join(' ')
}

// ─── Cancellable calls (issue #163) ─────────────────────────

/** Error message (and IPC `error`) of a call the user cancelled. */
export const MCP_CALL_CANCELLED_MESSAGE = 'MCP call cancelled by user'

/** Thrown by a call `mcpCancelCall` aborted; the handler maps `cancelled` onto the IPC reply. */
export class McpCallCancelledError extends Error {
  readonly cancelled = true as const
  constructor() {
    super(MCP_CALL_CANCELLED_MESSAGE)
    this.name = 'McpCallCancelledError'
  }
}

/** Per-call options of the cancellable calls (tools/call, resources/read, prompts/get). */
export interface McpCallOptions {
  /** Renderer-chosen id `mcpCancelCall(connectionId, callId)` aborts this call by. */
  callId?: string
}

/** In-flight cancellable calls: connectionId → callId → controller. */
const inflightCalls = new Map<string, Map<string, AbortController>>()

/**
 * Run one SDK call under an AbortController registered as `callId` (when
 * given). Registration is synchronous — before the first `await` — so a
 * cancel arriving right after the call starts still finds it. The SDK turns
 * the abort into the per-transport cancellation (`notifications/cancelled`,
 * or closing a 2026-07-28 request's own response stream) and rejects; that
 * rejection becomes `McpCallCancelledError`. The entry is removed when the
 * call settles.
 */
async function runCancellable<T>(
  connectionId: string,
  callId: string | undefined,
  run: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  if (!callId) return run(undefined)
  let calls = inflightCalls.get(connectionId)
  if (!calls) {
    calls = new Map()
    inflightCalls.set(connectionId, calls)
  }
  if (calls.has(callId)) throw new Error(`An MCP call with id "${callId}" is already running`)
  const controller = new AbortController()
  calls.set(callId, controller)
  try {
    return await run(controller.signal)
  } catch (err) {
    if (controller.signal.aborted) throw new McpCallCancelledError()
    throw err
  } finally {
    const current = inflightCalls.get(connectionId)
    if (current?.get(callId) === controller) {
      current.delete(callId)
      if (current.size === 0) inflightCalls.delete(connectionId)
    }
  }
}

/**
 * Cancel the running call `callId` of `connectionId` (issue #163). Returns
 * false when no such call is running (finished, unknown, already cancelled).
 * The connection stays open and usable.
 */
export function mcpCancelCall(connectionId: string, callId: string): boolean {
  const controller = inflightCalls.get(connectionId)?.get(callId)
  if (!controller || controller.signal.aborted) return false
  // The reason is what the server reads in `notifications/cancelled`.
  controller.abort(MCP_CALL_CANCELLED_MESSAGE)
  return true
}

// ─── Elicitation for 2025-era servers (issue #168) ──────────

const DEFAULT_ELICITATION_TIMEOUT_MS = 10 * 60_000
let elicitationTimeoutMs = DEFAULT_ELICITATION_TIMEOUT_MS

/** Test seam: shorten the pending-elicitation timeout; `null` restores the 10-minute default. */
export function setMcpElicitationTimeoutMs(ms: number | null): void {
  elicitationTimeoutMs = ms ?? DEFAULT_ELICITATION_TIMEOUT_MS
}

interface PendingElicitation {
  finish: (result: ElicitResult) => void
}

/** Open `elicitation/create` requests: connectionId → elicitationId → pending answer. */
const pendingElicitations = new Map<string, Map<string, PendingElicitation>>()
let nextElicitationId = 1

/** Answer every open elicitation of a connection with `cancel`. Returns how many there were. */
function cancelPendingElicitations(connectionId: string): number {
  const pending = pendingElicitations.get(connectionId)
  if (!pending) return 0
  pendingElicitations.delete(connectionId)
  const open = [...pending.values()]
  for (const p of open) p.finish({ action: 'cancel' })
  return open.length
}

/** The connection is gone: forget its calls (they reject on their own) and cancel its elicitations. */
function releaseConnectionWork(connectionId: string): void {
  inflightCalls.delete(connectionId)
  cancelPendingElicitations(connectionId)
}

interface ElicitParams {
  mode?: string
  message: string
  requestedSchema?: unknown
}

/**
 * A 2025-era server's `elicitation/create` (the SDK already validated it and
 * rejected modes the Client did not declare): emit it to the owning
 * connection and wait for `mcpRespondElicitation` — or answer `cancel` when
 * the server withdraws it, the connection closes, or nobody answers within
 * `elicitationTimeoutMs`. URL mode is never declared, so the decline branch
 * only covers an SDK that stops enforcing that.
 */
function handleElicitation(
  client: Client,
  state: WireState,
  params: ElicitParams,
  signal: AbortSignal | undefined,
): Promise<ElicitResult> {
  if (params.mode === 'url') {
    console.warn(
      `[mcp] ${state.connectionId}: declined a URL-mode elicitation — Testnizer answers form-mode elicitations only`,
    )
    return Promise.resolve({ action: 'decline' })
  }
  const connectionId = state.connectionId
  const elicitationId = `elicit-${nextElicitationId++}-${Date.now()}`
  return new Promise<ElicitResult>((resolve) => {
    let map = pendingElicitations.get(connectionId)
    if (!map) {
      map = new Map()
      pendingElicitations.set(connectionId, map)
    }
    const own = map
    let done = false
    const finish = (result: ElicitResult): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      own.delete(elicitationId)
      if (own.size === 0 && pendingElicitations.get(connectionId) === own) {
        pendingElicitations.delete(connectionId)
      }
      resolve(result)
    }
    const onAbort = (): void => finish({ action: 'cancel' })
    const timer = setTimeout(onAbort, elicitationTimeoutMs)
    timer.unref?.()
    own.set(elicitationId, { finish })
    if (signal?.aborted || state.closedByClient || state.transportClosed) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const serverName = client.getServerVersion()?.name
    emit(state, {
      type: 'elicitation',
      payload: {
        connectionId,
        elicitationId,
        ...(serverName ? { serverName } : {}),
        message: params.message,
        requestedSchema: isObject(params.requestedSchema) ? plainJson(params.requestedSchema) : {},
        mode: 'form',
      },
    })
  })
}

/**
 * Deliver the user's answer to an `McpElicitationEvent` (issue #168). Throws
 * when the elicitation is no longer open (answered, timed out, withdrawn, or
 * the connection closed) or the answer is malformed.
 */
export function mcpRespondElicitation(
  connectionId: string,
  elicitationId: string,
  result: McpElicitationResult,
): void {
  const pending = pendingElicitations.get(connectionId)?.get(elicitationId)
  if (!pending) {
    throw new Error(
      `No pending elicitation ${elicitationId} on this connection (already answered, timed out, or the connection closed)`,
    )
  }
  const action: unknown = isObject(result) ? result.action : undefined
  if (action === 'accept') {
    if (!isObject(result.content)) {
      throw new Error('An accepted elicitation needs a content object')
    }
    pending.finish({
      action,
      content: plainJson(result.content) as NonNullable<ElicitResult['content']>,
    })
    return
  }
  if (action === 'decline' || action === 'cancel') {
    pending.finish({ action })
    return
  }
  throw new Error(`Invalid elicitation action: ${String(action)}`)
}

// ─── Errors ─────────────────────────────────────────────────

/** `MCP error <code>: <message>` (+ the server's supported versions for -32022) of a JSON-RPC error body. */
function jsonRpcErrorText(body: unknown): string | undefined {
  if (typeof body !== 'string' || !body.trim().startsWith('{')) return undefined
  try {
    const parsed: unknown = JSON.parse(body)
    if (!isObject(parsed) || !isObject(parsed.error)) return undefined
    const { code, message, data } = parsed.error
    if (typeof code !== 'number') return undefined
    const supported =
      isObject(data) && Array.isArray(data.supported)
        ? ` (server supports ${data.supported.join(', ')})`
        : ''
    return `MCP error ${code}: ${typeof message === 'string' ? message : ''}${supported}`
  } catch {
    return undefined
  }
}

/**
 * Make SDK v2 errors read like the v1 ones users (and logs) know:
 *  - `ProtocolError` (a JSON-RPC error from the server) carries the bare
 *    server message → `MCP error <code>: <message>`;
 *  - `SdkHttpError` keeps the HTTP status in `.status` (v1: `.code`) → the
 *    message names the status, and a JSON-RPC error body (e.g. a
 *    2026-07-28-only server's `-32022 Unsupported protocol version`) is
 *    spelled out instead of dumped raw.
 * The error object itself (class, `.code`, `.status`, `.data`) is kept.
 */
export function decorateMcpError(err: unknown): unknown {
  if (!(err instanceof Error)) return err
  const e = err as Error & { code?: unknown; status?: unknown; data?: unknown }
  try {
    if (e.name === 'ProtocolError' && typeof e.code === 'number') {
      if (!e.message.startsWith('MCP error')) e.message = `MCP error ${e.code}: ${e.message}`
    } else if (e.name === 'SdkHttpError' && typeof e.status === 'number') {
      const rpc = jsonRpcErrorText(isObject(e.data) ? e.data.text : undefined)
      if (rpc) e.message = `HTTP ${e.status}: ${rpc}`
      else if (!e.message.includes(String(e.status))) e.message = `${e.message} (HTTP ${e.status})`
    }
  } catch {
    /* read-only message — leave it */
  }
  return err
}

async function sdkCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    throw decorateMcpError(err)
  }
}

// ─── Authorization tab (MCP Auth) ───────────────────────────
// Pure helpers live in `mcp-auth.ts` (shared with the Security Scan);
// re-exported so callers / tests keep importing them from the engine.
export { applyMcpAuth, type McpAuthOptions } from './mcp-auth'

// ─── Version negotiation ────────────────────────────────────

const PROTOCOL_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isModernProtocolVersion(version: string): boolean {
  return PROTOCOL_DATE.test(version) && version >= MCP_MODERN_PROTOCOL_VERSION
}

interface NegotiationPlan {
  versionNegotiation: VersionNegotiationOptions
  /** Legacy pin: the only version `initialize` offers / accepts. */
  supportedProtocolVersions?: string[]
}

/**
 * Map the `protocol` connect option onto the SDK's `versionNegotiation`.
 *  - `'auto'` → `{ mode: 'auto' }`, except on legacy HTTP+SSE: that transport
 *    predates 2026-07-28, and a non-SDK SSE server rejecting the probe POST
 *    fails the connect instead of falling back — so it stays on `initialize`.
 *  - a modern revision → `{ mode: { pin } }`.
 *  - a legacy revision → `{ mode: 'legacy' }` + `supportedProtocolVersions: [v]`
 *    (the SDK refuses to `pin` a pre-2026 version).
 */
export function resolveNegotiation(
  protocol: McpProtocolOption | undefined,
  transport: McpTransport,
): NegotiationPlan {
  const value = (protocol ?? 'auto').trim() || 'auto'
  if (value === 'legacy') return { versionNegotiation: { mode: 'legacy' } }
  if (value === 'auto') {
    if (transport === 'sse') return { versionNegotiation: { mode: 'legacy' } }
    return {
      versionNegotiation: {
        mode: 'auto',
        probe: {
          timeoutMs: transport === 'stdio' ? STDIO_PROBE_TIMEOUT_MS : HTTP_PROBE_TIMEOUT_MS,
        },
      },
    }
  }
  if (!PROTOCOL_DATE.test(value)) {
    throw new Error(
      `Unknown MCP protocol option "${value}" — use auto, legacy or a protocol version like ${MCP_MODERN_PROTOCOL_VERSION}`,
    )
  }
  if (isModernProtocolVersion(value)) {
    return {
      versionNegotiation: {
        mode: { pin: value },
        ...(transport === 'stdio' ? { probe: { timeoutMs: STDIO_PROBE_TIMEOUT_MS } } : {}),
      },
    }
  }
  return { versionNegotiation: { mode: 'legacy' }, supportedProtocolVersions: [value] }
}

/** HTTP 401 in any SDK 2.x / v1-transport shape (`SdkHttpError.status`, `SseError.code`, `UnauthorizedError`). */
function isUnauthorizedError(err: unknown): boolean {
  if (!isObject(err)) return false
  return err.status === 401 || err.code === 401 || err.name === 'UnauthorizedError'
}

/**
 * The SDK Client, with the 2026-07-28 per-request envelope kept exactly as it
 * was before issue #168: the Client now declares form elicitation (so a
 * 2025-era server may send `elicitation/create`), but on the modern era only
 * `tools/call` advertises it — `runToolCall` puts it in that request's own
 * `_meta` — because that is the one request whose `input_required` answer
 * Testnizer can fulfil (`mcpRespondInput`).
 */
class TestnizerClient extends Client {
  protected override _outboundMetaEnvelope(): Readonly<Record<string, unknown>> | undefined {
    const envelope = super._outboundMetaEnvelope()
    const caps = envelope?.[CLIENT_CAPABILITIES_META_KEY]
    if (!envelope || !isObject(caps) || !('elicitation' in caps)) return envelope
    const withoutElicitation: Record<string, unknown> = { ...caps }
    delete withoutElicitation.elicitation
    return { ...envelope, [CLIENT_CAPABILITIES_META_KEY]: withoutElicitation }
  }
}

function newClient(plan: NegotiationPlan, state: WireState): Client {
  const client = new TestnizerClient(
    { name: 'Testnizer', version: '1.0.0' },
    {
      // Form elicitation for 2025-era servers (issue #168): declared at
      // `initialize`, answered by asking the user (`handleElicitation`). The
      // 'auto' → legacy fallback runs on this same Client, so it is declared
      // for every connect; the modern era drops inbound requests anyway.
      capabilities: { elicitation: { form: {} } },
      versionNegotiation: plan.versionNegotiation,
      ...(plan.supportedProtocolVersions
        ? { supportedProtocolVersions: plan.supportedProtocolVersions }
        : {}),
      // Manual multi-round-trip mode: an `input_required` tools/call result
      // is handed to the renderer (see `runToolCall`), never auto-fulfilled
      // through the elicitation handler below.
      inputRequired: { autoFulfill: false },
      listMaxPages: MAX_PAGES,
    },
  )
  client.setRequestHandler('elicitation/create', (request, ctx) =>
    handleElicitation(client, state, request.params as ElicitParams, ctx.mcpReq.signal),
  )
  return client
}

/** The `subscriptions/listen` filter a server's `listChanged` capabilities call for. */
function listenFilterFor(capabilities: Record<string, unknown> | undefined): SubscriptionFilter {
  const caps = capabilities ?? {}
  const flag = (key: string): boolean => isObject(caps[key]) && caps[key].listChanged === true
  return {
    ...(flag('tools') ? { toolsListChanged: true } : {}),
    ...(flag('prompts') ? { promptsListChanged: true } : {}),
    ...(flag('resources') ? { resourcesListChanged: true } : {}),
  }
}

function plainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// ─── Connect / disconnect ───────────────────────────────────

export async function mcpConnect(options: {
  transport: McpTransport
  url: string
  command?: string
  args?: string[]
  /**
   * Extra environment for the `stdio` server process, merged OVER the SDK's
   * safe default env (PATH, HOME, …) so `npx`-style commands keep working.
   * Ignored for `http` / `sse`.
   */
  env?: Record<string, string>
  /**
   * Custom HTTP headers for the `http` / `sse` handshake and every request
   * after it — e.g. `Authorization: Bearer …` or API-gateway `X-…` headers
   * (issue #137). Ignored for `stdio` (no HTTP involved).
   */
  headers?: Record<string, string>
  /**
   * Authorization tab (basic / bearer / API key), filling only the headers
   * `headers` does not set (`applyMcpAuth`). Ignored for `stdio`.
   */
  auth?: McpAuthOptions
  /**
   * Renderer-supplied id so `mcpCancelConnect(id)` can abort the handshake —
   * including the modern-era `subscriptions/listen` step after
   * `client.connect()` resolved (issue #154). Cleared once the connection is
   * registered or the attempt fails.
   */
  pendingId?: string
  /**
   * OAuth 2.1 session from the debugger (issue #141). Its access token is put
   * on every http / sse request by `createMcpOAuthFetch` — after the user's
   * headers, so the token wins — and refreshed once on a 401. The renderer
   * never sees the token. Ignored for `stdio`.
   */
  oauthSessionId?: string
  /** Protocol era negotiation (issue #152). Default `'auto'`. */
  protocol?: McpProtocolOption
}): Promise<McpConnectionInfo> {
  const connectionId = makeId()
  const plan = resolveNegotiation(options.protocol, options.transport)

  const state: WireState = {
    connectionId,
    kind: options.transport,
    established: false,
    buffering: true,
    buffer: [],
    discarded: false,
    handshaking: true,
    closedByClient: false,
    closeEmitted: false,
    transportClosed: false,
    credentialDrops: new Map(),
    reportedDrops: new Set(),
    outbound: new Set(),
    postsById: new Map(),
    postAbortQuietUntil: 0,
  }

  /** A fresh transport for one connect attempt (a transport cannot be restarted). */
  const buildTransport = (): Transport => {
    if (options.transport === 'stdio') {
      // With explicit `args` the caller already tokenised the command line
      // (the renderer's quote-aware `parseCommandLine`), so `command` is the
      // executable VERBATIM — a path with spaces must not be split again.
      // Without `args`, `command` (or the url field) is a whole command
      // line, split on whitespace as before.
      const verbatim = !!options.command && options.args !== undefined
      const cmd = options.command || options.url
      const parts = verbatim ? [cmd] : cmd.split(/\s+/)
      // The SDK's start() spreads getDefaultEnvironment() under the given
      // env; merge here explicitly anyway so neither an SDK change nor a user
      // env row can drop the inherited PATH / HOME (which breaks `npx`).
      const env =
        options.env && Object.keys(options.env).length > 0
          ? { ...getDefaultEnvironment(), ...options.env }
          : undefined
      return new StdioClientTransport({
        command: parts[0],
        args: [...parts.slice(1), ...(options.args ?? [])],
        env,
      })
    }
    // Authorization tab under the custom headers: a custom row of the same
    // name wins (issue #48 parity). The api-key query variant changes the
    // wire URL; `info.url` below keeps the original so the key never reaches
    // the console log or the connect result.
    const effective = applyMcpAuth(options.url, options.headers, options.auth)
    const headers = Object.keys(effective.headers).length > 0 ? effective.headers : undefined
    // SDK 2.x: both transports build every request's headers from
    // `requestInit.headers` in `_commonHeaders()` — Streamable HTTP POST /
    // GET / DELETE and the legacy SSE GET EventSource stream + POSTs — then
    // set their own `mcp-session-id` / `mcp-protocol-version` over them.
    // OAuth (issue #141): a custom `fetch` rather than the SDK's
    // `authProvider` — with an authProvider a 401 re-runs the SDK's whole
    // `auth()` orchestrator (browser redirect mid-connect). The OAuth fetch
    // sets its token AFTER the SDK built the headers, so the token wins.
    const oauthFetch = options.oauthSessionId
      ? createMcpOAuthFetch(options.oauthSessionId)
      : undefined
    const base: FetchLike = oauthFetch ?? ((url, init) => fetch(url, init))
    // The user's spelling of each header name, for the drop report (issue #169).
    const spelled = new Map(Object.keys(effective.headers).map((k) => [k.toLowerCase(), k]))
    const onCredentialsDropped = (drop: McpRedirectCredentialDrop): void =>
      noteCredentialDrop(state, {
        ...drop,
        headers: drop.headers.map((name) => spelled.get(name) ?? name),
      })
    const httpOpts = {
      ...(headers ? { requestInit: { headers } } : {}),
      // Frame tap outermost (sees the final answer only), then the redirect
      // follower, then the OAuth fetch — called per hop, so its audience
      // gate decides the bearer for each hop's own origin.
      fetch: frameTapFetch(
        state,
        abortablePostFetch(state, fetchFollowingRedirects(base, onCredentialsDropped)),
      ),
      // v1 parity: SDK 2.x refuses cross-origin redirects by default; v1
      // followed them. `'follow'` hands every request to our `fetch`
      // untouched, and `fetchFollowingRedirects` follows them — dropping
      // credential headers (`isCredentialHeaderName`) on a cross-origin hop,
      // which native fetch does only for Authorization / Cookie (issue #154).
      redirectPolicy: 'follow' as const,
    }
    // Legacy SSE: the POST endpoint comes from the server's `endpoint`
    // event, so an api-key query param rides the GET stream only.
    return options.transport === 'http'
      ? new StreamableHTTPClientTransport(new URL(effective.url), httpOpts)
      : new SSEClientTransport(new URL(effective.url), httpOpts)
  }

  let current: Transport | undefined
  let cancelled = false
  // Register before the connect() promise so a fast cancel still finds the
  // entry. Teardown closes the CURRENT attempt's transport — this is what
  // makes `client.connect()` reject (also mid-probe).
  if (options.pendingId) {
    pendingConnects.set(options.pendingId, async () => {
      cancelled = true
      try {
        await current?.close()
      } catch {
        // Best-effort: socket may already be torn down.
      }
    })
  }

  const attempt = async (attemptPlan: NegotiationPlan): Promise<Client> => {
    const client = newClient(attemptPlan, state)
    const transport = buildTransport()
    current = transport
    // A close of an attempt the auto → legacy retry gave up on is not this one's.
    state.transportClosed = false
    tapTransport(transport, state, options.transport === 'stdio', () => current === transport)
    await client.connect(transport)
    return client
  }

  const fail = (err: unknown): never => {
    if (options.pendingId) pendingConnects.delete(options.pendingId)
    state.discarded = true
    state.buffer = []
    const decorated = decorateMcpError(err)
    // Issue #169: a 401 / 403 after a cross-origin redirect dropped the
    // user's credential headers is explained by that drop — say so. The
    // error object is kept (`.status` drives the handler's `unauthorized`).
    if (
      decorated instanceof Error &&
      state.credentialDrops.size > 0 &&
      isAuthRejection(decorated)
    ) {
      try {
        decorated.message = `${decorated.message} ${credentialDropHint(state)}`
      } catch {
        /* read-only message — leave it */
      }
    }
    throw decorated
  }

  let client: Client
  try {
    client = await attempt(plan)
  } catch (err) {
    // Streamable HTTP `'auto'`: the SDK falls back to `initialize` only on
    // definitive legacy signals. A 2025 server behind a gateway / WAF that
    // answers the unknown `server/discover` POST with 403 or 5xx, or one that
    // never answers it, makes the probe a hard error — although the plain
    // 2025 handshake (what SDK 1.x always did) would work. Retry exactly
    // that, once, on a fresh client + transport; its error, if any, is the
    // one a 2025 client would have shown. A 401 is final (the renderer offers
    // OAuth on it), and so is a user cancel.
    const retryLegacy =
      options.transport === 'http' &&
      plan.versionNegotiation.mode === 'auto' &&
      !cancelled &&
      !isUnauthorizedError(err)
    if (!retryLegacy) return fail(err)
    try {
      client = await attempt({ versionNegotiation: { mode: 'legacy' } })
    } catch (legacyErr) {
      return fail(legacyErr)
    }
  }
  const era = client.getProtocolEra()
  const serverInfo = client.getServerVersion()
  const capabilities = client.getServerCapabilities()
  const capabilitiesJson = capabilities
    ? plainJson(capabilities as unknown as Record<string, unknown>)
    : undefined
  const instructions = client.getInstructions()
  const protocolVersion = client.getNegotiatedProtocolVersion()
  const discover = client.getDiscoverResult()

  const conn: Connection = {
    client,
    state,
    tools: new Map(),
    info: {
      connectionId,
      transport: options.transport,
      url: options.url,
      serverName: serverInfo?.name,
      serverVersion: serverInfo?.version,
      ...(protocolVersion ? { protocolVersion } : {}),
      ...(capabilitiesJson ? { capabilities: capabilitiesJson } : {}),
      ...(typeof instructions === 'string' && instructions ? { instructions } : {}),
      ...(era ? { era } : {}),
      ...(discover ? { discover: plainJson(discover as unknown as Record<string, unknown>) } : {}),
    },
  }

  // 2026-07-28: list-change notifications are only delivered on an explicit
  // `subscriptions/listen` stream (2025-era servers push them unsolicited).
  if (era === 'modern') {
    const requested = listenFilterFor(capabilitiesJson)
    if (Object.keys(requested).length > 0) {
      conn.info.subscription = await openSubscription(conn, requested)
    }
  }

  // The listen step is still the handshake (issue #154): a Cancel or a
  // transport close in that window must not come back as "connected" —
  // `openSubscription` turns the failed listen into a subscription error, so
  // check here, before the connection is registered.
  if (cancelled || state.transportClosed) {
    const reason = cancelled
      ? new Error('MCP handshake cancelled by user')
      : new Error(
          `Connection closed during the handshake${state.lastError ? `: ${state.lastError}` : ''}`,
        )
    state.closedByClient = true
    const sub = conn.subscription
    conn.subscription = undefined
    await sub?.close().catch(() => {})
    await client.close().catch(() => {})
    return fail(reason)
  }
  if (options.pendingId) pendingConnects.delete(options.pendingId)

  connections.set(connectionId, conn)
  state.established = true
  state.handshaking = false
  // An error the handshake survived (the probe's 4xx) is not this connection's.
  state.lastError = undefined
  // One macrotask later: the IPC reply carrying `connectionId` is posted from
  // the microtask chain that resolves this promise, so it reaches the
  // renderer before the buffered handshake frames do.
  setTimeout(() => flushBuffered(state), 0)
  return conn.info
}

/**
 * Open the modern-era `subscriptions/listen` stream. Change notifications on
 * it reach the renderer through the frame tap (like every notification), so
 * no `setNotificationHandler` is registered. A failure is reported on the
 * connect result — the connection itself stays usable.
 */
async function openSubscription(
  conn: Connection,
  requested: SubscriptionFilter,
): Promise<McpSubscriptionInfo> {
  const { state } = conn
  try {
    const sub = await conn.client.listen(requested, { timeout: LISTEN_ACK_TIMEOUT_MS })
    conn.subscription = sub
    const honoredFilter = plainJson(sub.honoredFilter as unknown as McpSubscriptionFilter)
    emit(state, {
      type: 'subscriptionState',
      payload: { connectionId: state.connectionId, state: 'open', honoredFilter },
    })
    void sub.closed.then((reason) => {
      if (conn.subscription === sub) conn.subscription = undefined
      if (reason === 'local' || state.closedByClient) return
      emit(state, {
        type: 'subscriptionState',
        payload: { connectionId: state.connectionId, state: 'closed', reason },
      })
    })
    return { requested: plainJson(requested as unknown as McpSubscriptionFilter), honoredFilter }
  } catch (err) {
    const message = (decorateMcpError(err) as Error)?.message ?? String(err)
    return { requested: plainJson(requested as unknown as McpSubscriptionFilter), error: message }
  }
}

/**
 * Abort an in-flight `mcpConnect()`. Returns true when a pending handshake
 * was found and the underlying transport torn down. The original `mcpConnect`
 * promise rejects — through the transport-close error while `client.connect()`
 * runs, or with "MCP handshake cancelled by user" during the
 * `subscriptions/listen` step (issue #154) — and never registers the
 * connection.
 */
export async function mcpCancelConnect(pendingId: string): Promise<boolean> {
  const teardown = pendingConnects.get(pendingId)
  if (!teardown) return false
  pendingConnects.delete(pendingId)
  await teardown()
  return true
}

export async function mcpDisconnect(connectionId: string): Promise<void> {
  const conn = connections.get(connectionId)
  if (!conn) return
  conn.state.closedByClient = true
  connections.delete(connectionId)
  // Pending elicitations are answered `cancel` (issue #168) — and those
  // answers are given a moment to reach the server before the transport
  // closes under them.
  if (cancelPendingElicitations(connectionId) > 0) await flushOutbound(conn.state)
  inflightCalls.delete(connectionId)
  const sub = conn.subscription
  conn.subscription = undefined
  if (sub) {
    // close() aborts the listen stream AND sends notifications/cancelled;
    // bounded so a hung server cannot stall the disconnect.
    await Promise.race([
      sub.close().catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, SUBSCRIPTION_CLOSE_TIMEOUT_MS)),
    ])
  }
  try {
    await conn.client.close()
  } catch {
    /* ignore */
  }
}

/** Let the SDK hand queued responses to the transport, then wait (bounded) for those sends. */
async function flushOutbound(state: WireState): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (state.outbound.size === 0) return
  await Promise.race([
    Promise.allSettled([...state.outbound]),
    new Promise<void>((resolve) => setTimeout(resolve, SUBSCRIPTION_CLOSE_TIMEOUT_MS)),
  ])
}

function requireConnection(connectionId: string): Connection {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('Not connected')
  return conn
}

// ─── Lists (paginated) ──────────────────────────────────────

/**
 * SDK 2.x walks every page itself when a list call has no `cursor` (capped by
 * `listMaxPages` = MAX_PAGES), so on a real server this loop runs once; it
 * still guards per-page answers (a `nextCursor` on the first result).
 */
async function collectPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string }>,
): Promise<T[]> {
  const out: T[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, nextCursor } = await fetchPage(cursor)
    out.push(...items)
    if (out.length >= MAX_ITEMS) return out.slice(0, MAX_ITEMS)
    // A server echoing the same cursor would otherwise loop to MAX_PAGES.
    if (!nextCursor || seenCursors.has(nextCursor)) break
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }
  return out
}

function isMethodNotFound(err: unknown): boolean {
  return isObject(err) && err.code === METHOD_NOT_FOUND
}

/** Drop `undefined` members so IPC payloads stay minimal. */
function compact<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] === undefined) delete obj[key]
  }
  return obj
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined
}

/**
 * A testing tool always asks the server: `'refresh'` skips the SDK's
 * response cache (SEP-2549 `ttlMs` hints) yet still writes it, which keeps
 * `callTool`'s output-schema / `Mcp-Param-*` index current.
 */
const FRESH = { cacheMode: 'refresh' as const }

export async function mcpListTools(connectionId: string): Promise<McpTool[]> {
  const conn = requireConnection(connectionId)
  const { client } = conn
  const raw: Tool[] = []
  const tools = await sdkCall(() =>
    collectPages(async (cursor) => {
      const res = await client.listTools(cursor ? { cursor } : undefined, FRESH)
      raw.push(...res.tools)
      return {
        nextCursor: res.nextCursor,
        items: res.tools.map((t) =>
          compact<McpTool>({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
            outputSchema: asRecord(t.outputSchema),
            annotations: asRecord(t.annotations),
          }),
        ),
      }
    }),
  )
  conn.tools = new Map(raw.map((t) => [t.name, t]))
  return tools
}

/**
 * `resources/list` + `resources/templates/list`, both fully paginated. A
 * server without the `resources` capability yields empty lists (Postman shows
 * an empty tab, not an error); a server that has resources but no template
 * support (`Method not found`) yields an empty template list.
 */
export async function mcpListResources(connectionId: string): Promise<McpResourceList> {
  const { client } = requireConnection(connectionId)
  if (!client.getServerCapabilities()?.resources) return { resources: [], templates: [] }

  let resources: McpResource[] = []
  try {
    resources = await collectPages(async (cursor) => {
      const res = await client.listResources(cursor ? { cursor } : undefined, FRESH)
      return {
        nextCursor: res.nextCursor,
        items: res.resources.map((r) =>
          compact<McpResource>({
            uri: r.uri,
            name: r.name,
            title: r.title,
            description: r.description,
            mimeType: r.mimeType,
            size: typeof r.size === 'number' ? r.size : undefined,
          }),
        ),
      }
    })
  } catch (err) {
    if (!isMethodNotFound(err)) throw decorateMcpError(err)
  }

  let templates: McpResourceTemplate[] = []
  try {
    templates = await collectPages(async (cursor) => {
      const res = await client.listResourceTemplates(cursor ? { cursor } : undefined, FRESH)
      return {
        nextCursor: res.nextCursor,
        items: res.resourceTemplates.map((t) =>
          compact<McpResourceTemplate>({
            uriTemplate: t.uriTemplate,
            name: t.name,
            title: t.title,
            description: t.description,
            mimeType: t.mimeType,
          }),
        ),
      }
    })
  } catch (err) {
    if (!isMethodNotFound(err)) throw decorateMcpError(err)
  }

  return { resources, templates }
}

export async function mcpReadResource(
  connectionId: string,
  uri: string,
  opts: McpCallOptions = {},
): Promise<McpReadResourceResult> {
  const { client } = requireConnection(connectionId)
  const res = await runCancellable(connectionId, opts.callId, (signal) =>
    sdkCall(() => client.readResource({ uri }, { ...FRESH, ...(signal ? { signal } : {}) })),
  )
  return {
    contents: res.contents.map((c) => {
      const item = c as Record<string, unknown>
      return compact<McpResourceContents>({
        uri: c.uri,
        mimeType: c.mimeType,
        text: typeof item.text === 'string' ? item.text : undefined,
        blob: typeof item.blob === 'string' ? item.blob : undefined,
      })
    }),
  }
}

/** `prompts/list`, fully paginated; empty when the server lacks the `prompts` capability. */
export async function mcpListPrompts(connectionId: string): Promise<McpPrompt[]> {
  const { client } = requireConnection(connectionId)
  if (!client.getServerCapabilities()?.prompts) return []
  try {
    return await collectPages(async (cursor) => {
      const res = await client.listPrompts(cursor ? { cursor } : undefined, FRESH)
      return {
        nextCursor: res.nextCursor,
        items: res.prompts.map((p) =>
          compact<McpPrompt>({
            name: p.name,
            title: p.title,
            description: p.description,
            arguments: p.arguments?.map((a) =>
              compact<McpPromptArgument>({
                name: a.name,
                description: a.description,
                required: a.required,
              }),
            ),
          }),
        ),
      }
    })
  } catch (err) {
    if (isMethodNotFound(err)) return []
    throw decorateMcpError(err)
  }
}

export async function mcpGetPrompt(
  connectionId: string,
  name: string,
  args: Record<string, string> = {},
  opts: McpCallOptions = {},
): Promise<McpGetPromptResult> {
  const { client } = requireConnection(connectionId)
  // prompts/get arguments are string-valued per spec; coerce defensively and
  // drop empty slots rather than sending "undefined".
  const promptArgs: Record<string, string> = {}
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined || v === null) continue
    promptArgs[k] = String(v)
  }
  const params = { name, arguments: promptArgs }
  const res = await runCancellable(connectionId, opts.callId, (signal) =>
    sdkCall(() => (signal ? client.getPrompt(params, { signal }) : client.getPrompt(params))),
  )
  return compact<McpGetPromptResult>({
    description: res.description,
    messages: res.messages.map((m) => ({ role: m.role, content: m.content })),
  })
}

// ─── tools/call (+ 2026-07-28 multi-round-trip) ─────────────

interface ToolCallParams {
  name: string
  arguments: Record<string, unknown>
  /** MRTR retry channel — top-level params, per the SDK's retry builder. */
  inputResponses?: Record<string, unknown>
  requestState?: string
  _meta?: Record<string, unknown>
}

/**
 * One `tools/call` leg. On the modern era the call runs in the SDK's manual
 * multi-round-trip mode (`allowInputRequired`): an `input_required` answer
 * comes back as the neutral `{ resultType: 'input_required', inputRequests?,
 * requestState? }` shape, marked with `__mcp` for the renderer. A complete
 * result is returned exactly as before.
 *
 * `callTool` validates `structuredContent` against the tool's cached
 * `outputSchema` AFTER the call, and would reject a legitimate
 * `input_required` (it has no structured content). On the modern era a tool
 * with an `outputSchema` is therefore called with its listed definition minus
 * that schema (`toolDefinition` — which still drives SEP-2243 `Mcp-Param-*`
 * header mirroring); its output is not validated client-side.
 */
async function runToolCall(
  conn: Connection,
  request: ToolCallParams,
  signal?: AbortSignal,
): Promise<unknown> {
  let params = request
  const modern = conn.client.getProtocolEra() === 'modern'
  // `onprogress` makes the SDK attach `_meta.progressToken`, which is what
  // allows a server to emit `notifications/progress` for this call at all
  // (they reach the renderer through the frame tap as `mcp:notification`).
  // Progress also resets the SDK's 60 s request timeout.
  const options: CallToolRequestOptions = {
    onprogress: () => {},
    resetTimeoutOnProgress: true,
    // Issue #163: `mcpCancelCall` — the MRTR retry legs get their own signal.
    ...(signal ? { signal } : {}),
  }
  if (modern) {
    options.allowInputRequired = true
    // The per-request envelope carries the client capabilities on
    // 2026-07-28, and a server only embeds an elicitation in `input_required`
    // for a client that declares it. Testnizer fulfils form elicitations by
    // asking the user (`mcpRespondInput`), so it declares form elicitation on
    // its modern tools/call requests — not on the Client itself, where a
    // 2025-era server would send `elicitation/create` requests no handler
    // answers. (User `_meta` keys win over the SDK's auto-attached envelope.)
    params = {
      ...params,
      _meta: {
        ...(params._meta ?? {}),
        [CLIENT_CAPABILITIES_META_KEY]: { elicitation: { form: {} } },
      },
    }
    const listed = conn.tools.get(params.name)
    if (listed && listed.outputSchema !== undefined) {
      const definition: Tool = { ...listed }
      delete definition.outputSchema
      options.toolDefinition = definition
    }
  }
  const result: unknown = await sdkCall(() =>
    conn.client.callTool(params as Parameters<Client['callTool']>[0], options),
  )
  if (isInputRequiredResult(result)) {
    const marker: McpInputRequiredMarker = {
      kind: 'input_required',
      inputRequests: plainJson((result.inputRequests ?? {}) as Record<string, unknown>),
      ...(typeof result.requestState === 'string' ? { requestState: result.requestState } : {}),
    }
    return { ...result, __mcp: marker }
  }
  return result
}

export async function mcpCallTool(
  connectionId: string,
  toolName: string,
  args: Record<string, unknown>,
  opts: McpCallOptions = {},
): Promise<unknown> {
  const conn = requireConnection(connectionId)
  return runCancellable(connectionId, opts.callId, (signal) =>
    runToolCall(conn, { name: toolName, arguments: args }, signal),
  )
}

/**
 * Answer an `input_required` `tools/call` result (2026-07-28 MRTR): re-issue
 * the call with the same name / arguments plus `inputResponses` (bare result
 * objects keyed by the server's `inputRequests` ids — e.g.
 * `{ count: { action: 'accept', content: { count: 3 } } }`) and the opaque
 * `requestState` echoed verbatim. Both ride TOP-LEVEL params, exactly as the
 * SDK's own auto-fulfilment driver sends them. May return another
 * `input_required` round.
 */
export async function mcpRespondInput(
  connectionId: string,
  toolName: string,
  args: Record<string, unknown>,
  requestState: string | undefined,
  inputResponses: Record<string, unknown> | undefined,
  opts: McpCallOptions = {},
): Promise<unknown> {
  const conn = requireConnection(connectionId)
  if (conn.client.getProtocolEra() !== 'modern') {
    throw new Error(
      `Input responses need a ${MCP_MODERN_PROTOCOL_VERSION} connection (this one negotiated ${conn.info.protocolVersion ?? 'a 2025-era version'})`,
    )
  }
  const hasResponses = !!inputResponses && Object.keys(inputResponses).length > 0
  if (!hasResponses && requestState === undefined) {
    throw new Error('Nothing to send: give inputResponses and/or the requestState to echo')
  }
  return runCancellable(connectionId, opts.callId, (signal) =>
    runToolCall(
      conn,
      {
        name: toolName,
        arguments: args,
        ...(hasResponses ? { inputResponses } : {}),
        ...(requestState !== undefined ? { requestState } : {}),
      },
      signal,
    ),
  )
}

/** Ids of the registered (open) connections — diagnostics and tests. */
export function mcpConnectionIds(): string[] {
  return [...connections.keys()]
}

export function mcpGetConnection(connectionId: string): McpConnectionInfo | undefined {
  return connections.get(connectionId)?.info
}

export function mcpDisconnectAll(): void {
  for (const [id] of connections) {
    mcpDisconnect(id).catch(() => {})
  }
}
