import { createSioClient, type SioClient } from './socketio-client'
import {
  DEFAULT_SIO_SETTINGS,
  bytesToBase64,
  decodeBinary,
  isBinaryContentType,
  readSioSettings,
  type SioListenConfig,
  type SioSettings,
  type SioWireArg,
  type TaggedBinary,
} from '../../shared/realtime'

/**
 * One timeline entry pushed to the renderer.
 *   - `in` / `out`: a received / emitted event; `args` is set when the event
 *     carried other than exactly one argument (`data` then is the array).
 *   - `ack`: the server's acknowledgement of an emit (`event` = the emitted
 *     name; `error` set when none arrived in time).
 *   - `system`: a connection-level row (`event` = `reconnecting`,
 *     `reconnected`, `reconnect_attempt`); `data` carries the reason / attempt.
 * Binary values are tagged `{ $binary, size }` (IPC turns Buffers into bare
 * Uint8Arrays the renderer cannot tell from a number array).
 */
export interface SocketIOEvent {
  direction: 'in' | 'out' | 'ack' | 'system'
  event: string
  data: unknown
  args?: unknown[]
  error?: string
  timestamp: number
}

export interface SocketIOConnectionInfo {
  connectionId: string
  url: string
  namespace: string
}

/** Why a connection ended without the user disconnecting it (issue #275). */
export interface SocketIOClosedInfo {
  connectionId: string
  /** socket.io-client's reason (`io server disconnect`, `transport close`, …) or `reconnect failed`. */
  reason: string
}

/**
 * Upper bound on how many events are buffered before the renderer attaches its
 * `onEvent` callback. The server can push events (e.g. a `welcome`) the instant
 * the socket connects — before the renderer's `socketio:connect` IPC roundtrip
 * completes and wires the callback. Without buffering those events vanish (the
 * old `conn.onEvent?.` optional chaining silently dropped them). When the cap is
 * exceeded the oldest entry is discarded so a chatty server can never grow this
 * unbounded.
 */
const MAX_PENDING_EVENTS = 1000

/** How long an emit with "Ack" waits for the server's acknowledgement. */
export const SIO_ACK_TIMEOUT_MS = 15_000

interface Connection {
  socket: SioClient
  info: SocketIOConnectionInfo
  onEvent?: (event: SocketIOEvent) => void
  /**
   * Events that arrived before `onEvent` was set. Flushed in arrival order the
   * moment `socketIOSetEventCallback` wires the callback, then left empty for
   * the remainder of the connection. Cleared on disconnect.
   */
  pendingEvents: SocketIOEvent[]
  /**
   * Which received events reach the renderer (the Events tab's Listen
   * toggles). `all` forwards everything — the pre-#283 default, still what a
   * caller that passes no `listen` gets.
   */
  listen: { all: boolean; events: Set<string> }
}

/**
 * Deliver an event to the renderer callback, or buffer it (bounded) when the
 * callback has not been wired yet. Single funnel for the inbound `onAny`
 * forward, the outbound `emit` echo, acks and system rows so buffering/flush
 * stays consistent.
 */
function dispatchEvent(conn: Connection, event: SocketIOEvent): void {
  if (conn.onEvent) {
    conn.onEvent(event)
    return
  }
  conn.pendingEvents.push(event)
  if (conn.pendingEvents.length > MAX_PENDING_EVENTS) {
    conn.pendingEvents.shift()
  }
}

const connections = new Map<string, Connection>()
/**
 * In-flight Socket.IO handshakes keyed by the renderer-supplied pendingId.
 * Removed once the connection opens (resolve) or fails (reject).
 * `socketIOCancelConnect` tears the client down and rejects the pending
 * `connect` promise itself: neither client reports anything when it is
 * disconnected mid-handshake, so the promise (and its IPC call) would never
 * settle.
 */
const pendingConnects = new Map<string, { socket: SioClient; cancel: () => void }>()

/** The rejection a cancelled handshake gets. */
export const SIO_CANCELLED_MESSAGE = 'Connection cancelled'
let nextId = 1

function makeId(): string {
  return `sio-${nextId++}-${Date.now()}`
}

// ─── Binary tagging ──────────────────────────────────────────────────────

function tagBinary(bytes: Uint8Array): TaggedBinary {
  return { $binary: bytesToBase64(bytes), size: bytes.length }
}

/**
 * Received / emitted values made IPC-safe and displayable: Buffers and typed
 * arrays become `{ $binary, size }`, functions (a server ack callback riding
 * on an event) are dropped — structured clone throws on them.
 */
export function toWireValue(value: unknown, depth = 0): unknown {
  if (value instanceof Uint8Array) return tagBinary(value)
  if (value instanceof ArrayBuffer) return tagBinary(new Uint8Array(value))
  if (ArrayBuffer.isView(value)) {
    return tagBinary(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  }
  if (depth > 32 || value === null || typeof value !== 'object') {
    return typeof value === 'function' ? undefined : value
  }
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v !== 'function').map((v) => toWireValue(v, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'function') out[k] = toWireValue(v, depth + 1)
  }
  return out
}

