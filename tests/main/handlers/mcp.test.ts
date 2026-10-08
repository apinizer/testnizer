/**
 * Smoke tests for `mcp:*` IPC handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

/** Everything sent on the `console:log` IPC channel. */
let consoleEntries: unknown[] = []
/** Every non-console `webContents.send` (the MCP event channels, issue #139). */
let sentEvents: Array<{ channel: string; payload: unknown }> = []

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    // One live window, so `emitConsoleEntry` has somewhere to send.
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, entry: unknown) => {
            if (channel === 'console:log') consoleEntries.push(entry)
            else sentEvents.push({ channel, payload: entry })
          },
        },
      },
    ],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

let shouldFailConnect = false
/** Make the mocked connect fail like the SDK transports do on HTTP 401 (issue #141). */
let failWith401 = false
let shouldFailCapabilityCalls = false
/** The sink `registerMcpHandlers()` installs on the engine (issue #139). */
let installedSink: ((event: unknown) => void) | null = null
vi.mock('../../../src/main/protocols/mcp.engine', () => ({
  mcpConnect: vi.fn(async () => {
    if (shouldFailConnect) throw new Error('mcp fail')
    if (failWith401) {
      throw Object.assign(
        new Error('Streamable HTTP error: Error POSTing to endpoint: {"error":"unauthorized"}'),
        {
          code: 401,
        },
      )
    }
    return {
      connectionId: 'mcp-1',
      serverName: 'mock',
      serverVersion: '1.0',
      protocolVersion: '2025-06-18',
      capabilities: { tools: {}, resources: {}, prompts: {} },
    }
  }),
  mcpDisconnect: vi.fn(async () => {}),
  mcpCancelConnect: vi.fn(async () => true),
  mcpListTools: vi.fn(async () => [{ name: 'toolA' }, { name: 'toolB' }]),
  mcpCallTool: vi.fn(async () => ({ ok: true })),
  mcpListResources: vi.fn(async () => {
    if (shouldFailCapabilityCalls) throw new Error('resources boom')
    return {
      resources: [{ uri: 'test://greeting', name: 'greeting' }],
      templates: [{ uriTemplate: 'test://item/{id}', name: 'item' }],
    }
  }),
  mcpReadResource: vi.fn(async (_id: string, uri: string) => {
    if (shouldFailCapabilityCalls) throw new Error('read boom')
    return { contents: [{ uri, mimeType: 'text/plain', text: 'hi' }] }
  }),
  mcpListPrompts: vi.fn(async () => {
    if (shouldFailCapabilityCalls) throw new Error('prompts boom')
    return [{ name: 'summarize', arguments: [{ name: 'text', required: true }] }]
  }),
  mcpGetPrompt: vi.fn(async (_id: string, name: string) => {
    if (shouldFailCapabilityCalls) throw new Error('prompt boom')
    return { description: name, messages: [{ role: 'user', content: { type: 'text', text: 'x' } }] }
  }),
  setMcpEventSink: vi.fn((sink: ((event: unknown) => void) | null) => {
    installedSink = sink
  }),
}))

const { registerMcpHandlers } = await import('../../../src/main/ipc/mcp.handler')
const engine = await import('../../../src/main/protocols/mcp.engine')
const { mcpConnect } = engine

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  shouldFailConnect = false
  failWith401 = false
  shouldFailCapabilityCalls = false
  consoleEntries = []
  sentEvents = []
  installedSink = null
  vi.mocked(mcpConnect).mockClear()
  registerMcpHandlers()
})

describe('mcp:connect + disconnect', () => {
  it('connects and returns connectionId', async () => {
    const res = (await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://example/mcp',
    })) as { success: boolean; data?: { connectionId: string } }
    expect(res.success).toBe(true)
    expect(res.data?.connectionId).toBe('mcp-1')
  })

  it('returns error envelope on connect failure', async () => {
    shouldFailConnect = true
    const res = (await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://example/mcp',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/mcp fail/)
  })

  it('disconnects an existing connection', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://example/mcp',
    })
    const res = (await harness.invoke('mcp:disconnect', 'mcp-1')) as { success: boolean }
    expect(res.success).toBe(true)
  })
})

