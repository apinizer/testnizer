/**
 * Integration tests for `src/main/protocols/graphql.engine.ts`.
 *
 * Strategy:
 *   - `executeQuery` / `introspect`: in-process HTTP server (Node `http`) that
 *     handles the standard GraphQL-over-HTTP POST format.
 *
 * Coverage:
 *   - executeQuery: success, field-with-arg, timing, invalid variables JSON, network failure
 *   - introspect: type list, queryType, subscriptionType, network failure
 *
 * Subscriptions over WebSocket: `tests/main/graphql-ws-engine.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { buildSchema, parse, execute as gqlExecute } from 'graphql'

import { executeQuery, introspect } from '../../src/main/protocols/graphql.engine'

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

afterAll(async () => {
  await new Promise<void>((r) => httpServer.close(() => r()))
})

const httpUrl = () => `http://127.0.0.1:${httpPort}`

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
