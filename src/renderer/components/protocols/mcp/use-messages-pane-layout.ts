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
    const startH = heightRef.current
    const onMove = (ev: MouseEvent): void => {
      heightRef.current = clampPaneHeight(startH + (startY - ev.clientY))
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
