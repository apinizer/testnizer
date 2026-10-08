import { ipcMain, BrowserWindow } from 'electron'
import {
  mcpConnect,
  mcpDisconnect,
  mcpCancelConnect,
  mcpListTools,
  mcpCallTool,
  mcpRespondInput,
  mcpListResources,
  mcpReadResource,
  mcpListPrompts,
  mcpGetPrompt,
  setMcpEventSink,
  type McpEngineEvent,
  type McpTransport,
} from '../protocols/mcp.engine'
// Pure module, not the engine: the handler tests mock `mcp.engine` wholesale.
import { parseMcpAuth } from '../protocols/mcp-auth'
import { logRequestResponse, logEvent } from '../lib/console-logger'
import * as historyRepo from '../db/history.repo'
import { maskSensitiveHeaders, MASKED_VALUE } from '../db/saved-response.repo'

/**
 * Gateway credentials rarely use the standard names (`X-Gateway-Token`,
 * `X-Client-Secret`, …) — the whole point of issue #137 — so on top of the
 * shared list below, any name that looks credential-bearing is masked too.
 */
const CREDENTIAL_NAME = /auth|token|secret|key|password|passwd|cookie|session|signature/i

/**
 * Console-safe view of the user's custom connect headers (issue #137): values
 * of credential-bearing names (Authorization, Cookie, X-API-Key, … — the same
 * list saved examples use, plus `CREDENTIAL_NAME`) are masked, so a Bearer
 * token typed into the MCP headers table never lands in the console log in
 * clear text.
 */
function consoleSafeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const masked = maskSensitiveHeaders(headers)
  if (!masked || Object.keys(masked).length === 0) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(masked)) {
    out[k] = CREDENTIAL_NAME.test(k) && v ? MASKED_VALUE : String(v ?? '')
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

// Track when each connection was opened so the disconnect log can carry the
// connection lifetime — useful for spotting servers that drop early or
// clients that linger.
const mcpContext = new Map<string, { url: string; connectedAt: number }>()

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
 * Transport errors are console-logged only. Handshake events are released one
 * macrotask after `mcp:connect` resolves (see `flushBuffered` in the engine),
 * so the renderer always knows the connectionId before its first frame.
 */
function handleEngineEvent(event: McpEngineEvent): void {
  switch (event.type) {
    case 'notification':
      broadcast('mcp:notification', event.payload)
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

interface ToolCallContext {
  workspaceId?: string
  projectId?: string
  endpointId?: string
}

/**
 * Shared envelope + console log + history row for `mcp:callTool` and
 * `mcp:respondInput`. An `input_required` result (issue #152) is a success
 * like any other — the renderer reads `__mcp.kind`.
 */
async function loggedToolCall(
  method: 'CALL_TOOL' | 'RESPOND_INPUT',
  connectionId: string,
  toolName: string,
  args: Record<string, unknown>,
  ctxOpts: ToolCallContext | undefined,
  run: () => Promise<unknown>,
  extraMeta?: Record<string, string | number | boolean>,
): Promise<{ success: true; data: unknown } | { success: false; error: string }> {
  const started = Date.now()
  const argsBody = JSON.stringify(args)
  const ctx = mcpContext.get(connectionId)
  const targetUrl = ctx ? `${ctx.url}/${toolName}` : `${connectionId}/${toolName}`
  try {
    const data = await run()
    const responseBody = JSON.stringify(data) ?? ''
    const durationMs = Date.now() - started
    const inputRequired =
      !!data &&
      typeof data === 'object' &&
      (data as { __mcp?: { kind?: unknown } }).__mcp?.kind === 'input_required'
    logRequestResponse({
      protocol: 'mcp',
      method,
      url: targetUrl,
      status: 0,
      statusText: inputRequired ? 'INPUT_REQUIRED' : 'OK',
      durationMs,
      sizeBytes: Buffer.byteLength(responseBody, 'utf-8'),
      requestBody: argsBody,
      responseBody,
      ...(extraMeta || inputRequired
        ? { meta: { ...(extraMeta ?? {}), ...(inputRequired ? { inputRequired: true } : {}) } }
        : {}),
    })
    try {
      historyRepo.addHistory({
        workspace_id: ctxOpts?.workspaceId,
        project_id: ctxOpts?.projectId,
        endpoint_id: ctxOpts?.endpointId,
        protocol: 'mcp',
        method,
        url: targetUrl,
        status_code: 0,
        duration_ms: durationMs,
        request_snapshot: JSON.stringify({
          connectionId,
          toolName,
          args,
          transport: 'unknown',
        }),
        response_snapshot: responseBody.length <= 500_000 ? responseBody : undefined,
      })
    } catch {
      // history failure is never fatal
    }
    return { success: true, data }
  } catch (e) {
    const err = e as Error
    const durationMs = Date.now() - started
    logRequestResponse({
      protocol: 'mcp',
      method,
      url: targetUrl,
      status: -1,
      statusText: err.message,
      durationMs,
      requestBody: argsBody,
      error: { message: err.message, stack: err.stack },
    })
    try {
      historyRepo.addHistory({
        workspace_id: ctxOpts?.workspaceId,
        project_id: ctxOpts?.projectId,
        endpoint_id: ctxOpts?.endpointId,
        protocol: 'mcp',
        method,
        url: targetUrl,
        status_code: -1,
        duration_ms: durationMs,
        request_snapshot: JSON.stringify({ connectionId, toolName, args }),
        response_snapshot: JSON.stringify({ error: err.message }),
      })
    } catch {
      /* ignore */
    }
    return { success: false, error: err.message }
  }
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
        _pendingId?: string
      },
    ) => {
      const started = Date.now()
      const loggedHeaders = consoleSafeHeaders(options.headers)
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
        mcpContext.set(data.connectionId, { url: options.url, connectedAt: Date.now() })
        logRequestResponse({
          protocol: 'mcp',
          method: 'CONNECT',
          url: options.url,
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
            // renderer's, so an api-key query param is not in it either.
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
          url: options.url,
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

  ipcMain.handle('mcp:readResource', async (_event, connectionId: string, uri: string) =>
    loggedCall(
      'READ_RESOURCE',
      uri,
      () => mcpReadResource(connectionId, uri),
      (data) => ({
        responseBody: JSON.stringify(data),
        meta: { contents: data.contents.length },
      }),
    ),
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
    async (_event, connectionId: string, name: string, args?: Record<string, string>) => {
      const ctx = mcpContext.get(connectionId)
      return loggedCall(
        'GET_PROMPT',
        ctx ? `${ctx.url}/${name}` : `${connectionId}/${name}`,
        () => mcpGetPrompt(connectionId, name, args ?? {}),
        (data) => ({
          responseBody: JSON.stringify(data),
          meta: { messages: data.messages.length },
        }),
        JSON.stringify(args ?? {}),
      )
    },
  )

  ipcMain.handle(
    'mcp:callTool',
    async (
      _event,
      connectionId: string,
      toolName: string,
      args: Record<string, unknown>,
      ctxOpts?: ToolCallContext,
    ) =>
      loggedToolCall('CALL_TOOL', connectionId, toolName, args, ctxOpts, () =>
        mcpCallTool(connectionId, toolName, args),
      ),
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
      ctxOpts?: ToolCallContext,
    ) =>
      loggedToolCall(
        'RESPOND_INPUT',
        connectionId,
        toolName,
        args,
        ctxOpts,
        () =>
          mcpRespondInput(
            connectionId,
            toolName,
            args ?? {},
            typeof requestState === 'string' ? requestState : undefined,
            inputResponses && typeof inputResponses === 'object' && !Array.isArray(inputResponses)
              ? (inputResponses as Record<string, unknown>)
              : undefined,
          ),
        // The responses are user input (form values) — log the keys only.
        {
          inputResponseKeys:
            inputResponses && typeof inputResponses === 'object'
              ? Object.keys(inputResponses).join(',')
              : '',
        },
      ),
  )
}