describe('mcp:connect OAuth (issue #141)', () => {
  it('forwards oauthSessionId to the engine and logs only whether OAuth was used', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://example/mcp',
      oauthSessionId: 'mcp-oauth-abc',
    })
    expect(vi.mocked(mcpConnect).mock.calls[0][0]).toMatchObject({
      oauthSessionId: 'mcp-oauth-abc',
    })
    const connectLog = JSON.stringify(consoleEntries)
    expect(connectLog).toContain('"oauth":true')
  })

  it('omits oauthSessionId when the renderer sent none', async () => {
    await harness.invoke('mcp:connect', { transport: 'http', url: 'http://example/mcp' })
    expect(vi.mocked(mcpConnect).mock.calls[0][0]).not.toHaveProperty('oauthSessionId')
  })

  it('flags a 401 connect failure with unauthorized: true', async () => {
    failWith401 = true
    const res = (await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://example/mcp',
    })) as { success: boolean; error?: string; unauthorized?: boolean }
    expect(res.success).toBe(false)
    expect(res.unauthorized).toBe(true)
    expect(res.error).toMatch(/401|unauthorized/i)
  })

  it('other failures carry no unauthorized flag', async () => {
    shouldFailConnect = true
    const res = (await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://example/mcp',
    })) as { success: boolean; unauthorized?: boolean }
    expect(res.success).toBe(false)
    expect(res).not.toHaveProperty('unauthorized')
  })
})

describe('mcp:listTools + callTool', () => {
  it('lists tools', async () => {
    const res = (await harness.invoke('mcp:listTools', 'mcp-1')) as {
      success: boolean
      data?: Array<{ name: string }>
    }
    expect(res.success).toBe(true)
    expect(res.data?.length).toBe(2)
  })

  it('calls a tool', async () => {
    const res = (await harness.invoke('mcp:callTool', 'mcp-1', 'toolA', {})) as {
      success: boolean
      data?: { ok: boolean }
    }
    expect(res.success).toBe(true)
    expect(res.data?.ok).toBe(true)
  })

  it('cancelConnect returns canceled flag', async () => {
    const res = (await harness.invoke('mcp:cancelConnect', 'pending-x')) as {
      success: boolean
      data?: { canceled: boolean }
    }
    expect(res.success).toBe(true)
    expect(res.data?.canceled).toBe(true)
  })
})

describe('mcp:connect custom headers (issue #137)', () => {
  const TOKEN = 'Bearer super-secret-137'
  const HEADERS = {
    Authorization: TOKEN,
    'X-Gateway-Token': 'gw-secret-137',
    'X-Gateway-Project': 'project1',
  }

  it('forwards options.headers to mcpConnect', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://127.0.0.1:8091/apigateway/project1/mcp-jira/',
      headers: HEADERS,
    })
    expect(vi.mocked(mcpConnect)).toHaveBeenCalledWith(
      expect.objectContaining({ transport: 'http', headers: HEADERS }),
    )
  })

  it('console log never carries raw credential values (success path)', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://gw.local/mcp',
      headers: HEADERS,
    })
    expect(consoleEntries.length).toBeGreaterThan(0)
    const wire = JSON.stringify(consoleEntries)
    expect(wire).not.toContain('super-secret-137')
    expect(wire).not.toContain('gw-secret-137')
    const entry = consoleEntries[0] as {
      details?: { requestHeaders?: Record<string, string>; meta?: Record<string, unknown> }
    }
    // Names stay visible for debugging; credential values are masked.
    expect(Object.keys(entry.details?.requestHeaders ?? {})).toEqual(Object.keys(HEADERS))
    expect(entry.details?.requestHeaders?.Authorization).toBe('••••••')
    expect(entry.details?.requestHeaders?.['X-Gateway-Token']).toBe('••••••')
    expect(entry.details?.requestHeaders?.['X-Gateway-Project']).toBe('project1')
    expect(entry.details?.meta?.headerCount).toBe(3)
  })

  it('console log never carries raw credential values (error path)', async () => {
    shouldFailConnect = true
    const res = (await harness.invoke('mcp:connect', {
      transport: 'sse',
      url: 'http://gw.local/sse',
      headers: HEADERS,
    })) as { success: boolean }
    expect(res.success).toBe(false)
    expect(consoleEntries.length).toBeGreaterThan(0)
    expect(JSON.stringify(consoleEntries)).not.toContain('super-secret-137')
  })
})

