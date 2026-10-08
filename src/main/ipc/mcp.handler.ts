import { ipcMain } from 'electron'
import {
  mcpConnect,
  mcpDisconnect,
  mcpCancelConnect,
  mcpListTools,
  mcpCallTool,
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

export function registerMcpHandlers(): void {
  ipcMain.handle(
    'mcp:connect',
    async (
      _event,
      options: {
        transport: McpTransport
        url: string
        command?: string
        args?: string[]
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
            headerCount: loggedHeaders ? Object.keys(loggedHeaders).length : 0,
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
