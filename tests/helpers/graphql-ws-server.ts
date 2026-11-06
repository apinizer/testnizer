/**
 * A local GraphQL-over-WebSocket server for tests: real sockets, hand-written
 * protocol, so a test can make it misbehave (no ack, a given close code, an
 * unknown subprotocol). Speaks `graphql-transport-ws` and legacy `graphql-ws`,
 * message shapes as in their PROTOCOL.md documents.
 *
 * The real `graphql-ws` server library is run by the test itself; this fixture
 * is for everything that library would not do on purpose.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'

export const SUBPROTOCOL_TRANSPORT = 'graphql-transport-ws'
export const SUBPROTOCOL_LEGACY = 'graphql-ws'

export interface GqlWsFixtureOptions {
  /** Which subprotocol the server picks from what is offered. */
  choose?:
    | 'transport' // graphql-transport-ws, else graphql-ws
    | 'legacy' // graphql-ws only
    | 'first' // `ws`'s default: the first one offered
    | 'none' // no subprotocol header at all
    | 'bogus' // a name the client did not offer
  /** `first` + subscriptions-transport-ws: anything but graphql-ws closes 1002. */
  legacyServerClose1002?: boolean
  /** Never answer connection_init. */
  noAck?: boolean
  /** Close the socket with this code on connection_init. */
  closeOnInit?: { code: number; reason?: string }
  /** Legacy: answer connection_init with connection_error. */
  connectionError?: Record<string, unknown>
  /** Answer the operation with an error frame. */
  operationError?: string
  /** Send this many data frames right after the operation starts. */
  immediateEvents?: number
  /** Send a frame on this period while an operation runs. */
  streamEveryMs?: number
  /** Complete the operation after the immediate events. */
  completeAfterEvents?: boolean
  /** Each data frame also carries the init payload + handshake headers (an echo server). */
  echoRequest?: boolean
  /** Send a server ping right after the ack. */
  pingAfterAck?: boolean
  /** Attach to a running HTTP server instead of a new one (e2e: same port as POST). */
  server?: http.Server
  path?: string
}

export interface GqlWsFixture {
  port: number
  url: string
  wsUrl: string
  /** Every connection, in order. */
  connections: FixtureConnection[]
  /** Every frame the clients sent. */
  frames: Array<Record<string, unknown>>
  /** Send a data frame to every running operation. */
  publish: (data: unknown) => void
  /** Server `complete` on every running operation. */
  complete: () => void
  /** Close every socket with a code. */
  closeAll: (code: number, reason?: string) => void
  /** Drop every socket without a close frame. */
  terminateAll: () => void
  /** Open sockets now. */
  openCount: () => number
  /** Wait for a frame of this type. */
  waitForFrame: (type: string, timeoutMs?: number) => Promise<Record<string, unknown>>
  close: () => Promise<void>
}

export interface FixtureConnection {
  socket: WebSocket
  protocol: string
  headers: http.IncomingHttpHeaders
  initPayload?: unknown
  operations: Map<string, { payload: Record<string, unknown>; timer?: NodeJS.Timeout }>
}

