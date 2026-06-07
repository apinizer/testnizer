import { io, type Socket } from 'socket.io-client'

export interface SocketIOEvent {
  direction: 'in' | 'out'
  event: string
  data: unknown
  timestamp: number
}

export interface SocketIOConnectionInfo {
  connectionId: string
  url: string
  namespace: string
}

interface SubscriptionState {
  /**
   * 'all'       — every received event is forwarded to the renderer.
   *               Default after connect, used until the user explicitly
   *               subscribes to a specific event.
   * 'whitelist' — only events whose name appears in `whitelist` are forwarded.
   *               Set the moment the first `socketIOSubscribe` call lands and
   *               persists across `unsubscribe` (so removing the last name
   *               results in *no* events surfacing, not "all again").
   */
  mode: 'all' | 'whitelist'
  whitelist: Set<string>
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

interface Connection {
  socket: Socket
  info: SocketIOConnectionInfo
  onEvent?: (event: SocketIOEvent) => void
  /**
   * Events that arrived before `onEvent` was set. Flushed in arrival order the
   * moment `socketIOSetEventCallback` wires the callback, then left empty for
   * the remainder of the connection. Cleared on disconnect.
   */
  pendingEvents: SocketIOEvent[]
  subscription: SubscriptionState
}

/**
 * Deliver an event to the renderer callback, or buffer it (bounded) when the
 * callback has not been wired yet. Single funnel for both the inbound `onAny`
 * forward and the outbound `emit` echo so buffering/flush stays consistent.
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
 * `socketIOCancelConnect` looks the entry up and disconnects, which causes
 * the pending `connect` promise to reject through the existing
 * `connect_error` path.
 */
const pendingConnects = new Map<string, Socket>()
let nextId = 1

function makeId(): string {
  return `sio-${nextId++}-${Date.now()}`
}

export async function socketIOConnect(options: {
  url: string
  namespace?: string
  auth?: Record<string, unknown>
  extraHeaders?: Record<string, string>
  /**
   * Renderer-supplied id so `socketIOCancelConnect(id)` can abort a stalled
   * handshake. Cleared once the connection opens or fails.
   */
  pendingId?: string
}): Promise<SocketIOConnectionInfo> {
  return new Promise((resolve, reject) => {
    const connectionId = makeId()
    const ns = options.namespace || '/'
    const fullUrl = options.url.replace(/\/$/, '') + (ns === '/' ? '' : ns)

    const socket = io(fullUrl, {
      auth: options.auth,
      extraHeaders: options.extraHeaders,
      reconnection: false,
      timeout: 10000,
      transports: ['websocket', 'polling'],
    })

    if (options.pendingId) {
      pendingConnects.set(options.pendingId, socket)
    }

    const info: SocketIOConnectionInfo = {
      connectionId,
      url: options.url,
      namespace: ns,
    }

    socket.once('connect', () => {
      if (options.pendingId) pendingConnects.delete(options.pendingId)
      const conn: Connection = {
        socket,
        info,
        pendingEvents: [],
        subscription: { mode: 'all', whitelist: new Set<string>() },
      }
      connections.set(connectionId, conn)

      // Forward every server-pushed event. Filtering is applied here based on
      // the subscription whitelist, so the `subscribe`/`unsubscribe` API only
      // adjusts what reaches the renderer — it never re-attaches listeners on
      // the socket.io client.
      socket.onAny((event: string, ...args: unknown[]) => {
        const sub = conn.subscription
        if (sub.mode === 'whitelist' && !sub.whitelist.has(event)) return
        const data = args.length === 1 ? args[0] : args.length === 0 ? null : args
        dispatchEvent(conn, {
          direction: 'in',
          event,
          data,
          timestamp: Date.now(),
        })
      })

      resolve(info)
    })

    socket.once('connect_error', (err) => {
      if (options.pendingId) pendingConnects.delete(options.pendingId)
      socket.disconnect()
      reject(new Error(err.message))
    })
  })
}

/**
 * Abort an in-flight Socket.IO handshake. Returns true when a pending entry
 * was found and torn down (which will reject the pending promise through the
 * `connect_error` path), false otherwise.
 */
export function socketIOCancelConnect(pendingId: string): boolean {
  const socket = pendingConnects.get(pendingId)
  if (!socket) return false
  pendingConnects.delete(pendingId)
  try {
    socket.disconnect()
  } catch {
    // Best-effort.
  }
  return true
}

export function socketIODisconnect(connectionId: string): void {
  const conn = connections.get(connectionId)
  if (!conn) return
  conn.socket.disconnect()
  conn.pendingEvents.length = 0
  connections.delete(connectionId)
}

export function socketIOEmit(connectionId: string, eventName: string, data: unknown): void {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('Not connected')
  conn.socket.emit(eventName, data)
  dispatchEvent(conn, {
    direction: 'out',
    event: eventName,
    data,
    timestamp: Date.now(),
  })
}

export function socketIOSubscribe(connectionId: string, eventName: string): void {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('Not connected')
  conn.subscription.mode = 'whitelist'
  conn.subscription.whitelist.add(eventName)
}

export function socketIOUnsubscribe(connectionId: string, eventName: string): void {
  const conn = connections.get(connectionId)
  if (!conn) return
  conn.subscription.whitelist.delete(eventName)
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
