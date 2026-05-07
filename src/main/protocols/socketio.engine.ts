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

interface Connection {
  socket: Socket
  info: SocketIOConnectionInfo
  onEvent?: (event: SocketIOEvent) => void
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
      connections.set(connectionId, { socket, info })
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
  // Avoid duplicate listeners
  conn.socket.off(eventName)
  conn.socket.on(eventName, (data: unknown) => {
    conn.onEvent?.({
      direction: 'in',
      event: eventName,
      data,
      timestamp: Date.now(),
    })
  })
}

export function socketIOUnsubscribe(connectionId: string, eventName: string): void {
  const conn = connections.get(connectionId)
  if (!conn) return
  conn.socket.off(eventName)
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
