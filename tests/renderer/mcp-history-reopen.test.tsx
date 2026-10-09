/**
 * Issue #166 (renderer half) — reopen an MCP call from History. Only SOAP was
 * special-cased in `HistoryListPanel`, so an MCP row fell into the HTTP branch
 * and opened with an empty server URL (live-verified). The MCP branch now
 * opens an MCP tab with transport / url / protocol from the snapshot and the
 * capability + name + args selected via `restoreMcpCall`; the user then
 * presses Connect and Run. History search matches tool / prompt / resource
 * names too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import HistoryListPanel from '../../src/renderer/components/sidebar/HistoryListPanel'
import { useHistoryStore } from '../../src/renderer/stores/history.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import {
  mcpHistoryRestore,
  mcpHistorySearchText,
} from '../../src/renderer/components/protocols/mcp/history-restore'
import type { HistoryEntry } from '../../src/renderer/types'

const row = (over: Partial<HistoryEntry>): HistoryEntry =>
  ({
    id: 'h1',
    protocol: 'mcp',
    method: 'CALL_TOOL',
    url: 'http://127.0.0.1:3100/mcp',
    status_code: 0,
    duration_ms: 12,
    executed_at: Date.now(),
    request_snapshot: {},
    ...over,
  }) as HistoryEntry

/** The shape main writes from #166 on. */
const TOOL_ROW = row({
  request_snapshot: {
    mcp: {
      transport: 'http',
      url: 'http://127.0.0.1:3100/mcp',
      protocol: '2025-06-18',
      capability: 'tool',
      name: 'echo',
      args: { text: 'hi' },
    },
  } as never,
})

/** What main wrote before #166: url = `${server}/${toolName}`, no `mcp` key. */
const LEGACY_ROW = row({
  id: 'h-legacy',
  url: 'http://127.0.0.1:3100/mcp/echo',
  request_snapshot: { connectionId: 'c1', toolName: 'echo', args: { text: 'old' } } as never,
})

describe('mcpHistoryRestore — tolerant snapshot adapter', () => {
  it('reads a tool row', () => {
    expect(mcpHistoryRestore(TOOL_ROW)).toEqual({
      transport: 'http',
      url: 'http://127.0.0.1:3100/mcp',
      protocol: '2025-06-18',
      name: 'echo',
      call: {
        capabilityTab: 'tools',
        selectedTool: 'echo',
        toolArgs: JSON.stringify({ text: 'hi' }, null, 2),
      },
    })
  })

  it('reads resource and prompt rows', () => {
    const res = mcpHistoryRestore(
      row({
        method: 'READ_RESOURCE',
        request_snapshot: {
          mcp: { transport: 'sse', url: 'http://s/sse', capability: 'resource', uri: 'test://a' },
        } as never,
      }),
    )
    expect(res.transport).toBe('sse')
    expect(res.call).toEqual({
      capabilityTab: 'resources',
      selectedResourceUri: 'test://a',
      resourceUriDraft: 'test://a',
    })
    const prompt = mcpHistoryRestore(
      row({
        method: 'GET_PROMPT',
        request_snapshot: {
          mcp: {
            url: 'http://s/mcp',
            capability: 'prompt',
            name: 'greet',
            args: { who: 'Ada', n: 2 },
          },
        } as never,
      }),
    )
    expect(prompt.call).toEqual({
      capabilityTab: 'prompts',
      selectedPrompt: 'greet',
      promptArgs: { who: 'Ada', n: '2' },
    })
  })

  it('reads a pre-#166 row: strips /toolName from the url, guesses stdio from a command line', () => {
    const r = mcpHistoryRestore(LEGACY_ROW)
    expect(r.url).toBe('http://127.0.0.1:3100/mcp')
    expect(r.transport).toBe('http')
    expect(r.call.selectedTool).toBe('echo')
    expect(JSON.parse(r.call.toolArgs ?? '')).toEqual({ text: 'old' })

    const stdio = mcpHistoryRestore(
      row({ url: 'npx -y @scope/server/echo', request_snapshot: { toolName: 'echo' } as never }),
    )
    expect(stdio.transport).toBe('stdio')
    expect(stdio.url).toBe('npx -y @scope/server')
  })

  it('accepts the snapshot as a raw JSON string too', () => {
    const r = mcpHistoryRestore(
      row({
        request_snapshot: JSON.stringify({ mcp: { url: 'http://s/mcp', name: 'echo' } }) as never,
      }),
    )
    expect(r.url).toBe('http://s/mcp')
    expect(r.call.selectedTool).toBe('echo')
  })

  it('search text holds the tool / prompt / resource name', () => {
    expect(mcpHistorySearchText(TOOL_ROW)).toContain('echo')
    expect(
      mcpHistorySearchText(
        row({ request_snapshot: { mcp: { capability: 'resource', uri: 'test://docs' } } as never }),
      ),
    ).toContain('test://docs')
  })
})

describe('HistoryListPanel — MCP rows (issue #166)', () => {
  beforeEach(() => {
    ;(window as unknown as { api: unknown }).api = { mcp: {} }
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
    useHistoryStore.setState({
      entries: [TOOL_ROW],
      searchTerm: '',
      fetch: vi.fn(async () => undefined),
    } as never)
  })
  afterEach(cleanup)

  it('opens an MCP tab with the server and the call selected', () => {
    render(<HistoryListPanel />)
    fireEvent.click(screen.getByTestId('history-entry'))
    const tabs = useTabsStore.getState()
    const active = tabs.tabs.find((t) => t.id === tabs.activeTabId)
    expect(active?.protocol).toBe('mcp')
    expect(active?.url).toBe('http://127.0.0.1:3100/mcp')
    const s = useMcpStore.getState()
    expect(s._currentTabId).toBe(tabs.activeTabId)
    expect(s.url).toBe('http://127.0.0.1:3100/mcp')
    expect(s.transport).toBe('http')
    expect(s.protocol).toBe('2025-06-18')
    expect(s.capabilityTab).toBe('tools')
    expect(s.selectedTool).toBe('echo')
    expect(JSON.parse(s.toolArgs)).toEqual({ text: 'hi' })
    expect(s.connectionState).toBe('disconnected')
  })

  it('opens a pre-#166 row on the server URL, not `server/toolName`', () => {
    useHistoryStore.setState({ entries: [LEGACY_ROW] } as never)
    render(<HistoryListPanel />)
    fireEvent.click(screen.getByTestId('history-entry'))
    expect(useMcpStore.getState().url).toBe('http://127.0.0.1:3100/mcp')
    expect(useMcpStore.getState().selectedTool).toBe('echo')
  })

  it('search matches the tool name', () => {
    useHistoryStore.setState({
      entries: [TOOL_ROW, row({ id: 'h2', protocol: 'http', method: 'GET', url: 'http://api/x' })],
      searchTerm: 'echo',
    } as never)
    render(<HistoryListPanel />)
    expect(screen.getAllByTestId('history-entry')).toHaveLength(1)
  })
})
