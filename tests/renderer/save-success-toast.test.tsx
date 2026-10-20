/**
 * Issue #212 — a successful save showed no confirmation: Ctrl+S toasted only
 * errors and the Save dialog (EndpointSaveModal) just closed. Both now show
 * "Request saved" for every protocol. The Mock MCP editor's own Ctrl+S keeps
 * its own toast and must not also fire the global one (double toast).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/renderer/lib/platform', () => ({ isMac: () => false }))
vi.mock('../../src/renderer/lib/save-active-request', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/lib/save-active-request')>()
  return { ...real, saveActiveRequestInPlace: vi.fn() }
})
vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import { toast } from '../../src/renderer/lib/toast'
import { saveActiveRequestInPlace } from '../../src/renderer/lib/save-active-request'
import { useKeyboardShortcuts } from '../../src/renderer/lib/keyboard-shortcuts'
import EndpointSaveModal from '../../src/renderer/components/modals/EndpointSaveModal'
import MockMcpServerEditor from '../../src/renderer/components/mock-mcp/MockMcpServerEditor'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import type { Tab } from '../../src/renderer/types'
import { installBridge, sampleServer } from './mock-mcp-bridge-stub'

function Shortcuts(): null {
  useKeyboardShortcuts()
  return null
}

function pressCtrlS(target: Window | Element = window): void {
  fireEvent.keyDown(target, { key: 's', ctrlKey: true })
}

function activate(tab: Partial<Tab>): void {
  useTabsStore.setState({
    tabs: [{ id: 'tab-1', name: 'Req', method: 'GET', url: '', ...tab } as Tab],
    activeTabId: 'tab-1',
  })
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  vi.mocked(saveActiveRequestInPlace).mockReset()
  useUIStore.setState({ showSaveModal: false, showEndpointSaveModal: false })
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('Ctrl+S on a saved request (issue #212)', () => {
  it.each(['http', 'soap', 'graphql', 'websocket', 'grpc', 'mcp', 'ai'] as const)(
    'shows "Request saved" after a successful in-place save (%s)',
    async (protocol) => {
      vi.mocked(saveActiveRequestInPlace).mockResolvedValue({ success: true })
      activate({ protocol, endpointId: 'e-1' })
      render(<Shortcuts />)
      pressCtrlS()
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Request saved'))
      expect(toast.success).toHaveBeenCalledTimes(1)
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it('in Turkish the toast is translated', async () => {
    vi.mocked(saveActiveRequestInPlace).mockResolvedValue({ success: true })
    useUIStore.getState().setLocale('tr')
    activate({ protocol: 'http', savedRequestId: 's-1' })
    render(<Shortcuts />)
    pressCtrlS()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('İstek kaydedildi'))
  })

  it('a failed save shows only the error', async () => {
    vi.mocked(saveActiveRequestInPlace).mockResolvedValue({ success: false, error: 'disk full' })
    activate({ protocol: 'http', testSuiteItemId: 'ti-1' })
    render(<Shortcuts />)
    pressCtrlS()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('disk full'))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('a row the save cannot find falls back to the Save dialog without a toast', async () => {
    vi.mocked(saveActiveRequestInPlace).mockResolvedValue({ success: false, notApplicable: true })
    activate({ protocol: 'http', endpointId: 'gone' })
    render(<Shortcuts />)
    pressCtrlS()
    await waitFor(() => expect(useUIStore.getState().showEndpointSaveModal).toBe(true))
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('Save dialog (EndpointSaveModal) — issue #212', () => {
  function installApi(): { create: ReturnType<typeof vi.fn> } {
    const create = vi.fn(async () => ({ success: true, data: { id: 'sr-new' } }))
    const permissive = new Proxy(
      {},
      { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
    ) as Record<string, unknown>
    const own: Record<string, unknown> = {
      folder: { list: vi.fn(async () => ({ success: true, data: [] })), create: vi.fn() },
      savedRequest: { create, update: vi.fn(), get: vi.fn() },
    }
    ;(window as unknown as { api: unknown }).api = new Proxy(own, {
      get: (t, k) => (typeof k === 'string' && k in t ? t[k] : permissive[k as string]),
    })
    return { create }
  }

  it.each(['http', 'ai'] as const)(
    'a successful save closes the dialog with "Request saved" (%s)',
    async (protocol) => {
      const { create } = installApi()
      activate({ protocol, name: 'My call' })
      useWorkspaceStore.setState({
        activeProjectId: 'p1',
        projects: [],
        refreshTree: vi.fn(async () => {}),
      } as never)
      useUIStore.setState({ showEndpointSaveModal: true })
      render(<EndpointSaveModal />)
      await screen.findByDisplayValue('My call')
      fireEvent.click(screen.getByTestId('endpoint-save-submit'))
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Request saved'))
      expect(create).toHaveBeenCalledTimes(1)
      expect(useUIStore.getState().showEndpointSaveModal).toBe(false)
    },
  )

  it('no toast when the save is refused', async () => {
    const { create } = installApi()
    create.mockResolvedValueOnce({ success: false } as never)
    activate({ protocol: 'http', name: 'My call' })
    useWorkspaceStore.setState({
      activeProjectId: 'p1',
      projects: [],
      refreshTree: vi.fn(async () => {}),
    } as never)
    useUIStore.setState({ showEndpointSaveModal: true })
    render(<EndpointSaveModal />)
    await screen.findByDisplayValue('My call')
    fireEvent.click(screen.getByTestId('endpoint-save-submit'))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('Mock MCP editor Ctrl+S — no double toast (issue #212)', () => {
  it('shows only the editor toast, never the global one or the project Save dialog', async () => {
    const stub = installBridge([sampleServer({ id: 'a', name: 'Alpha' })])
    useMockMcpStore.setState({
      servers: [],
      projectId: null,
      stateByServer: {},
      logsByServer: {},
      drafts: {},
    })
    useWorkspaceStore.setState({ activeProjectId: 'p-1' })
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useTabsStore.getState().openTab({
      id: 'mockmcp-a',
      name: 'Alpha',
      protocol: 'mockMcpServer',
      mockMcpServerId: 'a',
    })
    await act(async () => {
      await useMockMcpStore.getState().loadServers('p-1')
    })
    render(
      <>
        <Shortcuts />
        <MockMcpServerEditor serverId="a" />
      </>,
    )
    fireEvent.change(screen.getByTestId('mock-mcp-name'), { target: { value: 'Renamed' } })
    pressCtrlS(screen.getByTestId('mock-mcp-name'))
    await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mock MCP server saved'))
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(saveActiveRequestInPlace).not.toHaveBeenCalled()
    expect(useUIStore.getState().showSaveModal).toBe(false)
    expect(useUIStore.getState().showEndpointSaveModal).toBe(false)
  })
})
