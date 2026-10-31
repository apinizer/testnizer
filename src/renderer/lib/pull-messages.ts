import { formatCount } from './plural'

/**
 * After a pull: secret values never travel through git (issue #177), so a
 * teammate's first Send can fail on an empty token. `git:pull` counts what is
 * still empty here; every pull entry point shows the same line.
 */
export function emptySecretsMessage(t: (key: string) => string, count: number): string {
  return formatCount(count, t('toast.pulledEmptySecretOne'), t('toast.pulledEmptySecrets'))
}
