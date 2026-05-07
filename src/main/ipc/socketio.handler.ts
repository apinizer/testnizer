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

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
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
      try {
        const data = await socketIOConnect(options)
        // Wire event push back to renderer
        socketIOSetEventCallback(data.connectionId, (event: SocketIOEvent) => {
          getWindow()?.webContents.send('socketio:event', {
            connectionId: data.connectionId,
            ...event,
          })
        })
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('socketio:disconnect', (_event, connectionId: string) => {
    try {
      socketIODisconnect(connectionId)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(
    'socketio:emit',
    (_event, connectionId: string, eventName: string, data: unknown) => {
      try {
        socketIOEmit(connectionId, eventName, data)
        return { success: true, data: true }
      } catch (e) {
        return { success: false, error: (e as Error).message }
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
