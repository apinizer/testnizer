import { useRef, type ReactElement, type ReactNode } from 'react'
import { Panel, PanelGroup } from 'react-resizable-panels'
import McpSplitHandle from '../mcp/McpSplitHandle'
import { mcpSplitStorage, pairedMins, useElementLength } from '../mcp/mcp-split-layout'
import {
  AI_CHAT_SPLIT_ID,
  AI_CONFIG_MIN_PX,
  AI_CONFIG_PANEL_ID,
  AI_TRANSCRIPT_MIN_PX,
  AI_TRANSCRIPT_PANEL_ID,
} from '../../../lib/ai-chat-view'

/**
 * AI Chat editor body (issue #228): Settings + Tools above the conversation.
 * While a section is open the two share the body through a drag divider — the
 * MCP call / result split (#211), remembered per user — so the configuration
 * scrolls inside its panel and the conversation never drops below a usable
 * height (an approval card stays whole). With both sections collapsed there is
 * nothing to split: the two header rows sit on top and the conversation takes
 * the rest.
 */
export default function AiChatSplit({
  split,
  config,
  transcript,
}: {
  /** At least one configuration section is expanded. */
  split: boolean
  config: ReactNode
  transcript: ReactNode
}): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const height = useElementLength(rootRef, 'height')
  const [configMin, transcriptMin] = pairedMins(AI_CONFIG_MIN_PX, AI_TRANSCRIPT_MIN_PX, height, 15)

  return (
    <div
      ref={rootRef}
      data-testid="ai-chat-body"
      data-split={split ? 'true' : 'false'}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {split ? (
        <PanelGroup
          direction="vertical"
          autoSaveId={AI_CHAT_SPLIT_ID}
          storage={mcpSplitStorage}
          className="min-h-0 flex-1"
        >
          <Panel id={AI_CONFIG_PANEL_ID} order={1} defaultSize={40} minSize={configMin}>
            {/* The column lives in an inner div: the Panel's own overflow is hidden. */}
            <div data-testid="ai-chat-config" className="h-full min-h-0 overflow-y-auto">
              {config}
            </div>
          </Panel>
          <McpSplitHandle direction="vertical" testId="ai-chat-split-handle" />
          <Panel
            id={AI_TRANSCRIPT_PANEL_ID}
            order={2}
            defaultSize={60}
            minSize={transcriptMin}
            data-testid="ai-chat-transcript-panel"
            data-min-size={transcriptMin}
          >
            <div className="flex h-full min-h-0 flex-col">{transcript}</div>
          </Panel>
        </PanelGroup>
      ) : (
        <>
          <div data-testid="ai-chat-config" className="shrink-0">
            {config}
          </div>
          {transcript}
        </>
      )}
    </div>
  )
}
