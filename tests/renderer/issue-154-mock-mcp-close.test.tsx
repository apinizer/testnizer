/**
 * Issue #154 — closing a dirty Mock MCP editor tab.
 *
 * The unsaved-changes dialog's Save went through `saveActiveRequestInPlace`,
 * which reports Mock MCP tabs as not applicable → Save did nothing (and the
 * tab stayed open). "Close anyway" closed the tab but kept the in-memory
 * draft, so reopening showed the discarded edits again. And the dirty flag is
 * persisted with the tab while drafts are not, so after a restart a mock MCP
 * tab showed the dirty dot with nothing to save.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { serverToDraft } from '../../src/renderer/components/mock-mcp/mock-mcp-draft'
import { blankElicitRow } from '../../src/renderer/components/mock-mcp/mock-mcp-elicit'
import { cleanupTabState } from '../../src/renderer/lib/cleanup-tab-state'
import type { Tab } from '../../src/renderer/types'
import { installBridge, sampleServer, type BridgeStub } from './mock-mcp-bridge-stub'

vi.mock('../../src/renderer/lib/activate-tab', () => ({
  activateTabStores: vi.fn(),
  switchActiveTab: vi.fn(),
}))
vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))

/** Every other `window.api` namespace answers `{ success: true, data: [] }`. */
const permissive: unknown = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
)
function installApi(): BridgeStub {
  const stub = installBridge([sampleServer({ id: 'a', name: 'Alpha' })])
  const real = (window as unknown as { api: Record<string, unknown> }).api
  ;(window as unknown as { api: unknown }).api = new Proxy(real, {
    get: (t, k) => (k in t ? t[k as string] : (permissive as Record<string, unknown>)[k as string]),
  })
  return stub
}
installApi()

const Workbench = (await import('../../src/renderer/components/layout/Workbench')).default

const HTTP_TAB = {
  id: 'http-1',
  name: 'Request',
  protocol: 'http',
  method: 'GET',
  url: '',
  isDirty: false,
  isLoading: false,
} as Tab

function mockTab(dirty: boolean): Tab {
  return {
    id: 'mockmcp-a',
    name: 'Alpha',
    protocol: 'mockMcpServer',
    mockMcpServerId: 'a',
    isDirty: dirty,
    isLoading: false,
    isPreview: false,
  } as Tab
}

let stub: BridgeStub

beforeEach(() => {
  stub = installApi()
  const server = sampleServer({ id: 'a', name: 'Alpha' })
  useMockMcpStore.setState({
    servers: [server],
    projectId: 'p-1',
    stateByServer: {},
    logsByServer: {},
    drafts: { a: { ...serverToDraft(server), name: 'Alpha renamed' } },
  })
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
  // The mock MCP tab sits in the background; the user hits its ×.
  useTabsStore.setState({ tabs: [HTTP_TAB, mockTab(true)], activeTabId: HTTP_TAB.id })
})
afterEach(cleanup)

function closeMockTab(): void {
  const tab = screen
    .getAllByTestId('endpoint-tab')
    .find((el) => el.getAttribute('data-tab-name') === 'Alpha')
  if (!tab) throw new Error('mock MCP tab not rendered')
  fireEvent.click(within(tab).getByTestId('tab-close'))
}

describe('the unsaved-changes dialog on a Mock MCP tab', () => {
  it('Save saves the draft through the editor path, then closes the tab', async () => {
    render(<Workbench />)
    closeMockTab()
    fireEvent.click(await screen.findByTestId('unsaved-save-btn'))
    await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
    expect(vi.mocked(stub.bridge.server.update).mock.calls[0][0]).toBe('a')
    expect(vi.mocked(stub.bridge.server.update).mock.calls[0][1]).toMatchObject({
      name: 'Alpha renamed',
    })
    await waitFor(() =>
      expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([HTTP_TAB.id]),
    )
    expect(useMockMcpStore.getState().drafts.a).toBeUndefined()
    expect(useMockMcpStore.getState().servers[0].name).toBe('Alpha renamed')
  })

  it('a draft the backend cannot take keeps the dialog and the tab', async () => {
    const draft = useMockMcpStore.getState().drafts.a
    const tool = { ...draft.tools[0], elicit: undefined }
    // Two elicitation fields with one name: rejected before any IPC.
    useMockMcpStore.setState({
      drafts: {
        a: {
          ...draft,
          tools: [
            {
              ...tool,
              elicit: {
                key: 'k',
                message: 'm',
                responseTemplate: '',
                fields: [blankElicitRow('x'), blankElicitRow('x')],
              },
            },
          ],
        },
      },
    })
    render(<Workbench />)
    closeMockTab()
    fireEvent.click(await screen.findByTestId('unsaved-save-btn'))
    await waitFor(() => expect(screen.getByTestId('unsaved-save-btn')).not.toBeDisabled())
    expect(stub.bridge.server.update).not.toHaveBeenCalled()
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toContain('mockmcp-a')
    expect(useMockMcpStore.getState().drafts.a).toBeDefined()
  })

  it('Close anyway discards the draft', async () => {
    render(<Workbench />)
    closeMockTab()
    fireEvent.click(await screen.findByTestId('unsaved-discard-btn'))
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual([HTTP_TAB.id])
    expect(useMockMcpStore.getState().drafts.a).toBeUndefined()
    expect(stub.bridge.server.update).not.toHaveBeenCalled()
  })

  it('every close path (cleanupTabState) drops the draft of the closed tab only', () => {
    const other = useMockMcpStore.getState().drafts.a
    useMockMcpStore.setState({ drafts: { a: other, b: other } })
    cleanupTabState('mockmcp-a')
    expect(Object.keys(useMockMcpStore.getState().drafts)).toEqual(['b'])
  })
})

describe('the persisted dirty flag of Mock MCP tabs', () => {
  it('a restored mock MCP tab is clean (drafts are never persisted); others keep theirs', async () => {
    window.localStorage.setItem(
      'testnizer-tabs',
      JSON.stringify({
        tabs: [{ ...HTTP_TAB, isDirty: true }, mockTab(true)],
        activeTabId: HTTP_TAB.id,
      }),
    )
    vi.resetModules()
    const fresh = await import('../../src/renderer/stores/tabs.store')
    const tabs = fresh.useTabsStore.getState().tabs
    expect(tabs.find((t) => t.id === 'mockmcp-a')?.isDirty).toBe(false)
    expect(tabs.find((t) => t.id === HTTP_TAB.id)?.isDirty).toBe(true)
    window.localStorage.removeItem('testnizer-tabs')
  })

  it('a project tab snapshot keeps the dot only while the draft exists', () => {
    useTabsStore.getState().replaceAllTabs([mockTab(true)], 'mockmcp-a')
    expect(useTabsStore.getState().tabs[0].isDirty).toBe(true)
    useMockMcpStore.setState({ drafts: {} })
    useTabsStore.getState().replaceAllTabs([mockTab(true)], 'mockmcp-a')
    expect(useTabsStore.getState().tabs[0].isDirty).toBe(false)
  })
})
