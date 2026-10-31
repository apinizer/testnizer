/**
 * 1.6.0 screen review G-08 (issue #251) — the MCP capability tabs showed
 * "Resourc..." even in a wide window: each tab was `flex-1 min-w-0` with a
 * truncating label, so the three tabs split the pane into EQUAL thirds and the
 * longest label lost, although "Tools" and "Prompts" had room to spare.
 *
 * The tabs now size to their content (`flex: 1 0 auto`) — they still share the
 * spare width, but never shrink below their label — and the strip scrolls
 * horizontally when the pane is narrower than all three labels.
 *
 * jsdom does no layout, so this pins the CSS contract that produces it (the
 * classes) rather than measured widths.
 */
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'

import McpCapabilityList from '../../src/renderer/components/protocols/mcp/McpCapabilityList'

afterEach(() => cleanup())

describe('MCP capability tabs show full labels (G-08)', () => {
  it('tabs size to content and never truncate their label', () => {
    render(<McpCapabilityList />)
    for (const id of ['tools', 'resources', 'prompts']) {
      const tab = screen.getByTestId(`mcp-cap-tab-${id}`)
      expect(tab.className, id).not.toMatch(/(^|\s)flex-1(\s|$)/)
      expect(tab.className, id).not.toMatch(/(^|\s)min-w-0(\s|$)/)
      expect(tab.className, id).toMatch(/flex-\[1_0_auto\]/)
      expect(tab.querySelector('.truncate'), id).toBeNull()
    }
    expect(screen.getByTestId('mcp-cap-tab-resources')).toHaveTextContent(/^Resources/)
  })

  it('the strip scrolls instead of clipping when the pane is truly narrow', () => {
    render(<McpCapabilityList />)
    const strip = screen.getByRole('tablist')
    expect(strip.className).toMatch(/\boverflow-x-auto\b/)
  })
})
