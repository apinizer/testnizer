/**
 * Issue #224: the WebSocket and Socket.IO connection bars reuse the MCP / SSE
 * bars' token status pill, button tokens and i18n keys. Before, both used
 * hardcoded hex pills / inline `#fff` / `#cc2200` styles that stayed light in
 * dark mode, and hardcoded English labels ("Connected", "Disconnect"…).
 * Fail-before: no `ws-status` / `socketio-status` pill, inline hex styles, and
 * English text under the Turkish locale.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import WsConnectionBar from '../../src/renderer/components/protocols/WsConnectionBar'
import SocketIOEditor from '../../src/renderer/components/protocols/SocketIOEditor'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

type State = 'disconnected' | 'connecting' | 'connected' | 'error'
const HEX = /#[0-9a-fA-F]{3,8}\b/

function showWs(connectionState: State, errorMessage: string | null = null): void {
  useWebSocketStore.setState({ url: 'ws://127.0.0.1:3100', connectionState, errorMessage })
  render(React.createElement(WsConnectionBar))
}

function showSio(connectionState: State, errorMessage: string | null = null): void {
  useSocketIOStore.setState({ url: 'http://127.0.0.1:3300', connectionState, errorMessage })
  render(React.createElement(SocketIOEditor))
}

/** No hex in any class or inline style of the element and its descendants. */
function expectNoHex(root: HTMLElement): void {
  for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
    expect(el.getAttribute('style') ?? '').not.toMatch(HEX)
    expect(el.getAttribute('class') ?? '').not.toMatch(HEX)
  }
}

beforeEach(() => useUIStore.getState().setLocale('en'))
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('WsConnectionBar (issue #224)', () => {
  it('disconnected: token pill + Connect, no hex anywhere in the bar', () => {
    showWs('disconnected')
    const pill = screen.getByTestId('ws-status')
    expect(pill).toHaveAttribute('data-state', 'disconnected')
    expect(pill).toHaveTextContent('Disconnected')
    expect(pill.className).toContain('bg-[var(--surface)]')
    expect(pill.getAttribute('style')).toBeNull()
    const connect = screen.getByTestId('ws-connect')
    expect(connect).toHaveTextContent('Connect')
    expect(connect.className).toContain('bg-[var(--accent)]')
    expect(screen.getByTestId('ws-url')).toBeEnabled()
    expectNoHex(pill.parentElement!.parentElement!)
  })

  it('connecting: orange pill + Cancel (ws-cancel)', () => {
    showWs('connecting')
    const pill = screen.getByTestId('ws-status')
    expect(pill).toHaveTextContent('Connecting…')
    expect(pill.className).toContain('text-[var(--orange)]')
    const cancel = screen.getByTestId('ws-cancel')
    expect(cancel).toHaveTextContent('Cancel')
    expect(cancel.className).toContain('bg-[var(--mb-delete-fg)]')
    expect(screen.getByTestId('ws-url')).toBeDisabled()
  })

  it('connected: green pill + Disconnect (ws-disconnect)', () => {
    showWs('connected')
    const pill = screen.getByTestId('ws-status')
    expect(pill).toHaveTextContent(/^Connected$/)
    expect(pill.className).toContain('bg-[var(--green-bg)]')
    expect(screen.getByTestId('ws-disconnect')).toHaveTextContent('Disconnect')
    expect(screen.queryByTestId('ws-connect')).toBeNull()
  })

  it('error: red token pill and red token box, role alert, no Tailwind palette red', () => {
    showWs('error', 'Connection refused')
    expect(screen.getByTestId('ws-status').className).toContain('bg-[var(--mb-delete-bg)]')
    const box = screen.getByTestId('ws-error')
    expect(box).toHaveAttribute('role', 'alert')
    expect(box).toHaveTextContent('Connection refused')
    expect(box.className).toContain('bg-[var(--mb-delete-bg)]')
    expect(box.className).not.toMatch(/red-\d/)
  })

  it('Turkish labels', () => {
    useUIStore.getState().setLocale('tr')
    showWs('connected')
    expect(screen.getByTestId('ws-status')).toHaveTextContent(/^Bağlı$/)
    expect(screen.getByTestId('ws-disconnect')).toHaveTextContent('Bağlantıyı Kes')
    cleanup()
    showWs('connecting')
    expect(screen.getByTestId('ws-status')).toHaveTextContent('Bağlanıyor…')
    expect(screen.getByTestId('ws-cancel')).toHaveTextContent('İptal')
    cleanup()
    showWs('disconnected')
    expect(screen.getByTestId('ws-status')).toHaveTextContent('Bağlı değil')
    expect(screen.getByTestId('ws-connect')).toHaveTextContent('Bağlan')
  })
})

