/**
 * The MCP call lifecycle on a client tab:
 *  - #163 Cancel: every call carries a renderer `callId`; while it runs the
 *    Invoke / Read / Get button turns into Cancel → `mcp.cancelCall`. A
 *    cancelled call shows "Cancelled" (not an error), the connection stays,
 *    and a cancel in tab A never touches tab B (issue #76 class).
 *  - #164 Result header: OK / Tool error / Cancelled pill, `NNN ms`, size
 *    (HTTP's KB format) and Copy.
 *  - #175 Decline vs Cancel: after the user declines / cancels an input card
 *    a one-line note says so above the result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import McpToolPane from '../../src/renderer/components/protocols/mcp/McpToolPane'
import McpResourcePane from '../../src/renderer/components/protocols/mcp/McpResourcePane'
import McpPromptPane from '../../src/renderer/components/protocols/mcp/McpPromptPane'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

type Reply = {
  success: boolean
  data?: unknown
  error?: string
  cancelled?: boolean
  timing?: { durationMs: number; sizeBytes: number }
}

function installApi() {
  const pending: Deferred<Reply>[] = []
  let nextConn = 0
  const mcp = {
    connect: vi.fn(async () => ({
      success: true,
      data: { connectionId: `conn-${++nextConn}`, transport: 'http', url: 'http://x/mcp' },
    })),
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    listTools: vi.fn(async () => ({
      success: true,
      data: [{ name: 'slow', inputSchema: { type: 'object', properties: {} } }],
    })),
    listResources: vi.fn(async () => ({
      success: true,
      data: { resources: [{ uri: 'test://a', name: 'a' }], templates: [] },
    })),
    listPrompts: vi.fn(async () => ({ success: true, data: [{ name: 'greet' }] })),
    callTool: vi.fn(() => {
      const d = deferred<Reply>()
      pending.push(d)
      return d.promise
    }),
    respondInput: vi.fn(() => {
      const d = deferred<Reply>()
      pending.push(d)
      return d.promise
    }),
    readResource: vi.fn(() => {
      const d = deferred<Reply>()
      pending.push(d)
      return d.promise
    }),
    getPrompt: vi.fn(() => {
      const d = deferred<Reply>()
      pending.push(d)
      return d.promise
    }),
    cancelCall: vi.fn(async () => ({ success: true, data: { cancelled: true } })),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return { mcp, pending }
}

let api: ReturnType<typeof installApi>

async function connectTab(id: string): Promise<void> {
  useTabsStore.setState({
    tabs: [
      ...useTabsStore.getState().tabs.filter((t) => t.id !== id),
      { id, name: id, protocol: 'mcp', isDirty: false } as never,
    ],
    activeTabId: id,
  })
  useMcpStore.getState().switchToTab(id)
  useMcpStore.setState({ url: 'http://x/mcp', transport: 'http' })
  await useMcpStore.getState().connect()
}

function switchTo(id: string): void {
  useTabsStore.setState({ activeTabId: id })
  useMcpStore.getState().switchToTab(id)
}

const flush = () => act(async () => {})

/**
 * Wait until `n` calls reached main. A call first resolves the script cascade
 * and runs the pre-request scripts (issue #160), so the IPC call is no longer
 * made in the same tick as `callTool()` / `readResource()` / `getPrompt()`.
 */
async function sent(n: number): Promise<void> {
  await vi.waitFor(() => expect(api.pending.length).toBeGreaterThanOrEqual(n))
}

beforeEach(() => {
  api = installApi()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
})
afterEach(cleanup)

