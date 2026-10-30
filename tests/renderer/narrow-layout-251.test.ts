/**
 * Issue #251 — pure decision functions for the narrow request editor.
 *
 * CONTRACT — new module `src/renderer/lib/narrow-layout.ts`:
 *
 *   export const RIGHT_PANEL_COLLAPSE_BELOW = 600   // px
 *   export const URL_BAR_COMPACT_BELOW = 580        // px
 *   export const EDGE_HANDLE_PX = 5                 // EdgeResizeHandle width
 *   export interface NarrowLayout { collapseRightPanel: boolean; compactUrlBar: boolean }
 *   // editorWidth <= 0 / NaN / Infinity means "not measured" -> both false.
 *   export function narrowLayoutFor(editorWidth: number): NarrowLayout
 *   // Width the editor column WOULD have with the right panel open:
 *   // rowWidth - rightPanelWidth - EDGE_HANDLE_PX. Depends on the panel's
 *   // CONFIGURED width only, never on whether it is open right now.
 *   export function editorWidthWithPanelOpen(rowWidth: number, rightPanelWidth: number): number
 *
 * Pixel budget behind the numbers (16 px font, TR "Gönder"): UrlBar padding 24
 * + method pill 90 + Send split ~123 + Save ~80 leaves the URL >= 240 px from
 * 557 px up; the right panel collapses when the editor would drop under 600 px
 * WITH the panel open (so a 1400 px window with a 300 px sidebar and a 300 px
 * panel keeps the panel: 1400-83-300-300-5 = 712).
 *
 * Why the collapse decision uses the width WITH the panel open: if it read the
 * editor's current width it would oscillate — a narrow editor collapses the
 * panel, the editor gains ~260 px, the panel re-opens, the editor is narrow
 * again. `editorWidthWithPanelOpen` makes the answer identical for an open and
 * a collapsed panel (test below).
 *
 * Red now: the module does not exist.
 */
import { describe, it, expect } from 'vitest'
import {
  narrowLayoutFor,
  editorWidthWithPanelOpen,
  RIGHT_PANEL_COLLAPSE_BELOW,
  URL_BAR_COMPACT_BELOW,
  EDGE_HANDLE_PX,
} from '../../src/renderer/lib/narrow-layout'

describe('narrowLayoutFor', () => {
  it('a wide editor needs nothing', () => {
    expect(narrowLayoutFor(1000)).toEqual({ collapseRightPanel: false, compactUrlBar: false })
  })

  it('collapses the right panel strictly below RIGHT_PANEL_COLLAPSE_BELOW', () => {
    expect(narrowLayoutFor(RIGHT_PANEL_COLLAPSE_BELOW).collapseRightPanel).toBe(false)
    expect(narrowLayoutFor(RIGHT_PANEL_COLLAPSE_BELOW - 1).collapseRightPanel).toBe(true)
  })

  it('compacts the URL bar strictly below URL_BAR_COMPACT_BELOW', () => {
    expect(narrowLayoutFor(URL_BAR_COMPACT_BELOW).compactUrlBar).toBe(false)
    expect(narrowLayoutFor(URL_BAR_COMPACT_BELOW - 1).compactUrlBar).toBe(true)
  })

  it('the panel yields before the URL bar does (compact implies collapse)', () => {
    expect(URL_BAR_COMPACT_BELOW).toBeLessThanOrEqual(RIGHT_PANEL_COLLAPSE_BELOW)
    for (let w = 100; w < 1400; w += 7) {
      const l = narrowLayoutFor(w)
      if (l.compactUrlBar) expect(l.collapseRightPanel).toBe(true)
    }
  })

  it('is monotonic: a wider editor is never narrower', () => {
    let prev = narrowLayoutFor(0.5)
    for (let w = 1; w < 1600; w += 3) {
      const cur = narrowLayoutFor(w)
      if (!prev.collapseRightPanel) expect(cur.collapseRightPanel).toBe(false)
      if (!prev.compactUrlBar) expect(cur.compactUrlBar).toBe(false)
      prev = cur
    }
  })

  it('an unmeasured width (0, negative, NaN, Infinity) is NOT narrow', () => {
    for (const w of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(narrowLayoutFor(w)).toEqual({ collapseRightPanel: false, compactUrlBar: false })
    }
  })

  it('thresholds leave the URL room (budget guard)', () => {
    // URL >= 240 needs 24 + 90 + 240 + 123 + 80 = 557 px with Save inline.
    expect(URL_BAR_COMPACT_BELOW).toBeGreaterThanOrEqual(557)
    // The reviewer's default window (1400, 300 + 300 panels) must not auto-collapse.
    expect(RIGHT_PANEL_COLLAPSE_BELOW).toBeLessThanOrEqual(1400 - 83 - 300 - 300 - EDGE_HANDLE_PX)
  })
})

describe('editorWidthWithPanelOpen — no feedback loop', () => {
  it('is row width minus the panel and the drag handle', () => {
    expect(editorWidthWithPanelOpen(1000, 300)).toBe(1000 - 300 - EDGE_HANDLE_PX)
  })

  it('depends on the configured panel width only, so open and collapsed panels decide the same', () => {
    // Same row (the flex row holding editor + handle + panel/rail), same
    // configured panel width: one answer, whatever the panel looks like now.
    const row = 800 // 800 - 305 = 495 < 600
    const decision = narrowLayoutFor(editorWidthWithPanelOpen(row, 300)).collapseRightPanel
    for (let i = 0; i < 5; i++) {
      expect(narrowLayoutFor(editorWidthWithPanelOpen(row, 300)).collapseRightPanel).toBe(decision)
    }
    expect(decision).toBe(true)
  })

  it('1024 px window, 300 px sidebar, 300 px panel -> collapse; 1400 px -> keep', () => {
    const iconSidebar = 83
    const left = 300
    const rowAt = (win: number): number => win - iconSidebar - left
    expect(narrowLayoutFor(editorWidthWithPanelOpen(rowAt(1024), 300)).collapseRightPanel).toBe(
      true,
    )
    expect(narrowLayoutFor(editorWidthWithPanelOpen(rowAt(1400), 300)).collapseRightPanel).toBe(
      false,
    )
  })
})
