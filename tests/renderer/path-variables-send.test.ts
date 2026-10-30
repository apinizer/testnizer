/**
 * Issue #276 — `:name` path variables on Send, the URL-driven rows, and the
 * Ctrl+S → reopen round trip.
 *
 * Send runs the SAME cases as Run (tests/fixtures/path-variables-parity.ts →
 * tests/main/handlers/path-variables-run.test.ts), so the two paths cannot
 * drift: both call `applyPathVariables` from `src/shared/path-variables.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { saveActiveRequestInPlace } from '../../src/renderer/lib/save-active-request'
import { openEndpointTab } from '../../src/renderer/lib/open-endpoint-tab'
import type { Environment, Tab } from '../../src/renderer/types'
import { PATH_VARIABLE_CASES } from '../fixtures/path-variables-parity'

const ok = (data: unknown) => ({ success: true, data })
let sent: Array<{ url: string }> = []
let stored: Record<string, { request_schema: string; path: string; method: string }> = {}
let savedRows: Record<string, Record<string, unknown>> = {}

function installMockApi(): void {
  sent = []
  stored = {}
  savedRows = {}
  const api = {
    request: {
      send: vi.fn(async (opts: { url: string }) => {
        sent.push({ url: opts.url })
        return ok({
          requestId: 'r1',
          protocol: 'http',
          status: 200,
          statusText: 'OK',
          headers: {},
          body: '',
          bodySize: 0,
          timing: { total: 1 },
        })
      }),
      cancel: vi.fn(),
    },
    settings: { get: vi.fn(async () => ok({})) },
    endpoint: {
      get: vi.fn(async (id: string) =>
        stored[id]
          ? ok({ id, name: 'ep', protocol: 'http', ...stored[id] })
          : { success: false, notFound: true },
      ),
      update: vi.fn(
        async (id: string, data: { request_schema: string; path: string; method: string }) => {
          stored[id] = { ...stored[id], ...data }
          return ok(true)
        },
      ),
    },
    savedRequest: {
      get: vi.fn(async (id: string) =>
        savedRows[id] ? ok({ id, name: 'sr', protocol: 'http', ...savedRows[id] }) : ok(null),
      ),
      update: vi.fn(async (id: string, data: Record<string, unknown>) => {
        savedRows[id] = { ...savedRows[id], ...data }
        return ok(true)
      }),
    },
  }
  ;(window as unknown as { api: typeof api }).api = api
}

function env(vars: Record<string, string>): Environment {
  return {
    id: 'env1',
    workspace_id: 'ws1',
    name: 'E',
    is_active: true,
    variables: Object.entries(vars).map(([key, value], i) => ({
      id: `v${i}`,
      key,
      value,
      initialValue: value,
      enabled: true,
      secret: false,
    })),
    created_at: 0,
    updated_at: 0,
  }
}

function openTab(tab: Partial<Tab> & { id: string }): void {
  useTabsStore.setState({
    tabs: [{ name: 'T', protocol: 'http', method: 'GET', url: '', isDirty: false, ...tab } as Tab],
    activeTabId: tab.id,
  })
  useRequestStore.getState().switchToTab(tab.id)
}

beforeEach(() => {
  installMockApi()
  useResponseStore.setState({ response: null, isLoading: false })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useWorkspaceStore.setState({ refreshTree: vi.fn().mockResolvedValue(undefined) })
})

describe('issue #276 — path variables on Send (Send ≡ Run cases)', () => {
  for (const c of PATH_VARIABLE_CASES) {
    it(c.name, async () => {
      useEnvironmentStore.setState({
        ...useEnvironmentStore.getState(),
        environments: [env({ base: 'http://send.test', ...(c.env ?? {}) })],
        globalVariables: [],
        activeEnvironmentId: 'env1',
      })
      openTab({ id: `t-${c.name}` })
      useRequestStore.getState().loadFromEndpoint({
        method: 'GET',
        url: c.url,
        ...(c.pathVariables ? { pathVariables: c.pathVariables } : {}),
      })
      await useRequestStore.getState().sendRequest()
      expect(sent).toHaveLength(1)
      expect(sent[0].url).toBe(`http://send.test${c.expected}`)
    })
  }
})

describe('issue #276 — Path Variables rows follow the URL', () => {
  it('typing :name adds a row, editing keeps its value, removing the segment drops it', () => {
    openTab({ id: 't-rows' })
    const s = useRequestStore.getState
    s().setUrl('https://x.test/users/:id')
    expect(s().pathVariables.map((r) => r.key)).toEqual(['id'])
    const id = s().pathVariables[0].id
    s().updatePathVariable(id, { value: '42', description: 'user' })
    s().setUrl('https://x.test/orgs/:org/users/:id?q=1')
    expect(s().pathVariables.map((r) => [r.key, r.value])).toEqual([
      ['org', ''],
      ['id', '42'],
    ])
    expect(s().pathVariables[1]).toMatchObject({ id, description: 'user' })
    s().setUrl('https://x.test/orgs/:org')
    expect(s().pathVariables.map((r) => r.key)).toEqual(['org'])
    // A tab switch keeps the rows with the tab.
    useRequestStore.getState().switchToTab('other')
    expect(s().pathVariables).toEqual([])
    useRequestStore.getState().switchToTab('t-rows')
    expect(s().pathVariables.map((r) => r.key)).toEqual(['org'])
  })
})

describe('issue #276 — Ctrl+S writes the rows, reopening restores them', () => {
  it('endpoint: request_schema.pathVariables round trip', async () => {
    stored['ep-1'] = {
      method: 'GET',
      path: '{{base}}/users/:id',
      request_schema: JSON.stringify({ url: '{{base}}/users/:id', method: 'GET' }),
    }
    await openEndpointTab('ep-1')
    const s = useRequestStore.getState
    expect(s().pathVariables.map((r) => [r.key, r.value])).toEqual([['id', '']])
    s().updatePathVariable(s().pathVariables[0].id, { value: '{{uid}}', description: 'who' })
    const res = await saveActiveRequestInPlace()
    expect(res.success).toBe(true)
    const schema = JSON.parse(stored['ep-1'].request_schema) as { pathVariables: unknown }
    expect(schema.pathVariables).toEqual([
      { id: expect.any(String), key: 'id', value: '{{uid}}', description: 'who' },
    ])

    // Close and reopen: the rows come back from the row.
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null, pathVariables: [] })
    await openEndpointTab('ep-1')
    expect(s().pathVariables.map((r) => [r.key, r.value, r.description])).toEqual([
      ['id', '{{uid}}', 'who'],
    ])
  })

  it('saved request: rows ride in metadata, and an old row without them saves byte-identical', async () => {
    savedRows['sr-1'] = {
      method: 'GET',
      url: 'https://x.test/a/:k',
      params: '[]',
      headers: '[]',
      body: JSON.stringify({ type: 'none' }),
      auth: JSON.stringify({ type: 'none' }),
      assertions: '[]',
      metadata: JSON.stringify({ pathVariables: [{ key: 'k', value: 'v1' }] }),
    }
    await openEndpointTab('sr-1')
    const s = useRequestStore.getState
    expect(s().pathVariables.map((r) => [r.key, r.value])).toEqual([['k', 'v1']])
    s().updatePathVariable(s().pathVariables[0].id, { value: 'v2' })
    expect((await saveActiveRequestInPlace()).success).toBe(true)
    const meta = JSON.parse(String(savedRows['sr-1'].metadata)) as {
      pathVariables: Array<{ key: string; value: string }>
    }
    expect(meta.pathVariables.map((r) => [r.key, r.value])).toEqual([['k', 'v2']])
  })

  it('a URL without :name stores no pathVariables key', async () => {
    stored['ep-2'] = {
      method: 'GET',
      path: 'https://x.test/plain',
      request_schema: JSON.stringify({ url: 'https://x.test/plain', method: 'GET' }),
    }
    await openEndpointTab('ep-2')
    useRequestStore.getState().setHeaders([])
    expect((await saveActiveRequestInPlace()).success).toBe(true)
    expect('pathVariables' in JSON.parse(stored['ep-2'].request_schema)).toBe(false)
  })
})
