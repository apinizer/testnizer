/**
 * Issue #114 — the search box and the method chips actually narrow the list.
 *
 * `runner-result-filter.test.ts` pins the predicate; this pins the wiring. A
 * pure filter that nothing is connected to would pass that test and ship a
 * search box that does nothing — the same shape of defect as issue #113's
 * Paste item.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import type { EndpointRunResult } from '../../src/shared/runner-types'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({ default: () => null }))

const RunnerResults = (await import('../../src/renderer/components/runner/RunnerResults')).default

function res(over: Partial<EndpointRunResult>): EndpointRunResult {
  return {
    endpointId: over.endpointName ?? 'id',
    endpointName: 'Request',
    method: 'GET',
    url: 'https://api.test/thing',
    status: 200,
    statusText: 'OK',
    duration: 5,
    passed: 1,
    failed: 0,
    skipped: 0,
    assertions: [],
    ...over,
  } as EndpointRunResult
}

const RESULTS: EndpointRunResult[] = [
  res({ endpointName: 'List users', method: 'GET', url: 'https://api.test/users' }),
  res({ endpointName: 'Create user', method: 'POST', url: 'https://api.test/users' }),
  res({ endpointName: 'Delete order', method: 'DELETE', url: 'https://api.test/orders/9' }),
]

function renderResults(over: Partial<React.ComponentProps<typeof RunnerResults>> = {}) {
  return render(
    <RunnerResults
      results={RESULTS}
      report={null}
      isRunning={false}
      currentIndex={3}
      totalCount={3}
      runStartedAt={null}
      sourceLabel="Runner"
      onStop={() => {}}
      onStopDirect={() => {}}
      onNewRun={() => {}}
      onRunAgain={() => {}}
      onViewAllRuns={() => {}}
      selectedResultId={null}
      onSelectResult={() => {}}
      {...over}
    />,
  )
}

const listNames = () => {
  const list = screen.getByTestId('runner-results-list')
  return RESULTS.map((r) => r.endpointName).filter(
    (n) => within(list).queryAllByText(n, { exact: false }).length > 0,
  )
}

beforeEach(() => cleanup())
afterEach(cleanup)

describe('the search box', () => {
  it('narrows the list to matching request names', () => {
    renderResults()
    fireEvent.change(screen.getByTestId('runner-results-search'), { target: { value: 'create' } })
    expect(listNames()).toEqual(['Create user'])
  })

  it('matches on the URL too', () => {
    renderResults()
    fireEvent.change(screen.getByTestId('runner-results-search'), { target: { value: '/orders/' } })
    expect(listNames()).toEqual(['Delete order'])
  })

  it('says so when nothing matches, instead of rendering a blank list', () => {
    renderResults()
    fireEvent.change(screen.getByTestId('runner-results-search'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('runner-results-empty')).toBeTruthy()
  })

  it('restores the full list when cleared', () => {
    renderResults()
    const box = screen.getByTestId('runner-results-search')
    fireEvent.change(box, { target: { value: 'create' } })
    fireEvent.change(box, { target: { value: '' } })
    expect(listNames()).toHaveLength(3)
  })
})

describe('the method chips', () => {
  it('offers only the verbs this run contains', () => {
    renderResults()
    fireEvent.click(screen.getByTestId('runner-results-method-filter'))
    expect(screen.getByTestId('runner-results-method-DELETE')).toBeTruthy()
    // PATCH is not in the run, so a chip for it could only ever empty the list.
    expect(screen.queryByTestId('runner-results-method-PATCH')).toBeNull()
  })

  it('narrows the list to the chosen verb', () => {
    renderResults()
    fireEvent.click(screen.getByTestId('runner-results-method-filter'))
    fireEvent.click(screen.getByTestId('runner-results-method-DELETE'))
    expect(listNames()).toEqual(['Delete order'])
  })

  it('is multi-select', () => {
    renderResults()
    fireEvent.click(screen.getByTestId('runner-results-method-filter'))
    fireEvent.click(screen.getByTestId('runner-results-method-DELETE'))
    fireEvent.click(screen.getByTestId('runner-results-method-POST'))
    expect(listNames()).toEqual(['Create user', 'Delete order'])
  })
})

describe('Reveal in APIs (issue #115)', () => {
  it('is offered on every row when the caller supports it', () => {
    renderResults({ onRevealInApis: () => {} })
    expect(screen.getAllByTestId(/^runner-reveal-/)).toHaveLength(3)
  })

  it('is absent when the caller does not support it — a suite run', () => {
    renderResults()
    expect(screen.queryAllByTestId(/^runner-reveal-/)).toHaveLength(0)
  })

  it('reveals without also opening the details pane', () => {
    // Row click is details; revealing is a separate control (issue #115 is
    // explicit that row click must keep working), so its click must not bubble.
    const revealed: string[] = []
    const selected: (string | null)[] = []
    renderResults({
      onRevealInApis: (id) => revealed.push(id),
      onSelectResult: (id) => selected.push(id),
    })
    fireEvent.click(screen.getByTestId('runner-reveal-Delete order'))
    expect(revealed).toEqual(['Delete order'])
    expect(selected).toEqual([])
  })
})
