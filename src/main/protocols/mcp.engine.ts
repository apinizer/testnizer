import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { createMcpOAuthFetch } from './mcp-oauth.engine'

export type McpTransport = 'http' | 'sse' | 'stdio'

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

export interface McpConnectionInfo {
  connectionId: string
  transport: McpTransport
  url: string
  serverName?: string
  serverVersion?: string
  /** Negotiated MCP protocol version (from the `initialize` result). */
  protocolVersion?: string
  /** `client.getServerCapabilities()` as plain JSON. */
  capabilities?: Record<string, unknown>
  /** Server-supplied usage instructions from the `initialize` result. */
  instructions?: string
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

export type McpEngineEvent =
  | { type: 'notification'; payload: McpNotificationEvent }
  | { type: 'frame'; payload: McpFrameEvent }
  | { type: 'connectionClosed'; payload: McpConnectionClosedEvent }
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

/** Pagination guard for every list call (issue #139). */
const MAX_PAGES = 50
const MAX_ITEMS = 2000
/** Frames bigger than this (serialised chars) are summarised, not shipped whole. */
const MAX_FRAME_CHARS = 1_000_000
const FRAME_PREVIEW_CHARS = 2048
/** JSON-RPC "Method not found". */
const METHOD_NOT_FOUND = -32601

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
  closedByClient: boolean
  closeEmitted: boolean
  /** Last transport error; cleared whenever an inbound frame proves the link alive. */
  lastError?: string
  initializeId?: string | number
  negotiatedProtocolVersion?: string
}

interface Connection {
  client: Client
  info: McpConnectionInfo
  state: WireState
}

const connections = new Map<string, Connection>()
/**
 * In-flight MCP handshakes keyed by the renderer-supplied pendingId. The
 * value is a teardown closure that closes the transport so the in-flight
 * `client.connect()` rejects. Removed once the connection opens or fails.
 */
const pendingConnects = new Map<string, () => Promise<void>>()
let nextId = 1

function makeId(): string {
  return `mcp-${nextId++}-${Date.now()}`
}

