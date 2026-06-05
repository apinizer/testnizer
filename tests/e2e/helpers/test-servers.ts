import fs from 'node:fs'
import path from 'node:path'

export interface TestServerUrls {
  http: string
  ws: string
  sse: string
  socketio: string
  graphql: string
  grpc: string
  mcp: string
  llm: string
}

const STATE_FILE = path.join(__dirname, '../servers/.test-servers.json')

let cached: TestServerUrls | null = null

/** Read local test server URLs written by globalSetup. */
export function getTestServerUrls(): TestServerUrls {
  if (cached) return cached

  if (process.env.E2E_HTTP_BASE) {
    cached = {
      http: process.env.E2E_HTTP_BASE,
      ws: process.env.E2E_WS_URL ?? `ws://127.0.0.1:${process.env.E2E_WS_PORT}`,
      sse: process.env.E2E_SSE_URL ?? `http://127.0.0.1:${process.env.E2E_SSE_PORT}/events`,
      socketio: process.env.E2E_SOCKETIO_URL ?? `http://127.0.0.1:${process.env.E2E_SOCKETIO_PORT}`,
      graphql: process.env.E2E_GRAPHQL_URL ?? `http://127.0.0.1:${process.env.E2E_GRAPHQL_PORT}/graphql`,
      grpc: process.env.E2E_GRPC_ADDR ?? `127.0.0.1:${process.env.E2E_GRPC_PORT}`,
      mcp: process.env.E2E_MCP_URL ?? `http://127.0.0.1:${process.env.E2E_MCP_PORT}/mcp`,
      llm: process.env.E2E_LLM_BASE ?? `http://127.0.0.1:${process.env.E2E_LLM_PORT}`,
    }
    return cached
  }

  if (fs.existsSync(STATE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as { urls: TestServerUrls }
    cached = raw.urls
    return cached
  }

  throw new Error(
    'Test server URLs not available. Run Playwright with globalSetup or set E2E_HTTP_BASE.',
  )
}

/** httpbin-compatible base URL (local echo server). */
export function localHttpBin(): string {
  return getTestServerUrls().http
}
