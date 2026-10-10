/**
 * Issue #170 — "Allow plain-HTTP authorization server (intranet)" switch of
 * the MCP OAuth 2.1 debugger. Pins:
 *   - the flag lives in `auth.oauth2` and only a literal `true` turns it on
 *     (`normalizeMcpAuth`); it is never sent on Connect (`resolveMcpAuth`);
 *   - toggling flips the tab dirty, rides the Ctrl+S snapshot and comes back
 *     on reopen (snapshot → JSON → restore into another tab);
 *   - `startOAuth` passes `allowHttpAuthServer: true` only while it is on;
 *   - the switch is OFF by default, shows the red warning when on, and is
 *     locked while a flow runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import McpOAuthSection from '../../src/renderer/components/protocols/mcp/McpOAuthSection'
import {
  restoreProtocolFromMetadata,
  snapshotProtocol,
} from '../../src/renderer/lib/save-active-request'
import {
  allowsHttpAuthServer,
  normalizeMcpAuth,
  resolveMcpAuth,
} from '../../src/renderer/stores/mcp-auth.slice'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Tab } from '../../src/renderer/types'
import type { McpOAuthStartRequest } from '../../src/renderer/types/mcp'

function installApi() {
  const mcp = {
    oauthStart: vi.fn(async (_req: McpOAuthStartRequest) => ({
      success: true,
      data: { oauthSessionId: 'mcp-oauth-170' },
    })),
    oauthCancel: vi.fn(async () => ({ success: true, data: { cancelled: true } })),
    oauthForget: vi.fn(async () => ({ success: true, data: { forgotten: true } })),
    onOauthStep: vi.fn(() => () => {}),
    onOauthDone: vi.fn(() => () => {}),
    onNotification: vi.fn(() => () => {}),
    onFrame: vi.fn(() => () => {}),
    onConnectionClosed: vi.fn(() => () => {}),
    onSubscriptionState: vi.fn(() => () => {}),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return mcp
}

function openTab(id: string): void {
  useTabsStore.setState({
    tabs: [
      ...useTabsStore.getState().tabs,
      { id, name: 'MCP', protocol: 'mcp', isDirty: false } as Tab,
    ],
    activeTabId: id,
  })
  useMcpStore.getState().switchToTab(id)
}

const isDirty = (id: string): boolean =>
  useTabsStore.getState().tabs.find((t) => t.id === id)?.isDirty ?? false

beforeEach(() => {
  installApi()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
})

afterEach(() => cleanup())

describe('normalizeMcpAuth — the opt-in flag', () => {
  it('keeps a literal true; anything else is off', () => {
    expect(
      normalizeMcpAuth({ type: 'oauth2', oauth2: { allowHttpAuthServer: true } }),
    ).toEqual({ type: 'oauth2', oauth2: { allowHttpAuthServer: true } })
    for (const value of ['true', 1, null, undefined, {}]) {
      const auth = normalizeMcpAuth({ type: 'oauth2', oauth2: { allowHttpAuthServer: value } })
      expect(allowsHttpAuthServer(auth)).toBe(false)
    }
    // Rows saved before issue #170 have no `oauth2` → off.
    expect(allowsHttpAuthServer(normalizeMcpAuth({ type: 'oauth2' }))).toBe(false)
    expect(normalizeMcpAuth({ type: 'oauth2', oauth2: 'yes' })).toEqual({ type: 'oauth2' })
  })

  it('survives switching the type away and back (sub-objects are kept)', () => {
    const auth = normalizeMcpAuth({
      type: 'bearer',
      bearer: { token: 't' },
      oauth2: { allowHttpAuthServer: true },
    })
    expect(allowsHttpAuthServer(auth)).toBe(true)
  })

  it('is never sent on Connect', () => {
    const auth = normalizeMcpAuth({ type: 'oauth2', oauth2: { allowHttpAuthServer: true } })
    expect(resolveMcpAuth(auth, {})).toBeUndefined()
  })
})

describe('store + Ctrl+S snapshot / restore', () => {
  it('toggling flips the tab dirty and the snapshot carries it; restore brings it back', () => {
    openTab('tab-src')
    useMcpStore.setState({ url: 'http://mcp.intranet/mcp' })
    useMcpStore.getState().setAuth({ type: 'oauth2' })
    useTabsStore.setState({
      tabs: useTabsStore.getState().tabs.map((t) => ({ ...t, isDirty: false })),
    })

    useMcpStore.getState().setOAuthAllowHttpAuthServer(true)
    expect(isDirty('tab-src')).toBe(true)
    expect(allowsHttpAuthServer(useMcpStore.getState().auth)).toBe(true)

    const { protocolMeta } = snapshotProtocol({ id: 'tab-src', protocol: 'mcp' } as Tab)
    // What the DB stores is JSON.
    const saved = JSON.parse(JSON.stringify(protocolMeta)) as { mcp: { auth: unknown } }
    expect(saved.mcp.auth).toEqual({ type: 'oauth2', oauth2: { allowHttpAuthServer: true } })

    openTab('tab-reopened')
    expect(allowsHttpAuthServer(useMcpStore.getState().auth)).toBe(false)
    restoreProtocolFromMetadata('mcp', saved)
    expect(useMcpStore.getState().auth).toEqual({
      type: 'oauth2',
      oauth2: { allowHttpAuthServer: true },
    })

    // Turning it off again is saved as off.
    useMcpStore.getState().setOAuthAllowHttpAuthServer(false)
    const off = snapshotProtocol({ id: 'tab-reopened', protocol: 'mcp' } as Tab).protocolMeta as {
      mcp: { auth: unknown }
    }
    expect(allowsHttpAuthServer(normalizeMcpAuth(off.mcp.auth))).toBe(false)
  })

  it('startOAuth passes allowHttpAuthServer only while the switch is on', async () => {
    const api = installApi()
    openTab('tab-flow')
    useMcpStore.setState({ url: 'http://mcp.intranet/mcp', transport: 'http' })
    useMcpStore.getState().setAuth({ type: 'oauth2' })

    await useMcpStore.getState().startOAuth()
    expect(api.oauthStart.mock.calls[0][0]).not.toHaveProperty('allowHttpAuthServer')

    useMcpStore.setState({ oauthRunning: false })
    useMcpStore.getState().setOAuthAllowHttpAuthServer(true)
    await useMcpStore.getState().startOAuth()
    expect(api.oauthStart.mock.calls[1][0]).toMatchObject({
      url: 'http://mcp.intranet/mcp',
      allowHttpAuthServer: true,
    })
  })
})

describe('turning the switch off takes effect at once', () => {
  const SUMMARY = {
    tokenType: 'Bearer',
    issuer: 'http://auth.intranet.test',
    clientId: 'c',
    hasRefreshToken: true,
    clientAuthMethod: 'none',
  }

  it('a token issued over plain HTTP is forgotten (flow + connect session) and the state cleared', () => {
    const api = installApi()
    openTab('tab-off')
    useMcpStore.getState().setAuth({ type: 'oauth2', oauth2: { allowHttpAuthServer: true } })
    useMcpStore.setState({
      oauthFlowId: 'mcp-oauth-http',
      oauthSessionId: 'mcp-oauth-http',
      oauthSummary: { ...SUMMARY, plainHttpTokenEndpoint: true },
    })

    useMcpStore.getState().setOAuthAllowHttpAuthServer(false)

    expect(api.oauthForget).toHaveBeenCalledTimes(1)
    expect(api.oauthForget).toHaveBeenCalledWith('mcp-oauth-http')
    const st = useMcpStore.getState()
    expect(st.oauthSessionId).toBeNull()
    expect(st.oauthFlowId).toBeNull()
    expect(st.oauthSummary).toBeNull()
    expect(allowsHttpAuthServer(st.auth)).toBe(false)
  })

  it('an https-issued token is kept; turning the switch on never forgets', () => {
    const api = installApi()
    openTab('tab-keep')
    useMcpStore.getState().setAuth({ type: 'oauth2', oauth2: { allowHttpAuthServer: true } })
    useMcpStore.setState({
      oauthFlowId: 'mcp-oauth-tls',
      oauthSessionId: 'mcp-oauth-tls',
      oauthSummary: SUMMARY,
    })
    useMcpStore.getState().setOAuthAllowHttpAuthServer(false)
    useMcpStore.getState().setOAuthAllowHttpAuthServer(true)
    expect(api.oauthForget).not.toHaveBeenCalled()
    expect(useMcpStore.getState().oauthSessionId).toBe('mcp-oauth-tls')
  })
})

describe('McpOAuthSection — the switch', () => {
  it('is off by default with no warning; on shows the red warning and sets the flag', () => {
    openTab('tab-ui')
    useMcpStore.setState({ url: 'http://mcp.intranet/mcp', transport: 'http' })
    useMcpStore.getState().setAuth({ type: 'oauth2' })
    render(<McpOAuthSection />)

    const toggle = screen.getByTestId('mcp-oauth-allow-http')
    expect(toggle.getAttribute('role')).toBe('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Allow plain-HTTP authorization server (intranet)')).toBeTruthy()
    expect(screen.queryByTestId('mcp-oauth-allow-http-warning')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(allowsHttpAuthServer(useMcpStore.getState().auth)).toBe(true)
    const warning = screen.getByTestId('mcp-oauth-allow-http-warning')
    expect(warning.textContent).toMatch(/unencrypted/)
    expect(warning.textContent).toMatch(/authorization server this MCP server advertises/)
    expect(warning.textContent).toMatch(/servers you trust on your intranet/)
    expect(warning.textContent).toMatch(/Any other host or port still requires HTTPS/)
    expect(warning.className).toContain('var(--red)')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(allowsHttpAuthServer(useMcpStore.getState().auth)).toBe(false)
    expect(screen.queryByTestId('mcp-oauth-allow-http-warning')).toBeNull()
  })

  it('is locked while a flow runs', () => {
    openTab('tab-running')
    useMcpStore.setState({ url: 'http://mcp.intranet/mcp', transport: 'http', oauthRunning: true })
    render(<McpOAuthSection />)
    const toggle = screen.getByTestId('mcp-oauth-allow-http') as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
  })
})
