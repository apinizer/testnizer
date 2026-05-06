import { ipcMain, BrowserWindow } from 'electron'
import {
  connect,
  disconnect,
  sendMessage,
  type WsConnectOptions
} from '../protocols/websocket.engine'
import { logEvent } from '../lib/console-logger'

interface WsConnectPayload {
  url: string
  headers?: Record<string, string>
  protocols?: string[]
  rejectUnauthorized?: boolean
  _tabId?: string
}

// Map connectionId -> { url, tabId } so disconnect / send events can carry
// the originating-tab info for ConsolePanel filtering.
const wsContext = new Map<string, { url: string; tabId?: string }>()

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

      logEvent({
        protocol: 'websocket',
        category: 'connection',
        message: `WS connecting → ${payload.url}`,
        url: payload.url,
        tabId: payload._tabId,
        meta: { protocols: (payload.protocols ?? []).join(',') },
      })

      try {
        const connectionInfo = await connect(options, win.id)
        wsContext.set(connectionInfo.connectionId, {
          url: payload.url,
          tabId: payload._tabId,
        })
        logEvent({
          protocol: 'websocket',
          category: 'connection',
          level: 'success',
          message: `WS connected → ${payload.url}`,
          url: payload.url,
          tabId: payload._tabId,
        })
        return { success: true, data: connectionInfo }
      } catch (err) {
        logEvent({
          protocol: 'websocket',
          category: 'connection',
          level: 'error',
          message: `WS connection failed: ${(err as Error).message}`,
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

  // ─── Disconnect WebSocket ─────────────────────────────────
  ipcMain.handle('ws:disconnect', async (_event, connectionId: string) => {
    try {
      const ctx = wsContext.get(connectionId)
      const result = disconnect(connectionId)
      logEvent({
        protocol: 'websocket',
        category: 'connection',
        message: `WS disconnected${ctx?.url ? ` ← ${ctx.url}` : ''}`,
        url: ctx?.url,
        tabId: ctx?.tabId,
      })
      wsContext.delete(connectionId)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Send message ─────────────────────────────────────────
  ipcMain.handle('ws:send', async (_event, connectionId: string, message: string) => {
    try {
      const ctx = wsContext.get(connectionId)
      const result = sendMessage(connectionId, message)
      logEvent({
        protocol: 'websocket',
        category: 'event',
        direction: 'out',
        message: `WS → ${truncate(message, 80)}`,
        body: message,
        url: ctx?.url,
        tabId: ctx?.tabId,
      })
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}

function truncate(s: string, max: number): string {
  if (s == null) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}
