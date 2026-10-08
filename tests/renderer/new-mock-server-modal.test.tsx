/**
 * "New mock server" dialog + unified Mocks panel (issue #140).
 *
 * One creation flow for HTTP mocks and Mock MCP servers: the type switch
 * changes the preset list, the name follows the preset (unique in the
 * project), the port suggestion skips the ports of BOTH kinds, and Create
 * runs the right factory and opens the right editor tab. The panel shows both
 * groups with the same row and each group's "+" preselects its type.
 *
 * Fixture ports: HTTP 3001 + 3101, MCP 3100 + 3002 — so the HTTP suggestion
 * (from 3001) must skip an MCP port and the MCP one (from 3100) an HTTP port.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within, cleanup } from '@testing-library/react'
// Must come first: installs window.api.mock before mock.store captures it at import.
import { calls, httpBridge, httpServer, resetHttpBridge } from './mock-http-bridge-stub'
import { installBridge, sampleServer, type BridgeStub } from './mock-mcp-bridge-stub'
import NewMockServerModal from '../../src/renderer/components/mock/NewMockServerModal'
import MockServersPanel from '../../src/renderer/components/mock/MockServersPanel'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'

void React

let mcp: BridgeStub

const HTTP_SERVERS = [
  httpServer({ id: 'h1', name: 'Users API', port: 3001 }),
  httpServer({ id: 'h2', name: 'Legacy', port: 3101 }),
]

async function setup(opts: { failEndpointCreate?: string } = {}): Promise<void> {
  resetHttpBridge(HTTP_SERVERS, opts)
  mcp = installBridge([
    sampleServer({ id: 'a', name: 'Echo MCP', port: 3100 }),
    sampleServer({ id: 'b', name: 'Beta', port: 3002 }),
  ])
  useMockStore.setState({ servers: [], statusByServer: {}, errorByServer: {} })
  useMockMcpStore.setState({
    servers: [],
    projectId: null,
    stateByServer: {},
    logsByServer: {},
    drafts: {},
  })
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  await act(async () => {
    await useMockStore.getState().loadServers('p-1')
    await useMockMcpStore.getState().loadServers('p-1')
  })
  calls.length = 0
}

beforeEach(async () => {
  await setup()
})

afterEach(() => cleanup())

const nameValue = (): string => (screen.getByTestId('mock-new-name') as HTMLInputElement).value
const portValue = (): string => (screen.getByTestId('mock-new-port') as HTMLInputElement).value
const presetIds = (): (string | null)[] =>
  within(screen.getByTestId('mock-new-presets'))
    .getAllByRole('radio')
    .map((b) => b.getAttribute('data-testid'))

describe('New mock server dialog', () => {
  it('the type switch changes the preset list (HTTP → Blank, MCP → Echo by default)', () => {
    render(<NewMockServerModal initialKind="http" onClose={vi.fn()} />)
    expect(screen.getByTestId('mock-new-type-http')).toHaveAttribute('aria-checked', 'true')
    expect(presetIds()).toEqual([
      'mock-new-preset-blank',
      'mock-new-preset-rest',
      'mock-new-preset-echo',
      'mock-new-preset-auth',
      'mock-new-preset-faults',
    ])
    expect(screen.getByTestId('mock-new-preset-blank')).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByTestId('mock-new-type-mcp'))
    expect(screen.getByTestId('mock-new-type-mcp')).toHaveAttribute('aria-checked', 'true')
    expect(presetIds()).toEqual([
      'mock-new-preset-echo',
      'mock-new-preset-auth',
      'mock-new-preset-errors',
      'mock-new-preset-schemas',
      'mock-new-preset-slow',
    ])
    expect(screen.getByTestId('mock-new-preset-echo')).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByTestId('mock-new-preset-rest')).toBeNull()
  })

  it('the name prefills from the preset, unique across both kinds, until the user types', () => {
    render(<NewMockServerModal initialKind="http" onClose={vi.fn()} />)
    expect(nameValue()).toBe('Mock Server')
    fireEvent.click(screen.getByTestId('mock-new-preset-rest'))
    expect(nameValue()).toBe('Users API 2') // "Users API" is taken
    expect(screen.getByTestId('mock-new-preset-rest')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByTestId('mock-new-type-mcp'))
    expect(nameValue()).toBe('Echo MCP 2')
    fireEvent.click(screen.getByTestId('mock-new-preset-slow'))
    expect(nameValue()).toBe('Slow MCP')

    fireEvent.change(screen.getByTestId('mock-new-name'), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByTestId('mock-new-preset-errors'))
    expect(nameValue()).toBe('Mine')
  })

  it('the port suggestion skips the ports of HTTP AND MCP mocks; a taken port warns', () => {
    render(<NewMockServerModal initialKind="http" onClose={vi.fn()} />)
    expect(portValue()).toBe('3003') // 3001 HTTP, 3002 MCP
    fireEvent.click(screen.getByTestId('mock-new-type-mcp'))
    expect(portValue()).toBe('3102') // 3100 MCP, 3101 HTTP
    expect(screen.queryByTestId('mock-new-port-warning')).toBeNull()

    fireEvent.change(screen.getByTestId('mock-new-port'), { target: { value: '3001' } })
    expect(screen.getByTestId('mock-new-port-warning')).toHaveTextContent('3001')
  })

  it('Create (HTTP · REST example) replays the preset over IPC and opens the mockServer tab', async () => {
    const onClose = vi.fn()
    render(<NewMockServerModal initialKind="http" onClose={onClose} />)
    fireEvent.click(screen.getByTestId('mock-new-preset-rest'))
    fireEvent.click(screen.getByTestId('mock-new-create'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    expect(httpBridge.server.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p-1', name: 'Users API 2', port: 3003 }),
    )
    expect(calls.filter((c) => c.endsWith('.create'))).toEqual([
      'server.create',
      'endpoint.create',
      'response.create',
      'endpoint.create',
      'response.create',
      'response.create',
      'endpoint.create',
      'response.create',
      'endpoint.create',
      'response.create',
    ])
    expect(mcp.bridge.server.create).not.toHaveBeenCalled()

    const created = await httpBridge.server.create.mock.results[0].value
    const tabs = useTabsStore.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      id: `mock-${created.data.id}`,
      protocol: 'mockServer',
      name: 'Users API 2',
      mockServerId: created.data.id,
    })
    expect(useMockStore.getState().servers.map((s) => s.name)).toContain('Users API 2')
  })

  it('Create (MCP · Slow) goes through the MCP store and opens the mockMcpServer tab', async () => {
    const onClose = vi.fn()
    render(<NewMockServerModal initialKind="mcp" onClose={onClose} />)
    fireEvent.click(screen.getByTestId('mock-new-preset-slow'))
    fireEvent.click(screen.getByTestId('mock-new-create'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    const input = vi.mocked(mcp.bridge.server.create).mock.calls[0][0]
    expect(input).toMatchObject({ projectId: 'p-1', name: 'Slow MCP', port: 3102, latencyMs: 1500 })
    expect(httpBridge.server.create).not.toHaveBeenCalled()
    const tabs = useTabsStore.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ protocol: 'mockMcpServer', name: 'Slow MCP' })
    expect(tabs[0].mockMcpServerId).toBeTruthy()
  })

  it('submitting the form (Enter) creates with the typed name and port', async () => {
    const onClose = vi.fn()
    render(<NewMockServerModal initialKind="http" onClose={onClose} />)
    fireEvent.change(screen.getByTestId('mock-new-name'), { target: { value: 'Typed' } })
    fireEvent.change(screen.getByTestId('mock-new-port'), { target: { value: '4555' } })
    fireEvent.submit(screen.getByTestId('mock-new-name').closest('form')!)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(httpBridge.server.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Typed', port: 4555 }),
    )
    expect(calls.filter((c) => c.endsWith('.create'))).toEqual(['server.create']) // Blank
  })

  it('validates name and port before any IPC', async () => {
    render(<NewMockServerModal initialKind="http" onClose={vi.fn()} />)
    fireEvent.change(screen.getByTestId('mock-new-name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('mock-new-create'))
    expect(await screen.findByTestId('mock-new-error')).toHaveTextContent('Name is required.')

    fireEvent.change(screen.getByTestId('mock-new-name'), { target: { value: 'Ok' } })
    fireEvent.change(screen.getByTestId('mock-new-port'), { target: { value: '70000' } })
    fireEvent.click(screen.getByTestId('mock-new-create'))
    await waitFor(() =>
      expect(screen.getByTestId('mock-new-error')).toHaveTextContent('Port must be 1–65535.'),
    )
    expect(httpBridge.server.create).not.toHaveBeenCalled()
  })

  it('a failed preset step keeps the dialog open with the error and rolls the server back', async () => {
    await setup({ failEndpointCreate: 'boom' })
    const onClose = vi.fn()
    render(<NewMockServerModal initialKind="http" onClose={onClose} />)
    fireEvent.click(screen.getByTestId('mock-new-preset-echo'))
    fireEvent.click(screen.getByTestId('mock-new-create'))
    expect(await screen.findByTestId('mock-new-error')).toHaveTextContent('boom')
    expect(onClose).not.toHaveBeenCalled()
    expect(httpBridge.server.delete).toHaveBeenCalledTimes(1)
    expect(useTabsStore.getState().tabs).toHaveLength(0)
  })
})

describe('Mocks panel — both groups, one row design', () => {
  it('lists HTTP and MCP servers with the same row parts and per-group counts', async () => {
    render(<MockServersPanel />)
    const http = await screen.findByTestId('mock-http-row-h1')
    const mcpRow = await screen.findByTestId('mock-mcp-row-a')
    expect(within(http).getByText('HTTP')).toBeInTheDocument()
    expect(within(http).getByText('Users API')).toBeInTheDocument()
    expect(within(http).getByText('127.0.0.1:3001')).toBeInTheDocument()
    expect(within(mcpRow).getByText('MCP')).toBeInTheDocument()
    expect(within(mcpRow).getByText('http://127.0.0.1:3100/mcp')).toBeInTheDocument()
    for (const [row, prefix] of [
      [http, 'mock-http'],
      [mcpRow, 'mock-mcp'],
    ] as const) {
      expect(within(row).getByTestId(`${prefix}-row-status`)).toHaveTextContent('stopped')
      expect(within(row).getByTestId(`${prefix}-copy-url`)).toBeInTheDocument()
      expect(within(row).getByTestId(`${prefix}-start`)).toBeInTheDocument()
      expect(within(row).getByTestId(`${prefix}-delete`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('mock-http-section-title-count')).toHaveTextContent('2')
    expect(screen.getByTestId('mock-mcp-section-title-count')).toHaveTextContent('2')
  })

  it('the search filters both groups', async () => {
    render(<MockServersPanel />)
    await screen.findByTestId('mock-mcp-row-a')
    fireEvent.change(screen.getByTestId('mock-search'), { target: { value: 'users' } })
    expect(screen.getByTestId('mock-http-row-h1')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-http-row-h2')).toBeNull()
    expect(screen.queryByTestId('mock-mcp-row-a')).toBeNull()
    fireEvent.change(screen.getByTestId('mock-search'), { target: { value: 'echo' } })
    expect(screen.getByTestId('mock-mcp-row-a')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-mcp-row-b')).toBeNull()
    expect(screen.queryByTestId('mock-http-row-h1')).toBeNull()
  })

  it('header "+" and each group "+" open the dialog with the right type preselected', async () => {
    render(<MockServersPanel />)
    await screen.findByTestId('mock-mcp-row-a')
    const openWith = async (testId: string, kind: 'http' | 'mcp'): Promise<void> => {
      fireEvent.click(screen.getByTestId(testId))
      await screen.findByTestId('mock-new-dialog')
      expect(screen.getByTestId(`mock-new-type-${kind}`)).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(screen.getByTestId('mock-new-cancel'))
      await waitFor(() => expect(screen.queryByTestId('mock-new-dialog')).toBeNull())
    }
    await openWith('mock-group-add-mcp', 'mcp')
    await openWith('mock-group-add-http', 'http')
    await openWith('mock-new', 'http')
  })

  it('HTTP row: Start/Stop hit that server only; clicking the row opens its editor tab', async () => {
    render(<MockServersPanel />)
    const row = await screen.findByTestId('mock-http-row-h1')
    fireEvent.click(within(row).getByTestId('mock-http-start'))
    await waitFor(() => expect(httpBridge.server.start).toHaveBeenCalledWith('h1'))
    fireEvent.click(await within(row).findByTestId('mock-http-stop'))
    await waitFor(() => expect(httpBridge.server.stop).toHaveBeenCalledWith('h1'))
    expect(httpBridge.server.start).toHaveBeenCalledTimes(1)
    expect(useTabsStore.getState().tabs).toHaveLength(0)

    fireEvent.click(row)
    expect(useTabsStore.getState().tabs[0]).toMatchObject({
      id: 'mock-h1',
      protocol: 'mockServer',
      mockServerId: 'h1',
    })
  })

  it('HTTP row: Delete confirms in a dialog, deletes and closes the open editor tab', async () => {
    render(<MockServersPanel />)
    const row = await screen.findByTestId('mock-http-row-h1')
    fireEvent.click(row)
    expect(useTabsStore.getState().tabs).toHaveLength(1)
    fireEvent.click(within(row).getByTestId('mock-http-delete'))
    fireEvent.click(await screen.findByTestId('delete-confirm-btn'))
    await waitFor(() => expect(httpBridge.server.delete).toHaveBeenCalledWith('h1'))
    await waitFor(() => expect(screen.queryByTestId('mock-http-row-h1')).toBeNull())
    expect(useTabsStore.getState().tabs).toHaveLength(0)
  })
})
