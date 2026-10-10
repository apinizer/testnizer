/**
 * Issue #185 — the request timeout (and HTTP's redirects / SSL) is saved and
 * restored. Before: the Settings tab lived only in the per-tab localStorage
 * cache — no Ctrl+S branch wrote it, no open path read it back, so "set a
 * timeout, Ctrl+S, close, reopen" came back with the default, and Run never
 * saw it. MCP had no timeout control at all.
 *
 * One key for both protocols: top-level `timeout` (ms) in the endpoint /
 * suite item `request_schema`, and the same top-level keys inside the
 * saved_request `metadata` JSON. Each case saves through the real
 * `saveActiveRequestInPlace`, "closes" the tab, and reopens through the real
 * open path against an in-memory row store behind `window.api`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveActiveRequestInPlace } from '../../src/renderer/lib/save-active-request'
import { openEndpointTab, openSuiteItemTab } from '../../src/renderer/lib/open-endpoint-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { Tab } from '../../src/renderer/types'

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
        // Mirrors the repo: an omitted / undefined field keeps the old value.
        const prev = saved.get(id) ?? {}
        const next: Row = { ...prev }
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

let rows: ReturnType<typeof installRowApi>

function openEditorTab(tab: Partial<Tab> & { id: string }): void {
  useTabsStore.setState({
    tabs: [{ name: 'Req', method: 'GET', url: 'https://api.test', isDirty: false, ...tab } as Tab],
    activeTabId: tab.id,
  })
  useRequestStore.getState().switchToTab(tab.id)
  useMcpStore.getState().switchToTab(tab.id)
}

/** Close every tab and drop its cached state — the reopen starts from scratch. */
function closeAll(): void {
  for (const t of useTabsStore.getState().tabs) {
    useRequestStore.getState().removeTabState(t.id)
    useMcpStore.getState().removeTabState(t.id)
  }
  useTabsStore.setState({ tabs: [], activeTabId: null })
  // Land the live slices on a throwaway tab so nothing of the closed one leaks.
  useRequestStore.getState().switchToTab('scratch')
  useMcpStore.getState().switchToTab('scratch')
}

function setHttpSettings(): void {
  const r = useRequestStore.getState()
  r.setUrl('https://api.test/slow')
  r.setRequestTimeout(4500)
  r.setFollowRedirects(false)
  r.setMaxRedirects(2)
  r.setSslVerification(false)
}

function expectHttpSettingsRestored(): void {
  const r = useRequestStore.getState()
  expect(r.requestTimeout).toBe(4500)
  expect(r.followRedirects).toBe(false)
  expect(r.maxRedirects).toBe(2)
  expect(r.sslVerification).toBe(false)
}

const activeDirty = (): boolean => {
  const s = useTabsStore.getState()
  return s.tabs.find((t) => t.id === s.activeTabId)?.isDirty ?? false
}

beforeEach(() => {
  rows = installRowApi()
  useWorkspaceStore.setState({ refreshTree: vi.fn().mockResolvedValue(undefined) })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
})

describe('issue #185 — HTTP request settings survive Ctrl+S → close → reopen', () => {
  it('endpoint row: top-level timeout / redirects / ssl in request_schema, restored on reopen', async () => {
    rows.endpoints.set('ep-1', {
      id: 'ep-1',
      name: 'Slow',
      method: 'GET',
      path: '/slow',
      protocol: 'http',
    })
    openEditorTab({ id: 'tab-ep-1', protocol: 'http', endpointId: 'ep-1' })
    setHttpSettings()

    expect((await saveActiveRequestInPlace()).success).toBe(true)
    const schema = JSON.parse(String(rows.endpoints.get('ep-1')?.request_schema))
    expect(schema).toMatchObject({
      timeout: 4500,
      followRedirects: false,
      maxRedirects: 2,
      sslVerification: false,
    })

    closeAll()
    expect(useRequestStore.getState().requestTimeout).toBeNull()
    await openEndpointTab('ep-1')
    expectHttpSettingsRestored()
    expect(activeDirty()).toBe(false)
  })

  it('saved request row: the keys ride in metadata, restored on reopen', async () => {
    rows.saved.set('sr-1', {
      id: 'sr-1',
      name: 'Slow',
      method: 'GET',
      url: '/slow',
      protocol: 'http',
    })
    openEditorTab({ id: 'tab-sr-1', protocol: 'http', savedRequestId: 'sr-1' })
    setHttpSettings()

    expect((await saveActiveRequestInPlace()).success).toBe(true)
    expect(JSON.parse(String(rows.saved.get('sr-1')?.metadata))).toMatchObject({
      timeout: 4500,
      followRedirects: false,
      maxRedirects: 2,
      sslVerification: false,
    })

    closeAll()
    await openEndpointTab('sr-1')
    expectHttpSettingsRestored()
  })

  it('test suite item: top-level keys in request_schema, restored on reopen', async () => {
    rows.items.set('it-1', {
      id: 'it-1',
      suite_id: 's',
      folder_id: null,
      protocol: 'http',
      name: 'Slow',
      method: 'GET',
      url: '/slow',
      request_schema: '{}',
      assertions: '[]',
    })
    openEditorTab({ id: 'tab-it-1', protocol: 'http', testSuiteItemId: 'it-1' })
    setHttpSettings()

    expect((await saveActiveRequestInPlace()).success).toBe(true)
    expect(JSON.parse(String(rows.items.get('it-1')?.request_schema))).toMatchObject({
      timeout: 4500,
      followRedirects: false,
      maxRedirects: 2,
      sslVerification: false,
    })

    closeAll()
    await openSuiteItemTab('it-1')
    expectHttpSettingsRestored()
  })

  it('clearing the timeout (inherit) drops the key — a stale value does not survive', async () => {
    rows.saved.set('sr-2', { id: 'sr-2', name: 'R', method: 'GET', url: '/r', protocol: 'http' })
    openEditorTab({ id: 'tab-sr-2', protocol: 'http', savedRequestId: 'sr-2' })
    useRequestStore.getState().setRequestTimeout(9000)
    await saveActiveRequestInPlace()
    useRequestStore.getState().setRequestTimeout(null)
    await saveActiveRequestInPlace()
    expect(JSON.parse(String(rows.saved.get('sr-2')?.metadata))).not.toHaveProperty('timeout')

    closeAll()
    await openEndpointTab('sr-2')
    expect(useRequestStore.getState().requestTimeout).toBeNull()
  })

  it('a row imported before #185 with only `timeoutSeconds` opens with that timeout', async () => {
    rows.endpoints.set('ep-old', {
      id: 'ep-old',
      name: 'Old',
      method: 'GET',
      path: '/old',
      protocol: 'http',
      request_schema: JSON.stringify({ url: '/old', timeoutSeconds: 15 }),
    })
    await openEndpointTab('ep-old')
    expect(useRequestStore.getState().requestTimeout).toBe(15_000)
  })
})

