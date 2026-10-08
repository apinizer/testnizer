import { useMockMcpStore, stoppedState } from '../../stores/mock-mcp.store'
import { toast } from '../../lib/toast'
import type { MockMcpServer } from '../../types/mock-mcp'
import MockServerRow from '../mock/MockServerRow'
import { connectUrl } from './mock-mcp-draft'

/**
 * One Mock MCP server in the Mocks panel — the shared `MockServerRow` (same
 * row as HTTP mocks, issue #140) wired to the live state in the MCP store.
 */
export default function MockMcpServerRow({
  server,
  onOpen,
  onDelete,
}: {
  server: MockMcpServer
  onOpen: (server: MockMcpServer) => void
  onDelete: (server: MockMcpServer) => void
}) {
  const live = useMockMcpStore((s) => s.stateByServer[server.id]) ?? stoppedState(server.id)
  const startServer = useMockMcpStore((s) => s.startServer)
  const stopServer = useMockMcpStore((s) => s.stopServer)
  const url = connectUrl(server, live.url)

  const run = async (action: (id: string) => Promise<string | null>): Promise<void> => {
    const err = await action(server.id)
    if (err) toast.error(err)
  }

  return (
    <MockServerRow
      kind="mcp"
      testIdPrefix="mock-mcp"
      id={server.id}
      name={server.name}
      status={live.status}
      address={url}
      copyText={url}
      errorMessage={live.errorMessage}
      onOpen={() => onOpen(server)}
      onStart={() => void run(startServer)}
      onStop={() => void run(stopServer)}
      onDelete={() => onDelete(server)}
    />
  )
}
