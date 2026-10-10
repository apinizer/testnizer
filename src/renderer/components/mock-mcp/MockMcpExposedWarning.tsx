import { AlertTriangle } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import type { MockMcpServerDraft } from '../../types/mock-mcp'
import { isExposedWithoutAuth } from '../../../shared/mock-mcp-exposure'

/**
 * Amber note when the DRAFT listens on a non-loopback host with no auth
 * (issue #154): shown under Listen (General) and under Auth (Scenarios) — the
 * two places where either half of the problem is fixed. Same predicate as the
 * running server's start-time log warning (`src/shared/mock-mcp-exposure.ts`).
 */
export default function MockMcpExposedWarning({
  draft,
}: {
  draft: Pick<MockMcpServerDraft, 'host' | 'authMode'>
}) {
  const { t } = useTranslation()
  if (!isExposedWithoutAuth(draft)) return null
  return (
    <div
      role="note"
      data-testid="mock-mcp-exposed-warning"
      className="flex items-start gap-1.5 text-[11px] text-[var(--orange)]"
    >
      <AlertTriangle size={12} className="mt-px shrink-0" />
      <span>{t('mockMcp.exposedWarning')}</span>
    </div>
  )
}
