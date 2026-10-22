/**
 * Issue #243 — the Socket.IO editor's bearer token never reaches localStorage.
 *
 * The per-tab snapshot (`testnizer-socketio`) used to carry `bearerToken` in
 * plain text. It is write-only now, like the key-material passwords: a literal
 * token stays in memory for the session (a tab switch keeps it), the snapshot
 * stores `''` + `bearerTokenWithheld`. A `{{variable}}`-only token carries no
 * secret and is stored as typed.
 *
 * The data-loss trap: the token is ALSO saved on the row (Ctrl+S →
 * `metadata.socketio.bearerToken`). After a restart the tab comes back from
 * localStorage with an empty token field; Ctrl+S must not write that empty
 * field over the stored token. `saveActiveRequestInPlace` reads the token back
 * from the row first (`lib/socketio-saved-token.ts`).
 *
 * Pinned here:
 *   1. the stored snapshot has no literal token — active AND cached tab; the
 *      in-memory state still has it; `{{var}}` tokens are stored;
 *   2. a snapshot an older build wrote with the token is cleaned on load;
 *   3. save with token → restart (modules re-imported, stores rehydrate from
 *      localStorage) → Ctrl+S path → the row still holds the token; also for
 *      a saved request and a suite item, and the activation reload;
 *   4. a row that cannot be read blocks the save instead of wiping the token;
 *   5. the editor's hint renders in EN and TR.
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import SocketIOEditor from '../../src/renderer/components/protocols/SocketIOEditor'
import type { Tab } from '../../src/renderer/types'

const TOKEN = 'sio-LITERAL-secret-9c41'
const KEY = 'testnizer-socketio'

function raw(key: string): string {
  return window.localStorage.getItem(key) ?? ''
}

/** Every localStorage value — the token must not sit under ANY key. */
function allStorage(): string {
  const out: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)
    if (k) out.push(`${k}=${window.localStorage.getItem(k) ?? ''}`)
  }
  return out.join('\n')
}

type Row = Record<string, unknown>

