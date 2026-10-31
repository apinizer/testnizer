import { useEffect, useLayoutEffect, useState } from 'react'

/**
 * Horizontal tab strips (issue #241). Paired with the `.scroll-strip` class in
 * globals.css, which hides the scrollbar so an overflowing strip keeps its
 * height. With no scrollbar to drag, the strip needs:
 *  - a plain mouse wheel (vertical delta) to scroll it sideways, and
 *  - the active tab brought into view when it changes.
 */

/** Pixels per line for `WheelEvent.DOM_DELTA_LINE` (Windows "lines" setting). */
const LINE_PX = 16

/**
 * How far a wheel event should move a horizontal-only strip, or `null` to let
 * the browser handle it: the strip does not overflow, or the gesture is already
 * mostly horizontal (trackpad swipe, Shift+wheel), which scrolls natively.
 */
export function wheelToHorizontal(
  e: { deltaX: number; deltaY: number; deltaMode?: number },
  el: { scrollWidth: number; clientWidth: number },
): number | null {
  if (el.scrollWidth <= el.clientWidth) return null
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return null
  return e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaY
}

/** Scroll the strip's active child into view; `null` strip is a no-op. */
function revealActive(el: HTMLElement | null): void {
  const active = el?.querySelector<HTMLElement>('[data-active="true"]')
  // jsdom has no scrollIntoView; guard so every strip renders in tests.
  active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

/**
 * Returns a callback ref for the strip element (a callback, so a strip that
 * mounts after the first render — e.g. once a response arrives — still gets
 * the wheel listener). `activeKey` is the active tab's id or key; the child
 * marked `data-active="true"` is scrolled into view whenever it changes.
 * `block: 'nearest'` keeps ancestors from scrolling vertically — the very shift
 * this exists to avoid.
 */
export function useScrollStrip<T extends HTMLElement = HTMLDivElement>(
  activeKey: unknown,
): (node: T | null) => void {
  const [el, setEl] = useState<T | null>(null)

  useEffect(() => {
    if (!el) return
    // Native listener: React registers `onWheel` as passive, so preventDefault
    // there is ignored and the page would also try to scroll.
    const onWheel = (e: WheelEvent): void => {
      const dx = wheelToHorizontal(e, el)
      if (dx === null) return
      e.preventDefault()
      el.scrollLeft += dx
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [el])

  useLayoutEffect(() => {
    revealActive(el)
  }, [el, activeKey])

  // The strip's width is not final when the active tab changes: opening a
  // blank "+" tab swaps the editor beside the bar (the right-panel rail
  // disappears and the strip widens by 40 px), so the scroll above is measured
  // against a stale width and the new tab ends up clipped at the right edge.
  // Re-reveal the active tab whenever the strip itself is resized.
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => revealActive(el))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])

  return setEl
}
