/**
 * Issue #257 (item: shortcut notation) — guards that need no new module.
 * See shortcut-format-257.test.ts / shortcut-surfaces-257.test.tsx for the
 * formatter contract.
 *
 *  - header.saveProjectHint (EN + TR) no longer hardcodes "(Cmd+S)"; Header
 *    appends the formatted chord itself.
 *  - STATIC GUARD: outside lib/shortcut-format.ts, no non-comment line under
 *    src/renderer/components/ contains "Cmd+", "Ctrl+", "⌘", "Alt+Ctrl" or
 *    `modKeyLabel` — nobody formats a shortcut by hand any more.
 * Red now: i18n value + Footer, LeftPanelCollapseButton, project-settings-panes,
 * Workbench.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { t, setLocale } from '../../src/renderer/lib/i18n'

describe('i18n values do not hardcode the chord', () => {
  it('header.saveProjectHint is chord-free in EN and TR', () => {
    setLocale('en')
    expect(t('header.saveProjectHint')).not.toMatch(/Cmd|Ctrl|⌘|\(/)
    setLocale('tr')
    expect(t('header.saveProjectHint')).not.toMatch(/Cmd|Ctrl|⌘|\(/)
  })
})

describe('static guard: nobody formats a shortcut by hand in components/', () => {
  const root = resolve(__dirname, '../../src/renderer/components')
  const files: string[] = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e)) files.push(p)
    }
  }
  walk(root)

  it('no hand-written Cmd+/Ctrl+/⌘/Alt+Ctrl/modKeyLabel in non-comment lines', () => {
    const offenders: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const s = line.trim()
          if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*') || s.startsWith('{/*'))
            return
          if (/Cmd\+|Ctrl\+|⌘|Alt\+Ctrl|modKeyLabel/.test(line)) {
            offenders.push(`${f.replace(root, 'components')}:${i + 1}: ${s.slice(0, 90)}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })
})
