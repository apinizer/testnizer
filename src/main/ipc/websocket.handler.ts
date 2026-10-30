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
import type { HistoryConfigured } from '../../shared/history-snapshot'
import {
  decodeBinary,
  maxPayloadBytes,
  readWsSettings,
  type WsSettings,
} from '../../shared/realtime'

interface WsConnectPayload {
  url: string
  headers?: Record<string, string>
  protocols?: string[]
  rejectUnauthorized?: boolean
  /** Settings tab (issue #282); `strictSSL` wins over `rejectUnauthorized`. */
  settings?: Partial<WsSettings>
  _tabId?: string
  _workspaceId?: string
  _projectId?: string
  _endpointId?: string
  /** Renderer-supplied id so `ws:cancelConnect(id)` can abort the handshake. */
  _pendingId?: string
  /**
   * The editor state (`{{var}}` kept) for the History row's `configured` —
   * what reopening the row restores (issues #182, #195).
   */
  _configured?: HistoryConfigured
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

      // Missing settings keep the pre-#282 behaviour (verify TLS, 15 s
      // handshake, `ws`'s 100 MiB cap, no reconnection).
      const settings = payload.settings ? readWsSettings(payload.settings) : null
      const options: WsConnectOptions = {
        url: payload.url,
        headers: payload.headers,
        protocols: payload.protocols,
        rejectUnauthorized: settings ? settings.strictSSL : payload.rejectUnauthorized,
        ...(settings
          ? {
              handshakeTimeout: settings.handshakeTimeout,
              maxPayload: maxPayloadBytes(settings.maxPayload),
              retryCount: settings.retryCount,
              retryDelay: settings.retryDelay,
            }
          : {}),
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
              rejectUnauthorized: options.rejectUnauthorized,
              ...(settings ? { settings } : {}),
              ...(payload._configured ? { configured: payload._configured } : {}),
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
              ...(payload._configured ? { configured: payload._configured } : {}),
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
  // `opts.binary` (issue #282): the message is base64 / hex text decoded in
  // main into a binary frame.
  ipcMain.handle(
    'ws:send',
    async (_event, connectionId: string, message: string, opts?: { binary?: 'base64' | 'hex' }) => {
      try {
        const ctx = wsContext.get(connectionId)
        const binary = opts?.binary === 'base64' || opts?.binary === 'hex' ? opts.binary : undefined
        const result = sendMessage(connectionId, message, { binary })
        const decoded = binary ? decodeBinary(message, binary) : null
        const bytes =
          decoded && decoded.ok ? decoded.bytes.length : Buffer.byteLength(message, 'utf-8')
        logEvent({
          protocol: 'websocket',
          category: 'event',
          direction: 'out',
          message: binary ? `WS → <binary ${bytes} bytes>` : `WS → ${truncate(message, 80)}`,
          body: message,
          url: ctx?.url,
          tabId: ctx?.tabId,
          sizeBytes: bytes,
          durationMs: ctx ? Date.now() - ctx.connectedAt : undefined,
          ...(binary ? { meta: { binary } } : {}),
        })
        return { success: true, data: result }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )
}

function truncate(s: string, max: number): string {
  if (s == null) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}
