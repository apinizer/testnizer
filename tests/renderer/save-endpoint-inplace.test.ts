/**
 * Issue #41 — Ctrl+S must behave like the Save button next to Send: an
 * already-saved endpoint tab saves in place instead of popping the "Save As"
 * folder picker. The keyboard handler routes through saveActiveRequestInPlace,
 * so the endpoint branch added here is what makes the two paths agree.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveActiveRequestInPlace } from '../../src/renderer/lib/save-active-request'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import type { Tab } from '../../src/renderer/types'

beforeEach(() => {
  useTabsStore.setState({
    tabs: [
      {
        id: 'tab-ep',
        name: 'My API',
        protocol: 'http',
        endpointId: 'ep-1',
        method: 'GET',
        url: 'https://api.test',
      } as Tab,
    ],
    activeTabId: 'tab-ep',
  })
  useRequestStore.setState({
    ...useRequestStore.getState(),
    url: 'https://api.test/v2',
    method: 'POST',
  })
})

describe('saveActiveRequestInPlace — endpoint tab (issue #41)', () => {
  it('persists an endpoint-backed tab in place instead of falling back to the modal', async () => {
    const update = vi.fn().mockResolvedValue({ success: true })
    ;(globalThis as unknown as { window: { api: unknown } }).window = {
      api: { endpoint: { update } },
    }

    const res = await saveActiveRequestInPlace()

    expect(res.success).toBe(true)
    expect(res.notApplicable).toBeFalsy()
    expect(update).toHaveBeenCalledTimes(1)
    const [id, payload] = update.mock.calls[0] as [string, { method: string; path: string; request_schema: string }]
    expect(id).toBe('ep-1')
    expect(payload.method).toBe('POST')
    expect(payload.path).toBe('https://api.test/v2')
    // Endpoints keep assertions inside request_schema (no separate column).
    expect(JSON.parse(payload.request_schema)).toHaveProperty('assertions')
  })

  it('clears the tab dirty flag after a successful in-place save', async () => {
    const update = vi.fn().mockResolvedValue({ success: true })
    ;(globalThis as unknown as { window: { api: unknown } }).window = {
      api: { endpoint: { update } },
    }
    useTabsStore.getState().markDirty('tab-ep', true)

    await saveActiveRequestInPlace()

    const tab = useTabsStore.getState().tabs.find((t) => t.id === 'tab-ep')
    expect(tab?.isDirty).toBe(false)
  })
})
