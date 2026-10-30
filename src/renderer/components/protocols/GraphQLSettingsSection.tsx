import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useRequestStore } from '../../stores/request.store'
import { useTranslation } from '../../lib/i18n'
import CriticalRequestToggle from '../request/CriticalRequestToggle'

/**
 * GraphQL request settings (issue #304): a collapsible section under Headers,
 * same anatomy as the Variables / Headers sections above it. Holds the
 * Critical switch — GraphQL rows run in the Runner, so they can stop a run.
 * A dot marks the collapsed section when the request is Critical (HTTP
 * Settings tab / MCP Settings badge rule).
 */
export default function GraphQLSettingsSection() {
  const { t } = useTranslation()
  const critical = useRequestStore((s) => s.critical)
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="shrink-0 border-t border-[var(--border)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        data-testid="graphql-settings-toggle"
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3.5 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{t('request.settings')}</span>
        {critical && (
          <span
            aria-hidden="true"
            className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--green)]"
          />
        )}
      </button>
      {expanded && (
        <div className="border-t border-[var(--border)] p-3">
          <CriticalRequestToggle />
        </div>
      )}
    </div>
  )
}
