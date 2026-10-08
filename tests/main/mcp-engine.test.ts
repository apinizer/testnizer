/**
 * Integration tests for `src/main/protocols/mcp.engine.ts`.
 *
 * Strategy: mock the SDK 2.x `Client` + transport classes
 * (`@modelcontextprotocol/client`, `@modelcontextprotocol/client/stdio`) so we
 * can exercise the engine's connection-management, tool listing, tool calling,
 * and error-propagation logic without opening any real network connection.
 * Everything else in the client package (`createMiddleware`,
 * `isInputRequiredResult`, error classes) stays real.
 *
 * Coverage:
 *   - mcpConnect resolves with McpConnectionInfo (http, sse, stdio)
 *   - server name/version are propagated from getServerVersion()
 *   - mcpGetConnection returns info while connected, undefined after disconnect
 *   - mcpDisconnect calls client.close()
 *   - mcpListTools returns mapped tool array
 *   - mcpCallTool forwards args and returns result
 *   - error cases: listTools / callTool on unknown id, connect failure
 *   - mcpDisconnectAll clears all connections
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock the SDK BEFORE importing the engine ─────────────────

/** Shape of the fake transports below, after the engine tapped them. */
interface FakeTransport {
  _url?: string
  _opts?: unknown
  protocolVersion?: string
  send?: (message: unknown) => Promise<void>
  close?: () => Promise<void>
  onmessage?: (message: unknown) => void
  onclose?: () => void
  onerror?: (err: Error) => void
}

const DEFAULT_CAPS = { tools: { listChanged: true }, resources: {}, prompts: {}, logging: {} }

/**
 * Mimics `Client.connect` → `Protocol.connect`: the SDK calls the transport's
 * (tapped) `send` for `initialize`, receives the result through the
 * transport's `onmessage`, then sends `notifications/initialized`.
 */
async function simulateHandshake(transport: FakeTransport): Promise<void> {
  await transport.send?.({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Testnizer' } },
  })
  transport.onmessage?.({
    jsonrpc: '2.0',
    id: 0,
    result: {
      protocolVersion: '2025-03-26',
      capabilities: DEFAULT_CAPS,
      serverInfo: { name: 'MockServer', version: '2.0.0' },
    },
  })
  await transport.send?.({ jsonrpc: '2.0', method: 'notifications/initialized' })
}

const mockClient = {
  ctor: vi.fn<(info: unknown, options: unknown) => void>(),
  connect: vi.fn<(t: FakeTransport) => Promise<void>>(),
  getNegotiatedProtocolVersion: vi.fn<() => string | undefined>(),
  getProtocolEra: vi.fn<() => 'legacy' | 'modern' | undefined>(),
  getDiscoverResult: vi.fn<() => Record<string, unknown> | undefined>(),
  listen: vi.fn(),
  getServerVersion: vi
    .fn<() => { name: string; version: string }>()
    .mockReturnValue({ name: 'MockServer', version: '2.0.0' }),
  getServerCapabilities: vi.fn<() => Record<string, unknown> | undefined>(),
  getInstructions: vi.fn<() => string | undefined>(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  listResources: vi.fn(),
  listResourceTemplates: vi.fn(),
  readResource: vi.fn(),
  listPrompts: vi.fn(),
  getPrompt: vi.fn(),
  close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}

/**
 * One wrapper per `new Client()` so `close()` can fire THAT connection's
 * transport `onclose` (the real Protocol.close → transport.close does), while
 * every call still lands on the shared `mockClient` spies.
 */
function makeClientInstance(): Record<string, unknown> {
  let transport: FakeTransport | undefined
  return {
    connect: (t: FakeTransport) => {
      transport = t
      return mockClient.connect(t)
    },
    close: async () => {
      await mockClient.close()
      transport?.onclose?.()
    },
    getServerVersion: () => mockClient.getServerVersion(),
    getNegotiatedProtocolVersion: () => mockClient.getNegotiatedProtocolVersion(),
    getProtocolEra: () => mockClient.getProtocolEra(),
    getDiscoverResult: () => mockClient.getDiscoverResult(),
    listen: (...a: unknown[]) => mockClient.listen(...a),
    getServerCapabilities: () => mockClient.getServerCapabilities(),
    getInstructions: () => mockClient.getInstructions(),
    listTools: (...a: unknown[]) => mockClient.listTools(...a),
    callTool: (...a: unknown[]) => mockClient.callTool(...a),
    listResources: (...a: unknown[]) => mockClient.listResources(...a),
    listResourceTemplates: (...a: unknown[]) => mockClient.listResourceTemplates(...a),
    readResource: (...a: unknown[]) => mockClient.readResource(...a),
    listPrompts: (...a: unknown[]) => mockClient.listPrompts(...a),
    getPrompt: (...a: unknown[]) => mockClient.getPrompt(...a),
  }
}

function fakeTransport(extra: Partial<FakeTransport>): FakeTransport {
  return {
    send: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    ...extra,
  }
}

vi.mock('@modelcontextprotocol/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@modelcontextprotocol/client')>()),
  Client: vi.fn().mockImplementation((info: unknown, options: unknown) => {
    mockClient.ctor(info, options)
    return makeClientInstance()
  }),
  StreamableHTTPClientTransport: vi
    .fn()
    .mockImplementation((url: URL, opts?: unknown) =>
      fakeTransport({ _url: url.toString(), _opts: opts }),
    ),
  SSEClientTransport: vi
    .fn()
    .mockImplementation((url: URL, opts?: unknown) =>
      fakeTransport({ _url: url.toString(), _opts: opts }),
    ),
}))

vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: vi
    .fn()
    .mockImplementation((opts: unknown) => fakeTransport({ _opts: opts })),
  getDefaultEnvironment: vi.fn(() => ({ PATH: '/usr/bin:/bin', HOME: '/home/tester' })),
}))

/**
 * Faithful stand-in for `createMcpOAuthFetch` (the real wrapper runs against
 * live servers in `mcp-oauth-engine.test.ts`): the session's token is SET on
 * top of whatever headers the SDK built from `requestInit`, then the request
 * goes to `oauthBaseFetch`. Lets the precedence test below see the token win
 * without running an OAuth flow.
 */