function emit(state: WireState, event: McpEngineEvent): void {
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

function frameMessage(message: JSONRPCMessage): { message: unknown; truncated?: boolean } {
  let serialised: string
  try {
    serialised = JSON.stringify(message)
  } catch {
    return { message }
  }
  if (serialised.length <= MAX_FRAME_CHARS) return { message }
  const m = message as Record<string, unknown>
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

function recordFrame(state: WireState, direction: 'in' | 'out', message: JSONRPCMessage): void {
  const ts = Date.now()
  const m = message as Record<string, unknown>
  const hasId = 'id' in m && m.id !== undefined && m.id !== null
  const method = typeof m.method === 'string' ? m.method : undefined

  // The Client does not keep the negotiated protocol version (SDK 1.29
  // client/index.js:298-317 stores only capabilities / serverInfo /
  // instructions), and only Streamable HTTP exposes it afterwards — so the
  // `initialize` round-trip seen here is the source for sse / stdio.
  if (direction === 'out' && method === 'initialize' && hasId) {
    state.initializeId = m.id as string | number
  } else if (
    direction === 'in' &&
    hasId &&
    state.initializeId !== undefined &&
    m.id === state.initializeId &&
    isObject(m.result) &&
    typeof m.result.protocolVersion === 'string'
  ) {
    state.negotiatedProtocolVersion = m.result.protocolVersion
  }
  if (direction === 'in') state.lastError = undefined

  emit(state, {
    type: 'frame',
    payload: { connectionId: state.connectionId, ts, direction, ...frameMessage(message) },
  })
  // Every inbound JSON-RPC notification (method, no id). Derived from the
  // frame tap rather than `client.fallbackNotificationHandler`: the SDK's
  // Protocol constructor pre-registers `notifications/cancelled` and
  // `notifications/progress` (shared/protocol.js:31-36), which shadow the
  // fallback, and replacing the progress handler would break the SDK's own
  // progress / timeout bookkeeping (`_onprogress` is private).
  if (direction === 'in' && method && !hasId) {
    emit(state, {
      type: 'notification',
      payload: {
        connectionId: state.connectionId,
        ts,
        method,
        ...('params' in m ? { params: m.params } : {}),
      },
    })
  }
}

/**
 * A transport error the connection cannot recover from:
 *  - legacy SSE: `SseError` carrying an HTTP status — eventsource@3 only
 *    passes a code from `failConnection` (non-200 / 204 / wrong content
 *    type), after which it is CLOSED and never reconnects; network drops
 *    arrive code-less and are retried by eventsource itself.
 *  - Streamable HTTP: the standalone GET stream gave up reconnecting
 *    (streamableHttp.js:147). Per-request POST failures also surface as
 *    `onerror` there (:417, :457) — those are NOT terminal.
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
  const conn = connections.get(state.connectionId)
  if (conn && conn.state === state) connections.delete(state.connectionId)
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
  // Consecutive identical errors (e.g. an SSE reconnect loop against a dead
  // server) are reported once.
  if (message !== state.lastError) {
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
 * Wire the frame tap BEFORE `client.connect()`. `Protocol.connect`
 * (shared/protocol.js:224-245) chains any `onmessage` / `onclose` /
 * `onerror` already on the transport instead of dropping them, so the
 * `initialize` request + result are captured too. `send` is wrapped as an
 * own property, shadowing the prototype method Protocol calls.
 */
function tapTransport(transport: Transport, state: WireState): void {
  if (typeof transport.send === 'function') {
    const originalSend = transport.send.bind(transport)
    transport.send = (message, options) => {
      // Recorded before the send: on Streamable HTTP a JSON response is
      // delivered through onmessage while send() is still pending.
      recordFrame(state, 'out', message)
      return originalSend(message, options)
    }
  }
  transport.onmessage = (message: JSONRPCMessage) => recordFrame(state, 'in', message)
  transport.onclose = () => handleClose(state)
  transport.onerror = (err: Error) => handleError(state, err)
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
   * Renderer-supplied id so `mcpCancelConnect(id)` can abort the handshake
   * before `client.connect()` resolves. Cleared once the connection opens
   * or fails.
   */
  pendingId?: string
  /**
   * OAuth 2.1 session from the debugger (issue #141). Its access token is put
   * on every http / sse request by `createMcpOAuthFetch` — after the user's
   * headers, so the token wins — and refreshed once on a 401. The renderer
   * never sees the token. Ignored for `stdio`.
   */
  oauthSessionId?: string
}): Promise<McpConnectionInfo> {
  const connectionId = makeId()
  const client = new Client({ name: 'Testnizer', version: '1.0.0' })

  let transport: StreamableHTTPClientTransport | SSEClientTransport | StdioClientTransport

  // @modelcontextprotocol/sdk@1.29.0: both HTTP transports merge
  // `requestInit.headers` in `_commonHeaders()` (dist/cjs/client/sse.js:54-69,
  // streamableHttp.js:62-81), which feeds EVERY wire request — the SSE GET
  // EventSource stream (sse.js:77 inside its `fetch` wrapper), the SSE POSTs
  // (sse.js:168), and Streamable HTTP GET/POST/DELETE (streamableHttp.js:87,
  // :300, :440). So no `eventSourceInit.fetch` wrapper is needed on this SDK
  // version (older SDKs applied requestInit to POST only). User headers are
  // spread last there, so they override the SDK's own Authorization /
  // session headers on a name clash — intended: the user's row wins.
  const headers =
    options.headers && Object.keys(options.headers).length > 0 ? options.headers : undefined
  // OAuth (issue #141): a custom `fetch` rather than the SDK's `authProvider`.
  // With an authProvider the SDK spreads `requestInit.headers` AFTER the
  // token (`_commonHeaders`), so a user `Authorization` row would beat it,
  // and a 401 re-runs the whole `auth()` orchestrator (browser redirect
  // mid-connect). The fetch reaches every wire request of both transports
  // (streamableHttp `_fetch`; sse `eventSourceInit.fetch ?? _fetch`).
  const oauthFetch =
    options.oauthSessionId && options.transport !== 'stdio'
      ? createMcpOAuthFetch(options.oauthSessionId)
      : undefined
  const httpOpts =
    headers || oauthFetch
      ? {
          ...(headers ? { requestInit: { headers } } : {}),
          ...(oauthFetch ? { fetch: oauthFetch } : {}),
        }
      : undefined

  if (options.transport === 'http') {
    transport = new StreamableHTTPClientTransport(new URL(options.url), httpOpts)
  } else if (options.transport === 'sse') {
    transport = new SSEClientTransport(new URL(options.url), httpOpts)
  } else {
    // stdio. With explicit `args` the caller already tokenised the command
    // line (the renderer's quote-aware `parseCommandLine`), so `command` is
    // the executable VERBATIM — a path with spaces must not be split again.
    // Without `args`, `command` (or the url field) is a whole command line,
    // split on whitespace as before.
    const verbatim = !!options.command && options.args !== undefined
    const cmd = options.command || options.url
    const parts = verbatim ? [cmd] : cmd.split(/\s+/)
    // SDK 1.29's start() already spreads getDefaultEnvironment() under the
    // given env (stdio.js:72-75); older SDKs used `env ?? default`, where a
    // user env REPLACED the inherited PATH/HOME and broke `npx`. Merge here
    // explicitly so neither an SDK bump nor a user env row can do that.
    const env =
      options.env && Object.keys(options.env).length > 0
        ? { ...getDefaultEnvironment(), ...options.env }
        : undefined
    transport = new StdioClientTransport({
      command: parts[0],
      args: [...parts.slice(1), ...(options.args ?? [])],
      env,
    })
  }

  const state: WireState = {
    connectionId,
    kind: options.transport,
    established: false,
    buffering: true,
    buffer: [],
    closedByClient: false,
    closeEmitted: false,
  }
  tapTransport(transport, state)

  // Register before the connect() promise so a fast cancel still finds the
  // entry. Teardown calls transport.close() — this is what causes
  // `client.connect()` to reject for HTTP / SSE / stdio transports.
  if (options.pendingId) {
    pendingConnects.set(options.pendingId, async () => {
      try {
        await transport.close()
      } catch {
        // Best-effort: socket may already be torn down.
      }
    })
  }

  try {
    await client.connect(transport)
  } catch (err) {
    if (options.pendingId) pendingConnects.delete(options.pendingId)
    state.buffer = []
    throw err
  }

  if (options.pendingId) pendingConnects.delete(options.pendingId)

  const serverInfo = client.getServerVersion()
  const capabilities = client.getServerCapabilities()
  const instructions = client.getInstructions()
  const transportVersion =
    options.transport === 'http'
      ? (transport as StreamableHTTPClientTransport).protocolVersion
      : undefined
  const protocolVersion = transportVersion ?? state.negotiatedProtocolVersion
  const info: McpConnectionInfo = {
    connectionId,
    transport: options.transport,
    url: options.url,
    serverName: serverInfo?.name,
    serverVersion: serverInfo?.version,
    ...(protocolVersion ? { protocolVersion } : {}),
    ...(capabilities
      ? { capabilities: JSON.parse(JSON.stringify(capabilities)) as Record<string, unknown> }
      : {}),
    ...(typeof instructions === 'string' && instructions ? { instructions } : {}),
  }

  connections.set(connectionId, { client, info, state })
  state.established = true
  // One macrotask later: the IPC reply carrying `connectionId` is posted from
  // the microtask chain that resolves this promise, so it reaches the
  // renderer before the buffered handshake frames do.
  setTimeout(() => flushBuffered(state), 0)
  return info
}

/**
 * Abort an in-flight `mcpConnect()`. Returns true when a pending handshake
 * was found and the underlying transport torn down. The original `mcpConnect`
 * promise will reject through the existing error path.
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
  try {
    await conn.client.close()
  } catch {
    /* ignore */
  }
}

