/**
 * Issue #258 (mixed date "22 Eki 2026 12:28:26 AM") / issue #261 (AI Chat
 * metrics "2:18:35 AM" in Turkish) — ONE shared date-time formatter.
 *
 * CONTRACT — `src/renderer/lib/format-datetime.ts` (new module):
 *
 *   export type DateTimeLocale = 'en' | 'tr'
 *   export function formatTime(ts: number | Date, locale: DateTimeLocale,
 *     opts?: { seconds?: boolean }): string
 *   export function formatDate(ts: number | Date, locale: DateTimeLocale,
 *     opts?: { year?: boolean }): string      // month short + day (+ year, default true)
 *
 *   TR: `tr-TR`, `hourCycle: 'h23'`, no `hour12` -> "14:18:35" / "00:28:26"
 *       (midnight is "00", never "24"), "22 Eki 2020" / "22 Eki".
 *   EN: no locale named (the system's), the options the call sites used so
 *       far, so English output stays byte-identical:
 *         time  -> toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'
 *                  [, second:'2-digit']})
 *         date  -> toLocaleDateString('en-US', {month:'short', day:'numeric'
 *                  [, year:'numeric']})
 *   Date and time are formatted as SEPARATE parts; call sites join them with
 *   their existing separator (' ' or ', '). One Intl call would add a comma.
 *
 * The module is imported dynamically so a missing file fails an assertion,
 * not the whole file at load.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AFTERNOON,
  MIDNIGHT,
  TWELVE_HOUR,
  installEnUsDefault,
  uninstallEnUsDefault,
} from './helpers/default-locale-shim'

interface Mod {
  formatTime: (ts: number | Date, locale: 'en' | 'tr', opts?: { seconds?: boolean }) => string
  formatDate: (ts: number | Date, locale: 'en' | 'tr', opts?: { year?: boolean }) => string
}

async function load(): Promise<Mod> {
  const path = '../../src/renderer/lib/' + 'format-datetime'
  const mod = (await import(/* @vite-ignore */ path).catch(() => null)) as Mod | null
  expect(mod, 'src/renderer/lib/format-datetime.ts must exist').not.toBeNull()
  return mod as Mod
}

beforeEach(installEnUsDefault)
afterEach(uninstallEnUsDefault)

describe('formatTime', () => {
  it('TR: 24-hour, zero padded, midnight is 00 (never 24), no AM/PM', async () => {
    const { formatTime } = await load()
    expect(formatTime(AFTERNOON, 'tr', { seconds: true })).toBe('14:18:35')
    expect(formatTime(MIDNIGHT, 'tr', { seconds: true })).toBe('00:28:26')
    expect(formatTime(MIDNIGHT, 'tr')).toBe('00:28')
    expect(formatTime(AFTERNOON, 'tr')).not.toMatch(TWELVE_HOUR)
    expect(formatTime(new Date(AFTERNOON), 'tr')).toBe('14:18')
  })

  it('EN: byte-identical to what the call sites produced before (system clock)', async () => {
    const { formatTime } = await load()
    const d = new Date(AFTERNOON)
    expect(formatTime(AFTERNOON, 'en', { seconds: true })).toBe(
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    )
    expect(formatTime(AFTERNOON, 'en')).toBe(
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    )
    // Under the en-US default shim this is a 12-hour clock.
    expect(formatTime(AFTERNOON, 'en')).toBe('02:18 PM')
  })
})

describe('formatDate', () => {
  it('TR: Turkish month, day first', async () => {
    const { formatDate } = await load()
    expect(formatDate(MIDNIGHT, 'tr')).toBe('22 Eki 2020')
    expect(formatDate(MIDNIGHT, 'tr', { year: false })).toBe('22 Eki')
  })

  it('EN: en-US short month', async () => {
    const { formatDate } = await load()
    expect(formatDate(MIDNIGHT, 'en')).toBe('Oct 22, 2020')
    expect(formatDate(MIDNIGHT, 'en', { year: false })).toBe('Oct 22')
  })
})

describe('the reported string', () => {
  it('TR date + time never mixes a Turkish date with a 12-hour clock', async () => {
    const { formatDate, formatTime } = await load()
    const text = `${formatDate(MIDNIGHT, 'tr')} ${formatTime(MIDNIGHT, 'tr', { seconds: true })}`
    expect(text).toBe('22 Eki 2020 00:28:26')
    expect(text).not.toMatch(TWELVE_HOUR)
  })
})
