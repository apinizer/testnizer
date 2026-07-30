/**
 * Headline numbers for a run — computed in ONE place.
 *
 * `runner-verdict.ts` answers "did THIS row pass". This module answers "what does
 * THIS RUN read as", which had been re-implemented three times with three
 * different answers:
 *
 *  - `RunnerResults.tsx`      counted `results.length` as "All tests" and every
 *    row with an `error` as an error — including teardown rows, so a cleanup
 *    failure incremented the top-level Errors counter that the feature's own UI
 *    promises "does not affect the run verdict".
 *  - `RunnerResultsView.tsx`  computed "All tests" as Σ(passed+failed), i.e. an
 *    assertion count, so the two views disagreed with each other and with
 *    `runner_history.total_endpoints`.
 *  - `exportAsHtml`           derived failures as `primary.length - passed`,
 *    which buckets skipped rows as failures.
 *
 * The invariant this guarantees is the one a reader checks by eye:
 *
 *     passed + failed + skipped === total
 */
import { countsTowardRunVerdict, endpointDidPass, isSkippedStep } from './runner-verdict'
import type { EndpointRunResult } from './runner-types'

/** The subset of a result this module needs — keeps it testable with literals. */
export type SummarizableResult = Pick<
  EndpointRunResult,
  'error' | 'failed' | 'status' | 'assertions' | 'skipped' | 'phase' | 'consoleLogs'
>

export interface RunSummary {
  /** Verdict-bearing rows (setup + main). Excludes teardown. */
  total: number
  passed: number
  failed: number
  /** Rows that never ran. Counted across ALL phases so nothing is invisible. */
  skipped: number
  /** Transport errors in verdict-bearing phases only — teardown is excluded. */
  errors: number
  /** Teardown rows that failed. Reported separately, never folded into `failed`. */
  teardownFailed: number
  teardownTotal: number
  /** Total `console.*` lines captured across every row. */
  consoleLogs: number
}

export function summarizeRun(results: readonly SummarizableResult[]): RunSummary {
  const verdict = results.filter(countsTowardRunVerdict)
  const teardown = results.filter((r) => !countsTowardRunVerdict(r))
  // A skipped row is neutral: it must not be scored, in either direction.
  const scored = verdict.filter((r) => !isSkippedStep(r))
  const passed = scored.filter(endpointDidPass).length

  return {
    total: verdict.length,
    passed,
    failed: scored.length - passed,
    skipped: results.filter(isSkippedStep).length,
    errors: verdict.filter((r) => !!r.error).length,
    teardownFailed: teardown.filter((r) => !isSkippedStep(r) && !endpointDidPass(r)).length,
    teardownTotal: teardown.length,
    consoleLogs: results.reduce((n, r) => n + (r.consoleLogs?.length ?? 0), 0),
  }
}

/**
 * `statusText` values that mark a row as something other than a real HTTP
 * exchange. The data has always been there; the results UIs only ever read
 * `status`, which is why a run-level script row rendered a green "200" badge.
 */
export const SYNTHETIC_STATUS = new Set(['SCRIPT', 'SKIPPED', 'NOT_RUN', 'UNSUPPORTED'])

export type BadgeTone = 'ok' | 'warn' | 'error' | 'neutral'

export interface StatusBadge {
  text: string
  tone: BadgeTone
}

/**
 * What to render in a result row's status slot.
 *
 * Note the deliberate split from the verdict: tone is about the HTTP status, not
 * about pass/fail. A 400 that a test explicitly allows still shows in red — the
 * run says "passed", the response says "400", and both are true (Postman and
 * Insomnia behave the same way).
 */
export function statusBadge(r: {
  status: number | null
  statusText: string
  error?: string
}): StatusBadge | null {
  if (SYNTHETIC_STATUS.has(r.statusText)) {
    // A hook that threw carries `status: null` + `error`, and reads as an error
    // rather than a neutral chip.
    if (r.error) return { text: 'Error', tone: 'error' }
    return {
      text: r.statusText === 'SCRIPT' ? 'SCRIPT' : r.statusText.replace('_', ' '),
      tone: 'neutral',
    }
  }
  if (r.status === null) return r.error ? { text: 'Error', tone: 'error' } : null
  if (r.status < 300) return { text: String(r.status), tone: 'ok' }
  if (r.status < 500) return { text: String(r.status), tone: 'warn' }
  return { text: String(r.status), tone: 'error' }
}
