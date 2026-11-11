/**
 * Tester finding 12 — Iterations = 3 runs the same request three times; the
 * results list shows three rows, but clicking the third showed the FIRST run in
 * the detail pane, and all three rows lit up as selected.
 *
 * Selection was keyed by `endpointId`, which every iteration of a request
 * shares. A row's identity is its phase + iteration + request + occurrence
 * (`lib/run-result-key.ts`), and selection, the detail pane and the filtered
 * list all use that one key.
 */
import * as React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { EndpointRunResult } from '../../src/shared/runner-types'

// The real editor does not render in jsdom; this one prints what it was given,
// so the test can read which run the detail pane is showing.
vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value: string }) => <pre data-testid="detail-body">{value}</pre>,
}))

const RunnerResults = (await import('../../src/renderer/components/runner/RunnerResults')).default

function run(over: Partial<EndpointRunResult>): EndpointRunResult {
  return {
    endpointId: 'ep-1',
    endpointName: 'Get counter',
    method: 'GET',
    url: 'http://127.0.0.1/echo',
    status: 200,
    statusText: 'OK',
    duration: 5,
    passed: 0,
    failed: 0,
    skipped: 0,
    assertions: [],
    phase: 'main',
    ...over,
  }
}

function Harness({ results }: { results: EndpointRunResult[] }) {
  const [selected, setSelected] = React.useState<string | null>(null)
  return (
    <RunnerResults
      results={results}
      report={null}
      isRunning={false}
      currentIndex={results.length}
      totalCount={results.length}
      runStartedAt={null}
      sourceLabel="Runner"
      onStop={() => {}}
      onStopDirect={() => {}}
      onNewRun={() => {}}
      onRunAgain={() => {}}
      onViewAllRuns={() => {}}
      selectedResultKey={selected}
      onSelectResult={setSelected}
    />
  )
}

const rows = () => screen.getAllByTestId('runner-result-row')
const selectedRows = () => rows().filter((r) => r.getAttribute('data-selected') === 'true')
const detailBody = () => screen.getByTestId('detail-body').textContent ?? ''

afterEach(cleanup)

describe('Runner results — one selected row per run (finding 12)', () => {
  const THREE_ITERATIONS = [1, 2, 3].map((n) => run({ iteration: n, responseBody: `{"hit":${n}}` }))

  it('clicking the third iteration shows the third run and selects only that row', () => {
    render(<Harness results={THREE_ITERATIONS} />)
    expect(rows()).toHaveLength(3)

    fireEvent.click(rows()[2])
    expect(selectedRows()).toHaveLength(1)
    expect(selectedRows()[0]).toBe(rows()[2])
    expect(detailBody()).toContain('"hit": 3')
    expect(screen.getByTestId('runner-result-detail-iteration').textContent).toBe('Iteration 3')

    fireEvent.click(rows()[0])
    expect(selectedRows()).toHaveLength(1)
    expect(selectedRows()[0]).toBe(rows()[0])
    expect(detailBody()).toContain('"hit": 1')
  })

  it('the same request twice in ONE iteration (setNextRequest loop) is two rows', () => {
    const looped = [
      run({ iteration: 1, responseBody: '{"hit":1}' }),
      run({ iteration: 1, endpointId: 'ep-2', endpointName: 'Other', responseBody: '{"o":1}' }),
      run({ iteration: 1, responseBody: '{"hit":2}' }),
    ]
    render(<Harness results={looped} />)

    fireEvent.click(rows()[2])
    expect(selectedRows()).toHaveLength(1)
    expect(selectedRows()[0]).toBe(rows()[2])
    expect(detailBody()).toContain('"hit": 2')
  })

  it('setup and teardown rows of the same request stay apart from the main rows', () => {
    const phased = [
      run({ phase: 'setup', iteration: 1, responseBody: '{"at":"setup"}' }),
      run({ iteration: 1, responseBody: '{"at":"main"}' }),
      run({ phase: 'teardown', iteration: 1, responseBody: '{"at":"teardown"}' }),
    ]
    render(<Harness results={phased} />)

    fireEvent.click(rows()[2])
    expect(selectedRows()).toHaveLength(1)
    expect(detailBody()).toContain('"at": "teardown"')
  })

  it('a row from an old history entry (no phase, no iteration) can still be opened', () => {
    const legacy = [1, 2].map((n) => {
      const r = run({ responseBody: `{"hit":${n}}` })
      delete r.phase
      return r
    })
    render(<Harness results={legacy} />)

    fireEvent.click(rows()[1])
    expect(selectedRows()).toHaveLength(1)
    expect(detailBody()).toContain('"hit": 2')
  })
})

describe('keyRunResults — the one row key', () => {
  it('keys stay put when the live list is swapped for the report (NOT_RUN rows appended)', async () => {
    const { keyRunResults } = await import('../../src/renderer/lib/run-result-key')
    const live = [
      run({ phase: 'setup', endpointId: 'login' }),
      run({ iteration: 1 }),
      run({ iteration: 2 }),
      run({ phase: 'teardown', endpointId: 'cleanup' }),
    ]
    // The report adds a NOT_RUN row for the step a stop never reached.
    const report = [
      ...live.slice(0, 3),
      run({ iteration: 2, endpointId: 'ep-2', statusText: 'NOT_RUN', status: null }),
      live[3],
    ]
    const liveKeys = keyRunResults(live).map((r) => r.key)
    const byRow = new Map(keyRunResults(report).map((r) => [r.result, r.key]))
    expect(live.map((r) => byRow.get(r))).toEqual(liveKeys)
    expect(new Set(keyRunResults(report).map((r) => r.key)).size).toBe(report.length)
  })

  it('the filtered list keeps the keys of the whole run', async () => {
    const { keyRunResults } = await import('../../src/renderer/lib/run-result-key')
    const { filterKeyedRunResults } = await import('../../src/renderer/lib/runner-result-filter')
    const all = keyRunResults([
      run({ iteration: 1, status: 500 }),
      run({ iteration: 2 }),
      run({ iteration: 3 }),
    ])
    const passed = filterKeyedRunResults(all, { tab: 'passed', text: '', methods: [] })
    expect(passed.map((r) => r.key)).toEqual([all[1].key, all[2].key])
  })
})
