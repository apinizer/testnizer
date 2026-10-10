import { Info } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import McpElicitationCard from './McpElicitationCard'

/**
 * What sits above a call's result: 2025-era elicitation cards waiting for the
 * user (issue #168) and, once the user declined / cancelled an input card,
 * a one-line note saying so (issue #175) — the server's reply below then
 * reads as the consequence, not as a mystery.
 */
export default function McpCallNotes() {
  const { t } = useTranslation()
  const outcome = useMcpStore((s) => s.inputOutcome)
  const elicitations = useMcpStore((s) => s.pendingElicitations)
  const tabId = useMcpStore((s) => s._currentTabId)
  return (
    <>
      {elicitations.map((e) => (
        <McpElicitationCard key={`${tabId ?? ''}:${e.elicitationId}`} elicitation={e} />
      ))}
      {outcome && (
        <div
          data-testid="mcp-input-outcome"
          data-outcome={outcome}
          className="mb-2 flex items-center gap-1.5 text-[12px] text-[var(--muted)]"
        >
          <Info size={12} />
          <span>
            {outcome === 'declined'
              ? t('mcp.call.outcomeDeclined')
              : t('mcp.call.outcomeCancelled')}
          </span>
        </div>
      )}
    </>
  )
}