const { oauthBaseFetch } = vi.hoisted(() => ({
  oauthBaseFetch: vi.fn(
    async (_url: string | URL, _init?: RequestInit): Promise<Response> => new Response('{}'),
  ),
}))
vi.mock('../../src/main/protocols/mcp-oauth.engine', () => ({
  createMcpOAuthFetch:
    (oauthSessionId: string) =>
    async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer token-of-${oauthSessionId}`)
      return oauthBaseFetch(url, { ...init, headers })
    },
}))

import {
  mcpConnect,
  mcpDisconnect,
  mcpListTools,
  mcpCallTool,
  mcpListResources,
  mcpReadResource,
  mcpListPrompts,
  mcpGetPrompt,
  mcpGetConnection,
  mcpDisconnectAll,
  mcpCancelConnect,
  mcpRespondInput,
  setMcpEventSink,
  applyMcpAuth,
  decorateMcpError,
  resolveNegotiation,
  type McpEngineEvent,
} from '../../src/main/protocols/mcp.engine'
import {
  CLIENT_CAPABILITIES_META_KEY,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

/** Engine events captured through the sink. */
let events: McpEngineEvent[] = []
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

/**
 * The options an http / sse transport was built with. Since issue #152 every
 * http / sse transport gets the frame-tap `fetch` and `redirectPolicy:
 * 'follow'`; `rest` is what remains (requestInit, …).
 */
function httpOpts(
  ctor: typeof StreamableHTTPClientTransport | typeof SSEClientTransport,
  call = 0,
): { fetch: unknown; redirectPolicy: unknown; rest: Record<string, unknown> } {
  const raw = (vi.mocked(ctor).mock.calls[call][1] ?? {}) as Record<string, unknown>
  const { fetch, redirectPolicy, ...rest } = raw
  return { fetch, redirectPolicy, rest }
}

/** The fake transport handed to the most recent `client.connect()`. */
function lastTransport(): FakeTransport {
  const calls = mockClient.connect.mock.calls
  return calls[calls.length - 1][0]
}

// ─── Reset between tests ──────────────────────────────────────
beforeEach(async () => {
  mcpDisconnectAll()
  // Let the previous test's async closes / buffered flushes land before the
  // event log is reset, so nothing leaks across tests.
  await tick()
  vi.clearAllMocks()
  events = []
  setMcpEventSink((e) => events.push(e))
  mockClient.connect.mockImplementation(simulateHandshake)
  mockClient.getServerVersion.mockReturnValue({ name: 'MockServer', version: '2.0.0' })
  mockClient.getNegotiatedProtocolVersion.mockReturnValue('2025-03-26')
  mockClient.getProtocolEra.mockReturnValue('legacy')
  mockClient.getDiscoverResult.mockReturnValue(undefined)
  mockClient.listen.mockReset()
  mockClient.getServerCapabilities.mockReturnValue(DEFAULT_CAPS)
  mockClient.getInstructions.mockReturnValue(undefined)
  mockClient.listTools.mockResolvedValue({
    tools: [
      { name: 'echo', description: 'Returns its input unchanged', inputSchema: {} },
      { name: 'add', description: 'Adds two numbers', inputSchema: {} },
    ],
  })
  mockClient.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'echo-result' }] })
  mockClient.listResources.mockResolvedValue({ resources: [] })
  mockClient.listResourceTemplates.mockResolvedValue({ resourceTemplates: [] })
  mockClient.listPrompts.mockResolvedValue({ prompts: [] })
  mockClient.close.mockResolvedValue(undefined)
})

afterEach(() => {
  setMcpEventSink(null)
})

// ─── connect ──────────────────────────────────────────────────
describe('mcp.engine — connect', () => {
  it('http transport: resolves with McpConnectionInfo', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    expect(info.connectionId).toMatch(/^mcp-/)
    expect(info.transport).toBe('http')
    expect(info.url).toBe('http://mock.local/mcp')
    expect(info.serverName).toBe('MockServer')
    expect(info.serverVersion).toBe('2.0.0')
  })

  it('sse transport: resolves with McpConnectionInfo', async () => {
    const info = await mcpConnect({ transport: 'sse', url: 'http://mock.local/sse' })
    expect(info.transport).toBe('sse')
    expect(info.serverName).toBe('MockServer')
  })

  it('stdio transport: resolves with McpConnectionInfo', async () => {
    const info = await mcpConnect({ transport: 'stdio', url: 'node mock-server.js' })
    expect(info.transport).toBe('stdio')
  })

  it('stdio transport with explicit command + args', async () => {
    const info = await mcpConnect({
      transport: 'stdio',
      url: '',
      command: '/usr/bin/node',
      args: ['server.js', '--port', '9000'],
    })
    expect(info.transport).toBe('stdio')
  })

  it('server name is undefined when getServerVersion returns undefined', async () => {
    mockClient.getServerVersion.mockReturnValue(
      undefined as unknown as { name: string; version: string },
    )
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    expect(info.serverName).toBeUndefined()
    expect(info.serverVersion).toBeUndefined()
  })

  it('each connect returns a unique connectionId', async () => {
    const a = await mcpConnect({ transport: 'http', url: 'http://a.local/mcp' })
    const b = await mcpConnect({ transport: 'http', url: 'http://b.local/mcp' })
    expect(a.connectionId).not.toBe(b.connectionId)
  })

  it('rejects when client.connect() throws', async () => {
    // http 'auto' retries the legacy handshake once (see the retry block) — both fail here.
    mockClient.connect
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockRejectedValueOnce(new Error('Connection refused'))
    await expect(mcpConnect({ transport: 'http', url: 'http://bad.local/mcp' })).rejects.toThrow(
      'Connection refused',
    )
  })
})

// ─── getConnection / disconnect ───────────────────────────────
describe('mcp.engine — getConnection / disconnect', () => {
  it('mcpGetConnection returns info for an active connection', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    expect(mcpGetConnection(info.connectionId)).toEqual(info)
  })

  it('mcpGetConnection returns undefined for an unknown id', () => {
    expect(mcpGetConnection('nope')).toBeUndefined()
  })

  it('mcpDisconnect calls client.close() once', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await mcpDisconnect(info.connectionId)
    expect(mockClient.close).toHaveBeenCalledTimes(1)
  })

  it('mcpGetConnection returns undefined after disconnect', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await mcpDisconnect(info.connectionId)
    expect(mcpGetConnection(info.connectionId)).toBeUndefined()
  })

  it('mcpDisconnect on unknown id is a no-op (no throw)', async () => {
    await expect(mcpDisconnect('ghost')).resolves.toBeUndefined()
  })

  it('mcpDisconnectAll removes all active connections', async () => {
    const a = await mcpConnect({ transport: 'http', url: 'http://a.local/mcp' })
    const b = await mcpConnect({ transport: 'http', url: 'http://b.local/mcp' })
    mcpDisconnectAll()
    // disconnectAll fires async deletes; flush microtasks before asserting
    await new Promise((r) => setTimeout(r, 10))
    expect(mcpGetConnection(a.connectionId)).toBeUndefined()
    expect(mcpGetConnection(b.connectionId)).toBeUndefined()
  })
})

// ─── listTools ────────────────────────────────────────────────
describe('mcp.engine — listTools', () => {
  it('returns mapped tool array from connected server', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const tools = await mcpListTools(info.connectionId)
    expect(tools).toHaveLength(2)
    expect(tools[0].name).toBe('echo')
    expect(tools[0].description).toBe('Returns its input unchanged')
    expect(tools[1].name).toBe('add')
  })

  it('tool inputSchema defaults to {} when not provided', async () => {
    mockClient.listTools.mockResolvedValueOnce({
      tools: [{ name: 'bare', description: undefined, inputSchema: undefined }],
    })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const tools = await mcpListTools(info.connectionId)
    expect(tools[0].inputSchema).toEqual({})
  })

  it('throws Not connected for an unknown id', async () => {
    await expect(mcpListTools('ghost')).rejects.toThrow(/Not connected/)
  })
})

// ─── callTool ─────────────────────────────────────────────────
describe('mcp.engine — callTool', () => {
  it('forwards tool name + args to client.callTool()', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await mcpCallTool(info.connectionId, 'echo', { text: 'hello' })
    expect(mockClient.callTool.mock.calls[0][0]).toEqual({
      name: 'echo',
      arguments: { text: 'hello' },
    })
  })

  it('returns the raw result from the server', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const result = await mcpCallTool(info.connectionId, 'echo', { text: 'hi' })
    expect(result).toMatchObject({ content: [{ type: 'text', text: 'echo-result' }] })
  })

  it('throws Not connected for an unknown id', async () => {
    await expect(mcpCallTool('ghost', 'echo', {})).rejects.toThrow(/Not connected/)
  })

  it('propagates server-side tool errors', async () => {
    mockClient.callTool.mockRejectedValueOnce(new Error('Tool not found: unknown'))
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await expect(mcpCallTool(info.connectionId, 'unknown', {})).rejects.toThrow('Tool not found')
  })
})

// ─── custom headers (issue #137) ──────────────────────────────
describe('mcp.engine — custom connect headers (issue #137)', () => {
  const HEADERS = { Authorization: 'Bearer t-137', 'X-Gateway-Project': 'project1' }

  it('http: headers go to StreamableHTTPClientTransport via requestInit.headers', async () => {
    await mcpConnect({ transport: 'http', url: 'http://gw.local/mcp', headers: HEADERS })
    const ctor = vi.mocked(StreamableHTTPClientTransport)
    expect(ctor).toHaveBeenCalledTimes(1)
    const [url] = ctor.mock.calls[0]
    expect(url.toString()).toBe('http://gw.local/mcp')
    const opts = httpOpts(StreamableHTTPClientTransport)
    expect(opts.rest).toEqual({ requestInit: { headers: HEADERS } })
    expect(typeof opts.fetch).toBe('function')
    expect(opts.redirectPolicy).toBe('follow')
  })

  it('sse: headers go to SSEClientTransport via requestInit.headers (SDK 2.x applies them to the GET stream too)', async () => {
    await mcpConnect({ transport: 'sse', url: 'http://gw.local/sse', headers: HEADERS })
    const ctor = vi.mocked(SSEClientTransport)
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(httpOpts(SSEClientTransport).rest).toEqual({ requestInit: { headers: HEADERS } })
  })

  it('no headers / empty map → no requestInit (only the frame-tap fetch + redirect policy)', async () => {
    await mcpConnect({ transport: 'http', url: 'http://gw.local/mcp' })
    await mcpConnect({ transport: 'sse', url: 'http://gw.local/sse', headers: {} })
    for (const ctor of [StreamableHTTPClientTransport, SSEClientTransport] as const) {
      const opts = httpOpts(ctor)
      expect(opts.rest).toEqual({})
      expect(typeof opts.fetch).toBe('function')
      expect(opts.redirectPolicy).toBe('follow')
    }
  })

  it('stdio ignores headers', async () => {
    await mcpConnect({ transport: 'stdio', url: 'node server.js', headers: HEADERS })
    const ctor = vi.mocked(StdioClientTransport)
    expect(ctor).toHaveBeenCalledTimes(1)
    const params = ctor.mock.calls[0][0] as unknown as Record<string, unknown>
    expect(params).not.toHaveProperty('requestInit')
    expect(JSON.stringify(params)).not.toContain('Bearer t-137')
    expect(StreamableHTTPClientTransport).not.toHaveBeenCalled()
    expect(SSEClientTransport).not.toHaveBeenCalled()
  })
})

// ─── connect result (issue #139) ──────────────────────────────
describe('mcp.engine — connect result carries protocolVersion / capabilities / instructions (issue #139)', () => {
  it('protocolVersion is the SDK 2.x negotiated version, on every transport', async () => {
    for (const transport of ['http', 'sse', 'stdio'] as const) {
      mockClient.getNegotiatedProtocolVersion.mockReturnValueOnce(`v-${transport}`)
      const info = await mcpConnect({
        transport,
        url: transport === 'stdio' ? 'node s.js' : 'http://x/mcp',
      })
      expect(info.protocolVersion).toBe(`v-${transport}`)
      expect(info.era).toBe('legacy')
    }
  })

  it('capabilities are plain JSON from getServerCapabilities(); instructions passed through', async () => {
    mockClient.getInstructions.mockReturnValue('Use the echo tool first.')
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    expect(info.capabilities).toEqual(DEFAULT_CAPS)
    expect(info.capabilities).not.toBe(DEFAULT_CAPS)
    expect(info.instructions).toBe('Use the echo tool first.')
  })

  it('omits protocolVersion / capabilities / instructions when the server gave none', async () => {
    mockClient.connect.mockImplementationOnce(async () => {})
    mockClient.getServerCapabilities.mockReturnValue(undefined)
    mockClient.getNegotiatedProtocolVersion.mockReturnValue(undefined)
    const info = await mcpConnect({ transport: 'sse', url: 'http://mock.local/sse' })
    expect(info).not.toHaveProperty('protocolVersion')
    expect(info).not.toHaveProperty('capabilities')
    expect(info).not.toHaveProperty('instructions')
  })
})

// ─── stdio env (issue #139) ───────────────────────────────────
describe('mcp.engine — stdio env is merged over the SDK default env (issue #139)', () => {
  it('user env is spread OVER getDefaultEnvironment() — PATH/HOME survive, user keys win', async () => {
    await mcpConnect({
      transport: 'stdio',
      url: 'npx -y @scope/server',
      env: { API_KEY: 'k-139', HOME: '/override' },
    })
    const params = vi.mocked(StdioClientTransport).mock.calls[0][0]
    expect(params.command).toBe('npx')
    expect(params.args).toEqual(['-y', '@scope/server'])
    expect(params.env).toEqual({ PATH: '/usr/bin:/bin', HOME: '/override', API_KEY: 'k-139' })
  })

  it('no / empty env → env left undefined (SDK applies its default env itself)', async () => {
    await mcpConnect({ transport: 'stdio', url: 'node a.js' })
    await mcpConnect({ transport: 'stdio', url: 'node b.js', env: {} })
    const calls = vi.mocked(StdioClientTransport).mock.calls
    expect(calls[0][0].env).toBeUndefined()
    expect(calls[1][0].env).toBeUndefined()
  })

  it('http / sse ignore env', async () => {
    await mcpConnect({ transport: 'http', url: 'http://gw.local/mcp', env: { A: '1' } })
    expect(httpOpts(StreamableHTTPClientTransport).rest).toEqual({})
    expect(StdioClientTransport).not.toHaveBeenCalled()
  })
})

// ─── stdio command tokenisation (issue #141 follow-up) ────────
describe('mcp.engine — stdio command with explicit args is used verbatim', () => {
  it('explicit args → command is the executable as-is (a path with spaces is not split)', async () => {
    await mcpConnect({
      transport: 'stdio',
      url: '"/Applications/My Server/bin/server" --port 9000',
      command: '/Applications/My Server/bin/server',
      args: ['--port', '9000'],
    })
    const params = vi.mocked(StdioClientTransport).mock.calls[0][0]
    expect(params.command).toBe('/Applications/My Server/bin/server')
    expect(params.args).toEqual(['--port', '9000'])
  })

  it('explicit empty args still means "already tokenised"', async () => {
    await mcpConnect({
      transport: 'stdio',
      url: '',
      command: 'C:\\Program Files\\srv.exe',
      args: [],
    })
    const params = vi.mocked(StdioClientTransport).mock.calls[0][0]
    expect(params.command).toBe('C:\\Program Files\\srv.exe')
    expect(params.args).toEqual([])
  })

  it('no args → the command line is still split on whitespace (backwards compatible)', async () => {
    await mcpConnect({ transport: 'stdio', url: '', command: 'node server.js --verbose' })
    await mcpConnect({ transport: 'stdio', url: 'npx -y @scope/server' })
    const calls = vi.mocked(StdioClientTransport).mock.calls
    expect(calls[0][0].command).toBe('node')
    expect(calls[0][0].args).toEqual(['server.js', '--verbose'])
    expect(calls[1][0].command).toBe('npx')
    expect(calls[1][0].args).toEqual(['-y', '@scope/server'])
  })
})

// ─── OAuth session (issue #141) ───────────────────────────────
describe('mcp.engine — oauthSessionId wires an authenticating fetch into http / sse', () => {
  it('http / sse get a `fetch` option; headers still ride requestInit', async () => {
    await mcpConnect({
      transport: 'http',
      url: 'http://gw.local/mcp',
      headers: { 'X-A': '1' },
      oauthSessionId: 'mcp-oauth-x',
    })
    await mcpConnect({
      transport: 'sse',
      url: 'http://gw.local/sse',
      oauthSessionId: 'mcp-oauth-x',
    })
    const http = httpOpts(StreamableHTTPClientTransport)
    expect(http.rest).toEqual({ requestInit: { headers: { 'X-A': '1' } } })
    expect(typeof http.fetch).toBe('function')
    const sse = httpOpts(SSEClientTransport)
    expect(sse.rest).toEqual({})
    expect(typeof sse.fetch).toBe('function')
    // The transport fetch (frame tap) runs the session's OAuth fetch underneath.
    await (http.fetch as (u: string, i?: RequestInit) => Promise<Response>)('http://gw.local/mcp')
    expect(new Headers(oauthBaseFetch.mock.calls[0][1]?.headers).get('authorization')).toBe(
      'Bearer token-of-mcp-oauth-x',
    )
  })

  it('stdio ignores oauthSessionId', async () => {
    await mcpConnect({ transport: 'stdio', url: 'node s.js', oauthSessionId: 'mcp-oauth-x' })
    const params = vi.mocked(StdioClientTransport).mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >
    expect(params).not.toHaveProperty('fetch')
  })
})

// ─── listTools pass-through (issue #139) ──────────────────────
describe('mcp.engine — listTools (issue #139 fields + pagination)', () => {
  it('passes through title / outputSchema / annotations', async () => {
    mockClient.listTools.mockResolvedValueOnce({
      tools: [
        {
          name: 'weather',
          title: 'Weather',
          description: 'Get weather',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object', properties: { temp: { type: 'number' } } },
          annotations: { readOnlyHint: true, openWorldHint: true },
          _meta: { internal: 1 },
        },
      ],
    })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const tools = await mcpListTools(info.connectionId)
    expect(tools).toEqual([
      {
        name: 'weather',
        title: 'Weather',
        description: 'Get weather',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object', properties: { temp: { type: 'number' } } },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
    ])
  })

  it('follows nextCursor across pages', async () => {
    mockClient.listTools
      .mockResolvedValueOnce({ tools: [{ name: 'a', inputSchema: {} }], nextCursor: 'p2' })
      .mockResolvedValueOnce({ tools: [{ name: 'b', inputSchema: {} }] })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const tools = await mcpListTools(info.connectionId)
    expect(tools.map((t) => t.name)).toEqual(['a', 'b'])
    expect(mockClient.listTools.mock.calls[0][0]).toBeUndefined()
    expect(mockClient.listTools.mock.calls[1][0]).toEqual({ cursor: 'p2' })
  })
})

// ─── callTool progress token (issue #139) ─────────────────────
describe('mcp.engine — callTool asks for progress (issue #139)', () => {
  it('passes onprogress + resetTimeoutOnProgress so the SDK attaches a progressToken', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await mcpCallTool(info.connectionId, 'echo', {})
    // SDK 2.x: callTool(params, options) — the v1 result-schema slot is gone.
    const [, opts] = mockClient.callTool.mock.calls[0] as [
      unknown,
      { onprogress?: unknown; resetTimeoutOnProgress?: boolean; allowInputRequired?: boolean },
    ]
    expect(typeof opts.onprogress).toBe('function')
    expect(opts.resetTimeoutOnProgress).toBe(true)
    // Legacy era: no multi-round-trip opt-in.
    expect(opts.allowInputRequired).toBeUndefined()
  })
})

// ─── resources (issue #139) ───────────────────────────────────
describe('mcp.engine — listResources / readResource (issue #139)', () => {
  it('maps resources + templates and follows nextCursor for both', async () => {
    mockClient.listResources
      .mockResolvedValueOnce({
        resources: [
          {
            uri: 'test://a',
            name: 'a',
            title: 'A',
            description: 'first',
            mimeType: 'text/plain',
            size: 12,
            annotations: { audience: ['user'] },
          },
        ],
        nextCursor: 'r2',
      })
      .mockResolvedValueOnce({ resources: [{ uri: 'test://b', name: 'b' }] })
    mockClient.listResourceTemplates
      .mockResolvedValueOnce({
        resourceTemplates: [
          { uriTemplate: 'test://item/{id}', name: 'item', mimeType: 'application/json' },
        ],
        nextCursor: 't2',
      })
      .mockResolvedValueOnce({
        resourceTemplates: [{ uriTemplate: 'test://user/{name}', name: 'user', title: 'User' }],
      })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const res = await mcpListResources(info.connectionId)
    expect(res.resources).toEqual([
      {
        uri: 'test://a',
        name: 'a',
        title: 'A',
        description: 'first',
        mimeType: 'text/plain',
        size: 12,
      },
      { uri: 'test://b', name: 'b' },
    ])
    expect(res.templates).toEqual([
      { uriTemplate: 'test://item/{id}', name: 'item', mimeType: 'application/json' },
      { uriTemplate: 'test://user/{name}', name: 'user', title: 'User' },
    ])
    expect(mockClient.listResources.mock.calls.map((c) => c[0])).toEqual([
      undefined,
      { cursor: 'r2' },
    ])
    // A testing tool always asks the server (SDK 2.x response cache bypassed for reads).
    expect(mockClient.listResources.mock.calls[0][1]).toEqual({ cacheMode: 'refresh' })
    expect(mockClient.listResourceTemplates.mock.calls.map((c) => c[0])).toEqual([
      undefined,
      { cursor: 't2' },
    ])
  })

  it('server without the resources capability → empty lists, no request sent', async () => {
    mockClient.getServerCapabilities.mockReturnValue({ tools: {} })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await expect(mcpListResources(info.connectionId)).resolves.toEqual({
      resources: [],
      templates: [],
    })
    expect(mockClient.listResources).not.toHaveBeenCalled()
    expect(mockClient.listResourceTemplates).not.toHaveBeenCalled()
  })

  it('templates "Method not found" → empty templates, resources kept', async () => {
    mockClient.listResources.mockResolvedValueOnce({ resources: [{ uri: 'test://a', name: 'a' }] })
    mockClient.listResourceTemplates.mockRejectedValueOnce(
      Object.assign(new Error('MCP error -32601: Method not found'), { code: -32601 }),
    )
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const res = await mcpListResources(info.connectionId)
    expect(res.resources).toHaveLength(1)
    expect(res.templates).toEqual([])
  })

  it('other list errors propagate', async () => {
    mockClient.listResources.mockRejectedValueOnce(new Error('HTTP 500'))
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await expect(mcpListResources(info.connectionId)).rejects.toThrow('HTTP 500')
  })

  it('pagination stops on a repeated cursor', async () => {
    mockClient.listResources.mockResolvedValue({
      resources: [{ uri: 'test://x', name: 'x' }],
      nextCursor: 'same',
    })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const res = await mcpListResources(info.connectionId)
    // first page (no cursor) + one page with 'same' → the echo of 'same' stops it
    expect(mockClient.listResources).toHaveBeenCalledTimes(2)
    expect(res.resources).toHaveLength(2)
  })

  it('pagination is capped at 50 pages', async () => {
    let n = 0
    mockClient.listResources.mockImplementation(async () => ({
      resources: [{ uri: `test://${n}`, name: String(n) }],
      nextCursor: `c${++n}`,
    }))
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const res = await mcpListResources(info.connectionId)
    expect(mockClient.listResources).toHaveBeenCalledTimes(50)
    expect(res.resources).toHaveLength(50)
  })

  it('pagination is capped at 2000 items', async () => {
    let n = 0
    mockClient.listResources.mockImplementation(async () => ({
      resources: Array.from({ length: 900 }, (_, i) => ({ uri: `test://${n}/${i}`, name: 'r' })),
      nextCursor: `c${++n}`,
    }))
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const res = await mcpListResources(info.connectionId)
    expect(mockClient.listResources).toHaveBeenCalledTimes(3)
    expect(res.resources).toHaveLength(2000)
  })

  it('readResource maps text and base64 blob contents', async () => {
    mockClient.readResource.mockResolvedValueOnce({
      contents: [
        { uri: 'test://greeting', mimeType: 'text/plain', text: 'hi', _meta: { x: 1 } },
        { uri: 'test://pixel.png', mimeType: 'image/png', blob: 'iVBORw0=' },
      ],
    })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const res = await mcpReadResource(info.connectionId, 'test://greeting')
    expect(mockClient.readResource).toHaveBeenCalledWith(
      { uri: 'test://greeting' },
      { cacheMode: 'refresh' },
    )
    expect(res).toEqual({
      contents: [
        { uri: 'test://greeting', mimeType: 'text/plain', text: 'hi' },
        { uri: 'test://pixel.png', mimeType: 'image/png', blob: 'iVBORw0=' },
      ],
    })
  })

  it('unknown connection → Not connected', async () => {
    await expect(mcpListResources('ghost')).rejects.toThrow(/Not connected/)
    await expect(mcpReadResource('ghost', 'test://x')).rejects.toThrow(/Not connected/)
  })
})

