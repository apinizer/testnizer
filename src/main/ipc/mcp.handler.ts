import { ipcMain, BrowserWindow } from 'electron'
import {
  mcpConnect,
  mcpDisconnect,
  mcpCancelConnect,
  mcpListTools,
  mcpCallTool,
  mcpCancelCall,
  mcpRespondElicitation,
  mcpRespondInput,
  mcpListResources,
  mcpReadResource,
  mcpListPrompts,
  mcpGetPrompt,
  setMcpEventSink,
  type McpElicitationResult,
  type McpEngineEvent,
  type McpTransport,
} from '../protocols/mcp.engine'
// Pure module, not the engine: the handler tests mock `mcp.engine` wholesale.
import { parseMcpAuth } from '../protocols/mcp-auth'
import { logRequestResponse, logEvent } from '../lib/console-logger'
import { trustStdioServer } from '../lib/mcp-stdio-trust'
import * as historyRepo from '../db/history.repo'
import { maskSensitiveHeaders, MASKED_VALUE } from '../db/saved-response.repo'
// Gateway credentials rarely use the standard names (`X-Gateway-Token`,
// `X-Client-Secret`, … — the whole point of issue #137): one broad name rule,
// shared with the OAuth debugger and the Security Scan evidence.
import { isCredentialHeaderName } from '../lib/credential-headers'
import {
  maskMcpArgs,
  mcpHistoryRequest,
  mcpSafeCommandLine,
  mcpSafeUrl,
  tokenizeCommandLine,
  type McpHistoryCapability,
  type McpHistoryRequest,
} from '../../shared/mcp-call'

/**
 * Console-safe view of the user's custom connect headers (issue #137): values
 * of credential-bearing names (Authorization, Cookie, X-API-Key, … — the same
 * list saved examples use, plus `isCredentialHeaderName`) are masked, so a
 * Bearer token typed into the MCP headers table never lands in the console log
 * in clear text.
 */
function consoleSafeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const masked = maskSensitiveHeaders(headers)
  if (!masked || Object.keys(masked).length === 0) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(masked)) {
    out[k] = isCredentialHeaderName(k) && v ? MASKED_VALUE : String(v ?? '')
  }
  return out
}

/**
 * True when a connect failure is an HTTP 401 (issue #141). SDK 2.x (issue
 * #152): Streamable HTTP and the `'auto'` negotiation probe throw
 * `SdkHttpError` with the status in `.status` (its `.code` is now a string
 * `SdkErrorCode`); the legacy SSE transport's `SseError` still carries the
 * EventSource status as a numeric `.code`; `UnauthorizedError` covers the
 * SDK's own auth paths. Duck-typed and local on purpose — the handler tests
 * mock the engine wholesale, and SDK error classes are brand-checked.
 */
function isUnauthorized(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; status?: unknown; name?: unknown }
  return e.status === 401 || e.code === 401 || e.name === 'UnauthorizedError'
}

