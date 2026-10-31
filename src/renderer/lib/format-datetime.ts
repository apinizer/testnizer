/**
 * One date / time formatter for every screen that prints a time (issue #258,
 * issue #261). A Turkish UI used to mix a `tr-TR` date with a time formatted
 * in the operating system's locale ("22 Eki 2026 12:28:26 AM"), or showed a
 * 12-hour clock outright.
 *
 * Rules:
 *   - TR: `tr-TR`, `hourCycle: 'h23'` (midnight is "00", never "24"), so the
 *     result does not depend on the OS locale.
 *   - EN: exactly the call the screens made before (the system locale for the
 *     time, `en-US` for the short date), so English output is byte-identical.
 *   - Date and time are separate parts; call sites join them with their own
 *     separator (' ' or ', ').
 */

export type DateTimeLocale = 'en' | 'tr'

const toDate = (ts: number | Date): Date => (ts instanceof Date ? ts : new Date(ts))

const TR_CLOCK: Intl.DateTimeFormatOptions = { hourCycle: 'h23' }

/** "14:18" / "14:18:35" (TR); the system's 2-digit clock in EN. */
export function formatTime(
  ts: number | Date,
  locale: DateTimeLocale,
  opts: { seconds?: boolean } = {},
): string {
  const parts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }
  if (opts.seconds) parts.second = '2-digit'
  const d = toDate(ts)
  if (locale === 'tr') return d.toLocaleTimeString('tr-TR', { ...parts, ...TR_CLOCK })
  return d.toLocaleTimeString([], parts)
}

/**
 * The full time of day with seconds in the system's own style for EN
 * (`toLocaleTimeString()` with no arguments — "2:18:35 PM"), 24-hour in TR.
 */
export function formatClock(ts: number | Date, locale: DateTimeLocale): string {
  if (locale === 'tr') return formatTime(ts, 'tr', { seconds: true })
  return toDate(ts).toLocaleTimeString()
}

/** "22 Eki 2020" / "22 Eki" (TR); "Oct 22, 2020" / "Oct 22" (EN). */
export function formatDate(
  ts: number | Date,
  locale: DateTimeLocale,
  opts: { year?: boolean } = {},
): string {
  const parts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (opts.year !== false) parts.year = 'numeric'
  return toDate(ts).toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-US', parts)
}

/**
 * A full date + time stamp: "22.10.2020 14:18:35" in TR; in EN the system's
 * `toLocaleString()` exactly as the screens printed it before.
 */
export function formatDateTime(ts: number | Date, locale: DateTimeLocale): string {
  const d = toDate(ts)
  if (locale === 'tr') {
    return d.toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      ...TR_CLOCK,
    })
  }
  return d.toLocaleString()
}

/**
 * "now" / "5 min. ago" / "yesterday" (EN), "şimdi" / "5 dk. önce" / "dün"
 * (TR) — `Intl.RelativeTimeFormat` in the UI locale (G-17, issue #258 /
 * issue #261: the recent-endpoints list said "just now / 1m ago" in Turkish).
 * Past only: a timestamp ahead of `now` (clock skew) reads as "now". `now` is
 * injectable for tests.
 */
export function formatRelativeTime(
  ts: number | Date,
  locale: DateTimeLocale,
  now: number = Date.now(),
): string {
  const rtf = new Intl.RelativeTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
    numeric: 'auto',
    style: 'short',
  })
  const sec = Math.max(0, now - toDate(ts).getTime()) / 1000
  if (sec < 60) return rtf.format(0, 'second')
  if (sec < 3600) return rtf.format(-Math.floor(sec / 60), 'minute')
  if (sec < 86400) return rtf.format(-Math.floor(sec / 3600), 'hour')
  return rtf.format(-Math.floor(sec / 86400), 'day')
}
