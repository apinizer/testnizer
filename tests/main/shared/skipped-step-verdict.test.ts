/**
 * Run summary — the counters every results surface reads.
 *
 * Two bugs are pinned here.
 *
 * 1. A SKIPPED row used to be scored as PASSED. `endpointDidPass` falls back to
 *    the HTTP status when a row has no assertions, and a skipped row has
 *    `status: null` → `(null ?? 0) < 400` → true. Main's `recordStep` always
 *    guarded its tallies, but both renderer views and the HTML export did not.
 *    That was harmless while only `skipRequest()` produced such rows; it becomes
 *    a wrong headline the moment an aborted run reports the steps it never ran.
 *
 * 2. A TEARDOWN failure used to increment the top-level "Errors" counter, which
 *    contradicts the promise printed in the runner's own UI ("Failures are
 *    reported but never change the run verdict").
 */
import { describe, it, expect } from 'vitest'
import { isSkippedStep, endpointDidPass, countsTowardRunVerdict } from '../../../src/shared/runner-verdict'
import { summarizeRun, statusBadge, type SummarizableResult } from '../../../src/shared/runner-summary'

/** A green main-flow row. */
function ok(over: Partial<SummarizableResult> = {}): SummarizableResult {
  return { failed: 0, status: 200, assertions: [], skipped: 0, phase: 'main', ...over }
}
/** A row that never executed. */
function notRun(over: Partial<SummarizableResult> = {}): SummarizableResult {
  return { failed: 0, status: null, assertions: [], skipped: 1, phase: 'main', ...over }
}

describe('isSkippedStep', () => {
  it('detects rows that never ran', () => {
    expect(isSkippedStep({ skipped: 1 })).toBe(true)
    expect(isSkippedStep({ skipped: 0 })).toBe(false)
    // Older reports predate the field.
    expect(isSkippedStep({})).toBe(false)
  })

  it('is needed because endpointDidPass says PASSED about a skipped row', () => {
    // Documents the trap rather than asserting desired behaviour: the verdict
    // helper is right for real rows, which is exactly why callers must filter
    // skipped rows out BEFORE asking it.
    expect(endpointDidPass(notRun())).toBe(true)
    expect(isSkippedStep(notRun())).toBe(true)
  })
})

describe('summarizeRun', () => {
  it('scores a skipped row as neither passed nor failed', () => {
    const s = summarizeRun([ok(), notRun(), notRun()])
    expect(s.passed).toBe(1)
    expect(s.failed).toBe(0)
    expect(s.skipped).toBe(2)
  })

  it('keeps passed + failed + skipped === total', () => {
    const s = summarizeRun([
      ok(),
      ok({ status: 500 }),
      notRun(),
      ok({ failed: 1, assertions: [{ name: 'x', passed: false }] }),
    ])
    expect(s.passed + s.failed + s.skipped).toBe(s.total)
    expect(s.total).toBe(4)
    expect(s.passed).toBe(1)
    expect(s.failed).toBe(2)
    expect(s.skipped).toBe(1)
  })

  it('excludes teardown rows from the verdict counters', () => {
    const s = summarizeRun([ok(), ok({ phase: 'teardown', status: 404 })])
    expect(s.total).toBe(1)
    expect(s.passed).toBe(1)
    expect(s.failed).toBe(0)
    expect(s.teardownFailed).toBe(1)
    expect(s.teardownTotal).toBe(1)
  })

  it('does NOT let a teardown error raise the top-level Errors counter', () => {
    // The deciding case from the QA report: a fully green flow plus a teardown
    // script that throws must stay a PASS, with the failure reported separately.
    const s = summarizeRun([
      ok(),
      ok(),
      { failed: 0, status: null, assertions: [], skipped: 0, phase: 'teardown', error: 'boom' },
    ])
    expect(s.passed).toBe(2)
    expect(s.failed).toBe(0)
    expect(s.errors).toBe(0)
    expect(s.teardownFailed).toBe(1)
  })

  it('counts transport errors in verdict-bearing phases', () => {
    const s = summarizeRun([ok(), { ...ok({ status: null }), error: 'ECONNREFUSED' }])
    expect(s.errors).toBe(1)
    expect(s.failed).toBe(1)
  })

  it('counts setup rows toward the verdict', () => {
    // A missing precondition makes the run wrong, so setup is not cleanup.
    const s = summarizeRun([ok({ phase: 'setup', status: 500 }), ok()])
    expect(countsTowardRunVerdict({ phase: 'setup' })).toBe(true)
    expect(s.total).toBe(2)
    expect(s.failed).toBe(1)
  })

  it('sums captured console lines across every row', () => {
    const line = { level: 'log' as const, message: 'x', timestamp: 0 }
    const s = summarizeRun([
      ok({ consoleLogs: [line, line] }),
      ok({ consoleLogs: [line] }),
      ok(),
      ok({ phase: 'teardown', consoleLogs: [line] }),
    ])
    expect(s.consoleLogs).toBe(4)
  })

  it('handles an empty run', () => {
    const s = summarizeRun([])
    expect(s).toMatchObject({ total: 0, passed: 0, failed: 0, skipped: 0, errors: 0 })
  })
})

describe('statusBadge', () => {
  it('labels a run-level script row instead of showing a fake 200', () => {
    // main sets `status: 200` on purpose so a blown-up hook cannot be scored as a
    // pass by the no-assertion fallback; the UI must not repeat that number.
    expect(statusBadge({ status: 200, statusText: 'SCRIPT' })).toEqual({
      text: 'SCRIPT',
      tone: 'neutral',
    })
  })

  it('shows a thrown hook as an error', () => {
    expect(statusBadge({ status: null, statusText: 'SCRIPT', error: 'boom' })).toEqual({
      text: 'Error',
      tone: 'error',
    })
  })

  it('labels the three skip flavours', () => {
    expect(statusBadge({ status: null, statusText: 'NOT_RUN' })?.text).toBe('NOT RUN')
    expect(statusBadge({ status: null, statusText: 'SKIPPED' })?.text).toBe('SKIPPED')
    expect(statusBadge({ status: null, statusText: 'UNSUPPORTED' })?.text).toBe('UNSUPPORTED')
  })

  it('keeps status colour independent of the verdict', () => {
    // A 400 that an assertion explicitly allows still reads as a 400.
    expect(statusBadge({ status: 400, statusText: 'Bad Request' })).toEqual({
      text: '400',
      tone: 'warn',
    })
    expect(statusBadge({ status: 204, statusText: 'No Content' })?.tone).toBe('ok')
    expect(statusBadge({ status: 503, statusText: 'Unavailable' })?.tone).toBe('error')
  })

  it('renders nothing when there is neither a status nor an error', () => {
    expect(statusBadge({ status: null, statusText: '' })).toBeNull()
  })
})
