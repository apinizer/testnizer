import type { EndpointRunResult } from '../../shared/runner-types'
import { endpointDidPass, isSkippedStep } from '../../shared/runner-verdict'

/** The outcome tabs above the results list. */
export type RunResultTab = 'all' | 'passed' | 'failed' | 'skipped' | 'errors' | 'console'

export interface RunResultFilter {
  /** Outcome tab. */
  tab: RunResultTab
  /** Free text, matched against request name, folder and URL. */
  text: string
  /** HTTP methods to keep. Empty means "every method" (issue #114). */
  methods: string[]
}

export const EMPTY_RUN_RESULT_FILTER: RunResultFilter = { tab: 'all', text: '', methods: [] }

/** True when any narrowing beyond the plain "All" tab is in effect. */
export function isRunResultFilterActive(f: RunResultFilter): boolean {
  return f.tab !== 'all' || f.text.trim() !== '' || f.methods.length > 0
}

/**
 * Outcome tab predicate.
 *
 * A skipped row belongs under exactly one tab — its own. Without the guard it
 * would also show under "Passed", because `endpointDidPass` reads its absent
 * status as a success.
 */
function matchesTab(r: EndpointRunResult, tab: RunResultTab): boolean {
  switch (tab) {
    case 'passed':
      return !isSkippedStep(r) && endpointDidPass(r)
    case 'failed':
      return !isSkippedStep(r) && !endpointDidPass(r)
    case 'errors':
      return !!r.error
    case 'skipped':
      return isSkippedStep(r)
    case 'console':
      return (r.consoleLogs?.length ?? 0) > 0
    default:
      return true
  }
}

/**
 * Text predicate: request name, folder name and URL.
 *
 * The URL is included because a large run often repeats one name across
 * folders and the path is the only thing that tells two rows apart. Matching
 * is case-insensitive and the query is trimmed, so a stray trailing space
 * from a paste doesn't silently empty the list.
 */
function matchesText(r: EndpointRunResult, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    r.endpointName.toLowerCase().includes(q) ||
    (r.folderName ?? '').toLowerCase().includes(q) ||
    (r.url ?? '').toLowerCase().includes(q)
  )
}

/**
 * Method predicate. An empty selection means no method narrowing at all —
 * NOT "nothing matches", which would make clearing the last chip look like a
 * broken list.
 */
function matchesMethod(r: EndpointRunResult, methods: string[]): boolean {
  if (methods.length === 0) return true
  return methods.includes((r.method ?? '').toUpperCase())
}

/** All three predicates compose — the tabs, the search box and the chips. */
export function matchesRunResultFilter(r: EndpointRunResult, f: RunResultFilter): boolean {
  return matchesTab(r, f.tab) && matchesText(r, f.text) && matchesMethod(r, f.methods)
}

export function filterRunResults(
  results: EndpointRunResult[],
  f: RunResultFilter,
): EndpointRunResult[] {
  return results.filter((r) => matchesRunResultFilter(r, f))
}

/**
 * Methods actually present in a run, for the chip list.
 *
 * Derived rather than a fixed GET/POST/… list so a run never offers a chip
 * that can only ever produce an empty list, and so protocol runs (SOAP, gRPC)
 * show whatever verb they really carry. Ordered by the usual REST reading
 * order first, then anything else alphabetically.
 */
const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export function runResultMethods(results: EndpointRunResult[]): string[] {
  const seen = new Set<string>()
  for (const r of results) {
    const m = (r.method ?? '').trim().toUpperCase()
    if (m) seen.add(m)
  }
  return Array.from(seen).sort((a, b) => {
    const ia = METHOD_ORDER.indexOf(a)
    const ib = METHOD_ORDER.indexOf(b)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b)
  })
}
