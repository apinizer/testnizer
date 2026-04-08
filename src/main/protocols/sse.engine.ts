import EventSource from 'eventsource'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'

// ─── Types ───────────────────────────────────────────────────

export interface SseConnectOptions {
  url: string
  headers?: Record<string, string>
  lastEventId?: string
  withCredentials?: boolean
}

export interface SseConnectionInfo {
  connectionId: string
  url: string
  readyState: number
  connectedAt: number
}

export interface SseEventPayload {
  connectionId: string
  type: 'open' | 'event' | 'error'
  eventType?: string
  data?: string
  id?: string
  retry?: number
  timestamp: number
}

// ─── Connection manager ─────────────────────────────────────

interface ManagedSseConnection {
  connectionId: string
  eventSource: EventSource
  url: string
  connectedAt: number
  windowId: number
}

const connections = new Map<string, ManagedSseConnection>()

function sendEventToRenderer(windowId: number, event: SseEventPayload): void {
  const win = BrowserWindow.fromId(windowId)
  if (win && !win.isDestroyed()) {
    win.webContents.send('sse:event', event)
  }
}

// ─── Public API ─────────────────────────────────────────────

export function connect(
  options: SseConnectOptions,
  windowId: number
): Promise<SseConnectionInfo> {
  return new Promise((resolve, reject) => {
    const connectionId = randomUUID()

    const initDict: EventSource.EventSourceInitDict = {
      headers: options.headers ?? {},
      withCredentials: options.withCredentials ?? false
    }

    // Include Last-Event-ID header if provided
    if (options.lastEventId) {
      const headers = initDict.headers as Record<string, string>
      headers['Last-Event-ID'] = options.lastEventId
    }

    let eventSource: EventSource
    try {
      eventSource = new EventSource(options.url, initDict)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    const managed: ManagedSseConnection = {
      connectionId,
      eventSource,
      url: options.url,
      connectedAt: Date.now(),
      windowId
    }

    // Connection timeout
    const timeout = setTimeout(() => {
      if (eventSource.readyState === EventSource.CONNECTING) {
        eventSource.close()
        connections.delete(connectionId)
        reject(new Error('SSE connection timeout (15s)'))
      }
    }, 15000)

    eventSource.onopen = () => {
      clearTimeout(timeout)
      connections.set(connectionId, managed)

      sendEventToRenderer(windowId, {
        connectionId,
        type: 'open',
        timestamp: Date.now()
      })

      resolve({
        connectionId,
        url: options.url,
        readyState: eventSource.readyState,
        connectedAt: managed.connectedAt
      })
    }

    eventSource.onmessage = (event: MessageEvent) => {
      sendEventToRenderer(windowId, {
        connectionId,
        type: 'event',
        eventType: 'message',
        data: typeof event.data === 'string' ? event.data : String(event.data),
        id: event.lastEventId || undefined,
        timestamp: Date.now()
      })
    }

    eventSource.onerror = (err: MessageEvent) => {
      clearTimeout(timeout)

      const errorData = err.data ? String(err.data) : 'SSE connection error'

      sendEventToRenderer(windowId, {
        connectionId,
        type: 'error',
        data: errorData,
        timestamp: Date.now()
      })

      // If not yet connected, reject
      if (!connections.has(connectionId)) {
        connections.delete(connectionId)
        reject(new Error(errorData))
      }

      // If the connection is closed, clean up
      if (eventSource.readyState === EventSource.CLOSED) {
        connections.delete(connectionId)
      }
    }
  })
}

export function disconnect(connectionId: string): boolean {
  const managed = connections.get(connectionId)
  if (!managed) {
    return false
  }

  managed.eventSource.close()
  connections.delete(connectionId)
  return true
}

export function getConnectionInfo(connectionId: string): SseConnectionInfo | null {
  const managed = connections.get(connectionId)
  if (!managed) return null

  return {
    connectionId: managed.connectionId,
    url: managed.url,
    readyState: managed.eventSource.readyState,
    connectedAt: managed.connectedAt
  }
}

export function disconnectAll(): void {
  for (const [id] of connections) {
    disconnect(id)
  }
}
