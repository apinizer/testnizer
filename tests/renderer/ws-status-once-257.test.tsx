/**
 * Issue #257 (item: WebSocket shows the connection state twice) — the editor
 * header carried a green "Connected" badge AND the connection bar had the
 * `ws-status` pill. The bar pill stays (it covers all four states and is the
 * same component MCP/SSE-bar/Socket.IO use); the header badge is removed.
 *
 * CONTRACT: WebSocketEditor shows the state exactly once, in `ws-status`
 * (data-state mirrors the store). The header row keeps only the "WebSocket"
 * label. ws-editor-header-i18n.test.tsx was updated to read the text from the
 * pill.
 *
 * Sibling note (NOT asserted here, reported to the orchestrator): SseEditor.tsx
 * has the identical header badge next to `sse-status`. Per the sibling
 * consistency rule it should lose it too; the issue only names WebSocket.
 *
 * Red now: "Connected" appears twice for a connected socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import '@testing-library/jest-dom/vitest'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => React.createElement('div', { 'data-testid': 'monaco' }),
}))

import WebSocketEditor from '../../src/renderer/components/protocols/WebSocketEditor'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

type State = 'disconnected' | 'connecting' | 'connected' | 'error'
const LABEL: Record<State, Record<'en' | 'tr', string>> = {
  disconnected: { en: 'Disconnected', tr: 'Bağlı değil' },
  connecting: { en: 'Connecting', tr: 'Bağlanıyor' },
  connected: { en: 'Connected', tr: 'Bağlı' },
  error: { en: 'Error', tr: 'Hata' },
}

function show(state: State): HTMLElement {
  useWebSocketStore.setState({
    url: 'ws://127.0.0.1:3100',
    connectionState: state,
    errorMessage: state === 'error' ? 'boom' : null,
  })
  return render(React.createElement(WebSocketEditor)).container
}

/** Elements whose OWN text is exactly `text` (so wrappers do not double count). */
function ownTextCount(root: HTMLElement, text: string): number {
  return Array.from(root.querySelectorAll('*')).filter(
    (el) =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent?.trim())
        .join('') === text,
  ).length
}

beforeEach(() => useUIStore.getState().setLocale('en'))
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('WebSocket connection state is shown once', () => {
  it('connected: exactly one "Connected", and it is the bar pill', () => {
    const root = show('connected')
    expect(ownTextCount(root, 'Connected')).toBe(1)
    expect(screen.getByTestId('ws-status')).toHaveAttribute('data-state', 'connected')
    expect(screen.getByTestId('ws-status')).toHaveTextContent('Connected')
  })

  it('connected, Turkish: exactly one "Bağlı"', () => {
    useUIStore.getState().setLocale('tr')
    const root = show('connected')
    expect(ownTextCount(root, 'Bağlı')).toBe(1)
  })

  it('the header row holds only the title (no state badge)', () => {
    const root = show('connected')
    const header = root.firstElementChild!.firstElementChild as HTMLElement
    expect(header).toHaveTextContent('WebSocket')
    expect(header).not.toHaveTextContent('Connected')
    expect(header.querySelectorAll('span').length).toBe(1)
  })

  for (const state of ['disconnected', 'connecting', 'error'] as const) {
    it(`${state}: still one indicator (the pill) and no header badge`, () => {
      const root = show(state)
      expect(screen.getByTestId('ws-status')).toHaveAttribute('data-state', state)
      expect(screen.getByTestId('ws-status')).toHaveTextContent(LABEL[state].en)
      const header = root.firstElementChild!.firstElementChild as HTMLElement
      expect(header.querySelectorAll('span').length).toBe(1)
    })
  }

  it('guard: the pill still carries theme tokens, no hex (issue #224)', () => {
    show('connected')
    const pill = screen.getByTestId('ws-status')
    expect(pill.className).toContain('bg-[var(--green-bg)]')
    expect(pill.getAttribute('style')).toBeNull()
  })
})