describe('Socket.IO connection bar (issue #224)', () => {
  it('disconnected: token pill + Connect, testids kept, no hex in the bar', () => {
    showSio('disconnected')
    const pill = screen.getByTestId('socketio-status')
    expect(pill).toHaveAttribute('data-state', 'disconnected')
    expect(pill).toHaveTextContent('Disconnected')
    expect(pill.className).toContain('bg-[var(--surface)]')
    const connect = screen.getByTestId('socketio-connect')
    expect(connect).toHaveTextContent('Connect')
    expect(connect.className).toContain('bg-[var(--accent)]')
    expect(connect.getAttribute('style')).toBeNull()
    expect(screen.getByTestId('socketio-url')).toBeEnabled()
    expect(screen.getByPlaceholderText(/Namespace/i)).toBe(screen.getByTestId('socketio-namespace'))
    expect(screen.getByTestId('socketio-bearer-token')).toBeInTheDocument()
    expect(screen.getByTestId('socketio-token-hint')).toBeInTheDocument()
    expectNoHex(screen.getByTestId('socketio-connection-row'))
  })

  it('connecting: Cancel on the same socketio-connect button', () => {
    showSio('connecting')
    expect(screen.getByTestId('socketio-status')).toHaveTextContent('Connecting…')
    const btn = screen.getByTestId('socketio-connect')
    expect(btn).toHaveTextContent('Cancel')
    expect(btn.className).toContain('bg-[var(--mb-delete-fg)]')
  })

  it('connected: green pill + Disconnect, inputs locked', () => {
    showSio('connected')
    const pill = screen.getByTestId('socketio-status')
    expect(pill).toHaveTextContent(/^Connected$/)
    expect(pill.className).toContain('bg-[var(--green-bg)]')
    expect(screen.getByTestId('socketio-connect')).toHaveTextContent('Disconnect')
    expect(screen.getByTestId('socketio-url')).toBeDisabled()
    expect(screen.getByTestId('socketio-namespace')).toBeDisabled()
  })

  it('error: red token pill + red token error line, role alert', () => {
    showSio('error', 'xhr poll error')
    expect(screen.getByTestId('socketio-status').className).toContain('bg-[var(--mb-delete-bg)]')
    const err = screen.getByTestId('socketio-error')
    expect(err).toHaveAttribute('role', 'alert')
    expect(err).toHaveTextContent('xhr poll error')
    expect(err.className).toContain('text-[var(--red)]')
    expect(err.getAttribute('style')).toBeNull()
  })

  it('Turkish labels', () => {
    useUIStore.getState().setLocale('tr')
    showSio('connected')
    expect(screen.getByTestId('socketio-status')).toHaveTextContent(/^Bağlı$/)
    expect(screen.getByTestId('socketio-connect')).toHaveTextContent('Bağlantıyı Kes')
    cleanup()
    showSio('connecting')
    expect(screen.getByTestId('socketio-connect')).toHaveTextContent('İptal')
    cleanup()
    showSio('disconnected')
    expect(screen.getByTestId('socketio-status')).toHaveTextContent('Bağlı değil')
    expect(screen.getByTestId('socketio-connect')).toHaveTextContent('Bağlan')
  })
})
