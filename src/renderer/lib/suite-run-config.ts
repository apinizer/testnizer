/**
 * Per-suite Runner run configuration — pure serialise / parse / apply helpers
 * (issue #100).
 *
 * The Runner's sequence selection (include/exclude + setup/flow/teardown
 * roles) and its run options (iterations, delays, stop-on-error, lifecycle
 * scripts, environment) used to live only in RunnerTab React state plus
 * tab-scoped sessionStorage, so closing the suite's tab discarded the whole
 * setup. The config is now saved SUITE-scoped: serialised by
 * `buildSuiteRunConfig`, stored via `testSuite:saveRunConfig` as one JSON blob
 * in `test_suites.run_config`, and restored on suite open through
 * `parseSuiteRunConfig` + `applyRunConfigToItems`.
 *
 * Everything here is pure TS so the load/apply logic is unit-testable without
 * mounting RunnerTab (tests/renderer/suite-run-config.test.ts).
 *
 * Deliberately NOT part of the config (see `SuiteRunConfig` docs in types):
 * sequence order (already suite-persistent via `test_suite_items.sort_order`)
 * and iteration data files (file-derived, potentially MB-scale).
 */
import type { SuiteRunConfig, SuiteRunConfigItem } from '../types'

type Phase = 'setup' | 'main' | 'teardown'

/** The minimal structural shape of a sequence row this module needs. */
export interface SequenceItemLike {
  id: string
  selected: boolean
  phase?: Phase
}

/** Run options half of the config — mirrors RunnerTab's option state. */
export interface SuiteRunOptions {
  delay: number
  iterationDelay: number
  iterations: number
  stopOnError: boolean
  persistResponses: boolean
  keepVariableValues: boolean
  environmentId: string
  runPreScript: string
  runPostScript: string
}

/**
 * Build the serialisable config from the runner tab's current state.
 * Flow items store no `phase` (omitted = 'main'), and blank optional strings
 * are omitted entirely so the stored blob stays minimal and diff-friendly.
 */
export function buildSuiteRunConfig(
  items: readonly SequenceItemLike[],
  options: SuiteRunOptions,
): SuiteRunConfig {
  const configItems: SuiteRunConfigItem[] = items.map((it) => {
    const entry: SuiteRunConfigItem = { id: it.id, selected: it.selected }
    if (it.phase && it.phase !== 'main') entry.phase = it.phase
    return entry
  })
  const config: SuiteRunConfig = {
    version: 1,
    items: configItems,
    delay: options.delay,
    iterationDelay: options.iterationDelay,
    iterations: options.iterations,
    stopOnError: options.stopOnError,
    persistResponses: options.persistResponses,
    keepVariableValues: options.keepVariableValues,
  }
  if (options.environmentId.trim()) config.environmentId = options.environmentId
  if (options.runPreScript.trim()) config.runPreScript = options.runPreScript
  if (options.runPostScript.trim()) config.runPostScript = options.runPostScript
  return config
}

const PHASES: readonly Phase[] = ['setup', 'main', 'teardown']

function sanitiseNumber(value: unknown, fallback: number, min: number): number {
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(n) || n < min) return fallback
  return n
}

function sanitiseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Parse a stored `run_config` blob into a `SuiteRunConfig`, tolerantly.
 *
 * A corrupt or unparseable blob must NEVER block opening the suite — the
 * caller falls back to defaults (all selected, RUNNER_DEFAULTS options), the
 * same state a suite without a saved config gets. Malformed item entries are
 * dropped individually; out-of-range numbers snap to the defaults.
 */
export function parseSuiteRunConfig(raw: string | null | undefined): SuiteRunConfig | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.items)) return null

  const items: SuiteRunConfigItem[] = []
  for (const entry of obj.items) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (typeof e.id !== 'string' || !e.id) continue
    const item: SuiteRunConfigItem = { id: e.id, selected: e.selected !== false }
    if (typeof e.phase === 'string' && PHASES.includes(e.phase as Phase) && e.phase !== 'main') {
      item.phase = e.phase as Phase
    }
    items.push(item)
  }

  const config: SuiteRunConfig = {
    version: 1,
    items,
    delay: sanitiseNumber(obj.delay, 0, 0),
    iterationDelay: sanitiseNumber(obj.iterationDelay, 0, 0),
    iterations: sanitiseNumber(obj.iterations, 1, 1),
    stopOnError: sanitiseBoolean(obj.stopOnError, true),
    persistResponses: sanitiseBoolean(obj.persistResponses, true),
    keepVariableValues: sanitiseBoolean(obj.keepVariableValues, true),
  }
  if (typeof obj.environmentId === 'string' && obj.environmentId) {
    config.environmentId = obj.environmentId
  }
  if (typeof obj.runPreScript === 'string' && obj.runPreScript) {
    config.runPreScript = obj.runPreScript
  }
  if (typeof obj.runPostScript === 'string' && obj.runPostScript) {
    config.runPostScript = obj.runPostScript
  }
  return config
}

/**
 * Apply a saved config's per-item state onto a freshly fetched sequence.
 *
 * Matching is by suite item id. Items the config does not know (added after
 * the save) keep their defaults; config entries whose item no longer exists
 * are ignored — deleting a request must not resurrect it or break the load.
 * Returns new objects; never mutates the input.
 */
export function applyRunConfigToItems<T extends SequenceItemLike>(
  items: readonly T[],
  config: SuiteRunConfig,
): T[] {
  const byId = new Map(config.items.map((c) => [c.id, c]))
  return items.map((it) => {
    const saved = byId.get(it.id)
    if (!saved) return { ...it }
    return { ...it, selected: saved.selected, phase: saved.phase }
  })
}
