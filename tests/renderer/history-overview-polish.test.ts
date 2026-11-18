/**
 * History overview polish (screen check of the History page):
 *   - a gRPC row's URL is `localhost:50051/echo.Echo/Say` (no scheme). `new
 *     URL()` read `localhost:` as the scheme, so the row label lost its host
 *     and read "50051/echo.Echo/Say". Template and unparseable URLs kept their
 *     query string and userinfo.
 *   - a row from another year printed "Oct 9" — no year, so a 400-day-old
 *     entry looked like last month's.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shortHistoryUrl } from '../../src/renderer/lib/history-restore'
import { historyRowLabel } from '../../src/renderer/components/shared/history-row-label'
import { formatHistoryDate, formatWhen } from '../../src/renderer/components/history/history-format'
import { setLocale, t as translate } from '../../src/renderer/lib/i18n'

afterEach(() => {
  setLocale('en')
  vi.useRealTimers()
})

describe('shortHistoryUrl: host + path for every URL shape', () => {
  it('a scheme-less host:port address keeps its host (gRPC)', () => {
    expect(shortHistoryUrl('localhost:50051/echo.Echo/Say')).toBe('localhost:50051/echo.Echo/Say')
    expect(shortHistoryUrl('localhost:50051/pkg.Svc/Method')).toBe('localhost:50051/pkg.Svc/Method')
    expect(shortHistoryUrl('grpc.internal:443/pkg.Svc/Method?x=1')).toBe(
      'grpc.internal:443/pkg.Svc/Method',
    )
  })

  it('a template URL stays a template, without its query or fragment', () => {
    expect(shortHistoryUrl('{{baseUrl}}/orders')).toBe('{{baseUrl}}/orders')
    expect(shortHistoryUrl('{{baseUrl}}/orders?id={{id}}#top')).toBe('{{baseUrl}}/orders')
  })

  it('a normal URL: host + path, no scheme / query / fragment', () => {
    expect(shortHistoryUrl('https://api.site.com/users?x=1#f')).toBe('api.site.com/users')
    expect(shortHistoryUrl('ws://echo.local:8080/chat')).toBe('echo.local:8080/chat')
    expect(shortHistoryUrl('grpc://localhost:50051/a.B/C')).toBe('localhost:50051/a.B/C')
  })

  it('userinfo never reaches the label', () => {
    expect(shortHistoryUrl('https://user:secret@api.site.com/p?q=1')).toBe('api.site.com/p')
    // Does not parse as a URL (template host): cut by hand.
    expect(shortHistoryUrl('https://u:p@{{host}}:{{port}}/x?key=abc')).toBe('{{host}}:{{port}}/x')
    expect(shortHistoryUrl('user:secret@localhost:50051/pkg.Svc/M')).toBe(
      'localhost:50051/pkg.Svc/M',
    )
    // An `@` in the path is not userinfo.
    expect(shortHistoryUrl('{{baseUrl}}/users/@me')).toBe('{{baseUrl}}/users/@me')
  })

  it('the row label uses it', () => {
    const label = historyRowLabel({
      protocol: 'grpc',
      url: 'localhost:50051/echo.Echo/Say',
      method: 'UNARY',
      request_snapshot: {},
    })
    expect(label.label).toBe('localhost:50051/echo.Echo/Say')
  })
})

describe('History dates carry the year only when it is not this year', () => {
  const now = new Date(2026, 10, 12, 15, 0).getTime()

  it('formatWhen: same year without the year, another year with it (EN + TR)', () => {
    const thisYear = new Date(2026, 9, 9, 16, 58).getTime()
    const lastYear = new Date(2025, 9, 9, 16, 58).getTime()
    setLocale('tr')
    expect(formatWhen(thisYear, translate, 'tr', now)).toBe('9 Eki 16:58')
    expect(formatWhen(lastYear, translate, 'tr', now)).toBe('9 Eki 2025 16:58')
    setLocale('en')
    expect(formatWhen(thisYear, translate, 'en', now)).toMatch(/^Oct 9 /)
    expect(formatWhen(lastYear, translate, 'en', now)).toMatch(/^Oct 9, 2025 /)
  })

  it("formatHistoryDate: the summary line's date", () => {
    expect(formatHistoryDate(new Date(2026, 0, 3).getTime(), 'en', now)).toBe('Jan 3')
    expect(formatHistoryDate(new Date(2025, 11, 31).getTime(), 'en', now)).toBe('Dec 31, 2025')
    expect(formatHistoryDate(new Date(2025, 11, 31).getTime(), 'tr', now)).toBe('31 Ara 2025')
  })
})
