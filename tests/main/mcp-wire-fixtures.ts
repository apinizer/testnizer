/**
 * Inline MCP servers for the engine wire tests (issues #163, #168): a
 * stateful 2025-era server on the v1 SDK and a both-eras server on the v2 SDK
 * (`createMcpHandler`), each taking a `register` callback so a test adds only
 * the tools it needs. Not a test file (no `.test.ts`), so vitest never runs it
 * on its own.
 */
import http from 'node:http'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { McpServer as McpServerV1 } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { McpServer as McpServerV2, createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'

export interface RunningServer {
  url: string
  close: () => Promise<void>
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

async function listen(server: http.Server): Promise<RunningServer> {
  const port = await freePort()
  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? (JSON.parse(raw) as unknown) : undefined
}

/**
 * Stateful 2025-era Streamable HTTP server on the v1 SDK (answers the
 * `server/discover` probe with HTTP 400, like every deployed 2025 server).
 * `register` runs once per session on that session's `McpServer`.
 */
export async function startV1Server(
  register: (server: McpServerV1) => void,
): Promise<RunningServer> {
  const transports = new Map<string, StreamableHTTPServerTransport>()
  const server = http.createServer(async (req, res) => {
    if (req.url?.split('?')[0] !== '/mcp') {
      res.writeHead(404)
      res.end()
      return
    }
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    try {
      if (req.method === 'POST') {
        const body = await readJsonBody(req)
        if (sessionId && transports.has(sessionId)) {
          await transports.get(sessionId)!.handleRequest(req, res, body)
          return
        }
        if (!sessionId && isInitializeRequest(body)) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              transports.set(sid, transport)
            },
          })
          transport.onclose = () => {
            if (transport.sessionId) transports.delete(transport.sessionId)
          }
          const mcp = new McpServerV1({ name: 'wire-v1', version: '1.0.0' })
          register(mcp)
          await mcp.connect(transport)
          await transport.handleRequest(req, res, body)
          return
        }
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request' },
            id: null,
          }),
        )
        return
      }
      if (
        (req.method === 'GET' || req.method === 'DELETE') &&
        sessionId &&
        transports.has(sessionId)
      ) {
        await transports.get(sessionId)!.handleRequest(req, res)
        return
      }
      res.writeHead(req.method === 'GET' || req.method === 'DELETE' ? 404 : 405)
      res.end()
    } catch {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }
  })
  const running = await listen(server)
  return {
    url: running.url,
    close: async () => {
      for (const t of transports.values()) await t.close().catch(() => {})
      await running.close()
    },
  }
}

/** Both-eras Streamable HTTP server on the v2 SDK (`createMcpHandler`, stateless legacy). */
export async function startV2Server(
  register: (server: McpServerV2) => void,
): Promise<RunningServer> {
  const handler = createMcpHandler(
    () => {
      const mcp = new McpServerV2({ name: 'wire-v2', version: '1.0.0' })
      register(mcp)
      return mcp
    },
    { legacy: 'stateless' },
  )
  const nodeHandler = toNodeHandler(handler)
  const server = http.createServer((req, res) => {
    if (req.url?.split('?')[0] !== '/mcp') {
      res.writeHead(404)
      res.end()
      return
    }
    nodeHandler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  const running = await listen(server)
  return {
    url: running.url,
    close: async () => {
      await handler.close().catch(() => {})
      await running.close()
    },
  }
}

/** Resolve after `ms`, or as soon as `signal` aborts. */
export function waitOrAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

export async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (!pred()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}
