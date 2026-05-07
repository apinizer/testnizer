import { ipcMain } from 'electron'
import {
  mcpConnect,
  mcpDisconnect,
  mcpListTools,
  mcpCallTool,
  type McpTransport,
} from '../protocols/mcp.engine'

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
      try {
        const data = await mcpConnect(options)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('mcp:disconnect', async (_event, connectionId: string) => {
    try {
      await mcpDisconnect(connectionId)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('mcp:listTools', async (_event, connectionId: string) => {
    try {
      const data = await mcpListTools(connectionId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(
    'mcp:callTool',
    async (_event, connectionId: string, toolName: string, args: Record<string, unknown>) => {
      try {
        const data = await mcpCallTool(connectionId, toolName, args)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )
}
