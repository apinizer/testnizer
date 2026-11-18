/**
 * The active project's mock server addresses (HTTP / SSE / AI and MCP mocks),
 * for the History "mock servers" filter. Loaded only while that filter is on:
 * the mock stores are imported lazily (the HTTP one reads `window.api.mock` at
 * module load) and their lists loaded for the active project when they hold
 * another project's — or none, when the Mocks page was never opened.
 */
import { useEffect, useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import type { MockAddress } from './history-overview'

const NONE: readonly MockAddress[] = []

export function useMockAddresses(enabled: boolean): readonly MockAddress[] {
  const projectId = useWorkspaceStore((s) => s.activeProjectId)
  const [state, setState] = useState<{ projectId: string | null; list: readonly MockAddress[] }>({
    projectId: null,
    list: NONE,
  })

  useEffect(() => {
    if (!enabled || !projectId) return
    let alive = true
    const unsubscribe: Array<() => void> = []
    void (async () => {
      try {
        const [{ useMockStore }, { useMockMcpStore }] = await Promise.all([
          import('../../stores/mock.store'),
          import('../../stores/mock-mcp.store'),
        ])
        if (!alive) return
        const read = (): void => {
          const http = useMockStore.getState()
          const mcp = useMockMcpStore.getState()
          const servers = [
            ...(http.projectId === projectId ? http.servers : []),
            ...(mcp.projectId === projectId ? mcp.servers : []),
          ]
          if (alive) {
            setState({ projectId, list: servers.map((s) => ({ host: s.host, port: s.port })) })
          }
        }
        unsubscribe.push(useMockStore.subscribe(read), useMockMcpStore.subscribe(read))
        read()
        if (useMockStore.getState().projectId !== projectId) {
          await useMockStore.getState().loadServers(projectId)
        }
        if (useMockMcpStore.getState().projectId !== projectId) {
          await useMockMcpStore.getState().loadServers(projectId)
        }
      } catch {
        // No mock bridge (tests, a broken preload): no address is a mock.
      }
    })()
    return () => {
      alive = false
      unsubscribe.forEach((u) => u())
    }
  }, [enabled, projectId])

  return enabled && state.projectId === projectId ? state.list : NONE
}
