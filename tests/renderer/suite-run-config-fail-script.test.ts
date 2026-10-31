/**
 * Issue #267 — `runFailScript` rides the per-suite run configuration like
 * `runPreScript` / `runPostScript` (issue #100).
 *
 * ── CONTRACT ───────────────────────────────────────────────────────────────
 *  - `SuiteRunConfig.runFailScript?: string` (src/renderer/types/index.ts) and
 *    `RunnerExecuteOptions.runFailScript?: string` (src/shared/runner-types.ts).
 *  - `SuiteRunOptions.runFailScript?: string` (OPTIONAL and read defensively:
 *    callers/tests written before the field existed pass options without it).
 *  - `buildSuiteRunConfig` stores it only when non-blank (blank/whitespace →
 *    key omitted, same rule as the other two scripts).
 *  - `parseSuiteRunConfig` restores a non-empty string; a non-string is dropped;
 *    a config saved by an older build (no key) parses with it undefined.
 *  - The blob is stored verbatim in `test_suites.run_config`, so it travels with
 *    the project export / git exactly like the other two scripts. (Authors of a
 *    mail/webhook hook should reference `{{secretVar}}`, not paste a key — same
 *    advice as request auth.)
 */
import { describe, it, expect } from 'vitest'
import {
  buildSuiteRunConfig,
  parseSuiteRunConfig,
} from '../../src/renderer/lib/suite-run-config'

const OPTIONS = {
  delay: 0,
  iterationDelay: 0,
  iterations: 1,
  stopOnError: true,
  persistResponses: true,
  keepVariableValues: true,
  environmentId: '',
  runPreScript: 'pm.environment.set("a", "1")',
  runPostScript: 'console.log("done")',
  runFailScript: 'await pm.sendRequest("https://hooks.test/alert")',
}

describe('suite run config — runFailScript (issue #267)', () => {
  it('round-trips beside the other run scripts', () => {
    const config = buildSuiteRunConfig([{ id: 'a', selected: true }], OPTIONS)
    expect(config.runFailScript).toBe(OPTIONS.runFailScript)
    const parsed = parseSuiteRunConfig(JSON.stringify(config))
    expect(parsed).toEqual(config)
    expect(parsed!.runFailScript).toBe(OPTIONS.runFailScript)
    expect(parsed!.runPreScript).toBe(OPTIONS.runPreScript)
    expect(parsed!.runPostScript).toBe(OPTIONS.runPostScript)
  })

  it('omits a blank or whitespace script instead of storing an empty string', () => {
    expect(
      buildSuiteRunConfig([], { ...OPTIONS, runFailScript: '' }).runFailScript,
    ).toBeUndefined()
    expect(
      buildSuiteRunConfig([], { ...OPTIONS, runFailScript: '  \n ' }).runFailScript,
    ).toBeUndefined()
    const json = JSON.stringify(buildSuiteRunConfig([], { ...OPTIONS, runFailScript: '' }))
    expect(json).not.toContain('runFailScript')
  })

  it('options written before the field existed still build (field undefined)', () => {
    const { runFailScript: _omitted, ...legacy } = OPTIONS
    expect(() => buildSuiteRunConfig([], legacy)).not.toThrow()
    expect(buildSuiteRunConfig([], legacy).runFailScript).toBeUndefined()
  })

  it('a config saved by an older build parses with no fail script', () => {
    const old = JSON.stringify({ version: 1, items: [], runPreScript: 'x' })
    const parsed = parseSuiteRunConfig(old)
    expect(parsed).not.toBeNull()
    expect(parsed!.runFailScript).toBeUndefined()
    expect(parsed!.runPreScript).toBe('x')
  })

  it.each([42, true, null, { a: 1 }, ''])('drops a non-usable stored value %j', (bad) => {
    const parsed = parseSuiteRunConfig(JSON.stringify({ version: 1, items: [], runFailScript: bad }))
    expect(parsed!.runFailScript).toBeUndefined()
  })
})
