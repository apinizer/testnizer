/**
 * Issue #276 — Postman `protocolProfileBehavior` reaches Send.
 *
 * The Postman importer writes `followRedirects` / `maxRedirects` /
 * `sslVerification` at the top of the endpoint's `request_schema` (the issue
 * #185 keys). This pins that the Send side reads exactly those keys when the
 * imported request is opened — the Run side is pinned by
 * tests/main/handlers/postman-import-run.test.ts. (Store fields → engine
 * options on Send is covered by the issue #185 tests.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openEndpointTab } from '../../src/renderer/lib/open-endpoint-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

/** The request_schema the importer writes for `protocolProfileBehavior:
 *  {followRedirects:false, maxRedirects:3, strictSSL:false}` (see
 *  tests/main/import-postman-276.test.ts). */
const IMPORTED_SCHEMA = {
  url: 'https://api.test/hop',
  method: 'GET',
  params: [],
  headers: [],
  body: { type: 'none' },
  followRedirects: false,
  maxRedirects: 3,
  sslVerification: false,
}

beforeEach(() => {
  const ok = (data: unknown) => ({ success: true, data })
  ;(window as unknown as { api: unknown }).api = {
    endpoint: {
      get: vi.fn(async () =>
        ok({
          id: 'ep-pm',
          name: 'Imported',
          method: 'GET',
          path: '/hop',
          protocol: 'http',
          request_schema: JSON.stringify(IMPORTED_SCHEMA),
        }),
      ),
      update: vi.fn(async () => ok(true)),
    },
  }
  useWorkspaceStore.setState({ refreshTree: vi.fn().mockResolvedValue(undefined) })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
})

describe('issue #276 — imported request settings on Send', () => {
  it('opening the imported endpoint loads followRedirects / maxRedirects / sslVerification', async () => {
    await openEndpointTab('ep-pm')
    const r = useRequestStore.getState()
    expect(r.followRedirects).toBe(false)
    expect(r.maxRedirects).toBe(3)
    expect(r.sslVerification).toBe(false)
    expect(r.url).toBe('https://api.test/hop')
  })
})
