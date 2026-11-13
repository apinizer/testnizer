import {
  fillGitErrorText,
  isGitErrorCode,
  type GitErrorCode,
  type GitErrorParams,
} from '../../shared/git-errors'
import { t } from './i18n'

/** i18n key of a main-side git failure code (`src/shared/git-errors.ts`). */
export function gitErrorKey(code: GitErrorCode): string {
  return `gitError.${code}`
}

interface GitResultLike {
  error?: string
  errorCode?: string
  errorDetail?: string
  errorParams?: GitErrorParams
  errorCause?: { code?: string; detail?: string; params?: GitErrorParams }
}

/**
 * The text to show for a failed git / branch IPC result, in the UI language.
 * A known `errorCode` is translated (`errorDetail` fills `{detail}`,
 * `errorParams` the other placeholders, both shown as main sent them). A
 * known `errorCause` (the coded failure a pull / merge import hit) is
 * translated too and becomes the outer sentence's `{detail}`; an unknown one
 * falls back to `errorDetail` (its English text). Anything else — raw
 * simple-git stderr, an older main — is shown as main wrote it. No error at
 * all gives `''`, so the caller's own translated fallback
 * (`gitErrorText(res) || t('toast.pullFailed')`) still applies.
 */
export function gitErrorText(res: GitResultLike | null | undefined): string {
  if (!res) return ''
  if (!isGitErrorCode(res.errorCode)) return res.error ?? ''
  const cause = res.errorCause
  const detail =
    cause && isGitErrorCode(cause.code)
      ? fillGitErrorText(t(gitErrorKey(cause.code)), cause.detail, cause.params)
      : (res.errorDetail ?? '')
  return fillGitErrorText(t(gitErrorKey(res.errorCode)), detail, res.errorParams)
}
