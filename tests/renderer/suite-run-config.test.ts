/**
 * Issue #100 — pure helpers behind the per-suite Runner config persistence:
 * `parseSuiteRunConfig` (tolerant JSON → SuiteRunConfig), `buildSuiteRunConfig`
 * (RunnerTab state → serialisable config), and `applyRunConfigToItems`
 * (config → sequence items, unknown ids ignored, new items keep defaults).
 *
 * These are the renderer's load/apply logic; RunnerTab only wires them to the
 * `testSuite:getRunConfig` / `saveRunConfig` IPC pair.
 */
import { describe, it, expect } from 'vitest'
import {
  parseSuiteRunConfig,
  buildSuiteRunConfig,
  applyRunConfigToItems,
} from '../../src/renderer/lib/suite-run-config'
import type { SuiteRunConfig } from '../../src/renderer/types'

const OPTIONS = {
  delay: 250,
  iterationDelay: 1000,
  iterations: 3,
  stopOnError: false,
  persistResponses: true,
  keepVariableValues: false,
  environmentId: 'env-9',
  runPreScript: 'pm.environment.set("a", "1")',
  runPostScript: 'console.log("done")',
}

type SeqItem = { id: string; selected: boolean; phase?: 'setup' | 'main' | 'teardown'; name?: string }

const ITEMS: SeqItem[] = [
  { id: 'a', selected: true, phase: 'setup', name: 'Login' },
  { id: 'b', selected: false, name: 'Broken one' },
  { id: 'c', selected: true, phase: 'teardown', name: 'Cleanup' },
]

describe('buildSuiteRunConfig → parseSuiteRunConfig round-trip', () => {
  it('serialises items + options and parses back identically', () => {
    const config = buildSuiteRunConfig(ITEMS, OPTIONS)
    const parsed = parseSuiteRunConfig(JSON.stringify(config))
    expect(parsed).not.toBeNull()
    expect(parsed).toEqual(config)
    expect(parsed!.version).toBe(1)
    expect(parsed!.items).toEqual([
      { id: 'a', selected: true, phase: 'setup' },
      { id: 'b', selected: false },
      { id: 'c', selected: true, phase: 'teardown' },
    ])
    expect(parsed!.iterations).toBe(3)
    expect(parsed!.stopOnError).toBe(false)
    expect(parsed!.runPreScript).toBe(OPTIONS.runPreScript)
  })

  it('omits empty optional fields rather than storing empty strings', () => {
    const config = buildSuiteRunConfig(ITEMS, {
      ...OPTIONS,
      environmentId: '',
      runPreScript: '',
      runPostScript: '   ',
    })
    expect(config.environmentId).toBeUndefined()
    expect(config.runPreScript).toBeUndefined()
    expect(config.runPostScript).toBeUndefined()
  })

  it('does not store a phase for flow ("main") items — omitted means main', () => {
    const config = buildSuiteRunConfig([{ id: 'x', selected: true, phase: 'main' }], OPTIONS)
    expect(config.items[0].phase).toBeUndefined()
  })
})

describe('parseSuiteRunConfig — tolerant loading', () => {
  it.each([null, undefined, '', 'not-json', '42', '"str"', '[]'])(
    'returns null for unusable input %s',
    (raw) => {
      expect(parseSuiteRunConfig(raw as string | null | undefined)).toBeNull()
    },
  )

  it('returns null when items is missing or not an array', () => {
    expect(parseSuiteRunConfig(JSON.stringify({ version: 1 }))).toBeNull()
    expect(parseSuiteRunConfig(JSON.stringify({ version: 1, items: 'x' }))).toBeNull()
  })

  it('drops malformed item entries but keeps the valid ones', () => {
    const raw = JSON.stringify({
      version: 1,
      items: [
        { id: 'ok', selected: true },
        { id: 42, selected: true }, // bad id
        'garbage',
        { id: 'ok2', selected: false, phase: 'bogus-phase' }, // bad phase → stripped
      ],
      delay: 5,
    })
    const parsed = parseSuiteRunConfig(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.items).toEqual([
      { id: 'ok', selected: true },
      { id: 'ok2', selected: false },
    ])
  })

  it('fills sane defaults for missing numeric/boolean options', () => {
    const parsed = parseSuiteRunConfig(JSON.stringify({ version: 1, items: [] }))
    expect(parsed).not.toBeNull()
    expect(parsed!.delay).toBe(0)
    expect(parsed!.iterationDelay).toBe(0)
    expect(parsed!.iterations).toBe(1)
    expect(parsed!.stopOnError).toBe(true)
    expect(parsed!.persistResponses).toBe(true)
    expect(parsed!.keepVariableValues).toBe(true)
  })

  it('sanitises out-of-range numbers instead of trusting the blob', () => {
    const parsed = parseSuiteRunConfig(
      JSON.stringify({ version: 1, items: [], iterations: -3, delay: 'NaN', iterationDelay: -1 }),
    )
    expect(parsed!.iterations).toBe(1)
    expect(parsed!.delay).toBe(0)
    expect(parsed!.iterationDelay).toBe(0)
  })
})

describe('applyRunConfigToItems', () => {
  const config: SuiteRunConfig = {
    version: 1,
    items: [
      { id: 'a', selected: false },
      { id: 'c', selected: true, phase: 'setup' },
      { id: 'ghost', selected: false, phase: 'teardown' }, // deleted since the save
    ],
    delay: 0,
    iterationDelay: 0,
    iterations: 1,
    stopOnError: true,
    persistResponses: true,
    keepVariableValues: true,
  }

  it('applies selected + phase by id and leaves unknown-to-config items on defaults', () => {
    const fresh: SeqItem[] = [
      { id: 'a', selected: true, name: 'Login' },
      { id: 'b', selected: true, name: 'New since save' },
      { id: 'c', selected: true, name: 'Cleanup' },
    ]
    const applied = applyRunConfigToItems(fresh, config)
    expect(applied).toEqual([
      { id: 'a', selected: false, phase: undefined, name: 'Login' },
      { id: 'b', selected: true, name: 'New since save' },
      { id: 'c', selected: true, phase: 'setup', name: 'Cleanup' },
    ])
  })

  it('ignores config entries whose item no longer exists', () => {
    const applied = applyRunConfigToItems([{ id: 'a', selected: true }], config)
    expect(applied.map((i) => i.id)).toEqual(['a'])
  })

  it('does not mutate the input array', () => {
    const fresh: SeqItem[] = [{ id: 'a', selected: true }]
    applyRunConfigToItems(fresh, config)
    expect(fresh[0].selected).toBe(true)
  })
})
