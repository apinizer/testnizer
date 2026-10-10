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
/**
 * Make the mocked connect fail like SDK 2.x does on HTTP 401 (issue #141,
 * #152): `SdkHttpError` with the status in `.status` and a STRING `.code`
 * (Streamable HTTP / the negotiation probe), or the legacy SSE transport's
 * `SseError` with the EventSource status as a numeric `.code`.
 */
let failWith401: false | 'sdkHttpError' | 'sseError' = false
let shouldFailCapabilityCalls = false
/** The sink `registerMcpHandlers()` installs on the engine (issue #139). */
let installedSink: ((event: unknown) => void) | null = null
vi.mock('../../../src/main/protocols/mcp.engine', () => ({
  mcpConnect: vi.fn(async () => {
    if (shouldFailConnect) throw new Error('mcp fail')
    if (failWith401 === 'sdkHttpError') {
      throw Object.assign(
        new Error('Version negotiation failed: the server requires authorization (HTTP 401)'),
        { name: 'SdkHttpError', code: 'CLIENT_HTTP_AUTHENTICATION', status: 401 },
      )
    }
    if (failWith401 === 'sseError') {
      throw Object.assign(new Error('SSE error: Non-200 status code (401)'), { code: 401 })
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
  mcpCancelCall: vi.fn(() => true),
  mcpRespondElicitation: vi.fn(() => undefined),
  mcpRespondInput: vi.fn(async () => ({ content: [{ type: 'text', text: '3 apples' }] })),
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
// stdio connects record local run trust — keep it in memory, never a real settings file.
const { setStdioTrustStoreForTests } = await import('../../../src/main/lib/mcp-stdio-trust')
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
  const trustStore = new Map<string, unknown>()
  setStdioTrustStoreForTests({ get: (k) => trustStore.get(k), set: (k, v) => void trustStore.set(k, v) })
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

  it.each(['sdkHttpError', 'sseError'] as const)(
    'flags a 401 connect failure (%s) with unauthorized: true',
    async (kind) => {
      failWith401 = kind
      const res = (await harness.invoke('mcp:connect', {
        transport: kind === 'sseError' ? 'sse' : 'http',
        url: 'http://example/mcp',
      })) as { success: boolean; error?: string; unauthorized?: boolean }
      expect(res.success).toBe(false)
      expect(res.unauthorized).toBe(true)
      expect(res.error).toMatch(/401|unauthorized/i)
    },
  )

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

describe('mcp:connect protocol option (issue #152)', () => {
  it('forwards auto / legacy / a YYYY-MM-DD revision; drops anything else', async () => {
    for (const protocol of ['auto', 'legacy', '2026-07-28', ' 2025-06-18 ']) {
      await harness.invoke('mcp:connect', { transport: 'http', url: 'http://x/mcp', protocol })
    }
    await harness.invoke('mcp:connect', { transport: 'http', url: 'http://x/mcp', protocol: 'v2' })
    await harness.invoke('mcp:connect', { transport: 'http', url: 'http://x/mcp', protocol: 7 })
    const sent = vi
      .mocked(mcpConnect)
      .mock.calls.map((c) => (c[0] as { protocol?: string }).protocol)
    expect(sent).toEqual(['auto', 'legacy', '2026-07-28', '2025-06-18', undefined, undefined])
  })

  it('the CONNECT log names the negotiated era and what was requested', async () => {
    vi.mocked(mcpConnect).mockResolvedValueOnce({
      connectionId: 'mcp-9',
      transport: 'http',
      url: 'http://x/mcp',
      protocolVersion: '2026-07-28',
      era: 'modern',
    })
    await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://x/mcp',
      protocol: 'auto',
    })
    const log = JSON.stringify(consoleEntries)
    expect(log).toContain('"era":"modern"')
    expect(log).toContain('"protocolRequested":"auto"')
  })
})

describe('mcp:respondInput (issue #152)', () => {
  it('forwards (connectionId, tool, args, requestState, inputResponses) and wraps the result', async () => {
    const res = (await harness.invoke(
      'mcp:respondInput',
      'mcp-1',
      'ask_count',
      { label: 'apples' },
      'v1.state',
      { count: { action: 'accept', content: { count: 3 } } },
    )) as { success: boolean; data?: unknown }
    expect(res).toEqual({
      success: true,
      data: { content: [{ type: 'text', text: '3 apples' }] },
      timing: { durationMs: expect.any(Number), sizeBytes: expect.any(Number) },
    })
    expect(vi.mocked(engine.mcpRespondInput)).toHaveBeenCalledWith(
      'mcp-1',
      'ask_count',
      { label: 'apples' },
      'v1.state',
      { count: { action: 'accept', content: { count: 3 } } },
    )
    // The responses are user input — the console log names their keys only.
    const log = JSON.stringify(consoleEntries)
    expect(log).toContain('RESPOND_INPUT')
    expect(log).toContain('"inputResponseKeys":"count"')
  })

  it('malformed requestState / inputResponses are not forwarded; engine errors become the envelope', async () => {
    vi.mocked(engine.mcpRespondInput).mockRejectedValueOnce(new Error('Nothing to send'))
    const res = (await harness.invoke('mcp:respondInput', 'mcp-1', 't', {}, 42, ['x'])) as {
      success: boolean
      error?: string
    }
    expect(vi.mocked(engine.mcpRespondInput).mock.calls.at(-1)).toEqual([
      'mcp-1',
      't',
      {},
      undefined,
      undefined,
    ])
    expect(res).toEqual({
      success: false,
      error: 'Nothing to send',
      timing: { durationMs: expect.any(Number), sizeBytes: 0 },
    })
  })

  it('an input_required tools/call result is a success, logged as INPUT_REQUIRED', async () => {
    vi.mocked(engine.mcpCallTool).mockResolvedValueOnce({
      resultType: 'input_required',
      __mcp: { kind: 'input_required', inputRequests: {}, requestState: 's' },
    })
    const res = (await harness.invoke('mcp:callTool', 'mcp-1', 'ask_count', {})) as {
      success: boolean
    }
    expect(res.success).toBe(true)
    const log = JSON.stringify(consoleEntries)
    expect(log).toContain('INPUT_REQUIRED')
    expect(log).toContain('"inputRequired":true')
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

  it('subscriptionState goes to every window on mcp:subscriptionState (issue #152)', () => {
    const payload = { connectionId: 'mcp-1', state: 'closed', reason: 'remote' }
    installedSink?.({ type: 'subscriptionState', payload })
    expect(sentEvents).toEqual([{ channel: 'mcp:subscriptionState', payload }])
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

// ─── issue #163 / #164 / #166 / #168 / #169 ─────────────────────────────

type Envelope = {
  success: boolean
  data?: unknown
  error?: string
  cancelled?: boolean
  timing?: { durationMs: number; sizeBytes: number }
}

const cancelledError = (): Error =>
  Object.assign(new Error('MCP call cancelled by user'), {
    name: 'McpCallCancelledError',
    cancelled: true,
  })

describe('timing on call responses (issue #164)', () => {
  it.each([
    ['mcp:callTool', ['mcp-1', 'toolA', {}], { ok: true }],
    ['mcp:readResource', ['mcp-1', 'test://greeting'], null],
    ['mcp:getPrompt', ['mcp-1', 'summarize', { text: 'x' }], null],
    [
      'mcp:respondInput',
      ['mcp-1', 'ask_count', {}, 's', { count: { action: 'decline' } }],
      { content: [{ type: 'text', text: '3 apples' }] },
    ],
  ])('%s success carries { durationMs, sizeBytes } of the response JSON', async (channel, args) => {
    const res = (await harness.invoke(channel, ...args)) as Envelope
    expect(res.success).toBe(true)
    expect(res.timing?.durationMs).toBeGreaterThanOrEqual(0)
    expect(res.timing?.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(res.data), 'utf-8'))
  })

  it.each([
    ['mcp:readResource', ['mcp-1', 'test://x']],
    ['mcp:getPrompt', ['mcp-1', 'p', {}]],
  ])('%s failure carries timing with sizeBytes 0', async (channel, args) => {
    shouldFailCapabilityCalls = true
    const res = (await harness.invoke(channel, ...args)) as Envelope
    expect(res.success).toBe(false)
    expect(res.timing).toEqual({ durationMs: expect.any(Number), sizeBytes: 0 })
  })

  it('mcp:callTool failure carries timing with sizeBytes 0', async () => {
    vi.mocked(engine.mcpCallTool).mockRejectedValueOnce(new Error('tool boom'))
    const res = (await harness.invoke('mcp:callTool', 'mcp-1', 'toolA', {})) as Envelope
    expect(res).toEqual({
      success: false,
      error: 'tool boom',
      timing: { durationMs: expect.any(Number), sizeBytes: 0 },
    })
  })
})

describe('cancel a running call (issue #163)', () => {
  it('callTool / readResource / getPrompt / respondInput forward the callId to the engine', async () => {
    await harness.invoke('mcp:callTool', 'mcp-1', 'toolA', { a: 1 }, { callId: 'c-1' })
    expect(vi.mocked(engine.mcpCallTool)).toHaveBeenLastCalledWith(
      'mcp-1',
      'toolA',
      { a: 1 },
      {
        callId: 'c-1',
      },
    )
    await harness.invoke('mcp:readResource', 'mcp-1', 'test://greeting', { callId: 'r-1' })
    expect(vi.mocked(engine.mcpReadResource)).toHaveBeenLastCalledWith('mcp-1', 'test://greeting', {
      callId: 'r-1',
    })
    await harness.invoke('mcp:getPrompt', 'mcp-1', 'summarize', { text: 't' }, { callId: 'p-1' })
    expect(vi.mocked(engine.mcpGetPrompt)).toHaveBeenLastCalledWith(
      'mcp-1',
      'summarize',
      { text: 't' },
      { callId: 'p-1' },
    )
    await harness.invoke('mcp:respondInput', 'mcp-1', 't', {}, 's', { k: {} }, { callId: 'i-1' })
    expect(vi.mocked(engine.mcpRespondInput)).toHaveBeenLastCalledWith(
      'mcp-1',
      't',
      {},
      's',
      { k: {} },
      { callId: 'i-1' },
    )
  })

  it('issue #185: the tab timeout (timeoutMs, 0 = no limit) reaches the engine on all four calls', async () => {
    await harness.invoke('mcp:callTool', 'mcp-1', 'toolA', {}, { callId: 'c-2', timeoutMs: 4321 })
    expect(vi.mocked(engine.mcpCallTool)).toHaveBeenLastCalledWith('mcp-1', 'toolA', {}, {
      callId: 'c-2',
      timeoutMs: 4321,
    })
    await harness.invoke('mcp:readResource', 'mcp-1', 'test://greeting', { timeoutMs: 0 })
    expect(vi.mocked(engine.mcpReadResource)).toHaveBeenLastCalledWith('mcp-1', 'test://greeting', {
      timeoutMs: 0,
    })
    await harness.invoke('mcp:getPrompt', 'mcp-1', 'summarize', {}, { callId: 'p-2', timeoutMs: 9 })
    expect(vi.mocked(engine.mcpGetPrompt)).toHaveBeenLastCalledWith('mcp-1', 'summarize', {}, {
      callId: 'p-2',
      timeoutMs: 9,
    })
    await harness.invoke('mcp:respondInput', 'mcp-1', 't', {}, 's', { k: {} }, { timeoutMs: 77 })
    expect(vi.mocked(engine.mcpRespondInput)).toHaveBeenLastCalledWith(
      'mcp-1',
      't',
      {},
      's',
      { k: {} },
      { timeoutMs: 77 },
    )
    // Garbage is dropped — the engine then applies the shared default.
    await harness.invoke('mcp:callTool', 'mcp-1', 'toolA', {}, { timeoutMs: -1 })
    expect(vi.mocked(engine.mcpCallTool)).toHaveBeenLastCalledWith('mcp-1', 'toolA', {})
  })

  it('mcp:cancelCall → { cancelled } from the engine', async () => {
    const res = (await harness.invoke('mcp:cancelCall', 'mcp-1', 'c-1')) as Envelope
    expect(res).toEqual({ success: true, data: { cancelled: true } })
    expect(vi.mocked(engine.mcpCancelCall)).toHaveBeenLastCalledWith('mcp-1', 'c-1')
    vi.mocked(engine.mcpCancelCall).mockReturnValueOnce(false)
    expect(await harness.invoke('mcp:cancelCall', 'mcp-1', 'gone')).toEqual({
      success: true,
      data: { cancelled: false },
    })
  })

  it.each([
    ['mcp:callTool', 'mcpCallTool', ['mcp-1', 'slow', {}, { callId: 'c-1' }]],
    ['mcp:readResource', 'mcpReadResource', ['mcp-1', 'test://slow', { callId: 'r-1' }]],
    ['mcp:getPrompt', 'mcpGetPrompt', ['mcp-1', 'slow', {}, { callId: 'p-1' }]],
  ] as const)(
    '%s: a user cancel resolves { success:false, cancelled:true, timing }',
    async (channel, fn, args) => {
      vi.mocked(engine[fn]).mockRejectedValueOnce(cancelledError())
      const res = (await harness.invoke(channel, ...args)) as Envelope
      expect(res).toEqual({
        success: false,
        error: 'MCP call cancelled by user',
        cancelled: true,
        timing: { durationMs: expect.any(Number), sizeBytes: 0 },
      })
    },
  )
})

describe('elicitation bridge (issue #168)', () => {
  it('the engine elicitation event is broadcast on mcp:elicitation', () => {
    const payload = {
      connectionId: 'mcp-1',
      elicitationId: 'e-1',
      serverName: 'srv',
      message: 'Name?',
      requestedSchema: { type: 'object', properties: {} },
      mode: 'form',
    }
    installedSink?.({ type: 'elicitation', payload })
    expect(sentEvents).toEqual([{ channel: 'mcp:elicitation', payload }])
  })

  it('mcp:respondElicitation forwards the answer; engine errors become the envelope', async () => {
    const answer = { action: 'accept', content: { name: 'Ada' } }
    expect(await harness.invoke('mcp:respondElicitation', 'mcp-1', 'e-1', answer)).toEqual({
      success: true,
    })
    expect(vi.mocked(engine.mcpRespondElicitation)).toHaveBeenLastCalledWith('mcp-1', 'e-1', answer)
    vi.mocked(engine.mcpRespondElicitation).mockImplementationOnce(() => {
      throw new Error('No pending elicitation e-9')
    })
    expect(
      await harness.invoke('mcp:respondElicitation', 'mcp-1', 'e-9', { action: 'decline' }),
    ).toEqual({ success: false, error: 'No pending elicitation e-9' })
  })

  it('the answer content is never console-logged', async () => {
    await harness.invoke('mcp:respondElicitation', 'mcp-1', 'e-1', {
      action: 'accept',
      content: { secret: 'answer-168' },
    })
    expect(JSON.stringify(consoleEntries)).not.toContain('answer-168')
  })
})

describe('redirect credential drop (issue #169)', () => {
  it('is broadcast as a notification AND written to the console (names only)', () => {
    const payload = {
      connectionId: 'mcp-1',
      ts: 1,
      method: 'notifications/testnizer/redirect_credentials_dropped',
      params: { from: 'http://a.test', to: 'http://b.test', headers: ['X-API-Key'] },
    }
    installedSink?.({ type: 'notification', payload })
    expect(sentEvents).toEqual([{ channel: 'mcp:notification', payload }])
    const log = JSON.stringify(consoleEntries)
    expect(log).toContain('X-API-Key')
    expect(log).toContain('http://b.test')
  })
})

describe('history rows for tools / resources / prompts (issue #166)', () => {
  type Row = {
    protocol: string
    method: string
    url: string
    status_code: number
    project_id: string | null
    workspace_id: string | null
    endpoint_id: string | null
    request_snapshot: string
    response_snapshot: string | null
  }
  const rows = (): Row[] =>
    testDb.prepare('SELECT * FROM history ORDER BY executed_at ASC, rowid ASC').all() as Row[]
  const snapshot = (row: Row): { mcp: Record<string, unknown> } =>
    JSON.parse(row.request_snapshot) as { mcp: Record<string, unknown> }

  async function connectHttp(): Promise<void> {
    await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://user:pw@gw.local/mcp?token=abc&x=1',
      headers: { 'X-API-Key': 'hdr-secret' },
      auth: { type: 'bearer', bearer: { token: 'bearer-secret' } },
      protocol: 'auto',
    })
  }

  it('a tool call is CALL_TOOL against the server URL with a restorable mcp snapshot', async () => {
    await connectHttp()
    const ctx = { workspaceId: 'w-1', projectId: 'p-1', endpointId: 'e-1' }
    await harness.invoke(
      'mcp:callTool',
      'mcp-1',
      'get_weather',
      {
        city: 'Ankara',
        apiKey: 'arg-secret',
        nested: { password: 'pw-2' },
        days: 3,
        max_tokens: 256,
        session_flag: true,
      },
      ctx,
    )
    const [row] = rows()
    expect(row).toMatchObject({
      protocol: 'mcp',
      method: 'CALL_TOOL',
      url: 'http://gw.local/mcp?token=***&x=1',
      status_code: 0,
      workspace_id: 'w-1',
      project_id: 'p-1',
      endpoint_id: 'e-1',
    })
    expect(snapshot(row)).toEqual({
      mcp: {
        transport: 'http',
        url: 'http://gw.local/mcp?token=***&x=1',
        protocol: 'auto',
        capability: 'tool',
        name: 'get_weather',
        // Only string values under credential-like names are masked — numbers
        // and booleans survive, so the restored call still validates.
        args: {
          city: 'Ankara',
          apiKey: '••••••',
          nested: { password: '••••••' },
          days: 3,
          max_tokens: 256,
          session_flag: true,
        },
      },
    })
    expect(JSON.parse(row.response_snapshot ?? 'null')).toEqual({ ok: true })
    const all = JSON.stringify(rows())
    for (const secret of ['arg-secret', 'pw-2', 'hdr-secret', 'bearer-secret', 'abc', 'user:pw']) {
      expect(all).not.toContain(secret)
    }
  })

  it('a resource read is READ_RESOURCE with the uri; a prompt get is GET_PROMPT with name + args', async () => {
    await connectHttp()
    await harness.invoke('mcp:readResource', 'mcp-1', 'test://greeting', {
      callId: 'r-1',
      projectId: 'p-1',
    })
    await harness.invoke(
      'mcp:getPrompt',
      'mcp-1',
      'summarize',
      { text: 'hello' },
      {
        projectId: 'p-1',
      },
    )
    const [read, prompt] = rows()
    expect(read).toMatchObject({
      method: 'READ_RESOURCE',
      url: 'http://gw.local/mcp?token=***&x=1',
    })
    expect(read.project_id).toBe('p-1')
    expect(snapshot(read).mcp).toEqual({
      transport: 'http',
      url: 'http://gw.local/mcp?token=***&x=1',
      protocol: 'auto',
      capability: 'resource',
      uri: 'test://greeting',
    })
    expect(JSON.parse(read.response_snapshot ?? 'null')).toEqual({
      contents: [{ uri: 'test://greeting', mimeType: 'text/plain', text: 'hi' }],
    })
    expect(prompt).toMatchObject({ method: 'GET_PROMPT', project_id: 'p-1' })
    expect(snapshot(prompt).mcp).toEqual({
      transport: 'http',
      url: 'http://gw.local/mcp?token=***&x=1',
      protocol: 'auto',
      capability: 'prompt',
      name: 'summarize',
      args: { text: 'hello' },
    })
  })

  it('stdio: the url is the command line with credential-like arguments masked; env is never stored', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'stdio',
      url: '',
      command: 'npx',
      args: [
        '-y',
        '@scope/server',
        '--api-key',
        'argv-secret',
        '--token=tok-secret',
        '--port',
        '9',
      ],
      env: { API_TOKEN: 'env-secret' },
    })
    await harness.invoke('mcp:callTool', 'mcp-1', 'echo', { text: 'hi' })
    const [row] = rows()
    expect(row.url).toBe('npx -y @scope/server --api-key *** --token=*** --port 9')
    expect(snapshot(row).mcp).toMatchObject({ transport: 'stdio', url: row.url, protocol: 'auto' })
    const all = JSON.stringify(rows())
    for (const secret of ['argv-secret', 'tok-secret', 'env-secret'])
      expect(all).not.toContain(secret)
  })

  it('failures and user cancels are recorded with status -1 and the error', async () => {
    await connectHttp()
    vi.mocked(engine.mcpCallTool).mockRejectedValueOnce(new Error('tool boom'))
    await harness.invoke('mcp:callTool', 'mcp-1', 'a', {})
    vi.mocked(engine.mcpReadResource).mockRejectedValueOnce(cancelledError())
    await harness.invoke('mcp:readResource', 'mcp-1', 'test://slow', { callId: 'r-1' })
    const [failed, cancelled] = rows()
    expect(failed).toMatchObject({ method: 'CALL_TOOL', status_code: -1 })
    expect(JSON.parse(failed.response_snapshot ?? '{}')).toEqual({ error: 'tool boom' })
    expect(snapshot(failed).mcp).toMatchObject({ capability: 'tool', name: 'a', args: {} })
    expect(cancelled).toMatchObject({ method: 'READ_RESOURCE', status_code: -1 })
    expect(JSON.parse(cancelled.response_snapshot ?? '{}')).toEqual({
      error: 'MCP call cancelled by user',
      cancelled: true,
    })
  })

  it('respondInput rows stay RESPOND_INPUT with the tool snapshot (restores as the original call)', async () => {
    await connectHttp()
    await harness.invoke('mcp:respondInput', 'mcp-1', 'ask_count', { label: 'x' }, 's', {
      count: { action: 'accept', content: { count: 3 } },
    })
    const [row] = rows()
    expect(row.method).toBe('RESPOND_INPUT')
    expect(snapshot(row).mcp).toMatchObject({
      capability: 'tool',
      name: 'ask_count',
      args: { label: 'x' },
    })
    // The user's form answers are not part of the restorable request.
    expect(row.request_snapshot).not.toContain('inputResponses')
  })
})

describe('history scope fallback (issue #166)', () => {
  it('a call without scope is filed under the scope the connection last saw', async () => {
    await harness.invoke('mcp:connect', { transport: 'http', url: 'http://gw.local/mcp' })
    await harness.invoke(
      'mcp:callTool',
      'mcp-1',
      'echo',
      {},
      { workspaceId: 'w-9', projectId: 'p-9' },
    )
    await harness.invoke('mcp:readResource', 'mcp-1', 'test://greeting', { callId: 'r-9' })
    await harness.invoke('mcp:getPrompt', 'mcp-1', 'summarize', { text: 'x' })
    const scoped = testDb
      .prepare('SELECT method, workspace_id, project_id FROM history ORDER BY rowid ASC')
      .all() as Array<{ method: string; workspace_id: string | null; project_id: string | null }>
    expect(scoped).toEqual([
      { method: 'CALL_TOOL', workspace_id: 'w-9', project_id: 'p-9' },
      { method: 'READ_RESOURCE', workspace_id: 'w-9', project_id: 'p-9' },
      { method: 'GET_PROMPT', workspace_id: 'w-9', project_id: 'p-9' },
    ])
  })
})

describe('review round: history snapshot + console masking', () => {
  type Row = { url: string; project_id: string | null; request_snapshot: string }
  const rows = (): Row[] =>
    testDb.prepare('SELECT * FROM history ORDER BY executed_at ASC, rowid ASC').all() as Row[]

  it('item 8: the connection dropping while the call runs keeps the History target + scope', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://gw.local/mcp?token=abc',
      protocol: '2026-07-28',
    })
    await harness.invoke('mcp:callTool', 'mcp-1', 'warm', {}, { projectId: 'p-8' })
    let fail: (e: Error) => void = () => {}
    vi.mocked(engine.mcpCallTool).mockImplementationOnce(
      () => new Promise((_resolve, reject) => (fail = reject)),
    )
    const pending = harness.invoke('mcp:callTool', 'mcp-1', 'slow', {})
    await Promise.resolve()
    // The transport dies mid-call: main forgets the connection context…
    installedSink?.({ type: 'connectionClosed', payload: { connectionId: 'mcp-1', reason: 'gone' } })
    fail(new Error('connection closed'))
    await pending
    const row = rows()[1]
    // …but the row still names the server, not the connection id.
    expect(row.url).toBe('http://gw.local/mcp?token=***')
    expect(row.project_id).toBe('p-8')
    expect(JSON.parse(row.request_snapshot).mcp).toMatchObject({
      transport: 'http',
      url: 'http://gw.local/mcp?token=***',
      protocol: '2026-07-28',
    })
  })

  it('item 15: a stdio command line without args is split quote-aware for History', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'stdio',
      url: '',
      command: 'node "C:\\My Tools\\srv.js" --api-key k1',
    })
    await harness.invoke('mcp:callTool', 'mcp-1', 'echo', {})
    expect(rows()[0].url).toBe('node "C:\\My Tools\\srv.js" --api-key ***')
  })

  it('item 18: CONNECT and call console entries never carry the raw URL secret or credential args', async () => {
    await harness.invoke('mcp:connect', {
      transport: 'http',
      url: 'http://user:pw@gw.local/mcp?api_key=url-secret&x=1',
    })
    await harness.invoke('mcp:callTool', 'mcp-1', 'echo', { text: 'hi', api_key: 'arg-secret' })
    await harness.invoke('mcp:getPrompt', 'mcp-1', 'p', { password: 'prompt-secret' })
    await harness.invoke('mcp:respondInput', 'mcp-1', 'echo', { token: 'input-secret' }, 's', {})
    const all = JSON.stringify(consoleEntries)
    for (const secret of ['url-secret', 'user:pw', 'arg-secret', 'prompt-secret', 'input-secret']) {
      expect(all).not.toContain(secret)
    }
    // Non-secret parts stay readable.
    expect(all).toContain('gw.local/mcp')
    expect(all).toContain('hi')
  })
})
