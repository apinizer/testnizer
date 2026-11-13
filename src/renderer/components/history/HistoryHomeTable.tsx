/**
 * The History overview's table: one page of filtered rows (method, URL or MCP
 * call, status, duration, time). A row opens the way the sidebar opens it.
 */
import type { ReactNode } from 'react'
import { useTranslation } from '../../lib/i18n'
import { historyStatusDisplay } from '../../lib/history-status'
import { historyRowLabel } from '../shared/history-row-label'
import { openHistoryEntry } from '../sidebar/open-history-entry'
import RequestBadge from '../shared/RequestBadge'
import type { HistoryEntry } from '../../types'
import { formatDuration, formatWhen } from './history-format'

export default function HistoryHomeTable({ rows }: { rows: HistoryEntry[] }) {
  const { t } = useTranslation()
  return (
    // Auto layout: method, status, duration and time size to their content
    // (never cut — "Yesterday 12:58 PM", "Oct 9, 2025 04:58 PM"), the URL
    // column takes the rest and truncates (`max-w-0` + `w-full`). A fixed
    // `<col>` width cut the English time.
    <table className="w-full border-collapse">
      <thead>
        <tr className="bg-[var(--surface)]">
          <Th className="min-w-[90px]">{t('historyHome.col.method')}</Th>
          <Th className="w-full">{t('historyHome.col.url')}</Th>
          <Th className="min-w-[90px]">{t('historyHome.col.status')}</Th>
          <Th className="min-w-[90px]" align="right">
            {t('historyHome.col.duration')}
          </Th>
          <Th className="min-w-[110px]" align="right">
            {t('historyHome.col.time')}
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <Row key={e.id} entry={e} />
        ))}
      </tbody>
    </table>
  )
}

function Th({
  children,
  className,
  align = 'left',
}: {
  children: ReactNode
  className: string
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`border-b border-[var(--border)] px-[12px] py-[8px] text-xs font-semibold tracking-[0.4px] whitespace-nowrap text-[var(--muted)] uppercase ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
    >
      {children}
    </th>
  )
}

const CELL = 'border-t border-[var(--border)] px-[12px] py-[7px] text-sm whitespace-nowrap'

function Row({ entry }: { entry: HistoryEntry }) {
  const { t, locale } = useTranslation()
  const status = historyStatusDisplay(entry, t)
  // MCP: the call, the server in the tooltip; the rest: host+path, the full
  // (stored, masked) URL in the tooltip — the sidebar row's rule.
  const label = historyRowLabel(entry)
  return (
    <tr
      data-testid="history-home-row"
      onClick={() => openHistoryEntry(entry)}
      className="cursor-pointer hover:bg-[var(--item-hover)]"
    >
      <td className={CELL}>
        <RequestBadge protocol={entry.protocol} method={entry.method} small />
      </td>
      <td className={`${CELL} w-full max-w-0 truncate text-[var(--text)]`} title={label.title}>
        {label.label}
      </td>
      <td
        className={`${CELL} font-medium`}
        // The status colour is the row's own (green / red / …), a dynamic value.
        style={{ color: status?.color ?? 'var(--hint)' }}
      >
        <span title={status?.title}>{status?.label ?? '—'}</span>
      </td>
      <td className={`${CELL} text-right text-[var(--muted)]`}>
        {formatDuration(entry.duration_ms)}
      </td>
      <td className={`${CELL} text-right text-[var(--hint)]`}>
        {formatWhen(entry.executed_at, t, locale)}
      </td>
    </tr>
  )
}
