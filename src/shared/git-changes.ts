/**
 * Local git changes of a project (issue #207) — the contract between
 * `git:changes` / `git:commit` / `git:discard` (main) and the renderer's
 * Commit panel and branch menu.
 *
 * A project lives in ONE tracked file, so a "change" is a ROW of that file:
 * what a commit would write (the DB, exported and stripped of secrets) against
 * the file at HEAD, compared row by row with the same normalisation the
 * switch / merge no-op check uses.
 */

/** One kind per exported collection; `project` = name / display name / description. */
export type GitChangeKind =
  | 'project'
  | 'folder'
  | 'endpoint'
  | 'endpointCase'
  | 'savedRequest'
  | 'savedResponse'
  | 'environment'
  | 'variable'
  | 'globalVariable'
  | 'testSuite'
  | 'testSuiteFolder'
  | 'testSuiteItem'
  | 'mockServer'
  | 'mockEndpoint'
  | 'mockResponse'
  | 'mockMcpServer'
  | 'certificate'

export type GitChangeType = 'added' | 'modified' | 'deleted'

export interface GitChangeItem {
  kind: GitChangeKind
  /** Row id (the project id for `kind: 'project'`). */
  id: string
  /** Human name: request / folder name, `Env › key`, `GET /path`, host… */
  name: string
  change: GitChangeType
  /**
   * Keys (`gitChangeKey`) of the changes this one cannot be committed without
   * (issue #214): an added request needs its added folder; deleting a folder
   * needs the deletion / move of the rows that sit in it. Absent = none.
   */
  requires?: string[]
}

/** Stable key of a change: kind + row id. */
export function gitChangeKey(item: Pick<GitChangeItem, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`
}

/**
 * `keys` plus everything they require, transitively (issue #214). Unknown
 * keys are dropped. Main runs this on whatever the renderer sends — the
 * renderer's own selection is never trusted to be closed.
 */
export function withRequiredChanges(keys: Iterable<string>, items: GitChangeItem[]): Set<string> {
  const byKey = new Map(items.map((i) => [gitChangeKey(i), i]))
  const out = new Set<string>()
  const stack = [...keys].filter((k) => byKey.has(k))
  while (stack.length > 0) {
    const k = stack.pop() as string
    if (out.has(k)) continue
    out.add(k)
    for (const r of byKey.get(k)?.requires ?? []) if (byKey.has(r) && !out.has(r)) stack.push(r)
  }
  return out
}

/** `keys` plus every change that requires one of them, transitively (unchecking). */
export function withDependentChanges(keys: Iterable<string>, items: GitChangeItem[]): Set<string> {
  const dependents = new Map<string, string[]>()
  for (const i of items) {
    for (const r of i.requires ?? []) {
      const list = dependents.get(r) ?? []
      list.push(gitChangeKey(i))
      dependents.set(r, list)
    }
  }
  const out = new Set<string>()
  const stack = [...keys]
  while (stack.length > 0) {
    const k = stack.pop() as string
    if (out.has(k)) continue
    out.add(k)
    for (const d of dependents.get(k) ?? []) if (!out.has(d)) stack.push(d)
  }
  return out
}

export interface GitChangesSummary {
  items: GitChangeItem[]
  /** Local commits `origin/<branch>` does not have (local refs only, no fetch). */
  ahead: number
  /** Commits `origin/<branch>` has that HEAD does not (as of the last fetch). */
  behind: number
  branch: string
  /** False when there is no `origin/<branch>` tracking ref (never pushed / fetched). */
  hasUpstream: boolean
}

/**
 * `git:commit` options (issue #214). `only` = the keys of the changes to
 * commit; main adds what they require. Omitted / covering every change =
 * commit everything (the #207 behaviour).
 */
export interface GitCommitOpts {
  only?: string[]
}

/** `git:push` options (issues #136, #214). */
export interface GitPushOpts {
  /** Blank / omitted → automatic "Update <name> — <date>". */
  commitMessage?: string
  /**
   * false = push the existing commits only; uncommitted changes stay
   * uncommitted. Default true: commit them first (the #136 behaviour).
   */
  commitPending?: boolean
  /** With `commitPending`: commit only these changes (see `GitCommitOpts`). */
  only?: string[]
}

export interface GitCommitOutcome {
  /** False when the DB held nothing new — not an error. */
  committed: boolean
  /** True when some changes were left uncommitted (a selective commit). */
  partial?: boolean
  /** How many changes went into the commit (selected + required). */
  included?: number
  /** HEAD after the call; empty when the branch still has no commit. */
  sha: string
  branch: string
}

export interface GitDiscardOutcome {
  discarded: boolean
  /** The project file restored from HEAD. */
  file: string
}

/** Display order of the groups in the Commit panel. */
export const GIT_CHANGE_KIND_ORDER: readonly GitChangeKind[] = [
  'project',
  'folder',
  'endpoint',
  'endpointCase',
  'savedRequest',
  'savedResponse',
  'environment',
  'variable',
  'globalVariable',
  'testSuite',
  'testSuiteFolder',
  'testSuiteItem',
  'mockServer',
  'mockEndpoint',
  'mockResponse',
  'mockMcpServer',
  'certificate',
]

/**
 * Errors `git:commit` / `git:discard` return verbatim. Main has no i18n; the
 * renderer matches these strings to show its own translated text.
 */
export const GIT_MERGE_IN_PROGRESS_ERROR =
  'A merge is in progress. Resolve or abort it from the branch menu first.'
export const GIT_NOTHING_COMMITTED_ERROR =
  'Nothing has been committed for this project yet, so there is nothing to restore.'
