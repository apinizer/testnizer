import fs from 'node:fs'
import path from 'node:path'
import { getFreePort, type TestServerPorts, PORT_ENV_KEYS } from './ports'
import { startHttpEchoServer, type HttpEchoServer } from './http-echo'
import { startWsEchoServer, type WsEchoServer } from './ws-echo'
import { startSseServer, type SseServer } from './sse-server'
import { startSocketIoServer, type SocketIoServer } from './socketio-server'
import { startGraphqlServer, type GraphqlServer } from './graphql-server'
import { startGrpcServer, type GrpcServer } from './grpc-server'
import { startMcpServer, type McpServer } from './mcp-server'
import { startFakeLlmServer, type FakeLlmServer } from './fake-llm'

export const SERVERS_STATE_FILE = path.join(__dirname, '.test-servers.json')

export interface RunningServers {
  ports: TestServerPorts
  http: HttpEchoServer
  ws: WsEchoServer
  sse: SseServer
  socketio: SocketIoServer
  graphql: GraphqlServer
  grpc: GrpcServer
  mcp: McpServer
  llm: FakeLlmServer
}

export async function startAllTestServers(): Promise<RunningServers> {
  const ports: TestServerPorts = {
    http: await getFreePort(),
    ws: await getFreePort(),
    sse: await getFreePort(),
    socketio: await getFreePort(),
    graphql: await getFreePort(),
    grpc: await getFreePort(),
    mcp: await getFreePort(),
    llm: await getFreePort(),
  }

  const [http, ws, sse, socketio, graphql, grpc, mcp, llm] = await Promise.all([
    startHttpEchoServer(ports.http),
    startWsEchoServer(ports.ws),
    startSseServer(ports.sse),
    startSocketIoServer(ports.socketio),
    startGraphqlServer(ports.graphql),
    startGrpcServer(ports.grpc),
    startMcpServer(ports.mcp),
    startFakeLlmServer(ports.llm),
  ])

  const state: RunningServers = { ports, http, ws, sse, socketio, graphql, grpc, mcp, llm }

  fs.writeFileSync(
    SERVERS_STATE_FILE,
    JSON.stringify(
      {
        ports,
        urls: {
          http: http.baseUrl,
          ws: ws.url,
          sse: sse.url,
          socketio: socketio.url,
          graphql: graphql.url,
          grpc: grpc.address,
          mcp: mcp.url,
          llm: llm.url.replace('/v1/chat/completions', ''),
        },
      },
      null,
      2,
    ),
  )

  for (const [key, envKey] of Object.entries(PORT_ENV_KEYS)) {
    process.env[envKey] = String(ports[key as keyof TestServerPorts])
  }
  process.env.E2E_HTTP_BASE = http.baseUrl
  process.env.HTTPBIN_URL = http.baseUrl

  return state
}

export async function stopAllTestServers(servers: RunningServers): Promise<void> {
  await Promise.all([
    servers.http.close(),
    servers.ws.close(),
    servers.sse.close(),
    servers.socketio.close(),
    servers.graphql.close(),
    servers.grpc.close(),
    servers.mcp.close(),
    servers.llm.close(),
  ])
  if (fs.existsSync(SERVERS_STATE_FILE)) {
    fs.unlinkSync(SERVERS_STATE_FILE)
  }
}

/** Singleton used by globalSetup — torn down in globalTeardown. */
let globalServers: RunningServers | null = null

export function getGlobalServers(): RunningServers | null {
  return globalServers
}

export async function bootGlobalServers(): Promise<RunningServers> {
  if (!globalServers) {
    globalServers = await startAllTestServers()
  }
  return globalServers
}

export async function shutdownGlobalServers(): Promise<void> {
  if (globalServers) {
    await stopAllTestServers(globalServers)
    globalServers = null
  }
}
