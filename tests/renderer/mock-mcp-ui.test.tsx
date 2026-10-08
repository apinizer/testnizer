/**
 * Mock MCP UI (issue #140): the Mocks-panel section (list, start / stop, the
 * group "+" that opens the shared New mock server dialog) and the editor
 * (tabs, General / Scenarios form → `update` payload, Open in MCP tab)
 * against an in-memory `window.api.mockMcp` bridge.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within, cleanup } from '@testing-library/react'
import React from 'react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import MockMcpServersSection from '../../src/renderer/components/mock-mcp/MockMcpServersSection'
import MockMcpServerEditor from '../../src/renderer/components/mock-mcp/MockMcpServerEditor'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { installBridge, runningState, sampleServer, type BridgeStub } from './mock-mcp-bridge-stub'

let stub: BridgeStub

afterEach(() => cleanup())

beforeEach(() => {
  stub = installBridge([
    sampleServer({ id: 'a', name: 'Alpha' }),
    sampleServer({ id: 'b', name: 'Beta', port: 3101 }),
  ])
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

describe('Mocks panel — MCP section', () => {
  it('lists the project servers with the MCP badge and a status per row', async () => {
    render(<MockMcpServersSection query="" />)
    const rowA = await screen.findByTestId('mock-mcp-row-a')
    expect(screen.getByTestId('mock-mcp-row-b')).toBeInTheDocument()
    expect(within(rowA).getByText('MCP')).toBeInTheDocument()
    expect(within(rowA).getByText('Alpha')).toBeInTheDocument()
    expect(within(rowA).getByText('http://127.0.0.1:3100/mcp')).toBeInTheDocument()
    expect(stub.bridge.server.list).toHaveBeenCalledWith('p-1')
  })

  it('Start / Stop on a row call the IPC for THAT server only', async () => {
    render(<MockMcpServersSection query="" />)
    const rowB = await screen.findByTestId('mock-mcp-row-b')
    fireEvent.click(within(rowB).getByTestId('mock-mcp-start'))
    await waitFor(() => expect(stub.bridge.server.start).toHaveBeenCalledWith('b'))
    expect(stub.bridge.server.start).toHaveBeenCalledTimes(1)
    const stopBtn = await within(rowB).findByTestId('mock-mcp-stop')
    expect(
      within(screen.getByTestId('mock-mcp-row-a')).getByTestId('mock-mcp-start'),
    ).toBeInTheDocument()
    fireEvent.click(stopBtn)
    await waitFor(() => expect(stub.bridge.server.stop).toHaveBeenCalledWith('b'))
    // Opening the row is not triggered by the action buttons.
    expect(useTabsStore.getState().tabs).toHaveLength(0)
  })

  it('filters by the panel search query', async () => {
    render(<MockMcpServersSection query="bet" />)
    await screen.findByTestId('mock-mcp-row-b')
    expect(screen.queryByTestId('mock-mcp-row-a')).toBeNull()
  })

  it('the group "+" asks the panel to open the shared New mock server dialog', async () => {
    // Creation itself lives in the unified dialog (new-mock-server-modal.test.tsx);
    // the old inline "+ New" preset menu is gone.
    const onAdd = vi.fn()
    render(<MockMcpServersSection query="" onAdd={onAdd} />)
    await screen.findByTestId('mock-mcp-row-a')
    expect(screen.getByTestId('mock-mcp-section-title-count')).toHaveTextContent('2')
    fireEvent.click(screen.getByTestId('mock-group-add-mcp'))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('mock-mcp-new')).toBeNull()
    expect(stub.bridge.server.create).not.toHaveBeenCalled()
  })

  it('clicking a row opens (and re-focuses, never duplicates) its editor tab', async () => {
    render(<MockMcpServersSection query="" />)
    fireEvent.click(await screen.findByTestId('mock-mcp-row-a'))
    fireEvent.click(screen.getByTestId('mock-mcp-row-a'))
    const tabs = useTabsStore.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ protocol: 'mockMcpServer', mockMcpServerId: 'a' })
  })
})

async function renderEditor(id = 'a'): Promise<void> {
  await act(async () => {
    await useMockMcpStore.getState().loadServers('p-1')
  })
  render(<MockMcpServerEditor serverId={id} />)
}

describe('Mock MCP editor', () => {
  it('renders every tab with its testid and Save disabled until something changes', async () => {
    await renderEditor()
    expect(screen.getByTestId('mock-mcp-editor')).toBeInTheDocument()
    for (const id of ['general', 'scenarios', 'tools', 'resources', 'prompts', 'logs']) {
      expect(screen.getByTestId(`mock-mcp-tab-${id}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('mock-mcp-save')).toBeDisabled()
    fireEvent.click(screen.getByTestId('mock-mcp-tab-tools'))
    expect(screen.getByTestId('mock-mcp-tool-form')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mock-mcp-tab-logs'))
    expect(screen.getByTestId('mock-mcp-logs')).toBeInTheDocument()
  })

  it('General form → update(id, patch) with name, port, path, SSE and protocol pin', async () => {
    useTabsStore.getState().openTab({
      id: 'mockmcp-a',
      name: 'Alpha',
      protocol: 'mockMcpServer',
      mockMcpServerId: 'a',
    })
    await renderEditor()
    fireEvent.change(screen.getByTestId('mock-mcp-name'), { target: { value: 'Renamed' } })
    const port = screen.getByTestId('mock-mcp-port')
    fireEvent.focus(port)
    fireEvent.change(port, { target: { value: '4321' } })
    fireEvent.blur(port)
    fireEvent.change(screen.getByTestId('mock-mcp-path'), { target: { value: '/rpc' } })
    fireEvent.click(screen.getByTestId('mock-mcp-legacy-sse'))
    fireEvent.change(screen.getByTestId('mock-mcp-protocol-pin'), {
      target: { value: '2025-03-26' },
    })
    expect(screen.getByTestId('mock-mcp-unsaved')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mock-mcp-save'))
    await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
    const [id, patch] = vi.mocked(stub.bridge.server.update).mock.calls[0]
    expect(id).toBe('a')
    expect(patch).toMatchObject({
      name: 'Renamed',
      port: 4321,
      path: '/rpc',
      legacySse: true,
      protocolPin: '2025-03-26',
    })
    expect(patch.tools?.[0]).toMatchObject({ name: 'echo', inputSchema: { type: 'object' } })
    // Saved → the draft is gone and Save is disabled again.
    await waitFor(() => expect(screen.getByTestId('mock-mcp-save')).toBeDisabled())
    expect(useMockMcpStore.getState().drafts.a).toBeUndefined()
    // The rename reaches the Workbench tab strip.
    expect(useTabsStore.getState().tabs.find((x) => x.id === 'mockmcp-a')?.name).toBe('Renamed')
  })

  it('Scenarios form → bearer auth, latency and a JSON-RPC error mode in the patch', async () => {
    await renderEditor()
    fireEvent.click(screen.getByTestId('mock-mcp-tab-scenarios'))
    fireEvent.change(screen.getByTestId('mock-mcp-auth-mode'), { target: { value: 'bearer' } })
    const token = (screen.getByTestId('mock-mcp-bearer-token') as HTMLInputElement).value
    expect(token).toMatch(/^mcp_/) // generated on switch
    const latency = screen.getByTestId('mock-mcp-latency')
    fireEvent.focus(latency)
    fireEvent.change(latency, { target: { value: '750' } })
    fireEvent.blur(latency)
    fireEvent.change(screen.getByTestId('mock-mcp-error-kind'), { target: { value: 'jsonrpc' } })
    const code = screen.getByTestId('mock-mcp-error-code')
    fireEvent.focus(code)
    fireEvent.change(code, { target: { value: '-32001' } })
    fireEvent.blur(code)
    fireEvent.change(screen.getByTestId('mock-mcp-error-message'), { target: { value: 'nope' } })
    // Ctrl+S inside the editor saves (instead of the global project-save chord).
    fireEvent.keyDown(screen.getByTestId('mock-mcp-editor'), { key: 's', ctrlKey: true })
    await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
    const patch = vi.mocked(stub.bridge.server.update).mock.calls[0][1]
    expect(patch).toMatchObject({
      authMode: 'bearer',
      bearerToken: token,
      latencyMs: 750,
      errorMode: { kind: 'jsonrpc', code: -32001, message: 'nope' },
    })
  })

  it('shows the backend validation message and keeps the draft when Save fails', async () => {
    await renderEditor()
    vi.mocked(stub.bridge.server.update).mockResolvedValueOnce({
      success: false,
      error: 'Path must not be under /.well-known',
    })
    fireEvent.change(screen.getByTestId('mock-mcp-path'), {
      target: { value: '/.well-known/x' },
    })
    fireEvent.click(screen.getByTestId('mock-mcp-save'))
    expect(await screen.findByTestId('mock-mcp-save-error')).toHaveTextContent(
      'Path must not be under /.well-known',
    )
    expect(useMockMcpStore.getState().drafts.a?.path).toBe('/.well-known/x')
  })

  it('an unsaved draft survives the editor unmounting (tab switch)', async () => {
    await act(async () => {
      await useMockMcpStore.getState().loadServers('p-1')
    })
    const first = render(<MockMcpServerEditor serverId="a" />)
    fireEvent.change(screen.getByTestId('mock-mcp-name'), { target: { value: 'Kept' } })
    first.unmount() // the Workbench unmounts the editor when another tab is activated
    render(<MockMcpServerEditor serverId="a" />)
    expect((screen.getByTestId('mock-mcp-name') as HTMLInputElement).value).toBe('Kept')
    expect(screen.getByTestId('mock-mcp-unsaved')).toBeInTheDocument()
    expect(screen.getByTestId('mock-mcp-save')).toBeEnabled()
  })

  it('Ctrl+S inside the Delay field saves the number still being typed', async () => {
    await renderEditor()
    fireEvent.click(screen.getByTestId('mock-mcp-tab-tools'))
    const delay = screen.getByTestId('mock-mcp-tool-delay')
    delay.focus()
    fireEvent.change(delay, { target: { value: '250' } })
    // No blur / Enter: the field still holds the text uncommitted.
    fireEvent.keyDown(delay, { key: 's', ctrlKey: true })
    await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
    const patch = vi.mocked(stub.bridge.server.update).mock.calls[0][1]
    expect(patch.tools?.[0]).toMatchObject({ name: 'echo', delayMs: 250 })
    await waitFor(() => expect(useMockMcpStore.getState().drafts.a).toBeUndefined())
  })

  it('Ctrl+S inside an out-of-range Port field saves what the field then shows', async () => {
    await renderEditor()
    const port = screen.getByTestId('mock-mcp-port') as HTMLInputElement
    port.focus()
    fireEvent.change(port, { target: { value: '99999' } })
    fireEvent.keyDown(port, { key: 's', metaKey: true })
    await waitFor(() => expect(stub.bridge.server.update).toHaveBeenCalledTimes(1))
    // Clamped like blur / Enter clamp it — never the stale old port.
    expect(vi.mocked(stub.bridge.server.update).mock.calls[0][1]).toMatchObject({ port: 65535 })
    expect(port.value).toBe('65535')
  })

  it('a double Ctrl+S sends ONE update', async () => {
    await renderEditor()
    fireEvent.change(screen.getByTestId('mock-mcp-name'), { target: { value: 'Once' } })
    const editor = screen.getByTestId('mock-mcp-editor')
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true })
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true })
    await waitFor(() => expect(useMockMcpStore.getState().drafts.a).toBeUndefined())
    expect(stub.bridge.server.update).toHaveBeenCalledTimes(1)
  })

  it('an unsaved draft marks the editor tab dirty; Save and Discard clear it', async () => {
    useTabsStore.getState().openTab({
      id: 'mockmcp-a',
      name: 'Alpha',
      protocol: 'mockMcpServer',
      mockMcpServerId: 'a',
    })
    const isDirty = () => useTabsStore.getState().tabs.find((x) => x.id === 'mockmcp-a')?.isDirty
    await renderEditor()
    expect(isDirty()).toBeFalsy()
    fireEvent.change(screen.getByTestId('mock-mcp-name'), { target: { value: 'Edited' } })
    expect(isDirty()).toBe(true)
    fireEvent.click(screen.getByTestId('mock-mcp-save'))
    await waitFor(() => expect(isDirty()).toBe(false))

    fireEvent.change(screen.getByTestId('mock-mcp-name'), { target: { value: 'Again' } })
    expect(isDirty()).toBe(true)
    fireEvent.click(screen.getByTestId('mock-mcp-discard'))
    expect(isDirty()).toBe(false)
  })

  it('Open in MCP tab → new MCP tab with transport http, the live URL and Bearer on the Authorization tab', async () => {
    stub = installBridge([sampleServer({ id: 'a', authMode: 'bearer', bearerToken: 'tok123' })])
    vi.mocked(stub.bridge.server.status).mockResolvedValue({
      success: true,
      data: runningState('a', 4555),
    })
    await renderEditor()
    expect(screen.getByTestId('mock-mcp-url')).toHaveTextContent('http://127.0.0.1:4555/mcp')
    fireEvent.click(screen.getByTestId('mock-mcp-open-in-mcp'))
    const { tabs, activeTabId } = useTabsStore.getState()
    const mcpTab = tabs.find((t) => t.id === activeTabId)
    expect(mcpTab?.protocol).toBe('mcp')
    const mcp = useMcpStore.getState()
    expect(mcp._currentTabId).toBe(activeTabId)
    expect(mcp.transport).toBe('http')
    expect(mcp.url).toBe('http://127.0.0.1:4555/mcp')
    // MCP Auth: the token goes to the Authorization tab, which is selected —
    // no raw `Authorization` header row any more.
    expect(mcp.auth).toEqual({ type: 'bearer', bearer: { token: 'tok123' } })
    expect(mcp.configTab).toBe('auth')
    expect(mcp.configCollapsed).toBe(false)
    expect(mcp.customHeaders.some((h) => h.key === 'Authorization')).toBe(false)
    expect(mcpTab?.isDirty).toBe(false)
  })
})