describe('Cancel an MCP call (issue #163)', () => {
  it('sends a callId, and Cancel calls mcp.cancelCall with it; the connection stays', async () => {
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('slow')
    const run = useMcpStore.getState().callTool()
    const s = useMcpStore.getState()
    expect(s.isInvoking).toBe(true)
    const callId = s.toolCallId
    expect(callId).toBeTruthy()
    await sent(1)
    expect(api.mcp.callTool).toHaveBeenCalledWith(
      'conn-1',
      'slow',
      {},
      expect.objectContaining({ callId }),
    )

    await useMcpStore.getState().cancelCall('tool')
    expect(api.mcp.cancelCall).toHaveBeenCalledWith('conn-1', callId)
    let after = useMcpStore.getState()
    expect(after.isInvoking).toBe(false)
    expect(after.toolMeta?.status).toBe('cancelled')
    expect(after.resultError).toBeNull()
    expect(after.connectionState).toBe('connected')

    // Main's reply for the cancelled call lands late — ignored.
    api.pending[0].resolve({
      success: false,
      error: 'MCP call cancelled by user',
      cancelled: true,
      timing: { durationMs: 40, sizeBytes: 0 },
    })
    await run
    after = useMcpStore.getState()
    expect(after.resultError).toBeNull()
    expect(after.toolMeta?.status).toBe('cancelled')
  })

  it('a reply flagged cancelled (main-side cancel) is "Cancelled", not an error', async () => {
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('slow')
    const run = useMcpStore.getState().callTool()
    await sent(1)
    api.pending[0].resolve({
      success: false,
      error: 'MCP call cancelled by user',
      cancelled: true,
      timing: { durationMs: 40, sizeBytes: 0 },
    })
    await run
    const s = useMcpStore.getState()
    expect(s.resultError).toBeNull()
    expect(s.toolMeta).toEqual({ status: 'cancelled', durationMs: 40 })
  })

  it('cancelling in tab B never touches tab A', async () => {
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('slow')
    const runA = useMcpStore.getState().callTool()
    const callA = useMcpStore.getState().toolCallId

    await connectTab('tab-b')
    useMcpStore.getState().setSelectedTool('slow')
    void useMcpStore.getState().callTool()
    const callB = useMcpStore.getState().toolCallId
    expect(callB).not.toBe(callA)

    await useMcpStore.getState().cancelCall('tool')
    expect(api.mcp.cancelCall).toHaveBeenCalledTimes(1)
    expect(api.mcp.cancelCall).toHaveBeenCalledWith('conn-2', callB)

    // A is still running, and its result lands in A.
    expect(useMcpStore.getState()._tabStates.get('tab-a')?.isInvoking).toBe(true)
    api.pending[0].resolve({ success: true, data: { content: [{ type: 'text', text: 'A' }] } })
    await runA
    const a = useMcpStore.getState()._tabStates.get('tab-a')
    expect(a?.isInvoking).toBe(false)
    expect(a?.toolMeta?.status).toBe('ok')
    expect(useMcpStore.getState().toolMeta?.status).toBe('cancelled')
  })

  it('Read and Get carry a callId and are cancellable too', async () => {
    await connectTab('tab-a')
    useMcpStore.getState().selectResource('test://a')
    void useMcpStore.getState().readResource()
    const rid = useMcpStore.getState().resourceCallId
    await sent(1)
    expect(api.mcp.readResource).toHaveBeenCalledWith('conn-1', 'test://a', { callId: rid })
    await useMcpStore.getState().cancelCall('resource')
    expect(useMcpStore.getState().isReadingResource).toBe(false)
    expect(useMcpStore.getState().resourceMeta?.status).toBe('cancelled')

    useMcpStore.getState().setSelectedPrompt('greet')
    void useMcpStore.getState().getPrompt()
    const pid = useMcpStore.getState().promptCallId
    await sent(2)
    expect(api.mcp.getPrompt).toHaveBeenCalledWith('conn-1', 'greet', {}, { callId: pid })
    await useMcpStore.getState().cancelCall('prompt')
    expect(useMcpStore.getState().isGettingPrompt).toBe(false)
    expect(useMcpStore.getState().promptMeta?.status).toBe('cancelled')
  })

  it('Read and Get pass the project scope so their History rows land in the project (#166)', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'p-1' } as never)
    try {
      await connectTab('tab-a')
      useMcpStore.getState().selectResource('test://a')
      void useMcpStore.getState().readResource()
      await sent(1)
      expect(api.mcp.readResource).toHaveBeenCalledWith(
        'conn-1',
        'test://a',
        expect.objectContaining({ workspaceId: 'ws-1', projectId: 'p-1' }),
      )
      useMcpStore.getState().setSelectedPrompt('greet')
      void useMcpStore.getState().getPrompt()
      await sent(2)
      expect(api.mcp.getPrompt).toHaveBeenCalledWith(
        'conn-1',
        'greet',
        {},
        expect.objectContaining({ workspaceId: 'ws-1', projectId: 'p-1' }),
      )
    } finally {
      useWorkspaceStore.setState({ activeWorkspaceId: null, activeProjectId: null } as never)
    }
  })

  it('the Invoke button turns into Cancel while the call runs', async () => {
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('slow')
    render(<McpToolPane />)
    const button = screen.getByTestId('mcp-invoke')
    expect(button.getAttribute('data-running')).toBe('false')
    fireEvent.click(button)
    await flush()
    expect(button.getAttribute('data-running')).toBe('true')
    expect(button.textContent).toMatch(/Cancel/)
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    await flush()
    expect(api.mcp.cancelCall).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('mcp-call-status').getAttribute('data-status')).toBe('cancelled')
    expect(screen.getByTestId('mcp-call-cancelled')).toBeTruthy()
    expect(screen.queryByTestId('mcp-result-call-error')).toBeNull()
  })
})

