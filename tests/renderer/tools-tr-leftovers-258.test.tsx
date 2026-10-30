/**
 * Issue #258 — Tools reference content that stayed English in the Turkish UI:
 * Regex Tester (flag hints + sample text), UUID / Base converter / HMAC
 * placeholders.
 *
 * CONTRACT (all new i18n keys need EN + TR values):
 *   Regex   `tools.regex.flag.g|i|m|s|u|y`  title of each flag button,
 *           `tools.regex.sampleInput`       the default input text. The TR
 *           sample must still match the default (email) pattern so the demo
 *           shows matches. EN values = today's strings, byte for byte.
 *   UUID    `tools.uuid.namespaceCustomPlaceholder`  EN "custom namespace UUID"
 *           `tools.uuid.namespaceCustomLabel`        EN "Custom namespace UUID"
 *             (the hard-coded aria-label of the same input)
 *           `tools.uuid.validatePlaceholder`         EN "paste a UUID to inspect"
 *   HMAC    `tools.hmac.secretPlaceholder`           EN "secret key"
 *   Base    `tools.base.sample` — EN "Hello", TR a Turkish word. The five
 *           placeholders are DERIVED from it with the converter's own
 *           functions (ascii = the word, bin/oct/dec/hex = its bytes), so the
 *           row stays self-consistent. `tools.base.multiByte` /
 *           `tools.base.utf8Multi` replace "— (multi-byte)" / "— (UTF-8)"
 *           in the examples table (EN unchanged).
 */
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))
vi.hoisted(() => {
  const ns = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === 'then'
          ? undefined
          : (..._a: unknown[]) => Promise.resolve({ success: true, data: [] }),
    },
  )
  const api = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : ns) })
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = {}
  g.window.api = api
})

import RegexTool from '../../src/renderer/components/tools/RegexTool'
import UuidTool from '../../src/renderer/components/tools/UuidTool'
import HmacTool from '../../src/renderer/components/tools/HmacTool'
import BaseConverterTool from '../../src/renderer/components/tools/BaseConverterTool'
import { bytesToAll, parseToBytes } from '../../src/renderer/lib/tools/base-converter'
import { t } from '../../src/renderer/lib/i18n'
import { useLocale } from './helpers/default-locale-shim'

afterEach(() => {
  cleanup()
  useLocale('en')
})

/** Every user-readable attribute in the document. */
function attrs(): string[] {
  const out: string[] = []
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    for (const a of ['placeholder', 'title', 'aria-label']) {
      const v = el.getAttribute(a)
      if (v) out.push(v)
    }
  }
  return out
}

const EN_FLAG_HINTS: Record<string, string> = {
  g: 'global — find all matches',
  i: 'case-insensitive',
  m: 'multiline — ^/$ match per line',
  s: 'dotAll — . matches newlines',
  u: 'unicode — full Unicode support',
  y: 'sticky — match from lastIndex',
}

describe('Regex Tester', () => {
  it('EN guard: flag hints and sample text are the strings used so far', () => {
    useLocale('en')
    render(<RegexTool />)
    for (const [flag, hint] of Object.entries(EN_FLAG_HINTS)) {
      const btn = screen.getByRole('button', { name: flag })
      expect(btn.getAttribute('title'), flag).toBe(hint)
    }
    const input = document.querySelector('textarea') as HTMLTextAreaElement
    expect(input.value).toContain('Sample input text:')
    expect(input.value).toContain('Contact us at help@example.com')
  })

  it('TR: every flag hint is Turkish (differs from EN, no English words left)', () => {
    useLocale('tr')
    render(<RegexTool />)
    for (const [flag, enHint] of Object.entries(EN_FLAG_HINTS)) {
      const title = screen.getByRole('button', { name: flag }).getAttribute('title') ?? ''
      expect(title.length, flag).toBeGreaterThan(0)
      expect(title, `${flag} still English`).not.toBe(enHint)
      expect(title, `${flag} still English`).not.toMatch(
        /\b(global|case-insensitive|multiline|find all|matches newlines|support|match from|sticky|unicode)\b/,
      )
    }
  })

  it('TR: the sample text is Turkish and the default pattern still matches in it', () => {
    useLocale('tr')
    render(<RegexTool />)
    const input = document.querySelector('textarea') as HTMLTextAreaElement
    expect(input.value).not.toContain('Sample input text')
    expect(input.value).not.toContain('Contact us at')
    expect(input.value).not.toContain('Visit ')
    expect(input.value).toBe(t('tools.regex.sampleInput'))
    expect(input.value).toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/)
    const counter = document.body.textContent ?? ''
    expect(counter).toMatch(/\b[1-9]\d*\s*eşleşme/)
  })

  it('TR and EN samples are different texts', () => {
    useLocale('tr')
    const tr = t('tools.regex.sampleInput')
    useLocale('en')
    expect(t('tools.regex.sampleInput')).not.toBe(tr)
  })
})

