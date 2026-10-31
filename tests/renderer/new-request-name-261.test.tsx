/**
 * Issue #261 — the "New Request" tab name (and the tree's "New Endpoint") were
 * hard-coded English in the Turkish UI.
 *
 * CONTRACT — `src/renderer/lib/endpoint-name.ts` (already the home of
 * `isDefaultRequestName`, issue #201) gains:
 *
 *   defaultRequestTabName(): string
 *       `t('tabStrip.newRequest')` at CALL time ("New Request" / "Yeni İstek").
 *       Every place that opens a blank scratch tab uses it: Workbench.tsx
 *       (handleNewRequestTab + the Ctrl+T handler), AppShell.tsx (menu:newTab),
 *       QuickTestShell.tsx, lib/keyboard-shortcuts.ts (Ctrl+N) and
 *       lib/command-registry.ts (nav.newTab — a sixth site the issue missed).
 *
 *   isScratchTabName(name: string | null | undefined): boolean
 *       the ONE rule for "this is the blank scratch tab's name": trimmed name
 *       equals `tabStrip.newRequest` in ANY locale (`valuesInAllLocales`) or
 *       the legacy literal "New Request". `isBlankScratchTab` (lib/tab-kind.ts)
 *       uses it instead of comparing the literal, and `deriveEndpointName`
 *       skips such a URL segment like it skipped "New Request". Names that
 *       are not scratch names stay not scratch in both locales — the issue #69
 *       trap: "New Endpoint", "Yeni Uç Nokta", "Yeni Endpoint".
 *
 *   defaultRequestFor(protocol): { name: string; method: string }
 *       what the APIs tree's "Add Request" creates: HTTP's name is
 *       `t('welcome.newEndpointName')` ("New Endpoint" / "Yeni Uç Nokta");
 *       every other protocol returns its `DEFAULT_REQUEST_BY_PROTOCOL` entry
 *       unchanged, an unknown protocol falls back to HTTP (as TreeView did).
 *       `DEFAULT_REQUEST_BY_PROTOCOL` stays exported and unchanged;
 *       `isDefaultRequestName` keeps recognising both languages (issue #201),
 *       so a request created in Turkish is still a placeholder in English and
 *       vice versa. TreeView's handleAddRequest calls `defaultRequestFor`.
 *
 * Existing tab/row names are NEVER bulk-renamed on a locale switch.
 */
import * as React from 'react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import * as endpointName from '../../src/renderer/lib/endpoint-name'
import { isBlankScratchTab } from '../../src/renderer/lib/tab-kind'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useCommandActions } from '../../src/renderer/lib/command-registry'
import { useKeyboardShortcuts } from '../../src/renderer/lib/keyboard-shortcuts'
import { useLocale } from './helpers/default-locale-shim'

// Absent until the implementation lands: access through the namespace so a
// missing export fails an assertion instead of the module load.
const mod = endpointName as unknown as {
  defaultRequestTabName?: () => string
  isScratchTabName?: (n: string | null | undefined) => boolean
  defaultRequestFor?: (p: string) => { name: string; method: string }
}
const call = <T,>(fn: T | undefined, name: string): T => {
  expect(fn, `endpoint-name.ts must export ${name}`).toBeTypeOf('function')
  return fn as T
}

const blank = (name: string) => ({
  name,
  url: '',
  endpointId: undefined,
  savedRequestId: undefined,
  testSuiteItemId: undefined,
})

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  useLocale('en')
})

describe('defaultRequestTabName', () => {
  it('follows the UI language, at call time', () => {
    const fn = call(mod.defaultRequestTabName, 'defaultRequestTabName')
    useLocale('en')
    expect(fn()).toBe('New Request')
    useLocale('tr')
    expect(fn()).toBe('Yeni İstek')
  })
})

describe('isScratchTabName / isBlankScratchTab — one rule, both languages', () => {
  it.each(['en', 'tr'] as const)('recognises both names with the UI in %s', (locale) => {
    const is = call(mod.isScratchTabName, 'isScratchTabName')
    useLocale(locale)
    expect(is('New Request')).toBe(true)
    expect(is('Yeni İstek')).toBe(true)
    expect(is('  Yeni İstek ')).toBe(true)
    expect(isBlankScratchTab(blank('New Request'))).toBe(true)
    expect(isBlankScratchTab(blank('Yeni İstek'))).toBe(true)
  })

  it('a TR-created blank tab is still blank after switching to EN (and the reverse)', () => {
    useLocale('tr')
    const trName = call(mod.defaultRequestTabName, 'defaultRequestTabName')()
    useLocale('en')
    expect(isBlankScratchTab(blank(trName))).toBe(true)
    const enName = call(mod.defaultRequestTabName, 'defaultRequestTabName')()
    useLocale('tr')
    expect(isBlankScratchTab(blank(enName))).toBe(true)
  })

  it.each(['en', 'tr'] as const)(
    'issue #69 trap: tree defaults and user names are NOT scratch tabs (%s)',
    (locale) => {
      const is = call(mod.isScratchTabName, 'isScratchTabName')
      useLocale(locale)
      for (const name of [
        'New Endpoint',
        'Yeni Uç Nokta',
        'Yeni Endpoint',
        'My call',
        'Yeni İstek 2',
        '',
      ]) {
        expect(is(name), name).toBe(false)
        expect(isBlankScratchTab(blank(name)), name).toBe(false)
      }
      expect(is(null)).toBe(false)
      expect(is(undefined)).toBe(false)
    },
  )

  it('identity still wins: a stored request called "Yeni İstek" is never blank', () => {
    expect(isBlankScratchTab({ ...blank('Yeni İstek'), endpointId: 'ep-1' })).toBe(false)
    expect(isBlankScratchTab({ ...blank('Yeni İstek'), url: 'https://x.test' })).toBe(false)
  })

  it('a URL segment that is a scratch name never becomes a request name', () => {
    expect(endpointName.deriveEndpointName('https://api.test/items/Yeni%20%C4%B0stek')).toBe(
      'items',
    )
    expect(endpointName.deriveEndpointName('{{baseUrl}}/New%20Request')).toBeNull()
  })
})

