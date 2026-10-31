/**
 * Issue #252 follow-up — opening a blank "+" tab swaps the editor next to the
 * tab bar (the right-panel rail disappears, so the strip widens by 40 px AFTER
 * the active tab was scrolled into view). The strip must re-reveal the active
 * tab when it is resized, otherwise the new tab ends up clipped at the right.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useScrollStrip } from '../../src/renderer/lib/use-scroll-strip'

type RoCallback = () => void
const observers: RoCallback[] = []

class FakeResizeObserver {
  private readonly cb: RoCallback
  constructor(cb: RoCallback) {
    this.cb = cb
  }
  observe(): void {
    observers.push(this.cb)
  }
  disconnect(): void {
    const i = observers.indexOf(this.cb)
    if (i >= 0) observers.splice(i, 1)
  }
  unobserve(): void {}
}

const scrollIntoView = vi.fn()

function Strip({ activeKey }: { activeKey: string }) {
  const ref = useScrollStrip<HTMLDivElement>(activeKey)
  return (
    <div ref={ref} data-testid="strip">
      <div data-active="false" />
      <div data-active="true" />
    </div>
  )
}

beforeEach(() => {
  observers.length = 0
  scrollIntoView.mockReset()
  ;(Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver
})

afterEach(() => {
  cleanup()
  delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver
})

describe('useScrollStrip resize', () => {
  it('scrolls the active tab into view again when the strip is resized', () => {
    render(<Strip activeKey="a" />)
    expect(observers).toHaveLength(1)
    scrollIntoView.mockClear()
    act(() => observers[0]())
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  it('stops observing on unmount', () => {
    const { unmount } = render(<Strip activeKey="a" />)
    unmount()
    expect(observers).toHaveLength(0)
  })

  it('still works without ResizeObserver', () => {
    delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver
    expect(() => render(<Strip activeKey="a" />)).not.toThrow()
    expect(scrollIntoView).toHaveBeenCalled()
  })
})
