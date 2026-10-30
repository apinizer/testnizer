import type { RunOrigin } from './reveal-run-result'

/**
 * The run "source" label as shown to the user.
 *
 * The Runner stores the label in English (`Runner`, `Suite: <name>`,
 * `APIs: <name>`) — it is written to `runner_history.source_label` and must
 * stay stable, so only the prefix is translated, at display time. Anything
 * else (a scheduled task name, a label from an older build) is shown as is.
 */
export function displayRunSourceLabel(label: string, t: (key: string) => string): string {
  if (label === 'Runner') return t('runResults.sourceRunner')
  if (label.startsWith('Suite: ')) return `${t('runResults.sourceSuite')}: ${label.slice(7)}`
  if (label.startsWith('APIs: ')) return `${t('runResults.sourceApis')}: ${label.slice(6)}`
  return label
}

/**
 * Where a stored run started, read back from its source label (issue #302):
 * `Suite: …` rows carry `test_suite_items` ids, `APIs: …` and `Runner` rows
 * endpoint ids. All Runs and the Tests overview open a past run through this,
 * so its reveal / open actions route to the sidebar its ids live in instead of
 * the one the Runner tab happens to be scoped to.
 *
 * A scheduled run (`Scheduled: <task>`) names its task, not its scope: the
 * label alone reads as `runner`; `historyRunOrigin` resolves it via the task.
 */
export function runOriginFromSourceLabel(label: string | null | undefined): RunOrigin {
  if (label?.startsWith('Suite: ')) return 'suite'
  if (label?.startsWith('APIs: ')) return 'apis'
  return 'runner'
}

/**
 * A `runner_history` row's origin. Scheduled runs (`Scheduled: <task>`) are
 * resolved through their task: `scheduled_task_id` → a task that runs a suite
 * (`suiteTaskIds`, the ids of `scheduler:list` rows with a `suite_id`). A task
 * that runs APIs endpoints, or one deleted since, falls back to the label.
 */
export function historyRunOrigin(
  run: { source_label: string | null; scheduled_task_id?: string | null },
  suiteTaskIds: ReadonlySet<string>,
): RunOrigin {
  if (run.scheduled_task_id && suiteTaskIds.has(run.scheduled_task_id)) return 'suite'
  return runOriginFromSourceLabel(run.source_label)
}

/** Ids of the scheduled tasks that run a test suite, from a `scheduler:list` answer. */
export function suiteTaskIdsOf(tasks: unknown): Set<string> {
  const ids = new Set<string>()
  if (!Array.isArray(tasks)) return ids
  for (const t of tasks as Array<{ id?: unknown; suite_id?: unknown }>) {
    if (typeof t?.id === 'string' && typeof t.suite_id === 'string' && t.suite_id) ids.add(t.id)
  }
  return ids
}

/** A stored / payload origin value, or null when it is not one. */
export function asRunOrigin(v: unknown): RunOrigin | null {
  return v === 'suite' || v === 'apis' || v === 'runner' ? v : null
}
