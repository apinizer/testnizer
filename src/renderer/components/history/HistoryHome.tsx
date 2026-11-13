/**
 * The History page's workbench view (shown with no tab open; it replaces the
 * old "Pick a history entry from the left panel" placeholder): one card per
 * protocol with rows, filters, and a paged table of the loaded history.
 * Works on the rows the History store already holds — the sidebar list loads
 * them — so it adds no query. Opening a row is the sidebar's own open.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, History as HistoryIcon } from 'lucide-react'
import { useHistoryStore } from '../../stores/history.store'
import { useTranslation } from '../../lib/i18n'
import { historyStatusDisplay } from '../../lib/history-status'
import { mcpHistoryRowLabel } from '../protocols/mcp/history-restore'
import { openHistoryEntry } from '../sidebar/open-history-entry'
import RequestBadge from '../shared/RequestBadge'
import EmptyState from '../shared/EmptyState'
import type { HistoryEntry } from '../../types'
import HistoryFilterSelect from './HistoryFilterSelect'
import {
  PAGE_SIZE,
  historyProtocolName,
  rangeOptions,
  statusOptions,
  targetOptions,
  filterHistory,
  filterIgnoringProtocol,
  hasActiveFilters,
  methodOptions,
  protocolStats,
  totalStat,
  type HistoryRange,
  type HistoryStatusClass,
  type HistoryTarget,
  type ProtocolStat,
} from './history-overview'
import { useMockAddresses } from './use-mock-addresses'

export default function HistoryHome() {
  const { t, locale } = useTranslation()
  const entries = useHistoryStore((s) => s.entries)
  // Filters are shared with the sidebar list (history store).
  const filters = useHistoryStore((s) => s.filters)
  const update = useHistoryStore((s) => s.setFilters)
  const resetFilters = useHistoryStore((s) => s.resetFilters)
  // The page belongs to one filter set: any filter change (here or in the
  // sidebar) starts again at page 1.
  const filterKey = JSON.stringify(filters)
  const [paging, setPaging] = useState({ key: filterKey, page: 0 })
  const page = paging.key === filterKey ? paging.page : 0
  const setPage = (p: number): void => setPaging({ key: filterKey, page: p })

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
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="history-home"
      lang={locale}
      style={{ fontSize: 13 }}
    >
      <Header
        title={t('sidebar.history')}
        sub={t('historyHome.summary')
          .replace('{count}', String(entries.length))
          .replace('{date}', formatDate(oldest, locale))}
      />

      <div className="flex-1 overflow-auto px-6 py-5">
        {/* Protocol cards — only protocols that have rows */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <ProtocolCard
            testId="history-card-all"
            label={t('historyHome.all')}
            stat={total}
            selected={filters.protocol === null}
            onClick={() => update({ protocol: null })}
          />
          {stats.map((s) => (
            <ProtocolCard
              key={s.protocol}
              testId={`history-card-${s.protocol}`}
              label={historyProtocolName(s.protocol)}
              stat={s}
              selected={filters.protocol === s.protocol}
              onClick={() => update({ protocol: s.protocol })}
            />
          ))}
        </div>

        {/* Filters */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div
            className="flex items-center"
            style={{
              background: 'var(--surface)',
              border: '1.5px solid var(--border2)',
              borderRadius: 8,
              padding: '5px 10px',
              gap: 7,
              minWidth: 220,
              flex: '1 1 220px',
              maxWidth: 360,
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
              data-testid="history-home-search"
              value={filters.query}
              onChange={(e) => update({ query: e.target.value })}
              placeholder={t('historyHome.search')}
              aria-label={t('historyHome.search')}
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
              className="cursor-pointer border-none bg-transparent"
              style={{ color: 'var(--accent)', fontSize: 13 }}
            >
              {t('historyHome.reset')}
            </button>
          )}
        </div>

        {/* Table */}
        <div
          className="overflow-hidden rounded-[8px] border"
          style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
        >
          {rows.length === 0 ? (
            <div
              data-testid="history-home-no-matches"
              className="py-8 text-center"
              style={{ color: 'var(--muted)', fontSize: 13 }}
            >
              {t('historyHome.noMatches')}
            </div>
          ) : (
            <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 90 }} />
                <col />
                <col style={{ width: 90 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 130 }} />
              </colgroup>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  <Th>{t('historyHome.col.method')}</Th>
                  <Th>{t('historyHome.col.url')}</Th>
                  <Th>{t('historyHome.col.status')}</Th>
                  <Th align="right">{t('historyHome.col.duration')}</Th>
                  <Th align="right">{t('historyHome.col.time')}</Th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((e) => (
                  <Row key={e.id} entry={e} t={t} locale={locale} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Paging */}
        {rows.length > PAGE_SIZE && (
          <div
            className="mt-3 flex items-center justify-between"
            style={{ color: 'var(--muted)', fontSize: 13 }}
          >
            <span data-testid="history-home-range">
              {t('historyHome.pageRange')
                .replace('{from}', String(current * PAGE_SIZE + 1))
                .replace('{to}', String(Math.min((current + 1) * PAGE_SIZE, rows.length)))
                .replace('{total}', String(rows.length))}
            </span>
            <div className="flex items-center gap-2">
              <PageButton
                testId="history-home-prev"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                <ChevronLeft size={14} /> {t('historyHome.prev')}
              </PageButton>
              <span>
                {current + 1} / {pageCount}
              </span>
              <PageButton
                testId="history-home-next"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
              >
                {t('historyHome.next')} <ChevronRight size={14} />
              </PageButton>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Parts ─────────────────────────────────────────────────── */

/** Same header as the Tests overview (TestsHome): 48px, 16px bold title. */
function Header({ title, sub }: { title: string; sub?: string }) {
  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-6"
      style={{ height: 48 }}
    >
      <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 16 }}>{title}</span>
      {sub && (
        <span data-testid="history-home-summary" style={{ color: 'var(--muted)', fontSize: 13 }}>
          {sub}
        </span>
      )}
    </div>
  )
}

function ProtocolCard({
  testId,
  label,
  stat,
  selected,
  onClick,
}: {
  testId: string
  label: string
  stat: Omit<ProtocolStat, 'protocol'>
  selected: boolean
  onClick: () => void
}) {
  const { t, locale } = useTranslation()
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      onClick={onClick}
      className="cursor-pointer rounded-[10px] p-3 text-left transition-colors hover:border-[var(--accent)]"
      style={{
        border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        background: selected ? 'var(--accent-light)' : 'var(--white)',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>{label}</div>
      <div
        data-testid={`${testId}-count`}
        style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}
      >
        {stat.count.toLocaleString(locale === 'tr' ? 'tr-TR' : undefined)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {stat.okRate == null
          ? t('historyHome.noStatus')
          : t('historyHome.okRate').replace('{rate}', String(stat.okRate))}
      </div>
      {stat.count > 0 && (
        <div style={{ fontSize: 12, color: 'var(--hint)' }}>
          {t('historyHome.last').replace('{when}', formatWhen(stat.last, t, locale))}
        </div>
      )}
    </button>
  )
}

function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align,
        padding: '8px 12px',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        color: 'var(--muted)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {children}
    </th>
  )
}

