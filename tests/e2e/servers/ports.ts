import net from 'node:net'

/** Find a free TCP port on localhost. */
export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close((err) => (err ? reject(err) : resolve(port)))
    })
    srv.on('error', reject)
  })
}

export interface TestServerPorts {
  http: number
  ws: number
  sse: number
  socketio: number
  graphql: number
  grpc: number
  mcp: number
  llm: number
}

export const PORT_ENV_KEYS: Record<keyof TestServerPorts, string> = {
  http: 'E2E_HTTP_PORT',
  ws: 'E2E_WS_PORT',
  sse: 'E2E_SSE_PORT',
  socketio: 'E2E_SOCKETIO_PORT',
  graphql: 'E2E_GRAPHQL_PORT',
  grpc: 'E2E_GRPC_PORT',
  mcp: 'E2E_MCP_PORT',
  llm: 'E2E_LLM_PORT',
}
