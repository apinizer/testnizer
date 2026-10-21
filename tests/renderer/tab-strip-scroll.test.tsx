/**
 * Issue #241 — when open tabs overflowed, a horizontal scrollbar appeared under
 * the tab strip and shifted the editor down (the request sub-tab row had no
 * fixed height, so the bar grew it; the 32 px request tab strip lost 6 px of
 * its own box instead).
 *
 * Contract asserted here:
 *  - the strips carry `.scroll-strip` (globals.css: no scrollbar, overflow-y
 *    hidden) instead of a plain `overflow-x: auto`;
 *  - a vertical wheel over an overflowing strip scrolls it sideways (and is
 *    cancelled so nothing else scrolls); a horizontal gesture is left native;
 *  - the active tab is scrolled into view with `block: 'nearest'`.
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { wheelToHorizontal } from '../../src/renderer/lib/use-scroll-strip'
import type { Tab } from '../../src/renderer/types'

vi.mock('../../src/renderer/lib/activate-tab', () => ({
  activateTabStores: vi.fn(),
  switchActiveTab: vi.fn(),
}))
vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))

const anyApi: unknown = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
)
;(window as unknown as { api: unknown }).api = anyApi

const { EndpointTabBar } = await import('../../src/renderer/components/layout/Workbench')
const { default: RequestEditor } =
  await import('../../src/renderer/components/request/RequestEditor')

function tab(id: string): Tab {
  return {
    id,
    name: id,
    protocol: 'http',
    method: 'GET',
    url: '',
    isDirty: false,
    isLoading: false,
  } as Tab
}

const scrollIntoView = vi.fn()

beforeEach(() => {
  scrollIntoView.mockReset()
  ;(Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView
  useTabsStore.setState({ tabs: [tab('t1'), tab('t2'), tab('t3')], activeTabId: 't1' })
})

afterEach(() => {
  cleanup()
  delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
})

/** Pretend the strip is 300 px wide with 900 px of tabs in it. */
function makeOverflowing(el: HTMLElement): void {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 900 })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 300 })
}

function wheel(el: HTMLElement, init: WheelEventInit): WheelEvent {
  const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(ev)
  return ev
}

describe('wheelToHorizontal', () => {
  const overflowing = { scrollWidth: 900, clientWidth: 300 }

  it('maps a vertical wheel to horizontal movement', () => {
    expect(wheelToHorizontal({ deltaX: 0, deltaY: 40 }, overflowing)).toBe(40)
    expect(wheelToHorizontal({ deltaX: 0, deltaY: -40 }, overflowing)).toBe(-40)
  })

  it('converts line-mode deltas to pixels', () => {
    expect(wheelToHorizontal({ deltaX: 0, deltaY: 3, deltaMode: 1 }, overflowing)).toBe(48)
  })

  it('leaves horizontal gestures (trackpad, Shift+wheel) to the browser', () => {
    expect(wheelToHorizontal({ deltaX: 30, deltaY: 5 }, overflowing)).toBeNull()
  })

  it('does nothing when the strip does not overflow', () => {
    expect(
      wheelToHorizontal({ deltaX: 0, deltaY: 40 }, { scrollWidth: 300, clientWidth: 300 }),
    ).toBeNull()
  })
})

describe('request tab strip (Workbench)', () => {
  it('uses the scrollbar-less strip class, not a plain overflow-x: auto', () => {
    render(<EndpointTabBar />)
    const strip = screen.getByTestId('tab-strip')
    expect(strip.classList.contains('scroll-strip')).toBe(true)
    expect(strip.style.overflowX).toBe('')
    expect(strip.style.height).toBe('32px')
  })

  it('scrolls sideways on a vertical wheel and cancels the event', () => {
    render(<EndpointTabBar />)
    const strip = screen.getByTestId('tab-strip')
    makeOverflowing(strip)
    const ev = wheel(strip, { deltaY: 60 })
    expect(ev.defaultPrevented).toBe(true)
    expect(strip.scrollLeft).toBe(60)
  })

  it('leaves a horizontal trackpad swipe alone', () => {
    render(<EndpointTabBar />)
    const strip = screen.getByTestId('tab-strip')
    makeOverflowing(strip)
    const ev = wheel(strip, { deltaX: 50, deltaY: 2 })
    expect(ev.defaultPrevented).toBe(false)
    expect(strip.scrollLeft).toBe(0)
  })

  it('scrolls the active tab into view when it changes, without vertical scroll', () => {
    render(<EndpointTabBar />)
    scrollIntoView.mockClear()
    act(() => useTabsStore.setState({ activeTabId: 't3' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    const target = scrollIntoView.mock.contexts.at(-1) as HTMLElement
    expect(target.getAttribute('data-tab-name')).toBe('t3')
  })
})

describe('request editor sub-tab row (sibling)', () => {
  it('uses the same strip class and wheel mapping', () => {
    render(<RequestEditor />)
    const strip = screen.getByTestId('req-tab-strip')
    expect(strip.classList.contains('scroll-strip')).toBe(true)
    expect(strip.className).not.toMatch(/overflow-x-auto/)
    makeOverflowing(strip)
    const ev = wheel(strip, { deltaY: 30 })
    expect(ev.defaultPrevented).toBe(true)
    expect(strip.scrollLeft).toBe(30)
  })
})

describe('globals.css .scroll-strip', () => {
  const css = readFileSync(resolve(__dirname, '../../src/renderer/styles/globals.css'), 'utf8')

  it('hides the scrollbar and pins overflow-y (no layout-affecting bar)', () => {
    const rule = css.match(/\.scroll-strip\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/overflow-x:\s*auto/)
    expect(rule).toMatch(/overflow-y:\s*hidden/)
    expect(rule).toMatch(/scrollbar-width:\s*none/)
    expect(css).toMatch(/\.scroll-strip::-webkit-scrollbar\s*\{\s*display:\s*none/)
  })

  it('is not inside a cascade layer (must beat Tailwind utilities)', () => {
    const idx = css.indexOf('.scroll-strip {')
    const before = css.slice(0, idx)
    const opened = (before.match(/@layer[^{;]*\{/g) ?? []).length
    expect(opened).toBe(0)
  })
})
