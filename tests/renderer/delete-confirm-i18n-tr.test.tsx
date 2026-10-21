/**
 * issue #248 follow-up — the shared delete confirmation in the Turkish UI.
 *
 * DeleteConfirmDialog used to be hardcoded English ("Delete {itemType}", "Are
 * you sure…", Cancel / Delete), and several callers passed a raw English type
 * ("history entry", "run history", "branch", "scheduled task", "endpoint") —
 * so even a translated dialog read "Run history silinsin mi?" in TR.
 *
 * The fix splits the type in two: `itemType` stays raw because logic keys off
 * it (TreeView's `'folder'` picks the folder warning and the type-to-confirm
 * step), and `typeLabel` is the translated name the heading shows. These tests
 * drive two real callers in TR and pin that the folder logic still runs when
 * the visible label is Turkish.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))

import { mockWindowApi } from './screens/_mount'
import DeleteConfirmDialog from '../../src/renderer/components/modals/DeleteConfirmDialog'
import HistoryListPanel from '../../src/renderer/components/sidebar/HistoryListPanel'
import RunnerHistory from '../../src/renderer/components/runner/RunnerHistory'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useHistoryStore } from '../../src/renderer/stores/history.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { HistoryEntry } from '../../src/renderer/types'

function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

function stubDom(): void {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.scrollIntoView = () => {}
}

const RUN_ROW = {
  id: 'run-1',
  project_id: 'proj-1',
  environment_name: null,
  source: 'collection',
  source_label: 'Koleksiyon',
  iterations: 1,
  duration_ms: 10,
  total_endpoints: 1,
  passed_endpoints: 1,
  failed_endpoints: 0,
  total_tests: 1,
  passed_tests: 1,
  failed_tests: 0,
  skipped_tests: 0,
  avg_resp_time: 5,
  results_json: null,
  started_at: Date.now(),
}

const HISTORY_ENTRY: HistoryEntry = {
  id: 'h-1',
  project_id: 'proj-1',
  protocol: 'http',
  method: 'GET',
  url: 'https://ornek.test/kullanicilar',
  status_code: 200,
  duration_ms: 12,
  request_snapshot: {},
  executed_at: Date.now(),
}

beforeEach(() => {
  stubDom()
  mockWindowApi({
    runner: {
      history: vi.fn(async () => ({ success: true, data: { rows: [RUN_ROW], total: 1 } })),
      deleteHistory: vi.fn(async () => ({ success: true })),
    },
  })
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  useLocale('tr')
})

afterEach(() => {
  cleanup()
  useLocale('en')
})

describe('issue #248 — delete confirmation headings in Turkish', () => {
  it('History panel: "Geçmiş kaydı silinsin mi?" with a Turkish body', () => {
    useHistoryStore.setState({
      entries: [HISTORY_ENTRY],
      searchTerm: '',
      fetch: vi.fn(async () => undefined),
    } as never)
    render(<HistoryListPanel />)

    const row = screen.getByTestId('history-entry')
    const buttons = within(row).getAllByRole('button')
    // The trash button is the row's last control.
    act(() => {
      fireEvent.click(buttons[buttons.length - 1])
    })

    expect(screen.getByText('Geçmiş kaydı silinsin mi?')).toBeTruthy()
    expect(document.body.textContent).toContain('Bu geçmiş kaydı silinecek. Emin misiniz?')
    expect(document.body.textContent).not.toMatch(/history entry|Are you sure|Delete history/i)
    expect(screen.getByTestId('delete-cancel-btn').textContent).toBe('İptal')
    expect(screen.getByTestId('delete-confirm-btn').textContent).toBe('Sil')
  })

  it('Runner history: "Çalıştırma kaydı silinsin mi?" and a Turkish run count', async () => {
    render(<RunnerHistory onBack={() => {}} />)

    const selectAll = await screen.findByLabelText('Tümünü seç')
    act(() => {
      fireEvent.click(selectAll)
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Sil' }))
    })

    expect(screen.getByText('Çalıştırma kaydı silinsin mi?')).toBeTruthy()
    expect(document.body.textContent).toContain('1 çalıştırma kaydı silinecek. Emin misiniz?')
    expect(document.body.textContent).not.toMatch(/run history|Are you sure/i)
  })

  it('keeps logic on the raw itemType: folder warning + type-to-confirm under a Turkish label', () => {
    render(
      <DeleteConfirmDialog
        open
        itemName="Modeller"
        itemType="folder"
        typeLabel="klasör"
        requireTyping
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )

    expect(screen.getByText('Klasör silinsin mi?')).toBeTruthy()
    expect(screen.getByText('Klasör ve tüm içeriği kalıcı olarak silinecek.')).toBeTruthy()
    // The keyword stays literal "delete" — it is what the check compares against.
    expect(screen.getByTestId('delete-confirm-input')).toBeTruthy()
    expect(document.body.textContent).toContain('Onaylamak için delete yazın:')
    expect((screen.getByTestId('delete-confirm-btn') as HTMLButtonElement).disabled).toBe(true)
  })

  it('English stays byte-identical', () => {
    useLocale('en')
    render(
      <DeleteConfirmDialog
        open
        itemName="Production"
        itemType="environment"
        typeLabel="environment"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Delete environment')).toBeTruthy()
    expect(screen.getByText('This action cannot be undone.')).toBeTruthy()
    expect(document.body.textContent).toContain('Are you sure you want to delete Production?')
    expect(screen.getByTestId('delete-cancel-btn').textContent).toBe('Cancel')
    expect(screen.getByTestId('delete-confirm-btn').textContent).toBe('Delete')
  })
})
