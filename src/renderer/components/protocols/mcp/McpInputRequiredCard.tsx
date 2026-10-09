import { useMemo } from 'react'
import { MessageSquareMore } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import { parseInputRequests } from '../../../lib/mcp-elicitation'
import type { McpPendingInput } from '../../../types/mcp'
import McpInputForm from './McpInputForm'
import { JsonPre } from './ui'

/**
 * The 2026-07-28 multi-round-trip card (issue #152): a `tools/call` answered
 * `input_required`. Each `elicitation/create` request becomes a form generated
 * from its `requestedSchema`; Submit / Decline / Cancel send the bare
 * `ElicitResult`s with the echoed `requestState` (`mcp:respondInput`). The
 * server may ask again — the next round replaces this card (new `key`).
 */
export default function McpInputRequiredCard({ pending }: { pending: McpPendingInput }) {
  const { t } = useTranslation()
  const respondInput = useMcpStore((s) => s.respondInput)
  const isInvoking = useMcpStore((s) => s.isInvoking)
  const views = useMemo(() => parseInputRequests(pending.inputRequests), [pending.inputRequests])

  return (
    <div
      data-testid="mcp-input-required"
      data-round={pending.round}
      className="flex flex-col gap-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-light)] p-3"
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--accent-text)]">
        <MessageSquareMore size={14} />
        {t('mcp.input.title')}
        <span className="text-[11px] font-normal text-[var(--muted)]">
          {pending.toolName} · {t('mcp.input.round').replace('{n}', String(pending.round))}
        </span>
      </div>
      {views.length === 0 && (
        <span className="text-[12px] text-[var(--muted)]">{t('mcp.input.stateOnly')}</span>
      )}
      <McpInputForm
        views={views}
        busy={isInvoking}
        error={pending.error}
        acceptLabel={t('mcp.input.submit')}
        onSend={(_action, responses) => void respondInput(responses)}
      />
      <details className="text-[11px]">
        <summary className="cursor-pointer text-[var(--muted)]">{t('mcp.input.raw')}</summary>
        <div className="mt-1 max-h-40 overflow-auto rounded border border-[var(--border)] bg-[var(--white)] p-2">
          <JsonPre
            value={{ inputRequests: pending.inputRequests, requestState: pending.requestState }}
          />
        </div>
      </details>
    </div>
  )
}
