/**
 * A real MQTT 3.1.1 broker for tests (issue #284): Aedes 1.x on a random
 * localhost port, plain TCP plus an MQTT-over-WebSocket listener. Used by the
 * engine unit tests (`tests/main/mqtt-engine.test.ts`) and the e2e test
 * servers (`tests/e2e/servers/mqtt-server.ts`).
 *
 * Aedes 1.x is ESM-only and rejects MQTT 5 CONNECT ("Unacceptable protocol
 * version"): it is loaded with a dynamic `import()`, and MQTT 5 behaviour is
 * tested against `mqtt5-stub-broker.ts` instead.
 *
 * Optional `auth` makes the broker accept only that username / password
 * (CONNACK 4 "Bad username or password" otherwise).
 */
import net from 'node:net'
import http from 'node:http'
import { WebSocketServer, createWebSocketStream } from 'ws'

export interface AedesTestBroker {
  port: number
  wsPort: number
  url: string
  wsUrl: string
  /** Drop a connected client's socket without a DISCONNECT (fires its Last Will). */
  dropClient: (clientId: string) => boolean
  /** Messages published by any client (and wills), in order. */
  published: Array<{
    topic: string
    payload: string
    retain: boolean
    qos: number
    clientId: string | null
  }>
  close: () => Promise<void>
}

type AedesClient = { id: string; conn: { destroy: () => void } }
type AedesInstance = {
  handle: (stream: unknown) => unknown
  on: (event: string, listener: (...args: unknown[]) => void) => void
  close: (cb: () => void) => void
  clients: Record<string, AedesClient>
}

export async function startAedesBroker(
  opts: { port?: number; wsPort?: number; auth?: { username: string; password: string } } = {},
): Promise<AedesTestBroker> {
  const mod = (await import('aedes')) as unknown as {
    Aedes: { createBroker: (o: Record<string, unknown>) => Promise<AedesInstance> }
  }
  const auth = opts.auth
  const broker = await mod.Aedes.createBroker({
    ...(auth
      ? {
          authenticate: (
            _client: unknown,
            username: string | undefined,
            password: Buffer | undefined,
            done: (err: (Error & { returnCode: number }) | null, ok: boolean | null) => void,
          ) => {
            if (username === auth.username && password?.toString('utf-8') === auth.password) {
              done(null, true)
              return
            }
            const err = new Error('Bad username or password') as Error & { returnCode: number }
            err.returnCode = 4
            done(err, null)
          },
        }
      : {}),
  })
  const published: AedesTestBroker['published'] = []
  broker.on('publish', (...args: unknown[]) => {
    const packet = args[0] as { topic: string; payload: Buffer; retain: boolean; qos: number }
    const client = args[1] as AedesClient | null
    if (packet.topic.startsWith('$SYS')) return
    published.push({
      topic: packet.topic,
      payload: Buffer.from(packet.payload).toString('utf-8'),
      retain: packet.retain,
      qos: packet.qos,
      clientId: client ? client.id : null,
    })
  })

  const tcp = net.createServer((socket) => broker.handle(socket))
  await new Promise<void>((resolve) => tcp.listen(opts.port ?? 0, '127.0.0.1', resolve))
  const port = (tcp.address() as net.AddressInfo).port

  const httpServer = http.createServer()
  const wss = new WebSocketServer({ server: httpServer })
  wss.on('connection', (ws) => broker.handle(createWebSocketStream(ws)))
  await new Promise<void>((resolve) => httpServer.listen(opts.wsPort ?? 0, '127.0.0.1', resolve))
  const wsPort = (httpServer.address() as net.AddressInfo).port

  return {
    port,
    wsPort,
    url: `mqtt://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${wsPort}`,
    published,
    dropClient: (clientId) => {
      const c = broker.clients[clientId]
      if (!c) return false
      c.conn.destroy()
      return true
    },
    close: async () => {
      for (const c of wss.clients) c.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
      await new Promise<void>((resolve) => broker.close(() => resolve()))
      await new Promise<void>((resolve) => tcp.close(() => resolve()))
    },
  }
}
