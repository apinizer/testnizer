/**
 * Issue #101 — new request tabs (New → HTTP etc.) were missing the unsaved
 * indicator and close confirmation. `markActiveTabDirty` used to gate on the
 * active tab carrying an `endpointId` / `savedRequestId`, so a brand-new tab
 * (no backing row yet) could never turn dirty: edits were silently lost on
 * close, with no dot and no confirm dialog.
 *
 * The gate is now "is this a request-like tab" (`isRequestLikeTab`): any tab
 * backed by an endpoint / saved request / test-suite item row, or a scratch
 * tab whose protocol is a regular request protocol. Tool tabs, the Runner tab
 * and the Mock Server editor still never get flagged — they have no request
 * to be dirty against.
 *
 * Also pins the contract Workbench's close-confirm "Save & Close" relies on:
 * a scratch tab has no in-place row, so `saveActiveRequestInPlace()` must
 * report `notApplicable` — Workbench routes that to the EndpointSaveModal
 * (Save As) instead of silently closing the tab.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { markActiveTabDirty, isRequestLikeTab } from '../../src/renderer/lib/mark-dirty'
import { saveActiveRequestInPlace } from '../../src/renderer/lib/save-active-request'
import type { Tab } from '../../src/renderer/types'

/** Open a single tab and make it active. */
function openTab(over: Partial<Tab> & { id: string; protocol: Tab['protocol'] }): void {
  useTabsStore.setState({
    tabs: [
      {
        name: 'Tab',
        isDirty: false,
        isLoading: false,
        ...over,
      } as Tab,
    ],
    activeTabId: over.id,
  })
}

function isActiveTabDirty(): boolean {
  const { tabs, activeTabId } = useTabsStore.getState()
  return tabs.find((t) => t.id === activeTabId)?.isDirty ?? false
}

beforeEach(() => {
  ;(globalThis as unknown as { window: { api: unknown } }).window = { api: {} }
  useTabsStore.setState({ tabs: [], activeTabId: null })
})

describe('new-tab dirty indicator (#101)', () => {
  it('marks a brand-new HTTP tab (no backing ids) dirty when the URL is edited', () => {
    openTab({ id: 'tab-new-http', name: 'New Request', protocol: 'http', method: 'GET' })
    expect(isActiveTabDirty()).toBe(false)
    useRequestStore.getState().switchToTab('tab-new-http')
    expect(isActiveTabDirty()).toBe(false) // hydration is not an edit
    useRequestStore.getState().setUrl('https://api.example.test/users')
    expect(isActiveTabDirty()).toBe(true)
  })

  it('marks a brand-new protocol tab (New → GraphQL) dirty on edit', () => {
    openTab({ id: 'tab-new-gql', name: 'GraphQL', protocol: 'graphql' })
    expect(isActiveTabDirty()).toBe(false)
    useGraphQLStore.getState().setQuery('query { me { id } }')
    expect(isActiveTabDirty()).toBe(true)
  })

  it('marks a test-suite-item tab dirty on edit (in-place savable row)', () => {
    openTab({ id: 'tab-suite', protocol: 'http', testSuiteItemId: 'tsi-1' })
    useRequestStore.getState().switchToTab('tab-suite')
    useRequestStore.getState().setUrl('https://api.example.test/suite')
    expect(isActiveTabDirty()).toBe(true)
  })

  it('never marks tool / runner / mock-server tabs dirty', () => {
    for (const protocol of ['tools.jwt', 'runner', 'mockServer'] as const) {
      openTab({ id: `tab-${protocol}`, protocol })
      markActiveTabDirty()
      expect(isActiveTabDirty(), `protocol ${protocol} must stay clean`).toBe(false)
    }
  })

  it('markDirty(false) clears the flag after a first save (EndpointSaveModal path)', () => {
    openTab({ id: 'tab-new-http-2', protocol: 'http' })
    useRequestStore.getState().switchToTab('tab-new-http-2')
    useRequestStore.getState().setUrl('https://api.example.test')
    expect(isActiveTabDirty()).toBe(true)
    // EndpointSaveModal's success path does exactly this (markDirty false +
    // attaches the new savedRequestId).
    useTabsStore.getState().markDirty('tab-new-http-2', false)
    useTabsStore.getState().updateTab('tab-new-http-2', { savedRequestId: 'sr-new' })
    expect(isActiveTabDirty()).toBe(false)
  })

  it('in-place save on a saved-request tab clears the dirty flag', async () => {
    const update = vi.fn(async () => ({ success: true }))
    ;(globalThis as unknown as { window: { api: unknown } }).window = {
      api: { savedRequest: { update } },
    }
    openTab({ id: 'tab-saved', protocol: 'http', savedRequestId: 'sr-1' })
    useRequestStore.getState().switchToTab('tab-saved')
    useRequestStore.getState().setUrl('https://api.example.test/edited')
    expect(isActiveTabDirty()).toBe(true)
    const result = await saveActiveRequestInPlace()
    expect(result.success).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
    expect(isActiveTabDirty()).toBe(false)
  })

  it('saveActiveRequestInPlace reports notApplicable for a scratch tab (Workbench routes this to Save As)', async () => {
    openTab({ id: 'tab-scratch', protocol: 'http' })
    useRequestStore.getState().switchToTab('tab-scratch')
    const result = await saveActiveRequestInPlace()
    expect(result.success).toBe(false)
    expect(result.notApplicable).toBe(true)
  })
})

describe('isRequestLikeTab (#101)', () => {
  const base = { id: 't', name: 'T', isDirty: false, isLoading: false }

  it('accepts scratch tabs for every request protocol', () => {
    const requestProtocols: Tab['protocol'][] = [
      'http',
      'soap',
      'websocket',
      'graphql',
      'grpc',
      'sse',
      'ai',
      'mcp',
      'socketio',
    ]
    for (const protocol of requestProtocols) {
      expect(isRequestLikeTab({ ...base, protocol }), protocol).toBe(true)
    }
  })

  it('accepts row-backed tabs regardless of protocol', () => {
    expect(isRequestLikeTab({ ...base, protocol: 'http', endpointId: 'ep' })).toBe(true)
    expect(isRequestLikeTab({ ...base, protocol: 'soap', savedRequestId: 'sr' })).toBe(true)
    expect(isRequestLikeTab({ ...base, protocol: 'http', testSuiteItemId: 'tsi' })).toBe(true)
  })

  it('rejects tool, runner and mock-server tabs', () => {
    expect(isRequestLikeTab({ ...base, protocol: 'tools.jwt' })).toBe(false)
    expect(isRequestLikeTab({ ...base, protocol: 'tools.regex' })).toBe(false)
    expect(isRequestLikeTab({ ...base, protocol: 'runner' })).toBe(false)
    expect(isRequestLikeTab({ ...base, protocol: 'mockServer' })).toBe(false)
  })
})
