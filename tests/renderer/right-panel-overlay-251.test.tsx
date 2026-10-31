/**
 * Issue #251 follow-up — a right panel the user opens BY HAND on a row too
 * narrow to dock it (editor >= URL_BAR_MIN_BUDGET next to a panel of at least
 * RIGHT_PANEL_MIN_PX) is drawn as an OVERLAY drawer on the row's right edge;
 * the editor keeps the full row width underneath. Seen at 900x700 with a
 * 300 px sidebar: the docked 240 px panel left the editor ~270 px, its content
 * overflowed the overflow-hidden column, focus scrolled the column sideways
 * and the method / URL start / tab strip / Key/Value table were cut on the left.
 *
 *   rightPanelMode(row, stored): 'overlay' when a MEASURED row is below
 *     URL_BAR_MIN_BUDGET + EDGE_HANDLE_PX + min(stored, RIGHT_PANEL_MIN_PX),
 *     else 'docked' (unmeasured row -> docked).
 *   rightPanelOverlayWidth(row, stored) = min(stored, row - 48)
 *
 * The mode switch never writes the stored width or the open/closed preference;
 * no resize handle in overlay mode; Escape closes the overlay only when it is
 * pressed inside the panel. The editor column and row clip (never scroll) so
 * focus cannot shift the editor sideways.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/runner/RunnerVariables', () => ({
  default: () => (
    <div data-testid="stub-variables">
      <input data-testid="stub-input" />
    </div>
  ),
}))
vi.mock('../../src/renderer/components/layout/GenerateCodePane', () => ({
  default: () => <div data-testid="stub-code" />,
}))

import {
  EDGE_HANDLE_PX,
  RIGHT_PANEL_MIN_PX,
  RIGHT_PANEL_OVERLAY_EDITOR_STRIP_PX,
  URL_BAR_MIN_BUDGET,
  rightPanelMode,
  rightPanelOverlayWidth,
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

const DOCK_MIN_ROW = URL_BAR_MIN_BUDGET + EDGE_HANDLE_PX + RIGHT_PANEL_MIN_PX

describe('rightPanelMode', () => {
  it('docks on wide rows and exactly at the threshold', () => {
    expect(DOCK_MIN_ROW).toBe(662)
    for (const row of [DOCK_MIN_ROW, 700, 1017, 2000]) {
      expect(rightPanelMode(row, 300)).toBe('docked')
    }
  })

  it('overlays when the row cannot leave the URL bar its budget next to a minimum panel', () => {
    // 900x700 window, 300 px sidebar -> ~517 px row; 1024 -> ~641.
    for (const row of [DOCK_MIN_ROW - 1, 641, 517, 300, 1]) {
      expect(rightPanelMode(row, 300)).toBe('overlay')
    }
  })

  it('an unmeasured row is docked', () => {
    for (const row of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rightPanelMode(row, 300)).toBe('docked')
    }
  })
})

describe('rightPanelOverlayWidth', () => {
  it('is the stored width, leaving a visible editor strip on a narrow row', () => {
    expect(RIGHT_PANEL_OVERLAY_EDITOR_STRIP_PX).toBe(48)
    expect(rightPanelOverlayWidth(517, 300)).toBe(300)
    expect(rightPanelOverlayWidth(320, 300)).toBe(320 - 48)
    expect(rightPanelOverlayWidth(20, 300)).toBe(0)
  })
})

describe('WorkbenchMainRow — overlay drawer', () => {
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
      rightPanelCollapsed: true,
      rightPanelNarrowCollapsed: false,
      rightPanelTab: 'variables',
    } as never)
  })
  afterEach(() => cleanup())

  function openByHandAt(row: number): HTMLElement {
    render(
      <WorkbenchMainRow>
        <button data-testid="editor-btn">editor</button>
      </WorkbenchMainRow>,
    )
    resize(screen.getByTestId('workbench-main-row'), row)
    fireEvent.click(screen.getByTestId('right-panel-rail-variables'))
    return screen.getByTestId('right-panel')
  }

  const widthWrites = (): unknown[] =>
    setSpy.mock.calls.filter((c) => c[0] === 'ui.rightPanelWidth')

  it('900 px window (517 px row): overlay drawer at the stored width, no resize handle', () => {
    const panel = openByHandAt(517)
    expect(panel.getAttribute('data-mode')).toBe('overlay')
    expect(panel.className).toContain('absolute')
    expect(panel.className).toContain('right-0')
    expect(panel.className).toContain('shadow-[var(--shadow-drop)]')
    expect(panel.className).toContain('border-l')
    expect(parseFloat(panel.style.width)).toBe(300)
    expect(screen.queryByRole('separator')).toBeNull()
    // The row anchors the drawer; the stored width is never written.
    expect(screen.getByTestId('workbench-main-row').className).toContain('relative')
    expect(useUIStore.getState().rightPanelWidth).toBe(300)
    expect(widthWrites()).toEqual([])
  })

  it('a wide row docks it with the resize handle, and widening re-docks without writing', () => {
    const panel = openByHandAt(517)
    expect(panel.getAttribute('data-mode')).toBe('overlay')
    resize(screen.getByTestId('workbench-main-row'), 1100)
    const docked = screen.getByTestId('right-panel')
    expect(docked.getAttribute('data-mode')).toBe('docked')
    expect(docked.className).not.toContain('absolute')
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(useUIStore.getState().rightPanelWidth).toBe(300)
    expect(useUIStore.getState().rightPanelCollapsed).toBe(false)
    expect(widthWrites()).toEqual([])
  })

  it('Escape inside the overlay closes it', () => {
    openByHandAt(517)
    const input = screen.getByTestId('stub-input')
    input.focus()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('right-panel')).toBeNull()
    expect(screen.getByTestId('right-panel-rail')).toBeTruthy()
  })

  it('opened from the rail, focus lands in the drawer so Escape works right away', () => {
    const panel = openByHandAt(517)
    expect(document.activeElement).toBe(panel)
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(screen.queryByTestId('right-panel')).toBeNull()
  })

  it('a resize into overlay does not steal focus from the editor', () => {
    // Opened by hand at a narrow-but-dockable row, then shrunk further (no
    // auto-collapse crossing, so the hand-opened panel stays open).
    expect(rightPanelMode(700, 300)).toBe('docked')
    openByHandAt(700)
    const btn = screen.getByTestId('editor-btn')
    btn.focus()
    resize(screen.getByTestId('workbench-main-row'), 517)
    expect(screen.getByTestId('right-panel').getAttribute('data-mode')).toBe('overlay')
    expect(document.activeElement).toBe(btn)
  })

  it('Escape outside the panel (the editor) does not close it', () => {
    openByHandAt(517)
    fireEvent.keyDown(screen.getByTestId('editor-btn'), { key: 'Escape' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByTestId('right-panel')).toBeTruthy()
  })

  it('Escape already handled inside the panel (defaultPrevented) does not close it', () => {
    openByHandAt(517)
    const input = screen.getByTestId('stub-input')
    input.addEventListener('keydown', (e) => e.preventDefault())
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByTestId('right-panel')).toBeTruthy()
  })

  it('Escape in a DOCKED panel does nothing', () => {
    openByHandAt(1100)
    fireEvent.keyDown(screen.getByTestId('stub-input'), { key: 'Escape' })
    expect(screen.getByTestId('right-panel').getAttribute('data-mode')).toBe('docked')
  })

  it('the collapse control closes the overlay', () => {
    openByHandAt(517)
    fireEvent.click(screen.getByTestId('right-panel-collapse'))
    expect(screen.queryByTestId('right-panel')).toBeNull()
  })

  it('the editor column and the row clip instead of scrolling', () => {
    openByHandAt(517)
    const row = screen.getByTestId('workbench-main-row')
    const column = screen.getByTestId('workbench-editor-column')
    for (const el of [row, column]) {
      expect(el.className).toContain('overflow-clip')
      expect(el.className).not.toContain('overflow-hidden')
      expect(el.className).toContain('min-w-0')
    }
  })
})
