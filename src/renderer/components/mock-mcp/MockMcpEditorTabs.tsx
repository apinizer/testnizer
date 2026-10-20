/**
 * The Mock MCP editor's tab strip (issue #140). Tools / Resources / Prompts
 * carry an unsaved dot when that section of the draft differs from the saved
 * server (issue #210) — the header's "Unsaved changes" alone did not say
 * which tab changed.
 */
import type { ReactNode } from 'react'
import { useTranslation } from '../../lib/i18n'
import type { MockMcpEditorTab } from '../../types/mock-mcp'
import type { MockMcpSectionDirty } from './mock-mcp-dirty'

const MOCK_MCP_EDITOR_TABS: readonly MockMcpEditorTab[] = [
  'general',
  'scenarios',
  'tools',
  'resources',
  'prompts',
  'logs',
]

/** One editor tab — also the HTTP / SSE mock editor's tabs (MockServerEditor). */
export function MockEditorTabButton({
  testId,
  active,
  onClick,
  children,
}: {
  testId: string
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center border-x-0 border-b-2 border-t-0 bg-transparent px-4 py-2 text-[12px] font-semibold ${
        active
          ? 'border-[var(--accent)] text-[var(--accent-text)]'
          : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  )
}

function isListSection(id: MockMcpEditorTab): id is keyof MockMcpSectionDirty {
  return id === 'tools' || id === 'resources' || id === 'prompts'
}

export default function MockMcpEditorTabs({
  tab,
  onTab,
  labels,
  dirty,
}: {
  tab: MockMcpEditorTab
  onTab: (id: MockMcpEditorTab) => void
  labels: Record<MockMcpEditorTab, string>
  dirty: MockMcpSectionDirty
}) {
  const { t } = useTranslation()
  return (
    <div role="tablist" className="flex shrink-0 border-b border-[var(--border)] bg-[var(--white)]">
      {MOCK_MCP_EDITOR_TABS.map((id) => (
        <MockEditorTabButton
          key={id}
          testId={`mock-mcp-tab-${id}`}
          active={tab === id}
          onClick={() => onTab(id)}
        >
          {labels[id]}
          {isListSection(id) && dirty[id] && (
            // Text-less so the tab's label (and every text locator on it) is unchanged.
            <span
              role="img"
              data-testid={`mock-mcp-tab-dirty-${id}`}
              aria-label={t('mockMcp.tabUnsaved')}
              title={t('mockMcp.tabUnsaved')}
              className="ml-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
            />
          )}
        </MockEditorTabButton>
      ))}
    </div>
  )
}
