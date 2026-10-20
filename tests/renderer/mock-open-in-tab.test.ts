/**
 * "Open in SSE tab" / "Start & open in SSE tab" for SSE mock servers (issue
 * #221, design Ek D §D.3.4).
 *
 * The SSE request tab must be prefilled in the NEW tab's slice (the stores
 * are activated before the setters run), carry the endpoint's method (ANY →
 * GET), and stay clean — it holds nothing the user typed. "Start & open"
 * opens nothing when the server fails to start.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import './mock-http-bridge-stub'

vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { toast } from '../../src/renderer/lib/toast'
import {
  mockEndpointUrl,
  openMockInSseTab,
  sseMethodFor,
  startAndOpenMockInSseTab,
  streamTargetEndpoint,
} from '../../src/renderer/components/mock/mock-open-in-tab'
import { httpEndpoint, httpServer } from './mock-http-bridge-stub'

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  vi.mocked(toast.error).mockClear()
})

describe('openMockInSseTab', () => {
  it('opens an SSE tab with the URL and method, active and not dirty', () => {
    const id = openMockInSseTab({
      name: 'Ticker SSE',
      url: 'http://127.0.0.1:3200/events',
      method: 'POST',
    })
    const { tabs, activeTabId } = useTabsStore.getState()
    expect(activeTabId).toBe(id)
    const tab = tabs.find((t) => t.id === id)
    expect(tab).toMatchObject({ protocol: 'sse', name: 'Ticker SSE', isDirty: false })
    const sse = useSseStore.getState()
    expect(sse._currentTabId).toBe(id)
    expect(sse.url).toBe('http://127.0.0.1:3200/events')
    expect(sse.method).toBe('POST')
  })

  it('a second open is a second scratch tab (it does not overwrite the first)', () => {
    const a = openMockInSseTab({ name: 'A', url: 'http://127.0.0.1:3200/a', method: 'GET' })
    const b = openMockInSseTab({ name: 'B', url: 'http://127.0.0.1:3200/b', method: 'GET' })
    expect(a).not.toBe(b)
    expect(useTabsStore.getState().tabs).toHaveLength(2)
    expect(useSseStore.getState().url).toBe('http://127.0.0.1:3200/b')
  })
})

describe('startAndOpenMockInSseTab', () => {
  const target = { name: 'Ticker SSE', url: 'http://127.0.0.1:3200/events', method: 'GET' as const }

  it('not running + start fails → toast, no tab', async () => {
    const start = vi.fn(async () => 'Port 3200 is already in use')
    const id = await startAndOpenMockInSseTab({ ...target, running: false, start })
    expect(id).toBeNull()
    expect(start).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Port 3200 is already in use')
    expect(useTabsStore.getState().tabs).toHaveLength(0)
  })

  it('not running + start succeeds → the tab opens', async () => {
    const start = vi.fn(async () => null)
    const id = await startAndOpenMockInSseTab({ ...target, running: false, start })
    expect(id).toBeTruthy()
    expect(useTabsStore.getState().tabs[0]).toMatchObject({ protocol: 'sse', isDirty: false })
  })

  it('running → opens without starting', async () => {
    const start = vi.fn(async () => null)
    await startAndOpenMockInSseTab({ ...target, running: true, start })
    expect(start).not.toHaveBeenCalled()
    expect(useTabsStore.getState().tabs).toHaveLength(1)
  })
})

describe('target endpoint and method rules', () => {
  it('the header targets the first exact GET / ANY endpoint', () => {
    const eps = [
      httpEndpoint({ id: 'a', method: 'POST', path: '/x' }),
      httpEndpoint({ id: 'b', method: 'GET', path: '/users/:id', pathMode: 'param' }),
      httpEndpoint({ id: 'c', method: 'ANY', path: '/stream' }),
      httpEndpoint({ id: 'd', method: 'GET', path: '/events' }),
    ]
    expect(streamTargetEndpoint(eps)?.id).toBe('c')
    expect(streamTargetEndpoint([eps[0], eps[1]])).toBeNull()
  })

  it('ANY → GET; methods the SSE tab cannot send have no mapping', () => {
    expect(sseMethodFor('ANY')).toBe('GET')
    expect(sseMethodFor('PATCH')).toBe('PATCH')
    expect(sseMethodFor('HEAD')).toBeNull()
    expect(sseMethodFor('QUERY')).toBeNull()
  })

  it('the URL reaches a wildcard bind through loopback and keeps the base path', () => {
    const server = httpServer({ host: '0.0.0.0', port: 3200, basePath: 'api' })
    expect(mockEndpointUrl(server, '/events')).toBe('http://127.0.0.1:3200/api/events')
  })
})
