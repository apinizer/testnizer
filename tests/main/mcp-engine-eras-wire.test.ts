/**
 * Issue #152 — protocol eras ON THE WIRE: the SDK 2.x client (through the
 * engine) against
 *   - `startMcpServerV1` (v1 SDK, stateful, 2025-11-25 `initialize` only),
 *   - `startMcpServer` (v2 SDK `createMcpHandler`, both eras from one URL),
 *   - `startMcpServer({ legacy: 'reject' })` (2026-07-28 only),
 *   - a bearer-protected `startMcpServer` (401 detection),
 *   - an inline stdio stub (legacy, rejects anything before `initialize`).
 * Covers negotiation modes, the era on the connect result, the
 * `subscriptions/listen` honoredFilter, and the multi-round-trip `ask_count`
 * round trip (`input_required` → `mcpRespondInput` → complete).
 */
import http from 'node:http'
import net from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startMcpServer } from '../e2e/servers/mcp-server'
import { startMcpServerV1 } from '../e2e/servers/mcp-server-v1'
import {
  mcpCallTool,
  mcpConnect,
  mcpDisconnect,
  mcpListTools,
  mcpRespondInput,
  setMcpEventSink,
  type McpEngineEvent,
  type McpFrameEvent,
  type McpInputRequiredMarker,
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

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!pred()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

function framesFor(connectionId: string): McpFrameEvent[] {
  return events.flatMap((e) =>
    e.type === 'frame' && e.payload.connectionId === connectionId ? [e.payload] : [],
  )
}

const methodOf = (f: McpFrameEvent): string | undefined => (f.message as { method?: string }).method

async function v1Server(): Promise<string> {
  const srv = await startMcpServerV1(await freePort())
  cleanups.push(srv.close)
  return srv.url
}

async function v2Server(opts?: Parameters<typeof startMcpServer>[1]): Promise<string> {
  const srv = await startMcpServer(await freePort(), opts)
  cleanups.push(srv.close)
  return srv.url
}

/**
 * A gateway in front of `target` that refuses the `server/discover` probe with
 * `status` (a WAF / method allowlist in front of a 2025 server) and proxies
 * everything else, streaming responses through.
 */
async function probeRefusingGateway(target: string, status: number): Promise<string> {
  const upstream = new URL(target)
  const port = await freePort()
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
      if (method === 'server/discover') {
        res.writeHead(status, { 'Content-Type': 'text/plain' })
        res.end('Refused by gateway')
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
  await new Promise<void>((resolve) => gate.listen(port, '127.0.0.1', () => resolve()))
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        gate.closeAllConnections()
        gate.close(() => resolve())
      }),
  )
  return `http://127.0.0.1:${port}${upstream.pathname}`
}

async function connect(
  options: Parameters<typeof mcpConnect>[0],
): Promise<Awaited<ReturnType<typeof mcpConnect>>> {
  const info = await mcpConnect(options)
  cleanups.push(() => mcpDisconnect(info.connectionId))
  return info
}

