import { ipcMain, BrowserWindow } from 'electron'
import {
  connect,
  disconnect,
  sendMessage,
  type WsConnectOptions
} from '../protocols/websocket.engine'

interface WsConnectPayload {
  url: string
  headers?: Record<string, string>
  protocols?: string[]
  rejectUnauthorized?: boolean
}

export function registerWebSocketHandlers(): void {
  // ─── Connect to WebSocket ─────────────────────────────────
  ipcMain.handle('ws:connect', async (event, payload: WsConnectPayload) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) {
        return { success: false, error: 'No window found for this request' }
      }

      const options: WsConnectOptions = {
        url: payload.url,
        headers: payload.headers,
        protocols: payload.protocols,
        rejectUnauthorized: payload.rejectUnauthorized
      }

      const connectionInfo = await connect(options, win.id)
      return { success: true, data: connectionInfo }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Disconnect WebSocket ─────────────────────────────────
  ipcMain.handle('ws:disconnect', async (_event, connectionId: string) => {
    try {
      const result = disconnect(connectionId)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Send message ─────────────────────────────────────────
  ipcMain.handle('ws:send', async (_event, connectionId: string, message: string) => {
    try {
      const result = sendMessage(connectionId, message)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
