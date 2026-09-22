/**
 * Issue #125 — "Save response": the renderer store pins the active tab's
 * response to the request the tab is backed by, and re-opens it into the
 * active tab's response slice without re-sending.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  delete: vi.fn(),
  rename: vi.fn(),
}))
vi.hoisted(() => {
  const g = globalThis as unknown as { window: { api?: unknown } }
  g.window.api = { savedResponse: api }
})

import {
  useSavedResponseStore,
  savedResponseOwnerForTab,
  serializeResponseForSave,
  defaultSavedResponseName,
  SAVED_RESPONSE_BODY_LIMIT,
} from '../../src/renderer/stores/saved-response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { buildRequestSnapshot } from '../../src/renderer/stores/saved-response.store'
import type { ApiResponse, SavedRequestSnapshot, Tab } from '../../src/renderer/types'

const response: ApiResponse = {
  requestId: 'r1',
  protocol: 'http',
  status: 201,
  statusText: 'Created',
  headers: { 'content-type': 'application/json' },
  body: '{"id":7}',
  timing: { total: 42 },
  actualRequest: { url: 'https://api.test/users', method: 'POST', headers: {} } as never,
}

beforeEach(() => {
  api.create.mockReset()
  api.list.mockReset().mockResolvedValue({ success: true, data: [] })
  api.delete.mockReset().mockResolvedValue({ success: true, data: true })
  api.rename.mockReset().mockResolvedValue({ success: true, data: true })
  useTabsStore.setState({
    tabs: [
      {
        id: 'tab-a',
        name: 'Users',
        protocol: 'http',
        savedRequestId: 'sr-1',
        method: 'POST',
        url: 'https://api.test/users',
      } as Tab,
      { id: 'tab-scratch', name: 'New Request', protocol: 'http', method: 'GET', url: '' } as Tab,
    ],
    activeTabId: 'tab-a',
  })
  useResponseStore.getState().setResponse(response, 'tab-a')
  useSavedResponseStore.setState({ ownerKey: null, items: [], loading: false })
  useWorkspaceStore.setState({
    refreshTree: vi.fn().mockResolvedValue(undefined),
    openNodeIds: new Set<string>(),
  })
})

describe('savedResponseOwnerForTab', () => {
  it('maps the backing row, preferring endpoint > saved request > suite item', () => {
    expect(savedResponseOwnerForTab({ endpointId: 'e' } as Tab)).toEqual({
      type: 'endpoint',
      id: 'e',
    })
    expect(savedResponseOwnerForTab({ savedRequestId: 's' } as Tab)).toEqual({
      type: 'saved_request',
      id: 's',
    })
    expect(savedResponseOwnerForTab({ testSuiteItemId: 'i' } as Tab)).toEqual({
      type: 'test_suite_item',
      id: 'i',
    })
    expect(savedResponseOwnerForTab({} as Tab)).toBeNull()
    expect(savedResponseOwnerForTab(undefined)).toBeNull()
  })
})

describe('serializeResponseForSave / defaultSavedResponseName', () => {
  it('keeps status/headers/body and drops oversized bodies', () => {
    const snap = JSON.parse(serializeResponseForSave(response))
    expect(snap.status).toBe(201)
    expect(snap.body).toBe('{"id":7}')
    const big = JSON.parse(
      serializeResponseForSave({ ...response, body: 'x'.repeat(SAVED_RESPONSE_BODY_LIMIT + 1) }),
    )
    expect(big.body).toBeUndefined()
    expect(big.status).toBe(201)
  })

  it('suggests "<status> <statusText>" as the default name', () => {
    expect(defaultSavedResponseName(response)).toBe('201 Created')
    expect(defaultSavedResponseName({ ...response, status: undefined, error: 'boom' })).toBe(
      'Error',
    )
  })
})

describe('saveCurrent', () => {
  it('persists the active tab response under its saved-request owner', async () => {
    api.create.mockResolvedValue({
      success: true,
      data: {
        id: 'x1',
        name: 'ok sample',
        owner_type: 'saved_request',
        owner_id: 'sr-1',
        response_json: '{}',
        created_at: 1,
      },
    })
    const result = await useSavedResponseStore.getState().saveCurrent('ok sample')
    expect(result.ok).toBe(true)
    expect(api.create).toHaveBeenCalledTimes(1)
    const payload = api.create.mock.calls[0][0] as Record<string, unknown>
    expect(payload.owner_type).toBe('saved_request')
    expect(payload.owner_id).toBe('sr-1')
    // project_id is resolved in main from the owner row — never sent.
    expect('project_id' in payload).toBe(false)
    expect(payload.status_code).toBe(201)
    expect(payload.method).toBe('POST')
    expect(payload.url).toBe('https://api.test/users')
    expect(JSON.parse(payload.response_json as string).body).toBe('{"id":7}')
  })

  it('refuses on an unsaved scratch tab without touching the API', async () => {
    useTabsStore.setState({ activeTabId: 'tab-scratch' })
    useResponseStore.getState().setResponse(response, 'tab-scratch')
    const result = await useSavedResponseStore.getState().saveCurrent('x')
    expect(result).toEqual({ ok: false, error: 'unsaved-request' })
    expect(api.create).not.toHaveBeenCalled()
  })

  it('refuses when there is no response yet', async () => {
    useResponseStore.getState().clearResponse('tab-a')
    const result = await useSavedResponseStore.getState().saveCurrent('x')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('no-response')
  })
})

describe('load / open / remove', () => {
  it('opens an item in its OWN example tab and leaves the live tab response alone', async () => {
    api.list.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'x1',
          name: 'sample',
          owner_type: 'saved_request',
          owner_id: 'sr-1',
          protocol: 'http',
          method: 'GET',
          url: 'https://api.test/users/7',
          status_code: 404,
          response_json: JSON.stringify({
            status: 404,
            statusText: 'Not Found',
            body: '{"error":"nope"}',
            headers: {},
          }),
          created_at: 1,
        },
      ],
    })
    await useSavedResponseStore.getState().load({ type: 'saved_request', id: 'sr-1' })
    expect(api.list).toHaveBeenCalledWith('saved_request', 'sr-1')
    const items = useSavedResponseStore.getState().items
    expect(items).toHaveLength(1)

    useSavedResponseStore.getState().open(items[0])
    const tabs = useTabsStore.getState()
    const exampleTab = tabs.tabs.find((tb) => tb.savedResponseId === 'x1')
    expect(exampleTab).toBeDefined()
    expect(exampleTab?.protocol).toBe('example')
    expect(exampleTab?.name).toBe('Users · sample')
    expect(tabs.activeTabId).toBe(exampleTab?.id)
    // The owner tab's live response (201) is untouched — the example never
    // overwrites the editor it was saved from.
    useTabsStore.setState({ activeTabId: 'tab-a' })
    expect(useResponseStore.getState().response?.status).toBe(201)
    // Reopening focuses the same tab instead of minting a second one.
    useSavedResponseStore.getState().open(items[0])
    expect(useTabsStore.getState().tabs.filter((tb) => tb.savedResponseId === 'x1')).toHaveLength(1)

    // Delete closes that tab and refreshes the tree.
    expect(await useSavedResponseStore.getState().remove('x1')).toBe(true)
    expect(useSavedResponseStore.getState().items).toEqual([])
    expect(useTabsStore.getState().tabs.some((tb) => tb.savedResponseId === 'x1')).toBe(false)
    expect(useWorkspaceStore.getState().refreshTree).toHaveBeenCalled()
  })

  it('clears the previous owner list immediately when a new owner loads (no stale flash)', async () => {
    useSavedResponseStore.setState({ ownerKey: 'endpoint:A', items: [{ id: 'old' } as never] })
    let resolveB!: (v: unknown) => void
    api.list.mockImplementationOnce(() => new Promise((r) => (resolveB = r)))
    const p = useSavedResponseStore.getState().load({ type: 'endpoint', id: 'B' })
    expect(useSavedResponseStore.getState().items).toEqual([])
    resolveB({ success: true, data: [] })
    await p
  })

  it('reports bodyDropped when the body exceeds the cap', async () => {
    api.create.mockResolvedValue({
      success: true,
      data: { id: 'big', name: 'b', response_json: '{}', created_at: 1 },
    })
    useResponseStore
      .getState()
      .setResponse({ ...response, body: 'x'.repeat(SAVED_RESPONSE_BODY_LIMIT + 1) }, 'tab-a')
    const result = await useSavedResponseStore.getState().saveCurrent('big')
    expect(result.ok).toBe(true)
    expect(result.bodyDropped).toBe(true)
  })

  it('ignores a stale list response after the owner changed', async () => {
    let resolveA!: (v: unknown) => void
    api.list.mockImplementationOnce(() => new Promise((r) => (resolveA = r)))
    const pA = useSavedResponseStore.getState().load({ type: 'endpoint', id: 'A' })
    api.list.mockResolvedValueOnce({ success: true, data: [] })
    await useSavedResponseStore.getState().load({ type: 'endpoint', id: 'B' })
    resolveA({ success: true, data: [{ id: 'stale', name: 'stale' }] })
    await pA
    expect(useSavedResponseStore.getState().ownerKey).toBe('endpoint:B')
    expect(useSavedResponseStore.getState().items).toEqual([])
  })
})

describe('request snapshot (examples carry what was sent)', () => {
  it('buildRequestSnapshot keeps the template in `configured` and the wire form in `sent`', () => {
    const snap = buildRequestSnapshot(
      {
        method: 'POST',
        url: '{{baseUrl}}/employee',
        params: [],
        headers: [{ id: 'h', key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
        body: { type: 'json', content: '{{employee_body}}' },
        auth: { type: 'bearer', bearer: { token: 'secret' } } as never,
      },
      {
        actualRequest: {
          method: 'POST',
          url: 'https://api.test/employee',
          headers: { Authorization: 'Bearer real' },
          body: '{"name":"Ada"}',
        },
      },
    )
    expect(snap.configured.url).toBe('{{baseUrl}}/employee')
    expect(snap.configured.body.content).toBe('{{employee_body}}')
    expect(snap.configured.authType).toBe('bearer')
    // The credential itself never enters the snapshot.
    expect(JSON.stringify(snap.configured)).not.toContain('secret')
    expect(snap.sent?.url).toBe('https://api.test/employee')
    expect(snap.sent?.body).toBe('{"name":"Ada"}')
  })

  it('saveCurrent persists request_json and expands + refreshes the owner in the tree', async () => {
    api.create.mockResolvedValue({
      success: true,
      data: {
        id: 'n1',
        name: '201 Created',
        response_json: '{}',
        request_json: '{}',
        created_at: 1,
      },
    })
    useRequestStore.setState({
      ...useRequestStore.getState(),
      url: '{{baseUrl}}/users',
      method: 'POST',
      body: { type: 'json', content: '{{employee_body}}' },
    })
    const result = await useSavedResponseStore.getState().saveCurrent('201 Created')
    expect(result.ok).toBe(true)
    const payload = api.create.mock.calls[0][0] as { request_json: string }
    const snap = JSON.parse(payload.request_json) as SavedRequestSnapshot
    expect(snap.configured.url).toBe('{{baseUrl}}/users')
    expect(snap.configured.body.content).toBe('{{employee_body}}')
    expect(snap.sent?.url).toBe('https://api.test/users')
    // Tree: owner row expanded so the new child is visible, then rebuilt.
    expect(useWorkspaceStore.getState().openNodeIds.has('sr-1')).toBe(true)
    expect(useWorkspaceStore.getState().refreshTree).toHaveBeenCalledTimes(1)
  })

  it('rename syncs the open example tab title and refreshes the tree', async () => {
    useSavedResponseStore.setState({
      ownerKey: 'saved_request:sr-1',
      items: [{ id: 'x9', name: 'old' } as never],
    })
    useTabsStore.getState().openTab({
      id: 'example-x9',
      name: 'Users · old',
      protocol: 'example',
      savedResponseId: 'x9',
    })
    expect(await useSavedResponseStore.getState().rename('x9', 'new name')).toBe(true)
    expect(useTabsStore.getState().tabs.find((tb) => tb.id === 'example-x9')?.name).toBe('new name')
    expect(useWorkspaceStore.getState().refreshTree).toHaveBeenCalledTimes(1)
  })
})