describe('version negotiation against 2024–2025 and 2026-07-28 servers (issue #152)', () => {
  it("v1 server + 'auto': the probe meets the 2025 server's 400, the client falls back to initialize 2025-11-25", async () => {
    const info = await connect({ transport: 'http', url: await v1Server() })
    expect(info.era).toBe('legacy')
    expect(info.protocolVersion).toBe('2025-11-25')
    expect(info).not.toHaveProperty('discover')
    expect(info).not.toHaveProperty('subscription')
    expect(await mcpListTools(info.connectionId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'echo' })]),
    )
    await waitFor(() => framesFor(info.connectionId).length >= 5)
    const frames = framesFor(info.connectionId)
    // probe out → the server's JSON-RPC error body in → initialize out
    expect(frames[0].direction).toBe('out')
    expect(methodOf(frames[0])).toBe('server/discover')
    expect(frames[1]).toMatchObject({ direction: 'in', message: { error: { code: -32000 } } })
    expect(methodOf(frames[2])).toBe('initialize')
    // The handshake's 400 is not reported as a transport error.
    expect(events.filter((e) => e.type === 'transportError')).toEqual([])
  })

  it.each([403, 500])(
    "a gateway refusing the probe with %i in front of a 2025 server: 'auto' retries the plain initialize handshake",
    async (status) => {
      const url = await probeRefusingGateway(await v1Server(), status)
      const info = await connect({ transport: 'http', url })
      expect(info.era).toBe('legacy')
      expect(info.protocolVersion).toBe('2025-11-25')
      expect((await mcpListTools(info.connectionId)).length).toBeGreaterThan(0)
      // One frame log for both attempts: the refused probe, then initialize.
      await waitFor(() => framesFor(info.connectionId).length >= 3)
      const methods = framesFor(info.connectionId).map(methodOf)
      expect(methods[0]).toBe('server/discover')
      expect(methods).toContain('initialize')
      expect(events.filter((e) => e.type === 'transportError')).toEqual([])
    },
  )

  it("v2 server + 'auto' → modern era, discover result, listen honoredFilter", async () => {
    const info = await connect({ transport: 'http', url: await v2Server() })
    expect(info).toMatchObject({
      era: 'modern',
      protocolVersion: '2026-07-28',
      serverName: 'testnizer-e2e-mcp',
      serverVersion: '1.0.0',
      discover: { supportedVersions: ['2026-07-28'] },
      subscription: {
        requested: { toolsListChanged: true, promptsListChanged: true, resourcesListChanged: true },
        honoredFilter: {
          toolsListChanged: true,
          promptsListChanged: true,
          resourcesListChanged: true,
        },
      },
    })
    await waitFor(() => events.some((e) => e.type === 'subscriptionState'))
    expect(events.find((e) => e.type === 'subscriptionState')?.payload).toMatchObject({
      connectionId: info.connectionId,
      state: 'open',
    })
    const methods = framesFor(info.connectionId).map(methodOf)
    expect(methods).toContain('server/discover')
    expect(methods).toContain('subscriptions/listen')
    expect(methods).not.toContain('initialize')
  })

  it("v2 server + 'legacy' → the plain 2025 initialize handshake, no probe", async () => {
    const info = await connect({ transport: 'http', url: await v2Server(), protocol: 'legacy' })
    expect(info.era).toBe('legacy')
    expect(info.protocolVersion).toBe('2025-11-25')
    await waitFor(() => framesFor(info.connectionId).length >= 3)
    const methods = framesFor(info.connectionId).map(methodOf)
    expect(methods[0]).toBe('initialize')
    expect(methods).not.toContain('server/discover')
  })

  it('a pinned 2025 revision makes initialize offer exactly that version', async () => {
    const info = await connect({
      transport: 'http',
      url: await v2Server(),
      protocol: '2025-06-18',
    })
    expect(info.era).toBe('legacy')
    expect(info.protocolVersion).toBe('2025-06-18')
  })

  it("modern-only server (legacy: 'reject') + client 'legacy' → a clear error naming the supported revision", async () => {
    const url = await v2Server({ legacy: 'reject' })
    const err = (await mcpConnect({ transport: 'http', url, protocol: 'legacy' }).catch(
      (e: unknown) => e,
    )) as Error & { status?: number }
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(400)
    expect(err.message).toBe(
      'HTTP 400: MCP error -32022: Unsupported protocol version: 2025-11-25 (server supports 2026-07-28)',
    )
    // 'auto' gets through.
    const info = await connect({ transport: 'http', url })
    expect(info.era).toBe('modern')
  })

  it('pin 2026-07-28 against a 2025-only server → EraNegotiationFailed, readable', async () => {
    const err = (await mcpConnect({
      transport: 'http',
      url: await v1Server(),
      protocol: '2026-07-28',
    }).catch((e: unknown) => e)) as Error & { code?: unknown }
    expect(err.code).toBe('ERA_NEGOTIATION_FAILED')
    expect(err.message).toBe(
      'Version negotiation failed: the server did not offer pinned protocol version 2026-07-28 via server/discover (no fallback in pin mode)',
    )
    // A failed handshake never surfaces events for a connectionId the renderer never got.
    await new Promise((r) => setTimeout(r, 20))
    expect(events).toEqual([])
  })

  it('an unknown protocol option is refused before anything is sent', async () => {
    await expect(
      mcpConnect({ transport: 'http', url: 'http://127.0.0.1:9/mcp', protocol: '2026' }),
    ).rejects.toThrow(/Unknown MCP protocol option "2026"/)
  })
})

describe('HTTP 401 detection with SDK 2.x errors (issue #141 / #152)', () => {
  it("'auto' and 'legacy' both surface status 401 (SdkHttpError.status, not .code)", async () => {
    const url = await v2Server({ bearerToken: 'tok-152' })
    const auto = (await mcpConnect({ transport: 'http', url }).catch((e: unknown) => e)) as {
      status?: number
      code?: unknown
      message: string
    }
    expect(auto.status).toBe(401)
    expect(auto.code).toBe('CLIENT_HTTP_AUTHENTICATION')
    expect(auto.message).toMatch(/401/)
    const legacy = (await mcpConnect({ transport: 'http', url, protocol: 'legacy' }).catch(
      (e: unknown) => e,
    )) as { status?: number; message: string }
    expect(legacy.status).toBe(401)
    expect(legacy.message).toMatch(/401/)
    // With the token, the connect goes through.
    const ok = await connect({
      transport: 'http',
      url,
      auth: { type: 'bearer', bearer: { token: 'tok-152' } },
    })
    expect(ok.era).toBe('modern')
  })
})

