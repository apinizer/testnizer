import { useRef, type ReactNode } from 'react'
import { useRightPanelAutoCollapse } from '../../lib/use-narrow-layout'
import EdgeResizeHandle from './EdgeResizeHandle'
import RightPanel from './RightPanel'

/**
 * The request workbench row: editor column + drag handle + Variables/Code
 * panel. It owns the row ref the narrow-editor auto-collapse observes (issue
 * #251), so the observer follows this row's mount: switching to a Runner or
 * Tools tab unmounts it and clears the transient collapse.
 */
export default function WorkbenchMainRow({ children }: { children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null)
  useRightPanelAutoCollapse(rowRef)
  return (
    <div
      ref={rowRef}
      data-testid="workbench-main-row"
      className="flex flex-1 overflow-hidden bg-[var(--white)]"
    >
      {/* Main content — min-w-0 lets it shrink instead of pushing the panel out. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>

      {/* Drag divider between the workbench and the Variables pane (issue #15) */}
      <EdgeResizeHandle target="right" />

      {/* Right: Postman-style tabbed panel (Variables / Code / ...) */}
      <RightPanel />
    </div>
  )
}
