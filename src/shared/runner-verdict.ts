/**
 * Runner / Test-Suite endpoint verdict — the SINGLE source of truth shared by
 * the live run summary (main), the exported HTML report (main), and every
 * renderer results view (RunnerResults, RunnerResultsView).
 *
 * A request's verdict is driven by its ASSERTIONS when it has any: a test that
 * explicitly allows a non-2xx code (e.g. an idempotent DELETE asserting
 * `pm.expect(code).to.be.oneOf([200, 204, 404, 400])`) must count as PASSED when
 * that assertion holds — matching Postman / Insomnia (issue #16). Only when a
 * request carries NO assertions at all do we fall back to the HTTP status so a
 * bare 4xx/5xx still surfaces as a failure. Genuine transport failures
 * (`r.error`) always fail.
 *
 * This existed only in the main process (`runner.handler.ts`), while the
 * renderer results UIs still bucketed every 4xx/5xx as failed via a stale
 * `status < 400` check — so an idempotent-DELETE test that passed showed up as
 * "Failed" in the run summary even though the run counters said passed. Keeping
 * the rule here kills that "runner verdict parity" bug class the same way the
 * shared script runtime killed the script-API parity class.
 */
/**
 * Which lifecycle phase of a run produced a result. `setup` and `main` are the
 * run proper; `teardown` is cleanup that is executed even when the run stops
 * early (stopOnError / transport error / user Stop) — see issue #72.
 */
export type RunPhase = 'setup' | 'main' | 'teardown'

/**
 * Teardown is cleanup, not the thing under test: its results are REPORTED but
 * must never flip the run's verdict — a green run whose cleanup DELETE 404s is
 * still green, and a red run whose cleanup succeeds is still red (the original
 * failure must not be masked). Every pass/fail counter — main live run, HTML
 * export, both renderer results views — filters through this helper so the
 * rule can't drift the way the `status < 400` check once did.
 */
export function countsTowardRunVerdict(r: { phase?: RunPhase }): boolean {
  return r.phase !== 'teardown'
}

export interface EndpointVerdictShape {
  /** Transport-layer error (DNS/TCP/TLS/abort) — always a failure. */
  error?: string
  /** Number of failed assertions on this request. */
  failed: number
  /** HTTP status (null when the request never got a response). */
  status: number | null
  /** All assertion results; `.length === 0` means the request has no checks. */
  assertions: { length: number }
}

export function endpointDidPass(r: EndpointVerdictShape): boolean {
  if (r.error || r.failed > 0) return false
  if (r.assertions.length === 0) return (r.status ?? 0) < 400
  return true
}

/**
 * A row that never executed: `pm.execution.skipRequest()`, an unsupported
 * protocol, or a step the run aborted before reaching.
 *
 * It is NEITHER passed nor failed, and asking `endpointDidPass` about it gives
 * the wrong answer — a skipped row has `status: null` and no assertions, so the
 * no-assertion fallback reads `(null ?? 0) < 400` and scores it as PASSED. Main's
 * `recordStep` always guarded its tallies with this condition; the renderer
 * results views and the HTML export did not, so a cancelled 12-step run was
 * about to report "Passed 9". Every counter must exclude these first.
 */
export function isSkippedStep(r: { skipped?: number }): boolean {
  return (r.skipped ?? 0) > 0
}
