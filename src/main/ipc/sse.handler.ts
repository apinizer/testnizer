import { ipcMain, BrowserWindow } from 'electron'
import {
  connect,
  disconnect,
  type SseConnectOptions
} from '../protocols/sse.engine'

interface SseConnectPayload {
  url: string
  headers?: Record<string, string>
  lastEventId?: string
  withCredentials?: boolean
}

export function registerSseHandlers(): void {
  // ─── Connect to SSE endpoint ────────────────────────────────
  ipcMain.handle('sse:connect', async (event, payload: SseConnectPayload) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) {
        return { success: false, error: 'No window found for this request' }
      }

      const options: SseConnectOptions = {
        url: payload.url,
        headers: payload.headers,
        lastEventId: payload.lastEventId,
        withCredentials: payload.withCredentials
      }

      const connectionInfo = await connect(options, win.id)
      return { success: true, data: connectionInfo }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Disconnect SSE ─────────────────────────────────────────
  ipcMain.handle('sse:disconnect', async (_event, connectionId: string) => {
    try {
      const result = disconnect(connectionId)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
