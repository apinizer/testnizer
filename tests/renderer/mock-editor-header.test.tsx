/**
 * The HTTP / SSE mock editor wears the same header as the Mock MCP editor
 * (`MockEditorHeader`) and its per-endpoint "Open in SSE tab" follows the
 * header's start-then-open path (issue #221 screenshot review).
 *
 * Before: the HTTP header showed the raw English status in a hex pill (so
 * Turkish read "stopped" next to the sidebar's "durduruldu"), Start / Stop were
 * hex-coloured buttons, there was no base URL line, and the per-endpoint SSE
 * button opened a tab against a stopped server.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import React from 'react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import {
  httpBridge,
  httpEndpoint,
  httpResponse,
  httpServer,
  resetHttpBridge,
  seedHttpBridge,
} from './mock-http-bridge-stub'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import MockServerEditor from '../../src/renderer/components/mock/MockServerEditor'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { toast } from '../../src/renderer/lib/toast'
import type { MockServer } from '../../src/renderer/types'

const SSE_SERVER = httpServer({ id: 'srv-1', kind: 'sse', port: 3200, name: 'Ticker' })

async function mount(server: MockServer, status?: 'running'): Promise<void> {
  resetHttpBridge([server])
  seedHttpBridge({
    endpoints: [httpEndpoint({ serverId: server.id, path: '/events' })],
    responses: [httpResponse({ bodyType: 'sse', body: 'data: a\n' })],
  })
  useMockStore.setState({
    servers: [server],
    endpointsByServer: {},
    responsesByEndpoint: {},
    statusByServer: status ? { [server.id]: status } : {},
    errorByServer: {},
    logsByServer: {},
  })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  render(React.createElement(MockServerEditor, { serverId: server.id }))
  await screen.findByTestId('mock-endpoint-open-in-sse')
}

beforeEach(() => {
  useUIStore.getState().setLocale('en')
  vi.mocked(toast.error).mockClear()
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('MockServerEditor header — the Mock MCP header', () => {
  it('translated status (TR matches the sidebar), Start as a ghost button, base URL line', async () => {
    useUIStore.getState().setLocale('tr')
    await mount(SSE_SERVER)
    const status = screen.getByTestId('mock-status')
    expect(status).toHaveTextContent('durduruldu')
    expect(status).toHaveAttribute('data-status', 'stopped')
    const start = screen.getByTestId('mock-start')
    expect(start).toHaveTextContent('Başlat')
    // Token colour, no inline hex.
    expect(start.className).toContain('text-[var(--green)]')
    expect(start.getAttribute('style')).toBeNull()
    expect(screen.getByTestId('mock-base-url')).toHaveTextContent('http://127.0.0.1:3200')
    // Tabs: the Mock MCP editor's tab buttons, with testids.
    expect(screen.getByTestId('mock-tab-endpoints')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('mock-tab-logs')).toHaveTextContent('Loglar')
  })

  it('running: Stop in red and the status reads running', async () => {
    await mount(SSE_SERVER, 'running')
    expect(screen.getByTestId('mock-status')).toHaveTextContent('running')
    expect(screen.getByTestId('mock-stop').className).toContain('text-[var(--red)]')
  })

  it('a start error is a toast and shows under the title', async () => {
    await mount(SSE_SERVER)
    httpBridge.server.start.mockImplementationOnce(
      () => Promise.resolve({ success: false, error: 'Port 3200 is already in use' }) as never,
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-start'))
    })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Port 3200 is already in use'))
    expect(screen.getByTestId('mock-error')).toHaveTextContent('Port 3200 is already in use')
  })
})

describe('per-endpoint "Open in SSE tab" — same path as the header', () => {
  it('stopped: labelled "Start & open in SSE tab"; click starts, then opens the tab', async () => {
    await mount(SSE_SERVER)
    const btn = screen.getByTestId('mock-endpoint-open-in-sse')
    expect(btn).toHaveTextContent('Start & open in SSE tab')
    expect(btn).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(useTabsStore.getState().tabs).toHaveLength(1))
    expect(httpBridge.server.start).toHaveBeenCalledWith('srv-1')
    expect(useTabsStore.getState().tabs[0]).toMatchObject({ protocol: 'sse', isDirty: false })
  })

  it('stopped + the start fails: toast, no tab', async () => {
    await mount(SSE_SERVER)
    httpBridge.server.start.mockImplementationOnce(
      () => Promise.resolve({ success: false, error: 'Port 3200 is already in use' }) as never,
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-endpoint-open-in-sse'))
    })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Port 3200 is already in use'))
    expect(useTabsStore.getState().tabs).toHaveLength(0)
  })

  it('running: labelled "Open in SSE tab"; click opens without starting', async () => {
    await mount(SSE_SERVER, 'running')
    httpBridge.server.start.mockClear()
    const btn = screen.getByTestId('mock-endpoint-open-in-sse')
    expect(btn).toHaveTextContent('Open in SSE tab')
    expect(btn).not.toHaveTextContent('Start')
    await act(async () => {
      fireEvent.click(btn)
    })
    await waitFor(() => expect(useTabsStore.getState().tabs).toHaveLength(1))
    expect(httpBridge.server.start).not.toHaveBeenCalled()
  })
})
