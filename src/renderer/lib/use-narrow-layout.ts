import { useEffect, useRef, useState, type RefObject } from 'react'
import { useUIStore } from '../stores/ui.store'
import { editorWidthWithPanelOpen, narrowLayoutFor } from './narrow-layout'

/**
 * Report an element's own content width through ResizeObserver
 * (`entry.contentRect.width`). Does nothing without ResizeObserver.
 */
function observeWidth(el: Element, onWidth: (width: number) => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === el) onWidth(entry.contentRect.width)
    }
  })
  ro.observe(el)
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
  const narrow = narrowLayoutFor(
    editorWidthWithPanelOpen(st.row, ui.rightPanelWidth),
  ).collapseRightPanel
  if (narrow === st.narrow) return
  st.narrow = narrow
  ui.setRightPanelNarrowCollapsed(narrow)
}

export function useRightPanelAutoCollapse(rowRef: RefObject<HTMLElement | null>): void {
  const panelWidth = useUIStore((s) => s.rightPanelWidth)
  const state = useRef<AutoCollapseState>({ row: null, narrow: null })

  useEffect(() => {
    const el = rowRef.current
    const st = state.current
    if (!el) return
    const stop = observeWidth(el, (width) => {
      st.row = width
      evaluateAutoCollapse(st)
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
}

/**
 * Compact URL bar (issue #251): true while the bar's OWN width is under
 * `URL_BAR_COMPACT_BELOW`. Stays false without ResizeObserver.
 */
export function useCompactUrlBar(ref: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return observeWidth(el, (width) => setCompact(narrowLayoutFor(width).compactUrlBar))
  }, [ref])
  return compact
}