describe('2026-07-28 multi-round-trip tools/call (issue #152)', () => {
  it('ask_count: input_required → mcpRespondInput → complete', async () => {
    const info = await connect({ transport: 'http', url: await v2Server() })
    const first = (await mcpCallTool(info.connectionId, 'ask_count', { label: 'apples' })) as {
      resultType?: string
      __mcp?: McpInputRequiredMarker
      content?: unknown
    }
    expect(first.resultType).toBe('input_required')
    expect(first.content).toBeUndefined()
    expect(first.__mcp).toMatchObject({
      kind: 'input_required',
      inputRequests: {
        count: {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: 'How many apples?',
            requestedSchema: { type: 'object', properties: { count: { type: 'number' } } },
          },
        },
      },
      requestState: expect.stringMatching(/^v1\./),
    })

    const second = (await mcpRespondInput(
      info.connectionId,
      'ask_count',
      { label: 'apples' },
      first.__mcp?.requestState,
      { count: { action: 'accept', content: { count: 3 } } },
    )) as { content: Array<{ text: string }>; __mcp?: unknown }
    expect(second.__mcp).toBeUndefined()
    expect(second.content[0].text).toBe('3 apples')

    // On the wire: the retry carries inputResponses + requestState as top-level params.
    const retry = framesFor(info.connectionId)
      .filter((f) => f.direction === 'out' && methodOf(f) === 'tools/call')
      .map((f) => (f.message as { params: Record<string, unknown> }).params)
      .find((p) => 'inputResponses' in p)
    expect(retry).toMatchObject({
      name: 'ask_count',
      arguments: { label: 'apples' },
      inputResponses: { count: { action: 'accept', content: { count: 3 } } },
      requestState: first.__mcp?.requestState,
    })
  })

  it('a tampered requestState is refused by the server', async () => {
    const info = await connect({ transport: 'http', url: await v2Server() })
    await expect(
      mcpRespondInput(info.connectionId, 'ask_count', {}, 'v1.forged.state', {
        count: { action: 'accept', content: { count: 1 } },
      }),
    ).rejects.toThrow(/MCP error -32602/)
  })

  it('respondInput on a legacy-era connection is refused locally', async () => {
    const info = await connect({ transport: 'http', url: await v2Server(), protocol: 'legacy' })
    await expect(
      mcpRespondInput(info.connectionId, 'ask_count', {}, 's', { count: { action: 'decline' } }),
    ).rejects.toThrow(/need a 2026-07-28 connection/)
  })
})

describe('subscriptions/listen lifecycle (issue #152)', () => {
  it('tools/list_changed arrives on the listen stream; disconnect cancels it quietly', async () => {
    const info = await connect({ transport: 'http', url: await v2Server() })
    await mcpCallTool(info.connectionId, 'notify', { steps: 1 })
    await waitFor(() =>
      events.some(
        (e) =>
          e.type === 'notification' &&
          e.payload.connectionId === info.connectionId &&
          e.payload.method === 'notifications/tools/list_changed',
      ),
    )
    await mcpDisconnect(info.connectionId)
    const cancelled = framesFor(info.connectionId).find(
      (f) => f.direction === 'out' && methodOf(f) === 'notifications/cancelled',
    )
    expect(cancelled?.message).toMatchObject({
      params: { requestId: expect.stringMatching(/^listen:/) },
    })
    expect(
      events.filter((e) => e.type === 'subscriptionState' && e.payload.state === 'closed'),
    ).toEqual([])
  })

  it('a server that goes away ends the subscription with a closed event', async () => {
    const srv = await startMcpServer(await freePort())
    const info = await connect({ transport: 'http', url: srv.url })
    await waitFor(() => events.some((e) => e.type === 'subscriptionState'))
    await srv.close()
    await waitFor(() =>
      events.some((e) => e.type === 'subscriptionState' && e.payload.state === 'closed'),
    )
    expect(
      events.find((e) => e.type === 'subscriptionState' && e.payload.state === 'closed')?.payload,
    ).toMatchObject({
      connectionId: info.connectionId,
      state: 'closed',
      reason: expect.any(String),
    })
  })
})

describe('stdio eras (issue #152)', () => {
  /** Legacy stdio server that rejects anything before initialize (like many 2025 SDK servers). */
  const STUB = `
const rl = require('readline').createInterface({ input: process.stdin })
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
let ready = false
rl.on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.method === 'initialize') {
    ready = true
    return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-03-26',
      capabilities: { tools: {} }, serverInfo: { name: 'stdio-152', version: '0.0.1' } } })
  }
  if (m.id === undefined) return
  if (!ready) return send({ jsonrpc: '2.0', id: m.id, error: { code: -32600, message: 'Not initialized' } })
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [] } })
  send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } })
})
`

  it("'auto' probes on a sibling process and falls back to the legacy handshake", async () => {
    const info = await connect({
      transport: 'stdio',
      url: '',
      command: process.execPath,
      args: ['-e', STUB],
    })
    expect(info.era).toBe('legacy')
    expect(info.protocolVersion).toBe('2025-03-26')
    await waitFor(() => framesFor(info.connectionId).length >= 2)
    // The probe ran on a disposable sibling — the session pipe starts with initialize.
    expect(methodOf(framesFor(info.connectionId)[0])).toBe('initialize')
  })

  it('pin 2026-07-28 against a legacy stdio server → EraNegotiationFailed', async () => {
    await expect(
      mcpConnect({
        transport: 'stdio',
        url: '',
        command: process.execPath,
        args: ['-e', STUB],
        protocol: '2026-07-28',
      }),
    ).rejects.toMatchObject({ code: 'ERA_NEGOTIATION_FAILED' })
  })
})
