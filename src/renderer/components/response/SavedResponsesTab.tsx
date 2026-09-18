import { useEffect, useRef, useState } from 'react'
import { Bookmark, Trash2, ExternalLink, Pencil } from 'lucide-react'
import { useSavedResponseStore, savedResponseOwnerForTab } from '../../stores/saved-response.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useTranslation } from '../../lib/i18n'
import StatusBadge from '../shared/StatusBadge'
import EmptyState from '../shared/EmptyState'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import type { SavedResponse } from '../../types'

/**
 * "Saved" response sub-tab (issue #125): the named examples pinned to the
 * request the active tab is backed by. Open shows one in the response pane
 * without re-sending; Delete removes it.
 */
export default function SavedResponsesTab() {
  const { t } = useTranslation()
  const items = useSavedResponseStore((s) => s.items)
  const open = useSavedResponseStore((s) => s.open)
  const remove = useSavedResponseStore((s) => s.remove)
  const rename = useSavedResponseStore((s) => s.rename)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SavedResponse | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const activeTab = useTabsStore((s) => s.tabs.find((tb) => tb.id === s.activeTabId))
  const owner = savedResponseOwnerForTab(activeTab)

  // Loading is owned by ResponsePane (effect on the owner key) + the tabs
  // subscription in the store; this component only renders the list.

  useEffect(() => {
    if (renamingId) setTimeout(() => renameRef.current?.select(), 10)
  }, [renamingId])

  function startRename(item: SavedResponse): void {
    setRenameValue(item.name)
    setRenamingId(item.id)
  }

  async function commitRename(): Promise<void> {
    const id = renamingId
    const value = renameValue.trim()
    setRenamingId(null)
    if (!id || !value) return
    const current = items.find((i) => i.id === id)
    if (!current || current.name === value) return
    await rename(id, value)
  }

  if (!owner) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<Bookmark size={28} />}
          title={t('response.savedResponsesEmpty')}
          description={t('response.saveResponseNeedsSavedRequest')}
        />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<Bookmark size={28} />}
          title={t('response.savedResponsesEmpty')}
          description={t('response.savedResponsesHint')}
        />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto" data-testid="saved-responses-list">
      {items.map((item) => (
        <div
          key={item.id}
          data-testid="saved-response-row"
          className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-2 hover:bg-[var(--hover)]"
        >
          {item.status_code != null && <StatusBadge status={item.status_code} pill />}
          <div className="min-w-0 flex-1">
            {renamingId === item.id ? (
              <input
                ref={renameRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => void commitRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
                data-testid="saved-response-rename"
                className="w-full rounded border border-[var(--accent)] bg-[var(--white)] px-1 text-[var(--text)] outline-none"
              />
            ) : (
              <div
                className="truncate font-medium text-[var(--text)]"
                onDoubleClick={() => startRename(item)}
                title={t('response.renameSavedResponseHint')}
              >
                {item.name}
              </div>
            )}
            <div className="truncate text-[var(--muted)]" style={{ fontSize: 11 }}>
              {item.method ? `${item.method} ` : ''}
              {item.url || ''}
              {' · '}
              {new Date(item.created_at).toLocaleString()}
            </div>
          </div>
          <button
            type="button"
            onClick={() => open(item)}
            title={t('response.openSavedResponse')}
            className="flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
            style={{ borderColor: 'var(--border)', background: 'transparent', fontSize: 12 }}
          >
            <ExternalLink size={11} />
            {t('response.openSavedResponse')}
          </button>
          <button
            type="button"
            onClick={() => startRename(item)}
            title={t('response.renameSavedResponse')}
            className="flex cursor-pointer items-center justify-center rounded p-1 text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => setDeleteTarget(item)}
            title={t('response.deleteSavedResponse')}
            className="flex cursor-pointer items-center justify-center rounded p-1 text-[var(--muted)] transition-colors hover:text-[var(--red)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        itemName={deleteTarget?.name ?? ''}
        itemType={t('response.savedResponseItemType')}
        onConfirm={() => {
          if (deleteTarget) void remove(deleteTarget.id)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