describe('defaultRequestFor — the APIs tree default', () => {
  it('HTTP: "New Endpoint" in EN, "Yeni Uç Nokta" in TR; method GET', () => {
    const f = call(mod.defaultRequestFor, 'defaultRequestFor')
    useLocale('en')
    expect(f('http')).toEqual({ name: 'New Endpoint', method: 'GET' })
    useLocale('tr')
    expect(f('http')).toEqual({ name: 'Yeni Uç Nokta', method: 'GET' })
  })

  it('other protocols keep their table entry; unknown falls back to HTTP', () => {
    const f = call(mod.defaultRequestFor, 'defaultRequestFor')
    useLocale('tr')
    expect(f('grpc')).toEqual(endpointName.DEFAULT_REQUEST_BY_PROTOCOL.grpc)
    expect(f('soap')).toEqual(endpointName.DEFAULT_REQUEST_BY_PROTOCOL.soap)
    expect(f('no-such-protocol')).toEqual(f('http'))
  })

  it('issue #201 guard: placeholders of either language are default names', () => {
    for (const name of [
      'New Endpoint',
      'Yeni Uç Nokta',
      'Yeni Endpoint',
      'Yeni İstek',
      'New Request',
    ]) {
      expect(endpointName.isDefaultRequestName(name), name).toBe(true)
    }
    expect(endpointName.isDefaultRequestName('customers')).toBe(false)
    useLocale('tr')
    expect(
      endpointName.autoRequestName('http', 'New Endpoint', 'https://x.test/api/customers'),
    ).toBe('customers')
    useLocale('en')
    expect(
      endpointName.autoRequestName('http', 'Yeni Uç Nokta', 'https://x.test/api/customers'),
    ).toBe('customers')
  })

  it('TreeView creates the row through defaultRequestFor', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/renderer/components/sidebar/TreeView.tsx'),
      'utf8',
    )
    expect(src).toContain('defaultRequestFor(')
    expect(src).not.toMatch(/DEFAULT_REQUEST_BY_PROTOCOL\[/)
  })
})

describe('the sites that open a blank tab', () => {
  it('command palette "New tab" names the tab in the UI language', () => {
    useLocale('tr')
    const { result } = renderHook(() => useCommandActions())
    act(() => result.current.find((a) => a.id === 'nav.newTab')!.run())
    expect(useTabsStore.getState().tabs.map((t) => t.name)).toEqual(['Yeni İstek'])
  })

  it('Ctrl+N ("New item") names the tab in the UI language', () => {
    useLocale('tr')
    renderHook(() => useKeyboardShortcuts())
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, metaKey: true, bubbles: true }),
      )
    })
    expect(useTabsStore.getState().tabs.map((t) => t.name)).toEqual(['Yeni İstek'])
  })

  it('EN guard: both still say "New Request"', () => {
    useLocale('en')
    const { result } = renderHook(() => useCommandActions())
    act(() => result.current.find((a) => a.id === 'nav.newTab')!.run())
    expect(useTabsStore.getState().tabs[0].name).toBe('New Request')
  })

  it('static guard: no src/renderer file hard-codes the tab name (i18n.ts aside)', () => {
    const root = resolve(__dirname, '../../src/renderer')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry) && entry !== 'i18n.ts') {
          const src = readFileSync(full, 'utf8')
          // `name: 'New Request'` — a comment mentioning the phrase is fine.
          if (/name:\s*['"]New Request['"]/.test(src)) offenders.push(full.replace(root, ''))
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})

describe('existing names are never bulk-renamed (guard)', () => {
  it('a tab opened in EN keeps its name when the UI switches to TR', () => {
    useLocale('en')
    useTabsStore.getState().openTab({
      id: 't1',
      name: 'New Request',
      protocol: 'http',
      method: 'GET',
      url: '',
    })
    useLocale('tr')
    expect(useTabsStore.getState().tabs[0].name).toBe('New Request')
    // ...and it is still the blank scratch tab.
    expect(isBlankScratchTab(useTabsStore.getState().tabs[0])).toBe(true)
  })
})

// React is only needed for the JSX transform of this file's classic runtime.
void React
