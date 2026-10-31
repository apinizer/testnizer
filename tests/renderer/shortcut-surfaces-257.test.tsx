/**
 * Issue #257 (item: shortcut notation) — every surface goes through
 * `formatShortcut` (lib/shortcut-format.ts, see shortcut-format-257.test.ts).
 *
 * CONTRACT per surface:
 *  - command palette / cheatsheet: `shortcutLabel(key, {shift})` in
 *    lib/command-registry.ts == formatShortcut(['Mod', ...(shift?['Shift']:[]), key]);
 *    `getShortcutEntries()[i].keys` use it too.
 *  - Settings -> Shortcuts (`ShortcutsPane`): the key cell of every row is
 *    formatShortcut(...) — "Ctrl+T" / "⌘T", never "Ctrl + T" / "⌘ + T". Tab
 *    switching rows are Mod+Alt+Right / Mod+Alt+Left.
 *  - Header "Save project" tooltip: the i18n value no longer hardcodes the
 *    chord; Header appends ` (${formatShortcut(['Mod','S'])})` (keep the key
 *    `header.saveProjectHint`, but its EN/TR value is just "Save Project" /
 *    "Projeyi Kaydet"). Footer console tooltip uses formatShortcut(['Mod','Alt','C'])
 *    instead of the literal "Alt+Ctrl+C"; LeftPanelCollapseButton uses
 *    formatShortcut(['Mod','B']) instead of `${modKeyLabel()}+B`; Workbench's
 *    tab context menu drops its private cmdOrCtrl/altCmdOrCtrl.
 *  - the static guard + i18n check live in shortcut-guard-257.test.ts.
 *
 * The platform is injected through a mocked `isMac` only.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'

const platform = { mac: false }
vi.mock('../../src/renderer/lib/platform', () => ({ isMac: () => platform.mac }))

import { getShortcutEntries, shortcutLabel } from '../../src/renderer/lib/command-registry'
import { ShortcutsPane } from '../../src/renderer/components/modals/project-settings-panes'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useUIStore } from '../../src/renderer/stores/ui.store'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {}
  setLocale('en')
  useUIStore.setState({ locale: 'en' })
})
afterEach(() => cleanup())

/** Literal expectations per platform (no import of the formatter: red for the right reason). */
const EXPECT = {
  true: {
    newTab: '⌘T',
    palette: '⌘K',
    saveProject: '⇧⌘S',
    settings: '⌘,',
    send: '⌘Enter',
    next: '⌥⌘→',
    prev: '⌥⌘←',
  },
  false: {
    newTab: 'Ctrl+T',
    palette: 'Ctrl+K',
    saveProject: 'Ctrl+Shift+S',
    settings: 'Ctrl+,',
    send: 'Ctrl+Enter',
    next: 'Ctrl+Alt+→',
    prev: 'Ctrl+Alt+←',
  },
} as const

for (const mac of [true, false]) {
  const X = EXPECT[String(mac) as 'true' | 'false']
  describe(`${mac ? 'macOS' : 'Windows/Linux'}`, () => {
    beforeEach(() => {
      platform.mac = mac
    })

    it('shortcutLabel (command palette)', () => {
      expect(shortcutLabel('T')).toBe(X.newTab)
      expect(shortcutLabel('K')).toBe(X.palette)
      expect(shortcutLabel('S', { shift: true })).toBe(X.saveProject)
      expect(shortcutLabel(',')).toBe(X.settings)
    })

    it('cheatsheet entries use the same notation', () => {
      const keys = getShortcutEntries().map((e) => e.keys)
      expect(keys).toContain(X.palette)
      expect(keys).toContain(X.saveProject)
      expect(keys).toContain(X.send)
      expect(keys).toContain('?')
      for (const k of keys) expect(k).not.toMatch(/Cmd|\s\+\s/)
    })

    it('Settings -> Shortcuts shows the palette notation (palette == settings)', () => {
      render(<ShortcutsPane />)
      const cells = Array.from(document.querySelectorAll('tbody td:nth-child(2)')).map(
        (c) => c.textContent?.trim() ?? '',
      )
      expect(cells.length).toBeGreaterThanOrEqual(10)
      for (const c of cells) expect(c).not.toMatch(/\s\+\s|Cmd/)
      expect(cells).toContain(X.newTab)
      expect(cells).toContain(X.palette)
      expect(cells).toContain(X.settings)
      expect(cells).toContain(X.send)
      expect(cells).toContain(X.next)
      expect(cells).toContain(X.prev)
    })
  })
}
