/**
 * Issue #172 — MCP Messages pane: it remembers open/closed and its height per
 * user (localStorage, try/catch'd, default closed on first use), follows new
 * entries with an auto-scroll toggle that pauses when the user scrolls up,
 * copies the selected entry, and exports the visible entries as a JSON file
 * through the existing save-file bridge (`importExport.saveFile`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import McpMessagesPane from '../../src/renderer/components/protocols/mcp/McpMessagesPane'
import { MESSAGES_PANE_STORAGE_KEY } from '../../src/renderer/lib/mcp-messages-pane-prefs'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { McpFrame } from '../../src/renderer/types/mcp'

function frames(n: number): McpFrame[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    ts: i,
    direction: i % 2 === 0 ? ('out' as const) : ('in' as const),
    message:
      i % 2 === 0
        ? { jsonrpc: '2.0', id: i, method: i === 0 ? 'initialize' : 'tools/list' }
        : { jsonrpc: '2.0', id: i - 1, result: { n: i } },
  }))
}

const saveFile = vi.fn()

beforeEach(() => {
  window.localStorage.clear()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-msgs')
  saveFile.mockReset()
  saveFile.mockResolvedValue({ success: true, data: '/tmp/x.json' })
  ;(window as unknown as { api: unknown }).api = { importExport: { saveFile } }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('remembered open state and height', () => {
  it('first use is closed; opening persists and a remount comes back open', () => {
    const { unmount } = render(<McpMessagesPane />)
    expect(screen.getByTestId('mcp-messages-toggle')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByTestId('mcp-messages-toggle'))
    expect(
      JSON.parse(window.localStorage.getItem(MESSAGES_PANE_STORAGE_KEY) ?? '{}'),
    ).toMatchObject({ open: true })
    unmount()
    render(<McpMessagesPane />)
    expect(screen.getByTestId('mcp-messages-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('mcp-notifications')).toBeInTheDocument()
  })

  it('dragging the top edge resizes the pane (clamped) and the height survives a remount', () => {
    const { unmount } = render(<McpMessagesPane />)
    fireEvent.click(screen.getByTestId('mcp-messages-toggle'))
    const pane = screen.getByTestId('mcp-messages-pane')
    expect(pane.style.height).toBe('240px')
    const handle = screen.getByTestId('mcp-messages-resize')
    fireEvent.mouseDown(handle, { clientY: 500 })
    fireEvent.mouseMove(window, { clientY: 400 })
    fireEvent.mouseUp(window, { clientY: 400 })
    expect(pane.style.height).toBe('340px')
    // Far beyond the limits → clamped.
    fireEvent.mouseDown(handle, { clientY: 500 })
    fireEvent.mouseMove(window, { clientY: 495 + 5000 })
    fireEvent.mouseUp(window)
    expect(pane.style.height).toBe('120px')
    unmount()
    render(<McpMessagesPane />)
    expect(screen.getByTestId('mcp-messages-pane').style.height).toBe('120px')
  })

  it('a broken localStorage (throws) still renders the closed default', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    render(<McpMessagesPane />)
    expect(screen.getByTestId('mcp-messages-toggle')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByTestId('mcp-messages-toggle'))
    expect(screen.getByTestId('mcp-messages-toggle')).toHaveAttribute('aria-expanded', 'true')
  })

  it('a stored height outside the limits is clamped on load', () => {
    window.localStorage.setItem(
      MESSAGES_PANE_STORAGE_KEY,
      JSON.stringify({ open: true, height: 99999 }),
    )
    render(<McpMessagesPane />)
    expect(screen.getByTestId('mcp-messages-pane').style.height).toBe('600px')
  })
})

describe('auto-scroll', () => {
  function stubScroll(el: HTMLElement, sizes: { scrollHeight: number; clientHeight: number }) {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => sizes.scrollHeight })
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => sizes.clientHeight })
  }

  it('is on by default, pauses when the user scrolls up, and the toggle resumes it', () => {
    useMcpStore.setState({ frames: frames(10) })
    render(<McpMessagesPane />)
    fireEvent.click(screen.getByTestId('mcp-messages-tab-frames'))
    const toggle = screen.getByTestId('mcp-messages-autoscroll')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    const list = screen.getByTestId('mcp-frames-rows')
    const sizes = { scrollHeight: 1000, clientHeight: 200 }
    stubScroll(list, sizes)
    // The user scrolls up, away from the bottom.
    list.scrollTop = 100
    fireEvent.scroll(list)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    // A new frame arrives: the list does not jump to the bottom.
    sizes.scrollHeight = 1100
    act(() => useMcpStore.setState({ frames: frames(11) }))
    expect(list.scrollTop).toBe(100)

    // Turning it back on jumps to the newest entry and keeps following.
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(list.scrollTop).toBe(1100)
    sizes.scrollHeight = 1200
    act(() => useMcpStore.setState({ frames: frames(12) }))
    expect(list.scrollTop).toBe(1200)
  })
})

describe('copy and export', () => {
  it('Copy puts the selected frame JSON on the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    useMcpStore.setState({ frames: frames(2) })
    render(<McpMessagesPane />)
    fireEvent.click(screen.getByTestId('mcp-messages-tab-frames'))
    expect(screen.queryByTestId('mcp-frames-copy')).toBeNull()
    fireEvent.click(within(screen.getByTestId('mcp-frames')).getByText('result #0'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-frames-copy'))
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(JSON.parse(writeText.mock.calls[0][0] as string)).toEqual({
      jsonrpc: '2.0',
      id: 0,
      result: { n: 1 },
    })
  })

  it('Export saves the VISIBLE (filtered) entries as JSON through importExport.saveFile', async () => {
    useMcpStore.setState({ frames: frames(4) })
    render(<McpMessagesPane />)
    fireEvent.click(screen.getByTestId('mcp-messages-tab-frames'))
    fireEvent.change(screen.getByTestId('mcp-frames-filter'), { target: { value: 'tools/list' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-frames-export'))
    })
    expect(saveFile).toHaveBeenCalledTimes(1)
    const [content, name] = saveFile.mock.calls[0] as [string, string]
    expect(name).toMatch(/^mcp-frames-.*\.json$/)
    const exported = JSON.parse(content) as McpFrame[]
    expect(exported).toEqual([frames(4)[2]])
  })

  it('Export of notifications keeps the entries exactly as held (no extra fields)', async () => {
    const notifications = [
      { id: 'n1', ts: 5, method: 'notifications/message', params: { data: 'x' } },
    ]
    useMcpStore.setState({ notifications })
    render(<McpMessagesPane />)
    fireEvent.click(screen.getByTestId('mcp-messages-tab-notifications'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-notifications-export'))
    })
    const [content, name] = saveFile.mock.calls[0] as [string, string]
    expect(name).toMatch(/^mcp-notifications-.*\.json$/)
    expect(JSON.parse(content)).toEqual(notifications)
  })

  it('Export is disabled with nothing to export', () => {
    render(<McpMessagesPane />)
    fireEvent.click(screen.getByTestId('mcp-messages-tab-frames'))
    expect(screen.queryByTestId('mcp-frames-export')).toBeDisabled()
  })
})
