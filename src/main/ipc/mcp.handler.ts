import { ipcMain, BrowserWindow } from 'electron'
import {
  mcpConnect,
  mcpDisconnect,
  mcpCancelConnect,
  mcpListTools,
  mcpCallTool,
  mcpListResources,
  mcpReadResource,
  mcpListPrompts,
  mcpGetPrompt,
  setMcpEventSink,
  type McpEngineEvent,
  type McpTransport,
} from '../protocols/mcp.engine'
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
        _pendingId?: string
      },
    ) => {
      const started = Date.now()
      const loggedHeaders = consoleSafeHeaders(options.headers)
      try {
        const data = await mcpConnect({
          transport: options.transport,
          url: options.url,
          command: options.command,
          args: options.args,
          env: options.env,
          headers: options.headers,
          pendingId: options._pendingId,
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
            headerCount: loggedHeaders ? Object.keys(loggedHeaders).length : 0,
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
        return { success: false, error: err.message }
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
      ctxOpts?: { workspaceId?: string; projectId?: string; endpointId?: string },
    ) => {
      const started = Date.now()
      const argsBody = JSON.stringify(args)
      const ctx = mcpContext.get(connectionId)
      const targetUrl = ctx ? `${ctx.url}/${toolName}` : `${connectionId}/${toolName}`
      try {
        const data = await mcpCallTool(connectionId, toolName, args)
        const responseBody = JSON.stringify(data)
        const durationMs = Date.now() - started
        logRequestResponse({
          protocol: 'mcp',
          method: 'CALL_TOOL',
          url: targetUrl,
          status: 0,
          statusText: 'OK',
          durationMs,
          sizeBytes: Buffer.byteLength(responseBody, 'utf-8'),
          requestBody: argsBody,
          responseBody,
        })
        try {
          historyRepo.addHistory({
            workspace_id: ctxOpts?.workspaceId,
            project_id: ctxOpts?.projectId,
            endpoint_id: ctxOpts?.endpointId,
            protocol: 'mcp',
            method: 'CALL_TOOL',
            url: targetUrl,
            status_code: 0,
            duration_ms: durationMs,
            request_snapshot: JSON.stringify({
              connectionId,
              toolName,
              args,
              transport: ctx ? 'unknown' : 'unknown',
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
          method: 'CALL_TOOL',
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
            method: 'CALL_TOOL',
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
    },
  )
}
