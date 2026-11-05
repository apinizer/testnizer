/**
 * Pure logic of scripts/e2e-fault-drill.mjs. Nothing is spawned here: the
 * runner (git, npm run build, Playwright) is exercised by hand before an RC.
 */
import { describe, it, expect } from 'vitest'
import {
  applyFault,
  classifyFault,
  countStatuses,
  fileMatchesSpec,
  isLaunchError,
  parseArgs,
  parseReport,
  resolveSpec,
  validateFaults,
} from '../../scripts/e2e-fault-drill.mjs'

type T = { key: string; file: string; status: 'passed' | 'failed' | 'skipped'; error: string }
const SPEC = 'tests/e2e/ui/tur1/a.spec.ts'
const t = (name: string, status: T['status'], error = '', file = 'ui/tur1/a.spec.ts'): T => ({
  key: `${file} › ${name}`,
  file,
  status,
  error,
})
const run = (tests: T[], errors: string[] = []) => ({ tests, errors })
const classify = (baseline: T[], result: ReturnType<typeof run> | null, extra = {}) =>
  classifyFault({ specs: [SPEC], baseline: run(baseline), result, ...extra })

describe('applyFault', () => {
  const fault = { id: 'F1', file: 'x.ts', find: 'a < b', replace: 'a <= b' }

  it('replaces the single occurrence and nothing else', () => {
    expect(applyFault('if (a < b) {}\nreturn', fault)).toBe('if (a <= b) {}\nreturn')
  })

  it('refuses a find that is absent', () => {
    expect(() => applyFault('nothing here', fault)).toThrow(/0 times/)
  })

  it('refuses a find that occurs twice', () => {
    expect(() => applyFault('a < b; a < b', fault)).toThrow(/2 times/)
  })

  it('keeps "$&" in the replacement literal', () => {
    expect(applyFault('x = 1', { ...fault, find: 'x = 1', replace: "x = '$&'" })).toBe("x = '$&'")
  })

  it('allows deleting the matched text and refuses a no-op fault', () => {
    expect(applyFault('keep\ndrop\n', { ...fault, find: 'drop\n', replace: '' })).toBe('keep\n')
    expect(() => applyFault('a', { ...fault, find: 'a', replace: 'a' })).toThrow(/equals/)
  })
})

describe('classifyFault', () => {
  it('caught: a test that passed in baseline now fails', () => {
    const r = classify(
      [t('one', 'passed'), t('two', 'passed')],
      run([t('one', 'passed'), t('two', 'failed', '\u001b[31mexpected 200\u001b[39m\nreceived 500')]),
    )
    expect(r.status).toBe('caught')
    expect(r.caught).toEqual([{ test: 'ui/tur1/a.spec.ts › two', error: 'expected 200' }])
  })

  it('a test already red in baseline is not a catch', () => {
    const r = classify(
      [t('one', 'passed'), t('red', 'failed', 'boom')],
      run([t('one', 'passed'), t('red', 'failed', 'boom')]),
    )
    expect(r.status).toBe('missed')
    expect(r.caught).toEqual([])
  })

  it('missed: everything that passed still passes', () => {
    expect(classify([t('one', 'passed')], run([t('one', 'passed')])).status).toBe('missed')
  })

  it('crash: every baseline-passing test fails with a launch error', () => {
    const launch = 'electron.launch: firstWindow: Target page, context or browser has been closed'
    const r = classify(
      [t('one', 'passed'), t('two', 'passed')],
      run([t('one', 'failed', launch), t('two', 'failed', launch)]),
    )
    expect(r.status).toBe('crash')
    expect(r.caught).toEqual([])
  })

  it('all failing with a real assertion error is caught, not crash', () => {
    const r = classify(
      [t('one', 'passed'), t('two', 'passed')],
      run([t('one', 'failed', 'expected 1'), t('two', 'failed', 'expected 2')]),
    )
    expect(r.status).toBe('caught')
  })

  it('a mix of launch errors and assertion errors is caught', () => {
    const r = classify(
      [t('one', 'passed'), t('two', 'passed')],
      run([t('one', 'failed', 'expected 1'), t('two', 'failed', 'Target page, context or browser has been closed')]),
    )
    expect(r.status).toBe('caught')
  })

  it('an empty result is not caught', () => {
    expect(classify([t('one', 'passed')], run([])).status).toBe('no-result')
    expect(classify([t('one', 'passed')], null).status).toBe('no-result')
  })

  it('an empty result with a launch-type global error is a crash', () => {
    const r = classify([t('one', 'passed')], run([], ['Test servers exited (code 1)']))
    expect(r.status).toBe('crash')
  })

  it('skipped tests are not failures', () => {
    expect(classify([t('one', 'passed')], run([t('one', 'skipped')])).status).toBe('no-result')
  })

  it('no-baseline: nothing passed in the fault specs, so nothing can be caught', () => {
    expect(classify([t('one', 'failed', 'boom')], run([t('one', 'failed', 'boom')])).status).toBe('no-baseline')
    // a passing test in some OTHER file does not count
    const other = t('x', 'passed', '', 'ui/other.spec.ts')
    expect(classify([other], run([t('one', 'failed', 'boom')])).status).toBe('no-baseline')
  })

  it('build-failed and timeout win over the results', () => {
    const failing = run([t('one', 'failed', 'expected 1')])
    expect(classify([t('one', 'passed')], failing, { buildFailed: true }).status).toBe('build-failed')
    expect(classify([t('one', 'passed')], failing, { timedOut: true }).status).toBe('timeout')
  })
})

