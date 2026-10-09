/**
 * Issue #171 — MCP connection bar matches its WebSocket sibling: a status pill
 * on the left (Disconnected / Connecting… / Connected / Error), the error in a
 * boxed line UNDER the bar (with "Authorize…" next to it on a 401) instead of
 * wrapping the row, and the URL field is the `{{var}}`-aware input HTTP uses
 * (suggests environment variables on `{{`, highlights them, Enter connects).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import McpConnectionBar from '../../src/renderer/components/protocols/mcp/McpConnectionBar'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'

const realConnect = useMcpStore.getState().connect
// jsdom has no layout: the suggestion list scrolls its active row into view.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

beforeEach(() => {
  useMcpStore.setState({ connect: realConnect })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-bar')
  useEnvironmentStore.setState({
    environments: [
      {
        id: 'env-1',
        name: 'Dev',
        variables: [{ key: 'mcpHost', value: 'http://127.0.0.1:3100', enabled: true }],
      },
    ],
    activeEnvironmentId: 'env-1',
    globalVariables: [],
  } as never)
})

afterEach(() => cleanup())

describe('status pill', () => {
  it.each([
    ['disconnected', 'Disconnected'],
    ['connecting', 'Connecting…'],
    ['connected', 'Connected'],
    ['error', 'Error'],
  ] as const)('%s → "%s"', (state, label) => {
    useMcpStore.setState({ connectionState: state, url: 'http://x/mcp' })
    render(<McpConnectionBar />)
    const pill = screen.getByTestId('mcp-status')
    expect(pill).toHaveAttribute('data-state', state)
    expect(pill).toHaveTextContent(label)
    // The pill is the first thing in the row.
    expect(screen.getByTestId('mcp-connection-row').firstElementChild).toBe(pill)
  })

  it('the pill speaks Turkish too', async () => {
    const { useUIStore } = await import('../../src/renderer/stores/ui.store')
    const prev = useUIStore.getState().locale
    useUIStore.setState({ locale: 'tr' })
    try {
      useMcpStore.setState({ connectionState: 'connected' })
      render(<McpConnectionBar />)
      expect(screen.getByTestId('mcp-status')).toHaveTextContent('Bağlı')
    } finally {
      useUIStore.setState({ locale: prev })
    }
  })
})

describe('error line', () => {
  it('sits in a box under the row, not inside it; Authorize… is next to it on a 401', () => {
    useMcpStore.setState({
      connectionState: 'error',
      errorMessage: 'HTTP 401 Unauthorized',
      unauthorized: true,
      url: 'http://x/mcp',
    })
    render(<McpConnectionBar />)
    const row = screen.getByTestId('mcp-connection-row')
    const box = screen.getByTestId('mcp-error-box')
    expect(row.contains(box)).toBe(false)
    expect(within(box).getByTestId('mcp-error')).toHaveTextContent('HTTP 401 Unauthorized')
    expect(within(box).getByTestId('mcp-oauth-open')).toBeInTheDocument()
  })

  it('no box without an error', () => {
    useMcpStore.setState({ connectionState: 'disconnected', errorMessage: null })
    render(<McpConnectionBar />)
    expect(screen.queryByTestId('mcp-error-box')).toBeNull()
  })

  it('the row never wraps (single line at 1200 px)', () => {
    render(<McpConnectionBar />)
    const row = screen.getByTestId('mcp-connection-row')
    expect(row.className).toContain('flex-nowrap')
    expect(row.className).not.toMatch(/(^|\s)flex-wrap(\s|$)/)
  })
})

describe('URL field with {{variables}}', () => {
  it('keeps data-testid="mcp-url" on the real <input>', () => {
    useMcpStore.setState({ url: 'http://x/mcp' })
    render(<McpConnectionBar />)
    const input = screen.getByTestId('mcp-url')
    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveValue('http://x/mcp')
  })

  it('typing {{ suggests environment variables; picking one writes it to the tab', () => {
    const connect = vi.fn(async () => {})
    useMcpStore.setState({ connect } as never)
    render(<McpConnectionBar />)
    const input = screen.getByTestId('mcp-url') as HTMLInputElement
    fireEvent.change(input, { target: { value: '{{', selectionStart: 2 } })
    const drop = screen.getByTestId('var-autocomplete')
    expect(drop).toHaveTextContent('mcpHost')
    // Enter picks the suggestion — it does NOT also connect.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useMcpStore.getState().url).toBe('{{mcpHost}}')
    expect(connect).not.toHaveBeenCalled()
  })

  it('a {{variable}} in the URL is highlighted', () => {
    useMcpStore.setState({ url: '{{mcpHost}}/mcp' })
    const { container } = render(<McpConnectionBar />)
    const token = [...container.querySelectorAll('span')].find(
      (s) => s.textContent === '{{mcpHost}}',
    )
    expect(token).toBeTruthy()
  })

  it('Enter connects when no suggestion list is open', () => {
    const connect = vi.fn(async () => {})
    useMcpStore.setState({ url: 'http://x/mcp', connect } as never)
    render(<McpConnectionBar />)
    fireEvent.keyDown(screen.getByTestId('mcp-url'), { key: 'Enter' })
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('is disabled while connected', () => {
    useMcpStore.setState({ url: 'http://x/mcp', connectionState: 'connected' })
    render(<McpConnectionBar />)
    expect(screen.getByTestId('mcp-url')).toBeDisabled()
  })
})
