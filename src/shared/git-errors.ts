/**
 * Git / branch IPC failures the renderer words in the UI language (tester
 * finding 6: an English UI showed "Git yapılandırması bulunamadı.").
 *
 * Main returns the English sentence in `error` (logs, old consumers) plus a
 * stable `errorCode`; the renderer translates the code with
 * `lib/git-error-text.ts`. `errorDetail` fills `{detail}` (git's own line,
 * shown as-is), `errorParams` fill any other `{name}`. A failure without a
 * code (raw simple-git stderr) is shown as main wrote it.
 *
 * A failure deep inside a helper is thrown as a {@link GitCodedError}, so the
 * code travels with it to the handler's catch: nothing downstream ever
 * matches on the wording of our own sentences.
 */
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

/** The fields a failed git result carries (spread into `{ success: false, … }`). */
export interface GitFailure {
  error: string
  errorCode?: GitErrorCode
  errorDetail?: string
  errorParams?: GitErrorParams
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
  let out = template
  if (detail !== undefined) out = out.split('{detail}').join(detail)
  for (const [k, v] of Object.entries(params ?? {})) out = out.split(`{${k}}`).join(v)
  return out
}

/** The coded failure fields for `code`, English text filled. */
export function gitFailure(
  code: GitErrorCode,
  detail?: string,
  params?: GitErrorParams,
): GitFailure & { errorCode: GitErrorCode } {
  const out: GitFailure & { errorCode: GitErrorCode } = {
    error: fillGitErrorText(GIT_ERROR_TEXT[code], detail, params),
    errorCode: code,
  }
  if (detail !== undefined) out.errorDetail = detail
  if (params !== undefined) out.errorParams = params
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

  constructor(
    code: GitErrorCode,
    opts: { detail?: string; params?: GitErrorParams; cause?: unknown } = {},
  ) {
    super(
      fillGitErrorText(GIT_ERROR_TEXT[code], opts.detail, opts.params),
      opts.cause === undefined ? undefined : { cause: opts.cause },
    )
    this.name = 'GitCodedError'
    this.code = code
    this.detail = opts.detail
    this.params = opts.params
  }
}

/**
 * A caught error as failure fields: a {@link GitCodedError} keeps its code,
 * anything else is its message as-is (no classification — that is
 * `describeGitFailure`'s job, in `main/lib/git-config.ts`).
 */
export function gitFailureOf(e: unknown): GitFailure {
  if (e instanceof GitCodedError) return gitFailure(e.code, e.detail, e.params)
  return { error: e instanceof Error ? e.message : String(e) }
}

export function isGitErrorCode(value: unknown): value is GitErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GIT_ERROR_TEXT, value)
}
