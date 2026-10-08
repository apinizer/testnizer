/**
 * Tab helpers for HTTP mock servers — the twin of `mock-mcp/mock-mcp-tabs.ts`.
 * The stable id (`mock-<serverId>`) makes `openTab` refocus an open editor
 * instead of duplicating it.
 */
import { useTabsStore } from '../../stores/tabs.store'
import type { MockServer } from '../../types'

export function mockServerTabId(serverId: string): string {
  return `mock-${serverId}`
}

export function openMockServerTab(server: Pick<MockServer, 'id' | 'name'>): void {
  useTabsStore.getState().openTab({
    id: mockServerTabId(server.id),
    name: server.name,
    protocol: 'mockServer',
    mockServerId: server.id,
    isPreview: false,
  })
}

/** Close the server's editor tab, if open (after a delete). */
export function closeMockServerTab(serverId: string): void {
  const tabs = useTabsStore.getState()
  const id = mockServerTabId(serverId)
  if (tabs.tabs.some((t) => t.id === id)) tabs.closeTab(id)
}

/** Base URL a client uses to reach the mock (a wildcard bind is reached via loopback). */
export function mockServerUrl(server: Pick<MockServer, 'host' | 'port' | 'basePath'>): string {
  const host = server.host === '0.0.0.0' ? '127.0.0.1' : server.host
  const base = server.basePath ? `/${server.basePath.replace(/^\/+/, '')}` : ''
  return `http://${host}:${server.port}${base}`
}
