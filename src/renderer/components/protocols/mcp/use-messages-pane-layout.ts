import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  clampPaneHeight,
  loadMessagesPanePrefs,
  saveMessagesPanePrefs,
} from '../../../lib/mcp-messages-pane-prefs'

/**
 * Open/closed + height, remembered per user (issue #172), and the drag on the
 * pane's top edge that resizes it (dragging up grows the pane).
 */
export function useMessagesPaneLayout() {
  const [prefs, setPrefs] = useState(loadMessagesPanePrefs)
  const heightRef = useRef(prefs.height)
  const dragCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => dragCleanup.current?.(), [])

  const setOpen = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setPrefs((p) => {
      const open = typeof next === 'function' ? next(p.open) : next
      if (open === p.open) return p
      const updated = { ...p, open }
      saveMessagesPanePrefs(updated)
      return updated
    })
  }, [])

  const startResize = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    // The pane is capped at half the editor (`max-h-[50%]`): drag from the
    // height it SHOWS, and never store more than the editor can give it now.
    const pane = (e.currentTarget as HTMLElement | null)?.parentElement ?? null
    const editorH = pane?.parentElement?.clientHeight ?? 0
    const maxH = editorH > 0 ? Math.floor(editorH / 2) : Number.POSITIVE_INFINITY
    const shown = pane?.getBoundingClientRect().height ?? 0
    const startH = shown > 0 ? Math.min(heightRef.current, shown) : heightRef.current
    const onMove = (ev: MouseEvent): void => {
      heightRef.current = Math.min(maxH, clampPaneHeight(startH + (startY - ev.clientY)))
      setPrefs((p) => ({ ...p, height: heightRef.current }))
    }
    const onUp = (): void => {
      dragCleanup.current?.()
      setPrefs((p) => {
        const updated = { ...p, height: heightRef.current }
        saveMessagesPanePrefs(updated)
        return updated
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    dragCleanup.current = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragCleanup.current = null
    }
  }, [])

  return { open: prefs.open, height: prefs.height, setOpen, startResize }
}
