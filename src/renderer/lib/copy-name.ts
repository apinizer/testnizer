import { t } from './i18n'

/**
 * The name of a duplicate — the single owner for every Duplicate (APIs tree request /
 * endpoint / folder, tab, Tests item, project).
 *
 * The suffix is written in the UI language at creation time ("Orders (copy)"
 * in EN, "Orders (kopya)" in TR) and then saved like any name the user typed:
 * it is data, so switching the language later does not rename the copy. Main
 * has no dictionary, so the renderer passes this name over IPC
 * (`folder:duplicate`, `project:duplicate`); main's own English suffix is only
 * the fallback for a caller that sends none.
 */
export function copyName(name: string): string {
  return t('common.copyName', { name })
}
