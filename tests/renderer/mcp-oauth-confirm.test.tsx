/**
 * Issue #295 — the OAuth debugger's "send the client secret to this
 * authorization server?" card: it appears while the flow's running step
 * carries a `confirmation` (routed to the owning tab by flow id), shows the
 * MCP server / authorization server / token endpoint origins, and answers
 * main through `oauthConfirm(flowId, accept)`. The secret is never part of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import McpOAuthSection from '../../src/renderer/components/protocols/mcp/McpOAuthSection'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type {
  McpOAuthDoneEvent,
  McpOAuthStep,
  McpOAuthStepEvent,
} from '../../src/renderer/types/mcp'

const SECRET = 'typed-secret-295-renderer'

interface Handlers {
  step?: (e: McpOAuthStepEvent) => void
  done?: (e: McpOAuthDoneEvent) => void
}

function installApi() {
  const handlers: Handlers = {}
  const mcp = {
    oauthStart: vi.fn(async () => ({ success: true, data: { oauthSessionId: 'flow-295' } })),
    oauthCancel: vi.fn(async () => ({ success: true, data: { cancelled: true } })),
    oauthForget: vi.fn(async () => ({ success: true, data: { forgotten: true } })),
    oauthConfirm: vi.fn(async (_id: string, _accept: boolean) => ({
      success: true,
      data: { answered: true },
    })),
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

const ASKING: McpOAuthStep = {
  id: 'client-registration',
  index: 4,
  title: 'Client registration (RFC 7591)',
  status: 'running',
  note: 'Waiting for you to confirm the authorization server',
  confirmation: {
    mcpServer: 'https://mcp.example.com',
    authorizationServer: 'https://auth.intranet.test',
    tokenEndpoint: 'https://tokens.intranet.test',
  },
}

async function startAndAsk(handlers: Handlers, step: McpOAuthStep = ASKING): Promise<void> {
  useMcpStore.setState({ url: 'https://mcp.example.com/mcp', oauthClientId: 'cid' })
  useMcpStore.getState().setOAuthClientSecret(SECRET)
  await act(async () => {
    await useMcpStore.getState().startOAuth()
  })
  act(() => handlers.step?.({ oauthSessionId: 'flow-295', step }))
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-295')
})

afterEach(() => cleanup())

describe('McpOAuthConfirmCard', () => {
  it('shows the hosts while the step asks; Confirm answers true for this flow', async () => {
    const { mcp, handlers } = installApi()
    render(<McpOAuthSection />)
    expect(screen.queryByTestId('mcp-oauth-confirm')).toBeNull()

    await startAndAsk(handlers)
    const card = screen.getByTestId('mcp-oauth-confirm')
    expect(screen.getByTestId('mcp-oauth-confirm-server')).toHaveTextContent(
      'https://mcp.example.com',
    )
    expect(screen.getByTestId('mcp-oauth-confirm-auth-server')).toHaveTextContent(
      'https://auth.intranet.test',
    )
    expect(screen.getByTestId('mcp-oauth-confirm-token-endpoint')).toHaveTextContent(
      'https://tokens.intranet.test',
    )
    expect(card.textContent).not.toContain(SECRET)

    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-oauth-confirm-accept'))
    })
    expect(mcp.oauthConfirm).toHaveBeenCalledWith('flow-295', true)

    // Main answers with the step minus the question — the card goes.
    const { confirmation: _asked, ...answered } = ASKING
    act(() =>
      handlers.step?.({ oauthSessionId: 'flow-295', step: { ...answered, status: 'skipped' } }),
    )
    expect(screen.queryByTestId('mcp-oauth-confirm')).toBeNull()
  })

  it('Cancel answers false', async () => {
    const { mcp, handlers } = installApi()
    render(<McpOAuthSection />)
    await startAndAsk(handlers)
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-oauth-confirm-reject'))
    })
    expect(mcp.oauthConfirm).toHaveBeenCalledWith('flow-295', false)
  })

  it('no token-endpoint row when it is the authorization server itself', async () => {
    const { handlers } = installApi()
    render(<McpOAuthSection />)
    await startAndAsk(handlers, {
      ...ASKING,
      confirmation: { ...ASKING.confirmation!, tokenEndpoint: 'https://auth.intranet.test' },
    })
    expect(screen.getByTestId('mcp-oauth-confirm')).toBeInTheDocument()
    expect(screen.queryByTestId('mcp-oauth-confirm-token-endpoint')).toBeNull()
  })

  it('the question stays with the tab whose flow asks (issue #76 routing)', async () => {
    const { handlers } = installApi()
    render(<McpOAuthSection />)
    await startAndAsk(handlers)
    expect(screen.getByTestId('mcp-oauth-confirm')).toBeInTheDocument()

    act(() => useMcpStore.getState().switchToTab('tab-other'))
    expect(screen.queryByTestId('mcp-oauth-confirm')).toBeNull()
    act(() => useMcpStore.getState().switchToTab('tab-295'))
    expect(screen.getByTestId('mcp-oauth-confirm')).toBeInTheDocument()
  })

  it('a finished flow never shows a stale question', async () => {
    const { handlers } = installApi()
    render(<McpOAuthSection />)
    await startAndAsk(handlers)
    act(() =>
      handlers.done?.({
        oauthSessionId: 'flow-295',
        ok: false,
        cancelled: true,
        error: 'Cancelled by user',
      }),
    )
    expect(screen.queryByTestId('mcp-oauth-confirm')).toBeNull()
  })
})
