/**
 * Issue #139 — MCP store: per-connection event routing, ring buffers, stdio
 * env, auto-load on connect, owner-tab discipline for async results (the
 * issue #76 class), and what is / is not persisted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { MCP_LOG_LIMIT } from '../../src/renderer/lib/mcp-store-helpers'
import type { Environment, KeyValuePair, Tab } from '../../src/renderer/types'
import type {
  McpConnectRequest,
  McpConnectionClosedEvent,
  McpFrameEvent,
  McpNotificationEvent,
} from '../../src/renderer/types/mcp'

interface Handlers {
  notification?: (e: McpNotificationEvent) => void
  frame?: (e: McpFrameEvent) => void
  closed?: (e: McpConnectionClosedEvent) => void
}

const ALL_CAPS = { tools: { listChanged: true }, resources: {}, prompts: {} }

function installApi(opts: { caps?: Record<string, unknown>; deferConnect?: boolean } = {}) {
  const handlers: Handlers = {}
  let seq = 0
  const pending: Array<() => void> = []
  const connect = vi.fn((req: McpConnectRequest) => {
    const connectionId = `conn-${++seq}`
    const result = {
      success: true,
      data: {
        connectionId,
        transport: req.transport,
        url: req.url,
        serverName: 'mock',
        serverVersion: '1.2.3',
        protocolVersion: '2025-06-18',
        capabilities: opts.caps ?? ALL_CAPS,
        instructions: 'be nice',
      },
    }
    if (!opts.deferConnect) return Promise.resolve(result)
    return new Promise<typeof result>((resolve) => pending.push(() => resolve(result)))
  })
  const mcp = {
    connect,
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    listTools: vi.fn(async (cid: string) => ({
      success: true,
      data: [{ name: `tool-of-${cid}`, inputSchema: {} }],
    })),
    callTool: vi.fn(async () => ({ success: true, data: { content: [] } })),
    listResources: vi.fn(async () => ({
      success: true,
      data: {
        resources: [{ uri: 'test://greeting', name: 'greeting' }],
        templates: [{ uriTemplate: 'test://item/{id}', name: 'item' }],
      },
    })),
    readResource: vi.fn(async (_cid: string, uri: string) => ({
      success: true,
      data: { contents: [{ uri, text: 'hello' }] },
    })),
    listPrompts: vi.fn(async () => ({
      success: true,
      data: [{ name: 'summarize', arguments: [{ name: 'text', required: true }] }],
    })),
    getPrompt: vi.fn(async () => ({
      success: true,
      data: { messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }] },
    })),
    onNotification: vi.fn((cb: Handlers['notification']) => {
      handlers.notification = cb
      return () => undefined
    }),
    onFrame: vi.fn((cb: Handlers['frame']) => {
      handlers.frame = cb
      return () => undefined
    }),
    onConnectionClosed: vi.fn((cb: Handlers['closed']) => {
      handlers.closed = cb
      return () => undefined
    }),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return { mcp, handlers, resolveNextConnect: () => pending.shift()?.() }
}

function row(key: string, value: string, enabled = true): KeyValuePair {
  return { id: `${key}-${Math.random().toString(36).slice(2, 7)}`, key, value, enabled }
}

function setActiveEnv(vars: Record<string, string>): void {
  const env: Environment = {
    id: 'env-139',
    workspace_id: 'ws-1',
    name: 'E',
    is_active: true,
    variables: Object.entries(vars).map(([key, value], i) => ({
      id: `v${i}`,
      key,
      value,
      enabled: true,
      secret: false,
    })),
    created_at: 0,
    updated_at: 0,
  }
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    environments: [env],
    globalVariables: [],
    activeEnvironmentId: env.id,
  })
}

/** Open tab `id` in the MCP store with the given url and connect it. */
async function connectTab(id: string, url: string): Promise<string> {
  useMcpStore.getState().switchToTab(id)
  useMcpStore.setState({ url })
  await useMcpStore.getState().connect()
  return useMcpStore.getState().connectionId as string
}

const frame = (connectionId: string, n: number): McpFrameEvent => ({
  connectionId,
  ts: 1000 + n,
  direction: n % 2 ? 'in' : 'out',
  message: { jsonrpc: '2.0', id: n, method: 'tools/list' },
})

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-init')
  setActiveEnv({})
})