describe('UUID generator placeholders', () => {
  const openV5 = (): void => {
    fireEvent.click(screen.getByRole('button', { name: 'v5' }))
  }

  it('EN guard: strings unchanged', () => {
    useLocale('en')
    render(<UuidTool />)
    openV5()
    const all = attrs()
    expect(all).toContain('custom namespace UUID')
    expect(all).toContain('Custom namespace UUID')
    expect(all).toContain('paste a UUID to inspect')
  })

  it('TR: no English placeholder or aria-label', () => {
    useLocale('tr')
    render(<UuidTool />)
    openV5()
    const all = attrs().join('\n')
    expect(all).not.toMatch(/custom namespace UUID/i)
    expect(all).not.toContain('paste a UUID to inspect')
    expect(screen.getByPlaceholderText(t('tools.uuid.namespaceCustomPlaceholder'))).toBeTruthy()
    expect(screen.getByLabelText(t('tools.uuid.namespaceCustomLabel'))).toBeTruthy()
    expect(screen.getByPlaceholderText(t('tools.uuid.validatePlaceholder'))).toBeTruthy()
  })
})

describe('HMAC secret placeholder', () => {
  it('EN guard: "secret key"', () => {
    useLocale('en')
    render(<HmacTool />)
    expect(attrs()).toContain('secret key')
  })

  it('TR: localized', () => {
    useLocale('tr')
    render(<HmacTool />)
    expect(attrs()).not.toContain('secret key')
    expect(screen.getByPlaceholderText(t('tools.hmac.secretPlaceholder'))).toBeTruthy()
    expect(t('tools.hmac.secretPlaceholder')).not.toBe('secret key')
  })
})

describe('Base converter', () => {
  const placeholders = (): string[] =>
    Array.from(document.body.querySelectorAll('[placeholder]')).map(
      (e) => e.getAttribute('placeholder') ?? '',
    )

  it('EN guard: the "Hello" row is unchanged', () => {
    useLocale('en')
    render(<BaseConverterTool />)
    expect(placeholders()).toEqual([
      'Hello',
      '01001000 01100101 01101100 01101100 01101111',
      '110 145 154 154 157',
      '72 101 108 108 111',
      '48 65 6c 6c 6f',
    ])
    expect(document.body.textContent).toContain('— (multi-byte)')
  })

  it('TR: ascii placeholder is Turkish and the other four encode that same word', () => {
    useLocale('tr')
    render(<BaseConverterTool />)
    const [ascii, bin, oct, dec, hex] = placeholders()
    expect(ascii).not.toBe('Hello')
    expect(ascii).toBe(t('tools.base.sample'))
    const expected = bytesToAll(parseToBytes('ascii', ascii))
    expect({ bin, oct, dec, hex }).toEqual({
      bin: expected.bin,
      oct: expected.oct,
      dec: expected.dec,
      hex: expected.hex,
    })
  })

  it('TR: the examples table has no English cell', () => {
    useLocale('tr')
    render(<BaseConverterTool />)
    expect(document.body.textContent).not.toContain('multi-byte')
  })
})
