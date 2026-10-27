/**
 * Issues #282 / #283 — the WebSocket and Socket.IO editors' new surfaces,
 * rendered: request tab strip, Settings form, Events tab, multi-argument
 * composer, saved-messages pane and the shared log (search, filter, two-row
 * time difference, expanded view with hexdump). Both editors use the SAME
 * shared components (P-K sibling rule) — the last test pins that.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
    React.createElement('textarea', {
      'data-testid': 'monaco',
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    }),
}))

import SocketIOEditor from '../../src/renderer/components/protocols/SocketIOEditor'
import WebSocketEditor from '../../src/renderer/components/protocols/WebSocketEditor'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}

beforeEach(() => {
  useUIStore.getState().setLocale('en')
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useSocketIOStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useSocketIOStore.getState().switchToTab('s1')
  useWebSocketStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useWebSocketStore.getState().switchToTab('w1')
})
afterEach(cleanup)

describe('Socket.IO editor', () => {
  it('tab strip: Message, Params, Headers, Events, Settings', () => {
    render(<SocketIOEditor />)
    const names = screen.getAllByRole('tab').map((t) => t.textContent?.replace(/\d+$/, ''))
    expect(names).toEqual(['Message', 'Params', 'Headers', 'Events', 'Settings'])
    fireEvent.click(screen.getByTestId('socketio-tab-headers'))
    expect(screen.getByTestId('socketio-headers')).toBeTruthy()
  })

  it('Events tab: add a listener, toggle Listen, Listen to all', () => {
    render(<SocketIOEditor />)
    fireEvent.click(screen.getByTestId('socketio-tab-events'))
    fireEvent.change(screen.getByTestId('socketio-listener-input'), { target: { value: 'chat' } })
    fireEvent.click(screen.getByTestId('socketio-listener-add'))
    expect(useSocketIOStore.getState().listeners.map((l) => l.name)).toEqual(['chat'])
    fireEvent.click(screen.getByTestId('socketio-listener-listen'))
    expect(useSocketIOStore.getState().listeners[0].listen).toBe(false)
    fireEvent.click(screen.getByTestId('socketio-listen-all'))
    expect(useSocketIOStore.getState().listenAll).toBe(true)
    expect(screen.getByText(/Every event the server sends/)).toBeTruthy()
  })

  it('a new request says it listens to nothing, with one click to listen to all', () => {
    render(<SocketIOEditor />)
    expect(screen.getByTestId('socketio-listen-notice').getAttribute('role')).toBe('status')
    fireEvent.click(screen.getByTestId('socketio-listen-all-inline'))
    expect(useSocketIOStore.getState().listenAll).toBe(true)
    expect(screen.queryByTestId('socketio-listen-notice')).toBeNull()
  })

  it('composer: add an argument and pick Binary · Hex; Ack toggle', () => {
    render(<SocketIOEditor />)
    fireEvent.click(screen.getByTestId('socketio-add-arg'))
    const formats = screen.getAllByTestId('socketio-arg-format')
    expect(formats).toHaveLength(2)
    fireEvent.change(formats[1], { target: { value: 'hex' } })
    expect(useSocketIOStore.getState().emitArgs[1].contentType).toBe('hex')
    expect(within(formats[1] as HTMLElement).getByRole('group', { name: 'Binary' })).toBeTruthy()
    fireEvent.click(screen.getByTestId('socketio-ack'))
    expect(useSocketIOStore.getState().emitAck).toBe(true)
  })

  it('saved messages: Save adds, click loads, double-click renames, delete removes', () => {
    render(<SocketIOEditor />)
    fireEvent.change(screen.getByTestId('socketio-event-name'), { target: { value: 'ping' } })
    fireEvent.click(screen.getByTestId('socketio-save-message'))
    expect(screen.getAllByTestId('socketio-saved-item')).toHaveLength(1)
    fireEvent.doubleClick(screen.getByTestId('socketio-saved-load'))
    const input = screen.getByTestId('socketio-saved-rename-input')
    fireEvent.change(input, { target: { value: 'Ping!' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useSocketIOStore.getState().savedMessages[0].name).toBe('Ping!')
    fireEvent.click(screen.getByTestId('socketio-saved-delete'))
    expect(screen.getByTestId('socketio-saved-empty')).toBeTruthy()
  })

  it('settings: v4 / v3 / v2 all selectable, the hint follows; form locks while connected', () => {
    render(<SocketIOEditor />)
    fireEvent.click(screen.getByTestId('socketio-tab-settings'))
    const version = screen.getByTestId('socketio-settings-version') as HTMLSelectElement
    const opts = Array.from(version.options).map((o) => [o.value, o.disabled, o.textContent])
    expect(opts).toEqual([
      ['4', false, 'v4'],
      ['3', false, 'v3'],
      ['2', false, 'v2'],
    ])
    expect(screen.getByTestId('socketio-settings-version-hint').textContent).toMatch(
      /v3 and v4 use the same client/,
    )
    fireEvent.change(version, { target: { value: '2' } })
    expect(useSocketIOStore.getState().settings.version).toBe('2')
    expect(screen.getByTestId('socketio-settings-version-hint').textContent).toMatch(
      /"token" query parameter/,
    )

    act(() => useSocketIOStore.setState({ connectionState: 'connected', connectionId: 'c' }))
    expect((screen.getByTestId('socketio-settings-form') as HTMLFieldSetElement).disabled).toBe(
      true,
    )
    expect(screen.getByTestId('socketio-settings-locked')).toBeTruthy()
  })

  it('timeline: system rows, search, filter, two-row time difference, binary hexdump', () => {
    useSocketIOStore.setState({
      events: [
        { id: 'a', direction: 'system', event: 'connected', data: 'http://x', timestamp: 1000 },
        { id: 'b', direction: 'out', event: 'hello', data: { n: 1 }, timestamp: 1100 },
        {
          id: 'c',
          direction: 'in',
          event: 'blob',
          data: { $binary: 'AP8=', size: 2 },
          timestamp: 1350,
        },
        { id: 'd', direction: 'ack', event: 'hello', data: 'ok', timestamp: 1400 },
      ],
    })
    render(<SocketIOEditor />)
    expect(screen.getAllByTestId('socketio-event')).toHaveLength(4)
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByText('Ack · hello')).toBeTruthy()

    fireEvent.click(screen.getByTestId('socketio-log-filter-sent'))
    expect(screen.getAllByTestId('socketio-event')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('socketio-log-filter-all'))
    fireEvent.change(screen.getByTestId('socketio-log-search'), { target: { value: 'blob' } })
    expect(screen.getAllByTestId('socketio-event')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('socketio-log-search-clear'))

    const rows = screen.getAllByTestId('socketio-event')
    // Newest first: d, c, b, a.
    fireEvent.click(within(rows[1]).getByTestId('socketio-row-select'))
    fireEvent.click(within(rows[2]).getByTestId('socketio-row-select'))
    expect(screen.getByTestId('socketio-log-diff').textContent).toContain('250 ms')

    fireEvent.click(rows[1])
    expect(screen.getByTestId('socketio-view-body').textContent).toContain('00 ff')
    fireEvent.click(screen.getByTestId('socketio-view-text'))
    expect(screen.getByTestId('socketio-view-body').textContent).not.toContain('00000000')
  })
})

describe('WebSocket editor', () => {
  it('format list: Text, JSON, XML, HTML + Binary (Base64, Hexadecimal); Beautify JSON', () => {
    useWebSocketStore.setState({ composerMode: 'json', composerContent: '{"a":1}' })
    render(<WebSocketEditor />)
    const select = screen.getByTestId('ws-format') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'text',
      'json',
      'xml',
      'html',
      'base64',
      'hex',
    ])
    fireEvent.click(screen.getByTestId('ws-beautify'))
    expect(useWebSocketStore.getState().composerContent).toBe('{\n  "a": 1\n}')
    act(() => useWebSocketStore.setState({ composerContent: '{oops' }))
    fireEvent.click(screen.getByTestId('ws-beautify'))
    expect(screen.getByTestId('ws-beautify-error')).toBeTruthy()
    fireEvent.change(select, { target: { value: 'hex' } })
    expect(screen.getByTestId('ws-binary-hint')).toBeTruthy()
    expect(screen.queryByTestId('ws-beautify')).toBeNull()
  })

  it('settings tab shows the max message size; counts ignore connection rows', () => {
    useWebSocketStore.setState({
      messages: [
        {
          id: '1',
          direction: 'system',
          event: 'connected',
          content: 'ws://x',
          contentType: 'text',
          timestamp: 1,
        },
        { id: '2', direction: 'sent', content: 'hi', contentType: 'text', timestamp: 2 },
        { id: '3', direction: 'received', content: 'AP8=', contentType: 'binary', timestamp: 3 },
      ],
    })
    render(<WebSocketEditor />)
    expect(screen.getByTestId('ws-message-counts').textContent).toBe(
      '2 messages (1 sent, 1 received)',
    )
    expect(screen.getAllByTestId('ws-message')).toHaveLength(2)
    expect(screen.getAllByTestId('ws-system')).toHaveLength(1)
    fireEvent.click(screen.getAllByTestId('ws-message')[1])
    expect(screen.getByTestId('ws-view-body').textContent).toContain('00 ff')
    fireEvent.click(screen.getByTestId('ws-tab-settings'))
    expect(screen.getByTestId('ws-settings-max-payload')).toBeTruthy()
    expect(screen.getByTestId('ws-settings-strict-ssl')).toBeTruthy()
  })

  it('shares the log toolbar, settings form and saved-messages pane with Socket.IO', () => {
    render(<WebSocketEditor />)
    render(<SocketIOEditor />)
    for (const id of ['log-search', 'log-filter-all', 'log-clear', 'saved-pane', 'saved-add']) {
      const ws = screen.getByTestId(`ws-${id}`)
      const sio = screen.getByTestId(`socketio-${id}`)
      expect(ws.className).toBe(sio.className)
    }
  })
})
