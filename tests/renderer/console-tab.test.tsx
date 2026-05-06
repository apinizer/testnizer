/// <reference types="react" />
import * as React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Suppress "React is not defined" — the renderer tsconfig uses
// jsx: react-jsx, but vitest's transform here does not. Make the
// runtime React reference live on globalThis so JSX can compile.
;(globalThis as unknown as { React: typeof React }).React = React
import ConsoleTab from '../../src/renderer/components/response/ConsoleTab'
import { useConsoleStore } from '../../src/renderer/stores/console.store'

describe('ConsoleTab — virtualization', () => {
  beforeEach(() => {
    useConsoleStore.getState().clear()
    cleanup()

    // jsdom does not implement getBoundingClientRect dimensions; stub
    // ResizeObserver and a non-zero scroll container so @tanstack/react-virtual
    // can compute its window.
    if (!('ResizeObserver' in globalThis)) {
      ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        }
    }
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 600
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return 600
      },
    })
    HTMLElement.prototype.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  })

  it('renders 1000 entries without rendering them all (virtualized)', () => {
    const store = useConsoleStore.getState()
    for (let i = 0; i < 1000; i++) {
      store.addEntry({
        protocol: 'http',
        level: 'success',
        category: 'response',
        method: 'GET',
        url: `https://example.com/${i}`,
        status: 200,
        message: `GET https://example.com/${i} → 200`,
        durationMs: 10 + i,
      })
    }
    expect(useConsoleStore.getState().entries.length).toBe(1000)

    // Disable auto-scroll so the virtualizer doesn't try to chase the tail.
    useConsoleStore.getState().setAutoScroll(false)
    render(<ConsoleTab />)
    const list = screen.getByTestId('console-list')
    // Virtualizer should render only a slice of rows — far less than the
    // full 1000-entry buffer. Exact count is jsdom-specific (the
    // viewport size estimator returns the full container height) but
    // it must be strictly less than the dataset.
    const rows = list.querySelectorAll('[data-index]')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(useConsoleStore.getState().entries.length)
  })

  it('shows the empty state when there are no entries', () => {
    render(<ConsoleTab />)
    expect(
      screen.getByText(/no console entries yet/i),
    ).toBeInTheDocument()
  })

  it('per-tab filter only shows matching entries', () => {
    const store = useConsoleStore.getState()
    store.addEntry({
      protocol: 'http',
      level: 'success',
      category: 'response',
      method: 'GET',
      url: 'https://a',
      status: 200,
      message: 'A',
      tabId: 'tab-A',
    })
    store.addEntry({
      protocol: 'http',
      level: 'success',
      category: 'response',
      method: 'GET',
      url: 'https://b',
      status: 200,
      message: 'B',
      tabId: 'tab-B',
    })
    render(<ConsoleTab tabFilterId="tab-A" />)
    const list = screen.getByTestId('console-list')
    const rows = list.querySelectorAll('[data-index]')
    expect(rows.length).toBe(1)
  })
})
