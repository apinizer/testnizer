/**
 * The e2e GraphQL server (`tests/e2e/servers/graphql-server.ts`) answers POST and
 * WebSocket on one port and path. `tests/e2e/ui/62-graphql-subscription.spec.ts`
 * depends on this wiring; this checks it with real sockets without Electron.
 */
import { afterEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import WebSocket from 'ws'
import { startGraphqlServer, type GraphqlServer } from '../e2e/servers/graphql-server'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

let server: GraphqlServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

describe('e2e GraphQL server', () => {
  it('POST still answers, and a subscription streams on the same URL', async () => {
    server = await startGraphqlServer(await freePort())

    const post = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ hello(name: "x") }' }),
    })
    expect(await post.json()).toEqual({ data: { hello: 'Hello x' } })

    const socket = new WebSocket(server.url.replace('http://', 'ws://'), [
      'graphql-transport-ws',
      'graphql-ws',
    ])
    const types: string[] = []
    const stamps: number[] = []
    await new Promise<void>((resolve, reject) => {
      socket.on('error', reject)
      socket.on('open', () => socket.send(JSON.stringify({ type: 'connection_init' })))
      socket.on('message', (raw) => {
        const { type } = JSON.parse(String(raw)) as { type: string }
        types.push(type)
        if (type === 'connection_ack') {
          socket.send(
            JSON.stringify({
              id: '1',
              type: 'subscribe',
              payload: { query: 'subscription { tick }' },
            }),
          )
        }
        if (type === 'next') stamps.push(Date.now())
        if (stamps.length === 2) resolve()
      })
    })
    expect(socket.protocol).toBe('graphql-transport-ws')
    expect(types.slice(0, 2)).toEqual(['connection_ack', 'next'])
    expect(stamps[1] - stamps[0]).toBeGreaterThan(100)
    socket.close()
  })

  it('close() ends open sockets and frees the port', async () => {
    const port = await freePort()
    const running = await startGraphqlServer(port)
    const socket = new WebSocket(running.url.replace('http://', 'ws://'), ['graphql-transport-ws'])
    await new Promise((resolve, reject) => {
      socket.on('open', resolve)
      socket.on('error', reject)
    })
    const closed = new Promise((resolve) => socket.on('close', resolve))
    await running.close()
    await closed
    server = await startGraphqlServer(port)
    expect(server.port).toBe(port)
  })
})
