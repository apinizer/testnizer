/**
 * RunnerTab wiring of the Run-results folder icon (issue #115 follow-up).
 *
 * RunnerTab used to pass no reveal handler at all when the run came from a
 * test suite (`runOrigin === 'suite' ? undefined : …`), so suite runs had no
 * icon. A RunnerResults-only test cannot see that line; this one mounts the
 * real RunnerTab on a restored suite run and checks the icon is there, labelled
 * for the Tests sidebar, and an APIs run keeps "Reveal in APIs".
 *
 * Historical runs (issue #302): All Runs → open a past run replaced the results
 * but kept the TAB's scope as the reveal target, so a past suite run opened in
 * a fresh Runner tab looked its suite-item ids up in the APIs tree ("request no
 * longer exists"), and a past APIs run opened in a suite tab did the reverse.
 * The reveal target now follows the results on screen.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// Permissive bridge: every `window.api.<ns>.<method>()` resolves `{success,data:null}`
// (stores read some namespaces at module-eval time — see screens/runner-frame-screens).
// `overrides['ns.method']` answers a specific call instead, its value returned
// as is (All Runs' history list, the scheduled tasks, an event subscription).
const overrides = vi.hoisted(() => {
  const map: Record<string, (...a: unknown[]) => unknown> = {}
  const nsFor = (name: string): unknown =>
    new Proxy(
      {},
      {
        get: (_t, p) =>
          p === 'then'
            ? undefined
            : (...a: unknown[]) => {
                const fn = map[`${name}.${String(p)}`]
                return fn ? fn(...a) : Promise.resolve({ success: true, data: null })
              },
      },
    )
  const api = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : nsFor(String(p))) })
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
  return map
})

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import RunnerTab from '../../src/renderer/components/runner/RunnerTab'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { runnerKey } from '../../src/renderer/lib/runner-storage'
import type { EndpointRunResult } from '../../src/shared/runner-types'

const TAB = 'runner-wiring'

const RESULT = {
  endpointId: 'item-1',
  endpointName: 'Refund payment',
  method: 'POST',
  url: 'http://x/refund',
  status: 200,
  statusText: 'OK',
  duration: 5,
  passed: 1,
  failed: 0,
  skipped: 0,
  assertions: [],
} as unknown as EndpointRunResult

/** Restore a finished run on the results view, as a tab switch back would. */
function seedRun(scope: { sourceType: string; suiteId?: string }): void {
  sessionStorage.setItem(runnerKey('view', TAB)!, 'results')
  sessionStorage.setItem(
    runnerKey('run-data', TAB)!,
    JSON.stringify({ results: [RESULT], report: null, startedAt: 1 }),
  )
  sessionStorage.setItem(runnerKey('report', TAB)!, JSON.stringify(scope))
  // The payload's one-shot intent is already spent (no sessionKey → token '').
  sessionStorage.setItem(runnerKey('report-spent', TAB)!, '')
}

