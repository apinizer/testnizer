import { useEffect, useMemo, useState } from 'react'
import { Trash2, Clock, History as HistoryIcon } from 'lucide-react'
import { HISTORY_LIST_LIMIT, useHistoryStore } from '../../stores/history.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { historyRowLabel } from '../shared/history-row-label'
import HistoryClearButton from './HistoryClearButton'
import HistorySidebarFilters from '../history/HistorySidebarFilters'
import { useMockAddresses } from '../history/use-mock-addresses'
import { filterHistory, hasActiveFilters, protocolStats } from '../history/history-overview'
import { openHistoryEntry } from './open-history-entry'
import RequestBadge from '../shared/RequestBadge'
import EmptyState from '../shared/EmptyState'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import type { HistoryEntry } from '../../types'
import { useTranslation } from '../../lib/i18n'
import { historyStatusDisplay } from '../../lib/history-status'

/**
 * Postman-style request history list for the left panel — individual requests
 * grouped by date. Runner/suite run history lives on the Tests page
 * (RunnerHistory); it used to be mirrored here too, which duplicated that view
 * and pushed the day's requests down, so it was removed.
 */
export default function HistoryListPanel() {
  const { t, locale } = useTranslation()
  const entries = useHistoryStore((s) => s.entries)
  const fetch = useHistoryStore((s) => s.fetch)
  const deleteEntry = useHistoryStore((s) => s.deleteEntry)
  // Filters (search, date, status, protocol) are shared with the History
  // page's overview in the workbench — one set, the same rows in both.
  const filters = useHistoryStore((s) => s.filters)

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  // Fetch on mount
  useEffect(() => {
    fetch({
      workspaceId: activeWorkspaceId || undefined,
      projectId: activeProjectId || undefined,
      limit: HISTORY_LIST_LIMIT,
    })
  }, [activeWorkspaceId, activeProjectId, fetch])

  const filtering = hasActiveFilters(filters)
  // The overview's "mock servers" filter applies here too (shared filters).
  const mocks = useMockAddresses(filters.target !== '')
  const filtered = useMemo(
    () => filterHistory(entries, filters, t, mocks),
    [entries, filters, t, mocks],
  )
  // Every protocol in the loaded history, most used first.
  const protocols = useMemo(() => protocolStats(entries, t).map((s) => s.protocol), [entries, t])

  const groups = useMemo(() => groupByDate(filtered, t, locale), [filtered, t, locale])

  return (
    <div className="flex h-full flex-col" lang={locale}>
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <Clock size={13} style={{ color: 'var(--accent)' }} />
        <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>
          {t('sidebar.history')}
        </span>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{entries.length}</span>
        <div className="flex-1" />
        {/* Clears the active project (what this list shows); disabled off the
            unfiltered list, since Clear ignores the search filter. */}
        <HistoryClearButton
          projectId={activeProjectId || undefined}
          listEmpty={entries.length === 0}
        />
      </div>

      <HistorySidebarFilters
        protocols={protocols}
        shown={filtered.length}
        total={entries.length}
        filtering={filtering}
      />

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {/* Filters that match nothing are not an empty history. */}
        {groups.length === 0 && filtering && (
          <div
            data-testid="history-no-matches"
            className="px-4 py-4 text-center text-sm text-[var(--muted)]"
          >
            {t('history.noMatches')}
          </div>
        )}
        {groups.length === 0 && !filtering && (
          <EmptyState
            icon={HistoryIcon}
            title={t('history.emptyTitle')}
            description={t('history.emptyDesc')}
            variant="compact"
            size="sm"
          />
        )}

        {groups.map(({ label, items }) => (
          <div key={label}>
            {/* Date group header */}
            <div
              className="sticky top-0 z-10 px-3 py-1 font-semibold uppercase tracking-wide"
              style={{
                background: 'var(--surface)',
                color: 'var(--muted)',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
              }}
            >
              {label}
            </div>

            {items.map((entry) => (
              <div
                key={entry.id}
                onClick={() => openHistoryEntry(entry)}
                data-testid="history-entry"
                className="group flex cursor-pointer items-center gap-1.5 px-3 py-[6px]"
                style={{
                  borderBottom: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = 'var(--item-hover)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                <RequestBadge protocol={entry.protocol} method={entry.method} small />
                {/* MCP: the call, the server in the tooltip; the rest: host+path,
                    the full (stored, masked) URL in the tooltip. */}
                <span
                  data-testid="history-entry-label"
                  className="flex-1 truncate"
                  style={{ fontSize: 13 }}
                  title={historyRowLabel(entry).title}
                >
                  {historyRowLabel(entry).label}
                </span>
                <HistoryStatus entry={entry} t={t} />
                <span className="shrink-0" style={{ color: 'var(--hint)', fontSize: 13 }}>
                  {formatTime(entry.executed_at, locale)}
                </span>
                <button
                  type="button"
                  data-testid="history-entry-delete"
                  aria-label={t('common.delete')}
                  title={t('common.delete')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTargetId(entry.id)
                  }}
                  // Hidden by opacity, not display:none, so Tab reaches it; shown
                  // on row hover and on keyboard focus.
                  className="shrink-0 cursor-pointer opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--hint)',
                    padding: 1,
                  }}
                >
                  <Trash2 size={10} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <DeleteConfirmDialog
        open={!!deleteTargetId}
        itemName={t('deleteConfirm.thisHistoryEntry')}
        itemType="history entry"
        typeLabel={t('deleteConfirm.type.historyEntry')}
        onConfirm={() => {
          if (deleteTargetId) deleteEntry(deleteTargetId)
          setDeleteTargetId(null)
        }}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────

function groupByDate(
  entries: HistoryEntry[],
  t: (key: string) => string,
  locale: string,
): Array<{ label: string; items: HistoryEntry[] }> {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000

  const today: HistoryEntry[] = []
  const yesterday: HistoryEntry[] = []
  const earlierBuckets = new Map<string, HistoryEntry[]>()

  for (const e of entries) {
    if (e.executed_at >= startOfToday) {
      today.push(e)
    } else if (e.executed_at >= startOfYesterday) {
      yesterday.push(e)
    } else {
      const d = new Date(e.executed_at)
      // EN keeps the system's date format; TR always reads Turkish.
      const key = d.toLocaleDateString(locale === 'tr' ? 'tr-TR' : undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      if (!earlierBuckets.has(key)) earlierBuckets.set(key, [])
      earlierBuckets.get(key)!.push(e)
    }
  }

  const out: Array<{ label: string; items: HistoryEntry[] }> = []
  if (today.length) out.push({ label: t('history.today'), items: today })
  if (yesterday.length) out.push({ label: t('history.yesterday'), items: yesterday })
  for (const [label, items] of earlierBuckets) {
    out.push({ label, items })
  }
  return out
}

function formatTime(ts: number, locale: string): string {
  return new Date(ts).toLocaleTimeString(locale === 'tr' ? 'tr-TR' : undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Status badge — the shared rule with the Recent endpoints list (G-15). */
function HistoryStatus({ entry, t }: { entry: HistoryEntry; t: (key: string) => string }) {
  const status = historyStatusDisplay(entry, t)
  if (!status) return null
  return (
    <span
      className="shrink-0 whitespace-nowrap font-medium"
      style={{ color: status.color, fontSize: 13 }}
      title={status.title}
    >
      {status.label}
    </span>
  )
}
