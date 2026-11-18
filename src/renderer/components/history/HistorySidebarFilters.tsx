/**
 * The History sidebar's search + filters: date, status, protocol and mock
 * target in a 2×2 grid — the overview's drop-downs (one shared filter set,
 * history store) — and, while a filter is set, "N of M" with a reset link.
 */
import {
  useHistoryStore,
  type HistoryRange,
  type HistoryStatusClass,
  type HistoryTarget,
} from '../../stores/history.store'
import { useTranslation } from '../../lib/i18n'
import { fillTemplate } from '../../../shared/fill-template'
import { formatCount } from '../../lib/plural'
import HistoryFilterSelect from './HistoryFilterSelect'
import HistorySearchBox from './HistorySearchBox'
import { historyProtocolName, rangeOptions, statusOptions, targetOptions } from './history-overview'

export default function HistorySidebarFilters({
  protocols,
  shown,
  total,
  filtering,
}: {
  /** Every protocol in the loaded history, most used first. */
  protocols: string[]
  shown: number
  total: number
  filtering: boolean
}) {
  const { t } = useTranslation()
  const filters = useHistoryStore((s) => s.filters)
  const setFilters = useHistoryStore((s) => s.setFilters)
  const resetFilters = useHistoryStore((s) => s.resetFilters)

  return (
    <div className="shrink-0 border-b border-[var(--border)] px-[10px] py-[8px]">
      <HistorySearchBox
        testId="history-search"
        value={filters.query}
        onChange={(query) => setFilters({ query })}
        placeholder={t('history.filterPlaceholder')}
        className="py-[6px]"
      />
      <div className="mt-2 grid grid-cols-2 gap-[6px]">
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
        <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--muted)]">
          <span data-testid="history-side-count">
            {fillTemplate(
              formatCount(total, t('history.filteredCountOne'), t('history.filteredCount')),
              { shown: String(shown) },
            )}
          </span>
          <button
            type="button"
            data-testid="history-side-reset"
            onClick={resetFilters}
            className="cursor-pointer border-none bg-transparent p-0 text-xs text-[var(--accent)]"
          >
            {t('historyHome.reset')}
          </button>
        </div>
      )}
    </div>
  )
}
