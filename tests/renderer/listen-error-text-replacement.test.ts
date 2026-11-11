/**
 * The busy-port text names the mock server holding the port — user text.
 * It used to be filled with `String.replace('{name}', name)`, which expands
 * `$&` / `$1` / `` $` `` / `$'` / `$$` in the name; now `t(key, values)` inserts
 * it verbatim, in English and Turkish (Codex review of e6e82a7).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { describeListenError, mockIpcErrorText } from '../../src/renderer/lib/listen-error-text'
import { setLocale, t } from '../../src/renderer/lib/i18n'

const WEIRD = "Mock $& $1 $` $' $$ {port}"

afterEach(() => setLocale('en'))

describe('describeListenError — a mock name with replacement patterns', () => {
  const cases = [
    {
      otherProject: false,
      en: `Port 4010 is already in use by mock server "${WEIRD}". Stop it or use a different port.`,
      tr: `4010 portu "${WEIRD}" mock sunucusu tarafından kullanılıyor. Onu durdurun ya da başka bir port kullanın.`,
    },
    {
      otherProject: true,
      en: `Port 4010 is already in use by mock server "${WEIRD}", which belongs to another project.`,
      tr: `4010 portu başka bir projeye ait "${WEIRD}" mock sunucusu tarafından kullanılıyor.`,
    },
  ]

  for (const c of cases) {
    const info = {
      kind: 'in-use',
      host: '127.0.0.1',
      port: 4010,
      by: WEIRD,
      ...(c.otherProject ? { otherProject: true } : {}),
    }
    const label = c.otherProject ? 'another project' : 'this project'
    it(`EN, ${label}: the name stays byte-identical`, () => {
      setLocale('en')
      const text = describeListenError(info, 'fallback')
      expect(text.startsWith(c.en)).toBe(true)
      expect(mockIpcErrorText({ error: 'main', errorInfo: info }, 'x')).toBe(text)
    })
    it(`TR, ${label}: the name stays byte-identical`, () => {
      setLocale('tr')
      expect(describeListenError(info, 'fallback').startsWith(c.tr)).toBe(true)
    })
  }

  it('an unknown key still falls back to main’s text', () => {
    setLocale('tr')
    expect(describeListenError({ kind: 'other', host: 'h', port: 1 }, 'main text')).toBe(
      'main text',
    )
  })
})

describe('the refused-move toast template', () => {
  it('keeps `$&` in the address / detail verbatim (EN and TR)', () => {
    for (const locale of ['en', 'tr'] as const) {
      setLocale(locale)
      const text = t('mock.portChangeRefused', { address: '127.0.0.1:4010', detail: WEIRD })
      expect(text.endsWith(WEIRD)).toBe(true)
      expect(text).toContain('127.0.0.1:4010')
    }
  })
})
