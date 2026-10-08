import type { Locale } from './i18n'

/**
 * Suggested commit message for the Push dialog (issue #136). Mirrors the
 * main-process fallback in `git:push` ("Update <name> — <date>") so the text
 * the user sees prefilled is what a blank message would have produced anyway.
 * Callers compute it when the dialog OPENS (an event handler), not during
 * render, so the timestamp is the moment the user clicked Push.
 */
export function suggestedCommitMessage(
  projectName: string,
  locale: Locale,
  now: Date = new Date(),
): string {
  const stamp = now.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US')
  return `Update ${projectName} — ${stamp}`
}
