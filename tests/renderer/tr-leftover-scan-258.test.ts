/**
 * Issue #258 / issue #261 — regression scan. The English strings that leaked
 * into the Turkish UI must not come back as literals: any user-visible text in
 * components/tools, components/protocols and lib/protocol-chip.ts (the
 * "New Request" tab name has its own scan in new-request-name-261.test.tsx) goes through
 * `t('…')`. (The rendered, per-language checks are in tools-tr-leftovers-258,
 * http-status-tr-258, sse-chip-tooltip-261 and clipped-placeholders-261; this
 * is the cheap static net for the same strings.)
 *
 * The strings below are the exact ones found in the product review. They stay
 * in i18n.ts as EN dictionary values — that file is excluded.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const RENDERER = resolve(__dirname, '../../src/renderer')

const LEAKED = [
  'global — find all matches',
  'case-insensitive',
  'multiline — ^/$ match per line',
  'dotAll — . matches newlines',
  'unicode — full Unicode support',
  'sticky — match from lastIndex',
  'Sample input text',
  'placeholder="secret key"',
  'placeholder="custom namespace UUID"',
  'aria-label="Custom namespace UUID"',
  'placeholder="paste a UUID to inspect"',
  'placeholder="Hello"',
  '(multi-byte)',
  "'Server-Sent Events'",
]

function files(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files(full, acc)
    else if (/\.tsx?$/.test(entry)) acc.push(full)
  }
  return acc
}

describe('no hard-coded English from the 1.6.0 review in tools / protocols', () => {
  const scanned = [
    ...files(join(RENDERER, 'components/tools')),
    ...files(join(RENDERER, 'components/protocols')),
    join(RENDERER, 'lib/protocol-chip.ts'),
  ]

  for (const needle of LEAKED) {
    it(`${JSON.stringify(needle)} is not a literal in a component`, () => {
      const hits = scanned
        .filter((f) => readFileSync(f, 'utf8').includes(needle))
        .map((f) => f.replace(RENDERER, ''))
      expect(hits).toEqual([])
    })
  }
})
