import { fillGitErrorText, isGitErrorCode, type GitErrorCode } from '../../shared/git-errors'
import { t } from './i18n'

/** i18n key of a main-side git failure code (`src/shared/git-errors.ts`). */
export function gitErrorKey(code: GitErrorCode): string {
  return `gitError.${code}`
}

/**
 * The text to show for a failed git / branch IPC result, in the UI language.
 * A known `errorCode` is translated (`errorDetail` fills `{detail}`,
 * `errorParams` the other placeholders, both shown as main sent them);
 * anything else — raw simple-git stderr, an older main — is shown as main
 * wrote it. No error at all gives `''`, so the caller's own translated
 * fallback (`gitErrorText(res) || t('toast.pullFailed')`) still applies.
 */
export function gitErrorText(
  res:
    | {
        error?: string
        errorCode?: string
        errorDetail?: string
        errorParams?: Readonly<Record<string, string>>
      }
    | null
    | undefined,
): string {
  if (!res) return ''
  if (isGitErrorCode(res.errorCode)) {
    return fillGitErrorText(t(gitErrorKey(res.errorCode)), res.errorDetail ?? '', res.errorParams)
  }
  return res.error ?? ''
}
