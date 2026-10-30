/**
 * Issue #258 / issue #261 — every screen that prints a time uses the shared
 * formatter (`lib/format-datetime.ts`, see format-datetime-258.test.ts), so a
 * Turkish UI never shows a 12-hour clock and never glues a Turkish date to a
 * system-locale time.
 *
 * Call sites pinned here (all four were found by grepping the renderer):
 *   - RunnerHistory.tsx   "22 Eki 2026 12:28:26 AM" (the reported string):
 *                         `${formatDate(ts,'tr')} ${formatTime(ts,'tr',{seconds:true})}`
 *   - ScheduledTasksView  "Eki 22, 12:28 AM" ->  "22 Eki, 00:28"  (", " joins)
 *                         and the "today" branch: time only, 24-hour
 *   - TestsHome           date was hard-coded 'en-US' even in Turkish
 *   - AiChatMetricsRow    `toLocaleTimeString()` with no locale: "2:18:35 PM"
 *                         TR -> "14:18:35"; EN unchanged ("2:18:35 PM")
 *
 * "System locale" is pinned to en-US by the shim, so these fail on every
 * machine. The static guard is limited to these four files on purpose;
 * the other bare `toLocaleString()` sites are listed in the report.
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))

import { mockWindowApi } from './screens/_mount'
import RunnerHistory from '../../src/renderer/components/runner/RunnerHistory'
import ScheduledTasksView from '../../src/renderer/components/runner/ScheduledTasksView'
import TestsHome from '../../src/renderer/components/runner/TestsHome'
import AiChatMetricsRow from '../../src/renderer/components/protocols/ai-chat/AiChatMetricsRow'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import {
  AFTERNOON,
  MIDNIGHT,
  TWELVE_HOUR,
  installEnUsDefault,
  uninstallEnUsDefault,
  useLocale,
} from './helpers/default-locale-shim'

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

const todayAt = (h: number, m: number): number => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

function runRow(startedAt: number): Record<string, unknown> {
  return {
    id: 'run-1',
    project_id: 'proj-1',
    environment_name: 'Prod',
    source: 'collection',
    source_label: 'Col',
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
    started_at: startedAt,
  }
}

function taskRow(id: string, lastRunAt: number | null, nextRunAt: number | null) {
  return {
    id,
    project_id: 'proj-1',
    name: `Task ${id}`,
    endpoint_ids: '["e1"]',
    folder_id: null,
    environment_id: null,
    interval_value: 5,
    interval_unit: 'minutes',
    delay_ms: 0,
    enabled: 1,
    last_run_at: lastRunAt,
    next_run_at: nextRunAt,
    created_at: 0,
    schedule_type: 'interval',
    schedule_time: null,
    schedule_days: null,
    schedule_cron: null,
    suite_id: 's-1',
  }
}

function api(
  runs: unknown[],
  tasks: unknown[],
  suites: unknown[] = [],
  shape: 'paged' | 'list' = 'paged',
): void {
  mockWindowApi({
    runner: {
      history: vi.fn(async () => ({
        success: true,
        // All Runs pages ({rows,total}); the Tests home takes the plain list.
        data: shape === 'paged' ? { rows: runs, total: runs.length } : runs,
      })),
      historyStats: vi.fn(async () => ({
        success: true,
        data: { runs: runs.length, totalEndpoints: 0, passedEndpoints: 0, failedEndpoints: 0 },
      })),
      deleteHistory: vi.fn(async () => ({ success: true })),
    },
    testSuite: { list: vi.fn(async () => ({ success: true, data: suites })) },
    scheduler: {
      list: vi.fn(async () => ({ success: true, data: tasks })),
      history: vi.fn(async () => ({ success: true, data: [] })),
      taskEndpoints: vi.fn(async () => ({ success: true, data: { items: [], source: 'suite' } })),
      toggle: vi.fn(async () => ({ success: true })),
      delete: vi.fn(async () => ({ success: true })),
      runNow: vi.fn(async () => ({ success: true })),
      onRunCompleted: () => () => {},
    },
  })
}

beforeEach(() => {
  stubDom()
  installEnUsDefault()
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
})
afterEach(() => {
  cleanup()
  uninstallEnUsDefault()
  useLocale('en')
})

const text = (): string => document.body.textContent ?? ''

describe('All Runs (RunnerHistory) — the reported string', () => {
  it('TR: "22 Eki 2020 00:28:26" — Turkish date, 24-hour time, no AM/PM', async () => {
    useLocale('tr')
    api([runRow(MIDNIGHT)], [])
    render(<RunnerHistory onBack={() => {}} onViewReport={() => {}} />)
    await screen.findByLabelText('Tümünü seç')
    expect(text()).toContain('22 Eki 2020 00:28:26')
    expect(text()).not.toMatch(TWELVE_HOUR)
    expect(text()).not.toContain('24:28')
  })

  it('EN guard: unchanged "Oct 22, 2020 12:28:26 AM"', async () => {
    useLocale('en')
    api([runRow(MIDNIGHT)], [])
    render(<RunnerHistory onBack={() => {}} onViewReport={() => {}} />)
    await screen.findByLabelText('Select all')
    expect(text()).toContain('Oct 22, 2020 12:28:26 AM')
  })
})

describe('Scheduled Tasks', () => {
  it('TR: past dates read "22 Eki, 14:18" / "22 Eki, 00:28"; today is a bare 24-hour time', async () => {
    useLocale('tr')
    api([], [taskRow('a', AFTERNOON, MIDNIGHT), taskRow('b', todayAt(13, 5), null)])
    render(<ScheduledTasksView onBack={() => {}} />)
    await screen.findAllByTestId('scheduled-task-row')
    expect(text()).toContain('22 Eki, 14:18')
    expect(text()).toContain('22 Eki, 00:28')
    expect(text()).toContain('13:05')
    expect(text()).not.toMatch(TWELVE_HOUR)
  })

  it('EN guard: "Oct 22, 12:28 AM" and "01:05 PM" stay', async () => {
    useLocale('en')
    api([], [taskRow('a', AFTERNOON, MIDNIGHT), taskRow('b', todayAt(13, 5), null)])
    render(<ScheduledTasksView onBack={() => {}} />)
    await screen.findAllByTestId('scheduled-task-row')
    expect(text()).toContain('Oct 22, 12:28 AM')
    expect(text()).toContain('Oct 22, 02:18 PM')
    expect(text()).toContain('01:05 PM')
  })
})

describe('Tests home', () => {
  const mount = async (): Promise<void> => {
    await act(async () => {
      render(<TestsHome onViewAllRuns={() => {}} onViewScheduled={() => {}} onNewRun={() => {}} />)
    })
  }

  it('TR: Turkish month and 24-hour time (the date was hard-coded en-US)', async () => {
    useLocale('tr')
    api(
      [runRow(AFTERNOON)],
      [taskRow('a', null, MIDNIGHT)],
      [{ id: 's-1', project_id: 'proj-1', name: 'Suite', created_at: MIDNIGHT }],
      'list',
    )
    await mount()
    expect(text()).toContain('22 Eki, 14:18')
    expect(text()).toContain('22 Eki, 00:28')
    expect(text()).not.toContain('Oct')
    expect(text()).not.toMatch(TWELVE_HOUR)
  })

  it('EN guard: "Oct 22, 02:18 PM" stays', async () => {
    useLocale('en')
    api([runRow(AFTERNOON)], [], [], 'list')
    await mount()
    expect(text()).toContain('Oct 22, 02:18 PM')
  })
})

describe('AI Chat metrics row', () => {
  it('TR: "14:18:35", with and without metrics', () => {
    useLocale('tr')
    const { unmount } = render(<AiChatMetricsRow timestamp={AFTERNOON} />)
    expect(screen.getByTestId('ai-metrics').textContent).toContain('14:18:35')
    expect(screen.getByTestId('ai-metrics').textContent).not.toMatch(TWELVE_HOUR)
    unmount()
    render(
      <AiChatMetricsRow
        timestamp={MIDNIGHT}
        metrics={
          {
            status: 200,
            ttfbMs: 5,
            durationMs: 9,
            usageReported: false,
            calls: [],
          } as never
        }
      />,
    )
    expect(screen.getByTestId('ai-metrics').textContent).toContain('00:28:26')
    expect(screen.getByTestId('ai-metrics').textContent).not.toMatch(TWELVE_HOUR)
  })

  it('EN guard: still the system time exactly as before ("2:18:35 PM")', () => {
    useLocale('en')
    render(<AiChatMetricsRow timestamp={AFTERNOON} />)
    expect(screen.getByTestId('ai-metrics').textContent).toBe('2:18:35 PM')
  })
})

describe('static guard: the four call sites use the shared formatter', () => {
  const files = [
    'src/renderer/components/runner/RunnerHistory.tsx',
    'src/renderer/components/runner/ScheduledTasksView.tsx',
    'src/renderer/components/runner/TestsHome.tsx',
    'src/renderer/components/protocols/ai-chat/AiChatMetricsRow.tsx',
  ]
  for (const f of files) {
    it(`${f.split('/').pop()}: no direct toLocale*String, imports format-datetime`, () => {
      const src = readFileSync(resolve(__dirname, '../..', f), 'utf8')
      expect(src).not.toMatch(/toLocale(Time|Date)?String\(/)
      expect(src).toMatch(/lib\/format-datetime/)
    })
  }
})
