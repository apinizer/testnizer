/**
 * The teardown-phase verdict rule (issue #72) — pinned at its single source,
 * `shared/runner-verdict.ts`, because FOUR consumers depend on it: the main
 * live run, the exported HTML report, and both renderer results views.
 *
 * Cleanup is reported, never decisive: a failing teardown must not turn a green
 * run red, and a passing teardown must not rescue the failure that stopped the
 * run. `endpointDidPass` still scores each individual row the same way it does
 * anywhere else — the phase only decides WHICH counter the row lands in.
 */
import { describe, it, expect } from 'vitest'
import { endpointDidPass, countsTowardRunVerdict } from '../../../src/shared/runner-verdict'
import type { EndpointVerdictShape, RunPhase } from '../../../src/shared/runner-verdict'

type Row = EndpointVerdictShape & { phase?: RunPhase }

const row = (over: Partial<Row>): Row => ({
  failed: 0,
  status: 200,
  assertions: { length: 0 },
  ...over,
})

describe('countsTowardRunVerdict', () => {
  it('counts setup and main rows toward the run verdict', () => {
    expect(countsTowardRunVerdict(row({ phase: 'setup' }))).toBe(true)
    expect(countsTowardRunVerdict(row({ phase: 'main' }))).toBe(true)
  })

  it('excludes teardown rows', () => {
    expect(countsTowardRunVerdict(row({ phase: 'teardown' }))).toBe(false)
  })

  it('treats a phase-less row as main (reports written before issue #72)', () => {
    expect(countsTowardRunVerdict(row({}))).toBe(true)
  })
})

describe('run verdict with a teardown phase', () => {
  const verdictOf = (rows: Row[]) => {
    const primary = rows.filter(countsTowardRunVerdict)
    return {
      passed: primary.filter(endpointDidPass).length,
      failed: primary.filter((r) => !endpointDidPass(r)).length,
      teardownFailed: rows.filter((r) => !countsTowardRunVerdict(r) && !endpointDidPass(r)).length,
    }
  }

  it('a failing teardown does not turn a green run red', () => {
    const v = verdictOf([row({ phase: 'main' }), row({ phase: 'teardown', status: 500 })])
    expect(v).toEqual({ passed: 1, failed: 0, teardownFailed: 1 })
  })

  it('a passing teardown does not mask the failure that stopped the run', () => {
    const v = verdictOf([
      row({ phase: 'main', status: 500 }),
      row({ phase: 'teardown', status: 200 }),
    ])
    expect(v).toEqual({ passed: 0, failed: 1, teardownFailed: 0 })
  })

  it('scores a teardown row itself with the normal assertion-driven rule', () => {
    // Idempotent cleanup DELETE: 400 with a passing assertion is a PASS.
    const cleanup = row({ phase: 'teardown', status: 400, assertions: { length: 1 }, failed: 0 })
    expect(endpointDidPass(cleanup)).toBe(true)
    // ...while a bare 400 with no checks is still a teardown failure.
    expect(endpointDidPass(row({ phase: 'teardown', status: 400 }))).toBe(false)
  })

  it('a transport failure in teardown is a teardown failure, not a run failure', () => {
    const v = verdictOf([
      row({ phase: 'main' }),
      row({ phase: 'teardown', status: null, error: 'ECONNREFUSED' }),
    ])
    expect(v).toEqual({ passed: 1, failed: 0, teardownFailed: 1 })
  })
})
