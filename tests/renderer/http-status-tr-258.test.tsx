/**
 * Issue #258 — the HTTP Status Codes tool was English in the Turkish UI
 * (about 60 names and descriptions).
 *
 * CONTRACT (HttpStatusTool.tsx + lib/tools/http-status.ts; the Turkish data
 * lives wherever you like, the tests only look at the rendered rows):
 *   - every row has data-testid `http-status-row-<code>` and contains
 *       * `http-status-name-<code>`   the English reason phrase (always visible)
 *       * `http-status-local-name-<code>` the Turkish name — rendered in TR
 *         only, e.g. row text "404 Not Found — Bulunamadı"
 *       * `http-status-desc-<code>`   the description in the UI language
 *   - EN is unchanged: no local-name element, English description.
 *   - search (the existing input, placeholder `tools.httpStatus.search`)
 *     finds a code by number, by the English phrase and, in TR, by the
 *     Turkish name/description — case- and diacritic-insensitive
 *     ("bulunamadi", "BULUNAMADI", "Bulunamadı" all find 404).
 *   - Turkish text is written with Turkish letters (see
 *     i18n-tr-orthography.test.ts, which does NOT scan this data).
 */
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import HttpStatusTool from '../../src/renderer/components/tools/HttpStatusTool'
import { HTTP_STATUS_CODES } from '../../src/renderer/lib/tools/http-status'
import { useLocale } from './helpers/default-locale-shim'
import { t } from '../../src/renderer/lib/i18n'

afterEach(() => {
  cleanup()
  useLocale('en')
})

/** Words that mean the Turkish description is still English. */
const ENGLISH_WORDS = /\b(the|and|has|been|with|that|was|are|not|request|server|client)\b/i

function search(q: string): void {
  fireEvent.change(screen.getByPlaceholderText(t('tools.httpStatus.search')), {
    target: { value: q },
  })
}

describe('TR: every code shows a Turkish name and description', () => {
  it('keeps the English reason phrase, adds a different Turkish name, translates the text', () => {
    useLocale('tr')
    render(<HttpStatusTool />)
    let withDiacritics = 0
    for (const s of HTTP_STATUS_CODES) {
      const row = screen.getByTestId(`http-status-row-${s.code}`)
      expect(row.textContent, `${s.code} keeps the English phrase`).toContain(s.name)
      expect(screen.getByTestId(`http-status-name-${s.code}`).textContent).toBe(s.name)

      const local = screen.getByTestId(`http-status-local-name-${s.code}`).textContent ?? ''
      expect(local.trim().length, `${s.code} local name`).toBeGreaterThan(0)
      expect(local, `${s.code} local name differs from the English one`).not.toBe(s.name)

      const desc = screen.getByTestId(`http-status-desc-${s.code}`).textContent ?? ''
      expect(desc.trim().length, `${s.code} description`).toBeGreaterThan(0)
      expect(desc, `${s.code} description is not the English one`).not.toBe(s.description)
      expect(row.textContent, `${s.code} row has no English description`).not.toContain(
        s.description,
      )
      expect(desc, `${s.code} description still reads English`).not.toMatch(ENGLISH_WORDS)
      if (/[çğıöşüÇĞİÖŞÜ]/.test(desc + local)) withDiacritics++
    }
    // Anti ASCII-folding guard ("Bulunamadi"): most Turkish sentences have a
    // Turkish letter in them.
    expect(withDiacritics / HTTP_STATUS_CODES.length).toBeGreaterThan(0.6)
  })

  it('pins the example from the issue: "404 Not Found — Bulunamadı"', () => {
    useLocale('tr')
    render(<HttpStatusTool />)
    expect(screen.getByTestId('http-status-local-name-404').textContent).toBe('Bulunamadı')
    const row = screen.getByTestId('http-status-row-404').textContent ?? ''
    expect(row).toMatch(/404.*Not Found\s*—\s*Bulunamadı/)
  })
})

describe('TR: search finds a code by number, English phrase and Turkish text', () => {
  const finds = (q: string): number[] => {
    search(q)
    return HTTP_STATUS_CODES.filter((s) => screen.queryByTestId(`http-status-row-${s.code}`)).map(
      (s) => s.code,
    )
  }

  it.each([
    ['404', 404],
    ['Not Found', 404],
    ['not found', 404],
    ['Bulunamadı', 404],
    ['bulunamadı', 404],
    ['BULUNAMADI', 404],
    ['bulunamadi', 404],
  ])('%j finds 404', (q, code) => {
    useLocale('tr')
    render(<HttpStatusTool />)
    const found = finds(q)
    expect(found).toContain(code)
    expect(found).not.toContain(200)
  })

  it('searches the Turkish description too', () => {
    useLocale('tr')
    render(<HttpStatusTool />)
    // Take a distinctive word from the Turkish description of 404 and search it.
    search('')
    const desc = screen.getByTestId('http-status-desc-404').textContent ?? ''
    const word = desc.split(/\s+/).filter((w) => w.length >= 6)[0]
    expect(word, 'a Turkish description word to search for').toBeTruthy()
    expect(finds(word)).toContain(404)
  })

  it('a query nothing matches shows the empty state', () => {
    useLocale('tr')
    render(<HttpStatusTool />)
    search('zzzz-no-such-status')
    expect(screen.getByText('Filtreyle eşleşen kod yok.')).toBeTruthy()
  })
})

describe('EN guard: unchanged', () => {
  it('English name and description only, no local-name element', () => {
    useLocale('en')
    render(<HttpStatusTool />)
    const s404 = HTTP_STATUS_CODES.find((s) => s.code === 404)!
    expect(screen.getByTestId('http-status-name-404').textContent).toBe('Not Found')
    expect(screen.getByTestId('http-status-desc-404').textContent).toBe(s404.description)
    expect(screen.queryByTestId('http-status-local-name-404')).toBeNull()
    expect(screen.getByTestId('http-status-row-404').textContent).not.toContain('—')
  })

  it('EN search by English text and number still works', () => {
    useLocale('en')
    render(<HttpStatusTool />)
    search('not found')
    expect(screen.getByTestId('http-status-row-404')).toBeTruthy()
    expect(screen.queryByTestId('http-status-row-200')).toBeNull()
    search('200')
    expect(screen.getByTestId('http-status-row-200')).toBeTruthy()
  })
})
