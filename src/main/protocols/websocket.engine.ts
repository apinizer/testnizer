import WebSocket from 'ws'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { classifyTransportError, hintForHttpStatus } from '../lib/error-classifier'

// ─── Types ───────────────────────────────────────────────────

export interface WsConnectOptions {
  url: string
  headers?: Record<string, string>
  protocols?: string[]
  rejectUnauthorized?: boolean
  /**
   * Renderer-generated id that can later be passed to `cancelConnect()` so
   * the user can abort a long handshake. Optional — when omitted the
   * connection is uncancellable until it opens (after which `disconnect()`
   * works normally).
   */
  pendingId?: string
}

export interface WsConnectionInfo {
  connectionId: string
  url: string
  readyState: number
  connectedAt: number
}

export interface WsEventPayload {
  connectionId: string
  type: 'open' | 'message' | 'close' | 'error'
  data?: string
  code?: number
  reason?: string
  timestamp: number
  messageId?: string
  contentType?: 'text' | 'json' | 'binary'
}

// ─── Connection manager ─────────────────────────────────────

interface ManagedConnection {
  ws: WebSocket
  connectionId: string
  url: string
  connectedAt: number
  windowId: number
}

const connections = new Map<string, ManagedConnection>()

/**
 * Pending WebSocket handshakes keyed by the renderer-supplied `pendingId`.
 * Once a connection opens (or rejects) it leaves this map. `cancelConnect`
 * looks up the entry, terminates the underlying socket, and the in-flight
 * `connect()` promise rejects through the existing 'error' / timeout path.
 */
const pendingConnects = new Map<string, WebSocket>()

function getWindow(windowId: number): BrowserWindow | null {
  return BrowserWindow.fromId(windowId) ?? null
}

function sendEventToRenderer(windowId: number, event: WsEventPayload): void {
  const win = getWindow(windowId)
  if (win && !win.isDestroyed()) {
    win.webContents.send('ws:event', event)
  }
}

// ─── Error message enrichment ───────────────────────────────

/**
 * `ws` reports handshake failures as `Error("Unexpected server response: 401")`
 * and transport failures as `Error("connect ECONNREFUSED ...")` — the latter
 * also carry a `.code` property. We normalize both shapes through the shared
 * classifier and bolt on an HTTP status hint when one is recoverable from
 * the handshake message (so a user staring at "401" gets "check Authorization").
 */
export function describeWebSocketError(err: unknown): string {
  const e = err as { message?: unknown }
  const msg = typeof e?.message === 'string' ? e.message : String(err)

  const m = msg.match(/Unexpected server response:\s*(\d{3})/i)
  if (m) {
    const status = Number(m[1])
    const hint = hintForHttpStatus(status)
    return hint
      ? `WebSocket handshake failed: HTTP ${status} ${hint}`
      : `WebSocket handshake failed: HTTP ${status}`
  }

  const classified = classifyTransportError(err)
  return classified.message
}

// ─── Public API ─────────────────────────────────────────────

