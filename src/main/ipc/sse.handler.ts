import { ipcMain, BrowserWindow } from 'electron'
import {
  connect,
  disconnect,
  type SseConnectOptions
} from '../protocols/sse.engine'
import { logEvent } from '../lib/console-logger'

interface SseConnectPayload {
  url: string
  headers?: Record<string, string>
  lastEventId?: string
  withCredentials?: boolean
  _tabId?: string
}

const sseContext = new Map<string, { url: string; tabId?: string }>()

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

      logEvent({
        protocol: 'sse',
        category: 'connection',
        message: `SSE connecting → ${payload.url}`,
        url: payload.url,
        tabId: payload._tabId,
      })

      try {
        const connectionInfo = await connect(options, win.id)
        sseContext.set(connectionInfo.connectionId, { url: payload.url, tabId: payload._tabId })
        logEvent({
          protocol: 'sse',
          category: 'connection',
          level: 'success',
          message: `SSE connected → ${payload.url}`,
          url: payload.url,
          tabId: payload._tabId,
        })
        return { success: true, data: connectionInfo }
      } catch (err) {
        logEvent({
          protocol: 'sse',
          category: 'connection',
          level: 'error',
          message: `SSE connection failed: ${(err as Error).message}`,
          url: payload.url,
          tabId: payload._tabId,
          error: { message: (err as Error).message },
        })
        throw err
      }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Disconnect SSE ─────────────────────────────────────────
  ipcMain.handle('sse:disconnect', async (_event, connectionId: string) => {
    try {
      const ctx = sseContext.get(connectionId)
      const result = disconnect(connectionId)
      logEvent({
        protocol: 'sse',
        category: 'connection',
        message: `SSE disconnected${ctx?.url ? ` ← ${ctx.url}` : ''}`,
        url: ctx?.url,
        tabId: ctx?.tabId,
      })
      sseContext.delete(connectionId)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
