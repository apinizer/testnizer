/**
 * Issue #251 follow-up — dragging the right panel's resize handle must never
 * make the editor narrow enough for the narrow-view auto-collapse to snap the
 * panel shut under the user's cursor. The drag is clamped instead:
 *
 *   max panel width = row width − EDGE_HANDLE_PX − RIGHT_PANEL_COLLAPSE_BELOW
 *
 * (both constants from lib/narrow-layout.ts), never above the static 600 px
 * and never below the static 240 px minimum. An unmeasured row (0 / NaN, as in
 * jsdom) keeps the static bounds. A panel the user opened BY HAND on a narrow
 * row is already past the threshold: it can still be widened, but only up to
 * the room the URL bar needs (`rightPanelRoomMax`, see
 * right-panel-url-room.test.tsx), until the drag brings the editor back to
 * wide; then the collapse cap applies for the rest of that drag.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  EDGE_HANDLE_PX,
  RIGHT_PANEL_COLLAPSE_BELOW,
  URL_BAR_MIN_BUDGET,
  editorWidthWithPanelOpen,
  narrowLayoutFor,
  rightPanelDragClamp,
  rightPanelMaxWidth,
} from '../../src/renderer/lib/narrow-layout'
import EdgeResizeHandle from '../../src/renderer/components/layout/EdgeResizeHandle'
import { useUIStore } from '../../src/renderer/stores/ui.store'

describe('rightPanelMaxWidth', () => {
  it('keeps the editor at or above the collapse threshold for every row width it can honour', () => {
    for (const row of [845, 900, 1000, 1180, 1205, 1440]) {
      const max = rightPanelMaxWidth(row, 600)
      expect(max).toBeLessThanOrEqual(600)
      expect(narrowLayoutFor(editorWidthWithPanelOpen(row, max)).collapseRightPanel).toBe(false)
    }
  })

  it('is derived from the narrow-layout constants, not a separate magic number', () => {
    expect(rightPanelMaxWidth(1000, 600)).toBe(1000 - EDGE_HANDLE_PX - RIGHT_PANEL_COLLAPSE_BELOW)
  })

  it('never exceeds the static max on a wide row', () => {
    expect(rightPanelMaxWidth(2000, 600)).toBe(600)
  })

  it('falls back to the static max while the row is unmeasured', () => {
    expect(rightPanelMaxWidth(0, 600)).toBe(600)
    expect(rightPanelMaxWidth(Number.NaN, 600)).toBe(600)
    expect(rightPanelMaxWidth(Number.POSITIVE_INFINITY, 600)).toBe(600)
  })
})

describe('rightPanelDragClamp', () => {
  it('a wide start is capped for the whole drag', () => {
    const clamp = rightPanelDragClamp(1000, 300, 240, 600)
    expect(clamp(700)).toBe(395)
    expect(clamp(100)).toBe(240)
  })

  it('a hand-opened panel on a narrow row can widen up to the URL bar room', () => {
    const clamp = rightPanelDragClamp(900, 300, 240, 600)
    expect(clamp(400)).toBe(400)
    expect(clamp(700)).toBe(900 - EDGE_HANDLE_PX - URL_BAR_MIN_BUDGET)
    expect(clamp(100)).toBe(240)
  })

  it('a row without room for the URL bar pins a hand-opened panel to the minimum', () => {
    const clamp = rightPanelDragClamp(641, 300, 240, 600)
    expect(clamp(400)).toBe(240)
  })

  it('a narrow start that reaches the wide region is capped from then on', () => {
    const clamp = rightPanelDragClamp(917, 400, 240, 600)
    expect(clamp(450)).toBe(450) // still narrow: free
    expect(clamp(280)).toBe(280) // editor 632: wide -> cap engages
    expect(clamp(500)).toBe(917 - EDGE_HANDLE_PX - RIGHT_PANEL_COLLAPSE_BELOW)
  })

  it('overshooting below the minimum on a too-narrow row does not lock the cap in', () => {
    const clamp = rightPanelDragClamp(800, 300, 240, 600)
    expect(clamp(100)).toBe(240)
    expect(clamp(350)).toBe(350)
  })
})

describe('EdgeResizeHandle (right) clamps the drag to the row', () => {
  beforeEach(() => {
    ;(window as unknown as { api: unknown }).api = {
      settings: { set: vi.fn(async () => ({ success: true })) },
    }
    useUIStore.setState({
      rightPanelWidth: 300,
      leftPanelWidth: 260,
      rightPanelCollapsed: false,
      rightPanelNarrowCollapsed: false,
    } as never)
  })
  afterEach(() => cleanup())

  function renderInRow(width: number, target: 'left' | 'right'): HTMLElement {
    render(
      <div data-testid="row">
        <div style={{ flex: 1 }} />
        <EdgeResizeHandle target={target} />
      </div>,
    )
    const row = screen.getByTestId('row')
    row.getBoundingClientRect = () =>
      ({ width, height: 600, top: 0, left: 0, right: width, bottom: 600, x: 0, y: 0 }) as DOMRect
    return screen.getByRole('separator')
  }

  function drag(handle: HTMLElement, fromX: number, ...toX: number[]): void {
    fireEvent.mouseDown(handle, { clientX: fromX })
    act(() => {
      for (const x of toX) window.dispatchEvent(new MouseEvent('mousemove', { clientX: x }))
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: toX[toX.length - 1] }))
    })
  }

  it('stops widening at the width that keeps the editor wide (1000 px row -> 395)', () => {
    const handle = renderInRow(1000, 'right')
    // Drag 400 px to the left: unclamped this asks for 700 (static max 600).
    drag(handle, 500, 100)
    const w = useUIStore.getState().rightPanelWidth
    expect(w).toBe(1000 - EDGE_HANDLE_PX - RIGHT_PANEL_COLLAPSE_BELOW)
    expect(narrowLayoutFor(editorWidthWithPanelOpen(1000, w)).collapseRightPanel).toBe(false)
  })

  it('keeps the existing minimum width', () => {
    const handle = renderInRow(1000, 'right')
    drag(handle, 500, 900)
    expect(useUIStore.getState().rightPanelWidth).toBe(240)
  })

  it('a panel opened by hand on a narrow row can still be widened', () => {
    const handle = renderInRow(900, 'right')
    // Widen by 100: 300 -> 400. The clamp must not pin it to the 240 minimum.
    drag(handle, 500, 400)
    expect(useUIStore.getState().rightPanelWidth).toBe(400)
  })

  it('...but never past the room the URL bar needs', () => {
    const handle = renderInRow(900, 'right')
    drag(handle, 500, 100)
    expect(useUIStore.getState().rightPanelWidth).toBe(900 - EDGE_HANDLE_PX - URL_BAR_MIN_BUDGET)
  })

  it('narrowing a hand-opened panel back to wide engages the cap (no snap on the way back)', () => {
    useUIStore.setState({ rightPanelWidth: 400 } as never)
    const handle = renderInRow(917, 'right')
    // 400 -> 280 (editor wide again) -> towards 500: stops at 917 - 605 = 312.
    drag(handle, 500, 620, 400)
    const w = useUIStore.getState().rightPanelWidth
    expect(w).toBe(917 - EDGE_HANDLE_PX - RIGHT_PANEL_COLLAPSE_BELOW)
    expect(narrowLayoutFor(editorWidthWithPanelOpen(917, w)).collapseRightPanel).toBe(false)
  })

  it('the left (APIs tree) handle is not clamped by the row', () => {
    const handle = renderInRow(700, 'left')
    drag(handle, 100, 400)
    expect(useUIStore.getState().leftPanelWidth).toBe(560)
  })
})