describe('event routing — by connectionId, never "the active tab"', () => {
  it('a notification for tab A lands in A while tab B is active', async () => {
    const { handlers } = installApi()
    const connA = await connectTab('tab-a', 'http://a.test/mcp')
    const connB = await connectTab('tab-b', 'http://b.test/mcp')
    expect(useMcpStore.getState()._currentTabId).toBe('tab-b')

    handlers.notification?.({
      connectionId: connA,
      ts: 1,
      method: 'notifications/message',
      params: { level: 'info', data: 'for A' },
    })
    handlers.frame?.(frame(connB, 1))

    // Active tab B got only its own frame.
    expect(useMcpStore.getState().notifications).toEqual([])
    expect(useMcpStore.getState().frames).toHaveLength(1)
    // A's cached slice got the notification.
    const a = useMcpStore.getState()._tabStates.get('tab-a')
    expect(a?.notifications.map((n) => n.method)).toEqual(['notifications/message'])
    expect(a?.frames).toEqual([])

    useMcpStore.getState().switchToTab('tab-a')
    expect(useMcpStore.getState().notifications[0].params).toEqual({ level: 'info', data: 'for A' })
  })

  it('an event for an unknown connection changes no tab', async () => {
    const { handlers } = installApi()
    await connectTab('tab-a', 'http://a.test/mcp')
    handlers.notification?.({ connectionId: 'conn-nobody', ts: 1, method: 'x' })
    handlers.frame?.(frame('conn-nobody', 1))
    expect(useMcpStore.getState().notifications).toEqual([])
    expect(useMcpStore.getState().frames).toEqual([])
  })

  it('frames that arrive before connect resolves (the initialize round-trip) are kept', async () => {
    const { handlers, resolveNextConnect } = installApi({ deferConnect: true })
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({ url: 'http://a.test/mcp' })
    const done = useMcpStore.getState().connect()
    await Promise.resolve()
    handlers.frame?.(frame('conn-1', 0))
    handlers.frame?.(frame('conn-1', 1))
    resolveNextConnect()
    await done
    expect(useMcpStore.getState().connectionId).toBe('conn-1')
    expect(useMcpStore.getState().frames.map((f) => f.direction)).toEqual(['out', 'in'])
  })

  // A1's bridge delivers the initialize handshake frames one macrotask AFTER
  // `mcp:connect` resolves — the store must have written the connectionId to
  // the owning tab synchronously after the await, or they are dropped.
  it('handshake frames delivered a macrotask after connect resolves land on the tab', async () => {
    const { mcp, handlers } = installApi()
    mcp.connect.mockImplementationOnce(async (req: McpConnectRequest) => {
      setTimeout(() => {
        handlers.frame?.({
          connectionId: 'conn-late',
          ts: 1,
          direction: 'out',
          message: { jsonrpc: '2.0', id: 0, method: 'initialize' },
        })
        handlers.frame?.({
          connectionId: 'conn-late',
          ts: 2,
          direction: 'in',
          message: { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-06-18' } },
        })
      }, 0)
      return {
        success: true,
        data: {
          connectionId: 'conn-late',
          transport: req.transport,
          url: req.url,
          capabilities: ALL_CAPS,
        },
      }
    })
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({ url: 'http://a.test/mcp' })
    const done = useMcpStore.getState().connect()
    // Switch away before the late frames arrive — they must still find tab A.
    await Promise.resolve()
    await Promise.resolve()
    useMcpStore.getState().switchToTab('tab-b')
    await done
    await new Promise((r) => setTimeout(r, 5))

    expect(useMcpStore.getState().frames).toEqual([])
    const a = useMcpStore.getState()._tabStates.get('tab-a')
    expect(a?.connectionId).toBe('conn-late')
    expect(a?.frames.map((f) => (f.message as { method?: string }).method ?? 'result')).toEqual([
      'initialize',
      'result',
    ])
  })

  it('connectionClosed without a reason (user disconnect) → disconnected, no error', async () => {
    const { handlers } = installApi()
    const cid = await connectTab('tab-a', 'http://a.test/mcp')
    handlers.closed?.({ connectionId: cid })
    const s = useMcpStore.getState()
    expect(s.connectionState).toBe('disconnected')
    expect(s.errorMessage).toBeNull()
    expect(s.connectionId).toBeNull()
  })

  it('connectionClosed disconnects only the owning tab and keeps its config + log', async () => {
    const { handlers } = installApi()
    const connA = await connectTab('tab-a', 'http://a.test/mcp')
    useMcpStore.getState().setHeaders([row('X-Keep', 'v')])
    handlers.frame?.(frame(connA, 1))
    await connectTab('tab-b', 'http://b.test/mcp')

    handlers.closed?.({ connectionId: connA, reason: 'Server process exited' })

    expect(useMcpStore.getState().connectionState).toBe('connected') // B untouched
    const a = useMcpStore.getState()._tabStates.get('tab-a')
    expect(a?.connectionState).toBe('error')
    expect(a?.errorMessage).toBe('Server process exited')
    expect(a?.connectionId).toBeNull()
    expect(a?.tools).toEqual([])
    expect(a?.customHeaders.map((h) => h.key)).toEqual(['X-Keep'])
    expect(a?.frames).toHaveLength(1)
  })

  it('a */list_changed notification re-fetches that list for the owning tab', async () => {
    const { handlers, mcp } = installApi()
    const connA = await connectTab('tab-a', 'http://a.test/mcp')
    await connectTab('tab-b', 'http://b.test/mcp')
    mcp.listTools.mockClear()
    handlers.notification?.({
      connectionId: connA,
      ts: 1,
      method: 'notifications/tools/list_changed',
    })
    await vi.waitFor(() => expect(mcp.listTools).toHaveBeenCalledWith(connA))
  })
})

describe('ring buffers', () => {
  it(`notifications and frames are capped at ${MCP_LOG_LIMIT}, oldest dropped`, async () => {
    const { handlers } = installApi()
    const cid = await connectTab('tab-a', 'http://a.test/mcp')
    for (let i = 0; i < MCP_LOG_LIMIT + 10; i++) {
      handlers.frame?.(frame(cid, i))
      handlers.notification?.({ connectionId: cid, ts: i, method: `m-${i}` })
    }
    const s = useMcpStore.getState()
    expect(s.frames).toHaveLength(MCP_LOG_LIMIT)
    expect(s.notifications).toHaveLength(MCP_LOG_LIMIT)
    expect(s.notifications[0].method).toBe('m-10')
    expect(s.notifications[MCP_LOG_LIMIT - 1].method).toBe(`m-${MCP_LOG_LIMIT + 9}`)
    expect((s.frames[0].message as { id: number }).id).toBe(10)
  })
})

describe('connect payload — stdio env + command line', () => {
  it('stdio sends enabled env rows ({{var}} resolved) and splits the command line', async () => {
    const { mcp } = installApi()
    setActiveEnv({ key: 'secret-1' })
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({ transport: 'stdio', url: 'node "/My Tools/server.js" --flag' })
    useMcpStore
      .getState()
      .setEnvVars([row('API_KEY', '{{key}}'), row('OFF', 'x', false), row('', 'orphan')])
    useMcpStore.getState().setHeaders([row('Authorization', 'Bearer x')])
    await useMcpStore.getState().connect()

    const req = mcp.connect.mock.calls[0][0]
    expect(req.env).toEqual({ API_KEY: 'secret-1' })
    expect(req.command).toBe('node')
    expect(req.args).toEqual(['/My Tools/server.js', '--flag'])
    expect(req).not.toHaveProperty('headers')
  })

  it('http / sse never send env, and stdio without env rows sends no env key', async () => {
    const { mcp } = installApi()
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({ transport: 'http', url: 'http://a.test/mcp' })
    useMcpStore.getState().setEnvVars([row('API_KEY', 'v')])
    await useMcpStore.getState().connect()
    expect(mcp.connect.mock.calls[0][0]).not.toHaveProperty('env')
    expect(mcp.connect.mock.calls[0][0]).not.toHaveProperty('command')

    useMcpStore.getState().switchToTab('tab-b')
    useMcpStore.setState({ transport: 'stdio', url: 'node s.js' })
    await useMcpStore.getState().connect()
    expect(mcp.connect.mock.calls[1][0]).not.toHaveProperty('env')
  })
})

describe('auto-load on connect', () => {
  it('stores protocol version / capabilities and loads tools, resources and prompts', async () => {
    const { mcp } = installApi()
    await connectTab('tab-a', 'http://a.test/mcp')
    await vi.waitFor(() => expect(useMcpStore.getState().prompts).toHaveLength(1))
    const s = useMcpStore.getState()
    expect(s.protocolVersion).toBe('2025-06-18')
    expect(s.serverVersion).toBe('1.2.3')
    expect(s.capabilities).toEqual(ALL_CAPS)
    expect(s.instructions).toBe('be nice')
    expect(s.tools.map((t) => t.name)).toEqual(['tool-of-conn-1'])
    expect(s.resources.map((r) => r.uri)).toEqual(['test://greeting'])
    expect(s.resourceTemplates.map((r) => r.uriTemplate)).toEqual(['test://item/{id}'])
    expect(mcp.listResources).toHaveBeenCalledWith('conn-1')
  })

  it('skips the lists the server capabilities rule out', async () => {
    const { mcp } = installApi({ caps: { tools: {} } })
    await connectTab('tab-a', 'http://a.test/mcp')
    expect(mcp.listTools).toHaveBeenCalled()
    expect(mcp.listResources).not.toHaveBeenCalled()
    expect(mcp.listPrompts).not.toHaveBeenCalled()
  })

  it('a connect that resolves after a tab switch lands on the tab that started it', async () => {
    const { resolveNextConnect } = installApi({ deferConnect: true })
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({ url: 'http://a.test/mcp' })
    const done = useMcpStore.getState().connect()
    useMcpStore.getState().switchToTab('tab-b')
    resolveNextConnect()
    await done

    expect(useMcpStore.getState().connectionState).toBe('disconnected') // B
    const a = useMcpStore.getState()._tabStates.get('tab-a')
    expect(a?.connectionState).toBe('connected')
    expect(a?.connectionId).toBe('conn-1')
    expect(a?.tools.map((t) => t.name)).toEqual(['tool-of-conn-1'])
  })

  it('a cancelled handshake that still succeeds is closed, not adopted', async () => {
    const { mcp, resolveNextConnect } = installApi({ deferConnect: true })
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({ url: 'http://a.test/mcp' })
    const done = useMcpStore.getState().connect()
    await useMcpStore.getState().disconnect()
    resolveNextConnect()
    await done
    expect(useMcpStore.getState().connectionState).toBe('disconnected')
    expect(mcp.disconnect).toHaveBeenCalledWith('conn-1')
  })
})

describe('resources / prompts', () => {
  it('a template is edited into a concrete URI before Read', async () => {
    const { mcp } = installApi()
    await connectTab('tab-a', 'http://a.test/mcp')
    await vi.waitFor(() => expect(useMcpStore.getState().resourceTemplates).toHaveLength(1))
    useMcpStore.getState().selectResource('test://item/{id}')
    expect(useMcpStore.getState().resourceUriDraft).toBe('test://item/{id}')
    await useMcpStore.getState().readResource()
    expect(mcp.readResource).not.toHaveBeenCalled()
    expect(useMcpStore.getState().resourceError).toMatch(/placeholders/)

    useMcpStore.getState().setResourceUriDraft('test://item/42')
    await useMcpStore.getState().readResource()
    // Issue #163: every call carries its cancellable callId.
    expect(mcp.readResource).toHaveBeenCalledWith('conn-1', 'test://item/42', {
      callId: expect.any(String),
    })
    expect(useMcpStore.getState().resourceContent?.contents[0].text).toBe('hello')
  })

  it('getPrompt enforces required arguments, then sends them', async () => {
    const { mcp } = installApi()
    await connectTab('tab-a', 'http://a.test/mcp')
    await vi.waitFor(() => expect(useMcpStore.getState().prompts).toHaveLength(1))
    useMcpStore.getState().setSelectedPrompt('summarize')
    await useMcpStore.getState().getPrompt()
    expect(mcp.getPrompt).not.toHaveBeenCalled()
    expect(useMcpStore.getState().promptError).toMatch(/text/)

    useMcpStore.getState().setPromptArg('text', 'long text')
    await useMcpStore.getState().getPrompt()
    expect(mcp.getPrompt).toHaveBeenCalledWith(
      'conn-1',
      'summarize',
      { text: 'long text' },
      { callId: expect.any(String) },
    )
    expect(useMcpStore.getState().promptResult?.messages).toHaveLength(1)
  })
})

describe('env rows — dirty flag, disconnect, config import, persistence', () => {
  it('env edits mark the active MCP tab dirty', () => {
    const tab = { id: 'tab-a', name: 'MCP', protocol: 'mcp', savedRequestId: 'sr' } as Tab
    useTabsStore.setState({ tabs: [tab], activeTabId: 'tab-a' })
    useMcpStore.getState().addEnvVar()
    expect(useTabsStore.getState().tabs[0].isDirty).toBe(true)
  })

  it('disconnect keeps env rows and the message log', async () => {
    const { handlers } = installApi()
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({ transport: 'stdio', url: 'node s.js' })
    const rows = [row('API_KEY', 'v')]
    useMcpStore.getState().setEnvVars(rows)
    await useMcpStore.getState().connect()
    handlers.frame?.(frame('conn-1', 1))
    await useMcpStore.getState().disconnect()
    const s = useMcpStore.getState()
    expect(s.envVars).toEqual(rows)
    expect(s.frames).toHaveLength(1)
    expect(s.connectionState).toBe('disconnected')
  })

  it('applyServerConfig fills transport, command line, env and headers', () => {
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.getState().applyServerConfig({
      name: 'fs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'pkg', '/My Docs'],
      env: { K: 'v' },
    })
    let s = useMcpStore.getState()
    expect(s.transport).toBe('stdio')
    expect(s.url).toBe('npx -y pkg "/My Docs"')
    expect(s.envVars.map((r) => [r.key, r.value])).toEqual([['K', 'v']])

    useMcpStore.getState().applyServerConfig({
      name: 'gw',
      transport: 'sse',
      url: 'https://gw.test/sse',
      headers: { Authorization: 'Bearer t' },
    })
    s = useMcpStore.getState()
    expect(s.transport).toBe('sse')
    expect(s.url).toBe('https://gw.test/sse')
    expect(s.customHeaders.map((r) => [r.key, r.value])).toEqual([['Authorization', 'Bearer t']])
    expect(s.envVars.map((r) => r.key)).toEqual([''])
  })

  it('persists envVars but never frames / notifications / connection state', async () => {
    const { handlers } = installApi()
    const cid = await connectTab('tab-a', 'http://a.test/mcp')
    useMcpStore.getState().setEnvVars([row('PERSIST_ME', '1')])
    handlers.frame?.(frame(cid, 1))
    handlers.notification?.({ connectionId: cid, ts: 1, method: 'm' })
    useMcpStore.getState().switchToTab('tab-b') // tab-a now lives in _tabStates

    const parsed = JSON.parse(localStorage.getItem('testnizer-mcp') as string) as {
      _tabStates: [string, Record<string, unknown>][]
    }
    const a = parsed._tabStates.find(([id]) => id === 'tab-a')?.[1]
    expect((a?.envVars as KeyValuePair[]).map((r) => r.key)).toEqual(['PERSIST_ME'])
    expect(a?.frames).toEqual([])
    expect(a?.notifications).toEqual([])
    expect(a?.connectionId).toBeNull()
    expect(a?.connectionState).toBe('disconnected')
    expect(a?.tools).toEqual([])
    // …while the in-memory cache still holds the live connection.
    expect(useMcpStore.getState()._tabStates.get('tab-a')?.frames).toHaveLength(1)
  })
})

describe('closing a tab while its connect is in flight', () => {
  it('cancels the handshake, closes the late connection and leaves no ghost tab', async () => {
    const { mcp, resolveNextConnect } = installApi({ deferConnect: true })
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({ url: 'http://slow.test/mcp' })
    const done = useMcpStore.getState().connect()
    await Promise.resolve()
    const pendingId = useMcpStore.getState()._pendingConnectId
    expect(pendingId).toBeTruthy()

    // Ctrl+W on the live tab; the Workbench then activates the next tab.
    useMcpStore.getState().removeTabState('tab-a')
    expect(mcp.cancelConnect).toHaveBeenCalledWith(pendingId)
    useMcpStore.getState().switchToTab('tab-b')
    expect(useMcpStore.getState()._tabStates.has('tab-a')).toBe(false)

    resolveNextConnect()
    await done
    // The engine finished anyway: its connection belongs to nobody → closed.
    expect(mcp.disconnect).toHaveBeenCalledWith('conn-1')
    expect(useMcpStore.getState()._tabStates.has('tab-a')).toBe(false)
    expect(useMcpStore.getState().connectionId).toBeNull()
    expect(mcp.listTools).not.toHaveBeenCalled()
  })

  it('a connect that resolves before the next tab is activated is closed too', async () => {
    const { mcp, resolveNextConnect } = installApi({ deferConnect: true })
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({ url: 'http://slow.test/mcp' })
    const done = useMcpStore.getState().connect()
    await Promise.resolve()
    useMcpStore.getState().removeTabState('tab-a')
    resolveNextConnect()
    await done
    expect(mcp.disconnect).toHaveBeenCalledWith('conn-1')
    expect(useMcpStore.getState().connectionId).toBeNull()
    expect(useMcpStore.getState().connectionState).toBe('disconnected')
    useMcpStore.getState().switchToTab('tab-b')
    expect(useMcpStore.getState()._tabStates.has('tab-a')).toBe(false)
  })
})
