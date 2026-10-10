import { EyeOff, X } from 'lucide-react'
import { useTabsStore } from '../../stores/tabs.store'
import { useHistoryHiddenStore } from '../../stores/history-hidden.store'
import { useTranslation } from '../../lib/i18n'

/**
 * "Credentials were not stored — enter them again" (issue #195). Shown above
 * the editor of a tab reopened from History when a literal credential had to
 * come back empty; lists where. Dismissable. Same idea as MCP's
 * `McpHiddenArgsNote`.
 */
export default function HistoryHiddenNote() {
  const { t } = useTranslation()
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const hidden = useHistoryHiddenStore((s) => (activeTabId ? s.byTab[activeTabId] : undefined))
  const clear = useHistoryHiddenStore((s) => s.clear)
  if (!activeTabId || !hidden || hidden.length === 0) return null
  return (
    <div
      data-testid="history-hidden-credentials"
      role="note"
      className="mx-3 mt-2 flex items-start gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--muted)]"
    >
      <EyeOff size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span className="flex-1">
        {t('history.hiddenCredentials')}:{' '}
        <span className="font-mono text-[var(--text)]">{hidden.join(', ')}</span>
      </span>
      <button
        type="button"
        data-testid="history-hidden-credentials-dismiss"
        onClick={() => clear(activeTabId)}
        title={t('history.hiddenCredentialsDismiss')}
        aria-label={t('history.hiddenCredentialsDismiss')}
        className="cursor-pointer border-none bg-transparent p-0 text-[var(--muted)]"
      >
        <X size={12} />
      </button>
    </div>
  )
}
