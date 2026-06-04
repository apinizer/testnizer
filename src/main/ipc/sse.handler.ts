import { ipcMain, BrowserWindow } from 'electron'
import {
  connect,
  disconnect,
  cancelConnect,
  type SseConnectOptions,
  type SseHttpMethod,
} from '../protocols/sse.engine'
import { logEvent } from '../lib/console-logger'
import * as historyRepo from '../db/history.repo'

interface SseConnectPayload {
  url: string
  headers?: Record<string, string>
  lastEventId?: string
  withCredentials?: boolean
  method?: SseHttpMethod
  body?: string
  _tabId?: string
  _workspaceId?: string
  _projectId?: string
  _endpointId?: string
  /** Renderer-supplied id so `sse:cancelConnect(id)` can abort the handshake. */
  _pendingId?: string
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
        pendingId: payload._pendingId,
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
        try {
          historyRepo.addHistory({
            workspace_id: payload._workspaceId,
            project_id: payload._projectId,
            endpoint_id: payload._endpointId,
            protocol: 'sse',
            method: payload.method ?? 'GET',
            url: payload.url,
            status_code: 200,
            duration_ms: connectedAt - connectStart,
            request_snapshot: JSON.stringify({
              url: payload.url,
              method: payload.method ?? 'GET',
              headers: payload.headers,
              lastEventId: payload.lastEventId,
              body: payload.body,
            }),
            response_snapshot: JSON.stringify({
              status: 200,
              statusText: 'OK',
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
          protocol: 'sse',
          category: 'connection',
          level: 'error',
          message: `SSE connection failed: ${(err as Error).message}`,
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
            protocol: 'sse',
            method: payload.method ?? 'GET',
            url: payload.url,
            status_code: -1,
            duration_ms: failedAt - connectStart,
            request_snapshot: JSON.stringify({
              url: payload.url,
              method: payload.method ?? 'GET',
              headers: payload.headers,
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

  // ─── Cancel an in-flight SSE handshake ─────────────────────
  ipcMain.handle('sse:cancelConnect', async (_event, pendingId: string) => {
    const ok = cancelConnect(pendingId)
    if (ok) {
      logEvent({
        protocol: 'sse',
        category: 'connection',
        message: 'SSE handshake cancelled by user',
      })
    }
    return { success: true, data: { canceled: ok } }
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
