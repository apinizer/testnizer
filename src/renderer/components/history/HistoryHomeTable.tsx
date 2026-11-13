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
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        <col className="w-[90px]" />
        <col />
        <col className="w-[90px]" />
        <col className="w-[90px]" />
        <col className="w-[130px]" />
      </colgroup>
      <thead>
        <tr className="bg-[var(--surface)]">
          <Th>{t('historyHome.col.method')}</Th>
          <Th>{t('historyHome.col.url')}</Th>
          <Th>{t('historyHome.col.status')}</Th>
          <Th align="right">{t('historyHome.col.duration')}</Th>
          <Th align="right">{t('historyHome.col.time')}</Th>
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

function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`border-b border-[var(--border)] px-[12px] py-[8px] text-xs font-semibold tracking-[0.4px] text-[var(--muted)] uppercase ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

const CELL = 'truncate border-t border-[var(--border)] px-[12px] py-[7px] text-sm'

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
      <td className={`${CELL} text-[var(--text)]`} title={label.title}>
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
