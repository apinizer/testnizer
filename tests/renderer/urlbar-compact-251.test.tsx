/**
 * Issue #251 — at a narrow editor width the URL field shrank to ~30 px and the
 * Send button overlapped it. The URL bar now switches to a COMPACT layout.
 *
 * CONTRACT — `UrlBar.tsx`:
 *   - root element carries `data-testid="url-bar"` and is observed with
 *     ResizeObserver on its BORDER box (`borderBoxSize[0].inlineSize`, falling
 *     back to `contentRect.width` — what this file's fake observer reports);
 *     compact mode's own padding change must not flip the decision
 *     (narrow-layout-review-251.test.tsx).
 *     compact = narrowLayoutFor(width).compactUrlBar  (lib/narrow-layout.ts,
 *     via `useCompactUrlBar(ref)` in lib/use-narrow-layout.ts). Without a
 *     ResizeObserver the bar stays in the wide layout.
 *   - the SECONDARY action is the Save button (the only non-essential control:
 *     method pill, URL, Send + its dropdown chevron stay always). Wide layout:
 *     unchanged `save-btn`. Compact layout: `save-btn` is NOT rendered; instead
 *       `url-more-btn`   icon button, aria-label = t('urlBar.more')
 *                        (EN "More actions", TR "Diğer işlemler"),
 *                        aria-haspopup="menu", aria-expanded true|false
 *       `url-more-menu`  role="menu", rendered only while open
 *       `url-more-save`  role="menuitem", label t('urlBar.save'), runs EXACTLY
 *                        what save-btn ran (unsaved/orphaned -> Save dialog;
 *                        saved -> saveActiveRequestInPlace)
 *     The menu closes on Escape, on a mousedown outside it, and after a pick.
 *   - the URL field keeps a usable minimum: some element from the URL input up
 *     to `url-bar` has style.minWidth >= 160px (the e2e spec checks real
 *     pixels: >= 200 px at 900 and 1024 px windows).
 *   - Send keeps `send-btn` in both layouts.
 *
 * jsdom cannot lay out; pixel/overlap checks live in the e2e spec
 * tests/e2e/ui/54-narrow-editor-layout-251.spec.ts.
 *
 * Red now: no `url-bar` testid, no compact mode.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/renderer/lib/platform', () => ({ isMac: () => false }))
vi.mock('../../src/renderer/lib/save-active-request', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/lib/save-active-request')>()
  return { ...real, saveActiveRequestInPlace: vi.fn() }
})

import { saveActiveRequestInPlace } from '../../src/renderer/lib/save-active-request'
import UrlBar from '../../src/renderer/components/layout/UrlBar'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import type { Tab } from '../../src/renderer/types'

type Cb = (
  entries: Array<{ target: Element; contentRect: { width: number; height: number } }>,
) => void
const observers: Array<{ cb: Cb; els: Set<Element> }> = []
class FakeResizeObserver {
  private rec: { cb: Cb; els: Set<Element> }
  constructor(cb: Cb) {
    this.rec = { cb, els: new Set() }
    observers.push(this.rec)
  }
  observe(el: Element): void {
    this.rec.els.add(el)
  }
  unobserve(el: Element): void {
    this.rec.els.delete(el)
  }
  disconnect(): void {
    this.rec.els.clear()
  }
}
function resize(el: Element, width: number): void {
  act(() => {
    for (const o of observers) {
      if (o.els.has(el)) o.cb([{ target: el, contentRect: { width, height: 44 } }])
    }
  })
}

function activate(tab: Partial<Tab>): void {
  useTabsStore.setState({
    tabs: [{ id: 'tab-1', name: 'Req', method: 'GET', url: '', protocol: 'http', ...tab } as Tab],
    activeTabId: 'tab-1',
  })
}

beforeEach(() => {
  observers.length = 0
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver
  vi.mocked(saveActiveRequestInPlace).mockReset()
  useUIStore.setState({ showEndpointSaveModal: false })
  useUIStore.getState().setLocale('en')
  activate({})
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

const bar = (): HTMLElement => screen.getByTestId('url-bar')

/** Widest min-width among the URL input and its ancestors up to the bar. */
function urlFieldMinWidth(): number {
  let el: HTMLElement | null = screen.getByTestId('url-input')
  let max = 0
  while (el && el !== bar()) {
    const px = parseFloat(el.style.minWidth || '0')
    if (Number.isFinite(px)) max = Math.max(max, px)
    el = el.parentElement
  }
  return max
}

