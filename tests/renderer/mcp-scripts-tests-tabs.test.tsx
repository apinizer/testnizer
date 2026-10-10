/**
 * Issue #160 (renderer half) — the MCP config strip gets the HTTP editor's
 * Scripts and Tests tabs, reused as-is. They read / write the per-tab request
 * store (`preScript` / `postScript` / `assertions`), the strip badges them the
 * way `RequestEditor` does, and Ctrl+S persists them for an MCP tab through
 * the single in-place save path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Tab } from '../../src/renderer/types'

vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))

const { default: McpConfigTabs } =
  await import('../../src/renderer/components/protocols/mcp/McpConfigTabs')
const { useMcpStore } = await import('../../src/renderer/stores/mcp.store')
const { useRequestStore } = await import('../../src/renderer/stores/request.store')
const { useTabsStore } = await import('../../src/renderer/stores/tabs.store')
const { saveActiveRequestInPlace } = await import('../../src/renderer/lib/save-active-request')
const { setLocale } = await import('../../src/renderer/lib/i18n')

const TAB_ID = 'tab-mcp-scripts'

beforeEach(() => {
  window.localStorage.clear()
  setLocale('en')
  useTabsStore.setState({
    tabs: [{ id: TAB_ID, name: 'Echo', protocol: 'mcp', isDirty: false } as Tab],
    activeTabId: TAB_ID,
  })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab(TAB_ID)
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null } as never)
  useRequestStore.getState().switchToTab(TAB_ID)
})

afterEach(() => {
  cleanup()
  setLocale('en')
})

describe('MCP config strip — Scripts and Tests tabs', () => {
  it('order: Authorization, Headers | Environment, Scripts, Tests — with the HTTP labels', () => {
    render(<McpConfigTabs />)
    const labels = () => screen.getAllByRole('tab').map((el) => el.getAttribute('data-testid'))
    expect(labels()).toEqual([
      'mcp-config-tab-auth',
      'mcp-config-tab-headers',
      'mcp-config-tab-scripts',
      'mcp-config-tab-tests',
    ])
    expect(screen.getByTestId('mcp-config-tab-scripts')).toHaveTextContent('Scripts')
    expect(screen.getByTestId('mcp-config-tab-tests')).toHaveTextContent('Tests')
    act(() => useMcpStore.getState().setTransport('stdio'))
    expect(labels()).toEqual([
      'mcp-config-tab-auth',
      'mcp-config-tab-env',
      'mcp-config-tab-scripts',
      'mcp-config-tab-tests',
    ])
  })

  it('Turkish labels come from the same keys as the HTTP editor', async () => {
    const { useUIStore } = await import('../../src/renderer/stores/ui.store')
    const prev = useUIStore.getState().locale
    useUIStore.setState({ locale: 'tr' })
    try {
      render(<McpConfigTabs />)
      expect(screen.getByTestId('mcp-config-tab-scripts')).toHaveTextContent('Betikler')
      expect(screen.getByTestId('mcp-config-tab-tests')).toHaveTextContent('Testler')
    } finally {
      useUIStore.setState({ locale: prev })
    }
  })

  it('Scripts renders the HTTP ScriptsTab with a real height (Monaco needs one)', () => {
    render(<McpConfigTabs />)
    fireEvent.click(screen.getByTestId('mcp-config-tab-scripts'))
    const panel = screen.getByTestId('mcp-config-panel-scripts')
    expect(panel.className).toMatch(/(^|\s)h-\[40vh\](\s|$)/)
    expect(screen.getByTestId('scripts-pre')).toBeInTheDocument()
    expect(screen.getByTestId('scripts-post')).toBeInTheDocument()
  })

  it('Tests renders the HTTP TestsTab; adding an assertion writes the per-tab request store', () => {
    render(<McpConfigTabs />)
    fireEvent.click(screen.getByTestId('mcp-config-tab-tests'))
    expect(screen.getByTestId('mcp-config-panel-tests')).toBeInTheDocument()
    act(() => useRequestStore.getState().addAssertion())
    expect(useRequestStore.getState().assertions).toHaveLength(1)
  })

  it('badges: a dot on Scripts when a script is set, the enabled assertion count on Tests', () => {
    render(<McpConfigTabs />)
    expect(screen.queryByTestId('mcp-config-scripts-dot')).toBeNull()
    expect(screen.queryByTestId('mcp-tests-count')).toBeNull()
    act(() => useRequestStore.getState().setPostScript('pm.test("x", () => {})'))
    expect(screen.getByTestId('mcp-config-scripts-dot')).toBeInTheDocument()
    act(() =>
      useRequestStore.getState().setAssertions([
        { id: 'a1', name: 'ok', type: 'status_equals', enabled: true, expected: 200 },
        { id: 'a2', name: 'off', type: 'status_equals', enabled: false, expected: 200 },
        { id: 'a3', name: 'fast', type: 'response_time_under', enabled: true, expected: 500 },
      ]),
    )
    expect(screen.getByTestId('mcp-tests-count')).toHaveTextContent('2')
  })

  it('editing a script flips the MCP tab dirty, so Ctrl+S has something to save', () => {
    useTabsStore.setState({
      tabs: [
        {
          id: TAB_ID,
          name: 'Echo',
          protocol: 'mcp',
          isDirty: false,
          savedRequestId: 'sr-1',
        } as Tab,
      ],
    })
    act(() => useRequestStore.getState().setPreScript('pm.environment.set("a", "1")'))
    expect(useTabsStore.getState().tabs[0].isDirty).toBe(true)
  })
})

describe('Ctrl+S keeps an MCP tab’s scripts and assertions (verification, no fix needed)', () => {
  it('saved_request branch writes pre_script / post_script / assertions next to the mcp metadata', async () => {
    const update = vi.fn(async () => ({ success: true }))
    ;(window as unknown as { api: unknown }).api = {
      savedRequest: { update },
      folder: { list: async () => ({ success: true, data: [] }) },
      endpoint: { listByProject: async () => ({ success: true, data: [] }) },
    }
    useTabsStore.setState({
      tabs: [
        { id: TAB_ID, name: 'Echo', protocol: 'mcp', isDirty: true, savedRequestId: 'sr-1' } as Tab,
      ],
      activeTabId: TAB_ID,
    })
    useMcpStore.setState({ url: 'http://127.0.0.1:3100/mcp', selectedTool: 'echo' })
    useRequestStore.setState({
      preScript: 'pm.variables.set("t", "hi")',
      postScript: 'pm.test("echo", () => {})',
      assertions: [{ id: 'a1', name: 'ok', type: 'status_equals', enabled: true, expected: 200 }],
    })
    const res = await saveActiveRequestInPlace()
    expect(res.success).toBe(true)
    const payload = (update.mock.calls[0] as unknown[])[1] as Record<string, string>
    expect(payload.protocol).toBe('mcp')
    expect(payload.pre_script).toBe('pm.variables.set("t", "hi")')
    expect(payload.post_script).toBe('pm.test("echo", () => {})')
    expect(JSON.parse(payload.assertions)).toHaveLength(1)
    expect(JSON.parse(payload.metadata).mcp.call.selectedTool).toBe('echo')
  })
})
