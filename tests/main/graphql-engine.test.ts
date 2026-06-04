/**
 * Integration tests for `src/main/protocols/graphql.engine.ts`.
 *
 * Strategy:
 *   - `executeQuery` / `introspect`: in-process HTTP server (Node `http`) that
 *     handles the standard GraphQL-over-HTTP POST format.
 *   - `subscribe`: in-process WebSocket server that manually implements the
 *     `graphql-transport-ws` sub-protocol so we avoid duplicate-`graphql`-module
 *     conflicts that arise when using `graphql-ws`'s `makeServer` helper.
 *   - `electron` BrowserWindow is mocked so subscription events are captured
 *     without booting Electron.
 *
 * Coverage:
 *   - executeQuery: success, field-with-arg, timing, invalid variables JSON, network failure
 *   - introspect: type list, queryType, subscriptionType, network failure
 *   - subscribe: returns subscriptionId, fires data events, fires complete event,
 *     fires error on invalid variables JSON
 *   - unsubscribe: returns false for unknown id
 *   - unsubscribeAll: no-op when empty
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { buildSchema, parse, execute as gqlExecute, subscribe as gqlSubscribe } from 'graphql'
import type { ExecutionResult } from 'graphql'

// ─── Mock electron BEFORE importing the engine ────────────────
const sentEvents: Array<{ channel: string; payload: unknown }> = []
vi.mock('electron', () => ({
  BrowserWindow: {
    fromId: (_id: number) => ({
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown) => sentEvents.push({ channel, payload }),
      },
    }),
  },
}))

import {
  executeQuery,
  introspect,
  subscribe,
  unsubscribe,
  unsubscribeAll,
} from '../../src/main/protocols/graphql.engine'

// ─── Shared schema ────────────────────────────────────────────
const schema = buildSchema(`
  type Query { hello: String, echo(text: String): String }
  type Subscription { greet: String }
`)

const rootValue = {
  hello: () => 'world',
  echo: ({ text }: { text: string }) => text,
  greet: async function* () {
    yield { greet: 'Hello, world!' }
  },
}

// ─── HTTP server (executeQuery + introspect) ──────────────────
let httpServer: Server
let httpPort: number

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
  })
}

beforeAll(async () => {
  httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    try {
      const body = JSON.parse(await readBody(req)) as {
        query: string
        variables?: Record<string, unknown>
        operationName?: string
      }
      const result = await gqlExecute({
        schema,
        document: parse(body.query),
        rootValue,
        variableValues: body.variables,
        operationName: body.operationName,
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ errors: [{ message: (e as Error).message }] }))
    }
  })

  await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r))
  httpPort = (httpServer.address() as AddressInfo).port
})

// ─── WebSocket server (subscriptions — manual graphql-transport-ws) ─
//
// We implement only the subset of the protocol that the engine exercises:
//   connection_init → connection_ack
//   subscribe       → next* → complete
//   ping            → pong
//
// This avoids the duplicate-graphql-module problem that arises when using
// graphql-ws's makeServer because it imports graphql from its own realm.
let wss: WebSocketServer
let wsPort: number

beforeAll(async () => {
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })

  wss.on('connection', (socket: WsSocket) => {
    socket.on('message', async (raw) => {
      let msg: { type: string; id?: string; payload?: { query: string; variables?: unknown } }
      try {
        msg = JSON.parse(raw.toString()) as typeof msg
      } catch {
        return
      }

      if (msg.type === 'connection_init') {
        socket.send(JSON.stringify({ type: 'connection_ack' }))
        return
      }

      if (msg.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }))
        return
      }

      if (msg.type === 'subscribe' && msg.id && msg.payload?.query) {
        try {
          const result = await gqlSubscribe({
            schema,
            document: parse(msg.payload.query),
            rootValue,
          })

          if (Symbol.asyncIterator in (result as object)) {
            for await (const data of result as AsyncIterable<ExecutionResult>) {
              if (socket.readyState !== socket.OPEN) break
              socket.send(JSON.stringify({ type: 'next', id: msg.id, payload: data }))
            }
          }
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: 'complete', id: msg.id }))
          }
        } catch (err) {
          if (socket.readyState === socket.OPEN) {
            socket.send(
              JSON.stringify({
                type: 'error',
                id: msg.id,
                payload: [{ message: (err as Error).message }],
              }),
            )
          }
        }
      }
    })
  })

  await new Promise<void>((r) => wss.on('listening', r))
  wsPort = (wss.address() as AddressInfo).port
})

afterAll(async () => {
  unsubscribeAll()
  await new Promise<void>((r) => wss.close(() => r()))
  await new Promise<void>((r) => httpServer.close(() => r()))
})

beforeEach(() => {
  unsubscribeAll()
  sentEvents.length = 0
})

const httpUrl = () => `http://127.0.0.1:${httpPort}`
const wsUrl = () => `ws://127.0.0.1:${wsPort}`

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

// ─── executeQuery ─────────────────────────────────────────────
describe('graphql.engine — executeQuery', () => {
  it('executes a simple query and returns data', async () => {
    const result = await executeQuery({ url: httpUrl(), query: '{ hello }' })
    expect(result.protocol).toBe('graphql')
    expect(result.status).toBe(200)
    expect(result.body).toContain('"hello"')
    expect(result.body).toContain('"world"')
    expect(result.error).toBeUndefined()
  })

  it('returns data for a field with argument', async () => {
    const result = await executeQuery({ url: httpUrl(), query: '{ echo(text: "ping") }' })
    expect(result.body).toContain('"ping"')
    expect(result.status).toBe(200)
  })

  it('timing.total is a non-negative number', async () => {
    const result = await executeQuery({ url: httpUrl(), query: '{ hello }' })
    expect(typeof result.timing.total).toBe('number')
    expect(result.timing.total).toBeGreaterThanOrEqual(0)
  })

  it('returns error in result.error for invalid variables JSON', async () => {
    const result = await executeQuery({
      url: httpUrl(),
      query: '{ hello }',
      variables: '{ NOT VALID JSON }',
    })
    expect(result.error).toMatch(/Invalid JSON/i)
  })

  it('returns error on network failure (bad URL)', async () => {
    const result = await executeQuery({ url: 'http://127.0.0.1:1', query: '{ hello }' })
    expect(result.error).toBeTruthy()
  })
})

// ─── introspect ───────────────────────────────────────────────
describe('graphql.engine — introspect', () => {
  it('returns type list including Query', async () => {
    const result = await introspect(httpUrl())
    expect(result.queryType).toBe('Query')
    expect(Array.isArray(result.types)).toBe(true)
    expect(result.types.map((t) => t.name)).toContain('Query')
  })

  it('subscriptionType is populated', async () => {
    const result = await introspect(httpUrl())
    expect(result.subscriptionType).toBe('Subscription')
  })

  it('throws on network failure', async () => {
    await expect(introspect('http://127.0.0.1:1')).rejects.toThrow()
  })
})

// ─── subscribe / unsubscribe ──────────────────────────────────
describe('graphql.engine — subscribe', () => {
  it('returns a non-empty subscriptionId', () => {
    const id = subscribe({ url: httpUrl(), wsUrl: wsUrl(), query: 'subscription { greet }' }, 1)
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    unsubscribe(id)
  })

  it('delivers a data event to BrowserWindow.webContents.send', async () => {
    subscribe({ url: httpUrl(), wsUrl: wsUrl(), query: 'subscription { greet }' }, 1)
    await waitFor(() => sentEvents.some((e) => (e.payload as any)?.type === 'data'))
    const payload = sentEvents.find((e) => (e.payload as any)?.type === 'data')!.payload as any
    expect(payload.data).toContain('Hello, world!')
  })

  it('fires a complete event after the subscription finishes', async () => {
    subscribe({ url: httpUrl(), wsUrl: wsUrl(), query: 'subscription { greet }' }, 1)
    await waitFor(() => sentEvents.some((e) => (e.payload as any)?.type === 'complete'))
    expect(sentEvents.some((e) => (e.payload as any)?.type === 'complete')).toBe(true)
  })

  it('fires an error event for invalid JSON variables', async () => {
    subscribe(
      {
        url: httpUrl(),
        wsUrl: wsUrl(),
        query: 'subscription { greet }',
        variables: '{bad json}',
      },
      1,
    )
    await waitFor(() => sentEvents.some((e) => (e.payload as any)?.type === 'error'))
    const errPayload = sentEvents.find((e) => (e.payload as any)?.type === 'error')!
      .payload as any
    expect(errPayload.error).toMatch(/Invalid JSON/i)
  })
})

describe('graphql.engine — unsubscribe / unsubscribeAll', () => {
  it('unsubscribe returns false for an unknown id', () => {
    expect(unsubscribe('does-not-exist')).toBe(false)
  })

  it('unsubscribeAll is a no-op when no subscriptions are active', () => {
    expect(() => unsubscribeAll()).not.toThrow()
  })
})
