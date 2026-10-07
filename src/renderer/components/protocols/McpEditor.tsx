import { useState } from 'react'
import { useMcpStore } from '../../stores/mcp.store'
import { useTranslation } from '../../lib/i18n'
import McpConnectionBar from './mcp/McpConnectionBar'
import McpHeadersSection from './mcp/McpHeadersSection'
import McpStdioEnvSection from './mcp/McpStdioEnvSection'
import McpCapabilityList from './mcp/McpCapabilityList'
import McpToolPane from './mcp/McpToolPane'
import McpResourcePane from './mcp/McpResourcePane'
import McpPromptPane from './mcp/McpPromptPane'
import McpMessagesPane from './mcp/McpMessagesPane'
import { MCP_EXTRA_SECTIONS } from './mcp/sections'

const EXPLORER = 'explorer'

/**
 * MCP request editor (issues #137, #139) — a thin host. Connection bar,
 * header / stdio-env blocks, then the capability list on the left and the
 * matching pane on the right (Tools | Resources | Prompts), the messages
 * pane at the bottom. Extra right-pane tabs come from `mcp/sections.ts`, so
 * later phases plug in without editing this file.
 */
export default function McpEditor() {
  const { t } = useTranslation()
  const capabilityTab = useMcpStore((s) => s.capabilityTab)
  const [rightTab, setRightTab] = useState<string>(EXPLORER)
  const extra = MCP_EXTRA_SECTIONS.find((s) => s.id === rightTab)
  const ExtraComponent = extra?.component

  return (
    <div
      data-testid="mcp-editor"
      className="flex h-full flex-col overflow-hidden bg-[var(--white)]"
    >
      <McpConnectionBar />
      <McpHeadersSection />
      <McpStdioEnvSection />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <McpCapabilityList />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {MCP_EXTRA_SECTIONS.length > 0 && (
            <div
              role="tablist"
              className="flex shrink-0 gap-1 border-b border-[var(--border)] px-2"
            >
              {[{ id: EXPLORER, label: t('mcp.section.explorer') }, ...MCP_EXTRA_SECTIONS].map(
                (s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={rightTab === s.id}
                    data-testid={`mcp-section-${s.id}`}
                    onClick={() => setRightTab(s.id)}
                    className={`cursor-pointer border-x-0 border-t-0 border-b-2 bg-transparent px-2.5 py-1.5 text-[12px] ${
                      rightTab === s.id
                        ? 'border-[var(--accent)] text-[var(--accent-text)]'
                        : 'border-transparent text-[var(--muted)]'
                    }`}
                  >
                    {s.id === EXPLORER ? s.label : t(s.label)}
                  </button>
                ),
              )}
            </div>
          )}
          {ExtraComponent ? (
            <ExtraComponent />
          ) : capabilityTab === 'resources' ? (
            <McpResourcePane />
          ) : capabilityTab === 'prompts' ? (
            <McpPromptPane />
          ) : (
            <McpToolPane />
          )}
        </div>
      </div>
      <McpMessagesPane />
    </div>
  )
}
