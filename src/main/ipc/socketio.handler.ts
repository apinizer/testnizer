import { ipcMain, BrowserWindow } from 'electron'
import {
  socketIOConnect,
  socketIODisconnect,
  socketIOEmit,
  socketIOSubscribe,
  socketIOUnsubscribe,
  socketIOSetEventCallback,
  type SocketIOEvent,
} from '../protocols/socketio.engine'
import { logRequest, logResponse, logEvent } from '../lib/console-logger'

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

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
      },
    ) => {
      const started = Date.now()
      const fullTarget = `${options.url}${options.namespace && options.namespace !== '/' ? options.namespace : ''}`
      logRequest({
        protocol: 'socketio',
        method: 'CONNECT',
        url: fullTarget,
        message: `Socket.IO connect: ${fullTarget}`,
        meta: {
          namespace: options.namespace ?? '/',
          hasAuth: !!options.auth,
        },
      })
      try {
        const data = await socketIOConnect(options)
        // Wire event push back to renderer
        socketIOSetEventCallback(data.connectionId, (event: SocketIOEvent) => {
          getWindow()?.webContents.send('socketio:event', {
            connectionId: data.connectionId,
            ...event,
          })
        })
        logResponse({
          protocol: 'socketio',
          method: 'CONNECT',
          url: fullTarget,
          status: 0,
          statusText: 'connected',
          durationMs: Date.now() - started,
          meta: { connectionId: data.connectionId },
        })
        return { success: true, data }
      } catch (e) {
        const err = e as Error
        logResponse({
          protocol: 'socketio',
          method: 'CONNECT',
          url: fullTarget,
          status: -1,
          statusText: err.message,
          durationMs: Date.now() - started,
          error: { message: err.message, stack: err.stack },
        })
        return { success: false, error: err.message }
      }
    },
  )

  ipcMain.handle('socketio:disconnect', (_event, connectionId: string) => {
    try {
      socketIODisconnect(connectionId)
      logEvent({
        protocol: 'socketio',
        category: 'connection',
        message: `Socket.IO disconnected (${connectionId})`,
        direction: 'out',
      })
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
        logEvent({
          protocol: 'socketio',
          category: 'event',
          message: `Socket.IO → ${eventName}: ${previewJson(data)}`,
          direction: 'out',
          eventName,
          body: typeof data === 'string' ? data : JSON.stringify(data),
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
