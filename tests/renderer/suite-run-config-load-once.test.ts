/**
 * Issue #100, retest — "Save configuration" worked, restoring it did not.
 *
 * The reporter's three observations only look contradictory until you see the
 * guard: leaving the Runner tab and coming back kept the config; opening the
 * suite from the sidebar lost it; opening a request inside the suite and then
 * returning to the Runner brought it back.
 *
 * The suite-items effect loads the saved config once per suite, tracked in a
 * ref. It marked the suite as loaded BEFORE awaiting the config, and it took
 * `runFolderName` as a dependency although it never reads it — and
 * `runFolderName` is set from the session payload right after mount. So the
 * first run was cancelled mid-await by its own dependency changing, the
 * `if (cancelled) return` fired, and the ref was left claiming a config had
 * been loaded that had never been applied. Every later run skipped the load.
 * Only a remount (a detour through another tab) reset the ref — which is
 * exactly the one path that worked.
 *
 * The ordering is what is pinned here: mark AFTER the load survives, never
 * before.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSuiteRunConfig } from '../../src/renderer/lib/suite-run-config'

const RUNNER_TAB = resolve(__dirname, '../../src/renderer/components/runner/RunnerTab.tsx')

/**
 * The load-once guard, reduced to the shape the component uses. The bug was
 * an ordering one, so a faithful reduction reproduces it and the component's
 * 1500 lines of unrelated wiring do not have to be mounted to see it.
 */
function makeLoader(opts: { markBeforeAwait: boolean }) {
  const ref: { current: string | null } = { current: null }
  const applied: string[] = []

  async function run(
    suiteId: string,
    fetchConfig: () => Promise<string | null>,
    signal: {
      cancelled: boolean
    },
  ) {
    if (ref.current === suiteId) return
    if (opts.markBeforeAwait) ref.current = suiteId
    const raw = await fetchConfig()
    if (signal.cancelled) return
    if (!opts.markBeforeAwait) ref.current = suiteId
    const cfg = parseSuiteRunConfig(raw)
    if (cfg) applied.push(suiteId)
  }

  return { run, applied, ref }
}

const CONFIG = JSON.stringify({
  version: 1,
  delay: 250,
  iterationDelay: 0,
  iterations: 3,
  stopOnError: true,
  persistResponses: false,
  keepVariableValues: true,
  environmentId: null,
  items: [],
})

beforeEach(() => vi.clearAllMocks())

describe('the load-once guard (#100)', () => {
  it('loses the config forever when the first run is cancelled — the reported bug', async () => {
    const loader = makeLoader({ markBeforeAwait: true })
    const first = { cancelled: false }
    const inFlight = loader.run('suite-1', async () => CONFIG, first)
    // `runFolderName` lands from the session payload → cleanup → re-run.
    first.cancelled = true
    await inFlight
    await loader.run('suite-1', async () => CONFIG, { cancelled: false })

    expect(loader.applied).toEqual([])
    expect(loader.ref.current).toBe('suite-1') // marked, yet nothing applied
  })

  it('survives that cancellation once the mark comes after the load', async () => {
    const loader = makeLoader({ markBeforeAwait: false })
    const first = { cancelled: false }
    const inFlight = loader.run('suite-1', async () => CONFIG, first)
    first.cancelled = true
    await inFlight
    await loader.run('suite-1', async () => CONFIG, { cancelled: false })

    expect(loader.applied).toEqual(['suite-1'])
  })

  it('still loads only once when nothing is cancelled', async () => {
    const loader = makeLoader({ markBeforeAwait: false })
    const quiet = { cancelled: false }
    await loader.run('suite-1', async () => CONFIG, quiet)
    await loader.run('suite-1', async () => CONFIG, quiet)

    expect(loader.applied).toEqual(['suite-1'])
  })

  it('reloads when the tab is pointed at a different suite', async () => {
    const loader = makeLoader({ markBeforeAwait: false })
    const quiet = { cancelled: false }
    await loader.run('suite-1', async () => CONFIG, quiet)
    await loader.run('suite-2', async () => CONFIG, quiet)

    expect(loader.applied).toEqual(['suite-1', 'suite-2'])
  })
})

describe('RunnerTab keeps that ordering (#100)', () => {
  const source = readFileSync(RUNNER_TAB, 'utf8')

  it('marks the suite as loaded only after the cancellation check', () => {
    const mark = source.indexOf('configLoadedForSuiteRef.current = suiteIdForRunner')
    const guard = source.indexOf('if (configLoadedForSuiteRef.current !== suiteIdForRunner)')
    const cancelCheck = source.indexOf('if (cancelled) return', guard)

    expect(guard).toBeGreaterThan(-1)
    expect(mark).toBeGreaterThan(cancelCheck)
  })

  it('does not depend on runFolderName, which it never reads', () => {
    // The dependency was the churn the config load kept losing its race to.
    expect(source).toContain('}, [suiteIdForRunner])')
    expect(source).not.toContain('}, [suiteIdForRunner, runFolderName])')
  })
})