/** `mcp:connect` `protocol` option: `auto` / `legacy` / a `YYYY-MM-DD` revision; anything else → default. */
function parseProtocolOption(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  if (value === 'auto' || value === 'legacy' || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return undefined
}

/**
 * Method of the engine's synthetic redirect-credential-drop notification
 * (issue #169). Spelled out here (not imported) because the handler tests
 * mock the engine wholesale.
 */
const REDIRECT_CREDENTIALS_DROPPED = 'notifications/testnizer/redirect_credentials_dropped'

interface McpConnectionContext {
  /**
   * URL every console / lifetime log of this connection shows: the server URL
   * without userinfo and with credential query values masked, or the masked
   * stdio command line — the same text as `target`. Never the raw URL.
   */
  url: string
  connectedAt: number
  transport: McpTransport
  /** History `url`: the server URL, or the stdio command line — credentials masked. */
  target: string
  /** The requested `protocol` option (`auto` when none was given). */
  protocol: string
  /**
   * History scope last passed with a call on this connection. A connection
   * belongs to one tab, so a call that comes without one (e.g. a resource
   * read from a renderer that passes only `callId`) is filed under it.
   */
  scope?: { workspaceId?: string; projectId?: string; endpointId?: string }
}

// Track when each connection was opened so the disconnect log can carry the
// connection lifetime — useful for spotting servers that drop early or
// clients that linger — plus what History needs to restore a call (issue #166).
const mcpContext = new Map<string, McpConnectionContext>()

// ─── History snapshot (issue #166) ──────────────────────────

function historyTarget(options: {
  transport: McpTransport
  url: string
  command?: string
  args?: string[]
}): string {
  if (options.transport !== 'stdio') return mcpSafeUrl(options.url)
  // Explicit `args` → `command` is one token; otherwise the line is split
  // quote-aware, like the shared `parseCommandLine` (a quoted path with a
  // space stays one token).
  const parts =
    options.command && Array.isArray(options.args)
      ? [options.command, ...options.args]
      : tokenizeCommandLine(options.command || options.url)
  return mcpSafeCommandLine(parts.filter((p) => typeof p === 'string'))
}

type McpCapability = McpHistoryCapability

interface CallTarget {
  capability: McpCapability
  name?: string
  args?: Record<string, unknown>
  uri?: string
}

/**
 * The restorable request of an MCP history row — the shared builder Run's
 * History rows use too (`src/shared/mcp-call.ts` `mcpHistoryRequest`). `ctx`
 * is the connection context snapshotted when the call STARTED: a connection
 * that drops mid-call is forgotten (`connectionClosed`) before the row is written.
 */
function historyRequest(
  ctx: McpConnectionContext | undefined,
  connectionId: string,
  target: CallTarget,
): McpHistoryRequest {
  return mcpHistoryRequest(
    {
      transport: ctx?.transport ?? 'unknown',
      url: ctx?.target ?? connectionId,
      protocol: ctx?.protocol ?? 'auto',
    },
    target,
    MASKED_VALUE,
  )
}

/** Push an MCP event to every live window (issue #139 — per-connection, never "the active tab"). */
function broadcast(channel: string, payload: unknown): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  } catch {
    // best-effort: a window mid-teardown must not break the transport
  }
}

/**
 * Engine → renderer bridge (issue #139). Channels:
 *   - `mcp:notification` `{ connectionId, ts, method, params? }` — every server notification
 *   - `mcp:frame`        `{ connectionId, ts, direction, message, truncated? }` — every JSON-RPC frame
 *   - `mcp:connectionClosed` `{ connectionId, reason? }` — transport closed / died
 *   - `mcp:subscriptionState` `{ connectionId, state, honoredFilter?, reason? }` —
 *     the 2026-07-28 `subscriptions/listen` stream opened / ended (issue #152)
 *   - `mcp:elicitation` `{ connectionId, elicitationId, serverName?, message,
 *     requestedSchema, mode }` — a 2025-era server asks for input (issue #168);
 *     answered through `mcp:respondElicitation`
 * Transport errors are console-logged only. Handshake events are released one
 * macrotask after `mcp:connect` resolves (see `flushBuffered` in the engine),
 * so the renderer always knows the connectionId before its first frame.
 */
function handleEngineEvent(event: McpEngineEvent): void {
  switch (event.type) {
    case 'notification': {
      broadcast('mcp:notification', event.payload)
      if (event.payload.method === REDIRECT_CREDENTIALS_DROPPED) {
        // Issue #169: names only — the engine never puts a value in params.
        const params = (event.payload.params ?? {}) as {
          from?: unknown
          to?: unknown
          headers?: unknown
        }
        const names = Array.isArray(params.headers) ? params.headers.map(String).join(', ') : ''
        logEvent({
          protocol: 'mcp',
          category: 'connection',
          level: 'warning',
          message: `MCP redirect from ${String(params.from)} to ${String(params.to)}: credential headers ${names} were not sent to the new origin`,
          url: mcpContext.get(event.payload.connectionId)?.url,
        })
      }
      return
    }
    case 'elicitation':
      broadcast('mcp:elicitation', event.payload)
      logEvent({
        protocol: 'mcp',
        category: 'event',
        message: `MCP server asks for input (${event.payload.connectionId}): ${event.payload.message}`,
        url: mcpContext.get(event.payload.connectionId)?.url,
        direction: 'in',
      })
      return
    case 'frame':
      broadcast('mcp:frame', event.payload)
      return
    case 'subscriptionState':
      broadcast('mcp:subscriptionState', event.payload)
      return
    case 'connectionClosed': {
      const { connectionId, reason } = event.payload
      broadcast('mcp:connectionClosed', event.payload)
      const ctx = mcpContext.get(connectionId)
      if (reason) {
        logEvent({
          protocol: 'mcp',
          category: 'connection',
          level: 'error',
          message: `MCP connection closed (${connectionId}): ${reason}`,
          url: ctx?.url,
          durationMs: ctx ? Date.now() - ctx.connectedAt : undefined,
          error: { message: reason },
        })
      }
      mcpContext.delete(connectionId)
      return
    }
    case 'transportError': {
      const ctx = mcpContext.get(event.payload.connectionId)
      logEvent({
        protocol: 'mcp',
        category: 'connection',
        level: 'warning',
        message: `MCP transport error (${event.payload.connectionId}): ${event.payload.message}`,
        url: ctx?.url,
      })
      return
    }
  }
}

