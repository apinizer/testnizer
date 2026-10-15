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

export interface GitCommitOutcome {
  /** False when the DB held nothing new — not an error. */
  committed: boolean
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
