/**
 * Review #5 / #6 (1.6.0 product review) — the four connection bars are
 * siblings in size and wrap behaviour, and the MCP editor follows the font
 * size setting.
 *
 * Fail-before (DOM-measured in the review): WS / SSE URL 35px / button 33px
 * (`py-2` boxes) vs Socket.IO / MCP 26px (`h-8`); the status pill a fixed
 * 12px next to a 16px URL; four different narrow-window behaviours (SSE
 * clipped its button, Socket.IO wrapped Connect alone and clipped the token
 * placeholder, MCP wrapped the config icons to a second row); MCP
 * Tools / Resources / Prompts tabs and the Auth Type select fixed at 12px.
 *
 * jsdom has no layout, so the invariants are pinned on the shared class set
 * (`connection-bar-ui.ts`): one height token, base-size text, and the URL +
 * actions group that wraps as a unit. The 1024 / 16px / TR cell itself is a
 * live check (not run here).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import WsConnectionBar from '../../src/renderer/components/protocols/WsConnectionBar'
import SseConnectionBar from '../../src/renderer/components/protocols/SseConnectionBar'
import SocketIOEditor from '../../src/renderer/components/protocols/SocketIOEditor'
import McpConnectionBar from '../../src/renderer/components/protocols/mcp/McpConnectionBar'
import McpCapabilityList from '../../src/renderer/components/protocols/mcp/McpCapabilityList'
import McpAuthSection from '../../src/renderer/components/protocols/mcp/McpAuthSection'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

/** The shared bar height (`connection-bar-ui.ts` CB_HEIGHT), written out so the test pins it. */
const CB_HEIGHT = 'h-[max(28px,2rem)]'

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

const cls = (el: Element): string[] => (el.getAttribute('class') ?? '').split(/\s+/)
const has = (el: Element, c: string): boolean => cls(el).includes(c)

/** Each bar: its row, URL field, primary button and status pill. */
const BARS = [
  {
    name: 'WebSocket',
    mount: () => {
      useWebSocketStore.setState({
        url: 'ws://127.0.0.1:3100',
        connectionState: 'disconnected',
        errorMessage: null,
      })
      render(React.createElement(WsConnectionBar))
    },
    row: 'ws-connection-row',
    url: 'ws-url',
    button: 'ws-connect',
    pill: 'ws-status',
  },
  {
    name: 'SSE',
    mount: () => {
      useSseStore.setState({
        url: 'http://127.0.0.1:3200/events',
        method: 'GET',
        connectionState: 'connected',
        reconnecting: false,
        errorMessage: null,
      })
      render(React.createElement(SseConnectionBar))
    },
    row: 'sse-connection-row',
    url: 'sse-url',
    button: 'sse-disconnect',
    pill: 'sse-status',
  },
  {
    name: 'Socket.IO',
    mount: () => {
      useSocketIOStore.setState({
        url: 'http://127.0.0.1:3300',
        connectionState: 'disconnected',
        errorMessage: null,
      })
      render(React.createElement(SocketIOEditor))
    },
    row: 'socketio-connection-row',
    url: 'socketio-url',
    button: 'socketio-connect',
    pill: 'socketio-status',
  },
  {
    name: 'MCP',
    mount: () => {
      useMcpStore.getState().switchToTab('tab-bar-siblings')
      useMcpStore.setState({ url: 'https://mcp.example.com/mcp', transport: 'http' })
      render(React.createElement(McpConnectionBar))
    },
    row: 'mcp-connection-row',
    url: 'mcp-url',
    button: 'mcp-connect',
    pill: 'mcp-status',
  },
] as const

