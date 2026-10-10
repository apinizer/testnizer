/**
 * Issue #173 completeness — every LIST of requests shows the protocol chip for
 * a non-HTTP request instead of its placeholder method (`GET`, or an MCP
 * History verb like `CALL_TOOL`). The tree row and the tab strip already did
 * (`protocol-chip.test.tsx`); History and the Runner sequence did not — and
 * MCP rows now RUN, so the Runner showed "GET" for an MCP call.
 */
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import RequestBadge from '../../src/renderer/components/shared/RequestBadge'
import RunnerSequence from '../../src/renderer/components/runner/RunnerSequence'
import HistoryListPanel from '../../src/renderer/components/sidebar/HistoryListPanel'
import { useHistoryStore } from '../../src/renderer/stores/history.store'
import type { HistoryEntry } from '../../src/renderer/types'
import type { RunnerEndpointItem } from '../../src/renderer/components/runner/RunnerTab'
;(globalThis as unknown as { React: typeof React }).React = React

afterEach(() => cleanup())

describe('RequestBadge', () => {
  it('non-HTTP → protocol chip; HTTP / SOAP → method badge', () => {
    render(<RequestBadge protocol="mcp" method="GET" />)
    expect(screen.getByTestId('protocol-chip')).toHaveTextContent('MCP')
    expect(screen.queryByText('GET')).toBeNull()
    cleanup()
    render(<RequestBadge protocol="http" method="POST" />)
    expect(screen.queryByTestId('protocol-chip')).toBeNull()
    expect(screen.getByText('POST')).toBeInTheDocument()
    cleanup()
    render(<RequestBadge protocol="soap" method={null} />)
    expect(screen.getByText('GET')).toBeInTheDocument()
  })
})

describe('History row', () => {
  const entry = (over: Partial<HistoryEntry>): HistoryEntry =>
    ({
      id: 'h1',
      protocol: 'mcp',
      method: 'CALL_TOOL',
      url: 'http://127.0.0.1:3100/mcp',
      status_code: 0,
      duration_ms: 3,
      executed_at: Date.now(),
      request_snapshot: {},
      ...over,
    }) as HistoryEntry

  it('an MCP entry shows MCP, an HTTP entry keeps its method', () => {
    useHistoryStore.setState({
      entries: [
        entry({}),
        entry({ id: 'h2', protocol: 'http', method: 'DELETE', url: 'http://x/a' }),
      ],
      searchTerm: '',
      fetch: vi.fn(async () => undefined),
    } as never)
    render(<HistoryListPanel />)
    const [mcpRow, httpRow] = screen.getAllByTestId('history-entry')
    expect(within(mcpRow).getByTestId('protocol-chip')).toHaveTextContent('MCP')
    expect(within(mcpRow).queryByText('CALL_TOOL')).toBeNull()
    expect(within(httpRow).queryByTestId('protocol-chip')).toBeNull()
    expect(within(httpRow).getByText('DELETE')).toBeInTheDocument()
  })
})

describe('Runner sequence row', () => {
  it('an MCP request in the run shows MCP, not its placeholder GET', () => {
    const endpoints: RunnerEndpointItem[] = [
      {
        id: 'm',
        name: 'Echo tool',
        method: 'GET',
        url: 'http://x/mcp',
        selected: true,
        protocol: 'mcp',
      },
      { id: 'h', name: 'Health', method: 'GET', url: '/health', selected: true, protocol: 'http' },
    ]
    const noop = () => {}
    render(
      <RunnerSequence
        endpoints={endpoints}
        folderGroups={[]}
        onToggle={noop}
        onSelectAll={noop}
        onDeselectAll={noop}
        onReset={noop}
        onSetPhase={noop}
        onSetFolderPhase={noop}
        onToggleFolder={noop}
      />,
    )
    const mcpRow = screen.getByText('Echo tool').parentElement as HTMLElement
    expect(within(mcpRow).getByTestId('protocol-chip')).toHaveTextContent('MCP')
    expect(within(mcpRow).queryByText('GET')).toBeNull()
    const httpRow = screen.getByText('Health').parentElement as HTMLElement
    expect(within(httpRow).getByText('GET')).toBeInTheDocument()
  })
})
