/**
 * Issue #165 — Ctrl/Cmd+Enter on an MCP tab. The global chord used to call
 * the HTTP request store's `sendRequest` whatever tab was active, so on an
 * MCP tab it fired an HTTP request built from a stale URL instead of the
 * tool. It now dispatches by the active tab's protocol: MCP runs the active
 * capability's primary action (Invoke / Read / Get) when connected; every
 * other protocol keeps `sendRequest` exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { runActiveRequest } from '../../src/renderer/lib/run-active-request'
import { useKeyboardShortcuts } from '../../src/renderer/lib/keyboard-shortcuts'
import { useCommandActions } from '../../src/renderer/lib/command-registry'
import McpToolPane from '../../src/renderer/components/protocols/mcp/McpToolPane'
import type { Tab } from '../../src/renderer/types'

function installApi() {
  const mcp = {
    connect: vi.fn(async () => ({
      success: true,
      data: { connectionId: 'conn-1', transport: 'http', url: 'http://x/mcp' },
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
    callTool: vi.fn(async () => ({ success: true, data: { content: [] } })),
    readResource: vi.fn(async () => ({ success: true, data: { contents: [] } })),
    getPrompt: vi.fn(async () => ({ success: true, data: { messages: [] } })),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return mcp
}

let mcp: ReturnType<typeof installApi>
let sendRequest: ReturnType<typeof vi.fn>

function activate(protocol: string, id = `tab-${protocol}`): void {
  useTabsStore.setState({
    tabs: [{ id, name: id, protocol, isDirty: false } as Tab],
    activeTabId: id,
  })
}

async function connectedMcpTab(): Promise<void> {
  activate('mcp')
  useMcpStore.getState().switchToTab('tab-mcp')
  useMcpStore.setState({ url: 'http://x/mcp', transport: 'http' })
  await useMcpStore.getState().connect()
}

beforeEach(() => {
  mcp = installApi()
  sendRequest = vi.fn(async () => undefined)
  useRequestStore.setState({ sendRequest } as never)
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
})
afterEach(cleanup)

describe('runActiveRequest — one dispatch for the chord and the palette (issue #165)', () => {
  it.each(['http', 'soap', 'graphql'])('%s tabs still call sendRequest', (protocol) => {
    activate(protocol)
    runActiveRequest()
    expect(sendRequest).toHaveBeenCalledTimes(1)
    expect(mcp.callTool).not.toHaveBeenCalled()
  })

  it('an MCP tab invokes the selected tool, never sendRequest', async () => {
    await connectedMcpTab()
    useMcpStore.getState().setSelectedTool('echo')
    await act(async () => runActiveRequest())
    expect(mcp.callTool).toHaveBeenCalledTimes(1)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('…reads the resource on the Resources tab and gets the prompt on Prompts', async () => {
    await connectedMcpTab()
    useMcpStore.getState().setCapabilityTab('resources')
    useMcpStore.getState().selectResource('test://a')
    await act(async () => runActiveRequest())
    expect(mcp.readResource).toHaveBeenCalledTimes(1)

    useMcpStore.getState().setCapabilityTab('prompts')
    useMcpStore.getState().setSelectedPrompt('greet')
    await act(async () => runActiveRequest())
    expect(mcp.getPrompt).toHaveBeenCalledTimes(1)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('does nothing on a disconnected MCP tab', () => {
    activate('mcp')
    useMcpStore.getState().switchToTab('tab-mcp')
    useMcpStore.setState({ selectedTool: 'echo' })
    runActiveRequest()
    expect(mcp.callTool).not.toHaveBeenCalled()
    expect(sendRequest).not.toHaveBeenCalled()
  })
})

describe('the chord and the palette use the dispatch (issue #165)', () => {
  function pressModEnter(): void {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, metaKey: true, bubbles: true }),
    )
  }

  it('Ctrl/Cmd+Enter on an HTTP tab sends; on an MCP tab invokes the tool', async () => {
    renderHook(() => useKeyboardShortcuts())
    activate('http')
    pressModEnter()
    expect(sendRequest).toHaveBeenCalledTimes(1)

    await connectedMcpTab()
    useMcpStore.getState().setSelectedTool('echo')
    await act(async () => pressModEnter())
    expect(mcp.callTool).toHaveBeenCalledTimes(1)
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it('the palette "Send" action runs the MCP tool on an MCP tab', async () => {
    await connectedMcpTab()
    useMcpStore.getState().setSelectedTool('echo')
    const { result } = renderHook(() => useCommandActions())
    const send = result.current.find((a) => a.id === 'request.send')
    await act(async () => {
      await send?.run()
    })
    expect(mcp.callTool).toHaveBeenCalledTimes(1)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('the Invoke button tooltip names the chord', async () => {
    await connectedMcpTab()
    useMcpStore.getState().setSelectedTool('echo')
    render(<McpToolPane />)
    expect(screen.getByTestId('mcp-invoke').getAttribute('title')).toMatch(/\((Ctrl|Cmd)\+Enter\)$/)
  })
})
