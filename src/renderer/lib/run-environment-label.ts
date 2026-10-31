import { runEnvironmentOf } from '../../shared/run-environment'

/**
 * The run environment as shown on every run surface (issue #307): the live
 * results header, All Runs rows and scheduled-task history rows. Main already
 * resolved legacy id rows; this only renders the shared encoding
 * (`src/shared/run-environment.ts`): name / "No environment" / '-' (unknown).
 */
export function displayRunEnvironment(value: unknown, t: (key: string) => string): string {
  const env = runEnvironmentOf(value)
  if (env.kind === 'named') return env.name
  if (env.kind === 'none') return t('runResults.noEnvironment')
  return '-'
}

/**
 * A scheduled TASK's environment (`scheduler:list` row, resolved in main):
 * current name / "No environment" when the task has none / "Deleted
 * environment" when the environment it names is gone. Never the raw id.
 */
export function displayTaskEnvironment(
  task: { environment_id: string | null; environment_name?: string | null },
  t: (key: string) => string,
): string {
  if (!task.environment_id) return t('runResults.noEnvironment')
  if (typeof task.environment_name === 'string' && task.environment_name) {
    return task.environment_name
  }
  return t('scheduledTasks.environmentDeleted')
}
