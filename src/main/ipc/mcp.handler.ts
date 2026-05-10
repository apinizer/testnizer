import { ipcMain } from 'electron'
import {
  mcpConnect,
  mcpDisconnect,
  mcpListTools,
  mcpCallTool,
  type McpTransport,
} from '../protocols/mcp.engine'
import { logRequest, logResponse, logEvent } from '../lib/console-logger'
import * as historyRepo from '../db/history.repo'

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
      },
    ) => {
      const started = Date.now()
      logRequest({
        protocol: 'mcp',
        method: 'CONNECT',
        url: options.url,
        message: `MCP connect (${options.transport}): ${options.url}`,
        meta: { transport: options.transport },
      })
      try {
        const data = await mcpConnect(options)
        mcpContext.set(data.connectionId, { url: options.url, connectedAt: Date.now() })
        logResponse({
          protocol: 'mcp',
          method: 'CONNECT',
          url: options.url,
          status: 0,
          statusText: 'OK',
          durationMs: Date.now() - started,
          responseBody: JSON.stringify(data),
          meta: {
            serverName: data.serverName ?? 'unknown',
            serverVersion: data.serverVersion ?? 'unknown',
            transport: options.transport,
          },
        })
        return { success: true, data }
      } catch (e) {
        const err = e as Error
        logResponse({
          protocol: 'mcp',
          method: 'CONNECT',
          url: options.url,
          status: -1,
          statusText: err.message,
          durationMs: Date.now() - started,
          error: { message: err.message, stack: err.stack },
        })
        return { success: false, error: err.message }
      }
    },
  )

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
      logResponse({
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
      logResponse({
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
      logRequest({
        protocol: 'mcp',
        method: 'CALL_TOOL',
        url: targetUrl,
        body: argsBody,
        message: `MCP call ${toolName}`,
      })
      try {
        const data = await mcpCallTool(connectionId, toolName, args)
        const responseBody = JSON.stringify(data)
        const durationMs = Date.now() - started
        logResponse({
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
        logResponse({
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
