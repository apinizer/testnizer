import { useMemo } from 'react'
import { MessageSquareMore } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import { parseInputRequest } from '../../../lib/mcp-elicitation'
import type { McpPendingElicitation } from '../../../stores/mcp-call.slice'
import McpInputForm from './McpInputForm'

/**
 * A 2025-era `elicitation/create` the server sent mid-call (issue #168): the
 * input card variant naming the server, with Accept / Decline / Cancel (spec
 * MUST) and the "Will send" preview open so the answer is reviewed before it
 * goes. Unlike the 2026 card it stays usable while the tool call is still
 * running — the call is waiting on exactly this answer.
 */
export default function McpElicitationCard({
  elicitation,
}: {
  elicitation: McpPendingElicitation
}) {
  const { t } = useTranslation()
  const respond = useMcpStore((s) => s.respondElicitation)
  const views = useMemo(
    () => [
      parseInputRequest(elicitation.elicitationId, {
        method: 'elicitation/create',
        params: {
          mode: 'form',
          message: elicitation.message,
          requestedSchema: elicitation.requestedSchema,
        },
      }),
    ],
    [elicitation.elicitationId, elicitation.message, elicitation.requestedSchema],
  )
  const server = elicitation.serverName || t('mcp.elicit.unknownServer')

  return (
    <div
      data-testid="mcp-elicitation"
      data-elicitation-id={elicitation.elicitationId}
      className="mb-2 flex flex-col gap-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-light)] p-3"
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--accent-text)]">
        <MessageSquareMore size={14} />
        <span data-testid="mcp-elicitation-server">
          {t('mcp.elicit.from').replace('{server}', server)}
        </span>
      </div>
      <McpInputForm
        views={views}
        busy={!!elicitation.sending}
        error={elicitation.error}
        acceptLabel={t('mcp.input.accept')}
        previewOpen
        onSend={(action, responses) => {
          const answer = responses[elicitation.elicitationId]
          void respond(
            elicitation.elicitationId,
            action,
            answer && answer.action === 'accept' ? answer.content : undefined,
          )
        }}
      />
    </div>
  )
}
