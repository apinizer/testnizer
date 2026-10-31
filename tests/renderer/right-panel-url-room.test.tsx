/**
 * Issue #251 follow-up — an OPEN right panel (including one the user opened by
 * hand on a narrow row) must leave the URL bar the room its compact layout
 * needs: padding + method + gap + URL floor + Send split + overflow button
 * (`URL_BAR_MIN_BUDGET`, composed in lib/narrow-layout.ts from the same
 * numbers UrlBar uses).
 *
 *   rendered width = min(stored, max(PANEL_MIN, row − EDGE_HANDLE_PX − URL_BAR_MIN_BUDGET))
 *
 * Only the RENDERED width is clamped; the stored preference is never written.
 * Below a row of PANEL_MIN + EDGE + budget the panel keeps PANEL_MIN and the
 * URL bar may clip (accepted at that extreme).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/runner/RunnerVariables', () => ({
  default: () => <div data-testid="stub-variables" />,
}))
vi.mock('../../src/renderer/components/layout/GenerateCodePane', () => ({
  default: () => <div data-testid="stub-code" />,
}))

import {
  EDGE_HANDLE_PX,
  RIGHT_PANEL_MAX_PX,
  RIGHT_PANEL_MIN_PX,
  URL_BAR_COMPACT_METHOD_MIN_PX,
  URL_BAR_COMPACT_PAD_X_PX,
  URL_BAR_COMPACT_SEND_GAP_PX,
  URL_BAR_MIN_BUDGET,
  URL_BAR_OVERFLOW_PX,
  URL_BAR_SEND_SPLIT_PX,
  URL_FIELD_MIN_PX,
  rightPanelDragClamp,
  rightPanelRenderedWidth,
  rightPanelRoomMax,
} from '../../src/renderer/lib/narrow-layout'
import WorkbenchMainRow from '../../src/renderer/components/layout/WorkbenchMainRow'
import { useUIStore } from '../../src/renderer/stores/ui.store'

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
      if (o.els.has(el)) o.cb([{ target: el, contentRect: { width, height: 600 } }])
    }
  })
}

const room = (row: number): number => row - EDGE_HANDLE_PX - URL_BAR_MIN_BUDGET

describe('URL_BAR_MIN_BUDGET', () => {
  it('is composed from the compact URL bar pieces', () => {
    expect(URL_BAR_MIN_BUDGET).toBe(
      2 * URL_BAR_COMPACT_PAD_X_PX +
        URL_BAR_COMPACT_METHOD_MIN_PX +
        URL_BAR_COMPACT_SEND_GAP_PX +
        URL_FIELD_MIN_PX +
        URL_BAR_SEND_SPLIT_PX +
        URL_BAR_OVERFLOW_PX,
    )
    expect(URL_FIELD_MIN_PX).toBe(160)
  })
})

describe('rightPanelRoomMax / rightPanelRenderedWidth', () => {
  it('leaves the URL bar its budget when the row allows it', () => {
    expect(rightPanelRoomMax(700)).toBe(room(700))
    expect(rightPanelRenderedWidth(700, 300)).toBe(room(700))
    expect(700 - EDGE_HANDLE_PX - rightPanelRenderedWidth(700, 300)).toBe(URL_BAR_MIN_BUDGET)
  })

  it('a too-narrow row keeps PANEL_MIN', () => {
    expect(room(641)).toBeLessThan(RIGHT_PANEL_MIN_PX)
    expect(rightPanelRoomMax(641)).toBe(RIGHT_PANEL_MIN_PX)
    expect(rightPanelRenderedWidth(641, 300)).toBe(RIGHT_PANEL_MIN_PX)
  })

  it('a wide row keeps the stored width and never exceeds the static max', () => {
    expect(rightPanelRenderedWidth(1400, 300)).toBe(300)
    expect(rightPanelRoomMax(2000)).toBe(RIGHT_PANEL_MAX_PX)
  })

  it('an unmeasured row keeps the stored width', () => {
    for (const row of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rightPanelRenderedWidth(row, 300)).toBe(300)
    }
  })

  it('a hand-opened drag is capped at the same value', () => {
    const clamp = rightPanelDragClamp(900, 300, RIGHT_PANEL_MIN_PX, RIGHT_PANEL_MAX_PX)
    expect(clamp(400)).toBe(400)
    expect(clamp(600)).toBe(room(900))
  })
})

describe('WorkbenchMainRow renders the panel within the room it leaves', () => {
  let setSpy: ReturnType<typeof vi.fn>
  beforeEach(() => {
    observers.length = 0
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver
    setSpy = vi.fn(async () => ({ success: true }))
    ;(window as unknown as { api: unknown }).api = {
      settings: { get: vi.fn(async () => ({ success: true, data: undefined })), set: setSpy },
    }
    useUIStore.setState({
      rightPanelWidth: 300,
      rightPanelCollapsed: false,
      rightPanelNarrowCollapsed: false,
    } as never)
  })
  afterEach(() => cleanup())

  /** Measure the row, then open the panel by hand from the rail, as a user does. */
  function openByHandAt(row: number): HTMLElement {
    render(
      <WorkbenchMainRow>
        <div data-testid="editor" />
      </WorkbenchMainRow>,
    )
    resize(screen.getByTestId('workbench-main-row'), row)
    const rail = screen.queryByTestId('right-panel-rail-variables')
    if (rail) fireEvent.click(rail)
    return screen.getByTestId('right-panel')
  }

  it(`row 700: a stored 300 px panel renders docked at ${room(700)} px; the preference stays 300`, () => {
    const panel = openByHandAt(700)
    expect(panel.getAttribute('data-mode')).toBe('docked')
    expect(parseFloat(panel.style.width)).toBe(room(700))
    expect(parseFloat(panel.style.width)).toBeLessThan(300)
    expect(useUIStore.getState().rightPanelWidth).toBe(300)
    expect(setSpy.mock.calls.filter((c) => c[0] === 'ui.rightPanelWidth')).toEqual([])
  })

  // Row 641 (1024 px window, 300 px sidebar): docking even a PANEL_MIN panel
  // leaves the editor under the URL bar's budget, so it used to render docked
  // at 240 px and the editor was cut. It is now an overlay drawer at the stored
  // width over a full-width editor (right-panel-overlay-251.test.tsx).
  it('row 641: too narrow to dock — overlay at the stored width; the preference stays 300', () => {
    expect(room(641)).toBeLessThan(RIGHT_PANEL_MIN_PX)
    const panel = openByHandAt(641)
    expect(panel.getAttribute('data-mode')).toBe('overlay')
    expect(parseFloat(panel.style.width)).toBe(300)
    expect(useUIStore.getState().rightPanelWidth).toBe(300)
    expect(setSpy.mock.calls.filter((c) => c[0] === 'ui.rightPanelWidth')).toEqual([])
  })

  it('a wide row renders the stored width', () => {
    const panel = openByHandAt(1400)
    expect(parseFloat(panel.style.width)).toBe(300)
  })

  it('a drag starts from the RENDERED width (no dead zone)', () => {
    openByHandAt(700)
    const handle = screen.getByRole('separator')
    const row = screen.getByTestId('workbench-main-row')
    row.getBoundingClientRect = () =>
      ({ width: 700, height: 600, top: 0, left: 0, right: 700, bottom: 600, x: 0, y: 0 }) as DOMRect
    // Right divider moved 10 px right = 10 px narrower than what is on screen.
    fireEvent.mouseDown(handle, { clientX: 300 })
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 310 }))
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 310 }))
    })
    expect(useUIStore.getState().rightPanelWidth).toBe(room(700) - 10)
  })
})