export function connect(options: WsConnectOptions, windowId: number): Promise<WsConnectionInfo> {
  return new Promise((resolve, reject) => {
    const connectionId = randomUUID()

    const wsOptions: WebSocket.ClientOptions = {
      headers: options.headers ?? {},
      rejectUnauthorized: options.rejectUnauthorized !== false,
    }

    let ws: WebSocket

    try {
      ws = new WebSocket(options.url, options.protocols ?? [], wsOptions)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    // Register against the renderer-supplied pendingId so `cancelConnect`
    // can terminate a long handshake before 'open' fires.
    if (options.pendingId) {
      pendingConnects.set(options.pendingId, ws)
    }

    const managed: ManagedConnection = {
      ws,
      connectionId,
      url: options.url,
      connectedAt: Date.now(),
      windowId,
    }

    // Set a connection timeout
    const timeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.terminate()
        connections.delete(connectionId)
        reject(new Error('WebSocket connection timeout (15s)'))
      }
    }, 15000)

    ws.on('open', () => {
      clearTimeout(timeout)
      if (options.pendingId) pendingConnects.delete(options.pendingId)
      connections.set(connectionId, managed)

      sendEventToRenderer(windowId, {
        connectionId,
        type: 'open',
        timestamp: Date.now(),
      })

      resolve({
        connectionId,
        url: options.url,
        readyState: ws.readyState,
        connectedAt: managed.connectedAt,
      })
    })

    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      const messageId = randomUUID()
      let content: string
      let contentType: 'text' | 'json' | 'binary'

      if (isBinary) {
        content = Buffer.isBuffer(data)
          ? data.toString('base64')
          : Buffer.from(data as ArrayBuffer).toString('base64')
        contentType = 'binary'
      } else {
        content = data.toString()
        contentType = 'text'
        // Try to detect JSON
        try {
          JSON.parse(content)
          contentType = 'json'
        } catch {
          // Not JSON, keep as text
        }
      }

      sendEventToRenderer(windowId, {
        connectionId,
        type: 'message',
        data: content,
        timestamp: Date.now(),
        messageId,
        contentType,
      })
    })

    ws.on('close', (code: number, reason: Buffer) => {
      connections.delete(connectionId)

      sendEventToRenderer(windowId, {
        connectionId,
        type: 'close',
        code,
        reason: reason.toString(),
        timestamp: Date.now(),
      })
    })

    ws.on('error', (err: Error) => {
      clearTimeout(timeout)
      if (options.pendingId) pendingConnects.delete(options.pendingId)

      const message = describeWebSocketError(err)
      sendEventToRenderer(windowId, {
        connectionId,
        type: 'error',
        data: message,
        timestamp: Date.now(),
      })

      // If we haven't connected yet, reject the promise with the enriched
      // message so the renderer surfaces the same text as the error event.
      if (!connections.has(connectionId)) {
        connections.delete(connectionId)
        reject(new Error(message))
      }
    })
  })
}

/**
 * Abort an in-flight `connect()` whose handshake hasn't completed. Returns
 * true when a pending connection was found and terminated, false otherwise
 * (already open, already failed, or unknown id).
 */
export function cancelConnect(pendingId: string): boolean {
  const ws = pendingConnects.get(pendingId)
  if (!ws) return false
  pendingConnects.delete(pendingId)
  try {
    ws.terminate()
  } catch {
    // Best-effort — the socket may already be torn down.
  }
  return true
}

export function disconnect(connectionId: string): boolean {
  const managed = connections.get(connectionId)
  if (!managed) {
    return false
  }

  try {
    managed.ws.close(1000, 'Client disconnected')
  } catch {
    managed.ws.terminate()
  }

  connections.delete(connectionId)
  return true
}

export function sendMessage(connectionId: string, message: string): boolean {
  const managed = connections.get(connectionId)
  if (!managed) {
    throw new Error(`No active connection with id: ${connectionId}`)
  }

  if (managed.ws.readyState !== WebSocket.OPEN) {
    throw new Error(`WebSocket is not open (state: ${managed.ws.readyState})`)
  }

  managed.ws.send(message)
  return true
}

export function getConnectionInfo(connectionId: string): WsConnectionInfo | null {
  const managed = connections.get(connectionId)
  if (!managed) return null

  return {
    connectionId: managed.connectionId,
    url: managed.url,
    readyState: managed.ws.readyState,
    connectedAt: managed.connectedAt,
  }
}

export function getActiveConnections(): WsConnectionInfo[] {
  const result: WsConnectionInfo[] = []
  for (const managed of connections.values()) {
    result.push({
      connectionId: managed.connectionId,
      url: managed.url,
      readyState: managed.ws.readyState,
      connectedAt: managed.connectedAt,
    })
  }
  return result
}

/**
 * Clean up all connections (called on app quit)
 */
export function disconnectAll(): void {
  for (const [id] of connections) {
    disconnect(id)
  }
}
