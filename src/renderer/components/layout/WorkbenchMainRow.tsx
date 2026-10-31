import { useRef, type ReactNode } from 'react'
import { useRightPanelAutoCollapse } from '../../lib/use-narrow-layout'
import { rightPanelMode } from '../../lib/narrow-layout'
import { useUIStore } from '../../stores/ui.store'
import EdgeResizeHandle from './EdgeResizeHandle'
import RightPanel from './RightPanel'

/**
 * The request workbench row: editor column + drag handle + Variables/Code
 * panel. It owns the row ref the narrow-editor auto-collapse observes (issue
 * #251), so the observer follows this row's mount: switching to a Runner or
 * Tools tab unmounts it and clears the transient collapse.
 *
 * A panel opened by hand on a row too narrow to dock it is an overlay drawer
 * (`rightPanelMode`): positioned against this row, so the editor keeps the
 * full row width and there is no resize handle.
 *
 * Row and editor column CLIP rather than hide overflow: `overflow: hidden` is
 * still a scroll container, and focusing a control past its edge scrolled the
 * editor sideways (method / URL start cut on the left). `clip` is not a scroll
 * container, so it also drops the implicit `min-width: 0` — hence `min-w-0`.
 */
export default function WorkbenchMainRow({ children }: { children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const rowWidth = useRightPanelAutoCollapse(rowRef)
  const storedWidth = useUIStore((s) => s.rightPanelWidth)
  const mode = rightPanelMode(rowWidth, storedWidth)
  return (
    <div
      ref={rowRef}
      data-testid="workbench-main-row"
      className="relative flex min-w-0 flex-1 overflow-clip bg-[var(--white)]"
    >
      {/* Main content — min-w-0 lets it shrink instead of pushing the panel out. */}
      <div
        data-testid="workbench-editor-column"
        className="flex min-w-0 flex-1 flex-col overflow-clip"
      >
        {children}
      </div>

      {/* Drag divider between the workbench and the Variables pane (issue #15) */}
      {mode === 'docked' && <EdgeResizeHandle target="right" />}

      {/* Right: Postman-style tabbed panel (Variables / Code / ...) */}
      <RightPanel rowWidth={rowWidth} mode={mode} />
    </div>
  )
}
