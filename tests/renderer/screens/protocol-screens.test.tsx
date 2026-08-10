/**
 * Smoke-render every protocol editor under components/protocols/ against a
 * seeded protocol store + mocked window.api. These are the "content region"
 * screens Workbench swaps in per active tab; a render-throw here used to
 * white-screen the whole app. `mountsWithoutCrash` turns that into a RED test.
 *
 * Each editor reads its own Zustand store — we seed each store minimally with
 * meaningful (non-default) state so the REAL editor tree renders (a connected /
 * loaded branch), not an early bail-out.
 */
import * as React from 'react'
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Monaco can't run in jsdom — stub it (mirrors the existing renderer tests).
vi.mock('../../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco">{value}</div>,
}))

import { mountsWithoutCrash, mockWindowApi } from './_mount'

import { useSoapStore } from '../../../src/renderer/stores/soap.store'
import { useWebSocketStore } from '../../../src/renderer/stores/websocket.store'
import { useGraphQLStore } from '../../../src/renderer/stores/graphql.store'
import { useGrpcStore } from '../../../src/renderer/stores/grpc.store'
import { useSseStore } from '../../../src/renderer/stores/sse.store'
import { useSocketIOStore } from '../../../src/renderer/stores/socketio.store'
import { useMcpStore } from '../../../src/renderer/stores/mcp.store'
import { useResponseStore } from '../../../src/renderer/stores/response.store'

import SoapEditor from '../../../src/renderer/components/protocols/SoapEditor'
import WebSocketEditor from '../../../src/renderer/components/protocols/WebSocketEditor'
import GraphQLEditor from '../../../src/renderer/components/protocols/GraphQLEditor'
import GrpcEditor from '../../../src/renderer/components/protocols/GrpcEditor'
import SseEditor from '../../../src/renderer/components/protocols/SseEditor'
import SocketIOEditor from '../../../src/renderer/components/protocols/SocketIOEditor'
import McpEditor from '../../../src/renderer/components/protocols/McpEditor'
import AiChatEditor from '../../../src/renderer/components/protocols/AiChatEditor'

function seedStores(): void {
  // SOAP — raw manual XML mode (RawXmlBodyEditor branch) + a response pane.
  useSoapStore.setState({
    parsedWsdl: null,
    selectedOperation: null,
    rawXml: '<soap:Envelope><soap:Body/></soap:Envelope>',
  })

  // WebSocket — connected, with a header row.
  useWebSocketStore.setState({
    url: 'wss://echo.websocket.org',
    connectionState: 'connected',
    customHeaders: [{ id: 'h1', key: 'X-Token', value: 'abc', enabled: true }],
    messages: [],
  })

  // GraphQL — a normal query (non-subscription) with variables + a header.
  useGraphQLStore.setState({
    url: 'https://api.example.com/graphql',
    query: 'query { me { id } }',
    variables: '{"id":1}',
    headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer x', enabled: true }],
    subscriptionState: 'disconnected',
    isLoading: false,
    isIntrospecting: false,
  })

  // gRPC — proto loaded with a service/method selected (exercises the full pane).
  useGrpcStore.setState({
    address: 'demo.connectrpc.com:443',
    useTls: true,
    protoSource: 'reflection',
    protoLoaded: true,
    services: [
      {
        name: 'eliza.v1.ElizaService',
        methods: [
          { name: 'Say', type: 'unary', requestType: 'SayRequest', responseType: 'SayResponse' },
        ],
      },
    ],
    selectedService: 'eliza.v1.ElizaService',
    selectedMethod: 'Say',
    requestBody: '{"sentence":"hi"}',
    metadata: [{ id: 'm1', key: 'x-api-key', value: 'k', enabled: true }],
    isLoading: false,
    isStreaming: false,
    halfClosed: false,
    errorMessage: null,
  })

  // SSE — connected, POST so the body branch is enabled.
  useSseStore.setState({
    url: 'https://api.example.com/stream',
    method: 'POST',
    connectionState: 'connected',
    customHeaders: [{ id: 'h1', key: 'Accept', value: 'text/event-stream', enabled: true }],
    lastEventId: '42',
    body: '{"n":1}',
    bodyType: 'json',
  })

  // Socket.IO — connected with a subscription and one event in the timeline.
  useSocketIOStore.setState({
    url: 'http://localhost:3000',
    namespace: '/',
    bearerToken: '',
    connectionState: 'connected',
    subscriptions: ['message'],
    events: [{ direction: 'in', event: 'message', data: '{"ok":true}', timestamp: Date.now() }],
    emitEvent: 'ping',
    emitPayload: '{}',
    newSubscription: '',
  })

  // MCP — connected with a tool selected (exercises args + result panes).
  useMcpStore.setState({
    transport: 'http',
    url: 'https://mcp.example.com/mcp',
    connectionState: 'connected',
    serverName: 'example',
    tools: [
      {
        name: 'echo',
        description: 'Echo input back',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      },
    ],
    selectedTool: 'echo',
    toolArgs: '{"text":"hi"}',
    result: null,
    resultError: null,
    isInvoking: false,
  })

  // Response store (SOAP editor embeds ResponsePane).
  useResponseStore.setState({ response: null, isLoading: false })
}

beforeEach(() => {
  mockWindowApi()
  seedStores()
})

afterEach(() => {
  cleanup()
})

describe('Protocol screens — smoke mount', () => {
  it('SoapEditor', () => {
    mountsWithoutCrash(<SoapEditor />)
  })

  it('WebSocketEditor', () => {
    mountsWithoutCrash(<WebSocketEditor />)
  })

  it('GraphQLEditor', () => {
    mountsWithoutCrash(<GraphQLEditor />)
  })

  it('GrpcEditor', () => {
    mountsWithoutCrash(<GrpcEditor />)
  })

  it('SseEditor', () => {
    mountsWithoutCrash(<SseEditor />)
  })

  it('SocketIOEditor', () => {
    mountsWithoutCrash(<SocketIOEditor />)
  })

  it('McpEditor', () => {
    mountsWithoutCrash(<McpEditor />)
  })

  it('AiChatEditor', () => {
    mountsWithoutCrash(<AiChatEditor />)
  })
})
