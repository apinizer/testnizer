/**
 * Issue #251 — the Variables/Code panel collapses by itself while the request
 * editor is too narrow, and comes back (to the user's own preference) when the
 * editor is wide again.
 *
 * CONTRACT — `src/renderer/lib/use-narrow-layout.ts` (new):
 *
 *   useRightPanelAutoCollapse(rowRef: RefObject<HTMLElement | null>): void
 *     - Observes `rowRef.current` — the flex row that holds editor column +
 *       EdgeResizeHandle + RightPanel (Workbench renders it with
 *       data-testid="workbench-main-row") — with ResizeObserver and reads the
 *       width from `entry.contentRect.width` (NOT clientWidth/offsetWidth).
 *     - narrow = narrowLayoutForRow(rowWidth, ui.rightPanelWidth)
 *       .collapseRightPanel (a measured row narrower than the panel is narrow,
 *       see narrow-layout-review-251.test.tsx). Re-evaluated on every
 *       observer callback AND when ui.rightPanelWidth changes.
 *     - It writes `useUIStore.setRightPanelNarrowCollapsed(narrow)` ONLY when
 *       `narrow` differs from the value it last computed (a CROSSING). So a
 *       user who opens the panel by hand while narrow is not fought on the
 *       next callback with the same width.
 *     - Never touches the persisted preference `rightPanelCollapsed` and never
 *       calls `settings.set`.
 *     - On unmount it clears the flag (setRightPanelNarrowCollapsed(false)) so
 *       other screens (Runner, Tools) are not left collapsed.
 *     - Without ResizeObserver (old jsdom) it does nothing.
 *
 * ui.store additions are specified in right-panel-pref-257.test.tsx.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useRightPanelAutoCollapse } from '../../src/renderer/lib/use-narrow-layout'

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

/** Report `width` for `el` to every observer watching it. */
function resize(el: Element, width: number): void {
  act(() => {
    for (const o of observers) {
      if (o.els.has(el)) o.cb([{ target: el, contentRect: { width, height: 600 } }])
    }
  })
}

function Row(): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null)
  useRightPanelAutoCollapse(ref)
  return <div ref={ref} data-testid="workbench-main-row" />
}

let setSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  observers.length = 0
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver
  setSpy = vi.fn(async () => ({ success: true }))
  ;(window as unknown as { api: unknown }).api = {
    settings: { get: vi.fn(async () => ({ success: true, data: undefined })), set: setSpy },
  }
  useUIStore.setState({
    rightPanelCollapsed: false,
    rightPanelNarrowCollapsed: false,
    rightPanelWidth: 300,
    rightPanelTab: 'variables',
  })
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

const narrow = (): boolean => useUIStore.getState().rightPanelNarrowCollapsed
const pref = (): boolean => useUIStore.getState().rightPanelCollapsed
const find = (): Element => document.querySelector('[data-testid="workbench-main-row"]')!

describe('useRightPanelAutoCollapse', () => {
  it('collapses while the editor would be under the threshold, without touching the preference', () => {
    render(<Row />)
    resize(find(), 650) // 650 - 300 - 5 = 345 < 600
    expect(narrow()).toBe(true)
    expect(pref()).toBe(false)
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('leaves a wide window alone (1400 px: 1017 px row)', () => {
    render(<Row />)
    resize(find(), 1017)
    expect(narrow()).toBe(false)
  })

  it('returns to the preference when the editor is wide again (no persisted change)', () => {
    render(<Row />)
    resize(find(), 650)
    expect(narrow()).toBe(true)
    resize(find(), 1100)
    expect(narrow()).toBe(false)
    expect(pref()).toBe(false)
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('does not oscillate: the same row width keeps the same answer', () => {
    render(<Row />)
    resize(find(), 650)
    for (let i = 0; i < 4; i++) {
      resize(find(), 650)
      expect(narrow()).toBe(true)
    }
  })

  it('a user who opens the panel while narrow is not fought on the next callback', () => {
    render(<Row />)
    resize(find(), 650)
    expect(narrow()).toBe(true)
    act(() => useUIStore.getState().setRightPanelTab('variables')) // rail click
    expect(narrow()).toBe(false)
    resize(find(), 650) // same width, no crossing -> stays open
    expect(narrow()).toBe(false)
    resize(find(), 1100) // wide ...
    resize(find(), 650) // ... then narrow again = a crossing -> collapses again
    expect(narrow()).toBe(true)
  })

  it('re-evaluates when the configured panel width changes', () => {
    render(<Row />)
    resize(find(), 1100) // 1100 - 300 - 5 = 795 -> keep
    expect(narrow()).toBe(false)
    act(() => useUIStore.getState().setRightPanelWidth(600)) // 1100 - 605 = 495 -> collapse
    expect(narrow()).toBe(true)
    act(() => useUIStore.getState().setRightPanelWidth(240)) // 855 -> keep
    expect(narrow()).toBe(false)
  })

  it('clears the flag on unmount so other screens are not left collapsed', () => {
    const { unmount } = render(<Row />)
    resize(find(), 650)
    expect(narrow()).toBe(true)
    unmount()
    expect(narrow()).toBe(false)
  })

  it('does nothing (and does not throw) without ResizeObserver', () => {
    delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver
    expect(() => render(<Row />)).not.toThrow()
    expect(narrow()).toBe(false)
  })
})
