/**
 * Pure viewport-clamp math for popovers / context menus (issue #58).
 *
 * Given a desired top-left anchor (x, y) and the element's measured size,
 * return a position clamped/flipped so the element stays fully inside the
 * viewport with `pad` px of breathing room on every edge. Extracted from the
 * inline `ContextMenuShell` logic so it is unit-testable without a DOM.
 */
export interface ClampToViewportInput {
  /** Desired left (client X of the click). */
  x: number
  /** Desired top (client Y of the click). */
  y: number
  /** Measured element width. */
  width: number
  /** Measured element height. */
  height: number
  /** Viewport width (e.g. `window.innerWidth`). */
  viewportWidth: number
  /** Viewport height (e.g. `window.innerHeight`). */
  viewportHeight: number
  /** Minimum gap from every edge. Defaults to 8. */
  pad?: number
}

/**
 * Clamp an anchor so `[left, left+width] × [top, top+height]` fits inside
 * `[pad, viewport-pad]`. When the element is wider/taller than the available
 * space, the `Math.max(pad, …)` floor keeps the top-left visible (the far edge
 * may still overflow, which is unavoidable, but the menu's actions stay
 * reachable from the top).
 */
export function clampToViewport({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  pad = 8,
}: ClampToViewportInput): { left: number; top: number } {
  let left = x
  let top = y
  if (left + width > viewportWidth - pad) left = Math.max(pad, viewportWidth - width - pad)
  if (top + height > viewportHeight - pad) top = Math.max(pad, viewportHeight - height - pad)
  return { left, top }
}
