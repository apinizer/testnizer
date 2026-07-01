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
