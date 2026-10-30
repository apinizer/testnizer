import { useRef } from 'react'
import { useUIStore, selectRightPanelCollapsed } from '../../stores/ui.store'
import { lockDragStyles } from '../../lib/drag-lock'
import { useTranslation } from '../../lib/i18n'
import {
  EDGE_HANDLE_PX,
  RIGHT_PANEL_MAX_PX,
  RIGHT_PANEL_MIN_PX,
  rightPanelDragClamp,
  rightPanelRenderedWidth,
} from '../../lib/narrow-layout'

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
  right: { min: RIGHT_PANEL_MIN_PX, max: RIGHT_PANEL_MAX_PX },
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
  const { t } = useTranslation()
  const collapsed = useUIStore((s) => (target === 'right' ? selectRightPanelCollapsed(s) : false))
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
    // The right pane may not squeeze the editor under the narrow-view threshold
    // nor the URL bar under its room (issue #251): the row is measured once —
    // its width does not change while the panel inside it is resized. The drag
    // starts from the width ON SCREEN (the stored one may be clamped down). The
    // left handle's row is the AppShell's.
    const rowWidth =
      target === 'right' ? (e.currentTarget.parentElement?.getBoundingClientRect().width ?? 0) : 0
    startW.current = target === 'right' ? rightPanelRenderedWidth(rowWidth, width) : width
    const clamp =
      target === 'right'
        ? rightPanelDragClamp(rowWidth, startW.current, min, max)
        : (next: number): number => Math.max(min, Math.min(max, next))
    const releaseStyles = lockDragStyles('col-resize')

    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX.current
      // Left divider widens as it moves right; right divider narrows.
      const next = target === 'left' ? startW.current + dx : startW.current - dx
      setWidth(clamp(next))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      releaseStyles()
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
      title={t('shell.dragToResize')}
      className="shrink-0 transition-colors hover:bg-[var(--accent)]"
      style={{ width: EDGE_HANDLE_PX, cursor: 'col-resize', background: 'transparent', zIndex: 5 }}
    />
  )
}
