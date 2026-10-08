/**
 * Issue #141 — the OAuth 2.1 debugger of the MCP editor: rendered inline by
 * the Authorization config tab when its type is OAuth 2.1 (MCP Auth — it is
 * no longer an extra right-pane tab), the form (write-only secret), the
 * seven-step list with expandable request / response, the summary card
 * actions, and the 401 → "Authorize…" hand-off from the connection bar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import McpEditor from '../../src/renderer/components/protocols/McpEditor'
import McpOAuthSection from '../../src/renderer/components/protocols/mcp/McpOAuthSection'
import { MCP_EXTRA_SECTIONS } from '../../src/renderer/components/protocols/mcp/sections'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { McpOAuthStep } from '../../src/renderer/types/mcp'

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-oauth-ui')
})

afterEach(() => cleanup())

const STEPS: McpOAuthStep[] = [
  {
    id: 'probe',
    index: 1,
    title: 'Unauthenticated probe',
    status: 'passed',
    durationMs: 12,
    request: {
      method: 'POST',
      url: 'http://srv.test/mcp',
      headers: { accept: 'application/json' },
    },
    response: {
      status: 401,
      headers: { 'www-authenticate': 'Bearer resource_metadata="http://srv.test/.well-known/x"' },
      body: '{"error":"unauthorized"}',
    },
    note: 'HTTP 401; WWW-Authenticate resource_metadata=http://srv.test/.well-known/x',
  },
  { id: 'resource-metadata', index: 2, title: 'PRM', status: 'passed' },
  {
    id: 'auth-server-metadata',
    index: 3,
    title: 'ASM',
    status: 'failed',
    error: 'No authorization server metadata',
    attempts: [
      {
        request: {
          method: 'GET',
          url: 'http://as.test/.well-known/oauth-authorization-server',
          headers: {},
        },
        response: { status: 404, headers: {} },
      },
      {
        request: {
          method: 'GET',
          url: 'http://as.test/.well-known/openid-configuration',
          headers: {},
        },
        response: { status: 404, headers: {} },
      },
    ],
    request: { method: 'GET', url: 'http://as.test/.well-known/openid-configuration', headers: {} },
    response: { status: 404, headers: {} },
  },
]

describe('registration', () => {
  it('the debugger lives in the Authorization tab (type OAuth 2.1), not in the right pane', () => {
    expect(MCP_EXTRA_SECTIONS.map((s) => s.id)).not.toContain('oauth')
    render(<McpEditor />)
    expect(screen.queryByTestId('mcp-section-oauth')).toBeNull()
    expect(screen.queryByTestId('mcp-oauth-tab')).toBeNull()

    fireEvent.click(screen.getByTestId('mcp-config-tab-auth'))
    fireEvent.change(screen.getByTestId('mcp-auth-type'), { target: { value: 'oauth2' } })
    const panel = screen.getByTestId('mcp-config-panel-auth')
    expect(within(panel).getByTestId('mcp-oauth-tab')).toBeInTheDocument()
    expect(useMcpStore.getState().auth.type).toBe('oauth2')
  })
})

describe('McpOAuthSection', () => {
  it('form fields write to the store; the secret is a password input; Start runs the flow', () => {
    const startOAuth = vi.fn(async () => {})
    useMcpStore.setState({ url: 'http://srv.test/mcp', startOAuth })
    render(<McpOAuthSection />)
    fireEvent.change(screen.getByTestId('mcp-oauth-client-id'), { target: { value: 'cid' } })
    fireEvent.change(screen.getByTestId('mcp-oauth-client-secret'), { target: { value: 's3' } })
    fireEvent.change(screen.getByTestId('mcp-oauth-scope'), { target: { value: 'a b' } })
    expect(screen.getByTestId('mcp-oauth-client-secret')).toHaveAttribute('type', 'password')
    const st = useMcpStore.getState()
    expect([st.oauthClientId, st.oauthClientSecret, st.oauthScope]).toEqual(['cid', 's3', 'a b'])
    fireEvent.click(screen.getByTestId('mcp-oauth-start'))
    expect(startOAuth).toHaveBeenCalledTimes(1)
  })

  it('Start is disabled without a URL; stdio shows a hint instead of the form', () => {
    useMcpStore.setState({ url: '' })
    const { unmount } = render(<McpOAuthSection />)
    expect(screen.getByTestId('mcp-oauth-start')).toBeDisabled()
    unmount()
    useMcpStore.setState({ transport: 'stdio', url: 'node s.js' })
    render(<McpOAuthSection />)
    expect(screen.queryByTestId('mcp-oauth-start')).toBeNull()
    expect(screen.getByTestId('mcp-oauth-tab')).toHaveTextContent(/HTTP and SSE/)
  })

  it('renders all seven steps; a step expands to its request / response / attempts', () => {
    useMcpStore.setState({
      url: 'http://srv.test/mcp',
      oauthSteps: STEPS,
      oauthError: 'No authorization server metadata',
    })
    render(<McpOAuthSection />)
    for (let n = 1; n <= 7; n++)
      expect(screen.getByTestId(`mcp-oauth-step-${n}`)).toBeInTheDocument()
    expect(screen.getByTestId('mcp-oauth-step-1')).toHaveAttribute('data-status', 'passed')
    expect(screen.getByTestId('mcp-oauth-step-3')).toHaveAttribute('data-status', 'failed')
    expect(screen.getByTestId('mcp-oauth-step-4')).toHaveAttribute('data-status', 'pending')
    expect(screen.getByTestId('mcp-oauth-step-3')).toHaveTextContent(
      'No authorization server metadata',
    )
    expect(screen.getByTestId('mcp-oauth-error')).toBeInTheDocument()

    fireEvent.click(within(screen.getByTestId('mcp-oauth-step-1')).getByRole('button'))
    const details = screen.getByTestId('mcp-oauth-step-1-details')
    expect(details).toHaveTextContent('POST http://srv.test/mcp')
    expect(details).toHaveTextContent('HTTP 401')
    expect(details).toHaveTextContent('www-authenticate: Bearer resource_metadata=')

    fireEvent.click(within(screen.getByTestId('mcp-oauth-step-3')).getByRole('button'))
    expect(screen.getByTestId('mcp-oauth-step-3-details')).toHaveTextContent('Attempts (2)')
  })

  it('the summary card shows metadata only and wires Connect / Forget', () => {
    const connectWithOAuth = vi.fn(async () => {})
    const forgetOAuth = vi.fn(async () => {})
    useMcpStore.setState({
      url: 'http://srv.test/mcp',
      oauthFlowId: 'flow-1',
      oauthSteps: STEPS.slice(0, 1),
      oauthSummary: {
        tokenType: 'Bearer',
        issuer: 'http://as.test',
        clientId: 'dcr-1',
        scope: 'mcp:tools',
        hasRefreshToken: true,
        clientAuthMethod: 'none',
        expiresAt: Date.now() + 3_600_000,
      },
      connectWithOAuth,
      forgetOAuth,
    })
    render(<McpOAuthSection />)
    const card = screen.getByTestId('mcp-oauth-summary')
    expect(card).toHaveTextContent('http://as.test')
    expect(screen.getByTestId('mcp-oauth-summary-client-id')).toHaveTextContent('dcr-1')
    expect(card).toHaveTextContent('mcp:tools')
    fireEvent.click(screen.getByTestId('mcp-oauth-connect'))
    fireEvent.click(screen.getByTestId('mcp-oauth-forget'))
    expect(connectWithOAuth).toHaveBeenCalledTimes(1)
    expect(forgetOAuth).toHaveBeenCalledTimes(1)
  })
})

describe('401 hand-off', () => {
  it('a 401 connect error offers Authorize…, which lands on Authorization / OAuth 2.1', () => {
    useMcpStore.setState({
      url: 'http://srv.test/mcp',
      connectionState: 'error',
      errorMessage: 'Streamable HTTP error: HTTP 401',
      unauthorized: true,
      auth: { type: 'bearer', bearer: { token: 'stale' } },
      configTab: 'headers',
      configCollapsed: true,
    })
    render(<McpEditor />)
    expect(screen.queryByTestId('mcp-oauth-tab')).toBeNull()
    fireEvent.click(screen.getByTestId('mcp-oauth-open'))
    expect(screen.getByTestId('mcp-config-tab-auth')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('mcp-auth-type')).toHaveValue('oauth2')
    expect(screen.getByTestId('mcp-oauth-tab')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-oauth-unauthorized')).toBeInTheDocument()
    // The bearer fields survive the type switch.
    expect(useMcpStore.getState().auth.bearer).toEqual({ token: 'stale' })
  })

  it('a 401 on Connect itself opens the Authorization tab on OAuth 2.1 (No Auth tab)', async () => {
    ;(window as unknown as { api: unknown }).api = {
      mcp: {
        connect: vi.fn(async () => ({
          success: false,
          error: 'Streamable HTTP error: HTTP 401',
          unauthorized: true,
        })),
        cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
        disconnect: vi.fn(async () => ({ success: true, data: true })),
      },
    }
    useMcpStore.setState({ url: 'http://srv.test/mcp', configCollapsed: true })
    render(<McpEditor />)
    fireEvent.click(screen.getByTestId('mcp-connect'))
    expect(await screen.findByTestId('mcp-oauth-unauthorized')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-config-panel-auth')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-auth-type')).toHaveValue('oauth2')
  })
})
