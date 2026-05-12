import { ipcMain, BrowserWindow } from 'electron'
import {
  connect,
  disconnect,
  cancelConnect,
  sendMessage,
  type WsConnectOptions,
} from '../protocols/websocket.engine'
import { logEvent } from '../lib/console-logger'
import * as historyRepo from '../db/history.repo'

interface WsConnectPayload {
  url: string
  headers?: Record<string, string>
  protocols?: string[]
  rejectUnauthorized?: boolean
  _tabId?: string
  _workspaceId?: string
  _projectId?: string
  _endpointId?: string
  /** Renderer-supplied id so `ws:cancelConnect(id)` can abort the handshake. */
  _pendingId?: string
}

// Map connectionId -> { url, tabId, connectedAt } so disconnect / send events
// can carry the originating-tab info for ConsolePanel filtering AND so we can
// compute total connection lifetime + per-event timing deltas.
const wsContext = new Map<string, { url: string; tabId?: string; connectedAt: number }>()

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
        rejectUnauthorized: payload.rejectUnauthorized,
        pendingId: payload._pendingId,
      }

      const connectStart = Date.now()
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
        const connectedAt = Date.now()
        wsContext.set(connectionInfo.connectionId, {
          url: payload.url,
          tabId: payload._tabId,
          connectedAt,
        })
        logEvent({
          protocol: 'websocket',
          category: 'connection',
          level: 'success',
          message: `WS connected → ${payload.url}`,
          url: payload.url,
          tabId: payload._tabId,
          status: 101,
          statusText: 'Switching Protocols',
          durationMs: connectedAt - connectStart,
        })
        try {
          historyRepo.addHistory({
            workspace_id: payload._workspaceId,
            project_id: payload._projectId,
            endpoint_id: payload._endpointId,
            protocol: 'websocket',
            method: 'CONNECT',
            url: payload.url,
            status_code: 101,
            duration_ms: connectedAt - connectStart,
            request_snapshot: JSON.stringify({
              url: payload.url,
              headers: payload.headers,
              protocols: payload.protocols,
              rejectUnauthorized: payload.rejectUnauthorized,
            }),
            response_snapshot: JSON.stringify({
              status: 101,
              statusText: 'Switching Protocols',
              connectionId: connectionInfo.connectionId,
              connectedAt,
            }),
          })
        } catch {
          /* never propagate history failures */
        }
        return { success: true, data: connectionInfo }
      } catch (err) {
        const failedAt = Date.now()
        logEvent({
          protocol: 'websocket',
          category: 'connection',
          level: 'error',
          message: `WS connection failed: ${(err as Error).message}`,
          url: payload.url,
          tabId: payload._tabId,
          durationMs: failedAt - connectStart,
          error: { message: (err as Error).message },
        })
        try {
          historyRepo.addHistory({
            workspace_id: payload._workspaceId,
            project_id: payload._projectId,
            endpoint_id: payload._endpointId,
            protocol: 'websocket',
            method: 'CONNECT',
            url: payload.url,
            status_code: -1,
            duration_ms: failedAt - connectStart,
            request_snapshot: JSON.stringify({
              url: payload.url,
              headers: payload.headers,
              protocols: payload.protocols,
            }),
            response_snapshot: JSON.stringify({ error: (err as Error).message }),
          })
        } catch {
          /* ignore */
        }
        throw err
      }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Cancel an in-flight WebSocket handshake ──────────────
  ipcMain.handle('ws:cancelConnect', async (_event, pendingId: string) => {
    const ok = cancelConnect(pendingId)
    if (ok) {
      logEvent({
        protocol: 'websocket',
        category: 'connection',
        message: 'WS handshake cancelled by user',
      })
    }
    return { success: true, data: { canceled: ok } }
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
        durationMs: ctx ? Date.now() - ctx.connectedAt : undefined,
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
        sizeBytes: Buffer.byteLength(message, 'utf-8'),
        durationMs: ctx ? Date.now() - ctx.connectedAt : undefined,
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
