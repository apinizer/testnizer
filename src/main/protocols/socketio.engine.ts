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

interface Connection {
  socket: Socket
  info: SocketIOConnectionInfo
  onEvent?: (event: SocketIOEvent) => void
  subscription: SubscriptionState
}

const connections = new Map<string, Connection>()
let nextId = 1

function makeId(): string {
  return `sio-${nextId++}-${Date.now()}`
}

export async function socketIOConnect(options: {
  url: string
  namespace?: string
  auth?: Record<string, unknown>
  extraHeaders?: Record<string, string>
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

    const info: SocketIOConnectionInfo = {
      connectionId,
      url: options.url,
      namespace: ns,
    }

    socket.once('connect', () => {
      const conn: Connection = {
        socket,
        info,
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
        conn.onEvent?.({
          direction: 'in',
          event,
          data,
          timestamp: Date.now(),
        })
      })

      resolve(info)
    })

    socket.once('connect_error', (err) => {
      socket.disconnect()
      reject(new Error(err.message))
    })
  })
}

export function socketIODisconnect(connectionId: string): void {
  const conn = connections.get(connectionId)
  if (!conn) return
  conn.socket.disconnect()
  connections.delete(connectionId)
}

export function socketIOEmit(connectionId: string, eventName: string, data: unknown): void {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('Not connected')
  conn.socket.emit(eventName, data)
  conn.onEvent?.({
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
}

export function socketIOGetInfo(connectionId: string): SocketIOConnectionInfo | undefined {
  return connections.get(connectionId)?.info
}

export function socketIODisconnectAll(): void {
  for (const [id] of connections) {
    socketIODisconnect(id)
  }
}
