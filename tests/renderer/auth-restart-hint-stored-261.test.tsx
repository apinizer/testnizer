/**
 * Issue #261 (last bullet) — "The restart hint under Auth stays after the
 * request is saved with a literal token. Its text says 'unless the request is
 * saved', so it misleads once saved."
 *
 * DECISION (acceptance item 10): the hint (`auth-credential-restart-hint`,
 * AuthTab.tsx ~101: today only `hasLiteralAuthCredential`) is hidden ONLY while
 * the current literal credential EQUALS the value successfully stored in the
 * bound row (saved request / endpoint / suite item):
 *   - saved with token A, field still A            -> hidden
 *   - saved with A, then B typed                   -> shown again
 *   - saved with A, B typed, A typed back          -> hidden (equality, not an
 *     "is dirty" shortcut)
 *   - after a restart + the withheld reload (field refilled from the row) -> hidden
 *   - the save failed (`success:false`)            -> shown
 *   - an unsaved draft (tab bound to no row)       -> shown (nothing is stored)
 *   - the row could not be read / no row yet       -> shown
 * All literal credential fields of the active auth type are compared
 * (`HTTP_CREDENTIALS` paths under `auth.<type>.`); `{{var}}` / empty never
 * showed the hint in the first place.
 *
 * HOW THE STORED VALUE IS KNOWN — free choice, the tests only watch the
 * outcome: either re-read the bound row with `readBoundRow(tab)`
 * (lib/withheld-credentials.ts) when the tab's binding changes and after each
 * save / reload (the tab turning clean via `markDirty(id,false)`), or record
 * the stored auth in MEMORY inside `saveActiveRequestInPlace` /
 * `ensureWithheldCredentialsLoaded` / the Save As modal. BLOCKER: the stored
 * value lives in memory only — never in a tab snapshot, never in
 * localStorage (that would bring back the issue #244 leak; the test runs the
 * `expectNoLiteral` check after every step).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { AuthConfig, Tab } from '../../src/renderer/types'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { saveActiveRequestInPlace } from '../../src/renderer/lib/save-active-request'
import { activateTabStores } from '../../src/renderer/lib/activate-tab'
import { ensureWithheldCredentialsLoaded } from '../../src/renderer/lib/withheld-credentials'
import AuthTab from '../../src/renderer/components/request/AuthTab'
import { useLocale } from './helpers/default-locale-shim'

const A = 'LITERAL-token-261-A'
const B = 'LITERAL-token-261-B'
const HINT = 'auth-credential-restart-hint'

type Row = Record<string, unknown>

let saveResult: { success: boolean; error?: string } = { success: true }

function installRowApi() {
  const endpoints = new Map<string, Row>()
  const saved = new Map<string, Row>()
  const items = new Map<string, Row>()
  const ok = (data: unknown) => ({ success: true, data })
  const upsert = (m: Map<string, Row>) =>
    vi.fn(async (id: string, patch: Row) => {
      if (!saveResult.success) return saveResult
      const next: Row = { ...(m.get(id) ?? {}) }
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v
      m.set(id, next)
      return ok(true)
    })
  ;(window as unknown as { api: unknown }).api = {
    endpoint: {
      update: upsert(endpoints),
      get: vi.fn(async (id: string) => ok(endpoints.get(id) ?? null)),
    },
    savedRequest: {
      update: upsert(saved),
      get: vi.fn(async (id: string) => ok(saved.get(id) ?? null)),
    },
    testSuiteItem: {
      update: upsert(items),
      get: vi.fn(async (id: string) => ok(items.get(id) ?? null)),
    },
  }
}

/** No literal credential under ANY localStorage key (issue #244). */
function expectNoLiteral(): void {
  const all: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)
    if (k) all.push(`${k}=${window.localStorage.getItem(k) ?? ''}`)
  }
  for (const s of [A, B]) expect(all.join('\n')).not.toContain(s)
}

const BINDINGS: Array<[string, Partial<Tab>]> = [
  ['saved request', { savedRequestId: 'sr-1' }],
  ['endpoint', { endpointId: 'ep-1' }],
  ['suite item', { testSuiteItemId: 'it-1' }],
]

function openTab(bind: Partial<Tab>): Tab {
  useTabsStore.setState({
    tabs: [
      {
        id: 'tab-x',
        name: 'X',
        protocol: 'http',
        method: 'GET',
        url: '',
        isDirty: false,
        ...bind,
      } as Tab,
    ],
    activeTabId: 'tab-x',
  })
  activateTabStores('tab-x')
  useRequestStore.getState().setUrl('https://api.test/a')
  return useTabsStore.getState().tabs[0]
}