function eventPayload(args: unknown[]): { data: unknown; args?: unknown[] } {
  const wire = args.filter((a) => typeof a !== 'function').map((a) => toWireValue(a))
  if (wire.length === 1) return { data: wire[0] }
  return { data: wire.length === 0 ? null : wire, args: wire }
}

/**
 * Renderer arguments → what socket.io-client sends: JSON parsed (an invalid
 * JSON argument is an error, never silently sent as text), text as a string,
 * base64 / hex decoded to a Buffer (a binary attachment on the wire).
 */
export function decodeWireArgs(args: SioWireArg[]): unknown[] {
  return args.map((a, i) => {
    if (a.contentType === 'json') {
      try {
        return JSON.parse(a.content)
      } catch (e) {
        throw new Error(`Argument ${i + 1} is not valid JSON: ${(e as Error).message}`)
      }
    }
    if (isBinaryContentType(a.contentType)) {
      const res = decodeBinary(a.content, a.contentType)
      if (!res.ok) throw new Error(`Argument ${i + 1}: ${res.error}`)
      return Buffer.from(res.bytes)
    }
    return a.content
  })
}

// ─── Connect ─────────────────────────────────────────────────────────────

export async function socketIOConnect(options: {
  url: string
  namespace?: string
  auth?: Record<string, unknown>
  extraHeaders?: Record<string, string>
  /**
   * Settings tab (issue #283); missing keys take `DEFAULT_SIO_SETTINGS`.
   * `version` picks the client (`socketio-client.ts`): `'2'` the 2.x client,
   * `'3'` / `'4'` the 4.x one.
   */
  settings?: Partial<SioSettings>
  /** Listened events; omitted = forward every event. */
  listen?: SioListenConfig
  /**
   * Called once when the connection ends without the user disconnecting it —
   * the server kicked the client, the transport died and no reconnection is
   * configured, or every reconnection attempt failed (issue #275). Given at
   * connect time so a close right after the handshake is never missed.
   */
  onClose?: (info: SocketIOClosedInfo) => void
  /**
   * Renderer-supplied id so `socketIOCancelConnect(id)` can abort a stalled
   * handshake. Cleared once the connection opens or fails.
   */
  pendingId?: string
}): Promise<SocketIOConnectionInfo> {
  const settings = readSioSettings({ ...DEFAULT_SIO_SETTINGS, ...(options.settings ?? {}) })
  return new Promise((resolve, reject) => {
    const connectionId = makeId()
    const ns = options.namespace || '/'
    const reconnect = settings.retryCount > 0

    const socket = createSioClient({
      url: options.url,
      namespace: ns,
      auth: options.auth,
      extraHeaders: options.extraHeaders,
      settings,
    })

    if (options.pendingId) {
      pendingConnects.set(options.pendingId, {
        socket,
        cancel: () => reject(new Error(SIO_CANCELLED_MESSAGE)),
      })
    }

    const info: SocketIOConnectionInfo = {
      connectionId,
      url: options.url,
      namespace: ns,
    }

    let opened = false
    socket.onceConnect(() => {
      opened = true
      if (options.pendingId) pendingConnects.delete(options.pendingId)
      const conn: Connection = {
        socket,
        info,
        pendingEvents: [],
        listen: {
          all: options.listen ? options.listen.all : true,
          events: new Set(options.listen?.events ?? []),
        },
      }
      connections.set(connectionId, conn)

      // Forward server-pushed events the listen config lets through. The
      // config only adjusts what reaches the renderer — listeners are never
      // re-attached on the socket.io client.
      socket.onAny((event, args) => {
        if (!conn.listen.all && !conn.listen.events.has(event)) return
        dispatchEvent(conn, {
          direction: 'in',
          event,
          ...eventPayload(args),
          timestamp: Date.now(),
        })
      })

      const close = (reason: string): void => {
        // A user disconnect removed the entry first — nothing to report.
        if (connections.get(connectionId) !== conn) return
        connections.delete(connectionId)
        conn.pendingEvents.length = 0
        options.onClose?.({ connectionId, reason })
      }

      socket.onDisconnect((reason) => {
        if (connections.get(connectionId) !== conn) return
        // The client reconnects by itself only when reconnection is
        // configured, and never after a server kick or a client disconnect.
        if (reconnect && socket.willReconnect) {
          dispatchEvent(conn, {
            direction: 'system',
            event: 'reconnecting',
            data: reason,
            timestamp: Date.now(),
          })
          return
        }
        close(reason)
        socket.disconnect()
      })
      socket.onReconnectAttempt((attempt) => {
        if (connections.get(connectionId) !== conn) return
        dispatchEvent(conn, {
          direction: 'system',
          event: 'reconnect_attempt',
          data: attempt,
          timestamp: Date.now(),
        })
      })
      socket.onReconnect((attempt) => {
        if (connections.get(connectionId) !== conn) return
        dispatchEvent(conn, {
          direction: 'system',
          event: 'reconnected',
          data: attempt,
          timestamp: Date.now(),
        })
      })
      socket.onReconnectFailed(() => {
        close('reconnect failed')
        socket.disconnect()
      })

      resolve(info)
    })

    socket.onceConnectError((message) => {
      if (opened) return
      if (options.pendingId) pendingConnects.delete(options.pendingId)
      socket.disconnect()
      reject(new Error(message))
    })
  })
}

