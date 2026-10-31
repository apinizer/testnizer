/**
 * Issue #257 (item: shortcut notation differs) — the ONE formatter.
 *
 * CONTRACT — new module `src/renderer/lib/shortcut-format.ts`:
 *
 *   export type ShortcutToken = 'Mod' | 'Ctrl' | 'Alt' | 'Shift' | string
 *   export function formatShortcut(
 *     tokens: readonly ShortcutToken[],
 *     opts?: { mac?: boolean },        // default: isMac() from ./platform
 *   ): string
 *
 *   - It imports ONLY `isMac` from './platform' (other tests mock that module
 *     with `{ isMac }` alone — do not import `modKeyLabel` there).
 *   - Tokens may come in any order; the output order is canonical.
 *     'Mod' = Cmd on macOS, Ctrl elsewhere; 'Ctrl' = the real Control key.
 *   - macOS: symbols, NO separators, Apple's modifier order ⌃ ⌥ ⇧ ⌘ then the
 *     key:  ['Mod','T'] -> "⌘T",  ['Mod','Shift','S'] -> "⇧⌘S",
 *           ['Mod','Alt','W'] -> "⌥⌘W", ['Mod','Alt','Right'] -> "⌥⌘→".
 *   - Windows/Linux: words joined by '+', order Ctrl, Alt, Shift, key:
 *           "Ctrl+T", "Ctrl+Shift+S", "Ctrl+Alt+W", "Ctrl+Alt+→".
 *   - Key names: single letters upper-cased; 'Right'/'Left'/'Up'/'Down' ->
 *     → ← ↑ ↓ on BOTH platforms; 'Enter' stays "Enter" ("⌘Enter" / "Ctrl+Enter");
 *     any other key (',' '?' 'Tab' 'F5') is kept as written.
 *   - A lone key ('?') is returned as is.
 *   - Never emits "Cmd", " + " (spaced plus) or "Control".
 *
 * Red now: the module does not exist (three notations live in command-registry
 * "Cmd+K", project-settings-panes "⌘ + K", Workbench "⌘T").
 */
import { describe, expect, it } from 'vitest'
import { formatShortcut } from '../../src/renderer/lib/shortcut-format'

const mac = { mac: true }
const pc = { mac: false }

describe('formatShortcut — macOS', () => {
  it('Mod + key', () => {
    expect(formatShortcut(['Mod', 'T'], mac)).toBe('⌘T')
    expect(formatShortcut(['Mod', ','], mac)).toBe('⌘,')
    expect(formatShortcut(['Mod', 'Enter'], mac)).toBe('⌘Enter')
  })
  it("Apple's order is ⌃ ⌥ ⇧ ⌘ whatever the input order", () => {
    expect(formatShortcut(['Mod', 'Shift', 'S'], mac)).toBe('⇧⌘S')
    expect(formatShortcut(['Shift', 'Mod', 'S'], mac)).toBe('⇧⌘S')
    expect(formatShortcut(['Mod', 'Alt', 'W'], mac)).toBe('⌥⌘W')
    expect(formatShortcut(['Alt', 'Mod', 'W'], mac)).toBe('⌥⌘W')
    expect(formatShortcut(['Ctrl', 'Alt', 'Shift', 'Mod', 'K'], mac)).toBe('⌃⌥⇧⌘K')
  })
  it('arrows', () => {
    expect(formatShortcut(['Mod', 'Alt', 'Right'], mac)).toBe('⌥⌘→')
    expect(formatShortcut(['Mod', 'Alt', 'Left'], mac)).toBe('⌥⌘←')
  })
  it('letters are upper-cased, a lone key is untouched', () => {
    expect(formatShortcut(['Mod', 't'], mac)).toBe('⌘T')
    expect(formatShortcut(['?'], mac)).toBe('?')
  })
})

describe('formatShortcut — Windows / Linux', () => {
  it('Mod becomes Ctrl, joined with +', () => {
    expect(formatShortcut(['Mod', 'T'], pc)).toBe('Ctrl+T')
    expect(formatShortcut(['Mod', ','], pc)).toBe('Ctrl+,')
    expect(formatShortcut(['Mod', 'Enter'], pc)).toBe('Ctrl+Enter')
  })
  it('canonical order Ctrl, Alt, Shift, key', () => {
    expect(formatShortcut(['Mod', 'Shift', 'S'], pc)).toBe('Ctrl+Shift+S')
    expect(formatShortcut(['Shift', 'Mod', 'S'], pc)).toBe('Ctrl+Shift+S')
    expect(formatShortcut(['Alt', 'Mod', 'W'], pc)).toBe('Ctrl+Alt+W')
  })
  it('arrows and a lone key', () => {
    expect(formatShortcut(['Mod', 'Alt', 'Right'], pc)).toBe('Ctrl+Alt+→')
    expect(formatShortcut(['?'], pc)).toBe('?')
  })
})

describe('never the old notations', () => {
  const samples: string[] = []
  for (const opts of [mac, pc]) {
    for (const toks of [
      ['Mod', 'T'],
      ['Mod', 'Shift', 'S'],
      ['Mod', 'Alt', 'W'],
      ['Mod', 'Enter'],
    ]) {
      samples.push(formatShortcut(toks, opts))
    }
  }
  it('no "Cmd", no spaced plus, no "Control"', () => {
    for (const s of samples) {
      expect(s).not.toMatch(/Cmd|\s\+\s|Control/)
    }
  })
})