// ─── prompts (issue #139) ─────────────────────────────────────
describe('mcp.engine — listPrompts / getPrompt (issue #139)', () => {
  it('maps prompts with arguments and follows nextCursor', async () => {
    mockClient.listPrompts
      .mockResolvedValueOnce({
        prompts: [
          {
            name: 'summarize',
            title: 'Summarize',
            description: 'Summarize text',
            arguments: [{ name: 'text', description: 'The text', required: true }],
          },
        ],
        nextCursor: 'p2',
      })
      .mockResolvedValueOnce({ prompts: [{ name: 'greet' }] })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const prompts = await mcpListPrompts(info.connectionId)
    expect(prompts).toEqual([
      {
        name: 'summarize',
        title: 'Summarize',
        description: 'Summarize text',
        arguments: [{ name: 'text', description: 'The text', required: true }],
      },
      { name: 'greet' },
    ])
    expect(mockClient.listPrompts.mock.calls[1][0]).toEqual({ cursor: 'p2' })
  })

  it('server without the prompts capability → [], no request sent', async () => {
    mockClient.getServerCapabilities.mockReturnValue({ tools: {} })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await expect(mcpListPrompts(info.connectionId)).resolves.toEqual([])
    expect(mockClient.listPrompts).not.toHaveBeenCalled()
  })

  it('getPrompt forwards name + string args and maps messages', async () => {
    mockClient.getPrompt.mockResolvedValueOnce({
      description: 'Summarize prompt',
      messages: [
        { role: 'user', content: { type: 'text', text: 'Please summarize: hello' } },
        { role: 'assistant', content: { type: 'text', text: 'ok' } },
      ],
    })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const res = await mcpGetPrompt(info.connectionId, 'summarize', { text: 'hello' })
    expect(mockClient.getPrompt).toHaveBeenCalledWith({
      name: 'summarize',
      arguments: { text: 'hello' },
    })
    expect(res).toEqual({
      description: 'Summarize prompt',
      messages: [
        { role: 'user', content: { type: 'text', text: 'Please summarize: hello' } },
        { role: 'assistant', content: { type: 'text', text: 'ok' } },
      ],
    })
  })

  it('getPrompt coerces non-string arg values and drops null/undefined', async () => {
    mockClient.getPrompt.mockResolvedValueOnce({ messages: [] })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await mcpGetPrompt(info.connectionId, 'p', {
      n: 5 as unknown as string,
      gone: undefined as unknown as string,
    })
    expect(mockClient.getPrompt).toHaveBeenCalledWith({ name: 'p', arguments: { n: '5' } })
  })
})

