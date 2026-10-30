/**
 * Issue #257 follow-up — shortcuts that were shown but did nothing (or did
 * nothing on macOS):
 *
 *  - Mod+Alt+Right / Mod+Alt+Left (next / previous tab) were listed in
 *    Settings -> Shortcuts but bound nowhere. They now go through the global
 *    `useKeyboardShortcuts` listener (wrapping at the ends), and the palette
 *    and cheatsheet name them in the same notation. They fire with focus in
 *    an input too: the chord needs BOTH modifiers, while word jump is
 *    Option+Arrow (macOS) / Ctrl+Arrow (Windows / Linux) and line jump is
 *    Cmd+Arrow — none of them hold Mod and Alt together. Shift variants
 *    (selection) are left alone.
 *  - Mod+Alt+W (force close, Workbench) matched `e.key === 'w'`; on macOS
 *    Option turns the key into "∑", so it never fired there. The physical key
 *    (`e.code === 'KeyW'`) decides on macOS now.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook } from '@testing-library/react'

const platform = { mac: false }
vi.mock('../../src/renderer/lib/platform', () => ({
  isMac: () => platform.mac,
  modKeyLabel: () => (platform.mac ? 'Cmd' : 'Ctrl'),
}))
vi.mock('../../src/renderer/lib/activate-tab', () => ({
  activateTabStores: vi.fn(),
  switchActiveTab: vi.fn(),
}))
vi.mock('../../src/renderer/components/shared/MonacoWrapperImpl', () => ({
  default: () => null,
}))
;(window as unknown as { api: unknown }).api = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => ({ success: true, data: [] }) }) },
)

const { useKeyboardShortcuts } = await import('../../src/renderer/lib/keyboard-shortcuts')
const { getShortcutEntries, useCommandActions } =
  await import('../../src/renderer/lib/command-registry')
const Workbench = (await import('../../src/renderer/components/layout/Workbench')).default
const { useTabsStore } = await import('../../src/renderer/stores/tabs.store')
import type { Tab } from '../../src/renderer/types'

const tab = (id: string, over: Partial<Tab> = {}): Tab =>
  ({ id, name: id, protocol: 'http', method: 'GET', url: '', isDirty: false, ...over }) as Tab

function press(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(ev)
  })
  return ev
}

const mod = (): KeyboardEventInit => (platform.mac ? { metaKey: true } : { ctrlKey: true })

beforeEach(() => {
  useTabsStore.setState({ tabs: [tab('a'), tab('b'), tab('c')], activeTabId: 'a' })
})
afterEach(() => {
  cleanup()
  platform.mac = false
  vi.restoreAllMocks()
})

for (const mac of [false, true]) {
  describe(`mac=${mac}: Mod+Alt+Right / Left switch tabs`, () => {
    beforeEach(() => {
      platform.mac = mac
    })

    it('Right goes to the next tab and wraps; Left goes back and wraps', () => {
      renderHook(() => useKeyboardShortcuts())
      const ev = press({ key: 'ArrowRight', code: 'ArrowRight', altKey: true, ...mod() })
      expect(ev.defaultPrevented).toBe(true)
      expect(useTabsStore.getState().activeTabId).toBe('b')
      press({ key: 'ArrowRight', code: 'ArrowRight', altKey: true, ...mod() })
      press({ key: 'ArrowRight', code: 'ArrowRight', altKey: true, ...mod() })
      expect(useTabsStore.getState().activeTabId).toBe('a')
      press({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true, ...mod() })
      expect(useTabsStore.getState().activeTabId).toBe('c')
    })

    it('also fires with focus in a text input', () => {
      renderHook(() => useKeyboardShortcuts())
      const input = document.createElement('input')
      document.body.appendChild(input)
      press({ key: 'ArrowRight', code: 'ArrowRight', altKey: true, ...mod() }, input)
      expect(useTabsStore.getState().activeTabId).toBe('b')
      input.remove()
    })

    it('Mod+Arrow (line jump) and Mod+Shift+Alt+Arrow (selection) are left alone', () => {
      renderHook(() => useKeyboardShortcuts())
      const plain = press({ key: 'ArrowRight', code: 'ArrowRight', ...mod() })
      expect(plain.defaultPrevented).toBe(false)
      press({ key: 'ArrowRight', code: 'ArrowRight', altKey: true, shiftKey: true, ...mod() })
      expect(useTabsStore.getState().activeTabId).toBe('a')
    })

    it('palette and cheatsheet name the chord like Settings -> Shortcuts', () => {
      const next = mac ? '⌥⌘→' : 'Ctrl+Alt+→'
      const prev = mac ? '⌥⌘←' : 'Ctrl+Alt+←'
      const { result } = renderHook(() => useCommandActions())
      expect(result.current.find((a) => a.id === 'nav.nextTab')?.shortcut).toBe(next)
      expect(result.current.find((a) => a.id === 'nav.prevTab')?.shortcut).toBe(prev)
      const keys = getShortcutEntries().map((e) => e.keys)
      expect(keys).toContain(next)
      expect(keys).toContain(prev)
    })
  })

  describe(`mac=${mac}: Mod+Alt+W force-closes a dirty tab`, () => {
    beforeEach(() => {
      platform.mac = mac
      ;(Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = vi.fn()
    })

    it('closes without asking, even though Option rewrote the key on macOS', () => {
      useTabsStore.setState({ tabs: [tab('a', { isDirty: true }), tab('b')], activeTabId: 'a' })
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      render(<Workbench />)
      // macOS reports Option+W as "∑"; Windows / Linux report "w".
      press({ key: mac ? '∑' : 'w', code: 'KeyW', altKey: true, ...mod() })
      expect(confirm).not.toHaveBeenCalled()
      expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(['b'])
    })

    it('plain Mod+W on a dirty tab still asks first', () => {
      useTabsStore.setState({ tabs: [tab('a', { isDirty: true }), tab('b')], activeTabId: 'a' })
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      render(<Workbench />)
      press({ key: 'w', code: 'KeyW', ...mod() })
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(['a', 'b'])
    })
  })
}
