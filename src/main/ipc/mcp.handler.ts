import { ipcMain } from 'electron'
import {
  mcpConnect,
  mcpDisconnect,
  mcpListTools,
  mcpCallTool,
  type McpTransport,
} from '../protocols/mcp.engine'
import { logRequest, logResponse, logEvent } from '../lib/console-logger'

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
      await mcpDisconnect(connectionId)
      logEvent({
        protocol: 'mcp',
        category: 'connection',
        message: `MCP disconnected (${connectionId})`,
        direction: 'out',
      })
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
    async (_event, connectionId: string, toolName: string, args: Record<string, unknown>) => {
      const started = Date.now()
      logRequest({
        protocol: 'mcp',
        method: 'CALL_TOOL',
        url: `${connectionId}/${toolName}`,
        body: JSON.stringify(args),
        message: `MCP call ${toolName}`,
      })
      try {
        const data = await mcpCallTool(connectionId, toolName, args)
        logResponse({
          protocol: 'mcp',
          method: 'CALL_TOOL',
          url: `${connectionId}/${toolName}`,
          status: 0,
          statusText: 'OK',
          durationMs: Date.now() - started,
          requestBody: JSON.stringify(args),
          responseBody: JSON.stringify(data),
        })
        return { success: true, data }
      } catch (e) {
        const err = e as Error
        logResponse({
          protocol: 'mcp',
          method: 'CALL_TOOL',
          url: `${connectionId}/${toolName}`,
          status: -1,
          statusText: err.message,
          durationMs: Date.now() - started,
          requestBody: JSON.stringify(args),
          error: { message: err.message, stack: err.stack },
        })
        return { success: false, error: err.message }
      }
    },
  )
}
