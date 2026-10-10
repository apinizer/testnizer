/**
 * Issue #154 — the `subscriptions/listen` step is part of the handshake.
 *
 * On a 2026-07-28 connection `mcpConnect` opens the listen stream AFTER
 * `client.connect()` resolved, which can take up to the 10 s ack timeout. The
 * pending entry used to be dropped before that step, so in that window a user
 * Cancel was a no-op and a transport close went unnoticed: the renderer got a
 * "connected" result for a connection that was already dead (and the engine
 * kept it in its connections map). Now Cancel tears the attempt down and a
 * close in that window fails the connect.
 *
 * Real SDK 2.x client against real servers: a gateway in front of the e2e
 * Streamable HTTP server that holds the listen request, and an inline stdio
 * 2026-07-28 stub that exits when it receives `subscriptions/listen`.
 */
import http from 'node:http'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { startMcpServer } from '../e2e/servers/mcp-server'
import {
  mcpCancelConnect,
  mcpConnect,
  mcpConnectionIds,
  mcpDisconnectAll,
} from '../../src/main/protocols/mcp.engine'

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  mcpDisconnectAll()
  while (cleanups.length) await cleanups.pop()!().catch(() => {})
})

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms),
    ),
  ])
}

/**
 * A gateway in front of `target` that HOLDS every `subscriptions/listen` POST
 * (never answers it) and proxies everything else, streaming responses.
 * `listenArrived` resolves when the listen request is in; `listenClosed` when
 * the client side of that request went away (transport torn down).
 */
async function listenHoldingGateway(target: string): Promise<{
  url: string
  listenArrived: Promise<void>
  listenClosed: Promise<void>
}> {
  const upstream = new URL(target)
  let arrived: () => void = () => {}
  let closed: () => void = () => {}
  const listenArrived = new Promise<void>((resolve) => (arrived = resolve))
  const listenClosed = new Promise<void>((resolve) => (closed = resolve))
  const gate = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      let method: unknown
      try {
        method = (JSON.parse(body.toString('utf8')) as { method?: unknown }).method
      } catch {
        method = undefined
      }
      if (method === 'subscriptions/listen') {
        res.on('close', () => closed())
        arrived()
        return
      }
      const up = http.request(
        {
          host: upstream.hostname,
          port: upstream.port,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (ur) => {
          res.writeHead(ur.statusCode ?? 502, ur.headers)
          ur.pipe(res)
        },
      )
      up.on('error', () => {
        if (!res.headersSent) res.writeHead(502)
        res.end()
      })
      up.end(body)
    })
  })
  const port = await freePort()
  await new Promise<void>((resolve) => gate.listen(port, '127.0.0.1', () => resolve()))
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        gate.closeAllConnections()
        gate.close(() => resolve())
      }),
  )
  return { url: `http://127.0.0.1:${port}${upstream.pathname}`, listenArrived, listenClosed }
}

/**
 * 2026-07-28 stdio server: answers `server/discover` (on every spawn — the
 * auto / pin probe runs on a sibling process) advertising list-changed
 * capabilities, so the engine opens a listen stream — and exits as soon as
 * `subscriptions/listen` arrives.
 */
const DYING_MODERN_STDIO = `
const rl = require('readline').createInterface({ input: process.stdin })
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
rl.on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.method === 'server/discover') {
    return send({ jsonrpc: '2.0', id: m.id, result: {
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: { listChanged: true } },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'dying-154', version: '0.0.1' } },
    } })
  }
  if (m.method === 'subscriptions/listen') process.exit(0)
  if (m.id === undefined) return
  send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } })
})
`

describe('mcp.engine — handshake window covers subscriptions/listen (issue #154)', () => {
  it('Cancel during a slow subscriptions/listen tears the attempt down instead of reporting connected', async () => {
    const target = await startMcpServer(await freePort())
    cleanups.push(target.close)
    const gate = await listenHoldingGateway(target.url)

    const pending = mcpConnect({
      transport: 'http',
      url: gate.url,
      protocol: '2026-07-28',
      pendingId: 'cw-1',
    })
    // Whatever happens, never leave the attempt running past the test.
    const settled = pending.then(
      () => 'connected' as const,
      (err: unknown) => err,
    )
    cleanups.push(async () => {
      await settled
    })

    await withTimeout(gate.listenArrived, 8_000, 'subscriptions/listen')
    // The handshake is still pending (the listen ack never comes) — Cancel must find it.
    await expect(mcpCancelConnect('cw-1')).resolves.toBe(true)

    const outcome = await withTimeout(settled, 5_000, 'mcpConnect to settle')
    expect(outcome).toBeInstanceOf(Error)
    expect((outcome as Error).message).toMatch(/cancelled/i)
    // The transport was closed: the held listen request's client side is gone.
    await withTimeout(gate.listenClosed, 5_000, 'the listen request to close')
    // Nothing registered.
    expect(mcpConnectionIds()).toEqual([])
    // The entry is gone too: a second Cancel finds nothing.
    await expect(mcpCancelConnect('cw-1')).resolves.toBe(false)
  })

  it('stdio: the server exiting during subscriptions/listen fails the connect', async () => {
    const outcome = await withTimeout(
      mcpConnect({
        transport: 'stdio',
        url: '',
        command: process.execPath,
        args: ['-e', DYING_MODERN_STDIO],
        protocol: '2026-07-28',
        pendingId: 'cw-2',
      }).then(
        () => 'connected' as const,
        (err: unknown) => err,
      ),
      15_000,
      'mcpConnect to settle',
    )
    expect(outcome).toBeInstanceOf(Error)
    expect((outcome as Error).message).toMatch(/closed/i)
    expect(mcpConnectionIds()).toEqual([])
    await expect(mcpCancelConnect('cw-2')).resolves.toBe(false)
  })
})
