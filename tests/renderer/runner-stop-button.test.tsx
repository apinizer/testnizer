/**
 * The Stop button has to say which of two different things it will do.
 *
 * Stop during the flow ends the run and lets cleanup finish. "Skip teardown"
 * abandons cleanup — the escape hatch for a cleanup endpoint that never
 * answers. Main used to tell those apart by WHEN the click arrived, so an
 * impatient second click during the flow silently killed cleanup and the
 * behaviour looked random (reported 5 Aug).
 *
 * Intent now comes from which button the user pressed, which only works if the
 * button labels the two cases differently. That is what this pins.
 */
import * as React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { EndpointRunResult } from '../../src/shared/runner-types'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import RunnerResults from '../../src/renderer/components/runner/RunnerResults'

const noop = () => {}

function renderRunning(opts: { inTeardown?: boolean; onStop?: () => void }) {
  const results: EndpointRunResult[] = []
  return render(
    <RunnerResults
      results={results}
      report={null}
      isRunning
      currentIndex={1}
      totalCount={4}
      runStartedAt={Date.now()}
      sourceLabel="Runner"
      onStop={opts.onStop ?? noop}
      inTeardown={opts.inTeardown}
      onNewRun={noop}
      onRunAgain={noop}
      onViewAllRuns={noop}
      selectedResultId={null}
      onSelectResult={noop}
    />,
  )
}

afterEach(cleanup)

describe('the run-in-progress Stop button', () => {
  it('says "Stop" during the flow', () => {
    renderRunning({})
    expect(screen.getByTestId('runner-stop')).toHaveTextContent('Stop')
    expect(screen.getByTestId('runner-stop')).not.toHaveTextContent('Skip teardown')
  })

  it('promises that cleanup still runs', () => {
    renderRunning({})
    expect(screen.getByTestId('runner-stop').getAttribute('title')).toMatch(/cleanup still runs/i)
  })

  it('becomes "Skip teardown" once cleanup is running', () => {
    renderRunning({ inTeardown: true })
    expect(screen.getByTestId('runner-stop')).toHaveTextContent('Skip teardown')
  })

  it('says what skipping means, so it is not pressed by reflex', () => {
    renderRunning({ inTeardown: true })
    expect(screen.getByTestId('runner-stop').getAttribute('title')).toMatch(/abandon/i)
  })

  it('tells the user the run has moved on to cleanup', () => {
    renderRunning({ inTeardown: true })
    // "Running 1 of 4" during cleanup reads as if the flow were still going,
    // which is what makes a Stop press there ambiguous in the first place.
    expect(screen.getByText(/Cleaning up/i)).toBeTruthy()
  })

  it('still calls back on click in both modes', () => {
    const flow = vi.fn()
    renderRunning({ onStop: flow })
    fireEvent.click(screen.getByTestId('runner-stop'))
    expect(flow).toHaveBeenCalledTimes(1)
    cleanup()

    const teardown = vi.fn()
    renderRunning({ inTeardown: true, onStop: teardown })
    fireEvent.click(screen.getByTestId('runner-stop'))
    expect(teardown).toHaveBeenCalledTimes(1)
  })
})
