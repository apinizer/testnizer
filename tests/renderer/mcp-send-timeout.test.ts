/**
 * Issue #185 — MCP Send passes the tab's timeout to main. Before, the store
 * sent only `callId`, so every Send ran on the SDK's implicit 60 s while Run
 * used 120 s. Now each call carries `timeoutMs`: the tab's own value (0 = no
 * limit) or the shared `MCP_DEFAULT_TIMEOUT_MS` that Run uses too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { MCP_DEFAULT_TIMEOUT_MS } from '../../src/shared/request-settings'
import type { Tab } from '../../src/renderer/types'

const done = { success: true, data: { content: [] }, timing: { durationMs: 1, sizeBytes: 2 } }

function installApi() {
  const mcp = {
    connect: vi.fn(async () => ({
      success: true,
      data: { connectionId: 'conn-185', transport: 'http', url: 'http://x/mcp' },
    })),
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    listTools: vi.fn(async () => ({
      success: true,
      data: [{ name: 'echo', inputSchema: { type: 'object', properties: {} } }],
    })),
    listResources: vi.fn(async () => ({
      success: true,
      data: { resources: [{ uri: 'test://a', name: 'a' }], templates: [] },
    })),
    listPrompts: vi.fn(async () => ({ success: true, data: [{ name: 'greet' }] })),
    callTool: vi.fn(async () => done),
    readResource: vi.fn(async () => ({ ...done, data: { contents: [] } })),
    getPrompt: vi.fn(async () => ({ ...done, data: { messages: [] } })),
    cancelCall: vi.fn(async () => ({ success: true, data: { cancelled: false } })),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return mcp
}

let api: ReturnType<typeof installApi>

async function connectTab(id: string): Promise<void> {
  useTabsStore.setState({
    tabs: [{ id, name: id, protocol: 'mcp', isDirty: false } as Tab],
    activeTabId: id,
  })
  useMcpStore.getState().switchToTab(id)
  useMcpStore.setState({ url: 'http://x/mcp', transport: 'http' })
  await useMcpStore.getState().connect()
}

/** The ctx / opts argument of the last call to `fn`. */
function lastCtx(fn: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const call = fn.mock.calls[fn.mock.calls.length - 1]
  return call[call.length - 1] as Record<string, unknown>
}

beforeEach(() => {
  api = installApi()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
})

describe('issue #185 — MCP Send passes the timeout', () => {
  it('no timeout set → the shared default (120 s), never left to the SDK', async () => {
    await connectTab('t1')
    useMcpStore.setState({ selectedTool: 'echo', toolArgs: '{}' })
    await useMcpStore.getState().callTool({ force: true })
    expect(api.callTool).toHaveBeenCalledTimes(1)
    expect(lastCtx(api.callTool).timeoutMs).toBe(MCP_DEFAULT_TIMEOUT_MS)
    expect(MCP_DEFAULT_TIMEOUT_MS).toBe(120_000)
  })

  it('the tab timeout goes with tools/call, resources/read and prompts/get', async () => {
    await connectTab('t2')
    useMcpStore.getState().setRequestTimeout(4321)
    useMcpStore.setState({ selectedTool: 'echo', toolArgs: '{}' })
    await useMcpStore.getState().callTool({ force: true })
    expect(lastCtx(api.callTool).timeoutMs).toBe(4321)

    useMcpStore.setState({ resourceUriDraft: 'test://a', selectedResourceUri: 'test://a' })
    await useMcpStore.getState().readResource()
    expect(lastCtx(api.readResource).timeoutMs).toBe(4321)

    useMcpStore.setState({ selectedPrompt: 'greet', promptArgs: {} })
    await useMcpStore.getState().getPrompt()
    expect(lastCtx(api.getPrompt).timeoutMs).toBe(4321)
  })

  it('0 = no limit is sent as 0 (main maps it to the largest timer)', async () => {
    await connectTab('t3')
    useMcpStore.getState().setRequestTimeout(0)
    useMcpStore.setState({ selectedTool: 'echo', toolArgs: '{}' })
    await useMcpStore.getState().callTool({ force: true })
    expect(lastCtx(api.callTool).timeoutMs).toBe(0)
  })

  it('a negative / non-finite value collapses to the default', async () => {
    await connectTab('t4')
    useMcpStore.getState().setRequestTimeout(-5)
    expect(useMcpStore.getState().requestTimeout).toBeNull()
    useMcpStore.getState().setRequestTimeout(Number.NaN)
    expect(useMcpStore.getState().requestTimeout).toBeNull()
  })
})
