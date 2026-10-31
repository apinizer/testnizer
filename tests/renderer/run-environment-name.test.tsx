/**
 * Issue #307 — the run's environment NAME is shown on every run surface.
 *
 * Before: the live results header printed the fixed word "Active" for every
 * run (`runResults.envActive`), All Runs rows printed whatever
 * `environment_name` held (an environment id) and scheduled history rows had no
 * environment at all.
 *
 * Encoding (resolved in main, see tests/main/handlers/runner-environment-name):
 *   a non-empty string = the environment's name, '' = the run used no
 *   environment, null / absent = unknown (legacy row, deleted environment,
 *   report from an older build) → '-'.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import type { EndpointRunResult, RunnerReport } from '../../src/shared/runner-types'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mockWindowApi } from './screens/_mount'
import RunnerResults from '../../src/renderer/components/runner/RunnerResults'
import RunnerHistory from '../../src/renderer/components/runner/RunnerHistory'
import ScheduledTasksView from '../../src/renderer/components/runner/ScheduledTasksView'
import TestsHome from '../../src/renderer/components/runner/TestsHome'
import { useRunnerStore } from '../../src/renderer/stores/runner.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { setLocale, t } from '../../src/renderer/lib/i18n'

function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

const noop = (): void => {}

const RESULTS: EndpointRunResult[] = [
  {
    endpointId: 'e1',
    endpointName: 'e1',
    method: 'GET',
    url: 'https://example.test/e1',
    status: 200,
    statusText: 'OK',
    duration: 12,
    passed: 0,
    failed: 0,
    skipped: 0,
    assertions: [],
  },
]

function reportWith(environmentName: string | undefined): RunnerReport {
  const rep: RunnerReport = {
    projectId: 'proj-1',
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_001_000,
    totalEndpoints: 1,
    passedEndpoints: 1,
    failedEndpoints: 0,
    totalAssertions: 0,
    passedAssertions: 0,
    failedAssertions: 0,
    results: RESULTS,
  }
  return environmentName === undefined ? rep : { ...rep, environmentName }
}

function renderResults(rep: RunnerReport | null) {
  return render(
    <RunnerResults
      results={RESULTS}
      report={rep}
      isRunning={false}
      currentIndex={0}
      totalCount={RESULTS.length}
      runStartedAt={rep?.startedAt ?? null}
      sourceLabel="Runner"
      onStop={noop}
      onNewRun={noop}
      onRunAgain={noop}
      onViewAllRuns={noop}
      selectedResultId={null}
      onSelectResult={noop}
    />,
  )
}

/** The value a StatCell renders under `label` (label + value are siblings). */
function stat(label: string): string {
  const cell = screen.getByText(label).parentElement
  if (!cell) throw new Error(`no StatCell for ${label}`)
  return cell.textContent?.replace(label, '').trim() ?? ''
}

function historyRow(id: string, environment_name: string | null): Record<string, unknown> {
  return {
    id,
    project_id: 'proj-1',
    environment_name,
    source: 'Runner',
    source_label: 'Runner',
    iterations: 1,
    duration_ms: 1500,
    total_endpoints: 1,
    passed_endpoints: 1,
    failed_endpoints: 0,
    total_tests: 0,
    passed_tests: 0,
    failed_tests: 0,
    skipped_tests: 0,
    avg_resp_time: 5,
    results_json: JSON.stringify(RESULTS),
    started_at: Date.now(),
  }
}

const TASK = {
  id: 't-1',
  project_id: 'proj-1',
  name: 'Nightly',
  endpoint_ids: '["e1"]',
  folder_id: null,
  environment_id: null,
  interval_value: 5,
  interval_unit: 'minutes',
  delay_ms: 0,
  enabled: 1,
  last_run_at: null,
  next_run_at: Date.now() + 60_000,
  created_at: 0,
  schedule_type: 'interval',
  schedule_time: null,
  schedule_days: null,
  schedule_cron: null,
  suite_id: null,
}

let exportCalls: unknown[] = []