beforeEach(() => {
  useUIStore.getState().setLocale('en')
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('one size token set across the four bars (review #5)', () => {
  for (const bar of BARS) {
    it(`${bar.name}: pill, URL and button share the bar height; text follows the font size`, () => {
      bar.mount()
      const url = screen.getByTestId(bar.url)
      const button = screen.getByTestId(bar.button)
      const pill = screen.getByTestId(bar.pill)
      for (const el of [url, button, pill]) {
        expect(has(el, CB_HEIGHT), `${bar.name} ${el.dataset.testid}`).toBe(true)
        // the old WS / SSE box: vertical padding instead of a height
        expect(cls(el).some((c) => /^py-/.test(c))).toBe(false)
      }
      expect(has(url, 'text-sm')).toBe(true)
      expect(has(button, 'text-sm')).toBe(true)
      expect(has(button, 'whitespace-nowrap')).toBe(true)
      // base − 1px, not a fixed 12px next to a 16px URL
      expect(has(pill, 'text-xs')).toBe(true)
      expect(pill.className).not.toContain('text-[12px]')
    })

    it(`${bar.name}: URL + its buttons are one group that wraps as a unit`, () => {
      bar.mount()
      const row = screen.getByTestId(bar.row)
      expect(has(row, 'flex-wrap')).toBe(true)
      const button = screen.getByTestId(bar.button)
      const group = button.parentElement as HTMLElement
      expect(group.parentElement).toBe(row)
      expect(group).toContainElement(screen.getByTestId(bar.url))
      expect(has(group, 'flex-[1_1_24rem]')).toBe(true)
      expect(has(group, 'flex-wrap')).toBe(false)
      // the status pill stays in front, outside the group
      expect(group).not.toContainElement(screen.getByTestId(bar.pill))
    })
  }

  it('SSE: the method select and Reconnect use the same height', () => {
    BARS[1].mount()
    expect(has(screen.getByTestId('sse-method'), CB_HEIGHT)).toBe(true)
    expect(has(screen.getByTestId('sse-reconnect'), CB_HEIGHT)).toBe(true)
  })

  it('Socket.IO: namespace + token sit on their own row; token is translated and not inline-sized', () => {
    useUIStore.getState().setLocale('tr')
    BARS[2].mount()
    const options = screen.getByTestId('socketio-options-row')
    const token = screen.getByTestId('socketio-bearer-token')
    expect(options).toContainElement(token)
    expect(options).toContainElement(screen.getByTestId('socketio-namespace'))
    expect(screen.getByTestId('socketio-connection-row')).not.toContainElement(token)
    expect(token.getAttribute('placeholder')).toBe('Bearer token (isteğe bağlı)')
    expect(token.getAttribute('style')).toBeNull()
    expect(has(token, CB_HEIGHT)).toBe(true)
  })
})

describe('MCP editor at the 16px setting (review #6)', () => {
  it('Paste / Export config: square bar-height icon buttons with names, in the URL group', () => {
    BARS[3].mount()
    const group = screen.getByTestId('mcp-connection-target')
    for (const id of ['mcp-config-paste', 'mcp-config-export']) {
      const b = screen.getByTestId(id)
      expect(group).toContainElement(b)
      expect(has(b, CB_HEIGHT)).toBe(true)
      expect(has(b, 'w-[max(28px,2rem)]')).toBe(true)
      expect(b.getAttribute('aria-label')).toBeTruthy()
    }
  })

  it('Tools / Resources / Prompts tabs and the capability search use the base size', () => {
    useMcpStore.getState().switchToTab('tab-cap-size')
    render(React.createElement(McpCapabilityList))
    for (const id of ['tools', 'resources', 'prompts']) {
      const tab = screen.getByTestId(`mcp-cap-tab-${id}`)
      expect(has(tab, 'text-sm')).toBe(true)
      expect(tab.className).not.toContain('text-[12px]')
    }
    expect(has(screen.getByTestId('mcp-search'), 'text-sm')).toBe(true)
  })

  it('Auth Type select and the auth fields use the base size', () => {
    useMcpStore.getState().switchToTab('tab-auth-size')
    useMcpStore.setState({
      transport: 'http',
      auth: { type: 'api-key', apiKey: { key: 'X-Key', value: '', in: 'header' } },
    })
    render(React.createElement(McpAuthSection))
    for (const id of ['mcp-auth-type', 'mcp-auth-apikey-in', 'mcp-auth-apikey-key']) {
      const el = screen.getByTestId(id)
      expect(has(el, 'text-sm'), id).toBe(true)
      expect(el.className).not.toContain('text-[12px]')
    }
  })
})
