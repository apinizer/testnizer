import http from 'node:http'
import { randomUUID } from 'node:crypto'
import {
  McpServer as McpSdkServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

export interface McpServer {
  port: number
  url: string
  close: () => Promise<void>
}

/** 1×1 transparent PNG — a binary (`blob`) resource for the Resources tab. */
const PIXEL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function createMcpServer(): McpSdkServer {
  // `logging` must be declared or the SDK server refuses to send
  // `notifications/message` (server/index.js assertNotificationCapability).
  const server = new McpSdkServer(
    { name: 'testnizer-e2e-mcp', version: '1.0.0' },
    {
      capabilities: { logging: {} },
      instructions: 'Testnizer e2e MCP server — tools, resources and prompts for UI tests.',
    },
  )

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

  // Issue #137: returns the HTTP headers of the request that carried this
  // tools/call, so a test can prove a custom MCP connect header reached the
  // server (the client sends its custom headers on every request).
  server.registerTool(
    'echo_headers',
    {
      description: 'Return the HTTP request headers seen by the server',
      inputSchema: {},
    },
    async (_args, extra) => ({
      content: [{ type: 'text', text: JSON.stringify(extra.requestInfo?.headers ?? {}) }],
    }),
  )

  // Issue #139: exercises the client's notification / frame stream. All three
  // notifications are request-related, so they ride this call's own SSE
  // response stream (deterministic) instead of the standalone GET stream.
  // Progress is only sent when the call carries a progressToken (Testnizer's
  // client always attaches one).
  server.registerTool(
    'notify',
    {
      title: 'Notify',
      description:
        'Emit a logging message, progress notifications and tools/list_changed, then return',
      inputSchema: { steps: z.number().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ steps }, extra) => {
      const total = Math.max(1, Math.min(10, Number(steps ?? 2)))
      const progressToken = extra._meta?.progressToken
      await extra.sendNotification({
        method: 'notifications/message',
        params: { level: 'info', logger: 'e2e', data: 'notify tool started' },
      })
      if (progressToken !== undefined) {
        for (let i = 1; i <= total; i++) {
          await extra.sendNotification({
            method: 'notifications/progress',
            params: { progressToken, progress: i, total, message: `step ${i}/${total}` },
          })
        }
      }
      await extra.sendNotification({ method: 'notifications/tools/list_changed' })
      return {
        content: [
          {
            type: 'text',
            text: `notified (${total} steps, progress ${progressToken !== undefined ? 'on' : 'off'})`,
          },
        ],
      }
    },
  )

  // ─── Resources (issue #139) ────────────────────────────────
  server.registerResource(
    'greeting',
    'test://greeting',
    { title: 'Greeting', description: 'A static text resource', mimeType: 'text/plain' },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'Hello from Testnizer' }],
    }),
  )

  server.registerResource(
    'pixel',
    'test://pixel.png',
    { title: 'Pixel', description: '1x1 PNG (binary resource)', mimeType: 'image/png' },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'image/png', blob: PIXEL_PNG_B64 }],
    }),
  )

  server.registerResource(
    'item',
    new ResourceTemplate('test://item/{id}', { list: undefined }),
    { title: 'Item by id', description: 'Templated resource', mimeType: 'application/json' },
    async (uri, { id }) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ id }) }],
    }),
  )

  // ─── Prompts (issue #139) ──────────────────────────────────
  server.registerPrompt(
    'summarize',
    {
      title: 'Summarize',
      description: 'Summarize the given text',
      argsSchema: { text: z.string().describe('Text to summarize') },
    },
    ({ text }) => ({
      description: 'Summarize prompt',
      messages: [{ role: 'user', content: { type: 'text', text: `Please summarize:\n\n${text}` } }],
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
        // Drop live SSE / keep-alive sockets too — otherwise close() waits out
        // the 5 s keepAliveTimeout when a client disconnected mid-handshake.
        server.closeAllConnections()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
