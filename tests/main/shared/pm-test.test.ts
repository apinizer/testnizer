/**
 * Shared `pm.test` recorder (src/shared/script/pm-test.ts) — issue #274.
 *
 * The parity fixture (tests/fixtures/script-parity.ts, case l2) proves Send≡Run
 * for the done-callback form. These units cover what the fixture cannot keep
 * fast: the watchdog (vitest's own timeout is also 5 s, so it runs with a short
 * injected value here), repeated done(), `async function (done)`, and routing a
 * late throw from a bound callback to the test that scheduled it.
 */
import { describe, expect, it } from 'vitest'
import {
  createTestRecorder,
  drainPending,
  DONE_CALLBACK_TIMEOUT_MS,
} from '../../../src/shared/script/pm-test'

async function settle(rec: ReturnType<typeof createTestRecorder>): Promise<void> {
  await drainPending([], rec.pending)
}

describe('pm.test done-callback form (issue #274)', () => {
  it('defaults to a 5000 ms watchdog', () => {
    expect(DONE_CALLBACK_TIMEOUT_MS).toBe(5000)
  })

  it('fails with a clear message when done() is never called', async () => {
    const rec = createTestRecorder({ doneTimeoutMs: 20 })
    rec.test('never done', (done) => {
      void done
    })
    await settle(rec)
    expect(rec.results).toEqual([
      {
        name: 'never done',
        passed: false,
        error: 'pm.test "never done" timed out after 20 ms waiting for done()',
      },
    ])
  })

  it('is not recorded as passed before done() runs', () => {
    const rec = createTestRecorder({ doneTimeoutMs: 1000 })
    rec.test('pending', (done) => {
      setTimeout(() => done?.(), 5)
    })
    // Read before the drain: the slot must not be an optimistic PASS.
    expect(rec.results[0].passed).toBe(false)
  })

  it('ignores a second done() — the first call decides', async () => {
    const rec = createTestRecorder({ doneTimeoutMs: 1000 })
    rec.test('twice', (done) => {
      done?.()
      done?.(new Error('too late'))
    })
    await settle(rec)
    expect(rec.results).toEqual([{ name: 'twice', passed: true }])
  })

  it('accepts a non-Error value in done(err)', async () => {
    const rec = createTestRecorder({ doneTimeoutMs: 1000 })
    rec.test('string err', (done) => done?.('nope'))
    await settle(rec)
    expect(rec.results[0]).toEqual({ name: 'string err', passed: false, error: 'nope' })
  })

  it('fails an async function(done) whose promise rejects before done()', async () => {
    const rec = createTestRecorder({ doneTimeoutMs: 1000 })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rec.test('async rejects', async (done) => {
      await Promise.resolve()
      throw new Error('async boom')
    })
    await settle(rec)
    expect(rec.results[0]).toEqual({ name: 'async rejects', passed: false, error: 'async boom' })
  })

  it('routes a throw from a bound callback to the test that scheduled it', async () => {
    const rec = createTestRecorder({ doneTimeoutMs: 1000 })
    rec.test('via callback', (done) => {
      // What pm.sendRequest does with the user's callback.
      const cb = rec.bindCallback(() => {
        throw new Error('assertion inside the send callback')
        // eslint-disable-next-line no-unreachable
        done?.()
      })
      setTimeout(() => cb(), 5)
    })
    await settle(rec)
    expect(rec.results[0]).toEqual({
      name: 'via callback',
      passed: false,
      error: 'assertion inside the send callback',
    })
  })

  it('sandbox timers carry the owning test into nested timers', async () => {
    const rec = createTestRecorder({ doneTimeoutMs: 1000 })
    rec.test('nested', (done) => {
      rec.timers.setTimeout(() => {
        rec.timers.setTimeout(() => {
          throw new Error('deep failure')
        }, 1)
        void done
      }, 1)
    })
    await settle(rec)
    expect(rec.results[0]).toEqual({ name: 'nested', passed: false, error: 'deep failure' })
  })

  it('a timer throw that belongs to no test goes to onAsyncError, not the host', async () => {
    const seen: string[] = []
    const rec = createTestRecorder({
      onAsyncError: (e) => seen.push(e instanceof Error ? e.message : String(e)),
    })
    rec.timers.setTimeout(() => {
      throw new Error('loose')
    }, 1)
    await new Promise((r) => setTimeout(r, 20))
    expect(seen).toEqual(['loose'])
  })

  it('leaves the sync and promise forms unchanged', async () => {
    const rec = createTestRecorder()
    rec.test('sync ok', () => {})
    rec.test('sync fail', () => {
      throw new Error('x')
    })
    rec.test('promise fail', async () => {
      throw new Error('y')
    })
    // Optimistic slot for the promise form, exactly as before.
    expect(rec.results.map((r) => r.passed)).toEqual([true, false, true])
    await settle(rec)
    expect(rec.results).toEqual([
      { name: 'sync ok', passed: true },
      { name: 'sync fail', passed: false, error: 'x' },
      { name: 'promise fail', passed: false, error: 'y' },
    ])
  })
})

describe('pm.test.skip / pm.test.index (issue #281)', () => {
  it('records a skipped test without running it, and counts every registration', () => {
    const rec = createTestRecorder()
    let ran = false
    rec.test('a', () => {})
    rec.test.skip('b', () => {
      ran = true
    })
    rec.test('c', () => {})
    expect(ran).toBe(false)
    expect(rec.results[1]).toEqual({ name: 'b', passed: true, skipped: true })
    expect(rec.test.index()).toBe(3)
  })
})
