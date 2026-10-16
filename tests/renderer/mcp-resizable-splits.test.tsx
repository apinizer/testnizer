/**
 * Issue #211 — the MCP request tab had a fixed 240 px capability list (tab
 * labels like "Prompts 4" were cut) and a RESULT block floored at 5rem with no
 * divider. Both are now react-resizable-panels splits: list ↔ Explorer
 * (horizontal) and call header ↔ result (vertical, shared by the Tool /
 * Resource / Prompt panes). Sizes are remembered per user in localStorage.
 *
 * jsdom has no layout, so the pixel floors fall back to fixed percentages;
 * the seeded sizes below sit inside those fallbacks so nothing is clamped.
 *
 * Vitest resolves the package's `node` (SSR) build, which has no layout
 * effects — it never reads or writes the saved layout. The Electron renderer
 * runs the browser build, so that is the one under test here.
 */
vi.mock(
  'react-resizable-panels',
  () =>
    import('../../node_modules/react-resizable-panels/dist/react-resizable-panels.browser.development.esm.js'),
)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import McpEditor from '../../src/renderer/components/protocols/McpEditor'
import McpToolPane from '../../src/renderer/components/protocols/mcp/McpToolPane'
import McpResourcePane from '../../src/renderer/components/protocols/mcp/McpResourcePane'
import McpPromptPane from '../../src/renderer/components/protocols/mcp/McpPromptPane'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import {
  MCP_CALL_SPLIT_ID,
  MCP_LIST_SPLIT_ID,
  mcpSplitStorage,
  pairedMins,
  pxToPercent,
} from '../../src/renderer/components/protocols/mcp/mcp-split-layout'

const LIST_KEY = `react-resizable-panels:${MCP_LIST_SPLIT_ID}`
const CALL_KEY = `react-resizable-panels:${MCP_CALL_SPLIT_ID}`

function panelOf(testId: string): HTMLElement {
  const el = screen.getByTestId(testId).closest('[data-panel-size]')
  if (!(el instanceof HTMLElement)) throw new Error(`no panel around ${testId}`)
  return el
}

beforeEach(() => {
  window.localStorage.clear()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-211')
  useMcpStore.setState({
    connectionState: 'connected',
    tools: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }],
    resources: [{ uri: 'test://a', name: 'a' }],
    prompts: [{ name: 'greet' }],
  })
  useMcpStore.getState().setSelectedTool('echo')
})

afterEach(() => cleanup())

describe('list ↔ Explorer split (issue #211)', () => {
  it('the capability list sits in a resizable panel with a drag handle', () => {
    render(<McpEditor />)
    const handle = screen.getByTestId('mcp-list-split-handle')
    expect(handle).toHaveAttribute('data-panel-group-direction', 'horizontal')
    const list = screen.getByTestId('mcp-capability-list')
    expect(list.className).not.toContain('w-[240px]')
    expect(panelOf('mcp-capability-list')).toHaveAttribute(
      'data-panel-id',
      'mcp-capability-list-panel',
    )
    // The editor body keeps its floor (review item 12).
    expect(screen.getByTestId('mcp-editor-body').className).toContain('min-h-[120px]')
  })

  it('restores the remembered list width', () => {
    window.localStorage.setItem(
      LIST_KEY,
      JSON.stringify({
        'mcp-capability-list-panel,mcp-explorer-panel': { layout: [35, 65], expandToSizes: {} },
      }),
    )
    render(<McpEditor />)
    expect(panelOf('mcp-capability-list')).toHaveAttribute('data-panel-size', '35.0')
  })
})

