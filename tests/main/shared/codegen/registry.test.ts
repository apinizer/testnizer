/**
 * Issue #280 — the Language → Variant catalogue: every variant has a label,
 * a Monaco language, an options schema and a generator that renders the
 * whole request matrix without throwing; ids are unique; the 11 pre-#280 ids
 * are still variant ids.
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_VARIANTS,
  CODEGEN_LANGUAGES,
  findVariant,
  languageOfVariant,
  normalizeRequest,
  renderSnippet,
  resolveOptions,
} from '../../../../src/shared/codegen'
import { BASELINE_CASES, EXTRA_CASES } from '../../../fixtures/codegen-cases'

const LEGACY = [
  'curl',
  'js-fetch',
  'js-axios',
  'python-requests',
  'java-okhttp',
  'go',
  'php',
  'ruby',
  'swift',
  'kotlin',
  'csharp',
]

describe('codegen registry', () => {
  it('keeps the 11 pre-#280 ids as variants', () => {
    for (const id of LEGACY) expect(findVariant(id), id).toBeTruthy()
    expect(languageOfVariant('js-axios')?.id).toBe('nodejs')
    expect(languageOfVariant('php')?.label).toBe('PHP')
    expect(findVariant('php')?.label).toBe('cURL')
  })

  it('cURL is first and has the three shells as variants', () => {
    expect(CODEGEN_LANGUAGES[0].id).toBe('curl')
    expect(CODEGEN_LANGUAGES[0].variants.map((v) => v.id)).toEqual([
      'curl',
      'curl-cmd',
      'curl-powershell',
    ])
  })

  it('variant ids are unique and every variant belongs to its language', () => {
    const ids = ALL_VARIANTS.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const lang of CODEGEN_LANGUAGES) {
      expect(lang.label).toBeTruthy()
      expect(lang.variants.length).toBeGreaterThan(0)
      for (const v of lang.variants) expect(v.language).toBe(lang.id)
    }
    expect(ALL_VARIANTS.length).toBe(31)
  })

  it('every variant has a label, a Monaco language and a well-formed options schema', () => {
    for (const v of ALL_VARIANTS) {
      expect(v.label, v.id).toBeTruthy()
      expect(v.monaco, v.id).toBeTruthy()
      expect(typeof v.generate).toBe('function')
      const optionIds = v.options.map((o) => o.id)
      expect(new Set(optionIds).size, v.id).toBe(optionIds.length)
      for (const o of v.options) {
        expect(o.labelKey, `${v.id}.${o.id}`).toMatch(/^codeGen\.option\./)
        if (o.type === 'enum') expect(o.choices?.some((c) => c.value === o.default)).toBe(true)
        else expect(typeof o.default).toBe(o.type)
      }
    }
  })

  it('every variant renders every case of the matrix, with the method and the host', () => {
    for (const v of ALL_VARIANTS) {
      for (const c of [...BASELINE_CASES, ...EXTRA_CASES]) {
        const out = renderSnippet(v.id, normalizeRequest(c.req))
        expect(out.trim().length, `${v.id} × ${c.name}`).toBeGreaterThan(0)
        if (!c.req.url.startsWith('{{'))
          expect(out, `${v.id} × ${c.name}`).toContain('api.example.com')
      }
    }
  })

  it('resolveOptions fills defaults and drops values of the wrong type', () => {
    const v = findVariant('js-fetch')!
    const o = resolveOptions(v.options, {
      indentCount: 'x' as unknown as number,
      indentType: 'tab',
      bogus: 1,
    })
    expect(o.indentCount).toBe(2)
    expect(o.indentType).toBe('tab')
    expect('bogus' in o).toBe(false)
  })

  it('an unknown variant id renders a not-supported comment', () => {
    expect(renderSnippet('cobol', normalizeRequest(BASELINE_CASES[0].req))).toContain(
      'not supported',
    )
  })
})
