/**
 * Git / branch IPC failures the renderer words in the UI language (tester
 * finding 6: an English UI showed "Git yapılandırması bulunamadı.").
 *
 * Main returns the English sentence in `error` (logs, old consumers) plus a
 * stable `errorCode`; the renderer translates the code with
 * `lib/git-error-text.ts`. `errorDetail` fills `{detail}` (git's own line,
 * shown as-is), `errorParams` fill any other `{name}`. A failure that wraps
 * another coded failure (pull / merge succeeded, the import then failed on
 * `GIT_PROJECT_FILE_AMBIGUOUS`) also carries it as `errorCause`, so the
 * renderer words the inner sentence too; `errorDetail` stays its English
 * text. A failure without a code (raw simple-git stderr) is shown as main
 * wrote it.
 *
 * A failure deep inside a helper is thrown as a {@link GitCodedError}, so the
 * code travels with it to the handler's catch: nothing downstream ever
 * matches on the wording of our own sentences.
 */
import { fillTemplate } from './fill-template'

export const GIT_ERROR_TEXT = {
  GIT_CONFIG_MISSING: 'Git configuration not found.',
  GIT_CONFIG_MISSING_SETTINGS:
    'Git configuration not found. Enter the Git details in the project settings.',
  GIT_ACTIVE_BRANCH_DELETE: 'The active branch cannot be deleted. Switch to another branch first.',
  GIT_MERGE_IMPORT_FAILED: 'Merge succeeded but importing the merged state failed: {detail}',
  GIT_PULL_IMPORT_FAILED: 'Pull succeeded but importing the new state failed: {detail}',
  GIT_REMOTE_EMPTY: 'The Git repository is empty: nothing has been pushed yet.',
  GIT_PROJECT_FILE_MISSING: 'No project file found in the Git repository.',
  GIT_PROJECT_FILE_AMBIGUOUS:
    "The repository holds several project files ({files}) and none matches this project's name ({name}). Rename the project to match a file, or remove the extra files.",
  GIT_TOKEN_MISSING:
    'Git token not found or could not be decrypted. Re-enter the Personal Access Token in Project Settings → Storage.',
  GIT_SSH_URL:
    'The Git remote must be an HTTPS URL (https://…). SSH addresses (git@host:…) cannot be used with a Personal Access Token.',
  GIT_AUTH_FAILED:
    'Git authentication failed (401/403). Check the username and the Personal Access Token. ({detail})',
  GIT_PUSH_REJECTED:
    'The remote is ahead of your local copy (non-fast-forward). Pull first, then try Push again.',
  GIT_PUSH_TRANSIENT:
    'The remote server returned a temporary error (HTTP 5xx) and the push failed after several attempts. Your changes are not lost; only sending them to the remote failed. Try Push again shortly — no new (duplicate) commit is created. ({detail})',
  GIT_REMOTE_TRANSIENT:
    'The remote server returned a temporary error (HTTP 5xx). Try again shortly. ({detail})',
  GIT_REMOTE_UNREACHABLE: 'Could not reach the remote repository: {detail}',
  GIT_FOREIGN_REPO:
    '{path} is already a git repository connected to another remote ({remote}). In Project Settings → Storage, pick an empty folder or one that belongs to this repository.',
  BRANCH_NOT_FOUND: 'Branch not found',
  BRANCH_DEFAULT_UNDELETABLE: 'Cannot delete default branch',
} as const

export type GitErrorCode = keyof typeof GIT_ERROR_TEXT

/** Values for the `{name}` placeholders other than `{detail}`. */
export type GitErrorParams = Readonly<Record<string, string>>

/** The coded failure a wrapping failure was caused by (one level deep). */
export interface GitErrorCause {
  code: GitErrorCode
  detail?: string
  params?: GitErrorParams
}

/** The fields a failed git result carries (spread into `{ success: false, … }`). */
export interface GitFailure {
  error: string
  errorCode?: GitErrorCode
  errorDetail?: string
  errorParams?: GitErrorParams
  errorCause?: GitErrorCause
}

export interface GitErrorResult extends GitFailure {
  success: false
  errorCode: GitErrorCode
}

/** Fill `{detail}` and the named placeholders of a template (EN here, any locale in the renderer). */
export function fillGitErrorText(
  template: string,
  detail: string | undefined,
  params: GitErrorParams | undefined,
): string {
  return fillTemplate(template, detail === undefined ? { ...params } : { ...params, detail })
}

