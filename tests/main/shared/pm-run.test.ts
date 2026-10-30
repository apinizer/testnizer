/**
 * Issue #267 — `pm.run`, the read-only run context of the run fail script.
 *
 * ── CONTRACT ───────────────────────────────────────────────────────────────
 *  `createPm` (src/shared/script/pm.ts) takes an OPTIONAL `run` backing and is
 *  the only place `pm.run` is built (Send≡Run: no host re-implements it):
 *
 *      CreatePmOptions.run?: PmRunBacking
 *      interface PmRunBacking {
 *        /** Snapshot of the finished run, taken by the host BEFORE the hook. *\/
 *        summary: {
 *          passed: number; failed: number; skipped: number; errors: number
 *          duration: number            // ms
 *          stopReason: string | null   // the run's RunStopReason, or null
 *        }
 *        exportJson(): string
 *        exportHtml(): string
 *      }
 *
 *  - `run` omitted → `pm.run` is `undefined` (`'run' in pm` is false) — the
 *    property exists only in the fail hook.
 *  - `pm.run.summary` has EXACTLY the keys above, is a frozen COPY (a later
 *    mutation of the host's object does not show through; a script write does
 *    not change it).
 *  - `pm.run.exportJson()` / `exportHtml()` call the host callbacks LAZILY (not
 *    at construction, once per call) and return their string unchanged — the
 *    shared module builds no report of its own.
 *  - `PmLike` (pm-types.ts) gains `run?: PmRunLike` with the same shape.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPm, type CreatePmOptions } from '../../../src/shared/script/pm'
import { HeaderCollection } from '../../../src/shared/script/headers'

type RunBacking = NonNullable<CreatePmOptions['run']>

function summary(over: Partial<RunBacking['summary']> = {}): RunBacking['summary'] {
  return { passed: 3, failed: 2, skipped: 1, errors: 1, duration: 1234, stopReason: null, ...over }
}

function makePm(run?: RunBacking) {
  return createPm({
    eventName: 'test',
    scopes: {
      globals: { values: new Map() },
      environment: { values: new Map() },
      locals: { values: new Map() },
    },
    request: { method: '', url: '', headers: new HeaderCollection() },
    response: null,
    send: async () => ({ status: 200, body: '{}' }),
    log: () => {},
    ...(run ? { run } : {}),
  }).pm as unknown as { run?: RunBacking }
}

describe('pm.run (issue #267)', () => {
  it('does not exist unless the host supplies it', () => {
    const pm = makePm()
    expect(pm.run).toBeUndefined()
    expect('run' in pm).toBe(false)
  })

  it('exposes exactly passed / failed / skipped / errors / duration / stopReason', () => {
    const pm = makePm({ summary: summary(), exportJson: () => '[]', exportHtml: () => '<html/>' })
    expect(Object.keys(pm.run!.summary).sort()).toEqual(
      ['duration', 'errors', 'failed', 'passed', 'skipped', 'stopReason'].sort(),
    )
    expect(pm.run!.summary).toEqual(summary())
  })

  it('carries a stop reason string through unchanged', () => {
    const pm = makePm({
      summary: summary({ stopReason: 'stopOnError' }),
      exportJson: () => '[]',
      exportHtml: () => '',
    })
    expect(pm.run!.summary.stopReason).toBe('stopOnError')
  })

  it('the summary is a frozen snapshot: neither the script nor the host can move it', () => {
    const live = summary()
    const pm = makePm({ summary: live, exportJson: () => '[]', exportHtml: () => '' })

    expect(Object.isFrozen(pm.run!.summary)).toBe(true)
    try {
      ;(pm.run!.summary as { failed: number }).failed = 99
    } catch {
      /* strict-mode scripts throw; sloppy ones are ignored — both fine */
    }
    expect(pm.run!.summary.failed).toBe(2)

    live.failed = 50
    expect(pm.run!.summary.failed).toBe(2)
  })

  it('export callbacks are lazy and their strings come back untouched', () => {
    const exportJson = vi.fn(() => '[{"a":1}]')
    const exportHtml = vi.fn(() => '<!DOCTYPE html><p>report</p>')
    const pm = makePm({ summary: summary(), exportJson, exportHtml })
    expect(exportJson).not.toHaveBeenCalled()
    expect(exportHtml).not.toHaveBeenCalled()

    expect(pm.run!.exportJson()).toBe('[{"a":1}]')
    expect(pm.run!.exportHtml()).toBe('<!DOCTYPE html><p>report</p>')
    expect(exportJson).toHaveBeenCalledTimes(1)
    expect(exportHtml).toHaveBeenCalledTimes(1)
  })

  it('a host export failure surfaces to the script (it is the script\'s to catch), not as a silent empty string', () => {
    const pm = makePm({
      summary: summary(),
      exportJson: () => {
        throw new Error('snapshot unavailable')
      },
      exportHtml: () => '',
    })
    expect(() => pm.run!.exportJson()).toThrow('snapshot unavailable')
  })
})
