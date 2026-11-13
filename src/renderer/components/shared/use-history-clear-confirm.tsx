import { useEffect, useRef, useState, type ReactNode } from 'react'
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
 *
 * The confirmation is bound to the project it was opened for: Confirm deletes
 * THAT project, never "whatever is active now". The History panel does not
 * remount on a project switch, so a switch cancels a count still in flight and
 * closes an open confirmation — the dialog's number belongs to the old project.
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
  // The open confirmation: the project it names + its count (null = unknown).
  const [pending, setPending] = useState<{ projectId: string; count: number | null } | null>(null)
  const [busy, setBusy] = useState(false)
  // Project switch → drop the confirmation (render-time reset, not an effect).
  const [boundProject, setBoundProject] = useState(projectId)
  if (boundProject !== projectId) {
    setBoundProject(projectId)
    setPending(null)
  }
  // The project the hook serves now, read by a count that resolves later.
  const currentProject = useRef(projectId)
  useEffect(() => {
    currentProject.current = projectId
  }, [projectId])

  async function ask(): Promise<void> {
    const target = projectId
    if (!target || busy) return
    setBusy(true)
    try {
      const n = await count(target)
      // Switched away while counting: this answer is for another project.
      if (currentProject.current !== target) return
      if (n === 0 && onNothingToClear) onNothingToClear()
      else setPending({ projectId: target, count: n })
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    const target = pending?.projectId
    setPending(null)
    // Only the project the dialog named, and only while it is still the one shown.
    if (!target || target !== currentProject.current) return
    setBusy(true)
    try {
      // Not `onCleared?.(await clear(…))`: an optional call skips its
      // arguments when the callback is absent, so nothing would be deleted.
      const result = await clear(target)
      onCleared?.(result)
    } finally {
      setBusy(false)
    }
  }

  const open = pending !== null && pending.projectId === projectId
  const itemName =
    open && typeof pending.count === 'number'
      ? formatCount(
          pending.count,
          t('deleteConfirm.projectHistoryCountOne'),
          t('deleteConfirm.projectHistoryCount'),
        )
      : t('deleteConfirm.projectHistoryItem')

  const dialog = (
    <DeleteConfirmDialog
      open={open}
      itemName={itemName}
      itemType="project history"
      typeLabel={t('deleteConfirm.type.projectHistory')}
      onConfirm={() => void confirm()}
      onCancel={() => setPending(null)}
    />
  )

  return { ask, busy, dialog }
}