describe('call header ↔ result split (issue #211)', () => {
  it('the tool pane has a vertical handle between the header and RESULT', () => {
    render(<McpToolPane />)
    const handle = screen.getByTestId('mcp-call-split-handle')
    expect(handle).toHaveAttribute('data-panel-group-direction', 'vertical')
    expect(panelOf('mcp-tool-header')).toHaveAttribute('data-panel-id', 'mcp-call-header-panel')
    expect(panelOf('mcp-call-result')).toHaveAttribute('data-panel-id', 'mcp-call-result-panel')
    expect(screen.getByTestId('mcp-call-result')).toHaveTextContent('Result')
  })

  it('restores the remembered split in the Tool, Resource and Prompt panes alike', () => {
    window.localStorage.setItem(
      CALL_KEY,
      JSON.stringify({
        'mcp-call-header-panel,mcp-call-result-panel': { layout: [30, 70], expandToSizes: {} },
      }),
    )
    const { unmount } = render(<McpToolPane />)
    expect(panelOf('mcp-tool-header')).toHaveAttribute('data-panel-size', '30.0')
    expect(panelOf('mcp-call-result')).toHaveAttribute('data-panel-size', '70.0')
    unmount()

    useMcpStore.getState().selectResource('test://a')
    const r = render(<McpResourcePane />)
    expect(screen.getByTestId('mcp-call-split-handle')).toBeInTheDocument()
    expect(panelOf('mcp-resource-header')).toHaveAttribute('data-panel-size', '30.0')
    r.unmount()

    useMcpStore.getState().setSelectedPrompt('greet')
    render(<McpPromptPane />)
    expect(screen.getByTestId('mcp-call-split-handle')).toBeInTheDocument()
    expect(panelOf('mcp-prompt-header')).toHaveAttribute('data-panel-size', '30.0')
  })
})

describe('dragging persists the size', () => {
  it('a keyboard resize of the list handle is written to storage', async () => {
    vi.useFakeTimers()
    try {
      render(<McpEditor />)
      const handle = screen.getByTestId('mcp-list-split-handle')
      act(() => handle.focus())
      fireEvent.keyDown(handle, { key: 'ArrowRight' })
      const after = Number(panelOf('mcp-capability-list').getAttribute('data-panel-size'))
      expect(after).toBeGreaterThan(26)
      await act(async () => {
        vi.advanceTimersByTime(500)
      })
      const saved = JSON.parse(window.localStorage.getItem(LIST_KEY) ?? '{}') as Record<
        string,
        { layout: number[] }
      >
      expect(saved['mcp-capability-list-panel,mcp-explorer-panel']?.layout[0]).toBe(after)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('mcpSplitStorage', () => {
  it('a throwing localStorage never breaks the editor', () => {
    const proto = Object.getPrototypeOf(window.localStorage) as Storage
    const origGet = proto.getItem
    const origSet = proto.setItem
    proto.getItem = () => {
      throw new Error('blocked')
    }
    proto.setItem = () => {
      throw new Error('blocked')
    }
    try {
      expect(mcpSplitStorage.getItem(LIST_KEY)).toBeNull()
      expect(() => mcpSplitStorage.setItem(LIST_KEY, '{}')).not.toThrow()
      render(<McpEditor />)
      expect(screen.getByTestId('mcp-list-split-handle')).toBeInTheDocument()
    } finally {
      proto.getItem = origGet
      proto.setItem = origSet
    }
  })
})

describe('pixel floors as percentages', () => {
  it('pxToPercent: fallback without layout, the share otherwise, capped', () => {
    expect(pxToPercent(220, 0, 18, 45)).toBe(18)
    expect(pxToPercent(220, 1100, 18, 45)).toBe(20)
    expect(pxToPercent(220, 300, 18, 45)).toBe(45)
  })

  it('pairedMins: header + result floors never exceed 90 % on the 120 px body floor', () => {
    expect(pairedMins(96, 80, 0, 15)).toEqual([15, 15])
    expect(pairedMins(96, 80, 800, 15)).toEqual([12, 10])
    const [a, b] = pairedMins(96, 80, 120, 15)
    expect(a + b).toBeLessThanOrEqual(90)
    expect(a).toBeGreaterThan(b)
  })
})
