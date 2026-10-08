import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import type {
  MockMcpDraftUpdater,
  MockMcpServerDraft,
  MockMcpToolDraft,
} from '../../types/mock-mcp'
import { blankToolDraft } from './mock-mcp-draft'
import { uniqueName } from './mock-mcp-presets'
import MockMcpToolForm from './MockMcpToolForm'
import { GhostButton } from './ui'
import { ListItem } from './ui-display'

/** Tools: master list on the left, the selected tool's form on the right. */
export default function MockMcpToolsTab({
  draft,
  change,
}: {
  draft: MockMcpServerDraft
  change: MockMcpDraftUpdater
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, draft.tools.length - 1)
  const tool = index >= 0 ? draft.tools[index] : undefined

  const add = (): void => {
    // MCP tool names: [A-Za-z0-9_.-] only — no spaces in the suffix.
    const name = uniqueName(
      'new_tool',
      draft.tools.map((x) => x.name),
      '_',
    )
    change((d) => ({ ...d, tools: [...d.tools, blankToolDraft(name)] }))
    setSelected(draft.tools.length)
  }

  const update = (key: string, fn: (tl: MockMcpToolDraft) => MockMcpToolDraft): void =>
    change((d) => ({ ...d, tools: d.tools.map((x) => (x.key === key ? fn(x) : x)) }))

  const remove = (key: string): void =>
    change((d) => ({ ...d, tools: d.tools.filter((x) => x.key !== key) }))

  return (
    <div data-testid="mock-mcp-tools" className="flex min-h-0 flex-1">
      <div className="flex w-[220px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--white)]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] p-2">
          <GhostButton
            data-testid="mock-mcp-tool-add"
            onClick={add}
            className="w-full justify-center"
          >
            <Plus size={12} />
            {t('mockMcp.tools.add')}
          </GhostButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {draft.tools.length === 0 && (
            <div className="p-3 text-[12px] text-[var(--hint)]">{t('mockMcp.tools.empty')}</div>
          )}
          {draft.tools.map((x, i) => (
            <ListItem
              key={x.key}
              testId={`mock-mcp-tool-item-${i}`}
              active={i === index}
              onClick={() => setSelected(i)}
            >
              <span className="truncate font-mono">{x.name || t('mockMcp.unnamed')}</span>
              {x.error && x.error.kind !== 'none' && (
                <span className="ml-auto shrink-0 text-[10px] text-[var(--red)]">
                  {x.error.kind}
                </span>
              )}
            </ListItem>
          ))}
        </div>
      </div>
      {tool ? (
        <MockMcpToolForm
          key={tool.key}
          tool={tool}
          onChange={(fn) => update(tool.key, fn)}
          onDelete={() => remove(tool.key)}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--hint)]">
          {t('mockMcp.tools.selectOrAdd')}
        </div>
      )}
    </div>
  )
}
