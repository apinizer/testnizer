/**
 * 1.6.0 screen review G-11 — the SSE log footer read "-1s" right after
 * Connect. The footer's `now` was taken when the log MOUNTED and refreshed only
 * by a 1 s interval, while `connectedAt` is stamped at connect — later — so the
 * first frame computed a negative elapsed time. Elapsed now starts at 0 on
 * connect and is clamped at 0 (`formatElapsed`, `src/shared/realtime.ts`).
 *
 * The WebSocket / Socket.IO / MQTT logs show no elapsed time (only SSE does).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

import SseEventLog from '../../src/renderer/components/protocols/SseEventLog'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { formatElapsed } from '../../src/shared/realtime'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 31, 12, 0, 0))
  useSseStore.setState({ events: [], connectionState: 'disconnected', connectedAt: null })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SSE elapsed time (G-11)', () => {
  it('starts at 0s when the connection opens after the log mounted', () => {
    render(<SseEventLog />)
    act(() => {
      vi.advanceTimersByTime(800)
    })
    act(() => {
      useSseStore.setState({ connectionState: 'connected', connectedAt: Date.now() })
    })
    expect(screen.getByTestId('sse-elapsed')).toHaveTextContent(/^0s$/)
    act(() => {
      vi.advanceTimersByTime(2100)
    })
    expect(screen.getByTestId('sse-elapsed')).toHaveTextContent(/^2s$/)
  })

  it('never formats a negative duration (a clock that is ahead)', () => {
    expect(formatElapsed(-1500)).toBe('0s')
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(61_000)).toBe('1m 1s')
    expect(formatElapsed(3_660_000)).toBe('1h 1m')
  })
})
