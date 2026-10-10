import { useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import type { AiToolCallPart, AiToolResultPart } from '../../../../shared/ai-chat-types'
import { answerToolApproval } from '../../../stores/ai-chat-tools'
import { useTranslation } from '../../../lib/i18n'

const STATUS_COLOR: Record<AiToolCallPart['status'], string> = {
  'pending-approval': 'var(--orange)',
  approved: 'var(--accent-text)',
  running: 'var(--accent-text)',
  done: 'var(--green)',
  denied: 'var(--muted)',
  error: 'var(--red)',
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}

/**
 * One tool call in the conversation (issue #180): collapsible arguments +
 * result, status, error state — and, while the call waits for the user, the
 * approval card (Allow once / Allow this tool for this conversation / Deny).
 */
export default function AiChatToolCallCard({
  call,
  result,
  live,
}: {
  call: AiToolCallPart
  result?: AiToolResultPart
  /** The call belongs to the turn being streamed — its approval can still be answered. */
  live: boolean
}): ReactElement {
  const { t } = useTranslation()
  const waiting = call.status === 'pending-approval' && live
  const [open, setOpen] = useState(false)
  const expanded = open || waiting
  const label = call.server ? `${call.server} › ${call.tool}` : call.tool

  return (
    <div
      className="rounded-md border border-[var(--border)] bg-[var(--white)]"
      data-testid="ai-tool-call"
      data-status={call.status}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-2 py-1.5 text-left"
        style={{ fontSize: 12 }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Wrench size={12} className="text-[var(--muted)]" />
        <span className="flex-1 truncate font-mono text-[var(--text)]">{label}</span>
        <span
          style={{ color: STATUS_COLOR[call.status], fontSize: 11 }}
          data-testid="ai-tool-call-status"
        >
          {t(`aiChat.toolStatus.${call.status}`)}
        </span>
      </button>
      {expanded && (
        <div
          className="flex flex-col gap-2 border-t border-[var(--border)] p-2"
          style={{ fontSize: 12 }}
        >
          <div>
            <div className="mb-1 text-[var(--muted)]">{t('aiChat.tool.arguments')}</div>
            <pre
              className="max-h-48 overflow-auto rounded bg-[var(--bg)] p-2 font-mono"
              data-testid="ai-tool-args"
            >
              {pretty(call.argsJson)}
            </pre>
          </div>
          {result && (
            <div>
              <div className="mb-1 text-[var(--muted)]">
                {result.isError ? t('aiChat.tool.error') : t('aiChat.tool.result')}
                {result.truncated ? ` (${t('aiChat.tool.truncated')})` : ''}
              </div>
              <pre
                className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg)] p-2 font-mono"
                style={{ color: result.isError ? 'var(--red)' : 'var(--text)' }}
                data-testid="ai-tool-result"
              >
                {result.content}
              </pre>
            </div>
          )}
          {waiting && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border px-2 py-2"
              style={{ borderColor: 'var(--orange)' }}
              data-testid="ai-tool-approval"
            >
              <span className="text-[var(--text)]">{t('aiChat.approval.question')}</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void answerToolApproval(call, 'once')}
                  data-testid="ai-approve-once"
                  className="cursor-pointer rounded-md border-none px-3 py-1 font-medium text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  {t('aiChat.approval.once')}
                </button>
                <button
                  type="button"
                  onClick={() => void answerToolApproval(call, 'conversation')}
                  data-testid="ai-approve-conversation"
                  className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-1 text-[var(--text)]"
                >
                  {t('aiChat.approval.conversation')}
                </button>
                <button
                  type="button"
                  onClick={() => void answerToolApproval(call, 'deny')}
                  data-testid="ai-approve-deny"
                  className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-3 py-1 text-[var(--red)]"
                >
                  {t('aiChat.approval.deny')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
