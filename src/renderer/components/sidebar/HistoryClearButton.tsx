import { useTranslation } from '../../lib/i18n'
import { useHistoryClearConfirm } from '../shared/use-history-clear-confirm'

/**
 * History sidebar "Clear" (tester finding 4). It used to delete on the first
 * click, stayed clickable on an empty list, and deleted every project's
 * history while the list shows one project. It now clears what the list shows
 * — the active project — after the shared confirmation
 * (`useHistoryClearConfirm`, also used by Settings → Data).
 */
export default function HistoryClearButton({
  projectId,
  listEmpty,
}: {
  projectId: string | undefined
  /** Nothing listed → nothing to clear → disabled (same scope as the list). */
  listEmpty: boolean
}) {
  const { t } = useTranslation()
  const { ask, busy, dialog } = useHistoryClearConfirm({ projectId })
  const disabled = listEmpty || !projectId || busy

  return (
    <>
      <button
        type="button"
        data-testid="history-clear-btn"
        onClick={() => void ask()}
        disabled={disabled}
        className="cursor-pointer rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-sm text-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
        title={t('history.clearAllTitle')}
      >
        {t('history.clear')}
      </button>
      {dialog}
    </>
  )
}
