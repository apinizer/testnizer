import { useRef, type ReactNode } from 'react'
import { Panel, PanelGroup } from 'react-resizable-panels'
import McpSplitHandle from './McpSplitHandle'
import {
  CALL_HEADER_MIN_PX,
  CALL_HEADER_PANEL_ID,
  CALL_RESULT_MIN_PX,
  CALL_RESULT_PANEL_ID,
  MCP_CALL_SPLIT_ID,
  mcpSplitStorage,
  pairedMins,
  useElementLength,
} from './mcp-split-layout'

/**
 * Tool / Resource / Prompt pane body (issues #155, #211): the call header
 * (description, arguments, sticky Run row) scrolls as one unit above the
 * result, and a drag divider between them sets the split — remembered per user
 * and shared by the three panes.
 */
export default function McpCallSplit({
  headerTestId,
  header,
  result,
}: {
  headerTestId: string
  header: ReactNode
  result: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const height = useElementLength(rootRef, 'height')
  const [headerMin, resultMin] = pairedMins(CALL_HEADER_MIN_PX, CALL_RESULT_MIN_PX, height, 15)

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PanelGroup
        direction="vertical"
        autoSaveId={MCP_CALL_SPLIT_ID}
        storage={mcpSplitStorage}
        className="min-h-0 flex-1"
      >
        <Panel id={CALL_HEADER_PANEL_ID} order={1} defaultSize={45} minSize={headerMin}>
          {/* The column lives in an inner div: the Panel's own overflow is hidden. */}
          <div data-testid={headerTestId} className="h-full min-h-0 overflow-y-auto">
            {header}
          </div>
        </Panel>
        <McpSplitHandle direction="vertical" testId="mcp-call-split-handle" />
        <Panel id={CALL_RESULT_PANEL_ID} order={2} defaultSize={55} minSize={resultMin}>
          <div data-testid="mcp-call-result" className="h-full overflow-auto p-3.5">
            {result}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}
