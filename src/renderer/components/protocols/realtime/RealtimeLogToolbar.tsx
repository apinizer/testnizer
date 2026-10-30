import type { ReactNode } from 'react'
import { Search, Trash2, X } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import type { LogFilter } from './use-realtime-log'

const FILTER_KEYS: Record<LogFilter, string> = {
  all: 'rt.log.filterAll',
  sent: 'rt.log.filterSent',
  received: 'rt.log.filterReceived',
  system: 'rt.log.filterSystem',
}

/**
 * Message-log toolbar shared by the WebSocket log and the Socket.IO timeline
 * (issues #282 / #283): search box with clear, All / Sent / Received / System
 * filter (`role="group"` + `aria-pressed`, the JSON | Preview switch's
 * anatomy), the time difference between the two selected rows, Clear.
 * `title` is the pane label on the left. Test ids `${testIdPrefix}-log-*`.
 */
export default function RealtimeLogToolbar({
  title,
  query,
  onQuery,
  filter,
  onFilter,
  filters,
  diffMs,
  onClearSelection,
  onClear,
  canClear,
  testIdPrefix,
}: {
  title: ReactNode
  query: string
  onQuery: (q: string) => void
  filter: LogFilter
  onFilter: (f: LogFilter) => void
  filters: readonly LogFilter[]
  diffMs: number | null
  onClearSelection: () => void
  onClear: () => void
  canClear: boolean
  testIdPrefix: string
}) {
  const { t } = useTranslation()
  const id = (s: string): string => `${testIdPrefix}-log-${s}`
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {title}
      </span>
      <div className="relative flex min-w-[10rem] flex-[1_1_12rem] items-center">
        <Search
          size={12}
          aria-hidden
          className="pointer-events-none absolute left-2 text-[var(--hint)]"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('rt.log.search')}
          aria-label={t('rt.log.search')}
          data-testid={id('search')}
          className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--white)] pr-6 pl-6 text-xs text-[var(--text)] outline-none placeholder:text-[var(--placeholder)] focus:border-[var(--accent)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery('')}
            aria-label={t('rt.log.clearSearch')}
            data-testid={id('search-clear')}
            className="absolute right-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded border-none bg-transparent text-[var(--muted)] hover:text-[var(--text)]"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div
        role="group"
        aria-label={t('rt.log.filter')}
        className="flex rounded-md border border-[var(--border)]"
      >
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            data-testid={id(`filter-${f}`)}
            onClick={() => onFilter(f)}
            className={`cursor-pointer border-none px-2 py-0.5 text-[11px] first:rounded-l-md last:rounded-r-md ${
              filter === f
                ? 'bg-[var(--accent-light)] font-semibold text-[var(--accent-text)]'
                : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {t(FILTER_KEYS[f])}
          </button>
        ))}
      </div>
      {diffMs !== null && (
        <span
          data-testid={id('diff')}
          className="flex items-center gap-1 rounded-full bg-[var(--accent-light)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--accent-text)]"
        >
          {t('rt.log.diff').replace('{ms}', String(diffMs))}
          <button
            type="button"
            onClick={onClearSelection}
            aria-label={t('rt.log.deselect')}
            data-testid={id('deselect')}
            className="flex cursor-pointer items-center border-none bg-transparent p-0 text-[var(--accent-text)]"
          >
            <X size={11} />
          </button>
        </span>
      )}
      <button
        type="button"
        onClick={onClear}
        disabled={!canClear}
        data-testid={id('clear')}
        className="ml-auto flex cursor-pointer items-center gap-1 border-none bg-transparent text-[11px] text-[var(--hint)] transition-colors hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 size={11} aria-hidden />
        {t('console.clear')}
      </button>
    </div>
  )
}
