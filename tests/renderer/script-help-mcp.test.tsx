/**
 * Script help mentions `pm.mcp` (issue #160 follow-up): MCP requests run the
 * same Scripts / Tests tabs, and their post-response scripts get `pm.mcp`
 * (`src/shared/mcp-response.ts`) — the help modal and "Insert example" now
 * say so (EN + TR).
 */
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ScriptHelpModal from '../../src/renderer/components/shared/ScriptHelpModal'
import ScriptsTab from '../../src/renderer/components/request/ScriptsTab'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
;(globalThis as unknown as { React: typeof React }).React = React

afterEach(() => {
  cleanup()
  useUIStore.setState({ locale: 'en' })
})

describe('ScriptHelpModal — MCP section', () => {
  it('lists pm.mcp.isError / result / structuredContent with examples', () => {
    render(<ScriptHelpModal open onClose={() => {}} variant="post" isMcp />)
    const section = screen.getByTestId('script-help-mcp')
    expect(section).toHaveTextContent('MCP requests')
    expect(section).toHaveTextContent(
      "pm.test('tool succeeded', () => pm.expect(pm.mcp.isError).to.be.false)",
    )
    expect(section).toHaveTextContent("pm.environment.set('libraryId', pm.response.json()")
    for (const expr of ['pm.mcp.isError', 'pm.mcp.result', 'pm.mcp.structuredContent']) {
      expect(screen.getByText(expr)).toBeInTheDocument()
    }
  })

  it('reads in Turkish when the UI is Turkish', () => {
    useUIStore.setState({ locale: 'tr' })
    render(<ScriptHelpModal open onClose={() => {}} variant="post" isMcp />)
    expect(screen.getByTestId('script-help-mcp')).toHaveTextContent('MCP istekleri')
  })
})

describe('ScriptsTab — Insert example on an MCP tab', () => {
  it('appends a pm.mcp example to the post-response script', () => {
    useTabsStore.setState({
      tabs: [{ id: 't-mcp', name: 'Echo', protocol: 'mcp', isDirty: false } as never],
      activeTabId: 't-mcp',
    })
    useRequestStore.setState({ postScript: '' } as never)
    render(<ScriptsTab />)
    fireEvent.click(screen.getByTestId('scripts-insert-example'))
    expect(useRequestStore.getState().postScript).toContain('pm.mcp.isError')
  })
})

describe('review item 13: the MCP section is for MCP tabs only', () => {
  it('an HTTP tab\'s help has no pm.mcp section', () => {
    render(<ScriptHelpModal open onClose={() => {}} variant="post" />)
    expect(screen.queryByTestId('script-help-mcp')).toBeNull()
  })

  it('the MCP section uses Tailwind classes, not inline style', () => {
    render(<ScriptHelpModal open onClose={() => {}} variant="post" isMcp />)
    const section = screen.getByTestId('script-help-mcp')
    expect(section.querySelector('p')?.getAttribute('style')).toBeNull()
    expect(section.querySelector('p')?.className).toContain('text-[13px]')
  })

  it('ScriptsTab passes isMcp from the active tab', () => {
    useTabsStore.setState({
      tabs: [{ id: 't-mcp', name: 'Echo', protocol: 'mcp', isDirty: false } as never],
      activeTabId: 't-mcp',
    })
    render(<ScriptsTab />)
    fireEvent.click(screen.getByTestId('scripts-post'))
    fireEvent.click(screen.getByTestId('scripts-help'))
    expect(screen.getByTestId('script-help-mcp')).toBeInTheDocument()
  })
})
