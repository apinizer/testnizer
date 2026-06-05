import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer as McpSdkServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

export interface McpServer {
  port: number
  url: string
  close: () => Promise<void>
}

function createMcpServer(): McpSdkServer {
  const server = new McpSdkServer({ name: 'testnizer-e2e-mcp', version: '1.0.0' })

  server.registerTool(
    'echo',
    {
      description: 'Echo input',
      inputSchema: { text: z.string().optional() },
    },
    async ({ text }) => ({
      content: [{ type: 'text', text: String(text ?? 'ok') }],
    }),
  )

  server.registerTool(
    'add',
    {
      description: 'Add two numbers',
      inputSchema: { a: z.number().optional(), b: z.number().optional() },
    },
    async ({ a, b }) => ({
      content: [{ type: 'text', text: String(Number(a ?? 0) + Number(b ?? 0)) }],
    }),
  )

  return server
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  return JSON.parse(raw) as unknown
}

function isInitBody(body: unknown): boolean {
  if (isInitializeRequest(body)) return true
  return Array.isArray(body) && body.some((item) => isInitializeRequest(item))
}

/** MCP Streamable HTTP test server compatible with @modelcontextprotocol/sdk client. */
export async function startMcpServer(port: number): Promise<McpServer> {
  const transports = new Map<string, StreamableHTTPServerTransport>()

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', protocol: 'mcp', port }))
      return
    }

    const path = req.url?.split('?')[0]
    if (path !== '/mcp') {
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

        if (!sessionId && isInitBody(body)) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              transports.set(sid, transport)
            },
          })
          transport.onclose = () => {
            const sid = transport.sessionId
            if (sid) transports.delete(sid)
          }
          const mcp = createMcpServer()
          await mcp.connect(transport)
          await transport.handleRequest(req, res, body)
          return
        }

        if (sessionId) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32_001, message: 'Session not found' },
              id: null,
            }),
          )
          return
        }

        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32_000, message: 'Bad Request' },
            id: null,
          }),
        )
        return
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        if (!sessionId || !transports.has(sessionId)) {
          res.writeHead(404)
          res.end('Session not found')
          return
        }
        await transports.get(sessionId)!.handleRequest(req, res)
        return
      }

      res.writeHead(405)
      res.end()
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32_603, message: 'Internal server error' },
            id: null,
          }),
        )
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })

  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
