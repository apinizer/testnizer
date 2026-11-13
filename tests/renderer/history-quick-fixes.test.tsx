/**
 * History page quick fixes (UI standardization, step 1):
 *   - a reopened HTTP / SOAP row's tab read "GET GET host/path": the tab strip
 *     already draws the method badge, so the name must not repeat it;
 *   - a search that matched nothing said "No history yet." — it is not an
 *     empty history, it is "No matches.";
 *   - the search now also matches the status the row shows ("404", "Error").
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import HistoryListPanel from '../../src/renderer/components/sidebar/HistoryListPanel'
import { historyTabName } from '../../src/renderer/lib/history-restore'
import { EMPTY_FILTERS, useHistoryStore } from '../../src/renderer/stores/history.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { HistoryEntry } from '../../src/renderer/types'

const row = (
  id: string,
  protocol: HistoryEntry['protocol'],
  method: string,
  url: string,
  status?: number,
): HistoryEntry => ({
  id,
  protocol,
  method,
  url,
  status_code: status,
  request_snapshot: {},
  executed_at: Date.now(),
})

const useLocale = (l: 'en' | 'tr'): void => {
  useUIStore.setState({ locale: l })
  setLocale(l)
}

function seed(entries: HistoryEntry[]): void {
  useHistoryStore.setState({
    entries,
    searchTerm: '',
    filters: EMPTY_FILTERS,
    fetch: vi.fn(async () => undefined),
  } as never)
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {}
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getState(),
    activeProjectId: 'p1',
    activeWorkspaceId: 'w1',
  })
})

afterEach(() => {
  cleanup()
  useLocale('en')
})

describe('historyTabName', () => {
  it('HTTP and SOAP tabs carry no method: the tab strip shows the badge', () => {
    expect(historyTabName(row('a', 'http', 'GET', 'https://api.site.com/users?x=1'))).toBe(
      'api.site.com/users',
    )
    expect(historyTabName(row('b', 'soap', 'POST', 'http://svc.local/ws'))).toBe('svc.local/ws')
  })

  it('other protocols keep the method — their tab has no method badge', () => {
    expect(historyTabName(row('c', 'websocket', 'CONNECT', 'ws://echo.local/chat'))).toBe(
      'CONNECT echo.local/chat',
    )
  })

  it('an unparseable URL is used as is', () => {
    expect(historyTabName(row('d', 'http', 'GET', '{{baseUrl}}/users'))).toBe('{{baseUrl}}/users')
  })
})

describe('History sidebar search', () => {
  const entries = [
    row('ok', 'http', 'GET', 'https://api.site.com/users', 200),
    row('nf', 'http', 'GET', 'https://api.site.com/orders', 404),
  ]

  it('a search with no match says "No matches.", not "No history yet."', () => {
    seed(entries)
    render(<HistoryListPanel />)
    fireEvent.change(screen.getByPlaceholderText(/.+/), { target: { value: 'zzz' } })
    expect(screen.getByTestId('history-no-matches').textContent).toBe('No matches.')
    expect(screen.queryByText('No history yet.')).toBeNull()
  })

  it('reads "Eşleşme yok." in Turkish', () => {
    useLocale('tr')
    seed(entries)
    render(<HistoryListPanel />)
    fireEvent.change(screen.getByPlaceholderText(/.+/), { target: { value: 'zzz' } })
    expect(screen.getByTestId('history-no-matches').textContent).toBe('Eşleşme yok.')
  })

  it('an empty history without a search still says "No history yet."', () => {
    seed([])
    render(<HistoryListPanel />)
    expect(screen.getByText('No history yet.')).toBeTruthy()
    expect(screen.queryByTestId('history-no-matches')).toBeNull()
  })

  it('matches the status code the row shows', () => {
    seed(entries)
    render(<HistoryListPanel />)
    fireEvent.change(screen.getByPlaceholderText(/.+/), { target: { value: '404' } })
    const rows = screen.getAllByTestId('history-entry')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toMatch(/orders/)
  })
})
