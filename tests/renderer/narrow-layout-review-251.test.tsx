/**
 * Issue #251 follow-ups from the review of 8d76642.
 *
 * (A) The compact URL bar flipped on and off at the threshold: compact mode
 *     narrows the bar's padding (12 -> 8 px), and the decision was taken on
 *     the CONTENT width, which the padding change itself moved (600 px bar:
 *     576 content -> compact -> 584 content -> wide -> ...). The decision is
 *     now taken on the border-box width, which padding does not change.
 * (B) Making the window narrower re-opened the right panel: a row narrower
 *     than the panel gave a negative editor width, which `narrowLayoutFor`
 *     reads as "not measured" -> wide. Only an unmeasured ROW is "wide" now;
 *     once the row is measured, an editor width <= 0 is narrow.
 * (C) The URL field's 160 px minimum sat on the inner <input>, while the flex
 *     item (VariableAutocompleteInput's wrapper) kept `min-width: 0`, so the
 *     wrapper shrank under 160 and the input spilled over Send. The minimum
 *     now sits on the outer flex item; other users of the component keep 0.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../src/renderer/lib/platform', () => ({ isMac: () => false }))

import UrlBar from '../../src/renderer/components/layout/UrlBar'
import VariableAutocompleteInput from '../../src/renderer/components/shared/VariableAutocompleteInput'
import {
  RIGHT_PANEL_COLLAPSE_BELOW,
  URL_BAR_COMPACT_BELOW,
  narrowLayoutForRow,
} from '../../src/renderer/lib/narrow-layout'
import { useRightPanelAutoCollapse } from '../../src/renderer/lib/use-narrow-layout'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import type { Tab } from '../../src/renderer/types'

interface Entry {
  target: Element
  contentRect: { width: number; height: number }
  borderBoxSize?: Array<{ inlineSize: number; blockSize: number }>
}
type Cb = (entries: Entry[]) => void
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

/**
 * Deliver what a real ResizeObserver reports for `el` at border-box `border`:
 * the content box is the border box minus the element's CURRENT horizontal
 * padding, so a padding change moves contentRect but not borderBoxSize.
 */
function deliver(el: HTMLElement, border: number): void {
  const pad =
    (parseFloat(el.style.paddingLeft || '0') || 0) + (parseFloat(el.style.paddingRight || '0') || 0)
  act(() => {
    for (const o of observers) {
      if (!o.els.has(el)) continue
      o.cb([
        {
          target: el,
          contentRect: { width: border - pad, height: 44 },
          borderBoxSize: [{ inlineSize: border, blockSize: 44 }],
        },
      ])
    }
  })
}

beforeEach(() => {
  observers.length = 0
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver
  ;(window as unknown as { api: unknown }).api = new Proxy(
    {},
    { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
  )
  useTabsStore.setState({
    tabs: [{ id: 'tab-1', name: 'Req', method: 'GET', url: '', protocol: 'http' } as Tab],
    activeTabId: 'tab-1',
  })
})
afterEach(() => cleanup())

describe('(A) the compact URL bar does not oscillate around the threshold', () => {
  // 600 px is the reviewer's case; the others sit on both sides of the threshold.
  for (const border of [URL_BAR_COMPACT_BELOW - 10, URL_BAR_COMPACT_BELOW + 4, 600, 620]) {
    it(`a ${border} px bar settles on one layout and stays there`, () => {
      render(<UrlBar />)
      const bar = screen.getByTestId('url-bar')
      const seen: string[] = []
      for (let i = 0; i < 4; i++) {
        deliver(bar, border)
        seen.push(bar.getAttribute('data-compact') ?? '')
      }
      expect(new Set(seen).size, `flipped: ${seen.join(',')}`).toBe(1)
      expect(seen[0]).toBe(border < URL_BAR_COMPACT_BELOW ? 'true' : 'false')
    })
  }
})

describe('(B) a row narrower than the panel never re-opens it', () => {
  it('narrowLayoutForRow(520, 600) collapses the panel (editor width is negative)', () => {
    expect(narrowLayoutForRow(520, 600)).toEqual({ collapseRightPanel: true, compactUrlBar: true })
  })

  it('an editor width of exactly 0 counts as narrow once the row is measured', () => {
    expect(narrowLayoutForRow(605, 600).collapseRightPanel).toBe(true)
  })

  it('only an UNMEASURED row is wide', () => {
    for (const row of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(narrowLayoutForRow(row, 600)).toEqual({
        collapseRightPanel: false,
        compactUrlBar: false,
      })
    }
  })

  it('a wide row keeps the panel', () => {
    expect(narrowLayoutForRow(600 + 5 + RIGHT_PANEL_COLLAPSE_BELOW, 600).collapseRightPanel).toBe(
      false,
    )
  })

  function Row(): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null)
    useRightPanelAutoCollapse(ref)
    return <div ref={ref} data-testid="row" />
  }

  it('shrinking the window step by step keeps the panel collapsed down to the narrowest width', () => {
    useUIStore.setState({ rightPanelWidth: 600, rightPanelNarrowCollapsed: false } as never)
    render(<Row />)
    const row = screen.getByTestId('row')
    for (const width of [1400, 1000, 800, 605, 520, 300]) {
      deliver(row, width)
      const expected = width - 600 - 5 < RIGHT_PANEL_COLLAPSE_BELOW
      expect(useUIStore.getState().rightPanelNarrowCollapsed, `row ${width}`).toBe(expected)
    }
  })
})

describe('(C) the URL minimum width holds the outer flex item', () => {
  it('UrlBar: the flex item wrapping the URL input carries the 160 px minimum', () => {
    render(<UrlBar />)
    const wrapper = screen.getByTestId('url-input').parentElement as HTMLElement
    expect(wrapper.tagName).toBe('SPAN')
    expect(parseFloat(wrapper.style.minWidth || '0')).toBeGreaterThanOrEqual(160)
  })

  it('other users of VariableAutocompleteInput keep min-width 0', () => {
    render(
      <VariableAutocompleteInput
        data-testid="plain"
        value=""
        onChange={() => {}}
        style={{ flex: 1 }}
      />,
    )
    const wrapper = screen.getByTestId('plain').parentElement as HTMLElement
    expect(parseFloat(wrapper.style.minWidth || '0')).toBe(0)
  })
})
