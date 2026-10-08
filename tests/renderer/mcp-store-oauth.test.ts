/**
 * Issue #141 — MCP store, OAuth 2.1 debugger slice: start request shape,
 * step / done routing by flow id (owner tab, never "the active tab"), steps
 * that race the start reply, Connect with token, the 401 → Authorization /
 * OAuth 2.1 hand-off, forget, and that neither the client secret nor any token session
 * reaches localStorage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Environment } from '../../src/renderer/types'
import type {
  McpConnectRequest,
  McpOAuthDoneEvent,
  McpOAuthStartRequest,
  McpOAuthStep,
  McpOAuthStepEvent,
} from '../../src/renderer/types/mcp'

interface Handlers {
  step?: (e: McpOAuthStepEvent) => void
  done?: (e: McpOAuthDoneEvent) => void
}

function installApi(opts: { connect401?: boolean; earlySteps?: McpOAuthStep[] } = {}) {
  const handlers: Handlers = {}
  let seq = 0
  const mcp = {
    connect: vi.fn(async (req: McpConnectRequest) =>
      opts.connect401
        ? { success: false, error: 'Streamable HTTP error: HTTP 401', unauthorized: true }
        : {
            success: true,
            data: { connectionId: `conn-${++seq}`, transport: req.transport, url: req.url },
          },
    ),
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    listTools: vi.fn(async () => ({ success: true, data: [] })),
    callTool: vi.fn(async () => ({ success: true, data: {} })),
    oauthStart: vi.fn(async (_req: McpOAuthStartRequest) => {
      const oauthSessionId = `flow-${++seq}`
      // Steps can be broadcast before the reply lands (they are routed by id).
      for (const step of opts.earlySteps ?? []) handlers.step?.({ oauthSessionId, step })
      return { success: true, data: { oauthSessionId } }
    }),
    oauthCancel: vi.fn(async () => ({ success: true, data: { cancelled: true } })),
    oauthForget: vi.fn(async () => ({ success: true, data: { forgotten: true } })),
    onNotification: vi.fn(() => () => undefined),
    onFrame: vi.fn(() => () => undefined),
    onConnectionClosed: vi.fn(() => () => undefined),
    onOauthStep: vi.fn((cb: Handlers['step']) => {
      handlers.step = cb
      return () => undefined
    }),
    onOauthDone: vi.fn((cb: Handlers['done']) => {
      handlers.done = cb
      return () => undefined
    }),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return { mcp, handlers }
}

function step(index: number, id: McpOAuthStep['id'], status: McpOAuthStep['status']): McpOAuthStep {
  return { id, index, title: id, status }
}

const SUMMARY = {
  tokenType: 'Bearer',
  issuer: 'http://as.test',
  clientId: 'dcr-1',
  hasRefreshToken: false,
  clientAuthMethod: 'none',
}

function setActiveEnv(vars: Record<string, string>): void {
  const env: Environment = {
    id: 'env-141',
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

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-init')
  setActiveEnv({})
})

describe('startOAuth', () => {
  it('sends the resolved url, headers and client fields; steps / done land on the owner tab', async () => {
    const { mcp, handlers } = installApi()
    setActiveEnv({ host: 'srv.test', cid: 'my-client' })
    const s = useMcpStore.getState()
    s.switchToTab('tab-a')
    useMcpStore.setState({
      url: 'http://{{host}}/mcp',
      transport: 'http',
      customHeaders: [{ id: 'h1', key: 'X-A', value: '1', enabled: true }],
      oauthClientId: '{{cid}}',
      oauthClientSecret: 'shh',
      oauthScope: ' mcp:tools ',
    })
    await useMcpStore.getState().startOAuth()
    expect(mcp.oauthStart).toHaveBeenCalledWith({
      url: 'http://srv.test/mcp',
      transport: 'http',
      headers: { 'X-A': '1' },
      clientId: 'my-client',
      clientSecret: 'shh',
      scope: 'mcp:tools',
    })
    const flowId = useMcpStore.getState().oauthFlowId as string
    expect(flowId).toMatch(/^flow-/)
    expect(useMcpStore.getState().oauthRunning).toBe(true)

    // Switch away — events must still reach tab A.
    useMcpStore.getState().switchToTab('tab-b')
    handlers.step?.({ oauthSessionId: flowId, step: step(2, 'resource-metadata', 'passed') })
    handlers.step?.({ oauthSessionId: flowId, step: step(1, 'probe', 'passed') })
    handlers.done?.({ oauthSessionId: flowId, ok: true, summary: SUMMARY })
    expect(useMcpStore.getState().oauthSteps).toEqual([])

    useMcpStore.getState().switchToTab('tab-a')
    const a = useMcpStore.getState()
    expect(a.oauthSteps.map((x) => x.id)).toEqual(['probe', 'resource-metadata'])
    expect(a.oauthRunning).toBe(false)
    expect(a.oauthSummary).toEqual(SUMMARY)
    expect(a.oauthError).toBeNull()
  })

  it('steps broadcast before the start reply are kept (orphan drain)', async () => {
    installApi({ earlySteps: [step(1, 'probe', 'running')] })
    useMcpStore.setState({ url: 'http://srv.test/mcp' })
    await useMcpStore.getState().startOAuth()
    expect(useMcpStore.getState().oauthSteps).toEqual([step(1, 'probe', 'running')])
  })

  it('a failed flow surfaces its error; stdio is refused without calling main', async () => {
    const { mcp, handlers } = installApi()
    useMcpStore.setState({ url: 'http://srv.test/mcp' })
    await useMcpStore.getState().startOAuth()
    const flowId = useMcpStore.getState().oauthFlowId as string
    handlers.done?.({
      oauthSessionId: flowId,
      ok: false,
      error: 'state mismatch',
      failedStep: 'authorization-callback',
    })
    expect(useMcpStore.getState().oauthError).toBe('state mismatch')
    expect(useMcpStore.getState().oauthSummary).toBeNull()

    mcp.oauthStart.mockClear()
    useMcpStore.setState({ transport: 'stdio', url: 'node s.js' })
    await useMcpStore.getState().startOAuth()
    expect(mcp.oauthStart).not.toHaveBeenCalled()
    expect(useMcpStore.getState().oauthError).toMatch(/HTTP and SSE/)
  })
})

describe('connect with the OAuth token', () => {
  it('Connect with token names the session on mcp:connect (http only) and forget clears it', async () => {
    const { mcp, handlers } = installApi()
    useMcpStore.setState({ url: 'http://srv.test/mcp' })
    await useMcpStore.getState().connect()
    expect(mcp.connect.mock.calls[0][0]).not.toHaveProperty('oauthSessionId')

    await useMcpStore.getState().startOAuth()
    const flowId = useMcpStore.getState().oauthFlowId as string
    handlers.done?.({ oauthSessionId: flowId, ok: true, summary: SUMMARY })
    await useMcpStore.getState().connectWithOAuth()
    expect(mcp.disconnect).toHaveBeenCalled() // was connected → reconnect
    expect(useMcpStore.getState().oauthSessionId).toBe(flowId)
    expect(mcp.connect.mock.calls.at(-1)?.[0]).toMatchObject({ oauthSessionId: flowId })

    await useMcpStore.getState().forgetOAuth()
    expect(mcp.oauthForget).toHaveBeenCalledWith(flowId)
    const st = useMcpStore.getState()
    expect(st.oauthSessionId).toBeNull()
    expect(st.oauthFlowId).toBeNull()
    expect(st.oauthSummary).toBeNull()
  })

  it('a 401 on connect flags unauthorized and opens Authorization on OAuth 2.1', async () => {
    installApi({ connect401: true })
    useMcpStore.setState({ url: 'http://srv.test/mcp', configTab: 'headers' })
    expect(useMcpStore.getState().auth.type).toBe('none')
    await useMcpStore.getState().connect()
    const st = useMcpStore.getState()
    expect(st.connectionState).toBe('error')
    expect(st.unauthorized).toBe(true)
    expect(st.configTab).toBe('auth')
    expect(st.auth.type).toBe('oauth2')
    // The right pane stays where it was — the debugger is no longer there.
    expect(st.section).toBe('explorer')
  })

  it('Connect with token switches a non-OAuth tab to OAuth 2.1 so the token is used', async () => {
    const { mcp, handlers } = installApi()
    useMcpStore.setState({ url: 'http://srv.test/mcp' })
    useMcpStore.getState().setAuth({ type: 'bearer', bearer: { token: 'other' } })
    await useMcpStore.getState().startOAuth()
    const flowId = useMcpStore.getState().oauthFlowId as string
    handlers.done?.({ oauthSessionId: flowId, ok: true, summary: SUMMARY })
    await useMcpStore.getState().connectWithOAuth()
    expect(useMcpStore.getState().auth.type).toBe('oauth2')
    const req = mcp.connect.mock.calls.at(-1)?.[0]
    expect(req).toMatchObject({ oauthSessionId: flowId })
    expect(req).not.toHaveProperty('auth')
  })

  it('closing the tab forgets its token sessions', async () => {
    const { mcp, handlers } = installApi()
    useMcpStore.getState().switchToTab('tab-x')
    useMcpStore.setState({ url: 'http://srv.test/mcp' })
    await useMcpStore.getState().startOAuth()
    const flowId = useMcpStore.getState().oauthFlowId as string
    handlers.done?.({ oauthSessionId: flowId, ok: true, summary: SUMMARY })
    useMcpStore.getState().switchToTab('tab-y')
    useMcpStore.getState().removeTabState('tab-x')
    expect(mcp.oauthForget).toHaveBeenCalledWith(flowId)
  })
})

describe('persistence', () => {
  it('never writes the client secret or any flow / token session to localStorage', async () => {
    const { handlers } = installApi()
    useMcpStore.setState({
      url: 'http://srv.test/mcp',
      oauthClientId: 'kept-client',
      oauthClientSecret: 'never-persist-141',
    })
    await useMcpStore.getState().startOAuth()
    const flowId = useMcpStore.getState().oauthFlowId as string
    handlers.done?.({ oauthSessionId: flowId, ok: true, summary: SUMMARY })
    await useMcpStore.getState().connectWithOAuth()
    useMcpStore.getState().switchToTab('tab-other') // caches the tab state as well

    const raw = localStorage.getItem('testnizer-mcp') as string
    expect(raw).toContain('kept-client')
    expect(raw).not.toContain('never-persist-141')
    expect(raw).not.toContain(flowId)
    expect(raw).not.toContain('dcr-1')
  })
})
