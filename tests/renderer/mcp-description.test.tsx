/**
 * Issue #155 — a very long tool description (Context7 `resolve-library-id`,
 * ~3000 chars) pushed the Arguments textarea and Invoke below the visible area.
 * The description is now clamped to three lines with a Show more / Show less
 * toggle, and the pane header scrolls as one unit above a floored result block.
 *
 * jsdom has no layout (every height is 0), so the toggle here is driven by the
 * length fallback in `McpDescription`; the real measurement path is covered by
 * the e2e spec in `tests/e2e/ui/18-protocols-deep.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import McpDescription, {
  DESCRIPTION_CLAMP_CHARS,
} from '../../src/renderer/components/protocols/mcp/McpDescription'
import McpToolPane from '../../src/renderer/components/protocols/mcp/McpToolPane'
import McpResourcePane from '../../src/renderer/components/protocols/mcp/McpResourcePane'
import McpPromptPane from '../../src/renderer/components/protocols/mcp/McpPromptPane'
import type { McpTool } from '../../src/renderer/types/mcp'

const SHORT = 'Returns pong'
const LONG = 'LONGDESC Resolves a package name to a Context7-compatible library ID. '
  .repeat(60)
  .slice(0, 3000)
const OTHER_LONG = ('OTHERDESC ' + 'x'.repeat(40) + ' ').repeat(80).slice(0, 3000)

const TOOLS: McpTool[] = [
  {
    name: 'resolve-library-id',
    description: LONG,
    inputSchema: { type: 'object', properties: { libraryName: { type: 'string' } } },
  },
  { name: 'other', description: OTHER_LONG, inputSchema: { type: 'object', properties: {} } },
]

function toggle(): HTMLElement {
  return screen.getByTestId('mcp-description-toggle')
}

/**
 * The action row is sticky at the bottom of the scrolling header, opaque, and
 * the LAST child of a column with no bottom padding — so the row's own `pb-2.5`
 * ends exactly where the scroll content ends and nothing can show beneath it.
 */
function expectStickyActions(headerId: string, actionsId: string, buttonId: string): void {
  const header = screen.getByTestId(headerId)
  const actions = screen.getByTestId(actionsId)
  expect(header).toHaveClass('overflow-y-auto', 'min-h-0', 'shrink')
  expect(header).not.toHaveClass('shrink-0')
  expect(header).toContainElement(actions)
  expect(actions).toHaveClass('sticky', 'bottom-0', 'bg-[var(--white)]')
  expect(actions).toContainElement(screen.getByTestId(buttonId))
  expect(header.firstElementChild?.lastElementChild).toBe(actions)
  expect(header.firstElementChild).toHaveClass('pt-2.5')
  expect(header.firstElementChild).not.toHaveClass('py-2.5')
  expect(header.firstElementChild).not.toHaveClass('pb-2.5')
  expect(actions).toHaveClass('pb-2.5')
  expect(actions).not.toHaveClass('-mb-2.5')
  expect(header.nextElementSibling).toHaveClass('flex-1', 'overflow-auto', 'min-h-[5rem]')
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-155')
})

afterEach(() => cleanup())

describe('McpDescription', () => {
  it('a short description is clamped but has no toggle', () => {
    expect(SHORT.length).toBeLessThan(DESCRIPTION_CLAMP_CHARS)
    render(<McpDescription text={SHORT} />)
    expect(screen.getByTestId('mcp-tool-description')).toHaveTextContent(SHORT)
    expect(screen.queryByTestId('mcp-description-toggle')).toBeNull()
  })

  it('a 3000-char description clamps to three lines and the toggle expands / collapses it', () => {
    expect(LONG).toHaveLength(3000)
    render(<McpDescription text={LONG} />)
    const desc = screen.getByTestId('mcp-tool-description')
    expect(desc).toHaveClass('line-clamp-3')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).toHaveTextContent('Show more')
    expect(toggle()).toHaveAttribute('aria-controls', desc.id)

    fireEvent.click(toggle())
    expect(desc).not.toHaveClass('line-clamp-3')
    expect(desc).toHaveClass('whitespace-pre-wrap', 'break-words')
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(toggle()).toHaveTextContent('Show less')

    fireEvent.click(toggle())
    expect(screen.getByTestId('mcp-tool-description')).toHaveClass('line-clamp-3')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('a new text resets to collapsed', () => {
    const { rerender } = render(<McpDescription text={LONG} testId="d" />)
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    rerender(<McpDescription text={OTHER_LONG} testId="d" />)
    expect(screen.getByTestId('d')).toHaveClass('line-clamp-3')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('MCP panes with a long description (issue #155)', () => {
  beforeEach(() => {
    useMcpStore.setState({ tools: TOOLS, connectionState: 'connected' })
    useMcpStore.getState().setSelectedTool('resolve-library-id')
  })

  it('the tool header scrolls with a sticky Invoke row; the result block keeps a floor', () => {
    render(<McpToolPane />)
    const header = screen.getByTestId('mcp-tool-header')
    // Form is the default args view (issue #162); either view lives in the header.
    const args = screen.queryByTestId('mcp-tool-args') ?? screen.getByTestId('mcp-args-form')
    expect(header).toContainElement(args)
    expect(header).toContainElement(screen.getByTestId('mcp-tool-description'))
    expectStickyActions('mcp-tool-header', 'mcp-tool-actions', 'mcp-invoke')
    expect(screen.getByTestId('mcp-tool-description')).toHaveClass('line-clamp-3')
  })

  it('selecting another tool collapses the description again — also on the way back', () => {
    render(<McpToolPane />)
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')

    act(() => useMcpStore.getState().setSelectedTool('other'))
    expect(screen.getByTestId('mcp-tool-description')).toHaveTextContent('OTHERDESC')
    expect(screen.getByTestId('mcp-tool-description')).toHaveClass('line-clamp-3')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')

    act(() => useMcpStore.getState().setSelectedTool('resolve-library-id'))
    expect(screen.getByTestId('mcp-tool-description')).toHaveClass('line-clamp-3')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('resource and prompt panes clamp their descriptions above a sticky action row', () => {
    useMcpStore.setState({
      resources: [{ uri: 'test://long', name: 'long', description: LONG }],
      selectedResourceUri: 'test://long',
      resourceUriDraft: 'test://long',
    })
    render(<McpResourcePane />)
    expectStickyActions('mcp-resource-header', 'mcp-resource-actions', 'mcp-read-resource')
    expect(screen.getByTestId('mcp-resource-actions')).toContainElement(
      screen.getByTestId('mcp-resource-uri'),
    )
    expect(screen.getByTestId('mcp-resource-description')).toHaveClass('line-clamp-3')
    cleanup()

    useMcpStore.setState({
      prompts: [{ name: 'summarize', description: LONG }],
      selectedPrompt: 'summarize',
    })
    render(<McpPromptPane />)
    expectStickyActions('mcp-prompt-header', 'mcp-prompt-actions', 'mcp-get-prompt')
    expect(screen.getByTestId('mcp-prompt-description')).toHaveClass('line-clamp-3')
  })
})
