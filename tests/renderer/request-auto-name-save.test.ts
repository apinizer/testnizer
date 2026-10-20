/**
 * Issue #201 — a request created from a folder's "Add Request" is a
 * saved_request row named 'New Endpoint', and Ctrl+S saves it in place
 * without a dialog. Before the fix the name never left the placeholder; now
 * the single save path renames a placeholder from the URL and leaves a name
 * the user typed alone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveActiveRequestInPlace } from '../../src/renderer/lib/save-active-request'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import type { Tab } from '../../src/renderer/types'

type UpdateMock = ReturnType<typeof vi.fn>

function seed(tab: Partial<Tab>, url: string): { savedUpdate: UpdateMock; epUpdate: UpdateMock } {
  useTabsStore.setState({
    tabs: [{ id: 'tab-1', method: 'GET', url: '', protocol: 'http', ...tab } as Tab],
    activeTabId: 'tab-1',
  })
  useRequestStore.setState({ ...useRequestStore.getState(), url, method: 'GET' })
  const savedUpdate = vi.fn().mockResolvedValue({ success: true })
  const epUpdate = vi.fn().mockResolvedValue({ success: true })
  ;(window as unknown as { api: unknown }).api = {
    savedRequest: { update: savedUpdate },
    endpoint: { update: epUpdate },
  }
  return { savedUpdate, epUpdate }
}

const tabName = (): string | undefined =>
  useTabsStore.getState().tabs.find((t) => t.id === 'tab-1')?.name

beforeEach(() => {
  useWorkspaceStore.setState({ refreshTree: vi.fn().mockResolvedValue(undefined) })
})

describe('saveActiveRequestInPlace — auto-name from URL (issue #201)', () => {
  it('saves a "New Endpoint" saved_request under the URL-derived name and renames the tab', async () => {
    const { savedUpdate } = seed(
      { name: 'New Endpoint', savedRequestId: 'sr-1' },
      '{{baseUrl}}/api/customers?x=1',
    )

    const res = await saveActiveRequestInPlace()

    expect(res.success).toBe(true)
    expect(savedUpdate).toHaveBeenCalledTimes(1)
    const [id, payload] = savedUpdate.mock.calls[0] as [string, { name: string; url: string }]
    expect(id).toBe('sr-1')
    expect(payload.name).toBe('customers')
    // The URL itself is saved as typed — only the name is derived.
    expect(payload.url).toBe('{{baseUrl}}/api/customers?x=1')
    expect(tabName()).toBe('customers')
    expect(useWorkspaceStore.getState().refreshTree).toHaveBeenCalledTimes(1)
  })

  it('also renames the Turkish placeholder', async () => {
    const { savedUpdate } = seed(
      { name: 'Yeni Uç Nokta', savedRequestId: 'sr-1' },
      'https://api.test/v1/orders/:id',
    )

    await saveActiveRequestInPlace()

    expect((savedUpdate.mock.calls[0][1] as { name: string }).name).toBe('orders')
    expect(tabName()).toBe('orders')
  })

  it('never renames a name the user typed', async () => {
    const { savedUpdate } = seed(
      { name: 'My call', savedRequestId: 'sr-1' },
      '{{baseUrl}}/api/customers?x=1',
    )

    await saveActiveRequestInPlace()

    expect((savedUpdate.mock.calls[0][1] as { name: string }).name).toBe('My call')
    expect(tabName()).toBe('My call')
  })

  it('keeps the placeholder when the URL yields no name', async () => {
    const { savedUpdate } = seed({ name: 'New Endpoint', savedRequestId: 'sr-1' }, '{{baseUrl}}')

    await saveActiveRequestInPlace()

    expect((savedUpdate.mock.calls[0][1] as { name: string }).name).toBe('New Endpoint')
    expect(tabName()).toBe('New Endpoint')
  })

  it('does not rename when the save fails', async () => {
    const { savedUpdate } = seed(
      { name: 'New Endpoint', savedRequestId: 'sr-1' },
      'https://api.test/users',
    )
    savedUpdate.mockResolvedValue({ success: false, error: 'nope' })

    const res = await saveActiveRequestInPlace()

    expect(res.success).toBe(false)
    expect(tabName()).toBe('New Endpoint')
  })

  it('leaves non-HTTP requests named as they are', async () => {
    const { savedUpdate } = seed(
      { name: 'New WebSocket', savedRequestId: 'sr-1', protocol: 'websocket' },
      '',
    )
    useWebSocketStore.setState({ url: 'wss://echo.test/chat' })

    await saveActiveRequestInPlace()

    expect((savedUpdate.mock.calls[0][1] as { name: string }).name).toBe('New WebSocket')
    expect(tabName()).toBe('New WebSocket')
  })

  it('sends a name to an endpoint row only when it renames it', async () => {
    const { epUpdate } = seed({ name: 'New Endpoint', endpointId: 'ep-1' }, 'https://api.test/pets')
    await saveActiveRequestInPlace()
    expect((epUpdate.mock.calls[0][1] as { name?: string }).name).toBe('pets')
    expect(tabName()).toBe('pets')

    const second = seed({ name: 'List pets', endpointId: 'ep-1' }, 'https://api.test/pets')
    await saveActiveRequestInPlace()
    expect(second.epUpdate.mock.calls[0][1]).not.toHaveProperty('name')
    expect(tabName()).toBe('List pets')
  })
})
