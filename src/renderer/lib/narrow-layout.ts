/**
 * Narrow request-editor layout decisions (issue #251) — pure, so the two
 * thresholds and the "no feedback loop" rule live in one place.
 *
 * Pixel budget (16 px font, TR "Gönder"): UrlBar padding 24 + method pill 90
 * + Send split ~123 + Save ~80 leaves the URL >= 240 px from 557 px up.
 */

/** Collapse the Variables/Code panel when the editor WITH the panel open is below this. */
export const RIGHT_PANEL_COLLAPSE_BELOW = 600
/** Move Save into the URL bar's overflow menu when the bar is below this. */
export const URL_BAR_COMPACT_BELOW = 580
/** Width of the `EdgeResizeHandle` between the editor and the right panel. */
export const EDGE_HANDLE_PX = 5

export interface NarrowLayout {
  collapseRightPanel: boolean
  compactUrlBar: boolean
}

const WIDE: NarrowLayout = { collapseRightPanel: false, compactUrlBar: false }

/** `editorWidth` <= 0, NaN or Infinity means "not measured yet" — never narrow. */
export function narrowLayoutFor(editorWidth: number): NarrowLayout {
  if (!Number.isFinite(editorWidth) || editorWidth <= 0) return { ...WIDE }
  return {
    collapseRightPanel: editorWidth < RIGHT_PANEL_COLLAPSE_BELOW,
    compactUrlBar: editorWidth < URL_BAR_COMPACT_BELOW,
  }
}

/**
 * The editor column's width WITH the right panel open. It depends on the
 * panel's configured width only — never on whether the panel is open now —
 * so collapsing the panel (which widens the editor) cannot re-open it on the
 * next measurement: an open and a collapsed panel give the same answer.
 */
export function editorWidthWithPanelOpen(rowWidth: number, rightPanelWidth: number): number {
  return rowWidth - rightPanelWidth - EDGE_HANDLE_PX
}
