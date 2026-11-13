import type { EndpointRunResult } from '../../shared/runner-types'

/**
 * A run result row and the key that identifies it within its run.
 *
 * `endpointId` is NOT a row identity: every iteration of a request shares it,
 * and so do a setup / teardown row for the same request and the second visit
 * of a `setNextRequest` loop. Selecting by it lit up every iteration's row and
 * opened the first run whatever row was clicked (tester finding 12).
 */
export interface KeyedRunResult {
  key: string
  result: EndpointRunResult
}

/**
 * The one place a results row gets its key: phase + iteration + request +
 * occurrence (how many earlier rows of the run had the same three).
 *
 * Derived from the list, not stored on the row, so a history entry written
 * before this existed opens the same way. Computed over the WHOLE run, never
 * the filtered list, so narrowing the list cannot move the selection to
 * another row.
 *
 * Stable when the live list is swapped for the final report: main appends rows
 * in order, and the only rows the report adds (NOT_RUN for steps a stop never
 * reached) come after every row that ran, so no executed row's occurrence
 * changes.
 */
export function keyRunResults(results: readonly EndpointRunResult[]): KeyedRunResult[] {
  const seen = new Map<string, number>()
  return results.map((result) => {
    // Older history rows carry neither field: they read as 'main', iteration 1
    // — the same defaults the iteration grouping uses.
    const phase = result.phase ?? 'main'
    const iteration = result.iteration && result.iteration > 0 ? result.iteration : 1
    const base = `${phase}:${iteration}:${result.endpointId}`
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    return { key: `${base}#${occurrence}`, result }
  })
}