/**
 * Shared envelope + console logging for the read-only MCP calls added in
 * issue #139 (resources / prompts). Mirrors the `mcp:listTools` shape.
 */
async function loggedCall<T>(
  method: string,
  url: string,
  run: () => Promise<T>,
  summarize: (data: T) => {
    responseBody: string
    meta?: Record<string, string | number | boolean>
  },
  requestBody?: string,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const started = Date.now()
  try {
    const data = await run()
    const { responseBody, meta } = summarize(data)
    logRequestResponse({
      protocol: 'mcp',
      method,
      url,
      status: 0,
      statusText: 'OK',
      durationMs: Date.now() - started,
      sizeBytes: Buffer.byteLength(responseBody, 'utf-8'),
      requestBody,
      responseBody,
      meta,
    })
    return { success: true, data }
  } catch (e) {
    const err = e as Error
    logRequestResponse({
      protocol: 'mcp',
      method,
      url,
      status: -1,
      statusText: err.message,
      durationMs: Date.now() - started,
      requestBody,
      error: { message: err.message, stack: err.stack },
    })
    return { success: false, error: err.message }
  }
}

/** History scope + cancel id the renderer passes with a call (issue #163 / #166). */
interface CallContext {
  workspaceId?: string
  projectId?: string
  endpointId?: string
  /** Renderer-chosen id `mcp:cancelCall` aborts this call by. */
  callId?: string
}

function contextOf(raw: unknown): CallContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
  return compactContext({
    workspaceId: str(r.workspaceId),
    projectId: str(r.projectId),
    endpointId: str(r.endpointId),
    callId: str(r.callId),
  })
}

function compactContext(ctx: CallContext): CallContext {
  const out: CallContext = {}
  for (const [k, v] of Object.entries(ctx) as Array<[keyof CallContext, string | undefined]>) {
    if (v !== undefined) out[k] = v
  }
  return out
}

/** `{ callId }` for the engine — only when the renderer gave one (keeps the engine call minimal). */
function callOpts(ctx: CallContext): [] | [{ callId: string }] {
  return ctx.callId ? [{ callId: ctx.callId }] : []
}

/** `timing` on every call reply (issue #164): wall time + byte size of the response JSON. */
interface McpCallTiming {
  durationMs: number
  sizeBytes: number
}

type McpCallReply =
  | { success: true; data: unknown; timing: McpCallTiming }
  | { success: false; error: string; cancelled?: true; timing: McpCallTiming }

/** A call `mcp:cancelCall` aborted (the engine's `McpCallCancelledError`) — duck-typed, the tests mock the engine. */
function isCancelled(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { cancelled?: unknown }).cancelled === true
}

interface LoggedCall {
  method: 'CALL_TOOL' | 'RESPOND_INPUT' | 'READ_RESOURCE' | 'GET_PROMPT'
  connectionId: string
  /** Console log url (unchanged per call kind). */
  consoleUrl: string
  requestBody?: string
  target: CallTarget
  ctx: CallContext
  run: () => Promise<unknown>
  /** Console status text + meta for a successful result. */
  describe?: (data: unknown) => {
    statusText?: string
    meta?: Record<string, string | number | boolean>
  }
  extraMeta?: Record<string, string | number | boolean>
}

