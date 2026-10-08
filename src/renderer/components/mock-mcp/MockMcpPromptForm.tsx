import { Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import type {
  MockMcpPrompt,
  MockMcpPromptArgument,
  MockMcpPromptMessage,
} from '../../types/mock-mcp'
import { Field, GhostButton, INPUT_CLS, SectionLabel, SELECT_CLS } from './ui'

const ICON_BTN =
  'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--red)]'

/** One prompt: name / description, an arguments table and the message list. */
export default function MockMcpPromptForm({
  prompt,
  onChange,
  onDelete,
}: {
  prompt: MockMcpPrompt
  onChange: (fn: (p: MockMcpPrompt) => MockMcpPrompt) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const args = prompt.arguments ?? []
  const set = (patch: Partial<MockMcpPrompt>): void => onChange((p) => ({ ...p, ...patch }))
  const setArg = (i: number, patch: Partial<MockMcpPromptArgument>): void =>
    onChange((p) => ({
      ...p,
      arguments: (p.arguments ?? []).map((a, j) => (j === i ? { ...a, ...patch } : a)),
    }))
  const setMsg = (i: number, patch: Partial<MockMcpPromptMessage>): void =>
    onChange((p) => ({
      ...p,
      messages: p.messages.map((m, j) => (j === i ? { ...m, ...patch } : m)),
    }))

  return (
    <div data-testid="mock-mcp-prompt-form" className="min-w-0 flex-1 overflow-y-auto p-4">
      <div className="flex max-w-[720px] flex-col gap-3">
        <SectionLabel
          right={
            <GhostButton
              data-testid="mock-mcp-prompt-delete"
              onClick={onDelete}
              className="text-[var(--red)]"
            >
              <Trash2 size={12} />
              {t('mockMcp.prompts.delete')}
            </GhostButton>
          }
        >
          {t('mockMcp.prompts.prompt')}
        </SectionLabel>
        <Field label={t('mockMcp.prompts.name')}>
          <input
            data-testid="mock-mcp-prompt-name"
            value={prompt.name}
            onChange={(e) => set({ name: e.target.value })}
            className={`${INPUT_CLS} font-mono`}
          />
        </Field>
        <Field label={t('mockMcp.prompts.description')}>
          <input
            value={prompt.description ?? ''}
            onChange={(e) => set({ description: e.target.value })}
            className={INPUT_CLS}
          />
        </Field>

        <SectionLabel
          right={
            <GhostButton
              data-testid="mock-mcp-prompt-arg-add"
              onClick={() => set({ arguments: [...args, { name: '' }] })}
            >
              <Plus size={12} />
              {t('mockMcp.prompts.addArgument')}
            </GhostButton>
          }
        >
          {t('mockMcp.prompts.arguments')}
        </SectionLabel>
        {args.length === 0 && (
          <div className="text-[11px] text-[var(--hint)]">{t('mockMcp.prompts.noArguments')}</div>
        )}
        {args.map((a, i) => (
          <div key={i} className="grid grid-cols-[160px_1fr_auto_auto] items-center gap-2">
            <input
              data-testid={`mock-mcp-prompt-arg-name-${i}`}
              value={a.name}
              placeholder={t('mockMcp.prompts.argName')}
              onChange={(e) => setArg(i, { name: e.target.value })}
              className={`${INPUT_CLS} font-mono`}
            />
            <input
              value={a.description ?? ''}
              placeholder={t('mockMcp.prompts.argDescription')}
              onChange={(e) => setArg(i, { description: e.target.value })}
              className={INPUT_CLS}
            />
            <label className="flex items-center gap-1 text-[11px] text-[var(--text)]">
              <input
                type="checkbox"
                checked={!!a.required}
                onChange={(e) => setArg(i, { required: e.target.checked })}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              {t('mockMcp.prompts.required')}
            </label>
            <button
              type="button"
              aria-label={t('mockMcp.prompts.removeArgument')}
              onClick={() => set({ arguments: args.filter((_, j) => j !== i) })}
              className={ICON_BTN}
            >
              <X size={12} />
            </button>
          </div>
        ))}

        <SectionLabel
          right={
            <GhostButton
              data-testid="mock-mcp-prompt-msg-add"
              onClick={() => set({ messages: [...prompt.messages, { role: 'user', text: '' }] })}
            >
              <Plus size={12} />
              {t('mockMcp.prompts.addMessage')}
            </GhostButton>
          }
        >
          {t('mockMcp.prompts.messages')}
        </SectionLabel>
        {prompt.messages.map((m, i) => (
          <div key={i} className="grid grid-cols-[110px_1fr_auto] items-start gap-2">
            <select
              value={m.role}
              onChange={(e) =>
                setMsg(i, { role: e.target.value === 'assistant' ? 'assistant' : 'user' })
              }
              className={SELECT_CLS}
            >
              <option value="user">user</option>
              <option value="assistant">assistant</option>
            </select>
            <textarea
              data-testid={`mock-mcp-prompt-msg-${i}`}
              value={m.text}
              rows={3}
              onChange={(e) => setMsg(i, { text: e.target.value })}
              className={`${INPUT_CLS} h-auto py-1`}
            />
            <button
              type="button"
              aria-label={t('mockMcp.prompts.removeMessage')}
              onClick={() => set({ messages: prompt.messages.filter((_, j) => j !== i) })}
              className={ICON_BTN}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <div className="text-[11px] text-[var(--hint)]">{t('mockMcp.prompts.templateHint')}</div>
      </div>
    </div>
  )
}
