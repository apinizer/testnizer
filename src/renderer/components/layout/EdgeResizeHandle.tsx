import { useRef } from 'react'
import { useUIStore } from '../../stores/ui.store'

interface Props {
  /**
   * Which side panel this divider resizes:
   *  - 'left'  → the APIs tree (divider sits on its right; drag right = wider)
   *  - 'right' → the Variables pane (divider sits on its left; drag right = narrower)
   */
  target: 'left' | 'right'
}

const BOUNDS = {
  left: { min: 200, max: 600 },
  right: { min: 240, max: 600 },
} as const

/**
 * A thin vertical drag divider rendered as a flex sibling BETWEEN a side panel
 * and the workbench — resizes the left APIs tree and the right Variables pane
 * by dragging (issue #15). Self-subscribes to the panel width so dragging only
 * re-renders this handle and the panel it controls, not the whole AppShell.
 * Mirrors ConsolePanel's window-listener drag pattern; persists on mouse-up.
 *
 * Placed as a sibling (not inside the panel) so it is never clipped by the
 * panel's `overflow: hidden` and never overlaps the tree's scrollbar.
 */
export default function EdgeResizeHandle({ target }: Props) {
  const collapsed = useUIStore((s) => (target === 'right' ? s.rightPanelCollapsed : false))
  const width = useUIStore((s) => (target === 'left' ? s.leftPanelWidth : s.rightPanelWidth))
  const setLeft = useUIStore((s) => s.setLeftPanelWidth)
  const setRight = useUIStore((s) => s.setRightPanelWidth)
  const commit = useUIStore((s) => s.commitPanelWidths)
  const startX = useRef(0)
  const startW = useRef(0)

  // The right pane folds to a thin icon rail when collapsed — nothing to drag.
  if (collapsed) return null

  const { min, max } = BOUNDS[target]
  const setWidth = target === 'left' ? setLeft : setRight

  function startDrag(e: React.MouseEvent): void {
    e.preventDefault()
    startX.current = e.clientX
    startW.current = width
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX.current
      // Left divider widens as it moves right; right divider narrows.
      const next = target === 'left' ? startW.current + dx : startW.current - dx
      setWidth(Math.max(min, Math.min(max, next)))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      commit()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onMouseDown={startDrag}
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      className="shrink-0 transition-colors hover:bg-[var(--accent)]"
      style={{ width: 5, cursor: 'col-resize', background: 'transparent', zIndex: 5 }}
    />
  )
}
