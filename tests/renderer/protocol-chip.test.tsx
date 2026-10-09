/**
 * Issue #173 — non-HTTP rows and tabs show a short protocol chip (MCP, WS,
 * SSE, SIO, GQL, gRPC) instead of the fake GET/POST method badge they were
 * created with (`TreeView` stamps `method:'GET'` on a new MCP row). HTTP and
 * SOAP keep their method badges; the tree search is unaffected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { Tab, TreeNode as TreeNodeType } from '../../src/renderer/types'

vi.mock('../../src/renderer/lib/activate-tab', () => ({
  activateTabStores: vi.fn(),
  switchActiveTab: vi.fn(),
}))
vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))

const rows = vi.hoisted(() => ({
  endpoints: [] as Array<Record<string, unknown>>,
  saved: [] as Array<Record<string, unknown>>,
}))

const anyApi: unknown = new Proxy(
  {
    folder: { list: async () => ({ success: true, data: [] }) },
    endpoint: { listByProject: async () => ({ success: true, data: rows.endpoints }) },
    savedRequest: { list: async () => ({ success: true, data: rows.saved }) },
    savedResponse: { listByProject: async () => ({ success: true, data: [] }) },
  } as Record<string, unknown>,
  {
    get: (target, key: string) =>
      target[key] ?? new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }),
  },
)
;(window as unknown as { api: unknown }).api = anyApi

const { default: ProtocolChip } = await import('../../src/renderer/components/shared/ProtocolChip')
const { protocolChipLabel } = await import('../../src/renderer/lib/protocol-chip')
const { default: TreeNode } = await import('../../src/renderer/components/sidebar/TreeNode')
const { EndpointTabBar } = await import('../../src/renderer/components/layout/Workbench')
const { useTabsStore } = await import('../../src/renderer/stores/tabs.store')
const { useWorkspaceStore } = await import('../../src/renderer/stores/workspace.store')
const { useBranchStore } = await import('../../src/renderer/stores/branch.store')

afterEach(() => cleanup())

describe('ProtocolChip', () => {
  it.each([
    ['mcp', 'MCP'],
    ['websocket', 'WS'],
    ['sse', 'SSE'],
    ['socketio', 'SIO'],
    ['graphql', 'GQL'],
    ['grpc', 'gRPC'],
  ])('%s → %s', (protocol, label) => {
    expect(protocolChipLabel(protocol)).toBe(label)
    render(<ProtocolChip protocol={protocol} />)
    const chip = screen.getByTestId('protocol-chip')
    expect(chip).toHaveTextContent(label)
    expect(chip).toHaveAttribute('data-protocol', protocol)
    // Colour comes from a globals.css token, never an inline hex.
    expect(chip.outerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
  })

  it.each(['http', 'soap', undefined, 'example'])('%s → no chip', (protocol) => {
    expect(protocolChipLabel(protocol)).toBeNull()
    const { container } = render(<ProtocolChip protocol={protocol} />)
    expect(container.firstChild).toBeNull()
  })
})

function renderNode(node: TreeNodeType) {
  return render(
    <TreeNode
      node={node}
      depth={0}
      activeId={null}
      openIds={new Set()}
      onToggle={() => {}}
      onSelect={() => {}}
    />,
  )
}

describe('tree rows', () => {
  it('an MCP row created with method GET shows the MCP chip, not a GET badge', () => {
    renderNode({ id: 'm1', type: 'request', label: 'Weather', method: 'GET', protocol: 'mcp' })
    const row = screen.getByTestId('tree-node')
    expect(within(row).getByTestId('protocol-chip')).toHaveTextContent('MCP')
    expect(row).not.toHaveTextContent('GET')
  })

  it('HTTP and SOAP rows keep their method badge', () => {
    renderNode({ id: 'h1', type: 'request', label: 'List', method: 'GET', protocol: 'http' })
    renderNode({ id: 's1', type: 'endpoint', label: 'Op', method: 'POST', protocol: 'soap' })
    const rowsEls = screen.getAllByTestId('tree-node')
    expect(rowsEls[0]).toHaveTextContent('GET')
    expect(rowsEls[1]).toHaveTextContent('POST')
    expect(screen.queryByTestId('protocol-chip')).toBeNull()
  })

  it('a row without a protocol (older data) keeps the method badge', () => {
    renderNode({ id: 'o1', type: 'request', label: 'Old', method: 'PUT' })
    expect(screen.getByTestId('tree-node')).toHaveTextContent('PUT')
  })
})

describe('buildTreeFromDB carries the protocol onto rows', () => {
  beforeEach(() => {
    useBranchStore.setState({ getActiveBranchScope: () => null } as never)
    useWorkspaceStore.setState({
      treeData: [],
      openNodeIds: new Set<string>(),
      searchQuery: '',
      activeProjectId: 'proj-1',
      projects: [{ id: 'proj-1', name: 'Proj' } as never],
    })
    rows.endpoints = [
      { id: 'ep1', name: 'Op', method: 'POST', path: '/x', folder_id: null, protocol: 'soap' },
    ]
    rows.saved = [
      { id: 'sr1', name: 'Weather', method: 'GET', url: '', folder_id: null, protocol: 'mcp' },
      { id: 'sr2', name: 'Chat', method: 'GET', url: '', folder_id: null, protocol: 'websocket' },
    ]
  })

  it('saved requests and endpoints keep their protocol', async () => {
    await useWorkspaceStore.getState().refreshTree()
    const root = useWorkspaceStore.getState().treeData[0]
    const byId = Object.fromEntries((root.children ?? []).map((n) => [n.id, n]))
    expect(byId.sr1.protocol).toBe('mcp')
    expect(byId.sr2.protocol).toBe('websocket')
    expect(byId.ep1.protocol).toBe('soap')
    // The stored method stays — request walkers key on it.
    expect(byId.sr1.method).toBe('GET')
  })
})

describe('tab strip', () => {
  function tab(id: string, protocol: string, method?: string): Tab {
    return { id, name: id, protocol, method, url: '', isDirty: false, isLoading: false } as Tab
  }

  it('MCP / WS / SSE / Socket.IO / GraphQL / gRPC tabs show their chip; HTTP + SOAP keep the method', () => {
    useTabsStore.setState({
      tabs: [
        tab('t-mcp', 'mcp', 'GET'),
        tab('t-ws', 'websocket', 'GET'),
        tab('t-sse', 'sse', 'GET'),
        tab('t-sio', 'socketio', 'GET'),
        tab('t-gql', 'graphql', 'POST'),
        tab('t-grpc', 'grpc', 'POST'),
        tab('t-http', 'http', 'DELETE'),
        tab('t-soap', 'soap', 'POST'),
        tab('t-ai', 'ai', 'POST'),
      ],
      activeTabId: 't-mcp',
    })
    render(<EndpointTabBar />)
    const tabs = screen.getAllByTestId('endpoint-tab')
    const chipOf = (i: number) => within(tabs[i]).queryByTestId('protocol-chip')?.textContent
    expect([0, 1, 2, 3, 4, 5].map(chipOf)).toEqual(['MCP', 'WS', 'SSE', 'SIO', 'GQL', 'gRPC'])
    expect(chipOf(6)).toBeUndefined()
    expect(tabs[6]).toHaveTextContent('DELETE')
    expect(chipOf(7)).toBeUndefined()
    expect(tabs[7]).toHaveTextContent('POST')
    // AI chat tabs are out of scope: no chip, no fake method.
    expect(chipOf(8)).toBeUndefined()
    expect(tabs[8]).not.toHaveTextContent('POST')
  })
})
