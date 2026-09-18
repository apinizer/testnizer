import { useEffect } from 'react'
import { Bookmark, Trash2, ExternalLink } from 'lucide-react'
import { useSavedResponseStore, savedResponseOwnerForTab } from '../../stores/saved-response.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useTranslation } from '../../lib/i18n'
import StatusBadge from '../shared/StatusBadge'
import EmptyState from '../shared/EmptyState'

/**
 * "Saved" response sub-tab (issue #125): the named examples pinned to the
 * request the active tab is backed by. Open shows one in the response pane
 * without re-sending; Delete removes it.
 */
export default function SavedResponsesTab() {
  const { t } = useTranslation()
  const items = useSavedResponseStore((s) => s.items)
  const load = useSavedResponseStore((s) => s.load)
  const open = useSavedResponseStore((s) => s.open)
  const remove = useSavedResponseStore((s) => s.remove)
  const activeTab = useTabsStore((s) => s.tabs.find((tb) => tb.id === s.activeTabId))
  const owner = savedResponseOwnerForTab(activeTab)
  const ownerKey = owner ? `${owner.type}:${owner.id}` : null

  useEffect(() => {
    void load(owner)
    // Reload when the backing row changes (Save As on a scratch tab).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey])

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
            <div className="truncate font-medium text-[var(--text)]">{item.name}</div>
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
            onClick={() => void remove(item.id)}
            title={t('response.deleteSavedResponse')}
            className="flex cursor-pointer items-center justify-center rounded p-1 text-[var(--muted)] transition-colors hover:text-[var(--red)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
