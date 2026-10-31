/**
 * 1.6.0 screen review G-17 (issue #258 / issue #261) — the "Son uç noktalar"
 * list on a Turkish new-request tab said "just now" / "1m ago": the welcome
 * page built relative times from English literals, and the commit history had
 * its own copy. Both go through `formatRelativeTime` in
 * `lib/format-datetime.ts` (Intl.RelativeTimeFormat with the UI locale).
 *
 * Expected strings are computed with Intl here rather than hard-coded: Node's
 * ICU and Electron's Chromium ICU may word short styles differently.
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import * as fmt from '../../src/renderer/lib/format-datetime'
import NewRequestWelcome from '../../src/renderer/components/layout/NewRequestWelcome'
import { useHistoryStore } from '../../src/renderer/stores/history.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { HistoryEntry } from '../../src/renderer/types'

type RelFn = (ts: number | Date, locale: 'en' | 'tr', now?: number) => string
const rel = (fmt as unknown as { formatRelativeTime?: RelFn }).formatRelativeTime

const NOW = new Date(2026, 9, 31, 12, 0, 0).getTime()
const ago = (sec: number): number => NOW - sec * 1000
const intl = (locale: 'en' | 'tr', n: number, unit: Intl.RelativeTimeFormatUnit): string =>
  new Intl.RelativeTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
    numeric: 'auto',
    style: 'short',
  }).format(n, unit)

afterEach(() => {
  cleanup()
  useUIStore.setState({ locale: 'en' })
  setLocale('en')
  vi.useRealTimers()
})

describe('formatRelativeTime (lib/format-datetime.ts)', () => {
  it('exists', () => {
    expect(typeof rel).toBe('function')
  })

  for (const locale of ['en', 'tr'] as const) {
    it(`follows the UI locale (${locale})`, () => {
      const f = rel as RelFn
      expect(f(ago(5), locale, NOW)).toBe(intl(locale, 0, 'second'))
      expect(f(ago(60), locale, NOW)).toBe(intl(locale, -1, 'minute'))
      expect(f(ago(59 * 60), locale, NOW)).toBe(intl(locale, -59, 'minute'))
      expect(f(ago(3 * 3600), locale, NOW)).toBe(intl(locale, -3, 'hour'))
      expect(f(ago(2 * 86400), locale, NOW)).toBe(intl(locale, -2, 'day'))
      // A clock that runs behind never reads as the future.
      expect(f(NOW + 30_000, locale, NOW)).toBe(intl(locale, 0, 'second'))
    })
  }

  it('TR never says "ago" / "just now"', () => {
    const f = rel as RelFn
    for (const s of [5, 90, 7200, 200_000]) {
      const out = f(ago(s), 'tr', NOW)
      expect(out).not.toMatch(/ago|just now/i)
    }
    expect(f(ago(90), 'tr', NOW)).toMatch(/önce/)
  })
})

function entry(id: string, executedAt: number): HistoryEntry {
  return {
    id,
    protocol: 'http',
    method: 'GET',
    url: `http://127.0.0.1:1/${id}`,
    status_code: 200,
    request_snapshot: {},
    executed_at: executedAt,
  }
}

describe('Recent endpoints on the new-request page (G-17)', () => {
  it('Turkish UI shows Turkish relative times', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    useUIStore.setState({ locale: 'tr' })
    setLocale('tr')
    ;(window as unknown as { api: unknown }).api = {}
    useHistoryStore.setState({
      entries: [entry('a', ago(5)), entry('b', ago(60))],
      fetch: vi.fn(async () => undefined),
    } as never)
    render(<NewRequestWelcome />)
    expect(screen.getByText(intl('tr', 0, 'second'))).toBeTruthy()
    expect(screen.getByText(intl('tr', -1, 'minute'))).toBeTruthy()
    expect(screen.queryByText(/just now|ago/)).toBeNull()
  })
})

describe('no English relative-time literals left (static guard)', () => {
  for (const file of [
    'src/renderer/components/layout/NewRequestWelcome.tsx',
    'src/renderer/components/sidebar/CommitHistoryPanel.tsx',
  ]) {
    it(file, () => {
      const src = readFileSync(resolve(__dirname, '../..', file), 'utf8')
      expect(src).not.toMatch(/'just now'|m ago`|h ago`|d ago`/)
      expect(src).not.toMatch(/commitHistory\.(justNow|minutesAgo|hoursAgo|daysAgo)/)
      expect(src).toMatch(/formatRelativeTime/)
    })
  }
})
