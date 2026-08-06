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

  it('NEVER becomes the destructive action, however far the run has got', () => {
    // The property that makes mashing Stop safe. An earlier version renamed
    // THIS button to "Skip teardown" once cleanup began, which put a
    // destructive action where the safe one had been — the inference issue #84
    // removed from main, smuggled back in as geometry.
    renderRunning({ inTeardown: true })
    expect(screen.getByTestId('runner-stop')).not.toHaveTextContent('Skip teardown')
    expect(screen.getByTestId('runner-stop')).toBeDisabled()
  })

  it('says why it has nothing left to do during cleanup', () => {
    renderRunning({ inTeardown: true })
    expect(screen.getByTestId('runner-stop').getAttribute('title')).toMatch(/will finish/i)
  })

  it('tells the user the run has moved on to cleanup', () => {
    renderRunning({ inTeardown: true })
    // "Running 1 of 4" during cleanup reads as if the flow were still going,
    // which is what makes a Stop press there ambiguous in the first place.
    expect(screen.getByText(/Cleaning up/i)).toBeTruthy()
  })

  it('calls back on click during the flow', () => {
    const flow = vi.fn()
    renderRunning({ onStop: flow })
    fireEvent.click(screen.getByTestId('runner-stop'))
    expect(flow).toHaveBeenCalledTimes(1)
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

  it('becomes "Skip teardown" during cleanup — same action, same place', () => {
    // Once cleanup is the only phase left, abandoning it IS the hard stop, so
    // the rename stays on THIS button. Renaming the safe one instead is what
    // let a stray click lose the cleanup.
    renderRunning({ inTeardown: true })
    expect(screen.getByTestId('runner-stop-direct')).toHaveTextContent('Skip teardown')
    expect(screen.getByTestId('runner-stop-direct')).not.toBeDisabled()
  })

  it('says what skipping means, so it is not pressed by reflex', () => {
    renderRunning({ inTeardown: true })
    expect(screen.getByTestId('runner-stop-direct').getAttribute('title')).toMatch(/abandon/i)
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

  it('stays available after a graceful stop', () => {
    // Having asked for a graceful stop must not lock the user out of changing
    // their mind once cleanup turns out to be the thing that is hanging.
    renderRunning({ stopRequested: 'graceful', inTeardown: true })
    const direct = screen.getByTestId('runner-stop-direct')
    expect(direct).toHaveTextContent('Skip teardown')
    expect(direct).not.toBeDisabled()
  })

  it('is the ONLY control that can lose cleanup — at any point in the run', () => {
    /*
     * The invariant, stated as one test: whatever the run is doing, clicking
     * the SAFE button never reaches the destructive handler.
     *
     * Two mechanisms hold it up, and they are checked separately elsewhere:
     * during the flow the safe button is wired to the graceful handler, and
     * during cleanup it is disabled outright (see "NEVER becomes the
     * destructive action"). This test is about the outcome of both.
     */
    for (const phase of [{}, { inTeardown: true }]) {
      const graceful = vi.fn()
      const direct = vi.fn()
      renderRunning({ ...phase, onStop: graceful, onStopDirect: direct })
      const stop = screen.getByTestId('runner-stop')
      for (let i = 0; i < 5; i++) fireEvent.click(stop)
      expect(direct).not.toHaveBeenCalled()
      // During the flow the clicks must actually land — otherwise this test
      // would also "pass" on a Stop button that simply did nothing.
      if (!('inTeardown' in phase)) expect(graceful).toHaveBeenCalledTimes(5)
      cleanup()
    }
  })
})