function requireConnection(connectionId: string): Connection {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('Not connected')
  return conn
}

// ─── Lists (paginated) ──────────────────────────────────────

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

export async function mcpListTools(connectionId: string): Promise<McpTool[]> {
  const { client } = requireConnection(connectionId)
  // Note: the SDK caches tool output-schema validators per listTools() page
  // (cacheToolMetadata clears first), so on a multi-page server only the last
  // page's tools get client-side structuredContent validation. Previously
  // only the first page was listed at all.
  return collectPages(async (cursor) => {
    const res = await client.listTools(cursor ? { cursor } : undefined)
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
  })
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
      const res = await client.listResources(cursor ? { cursor } : undefined)
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
    if (!isMethodNotFound(err)) throw err
  }

  let templates: McpResourceTemplate[] = []
  try {
    templates = await collectPages(async (cursor) => {
      const res = await client.listResourceTemplates(cursor ? { cursor } : undefined)
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
    if (!isMethodNotFound(err)) throw err
  }

  return { resources, templates }
}

export async function mcpReadResource(
  connectionId: string,
  uri: string,
): Promise<McpReadResourceResult> {
  const { client } = requireConnection(connectionId)
  const res = await client.readResource({ uri })
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
      const res = await client.listPrompts(cursor ? { cursor } : undefined)
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
    throw err
  }
}

export async function mcpGetPrompt(
  connectionId: string,
  name: string,
  args: Record<string, string> = {},
): Promise<McpGetPromptResult> {
  const { client } = requireConnection(connectionId)
  // prompts/get arguments are string-valued per spec; coerce defensively and
  // drop empty slots rather than sending "undefined".
  const promptArgs: Record<string, string> = {}
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined || v === null) continue
    promptArgs[k] = String(v)
  }
  const res = await client.getPrompt({ name, arguments: promptArgs })
  return compact<McpGetPromptResult>({
    description: res.description,
    messages: res.messages.map((m) => ({ role: m.role, content: m.content })),
  })
}

export async function mcpCallTool(
  connectionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { client } = requireConnection(connectionId)
  // `onprogress` makes the SDK attach `_meta.progressToken`, which is what
  // allows a server to emit `notifications/progress` for this call at all
  // (they reach the renderer through the frame tap as `mcp:notification`).
  // Progress also resets the SDK's 60 s request timeout, so long-running
  // tools that report progress are not cut off.
  const result = await client.callTool({ name: toolName, arguments: args }, undefined, {
    onprogress: () => {},
    resetTimeoutOnProgress: true,
  })
  return result
}

export function mcpGetConnection(connectionId: string): McpConnectionInfo | undefined {
  return connections.get(connectionId)?.info
}

export function mcpDisconnectAll(): void {
  for (const [id] of connections) {
    mcpDisconnect(id).catch(() => {})
  }
}