function Row({
  entry,
  t,
  locale,
}: {
  entry: HistoryEntry
  t: (key: string) => string
  locale: string
}) {
  const status = historyStatusDisplay(entry, t)
  const mcp = entry.protocol === 'mcp' ? mcpHistoryRowLabel(entry) : null
  const cell: CSSProperties = {
    padding: '7px 12px',
    borderTop: '1px solid var(--border)',
    fontSize: 13,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }
  return (
    <tr
      data-testid="history-home-row"
      onClick={() => openHistoryEntry(entry)}
      className="cursor-pointer hover:bg-[var(--item-hover)]"
    >
      <td style={cell}>
        <RequestBadge protocol={entry.protocol} method={entry.method} small />
      </td>
      <td style={{ ...cell, color: 'var(--text)' }} title={mcp ? mcp.title : entry.url}>
        {mcp ? mcp.label : shortUrl(entry.url)}
      </td>
      <td style={{ ...cell, color: status?.color ?? 'var(--hint)', fontWeight: 500 }}>
        <span title={status?.title}>{status?.label ?? '—'}</span>
      </td>
      <td style={{ ...cell, textAlign: 'right', color: 'var(--muted)' }}>
        {formatDuration(entry.duration_ms)}
      </td>
      <td style={{ ...cell, textAlign: 'right', color: 'var(--hint)' }}>
        {formatWhen(entry.executed_at, t, locale)}
      </td>
    </tr>
  )
}

function PageButton({
  testId,
  disabled,
  onClick,
  children,
}: {
  testId: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1 rounded-[6px] border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        borderColor: 'var(--border2)',
        background: 'var(--white)',
        color: 'var(--text)',
        fontSize: 13,
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  )
}

/* ── Formatting ────────────────────────────────────────────── */

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.host + u.pathname
  } catch {
    return url
  }
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function localeTag(locale: string): string | undefined {
  return locale === 'tr' ? 'tr-TR' : undefined
}

function formatDate(ts: number, locale: string): string {
  return new Date(ts).toLocaleDateString(localeTag(locale), { day: 'numeric', month: 'short' })
}

/** Today → time; yesterday → "Yesterday 14:05"; older → "12 Nov 14:05". */
function formatWhen(ts: number, t: (key: string) => string, locale: string): string {
  const d = new Date(ts)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const time = d.toLocaleTimeString(localeTag(locale), { hour: '2-digit', minute: '2-digit' })
  if (ts >= startOfToday) return time
  if (ts >= startOfToday - 24 * 60 * 60 * 1000) return `${t('history.yesterday')} ${time}`
  return `${formatDate(ts, locale)} ${time}`
}
