/**
 * Integration tests for `src/main/protocols/mcp.engine.ts`.
 *
 * Strategy: mock `@modelcontextprotocol/sdk` Client + transport modules so we
 * can exercise the engine's connection-management, tool listing, tool calling,
 * and error-propagation logic without opening any real network connection.
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
  connect: vi.fn<(t: FakeTransport) => Promise<void>>(),
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

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => makeClientInstance()),
}))

function fakeTransport(extra: Partial<FakeTransport>): FakeTransport {
  return {
    send: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    ...extra,
  }
}

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi
    .fn()
    .mockImplementation((url: URL, opts?: unknown) =>
      fakeTransport({ _url: url.toString(), _opts: opts }),
    ),
}))

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi
    .fn()
    .mockImplementation((url: URL, opts?: unknown) =>
      fakeTransport({ _url: url.toString(), _opts: opts }),
    ),
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation((opts: unknown) => fakeTransport({ _opts: opts })),
  getDefaultEnvironment: vi.fn(() => ({ PATH: '/usr/bin:/bin', HOME: '/home/tester' })),
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
  setMcpEventSink,
  type McpEngineEvent,
} from '../../src/main/protocols/mcp.engine'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

/** Engine events captured through the sink. */
let events: McpEngineEvent[] = []
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

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
    mockClient.getServerVersion.mockReturnValue(undefined as unknown as { name: string; version: string })
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
    mockClient.connect.mockRejectedValueOnce(new Error('Connection refused'))
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
    const [url, opts] = ctor.mock.calls[0]
    expect(url.toString()).toBe('http://gw.local/mcp')
    expect(opts).toEqual({ requestInit: { headers: HEADERS } })
  })

  it('sse: headers go to SSEClientTransport via requestInit.headers (SDK 1.29 applies them to the GET stream too)', async () => {
    await mcpConnect({ transport: 'sse', url: 'http://gw.local/sse', headers: HEADERS })
    const ctor = vi.mocked(SSEClientTransport)
    expect(ctor).toHaveBeenCalledTimes(1)
    const [, opts] = ctor.mock.calls[0]
    expect(opts).toEqual({ requestInit: { headers: HEADERS } })
  })

  it('no headers / empty map → transport built without options (unchanged default)', async () => {
    await mcpConnect({ transport: 'http', url: 'http://gw.local/mcp' })
    await mcpConnect({ transport: 'sse', url: 'http://gw.local/sse', headers: {} })
    expect(vi.mocked(StreamableHTTPClientTransport).mock.calls[0][1]).toBeUndefined()
    expect(vi.mocked(SSEClientTransport).mock.calls[0][1]).toBeUndefined()
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
  it('sse: protocolVersion comes from the initialize result frame (the SDK keeps none)', async () => {
    const info = await mcpConnect({ transport: 'sse', url: 'http://mock.local/sse' })
    expect(info.protocolVersion).toBe('2025-03-26')
  })

  it('stdio: protocolVersion comes from the initialize result frame', async () => {
    const info = await mcpConnect({ transport: 'stdio', url: 'node server.js' })
    expect(info.protocolVersion).toBe('2025-03-26')
  })

  it('http: the transport protocolVersion getter wins when set', async () => {
    vi.mocked(StreamableHTTPClientTransport).mockImplementationOnce(
      (url: URL) =>
        fakeTransport({
          _url: url.toString(),
          protocolVersion: '2025-06-18',
        }) as unknown as StreamableHTTPClientTransport,
    )
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    expect(info.protocolVersion).toBe('2025-06-18')
  })

  it('http: falls back to the initialize frame when the getter is empty', async () => {
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    expect(info.protocolVersion).toBe('2025-03-26')
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
    expect(vi.mocked(StreamableHTTPClientTransport).mock.calls[0][1]).toBeUndefined()
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
    await mcpConnect({ transport: 'stdio', url: '', command: 'C:\\Program Files\\srv.exe', args: [] })
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
    await mcpConnect({ transport: 'sse', url: 'http://gw.local/sse', oauthSessionId: 'mcp-oauth-x' })
    const httpOpts = vi.mocked(StreamableHTTPClientTransport).mock.calls[0][1] as Record<string, unknown>
    expect(httpOpts.requestInit).toEqual({ headers: { 'X-A': '1' } })
    expect(typeof httpOpts.fetch).toBe('function')
    const sseOpts = vi.mocked(SSEClientTransport).mock.calls[0][1] as Record<string, unknown>
    expect(sseOpts).not.toHaveProperty('requestInit')
    expect(typeof sseOpts.fetch).toBe('function')
  })

  it('stdio ignores oauthSessionId', async () => {
    await mcpConnect({ transport: 'stdio', url: 'node s.js', oauthSessionId: 'mcp-oauth-x' })
    const params = vi.mocked(StdioClientTransport).mock.calls[0][0] as unknown as Record<string, unknown>
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
    const [, schema, opts] = mockClient.callTool.mock.calls[0] as [
      unknown,
      unknown,
      { onprogress?: unknown; resetTimeoutOnProgress?: boolean },
    ]
    expect(schema).toBeUndefined()
    expect(typeof opts.onprogress).toBe('function')
    expect(opts.resetTimeoutOnProgress).toBe(true)
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
        resourceTemplates: [{ uriTemplate: 'test://item/{id}', name: 'item', mimeType: 'application/json' }],
        nextCursor: 't2',
      })
      .mockResolvedValueOnce({
        resourceTemplates: [{ uriTemplate: 'test://user/{name}', name: 'user', title: 'User' }],
      })
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    const res = await mcpListResources(info.connectionId)
    expect(res.resources).toEqual([
      { uri: 'test://a', name: 'a', title: 'A', description: 'first', mimeType: 'text/plain', size: 12 },
      { uri: 'test://b', name: 'b' },
    ])
    expect(res.templates).toEqual([
      { uriTemplate: 'test://item/{id}', name: 'item', mimeType: 'application/json' },
      { uriTemplate: 'test://user/{name}', name: 'user', title: 'User' },
    ])
    expect(mockClient.listResources.mock.calls.map((c) => c[0])).toEqual([undefined, { cursor: 'r2' }])
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
    expect(mockClient.readResource).toHaveBeenCalledWith({ uri: 'test://greeting' })
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
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    // Buffered: the IPC reply carrying connectionId must reach the renderer first.
    expect(events).toEqual([])
    await tick()
    const f = frames()
    expect(f.map((x) => [x.direction, (x.message as { method?: string }).method ?? 'result'])).toEqual([
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
    await expect(mcpConnect({ transport: 'http', url: 'http://x/mcp' })).rejects.toThrow('boom')
    await tick()
    expect(events).toEqual([])
  })

  it('every inbound JSON-RPC notification becomes a notification event, per connection', async () => {
    const a = await mcpConnect({ transport: 'http', url: 'http://a/mcp' })
    const ta = lastTransport()
    const b = await mcpConnect({ transport: 'sse', url: 'http://b/sse' })
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
      { connectionId: a.connectionId, ts: expect.any(Number), method: 'notifications/tools/list_changed' },
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
    await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
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
    const info = await mcpConnect({ transport: 'http', url: 'http://mock.local/mcp' })
    await tick()
    expect(() =>
      lastTransport().onmessage?.({ jsonrpc: '2.0', method: 'notifications/message' }),
    ).not.toThrow()
    expect(mcpGetConnection(info.connectionId)).toBeDefined()
  })
})
