/**
 * History page overview (the workbench view on the History page with no tab
 * open): one card per protocol that has rows, filters (date, method, status,
 * search) and a paged table — all over the rows the History store
 * already loaded. Replaces the "Pick a history entry from the left panel"
 * placeholder.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import HistoryHome from '../../src/renderer/components/history/HistoryHome'
import HistoryListPanel from '../../src/renderer/components/sidebar/HistoryListPanel'
import {
  EMPTY_FILTERS,
  PAGE_SIZE,
  filterHistory,
  methodOptions,
  protocolStats,
  httpClassOf,
  isMockTarget,
  matchesStatus,
  statusOptions,
  totalStat,
} from '../../src/renderer/components/history/history-overview'
import { HISTORY_LIST_LIMIT, useHistoryStore } from '../../src/renderer/stores/history.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale, t as translate } from '../../src/renderer/lib/i18n'
import { formatWhen } from '../../src/renderer/components/history/history-format'
import type { HistoryEntry } from '../../src/renderer/types'

const openHistoryEntry = vi.fn()
vi.mock('../../src/renderer/components/sidebar/open-history-entry', () => ({
  openHistoryEntry: (e: unknown) => openHistoryEntry(e),
}))

const NOW = new Date(2026, 10, 12, 15, 0).getTime()
const DAY = 24 * 60 * 60 * 1000
const tEn = (k: string): string =>
  k === 'history.statusError' ? 'Error' : k === 'history.statusOk' ? 'OK' : k

let n = 0
const row = (over: Partial<HistoryEntry>): HistoryEntry => ({
  id: `h${++n}`,
  protocol: 'http',
  method: 'GET',
  url: `https://api.site.com/r${n}`,
  status_code: 200,
  duration_ms: 100,
  request_snapshot: {},
  executed_at: NOW - 60_000,
  ...over,
})

const useLocale = (l: 'en' | 'tr'): void => {
  useUIStore.setState({ locale: l })
  setLocale(l)
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {}
  n = 0
  openHistoryEntry.mockReset()
})

afterEach(() => {
  cleanup()
  useLocale('en')
})

describe('history-overview — the rules', () => {
  it('the History page loads 500 rows, the default history limit', () => {
    expect(HISTORY_LIST_LIMIT).toBe(500)
  })

  it('HTTP classes only for HTTP, GraphQL and SOAP — a WebSocket 101 is no "2xx"', () => {
    expect(httpClassOf(row({ status_code: 204 }))).toBe('2xx')
    expect(httpClassOf(row({ status_code: 301 }))).toBe('3xx')
    expect(httpClassOf(row({ protocol: 'graphql', status_code: 404 }))).toBe('4xx')
    expect(httpClassOf(row({ protocol: 'soap', status_code: 503 }))).toBe('5xx')
    expect(httpClassOf(row({ protocol: 'websocket', status_code: 101 }))).toBe('')
    expect(httpClassOf(row({ protocol: 'sse', status_code: 200 }))).toBe('')
    expect(httpClassOf(row({ protocol: 'grpc', status_code: 14 }))).toBe('')
  })

  it('Successful / Failed work for every protocol, like the row colour', () => {
    const ok = (e: HistoryEntry): boolean => matchesStatus(e, 'ok', tEn)
    const failed = (e: HistoryEntry): boolean => matchesStatus(e, 'failed', tEn)
    expect(ok(row({ status_code: 200 }))).toBe(true)
    expect(failed(row({ status_code: 404 }))).toBe(true)
    expect(ok(row({ protocol: 'grpc', status_code: 0 }))).toBe(true)
    expect(failed(row({ protocol: 'grpc', status_code: 14 }))).toBe(true)
    expect(ok(row({ protocol: 'websocket', status_code: 101 }))).toBe(true)
    expect(failed(row({ protocol: 'mqtt', status_code: -1 }))).toBe(true)
    // No status at all: neither.
    expect(ok(row({ status_code: undefined }))).toBe(false)
    expect(failed(row({ status_code: undefined }))).toBe(false)
  })

  it('the status options: 2xx–5xx only with an HTTP-like protocol picked', () => {
    const values = (p: string | null): string[] => statusOptions(tEn, p).map(([v]) => v)
    expect(values(null)).toEqual(['', 'ok', 'failed'])
    expect(values('grpc')).toEqual(['', 'ok', 'failed'])
    expect(values('http')).toEqual(['', 'ok', 'failed', '2xx', '3xx', '4xx', '5xx'])
    expect(values('graphql')).toEqual(['', 'ok', 'failed', '2xx', '3xx', '4xx', '5xx'])
  })

  it('switching away from an HTTP-like protocol drops an HTTP class', () => {
    useHistoryStore.setState({ filters: EMPTY_FILTERS } as never)
    useHistoryStore.getState().setFilters({ protocol: 'http', status: '4xx' })
    useHistoryStore.getState().setFilters({ protocol: 'grpc' })
    expect(useHistoryStore.getState().filters.status).toBe('')
    useHistoryStore.getState().setFilters({ protocol: 'http', status: 'failed' })
    useHistoryStore.getState().setFilters({ protocol: null })
    expect(useHistoryStore.getState().filters.status).toBe('failed')
  })

  it('a request is "sent to a mock" when it hits a mock port on a loopback host', () => {
    const mocks = [
      { host: '127.0.0.1', port: 8080 },
      { host: '0.0.0.0', port: 9090 },
    ]
    expect(isMockTarget('http://localhost:8080/users', mocks)).toBe(true)
    expect(isMockTarget('http://127.0.0.1:9090/mcp', mocks)).toBe(true)
    expect(isMockTarget('http://localhost:3000/users', mocks)).toBe(false)
    expect(isMockTarget('https://api.site.com:8080/x', mocks)).toBe(false)
    expect(isMockTarget('{{baseUrl}}/users', mocks)).toBe(false)
    expect(isMockTarget('http://localhost:8080/users', [])).toBe(false)
  })

  it('the mock filter keeps or drops the requests sent to mocks', () => {
    const rows = [
      row({ url: 'http://localhost:8080/users' }),
      row({ url: 'https://api.site.com/users' }),
    ]
    const mocks = [{ host: '127.0.0.1', port: 8080 }]
    const ids = (target: 'mock' | 'notMock'): string[] =>
      filterHistory(rows, { ...EMPTY_FILTERS, target }, tEn, mocks, NOW).map((e) => e.id)
    expect(ids('mock')).toEqual(['h1'])
    expect(ids('notMock')).toEqual(['h2'])
  })

  it('filters by date range, method, status and search', () => {
    const rows = [
      row({ method: 'GET', status_code: 200 }),
      row({ method: 'POST', status_code: 401, duration_ms: 1500 }),
      row({ method: 'GET', status_code: 500, executed_at: NOW - 10 * DAY }),
      row({ method: 'DELETE', url: 'https://other.io/x', executed_at: NOW - 40 * DAY }),
    ]
    const ids = (f: Partial<typeof EMPTY_FILTERS>): string[] =>
      filterHistory(rows, { ...EMPTY_FILTERS, ...f }, tEn, [], NOW).map((e) => e.id)

    expect(ids({})).toEqual(['h1', 'h2', 'h3', 'h4'])
    expect(ids({ range: 'today' })).toEqual(['h1', 'h2'])
    expect(ids({ range: '7d' })).toEqual(['h1', 'h2'])
    expect(ids({ range: '30d' })).toEqual(['h1', 'h2', 'h3'])
    expect(ids({ method: 'GET' })).toEqual(['h1', 'h3'])
    expect(ids({ protocol: 'http', status: '4xx' })).toEqual(['h2'])
    expect(ids({ status: 'failed' })).toEqual(['h2', 'h3'])
    expect(ids({ query: 'other.io' })).toEqual(['h4'])
    expect(ids({ query: '500' })).toEqual(['h3'])
  })

  it('per-protocol figures: only protocols with rows, most used first', () => {
    const rows = [
      row({ status_code: 200 }),
      row({ status_code: 500 }),
      row({ status_code: 200 }),
      row({ protocol: 'grpc', status_code: 0 }),
    ]
    const stats = protocolStats(rows, tEn)
    expect(stats.map((s) => [s.protocol, s.count, s.okRate])).toEqual([
      ['http', 3, 67],
      ['grpc', 1, 100],
    ])
    expect(totalStat(stats)).toMatchObject({ count: 4, okRate: 75 })
  })

  it('method options come from HTTP / SOAP rows only, in the usual order', () => {
    const rows = [
      row({ method: 'POST' }),
      row({ method: 'GET' }),
      row({ protocol: 'websocket', method: 'CONNECT' }),
    ]
    expect(methodOptions(rows)).toEqual(['GET', 'POST'])
  })
})

describe('HistoryHome', () => {
  function seed(entries: HistoryEntry[]): void {
    useHistoryStore.setState({
      entries,
      filters: EMPTY_FILTERS,
      fetch: vi.fn(async () => undefined),
    } as never)
  }

  it('no history → the empty state, no cards', () => {
    seed([])
    render(<HistoryHome />)
    expect(screen.getByText('No history yet.')).toBeTruthy()
    expect(screen.queryByTestId('history-card-all')).toBeNull()
  })

  it('cards: "All" plus one per protocol with rows; a card filters the table', () => {
    seed([row({}), row({}), row({ protocol: 'grpc', method: 'UNARY', status_code: 0 })])
    render(<HistoryHome />)
    expect(screen.getByTestId('history-card-all-count').textContent).toBe('3')
    expect(screen.getByTestId('history-card-http-count').textContent).toBe('2')
    expect(screen.getByTestId('history-card-grpc-count').textContent).toBe('1')
    expect(screen.queryByTestId('history-card-websocket')).toBeNull()

    fireEvent.click(screen.getByTestId('history-card-grpc'))
    expect(screen.getAllByTestId('history-home-row')).toHaveLength(1)
    expect(screen.getByTestId('history-card-grpc').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByTestId('history-card-all'))
    expect(screen.getAllByTestId('history-home-row')).toHaveLength(3)
  })

  it('a filter with no match says so and offers a reset', () => {
    seed([row({ status_code: 200 })])
    render(<HistoryHome />)
    fireEvent.change(screen.getByTestId('history-filter-status'), { target: { value: 'failed' } })
    expect(screen.getByTestId('history-home-no-matches').textContent).toBe(
      'No request matches these filters.',
    )
    fireEvent.click(screen.getByTestId('history-filter-reset'))
    expect(screen.getAllByTestId('history-home-row')).toHaveLength(1)
    expect(screen.queryByTestId('history-filter-reset')).toBeNull()
  })

  it('pages the table 50 rows at a time', () => {
    seed(Array.from({ length: PAGE_SIZE + 7 }, (_, i) => row({ executed_at: NOW - i * 1000 })))
    render(<HistoryHome />)
    expect(screen.getAllByTestId('history-home-row')).toHaveLength(PAGE_SIZE)
    expect(screen.getByTestId('history-home-range').textContent).toBe('1–50 of 57')
    fireEvent.click(screen.getByTestId('history-home-next'))
    expect(screen.getAllByTestId('history-home-row')).toHaveLength(7)
    expect(screen.getByTestId('history-home-next')).toHaveProperty('disabled', true)
  })

  it('clicking a row opens it the way the sidebar does', () => {
    const e = row({})
    seed([e])
    render(<HistoryHome />)
    fireEvent.click(screen.getByTestId('history-home-row'))
    expect(openHistoryEntry).toHaveBeenCalledWith(e)
  })

  it('reads Turkish', () => {
    useLocale('tr')
    seed([row({})])
    render(<HistoryHome />)
    expect(screen.getByTestId('history-card-all').textContent).toMatch(/Tümü/)
    expect(screen.getByPlaceholderText('URL, yöntem veya durum ara…')).toBeTruthy()
  })
})

describe('History overview — counters, dates and paging (merge review)', () => {
  function seed(entries: HistoryEntry[]): void {
    useHistoryStore.setState({
      entries,
      filters: EMPTY_FILTERS,
      fetch: vi.fn(async () => undefined),
    } as never)
  }

  it('one request reads singular in the summary and the sidebar count (issue #309 rule)', () => {
    const now = Date.now()
    seed([row({ executed_at: now, status_code: 500 })])
    render(<HistoryHome />)
    expect(screen.getByTestId('history-home-summary').textContent).toMatch(/^Last 1 request since /)
    cleanup()
    render(<HistoryListPanel />)
    fireEvent.change(screen.getByTestId('history-side-status'), { target: { value: 'failed' } })
    expect(screen.getByTestId('history-side-count').textContent).toBe('1 of 1 request')
  })

  it('two requests read plural; Turkish has one form', () => {
    const now = Date.now()
    seed([row({ executed_at: now }), row({ executed_at: now })])
    render(<HistoryHome />)
    expect(screen.getByTestId('history-home-summary').textContent).toMatch(
      /^Last 2 requests since /,
    )
    cleanup()
    useLocale('tr')
    render(<HistoryHome />)
    expect(screen.getByTestId('history-home-summary').textContent).toMatch(
      / tarihinden bu yana son 2 istek$/,
    )
  })

  it('times go through the shared formatter: 24-hour in Turkish, "Yesterday" from i18n', () => {
    const now = new Date(2026, 10, 12, 15, 0).getTime()
    const yesterdayMidnight = new Date(2026, 10, 11, 0, 5).getTime()
    useLocale('tr')
    expect(formatWhen(yesterdayMidnight, translate, 'tr', now)).toBe('Dün 00:05')
    useLocale('en')
    expect(formatWhen(yesterdayMidnight, translate, 'en', now)).toMatch(/^Yesterday /)
    // Older than yesterday: the short date without a year, then the time.
    expect(formatWhen(new Date(2026, 10, 1, 9, 30).getTime(), translate, 'tr', now)).toBe(
      '1 Kas 09:30',
    )
  })

  it('the pager shows "page / pages"', () => {
    const now = Date.now()
    seed(Array.from({ length: PAGE_SIZE + 7 }, () => row({ executed_at: now })))
    render(<HistoryHome />)
    expect(screen.getByTestId('history-home-page').textContent).toBe('1 / 2')
    fireEvent.click(screen.getByTestId('history-home-next'))
    expect(screen.getByTestId('history-home-page').textContent).toBe('2 / 2')
  })
})

describe('History sidebar filters — shared with the overview', () => {
  function seed(entries: HistoryEntry[]): void {
    useHistoryStore.setState({
      entries,
      filters: EMPTY_FILTERS,
      fetch: vi.fn(async () => undefined),
    } as never)
  }

  it('date, status and protocol drop-downs filter the list and show "N of M"', () => {
    // The component filters against the real clock ("Today"), so these rows
    // are stamped now — not with the fixed NOW the pure-rule tests use.
    const now = Date.now()
    seed([
      row({ status_code: 200, executed_at: now }),
      row({ status_code: 404, executed_at: now }),
      row({ protocol: 'grpc', method: 'UNARY', status_code: 0, executed_at: now }),
    ])
    render(<HistoryListPanel />)
    expect(screen.getAllByTestId('history-entry')).toHaveLength(3)
    expect(screen.queryByTestId('history-side-count')).toBeNull()

    fireEvent.change(screen.getByTestId('history-side-status'), { target: { value: 'failed' } })
    expect(screen.getAllByTestId('history-entry')).toHaveLength(1)
    expect(screen.getByTestId('history-side-count').textContent).toBe('1 of 3 requests')

    fireEvent.click(screen.getByTestId('history-side-reset'))
    fireEvent.change(screen.getByTestId('history-side-protocol'), { target: { value: 'grpc' } })
    expect(screen.getAllByTestId('history-entry')).toHaveLength(1)

    fireEvent.change(screen.getByTestId('history-side-protocol'), { target: { value: '' } })
    fireEvent.change(screen.getByTestId('history-side-range'), { target: { value: 'today' } })
    expect(screen.getAllByTestId('history-entry')).toHaveLength(3)
  })

  it('the sidebar has the mock-target drop-down too, laid out 2×2', () => {
    seed([row({})])
    render(<HistoryListPanel />)
    const target = screen.getByTestId('history-side-target')
    expect([...target.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'All targets',
      'Sent to mocks',
      'Excluding mocks',
    ])
    // Two equal columns (Tailwind `grid-cols-2` = repeat(2, minmax(0, 1fr))).
    const grid = target.parentElement as HTMLElement
    expect(grid.classList.contains('grid')).toBe(true)
    expect(grid.classList.contains('grid-cols-2')).toBe(true)
    expect(grid.querySelectorAll('select')).toHaveLength(4)
  })

  it('the protocol drop-down lists every protocol in the history, even just one', () => {
    seed([row({})])
    render(<HistoryListPanel />)
    const options = [...screen.getByTestId('history-side-protocol').querySelectorAll('option')]
    expect(options.map((o) => o.textContent)).toEqual(['All protocols', 'HTTP'])
  })

  it('one filter set: a status picked in the sidebar filters the overview, and back', () => {
    seed([row({ status_code: 200 }), row({ status_code: 500 })])
    render(
      <>
        <HistoryListPanel />
        <HistoryHome />
      </>,
    )
    fireEvent.change(screen.getByTestId('history-side-status'), { target: { value: 'failed' } })
    expect(screen.getAllByTestId('history-home-row')).toHaveLength(1)
    expect((screen.getByTestId('history-filter-status') as HTMLSelectElement).value).toBe('failed')

    fireEvent.click(screen.getByTestId('history-filter-reset'))
    expect(screen.getAllByTestId('history-entry')).toHaveLength(2)
    expect((screen.getByTestId('history-side-status') as HTMLSelectElement).value).toBe('')
  })

  it('reads Turkish', () => {
    useLocale('tr')
    seed([row({ status_code: 200 }), row({ status_code: 404 })])
    render(<HistoryListPanel />)
    fireEvent.change(screen.getByTestId('history-side-status'), { target: { value: 'failed' } })
    expect(screen.getByTestId('history-side-count').textContent).toBe('1 / 2 istek')
    expect(screen.getByRole('option', { name: 'Hatalı' })).toBeTruthy()
    // All four sidebar drop-downs read Turkish.
    const first = (id: string): string | null =>
      screen.getByTestId(id).querySelector('option')?.textContent ?? null
    expect(first('history-side-range')).toBe('Tüm zamanlar')
    expect(first('history-side-status')).toBe('Tüm durumlar')
    expect(first('history-side-protocol')).toBe('Tüm protokoller')
    expect(first('history-side-target')).toBe('Tüm hedefler')
    expect(screen.getByRole('option', { name: "Mock'a gidenler" })).toBeTruthy()
    expect(screen.getByTestId('history-side-reset').textContent).toBe('Filtreleri sıfırla')
  })
})
