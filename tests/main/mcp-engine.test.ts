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

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock the SDK BEFORE importing the engine ─────────────────
const mockClient = {
  connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  getServerVersion: vi
    .fn<() => { name: string; version: string }>()
    .mockReturnValue({ name: 'MockServer', version: '2.0.0' }),
  listTools: vi.fn().mockResolvedValue({
    tools: [
      {
        name: 'echo',
        description: 'Returns its input unchanged',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      },
      {
        name: 'add',
        description: 'Adds two numbers',
        inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      },
    ],
  }),
  callTool: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'echo-result' }],
  }),
  close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => mockClient),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation((url: URL) => ({ _url: url.toString() })),
}))

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn().mockImplementation((url: URL) => ({ _url: url.toString() })),
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation((opts: unknown) => ({ _opts: opts })),
}))

import {
  mcpConnect,
  mcpDisconnect,
  mcpListTools,
  mcpCallTool,
  mcpGetConnection,
  mcpDisconnectAll,
} from '../../src/main/protocols/mcp.engine'

// ─── Reset between tests ──────────────────────────────────────
beforeEach(() => {
  mcpDisconnectAll()
  vi.clearAllMocks()
  mockClient.connect.mockResolvedValue(undefined)
  mockClient.getServerVersion.mockReturnValue({ name: 'MockServer', version: '2.0.0' })
  mockClient.listTools.mockResolvedValue({
    tools: [
      { name: 'echo', description: 'Returns its input unchanged', inputSchema: {} },
      { name: 'add', description: 'Adds two numbers', inputSchema: {} },
    ],
  })
  mockClient.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'echo-result' }] })
  mockClient.close.mockResolvedValue(undefined)
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
    expect(mockClient.callTool).toHaveBeenCalledWith({ name: 'echo', arguments: { text: 'hello' } })
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