/** In-memory rows behind the three IPC families the save/open paths use. */
function installRowApi() {
  const endpoints = new Map<string, Row>()
  const saved = new Map<string, Row>()
  const items = new Map<string, Row>()
  const ok = (data: unknown) => ({ success: true, data })
  const api = {
    endpoint: {
      update: vi.fn(async (id: string, patch: Row) => {
        endpoints.set(id, { ...endpoints.get(id), ...patch })
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(endpoints.get(id) ?? null)),
    },
    savedRequest: {
      update: vi.fn(async (id: string, patch: Row) => {
        const next: Row = { ...(saved.get(id) ?? {}) }
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v
        saved.set(id, next)
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(saved.get(id) ?? null)),
    },
    testSuiteItem: {
      update: vi.fn(async (id: string, patch: Row) => {
        items.set(id, { ...items.get(id), ...patch })
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(items.get(id) ?? null)),
    },
  }
  ;(window as unknown as { api: typeof api }).api = api
  return { api, endpoints, saved, items }
}

/** Fresh module graph — every store rehydrates from localStorage like a launch. */
async function launch() {
  vi.resetModules()
  const [tabs, sio, save, ws, token] = await Promise.all([
    import('../../src/renderer/stores/tabs.store'),
    import('../../src/renderer/stores/socketio.store'),
    import('../../src/renderer/lib/save-active-request'),
    import('../../src/renderer/stores/workspace.store'),
    import('../../src/renderer/lib/socketio-saved-token'),
  ])
  // The APIs-tree refresh after a save is not under test.
  ws.useWorkspaceStore.setState({ refreshTree: async () => {} } as never)
  return {
    useTabsStore: tabs.useTabsStore,
    useSocketIOStore: sio.useSocketIOStore,
    saveActiveRequestInPlace: save.saveActiveRequestInPlace,
    ensureSocketioTokenLoaded: token.ensureSocketioTokenLoaded,
  }
}

/** The bearer token on a saved row, whichever column family holds it. */
function storedToken(row: Row | undefined, column: 'request_schema' | 'metadata'): unknown {
  const json = JSON.parse(String(row?.[column] ?? '{}')) as Row
  const meta = (column === 'metadata' ? json : json.metadata) as Row | undefined
  return (meta?.socketio as Row | undefined)?.bearerToken
}

let rows: ReturnType<typeof installRowApi>

beforeEach(() => {
  window.localStorage.clear()
  rows = installRowApi()
})

// ─── 1–2. The snapshot ─────────────────────────────────────────────────

describe('Socket.IO snapshot never holds a literal bearer token (issue #243)', () => {
  it('strips the token from the active and cached tab; memory keeps it', async () => {
    const { useSocketIOStore } = await launch()
    useSocketIOStore.setState({
      _currentTabId: 'tab-1',
      _tabStates: new Map([
        [
          'tab-2',
          { ...useSocketIOStore.getState(), url: 'http://cached.test', bearerToken: TOKEN },
        ],
      ]),
      url: 'http://config.example.test',
    })
    useSocketIOStore.getState().setBearerToken(TOKEN)

    const stored = raw(KEY)
    expect(allStorage()).not.toContain(TOKEN)
    expect(stored).toContain('http://config.example.test')
    expect(stored).toContain('http://cached.test')
    // Session memory is untouched — Connect and a tab switch still use it.
    expect(useSocketIOStore.getState().bearerToken).toBe(TOKEN)
    expect(useSocketIOStore.getState()._tabStates.get('tab-2')?.bearerToken).toBe(TOKEN)
    useSocketIOStore.getState().switchToTab('tab-2')
    useSocketIOStore.getState().switchToTab('tab-1')
    expect(useSocketIOStore.getState().bearerToken).toBe(TOKEN)
    expect(allStorage()).not.toContain(TOKEN)
  })

  it('stores a {{variable}}-only token as typed — it carries no secret', async () => {
    const { useSocketIOStore } = await launch()
    useSocketIOStore.setState({ _currentTabId: 'tab-1', _tabStates: new Map() })
    useSocketIOStore.getState().setBearerToken('{{sioToken}}')
    expect(raw(KEY)).toContain('{{sioToken}}')
    const again = await launch()
    expect(again.useSocketIOStore.getState().bearerToken).toBe('{{sioToken}}')
    expect(again.useSocketIOStore.getState().bearerTokenWithheld).toBe(false)
  })

  it('cleans a snapshot an older build wrote with the token, on load', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        current: { url: 'http://config.example.test', bearerToken: TOKEN },
        _currentTabId: 'tab-1',
        _tabStates: [['tab-2', { url: 'http://cached.test', bearerToken: TOKEN }]],
      }),
    )
    const { useSocketIOStore } = await launch()
    const s = useSocketIOStore.getState()
    expect(s.url).toBe('http://config.example.test')
    expect(s.bearerToken).toBe('')
    expect(s.bearerTokenWithheld).toBe(true)
    expect(s._tabStates.get('tab-2')?.bearerToken).toBe('')
    expect(s._tabStates.get('tab-2')?.bearerTokenWithheld).toBe(true)
    // Rewritten at once, without waiting for a state change.
    expect(allStorage()).not.toContain(TOKEN)
    expect(raw(KEY)).toContain('http://config.example.test')
  })

  it('an explicit edit clears the withheld flag — a deliberate clear is saved as clear', async () => {
    const { useSocketIOStore } = await launch()
    useSocketIOStore.setState({ _currentTabId: 'tab-1', _tabStates: new Map() })
    useSocketIOStore.getState().setBearerToken(TOKEN)
    const again = await launch()
    expect(again.useSocketIOStore.getState().bearerTokenWithheld).toBe(true)
    again.useSocketIOStore.getState().setBearerToken('')
    expect(again.useSocketIOStore.getState().bearerTokenWithheld).toBe(false)
  })
})

// ─── 3–4. The data-loss trap ───────────────────────────────────────────

const BINDINGS: Array<{
  name: string
  bind: Partial<Tab>
  rowsOf: () => Map<string, Row>
  id: string
  column: 'request_schema' | 'metadata'
}> = [
  {
    name: 'endpoint',
    bind: { endpointId: 'ep-1' },
    rowsOf: () => rows.endpoints,
    id: 'ep-1',
    column: 'request_schema',
  },
  {
    name: 'saved request',
    bind: { savedRequestId: 'sr-1' },
    rowsOf: () => rows.saved,
    id: 'sr-1',
    column: 'metadata',
  },
  {
    name: 'suite item',
    bind: { testSuiteItemId: 'it-1' },
    rowsOf: () => rows.items,
    id: 'it-1',
    column: 'request_schema',
  },
]

/** Session 1: open a bound Socket.IO tab, type the token, Ctrl+S. */
async function saveWithToken(bind: Partial<Tab>) {
  const s1 = await launch()
  s1.useTabsStore.setState({
    tabs: [
      {
        id: 'tab-sio',
        name: 'Chat',
        protocol: 'socketio',
        method: 'GET',
        url: 'http://sio.test',
        isDirty: false,
        ...bind,
      } as Tab,
    ],
    activeTabId: 'tab-sio',
  })
  s1.useSocketIOStore.getState().switchToTab('tab-sio')
  s1.useSocketIOStore.getState().setUrl('http://sio.test')
  s1.useSocketIOStore.getState().setBearerToken(TOKEN)
  expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
  expect(allStorage()).not.toContain(TOKEN)
}

