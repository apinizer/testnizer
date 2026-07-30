/**
 * Runner IPC contract — the SINGLE definition shared by main, preload and the
 * renderer.
 *
 * These interfaces used to be declared three times: in `runner.handler.ts`, in
 * `preload/index.d.ts` and (partially) in `runner.store.ts`. They had already
 * drifted — `folderName` existed in two of the three and `RunPhase` was
 * re-declared locally in the preload copy instead of being imported from
 * `runner-verdict`. The drift also produced the reported bug: the Runner UI's
 * `execute` call simply omitted `stopOnError`, and nothing in the type system
 * could notice, because the payload type it satisfied had every field optional.
 *
 * Adding a field is now one edit, and `runner-payload.ts` turns "the UI forgot
 * to send it" into a compile error.
 */
import type { RunPhase } from './runner-verdict'

export type { RunPhase }

export interface ResponseTiming {
  total: number
  dns?: number
  tcp?: number
  tls?: number
  ttfb?: number
  download?: number
}

export interface AssertionResult {
  name: string
  passed: boolean
  actual?: string | number
  error?: string
}

/**
 * One line of `console.*` output captured from a user script.
 *
 * Levels are preserved because the renderer's Send path already preserves them;
 * main used to flatten warn/error into log, which is exactly the kind of
 * per-path divergence `src/shared/script/` exists to prevent.
 */
export interface ScriptConsoleLog {
  level: 'log' | 'warn' | 'error'
  message: string
  timestamp: number
}

export interface EndpointRunResult {
  endpointId: string
  endpointName: string
  folderName?: string
  method: string
  url: string
  status: number | null
  statusText: string
  duration: number
  passed: number
  failed: number
  skipped: number
  assertions: AssertionResult[]
  error?: string
  responseSize?: number
  responseBody?: string
  responseHeaders?: Record<string, string>
  requestHeaders?: Record<string, string>
  requestBody?: string
  /** 1-based iteration index. Renderer groups results by this field. */
  iteration?: number
  /**
   * Lifecycle phase that produced this result (issue #72). Absent on reports
   * written before run-level hooks existed — treated as 'main' everywhere.
   */
  phase?: RunPhase
  /**
   * `console.*` output from this step's scripts, capped in main. Absent on
   * reports written before the console pipeline existed.
   */
  consoleLogs?: ScriptConsoleLog[]
}

export interface RunnerExecuteOptions {
  projectId: string
  endpointIds: string[]
  environmentId?: string
  workspaceId?: string
  /** Delay in milliseconds inserted between requests. */
  delay?: number
  /**
   * Number of iterations. When `iterationData` is supplied, this is overridden
   * by `iterationData.length`. Defaults to 1.
   */
  iterations?: number
  /**
   * Per-iteration data rows (Postman / Insomnia compatible). When set, the
   * runner executes one iteration per row and exposes the row to scripts via
   * `pm.iterationData.get(key)`.
   */
  iterationData?: Record<string, string>[]
  stopOnError?: boolean
  /**
   * When true (default) each result carries the full responseBody +
   * responseHeaders. Disable to keep memory low for very large collections —
   * the report still has assertions, status, timing and size.
   */
  persistResponses?: boolean
  /**
   * Postman "Keep variable values" — when true (default) environment / global
   * variables written by scripts during the run (`pm.environment.set`,
   * `insomnia.environment.set`, …) are persisted back to the active environment
   * after the run completes, so a token fetched once in a setup request is
   * reused (and refreshed in one place) by every later request and by
   * subsequent runs. Set false to keep the run side-effect-free (issue #12).
   */
  keepVariableValues?: boolean
  /**
   * Run-level SETUP requests (issue #72). Executed once, in order, BEFORE the
   * main flow — not once per iteration: setup is "prepare this run", not
   * "prepare this iteration". They are part of the run proper, so a setup
   * failure counts against the run verdict and skips the main flow — but
   * teardown still executes.
   */
  setupEndpointIds?: string[]
  /**
   * Run-level TEARDOWN requests (issue #72). Executed once, in order, AFTER
   * everything else — GUARANTEED on a best-effort basis: they still run when
   * the run stopped early via stopOnError, a transport error, or the user
   * pressing Stop. A second Stop aborts teardown too, so the UI can never hang.
   * Their results are reported under the 'teardown' phase and deliberately do
   * NOT flip the run's verdict (see shared/runner-verdict.ts).
   */
  teardownEndpointIds?: string[]
  /** Run-level pre-request script — runs ONCE before the setup phase. */
  runPreScript?: string
  /** Run-level post-run script — runs ONCE at the end of teardown (guaranteed). */
  runPostScript?: string
  folderName?: string
  source?: string
  sourceLabel?: string
  // Set by executeCollectionForScheduler so we can tie this runner_history
  // row back to its scheduled_tasks row even after a rename / delete.
  scheduledTaskId?: string
  /**
   * Runner tab this run belongs to, used only to attribute Console entries
   * (issue #79). Send already tags its entries with the tab that fired them;
   * without this a run's traffic lands in the footer Console with no tab, so
   * the per-tab Console view stays empty for the tab you actually ran from.
   * Absent for scheduled runs, which have no tab — their entries are
   * identified by the `run`/`task` metadata instead.
   */
  runTabId?: string
}

export interface RunnerExportOptions {
  results: EndpointRunResult[]
  format: 'json' | 'html'
}

export interface RunnerProgress {
  current: number
  total: number
  endpointId: string
  result: EndpointRunResult
}

/**
 * 'setupFailed'      — a run-level setup step failed, so the flow was skipped.
 * 'stopOnError'      — a flow request failed and the run was configured to halt.
 * 'cancelled'        — the user pressed Stop.
 * 'teardownAborted'  — a SECOND Stop cut cleanup short as well.
 *
 * `setupFailed` is distinct from `stopOnError` on purpose: a failed setup skips
 * the flow whether or not "Stop run if an error occurs" is checked, so reusing
 * the stopOnError message would tell the user their checkbox did something it
 * did not do.
 */
export type RunStopReason = 'setupFailed' | 'stopOnError' | 'cancelled' | 'teardownAborted'

export interface RunnerReport {
  projectId: string
  startedAt: number
  completedAt: number
  totalEndpoints: number
  passedEndpoints: number
  failedEndpoints: number
  totalAssertions: number
  passedAssertions: number
  failedAssertions: number
  results: EndpointRunResult[]
  /**
   * Variables written by scripts during the run and (when keepVariableValues
   * is on) persisted to the active environment / project globals. The renderer
   * uses these deltas to refresh its in-memory env store so the next "Send"
   * and the env editor reflect the new values without a manual reload.
   */
  envUpdates?: Record<string, string>
  globalUpdates?: Record<string, string>
  /**
   * Teardown-phase tallies, kept OUT of passedEndpoints / failedEndpoints so a
   * cleanup failure is reported without masking (or manufacturing) the run's
   * real verdict — issue #72.
   */
  teardownPassedEndpoints?: number
  teardownFailedEndpoints?: number
  teardownPassedAssertions?: number
  teardownFailedAssertions?: number
  /** Why the main flow ended before its last request, when it did. */
  stopReason?: RunStopReason
}
