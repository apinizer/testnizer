/**
 * Issue #190 follow-up: `mock.store.loadServers` had no latest-request guard
 * (the Mock MCP store got one for the same bug class). Opening project B
 * while project A's HTTP server list was still loading let A's slower answer
 * land last, so B's Mocks → HTTP SERVERS showed A's servers — or none.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { httpBridge, httpServer, resetHttpBridge } from './mock-http-bridge-stub'
import { useMockStore } from '../../src/renderer/stores/mock.store'

type ListResult = { success: true; data: ReturnType<typeof httpServer>[] }

function deferred(): { promise: Promise<ListResult>; resolve: (v: ListResult) => void } {
  let resolve!: (v: ListResult) => void
  const promise = new Promise<ListResult>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  resetHttpBridge()
  useMockStore.setState({ servers: [] })
})

describe('HTTP mock server list: only the latest project load lands (issue #190)', () => {
  it('A answers after B → the panel keeps B’s servers', async () => {
    const a = deferred()
    const b = deferred()
    httpBridge.server.list.mockImplementationOnce(() => a.promise)
    httpBridge.server.list.mockImplementationOnce(() => b.promise)

    const loadA = useMockStore.getState().loadServers('project-a')
    const loadB = useMockStore.getState().loadServers('project-b')

    b.resolve({
      success: true,
      data: [httpServer({ id: 'b-1', projectId: 'project-b', name: 'Copy' })],
    })
    await loadB
    a.resolve({ success: true, data: [] })
    await loadA

    expect(useMockStore.getState().servers.map((s) => s.id)).toEqual(['b-1'])
  })
})
