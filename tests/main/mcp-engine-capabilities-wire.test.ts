/**
 * Issue #139 — Postman-parity MCP client surface, ON THE WIRE.
 *
 * Runs the REAL SDK 2.x client (`@modelcontextprotocol/client`, through the
 * engine) against real servers: the e2e Streamable HTTP server
 * (`tests/e2e/servers/mcp-server.ts`, v2 SDK — tools + resources + a resource
 * template + a prompt + a `notify` tool emitting logging / progress /
 * tools/list_changed) in BOTH protocol eras (issue #152), a tools-only legacy
 * SSE server (v1 SDK server — the legacy transport), and inline stdio stubs.
 *
 * Pins the SDK behaviour the engine relies on:
 *   - the http fetch-middleware tap sees the handshake on both eras
 *     (`initialize`, or the `server/discover` probe whose reply the SDK's
 *     probe window keeps from `onmessage`);
 *   - `Protocol.connect` chains a pre-set `transport.onmessage` (stdio tap);
 *   - `notifications/progress` (pre-registered by the SDK's Protocol, so it
 *     would shadow `fallbackNotificationHandler`) still reaches the renderer;
 *   - on 2026-07-28, list_changed arrives on the `subscriptions/listen` stream.
 */
import http from 'node:http'
import net from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/client'
import { startMcpServer } from '../e2e/servers/mcp-server'
import {
  mcpConnect,
  mcpCallTool,
  mcpDisconnect,
  mcpListTools,
  mcpListResources,
  mcpReadResource,
  mcpListPrompts,
  mcpGetPrompt,
  setMcpEventSink,
  type McpEngineEvent,
  type McpFrameEvent,
  type McpNotificationEvent,
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

/** Tools-only legacy MCP-over-SSE server (no resources / prompts capability). */
async function startToolsOnlySseServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const port = await freePort()
  const transports = new Map<string, SSEServerTransport>()
  const server = http.createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    if (req.method === 'GET' && path === '/sse') {
      const transport = new SSEServerTransport('/messages', res)
      transports.set(transport.sessionId, transport)
      transport.onclose = () => transports.delete(transport.sessionId)
      const mcp = new McpServer({ name: 'tools-only-sse', version: '1.0.0' })
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
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/**
 * Inline stdio MCP stub (newline-delimited JSON-RPC). Negotiates the OLD
 * `2024-11-05` protocol so the test proves the reported version is the
 * negotiated one, not the client's LATEST. Tools: `env` (reports
 * TESTNIZER_139 + whether PATH survived) and `exit` (replies, then exits).
 */
const STDIO_STUB = `
const rl = require('readline').createInterface({ input: process.stdin })
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
rl.on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.method === 'initialize') {
    return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05',
      capabilities: { tools: {} }, serverInfo: { name: 'stdio-139', version: '0.0.1' } } })
  }
  if (m.method === 'tools/list') {
    return send({ jsonrpc: '2.0', id: m.id, result: { tools: [
      { name: 'env', inputSchema: { type: 'object' } },
      { name: 'exit', inputSchema: { type: 'object' } } ] } })
  }
  if (m.method === 'tools/call' && m.params.name === 'env') {
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify({
      custom: process.env.TESTNIZER_139 ?? null, hasPath: Boolean(process.env.PATH) }) }] } })
  }
  if (m.method === 'tools/call' && m.params.name === 'exit') {
    send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'bye' }] } })
    setTimeout(() => process.exit(0), 20)
    return
  }
  if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } })
})
`

let events: McpEngineEvent[] = []
const cleanups: Array<() => Promise<void>> = []

beforeEach(() => {
  events = []
  setMcpEventSink((e) => events.push(e))
})

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!().catch(() => {})
  setMcpEventSink(null)
})

function framesFor(connectionId: string): McpFrameEvent[] {
  return events.flatMap((e) =>
    e.type === 'frame' && e.payload.connectionId === connectionId ? [e.payload] : [],
  )
}

