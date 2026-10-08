/**
 * Issue #137 — custom MCP connect headers must reach the server ON THE WIRE.
 *
 * Unlike `mcp-engine.test.ts` (SDK mocked), this suite runs the REAL
 * `@modelcontextprotocol/sdk` client against real local servers. It pins the
 * SDK behaviour the engine relies on: `requestInit.headers` is applied to the
 * SSE transport's GET EventSource stream as well as its POSTs, and to every
 * Streamable HTTP request. Older SDKs applied `requestInit` to POST only — if
 * an SDK upgrade regresses that, the GET-stream assertion here fails instead
 * of a gateway rejecting the handshake in the field.
 */
import http from 'node:http'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { startMcpServer } from '../e2e/servers/mcp-server'
import { mcpConnect, mcpCallTool, mcpDisconnect } from '../../src/main/protocols/mcp.engine'

const CUSTOM = {
  Authorization: 'Bearer wire-token-137',
  'X-Gateway-Project': 'project1',
}

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

interface SeenRequest {
  method: string
  path: string
  headers: http.IncomingHttpHeaders
}

/** Legacy MCP-over-SSE server that records every request's headers. */
async function startSseServer(): Promise<{
  url: string
  seen: SeenRequest[]
  close: () => Promise<void>
}> {
  const port = await freePort()
  const seen: SeenRequest[] = []
  const transports = new Map<string, SSEServerTransport>()
  const server = http.createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    seen.push({ method: req.method ?? '', path, headers: req.headers })
    if (req.method === 'GET' && path === '/sse') {
      const transport = new SSEServerTransport('/messages', res)
      transports.set(transport.sessionId, transport)
      transport.onclose = () => transports.delete(transport.sessionId)
      const mcp = new McpServer({ name: 'wire-sse', version: '1.0.0' })
      mcp.registerTool('ping', { description: 'pong', inputSchema: {} }, async () => ({
        content: [{ type: 'text', text: 'pong' }],
      }))
      await mcp.connect(transport)
      return
    }
    if (req.method === 'POST' && path === '/messages') {
      const sid = new URL(req.url ?? '', `http://127.0.0.1:${port}`).searchParams.get('sessionId')
      const t = sid ? transports.get(sid) : undefined
      if (t) {
        await t.handlePostMessage(req, res)
        return
      }
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()))
  return {
    url: `http://127.0.0.1:${port}/sse`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!().catch(() => {})
})

describe('mcp.engine — custom headers on the wire (issue #137)', () => {
  it('sse: custom headers reach the GET EventSource handshake AND the POSTs', async () => {
    const srv = await startSseServer()
    cleanups.push(srv.close)

    const info = await mcpConnect({ transport: 'sse', url: srv.url, headers: CUSTOM })
    cleanups.push(() => mcpDisconnect(info.connectionId))
    await mcpCallTool(info.connectionId, 'ping', {})

    const gets = srv.seen.filter((r) => r.method === 'GET' && r.path === '/sse')
    const posts = srv.seen.filter((r) => r.method === 'POST' && r.path === '/messages')
    expect(gets.length).toBeGreaterThan(0)
    expect(posts.length).toBeGreaterThan(0)
    for (const r of [...gets, ...posts]) {
      expect(r.headers.authorization).toBe('Bearer wire-token-137')
      expect(r.headers['x-gateway-project']).toBe('project1')
    }
  })

  it('http (Streamable HTTP): custom headers reach the server on tools/call', async () => {
    const port = await freePort()
    const srv = await startMcpServer(port)
    cleanups.push(srv.close)

    const info = await mcpConnect({ transport: 'http', url: srv.url, headers: CUSTOM })
    cleanups.push(() => mcpDisconnect(info.connectionId))
    const result = (await mcpCallTool(info.connectionId, 'echo_headers', {})) as {
      content: Array<{ type: string; text: string }>
    }
    const seen = JSON.parse(result.content[0].text) as Record<string, string>
    expect(seen.authorization).toBe('Bearer wire-token-137')
    expect(seen['x-gateway-project']).toBe('project1')
  })

  it('http: without custom headers nothing extra is sent', async () => {
    const port = await freePort()
    const srv = await startMcpServer(port)
    cleanups.push(srv.close)

    const info = await mcpConnect({ transport: 'http', url: srv.url })
    cleanups.push(() => mcpDisconnect(info.connectionId))
    const result = (await mcpCallTool(info.connectionId, 'echo_headers', {})) as {
      content: Array<{ type: string; text: string }>
    }
    const seen = JSON.parse(result.content[0].text) as Record<string, string>
    expect(seen.authorization).toBeUndefined()
    expect(seen['x-gateway-project']).toBeUndefined()
  })
})
