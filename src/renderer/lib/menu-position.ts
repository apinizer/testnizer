/**
 * Pure placement math for click-anchored context menus (issues #58, #67).
 *
 * Every context menu in the app used to be pinned at the raw click point, so a
 * right-click low in a long tree (or near the right edge) pushed the lower
 * actions — Delete among them — outside the window with no flip and no scroll.
 * Callers measure the rendered menu, hand the numbers to this function and
 * apply the result; keeping the math here means it is unit-testable without a
 * DOM and identical on every surface.
 */
export interface MenuPositionInput {
  /** Client X of the click (desired left edge). */
  x: number
  /** Client Y of the click (desired top edge). */
  y: number
  /** Measured menu width. */
  width: number
  /** Measured menu height, unconstrained. */
  height: number
  /** Viewport width (e.g. `window.innerWidth`). */
  viewportWidth: number
  /** Viewport height (e.g. `window.innerHeight`). */
  viewportHeight: number
  /** Minimum gap from every edge. Defaults to 8. */
  pad?: number
}

export interface MenuPosition {
  left: number
  top: number
  /**
   * Only set when the menu is taller than the viewport in both directions.
   * The caller must then also apply `overflow-y: auto`, otherwise the tail of
   * the menu stays unreachable.
   */
  maxHeight?: number
}

/**
 * Place a menu at (x, y), flipping and clamping so it never leaves the
 * viewport:
 *
 * - horizontally: open to the right of the cursor, flip to the left when that
 *   would cross the right edge, then clamp — never past 0;
 * - vertically: open downward, flip upward when there is more room above,
 *   slide up when neither anchor works but the menu still fits;
 * - when the menu is taller than the viewport itself, pin it and report a
 *   `maxHeight` so it scrolls internally instead of being cut off.
 */
export function positionContextMenu({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  pad = 8,
}: MenuPositionInput): MenuPosition {
  let left = x
  if (left + width > viewportWidth - pad) {
    const flipped = x - width
    // Prefer mirroring around the cursor (native menu behaviour); fall back to
    // hugging the right edge when the flipped menu would leave the viewport.
    left = flipped >= pad ? flipped : viewportWidth - width - pad
  }
  if (left < 0) left = 0

  const roomBelow = viewportHeight - pad - y
  const roomAbove = y - pad
  if (height <= roomBelow) return { left, top: y }
  if (height <= roomAbove) return { left, top: y - height }

  const usable = viewportHeight - pad * 2
  // Fits in the window, just not from this anchor — slide it up against the
  // bottom edge rather than flipping to a side that is also too small.
  if (height <= usable) return { left, top: Math.max(0, viewportHeight - height - pad) }

  return usable > 0
    ? { left, top: pad, maxHeight: usable }
    : { left, top: 0, maxHeight: Math.max(0, viewportHeight) }
}

export interface AnchoredMenuInput {
  /** The anchor button's client rect edges. */
  anchorLeft: number
  anchorTop: number
  anchorBottom: number
  /** Measured menu size, unconstrained. */
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  /** Minimum gap from every edge. Defaults to 8. */
  pad?: number
  /** Gap between the button and the menu. Defaults to 4. */
  gap?: number
}

/**
 * Place a dropdown anchored to a button (review item 11 — "Copy as…" sat in
 * an overflow-clipped header and opened upward off-screen): above the button
 * when it fits (the action bars sit low in their pane), else below, else on
 * the roomier side with a `maxHeight` so it scrolls. Left-aligned with the
 * button, clamped into the viewport.
 */
export function positionAnchoredMenu({
  anchorLeft,
  anchorTop,
  anchorBottom,
  width,
  height,
  viewportWidth,
  viewportHeight,
  pad = 8,
  gap = 4,
}: AnchoredMenuInput): MenuPosition {
  const left = Math.max(0, Math.min(anchorLeft, viewportWidth - width - pad))
  const above = anchorTop - gap - height
  const below = anchorBottom + gap
  if (above >= pad) return { left, top: above }
  if (below + height <= viewportHeight - pad) return { left, top: below }
  const roomAbove = anchorTop - gap - pad
  const roomBelow = viewportHeight - pad - below
  return roomAbove > roomBelow
    ? { left, top: pad, maxHeight: Math.max(0, roomAbove) }
    : { left, top: below, maxHeight: Math.max(0, roomBelow) }
}
