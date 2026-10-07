/**
 * Issue #142 — MCP store, Security Scan slice: request shape (resolved URL,
 * the tab's headers and OAuth session), progress / finding / done routing by
 * scan id to the OWNER tab (never "the active tab"), events that race the
 * start reply, Scan refused while running, cancel, tab close, and that only
 * the rate-limit opt-in reaches localStorage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Environment } from '../../src/renderer/types'
import type {
  McpSecurityDoneEvent,
  McpSecurityFinding,
  McpSecurityFindingEvent,
  McpSecurityProgressEvent,
  McpSecurityReport,
  McpSecurityScanRequest,
} from '../../src/renderer/types/mcp'

interface Handlers {
  progress?: (e: McpSecurityProgressEvent) => void
  finding?: (e: McpSecurityFindingEvent) => void
  done?: (e: McpSecurityDoneEvent) => void
}

function finding(id: string, status: McpSecurityFinding['status'] = 'pass'): McpSecurityFinding {
  const category = id.split('.')[0] as McpSecurityFinding['category']
  return { id, category, title: id, severity: 'info', status, detail: `${id} detail` }
}

function report(findings: McpSecurityFinding[]): McpSecurityReport {
  return {
    id: 'r',
    startedAt: 1,
    finishedAt: 2,
    target: { url: 'http://srv.test/mcp', transport: 'http', host: 'srv.test', scheme: 'http' },
    grade: 'A',
    score: 97,
    categories: [{ id: 'transport', title: 'Transport security', score: 97, findings }],
    summary: { pass: findings.length, warn: 0, fail: 0, info: 0, skipped: 0 },
  }
}

function installApi(opts: { early?: (scanId: string, h: Handlers) => void } = {}) {
  const handlers: Handlers = {}
  let seq = 0
  const mcp = {
    connect: vi.fn(async () => ({ success: false, error: 'not used' })),
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    listTools: vi.fn(async () => ({ success: true, data: [] })),
    callTool: vi.fn(async () => ({ success: true, data: {} })),
    oauthForget: vi.fn(async () => ({ success: true, data: { forgotten: true } })),
    securityScan: vi.fn(async (_req: McpSecurityScanRequest) => {
      const scanId = `scan-${++seq}`
      opts.early?.(scanId, handlers)
      return { success: true, data: { scanId } }
    }),
    securityCancel: vi.fn(async () => ({ success: true, data: { cancelled: true } })),
    securityExportHtml: vi.fn(async () => ({ success: true, data: { html: '<html></html>' } })),
    onNotification: vi.fn(() => () => undefined),
    onFrame: vi.fn(() => () => undefined),
    onConnectionClosed: vi.fn(() => () => undefined),
    onSecurityProgress: vi.fn((cb: Handlers['progress']) => {
      handlers.progress = cb
      return () => undefined
    }),
    onSecurityFinding: vi.fn((cb: Handlers['finding']) => {
      handlers.finding = cb
      return () => undefined
    }),
    onSecurityDone: vi.fn((cb: Handlers['done']) => {
      handlers.done = cb
      return () => undefined
    }),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return { mcp, handlers }
}

function setActiveEnv(vars: Record<string, string>): void {
  const env: Environment = {
    id: 'env-142',
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

describe('defaults', () => {
  it('the rate-limit probe is opt-in (false) on a new tab', () => {
    useMcpStore.getState().switchToTab('tab-fresh')
    const s = useMcpStore.getState()
    expect(s.securityRateLimitProbe).toBe(false)
    expect(s.securityRunning).toBe(false)
    expect(s.securityReport).toBeNull()
    expect(s.securityFindings).toEqual([])
  })
})

describe('startSecurityScan', () => {
  it('sends the resolved url, the tab headers, the OAuth session and the opt-in', async () => {
    const { mcp } = installApi()
    setActiveEnv({ host: 'srv.test', tok: 'abc' })
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({
      url: 'https://{{host}}/mcp',
      transport: 'sse',
      customHeaders: [
        { id: 'h1', key: 'Authorization', value: 'Bearer {{tok}}', enabled: true },
        { id: 'h2', key: 'X-Off', value: '1', enabled: false },
      ],
      oauthSessionId: 'mcp-oauth-9',
    })
    useMcpStore.getState().setSecurityRateLimitProbe(true)
    await useMcpStore.getState().startSecurityScan()
    expect(mcp.securityScan).toHaveBeenCalledWith({
      url: 'https://srv.test/mcp',
      transport: 'sse',
      headers: { Authorization: 'Bearer abc' },
      oauthSessionId: 'mcp-oauth-9',
      options: { rateLimitProbe: true },
    })
    const s = useMcpStore.getState()
    expect(s.securityScanId).toBe('scan-1')
    expect(s.securityRunning).toBe(true)
  })

  it('routes progress / findings / done to the owner tab, not the active one', async () => {
    const { handlers } = installApi()
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({ url: 'http://srv.test/mcp' })
    await useMcpStore.getState().startSecurityScan()
    const scanId = useMcpStore.getState().securityScanId as string

    useMcpStore.getState().switchToTab('tab-b')
    handlers.progress?.({ scanId, done: 1, total: 29, current: 'HTTPS' })
    handlers.finding?.({ scanId, finding: finding('transport.https', 'info') })
    expect(useMcpStore.getState().securityFindings).toEqual([])
    expect(useMcpStore.getState().securityProgress).toBeNull()

    useMcpStore.getState().switchToTab('tab-a')
    let a = useMcpStore.getState()
    expect(a.securityProgress).toEqual({ done: 1, total: 29, current: 'HTTPS' })
    expect(a.securityFindings.map((f) => f.id)).toEqual(['transport.https'])
    // A finding with the same id replaces the earlier one.
    handlers.finding?.({ scanId, finding: finding('transport.https', 'pass') })
    expect(useMcpStore.getState().securityFindings).toHaveLength(1)

    const final = report([finding('transport.https'), finding('transport.tls', 'skipped')])
    useMcpStore.getState().switchToTab('tab-b')
    handlers.done?.({ scanId, report: final })
    useMcpStore.getState().switchToTab('tab-a')
    a = useMcpStore.getState()
    expect(a.securityRunning).toBe(false)
    expect(a.securityReport).toEqual(final)
    expect(a.securityFindings.map((f) => f.id)).toEqual(['transport.https', 'transport.tls'])
    expect(a.securityError).toBeNull()
  })

  it('events that beat the start reply are kept (orphan drain)', async () => {
    installApi({
      early: (scanId, h) => {
        h.progress?.({ scanId, done: 2, total: 29, current: 'TLS' })
        h.finding?.({ scanId, finding: finding('transport.https') })
      },
    })
    useMcpStore.setState({ url: 'http://srv.test/mcp' })
    await useMcpStore.getState().startSecurityScan()
    const s = useMcpStore.getState()
    expect(s.securityFindings.map((f) => f.id)).toEqual(['transport.https'])
    expect(s.securityProgress).toEqual({ done: 2, total: 29, current: 'TLS' })
  })

  it('refuses a second scan while one runs, refuses stdio, surfaces start and engine errors', async () => {
    const { mcp, handlers } = installApi()
    useMcpStore.setState({ url: 'http://srv.test/mcp' })
    await useMcpStore.getState().startSecurityScan()
    await useMcpStore.getState().startSecurityScan()
    expect(mcp.securityScan).toHaveBeenCalledTimes(1)

    const scanId = useMcpStore.getState().securityScanId as string
    handlers.done?.({ scanId, error: 'Invalid MCP server URL' })
    expect(useMcpStore.getState().securityError).toBe('Invalid MCP server URL')
    expect(useMcpStore.getState().securityRunning).toBe(false)

    mcp.securityScan.mockClear()
    useMcpStore.setState({ transport: 'stdio', url: 'node s.js' })
    await useMcpStore.getState().startSecurityScan()
    expect(mcp.securityScan).not.toHaveBeenCalled()
    expect(useMcpStore.getState().securityError).toMatch(/HTTP and SSE/)

    mcp.securityScan.mockResolvedValueOnce({ success: false, error: 'nope' } as never)
    useMcpStore.setState({ transport: 'http', url: 'http://srv.test/mcp' })
    await useMcpStore.getState().startSecurityScan()
    expect(useMcpStore.getState().securityError).toBe('nope')
    expect(useMcpStore.getState().securityRunning).toBe(false)
  })
})

describe('cancel and tab close', () => {
  it('Cancel names the running scan; closing the tab cancels it too', async () => {
    const { mcp } = installApi()
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({ url: 'http://srv.test/mcp' })
    await useMcpStore.getState().startSecurityScan()
    await useMcpStore.getState().cancelSecurityScan()
    expect(mcp.securityCancel).toHaveBeenCalledWith('scan-1')

    useMcpStore.getState().switchToTab('tab-b')
    useMcpStore.getState().removeTabState('tab-a')
    expect(mcp.securityCancel).toHaveBeenCalledTimes(2)
    expect(mcp.securityCancel).toHaveBeenLastCalledWith('scan-1')
  })
})

describe('persistence', () => {
  it('only the rate-limit opt-in reaches localStorage — never findings or the report', async () => {
    const { handlers } = installApi()
    useMcpStore.getState().switchToTab('tab-a')
    useMcpStore.setState({ url: 'http://srv.test/mcp' })
    useMcpStore.getState().setSecurityRateLimitProbe(true)
    await useMcpStore.getState().startSecurityScan()
    const scanId = useMcpStore.getState().securityScanId as string
    handlers.done?.({ scanId, report: report([finding('transport.https')]) })
    useMcpStore.getState().switchToTab('tab-other')

    const raw = localStorage.getItem('testnizer-mcp') as string
    expect(raw).toContain('"securityRateLimitProbe":true')
    expect(raw).not.toContain(scanId)
    expect(raw).not.toContain('transport.https detail')
    expect(raw).not.toContain('"securityRunning":true')

    // The opt-in survives a tab switch round-trip; the default for others is false.
    expect(useMcpStore.getState().securityRateLimitProbe).toBe(false)
    useMcpStore.getState().switchToTab('tab-a')
    expect(useMcpStore.getState().securityRateLimitProbe).toBe(true)
  })
})
