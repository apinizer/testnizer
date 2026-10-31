import { useEffect, useRef, useState, type RefObject } from 'react'
import { useUIStore } from '../stores/ui.store'
import { narrowLayoutFor, narrowLayoutForRow } from './narrow-layout'

/**
 * Report an element's width through ResizeObserver. `'content'` reads
 * `entry.contentRect.width`; `'border'` reads the border box
 * (`borderBoxSize[0].inlineSize`, falling back to `contentRect.width` where a
 * ResizeObserver does not report it). Does nothing without ResizeObserver.
 * Shared by every measured narrow decision (#251 editor, #308 Runner split).
 */
export function observeWidth(
  el: Element,
  onWidth: (width: number) => void,
  box: 'content' | 'border' = 'content',
): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target !== el) continue
      const border = box === 'border' ? entry.borderBoxSize?.[0]?.inlineSize : undefined
      onWidth(border ?? entry.contentRect.width)
    }
  })
  if (box === 'border') ro.observe(el, { box: 'border-box' })
  else ro.observe(el)
  return () => ro.disconnect()
}

/**
 * Collapse the Variables/Code panel while the request editor would be too
 * narrow WITH the panel open (issue #251). `rowRef` is the flex row holding
 * editor column + drag handle + panel (`workbench-main-row`).
 *
 * It writes the transient `rightPanelNarrowCollapsed` flag only on a CROSSING
 * of the threshold, so a user who opens the panel by hand while narrow is not
 * fought on the next callback. The persisted preference is never touched.
 * Unmounting clears the flag so other screens are not left collapsed.
 */
interface AutoCollapseState {
  /** Last observed row width; null until the first measurement. */
  row: number | null
  /** Last decision written to the store; null before the first one. */
  narrow: boolean | null
}

/** Recompute and write the flag only when the decision changes (a crossing). */
function evaluateAutoCollapse(st: AutoCollapseState): void {
  if (st.row === null) return
  const ui = useUIStore.getState()
  const narrow = narrowLayoutForRow(st.row, ui.rightPanelWidth).collapseRightPanel
  if (narrow === st.narrow) return
  st.narrow = narrow
  ui.setRightPanelNarrowCollapsed(narrow)
}

/**
 * Returns the row's last measured width (0 until measured / without
 * ResizeObserver) — the right panel clamps its RENDERED width to it.
 */
export function useRightPanelAutoCollapse(rowRef: RefObject<HTMLElement | null>): number {
  const panelWidth = useUIStore((s) => s.rightPanelWidth)
  const state = useRef<AutoCollapseState>({ row: null, narrow: null })
  const [rowWidth, setRowWidth] = useState(0)

  useEffect(() => {
    const el = rowRef.current
    const st = state.current
    if (!el) return
    const stop = observeWidth(el, (width) => {
      st.row = width
      evaluateAutoCollapse(st)
      setRowWidth(width)
    })
    return () => {
      stop()
      st.row = null
      st.narrow = null
      useUIStore.getState().setRightPanelNarrowCollapsed(false)
    }
  }, [rowRef])

  // A dragged panel width changes the answer without a new row measurement.
  useEffect(() => {
    evaluateAutoCollapse(state.current)
  }, [panelWidth])

  return rowWidth
}

/**
 * Compact URL bar (issue #251): true while the bar's OWN width is under
 * `URL_BAR_COMPACT_BELOW`. Stays false without ResizeObserver.
 *
 * Measured on the BORDER box: compact mode narrows the bar's padding, so a
 * content-box decision moved its own input (600 px bar: 576 content ->
 * compact -> 584 content -> wide -> ...) and flipped on every callback.
 */
export function useCompactUrlBar(ref: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return observeWidth(el, (width) => setCompact(narrowLayoutFor(width).compactUrlBar), 'border')
  }, [ref])
  return compact
}
