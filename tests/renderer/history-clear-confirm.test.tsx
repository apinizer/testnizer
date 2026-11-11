/**
 * Tester findings 4 + 5 (History sidebar).
 *
 * 4 — "Clear" deleted every History row with no confirmation, stayed
 *     clickable on an empty list, and deleted by WORKSPACE (every project)
 *     while the list shows only the active project. Clear now deletes what the
 *     list shows — the active project's history, the same scope as Settings →
 *     Data "Clear history" — after the shared confirmation. The count comes
 *     from main (`history:count`, the delete's own WHERE): the list is capped
 *     at 200 rows, so `entries.length` is not the number deleted.
 *
 * 5a — the truncated URL of an HTTP / WebSocket / … row had no tooltip (MCP rows
 *      did). Every row now titles with its stored URL, which main has already
 *      masked (issue #195), so the tooltip never shows a raw credential.
 * 5b — the row's trash button had no accessible name.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HistoryListPanel from '../../src/renderer/components/sidebar/HistoryListPanel'
import { useHistoryStore } from '../../src/renderer/stores/history.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import { HISTORY_MASK } from '../../src/shared/credential-headers'

interface Row {
  id: string
  workspace_id: string
  project_id: string
  protocol: string
  method: string
  url: string
  status_code: number
  duration_ms: number
  request_snapshot: string
  executed_at: number
}

const MASKED_URL = `https://api.example.com/v1/orders/42?api_key=${HISTORY_MASK}&page=2`

function rows(): Row[] {
  const now = Date.now()
  return [
    {
      id: 'h-http',
      workspace_id: 'w1',
      project_id: 'p1',
      protocol: 'http',
      method: 'GET',
      url: MASKED_URL,
      status_code: 200,
      duration_ms: 12,
      request_snapshot: '{}',
      executed_at: now,
    },
    {
      id: 'h-ws',
      workspace_id: 'w1',
      project_id: 'p1',
      protocol: 'websocket',
      method: 'CONNECT',
      url: 'wss://echo.example.com/socket/live',
      status_code: 101,
      duration_ms: 5,
      request_snapshot: '{}',
      executed_at: now - 1000,
    },
  ]
}

let listed: Row[] = []
let workspaceCount = 5
const clear = vi.fn((scope: { project_id?: string }) => {
  listed = listed.filter((r) => r.project_id !== scope.project_id)
  return Promise.resolve({ success: true, data: workspaceCount })
})
const count = vi.fn((_scope: { project_id?: string }) =>
  Promise.resolve({ success: true, data: workspaceCount }),
)

const useLocale = (l: 'en' | 'tr'): void => {
  useUIStore.setState({ locale: l })
  setLocale(l)
}

beforeEach(() => {
  listed = rows()
  workspaceCount = 5
  clear.mockClear()
  count.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    history: {
      // The real list is project-scoped (`getHistory` ANDs workspace + project).
      list: (o: { project_id?: string }) =>
        Promise.resolve({
          success: true,
          data: listed.filter((r) => !o.project_id || r.project_id === o.project_id),
        }),
      clear,
      count,
      delete: () => Promise.resolve({ success: true, data: true }),
    },
  }
  useHistoryStore.setState({ entries: [], searchTerm: '' })
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

async function renderWithRows(): Promise<void> {
  render(<HistoryListPanel />)
  await waitFor(() => expect(screen.getAllByTestId('history-entry')).toHaveLength(2))
}

describe('History Clear asks first (finding 4)', () => {
  it('opens a confirmation with the count main will delete, and deletes nothing yet', async () => {
    await renderWithRows()
    fireEvent.click(screen.getByTestId('history-clear-btn'))

    // The count is main's (5 — the list is capped), scoped to the project.
    await screen.findByText('Delete project history')
    expect(screen.getByText("this project's 5 history entries")).toBeTruthy()
    expect(count).toHaveBeenCalledWith({ project_id: 'p1' })
    expect(clear).not.toHaveBeenCalled()
    expect(screen.queryByText(/every project/i)).toBeNull()
  })

  it('Cancel keeps every row', async () => {
    await renderWithRows()
    fireEvent.click(screen.getByTestId('history-clear-btn'))
    fireEvent.click(await screen.findByTestId('delete-cancel-btn'))
    expect(clear).not.toHaveBeenCalled()
    expect(screen.getAllByTestId('history-entry')).toHaveLength(2)
  })

  it('Confirm clears the ACTIVE PROJECT only — another project keeps its rows', async () => {
    listed.push({ ...rows()[0], id: 'h-other', project_id: 'p2', url: 'https://other.test/x' })
    await renderWithRows()
    fireEvent.click(screen.getByTestId('history-clear-btn'))
    fireEvent.click(await screen.findByTestId('delete-confirm-btn'))
    await waitFor(() => expect(clear).toHaveBeenCalledWith({ project_id: 'p1' }))
    await waitFor(() => expect(screen.queryAllByTestId('history-entry')).toHaveLength(0))
    expect(listed.map((r) => r.id)).toEqual(['h-other'])
  })

  it('says one entry in the singular', async () => {
    workspaceCount = 1
    listed = rows().slice(0, 1)
    render(<HistoryListPanel />)
    await waitFor(() => expect(screen.getAllByTestId('history-entry')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('history-clear-btn'))
    expect(await screen.findByText("this project's 1 history entry")).toBeTruthy()
  })

  it('reads Turkish', async () => {
    useLocale('tr')
    await renderWithRows()
    fireEvent.click(screen.getByTestId('history-clear-btn'))
    expect(await screen.findByText('Proje geçmişi silinsin mi?')).toBeTruthy()
    expect(screen.getByText('Bu projenin 5 geçmiş kaydı')).toBeTruthy()
  })

  it('is disabled while the list is empty', async () => {
    listed = []
    render(<HistoryListPanel />)
    const btn = await screen.findByTestId('history-clear-btn')
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(btn)
    expect(count).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    expect(screen.queryByTestId('delete-confirm-btn')).toBeNull()
  })
})

describe('History rows: full URL tooltip + labelled delete (finding 5)', () => {
  it('titles every non-MCP row with its full stored (masked) URL', async () => {
    await renderWithRows()
    const [http, ws] = screen.getAllByTestId('history-entry-label')
    expect(http.getAttribute('title')).toBe(MASKED_URL)
    expect(http.getAttribute('title')).toContain(HISTORY_MASK)
    expect(ws.getAttribute('title')).toBe('wss://echo.example.com/socket/live')
  })

  it('the trash button is reachable by keyboard: in the DOM, shown on focus', async () => {
    await renderWithRows()
    const [del] = screen.getAllByTestId('history-entry-delete')
    expect(del.tagName).toBe('BUTTON')
    // Hidden by opacity, not display:none — Tab can land on it.
    expect(del.className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(del.className).toMatch(/opacity-0/)
    expect(del.className).toMatch(/focus-visible:opacity-100/)
    del.focus()
    expect(document.activeElement).toBe(del)
  })

  it('gives the trash button a name (EN + TR)', async () => {
    await renderWithRows()
    const [del] = screen.getAllByTestId('history-entry-delete')
    expect(del.getAttribute('aria-label')).toBe('Delete')
    expect(del.getAttribute('title')).toBe('Delete')
    cleanup()
    useLocale('tr')
    await renderWithRows()
    expect(screen.getAllByTestId('history-entry-delete')[0].getAttribute('aria-label')).toBe('Sil')
  })
})