beforeEach(() => {
  for (const k of Object.keys(overrides)) delete overrides[k]
  sessionStorage.clear()
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
  useUIStore.getState().setLocale('en')
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

describe('RunnerTab — Run-results folder icon', () => {
  it('a suite run offers it, labelled "Reveal in Tests"', async () => {
    seedRun({ sourceType: 'suite', suiteId: 'suite-1' })
    render(<RunnerTab tabId={TAB} />)
    const icon = await screen.findByTestId('runner-reveal-item-1')
    expect(icon.getAttribute('title')).toBe('Reveal in Tests')
  })

  it('an APIs run keeps "Reveal in APIs"', async () => {
    seedRun({ sourceType: 'apis' })
    render(<RunnerTab tabId={TAB} />)
    const icon = await screen.findByTestId('runner-reveal-item-1')
    expect(icon.getAttribute('title')).toBe('Reveal in APIs')
  })
})

/** One `runner_history` row, as `runner:history` returns it. */
function historyRow(
  sourceLabel: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `run-${sourceLabel}`,
    project_id: 'p-1',
    environment_name: null,
    source: 'Runner',
    source_label: sourceLabel,
    iterations: 1,
    duration_ms: 5,
    total_endpoints: 1,
    passed_endpoints: 1,
    failed_endpoints: 0,
    total_tests: 0,
    passed_tests: 0,
    failed_tests: 0,
    skipped_tests: 0,
    avg_resp_time: 5,
    results_json: JSON.stringify([RESULT]),
    started_at: 1,
    ...extra,
  }
}

/** All Runs lists exactly `row`. */
function serveHistory(row: Record<string, unknown>): void {
  overrides['runner.history'] = () =>
    Promise.resolve({ success: true, data: { rows: [row], total: 1 } })
}

/** Open the only row of All Runs; resolves to the reveal icon of its result. */
async function openHistoricalRun(sourceLabel: string): Promise<HTMLElement> {
  const label = await screen.findByText(sourceLabel)
  fireEvent.click(label.closest('tr')!)
  return screen.findByTestId('runner-reveal-item-1')
}

describe('RunnerTab — reveal on a historical run (issue #302)', () => {
  it('a past suite run opened from All Runs in a fresh Runner tab reveals in Tests', async () => {
    sessionStorage.setItem(runnerKey('view', TAB)!, 'history')
    serveHistory(historyRow('Suite: Payments'))
    render(<RunnerTab tabId={TAB} />)
    const icon = await openHistoricalRun('Suite: Payments')
    expect(icon.getAttribute('title')).toBe('Reveal in Tests')
    fireEvent.click(icon)
    expect(useUIStore.getState().activeSidebarPage).toBe('tests')
  })

  it('a past APIs run opened in a suite-scoped tab reveals in APIs', async () => {
    seedRun({ sourceType: 'suite', suiteId: 'suite-1' })
    sessionStorage.setItem(runnerKey('view', TAB)!, 'history')
    serveHistory(historyRow('APIs: Billing'))
    render(<RunnerTab tabId={TAB} />)
    const icon = await openHistoricalRun('APIs: Billing')
    expect(icon.getAttribute('title')).toBe('Reveal in APIs')
  })

  it('a past suite run opened from the Tests overview (report payload) reveals in Tests', async () => {
    // PageWelcome → TestsHome → openOrReuseRunnerTab({results, report, startedAt, sourceLabel}).
    // Parked on results so the overview (whose event subscription this bridge
    // cannot fake) is never mounted; the payload flips the view there anyway.
    sessionStorage.setItem(runnerKey('view', TAB)!, 'results')
    sessionStorage.setItem(
      runnerKey('report', TAB)!,
      JSON.stringify({ results: [RESULT], report: null, startedAt: 1, sourceLabel: 'Suite: P' }),
    )
    render(<RunnerTab tabId={TAB} />)
    const icon = await screen.findByTestId('runner-reveal-item-1')
    expect(icon.getAttribute('title')).toBe('Reveal in Tests')
  })

  it('the historical run keeps its reveal target across a tab switch (remount)', async () => {
    sessionStorage.setItem(runnerKey('view', TAB)!, 'history')
    serveHistory(historyRow('Suite: Payments'))
    const first = render(<RunnerTab tabId={TAB} />)
    await openHistoricalRun('Suite: Payments')
    first.unmount()
    render(<RunnerTab tabId={TAB} />)
    const icon = await screen.findByTestId('runner-reveal-item-1')
    expect(icon.getAttribute('title')).toBe('Reveal in Tests')
  })

  describe('scheduled runs — origin from the task, not the label', () => {
    const SCHEDULED = { source: 'Scheduler', scheduled_task_id: 'task-1' }
    /** `scheduler:list` with one task; `suiteId` null = an APIs-tree task. */
    function serveTasks(suiteId: string | null): void {
      overrides['scheduler.list'] = () =>
        Promise.resolve({
          success: true,
          data: [
            { id: 'task-1', name: 'Nightly', enabled: 1, next_run_at: null, suite_id: suiteId },
          ],
        })
    }

    it('All Runs: a scheduled run of a suite reveals in Tests', async () => {
      sessionStorage.setItem(runnerKey('view', TAB)!, 'history')
      serveTasks('suite-1')
      serveHistory(historyRow('Scheduled: Nightly', SCHEDULED))
      render(<RunnerTab tabId={TAB} />)
      const icon = await openHistoricalRun('Scheduled: Nightly')
      expect(icon.getAttribute('title')).toBe('Reveal in Tests')
    })

    it('All Runs: a scheduled run of APIs endpoints keeps "Reveal in APIs"', async () => {
      sessionStorage.setItem(runnerKey('view', TAB)!, 'history')
      serveTasks(null)
      serveHistory(historyRow('Scheduled: Nightly', SCHEDULED))
      render(<RunnerTab tabId={TAB} />)
      const icon = await openHistoricalRun('Scheduled: Nightly')
      expect(icon.getAttribute('title')).toBe('Reveal in APIs')
    })

    it('Tests overview: a scheduled run of a suite reveals in Tests', async () => {
      sessionStorage.setItem(runnerKey('view', TAB)!, 'home')
      serveTasks('suite-1')
      // The overview asks `runner.history(projectId)` — the plain row list.
      overrides['runner.history'] = () =>
        Promise.resolve({ success: true, data: [historyRow('Scheduled: Nightly', SCHEDULED)] })
      overrides['scheduler.onRunCompleted'] = () => () => {}
      render(<RunnerTab tabId={TAB} />)
      const line = await screen.findByText(/Scheduled: Nightly/)
      fireEvent.click(line)
      const icon = await screen.findByTestId('runner-reveal-item-1')
      expect(icon.getAttribute('title')).toBe('Reveal in Tests')
    })
  })
})