/**
 * Abort an in-flight Socket.IO handshake. Returns true when a pending entry
 * was found and torn down — its `connect` promise then rejects with
 * `SIO_CANCELLED_MESSAGE` — false otherwise.
 */
export function socketIOCancelConnect(pendingId: string): boolean {
  const pending = pendingConnects.get(pendingId)
  if (!pending) return false
  pendingConnects.delete(pendingId)
  try {
    pending.socket.disconnect()
  } catch {
    // Best-effort.
  }
  pending.cancel()
  return true
}

export function socketIODisconnect(connectionId: string): void {
  const conn = connections.get(connectionId)
  if (!conn) return
  // Removed BEFORE the socket closes: its 'disconnect' listener then knows
  // this was the user, not the server, and reports nothing.
  connections.delete(connectionId)
  conn.pendingEvents.length = 0
  conn.socket.disconnect()
}

function liveConnection(connectionId: string): Connection {
  const conn = connections.get(connectionId)
  if (!conn || !conn.socket.connected) throw new Error('Not connected')
  return conn
}

/** Emit one event with one argument (the pre-#283 API). */
export function socketIOEmit(connectionId: string, eventName: string, data: unknown): void {
  socketIOEmitArgs(connectionId, eventName, [data])
}

/**
 * Emit `eventName` with any number of arguments (already decoded). With
 * `ack`, the server's acknowledgement — or its absence after
 * `SIO_ACK_TIMEOUT_MS` — arrives as an `ack` timeline entry.
 */
export function socketIOEmitArgs(
  connectionId: string,
  eventName: string,
  args: unknown[],
  opts: { ack?: boolean; ackTimeoutMs?: number } = {},
): void {
  const conn = liveConnection(connectionId)
  if (opts.ack) {
    conn.socket.emitWithAck(
      eventName,
      args,
      opts.ackTimeoutMs ?? SIO_ACK_TIMEOUT_MS,
      (err, response) => {
        if (connections.get(connectionId) !== conn) return
        dispatchEvent(conn, {
          direction: 'ack',
          event: eventName,
          ...(err ? { data: null, error: err.message } : eventPayload(response)),
          timestamp: Date.now(),
        })
      },
    )
  } else {
    conn.socket.emit(eventName, args)
  }
  dispatchEvent(conn, {
    direction: 'out',
    event: eventName,
    ...eventPayload(args),
    timestamp: Date.now(),
  })
}

/** Renderer-format arguments (`{content, contentType}`) decoded and emitted. */
export function socketIOEmitWire(
  connectionId: string,
  eventName: string,
  args: SioWireArg[],
  opts: { ack?: boolean } = {},
): void {
  liveConnection(connectionId)
  socketIOEmitArgs(connectionId, eventName, decodeWireArgs(args), opts)
}

/** Replace the listen config of a live connection (Events tab edit while connected). */
export function socketIOSetListen(connectionId: string, cfg: SioListenConfig): void {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('Not connected')
  conn.listen = { all: cfg.all, events: new Set(cfg.events) }
}

/** Listen to one more event (and stop forwarding the others). */
export function socketIOSubscribe(connectionId: string, eventName: string): void {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('Not connected')
  conn.listen.all = false
  conn.listen.events.add(eventName)
}

export function socketIOUnsubscribe(connectionId: string, eventName: string): void {
  const conn = connections.get(connectionId)
  if (!conn) return
  conn.listen.events.delete(eventName)
}

export function socketIOSetEventCallback(
  connectionId: string,
  cb: (event: SocketIOEvent) => void,
): void {
  const conn = connections.get(connectionId)
  if (!conn) return
  conn.onEvent = cb
  // Flush any events that arrived before the callback was wired (e.g. a server
  // `welcome` pushed during the IPC roundtrip), in arrival order, then drop the
  // buffer — all subsequent events go straight through `dispatchEvent`.
  if (conn.pendingEvents.length > 0) {
    const buffered = conn.pendingEvents
    conn.pendingEvents = []
    for (const event of buffered) cb(event)
  }
}

export function socketIOGetInfo(connectionId: string): SocketIOConnectionInfo | undefined {
  return connections.get(connectionId)?.info
}

export function socketIODisconnectAll(): void {
  for (const [id] of connections) {
    socketIODisconnect(id)
  }
}
