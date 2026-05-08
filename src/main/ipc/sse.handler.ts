import { ipcMain, BrowserWindow } from 'electron'
import {
  connect,
  disconnect,
  type SseConnectOptions,
  type SseHttpMethod,
} from '../protocols/sse.engine'
import { logEvent } from '../lib/console-logger'

interface SseConnectPayload {
  url: string
  headers?: Record<string, string>
  lastEventId?: string
  withCredentials?: boolean
  method?: SseHttpMethod
  body?: string
  _tabId?: string
}

const sseContext = new Map<string, { url: string; tabId?: string; connectedAt: number }>()

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
        withCredentials: payload.withCredentials,
        method: payload.method,
        body: payload.body,
      }

      const connectStart = Date.now()
      logEvent({
        protocol: 'sse',
        category: 'connection',
        message: `SSE connecting (${payload.method ?? 'GET'}) → ${payload.url}`,
        url: payload.url,
        tabId: payload._tabId,
      })

      try {
        const connectionInfo = await connect(options, win.id)
        const connectedAt = Date.now()
        sseContext.set(connectionInfo.connectionId, {
          url: payload.url,
          tabId: payload._tabId,
          connectedAt,
        })
        logEvent({
          protocol: 'sse',
          category: 'connection',
          level: 'success',
          message: `SSE connected → ${payload.url}`,
          url: payload.url,
          tabId: payload._tabId,
          status: 200,
          statusText: 'OK',
          durationMs: connectedAt - connectStart,
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
          durationMs: Date.now() - connectStart,
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
        durationMs: ctx ? Date.now() - ctx.connectedAt : undefined,
      })
      sseContext.delete(connectionId)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
