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
