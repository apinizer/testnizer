/**
 * Issue #280 — every Generate Code variant over the request matrix
 * (`tests/fixtures/codegen-cases.ts`). The 11 pre-#280 ids are pinned for the
 * baseline matrix by `tests/renderer/baseline-codegen.test.ts`; here they get
 * the extra cases, every other variant gets both. Plus option probes: the
 * same request with non-default options, per variant.
 */
import { describe, expect, it } from 'vitest'
import { ALL_VARIANTS } from '../../../../src/shared/codegen'
import { generateSnippet } from '../../../../src/renderer/lib/code-generator'
import { BASELINE_CASES, EXTRA_CASES, kv } from '../../../fixtures/codegen-cases'

const LEGACY = new Set([
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
])

for (const v of ALL_VARIANTS) {
  describe(`${v.language} / ${v.label} (${v.id})`, () => {
    const cases = LEGACY.has(v.id) ? EXTRA_CASES : [...BASELINE_CASES, ...EXTRA_CASES]
    for (const c of cases) {
      it(c.name, () => {
        expect(generateSnippet(v.id, c.req, c.options)).toMatchSnapshot()
      })
    }
    it('non-default options', () => {
      const req = {
        method: 'POST',
        url: 'https://api.example.com/items',
        params: [],
        headers: [kv('X-Trace', 'abc')],
        body: { type: 'json' as const, content: '  {"a":1}  ' },
      }
      const variantOptions = {
        indentCount: 3,
        indentType: 'space',
        trimRequestBody: true,
        followRedirect: false,
        requestTimeout: 3000,
        asyncAwait: false,
        includeBoilerplate: true,
        multiLine: false,
        longFormat: true,
        silent: true,
      }
      expect(generateSnippet(v.id, req, { variantOptions })).toMatchSnapshot()
    })
  })
}