describe('wide layout (guard: unchanged)', () => {
  it('shows the Save button, no overflow menu', () => {
    // First child, not the testid: this is a guard that is green before `url-bar` exists.
    const { container } = render(<UrlBar />)
    resize(container.firstElementChild!, 1000)
    expect(screen.getByTestId('save-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('url-more-btn')).toBeNull()
    expect(screen.getByTestId('send-btn')).toBeInTheDocument()
  })

  it('without ResizeObserver the bar stays wide', () => {
    delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver
    render(<UrlBar />)
    expect(screen.getByTestId('save-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('url-more-btn')).toBeNull()
  })
})

describe('compact layout (issue #251)', () => {
  it('moves Save into an overflow menu; Send and the URL stay', () => {
    render(<UrlBar />)
    resize(bar(), 480)
    expect(screen.queryByTestId('save-btn')).toBeNull()
    const more = screen.getByTestId('url-more-btn')
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('send-btn')).toBeInTheDocument()
    expect(screen.getByTestId('url-input')).toBeInTheDocument()
    expect(screen.getByTestId('url-method')).toBeInTheDocument()
  })

  it('the URL field keeps a usable minimum width', () => {
    render(<UrlBar />)
    resize(bar(), 480)
    expect(urlFieldMinWidth()).toBeGreaterThanOrEqual(160)
  })

  it('opens the menu, lists Save, and closes on Escape', () => {
    render(<UrlBar />)
    resize(bar(), 480)
    expect(screen.queryByTestId('url-more-menu')).toBeNull()
    fireEvent.click(screen.getByTestId('url-more-btn'))
    const menu = screen.getByTestId('url-more-menu')
    expect(menu).toHaveAttribute('role', 'menu')
    expect(screen.getByTestId('url-more-btn')).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).getByTestId('url-more-save')).toHaveTextContent('Save')
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByTestId('url-more-menu')).toBeNull()
  })

  it('closes on an outside mousedown', () => {
    render(<UrlBar />)
    resize(bar(), 480)
    fireEvent.click(screen.getByTestId('url-more-btn'))
    expect(screen.getByTestId('url-more-menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('url-more-menu')).toBeNull()
  })

  it('Save from the menu does what the Save button did: unsaved tab -> Save dialog', () => {
    render(<UrlBar />)
    resize(bar(), 480)
    fireEvent.click(screen.getByTestId('url-more-btn'))
    fireEvent.click(screen.getByTestId('url-more-save'))
    expect(useUIStore.getState().showEndpointSaveModal).toBe(true)
    expect(saveActiveRequestInPlace).not.toHaveBeenCalled()
    expect(screen.queryByTestId('url-more-menu')).toBeNull()
  })

  it('Save from the menu on a saved request writes in place', async () => {
    vi.mocked(saveActiveRequestInPlace).mockResolvedValue({ success: true })
    activate({ savedRequestId: 'sr-1' })
    render(<UrlBar />)
    resize(bar(), 480)
    fireEvent.click(screen.getByTestId('url-more-btn'))
    fireEvent.click(screen.getByTestId('url-more-save'))
    await waitFor(() => expect(saveActiveRequestInPlace).toHaveBeenCalledTimes(1))
    expect(useUIStore.getState().showEndpointSaveModal).toBe(false)
  })

  it('widening restores the Save button and drops the overflow button', () => {
    render(<UrlBar />)
    resize(bar(), 480)
    expect(screen.getByTestId('url-more-btn')).toBeInTheDocument()
    resize(bar(), 900)
    expect(screen.getByTestId('save-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('url-more-btn')).toBeNull()
  })

  it('the overflow button is labelled in English and Turkish', () => {
    render(<UrlBar />)
    resize(bar(), 480)
    expect(screen.getByTestId('url-more-btn')).toHaveAccessibleName('More actions')
    act(() => useUIStore.getState().setLocale('tr'))
    expect(screen.getByTestId('url-more-btn')).toHaveAccessibleName('Diğer işlemler')
    fireEvent.click(screen.getByTestId('url-more-btn'))
    expect(screen.getByTestId('url-more-save')).toHaveTextContent('Kaydet')
  })
})
