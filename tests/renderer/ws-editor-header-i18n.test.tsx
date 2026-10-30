/**
 * issue #248 — the WebSocket editor header printed a hardcoded English
 * "Connected" badge (inline hex colours) and an English "Custom Headers"
 * section, even in the Turkish UI. The header now matches its SSE sibling:
 * translated `mcp.status.connected` badge on theme tokens.
 * Fail-before: TR shows "Connected" / "Custom Headers", the badge carries hex.
 *
 * Issue #257 update: the header badge was a DUPLICATE of the connection bar's
 * `ws-status` pill and is gone (see ws-status-once-257.test.tsx). The
 * translated, token-styled "Connected" text now lives on the pill, so this
 * file asserts it there; the header row keeps only the "WebSocket" label.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import React from 'react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => React.createElement('div', { 'data-testid': 'monaco' }),
}))

import WebSocketEditor from '../../src/renderer/components/protocols/WebSocketEditor'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

const HEX = /#[0-9a-fA-F]{3,8}\b/

function show(): HTMLElement {
  useWebSocketStore.setState({ url: 'ws://127.0.0.1:3100', connectionState: 'connected' })
  render(React.createElement(WebSocketEditor))
  // The connection-state indicator is the bar's pill (issue #257).
  return screen.getByTestId('ws-status')
}

beforeEach(() => useUIStore.getState().setLocale('en'))
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('WebSocketEditor header (issue #248)', () => {
  it('TR: connected badge and headers section are Turkish, badge uses tokens', () => {
    useUIStore.getState().setLocale('tr')
    const header = show()
    expect(header).toHaveTextContent('Bağlı')
    expect(document.body.textContent).not.toMatch(/\bConnected\b|Custom Headers|\bHeaders\b/)
    // Issue #282: the request tab strip (the HTTP editor's labels).
    expect(document.body.textContent).toContain('Başlıklar')
    expect(header.className).toContain('var(--green')
    expect(header.getAttribute('style') ?? '').not.toMatch(HEX)
  })

  it('EN text unchanged', () => {
    const header = show()
    expect(header).toHaveTextContent('Connected')
    expect(document.body.textContent).toContain('Headers')
  })
})
