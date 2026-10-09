import { Inbox, MessageSquare } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import EmptyState from '../../shared/EmptyState'
import McpContentBlockView from './McpContentBlockView'
import McpDescription from './McpDescription'
import { CenterHint, ErrorLine, PrimaryButton, SectionLabel } from './ui'

/** Right pane for the Prompts tab: argument inputs from `arguments[]`, Get, messages by role. */
export default function McpPromptPane() {
  const { t } = useTranslation()
  const selected = useMcpStore((s) => s.selectedPrompt)
  const prompts = useMcpStore((s) => s.prompts)
  const promptArgs = useMcpStore((s) => s.promptArgs)
  const setPromptArg = useMcpStore((s) => s.setPromptArg)
  const getPrompt = useMcpStore((s) => s.getPrompt)
  const result = useMcpStore((s) => s.promptResult)
  const error = useMcpStore((s) => s.promptError)
  const isGetting = useMcpStore((s) => s.isGettingPrompt)
  const isConnected = useMcpStore((s) => s.connectionState === 'connected')

  if (!selected) {
    return <CenterHint>{isConnected ? t('mcp.prompt.select') : t('mcp.connectHint')}</CenterHint>
  }
  const def = prompts.find((p) => p.name === selected)
  const args = def?.arguments ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Issue #155: same layout as McpToolPane — a scrolling header whose action row
          (Get) is sticky at the bottom; floored result. */}
      <div
        data-testid="mcp-prompt-header"
        className="min-h-0 shrink overflow-y-auto border-b border-[var(--border)]"
      >
        <div className="flex flex-col gap-2 px-3.5 pt-2.5">
          <span className="font-semibold text-[var(--text)]">{def?.title || selected}</span>
          {def?.description && (
            <McpDescription text={def.description} testId="mcp-prompt-description" />
          )}
          {args.length > 0 && <SectionLabel>{t('mcp.prompt.arguments')}</SectionLabel>}
          {args.map((a) => (
            <label key={a.name} className="flex items-center gap-2 text-[12px]">
              <span
                className="w-32 shrink-0 truncate font-mono text-[var(--text)]"
                title={a.description}
              >
                {a.name}
                {a.required && <span className="text-[var(--red)]"> *</span>}
              </span>
              <input
                type="text"
                value={promptArgs[a.name] ?? ''}
                onChange={(e) => setPromptArg(a.name, e.target.value)}
                placeholder={a.description}
                data-testid={`mcp-prompt-arg-${a.name}`}
                className="h-7 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--placeholder)] focus:border-[var(--accent)]"
              />
            </label>
          ))}
          <div
            data-testid="mcp-prompt-actions"
            className="sticky bottom-0 bg-[var(--white)] pb-2.5 pt-2"
          >
            <PrimaryButton
              onClick={() => void getPrompt()}
              disabled={isGetting || !isConnected}
              data-testid="mcp-get-prompt"
            >
              <MessageSquare size={13} />
              {isGetting ? t('mcp.prompt.getting') : t('mcp.prompt.get')}
            </PrimaryButton>
          </div>
        </div>
      </div>
      <div className="min-h-[5rem] flex-1 overflow-auto p-3.5">
        <SectionLabel>{t('mcp.prompt.messages')}</SectionLabel>
        {error ? (
          <ErrorLine testId="mcp-prompt-error">{error}</ErrorLine>
        ) : result ? (
          <div className="flex flex-col gap-2" data-testid="mcp-prompt-result">
            {result.description && (
              <p className="m-0 text-[12px] text-[var(--muted)]">{result.description}</p>
            )}
            {result.messages.map((m, i) => (
              <div
                key={i}
                data-testid="mcp-prompt-message"
                data-role={m.role}
                className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] p-2.5"
              >
                <span
                  className={`self-start rounded px-1.5 text-[10px] font-semibold uppercase ${
                    m.role === 'user'
                      ? 'bg-[var(--mb-get-bg)] text-[var(--mb-get-fg)]'
                      : 'bg-[var(--mb-head-bg)] text-[var(--mb-head-fg)]'
                  }`}
                >
                  {m.role === 'user' ? t('mcp.prompt.roleUser') : t('mcp.prompt.roleAssistant')}
                </span>
                <McpContentBlockView block={m.content} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Inbox} title={t('mcp.prompt.none')} variant="compact" size="sm" />
        )}
      </div>
    </div>
  )
}