function apiWith(runs: Record<string, unknown>[], tasks: Record<string, unknown>[] = [TASK]): void {
  exportCalls = []
  mockWindowApi({
    runner: {
      history: vi.fn(async () => ({ success: true, data: { rows: runs, total: runs.length } })),
      deleteHistory: vi.fn(async () => ({ success: true })),
      export: vi.fn(async (opts: unknown) => {
        exportCalls.push(opts)
        return { success: true, data: '<html></html>' }
      }),
    },
    importExport: { saveFile: vi.fn(async () => ({ success: true, data: null })) },
    testSuite: { list: vi.fn(async () => ({ success: true, data: [] })) },
    scheduler: {
      list: vi.fn(async () => ({ success: true, data: tasks })),
      history: vi.fn(async () => ({ success: true, data: runs })),
      taskEndpoints: vi.fn(async () => ({ success: true, data: { items: [], source: 'suite' } })),
      toggle: vi.fn(async () => ({ success: true })),
      delete: vi.fn(async () => ({ success: true })),
      runNow: vi.fn(async () => ({ success: true })),
      onRunCompleted: () => () => {},
    },
  })
}

beforeEach(() => {
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  HTMLElement.prototype.scrollIntoView = () => {}
  useRunnerStore.setState({ results: [], report: null, isRunning: false })
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  useLocale('en')
  apiWith([])
})
afterEach(() => {
  cleanup()
  useLocale('en')
})

describe('RunnerResults header shows the run environment (issue #307)', () => {
  it('shows the environment name, not the fixed word "Active"', () => {
    renderResults(reportWith('Staging'))
    expect(stat('Environment')).toBe('Staging')
  })

  it('shows "No environment" when the run used none', () => {
    renderResults(reportWith(''))
    expect(stat('Environment')).toBe('No environment')
  })

  it('shows "-" for a report that does not know (older build / no report)', () => {
    renderResults(reportWith(undefined))
    expect(stat('Environment')).toBe('-')
  })

  it('Turkish: "Ortam yok"', () => {
    useLocale('tr')
    renderResults(reportWith(''))
    expect(stat('Ortam')).toBe('Ortam yok')
  })

  it('the header Export passes the environment to the one report generator', async () => {
    renderResults(reportWith('Staging'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('runner-export-html'))
    })
    expect(exportCalls[0]).toMatchObject({ format: 'html', environmentName: 'Staging' })
  })
})

describe('All Runs rows show the run environment (issue #307)', () => {
  it('name / "No environment" / "-" per row, and the row Export carries it', async () => {
    apiWith([historyRow('r-named', 'QA'), historyRow('r-none', ''), historyRow('r-unknown', null)])
    render(<RunnerHistory onBack={noop} onViewReport={noop} />)
    const rows = await screen.findAllByTestId('runner-history-row')
    const env = (id: string): string => {
      const row = rows.find((r) => r.getAttribute('data-run-id') === id)!
      return within(row).getByTestId('run-environment').textContent ?? ''
    }
    expect(env('r-named')).toBe('QA')
    expect(env('r-none')).toBe('No environment')
    expect(env('r-unknown')).toBe('-')

    const named = rows.find((r) => r.getAttribute('data-run-id') === 'r-named')!
    await act(async () => {
      fireEvent.click(within(named).getByTestId('runner-export-json'))
    })
    expect(exportCalls[0]).toMatchObject({ format: 'json', environmentName: 'QA' })
  })

  it('opening a stored run shows its environment in the results header', async () => {
    const onViewReport = vi.fn()
    apiWith([historyRow('r-named', 'QA')])
    render(<RunnerHistory onBack={noop} onViewReport={onViewReport} />)
    const [row] = await screen.findAllByTestId('runner-history-row')
    act(() => {
      fireEvent.click(row)
    })
    const report = onViewReport.mock.calls[0][1] as RunnerReport
    expect(report.environmentName).toBe('QA')
  })
})

