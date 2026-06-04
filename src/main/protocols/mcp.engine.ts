import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export type McpTransport = 'http' | 'sse' | 'stdio'

export interface McpTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface McpConnectionInfo {
  connectionId: string
  transport: McpTransport
  url: string
  serverName?: string
  serverVersion?: string
}

interface Connection {
  client: Client
  info: McpConnectionInfo
}

const connections = new Map<string, Connection>()
/**
 * In-flight MCP handshakes keyed by the renderer-supplied pendingId. The
 * value is a teardown closure that closes the transport so the in-flight
 * `client.connect()` rejects. Removed once the connection opens or fails.
 */
const pendingConnects = new Map<string, () => Promise<void>>()
let nextId = 1

function makeId(): string {
  return `mcp-${nextId++}-${Date.now()}`
}

export async function mcpConnect(options: {
  transport: McpTransport
  url: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  /**
   * Renderer-supplied id so `mcpCancelConnect(id)` can abort the handshake
   * before `client.connect()` resolves. Cleared once the connection opens
   * or fails.
   */
  pendingId?: string
}): Promise<McpConnectionInfo> {
  const connectionId = makeId()
  const client = new Client({ name: 'Testnizer', version: '1.0.0' })

  let transport: StreamableHTTPClientTransport | SSEClientTransport | StdioClientTransport

  if (options.transport === 'http') {
    transport = new StreamableHTTPClientTransport(new URL(options.url))
  } else if (options.transport === 'sse') {
    transport = new SSEClientTransport(new URL(options.url))
  } else {
    // stdio — command is the executable, url field used as command when command not provided
    const cmd = options.command || options.url
    const parts = cmd.split(/\s+/)
    transport = new StdioClientTransport({
      command: parts[0],
      args: [...parts.slice(1), ...(options.args ?? [])],
      env: options.env,
    })
  }

  // Register before the connect() promise so a fast cancel still finds the
  // entry. Teardown calls transport.close() — this is what causes
  // `client.connect()` to reject for HTTP / SSE / stdio transports.
  if (options.pendingId) {
    pendingConnects.set(options.pendingId, async () => {
      try {
        await transport.close()
      } catch {
        // Best-effort: socket may already be torn down.
      }
    })
  }

  try {
    await client.connect(transport)
  } catch (err) {
    if (options.pendingId) pendingConnects.delete(options.pendingId)
    throw err
  }

  if (options.pendingId) pendingConnects.delete(options.pendingId)

  const serverInfo = client.getServerVersion()
  const info: McpConnectionInfo = {
    connectionId,
    transport: options.transport,
    url: options.url,
    serverName: serverInfo?.name,
    serverVersion: serverInfo?.version,
  }

  connections.set(connectionId, { client, info })
  return info
}

/**
 * Abort an in-flight `mcpConnect()`. Returns true when a pending handshake
 * was found and the underlying transport torn down. The original `mcpConnect`
 * promise will reject through the existing error path.
 */
export async function mcpCancelConnect(pendingId: string): Promise<boolean> {
  const teardown = pendingConnects.get(pendingId)
  if (!teardown) return false
  pendingConnects.delete(pendingId)
  await teardown()
  return true
}

export async function mcpDisconnect(connectionId: string): Promise<void> {
  const conn = connections.get(connectionId)
  if (!conn) return
  try {
    await conn.client.close()
  } catch {
    /* ignore */
  }
  connections.delete(connectionId)
}

export async function mcpListTools(connectionId: string): Promise<McpTool[]> {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('Not connected')
  const res = await conn.client.listTools()
  return res.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
  }))
}

export async function mcpCallTool(
  connectionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('Not connected')
  const result = await conn.client.callTool({ name: toolName, arguments: args })
  return result
}

export function mcpGetConnection(connectionId: string): McpConnectionInfo | undefined {
  return connections.get(connectionId)?.info
}

export function mcpDisconnectAll(): void {
  for (const [id] of connections) {
    mcpDisconnect(id).catch(() => {})
  }
}