function notificationsFor(connectionId: string): McpNotificationEvent[] {
  return events.flatMap((e) =>
    e.type === 'notification' && e.payload.connectionId === connectionId ? [e.payload] : [],
  )
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!pred()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

type Era = 'legacy' | 'modern'

/**
 * Issue #152: the e2e server (v2 SDK, `legacy: 'stateless'`) serves both
 * eras from one URL. `'legacy'` → 2025 `initialize`; `'auto'` → the client
 * probes `server/discover` and lands on 2026-07-28.
 */
const ERAS: Array<{ era: Era; protocol: 'legacy' | 'auto' }> = [
  { era: 'legacy', protocol: 'legacy' },
  { era: 'modern', protocol: 'auto' },
]

async function connectHttp(protocol: 'legacy' | 'auto'): Promise<{
  connectionId: string
  info: Awaited<ReturnType<typeof mcpConnect>>
}> {
  const srv = await startMcpServer(await freePort())
  cleanups.push(srv.close)
  const info = await mcpConnect({ transport: 'http', url: srv.url, protocol })
  cleanups.push(() => mcpDisconnect(info.connectionId))
  return { connectionId: info.connectionId, info }
}

describe.each(ERAS)(
  'mcp.engine — Streamable HTTP on the wire, $era era (issue #139, #152)',
  ({ era, protocol }) => {
    it('connect reports era, negotiated protocolVersion, capabilities and instructions', async () => {
      const { info } = await connectHttp(protocol)
      expect(info.era).toBe(era)
      expect(info.protocolVersion).toBe(era === 'modern' ? '2026-07-28' : LATEST_PROTOCOL_VERSION)
      expect(info.capabilities).toMatchObject({
        tools: expect.any(Object),
        resources: expect.any(Object),
        prompts: expect.any(Object),
        logging: expect.any(Object),
      })
      expect(info.instructions).toMatch(/Testnizer e2e MCP server/)
      expect(info.serverName).toBe('testnizer-e2e-mcp')
      if (era === 'modern') {
        expect(info.discover).toMatchObject({
          supportedVersions: expect.arrayContaining(['2026-07-28']),
        })
        expect(info.subscription?.honoredFilter).toMatchObject({ toolsListChanged: true })
      } else {
        expect(info).not.toHaveProperty('discover')
        expect(info).not.toHaveProperty('subscription')
      }
    })

    it('lists and reads resources, including a templated one and a binary blob', async () => {
      const { connectionId } = await connectHttp(protocol)
      const list = await mcpListResources(connectionId)
      expect(list.resources).toEqual(
        expect.arrayContaining([
          {
            uri: 'test://greeting',
            name: 'greeting',
            title: 'Greeting',
            description: 'A static text resource',
            mimeType: 'text/plain',
          },
          expect.objectContaining({ uri: 'test://pixel.png', mimeType: 'image/png' }),
        ]),
      )
      expect(list.templates).toEqual([
        {
          uriTemplate: 'test://item/{id}',
          name: 'item',
          title: 'Item by id',
          description: 'Templated resource',
          mimeType: 'application/json',
        },
      ])

      const greeting = await mcpReadResource(connectionId, 'test://greeting')
      expect(greeting).toEqual({
        contents: [
          { uri: 'test://greeting', mimeType: 'text/plain', text: 'Hello from Testnizer' },
        ],
      })
      const item = await mcpReadResource(connectionId, 'test://item/42')
      expect(JSON.parse(item.contents[0].text ?? '')).toEqual({ id: '42' })
      const pixel = await mcpReadResource(connectionId, 'test://pixel.png')
      expect(pixel.contents[0].blob).toMatch(/^iVBORw0KGgo/)
      expect(pixel.contents[0].text).toBeUndefined()
    })

    it('lists prompts with their arguments and renders one', async () => {
      const { connectionId } = await connectHttp(protocol)
      const prompts = await mcpListPrompts(connectionId)
      expect(prompts).toEqual([
        {
          name: 'summarize',
          title: 'Summarize',
          description: 'Summarize the given text',
          arguments: [{ name: 'text', description: 'Text to summarize', required: true }],
        },
      ])
      const rendered = await mcpGetPrompt(connectionId, 'summarize', { text: 'hello world' })
      expect(rendered).toEqual({
        description: 'Summarize prompt',
        messages: [
          { role: 'user', content: { type: 'text', text: 'Please summarize:\n\nhello world' } },
        ],
      })
    })

    it('listTools passes title / annotations through', async () => {
      const { connectionId } = await connectHttp(protocol)
      const tools = await mcpListTools(connectionId)
      const notify = tools.find((t) => t.name === 'notify')
      expect(notify).toMatchObject({ title: 'Notify', annotations: { readOnlyHint: true } })
      expect(tools.map((t) => t.name)).toEqual(
        expect.arrayContaining(['echo', 'add', 'echo_headers', 'notify', 'ask_count']),
      )
    })

    it('server notifications (logging, progress, tools/list_changed) arrive tagged with their connectionId', async () => {
      const { connectionId } = await connectHttp(protocol)
      const result = (await mcpCallTool(connectionId, 'notify', { steps: 2 })) as {
        content: Array<{ text: string }>
      }
      // The tool saw a progressToken → the engine asked for progress.
      expect(result.content[0].text).toBe('notified (2 steps, progress on)')

      // Modern: list_changed travels on the subscriptions/listen stream (after
      // its ack), not on the call's own stream — so it may land after the result.
      await waitFor(() =>
        notificationsFor(connectionId).some((n) => n.method === 'notifications/tools/list_changed'),
      )
      const notes = notificationsFor(connectionId).filter(
        (n) => n.method !== 'notifications/subscriptions/acknowledged',
      )
      expect(notes.map((n) => n.method)).toEqual([
        'notifications/message',
        'notifications/progress',
        'notifications/progress',
        'notifications/tools/list_changed',
      ])
      expect(notes[0].params).toMatchObject({
        level: 'info',
        logger: 'e2e',
        data: 'notify tool started',
      })
      expect(notes[2].params).toMatchObject({ progress: 2, total: 2, message: 'step 2/2' })
      expect(notes.every((n) => typeof n.ts === 'number')).toBe(true)
      if (era === 'modern') {
        expect(notes[3].params).toMatchObject({
          _meta: { 'io.modelcontextprotocol/subscriptionId': expect.any(String) },
        })
        expect(notificationsFor(connectionId)[0].method).toBe(
          'notifications/subscriptions/acknowledged',
        )
      }
    })

    it('two live connections never cross-tag their events (issue #76 class)', async () => {
      const a = await connectHttp(protocol)
      const b = await connectHttp(protocol)
      await mcpCallTool(a.connectionId, 'notify', { steps: 1 })
      await waitFor(() =>
        notificationsFor(a.connectionId).some(
          (n) => n.method === 'notifications/tools/list_changed',
        ),
      )
      const own = (id: string): McpNotificationEvent[] =>
        notificationsFor(id).filter((n) => n.method !== 'notifications/subscriptions/acknowledged')
      expect(own(a.connectionId).length).toBe(3)
      expect(own(b.connectionId)).toEqual([])
    })

    it('frames include the handshake (initialize, or server/discover + listen) and tools/list → result', async () => {
      const { connectionId } = await connectHttp(protocol)
      await mcpListTools(connectionId)
      await waitFor(() =>
        framesFor(connectionId).some(
          (f) =>
            f.direction === 'in' &&
            isObj(f.message) &&
            isObj(f.message.result) &&
            'tools' in f.message.result,
        ),
      )
      const frames = framesFor(connectionId)
      const msgs = frames.map((f) => ({
        dir: f.direction,
        m: f.message as Record<string, unknown>,
      }))

      const handshakeMethod = era === 'modern' ? 'server/discover' : 'initialize'
      const hsReq = msgs.find((x) => x.dir === 'out' && x.m.method === handshakeMethod)
      expect(hsReq).toBeDefined()
      const hsRes = msgs.find((x) => x.dir === 'in' && x.m.id === hsReq!.m.id)
      if (era === 'modern') {
        expect(hsRes?.m.result).toMatchObject({
          supportedVersions: expect.arrayContaining(['2026-07-28']),
        })
        expect(msgs.some((x) => x.dir === 'out' && x.m.method === 'initialize')).toBe(false)
        expect(msgs.some((x) => x.dir === 'out' && x.m.method === 'subscriptions/listen')).toBe(
          true,
        )
      } else {
        expect(hsRes?.m.result).toMatchObject({
          protocolVersion: LATEST_PROTOCOL_VERSION,
          serverInfo: { name: 'testnizer-e2e-mcp' },
        })
        expect(
          msgs.some((x) => x.dir === 'out' && x.m.method === 'notifications/initialized'),
        ).toBe(true)
        expect(msgs.some((x) => x.dir === 'out' && x.m.method === 'server/discover')).toBe(false)
      }

      const listReq = msgs.find((x) => x.dir === 'out' && x.m.method === 'tools/list')
      expect(listReq).toBeDefined()
      const listRes = msgs.find((x) => x.dir === 'in' && x.m.id === listReq!.m.id)
      expect(listRes?.m.result).toMatchObject({ tools: expect.any(Array) })

      // Order: the handshake request precedes its result, which precedes tools/list.
      expect(msgs.indexOf(hsReq!)).toBeLessThan(msgs.indexOf(hsRes!))
      expect(msgs.indexOf(hsRes!)).toBeLessThan(msgs.indexOf(listReq!))
    })

    it('user disconnect → connectionClosed without a reason', async () => {
      const { connectionId } = await connectHttp(protocol)
      await mcpDisconnect(connectionId)
      await waitFor(() => events.some((e) => e.type === 'connectionClosed'))
      const closed = events.filter((e) => e.type === 'connectionClosed')
      expect(closed).toEqual([{ type: 'connectionClosed', payload: { connectionId } }])
      // A local close of the listen stream is not reported as a subscription end.
      expect(
        events.filter((e) => e.type === 'subscriptionState' && e.payload.state === 'closed'),
      ).toEqual([])
    })
  },
)

describe('mcp.engine — legacy SSE without resources / prompts (issue #139)', () => {
  it('missing capabilities → empty lists, not errors; protocolVersion recovered from the initialize frame', async () => {
    const srv = await startToolsOnlySseServer()
    cleanups.push(srv.close)
    const info = await mcpConnect({ transport: 'sse', url: srv.url })
    cleanups.push(() => mcpDisconnect(info.connectionId))

    // SSEClientTransport keeps the version private (sse.d.ts:64) — the frame tap recovers it.
    expect(info.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
    expect(info.capabilities).toHaveProperty('tools')
    expect(info.capabilities).not.toHaveProperty('resources')
    await expect(mcpListResources(info.connectionId)).resolves.toEqual({
      resources: [],
      templates: [],
    })
    await expect(mcpListPrompts(info.connectionId)).resolves.toEqual([])
  })
})

describe('mcp.engine — stdio on the wire (issue #139)', () => {
  it('reports the negotiated (older) protocolVersion and merges env over the default env', async () => {
    const info = await mcpConnect({
      transport: 'stdio',
      url: '',
      command: process.execPath,
      args: ['-e', STDIO_STUB],
      env: { TESTNIZER_139: 'env-ok' },
    })
    cleanups.push(() => mcpDisconnect(info.connectionId))

    // StdioClientTransport has no setProtocolVersion at all — the frame tap is the only source.
    expect(info.protocolVersion).toBe('2024-11-05')
    expect(info.serverName).toBe('stdio-139')

    const res = (await mcpCallTool(info.connectionId, 'env', {})) as {
      content: Array<{ text: string }>
    }
    expect(JSON.parse(res.content[0].text)).toEqual({ custom: 'env-ok', hasPath: true })
  })

  it('server process exit → connectionClosed with a reason', async () => {
    const info = await mcpConnect({
      transport: 'stdio',
      url: '',
      command: process.execPath,
      args: ['-e', STDIO_STUB],
    })
    cleanups.push(() => mcpDisconnect(info.connectionId))
    await mcpCallTool(info.connectionId, 'exit', {})
    await waitFor(() => events.some((e) => e.type === 'connectionClosed'))
    const closed = events.find((e) => e.type === 'connectionClosed')
    expect(closed?.payload).toEqual({
      connectionId: info.connectionId,
      reason: 'Server process exited',
    })
    await expect(mcpListTools(info.connectionId)).rejects.toThrow(/Not connected/)
  })
})
