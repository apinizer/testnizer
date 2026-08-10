/**
 * Issue #74, app-wide half — a drag must never leave the document
 * unselectable.
 *
 * Five surfaces (panel dividers, console splitter, headers/key-value column
 * resizers, the runner split) set `body.style.userSelect = 'none'` for the
 * duration of a drag and cleared it on `mouseup`. A mouse released OUTSIDE the
 * window never delivers that `mouseup`, so the lock stayed on and text
 * everywhere — chat bubbles included — stopped being selectable.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { lockDragStyles } from '../../src/renderer/lib/drag-lock'

describe('lockDragStyles', () => {
  beforeEach(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  it('locks selection during the drag and restores it on release', () => {
    const release = lockDragStyles('col-resize')
    expect(document.body.style.userSelect).toBe('none')
    expect(document.body.style.cursor).toBe('col-resize')

    release()
    expect(document.body.style.userSelect).toBe('')
    expect(document.body.style.cursor).toBe('')
  })

  it('releases when the window loses focus — the drag-out-and-release case', () => {
    lockDragStyles('row-resize')
    expect(document.body.style.userSelect).toBe('none')

    // The user released the button over another application: no mouseup ever
    // reaches us, only a blur.
    window.dispatchEvent(new Event('blur'))
    expect(document.body.style.userSelect).toBe('')
    expect(document.body.style.cursor).toBe('')
  })

  it('restores the PREVIOUS values rather than blanket-clearing them', () => {
    document.body.style.cursor = 'progress'
    document.body.style.userSelect = 'text'

    const release = lockDragStyles('col-resize')
    release()

    expect(document.body.style.cursor).toBe('progress')
    expect(document.body.style.userSelect).toBe('text')
  })

  it('is idempotent — a blur followed by the real mouseup is harmless', () => {
    document.body.style.userSelect = 'text'
    const release = lockDragStyles('col-resize')

    window.dispatchEvent(new Event('blur'))
    release()
    release()

    expect(document.body.style.userSelect).toBe('text')
  })

  it('stops listening after release, so a later blur cannot clobber styles', () => {
    const release = lockDragStyles('col-resize')
    release()

    document.body.style.userSelect = 'none' // some other feature's lock
    window.dispatchEvent(new Event('blur'))

    expect(document.body.style.userSelect).toBe('none')
  })
})
