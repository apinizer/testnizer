/**
 * MCP Auth — the Authorization tab of an MCP request (renderer store + pure
 * slice). Pins:
 *   - Connect sends `auth` with `{{var}}` resolved in every field, nothing
 *     for No Auth / an empty config / OAuth 2.1 / stdio;
 *   - the OAuth token session rides Connect only while the type is OAuth 2.1;
 *   - `setAuth` flags the tab dirty, the config-tab layout setters do not;
 *   - auth + config tab + fold state are per-tab and persisted;
 *   - a 401 lands on Authorization / OAuth 2.1 (but keeps a configured
 *     Basic / Bearer / API key), "Authorize…" switches explicitly;
 *   - `normalizeMcpAuth` / `resolveMcpAuth` / `effectiveConfigTab`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import {
  availableConfigTabs,
  effectiveConfigTab,
  normalizeMcpAuth,
  resolveMcpAuth,
} from '../../src/renderer/stores/mcp-auth.slice'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Environment, Tab } from '../../src/renderer/types'
import type { McpConnectRequest } from '../../src/renderer/types/mcp'

function installApi(opts: { connect401?: boolean } = {}) {
  const mcp = {
    connect: vi.fn(async (req: McpConnectRequest) =>
      opts.connect401
        ? { success: false, error: 'Streamable HTTP error: HTTP 401', unauthorized: true }
        : {
            success: true,
            data: { connectionId: 'conn-1', transport: req.transport, url: req.url },
          },
    ),
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    listTools: vi.fn(async () => ({ success: true, data: [] })),
    callTool: vi.fn(async () => ({ success: true, data: {} })),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return mcp
}

function setActiveEnv(vars: Record<string, string>): void {
  const env: Environment = {
    id: 'env-auth',
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

const lastConnect = (mcp: ReturnType<typeof installApi>): McpConnectRequest =>
  mcp.connect.mock.calls.at(-1)?.[0] as McpConnectRequest

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-auth')
  useMcpStore.setState({ transport: 'http', url: 'http://srv.test/mcp' })
  setActiveEnv({})
})

describe('connect sends the Authorization tab', () => {
  it('a fresh tab is No Auth on the Authorization config tab, unfolded — and sends no auth', async () => {
    const mcp = installApi()
    const s = useMcpStore.getState()
    expect(s.auth).toEqual({ type: 'none' })
    expect(s.configTab).toBe('auth')
    expect(s.configCollapsed).toBe(false)
    await s.connect()
    expect(lastConnect(mcp)).not.toHaveProperty('auth')
  })

  it('basic: {{var}} resolved in username and password', async () => {
    const mcp = installApi()
    setActiveEnv({ user: 'alice', pass: 's3cret' })
    useMcpStore.getState().setAuth({
      type: 'basic',
      basic: { username: '{{user}}', password: '{{pass}}' },
    })
    await useMcpStore.getState().connect()
    expect(lastConnect(mcp).auth).toEqual({
      type: 'basic',
      basic: { username: 'alice', password: 's3cret' },
    })
  })

  it('bearer: token and prefix resolved; an empty prefix is left to main (defaults to Bearer)', async () => {
    const mcp = installApi()
    setActiveEnv({ tok: 'abc-123', pfx: 'Token' })
    useMcpStore.getState().setAuth({ type: 'bearer', bearer: { token: '{{tok}}', prefix: '' } })
    await useMcpStore.getState().connect()
    expect(lastConnect(mcp).auth).toEqual({ type: 'bearer', bearer: { token: 'abc-123' } })

    useMcpStore
      .getState()
      .setAuth({ type: 'bearer', bearer: { token: '{{tok}}', prefix: '{{pfx}}' } })
    await useMcpStore.getState().connect()
    expect(lastConnect(mcp).auth).toEqual({
      type: 'bearer',
      bearer: { token: 'abc-123', prefix: 'Token' },
    })
  })

  it('api-key: key / value resolved, placement kept', async () => {
    const mcp = installApi()
    setActiveEnv({ k: 'X-API-Key', v: 'key-1' })
    useMcpStore.getState().setAuth({
      type: 'api-key',
      apiKey: { key: '{{k}}', value: '{{v}}', in: 'query' },
    })
    await useMcpStore.getState().connect()
    expect(lastConnect(mcp).auth).toEqual({
      type: 'api-key',
      apiKey: { key: 'X-API-Key', value: 'key-1', in: 'query' },
    })
    // The URL is sent as typed — main appends the key, so it never comes back.
    expect(lastConnect(mcp).url).toBe('http://srv.test/mcp')
  })

  it('an empty config of a credential type sends no auth', async () => {
    const mcp = installApi()
    for (const auth of [
      { type: 'basic' as const, basic: { username: '', password: '' } },
      { type: 'bearer' as const, bearer: { token: '  ' } },
      { type: 'api-key' as const, apiKey: { key: '', value: 'v', in: 'header' as const } },
      { type: 'bearer' as const },
    ]) {
      useMcpStore.getState().setAuth(auth)
      await useMcpStore.getState().connect()
      expect(lastConnect(mcp)).not.toHaveProperty('auth')
    }
  })

  it('stdio sends no auth', async () => {
    const mcp = installApi()
    useMcpStore.setState({ transport: 'stdio', url: 'node server.js' })
    useMcpStore.getState().setAuth({ type: 'bearer', bearer: { token: 't' } })
    await useMcpStore.getState().connect()
    expect(lastConnect(mcp)).not.toHaveProperty('auth')
  })

  it('the OAuth token session is named only while the type is OAuth 2.1', async () => {
    const mcp = installApi()
    useMcpStore.setState({ oauthSessionId: 'flow-1' })
    useMcpStore.getState().setAuth({ type: 'bearer', bearer: { token: 't' } })
    await useMcpStore.getState().connect()
    expect(lastConnect(mcp)).not.toHaveProperty('oauthSessionId')
    expect(lastConnect(mcp).auth).toEqual({ type: 'bearer', bearer: { token: 't' } })

    useMcpStore.getState().setAuth({ type: 'oauth2' })
    await useMcpStore.getState().connect()
    expect(lastConnect(mcp).oauthSessionId).toBe('flow-1')
    expect(lastConnect(mcp)).not.toHaveProperty('auth')
  })
})

describe('dirty flag', () => {
  it('setAuth flags the active MCP tab dirty; config-tab layout setters do not', () => {
    const tab = { id: 'tab-auth', name: 'MCP', protocol: 'mcp', savedRequestId: 'sr-1' } as Tab
    useTabsStore.setState({ tabs: [tab], activeTabId: 'tab-auth' })
    const isDirty = (): boolean => useTabsStore.getState().tabs[0].isDirty ?? false

    useMcpStore.getState().setConfigTab('headers')
    useMcpStore.getState().setConfigCollapsed(true)
    expect(isDirty()).toBe(false)

    useMcpStore.getState().setAuth({ type: 'bearer', bearer: { token: 'x' } })
    expect(isDirty()).toBe(true)
  })

  it('setConfigTab unfolds the panel', () => {
    useMcpStore.getState().setConfigCollapsed(true)
    useMcpStore.getState().setConfigTab('headers')
    const s = useMcpStore.getState()
    expect(s.configTab).toBe('headers')
    expect(s.configCollapsed).toBe(false)
  })
})

describe('per-tab state and persistence', () => {
  it('auth, config tab and fold state survive a tab switch; a fresh tab starts at defaults', () => {
    useMcpStore
      .getState()
      .setAuth({ type: 'api-key', apiKey: { key: 'K', value: 'V', in: 'header' } })
    useMcpStore.getState().setConfigTab('headers')
    useMcpStore.getState().setConfigCollapsed(true)

    useMcpStore.getState().switchToTab('tab-other')
    let s = useMcpStore.getState()
    expect(s.auth).toEqual({ type: 'none' })
    expect(s.configTab).toBe('auth')
    expect(s.configCollapsed).toBe(false)

    useMcpStore.getState().switchToTab('tab-auth')
    s = useMcpStore.getState()
    expect(s.auth).toEqual({ type: 'api-key', apiKey: { key: 'K', value: 'V', in: 'header' } })
    expect(s.configTab).toBe('headers')
    expect(s.configCollapsed).toBe(true)
  })

  it('are written to the persisted localStorage blob (like the headers)', () => {
    useMcpStore.getState().setAuth({ type: 'bearer', bearer: { token: '{{tok}}' } })
    useMcpStore.getState().setConfigCollapsed(true)
    const parsed = JSON.parse(localStorage.getItem('testnizer-mcp') as string) as {
      current: { auth: unknown; configTab: string; configCollapsed: boolean }
    }
    expect(parsed.current.auth).toEqual({ type: 'bearer', bearer: { token: '{{tok}}' } })
    expect(parsed.current.configCollapsed).toBe(true)
    expect(parsed.current.configTab).toBe('auth')
  })
})

describe('401 hand-off', () => {
  it('No Auth + 401 → Authorization tab, type OAuth 2.1, panel unfolded', async () => {
    installApi({ connect401: true })
    useMcpStore.setState({ configTab: 'headers', configCollapsed: true })
    await useMcpStore.getState().connect()
    const s = useMcpStore.getState()
    expect(s.unauthorized).toBe(true)
    expect(s.configTab).toBe('auth')
    expect(s.configCollapsed).toBe(false)
    expect(s.auth.type).toBe('oauth2')
  })

  it('a configured Bearer + 401 keeps Bearer (the token is likely wrong) but opens the tab', async () => {
    installApi({ connect401: true })
    useMcpStore.getState().setAuth({ type: 'bearer', bearer: { token: 'stale' } })
    useMcpStore.setState({ configTab: 'headers' })
    await useMcpStore.getState().connect()
    const s = useMcpStore.getState()
    expect(s.configTab).toBe('auth')
    expect(s.auth).toEqual({ type: 'bearer', bearer: { token: 'stale' } })
  })

  it('openOAuthAuthorization ("Authorize…") switches to OAuth 2.1 and keeps the other fields', () => {
    useMcpStore.getState().setAuth({ type: 'bearer', bearer: { token: 'keep-me' } })
    useMcpStore.setState({ configTab: 'headers', configCollapsed: true })
    useMcpStore.getState().openOAuthAuthorization()
    const s = useMcpStore.getState()
    expect(s.configTab).toBe('auth')
    expect(s.configCollapsed).toBe(false)
    expect(s.auth).toEqual({ type: 'oauth2', bearer: { token: 'keep-me' } })
  })
})

describe('mcp-auth.slice helpers', () => {
  it('normalizeMcpAuth tolerates garbage and keeps every sub-object', () => {
    expect(normalizeMcpAuth(undefined)).toEqual({ type: 'none' })
    expect(normalizeMcpAuth('bearer')).toEqual({ type: 'none' })
    expect(normalizeMcpAuth({ type: 'kerberos' })).toEqual({ type: 'none' })
    expect(
      normalizeMcpAuth({
        type: 'bearer',
        basic: { username: 'u', password: 5 },
        bearer: { token: 't', prefix: 'Token' },
        apiKey: { key: 'k', value: 'v', in: 'cookie' },
      }),
    ).toEqual({
      type: 'bearer',
      basic: { username: 'u', password: '' },
      bearer: { token: 't', prefix: 'Token' },
      apiKey: { key: 'k', value: 'v', in: 'header' },
    })
  })

  it('resolveMcpAuth drops the fields of other types', () => {
    expect(
      resolveMcpAuth(
        { type: 'basic', basic: { username: 'u', password: 'p' }, bearer: { token: 't' } },
        {},
      ),
    ).toEqual({ type: 'basic', basic: { username: 'u', password: 'p' } })
    expect(resolveMcpAuth({ type: 'oauth2', bearer: { token: 't' } }, {})).toBeUndefined()
  })

  it('config tabs follow the transport; an unavailable stored tab falls back to Authorization', () => {
    expect(availableConfigTabs('http')).toEqual(['auth', 'headers'])
    expect(availableConfigTabs('sse')).toEqual(['auth', 'headers'])
    expect(availableConfigTabs('stdio')).toEqual(['auth', 'env'])
    expect(effectiveConfigTab('headers', 'stdio')).toBe('auth')
    expect(effectiveConfigTab('env', 'http')).toBe('auth')
    expect(effectiveConfigTab('env', 'stdio')).toBe('env')
  })
})
