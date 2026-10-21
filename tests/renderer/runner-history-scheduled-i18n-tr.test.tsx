/**
 * issue #248 follow-up — All Runs (RunnerHistory) and Scheduled Tasks in Turkish.
 *
 * Both views were written before i18n and stayed fully English in the Turkish
 * UI: toolbar, tabs, empty states, column headers, pagination, row tooltips,
 * schedule descriptions ("Daily at 09:00", "Every 5 minutes") and the expanded
 * task panel. This renders each in TR with data, scans visible text plus
 * title / aria-label for English, and pins the key Turkish labels. A last case
 * keeps the English UI byte-identical for the e2e specs that match on it.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))

import { mockWindowApi } from './screens/_mount'
import RunnerHistory from '../../src/renderer/components/runner/RunnerHistory'
import ScheduledTasksView from '../../src/renderer/components/runner/ScheduledTasksView'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { setLocale } from '../../src/renderer/lib/i18n'

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

const DAY = 24 * 60 * 60 * 1000

function runRow(i: number): Record<string, unknown> {
  return {
    id: `run-${i}`,
    project_id: 'proj-1',
    environment_name: 'Üretim',
    source: 'collection',
    source_label: 'Koleksiyon',
    iterations: 1,
    duration_ms: 1500,
    total_endpoints: 2,
    passed_endpoints: 2,
    failed_endpoints: 0,
    total_tests: 2,
    passed_tests: 2,
    failed_tests: 0,
    skipped_tests: 0,
    avg_resp_time: 5,
    results_json: '[]',
    started_at: Date.now() - 3 * DAY,
  }
}

const TASKS = [
  {
    id: 't-1',
    project_id: 'proj-1',
    name: 'Gece Kontrolü',
    endpoint_ids: '["e1","e2"]',
    folder_id: null,
    environment_id: null,
    interval_value: 5,
    interval_unit: 'minutes',
    delay_ms: 0,
    enabled: 1,
    last_run_at: Date.now() - 3 * DAY,
    next_run_at: Date.now() + 3 * DAY,
    created_at: 0,
    schedule_type: 'interval',
    schedule_time: null,
    schedule_days: null,
    schedule_cron: null,
    suite_id: 's-1',
  },
  {
    id: 't-2',
    project_id: 'proj-1',
    name: 'Haftalık Rapor',
    endpoint_ids: '[]',
    folder_id: null,
    environment_id: null,
    interval_value: 1,
    interval_unit: 'days',
    delay_ms: 0,
    enabled: 0,
    last_run_at: null,
    next_run_at: null,
    created_at: 0,
    schedule_type: 'weekly',
    schedule_time: '09:00',
    schedule_days: '[1,3]',
    schedule_cron: null,
    suite_id: 's-1',
  },
]

/** English that must not survive in TR (whole words, case-sensitive). */
const ENGLISH: RegExp[] = [
  /\bBack\b/,
  /\bAll Runs\b/,
  /\bFunctional\b/,
  /\bScheduled\b/,
  /\bRuns triggered\b/,
  /\bitem selected\b/,
  /\bCancel\b/,
  /\bDelete\b/,
  /\bLoading\b/,
  /\bNo (scheduled )?runs yet\b/,
  /\bSelect (all|run)\b/,
  /\bStart time\b/,
  /\bSource\b/,
  /\bEnvironment\b/,
  /\bIterations\b/,
  /\bDuration\b/,
  /\bAll tests\b/,
  /\bPassed\b/,
  /\bFailed\b/,
  /\bSkipped\b/,
  /\bAvg\b/,
  /\bShowing\b/,
  /\bPrev\b/,
  /\bNext\b/,
  /\bPage\b/,
  /\bView Report\b/,
  /\bTasks?\b/,
  /\bPeriodic\b/,
  /\bUpcoming\b/,
  /\bSchedule\b/,
  /\bEndpoints in\b/,
  /\bActions\b/,
  /\b(Show|Hide) run history\b/,
  /\bRun history\b/,
  /\bPaused\b/,
  /\bLast run\b/,
  /\bNo Environment\b/,
  /\bRun now\b/,
  /\bPause\b/,
  /\bResume\b/,
  /\bDaily\b/,
  /\bWeekly\b/,
  /\bEvery\b/,
  /\bminutes\b/,
  /\b(Mon|Wed)\b/,
  /\bToday\b/,
  /\bfrom Test Suite\b/,
  /\bNo endpoints\b/,
  /\bWhen\b/,
  /\bResult\b/,
]

function englishLeftovers(): string[] {
  const parts: string[] = [document.body.textContent ?? '']
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(attr)
      if (v) parts.push(v)
    }
  }
  const text = parts.join('\n')
  return ENGLISH.filter((re) => re.test(text)).map((re) => {
    const line = text.split('\n').find((l) => re.test(l)) ?? ''
    return `${re} → "${line.trim().slice(0, 100)}"`
  })
}