describe('restart + Ctrl+S keeps the token stored on the row (issue #243)', () => {
  for (const b of BINDINGS) {
    it(`${b.name}: the untouched empty field does not wipe the saved token`, async () => {
      await saveWithToken(b.bind)
      expect(storedToken(b.rowsOf().get(b.id), b.column)).toBe(TOKEN)

      // Restart: tabs + Socket.IO tab state come back from localStorage only.
      const s2 = await launch()
      expect(allStorage()).not.toContain(TOKEN)
      expect(s2.useTabsStore.getState().activeTabId).toBe('tab-sio')
      expect(s2.useSocketIOStore.getState().bearerToken).toBe('')

      // Ctrl+S straight away — no tree click, no activation reload.
      expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
      expect(storedToken(b.rowsOf().get(b.id), b.column)).toBe(TOKEN)
      // The editor now has it again too.
      expect(s2.useSocketIOStore.getState().bearerToken).toBe(TOKEN)
    })
  }

  it('the activation reload brings the token back without dirtying the tab', async () => {
    await saveWithToken({ endpointId: 'ep-1' })
    const s2 = await launch()
    const tab = s2.useTabsStore.getState().tabs[0]
    expect(await s2.ensureSocketioTokenLoaded(tab)).toBe(true)
    expect(s2.useSocketIOStore.getState().bearerToken).toBe(TOKEN)
    expect(s2.useSocketIOStore.getState().bearerTokenWithheld).toBe(false)
    expect(s2.useTabsStore.getState().tabs[0].isDirty).toBe(false)
    expect(allStorage()).not.toContain(TOKEN)
  })

  it('a token typed while the reload is in flight wins', async () => {
    await saveWithToken({ endpointId: 'ep-1' })
    const s2 = await launch()
    const pending = s2.ensureSocketioTokenLoaded(s2.useTabsStore.getState().tabs[0])
    s2.useSocketIOStore.getState().setBearerToken('typed-after-restart')
    await pending
    expect(s2.useSocketIOStore.getState().bearerToken).toBe('typed-after-restart')
  })

  it('a row that cannot be read blocks the save instead of writing an empty token', async () => {
    await saveWithToken({ endpointId: 'ep-1' })
    const s2 = await launch()
    rows.api.endpoint.get.mockResolvedValueOnce({ success: false } as never)
    const res = await s2.saveActiveRequestInPlace()
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/bearer token/i)
    expect(storedToken(rows.endpoints.get('ep-1'), 'request_schema')).toBe(TOKEN)
  })

  it('an unsaved draft tab simply has no token after a restart', async () => {
    const s1 = await launch()
    s1.useTabsStore.setState({
      tabs: [
        {
          id: 'tab-d',
          name: 'Draft',
          protocol: 'socketio',
          method: 'GET',
          url: '',
          isDirty: false,
        } as Tab,
      ],
      activeTabId: 'tab-d',
    })
    s1.useSocketIOStore.getState().switchToTab('tab-d')
    s1.useSocketIOStore.getState().setBearerToken(TOKEN)
    const s2 = await launch()
    expect(await s2.ensureSocketioTokenLoaded(s2.useTabsStore.getState().tabs[0])).toBe(true)
    expect(s2.useSocketIOStore.getState().bearerToken).toBe('')
    expect(s2.useSocketIOStore.getState().bearerTokenWithheld).toBe(false)
  })
})

// ─── 5. The hint ───────────────────────────────────────────────────────

describe('Socket.IO token hint (issue #243)', () => {
  for (const [locale, text] of [
    ['en', /not kept after a restart unless the request is saved/],
    ['tr', /istek kaydedilmedikçe yeniden başlatmadan sonra korunmaz/],
  ] as const) {
    it(`renders under the token field in ${locale}`, () => {
      // The editor's `useTranslation` follows the UI store's locale.
      useUIStore.setState({ locale })
      setLocale(locale)
      render(<SocketIOEditor />)
      const hint = screen.getByTestId('socketio-token-hint')
      expect(hint.textContent).toMatch(text)
      // The example is the literal syntax in both locales: `{{değişken}}` typed
      // as shown would resolve nothing.
      expect(hint.textContent).toContain('{{variable}}')
      expect(hint.textContent).not.toContain('{{değişken}}')
      expect(screen.getByTestId('socketio-bearer-token').getAttribute('aria-describedby')).toBe(
        hint.id,
      )
      cleanup()
      useUIStore.setState({ locale: 'en' })
      setLocale('en')
    })
  }
})
