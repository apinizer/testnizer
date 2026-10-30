/**
 * Narrow request-editor layout decisions (issue #251) — pure, so the two
 * thresholds and the "no feedback loop" rule live in one place.
 *
 * Pixel budget (16 px font, TR "Gönder"): UrlBar padding 24 + method pill 90
 * + Send split ~123 + Save ~80 leaves the URL >= 240 px from 557 px up.
 */

/** Collapse the Variables/Code panel when the editor WITH the panel open is below this. */
export const RIGHT_PANEL_COLLAPSE_BELOW = 600
/** Move Save into the URL bar's overflow menu when the bar's BORDER-box width is below this. */
export const URL_BAR_COMPACT_BELOW = 580
/** Width of the `EdgeResizeHandle` between the editor and the right panel. */
export const EDGE_HANDLE_PX = 5
/** Right panel width bounds — drag handle and rendered width. */
export const RIGHT_PANEL_MIN_PX = 240
export const RIGHT_PANEL_MAX_PX = 600

/*
 * The compact URL bar, piece by piece (UrlBar.tsx uses these; the overflow
 * button lives in UrlBarSave.tsx). Their sum is the room an open right panel
 * must always leave the editor.
 */
/** Horizontal padding on EACH side of the compact bar. */
export const URL_BAR_COMPACT_PAD_X_PX = 8
/** Method pill's minimum width in the compact bar. */
export const URL_BAR_COMPACT_METHOD_MIN_PX = 76
/** Gap between the URL field and the Send split in the compact bar. */
export const URL_BAR_COMPACT_SEND_GAP_PX = 6
/** The URL field never gets narrower than this (on its outer flex item). */
export const URL_FIELD_MIN_PX = 160
/** Send + chevron split, measured at 16 px font with TR "Gönder" (the widest case). */
export const URL_BAR_SEND_SPLIT_PX = 123
/** Overflow "…" button: 4 px margin + 32 px button (UrlBarSave.tsx). */
export const URL_BAR_OVERFLOW_PX = 4 + 32
/** Narrowest the compact URL bar can be without clipping Send / the overflow menu. */
export const URL_BAR_MIN_BUDGET =
  2 * URL_BAR_COMPACT_PAD_X_PX +
  URL_BAR_COMPACT_METHOD_MIN_PX +
  URL_BAR_COMPACT_SEND_GAP_PX +
  URL_FIELD_MIN_PX +
  URL_BAR_SEND_SPLIT_PX +
  URL_BAR_OVERFLOW_PX

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

/**
 * The narrow decision for a workbench row of `rowWidth` with the right panel
 * at `rightPanelWidth`. Validity is checked on the MEASURED row, not on the
 * derived editor width: a row narrower than the panel gives an editor width
 * <= 0, which is the narrowest case there is — not "unmeasured" (passing it to
 * `narrowLayoutFor` re-opened the panel as the window shrank). Only an
 * unmeasured row (<= 0, NaN, Infinity) is wide.
 */
export function narrowLayoutForRow(rowWidth: number, rightPanelWidth: number): NarrowLayout {
  if (!Number.isFinite(rowWidth) || rowWidth <= 0) return { ...WIDE }
  const editor = editorWidthWithPanelOpen(rowWidth, rightPanelWidth)
  return {
    collapseRightPanel: editor < RIGHT_PANEL_COLLAPSE_BELOW,
    compactUrlBar: editor < URL_BAR_COMPACT_BELOW,
  }
}

/**
 * Widest the right panel may be DRAGGED in a row of `rowWidth`: the editor
 * keeps at least `RIGHT_PANEL_COLLAPSE_BELOW`, so a drag can never cross the
 * auto-collapse threshold and snap the panel shut under the cursor. Capped at
 * `staticMax`; an unmeasured row (<= 0, NaN, Infinity) keeps `staticMax`.
 * Can be below the panel's minimum on a narrow row — see
 * `rightPanelDragClamp`, which decides when this cap applies.
 */
export function rightPanelMaxWidth(rowWidth: number, staticMax: number): number {
  if (!Number.isFinite(rowWidth) || rowWidth <= 0) return staticMax
  return Math.min(staticMax, rowWidth - EDGE_HANDLE_PX - RIGHT_PANEL_COLLAPSE_BELOW)
}

/**
 * Widest an OPEN right panel may be in a row of `rowWidth` and still leave the
 * URL bar its `URL_BAR_MIN_BUDGET` — whether the panel is open by preference or
 * was opened by hand on a narrow row. Never below `min` (on a row too narrow
 * even for that the URL bar may clip — accepted at that extreme), never above
 * `max`. An unmeasured row (<= 0, NaN, Infinity) gives `max`.
 */
export function rightPanelRoomMax(
  rowWidth: number,
  min: number = RIGHT_PANEL_MIN_PX,
  max: number = RIGHT_PANEL_MAX_PX,
): number {
  if (!Number.isFinite(rowWidth) || rowWidth <= 0) return max
  return Math.max(min, Math.min(max, rowWidth - EDGE_HANDLE_PX - URL_BAR_MIN_BUDGET))
}

/**
 * The width the right panel is RENDERED at: the stored preference, but never
 * more than `rightPanelRoomMax`. Only rendering is clamped — the preference is
 * not written, so a wider window gives the user's width back.
 */
export function rightPanelRenderedWidth(rowWidth: number, storedWidth: number): number {
  return Math.min(storedWidth, rightPanelRoomMax(rowWidth))
}

/**
 * Width clamp for ONE right-panel drag (issue #251). The cap from
 * `rightPanelMaxWidth` applies only while the editor is wide: a drag that
 * starts wide can never cross into narrow (no snap-collapse). A panel the user
 * opened BY HAND on a narrow row is already past the threshold — no crossing
 * is possible while it stays narrow, so it is only held to the URL bar's room
 * (`rightPanelRoomMax`); once the drag brings the editor back to wide, the
 * collapse cap engages for the rest of it.
 */
export function rightPanelDragClamp(
  rowWidth: number,
  startWidth: number,
  min: number,
  max: number,
): (next: number) => number {
  const cap = rightPanelMaxWidth(rowWidth, max)
  const room = rightPanelRoomMax(rowWidth, min, max)
  let capped = !narrowLayoutForRow(rowWidth, startWidth).collapseRightPanel
  return (next) => {
    const w = Math.max(min, Math.min(room, next))
    if (!capped && w <= cap) capped = true
    // `cap >= min` whenever `capped`: a wide start has startWidth <= cap, and
    // engaging later needs a w >= min that is <= cap.
    return capped ? Math.min(cap, w) : w
  }
}