describe('mcp:connect Authorization tab (MCP Auth)', () => {
  const PASSWORD = 'pw-super-secret-auth'
  const TOKEN = 'tok-super-secret-auth'
  const API_KEY = 'key-super-secret-auth'

  it('forwards auth to mcpConnect unchanged', async () => {
    const auth = { type: 'basic', basic: { username: 'alice', password: PASSWORD } }
    await harness.invoke('mcp:connect', { transport: 'http', url: 'http://gw.local/mcp', auth })
    expect(vi.mocked(mcpConnect).mock.calls[0][0]).toMatchObject({ auth })
  })

  it('omits auth when the renderer sent none, a malformed value, or stdio', async () => {
    await harness.invoke('mcp:connect', { transport: 'http', url: 'http://gw.local/mcp' })
    await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://gw.local/mcp',
      auth: { type: 'kerberos' },
    })
    await harness.invoke('mcp:connect', {
      transport: 'sse',
      url: 'http://gw.local/sse',
      auth: 'Bearer nope',
    })
    await harness.invoke('mcp:connect', {
      transport: 'stdio',
      url: 'node server.js',
      auth: { type: 'bearer', bearer: { token: TOKEN } },
    })
    for (const call of vi.mocked(mcpConnect).mock.calls) {
      expect(call[0]).not.toHaveProperty('auth')
    }
  })

  it('console log names the auth type only — never a password, token or key (success path)', async () => {
    for (const auth of [
      { type: 'basic', basic: { username: 'alice', password: PASSWORD } },
      { type: 'bearer', bearer: { token: TOKEN, prefix: 'Bearer' } },
      { type: 'api-key', apiKey: { key: 'X-API-Key', value: API_KEY, in: 'query' } },
    ]) {
      await harness.invoke('mcp:connect', { transport: 'http', url: 'http://gw.local/mcp', auth })
    }
    const wire = JSON.stringify(consoleEntries)
    expect(wire).not.toContain(PASSWORD)
    expect(wire).not.toContain(TOKEN)
    expect(wire).not.toContain(API_KEY)
    const metas = (consoleEntries as Array<{ details?: { meta?: Record<string, unknown> } }>).map(
      (e) => e.details?.meta,
    )
    expect(metas.map((m) => m?.authType)).toEqual(['basic', 'bearer', 'api-key'])
    expect(metas[2]?.authIn).toBe('query')
    expect(metas[0]).not.toHaveProperty('authIn')
  })

  it('console log carries no credential on the error path either', async () => {
    shouldFailConnect = true
    const res = (await harness.invoke('mcp:connect', {
      transport: 'sse',
      url: 'http://gw.local/sse',
      auth: { type: 'bearer', bearer: { token: TOKEN } },
    })) as { success: boolean }
    expect(res.success).toBe(false)
    expect(consoleEntries.length).toBeGreaterThan(0)
    expect(JSON.stringify(consoleEntries)).not.toContain(TOKEN)
  })

  it('a connect without auth logs authType none', async () => {
    await harness.invoke('mcp:connect', { transport: 'http', url: 'http://gw.local/mcp' })
    const entry = consoleEntries[0] as { details?: { meta?: Record<string, unknown> } }
    expect(entry.details?.meta?.authType).toBe('none')
  })
})

describe('mcp:connect stdio env (issue #139)', () => {
  it('forwards options.env to mcpConnect', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'stdio',
      url: 'npx -y @scope/server',
      env: { GITHUB_TOKEN: 'ghp_secret139' },
    })
    expect(vi.mocked(mcpConnect)).toHaveBeenCalledWith(
      expect.objectContaining({ transport: 'stdio', env: { GITHUB_TOKEN: 'ghp_secret139' } }),
    )
  })

  it('console log carries the env count, never env values', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'stdio',
      url: 'npx -y @scope/server',
      env: { GITHUB_TOKEN: 'ghp_secret139', REGION: 'eu' },
    })
    const wire = JSON.stringify(consoleEntries)
    expect(wire).not.toContain('ghp_secret139')
    const entry = consoleEntries[0] as { details?: { meta?: Record<string, unknown> } }
    expect(entry.details?.meta?.envCount).toBe(2)
    expect(entry.details?.meta?.protocolVersion).toBe('2025-06-18')
  })

  it('connect envelope passes protocolVersion / capabilities through', async () => {
    const res = (await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://example/mcp',
    })) as { success: boolean; data?: { protocolVersion?: string; capabilities?: unknown } }
    expect(res.data?.protocolVersion).toBe('2025-06-18')
    expect(res.data?.capabilities).toEqual({ tools: {}, resources: {}, prompts: {} })
  })
})