function apiWith(runs: Record<string, unknown>[], total: number): void {
  mockWindowApi({
    runner: {
      history: vi.fn(async () => ({ success: true, data: { rows: runs, total } })),
      deleteHistory: vi.fn(async () => ({ success: true })),
    },
    testSuite: { list: vi.fn(async () => ({ success: true, data: [] })) },
    scheduler: {
      list: vi.fn(async () => ({ success: true, data: TASKS })),
      history: vi.fn(async () => ({ success: true, data: [] })),
      taskEndpoints: vi.fn(async () => ({
        success: true,
        data: { items: [], source: 'suite' },
      })),
      toggle: vi.fn(async () => ({ success: true })),
      delete: vi.fn(async () => ({ success: true })),
      runNow: vi.fn(async () => ({ success: true })),
      onRunCompleted: () => () => {},
    },
  })
}

beforeEach(() => {
  stubDom()
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  useLocale('tr')
})

afterEach(() => {
  cleanup()
  useLocale('en')
})

describe('issue #248 — All Runs in Turkish', () => {
  it('toolbar, tabs, headers, selection bar and pagination are Turkish', async () => {
    // A full page of 20 out of 25 → pagination shows.
    apiWith(
      Array.from({ length: 20 }, (_, i) => runRow(i)),
      25,
    )
    render(<RunnerHistory onBack={() => {}} onViewReport={() => {}} />)

    const selectAll = await screen.findByLabelText('Tümünü seç')
    act(() => {
      fireEvent.click(selectAll)
    })
    // The row's report button only shows on hover / selection.
    expect(screen.getAllByLabelText('Raporu Görüntüle').length).toBeGreaterThan(0)

    expect(englishLeftovers()).toEqual([])

    expect(screen.getByText('Tüm Çalıştırmalar')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fonksiyonel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Planlanmış' })).toBeTruthy()
    expect(screen.getByText('Başlangıç zamanı')).toBeTruthy()
    expect(screen.getByText('Ort. Yanıt Süresi')).toBeTruthy()
    expect(screen.getByText('20 öğe seçildi')).toBeTruthy()
    expect(screen.getByText('25 kayıttan 1-20 gösteriliyor')).toBeTruthy()
    expect(screen.getByText('Sayfa 1 / 2')).toBeTruthy()
  })

  it('empty state is Turkish', async () => {
    apiWith([], 0)
    render(<RunnerHistory onBack={() => {}} />)
    expect(await screen.findByText('Henüz çalıştırma yok')).toBeTruthy()
    expect(englishLeftovers()).toEqual([])
  })
})

describe('issue #248 — Scheduled Tasks in Turkish', () => {
  it('header, columns, row controls, schedules and the expanded panel are Turkish', async () => {
    apiWith([], 0)
    render(<ScheduledTasksView onBack={() => {}} />)

    const rows = await screen.findAllByTestId('scheduled-task-row')
    expect(rows).toHaveLength(2)
    act(() => {
      fireEvent.click(within(rows[0]).getByLabelText('Çalıştırma geçmişini göster'))
    })
    await screen.findByText('Çalıştırma geçmişi')
    await screen.findByText('Henüz çalıştırma yok — bu görev oluşturulduğundan beri tetiklenmedi.')
    await screen.findByText('Bu görevle ilişkili uç nokta yok.')

    expect(englishLeftovers()).toEqual([])

    expect(screen.getByText('Planlanmış Görevler')).toBeTruthy()
    expect(screen.getByText('Sıradaki çalıştırma')).toBeTruthy()
    expect(screen.getByText('İşlemler')).toBeTruthy()
    expect(screen.getByText('Her 5 dakikada bir')).toBeTruthy()
    expect(screen.getByText('Pzt, Çar 09:00')).toBeTruthy()
    expect(screen.getByText('Duraklatıldı')).toBeTruthy()
    expect(screen.getAllByText('Ortam Yok')).toHaveLength(2)
    expect(within(rows[0]).getByLabelText('Şimdi çalıştır')).toBeTruthy()
    expect(within(rows[0]).getByLabelText('Duraklat')).toBeTruthy()
    expect(within(rows[1]).getByLabelText('Sürdür')).toBeTruthy()
    expect(await screen.findByText('(test paketinden)')).toBeTruthy()
    // Uppercase section labels need Turkish casing.
    expect(screen.getByText('Planlanmış Görevler').closest('[lang]')?.getAttribute('lang')).toBe(
      'tr',
    )
  })
})

describe('issue #248 — English stays byte-identical', () => {
  it('All Runs and Scheduled Tasks keep their English text', async () => {
    useLocale('en')
    apiWith([runRow(1)], 1)
    const { unmount } = render(<RunnerHistory onBack={() => {}} />)
    await screen.findByLabelText('Select all')
    for (const s of [
      'Back',
      'All Runs',
      'Functional',
      'Scheduled',
      'Start time',
      'Avg. Resp. Time',
    ]) {
      expect(screen.getByText(s)).toBeTruthy()
    }
    unmount()

    render(<ScheduledTasksView onBack={() => {}} />)
    await screen.findAllByTestId('scheduled-task-row')
    for (const s of [
      'Scheduled Tasks',
      'Upcoming run',
      'Every 5 minutes',
      'Mon, Wed at 09:00',
      'Paused',
    ]) {
      expect(screen.getByText(s)).toBeTruthy()
    }
  })
})
