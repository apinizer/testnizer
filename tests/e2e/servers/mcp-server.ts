/**
 * e2e MCP server on the v2 SDK (issue #152): `createMcpHandler` +
 * `toNodeHandler`. With the default `legacy: 'stateless'` ONE URL serves both
 * protocol eras — 2026-07-28 (`server/discover`, per-request envelope,
 * `subscriptions/listen`, multi-round-trip `input_required`) and the 2025-era
 * `initialize` handshake (stateless: no session id, GET/DELETE → 405).
 * `legacy: 'reject'` makes it modern-only.
 *
 * Tools: echo, add, echo_headers, notify, ask_count (MRTR). Resources:
 * test://greeting, test://pixel.png, test://item/{id}. Prompt: summarize.
 * The pre-#152 stateful v1 server lives on in `mcp-server-v1.ts`.
 */
import http from 'node:http'
import {
  McpServer as McpSdkServer,
  ResourceTemplate,
  acceptedContent,
  createMcpHandler,
  createRequestStateCodec,
  inputRequired,
  type McpHttpHandler,
} from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { z } from 'zod'

export interface McpServer {
  port: number
  url: string
  close: () => Promise<void>
}

export interface McpServerOptions {
  /** How 2025-era traffic is served (`createMcpHandler`'s option). Default `'stateless'`. */
  legacy?: 'stateless' | 'reject'
  /**
   * When set, every `/mcp` request without `Authorization: Bearer <token>` is
   * answered `401` with a `WWW-Authenticate: Bearer` challenge (401-detection
   * wire tests).
   */
  bearerToken?: string
}

/** 1×1 transparent PNG — a binary (`blob`) resource for the Resources tab. */
const PIXEL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** `ask_count` state between rounds; HMAC-sealed by the codec (spec: MRTR integrity MUST). */
interface AskCountState {
  step: 'awaiting-count'
  label: string
}

const COUNT_SCHEMA = z.object({ count: z.number() })

const askCountState = createRequestStateCodec<AskCountState>({
  // ≥ 32 bytes; a fixed test key — every round of a flow hits this process.
  key: 'testnizer-e2e-mcp-request-state-key-0123456789abcdef',
})

function createMcpServer(era: 'legacy' | 'modern', handler: () => McpHttpHandler): McpSdkServer {
  // `logging` must be declared or the SDK server refuses to send
  // `notifications/message`.
  const server = new McpSdkServer(
    { name: 'testnizer-e2e-mcp', version: '1.0.0' },
    {
      capabilities: { logging: {} },
      instructions: 'Testnizer e2e MCP server — tools, resources and prompts for UI tests.',
      requestState: { verify: askCountState.verify },
    },
  )

  server.registerTool(
    'echo',
    {
      description: 'Echo input',
      inputSchema: z.object({ text: z.string().optional() }),
    },
    async ({ text }) => ({
      content: [{ type: 'text', text: String(text ?? 'ok') }],
    }),
  )

  server.registerTool(
    'add',
    {
      description: 'Add two numbers',
      inputSchema: z.object({ a: z.number().optional(), b: z.number().optional() }),
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
      inputSchema: z.object({}),
    },
    async (_args, ctx) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(Object.fromEntries(ctx.http?.req?.headers.entries() ?? [])),
        },
      ],
    }),
  )

  // Issue #139: exercises the client's notification / frame stream. Logging
  // and progress ride this call's own SSE response stream (deterministic).
  // tools/list_changed: on the 2025 era it rides the same stream; on
  // 2026-07-28 change notifications only travel on `subscriptions/listen`
  // streams, so it is published on the handler's bus.
  server.registerTool(
    'notify',
    {
      title: 'Notify',
      description:
        'Emit a logging message, progress notifications and tools/list_changed, then return',
      inputSchema: z.object({ steps: z.number().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ steps }, ctx) => {
      const total = Math.max(1, Math.min(10, Number(steps ?? 2)))
      const progressToken = ctx.mcpReq._meta?.progressToken
      await ctx.mcpReq.notify({
        method: 'notifications/message',
        params: { level: 'info', logger: 'e2e', data: 'notify tool started' },
      })
      if (progressToken !== undefined) {
        for (let i = 1; i <= total; i++) {
          await ctx.mcpReq.notify({
            method: 'notifications/progress',
            params: { progressToken, progress: i, total, message: `step ${i}/${total}` },
          })
        }
      }
      if (era === 'modern') handler().notify.toolsChanged()
      else await ctx.mcpReq.notify({ method: 'notifications/tools/list_changed' })
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

  // Issue #152: 2026-07-28 multi-round-trip. Round 1 answers `input_required`
  // with an embedded form elicitation + sealed state; round 2 reads the
  // accepted `count` from `inputResponses`. (On a 2025-era connection the
  // SDK's legacy shim would turn this into an `elicitation/create` request.)
  server.registerTool(
    'ask_count',
    {
      description: 'Ask the client how many items (multi-round-trip elicitation)',
      inputSchema: z.object({ label: z.string().optional() }),
    },
    async ({ label }, ctx) => {
      const state = ctx.mcpReq.requestState<AskCountState>()
      if (state?.step !== 'awaiting-count') {
        const what = label ?? 'items'
        return inputRequired({
          inputRequests: {
            count: inputRequired.elicit({
              message: `How many ${what}?`,
              requestedSchema: COUNT_SCHEMA,
            }),
          },
          requestState: await askCountState.mint({ step: 'awaiting-count', label: what }),
        })
      }
      const accepted = acceptedContent(ctx.mcpReq.inputResponses, 'count', COUNT_SCHEMA)
      if (!accepted) {
        return { content: [{ type: 'text', text: 'no count given' }], isError: true }
      }
      return { content: [{ type: 'text', text: `${accepted.count} ${state.label}` }] }
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
      argsSchema: z.object({ text: z.string().describe('Text to summarize') }),
    },
    ({ text }) => ({
      description: 'Summarize prompt',
      messages: [{ role: 'user', content: { type: 'text', text: `Please summarize:\n\n${text}` } }],
    }),
  )

  return server
}

/** MCP Streamable HTTP test server serving the 2026-07-28 and (unless `legacy: 'reject'`) 2025 eras. */
export async function startMcpServer(port: number, opts: McpServerOptions = {}): Promise<McpServer> {
  const handler: McpHttpHandler = createMcpHandler(
    (ctx) => createMcpServer(ctx.era, () => handler),
    { legacy: opts.legacy ?? 'stateless' },
  )
  const nodeHandler = toNodeHandler(handler)

  const server = http.createServer((req, res) => {
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

    if (opts.bearerToken && req.headers.authorization !== `Bearer ${opts.bearerToken}`) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="testnizer-e2e-mcp"',
      })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }

    nodeHandler(req, res).catch(() => {
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
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })

  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await handler.close().catch(() => {})
      await new Promise<void>((resolve, reject) => {
        // Drop live SSE / keep-alive sockets too — otherwise close() waits out
        // the 5 s keepAliveTimeout (open listen / GET streams).
        server.closeAllConnections()
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}
