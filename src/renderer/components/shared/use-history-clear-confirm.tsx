import { useState, type ReactNode } from 'react'
import { useHistoryStore } from '../../stores/history.store'
import { useTranslation } from '../../lib/i18n'
import { formatCount } from '../../lib/plural'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'

/**
 * The ONE "clear request history" flow (tester finding 4): the History sidebar
 * Clear and Project Settings → Data → Clear history both go through it, so they
 * share scope (the project), wording and dialog.
 *
 * `ask()` counts first (main's `history:count`, the delete's own WHERE — the
 * sidebar list is capped at 200, so its length is not the number deleted),
 * then opens the shared `DeleteConfirmDialog` with that count. The dialog is
 * the sibling bulk delete's (RunnerHistory: `formatCount`, no typed
 * confirmation). Nothing is deleted before Confirm.
 */
export function useHistoryClearConfirm({
  projectId,
  onCleared,
  onNothingToClear,
}: {
  projectId: string | null | undefined
  /** After Confirm: whether main deleted, and its error when it refused. */
  onCleared?: (result: { ok: boolean; error?: string }) => void
  /** The count came back 0: no dialog is opened. */
  onNothingToClear?: () => void
}): { ask: () => Promise<void>; busy: boolean; dialog: ReactNode } {
  const { t } = useTranslation()
  const clear = useHistoryStore((s) => s.clear)
  const count = useHistoryStore((s) => s.count)
  // undefined = closed; null = open, count unknown; number = open with count.
  const [pending, setPending] = useState<number | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  async function ask(): Promise<void> {
    if (!projectId || busy) return
    setBusy(true)
    try {
      const n = await count(projectId)
      if (n === 0 && onNothingToClear) onNothingToClear()
      else setPending(n)
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    setPending(undefined)
    if (!projectId) return
    setBusy(true)
    try {
      // Not `onCleared?.(await clear(…))`: an optional call skips its
      // arguments when the callback is absent, so nothing would be deleted.
      const result = await clear(projectId)
      onCleared?.(result)
    } finally {
      setBusy(false)
    }
  }

  const itemName =
    typeof pending === 'number'
      ? formatCount(
          pending,
          t('deleteConfirm.projectHistoryCountOne'),
          t('deleteConfirm.projectHistoryCount'),
        )
      : t('deleteConfirm.projectHistoryItem')

  const dialog = (
    <DeleteConfirmDialog
      open={pending !== undefined}
      itemName={itemName}
      itemType="project history"
      typeLabel={t('deleteConfirm.type.projectHistory')}
      onConfirm={() => void confirm()}
      onCancel={() => setPending(undefined)}
    />
  )

  return { ask, busy, dialog }
}