/**
 * Shared envelope + console log + history row for the four MCP calls
 * (`mcp:callTool`, `mcp:respondInput`, `mcp:readResource`, `mcp:getPrompt`).
 * Every reply carries `timing` (issue #164); a user cancel replies
 * `cancelled: true` (issue #163); every call — success, failure or cancel —
 * is a History row with a restorable `{ mcp: … }` request (issue #166). An
 * `input_required` result (issue #152) is a success like any other — the
 * renderer reads `__mcp.kind`.
 */
async function loggedMcpCall(call: LoggedCall): Promise<McpCallReply> {
  const started = Date.now()
  // Snapshot of the connection AT CALL START (target, transport, protocol,
  // scope): `connectionClosed` deletes the context while a call may still be
  // running, and the History row is written after the await.
  const conn = mcpContext.get(call.connectionId)
  const connAtStart = conn ? { ...conn } : undefined
  const given = call.ctx.workspaceId || call.ctx.projectId || call.ctx.endpointId
  if (conn && given) {
    conn.scope = compactContext({
      workspaceId: call.ctx.workspaceId,
      projectId: call.ctx.projectId,
      endpointId: call.ctx.endpointId,
    })
  }
  const scope = given ? call.ctx : (connAtStart?.scope ?? {})
  const history = (
    statusCode: number,
    responseSnapshot: string | undefined,
    durationMs: number,
  ): void => {
    try {
      historyRepo.addHistory({
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        endpoint_id: scope.endpointId,
        protocol: 'mcp',
        method: call.method,
        url: connAtStart?.target ?? call.connectionId,
        status_code: statusCode,
        duration_ms: durationMs,
        request_snapshot: JSON.stringify({
          mcp: historyRequest(connAtStart, call.connectionId, call.target),
        }),
        response_snapshot: responseSnapshot,
      })
    } catch {
      // history failure is never fatal
    }
  }
  try {
    const data = await call.run()
    const responseBody = JSON.stringify(data) ?? ''
    const durationMs = Date.now() - started
    const sizeBytes = Buffer.byteLength(responseBody, 'utf-8')
    const described = call.describe?.(data) ?? {}
    const meta =
      call.extraMeta || described.meta
        ? { ...(call.extraMeta ?? {}), ...(described.meta ?? {}) }
        : undefined
    logRequestResponse({
      protocol: 'mcp',
      method: call.method,
      url: call.consoleUrl,
      status: 0,
      statusText: described.statusText ?? 'OK',
      durationMs,
      sizeBytes,
      requestBody: call.requestBody,
      responseBody,
      ...(meta ? { meta } : {}),
    })
    history(0, responseBody.length <= 500_000 ? responseBody : undefined, durationMs)
    return { success: true, data, timing: { durationMs, sizeBytes } }
  } catch (e) {
    const err = e as Error
    const cancelled = isCancelled(e)
    const durationMs = Date.now() - started
    logRequestResponse({
      protocol: 'mcp',
      method: call.method,
      url: call.consoleUrl,
      status: -1,
      statusText: err.message,
      durationMs,
      requestBody: call.requestBody,
      error: { message: err.message, stack: err.stack },
      ...(cancelled ? { meta: { cancelled: true } } : {}),
    })
    history(
      -1,
      JSON.stringify(cancelled ? { error: err.message, cancelled: true } : { error: err.message }),
      durationMs,
    )
    const timing = { durationMs, sizeBytes: 0 }
    return cancelled
      ? { success: false, error: err.message, cancelled: true, timing }
      : { success: false, error: err.message, timing }
  }
}

function isInputRequired(data: unknown): boolean {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as { __mcp?: { kind?: unknown } }).__mcp?.kind === 'input_required'
  )
}

const describeToolResult = (
  data: unknown,
): { statusText?: string; meta?: Record<string, string | number | boolean> } =>
  isInputRequired(data) ? { statusText: 'INPUT_REQUIRED', meta: { inputRequired: true } } : {}

/** Console request body of a tool / prompt call: credential-named args masked (History's rule). */
function consoleArgs(args: unknown): string {
  return JSON.stringify(maskMcpArgs(args ?? {}, MASKED_VALUE)) ?? '{}'
}

function toolConsoleUrl(connectionId: string, toolName: string): string {
  const ctx = mcpContext.get(connectionId)
  return ctx ? `${ctx.url}/${toolName}` : `${connectionId}/${toolName}`
}

