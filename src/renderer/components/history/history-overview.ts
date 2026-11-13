/**
 * Filtering and per-protocol figures for the History page (the workbench view
 * shown on the History page with no tab open). Everything works on the rows
 * the History store already loaded (`HISTORY_LIST_LIMIT`) — no extra query.
 */
import type { HistoryEntry } from '../../types'
import {
  EMPTY_FILTERS,
  HTTP_STATUS_PROTOCOLS,
  httpStatusClassesApply,
  type HistoryFilters,
  type HistoryRange,
  type HistoryStatusClass,
  type HistoryTarget,
} from '../../stores/history.store'
import { historyStatusDisplay } from '../../lib/history-status'
import { protocolChipName } from '../../lib/protocol-chip'
import { mcpHistorySearchText } from '../protocols/mcp/history-restore'

export type { HistoryFilters, HistoryRange, HistoryStatusClass, HistoryTarget }
export { EMPTY_FILTERS }

/** Rows per table page. */
export const PAGE_SIZE = 50

const DAY_MS = 24 * 60 * 60 * 1000

/** Is any filter set (protocol included)? Shows the "Reset" link. */
export function hasActiveFilters(f: HistoryFilters): boolean {
  return (
    f.protocol !== null ||
    f.range !== 'all' ||
    f.method !== '' ||
    f.status !== '' ||
    f.target !== '' ||
    f.query.trim() !== ''
  )
}

/**
 * The search the History sidebar and the page share: URL, method, the status
 * the row shows ("404", "Error" / "Hata", "OK") and, for MCP, the call name.
 */
export function matchesHistorySearch(
  e: HistoryEntry,
  query: string,
  t: (key: string) => string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    e.url.toLowerCase().includes(q) ||
    (e.method || '').toLowerCase().includes(q) ||
    (historyStatusDisplay(e, t)?.label.toLowerCase().includes(q) ?? false) ||
    // MCP rows: the tool / prompt name and resource URI too (issue #166).
    (e.protocol === 'mcp' && mcpHistorySearchText(e).toLowerCase().includes(q))
  )
}

/**
 * The HTTP class of a row, or '' — only for protocols that answer with an
 * HTTP code (HTTP, GraphQL, SOAP). A WebSocket 101 or an SSE 200 is a
 * connect, not an HTTP answer, so it falls in no class.
 */
export function httpClassOf(e: HistoryEntry): HistoryStatusClass {
  const code = e.status_code
  if (!HTTP_STATUS_PROTOCOLS.includes(e.protocol || 'http')) return ''
  if (code == null || code < 100 || code >= 600) return ''
  if (code < 300) return '2xx'
  if (code < 400) return '3xx'
  if (code < 500) return '4xx'
  return '5xx'
}

/** Does a row pass the status filter? ok / failed follow the row's colour. */
export function matchesStatus(
  e: HistoryEntry,
  status: HistoryStatusClass,
  t: (key: string) => string,
): boolean {
  if (!status) return true
  if (status === 'ok' || status === 'failed') {
    const display = historyStatusDisplay(e, t)
    if (!display) return false
    return status === 'failed' ? display.failed : !display.failed
  }
  return httpClassOf(e) === status
}

