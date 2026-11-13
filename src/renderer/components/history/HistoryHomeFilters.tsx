/**
 * The History overview's filter row: search, date, method (when the history
 * has HTTP / SOAP methods), status and mock target, plus "Reset filters".
 * The protocol is picked with the cards above. One filter set with the
 * sidebar (history store).
 */
import {
  useHistoryStore,
  type HistoryRange,
  type HistoryStatusClass,
  type HistoryTarget,
} from '../../stores/history.store'
import { useTranslation } from '../../lib/i18n'
import HistoryFilterSelect from './HistoryFilterSelect'
import HistorySearchBox from './HistorySearchBox'
import { hasActiveFilters, rangeOptions, statusOptions, targetOptions } from './history-overview'

export default function HistoryHomeFilters({ methods }: { methods: string[] }) {
  const { t } = useTranslation()
  const filters = useHistoryStore((s) => s.filters)
  const update = useHistoryStore((s) => s.setFilters)
  const resetFilters = useHistoryStore((s) => s.resetFilters)

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <HistorySearchBox
        testId="history-home-search"
        value={filters.query}
        onChange={(query) => update({ query })}
        placeholder={t('historyHome.search')}
        className="max-w-[360px] min-w-[220px] flex-[1_1_220px] py-[5px]"
      />
      <HistoryFilterSelect
        testId="history-filter-range"
        label={t('historyHome.rangeLabel')}
        value={filters.range}
        onChange={(v) => update({ range: v as HistoryRange })}
        options={rangeOptions(t)}
      />
      {methods.length > 0 && (
        <HistoryFilterSelect
          testId="history-filter-method"
          label={t('historyHome.col.method')}
          value={filters.method}
          onChange={(v) => update({ method: v })}
          options={[
            ['', t('historyHome.method.all')],
            ...methods.map((m) => [m, m] as [string, string]),
          ]}
        />
      )}
      <HistoryFilterSelect
        testId="history-filter-status"
        label={t('historyHome.col.status')}
        value={filters.status}
        onChange={(v) => update({ status: v as HistoryStatusClass })}
        options={statusOptions(t, filters.protocol)}
      />
      <HistoryFilterSelect
        testId="history-filter-target"
        label={t('historyHome.targetLabel')}
        value={filters.target}
        onChange={(v) => update({ target: v as HistoryTarget })}
        options={targetOptions(t)}
      />
      <span className="flex-1" />
      {hasActiveFilters(filters) && (
        <button
          type="button"
          data-testid="history-filter-reset"
          onClick={resetFilters}
          className="cursor-pointer border-none bg-transparent text-sm text-[var(--accent)]"
        >
          {t('historyHome.reset')}
        </button>
      )}
    </div>
  )
}
