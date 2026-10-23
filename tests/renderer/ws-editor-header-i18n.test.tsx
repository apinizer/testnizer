/**
 * issue #248 — the WebSocket editor header printed a hardcoded English
 * "Connected" badge (inline hex colours) and an English "Custom Headers"
 * section, even in the Turkish UI. The header now matches its SSE sibling:
 * translated `mcp.status.connected` badge on theme tokens.
 * Fail-before: TR shows "Connected" / "Custom Headers", the badge carries hex.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
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
  const { container } = render(React.createElement(WebSocketEditor))
  // The header row is the editor's first child.
  return container.firstElementChild!.firstElementChild as HTMLElement
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
    const badge = Array.from(header.querySelectorAll('span')).find(
      (s) => s.textContent === 'Bağlı',
    )!
    expect(badge.className).toContain('bg-[var(--green-bg)]')
    expect(badge.getAttribute('style') ?? '').not.toMatch(HEX)
  })

  it('EN text unchanged', () => {
    const header = show()
    expect(header).toHaveTextContent('Connected')
    expect(document.body.textContent).toContain('Headers')
  })
})
