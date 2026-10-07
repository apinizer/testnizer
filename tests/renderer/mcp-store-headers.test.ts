/**
 * Issue #137 — MCP client custom HTTP headers (renderer store).
 *
 * The MCP tab must send user-defined headers (e.g. `Authorization: Bearer …`,
 * API-gateway `X-…` headers) on the Streamable HTTP / SSE handshake. These
 * tests pin the store contract:
 *   - only enabled rows with a non-empty key are sent;
 *   - `{{var}}` resolves in key AND value from the active environment;
 *   - stdio sends no headers;
 *   - `disconnect()` keeps the rows (only the live connection is torn down);
 *   - the rows are part of the per-tab state (`extractState`) — they survive
 *     a tab switch round-trip and land in the persisted localStorage blob.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Environment, KeyValuePair, Tab } from '../../src/renderer/types'

interface ConnectOptions {
  transport: string
  url: string
  headers?: Record<string, string>
  _pendingId?: string
}

function installMockApi(): { connect: ReturnType<typeof vi.fn> } {
  const connect = vi.fn(async (_opts: ConnectOptions) => ({
    success: true,
    data: { connectionId: 'mcp-conn-1', serverName: 'mock' },
  }))
  const api = {
    mcp: {
      connect,
      cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: false } })),
      disconnect: vi.fn(async () => ({ success: true, data: true })),
      listTools: vi.fn(async () => ({ success: true, data: [] })),
      callTool: vi.fn(async () => ({ success: true, data: null })),
    },
  }
  ;(window as unknown as { api: typeof api }).api = api
  return { connect }
}

function row(key: string, value: string, enabled = true): KeyValuePair {
  return { id: `${key}-${Math.random().toString(36).slice(2, 7)}`, key, value, enabled }
}

function setActiveEnv(vars: Record<string, string>): void {
  const env: Environment = {
    id: 'env-137',
    workspace_id: 'ws-1',
    name: 'Gateway',
    is_active: true,
    variables: Object.entries(vars).map(([key, value], i) => ({
      id: `v${i}`,
      key,
      value,
      enabled: true,
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

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({
    transport: 'http',
    url: 'http://127.0.0.1:8091/apigateway/project1/mcp-jira/',
    customHeaders: [],
    connectionId: null,
    connectionState: 'disconnected',
    _tabStates: new Map(),
    _currentTabId: null,
  })
  setActiveEnv({})
})

describe('mcp.store — custom headers on connect (issue #137)', () => {
  it('sends only enabled rows with a key, resolving {{var}} in key and value', async () => {
    const { connect } = installMockApi()
    setActiveEnv({ token: 'abc-123', hdr: 'X-Gateway-Project', project: 'project1' })
    useMcpStore
      .getState()
      .setHeaders([
        row('Authorization', 'Bearer {{token}}'),
        row('{{hdr}}', '{{project}}'),
        row('X-Disabled', 'nope', false),
        row('', 'orphan-value'),
        row('   ', 'blank-key'),
      ])

    await useMcpStore.getState().connect()

    expect(connect).toHaveBeenCalledTimes(1)
    const opts = connect.mock.calls[0][0] as ConnectOptions
    expect(opts.transport).toBe('http')
    expect(opts.headers).toEqual({
      Authorization: 'Bearer abc-123',
      'X-Gateway-Project': 'project1',
    })
  })

  it('sends no headers key when no row qualifies', async () => {
    const { connect } = installMockApi()
    useMcpStore.getState().setHeaders([row('X-Off', 'v', false), row('', 'v')])
    await useMcpStore.getState().connect()
    const opts = connect.mock.calls[0][0] as ConnectOptions
    expect(opts).not.toHaveProperty('headers')
  })

  it('sse transport sends the headers too', async () => {
    const { connect } = installMockApi()
    useMcpStore.setState({ transport: 'sse', url: 'http://gw.local/sse' })
    useMcpStore.getState().setHeaders([row('Authorization', 'Bearer s')])
    await useMcpStore.getState().connect()
    const opts = connect.mock.calls[0][0] as ConnectOptions
    expect(opts.transport).toBe('sse')
    expect(opts.headers).toEqual({ Authorization: 'Bearer s' })
  })

  it('stdio sends no headers', async () => {
    const { connect } = installMockApi()
    useMcpStore.setState({ transport: 'stdio', url: 'node server.js' })
    useMcpStore.getState().setHeaders([row('Authorization', 'Bearer s')])
    await useMcpStore.getState().connect()
    const opts = connect.mock.calls[0][0] as ConnectOptions
    expect(opts).not.toHaveProperty('headers')
  })

  it('disconnect() keeps the header rows, transport and url', async () => {
    installMockApi()
    const rows = [row('Authorization', 'Bearer keep')]
    useMcpStore.setState({ transport: 'sse', url: 'http://gw.local/sse' })
    useMcpStore.getState().setHeaders(rows)
    await useMcpStore.getState().connect()
    expect(useMcpStore.getState().connectionState).toBe('connected')

    await useMcpStore.getState().disconnect()

    const s = useMcpStore.getState()
    expect(s.connectionState).toBe('disconnected')
    expect(s.connectionId).toBeNull()
    expect(s.customHeaders).toEqual(rows)
    expect(s.transport).toBe('sse')
    expect(s.url).toBe('http://gw.local/sse')
  })
})

describe('mcp.store — headers are per-tab state (extractState)', () => {
  it('survive a tab switch round-trip; a fresh tab starts with one blank row', () => {
    const store = useMcpStore.getState()
    store.switchToTab('tab-a')
    useMcpStore.getState().setHeaders([row('X-Tab', 'A')])

    useMcpStore.getState().switchToTab('tab-b')
    const fresh = useMcpStore.getState().customHeaders
    expect(fresh).toHaveLength(1)
    expect(fresh[0].key).toBe('')

    useMcpStore.getState().switchToTab('tab-a')
    expect(useMcpStore.getState().customHeaders.map((h) => [h.key, h.value])).toEqual([
      ['X-Tab', 'A'],
    ])
  })

  it('are written to the persisted localStorage blob', () => {
    useMcpStore.getState().setHeaders([row('X-Persist', 'yes')])
    const raw = localStorage.getItem('testnizer-mcp')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw as string) as { current: { customHeaders: KeyValuePair[] } }
    expect(parsed.current.customHeaders.map((h) => h.key)).toEqual(['X-Persist'])
  })
})

describe('mcp.store — header edits flag the active tab dirty', () => {
  it('addHeader / updateHeader / removeHeader mark the active MCP tab dirty', () => {
    const tab: Tab = { id: 'tab-mcp', name: 'MCP', protocol: 'mcp', savedRequestId: 'sr-1' } as Tab
    const isDirty = (): boolean =>
      useTabsStore.getState().tabs.find((t) => t.id === 'tab-mcp')?.isDirty ?? false
    const reset = (): void => useTabsStore.getState().markDirty('tab-mcp', false)
    useTabsStore.setState({ tabs: [tab], activeTabId: 'tab-mcp' })

    useMcpStore.getState().addHeader()
    expect(isDirty()).toBe(true)

    reset()
    const id = useMcpStore.getState().customHeaders[0].id
    useMcpStore.getState().updateHeader(id, { key: 'X-Edit' })
    expect(isDirty()).toBe(true)

    reset()
    useMcpStore.getState().removeHeader(id)
    expect(isDirty()).toBe(true)
  })
})
