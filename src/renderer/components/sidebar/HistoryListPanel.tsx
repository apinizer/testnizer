import { useEffect, useMemo, useState } from 'react'
import { Trash2, Clock, History as HistoryIcon } from 'lucide-react'
import {
  HISTORY_LIST_LIMIT,
  useHistoryStore,
  type HistoryRange,
  type HistoryStatusClass,
  type HistoryTarget,
} from '../../stores/history.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { mcpHistoryRowLabel } from '../protocols/mcp/history-restore'
import HistoryFilterSelect from '../history/HistoryFilterSelect'
import { useMockAddresses } from '../history/use-mock-addresses'
import {
  filterHistory,
  hasActiveFilters,
  historyProtocolName,
  protocolStats,
  rangeOptions,
  statusOptions,
  targetOptions,
} from '../history/history-overview'
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
  const clear = useHistoryStore((s) => s.clear)
  const deleteEntry = useHistoryStore((s) => s.deleteEntry)
  // Filters (search, date, status, protocol) are shared with the History
  // page's overview in the workbench — one set, the same rows in both.
  const filters = useHistoryStore((s) => s.filters)
  const setFilters = useHistoryStore((s) => s.setFilters)
  const resetFilters = useHistoryStore((s) => s.resetFilters)

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
        <button
          type="button"
          onClick={() => clear(activeWorkspaceId || undefined)}
          className="cursor-pointer rounded px-1.5 py-0.5"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--muted)',
            fontSize: 13,
          }}
          title={t('history.clearAllTitle')}
        >
          {t('history.clear')}
        </button>
      </div>

      {/* Search — the APIs / Mocks panels' box: px sizes (Tailwind rem spacing
       *  shrinks with the app's root font size), 1.5px border, 13px magnifier. */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--surface)',
            border: '1.5px solid var(--border2)',
            borderRadius: 8,
            padding: '6px 10px',
            gap: 7,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--hint)"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            data-testid="history-search"
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
            placeholder={t('history.filterPlaceholder')}
            aria-label={t('history.filterPlaceholder')}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 13,
              color: 'var(--text)',
              width: '100%',
              fontFamily: 'inherit',
            }}
          />
        </div>
        {/* Date, status / protocol, mock target — the overview's drop-downs, 2×2 */}
        <div
          className="mt-2"
          style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6 }}
        >
          <HistoryFilterSelect
            fill
            testId="history-side-range"
            label={t('historyHome.rangeLabel')}
            value={filters.range}
            onChange={(v) => setFilters({ range: v as HistoryRange })}
            options={rangeOptions(t)}
          />
          <HistoryFilterSelect
            fill
            testId="history-side-status"
            label={t('historyHome.col.status')}
            value={filters.status}
            onChange={(v) => setFilters({ status: v as HistoryStatusClass })}
            options={statusOptions(t, filters.protocol)}
          />
          <HistoryFilterSelect
            fill
            testId="history-side-protocol"
            label={t('historyHome.protocolLabel')}
            value={filters.protocol ?? ''}
            onChange={(v) => setFilters({ protocol: v || null })}
            options={[
              ['', t('historyHome.protocol.all')],
              ...protocols.map((p) => [p, historyProtocolName(p)] as [string, string]),
            ]}
          />
          <HistoryFilterSelect
            fill
            testId="history-side-target"
            label={t('historyHome.targetLabel')}
            value={filters.target}
            onChange={(v) => setFilters({ target: v as HistoryTarget })}
            options={targetOptions(t)}
          />
        </div>
        {filtering && (
          <div
            className="mt-1.5 flex items-center justify-between"
            style={{ fontSize: 12, color: 'var(--muted)' }}
          >
            <span data-testid="history-side-count">
              {t('history.filteredCount')
                .replace('{shown}', String(filtered.length))
                .replace('{total}', String(entries.length))}
            </span>
            <button
              type="button"
              data-testid="history-side-reset"
              onClick={resetFilters}
              className="cursor-pointer border-none bg-transparent p-0"
              style={{ color: 'var(--accent)', fontSize: 12 }}
            >
              {t('historyHome.reset')}
            </button>
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {/* Filters that match nothing are not an empty history. */}
        {groups.length === 0 && filtering && (
          <div
            data-testid="history-no-matches"
            className="px-4 py-4 text-center"
            style={{ color: 'var(--muted)', fontSize: 13 }}
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
                {entry.protocol === 'mcp' ? (
                  // The call (tool / prompt / resource), the server in the tooltip.
                  <span
                    className="flex-1 truncate"
                    style={{ fontSize: 13 }}
                    title={mcpHistoryRowLabel(entry).title}
                  >
                    {mcpHistoryRowLabel(entry).label}
                  </span>
                ) : (
                  <span className="flex-1 truncate" style={{ fontSize: 13 }}>
                    {shortUrl(entry.url)}
                  </span>
                )}
                <HistoryStatus entry={entry} t={t} />
                <span className="shrink-0" style={{ color: 'var(--hint)', fontSize: 13 }}>
                  {formatTime(entry.executed_at, locale)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTargetId(entry.id)
                  }}
                  className="hidden shrink-0 cursor-pointer group-hover:block"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--hint)',
                    padding: 1,
                  }}
                >
                  <Trash2 size={10} />
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

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.host + u.pathname
  } catch {
    return url
  }
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