describe('issue #185 — MCP timeout survives Ctrl+S → close → reopen', () => {
  it('setting it marks the tab dirty; endpoint save writes top-level `timeout`; reopen restores it clean', async () => {
    rows.endpoints.set('mcp-1', {
      id: 'mcp-1',
      name: 'MCP',
      method: 'GET',
      path: '',
      protocol: 'mcp',
    })
    openEditorTab({ id: 'tab-mcp-1', protocol: 'mcp', endpointId: 'mcp-1' })
    useMcpStore.setState({ url: 'http://x/mcp' })
    useMcpStore.getState().setRequestTimeout(7000)
    expect(activeDirty()).toBe(true)

    expect((await saveActiveRequestInPlace()).success).toBe(true)
    const schema = JSON.parse(String(rows.endpoints.get('mcp-1')?.request_schema))
    expect(schema.timeout).toBe(7000)
    // MCP carries no HTTP-only settings.
    expect(schema).not.toHaveProperty('followRedirects')

    closeAll()
    expect(useMcpStore.getState().requestTimeout).toBeNull()
    await openEndpointTab('mcp-1')
    expect(useMcpStore.getState()._currentTabId).toBe(useTabsStore.getState().activeTabId)
    expect(useMcpStore.getState().requestTimeout).toBe(7000)
    expect(activeDirty()).toBe(false)
  })

  it('saved request: `timeout` next to the mcp block in metadata, restored on reopen', async () => {
    rows.saved.set('mcp-sr', { id: 'mcp-sr', name: 'MCP', method: 'GET', url: '', protocol: 'mcp' })
    openEditorTab({ id: 'tab-mcp-sr', protocol: 'mcp', savedRequestId: 'mcp-sr' })
    useMcpStore.setState({ url: 'http://x/mcp' })
    useMcpStore.getState().setRequestTimeout(0)

    await saveActiveRequestInPlace()
    const meta = JSON.parse(String(rows.saved.get('mcp-sr')?.metadata))
    expect(meta.timeout).toBe(0)
    expect(meta.mcp.url).toBe('http://x/mcp')

    closeAll()
    await openEndpointTab('mcp-sr')
    expect(useMcpStore.getState().requestTimeout).toBe(0)
  })

  it('suite item: top-level `timeout`, restored on reopen', async () => {
    rows.items.set('mcp-it', {
      id: 'mcp-it',
      suite_id: 's',
      folder_id: null,
      protocol: 'mcp',
      name: 'MCP',
      method: 'GET',
      url: '',
      request_schema: '{}',
      assertions: '[]',
    })
    openEditorTab({ id: 'tab-mcp-it', protocol: 'mcp', testSuiteItemId: 'mcp-it' })
    useMcpStore.setState({ url: 'http://x/mcp' })
    useMcpStore.getState().setRequestTimeout(2500)

    await saveActiveRequestInPlace()
    expect(JSON.parse(String(rows.items.get('mcp-it')?.request_schema)).timeout).toBe(2500)

    closeAll()
    await openSuiteItemTab('mcp-it')
    expect(useMcpStore.getState().requestTimeout).toBe(2500)
  })

  it('the timeout survives disconnect and tab switches (config, not connection state)', () => {
    openEditorTab({ id: 'tab-a', protocol: 'mcp' })
    useMcpStore.getState().setRequestTimeout(3000)
    useMcpStore.getState().switchToTab('tab-b')
    expect(useMcpStore.getState().requestTimeout).toBeNull()
    useMcpStore.getState().switchToTab('tab-a')
    expect(useMcpStore.getState().requestTimeout).toBe(3000)
  })
})
