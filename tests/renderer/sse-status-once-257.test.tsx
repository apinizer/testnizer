/**
 * Issue #257 (sibling of ws-status-once-257) — the SSE editor's header carried
 * a green "Connected" badge next to the connection bar's `sse-status` pill,
 * the same duplicate the WebSocket editor had. The pill stays (it also covers
 * Connecting / Reconnecting / Error); the header keeps only the title.
 *
 * Fail-before: "Connected" appears twice for a connected stream.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import '@testing-library/jest-dom/vitest'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => React.createElement('div', { 'data-testid': 'monaco' }),
}))

import SseEditor from '../../src/renderer/components/protocols/SseEditor'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

type State = 'disconnected' | 'connecting' | 'connected' | 'error'

function show(state: State): HTMLElement {
  useSseStore.setState({
    url: 'http://127.0.0.1:3100/events',
    connectionState: state,
    reconnecting: false,
  })
  return render(React.createElement(SseEditor)).container
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

describe('SSE connection state is shown once', () => {
  it('connected: exactly one "Connected", and it is the bar pill', () => {
    const root = show('connected')
    expect(ownTextCount(root, 'Connected')).toBe(1)
    expect(screen.getByTestId('sse-status')).toHaveAttribute('data-state', 'connected')
    expect(screen.getByTestId('sse-status')).toHaveTextContent('Connected')
  })

  it('connected, Turkish: exactly one "Bağlı"', () => {
    useUIStore.getState().setLocale('tr')
    const root = show('connected')
    expect(ownTextCount(root, 'Bağlı')).toBe(1)
  })

  for (const state of ['connected', 'disconnected', 'connecting', 'error'] as const) {
    it(`${state}: the header row holds only the title`, () => {
      const root = show(state)
      const header = root.firstElementChild!.firstElementChild as HTMLElement
      expect(header.querySelectorAll('span').length).toBe(1)
      expect(screen.getByTestId('sse-status')).toHaveAttribute('data-state', state)
    })
  }
})
