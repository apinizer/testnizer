/**
 * Cursor + text-selection lock for the duration of a mouse drag.
 *
 * Every drag surface (panel dividers, the console splitter, resizable table
 * columns, the runner split) sets `document.body.style.userSelect = 'none'` so
 * the drag does not paint a text selection across the app, then restores it on
 * `mouseup`. The restore was the problem: a `mouseup` that happens OUTSIDE the
 * application window never reaches the listener, so the body stayed
 * unselectable and text everywhere — chat bubbles, response bodies, headers —
 * silently stopped being selectable until the next completed drag. That is the
 * app-wide half of issue #74.
 *
 * This helper owns both styles, restores the PREVIOUS values (not a blanket
 * reset), also releases on window `blur` (the drag-out-and-release case) and is
 * idempotent, so a double release is harmless.
 */
export function lockDragStyles(cursor: string): () => void {
  if (typeof document === 'undefined') return () => {}

  const previousCursor = document.body.style.cursor
  const previousUserSelect = document.body.style.userSelect
  document.body.style.cursor = cursor
  document.body.style.userSelect = 'none'

  let released = false
  const release = (): void => {
    if (released) return
    released = true
    document.body.style.cursor = previousCursor
    document.body.style.userSelect = previousUserSelect
    window.removeEventListener('blur', release)
  }

  window.addEventListener('blur', release)
  return release
}