/** A mock server's address (HTTP / SSE / AI / MCP mocks). */
export interface MockAddress {
  host: string
  port: number
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'])

/**
 * Was the request sent to one of the project's mock servers? Same port, and
 * a loopback host or the mock's own host. Unparseable URLs ({{baseUrl}}…)
 * never match. A mock whose port changed no longer claims its old rows.
 */
export function isMockTarget(url: string, mocks: readonly MockAddress[]): boolean {
  if (mocks.length === 0) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  const port = Number(u.port || (u.protocol === 'https:' || u.protocol === 'wss:' ? 443 : 80))
  const host = u.hostname.toLowerCase()
  return mocks.some((m) => m.port === port && (LOOPBACK.has(host) || host === m.host))
}

function rangeStart(range: HistoryRange, now: number): number {
  if (range === 'all') return 0
  const d = new Date(now)
  const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (range === 'today') return startOfToday
  return startOfToday - (range === '7d' ? 6 : 29) * DAY_MS
}

/** Every filter except the protocol — what the cards count over. */
export function filterIgnoringProtocol(
  entries: HistoryEntry[],
  f: HistoryFilters,
  t: (key: string) => string,
  mocks: readonly MockAddress[] = [],
  now: number = Date.now(),
): HistoryEntry[] {
  const from = rangeStart(f.range, now)
  return entries.filter(
    (e) =>
      e.executed_at >= from &&
      (!f.method || (e.method || '').toUpperCase() === f.method) &&
      matchesStatus(e, f.status, t) &&
      (!f.target || isMockTarget(e.url, mocks) === (f.target === 'mock')) &&
      matchesHistorySearch(e, f.query, t),
  )
}

/** Rows that pass every filter, the protocol included — the table's rows. */
export function filterHistory(
  entries: HistoryEntry[],
  f: HistoryFilters,
  t: (key: string) => string,
  mocks: readonly MockAddress[] = [],
  now: number = Date.now(),
): HistoryEntry[] {
  return filterIgnoringProtocol(entries, f, t, mocks, now).filter(
    (e) => !f.protocol || (e.protocol || 'http') === f.protocol,
  )
}

export interface ProtocolStat {
  protocol: string
  count: number
  /** Share of rows with a status that did not fail, 0–100; null when none has a status. */
  okRate: number | null
  /** Newest `executed_at`. */
  last: number
}

/** Count, success rate and newest time per protocol — only protocols with rows, most used first. */
export function protocolStats(entries: HistoryEntry[], t: (key: string) => string): ProtocolStat[] {
  const by = new Map<string, { count: number; withStatus: number; ok: number; last: number }>()
  for (const e of entries) {
    const p = e.protocol || 'http'
    const s = by.get(p) ?? { count: 0, withStatus: 0, ok: 0, last: 0 }
    s.count += 1
    s.last = Math.max(s.last, e.executed_at)
    const display = historyStatusDisplay(e, t)
    if (display) {
      s.withStatus += 1
      if (!display.failed) s.ok += 1
    }
    by.set(p, s)
  }
  return [...by.entries()]
    .map(([protocol, s]) => ({
      protocol,
      count: s.count,
      okRate: s.withStatus ? Math.round((s.ok / s.withStatus) * 100) : null,
      last: s.last,
    }))
    .sort((a, b) => b.count - a.count || b.last - a.last)
}

/** All protocols together — the "All" card. */
export function totalStat(stats: ProtocolStat[]): Omit<ProtocolStat, 'protocol'> {
  const count = stats.reduce((n, s) => n + s.count, 0)
  const rated = stats.filter((s) => s.okRate != null)
  const ratedCount = rated.reduce((n, s) => n + s.count, 0)
  const okRate = ratedCount
    ? Math.round(rated.reduce((n, s) => n + (s.okRate as number) * s.count, 0) / ratedCount)
    : null
  return { count, okRate, last: stats.reduce((m, s) => Math.max(m, s.last), 0) }
}

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

/** The methods found on HTTP / SOAP rows, in the usual order (others after, A–Z). */
export function methodOptions(entries: HistoryEntry[]): string[] {
  const set = new Set<string>()
  for (const e of entries) {
    const p = e.protocol || 'http'
    if ((p === 'http' || p === 'soap') && e.method) set.add(e.method.toUpperCase())
  }
  const known = METHOD_ORDER.filter((m) => set.has(m))
  const rest = [...set].filter((m) => !METHOD_ORDER.includes(m)).sort()
  return [...known, ...rest]
}

/** A protocol's display name: the chip's full name, HTTP / SOAP otherwise. */
export function historyProtocolName(protocol: string): string {
  return protocolChipName(protocol) ?? protocol.toUpperCase()
}

/** Options of the date filter — the sidebar and the overview use the same. */
export function rangeOptions(t: (key: string) => string): Array<[HistoryRange, string]> {
  return [
    ['all', t('historyHome.range.all')],
    ['today', t('historyHome.range.today')],
    ['7d', t('historyHome.range.7d')],
    ['30d', t('historyHome.range.30d')],
  ]
}

/**
 * Options of the status filter — the sidebar and the overview use the same.
 * Successful / Failed fit every protocol; 2xx–5xx only HTTP, GraphQL, SOAP.
 */
export function statusOptions(
  t: (key: string) => string,
  protocol: string | null,
): Array<[HistoryStatusClass, string]> {
  const base: Array<[HistoryStatusClass, string]> = [
    ['', t('historyHome.status.all')],
    ['ok', t('historyHome.status.ok')],
    ['failed', t('historyHome.status.failed')],
  ]
  if (!httpStatusClassesApply(protocol)) return base
  return [...base, ['2xx', '2xx'], ['3xx', '3xx'], ['4xx', '4xx'], ['5xx', '5xx']]
}

/** Options of the mock-target filter. */
export function targetOptions(t: (key: string) => string): Array<[HistoryTarget, string]> {
  return [
    ['', t('historyHome.target.all')],
    ['mock', t('historyHome.target.mock')],
    ['notMock', t('historyHome.target.notMock')],
  ]
}
