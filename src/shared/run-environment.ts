/**
 * The environment a run used (issue #307) — ONE encoding for
 * `runner_history.environment_name`, `RunnerReport.environmentName`,
 * `runner:export`'s `environmentName` and every run surface that shows it.
 *
 *   non-empty string → the environment's NAME, snapshotted at run start (a
 *                      later rename / delete never rewrites it)
 *   ''               → the run used no environment
 *   null / undefined → unknown: a row written before issue #307 (it held an
 *                      environment id, or NULL even when the run fell back to
 *                      the active environment) whose environment is gone, or a
 *                      report from an older build
 *
 * Main resolves legacy id rows to the current name before any renderer sees
 * them (`src/main/lib/run-environment.ts`).
 */
export const NO_ENVIRONMENT = ''

export type RunEnvironment =
  | { kind: 'named'; name: string }
  | { kind: 'none' }
  | { kind: 'unknown' }

export function runEnvironmentOf(value: unknown): RunEnvironment {
  if (typeof value !== 'string') return { kind: 'unknown' }
  if (value === NO_ENVIRONMENT) return { kind: 'none' }
  return { kind: 'named', name: value }
}
