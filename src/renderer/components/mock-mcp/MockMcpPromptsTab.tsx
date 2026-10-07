import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import type { MockMcpDraftUpdater, MockMcpPrompt, MockMcpServerDraft } from '../../types/mock-mcp'
import { uniqueName } from './mock-mcp-presets'
import MockMcpPromptForm from './MockMcpPromptForm'
import { GhostButton } from './ui'
import { ListItem } from './ui-display'

/** Prompts: master list + the selected prompt's form. */
export default function MockMcpPromptsTab({
  draft,
  change,
}: {
  draft: MockMcpServerDraft
  change: MockMcpDraftUpdater
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, draft.prompts.length - 1)
  const prompt = index >= 0 ? draft.prompts[index] : undefined

  const add = (): void => {
    const name = uniqueName(
      'new_prompt',
      draft.prompts.map((p) => p.name),
      '_',
    )
    const p: MockMcpPrompt = {
      name,
      description: '',
      arguments: [{ name: 'topic', required: true }],
      messages: [{ role: 'user', text: 'Tell me about {{args.topic}}.' }],
    }
    change((d) => ({ ...d, prompts: [...d.prompts, p] }))
    setSelected(draft.prompts.length)
  }

  return (
    <div data-testid="mock-mcp-prompts" className="flex min-h-0 flex-1">
      <div className="flex w-[220px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--white)]">
        <div className="border-b border-[var(--border)] p-2">
          <GhostButton
            data-testid="mock-mcp-prompt-add"
            onClick={add}
            className="w-full justify-center"
          >
            <Plus size={12} />
            {t('mockMcp.prompts.add')}
          </GhostButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {draft.prompts.length === 0 && (
            <div className="p-3 text-[12px] text-[var(--hint)]">{t('mockMcp.prompts.empty')}</div>
          )}
          {draft.prompts.map((p, i) => (
            <ListItem key={i} active={i === index} onClick={() => setSelected(i)}>
              <span className="truncate font-mono">{p.name || t('mockMcp.unnamed')}</span>
            </ListItem>
          ))}
        </div>
      </div>
      {prompt ? (
        <MockMcpPromptForm
          key={index}
          prompt={prompt}
          onChange={(fn) =>
            change((d) => ({ ...d, prompts: d.prompts.map((p, j) => (j === index ? fn(p) : p)) }))
          }
          onDelete={() =>
            change((d) => ({ ...d, prompts: d.prompts.filter((_, j) => j !== index) }))
          }
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--hint)]">
          {t('mockMcp.prompts.selectOrAdd')}
        </div>
      )}
    </div>
  )
}
