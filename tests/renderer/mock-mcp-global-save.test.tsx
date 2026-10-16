/**
 * Issue #210 follow-up — Ctrl+S on a Mock MCP server tab while focus was
 * OUTSIDE the editor (e.g. after clicking the Workbench tab strip) reached
 * only the global shortcut, which treated the non-request tab as "nothing to
 * save in place" and opened the project Save dialog. The global handler now
 * hands the chord to the editor's own save (same blank-default warning, same
 * single `saveMockMcpDraft` path), and no non-request tab opens a Save dialog.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

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
import MockMcpServerEditor from '../../src/renderer/components/mock-mcp/MockMcpServerEditor'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import type { Tab } from '../../src/renderer/types'
import { installBridge, sampleServer, type BridgeStub } from './mock-mcp-bridge-stub'

function Shortcuts(): null {
  useKeyboardShortcuts()
  return null
}

function pressCtrlS(target: Window | Element = window): void {
  fireEvent.keyDown(target, { key: 's', ctrlKey: true })
}

let stub: BridgeStub

beforeEach(() => {
  vi.mocked(toast.success).mockClear()
  vi.mocked(saveActiveRequestInPlace).mockReset()
  useUIStore.setState({ showSaveModal: false, showEndpointSaveModal: false })
  stub = installBridge([sampleServer({ id: 'a', name: 'Alpha' })])
  useMockMcpStore.setState({
    servers: [],
    projectId: null,
    stateByServer: {},
    logsByServer: {},
    drafts: {},
  })
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
  useTabsStore.setState({ tabs: [], activeTabId: null })
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

async function renderMockMcpTab(activeServerId = 'a'): Promise<void> {
  useTabsStore.getState().openTab({
    id: `mockmcp-${activeServerId}`,
    name: 'Alpha',
    protocol: 'mockMcpServer',
    mockMcpServerId: activeServerId,
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
}

function expectNoSaveDialog(): void {
  expect(useUIStore.getState().showSaveModal).toBe(false)
  expect(useUIStore.getState().showEndpointSaveModal).toBe(false)
  expect(saveActiveRequestInPlace).not.toHaveBeenCalled()
}

describe('Ctrl+S with focus outside the Mock MCP editor (issue #210)', () => {
  it('saves the mock — no project / endpoint Save dialog', async () => {
    await renderMockMcpTab()
    fireEvent.change(screen.getByTestId('mock-mcp-name'), { target: { value: 'Renamed' } })
    ;(document.activeElement as HTMLElement | null)?.blur()
    pressCtrlS(document.body)
    await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mock MCP server saved'))
    expectNoSaveDialog()
  })

  it('an untouched "Add" default opens the same warning as the editor save', async () => {
    await renderMockMcpTab()
    fireEvent.click(screen.getByTestId('mock-mcp-tab-tools'))
    fireEvent.click(screen.getByTestId('mock-mcp-tool-add'))
    pressCtrlS()
    const dialog = await screen.findByTestId('mock-mcp-blank-dialog')
    expect(within(dialog).getByTestId('mock-mcp-blank-list')).toHaveTextContent('new_tool')
    expect(stub.bridge.server.update).not.toHaveBeenCalled()
    expectNoSaveDialog()

    fireEvent.click(within(dialog).getByTestId('mock-mcp-blank-save'))
    await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
  })

  it('Ctrl+S inside the editor still saves exactly once', async () => {
    await renderMockMcpTab()
    fireEvent.change(screen.getByTestId('mock-mcp-name'), { target: { value: 'Renamed' } })
    pressCtrlS(screen.getByTestId('mock-mcp-name'))
    await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
    // Give a stray second save (global handler on top) a chance to land.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(stub.bridge.server.update).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledTimes(1)
    expectNoSaveDialog()
  })

  it("another server's editor ignores the chord", async () => {
    await renderMockMcpTab('b')
    fireEvent.change(screen.getByTestId('mock-mcp-name'), { target: { value: 'Renamed' } })
    pressCtrlS()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(stub.bridge.server.update).not.toHaveBeenCalled()
    expectNoSaveDialog()
  })
})

describe('Ctrl+S on other non-request tabs never opens a Save dialog', () => {
  function activate(tab: Partial<Tab>): void {
    useTabsStore.setState({
      tabs: [{ id: 'tab-1', name: 'X', method: 'GET', url: '', ...tab } as Tab],
      activeTabId: 'tab-1',
    })
  }

  it.each([
    ['mockServer', { protocol: 'mockServer', mockServerId: 'm-1' }],
    ['runner', { protocol: 'runner' }],
    ['example', { protocol: 'example', savedResponseId: 'ex-1' }],
  ] as const)('%s tab: Ctrl+S is swallowed', (_name, tab) => {
    activate(tab as Partial<Tab>)
    render(<Shortcuts />)
    pressCtrlS()
    expectNoSaveDialog()
  })

  it('a Tools tab keeps the documented project-save fallback', () => {
    activate({ protocol: 'tools.jwt' })
    render(<Shortcuts />)
    pressCtrlS()
    expect(useUIStore.getState().showSaveModal).toBe(true)
    expect(useUIStore.getState().showEndpointSaveModal).toBe(false)
  })
})