describe('Scheduled task history rows show the run environment (issue #307)', () => {
  it('name and "No environment" in the expanded run history', async () => {
    apiWith([historyRow('s-named', 'Nightly Env'), historyRow('s-none', '')])
    render(<ScheduledTasksView onBack={noop} />)
    const [task] = await screen.findAllByTestId('scheduled-task-row')
    act(() => {
      fireEvent.click(within(task).getByLabelText('Show run history'))
    })
    const rows = await screen.findAllByTestId('scheduled-history-row')
    const env = (id: string): string => {
      const row = rows.find((r) => r.getAttribute('data-run-id') === id)!
      return within(row).getByTestId('run-environment').textContent ?? ''
    }
    expect(env('s-named')).toBe('Nightly Env')
    expect(env('s-none')).toBe('No environment')
  })
})

describe('Tests overview recent runs open with their environment (issue #307)', () => {
  it('the report handed to the results view carries the resolved name', async () => {
    const onViewReport = vi.fn()
    mockWindowApi({
      runner: {
        // The legacy runner:history(projectId) form — main resolves it too.
        history: vi.fn(async () => ({
          success: true,
          data: [{ ...historyRow('h-1', 'Home Env'), source_label: 'Overview Run' }],
        })),
        historyStats: vi.fn(async () => ({
          success: true,
          data: { runs: 1, totalEndpoints: 1, passedEndpoints: 1, failedEndpoints: 0 },
        })),
      },
      scheduler: { list: vi.fn(async () => ({ success: true, data: [] })) },
      testSuite: { list: vi.fn(async () => ({ success: true, data: [] })) },
    })
    render(
      <TestsHome
        onViewAllRuns={noop}
        onViewScheduled={noop}
        onNewRun={noop}
        onViewReport={onViewReport}
      />,
    )
    const label = await screen.findByText(/Overview Run/)
    act(() => {
      fireEvent.click(label)
    })
    const report = onViewReport.mock.calls[0][1] as RunnerReport
    expect(report.environmentName).toBe('Home Env')
  })
})

describe('Scheduled task row shows the environment NAME, never its id (issue #307 follow-up)', () => {
  const tasks = [
    { ...TASK, id: 't-named', name: 'Named', environment_id: 'env-1', environment_name: 'Prod' },
    { ...TASK, id: 't-gone', name: 'Gone', environment_id: 'env-2', environment_name: null },
    { ...TASK, id: 't-none', name: 'None', environment_id: null, environment_name: '' },
  ]

  async function taskEnv(): Promise<Record<string, string>> {
    const rows = await screen.findAllByTestId('scheduled-task-row')
    return Object.fromEntries(
      rows.map((r) => [
        r.getAttribute('data-task-name') ?? '',
        within(r).getByTestId('scheduled-task-environment').textContent ?? '',
      ]),
    )
  }

  it('English: name / "Deleted environment" / "No environment"', async () => {
    apiWith([], tasks)
    render(<ScheduledTasksView onBack={noop} />)
    const env = await taskEnv()
    expect(env['Named']).toBe('Prod')
    expect(env['Gone']).toBe('Deleted environment')
    expect(env['None']).toBe('No environment')
    expect(document.body.textContent).not.toContain('env-1')
    expect(document.body.textContent).not.toContain('env-2')
  })

  it('Turkish: "Silinmiş ortam" / "Ortam yok"', async () => {
    useLocale('tr')
    apiWith([], tasks)
    render(<ScheduledTasksView onBack={noop} />)
    const env = await taskEnv()
    expect(env['Named']).toBe('Prod')
    expect(env['Gone']).toBe('Silinmiş ortam')
    expect(env['None']).toBe('Ortam yok')
  })
})

describe('"No environment" is sentence case everywhere (issue #307 follow-up)', () => {
  it('the footer environment picker uses the same casing as the run surfaces', () => {
    useLocale('en')
    expect(t('footer.noEnvironment')).toBe('No environment')
    useLocale('tr')
    expect(t('footer.noEnvironment')).toBe('Ortam yok')
  })
})