describe('Result header (issue #164)', () => {
  it('OK pill, duration and size from main, Copy puts the text on the clipboard', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('slow')
    render(<McpToolPane />)
    const run = useMcpStore.getState().callTool()
    await sent(1)
    api.pending[0].resolve({
      success: true,
      data: { content: [{ type: 'text', text: 'hello' }] },
      timing: { durationMs: 142, sizeBytes: 2048 },
    })
    await act(async () => {
      await run
    })
    expect(screen.getByTestId('mcp-call-status').getAttribute('data-status')).toBe('ok')
    expect(screen.getByTestId('mcp-call-status').textContent).toBe('OK')
    expect(screen.getByTestId('mcp-call-duration').textContent).toBe('142 ms')
    expect(screen.getByTestId('mcp-call-size').textContent).toBe('2.00 KB')
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-call-copy'))
    })
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('isError → "Tool error" pill; no timing → the reply size is measured', async () => {
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('slow')
    render(<McpToolPane />)
    const data = { content: [{ type: 'text', text: 'boom' }], isError: true }
    const run = useMcpStore.getState().callTool()
    await sent(1)
    api.pending[0].resolve({ success: true, data })
    await act(async () => {
      await run
    })
    const pill = screen.getByTestId('mcp-call-status')
    expect(pill.getAttribute('data-status')).toBe('toolError')
    expect(pill.textContent).toBe('Tool error')
    expect(useMcpStore.getState().toolMeta?.sizeBytes).toBe(JSON.stringify(data).length)
  })

  it('a failed call shows an "Error" pill next to the error line', async () => {
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('slow')
    render(<McpToolPane />)
    const run = useMcpStore.getState().callTool()
    await sent(1)
    api.pending[0].resolve({
      success: false,
      error: 'boom',
      timing: { durationMs: 9, sizeBytes: 0 },
    })
    await act(async () => {
      await run
    })
    expect(screen.getByTestId('mcp-call-status').getAttribute('data-status')).toBe('error')
    expect(screen.getByTestId('mcp-result-call-error').textContent).toBe('boom')
  })

  it('resource and prompt panes get the same header', async () => {
    await connectTab('tab-a')
    useMcpStore.getState().selectResource('test://a')
    const { unmount } = render(<McpResourcePane />)
    const read = useMcpStore.getState().readResource()
    await sent(1)
    api.pending[0].resolve({
      success: true,
      data: { contents: [{ uri: 'test://a', text: 'x' }] },
      timing: { durationMs: 5, sizeBytes: 100 },
    })
    await act(async () => {
      await read
    })
    expect(screen.getByTestId('mcp-call-duration').textContent).toBe('5 ms')
    unmount()

    useMcpStore.getState().setCapabilityTab('prompts')
    useMcpStore.getState().setSelectedPrompt('greet')
    render(<McpPromptPane />)
    const get = useMcpStore.getState().getPrompt()
    await sent(2)
    api.pending[1].resolve({
      success: true,
      data: { messages: [] },
      timing: { durationMs: 7, sizeBytes: 10 },
    })
    await act(async () => {
      await get
    })
    expect(screen.getByTestId('mcp-call-status').getAttribute('data-status')).toBe('ok')
    expect(screen.getByTestId('mcp-call-duration').textContent).toBe('7 ms')
  })
})