const bearer = (token: string): AuthConfig => ({ type: 'bearer', bearer: { token } })
const type = (token: string): void =>
  act(() => {
    useRequestStore.getState().setAuth(bearer(token))
  })
const save = async (): Promise<{ success: boolean }> => {
  let res: { success: boolean } = { success: false }
  await act(async () => {
    res = (await saveActiveRequestInPlace()) as { success: boolean }
  })
  return res
}
const hintShown = (): boolean => screen.queryByTestId(HINT) !== null
const expectHidden = () => waitFor(() => expect(hintShown()).toBe(false))
const expectShown = () => waitFor(() => expect(hintShown()).toBe(true))

beforeEach(() => {
  window.localStorage.clear()
  saveResult = { success: true }
  installRowApi()
  useWorkspaceStore.setState({ refreshTree: async () => {} } as never)
  useLocale('en')
})
afterEach(() => {
  cleanup()
  useLocale('en')
})

describe.each(BINDINGS)('%s tab', (_name, bind) => {
  it('hidden after a successful save, shown for another token, hidden again for the stored one', async () => {
    openTab(bind)
    type(A)
    render(<AuthTab />)
    // Nothing stored yet.
    await expectShown()

    expect(await save()).toMatchObject({ success: true })
    await expectHidden()
    expectNoLiteral()

    type(B)
    await expectShown()

    type(A)
    await expectHidden()
    expectNoLiteral()
  })

  it('a newly typed different token after the save shows it again, and saving B hides it', async () => {
    openTab(bind)
    type(A)
    render(<AuthTab />)
    expect(await save()).toMatchObject({ success: true })
    await expectHidden()
    type(B)
    await expectShown()
    expect(await save()).toMatchObject({ success: true })
    await expectHidden()
    type(A) // A is no longer what the row holds
    await expectShown()
    expectNoLiteral()
  })

  it('after a restart the withheld reload refills the field from the row: hidden', async () => {
    const tab = openTab(bind)
    type(A)
    render(<AuthTab />)
    expect(await save()).toMatchObject({ success: true })
    await expectHidden()

    // The stores come back from localStorage with the token blank + marked.
    act(() => {
      useRequestStore.setState({
        auth: bearer(''),
        withheldCredentials: ['auth.bearer.token'],
      } as never)
    })
    await act(async () => {
      expect(await ensureWithheldCredentialsLoaded(tab)).toEqual({ ok: true })
    })
    expect(useRequestStore.getState().auth.bearer?.token).toBe(A)
    await expectHidden()
    expectNoLiteral()
  })

  it('the save failed: the hint stays', async () => {
    openTab(bind)
    type(A)
    render(<AuthTab />)
    saveResult = { success: false, error: 'disk full' }
    await save()
    await expectShown()
  })
})

describe('no stored value', () => {
  it('an unsaved draft keeps the hint, also after a save attempt that cannot apply', async () => {
    openTab({})
    type(A)
    render(<AuthTab />)
    await expectShown()
    await save()
    await expectShown()
    expectNoLiteral()
  })

  it('a bound tab whose row does not exist yet shows the hint', async () => {
    openTab({ savedRequestId: 'sr-missing' })
    type(A)
    render(<AuthTab />)
    await expectShown()
  })

  it('a different literal in an OTHER auth field of the active type still counts', async () => {
    openTab({ savedRequestId: 'sr-1' })
    act(() => {
      useRequestStore.getState().setAuth({
        type: 'oauth2',
        oauth2: {
          grantType: 'client_credentials',
          tokenUrl: 'https://i.test/t',
          clientId: 'c',
          clientSecret: A,
        },
      } as AuthConfig)
    })
    render(<AuthTab />)
    expect(await save()).toMatchObject({ success: true })
    await expectHidden()
    act(() => {
      useRequestStore.getState().setAuth({
        type: 'oauth2',
        oauth2: {
          grantType: 'client_credentials',
          tokenUrl: 'https://i.test/t',
          clientId: 'c',
          clientSecret: B,
        },
      } as AuthConfig)
    })
    await expectShown()
  })
})

describe('guards that already hold', () => {
  it('empty and {{var}} values never show the hint', async () => {
    openTab({ savedRequestId: 'sr-1' })
    render(<AuthTab />)
    type('')
    expect(hintShown()).toBe(false)
    type('{{api_token}}')
    expect(hintShown()).toBe(false)
  })
})
