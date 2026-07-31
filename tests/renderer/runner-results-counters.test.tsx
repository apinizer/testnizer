/**
 * The Runner's headline numbers, asserted through the DOM.
 *
 * `tests/main/shared/skipped-step-verdict.test.ts` already pins `summarizeRun`
 * as a function. This file pins the part the tester actually looked at: the
 * counters and badges that the two results views RENDER. That gap is not
 * theoretical — every bug in this file's scope was a renderer bug sitting on
 * top of correct main-process data:
 *
 *   RL-4  a failing teardown row incremented the top-level "Errors" stat, in a
 *         feature whose own UI promises "Does not affect the run verdict".
 *   RL-5  a run-level script row rendered a green "200" badge; `statusText`
 *         already said 'SCRIPT', the UI just never read it.
 *   RL-6  the "Console log" filter counter was hardcoded to 0.
 *   RL-8  skipped rows were counted as PASSED, because `(null ?? 0) < 400`.
 *
 * Both views are covered, because they are separate implementations of the same
 * screen and the divergence between them is exactly what shipped.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import type { EndpointRunResult, RunnerReport } from '../../src/shared/runner-types'

// Both views pull in MonacoWrapper to show response bodies; Monaco cannot run
// in jsdom (mirrors the existing renderer tests).
vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import RunnerResults from '../../src/renderer/components/runner/RunnerResults'
import RunnerResultsView from '../../src/renderer/components/modals/RunnerResultsView'
import { useRunnerStore } from '../../src/renderer/stores/runner.store'

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const noop = () => {}

function result(over: Partial<EndpointRunResult> & { endpointId: string }): EndpointRunResult {
  return {
    endpointName: over.endpointId,
    method: 'GET',
    url: 'https://example.test/' + over.endpointId,
    status: 200,
    statusText: 'OK',
    duration: 12,
    passed: 0,
    failed: 0,
    skipped: 0,
    assertions: [],
    ...over,
  }
}

/** A green main flow plus a teardown row that threw — the QA §5 scenario. */
const GREEN_RUN_WITH_FAILED_TEARDOWN: EndpointRunResult[] = [
  result({ endpointId: 'main-1', assertions: [{ name: 'status is 200', passed: true }], passed: 1 }),
  result({
    endpointId: 'cleanup',
    phase: 'teardown',
    status: 500,
    statusText: 'Internal Server Error',
    error: 'cleanup blew up',
  }),
]

const report: RunnerReport = {
  projectId: 'p1',
  startedAt: 1_700_000_000_000,
  completedAt: 1_700_000_001_000,
  totalEndpoints: 1,
  passedEndpoints: 1,
  failedEndpoints: 0,
  totalAssertions: 1,
  passedAssertions: 1,
  failedAssertions: 0,
  results: GREEN_RUN_WITH_FAILED_TEARDOWN,
  teardownFailedEndpoints: 1,
}