describe('Decline vs Cancel note (issue #175)', () => {
  const INPUT_REQUIRED = {
    __mcp: {
      kind: 'input_required',
      inputRequests: {
        q: {
          method: 'elicitation/create',
          params: { message: 'Name?', requestedSchema: { type: 'object', properties: {} } },
        },
      },
      requestState: 's1',
    },
  }

  async function pausedOnInput(): Promise<void> {
    await connectTab('tab-a')
    useMcpStore.getState().setSelectedTool('slow')
    const run = useMcpStore.getState().callTool()
    await sent(1)
    api.pending[0].resolve({ success: true, data: INPUT_REQUIRED })
    await run
    expect(useMcpStore.getState().pendingInput).not.toBeNull()
  }

  it('declining shows "You declined the request" above the result', async () => {
    await pausedOnInput()
    render(<McpToolPane />)
    fireEvent.click(screen.getByTestId('mcp-input-decline'))
    await flush()
    expect(useMcpStore.getState().inputOutcome).toBe('declined')
    api.pending[1].resolve({ success: true, data: { content: [{ type: 'text', text: 'ok' }] } })
    await flush()
    const note = screen.getByTestId('mcp-input-outcome')
    expect(note.getAttribute('data-outcome')).toBe('declined')
    expect(note.textContent).toBe('You declined the request')
    expect(screen.getByTestId('mcp-result')).toBeTruthy()
  })

  it('cancelling shows "You cancelled the request"; the next Invoke clears it', async () => {
    await pausedOnInput()
    render(<McpToolPane />)
    fireEvent.click(screen.getByTestId('mcp-input-cancel'))
    await flush()
    api.pending[1].resolve({ success: true, data: { content: [] } })
    await flush()
    expect(screen.getByTestId('mcp-input-outcome').textContent).toBe('You cancelled the request')

    await act(async () => {
      void useMcpStore.getState().callTool()
    })
    expect(useMcpStore.getState().inputOutcome).toBeNull()
    expect(screen.queryByTestId('mcp-input-outcome')).toBeNull()
  })
})

describe('tool annotation badges explain themselves', () => {
  it('each badge carries its plain-language tooltip', async () => {
    await connectTab('tab-a')
    useMcpStore.setState({
      tools: [
        {
          name: 'slow',
          inputSchema: { type: 'object', properties: {} },
          annotations: { readOnlyHint: true, destructiveHint: true },
        },
      ],
      selectedTool: 'slow',
    })
    render(<McpToolPane />)
    expect(screen.getByTestId('mcp-tool-hint-readOnlyHint').getAttribute('title')).toBe(
      'The server says this tool only reads; it does not change anything.',
    )
    expect(screen.getByTestId('mcp-tool-hint-destructiveHint').getAttribute('title')).toBe(
      'The server says this tool may delete or overwrite data.',
    )
  })
})
