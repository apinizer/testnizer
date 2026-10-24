/**
 * `pm.test` — the ONE implementation both script paths use (Send renderer
 * `test-runner.ts`, Run main `runner.handler.ts`).
 *
 * Three callback forms, decided by the callback itself:
 *   - sync `function () {}`      → recorded when it returns or throws.
 *   - promise `async () => {}`   → optimistic pass, rewritten if the promise
 *                                  rejects (unchanged from before; awaited by
 *                                  the host's drain).
 *   - done `function (done) {}`  → (issue #274) the slot starts FAILED and is
 *                                  decided by `done()` / `done(err)` / a throw /
 *                                  the watchdog. Before this, both paths called
 *                                  `fn()` with no argument and recorded a PASS
 *                                  as soon as it returned — a silent false-green
 *                                  for every Postman test that finishes in a
 *                                  timer or a `pm.sendRequest` callback.
 *
 * Errors thrown later, inside a timer or a `pm.sendRequest` callback, used to
 * escape every try/catch (an uncaught exception in the main process on Run).
 * The recorder hands the sandbox wrapped timers and a `bindCallback` helper:
 * a callback remembers which test was running when it was scheduled, and a
 * throw from it fails THAT test instead of escaping.
 */
import type { ScriptTestResult } from './types'

/**
 * How long a done-style test may wait for `done()`. The promise form has no
 * timeout of its own, so this is the documented default from issue #274.
 */
export const DONE_CALLBACK_TIMEOUT_MS = 5000

export type PmTestCallback = (done?: (err?: unknown) => void) => unknown

export interface PmTestFunction {
  (name: string, fn?: PmTestCallback): void
  /** Postman `pm.test.skip(name, fn)` — recorded as skipped, never run. */
  skip(name: string, fn?: PmTestCallback): void
  /** Postman `pm.test.index()` — how many tests this script registered so far. */
  index(): number
}