function renderTab(results: EndpointRunResult[], rep: RunnerReport | null = report) {
  return render(
    <RunnerResults
      results={results}
      report={rep ? { ...rep, results } : null}
      isRunning={false}
      currentIndex={0}
      totalCount={results.length}
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

/** The legacy view reads everything off the store instead of props. */
function renderLegacy(results: EndpointRunResult[], rep: RunnerReport | null = report) {
  useRunnerStore.setState({
    results,
    report: rep ? { ...rep, results } : null,
    isRunning: false,
    currentIndex: 0,
    totalCount: results.length,
    runStartedAt: rep?.startedAt ?? null,
  })
  return render(<RunnerResultsView onNewRun={noop} onClose={noop} />)
}

/**
 * Reads the number a `StatCell` renders under the given label. The label and
 * the value are sibling divs, so the cell is the label's PARENT — `closest`
 * would return the label's own div and always read back an empty string.
 */
function stat(label: string): string {
  const cell = screen.getByText(label).parentElement
  if (!cell) throw new Error(`no StatCell for ${label}`)
  return cell.textContent?.replace(label, '').trim() ?? ''
}

/** Reads the count a filter tab renders next to its label. */
function filterCount(key: string): number {
  const text = screen.getByTestId(`runner-filter-${key}`).textContent ?? ''
  const n = text.trim().split(/\s+/).pop()
  return Number(n)
}

beforeEach(() => {
  useRunnerStore.setState({ results: [], report: null, isRunning: false })
})
afterEach(cleanup)

/* ── RL-4: a failed teardown is reported, never folded into the verdict ─────── */

describe('teardown failures stay out of the run verdict (RL-4)', () => {
  it('leaves the top-level Errors stat at 0 and reports the teardown separately', () => {
    renderTab(GREEN_RUN_WITH_FAILED_TEARDOWN)

    // The bug: this read "1", because the counter filtered nothing.
    expect(stat('Errors')).toBe('0')
    // …and the row is still reported, with the promise the UI makes about it.
    // Matched as one string: the phase-section header carries the same note, so
    // the note alone is deliberately not unique.
    expect(screen.getByText(/Teardown: 1 · Does not affect the run verdict/)).toBeTruthy()
  })

  it('counts only verdict-bearing rows in "All tests"', () => {
    renderTab(GREEN_RUN_WITH_FAILED_TEARDOWN)
    // Two rows exist; one is teardown, so the run is one test.
    expect(stat('All tests')).toBe('1')
    expect(filterCount('passed')).toBe(1)
    expect(filterCount('failed')).toBe(0)
  })

  it('agrees with the legacy view', () => {
    renderLegacy(GREEN_RUN_WITH_FAILED_TEARDOWN)
    expect(stat('Errors')).toBe('0')
    expect(stat('All tests')).toBe('1')
    // The two views render the count in different places (header stat line vs
    // phase-section title); what must not diverge is the number itself.
    expect(screen.getByText(/Teardown: 1/)).toBeTruthy()
  })
})

/* ── RL-5: synthetic rows are not HTTP exchanges ───────────────────────────── */

describe('synthetic rows render a neutral chip, not an HTTP status (RL-5)', () => {
  const hookRow = result({
    endpointId: 'pre-run',
    endpointName: 'Run pre-request script',
    status: null,
    statusText: 'SCRIPT',
  })

  it('shows SCRIPT for a run-level hook instead of a green 200', () => {
    renderTab([hookRow])
    const list = screen.getByTestId('runner-results-list')
    expect(within(list).getByText('SCRIPT')).toBeTruthy()
    expect(within(list).queryByText('200')).toBeNull()
  })

  it('shows Error for a hook that threw', () => {
    renderTab([{ ...hookRow, error: 'ReferenceError: foo is not defined' }])
    const list = screen.getByTestId('runner-results-list')
    expect(within(list).getByText('Error')).toBeTruthy()
    expect(within(list).queryByText('SCRIPT')).toBeNull()
  })

  it('shows NOT RUN for a step the run never reached', () => {
    renderTab([result({ endpointId: 'never', status: null, statusText: 'NOT_RUN', skipped: 1 })])
    expect(within(screen.getByTestId('runner-results-list')).getByText('NOT RUN')).toBeTruthy()
  })
})

/* ── RL-8: a skipped row is neutral, in BOTH directions ────────────────────── */

describe('skipped rows are scored in neither direction (RL-8)', () => {
  const rows = [
    result({ endpointId: 'ran', assertions: [{ name: 'ok', passed: true }], passed: 1 }),
    result({ endpointId: 'skipped-1', status: null, statusText: 'NOT_RUN', skipped: 1 }),
    result({ endpointId: 'skipped-2', status: null, statusText: 'NOT_RUN', skipped: 1 }),
  ]

  it('keeps them out of Passed and Failed, and preserves the invariant', () => {
    renderTab(rows)
    // The bug: `(null ?? 0) < 400` made both skipped rows read as PASSED,
    // so an aborted run reported "Passed 3".
    expect(filterCount('passed')).toBe(1)
    expect(filterCount('failed')).toBe(0)
    expect(filterCount('skipped')).toBe(2)
    // passed + failed + skipped === total
    expect(filterCount('passed') + filterCount('failed') + filterCount('skipped')).toBe(
      Number(stat('All tests')),
    )
  })

  it('agrees with the legacy view', () => {
    renderLegacy(rows)
    expect(filterCount('passed')).toBe(1)
    expect(filterCount('skipped')).toBe(2)
  })
})

/* ── RL-6: the Console counter is real ─────────────────────────────────────── */

describe('script console output is counted and filterable (RL-6)', () => {
  const rows = [
    result({
      endpointId: 'chatty',
      consoleLogs: [
        { level: 'log', message: 'token acquired', timestamp: 1 },
        { level: 'warn', message: 'retrying', timestamp: 2 },
      ],
    }),
    result({
      endpointId: 'louder',
      consoleLogs: [{ level: 'error', message: 'boom', timestamp: 3 }],
    }),
    result({ endpointId: 'quiet' }),
  ]

  it('sums console lines across every row instead of hardcoding 0', () => {
    renderTab(rows)
    expect(filterCount('console')).toBe(3)
  })

  it('reports 0 when no script logged anything', () => {
    renderTab([result({ endpointId: 'quiet' })])
    expect(filterCount('console')).toBe(0)
  })

  it('agrees with the legacy view', () => {
    renderLegacy(rows)
    expect(filterCount('console')).toBe(3)
  })
})
