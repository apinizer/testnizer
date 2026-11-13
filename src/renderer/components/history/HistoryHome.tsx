/**
 * The History page's workbench view (shown with no tab open; it replaces the
 * old "Pick a history entry from the left panel" placeholder): one card per
 * protocol with rows, filters, and a paged table of the loaded history.
 * Works on the rows the History store already holds — the sidebar list loads
 * them — so it adds no query. Opening a row is the sidebar's own open.
 */
import { useMemo, useState } from 'react'
import { History as HistoryIcon } from 'lucide-react'
import { useHistoryStore } from '../../stores/history.store'
import { useTranslation } from '../../lib/i18n'
import { formatCount } from '../../lib/plural'
import { formatDate } from '../../lib/format-datetime'
import { fillTemplate } from '../../../shared/fill-template'
import EmptyState from '../shared/EmptyState'
import HistoryProtocolCard from './HistoryProtocolCard'
import HistoryHomeFilters from './HistoryHomeFilters'
import HistoryHomeTable from './HistoryHomeTable'
import HistoryHomePager from './HistoryHomePager'
import {
  PAGE_SIZE,
  filterHistory,
  filterIgnoringProtocol,
  historyProtocolName,
  methodOptions,
  protocolStats,
  totalStat,
} from './history-overview'
import { useMockAddresses } from './use-mock-addresses'

export default function HistoryHome() {
  const { t, locale } = useTranslation()
  const entries = useHistoryStore((s) => s.entries)
  // Filters are shared with the sidebar list (history store).
  const filters = useHistoryStore((s) => s.filters)
  const update = useHistoryStore((s) => s.setFilters)
  // The page belongs to one filter set: any filter change (here or in the
  // sidebar) starts again at page 1.
  const filterKey = JSON.stringify(filters)
  const [paging, setPaging] = useState({ key: filterKey, page: 0 })
  const page = paging.key === filterKey ? paging.page : 0

  const mocks = useMockAddresses(filters.target !== '')
  const forCards = useMemo(
    () => filterIgnoringProtocol(entries, filters, t, mocks),
    [entries, filters, t, mocks],
  )
  const stats = useMemo(() => protocolStats(forCards, t), [forCards, t])
  const total = useMemo(() => totalStat(stats), [stats])
  const rows = useMemo(
    () => filterHistory(entries, filters, t, mocks),
    [entries, filters, t, mocks],
  )
  const methods = useMemo(() => methodOptions(entries), [entries])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const pageRows = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const oldest = entries.reduce((m, e) => Math.min(m, e.executed_at), Infinity)

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" data-testid="history-home">
        <Header title={t('sidebar.history')} />
        <EmptyState
          icon={HistoryIcon}
          title={t('history.emptyTitle')}
          description={t('history.emptyDesc')}
        />
      </div>
    )
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden text-sm"
      data-testid="history-home"
      lang={locale}
    >
      <Header
        title={t('sidebar.history')}
        sub={fillTemplate(
          formatCount(entries.length, t('historyHome.summaryOne'), t('historyHome.summary')),
          { date: formatDate(oldest, locale, { year: false }) },
        )}
      />

      <div className="flex-1 overflow-auto px-6 py-5">
        {/* Protocol cards — only protocols that have rows */}
        <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
          <HistoryProtocolCard
            testId="history-card-all"
            label={t('historyHome.all')}
            stat={total}
            selected={filters.protocol === null}
            onClick={() => update({ protocol: null })}
          />
          {stats.map((s) => (
            <HistoryProtocolCard
              key={s.protocol}
              testId={`history-card-${s.protocol}`}
              label={historyProtocolName(s.protocol)}
              stat={s}
              selected={filters.protocol === s.protocol}
              onClick={() => update({ protocol: s.protocol })}
            />
          ))}
        </div>

        <HistoryHomeFilters methods={methods} />

        <div className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--white)]">
          {rows.length === 0 ? (
            <div
              data-testid="history-home-no-matches"
              className="py-8 text-center text-sm text-[var(--muted)]"
            >
              {t('historyHome.noMatches')}
            </div>
          ) : (
            <HistoryHomeTable rows={pageRows} />
          )}
        </div>

        {rows.length > PAGE_SIZE && (
          <HistoryHomePager
            page={current}
            pageCount={pageCount}
            pageSize={PAGE_SIZE}
            total={rows.length}
            onPage={(p) => setPaging({ key: filterKey, page: p })}
          />
        )}
      </div>
    </div>
  )
}

/** Same header as the Tests overview (TestsHome): 48px, bold title. */
function Header({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex h-[48px] shrink-0 items-center gap-3 border-b border-[var(--border)] px-6">
      <span className="text-lg font-bold text-[var(--text)]">{title}</span>
      {sub && (
        <span data-testid="history-home-summary" className="text-sm text-[var(--muted)]">
          {sub}
        </span>
      )}
    </div>
  )
}
