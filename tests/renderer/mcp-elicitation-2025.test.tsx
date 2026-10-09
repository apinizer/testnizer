/**
 * Issue #168 — 2025-era elicitation. A 2025 server asks for input mid-call
 * with `elicitation/create`; main forwards it as `mcp:elicitation` and waits
 * for `mcp.respondElicitation`. The event is routed by `connectionId` to the
 * tab that owns the connection (a background tab keeps it pending — issue
 * #76 class), shown as the input card naming the server with Accept /
 * Decline / Cancel and a review-before-send preview; the tool call's result
 * then arrives normally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import McpToolPane from '../../src/renderer/components/protocols/mcp/McpToolPane'
import type { McpElicitationEvent } from '../../src/renderer/lib/mcp-call-api'

type Reply = { success: boolean; data?: unknown; error?: string; cancelled?: boolean }

function installApi() {
  let elicitationCb: ((e: McpElicitationEvent) => void) | undefined
  let resolveCall: ((r: Reply) => void) | undefined
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
      data: [{ name: 'ask', inputSchema: { type: 'object', properties: {} } }],
    })),
    callTool: vi.fn(
      () =>
        new Promise<Reply>((r) => {
          resolveCall = r
        }),
    ),
    cancelCall: vi.fn(async () => ({ success: true, data: { cancelled: true } })),
    onElicitation: vi.fn((cb: (e: McpElicitationEvent) => void) => {
      elicitationCb = cb
      return () => undefined
    }),
    respondElicitation: vi.fn(async () => ({ success: true, data: true })),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return {
    mcp,
    emit: (e: McpElicitationEvent) => act(() => elicitationCb?.(e)),
    resolveCall: (r: Reply) => resolveCall?.(r),
  }
}

const ASK_NAME = (connectionId: string, elicitationId = 'el-1'): McpElicitationEvent => ({
  connectionId,
  elicitationId,
  serverName: 'Weather Server',
  message: 'What is your name?',
  requestedSchema: {
    type: 'object',
    properties: { name: { type: 'string', title: 'Name' } },
    required: ['name'],
  },
  mode: 'form',
})

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
  useMcpStore.getState().setSelectedTool('ask')
}

beforeEach(() => {
  api = installApi()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
})
afterEach(cleanup)

describe('2025-era elicitation (issue #168)', () => {
  it('routes to the owning tab — a background tab keeps it pending', async () => {
    await connectTab('tab-a')
    await connectTab('tab-b')
    api.emit(ASK_NAME('conn-1'))
    expect(useMcpStore.getState().pendingElicitations).toEqual([])
    expect(useMcpStore.getState()._tabStates.get('tab-a')?.pendingElicitations).toHaveLength(1)

    useTabsStore.setState({ activeTabId: 'tab-a' })
    useMcpStore.getState().switchToTab('tab-a')
    render(<McpToolPane />)
    expect(screen.getByTestId('mcp-elicitation-server').textContent).toBe(
      'Weather Server asks for input',
    )
  })

  it('Accept sends the reviewed content while the tool call is still running', async () => {
    await connectTab('tab-a')
    render(<McpToolPane />)
    const call = useMcpStore.getState().callTool()
    api.emit(ASK_NAME('conn-1'))

    const submit = screen.getByTestId('mcp-input-submit') as HTMLButtonElement
    expect(submit.textContent).toBe('Accept')
    expect(submit.disabled).toBe(false)
    fireEvent.change(screen.getByTestId('mcp-input-field-el-1-name'), { target: { value: 'Ada' } })
    // Review before send: the preview shows exactly what Accept sends.
    expect(JSON.parse(screen.getByTestId('mcp-input-preview-json').textContent ?? '')).toEqual({
      'el-1': { action: 'accept', content: { name: 'Ada' } },
    })
    await act(async () => {
      fireEvent.click(submit)
    })
    expect(api.mcp.respondElicitation).toHaveBeenCalledWith('conn-1', 'el-1', {
      action: 'accept',
      content: { name: 'Ada' },
    })
    expect(screen.queryByTestId('mcp-elicitation')).toBeNull()

    // The tool call's result then arrives normally.
    api.resolveCall({ success: true, data: { content: [{ type: 'text', text: 'Hi Ada' }] } })
    await act(async () => {
      await call
    })
    expect(screen.getByTestId('mcp-result').textContent).toContain('Hi Ada')
    expect(screen.queryByTestId('mcp-input-outcome')).toBeNull()
  })

  it('Decline answers decline and leaves the "declined" note', async () => {
    await connectTab('tab-a')
    render(<McpToolPane />)
    void useMcpStore.getState().callTool()
    api.emit(ASK_NAME('conn-1'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-input-decline'))
    })
    expect(api.mcp.respondElicitation).toHaveBeenCalledWith('conn-1', 'el-1', { action: 'decline' })
    expect(screen.getByTestId('mcp-input-outcome').getAttribute('data-outcome')).toBe('declined')
  })

  it('an elicitation no tab owns is cancelled so the server never hangs', async () => {
    await connectTab('tab-a')
    api.emit(ASK_NAME('conn-unknown', 'el-x'))
    expect(api.mcp.respondElicitation).toHaveBeenCalledWith('conn-unknown', 'el-x', {
      action: 'cancel',
    })
  })

  it('cancelling the tool call cancels the elicitation it waits on', async () => {
    await connectTab('tab-a')
    void useMcpStore.getState().callTool()
    api.emit(ASK_NAME('conn-1'))
    await useMcpStore.getState().cancelCall('tool')
    expect(useMcpStore.getState().pendingElicitations).toEqual([])
    expect(api.mcp.respondElicitation).toHaveBeenCalledWith('conn-1', 'el-1', { action: 'cancel' })
  })

  it('closing the owning tab cancels its pending elicitation', async () => {
    await connectTab('tab-a')
    await connectTab('tab-b')
    api.emit(ASK_NAME('conn-1'))
    useMcpStore.getState().removeTabState('tab-a')
    expect(api.mcp.respondElicitation).toHaveBeenCalledWith('conn-1', 'el-1', { action: 'cancel' })
  })

  it('a failed answer keeps the card with the error for a retry', async () => {
    await connectTab('tab-a')
    api.mcp.respondElicitation.mockResolvedValueOnce({ success: false, error: 'gone' } as never)
    render(<McpToolPane />)
    api.emit(ASK_NAME('conn-1'))
    fireEvent.change(screen.getByTestId('mcp-input-field-el-1-name'), { target: { value: 'Ada' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-input-submit'))
    })
    expect(screen.getByTestId('mcp-input-error').textContent).toBe('gone')
    expect(screen.getByTestId('mcp-elicitation')).toBeTruthy()
  })
})
