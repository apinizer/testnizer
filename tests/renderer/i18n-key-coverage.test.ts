/**
 * Every `t('…')` the renderer calls must resolve in BOTH locales.
 *
 * This exists because the sweep at the end of the v1.5.0 QA round found two keys
 * (`tools.jwt.loading`, `tools.jwt.jwksLoadFailed`) that were referenced by new
 * code but never added to the dictionary — the JWKS "Load" failure line would
 * have rendered the raw key name to the user. Nothing else would have caught it:
 * a missing key is not a type error, and it only shows on an error path.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const RENDERER = resolve(__dirname, '../../src/renderer')
const I18N = join(RENDERER, 'lib/i18n.ts')

/** Every key defined in the dictionary, with how many locales define it. */
function definedKeys(): Map<string, number> {
  const src = readFileSync(I18N, 'utf8')
  const counts = new Map<string, number>()
  for (const m of src.matchAll(/^ {4}'([a-zA-Z0-9_.]+)':/gm)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
  }
  return counts
}

/** Every `t('…')` argument used anywhere in the renderer (excluding i18n.ts). */
function usedKeys(): Set<string> {
  const used = new Set<string>()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry) || full === I18N) continue
      for (const m of readFileSync(full, 'utf8').matchAll(/\bt\('([a-zA-Z0-9_.]+)'\)/g)) {
        // Only dotted, namespaced keys — the regex would otherwise pick up
        // unrelated single-word calls like `at('a')`.
        if (m[1].includes('.')) used.add(m[1])
      }
    }
  }
  walk(RENDERER)
  return used
}

describe('i18n key coverage', () => {
  it('defines every key the renderer asks for', () => {
    const defined = definedKeys()
    const missing = [...usedKeys()].filter((k) => !defined.has(k)).sort()
    expect(missing, `Referenced but not defined in i18n.ts:\n${missing.join('\n')}`).toEqual([])
  })

  it('defines every key in BOTH locales', () => {
    // A key present once is in en or tr but not both, so one locale silently
    // falls through to the raw key.
    const oneLocaleOnly = [...definedKeys()]
      .filter(([, count]) => count !== 2)
      .map(([key, count]) => `${key} (${count}×)`)
      .sort()
    expect(
      oneLocaleOnly,
      `Keys not defined exactly twice (once per locale):\n${oneLocaleOnly.join('\n')}`,
    ).toEqual([])
  })
})
