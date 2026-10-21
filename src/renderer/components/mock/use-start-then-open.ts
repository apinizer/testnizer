/**
 * Hook behind the "Open in … tab" header buttons of an HTTP-table mock server
 * (issue #221): SSE (`MockOpenInSse.tsx`) and AI Chat (`MockOpenInAiChat.tsx`).
 * The Mock MCP header uses the store-free `useStartThenOpenGate` directly
 * (issue #222).
 */
import { useMockStore } from '../../stores/mock.store'
import type { MockServer } from '../../types'
import { useStartThenOpenGate } from './start-then-open-gate'

export { useStartThenOpenGate }

/** `useStartThenOpenGate` for a server of the HTTP mock table (HTTP / SSE / AI). */
export function useStartThenOpen(
  server: MockServer,
  status: string,
  keys: { open: string; startAndOpen: string },
) {
  const startServer = useMockStore((s) => s.startServer)
  return useStartThenOpenGate(status, () => startServer(server.id), keys)
}