describe('parseReport', () => {
  const report = {
    errors: [{ message: 'global setup blew up' }],
    suites: [
      {
        title: 'ui/a.spec.ts',
        file: 'ui/a.spec.ts',
        specs: [{ title: 'top', file: 'ui/a.spec.ts', tests: [{ status: 'expected', results: [{ status: 'passed' }] }] }],
        suites: [
          {
            title: 'group',
            file: 'ui/a.spec.ts',
            specs: [
              {
                title: 'bad',
                file: 'ui/a.spec.ts',
                tests: [{ status: 'unexpected', results: [{ status: 'failed', errors: [{ message: '\u001b[31mnope\u001b[39m' }] }] }],
              },
              { title: 'later', file: 'ui/a.spec.ts', tests: [{ status: 'skipped', results: [{ status: 'skipped' }] }] },
            ],
          },
        ],
      },
    ],
  }

  it('flattens nested suites into keyed tests with a status and a clean error', () => {
    const { tests, errors } = parseReport(report)
    expect(tests.map((x: T) => [x.key, x.status])).toEqual([
      ['ui/a.spec.ts › top', 'passed'],
      ['ui/a.spec.ts › group › bad', 'failed'],
      ['ui/a.spec.ts › group › later', 'skipped'],
    ])
    expect(tests[1].error).toBe('nope')
    expect(errors).toEqual(['global setup blew up'])
  })

  it('handles a report with nothing in it', () => {
    expect(parseReport({})).toEqual({ tests: [], errors: [] })
  })
})

describe('helpers', () => {
  it('resolves spec entries written repo-relative or relative to tests/e2e/ui', () => {
    const files = new Set(['tests/e2e/ui/a.spec.ts', 'tests/e2e/ui/tur1/b.spec.ts'])
    const has = (p: string) => files.has(p)
    expect(resolveSpec('tests/e2e/ui/a.spec.ts', has)).toBe('tests/e2e/ui/a.spec.ts')
    expect(resolveSpec('tur1/b.spec.ts', has)).toBe('tests/e2e/ui/tur1/b.spec.ts')
    expect(resolveSpec('./a.spec.ts', has)).toBe('tests/e2e/ui/a.spec.ts')
    expect(resolveSpec('gone.spec.ts', has)).toBeNull()
  })

  it('matches Playwright rootDir-relative files to a repo path by suffix, not by substring', () => {
    expect(fileMatchesSpec('ui/tur1/a.spec.ts', SPEC)).toBe(true)
    expect(fileMatchesSpec('tur1/a.spec.ts', SPEC)).toBe(true)
    expect(fileMatchesSpec('a.spec.ts', 'tests/e2e/ui/tur1/xa.spec.ts')).toBe(false)
  })

  it('recognises launch-type errors', () => {
    expect(isLaunchError('electron.launch: Process failed to launch!')).toBe(true)
    expect(isLaunchError('better-sqlite3 is built for "node:127", not Electron')).toBe(true)
    expect(isLaunchError('expect(received).toBe(expected)')).toBe(false)
  })

  it('counts every status, including ones with no record', () => {
    const c = countStatuses([{ status: 'caught' }, { status: 'caught' }, { status: 'crash' }])
    expect(c).toMatchObject({ caught: 2, crash: 1, missed: 0, timeout: 0 })
  })

  it('validates fault entries (an empty replace is a deletion, not an error)', () => {
    const ok = { id: 'F1', file: 'a', find: 'x', replace: '', specs: ['s'] }
    expect(validateFaults([ok])).toHaveLength(1)
    expect(() => validateFaults([{ ...ok, specs: [] }])).toThrow(/specs/)
    expect(() => validateFaults([{ ...ok, find: '' }])).toThrow(/find/)
    expect(() => validateFaults([ok, ok])).toThrow(/duplicate/)
  })

  it('parses arguments and rejects unknown ones', () => {
    expect(parseArgs(['--check'])).toMatchObject({ check: true, timeoutMin: 25 })
    expect(parseArgs(['--only', 'F01, F02', '--timeout-min', '5', '--report', 'r.json'])).toMatchObject({
      only: ['F01', 'F02'],
      timeoutMin: 5,
      report: 'r.json',
    })
    expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/)
    expect(() => parseArgs(['--only'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--timeout-min', '0'])).toThrow(/positive/)
  })
})
