/**
 * The History overview's filter row: search, date, method (when the history
 * has HTTP / SOAP methods), status and mock target, plus "Reset filters".
 * The protocol is picked with the cards above. One filter set with the
 * sidebar (history store).
 *
 * Layout (container query on the overview's own width, like ResponsePane):
 * wide — search (fixed width), the selects, "Reset filters" at the end;
 * narrow — search + reset on the first line, the selects as an equal grid
 * below. The reset slot is always there (an invisible copy of the label when
 * no filter is set), so the row does not move when it appears.
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
    <div className="@container mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <HistorySearchBox
          testId="history-home-search"
          value={filters.query}
          onChange={(query) => update({ query })}
          placeholder={t('historyHome.search')}
          className="w-[320px] shrink-0 py-[5px] @max-[74em]:w-auto @max-[74em]:min-w-0 @max-[74em]:flex-1"
        />
        <div
          data-testid="history-home-selects"
          className="flex flex-wrap items-center gap-2 @max-[74em]:order-last @max-[74em]:grid @max-[74em]:basis-full @max-[74em]:auto-cols-fr @max-[74em]:grid-flow-col @max-[74em]:[&>select]:w-full @max-[74em]:[&>select]:min-w-0 @max-[36em]:grid-flow-row @max-[36em]:grid-cols-2"
        >
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
        </div>
        <span className="flex-1 @max-[74em]:hidden" />
        {hasActiveFilters(filters) ? (
          <button
            type="button"
            data-testid="history-filter-reset"
            onClick={resetFilters}
            className="cursor-pointer border-none bg-transparent p-0 text-sm whitespace-nowrap text-[var(--accent)]"
          >
            {t('historyHome.reset')}
          </button>
        ) : (
          // Holds the reset's place, so nothing moves when it appears.
          <span aria-hidden="true" className="invisible text-sm whitespace-nowrap">
            {t('historyHome.reset')}
          </span>
        )}
      </div>
    </div>
  )
}
