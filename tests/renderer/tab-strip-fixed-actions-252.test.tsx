/**
 * Issue #252 — the environment selector and the new-tab "+" button sat INSIDE
 * the scrolling tab strip: with 63 tabs they were at x≈5800, off screen.
 *
 * CONTRACT (Workbench.tsx `EndpointTabBar`; ONE component mounted by every
 * sidebar page — APIs, Mocks, MCP, Tests — so a single fix covers them all):
 *
 *   <div data-testid="tab-bar">                       outer row: flex, h 32, border-bottom
 *     <div data-testid="tab-strip" class="scroll-strip flex-1 min-w-0 ...">
 *        endpoint-tab * N                              ONLY the tabs ...
 *        <div data-testid="tab-strip-drop-end"/>       ... and the "drop at end" zone
 *     </div>
 *     <div data-testid="tab-actions" class="shrink-0">  fixed action group, right edge
 *        <button data-testid="tab-new"/>
 *        <div data-testid="env-selector"><EnvironmentSelector/></div>
 *     </div>
 *   </div>
 *
 *  - `tab-strip` keeps `.scroll-strip`, the 32 px height, the wheel→horizontal
 *    mapping and `scrollIntoView` of the active tab (tab-strip-scroll.test.tsx
 *    must stay green unchanged).
 *  - `tab-new` and `env-selector` are NOT descendants of `tab-strip`.
 *  - the unsaved-changes dialog / context menu are portalled or siblings; they
 *    must not end up inside the scroller either.
 *
 * Red now: no `tab-bar`, `tab-actions`, `env-selector`, `tab-strip-drop-end`.
 * Guard tests (green now, must stay green) are marked "guard".
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
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

const TAB_DND_MIME = 'application/testnizer-tab'

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

function manyTabs(n: number): Tab[] {
  return Array.from({ length: n }, (_, i) => tab(`t${i + 1}`))
}

beforeEach(() => {
  ;(Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = vi.fn()
  useTabsStore.setState({ tabs: manyTabs(63), activeTabId: 't63' })
})

afterEach(() => {
  cleanup()
  delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
})

describe('issue #252 — fixed action group next to the scrolling tabs', () => {
  it('renders tab-bar > [tab-strip, tab-actions] as siblings', () => {
    render(<EndpointTabBar />)
    const bar = screen.getByTestId('tab-bar')
    const strip = screen.getByTestId('tab-strip')
    const actions = screen.getByTestId('tab-actions')
    expect(strip.parentElement).toBe(bar)
    expect(actions.parentElement).toBe(bar)
    expect(strip.contains(actions)).toBe(false)
    expect(actions.contains(strip)).toBe(false)
  })

  it('the "+" button and the environment selector are NOT inside the scrolling element (63 tabs)', () => {
    render(<EndpointTabBar />)
    const strip = screen.getByTestId('tab-strip')
    const plus = screen.getByTestId('tab-new')
    const env = screen.getByTestId('env-selector')
    expect(screen.getAllByTestId('endpoint-tab')).toHaveLength(63)
    expect(strip.contains(plus)).toBe(false)
    expect(strip.contains(env)).toBe(false)
    const actions = screen.getByTestId('tab-actions')
    expect(actions.contains(plus)).toBe(true)
    expect(actions.contains(env)).toBe(true)
  })

  it('the action group cannot shrink and the scroller can (flex contract)', () => {
    render(<EndpointTabBar />)
    expect(screen.getByTestId('tab-actions').className).toMatch(/\bshrink-0\b/)
    const strip = screen.getByTestId('tab-strip')
    // min-w-0 is what lets a flex child scroll instead of widening the row.
    expect(strip.className).toMatch(/\bmin-w-0\b/)
    expect(strip.className).toMatch(/\bflex-1\b/)
  })

  it('the environment selector wrapper hosts the real selector (its toggle button)', () => {
    render(<EndpointTabBar />)
    const env = screen.getByTestId('env-selector')
    // EnvironmentSelector renders two buttons: the dropdown pill and the eye.
    expect(env.querySelectorAll('button').length).toBeGreaterThanOrEqual(2)
  })

  it('the zero-tab strip still shows the "+" (issue #97) and the selector', () => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
    render(<EndpointTabBar />)
    expect(screen.getByTestId('tab-new')).toBeTruthy()
    expect(screen.getByTestId('env-selector')).toBeTruthy()
    expect(screen.queryAllByTestId('endpoint-tab')).toHaveLength(0)
  })

  it('"+" still opens a new tab from its new place', () => {
    useTabsStore.setState({ tabs: [tab('only')], activeTabId: 'only' })
    render(<EndpointTabBar />)
    fireEvent.click(screen.getByTestId('tab-new'))
    expect(useTabsStore.getState().tabs.length).toBe(2)
  })

  it('keeps a "drop at end" zone INSIDE the scroller and it still moves a tab to the end', () => {
    useTabsStore.setState({ tabs: [tab('a'), tab('b'), tab('c')], activeTabId: 'a' })
    render(<EndpointTabBar />)
    const strip = screen.getByTestId('tab-strip')
    const zone = screen.getByTestId('tab-strip-drop-end')
    expect(strip.contains(zone)).toBe(true)
    const dataTransfer = {
      types: [TAB_DND_MIME],
      getData: (mime: string) => (mime === TAB_DND_MIME ? 'a' : ''),
      dropEffect: '',
      effectAllowed: '',
      setData: () => {},
    }
    fireEvent.dragOver(zone, { dataTransfer })
    fireEvent.drop(zone, { dataTransfer })
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('guard — what #241 / #97 established must survive the move', () => {
  it('tab-strip is still the .scroll-strip element, 32 px high, holding the tabs', () => {
    render(<EndpointTabBar />)
    const strip = screen.getByTestId('tab-strip')
    expect(strip.classList.contains('scroll-strip')).toBe(true)
    expect(strip.style.height).toBe('32px')
    for (const t of screen.getAllByTestId('endpoint-tab')) expect(strip.contains(t)).toBe(true)
  })
})
