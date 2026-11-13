/**
 * How the History overview prints a time and a duration. Dates and times go
 * through the one formatter (`lib/format-datetime.ts`, issue #258/#261).
 */
import { formatDate, formatTime, type DateTimeLocale } from '../../lib/format-datetime'
import type { TemplateValues } from '../../../shared/fill-template'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The short date: "Nov 12" this year, "Oct 9, 2025" / "9 Eki 2025" for
 * another year — a 400-day-old row must not read like last month's.
 */
export function formatHistoryDate(
  ts: number,
  locale: DateTimeLocale,
  now: number = Date.now(),
): string {
  const year = new Date(ts).getFullYear() !== new Date(now).getFullYear()
  return formatDate(ts, locale, { year })
}

/**
 * Today → "14:05"; yesterday → "Yesterday 14:05"; older → "Nov 12 14:05"
 * (with the year when it is not this year, `formatHistoryDate`).
 */
export function formatWhen(
  ts: number,
  t: (key: string, values?: TemplateValues) => string,
  locale: DateTimeLocale,
  now: number = Date.now(),
): string {
  const d = new Date(now)
  const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const time = formatTime(ts, locale)
  if (ts >= startOfToday) return time
  if (ts >= startOfToday - DAY_MS) return t('historyHome.yesterdayAt', { time })
  return `${formatHistoryDate(ts, locale, now)} ${time}`
}

/** "142 ms" / "1.4 s"; no duration → "—". */
export function formatDuration(ms: number | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}
