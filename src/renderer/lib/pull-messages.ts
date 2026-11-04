import { formatCount } from './plural'

/**
 * After a pull: secret values never travel through git (issue #177), so a
 * teammate's first Send can fail on an empty token. `git:pull` counts what is
 * still empty here; every pull entry point shows the same line.
 */
export function emptySecretsMessage(t: (key: string) => string, count: number): string {
  return formatCount(count, t('toast.pulledEmptySecretOne'), t('toast.pulledEmptySecrets'))
}

const MAX_NAMED_FILES = 5

/**
 * A repository can hold `x.json -> /dev/zero`. Reads leave out links, special files
 * and oversized files; whoever pulled or opened the repository is told which.
 */
export function skippedFilesMessage(t: (key: string) => string, files: readonly string[]): string {
  const named = files.slice(0, MAX_NAMED_FILES).join(', ')
  const rest = files.length > MAX_NAMED_FILES ? ', …' : ''
  return formatCount(
    files.length,
    t('toast.pullSkippedFileOne'),
    t('toast.pullSkippedFiles'),
  ).replace('{files}', `${named}${rest}`)
}
