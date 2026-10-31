/**
 * Makes "the system locale" deterministic for renderer date/time tests
 * (issues #258 / #261). A call that names no locale (`undefined`, `[]`) is the
 * code path that follows the OS, which is how a Turkish UI got
 * "22 Eki 2026 12:28:26 AM": a `tr-TR` date glued to a system-locale time.
 * The shim pins that default to `en-US` (12-hour clock), so the test fails on
 * EVERY machine, not only on ones whose default happens to be 12-hour.
 */
import { setLocale } from '../../../src/renderer/lib/i18n'
import { useUIStore } from '../../../src/renderer/stores/ui.store'

type Loc = string | string[] | undefined
const pin = (locales: Loc): string | string[] =>
  locales === undefined || (Array.isArray(locales) && locales.length === 0) ? 'en-US' : locales

let restore: Array<() => void> = []

export function installEnUsDefault(): void {
  const proto = Date.prototype as unknown as Record<string, (...a: unknown[]) => string>
  for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'] as const) {
    const original = proto[name]
    proto[name] = function (this: Date, locales?: Loc, options?: Intl.DateTimeFormatOptions) {
      return original.call(this, pin(locales), options)
    } as never
    restore.push(() => {
      proto[name] = original
    })
  }
  const OriginalDtf = Intl.DateTimeFormat
  const Shim = new Proxy(OriginalDtf, {
    construct: (target, args: [Loc?, Intl.DateTimeFormatOptions?]) =>
      new target(pin(args[0]), args[1]),
    apply: (target, _this, args: [Loc?, Intl.DateTimeFormatOptions?]) =>
      (target as unknown as (l: unknown, o: unknown) => Intl.DateTimeFormat)(pin(args[0]), args[1]),
  })
  Intl.DateTimeFormat = Shim as typeof Intl.DateTimeFormat
  restore.push(() => {
    Intl.DateTimeFormat = OriginalDtf
  })
}

export function uninstallEnUsDefault(): void {
  for (const r of restore.reverse()) r()
  restore = []
}

export function useLocale(locale: 'en' | 'tr'): void {
  useUIStore.setState({ locale })
  setLocale(locale)
}

/** Local-time timestamps (timezone independent). */
export const AFTERNOON = new Date(2020, 9, 22, 14, 18, 35).getTime()
export const MIDNIGHT = new Date(2020, 9, 22, 0, 28, 26).getTime()

/** A 12-hour-clock marker in either language. */
export const TWELVE_HOUR = /\b(AM|PM)\b|ÖÖ|ÖS/