/** The English sentence of a cause. */
export function gitCauseText(cause: GitErrorCause): string {
  return fillGitErrorText(GIT_ERROR_TEXT[cause.code], cause.detail, cause.params)
}

/** The coded failure fields for `code`, English text filled. */
export function gitFailure(
  code: GitErrorCode,
  detail?: string,
  params?: GitErrorParams,
  cause?: GitErrorCause,
): GitFailure & { errorCode: GitErrorCode } {
  const out: GitFailure & { errorCode: GitErrorCode } = {
    error: fillGitErrorText(GIT_ERROR_TEXT[code], detail, params),
    errorCode: code,
  }
  if (detail !== undefined) out.errorDetail = detail
  if (params !== undefined) out.errorParams = params
  if (cause !== undefined) out.errorCause = cause
  return out
}

/** The failure envelope for `code`. */
export function gitErrorResult(
  code: GitErrorCode,
  detail?: string,
  params?: GitErrorParams,
): GitErrorResult {
  return { success: false, ...gitFailure(code, detail, params) }
}

/** A failure thrown from a helper: its message is the English text, the code rides along. */
export class GitCodedError extends Error {
  readonly code: GitErrorCode
  readonly detail?: string
  readonly params?: GitErrorParams
  /** The coded failure this one wraps (not `cause`: that is the raw Error, for logs). */
  readonly inner?: GitErrorCause

  constructor(
    code: GitErrorCode,
    opts: { detail?: string; params?: GitErrorParams; inner?: GitErrorCause; cause?: unknown } = {},
  ) {
    super(
      fillGitErrorText(GIT_ERROR_TEXT[code], opts.detail, opts.params),
      opts.cause === undefined ? undefined : { cause: opts.cause },
    )
    this.name = 'GitCodedError'
    this.code = code
    this.detail = opts.detail
    this.params = opts.params
    this.inner = opts.inner
  }
}

/**
 * A caught error as failure fields: a {@link GitCodedError} keeps its code,
 * anything else is its message as-is (no classification — that is
 * `describeGitFailure`'s job, in `main/lib/git-config.ts`).
 */
export function gitFailureOf(e: unknown): GitFailure {
  if (e instanceof GitCodedError) return gitFailure(e.code, e.detail, e.params, e.inner)
  return { error: e instanceof Error ? e.message : String(e) }
}

/**
 * `code` wrapping a caught error (pull / merge "succeeded but importing …
 * failed: {detail}"). A coded inner error becomes `errorCause` (its code and
 * values, so the renderer can word it) and its English text the detail; any
 * other error is its message as the detail, as before.
 */
export function wrappedGitFailure(
  code: GitErrorCode,
  inner: unknown,
): GitFailure & { errorCode: GitErrorCode } {
  if (inner instanceof GitCodedError) {
    const cause: GitErrorCause = { code: inner.code }
    if (inner.detail !== undefined) cause.detail = inner.detail
    if (inner.params !== undefined) cause.params = inner.params
    return gitFailure(code, gitCauseText(cause), undefined, cause)
  }
  return gitFailure(code, gitFailureOf(inner).error)
}

/**
 * Every free-text value of a failure through `scrub` (token redaction): the
 * detail, the params and the cause's. A coded failure's sentence is rebuilt
 * from the scrubbed values, never scrubbed itself — a short token could match
 * letters in our own words. An uncoded failure's text is scrubbed as a whole.
 */
export function scrubGitFailure(f: GitFailure, scrub: (s: string) => string): GitFailure {
  if (!f.errorCode) return { error: scrub(f.error) }
  const params = (p: GitErrorParams | undefined): GitErrorParams | undefined =>
    p === undefined
      ? undefined
      : Object.fromEntries(Object.entries(p).map(([k, v]) => [k, scrub(v)]))
  let cause: GitErrorCause | undefined
  if (f.errorCause) {
    cause = { code: f.errorCause.code }
    if (f.errorCause.detail !== undefined) cause.detail = scrub(f.errorCause.detail)
    if (f.errorCause.params !== undefined) cause.params = params(f.errorCause.params)
  }
  // A wrapping failure's detail is the cause's sentence: rebuild it from the
  // scrubbed cause rather than scrubbing our own words.
  const detail = cause
    ? gitCauseText(cause)
    : f.errorDetail === undefined
      ? undefined
      : scrub(f.errorDetail)
  return gitFailure(f.errorCode, detail, params(f.errorParams), cause)
}

export function isGitErrorCode(value: unknown): value is GitErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GIT_ERROR_TEXT, value)
}