export async function startGqlWsFixture(options: GqlWsFixtureOptions = {}): Promise<GqlWsFixture> {
  const server = options.server ?? http.createServer()
  const choose = options.choose ?? 'transport'
  const wss = new WebSocketServer({
    server,
    ...(options.path ? { path: options.path } : {}),
    handleProtocols: (offered: Set<string>) => {
      if (choose === 'none') return false
      if (choose === 'bogus') return 'not-graphql'
      if (choose === 'legacy') return offered.has(SUBPROTOCOL_LEGACY) ? SUBPROTOCOL_LEGACY : false
      if (choose === 'first') return offered.values().next().value ?? false
      if (offered.has(SUBPROTOCOL_TRANSPORT)) return SUBPROTOCOL_TRANSPORT
      return offered.has(SUBPROTOCOL_LEGACY) ? SUBPROTOCOL_LEGACY : false
    },
  })

  const connections: FixtureConnection[] = []
  const frames: Array<Record<string, unknown>> = []
  const waiters: Array<{ type: string; resolve: (f: Record<string, unknown>) => void }> = []

  const dataFrame = (conn: FixtureConnection, id: string, data: unknown): string =>
    JSON.stringify({
      id,
      type: conn.protocol === SUBPROTOCOL_LEGACY ? 'data' : 'next',
      payload: { data },
    })

  const echo = (conn: FixtureConnection, n: number): unknown =>
    options.echoRequest
      ? { tick: n, init: conn.initPayload, sentAuthorization: conn.headers.authorization }
      : { tick: n }

  const startOperation = (
    conn: FixtureConnection,
    id: string,
    payload: Record<string, unknown>,
  ) => {
    const legacy = conn.protocol === SUBPROTOCOL_LEGACY
    if (options.operationError) {
      conn.socket.send(
        JSON.stringify({
          id,
          type: 'error',
          payload: legacy
            ? { message: options.operationError }
            : [{ message: options.operationError }],
        }),
      )
      return
    }
    const op: { payload: Record<string, unknown>; timer?: NodeJS.Timeout } = { payload }
    conn.operations.set(id, op)
    for (let n = 1; n <= (options.immediateEvents ?? 0); n++) {
      conn.socket.send(dataFrame(conn, id, echo(conn, n)))
    }
    if (options.completeAfterEvents) {
      conn.socket.send(JSON.stringify({ id, type: 'complete' }))
      conn.operations.delete(id)
      return
    }
    if (options.streamEveryMs) {
      let n = 0
      op.timer = setInterval(() => {
        n += 1
        if (conn.socket.readyState === conn.socket.OPEN) {
          conn.socket.send(dataFrame(conn, id, echo(conn, n)))
        }
      }, options.streamEveryMs)
    }
  }

  wss.on('connection', (socket, request) => {
    const conn: FixtureConnection = {
      socket,
      protocol: socket.protocol,
      headers: request.headers,
      operations: new Map(),
    }
    connections.push(conn)
    socket.on('close', () => {
      for (const op of conn.operations.values()) if (op.timer) clearInterval(op.timer)
    })
    if (options.legacyServerClose1002 && socket.protocol !== SUBPROTOCOL_LEGACY) {
      socket.close(1002)
      return
    }
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>
      frames.push(frame)
      for (const w of [...waiters]) {
        if (w.type === frame.type) {
          waiters.splice(waiters.indexOf(w), 1)
          w.resolve(frame)
        }
      }
      const id = frame.id as string
      switch (frame.type) {
        case 'connection_init':
          conn.initPayload = frame.payload
          if (options.closeOnInit) {
            socket.close(options.closeOnInit.code, options.closeOnInit.reason)
          } else if (options.connectionError) {
            socket.send(
              JSON.stringify({ type: 'connection_error', payload: options.connectionError }),
            )
          } else if (!options.noAck) {
            socket.send(JSON.stringify({ type: 'connection_ack' }))
            if (conn.protocol === SUBPROTOCOL_LEGACY) socket.send(JSON.stringify({ type: 'ka' }))
            if (options.pingAfterAck) {
              socket.send(JSON.stringify({ type: 'ping', payload: { at: 'server' } }))
            }
          }
          break
        case 'subscribe':
        case 'start':
          startOperation(conn, id, frame.payload as Record<string, unknown>)
          break
        case 'complete':
        case 'stop': {
          const op = conn.operations.get(id)
          if (op?.timer) clearInterval(op.timer)
          conn.operations.delete(id)
          break
        }
        default:
          break
      }
    })
  })

  if (!options.server) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  }
  // An attached server may start listening after this returns.
  const portNow = (): number => (server.address() as AddressInfo | null)?.port ?? 0
  const path = options.path ?? '/graphql'

  const eachOperation = (fn: (conn: FixtureConnection, id: string) => void): void => {
    for (const conn of connections) {
      if (conn.socket.readyState !== conn.socket.OPEN) continue
      for (const id of [...conn.operations.keys()]) fn(conn, id)
    }
  }

  return {
    get port() {
      return portNow()
    },
    get url() {
      return `http://127.0.0.1:${portNow()}${path}`
    },
    get wsUrl() {
      return `ws://127.0.0.1:${portNow()}${path}`
    },
    connections,
    frames,
    publish: (data) => eachOperation((conn, id) => conn.socket.send(dataFrame(conn, id, data))),
    complete: () =>
      eachOperation((conn, id) => {
        conn.socket.send(JSON.stringify({ id, type: 'complete' }))
        conn.operations.delete(id)
      }),
    closeAll: (code, reason) => {
      for (const conn of connections) conn.socket.close(code, reason)
    },
    terminateAll: () => {
      for (const conn of connections) conn.socket.terminate()
    },
    openCount: () => [...wss.clients].filter((c) => c.readyState === c.OPEN).length,
    waitForFrame: (type, timeoutMs = 3000) => {
      const seen = frames.find((f) => f.type === type)
      if (seen) return Promise.resolve(seen)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`No "${type}" frame in ${timeoutMs} ms`)),
          timeoutMs,
        )
        waiters.push({
          type,
          resolve: (f) => {
            clearTimeout(timer)
            resolve(f)
          },
        })
      })
    },
    close: async () => {
      for (const c of wss.clients) c.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      if (!options.server) await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