/** The timer functions a script sees. Same signatures as the host's. */
export interface SandboxTimers {
  setTimeout: (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => unknown
  clearTimeout: (handle: unknown) => void
  setInterval: (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => unknown
  clearInterval: (handle: unknown) => void
}

export interface TestRecorderOptions {
  /** Result sink; pass the host's own array to keep its references valid. */
  results?: ScriptTestResult[]
  /** Pending-test sink; the host's drain awaits these. */
  pending?: Promise<void>[]
  /** Watchdog for done-style tests. Defaults to DONE_CALLBACK_TIMEOUT_MS. */
  doneTimeoutMs?: number
  /** A throw from a timer / callback that belongs to no pending test. */
  onAsyncError?: (err: unknown) => void
}

export interface TestRecorder {
  results: ScriptTestResult[]
  pending: Promise<void>[]
  test: PmTestFunction
  timers: SandboxTimers
  /**
   * Wrap a script callback (e.g. the `pm.sendRequest` callback) so that a throw
   * from it fails the test that was running when it was scheduled. Returns a
   * function that never throws.
   */
  bindCallback<A extends unknown[]>(fn: (...args: A) => unknown): (...args: A) => void
}

/** A test whose result is still open: async or done-style. */
interface OpenTest {
  fail(err: unknown): void
  settled(): boolean
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  return String(e)
}

export function createTestRecorder(opts: TestRecorderOptions = {}): TestRecorder {
  const results = opts.results ?? []
  const pending = opts.pending ?? []
  const timeoutMs = opts.doneTimeoutMs ?? DONE_CALLBACK_TIMEOUT_MS
  let registered = 0
  /** The test whose code is running right now (sync part or a bound callback). */
  let current: OpenTest | null = null

  const routeError = (owner: OpenTest | null, err: unknown): void => {
    if (owner && !owner.settled()) owner.fail(err)
    else opts.onAsyncError?.(err)
  }

  /** Run `fn` with `owner` as the current test; route a throw to it. */
  const withOwner = <A extends unknown[]>(
    owner: OpenTest | null,
    fn: (...args: A) => unknown,
    args: A,
  ): void => {
    const prev = current
    current = owner
    try {
      const out = fn(...args)
      // A callback that returns a rejected promise (async timer body) is the
      // same failure as a throw.
      if (out && typeof (out as Promise<unknown>).then === 'function') {
        ;(out as Promise<unknown>).then(undefined, (e: unknown) => routeError(owner, e))
      }
    } catch (e) {
      routeError(owner, e)
    } finally {
      current = prev
    }
  }

  function bindCallback<A extends unknown[]>(fn: (...args: A) => unknown): (...args: A) => void {
    const owner = current
    return (...args: A) => withOwner(owner, fn, args)
  }

  const timers: SandboxTimers = {
    setTimeout: (fn, ms, ...args) => {
      const run = bindCallback(fn)
      return setTimeout(() => run(...args), ms)
    },
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms, ...args) => {
      const run = bindCallback(fn)
      return setInterval(() => run(...args), ms)
    },
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  }

  function runSync(name: string, fn: PmTestCallback): void {
    try {
      const out = fn()
      if (out && typeof (out as Promise<unknown>).then === 'function') {
        // Promise form — unchanged: optimistic slot, rewritten on rejection.
        const idx = results.length
        results.push({ name, passed: true })
        let done = false
        const open: OpenTest = {
          fail: (e) => {
            done = true
            results[idx] = { name, passed: false, error: errorMessage(e) }
          },
          settled: () => done,
        }
        pending.push(
          (out as Promise<unknown>).then(
            () => {
              done = true
            },
            (e: unknown) => open.fail(e),
          ),
        )
        return
      }
      results.push({ name, passed: true })
    } catch (e) {
      results.push({ name, passed: false, error: errorMessage(e) })
    }
  }

  function runWithDone(name: string, fn: PmTestCallback): void {
    const idx = results.length
    results.push({ name, passed: false, error: `pm.test "${name}": done() was not called` })
    let isSettled = false
    let resolvePending: () => void = () => {}
    pending.push(
      new Promise<void>((resolve) => {
        resolvePending = resolve
      }),
    )
    const watchdog = setTimeout(() => {
      settle({
        name,
        passed: false,
        error: `pm.test "${name}" timed out after ${timeoutMs} ms waiting for done()`,
      })
    }, timeoutMs)
    function settle(r: ScriptTestResult): void {
      if (isSettled) return
      isSettled = true
      clearTimeout(watchdog)
      results[idx] = r
      resolvePending()
    }
    const open: OpenTest = {
      fail: (e) => settle({ name, passed: false, error: errorMessage(e) }),
      settled: () => isSettled,
    }
    const done = (err?: unknown): void => {
      if (err) open.fail(err)
      else settle({ name, passed: true })
    }
    withOwner(open, fn, [done])
  }

  const test = ((name: string, fn?: PmTestCallback): void => {
    registered++
    if (typeof fn !== 'function') {
      // Postman records a test without a callback as skipped.
      results.push({ name, passed: true, skipped: true })
      return
    }
    if (fn.length >= 1) runWithDone(name, fn)
    else runSync(name, fn)
  }) as PmTestFunction
  test.skip = (name: string): void => {
    registered++
    results.push({ name, passed: true, skipped: true })
  }
  test.index = (): number => registered

  return { results, pending, test, timers, bindCallback }
}

/**
 * Wait until every pending send and test has settled. Loops because a send
 * callback can register a new `pm.test` and a done-style test can fire a new
 * send — draining each queue once could leave late arrivals behind.
 */
export async function drainPending(
  pendingSends: Promise<unknown>[],
  pendingTests: Promise<void>[],
): Promise<void> {
  while (pendingSends.length > 0 || pendingTests.length > 0) {
    const sends = pendingSends.splice(0)
    await Promise.allSettled(sends)
    const tests = pendingTests.splice(0)
    await Promise.allSettled(tests)
  }
}
