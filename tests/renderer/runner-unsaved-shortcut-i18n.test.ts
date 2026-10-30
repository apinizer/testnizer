/**
 * Issue #257 follow-up — the Runner's "unsaved edits" / "orphaned request"
 * warnings named the save chord as a literal "(Ctrl+S)", so macOS users were
 * told to press Ctrl+S. The i18n values now carry a `{shortcut}` placeholder
 * that `dirty-run-guard.ts` fills from `formatShortcut(['Mod','S'])`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platform = { mac: false }
vi.mock('../../src/renderer/lib/platform', () => ({
  isMac: () => platform.mac,
  modKeyLabel: () => (platform.mac ? 'Cmd' : 'Ctrl'),
}))

const warn = vi.fn()
let tabsState: { tabs: Array<Record<string, unknown>>; activeTabId: string | null }
const saveActiveRequestInPlace = vi.fn(async () => ({ success: true }) as Record<string, unknown>)
vi.mock('../../src/renderer/stores/tabs.store', () => ({
  useTabsStore: { getState: () => tabsState },
}))
vi.mock('../../src/renderer/lib/save-active-request', () => ({
  saveActiveRequestInPlace: () => saveActiveRequestInPlace(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { warning: (m: string) => warn(m), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const { saveDirtyRunItemsBeforeRun } = await import('../../src/renderer/lib/dirty-run-guard')
const { setLocale, t } = await import('../../src/renderer/lib/i18n')

const KEYS = ['runner.unsavedRunItems', 'runner.orphanedRunItems'] as const

const tab = (over: Record<string, unknown>) => ({
  id: 'tab',
  name: 'Req',
  protocol: 'http',
  isDirty: false,
  isLoading: false,
  ...over,
})

/** One unsaved background tab + an active tab whose row was deleted. */
async function runWarnings(): Promise<string[]> {
  tabsState = {
    activeTabId: 'a',
    tabs: [
      tab({ id: 'a', testSuiteItemId: 'item-1', isDirty: true, name: 'Gone' }),
      tab({ id: 'b', testSuiteItemId: 'item-2', isDirty: true, name: 'Background' }),
    ],
  }
  saveActiveRequestInPlace.mockImplementationOnce(async () => {
    tabsState.tabs = tabsState.tabs.map((x) =>
      x.id === 'a' ? { ...x, testSuiteItemId: undefined } : x,
    )
    return { success: false, notApplicable: true, orphaned: true }
  })
  await saveDirtyRunItemsBeforeRun(['item-1', 'item-2'])
  return warn.mock.calls.map((c) => String(c[0]))
}

beforeEach(() => warn.mockClear())
afterEach(() => {
  setLocale('en')
  platform.mac = false
})

describe('runner unsaved / orphaned warnings name the platform save chord', () => {
  for (const locale of ['en', 'tr'] as const) {
    it(`${locale}: the i18n values carry {shortcut}, never a literal chord`, () => {
      setLocale(locale)
      for (const key of KEYS) {
        expect(t(key)).toContain('{shortcut}')
        expect(t(key)).not.toMatch(/Ctrl\+|Cmd\+|⌘/)
      }
    })

    it(`${locale} on macOS: both toasts say ⌘S, not Ctrl+S`, async () => {
      setLocale(locale)
      platform.mac = true
      const msgs = await runWarnings()
      expect(msgs).toHaveLength(2)
      for (const m of msgs) {
        expect(m).toContain('(⌘S)')
        expect(m).not.toContain('Ctrl+S')
        expect(m).not.toContain('{shortcut}')
      }
    })

    it(`${locale} on Windows / Linux: both toasts say Ctrl+S`, async () => {
      setLocale(locale)
      const msgs = await runWarnings()
      expect(msgs).toHaveLength(2)
      for (const m of msgs) {
        expect(m).toContain('(Ctrl+S)')
        expect(m).not.toContain('{shortcut}')
      }
    })
  }
})
