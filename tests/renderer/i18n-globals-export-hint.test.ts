/**
 * Issue #289 / #277 — two strings that described 1.5 behaviour:
 *   - the script help said `pm.globals` is "visible to every project"; since
 *     1.6.0 Globals belong to the project;
 *   - the Settings → Data export hint listed the formats without Postman v3,
 *     which the export dialog offers (folder and JSON).
 * The hint is pinned to the dialog's own format list so it cannot drift again.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { setLocale, t } from '../../src/renderer/lib/i18n'
import { PROJECT_EXPORT_FORMATS } from '../../src/renderer/lib/project-export'

afterEach(() => setLocale('en'))

describe('Globals help and export hint (issue #289 / #277)', () => {
  for (const locale of ['en', 'tr'] as const) {
    it(`${locale}: pm.globals help says the Globals are the project's`, () => {
      setLocale(locale)
      const text = t('scriptHelp.api.globals')
      expect(text).not.toMatch(/every project|Her projeden/i)
      expect(text).toMatch(locale === 'en' ? /this project/ : /bu projenin/)
    })

    it(`${locale}: the export hint names every format of the export dialog`, () => {
      setLocale(locale)
      const hint = t('data.exportDesc')
      for (const f of PROJECT_EXPORT_FORMATS) {
        // "Postman v3 (folder)" / "Postman v3 (JSON)" are named together as "Postman v3 (…)".
        const label = t(f.labelKey).replace(/\s*\(.*\)$/, '')
        expect(hint, f.labelKey).toContain(label)
      }
    })
  }
})
