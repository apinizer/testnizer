/**
 * Issue #266 — Export HTML / Export JSON on Runner results and on stored runs.
 *
 * ── CONTRACT (the implementer must satisfy this file) ──────────────────────
 *
 *  Helper `src/renderer/lib/run-report-export.ts`:
 *
 *      export type RunReportFormat = 'html' | 'json'
 *      export function runReportFileName(format: RunReportFormat, at?: Date): string
 *          // 'testnizer-run-report-YYYYMMDD-HHmmss.<format>'  (ends in .html / .json)
 *      export async function exportRunReport(
 *        results: EndpointRunResult[], format: RunReportFormat,
 *      ): Promise<boolean>   // true only when a file was written
 *
 *  Behaviour (the renderer builds NO report text — main is the one generator):
 *   1. `window.api.runner.export({ results, format })` → `{ success, data: string }`
 *   2. `window.api.importExport.saveFile(data, runReportFileName(format))`
 *      — receives EXACTLY the string step 1 returned.
 *   3. saved path → `toast.success(msg)` where msg contains the path
 *      (i18n `runner.exportSaved`, EN "Report saved to {path}").
 *      `{ success:true, data:null }` (dialog dismissed) → NO toast, returns false.
 *      Any `success:false` / throw → `toast.error(msg)` containing the error text
 *      (i18n `runner.exportFailed`), returns false. `saveFile` is not called when
 *      step 1 failed.
 *
 *  Buttons — `data-testid="runner-export-html"` / `"runner-export-json"`, label
 *  = existing i18n `runner.exportHtml` / `runner.exportJson`:
 *   - RunnerResults header (suite AND collection runs share this component):
 *     present when the run is finished and has results; ABSENT while running;
 *     export the `results` prop.
 *   - RunnerHistory (All Runs, Functional + Scheduled tabs): inside each row
 *     (`data-testid="runner-history-row"`, `data-run-id=<id>`); ALWAYS rendered
 *     (not hover-gated) when the row has `results_json`; export
 *     `JSON.parse(results_json)`; the click must NOT trigger the row's own
 *     "open report" action (`onViewReport`).
 *   - ScheduledTasksView expanded task history: inside each history row
 *     (`data-testid="scheduled-history-row"`, `data-run-id`), same rules.
 *   A stored row without `results_json` offers no export.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within, waitFor } from '@testing-library/react'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({ toast: toastMock }))
vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mockWindowApi } from './screens/_mount'
import {
  exportRunReport,
  runReportFileName,
} from '../../src/renderer/lib/run-report-export'
import RunnerResults from '../../src/renderer/components/runner/RunnerResults'
import RunnerHistory from '../../src/renderer/components/runner/RunnerHistory'
import ScheduledTasksView from '../../src/renderer/components/runner/ScheduledTasksView'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { setLocale, t } from '../../src/renderer/lib/i18n'
import type { EndpointRunResult, RunnerReport } from '../../src/shared/runner-types'
;(globalThis as unknown as { React: typeof React }).React = React

function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

const noop = (): void => {}

function result(over: Partial<EndpointRunResult> & { endpointId: string }): EndpointRunResult {
  return {
    endpointName: over.endpointId,
    method: 'GET',
    url: 'https://x.test/' + over.endpointId,
    status: 200,
    statusText: 'OK',
    duration: 5,
    passed: 0,
    failed: 0,
    skipped: 0,
    assertions: [],
    ...over,
  }
}

const RESULTS: EndpointRunResult[] = [
  result({ endpointId: 'a', iteration: 1, assertions: [{ name: 'ok', passed: true }], passed: 1 }),
  result({
    endpointId: 'b',
    iteration: 1,
    status: 500,
    statusText: 'Server Error',
    assertions: [{ name: 'ok', passed: false }],
    failed: 1,
  }),
]

const REPORT: RunnerReport = {
  projectId: 'p1',
  startedAt: 1,
  completedAt: 2,
  totalEndpoints: 2,
  passedEndpoints: 1,
  failedEndpoints: 1,
  totalAssertions: 2,
  passedAssertions: 1,
  failedAssertions: 1,
  results: RESULTS,
}

let exportFn: ReturnType<typeof vi.fn>
let saveFile: ReturnType<typeof vi.fn>

const BUILT = '<!DOCTYPE html><title>built by main</title>'

function installApi(
  opts: { historyRows?: Record<string, unknown>[]; scheduler?: Record<string, unknown> } = {},
): void {
  exportFn = vi.fn(async (opts: { format: string }) => ({
    success: true,
    data: opts.format === 'html' ? BUILT : '[{"built":"by main"}]',
  }))
  saveFile = vi.fn(async () => ({ success: true, data: '/tmp/out/report.file' }))
  mockWindowApi({
    runner: {
      export: exportFn,
      history: vi.fn(async () => ({
        success: true,
        data: { rows: opts.historyRows ?? [], total: (opts.historyRows ?? []).length },
      })),
      deleteHistory: vi.fn(async () => ({ success: true })),
    },
    importExport: { saveFile },
    testSuite: { list: vi.fn(async () => ({ success: true, data: [] })) },
    scheduler: opts.scheduler ?? {
      list: vi.fn(async () => ({ success: true, data: [] })),
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
  useLocale('en')
  for (const fn of Object.values(toastMock)) fn.mockReset()
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.scrollIntoView = () => {}
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'proj-1' })
  installApi()
})

afterEach(() => {
  cleanup()
})

describe('exportRunReport — one flow for every surface (issue #266)', () => {
  it('asks main for the report, then saves EXACTLY that string, with a typed file name', async () => {
    const ok = await exportRunReport(RESULTS, 'html')
    expect(ok).toBe(true)
    expect(exportFn).toHaveBeenCalledWith({ format: 'html', results: RESULTS })
    expect(saveFile).toHaveBeenCalledTimes(1)
    const [content, name] = saveFile.mock.calls[0] as [string, string]
    expect(content).toBe(BUILT)
    expect(name).toMatch(/\.html$/)
    expect(toastMock.success).toHaveBeenCalledTimes(1)
    expect(String(toastMock.success.mock.calls[0][0])).toContain('/tmp/out/report.file')
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('json: same flow, .json file name', async () => {
    await exportRunReport(RESULTS, 'json')
    expect(exportFn).toHaveBeenCalledWith({ format: 'json', results: RESULTS })
    const [content, name] = saveFile.mock.calls[0] as [string, string]
    expect(content).toBe('[{"built":"by main"}]')
    expect(name).toMatch(/\.json$/)
  })

  it('a dismissed save dialog is silent: no toast at all, nothing reported as failed', async () => {
    saveFile.mockResolvedValueOnce({ success: true, data: null })
    const ok = await exportRunReport(RESULTS, 'html')
    expect(ok).toBe(false)
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('a main-side failure toasts the error and never opens the save dialog', async () => {
    exportFn.mockResolvedValueOnce({ success: false, error: 'disk on fire' })
    const ok = await exportRunReport(RESULTS, 'html')
    expect(ok).toBe(false)
    expect(saveFile).not.toHaveBeenCalled()
    expect(toastMock.error).toHaveBeenCalledTimes(1)
    expect(String(toastMock.error.mock.calls[0][0])).toContain('disk on fire')
  })

  it('a save failure toasts the error', async () => {
    saveFile.mockResolvedValueOnce({ success: false, error: 'EACCES' })
    expect(await exportRunReport(RESULTS, 'json')).toBe(false)
    expect(String(toastMock.error.mock.calls[0][0])).toContain('EACCES')
  })

  it('file name carries a sortable timestamp', () => {
    const at = new Date(2026, 9, 30, 8, 5, 9)
    expect(runReportFileName('html', at)).toBe('testnizer-run-report-20261030-080509.html')
    expect(runReportFileName('json', at)).toBe('testnizer-run-report-20261030-080509.json')
  })
})

describe('RunnerResults — Export HTML / JSON (issue #266)', () => {
  function renderResults(over: Partial<React.ComponentProps<typeof RunnerResults>> = {}) {
    return render(
      <RunnerResults
        results={RESULTS}
        report={REPORT}
        isRunning={false}
        currentIndex={2}
        totalCount={2}
        runStartedAt={1}
        sourceLabel="Suite: Nightly"
        onStop={noop}
        onNewRun={noop}
        onRunAgain={noop}
        onViewAllRuns={noop}
        selectedResultId={null}
        onSelectResult={noop}
        {...over}
      />,
    )
  }

  it('both buttons are on the finished results header, labelled with the existing i18n keys', () => {
    renderResults()
    expect(screen.getByTestId('runner-export-html').textContent).toContain(t('runner.exportHtml'))
    expect(screen.getByTestId('runner-export-json').textContent).toContain(t('runner.exportJson'))
  })

  it('clicking Export HTML exports the run\'s results through main and saves the dialog', async () => {
    renderResults()
    await act(async () => {
      fireEvent.click(screen.getByTestId('runner-export-html'))
    })
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(exportFn).toHaveBeenCalledWith({ format: 'html', results: RESULTS })
    expect((saveFile.mock.calls[0] as [string, string])[0]).toBe(BUILT)
  })

  it('clicking Export JSON asks for the json format', async () => {
    renderResults()
    await act(async () => {
      fireEvent.click(screen.getByTestId('runner-export-json'))
    })
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(exportFn).toHaveBeenCalledWith({ format: 'json', results: RESULTS })
    expect((saveFile.mock.calls[0] as [string, string])[1]).toMatch(/\.json$/)
  })

  it('cancelling the save dialog shows no error toast', async () => {
    saveFile.mockResolvedValue({ success: true, data: null })
    renderResults()
    await act(async () => {
      fireEvent.click(screen.getByTestId('runner-export-html'))
    })
    await waitFor(() => expect(saveFile).toHaveBeenCalled())
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('no export while the run is still going', () => {
    renderResults({ isRunning: true })
    expect(screen.queryByTestId('runner-export-html')).toBeNull()
    expect(screen.queryByTestId('runner-export-json')).toBeNull()
  })

  it('no export for an empty run', () => {
    renderResults({ results: [], report: null })
    expect(screen.queryByTestId('runner-export-html')).toBeNull()
  })

  it('in Turkish the buttons keep their ids and use the Turkish labels', () => {
    useLocale('tr')
    renderResults()
    expect(screen.getByTestId('runner-export-html').textContent).toContain('HTML Dışarı Aktar')
    expect(screen.getByTestId('runner-export-json').textContent).toContain('JSON Dışarı Aktar')
  })
})

function storedRun(i: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `run-${i}`,
    project_id: 'proj-1',
    environment_name: null,
    source: 'Runner',
    source_label: null,
    iterations: 1,
    duration_ms: 100,
    total_endpoints: 2,
    passed_endpoints: 1,
    failed_endpoints: 1,
    total_tests: 2,
    passed_tests: 1,
    failed_tests: 1,
    skipped_tests: 0,
    avg_resp_time: 5,
    results_json: JSON.stringify(RESULTS),
    started_at: Date.now() - 24 * 60 * 60 * 1000,
    ...over,
  }
}

describe('All Runs — re-export a stored run without re-running (issue #266)', () => {
  function installHistory(rows: Record<string, unknown>[]): void {
    installApi({ historyRows: rows })
  }

  it('each row with stored results has Export HTML and JSON without hovering', async () => {
    installHistory([storedRun(1), storedRun(2)])
    render(<RunnerHistory onBack={noop} onViewReport={noop} />)
    const rows = await screen.findAllByTestId('runner-history-row')
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(within(r).getByTestId('runner-export-html')).toBeTruthy()
      expect(within(r).getByTestId('runner-export-json')).toBeTruthy()
    }
  })

  it('exports the stored results_json of THAT row, and does not open the report', async () => {
    const other = [result({ endpointId: 'only-in-run-2' })]
    installHistory([storedRun(1), storedRun(2, { results_json: JSON.stringify(other) })])
    const onViewReport = vi.fn()
    render(<RunnerHistory onBack={noop} onViewReport={onViewReport} />)
    const rows = await screen.findAllByTestId('runner-history-row')
    const second = rows.find((r) => r.getAttribute('data-run-id') === 'run-2')!

    await act(async () => {
      fireEvent.click(within(second).getByTestId('runner-export-json'))
    })
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(exportFn).toHaveBeenCalledWith({ format: 'json', results: other })
    expect(onViewReport).not.toHaveBeenCalled()
  })

  it('a row without stored results offers no export', async () => {
    installHistory([storedRun(1, { results_json: null })])
    render(<RunnerHistory onBack={noop} onViewReport={noop} />)
    const row = await screen.findByTestId('runner-history-row')
    expect(within(row).queryByTestId('runner-export-html')).toBeNull()
  })

  it('a corrupt results_json toasts an error instead of throwing or saving garbage', async () => {
    installHistory([storedRun(1, { results_json: '{not json' })])
    render(<RunnerHistory onBack={noop} onViewReport={noop} />)
    const row = await screen.findByTestId('runner-history-row')
    const btn = within(row).queryByTestId('runner-export-html')
    if (btn) {
      await act(async () => {
        fireEvent.click(btn)
      })
      expect(saveFile).not.toHaveBeenCalled()
      expect(toastMock.error).toHaveBeenCalled()
    }
  })
})

describe('Scheduled task history — re-export a stored run (issue #266)', () => {
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
    last_run_at: Date.now() - 1000,
    next_run_at: Date.now() + 100000,
    created_at: 0,
    schedule_type: 'interval',
    schedule_time: null,
    schedule_days: null,
    schedule_cron: null,
    suite_id: 's-1',
  }

  it('the expanded history lists runs with working export buttons', async () => {
    installApi({
      scheduler: {
        list: vi.fn(async () => ({ success: true, data: [TASK] })),
        history: vi.fn(async () => ({ success: true, data: [storedRun(7, { source: 'Scheduler' })] })),
        taskEndpoints: vi.fn(async () => ({ success: true, data: { items: [], source: 'suite' } })),
        toggle: vi.fn(async () => ({ success: true })),
        delete: vi.fn(async () => ({ success: true })),
        runNow: vi.fn(async () => ({ success: true })),
        onRunCompleted: () => () => {},
      },
    })
    render(<ScheduledTasksView onBack={noop} />)
    const taskRow = await screen.findByTestId('scheduled-task-row')
    act(() => {
      fireEvent.click(within(taskRow).getByLabelText(t('scheduledTasks.showHistory')))
    })
    const histRow = await screen.findByTestId('scheduled-history-row')
    expect(histRow.getAttribute('data-run-id')).toBe('run-7')

    await act(async () => {
      fireEvent.click(within(histRow).getByTestId('runner-export-html'))
    })
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(exportFn).toHaveBeenCalledWith({ format: 'html', results: RESULTS })
  })
})
