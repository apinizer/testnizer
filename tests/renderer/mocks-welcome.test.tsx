/**
 * Mocks page centre with no open tab (issue #226).
 *
 *  - The project has NO mock server of any kind (HTTP, MCP, SSE, AI) → an
 *    empty state with one primary action, "New mock server", that opens the
 *    same dialog as the sidebar "+" (and Create from it works).
 *  - The project has servers → the old "Select a mock server from the left
 *    panel" line.
 *  - Before the lists are known for the active project → the old line too
 *    ("unknown" is not "empty"); the welcome loads both lists itself, so a
 *    collapsed sidebar does not leave it guessing.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import { httpBridge, httpServer, resetHttpBridge } from './mock-http-bridge-stub'
import { installBridge, sampleServer } from './mock-mcp-bridge-stub'
import PageWelcome from '../../src/renderer/components/layout/PageWelcome'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useUIStore } from '../../src/renderer/stores/ui.store'

void React

function setup(http: ReturnType<typeof httpServer>[], mcp: ReturnType<typeof sampleServer>[]) {
  resetHttpBridge(http)
  installBridge(mcp)
  useMockStore.setState({ servers: [], projectId: null, statusByServer: {}, errorByServer: {} })
  useMockMcpStore.setState({ servers: [], projectId: null })
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
  useTabsStore.setState({ tabs: [], activeTabId: null })
}

beforeEach(() => {
  setLocale('en')
  useUIStore.setState({ locale: 'en' })
})
afterEach(() => cleanup())

describe('Mocks page welcome (issue #226)', () => {
  it('no servers of any kind → empty state with one "New mock server" action', async () => {
    setup([], [])
    render(<PageWelcome page="mocks" />)
    const action = await screen.findByTestId('mocks-empty-new')
    expect(action).toHaveTextContent('New mock server')
    expect(screen.getByText('No mock servers yet')).toBeInTheDocument()
    expect(screen.queryByText('Select a mock server from the left panel')).toBeNull()
    // The welcome loaded both lists itself.
    expect(httpBridge.server.list).toHaveBeenCalledWith('p-1')
  })

  it('the action opens the New mock server dialog, and Create from it works', async () => {
    setup([], [])
    render(<PageWelcome page="mocks" />)
    fireEvent.click(await screen.findByTestId('mocks-empty-new'))
    expect(screen.getByTestId('mock-new-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('mock-new-type-http')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByTestId('mock-new-create'))
    await waitFor(() => expect(httpBridge.server.create).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByTestId('mock-new-dialog')).toBeNull())
    expect(useTabsStore.getState().tabs).toHaveLength(1)
  })

  it('an HTTP / SSE / AI server exists → the old "select from the left panel" line', async () => {
    setup([httpServer({ id: 'h1', kind: 'sse' })], [])
    render(<PageWelcome page="mocks" />)
    await act(async () => {
      await Promise.resolve()
    })
    await waitFor(() => expect(useMockStore.getState().projectId).toBe('p-1'))
    expect(screen.getByText('Select a mock server from the left panel')).toBeInTheDocument()
    expect(screen.queryByTestId('mocks-empty-new')).toBeNull()
  })

  it('only a Mock MCP server exists → the old line', async () => {
    setup([], [sampleServer({ id: 'm1', projectId: 'p-1' })])
    render(<PageWelcome page="mocks" />)
    await waitFor(() => expect(useMockMcpStore.getState().projectId).toBe('p-1'))
    expect(screen.getByText('Select a mock server from the left panel')).toBeInTheDocument()
    expect(screen.queryByTestId('mocks-empty-new')).toBeNull()
  })

  it('lists not loaded yet for this project → the old line, never a premature empty state', () => {
    setup([], [])
    // Lists stay pending: the bridge never answers.
    httpBridge.server.list.mockImplementationOnce(() => new Promise(() => {}))
    render(<PageWelcome page="mocks" />)
    expect(screen.getByText('Select a mock server from the left panel')).toBeInTheDocument()
    expect(screen.queryByTestId('mocks-empty-new')).toBeNull()
  })

  it('Turkish wording', async () => {
    setLocale('tr')
    useUIStore.setState({ locale: 'tr' })
    setup([], [])
    render(<PageWelcome page="mocks" />)
    expect(await screen.findByTestId('mocks-empty-new')).toHaveTextContent('Yeni mock sunucu')
    expect(screen.getByText('Henüz mock sunucu yok')).toBeInTheDocument()
  })
})