// ─── events: frames / notifications / close (issue #139) ──────
describe('mcp.engine — frame / notification / connectionClosed events (issue #139)', () => {
  const frames = (): Array<Extract<McpEngineEvent, { type: 'frame' }>['payload']> =>
    events.flatMap((e) => (e.type === 'frame' ? [e.payload] : []))

  it('captures the initialize round-trip as frames, released only after connect resolves', async () => {
    // stdio: the transport's own onmessage is the inbound tap (http / sse read
    // the wire through the fetch middleware — see the frame-tap block below).
    const info = await mcpConnect({ transport: 'stdio', url: 'node s.js' })
    // Buffered: the IPC reply carrying connectionId must reach the renderer first.
    expect(events).toEqual([])
    await tick()
    const f = frames()
    expect(
      f.map((x) => [x.direction, (x.message as { method?: string }).method ?? 'result']),
    ).toEqual([
      ['out', 'initialize'],
      ['in', 'result'],
      ['out', 'notifications/initialized'],
    ])
    expect(f.every((x) => x.connectionId === info.connectionId)).toBe(true)
    expect(f.every((x) => typeof x.ts === 'number')).toBe(true)
  })

  it('a failed handshake emits nothing (the renderer never learned that connectionId)', async () => {
    mockClient.connect.mockImplementationOnce(async (t: FakeTransport) => {
      await t.send?.({ jsonrpc: '2.0', id: 0, method: 'initialize' })
      throw new Error('boom')
    })
    await expect(
      mcpConnect({ transport: 'http', url: 'http://x/mcp', protocol: 'legacy' }),
    ).rejects.toThrow('boom')
    await tick()
    expect(events).toEqual([])
  })

  it('every inbound JSON-RPC notification becomes a notification event, per connection', async () => {
    const a = await mcpConnect({ transport: 'stdio', url: 'node a.js' })
    const ta = lastTransport()
    const b = await mcpConnect({ transport: 'stdio', url: 'node b.js' })
    const tb = lastTransport()
    await tick()
    events = []
    ta.onmessage?.({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    tb.onmessage?.({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 1, progress: 1, total: 2 },
    })
    // A response is a frame but never a notification.
    ta.onmessage?.({ jsonrpc: '2.0', id: 9, result: {} })
    const notes = events.flatMap((e) => (e.type === 'notification' ? [e.payload] : []))
    expect(notes).toEqual([
      {
        connectionId: a.connectionId,
        ts: expect.any(Number),
        method: 'notifications/tools/list_changed',
      },
      {
        connectionId: b.connectionId,
        ts: expect.any(Number),
        method: 'notifications/progress',
        params: { progressToken: 1, progress: 1, total: 2 },
      },
    ])
    expect(frames()).toHaveLength(3)
  })

  it('outbound frames are recorded by the wrapped send', async () => {
    const info = await mcpConnect({ transport: 'stdio', url: 'node s.js' })
    await tick()
    events = []
    await lastTransport().send?.({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    expect(frames()).toEqual([
      {
        connectionId: info.connectionId,
        ts: expect.any(Number),
        direction: 'out',
        message: { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      },
    ])
  })

  it('frames over ~1 MB are summarised, not shipped whole', async () => {
    await mcpConnect({ transport: 'stdio', url: 'node s.js' })
    await tick()
    events = []
    const blob = 'A'.repeat(1_200_000)
    lastTransport().onmessage?.({
      jsonrpc: '2.0',
      id: 7,
      result: { contents: [{ uri: 'test://big', blob }] },
    })
    const [f] = frames()
    expect(f.truncated).toBe(true)
    const msg = f.message as { id: number; _truncated: { chars: number; preview: string } }
    expect(msg.id).toBe(7)
    expect(msg._truncated.chars).toBeGreaterThan(1_200_000)
    expect(msg._truncated.preview.length).toBe(2048)
  })

  it('server-side close → connectionClosed with a reason, connection dropped', async () => {
    const info = await mcpConnect({ transport: 'stdio', url: 'node s.js' })
    await tick()
    lastTransport().onclose?.()
    expect(events.filter((e) => e.type === 'connectionClosed')).toEqual([
      {
        type: 'connectionClosed',
        payload: { connectionId: info.connectionId, reason: 'Server process exited' },
      },
    ])
    expect(mcpGetConnection(info.connectionId)).toBeUndefined()
    await expect(mcpListTools(info.connectionId)).rejects.toThrow(/Not connected/)
  })

  it('the close reason is the last transport error when one preceded the close', async () => {
    const info = await mcpConnect({ transport: 'stdio', url: 'node s.js' })
    await tick()
    lastTransport().onerror?.(new Error('write EPIPE'))
    lastTransport().onclose?.()
    const closed = events.find((e) => e.type === 'connectionClosed')
    expect(closed?.payload).toEqual({ connectionId: info.connectionId, reason: 'write EPIPE' })
  })

  it('user disconnect → connectionClosed without a reason', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await tick()
    await mcpDisconnect(info.connectionId)
    expect(events.filter((e) => e.type === 'connectionClosed')).toEqual([
      { type: 'connectionClosed', payload: { connectionId: info.connectionId } },
    ])
  })

  it('legacy SSE: an SseError with an HTTP status (eventsource gave up) closes the connection', async () => {
    const info = await mcpConnect({ transport: 'sse', url: 'http://mock.local/sse' })
    await tick()
    const err = Object.assign(new Error('SSE error: Non-200 status code (502)'), { code: 502 })
    lastTransport().onerror?.(err)
    await tick()
    expect(mockClient.close).toHaveBeenCalledTimes(1)
    const closed = events.find((e) => e.type === 'connectionClosed')
    expect(closed?.payload).toEqual({
      connectionId: info.connectionId,
      reason: 'SSE error: Non-200 status code (502)',
    })
  })

  it('legacy SSE: a code-less SseError (eventsource is reconnecting) does not close', async () => {
    const info = await mcpConnect({ transport: 'sse', url: 'http://mock.local/sse' })
    await tick()
    lastTransport().onerror?.(new Error('SSE error: fetch failed'))
    await tick()
    expect(mockClient.close).not.toHaveBeenCalled()
    expect(mcpGetConnection(info.connectionId)).toBeDefined()
  })

  it('http: a per-request POST failure is reported as transportError, never closes', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await tick()
    events = []
    lastTransport().onerror?.(new Error('Error POSTing to endpoint (HTTP 500): oops'))
    lastTransport().onerror?.(new Error('Error POSTing to endpoint (HTTP 500): oops'))
    await tick()
    expect(mockClient.close).not.toHaveBeenCalled()
    expect(mcpGetConnection(info.connectionId)).toBeDefined()
    // identical consecutive errors are reported once
    expect(events).toEqual([
      {
        type: 'transportError',
        payload: {
          connectionId: info.connectionId,
          message: 'Error POSTing to endpoint (HTTP 500): oops',
        },
      },
    ])
  })

  it('http: GET-stream reconnection exhausted → connection closed with that reason', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await tick()
    lastTransport().onerror?.(new Error('Maximum reconnection attempts (2) exceeded.'))
    await tick()
    const closed = events.find((e) => e.type === 'connectionClosed')
    expect(closed?.payload).toEqual({
      connectionId: info.connectionId,
      reason: 'Maximum reconnection attempts (2) exceeded.',
    })
  })

  it('a throwing sink never breaks the transport', async () => {
    setMcpEventSink(() => {
      throw new Error('renderer gone')
    })
    const info = await mcpConnect({ transport: 'stdio', url: 'node s.js' })
    await tick()
    expect(() =>
      lastTransport().onmessage?.({ jsonrpc: '2.0', method: 'notifications/message' }),
    ).not.toThrow()
    expect(mcpGetConnection(info.connectionId)).toBeDefined()
  })
})

// ─── Authorization tab (MCP Auth) ─────────────────────────────
describe('mcp.engine — applyMcpAuth (Authorization tab)', () => {
  const URL_ = 'http://gw.local/mcp'

  it('basic → Authorization: Basic base64(user:pass)', () => {
    const { url, headers } = applyMcpAuth(URL_, undefined, {
      type: 'basic',
      basic: { username: 'alice', password: 's3cret' },
    })
    expect(url).toBe(URL_)
    expect(headers).toEqual({
      Authorization: `Basic ${Buffer.from('alice:s3cret', 'utf8').toString('base64')}`,
    })
  })

  it('basic strips ":" from the username (RFC 7617, same as the HTTP engine) and adds nothing when both fields are empty', () => {
    const { headers } = applyMcpAuth(URL_, undefined, {
      type: 'basic',
      basic: { username: 'a:b', password: 'p' },
    })
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('ab:p').toString('base64')}`)
    expect(
      applyMcpAuth(URL_, undefined, { type: 'basic', basic: { username: '', password: '' } })
        .headers,
    ).toEqual({})
  })

  it('bearer → "Bearer <token>" by default, custom prefix when set, nothing for an empty token', () => {
    expect(
      applyMcpAuth(URL_, undefined, { type: 'bearer', bearer: { token: 'tok-1' } }).headers,
    ).toEqual({ Authorization: 'Bearer tok-1' })
    expect(
      applyMcpAuth(URL_, undefined, { type: 'bearer', bearer: { token: 'tok-1', prefix: 'Token' } })
        .headers,
    ).toEqual({ Authorization: 'Token tok-1' })
    expect(
      applyMcpAuth(URL_, undefined, { type: 'bearer', bearer: { token: '  ' } }).headers,
    ).toEqual({})
  })

  it('api-key in header → <key>: <value>; an empty key adds nothing', () => {
    expect(
      applyMcpAuth(
        URL_,
        { 'X-A': '1' },
        {
          type: 'api-key',
          apiKey: { key: 'X-API-Key', value: 'k-1', in: 'header' },
        },
      ),
    ).toEqual({ url: URL_, headers: { 'X-A': '1', 'X-API-Key': 'k-1' } })
    expect(
      applyMcpAuth(URL_, undefined, {
        type: 'api-key',
        apiKey: { key: ' ', value: 'v', in: 'header' },
      }),
    ).toEqual({ url: URL_, headers: {} })
  })

  it('api-key in query appends to a URL that already has a query string (and leaves headers alone)', () => {
    const { url, headers } = applyMcpAuth(
      'http://gw.local/mcp?tenant=a',
      { 'X-A': '1' },
      {
        type: 'api-key',
        apiKey: { key: 'api_key', value: 'k 1&x', in: 'query' },
      },
    )
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('http://gw.local/mcp')
    expect([...parsed.searchParams.entries()]).toEqual([
      ['tenant', 'a'],
      ['api_key', 'k 1&x'],
    ])
    expect(url.startsWith('http://gw.local/mcp?tenant=a&api_key=')).toBe(true)
    expect(headers).toEqual({ 'X-A': '1' })
  })

  it('api-key in query on a URL without a query string', () => {
    const { url } = applyMcpAuth(URL_, undefined, {
      type: 'api-key',
      apiKey: { key: 'key', value: 'v', in: 'query' },
    })
    expect(url).toBe('http://gw.local/mcp?key=v')
  })

  it('precedence (HTTP parity, issue #48): a same-named custom header wins, whatever its case', () => {
    const custom = { authorization: 'Bearer custom', 'X-Other': '1', 'x-api-key': 'old' }
    const bearer = applyMcpAuth(URL_, custom, { type: 'bearer', bearer: { token: 'auth-token' } })
    expect(bearer.headers).toEqual(custom)
    const basic = applyMcpAuth(URL_, custom, {
      type: 'basic',
      basic: { username: 'u', password: 'p' },
    })
    expect(basic.headers).toEqual(custom)
    const apiKey = applyMcpAuth(URL_, custom, {
      type: 'api-key',
      apiKey: { key: 'X-API-Key', value: 'new', in: 'header' },
    })
    expect(apiKey.headers).toEqual(custom)
    // Auth fills what the user did not set.
    expect(
      applyMcpAuth(URL_, { 'X-Other': '1' }, { type: 'bearer', bearer: { token: 'auth-token' } })
        .headers,
    ).toEqual({ 'X-Other': '1', Authorization: 'Bearer auth-token' })
    // The caller's record is never mutated.
    expect(custom).toEqual({ authorization: 'Bearer custom', 'X-Other': '1', 'x-api-key': 'old' })
  })

  it('api-key in query: a parameter of the same name already in the URL wins', () => {
    const { url } = applyMcpAuth('http://gw.local/mcp?api_key=mine', undefined, {
      type: 'api-key',
      apiKey: { key: 'api_key', value: 'auth', in: 'query' },
    })
    expect(url).toBe('http://gw.local/mcp?api_key=mine')
  })

  it('a custom header that wins is never checked for line breaks by the auth path', () => {
    expect(
      applyMcpAuth(
        URL_,
        { Authorization: 'Bearer mine' },
        {
          type: 'bearer',
          bearer: { token: 'abc\nSECRET-LINE' },
        },
      ).headers,
    ).toEqual({ Authorization: 'Bearer mine' })
  })

  it('none / oauth2 / no auth leave url and headers as they are', () => {
    for (const auth of [undefined, { type: 'none' as const }, { type: 'oauth2' as const }]) {
      expect(applyMcpAuth(URL_, { 'X-A': '1' }, auth)).toEqual({
        url: URL_,
        headers: { 'X-A': '1' },
      })
    }
  })

  it('a credential with a line break is refused without echoing it', () => {
    expect(() =>
      applyMcpAuth(URL_, undefined, { type: 'bearer', bearer: { token: 'abc\nSECRET-LINE' } }),
    ).toThrow(/line break/)
    try {
      applyMcpAuth(URL_, undefined, { type: 'bearer', bearer: { token: 'abc\nSECRET-LINE' } })
    } catch (e) {
      expect((e as Error).message).not.toContain('SECRET-LINE')
    }
  })
})

describe('mcp.engine — mcpConnect applies the Authorization tab', () => {
  it('http: the auth header joins the custom headers in requestInit.headers', async () => {
    await mcpConnect({
      transport: 'http',
      url: 'http://gw.local/mcp',
      headers: { 'X-Gateway-Project': 'p1' },
      auth: { type: 'basic', basic: { username: 'u', password: 'p' } },
    })
    expect(httpOpts(StreamableHTTPClientTransport).rest).toEqual({
      requestInit: {
        headers: {
          'X-Gateway-Project': 'p1',
          Authorization: `Basic ${Buffer.from('u:p').toString('base64')}`,
        },
      },
    })
  })

  it('http: a custom Authorization row beats the Authorization tab (issue #48 parity)', async () => {
    await mcpConnect({
      transport: 'http',
      url: 'http://gw.local/mcp',
      headers: { Authorization: 'Bearer custom', 'X-Gateway-Project': 'p1' },
      auth: { type: 'basic', basic: { username: 'u', password: 'p' } },
    })
    expect(httpOpts(StreamableHTTPClientTransport).rest).toEqual({
      requestInit: { headers: { Authorization: 'Bearer custom', 'X-Gateway-Project': 'p1' } },
    })
  })

  it('sse: a bearer token alone builds requestInit.headers', async () => {
    await mcpConnect({
      transport: 'sse',
      url: 'http://gw.local/sse',
      auth: { type: 'bearer', bearer: { token: 't-sse' } },
    })
    expect(httpOpts(SSEClientTransport).rest).toEqual({
      requestInit: { headers: { Authorization: 'Bearer t-sse' } },
    })
  })

  it('api-key in query: the transport URL carries the key, the connection info does not', async () => {
    const info = await mcpConnect({
      transport: 'http',
      url: 'http://gw.local/mcp?tenant=a',
      auth: { type: 'api-key', apiKey: { key: 'api_key', value: 'K-SECRET', in: 'query' } },
    })
    const [wireUrl] = vi.mocked(StreamableHTTPClientTransport).mock.calls[0]
    expect(wireUrl.toString()).toBe('http://gw.local/mcp?tenant=a&api_key=K-SECRET')
    expect(httpOpts(StreamableHTTPClientTransport).rest).toEqual({})
    expect(info.url).toBe('http://gw.local/mcp?tenant=a')
    expect(JSON.stringify(mcpGetConnection(info.connectionId))).not.toContain('K-SECRET')
  })

  it('api-key in query on legacy SSE goes onto the SSE stream URL', async () => {
    await mcpConnect({
      transport: 'sse',
      url: 'http://gw.local/sse',
      auth: { type: 'api-key', apiKey: { key: 'k', value: 'v', in: 'query' } },
    })
    expect(vi.mocked(SSEClientTransport).mock.calls[0][0].toString()).toBe(
      'http://gw.local/sse?k=v',
    )
  })

  it('none / oauth2 auth change nothing (no requestInit when there are no headers)', async () => {
    await mcpConnect({ transport: 'http', url: 'http://gw.local/mcp', auth: { type: 'none' } })
    await mcpConnect({ transport: 'sse', url: 'http://gw.local/sse', auth: { type: 'oauth2' } })
    expect(httpOpts(StreamableHTTPClientTransport).rest).toEqual({})
    expect(httpOpts(SSEClientTransport).rest).toEqual({})
  })

  it('stdio ignores auth', async () => {
    await mcpConnect({
      transport: 'stdio',
      url: 'node server.js',
      auth: { type: 'bearer', bearer: { token: 'stdio-token' } },
    })
    const params = vi.mocked(StdioClientTransport).mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >
    expect(JSON.stringify(params)).not.toContain('stdio-token')
    expect(StreamableHTTPClientTransport).not.toHaveBeenCalled()
  })

  it('precedence end to end: auth < custom header < OAuth session token', async () => {
    await mcpConnect({
      transport: 'http',
      url: 'http://gw.local/mcp',
      headers: { Authorization: 'Bearer custom', 'X-Other': '1' },
      auth: { type: 'bearer', bearer: { token: 'auth-token' } },
      oauthSessionId: 'S1',
    })
    const opts = vi.mocked(StreamableHTTPClientTransport).mock.calls[0][1] as unknown as {
      requestInit: { headers: Record<string, string> }
      // The frame-tap fetch, wrapping the OAuth session's fetch.
      fetch: (url: string, init?: RequestInit) => Promise<Response>
    }
    // auth < custom: what the SDK merges into every request.
    expect(opts.requestInit.headers).toEqual({ 'X-Other': '1', Authorization: 'Bearer custom' })
    // custom < OAuth: the session's fetch sets its token over those headers.
    await opts.fetch('http://gw.local/mcp', { headers: opts.requestInit.headers })
    const sent = new Headers(oauthBaseFetch.mock.calls[0][1]?.headers)
    expect(sent.get('authorization')).toBe('Bearer token-of-S1')
    expect(sent.get('x-other')).toBe('1')
  })
})

// ─── SDK 2.x: version negotiation (issue #152) ────────────────
describe('mcp.engine — protocol option → versionNegotiation (issue #152)', () => {
  it('resolveNegotiation maps auto / legacy / modern pin / legacy pin', () => {
    // http: a bounded probe — a silent 2025 server falls back in seconds (legacy retry).
    const httpAuto = { versionNegotiation: { mode: 'auto', probe: { timeoutMs: 15_000 } } }
    expect(resolveNegotiation(undefined, 'http')).toEqual(httpAuto)
    expect(resolveNegotiation('auto', 'http')).toEqual(httpAuto)
    // stdio probes on a disposable sibling; a silent legacy server must not cost 60 s.
    expect(resolveNegotiation('auto', 'stdio')).toEqual({
      versionNegotiation: { mode: 'auto', probe: { timeoutMs: 10_000 } },
    })
    // Legacy HTTP+SSE predates 2026-07-28: auto stays on initialize.
    expect(resolveNegotiation('auto', 'sse')).toEqual({ versionNegotiation: { mode: 'legacy' } })
    expect(resolveNegotiation('legacy', 'http')).toEqual({ versionNegotiation: { mode: 'legacy' } })
    expect(resolveNegotiation('2026-07-28', 'http')).toEqual({
      versionNegotiation: { mode: { pin: '2026-07-28' } },
    })
    // The SDK refuses to pin a 2025 revision — that is initialize offering exactly it.
    expect(resolveNegotiation('2025-06-18', 'http')).toEqual({
      versionNegotiation: { mode: 'legacy' },
      supportedProtocolVersions: ['2025-06-18'],
    })
    expect(() => resolveNegotiation('latest', 'http')).toThrow(
      /Unknown MCP protocol option "latest"/,
    )
  })

  it('the Client is built with the negotiation, manual MRTR and the page cap', async () => {
    await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp', protocol: '2025-06-18' })
    const [info, options] = mockClient.ctor.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(info).toEqual({ name: 'Testnizer', version: '1.0.0' })
    expect(options).toEqual({
      versionNegotiation: { mode: 'auto', probe: { timeoutMs: 15_000 } },
      inputRequired: { autoFulfill: false },
      listMaxPages: 50,
    })
    expect(mockClient.ctor.mock.calls[1][1]).toMatchObject({
      versionNegotiation: { mode: 'legacy' },
      supportedProtocolVersions: ['2025-06-18'],
    })
  })

  it('an unknown protocol option rejects the connect before any transport is built', async () => {
    await expect(
      mcpConnect({ transport: 'http', url: 'http://mock.local/mcp', protocol: 'nope' }),
    ).rejects.toThrow(/Unknown MCP protocol option/)
    expect(StreamableHTTPClientTransport).not.toHaveBeenCalled()
  })
})

// ─── http 'auto': legacy retry when the probe itself fails (issue #152) ─
describe("mcp.engine — http 'auto' retries the plain 2025 handshake once (issue #152)", () => {
  const gatewayDenied = (): Error =>
    Object.assign(new Error('Version negotiation failed: the server denied access (HTTP 403)'), {
      name: 'SdkHttpError',
      code: 'CLIENT_HTTP_FORBIDDEN',
      status: 403,
    })

  it('a probe failure (403 / 5xx / timeout) → fresh legacy client + transport, connect succeeds', async () => {
    mockClient.connect.mockRejectedValueOnce(gatewayDenied())
    const info = await mcpConnect({ transport: 'http', url: 'http://gw.local/mcp' })
    expect(info.era).toBe('legacy')
    expect(mockClient.ctor).toHaveBeenCalledTimes(2)
    expect(mockClient.ctor.mock.calls[1][1]).toMatchObject({
      versionNegotiation: { mode: 'legacy' },
    })
    expect(StreamableHTTPClientTransport).toHaveBeenCalledTimes(2)
    // The first (abandoned) transport no longer drives the connection's lifecycle.
    const first = mockClient.connect.mock.calls[0][0]
    await tick()
    events = []
    first.onclose?.()
    first.onerror?.(new Error('late noise'))
    expect(events).toEqual([])
    expect(mcpGetConnection(info.connectionId)).toBeDefined()
  })

  it('when the legacy retry fails too, its error is the one reported', async () => {
    mockClient.connect
      .mockRejectedValueOnce(gatewayDenied())
      .mockRejectedValueOnce(new Error('Error POSTing to endpoint: legacy says no'))
    await expect(mcpConnect({ transport: 'http', url: 'http://gw.local/mcp' })).rejects.toThrow(
      'legacy says no',
    )
  })

  it('no retry on a 401, a pinned version, legacy mode, sse or stdio', async () => {
    const unauthorized = Object.assign(new Error('requires authorization (HTTP 401)'), {
      name: 'SdkHttpError',
      status: 401,
    })
    mockClient.connect.mockRejectedValueOnce(unauthorized)
    await expect(mcpConnect({ transport: 'http', url: 'http://x/mcp' })).rejects.toMatchObject({
      status: 401,
    })
    for (const opts of [
      { transport: 'http' as const, url: 'http://x/mcp', protocol: '2026-07-28' },
      { transport: 'http' as const, url: 'http://x/mcp', protocol: 'legacy' },
      { transport: 'sse' as const, url: 'http://x/sse' },
      { transport: 'stdio' as const, url: 'node s.js' },
    ]) {
      mockClient.connect.mockRejectedValueOnce(new Error('boom'))
      await expect(mcpConnect(opts)).rejects.toThrow('boom')
    }
    expect(mockClient.ctor).toHaveBeenCalledTimes(5)
  })

  it('a user cancel during the probe is final — no legacy retry', async () => {
    let release: () => void = () => {}
    mockClient.connect.mockImplementationOnce(
      (t: FakeTransport) =>
        new Promise<void>((_resolve, reject) => {
          release = () => reject(new Error('closed during probe'))
          t.close = vi.fn(async () => release())
        }),
    )
    const pending = mcpConnect({ transport: 'http', url: 'http://x/mcp', pendingId: 'p-1' })
    await tick()
    await expect(mcpCancelConnect('p-1')).resolves.toBe(true)
    await expect(pending).rejects.toThrow('closed during probe')
    expect(mockClient.ctor).toHaveBeenCalledTimes(1)
  })
})

// ─── SDK 2.x: modern era connect + subscriptions/listen (issue #152) ─
describe('mcp.engine — modern era: era / discover / listen (issue #152)', () => {
  const DISCOVER = {
    supportedVersions: ['2026-07-28'],
    capabilities: DEFAULT_CAPS,
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'MockServer', version: '2.0.0' } },
  }

  function fakeSubscription(honoredFilter: Record<string, unknown>): {
    sub: {
      honoredFilter: Record<string, unknown>
      close: ReturnType<typeof vi.fn>
      closed: Promise<string>
    }
    end: (reason: string) => void
  } {
    let end: (reason: string) => void = () => {}
    const closed = new Promise<string>((resolve) => {
      end = resolve
    })
    const sub = {
      honoredFilter,
      close: vi.fn(async () => end('local')),
      closed,
    }
    return { sub, end }
  }

  beforeEach(() => {
    mockClient.getProtocolEra.mockReturnValue('modern')
    mockClient.getNegotiatedProtocolVersion.mockReturnValue('2026-07-28')
    mockClient.getDiscoverResult.mockReturnValue(DISCOVER)
  })

  it('connect result carries era, protocolVersion and the discover result', async () => {
    const { sub } = fakeSubscription({ toolsListChanged: true })
    mockClient.listen.mockResolvedValue(sub)
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    expect(info.era).toBe('modern')
    expect(info.protocolVersion).toBe('2026-07-28')
    expect(info.discover).toEqual(DISCOVER)
    expect(info.discover).not.toBe(DISCOVER)
  })

  it('opens subscriptions/listen for the advertised listChanged capabilities; honoredFilter on the result + an open event', async () => {
    const { sub } = fakeSubscription({ toolsListChanged: true })
    mockClient.listen.mockResolvedValue(sub)
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    // DEFAULT_CAPS: only tools advertise listChanged.
    expect(mockClient.listen).toHaveBeenCalledWith({ toolsListChanged: true }, { timeout: 10_000 })
    expect(info.subscription).toEqual({
      requested: { toolsListChanged: true },
      honoredFilter: { toolsListChanged: true },
    })
    await tick()
    expect(events.filter((e) => e.type === 'subscriptionState')).toEqual([
      {
        type: 'subscriptionState',
        payload: {
          connectionId: info.connectionId,
          state: 'open',
          honoredFilter: { toolsListChanged: true },
        },
      },
    ])
  })

  it('no listChanged capability → no listen; legacy era → never listens', async () => {
    mockClient.getServerCapabilities.mockReturnValue({ tools: {} })
    const a = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    expect(a.subscription).toBeUndefined()
    mockClient.getServerCapabilities.mockReturnValue(DEFAULT_CAPS)
    mockClient.getProtocolEra.mockReturnValue('legacy')
    const b = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    expect(b.subscription).toBeUndefined()
    expect(mockClient.listen).not.toHaveBeenCalled()
  })

  it('a listen failure is reported on the result; the connection still works', async () => {
    mockClient.listen.mockRejectedValue(new Error('subscriptions/listen ack timed out'))
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    expect(info.subscription).toEqual({
      requested: { toolsListChanged: true },
      error: 'subscriptions/listen ack timed out',
    })
    await expect(mcpListTools(info.connectionId)).resolves.toHaveLength(2)
  })

  it('a server-ended subscription emits a closed event; disconnect closes it first and stays quiet', async () => {
    const first = fakeSubscription({ toolsListChanged: true })
    mockClient.listen.mockResolvedValueOnce(first.sub)
    const a = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await tick()
    first.end('remote')
    await tick()
    expect(events.filter((e) => e.type === 'subscriptionState').map((e) => e.payload)).toEqual([
      expect.objectContaining({ state: 'open' }),
      { connectionId: a.connectionId, state: 'closed', reason: 'remote' },
    ])

    const second = fakeSubscription({ toolsListChanged: true })
    mockClient.listen.mockResolvedValueOnce(second.sub)
    const b = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await tick()
    events = []
    await mcpDisconnect(b.connectionId)
    expect(second.sub.close).toHaveBeenCalledTimes(1)
    expect(second.sub.close.mock.invocationCallOrder[0]).toBeLessThan(
      mockClient.close.mock.invocationCallOrder[0],
    )
    await tick()
    expect(events.filter((e) => e.type === 'subscriptionState')).toEqual([])
  })
})

// ─── SDK 2.x: multi-round-trip tools/call (issue #152) ────────
describe('mcp.engine — 2026-07-28 input_required / respondInput (issue #152)', () => {
  const INPUT_REQUIRED = {
    resultType: 'input_required',
    inputRequests: {
      count: {
        method: 'elicitation/create',
        params: { mode: 'form', message: 'How many?', requestedSchema: { type: 'object' } },
      },
    },
    requestState: 'v1.sealed-state',
  }

  beforeEach(() => {
    mockClient.getProtocolEra.mockReturnValue('modern')
    mockClient.getNegotiatedProtocolVersion.mockReturnValue('2026-07-28')
    mockClient.getServerCapabilities.mockReturnValue({ tools: {} })
  })

  it('modern callTool opts into manual MRTR and declares form elicitation on that request only', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await mcpCallTool(info.connectionId, 'echo', { text: 'x' })
    const [params, opts] = mockClient.callTool.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(params).toEqual({
      name: 'echo',
      arguments: { text: 'x' },
      _meta: { [CLIENT_CAPABILITIES_META_KEY]: { elicitation: { form: {} } } },
    })
    expect(opts).toMatchObject({ allowInputRequired: true, resetTimeoutOnProgress: true })
    expect(opts).not.toHaveProperty('toolDefinition')
    // The Client itself declares nothing (a 2025 server would elicit with no handler).
    expect(mockClient.ctor.mock.calls[0][1]).not.toHaveProperty('capabilities')
  })

  it('a complete result is returned exactly as the SDK gave it', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const res = await mcpCallTool(info.connectionId, 'echo', {})
    expect(res).toEqual({ content: [{ type: 'text', text: 'echo-result' }] })
    expect(res).not.toHaveProperty('__mcp')
  })

  it('an input_required result keeps its raw shape and gains the __mcp marker', async () => {
    mockClient.callTool.mockResolvedValueOnce(INPUT_REQUIRED)
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const res = await mcpCallTool(info.connectionId, 'ask_count', {})
    expect(res).toEqual({
      ...INPUT_REQUIRED,
      __mcp: {
        kind: 'input_required',
        inputRequests: INPUT_REQUIRED.inputRequests,
        requestState: 'v1.sealed-state',
      },
    })
  })

  it('a listed tool with an outputSchema is called with its definition minus that schema', async () => {
    mockClient.listTools.mockResolvedValueOnce({
      tools: [
        {
          name: 'typed',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object', properties: { n: { type: 'number' } } },
        },
      ],
    })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await mcpListTools(info.connectionId)
    await mcpCallTool(info.connectionId, 'typed', {})
    const opts = mockClient.callTool.mock.calls[0][1] as {
      toolDefinition?: Record<string, unknown>
    }
    expect(opts.toolDefinition).toEqual({ name: 'typed', inputSchema: { type: 'object' } })
  })

  it('respondInput re-sends name + args with inputResponses / requestState as TOP-LEVEL params', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await mcpRespondInput(info.connectionId, 'ask_count', { label: 'apples' }, 'v1.sealed-state', {
      count: { action: 'accept', content: { count: 3 } },
    })
    expect(mockClient.callTool.mock.calls[0][0]).toEqual({
      name: 'ask_count',
      arguments: { label: 'apples' },
      inputResponses: { count: { action: 'accept', content: { count: 3 } } },
      requestState: 'v1.sealed-state',
      _meta: { [CLIENT_CAPABILITIES_META_KEY]: { elicitation: { form: {} } } },
    })
  })

  it('respondInput refuses a legacy connection and an empty answer', async () => {
    const modern = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await expect(mcpRespondInput(modern.connectionId, 't', {}, undefined, {})).rejects.toThrow(
      /Nothing to send/,
    )
    mockClient.getProtocolEra.mockReturnValue('legacy')
    mockClient.getNegotiatedProtocolVersion.mockReturnValue('2025-11-25')
    const legacy = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await expect(
      mcpRespondInput(legacy.connectionId, 't', {}, 's', { a: { action: 'decline' } }),
    ).rejects.toThrow(/need a 2026-07-28 connection \(this one negotiated 2025-11-25\)/)
    expect(mockClient.callTool).not.toHaveBeenCalled()
  })
})

// ─── SDK 2.x: HTTP frame tap = fetch middleware (issue #152) ──
describe('mcp.engine — http / sse inbound frames come from the wire (fetch middleware)', () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

  /** Connect over http with an OAuth stand-in so the tap wraps `oauthBaseFetch`; return the transport fetch. */
  async function tapFetch(
    transport: 'http' | 'sse' = 'http',
  ): Promise<{ connectionId: string; fetch: (u: string, i?: RequestInit) => Promise<Response> }> {
    const info = await mcpConnect({ transport, url: 'http://mock.local/mcp', oauthSessionId: 'S' })
    const ctor = transport === 'http' ? StreamableHTTPClientTransport : SSEClientTransport
    const opts = vi.mocked(ctor).mock.calls.at(-1)?.[1] as unknown as {
      fetch: (u: string, i?: RequestInit) => Promise<Response>
    }
    await tick()
    events = []
    return { connectionId: info.connectionId, fetch: opts.fetch }
  }

  const frames = (): Array<Extract<McpEngineEvent, { type: 'frame' }>['payload']> =>
    events.flatMap((e) => (e.type === 'frame' ? [e.payload] : []))

  it('a JSON response body becomes inbound frames (batches member by member); the SDK still reads the original', async () => {
    const { connectionId, fetch } = await tapFetch()
    oauthBaseFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { jsonrpc: '2.0', id: 1, result: { ok: true } },
          { jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } },
        ]),
        { headers: { 'content-type': 'application/json; charset=utf-8' } },
      ),
    )
    const res = await fetch('http://mock.local/mcp', { method: 'POST', body: '{}' })
    expect(await res.json()).toHaveLength(2)
    await tick()
    expect(frames().map((f) => [f.direction, f.message])).toEqual([
      ['in', { jsonrpc: '2.0', id: 1, result: { ok: true } }],
      ['in', { jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } }],
    ])
    expect(events.filter((e) => e.type === 'notification').map((e) => e.payload)).toEqual([
      {
        connectionId,
        ts: expect.any(Number),
        method: 'notifications/message',
        params: { level: 'info' },
      },
    ])
  })

  it('an SSE response is parsed event by event across chunk boundaries (CRLF, multi-line data, comments, other events)', async () => {
    const { fetch } = await tapFetch()
    const chunks = [
      ': keep-alive\r\n\r\n',
      'id: 1\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress",\r',
      '\ndata: "params":{"progress":1}}\r\n\r\n',
      'event: ping\ndata: {"jsonrpc":"2.0","method":"ignored"}\n\n',
      'data: {"jsonrpc":"2.0","id":7,"result":{}}\n',
      '\n',
    ]
    oauthBaseFetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const c of chunks) controller.enqueue(enc(c))
            controller.close()
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    )
    const res = await fetch('http://mock.local/mcp', { method: 'POST', body: '{}' })
    // The SDK's copy is intact.
    expect(await res.text()).toBe(chunks.join(''))
    await tick()
    expect(frames().map((f) => f.message)).toEqual([
      { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } },
      { jsonrpc: '2.0', id: 7, result: {} },
    ])
  })

  it('a POST error body (the 2025 server answering the server/discover probe) is a frame; a GET 405 body is not', async () => {
    const { fetch } = await tapFetch()
    const errorBody = { jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request' }, id: null }
    oauthBaseFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(errorBody), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await fetch('http://mock.local/mcp', { method: 'POST', body: '{}' })
    oauthBaseFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...errorBody, error: { code: -32000, message: 'Method not allowed.' } }),
        {
          status: 405,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    await fetch('http://mock.local/mcp', { method: 'GET' })
    await tick()
    expect(frames().map((f) => f.message)).toEqual([errorBody])
  })

  it('legacy sse: the inbound tap is the fetch too (no onmessage pre-set on http / sse)', async () => {
    await tapFetch('sse')
    expect(lastTransport().onmessage).toBeUndefined()
    await mcpConnect({ transport: 'stdio', url: 'node s.js' })
    expect(typeof lastTransport().onmessage).toBe('function')
  })

  it('transport errors during the handshake (the probe 4xx) are not reported; after it they are', async () => {
    mockClient.connect.mockImplementationOnce(async (t: FakeTransport) => {
      t.onerror?.(new Error('Error POSTing to endpoint: Bad Request'))
      await simulateHandshake(t)
    })
    await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await tick()
    expect(events.filter((e) => e.type === 'transportError')).toEqual([])
    lastTransport().onerror?.(new Error('later failure'))
    expect(events.filter((e) => e.type === 'transportError')).toHaveLength(1)
  })
})

// ─── SDK 2.x error messages (issue #152) ──────────────────────
describe('mcp.engine — decorateMcpError', () => {
  it('ProtocolError reads "MCP error <code>: …" (v1 wording), once', () => {
    const err = new ProtocolError(-32601, 'Method not found')
    expect((decorateMcpError(err) as Error).message).toBe('MCP error -32601: Method not found')
    expect((decorateMcpError(err) as Error).message).toBe('MCP error -32601: Method not found')
    expect(decorateMcpError(err)).toBe(err)
  })

  it('SdkHttpError names the status and spells out a JSON-RPC error body', () => {
    const text = JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32022,
        message: 'Unsupported protocol version: 2025-11-25',
        data: { supported: ['2026-07-28'], requested: '2025-11-25' },
      },
      id: 0,
    })
    const rpc = new SdkHttpError(
      SdkErrorCode.ClientHttpNotImplemented,
      `Error POSTing to endpoint: ${text}`,
      {
        status: 400,
        statusText: 'Bad Request',
        text,
      },
    )
    expect((decorateMcpError(rpc) as Error).message).toBe(
      'HTTP 400: MCP error -32022: Unsupported protocol version: 2025-11-25 (server supports 2026-07-28)',
    )
    expect((rpc as SdkHttpError).status).toBe(400)
    const plain = new SdkHttpError(
      SdkErrorCode.ClientHttpNotImplemented,
      'Error POSTing to endpoint: oops',
      {
        status: 500,
        statusText: 'Internal',
        text: 'oops',
      },
    )
    expect((decorateMcpError(plain) as Error).message).toBe(
      'Error POSTing to endpoint: oops (HTTP 500)',
    )
  })

  it('other errors are untouched', () => {
    const e = new SdkError(SdkErrorCode.EraNegotiationFailed, 'Version negotiation failed: x')
    expect((decorateMcpError(e) as Error).message).toBe('Version negotiation failed: x')
    expect(decorateMcpError('str')).toBe('str')
  })

  it('engine calls throw decorated errors', async () => {
    mockClient.callTool.mockRejectedValueOnce(new ProtocolError(-32602, 'bad args'))
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await expect(mcpCallTool(info.connectionId, 'x', {})).rejects.toThrow(
      'MCP error -32602: bad args',
    )
  })
})
