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
import type { ApiResponse, Tab } from '../../src/renderer/types'

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
  it('loads the owner list and opens an item into the ACTIVE tab response slice', async () => {
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
    const shown = useResponseStore.getState().response
    expect(shown?.status).toBe(404)
    expect(shown?.body).toBe('{"error":"nope"}')
    expect(shown?.requestId).toBe('saved-x1')
    // Written into tab-a's slice, not a detached one.
    useTabsStore.setState({ activeTabId: 'tab-scratch' })
    useTabsStore.setState({ activeTabId: 'tab-a' })
    expect(useResponseStore.getState().response?.status).toBe(404)

    expect(await useSavedResponseStore.getState().remove('x1')).toBe(true)
    expect(useSavedResponseStore.getState().items).toEqual([])
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
