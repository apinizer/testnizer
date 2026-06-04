/**
 * Epoch / Unix timestamp helpers.
 * Detects whether a numeric input is in seconds, milliseconds, microseconds
 * or nanoseconds based on its magnitude, and converts to/from a Date.
 */

export type EpochUnit = 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds'

/** Heuristic unit detection by magnitude. */
export function detectUnit(value: number): EpochUnit {
  const abs = Math.abs(value)
  // Seconds: ~10 digits up to year ~5138 → < 1e11
  if (abs < 1e11) return 'seconds'
  // Milliseconds: ~13 digits
  if (abs < 1e14) return 'milliseconds'
  // Microseconds: ~16 digits
  if (abs < 1e17) return 'microseconds'
  return 'nanoseconds'
}

/** Convert any Unix timestamp (autodetected unit) to a Date. */
export function epochToDate(
  value: number,
  unit: EpochUnit | 'auto' = 'auto',
): { date: Date; unit: EpochUnit } {
  const u = unit === 'auto' ? detectUnit(value) : unit
  const ms =
    u === 'seconds'
      ? value * 1000
      : u === 'milliseconds'
        ? value
        : u === 'microseconds'
          ? value / 1000
          : value / 1_000_000
  return { date: new Date(ms), unit: u }
}

/** Format a Date in the user's local time zone with friendly weekday/date. */
export function formatLocal(date: Date): string {
  if (isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/** Format a Date in UTC/GMT with friendly weekday/date. */
export function formatUtc(date: Date): string {
  if (isNaN(date.getTime())) return ''
  return date.toLocaleString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
}

/** Time zone offset string for a Date in the user's locale (e.g. "GMT+03:00"). */
export function localTzLabel(): string {
  const offsetMin = -new Date().getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `GMT${sign}${hh}:${mm}`
}

/** Human-readable "n {unit} ago" / "in n {unit}". */
export function relative(date: Date, now: Date = new Date()): string {
  if (isNaN(date.getTime())) return ''
  const diffMs = date.getTime() - now.getTime()
  const past = diffMs < 0
  const absSec = Math.round(Math.abs(diffMs) / 1000)
  const fmt = (n: number, u: string): string =>
    past ? `${n} ${u}${n === 1 ? '' : 's'} ago` : `in ${n} ${u}${n === 1 ? '' : 's'}`
  if (absSec < 60) return fmt(absSec, 'second')
  const min = Math.round(absSec / 60)
  if (min < 60) return fmt(min, 'minute')
  const h = Math.round(min / 60)
  if (h < 48) return fmt(h, 'hour')
  const d = Math.round(h / 24)
  if (d < 60) return fmt(d, 'day')
  const mo = Math.round(d / 30)
  if (mo < 24) return fmt(mo, 'month')
  const y = Math.round(d / 365)
  return fmt(y, 'year')
}

/** Build a Date from explicit Y/M/D/H/Min/S parts in either GMT or local zone. */
export function fromParts(
  parts: { y: number; mo: number; d: number; h: number; mi: number; s: number },
  zone: 'gmt' | 'local',
): Date {
  if (zone === 'gmt') {
    return new Date(Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s))
  }
  return new Date(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s)
}
