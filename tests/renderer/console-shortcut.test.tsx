/**
 * Issue #257 follow-up — the footer Console button's tooltip advertises
 * Mod+Alt+C (⌥⌘C on macOS, Ctrl+Alt+C elsewhere), so the chord must actually
 * toggle the console through the global `useKeyboardShortcuts` listener, and
 * every shortcut list (cheatsheet, Settings -> Shortcuts, command palette)
 * names it in the same notation.
 *
 * macOS: Option rewrites `e.key` (Cmd+Option+C arrives as key "ç"), so the
 * match is on `e.code === 'KeyC'` as well. Plain Mod+C (copy) must NOT toggle
 * and must not be preventDefault-ed.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, renderHook, screen } from '@testing-library/react'

const platform = { mac: false }
vi.mock('../../src/renderer/lib/platform', () => ({
  isMac: () => platform.mac,
  modKeyLabel: () => (platform.mac ? 'Cmd' : 'Ctrl'),
}))

import { useKeyboardShortcuts } from '../../src/renderer/lib/keyboard-shortcuts'
import { getShortcutEntries, useCommandActions } from '../../src/renderer/lib/command-registry'
import { ShortcutsPane } from '../../src/renderer/components/modals/project-settings-panes'
import Footer from '../../src/renderer/components/layout/Footer'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useUIStore } from '../../src/renderer/stores/ui.store'

function press(init: KeyboardEventInit): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  window.dispatchEvent(ev)
  return ev
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {}
  setLocale('en')
  useUIStore.setState({ locale: 'en', showConsolePanel: false } as never)
})
afterEach(() => {
  cleanup()
  platform.mac = false
})

describe('Mod+Alt+C toggles the console', () => {
  it('Windows / Linux: Ctrl+Alt+C toggles open and closed', () => {
    renderHook(() => useKeyboardShortcuts())
    const ev = press({ key: 'c', code: 'KeyC', ctrlKey: true, altKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(useUIStore.getState().showConsolePanel).toBe(true)
    press({ key: 'c', code: 'KeyC', ctrlKey: true, altKey: true })
    expect(useUIStore.getState().showConsolePanel).toBe(false)
  })

  it('macOS: Cmd+Option+C toggles although Option turned the key into "ç"', () => {
    platform.mac = true
    renderHook(() => useKeyboardShortcuts())
    press({ key: 'ç', code: 'KeyC', metaKey: true, altKey: true })
    expect(useUIStore.getState().showConsolePanel).toBe(true)
  })

  it('also fires with focus inside an input, like the sibling Mod shortcuts', () => {
    renderHook(() => useKeyboardShortcuts())
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        altKey: true,
      }),
    )
    expect(useUIStore.getState().showConsolePanel).toBe(true)
    input.remove()
  })

  it('plain Mod+C (copy) is left alone', () => {
    renderHook(() => useKeyboardShortcuts())
    const ev = press({ key: 'c', code: 'KeyC', ctrlKey: true })
    expect(ev.defaultPrevented).toBe(false)
    expect(useUIStore.getState().showConsolePanel).toBe(false)
  })

  it('Mod+Shift+Alt+C is not the console chord', () => {
    renderHook(() => useKeyboardShortcuts())
    press({ key: 'C', code: 'KeyC', ctrlKey: true, altKey: true, shiftKey: true })
    expect(useUIStore.getState().showConsolePanel).toBe(false)
  })

  it('Windows AltGr typing (Ctrl+Alt producing another character) is not swallowed', () => {
    renderHook(() => useKeyboardShortcuts())
    const ev = press({ key: 'ć', code: 'KeyC', ctrlKey: true, altKey: true })
    expect(ev.defaultPrevented).toBe(false)
    expect(useUIStore.getState().showConsolePanel).toBe(false)
  })
})

describe('every shortcut surface names the console chord the same way', () => {
  for (const mac of [false, true]) {
    const chord = mac ? '⌥⌘C' : 'Ctrl+Alt+C'
    it(`mac=${mac}: footer tooltip, cheatsheet, settings, palette`, () => {
      platform.mac = mac
      render(<Footer />)
      expect(screen.getByTestId('footer-console').getAttribute('title')).toContain(chord)
      cleanup()

      expect(getShortcutEntries().map((e) => e.keys)).toContain(chord)

      render(<ShortcutsPane />)
      const cells = Array.from(document.querySelectorAll('tbody td:nth-child(2)')).map(
        (c) => c.textContent?.trim() ?? '',
      )
      expect(cells).toContain(chord)
      cleanup()

      const { result } = renderHook(() => useCommandActions())
      const action = result.current.find((a) => a.id === 'view.toggleConsole')
      expect(action?.shortcut).toBe(chord)
      action?.run()
      expect(useUIStore.getState().showConsolePanel).toBe(true)
      useUIStore.setState({ showConsolePanel: false } as never)
    })
  }
})
