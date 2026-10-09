/**
 * Issue #154 — Mock MCP editor notes:
 *   - an amber warning when the server listens on a non-loopback host without
 *     authentication (`mock-mcp-exposed-warning`), driven by the DRAFT so it
 *     follows typing (predicate: `src/shared/mock-mcp-exposure.ts`, unit-tested
 *     in `tests/main/mock-mcp-exposure.test.ts`);
 *   - a muted note under the bearer token that it is saved in the project file
 *     and shared by Push (`mock-mcp-token-note`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import MockMcpServerEditor from '../../src/renderer/components/mock-mcp/MockMcpServerEditor'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { installBridge, sampleServer } from './mock-mcp-bridge-stub'

describe('editor notes', () => {
  beforeEach(() => {
    installBridge([sampleServer({ id: 'a', name: 'Alpha' })])
    useMockMcpStore.setState({
      servers: [sampleServer({ id: 'a', name: 'Alpha' })],
      projectId: 'p-1',
      stateByServer: {},
      logsByServer: {},
      drafts: {},
    })
    useWorkspaceStore.setState({ activeProjectId: 'p-1' })
    useTabsStore.setState({ tabs: [], activeTabId: null })
  })
  afterEach(() => cleanup())

  it('warns while the draft host is exposed without auth, and stops once bearer is on', () => {
    render(<MockMcpServerEditor serverId="a" />)
    expect(screen.queryByTestId('mock-mcp-exposed-warning')).toBeNull()
    fireEvent.change(screen.getByTestId('mock-mcp-host'), { target: { value: '0.0.0.0' } })
    expect(screen.getByTestId('mock-mcp-exposed-warning')).toHaveTextContent(
      'Reachable from other machines without authentication — set a bearer token or bind to 127.0.0.1.',
    )
    // The Scenarios tab (where auth lives) shows it too, until bearer is chosen.
    fireEvent.click(screen.getByTestId('mock-mcp-tab-scenarios'))
    expect(screen.getByTestId('mock-mcp-exposed-warning')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('mock-mcp-auth-mode'), { target: { value: 'bearer' } })
    expect(screen.queryByTestId('mock-mcp-exposed-warning')).toBeNull()
  })

  it('the bearer token input carries the "saved in the project file" note', () => {
    render(<MockMcpServerEditor serverId="a" />)
    fireEvent.click(screen.getByTestId('mock-mcp-tab-scenarios'))
    expect(screen.queryByTestId('mock-mcp-token-note')).toBeNull()
    fireEvent.change(screen.getByTestId('mock-mcp-auth-mode'), { target: { value: 'bearer' } })
    expect(screen.getByTestId('mock-mcp-token-note')).toHaveTextContent(
      'Saved in the project file — Push shares it with the repository.',
    )
  })
})
