import { ipcMain, BrowserWindow } from 'electron'
import {
  socketIOConnect,
  socketIODisconnect,
  socketIOCancelConnect,
  socketIOEmit,
  socketIOSubscribe,
  socketIOUnsubscribe,
  socketIOSetEventCallback,
  type SocketIOEvent,
} from '../protocols/socketio.engine'
import { logRequestResponse, logEvent } from '../lib/console-logger'
import * as historyRepo from '../db/history.repo'

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

// Track per-connection metadata so emit/disconnect events can carry
// `durationMs` deltas relative to the original connect.
const sioContext = new Map<string, { url: string; connectedAt: number }>()

function previewJson(value: unknown, max = 80): string {
  let s: string
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    s = String(value)
  }
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export function registerSocketIOHandlers(): void {
  ipcMain.handle(
    'socketio:connect',
    async (
      _event,
      options: {
        url: string
        namespace?: string
        auth?: Record<string, unknown>
        extraHeaders?: Record<string, string>
        _workspaceId?: string
        _projectId?: string
        _endpointId?: string
        _pendingId?: string
      },
    ) => {
      const started = Date.now()
      const fullTarget = `${options.url}${options.namespace && options.namespace !== '/' ? options.namespace : ''}`
      try {
        const data = await socketIOConnect({
          url: options.url,
          namespace: options.namespace,
          auth: options.auth,
          extraHeaders: options.extraHeaders,
          pendingId: options._pendingId,
        })
        const connectedAt = Date.now()
        sioContext.set(data.connectionId, { url: fullTarget, connectedAt })
        // Wire event push back to renderer
        socketIOSetEventCallback(data.connectionId, (event: SocketIOEvent) => {
          getWindow()?.webContents.send('socketio:event', {
            connectionId: data.connectionId,
            ...event,
          })
        })
        logRequestResponse({
          protocol: 'socketio',
          method: 'CONNECT',
          url: fullTarget,
          status: 0,
          statusText: 'connected',
          durationMs: connectedAt - started,
          meta: {
            connectionId: data.connectionId,
            namespace: options.namespace ?? '/',
            hasAuth: !!options.auth,
          },
        })
        try {
          historyRepo.addHistory({
            workspace_id: options._workspaceId,
            project_id: options._projectId,
            endpoint_id: options._endpointId,
            protocol: 'socketio',
            method: 'CONNECT',
            url: fullTarget,
            status_code: 0,
            duration_ms: connectedAt - started,
            request_snapshot: JSON.stringify({
              url: options.url,
              namespace: options.namespace,
              hasAuth: !!options.auth,
              extraHeaders: options.extraHeaders,
            }),
            response_snapshot: JSON.stringify({
              connectionId: data.connectionId,
              connectedAt,
              status: 'connected',
            }),
          })
        } catch {
          /* ignore */
        }
        return { success: true, data }
      } catch (e) {
        const err = e as Error
        const failedAt = Date.now()
        logRequestResponse({
          protocol: 'socketio',
          method: 'CONNECT',
          url: fullTarget,
          status: -1,
          statusText: err.message,
          durationMs: failedAt - started,
          error: { message: err.message, stack: err.stack },
        })
        try {
          historyRepo.addHistory({
            workspace_id: options._workspaceId,
            project_id: options._projectId,
            endpoint_id: options._endpointId,
            protocol: 'socketio',
            method: 'CONNECT',
            url: fullTarget,
            status_code: -1,
            duration_ms: failedAt - started,
            request_snapshot: JSON.stringify({
              url: options.url,
              namespace: options.namespace,
            }),
            response_snapshot: JSON.stringify({ error: err.message }),
          })
        } catch {
          /* ignore */
        }
        return { success: false, error: err.message }
      }
    },
  )

  ipcMain.handle('socketio:cancelConnect', (_event, pendingId: string) => {
    const ok = socketIOCancelConnect(pendingId)
    if (ok) {
      logEvent({
        protocol: 'socketio',
        category: 'connection',
        message: 'Socket.IO handshake cancelled by user',
      })
    }
    return { success: true, data: { canceled: ok } }
  })

  ipcMain.handle('socketio:disconnect', (_event, connectionId: string) => {
    try {
      const ctx = sioContext.get(connectionId)
      socketIODisconnect(connectionId)
      logEvent({
        protocol: 'socketio',
        category: 'connection',
        message: `Socket.IO disconnected (${connectionId})`,
        url: ctx?.url,
        direction: 'out',
        durationMs: ctx ? Date.now() - ctx.connectedAt : undefined,
      })
      sioContext.delete(connectionId)
      return { success: true, data: true }
    } catch (e) {
      const err = e as Error
      logEvent({
        protocol: 'socketio',
        category: 'connection',
        message: `Socket.IO disconnect failed: ${err.message}`,
        error: { message: err.message },
      })
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(
    'socketio:emit',
    (_event, connectionId: string, eventName: string, data: unknown) => {
      try {
        socketIOEmit(connectionId, eventName, data)
        const ctx = sioContext.get(connectionId)
        const body = typeof data === 'string' ? data : JSON.stringify(data)
        logEvent({
          protocol: 'socketio',
          category: 'event',
          message: `Socket.IO → ${eventName}: ${previewJson(data)}`,
          direction: 'out',
          eventName,
          body,
          url: ctx?.url,
          sizeBytes: Buffer.byteLength(body, 'utf-8'),
          durationMs: ctx ? Date.now() - ctx.connectedAt : undefined,
        })
        return { success: true, data: true }
      } catch (e) {
        const err = e as Error
        logEvent({
          protocol: 'socketio',
          category: 'event',
          message: `Socket.IO emit '${eventName}' failed: ${err.message}`,
          direction: 'out',
          eventName,
          error: { message: err.message },
        })
        return { success: false, error: err.message }
      }
    },
  )

  ipcMain.handle('socketio:subscribe', (_event, connectionId: string, eventName: string) => {
    try {
      socketIOSubscribe(connectionId, eventName)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('socketio:unsubscribe', (_event, connectionId: string, eventName: string) => {
    try {
      socketIOUnsubscribe(connectionId, eventName)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