describe('mcp resources / prompts channels (issue #139)', () => {
  it('mcp:listResources → { resources, templates }', async () => {
    const res = (await harness.invoke('mcp:listResources', 'mcp-1')) as {
      success: boolean
      data?: { resources: unknown[]; templates: unknown[] }
    }
    expect(res.success).toBe(true)
    expect(res.data?.resources).toEqual([{ uri: 'test://greeting', name: 'greeting' }])
    expect(res.data?.templates).toEqual([{ uriTemplate: 'test://item/{id}', name: 'item' }])
    expect(vi.mocked(engine.mcpListResources)).toHaveBeenCalledWith('mcp-1')
  })

  it('mcp:readResource forwards (connectionId, uri)', async () => {
    const res = (await harness.invoke('mcp:readResource', 'mcp-1', 'test://greeting')) as {
      success: boolean
      data?: { contents: Array<{ uri: string; text?: string }> }
    }
    expect(res.success).toBe(true)
    expect(res.data?.contents[0]).toEqual({
      uri: 'test://greeting',
      mimeType: 'text/plain',
      text: 'hi',
    })
    expect(vi.mocked(engine.mcpReadResource)).toHaveBeenCalledWith('mcp-1', 'test://greeting')
  })

  it('mcp:listPrompts → McpPrompt[]', async () => {
    const res = (await harness.invoke('mcp:listPrompts', 'mcp-1')) as {
      success: boolean
      data?: Array<{ name: string }>
    }
    expect(res.success).toBe(true)
    expect(res.data?.map((p) => p.name)).toEqual(['summarize'])
  })

  it('mcp:getPrompt forwards (connectionId, name, args)', async () => {
    const res = (await harness.invoke('mcp:getPrompt', 'mcp-1', 'summarize', {
      text: 'hello',
    })) as {
      success: boolean
      data?: { messages: unknown[] }
    }
    expect(res.success).toBe(true)
    expect(res.data?.messages).toHaveLength(1)
    expect(vi.mocked(engine.mcpGetPrompt)).toHaveBeenCalledWith('mcp-1', 'summarize', {
      text: 'hello',
    })
  })

  it('mcp:getPrompt with no args sends {}', async () => {
    await harness.invoke('mcp:getPrompt', 'mcp-1', 'summarize')
    expect(vi.mocked(engine.mcpGetPrompt)).toHaveBeenCalledWith('mcp-1', 'summarize', {})
  })

  it.each([
    ['mcp:listResources', ['mcp-1'], /resources boom/],
    ['mcp:readResource', ['mcp-1', 'test://x'], /read boom/],
    ['mcp:listPrompts', ['mcp-1'], /prompts boom/],
    ['mcp:getPrompt', ['mcp-1', 'p', {}], /prompt boom/],
  ])('%s → error envelope + console error entry', async (channel, args, msg) => {
    shouldFailCapabilityCalls = true
    const res = (await harness.invoke(channel, ...args)) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(msg)
    expect(consoleEntries.length).toBeGreaterThan(0)
  })
})

describe('mcp engine events → renderer broadcast (issue #139)', () => {
  it('registerMcpHandlers installs an engine sink', () => {
    expect(vi.mocked(engine.setMcpEventSink)).toHaveBeenCalled()
    expect(installedSink).toBeTypeOf('function')
  })

  it('notification / frame / connectionClosed go to every window on their own channels', () => {
    const notification = {
      connectionId: 'mcp-1',
      ts: 1,
      method: 'notifications/message',
      params: { level: 'info' },
    }
    const frame = {
      connectionId: 'mcp-1',
      ts: 2,
      direction: 'in',
      message: { jsonrpc: '2.0', id: 1, result: {} },
    }
    const closed = { connectionId: 'mcp-1', reason: 'Server process exited' }
    installedSink?.({ type: 'notification', payload: notification })
    installedSink?.({ type: 'frame', payload: frame })
    installedSink?.({ type: 'connectionClosed', payload: closed })
    expect(sentEvents).toEqual([
      { channel: 'mcp:notification', payload: notification },
      { channel: 'mcp:frame', payload: frame },
      { channel: 'mcp:connectionClosed', payload: closed },
    ])
    // An abnormal close is also console-logged.
    expect(JSON.stringify(consoleEntries)).toContain('Server process exited')
  })

  it('transportError is console-only, never broadcast as an MCP event', () => {
    installedSink?.({
      type: 'transportError',
      payload: { connectionId: 'mcp-1', message: 'HTTP 500' },
    })
    expect(sentEvents).toEqual([])
    expect(JSON.stringify(consoleEntries)).toContain('HTTP 500')
  })
})
