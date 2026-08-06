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

function renderRunning(opts: {
  inTeardown?: boolean
  onStop?: () => void
  onStopDirect?: () => void
  stopRequested?: 'graceful' | 'direct' | null
}) {
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
      onStopDirect={opts.onStopDirect ?? noop}
      stopRequested={opts.stopRequested ?? null}
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

/*
 * Issue #91 asked for the two intentions to become two controls. The tests
 * above pin that Stop labels itself honestly; these pin that the hard stop
 * exists as its own button and is never what a plain Stop does.
 */
describe('the "Stop now" button', () => {
  it('sits beside Stop during the flow', () => {
    renderRunning({})
    expect(screen.getByTestId('runner-stop-direct')).toHaveTextContent('Stop now')
    expect(screen.getByTestId('runner-stop')).toHaveTextContent('Stop')
  })

  it('is a DIFFERENT callback from Stop — the whole point of splitting them', () => {
    const graceful = vi.fn()
    const direct = vi.fn()
    renderRunning({ onStop: graceful, onStopDirect: direct })

    fireEvent.click(screen.getByTestId('runner-stop'))
    expect(graceful).toHaveBeenCalledTimes(1)
    expect(direct).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('runner-stop-direct'))
    expect(direct).toHaveBeenCalledTimes(1)
    // Pressing the hard stop must not also be counted as a graceful one.
    expect(graceful).toHaveBeenCalledTimes(1)
  })

  it('says it halts everything, so it is not pressed by reflex', () => {
    renderRunning({})
    const title = screen.getByTestId('runner-stop-direct').getAttribute('title') ?? ''
    expect(title).toMatch(/halt/i)
    expect(title).toMatch(/cleanup/i)
  })

  it('disappears during cleanup, where Stop already means the same thing', () => {
    // Two controls doing one thing is the ambiguity this change removes; the
    // remaining button says "Skip teardown" and does the hard stop.
    renderRunning({ inTeardown: true })
    expect(screen.queryByTestId('runner-stop-direct')).toBeNull()
    expect(screen.getByTestId('runner-stop')).toHaveTextContent('Skip teardown')
  })

  it('acknowledges the click, because a graceful stop cannot show its work', () => {
    // The reported symptom: Stop appears to do nothing, so the user clicks
    // again — and under the old inference that second click killed cleanup.
    // The flow request in flight is deliberately allowed to finish, so the only
    // honest feedback available is the button itself.
    renderRunning({ stopRequested: 'graceful' })
    const stop = screen.getByTestId('runner-stop')
    expect(stop).toHaveTextContent('Stopping…')
    expect(stop).toBeDisabled()
  })

  it('acknowledges a hard stop too', () => {
    renderRunning({ stopRequested: 'direct' })
    expect(screen.getByTestId('runner-stop-direct')).toHaveTextContent('Halting…')
    expect(screen.getByTestId('runner-stop-direct')).toBeDisabled()
  })

  it('keeps "Skip teardown" clickable after a graceful stop', () => {
    // Having asked for a graceful stop must not lock the user out of changing
    // their mind once cleanup turns out to be the thing that is hanging.
    renderRunning({ stopRequested: 'graceful', inTeardown: true })
    const stop = screen.getByTestId('runner-stop')
    expect(stop).toHaveTextContent('Skip teardown')
    expect(stop).not.toBeDisabled()
  })
})
