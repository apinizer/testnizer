import WebSocket from 'ws'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { classifyTransportError, hintForHttpStatus } from '../lib/error-classifier'
import { decodeBinary } from '../../shared/realtime'

// ─── Types ───────────────────────────────────────────────────

export interface WsConnectOptions {
  url: string
  headers?: Record<string, string>
  protocols?: string[]
  rejectUnauthorized?: boolean
  /** Handshake timeout in ms (Settings tab, issue #282). Default 15 s. */
  handshakeTimeout?: number
  /** Largest incoming message in bytes; 0 = unlimited. Default: the `ws` library's 100 MiB. */
  maxPayload?: number
  /** Reconnection attempts after an unexpected close; 0 / omitted = none. */
  retryCount?: number
  /** Delay between reconnection attempts in ms. */
  retryDelay?: number
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

/**
 * Engine → renderer. `reconnecting` (issue #282): the connection dropped and
 * attempt `attempt` starts after the retry delay; a later `open` carries
 * `reconnected: true`. `close` is final.
 */
export interface WsEventPayload {
  connectionId: string
  type: 'open' | 'message' | 'close' | 'error' | 'reconnecting'
  data?: string
  code?: number
  reason?: string
  timestamp: number
  messageId?: string
  contentType?: 'text' | 'json' | 'binary'
  attempt?: number
  reconnected?: boolean
}

/** Default handshake timeout (the fixed timer before issue #282). */
export const WS_DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000

// ─── Connection manager ─────────────────────────────────────

interface ManagedConnection {
  ws: WebSocket
  connectionId: string
  url: string
  connectedAt: number
  windowId: number
  options: WsConnectOptions
  /** Set by `disconnect()`: the close that follows is the user's, never retried. */
  userClosed: boolean
  /** Reconnection attempts since the last successful open. */
  attempts: number
  retryTimer?: ReturnType<typeof setTimeout>
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

function newSocket(options: WsConnectOptions): WebSocket {
  const wsOptions: WebSocket.ClientOptions = {
    headers: options.headers ?? {},
    rejectUnauthorized: options.rejectUnauthorized !== false,
    // A second behind the connect timer below (whose message names the
    // setting); the only timer of a reconnection attempt.
    handshakeTimeout: (options.handshakeTimeout ?? WS_DEFAULT_HANDSHAKE_TIMEOUT_MS) + 1000,
  }
  if (options.maxPayload !== undefined) wsOptions.maxPayload = options.maxPayload
  return new WebSocket(options.url, options.protocols ?? [], wsOptions)
}

/** A received frame → the renderer's text / JSON / binary (base64) message. */
function messageEvent(
  connectionId: string,
  data: WebSocket.RawData,
  isBinary: boolean,
): WsEventPayload {
  let content: string
  let contentType: 'text' | 'json' | 'binary'
  if (isBinary) {
    const buf = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data as ArrayBuffer)
    content = buf.toString('base64')
    contentType = 'binary'
  } else {
    content = data.toString()
    contentType = 'text'
    try {
      JSON.parse(content)
      contentType = 'json'
    } catch {
      // Not JSON, keep as text
    }
  }
  return {
    connectionId,
    type: 'message',
    data: content,
    timestamp: Date.now(),
    messageId: randomUUID(),
    contentType,
  }
}

/**
 * Wire an opened (or re-opened) socket of `managed`: messages, and the close
 * that either ends the connection or — when it was not the user's and
 * reconnection is configured — schedules the next attempt (issue #282).
 */
function attachLive(managed: ManagedConnection): void {
  const { ws, connectionId, windowId } = managed
  ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
    if (managed.ws !== ws) return
    sendEventToRenderer(windowId, messageEvent(connectionId, data, isBinary))
  })
  ws.on('close', (code: number, reason: Buffer) => {
    if (managed.ws !== ws) return
    onSocketClosed(managed, code, reason.toString())
  })
}

function onSocketClosed(managed: ManagedConnection, code: number, reason: string): void {
  const retry = managed.options.retryCount ?? 0
  const live = connections.get(managed.connectionId) === managed
  if (live && !managed.userClosed && managed.attempts < retry) {
    managed.attempts += 1
    sendEventToRenderer(managed.windowId, {
      connectionId: managed.connectionId,
      type: 'reconnecting',
      attempt: managed.attempts,
      code,
      reason,
      timestamp: Date.now(),
    })
    managed.retryTimer = setTimeout(() => reconnect(managed), managed.options.retryDelay ?? 0)
    return
  }
  if (live) connections.delete(managed.connectionId)
  sendEventToRenderer(managed.windowId, {
    connectionId: managed.connectionId,
    type: 'close',
    code,
    reason,
    timestamp: Date.now(),
  })
}

/** One reconnection attempt; its failure closes the socket, which retries or ends. */
function reconnect(managed: ManagedConnection): void {
  managed.retryTimer = undefined
  if (connections.get(managed.connectionId) !== managed || managed.userClosed) return
  let ws: WebSocket
  try {
    ws = newSocket(managed.options)
  } catch {
    onSocketClosed(managed, 1006, 'reconnect failed')
    return
  }
  managed.ws = ws
  attachLive(managed)
  // A failed attempt surfaces as 'close' (handled above); its 'error' is not
  // a new error state for the renderer — the reconnecting row says it all.
  ws.on('error', () => {})
  ws.on('open', () => {
    if (managed.ws !== ws) return
    managed.attempts = 0
    managed.connectedAt = Date.now()
    sendEventToRenderer(managed.windowId, {
      connectionId: managed.connectionId,
      type: 'open',
      reconnected: true,
      timestamp: Date.now(),
    })
  })
}

export function connect(options: WsConnectOptions, windowId: number): Promise<WsConnectionInfo> {
  return new Promise((resolve, reject) => {
    const connectionId = randomUUID()
    const timeoutMs = options.handshakeTimeout ?? WS_DEFAULT_HANDSHAKE_TIMEOUT_MS

    let ws: WebSocket

    try {
      ws = newSocket(options)
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
      options,
      userClosed: false,
      attempts: 0,
    }

    // Our own timer next to `ws`'s `handshakeTimeout` so the message names
    // the configured value.
    const timeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.terminate()
        connections.delete(connectionId)
        reject(new Error(`WebSocket connection timeout (${Math.round(timeoutMs / 100) / 10}s)`))
      }
    }, timeoutMs)

    ws.on('open', () => {
      clearTimeout(timeout)
      if (options.pendingId) pendingConnects.delete(options.pendingId)
      managed.connectedAt = Date.now()
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

    attachLive(managed)

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

  managed.userClosed = true
  if (managed.retryTimer) clearTimeout(managed.retryTimer)
  try {
    managed.ws.close(1000, 'Client disconnected')
  } catch {
    managed.ws.terminate()
  }

  connections.delete(connectionId)
  return true
}

/**
 * Send one frame. `binary` (issue #282): the content is base64 / hex text,
 * decoded here into a binary frame — never sent as the text itself.
 */
export function sendMessage(
  connectionId: string,
  message: string,
  opts: { binary?: 'base64' | 'hex' } = {},
): boolean {
  const managed = connections.get(connectionId)
  if (!managed) {
    throw new Error(`No active connection with id: ${connectionId}`)
  }

  if (managed.ws.readyState !== WebSocket.OPEN) {
    throw new Error(`WebSocket is not open (state: ${managed.ws.readyState})`)
  }

  if (opts.binary) {
    const res = decodeBinary(message, opts.binary)
    if (!res.ok) throw new Error(res.error)
    managed.ws.send(Buffer.from(res.bytes), { binary: true })
    return true
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