export function registerMcpHandlers(): void {
  setMcpEventSink(handleEngineEvent)

  ipcMain.handle(
    'mcp:connect',
    async (
      _event,
      options: {
        transport: McpTransport
        url: string
        command?: string
        args?: string[]
        /** Extra env for the stdio server process, merged over the safe default env (issue #139). */
        env?: Record<string, string>
        /** Custom HTTP headers for http / sse transports (issue #137). */
        headers?: Record<string, string>
        /** Authorization tab (basic / bearer / API key), `{{var}}`-resolved. */
        auth?: unknown
        /** OAuth 2.1 debugger session whose token authenticates the connection (issue #141). */
        oauthSessionId?: string
        /** Protocol era negotiation: `auto` (default) / `legacy` / a pinned revision (issue #152). */
        protocol?: unknown
        /**
         * Project of the tab that connects. A stdio server connected here (the
         * user's explicit Connect) becomes trusted for runs of that project on
         * this computer (`lib/mcp-stdio-trust.ts`).
         */
        projectId?: unknown
        _pendingId?: string
      },
    ) => {
      const started = Date.now()
      const loggedHeaders = consoleSafeHeaders(options.headers)
      // Console / History text of this server: no userinfo, credential query
      // values and stdio credential flags masked (the raw URL never logs).
      const target = historyTarget(options)
      const auth = options.transport === 'stdio' ? undefined : parseMcpAuth(options.auth)
      const protocol = parseProtocolOption(options.protocol)
      try {
        const data = await mcpConnect({
          transport: options.transport,
          url: options.url,
          command: options.command,
          args: options.args,
          env: options.env,
          headers: options.headers,
          ...(auth ? { auth } : {}),
          pendingId: options._pendingId,
          ...(typeof options.oauthSessionId === 'string' && options.oauthSessionId
            ? { oauthSessionId: options.oauthSessionId }
            : {}),
          ...(protocol ? { protocol } : {}),
        })
        if (options.transport === 'stdio') {
          // The user ran this command line from its tab — runs may now too.
          await trustStdioServer({
            projectId: typeof options.projectId === 'string' ? options.projectId : undefined,
            command: options.command,
            args: options.args,
            url: options.url,
            env: options.env,
          })
        }
        mcpContext.set(data.connectionId, {
          url: target,
          connectedAt: Date.now(),
          transport: options.transport,
          target,
          protocol: protocol ?? 'auto',
        })
        logRequestResponse({
          protocol: 'mcp',
          method: 'CONNECT',
          url: target,
          status: 0,
          statusText: 'OK',
          durationMs: Date.now() - started,
          requestHeaders: loggedHeaders,
          responseBody: JSON.stringify(data),
          meta: {
            serverName: data.serverName ?? 'unknown',
            serverVersion: data.serverVersion ?? 'unknown',
            transport: options.transport,
            protocolVersion: data.protocolVersion ?? 'unknown',
            // issue #152: the era actually negotiated, and what was asked for.
            era: data.era ?? 'unknown',
            protocolRequested: protocol ?? 'auto',
            headerCount: loggedHeaders ? Object.keys(loggedHeaders).length : 0,
            // Whether an OAuth session was used — never the token itself.
            oauth: !!options.oauthSessionId,
            // Authorization tab: the type (and api-key placement) only — never
            // a username, password, token or key value. The logged url is the
            // masked target, so an api-key query param is not in it either.
            authType: auth?.type ?? 'none',
            ...(auth?.type === 'api-key' ? { authIn: auth.apiKey?.in ?? 'header' } : {}),
            // stdio env values routinely carry API tokens — count only, never values.
            envCount: options.env ? Object.keys(options.env).length : 0,
          },
        })
        return { success: true, data }
      } catch (e) {
        const err = e as Error
        logRequestResponse({
          protocol: 'mcp',
          method: 'CONNECT',
          url: target,
          status: -1,
          statusText: err.message,
          durationMs: Date.now() - started,
          requestHeaders: loggedHeaders,
          error: { message: err.message, stack: err.stack },
        })
        // `unauthorized` lets the renderer offer the OAuth 2.1 debugger (issue #141).
        return isUnauthorized(e)
          ? { success: false, error: err.message, unauthorized: true }
          : { success: false, error: err.message }
      }
    },
  )

  ipcMain.handle('mcp:cancelConnect', async (_event, pendingId: string) => {
    const ok = await mcpCancelConnect(pendingId)
    if (ok) {
      logEvent({
        protocol: 'mcp',
        category: 'connection',
        message: 'MCP handshake cancelled by user',
      })
    }
    return { success: true, data: { canceled: ok } }
  })

  ipcMain.handle('mcp:disconnect', async (_event, connectionId: string) => {
    try {
      const ctx = mcpContext.get(connectionId)
      await mcpDisconnect(connectionId)
      logEvent({
        protocol: 'mcp',
        category: 'connection',
        message: `MCP disconnected (${connectionId})`,
        url: ctx?.url,
        direction: 'out',
        durationMs: ctx ? Date.now() - ctx.connectedAt : undefined,
      })
      mcpContext.delete(connectionId)
      return { success: true, data: true }
    } catch (e) {
      const err = e as Error
      logEvent({
        protocol: 'mcp',
        category: 'connection',
        message: `MCP disconnect failed: ${err.message}`,
        error: { message: err.message },
      })
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('mcp:listTools', async (_event, connectionId: string) => {
    const started = Date.now()
    try {
      const data = await mcpListTools(connectionId)
      logRequestResponse({
        protocol: 'mcp',
        method: 'LIST_TOOLS',
        url: connectionId,
        status: 0,
        statusText: 'OK',
        durationMs: Date.now() - started,
        responseBody: JSON.stringify(data.map((t) => t.name)),
        meta: { count: data.length },
      })
      return { success: true, data }
    } catch (e) {
      const err = e as Error
      logRequestResponse({
        protocol: 'mcp',
        method: 'LIST_TOOLS',
        url: connectionId,
        status: -1,
        statusText: err.message,
        durationMs: Date.now() - started,
        error: { message: err.message, stack: err.stack },
      })
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('mcp:listResources', async (_event, connectionId: string) =>
    loggedCall(
      'LIST_RESOURCES',
      mcpContext.get(connectionId)?.url ?? connectionId,
      () => mcpListResources(connectionId),
      (data) => ({
        responseBody: JSON.stringify({
          resources: data.resources.map((r) => r.uri),
          templates: data.templates.map((t) => t.uriTemplate),
        }),
        meta: { resources: data.resources.length, templates: data.templates.length },
      }),
    ),
  )

  ipcMain.handle(
    'mcp:readResource',
    async (_event, connectionId: string, uri: string, opts?: unknown) => {
      const ctx = contextOf(opts)
      return loggedMcpCall({
        method: 'READ_RESOURCE',
        connectionId,
        consoleUrl: uri,
        target: { capability: 'resource', uri },
        ctx,
        run: () => mcpReadResource(connectionId, uri, ...callOpts(ctx)),
        describe: (data) => ({
          meta: { contents: (data as { contents: unknown[] }).contents?.length ?? 0 },
        }),
      })
    },
  )

  ipcMain.handle('mcp:listPrompts', async (_event, connectionId: string) =>
    loggedCall(
      'LIST_PROMPTS',
      mcpContext.get(connectionId)?.url ?? connectionId,
      () => mcpListPrompts(connectionId),
      (data) => ({
        responseBody: JSON.stringify(data.map((p) => p.name)),
        meta: { count: data.length },
      }),
    ),
  )

  ipcMain.handle(
    'mcp:getPrompt',
    async (
      _event,
      connectionId: string,
      name: string,
      args?: Record<string, string>,
      opts?: unknown,
    ) => {
      const ctx = contextOf(opts)
      const ctxInfo = mcpContext.get(connectionId)
      return loggedMcpCall({
        method: 'GET_PROMPT',
        connectionId,
        consoleUrl: ctxInfo ? `${ctxInfo.url}/${name}` : `${connectionId}/${name}`,
        requestBody: consoleArgs(args),
        target: { capability: 'prompt', name, args: args ?? {} },
        ctx,
        run: () => mcpGetPrompt(connectionId, name, args ?? {}, ...callOpts(ctx)),
        describe: (data) => ({
          meta: { messages: (data as { messages: unknown[] }).messages?.length ?? 0 },
        }),
      })
    },
  )

  ipcMain.handle(
    'mcp:callTool',
    async (
      _event,
      connectionId: string,
      toolName: string,
      args: Record<string, unknown>,
      ctxOpts?: unknown,
    ) => {
      const ctx = contextOf(ctxOpts)
      return loggedMcpCall({
        method: 'CALL_TOOL',
        connectionId,
        consoleUrl: toolConsoleUrl(connectionId, toolName),
        requestBody: consoleArgs(args),
        target: { capability: 'tool', name: toolName, args: args ?? {} },
        ctx,
        run: () => mcpCallTool(connectionId, toolName, args, ...callOpts(ctx)),
        describe: describeToolResult,
      })
    },
  )

  /**
   * Cancel a running call (issue #163) by the `callId` the renderer passed to
   * `mcp:callTool` / `mcp:respondInput` / `mcp:readResource` /
   * `mcp:getPrompt`. That call's own reply then resolves
   * `{ success: false, error: 'MCP call cancelled by user', cancelled: true }`;
   * the connection stays open. `cancelled: false` when nothing was running.
   */
  ipcMain.handle('mcp:cancelCall', async (_event, connectionId: unknown, callId: unknown) => {
    try {
      const cancelled =
        typeof connectionId === 'string' && typeof callId === 'string' && callId !== ''
          ? mcpCancelCall(connectionId, callId)
          : false
      if (cancelled) {
        logEvent({
          protocol: 'mcp',
          category: 'event',
          level: 'warning',
          message: `MCP call cancelled by user (${String(callId)})`,
          url: mcpContext.get(String(connectionId))?.url,
          direction: 'out',
        })
      }
      return { success: true, data: { cancelled } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  /**
   * Answer a 2025-era server's `elicitation/create` (issue #168), delivered
   * to the renderer as `mcp:elicitation`. Only the action is logged — never
   * the form values.
   */
  ipcMain.handle(
    'mcp:respondElicitation',
    async (_event, connectionId: unknown, elicitationId: unknown, result: unknown) => {
      try {
        if (typeof connectionId !== 'string' || typeof elicitationId !== 'string') {
          throw new Error('connectionId and elicitationId are required')
        }
        mcpRespondElicitation(connectionId, elicitationId, result as McpElicitationResult)
        const action =
          result && typeof result === 'object'
            ? String((result as { action?: unknown }).action)
            : ''
        logEvent({
          protocol: 'mcp',
          category: 'event',
          message: `MCP elicitation ${elicitationId} answered: ${action}`,
          url: mcpContext.get(connectionId)?.url,
          direction: 'out',
        })
        return { success: true }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  /**
   * Answer an `input_required` tools/call result (2026-07-28 multi-round-trip,
   * issue #152): the same call again with `inputResponses` + the echoed
   * `requestState`. Same envelope as `mcp:callTool` — the result may be
   * complete or another `input_required` round (`__mcp.kind`).
   */
  ipcMain.handle(
    'mcp:respondInput',
    async (
      _event,
      connectionId: string,
      toolName: string,
      args: Record<string, unknown>,
      requestState: unknown,
      inputResponses: unknown,
      ctxOpts?: unknown,
    ) => {
      const ctx = contextOf(ctxOpts)
      return loggedMcpCall({
        method: 'RESPOND_INPUT',
        connectionId,
        consoleUrl: toolConsoleUrl(connectionId, toolName),
        requestBody: consoleArgs(args),
        // The restorable request is the tool call itself — the form answers
        // of this round are not part of it.
        target: { capability: 'tool', name: toolName, args: args ?? {} },
        ctx,
        run: () =>
          mcpRespondInput(
            connectionId,
            toolName,
            args ?? {},
            typeof requestState === 'string' ? requestState : undefined,
            inputResponses && typeof inputResponses === 'object' && !Array.isArray(inputResponses)
              ? (inputResponses as Record<string, unknown>)
              : undefined,
            ...callOpts(ctx),
          ),
        describe: describeToolResult,
        // The responses are user input (form values) — log the keys only.
        extraMeta: {
          inputResponseKeys:
            inputResponses && typeof inputResponses === 'object'
              ? Object.keys(inputResponses).join(',')
              : '',
        },
      })
    },
  )
}
