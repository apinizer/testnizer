/**
 * The protocol action buttons name the Ctrl/Cmd+Enter chord in their tooltip
 * — but ONLY in a state where the chord (`run-active-request.ts`) does exactly
 * what a click on that button does. Before, only MCP Invoke said so.
 *
 * Every case below is checked two ways:
 *  1. the expected labelled / not-labelled verdict, and
 *  2. parity: the title names the chord  <=>  a click and `runActiveRequest()`
 *     call the same store action (and a click calls something).
 * So a button that says "(⌘Enter)" while the chord would do something else —
 * the WebSocket Send button while disconnected (the chord connects), HTTP
 * Cancel (the chord sends) — fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-impl" />,
  loader: { config: () => {} },
}))
vi.mock('monaco-editor', () => ({}))

import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useMqttStore } from '../../src/renderer/stores/mqtt.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { runActiveRequest } from '../../src/renderer/lib/run-active-request'
import { formatShortcut } from '../../src/renderer/lib/shortcut-format'
import UrlBar from '../../src/renderer/components/layout/UrlBar'
import GraphQLQueryPane from '../../src/renderer/components/protocols/GraphQLQueryPane'
import SoapEditor from '../../src/renderer/components/protocols/SoapEditor'
import GrpcRequestPane from '../../src/renderer/components/protocols/GrpcRequestPane'
import WsConnectionBar from '../../src/renderer/components/protocols/WsConnectionBar'
import WsComposer from '../../src/renderer/components/protocols/WsComposer'
import SioComposer from '../../src/renderer/components/protocols/socketio/SioComposer'
import SocketIOConnectionBar from '../../src/renderer/components/protocols/socketio/SocketIOConnectionBar'
import MqttConnectionBar from '../../src/renderer/components/protocols/mqtt/MqttConnectionBar'
import MqttComposer from '../../src/renderer/components/protocols/mqtt/MqttComposer'
import SseConnectionBar from '../../src/renderer/components/protocols/SseConnectionBar'
import type { Tab } from '../../src/renderer/types'

const CHORD = formatShortcut(['Mod', 'Enter'])

/** Every store action a button or the chord may reach, by name. */
const mocks: Record<string, ReturnType<typeof vi.fn>> = {}
const mock = (name: string) => {
  const f = vi.fn(async () => undefined)
  mocks[name] = f
  return f
}
const called = (): string[] =>
  Object.entries(mocks)
    .filter(([, f]) => f.mock.calls.length > 0)
    .map(([n]) => n)
    .sort()
const resetCalls = (): void => Object.values(mocks).forEach((f) => f.mockClear())

function activate(protocol: string): void {
  const id = `tab-${protocol}`
  useTabsStore.setState({
    tabs: [{ id, name: id, protocol, url: 'http://x', isDirty: false } as Tab],
    activeTabId: id,
  })
}

/** The title of `testId`, then the parity of click vs chord in that state. */
function check(testId: string, labelled: boolean): void {
  const button = screen.getByTestId(testId)
  const title = button.getAttribute('title') ?? ''
  expect(title.includes(CHORD), `${testId} title "${title}"`).toBe(labelled)

  resetCalls()
  fireEvent.click(button)
  const byClick = called()
  resetCalls()
  act(() => void runActiveRequest())
  const byChord = called()
  resetCalls()
  const same = byClick.length > 0 && byClick.join() === byChord.join()
  expect(same, `${testId}: click ${byClick.join() || '-'} / chord ${byChord.join() || '-'}`).toBe(
    labelled,
  )
}

beforeEach(() => {
  ;(window as unknown as { api: Record<string, unknown> }).api = {}
  for (const k of Object.keys(mocks)) delete mocks[k]
  useRequestStore.setState({
    sendRequest: mock('http.send'),
    cancelRequest: mock('http.cancel'),
  } as never)
  useResponseStore.setState({ isLoading: false } as never)
  useGraphQLStore.setState({
    executeQuery: mock('gql.run'),
    cancelQuery: mock('gql.cancel'),
    subscribe: mock('gql.subscribe'),
    unsubscribe: mock('gql.unsubscribe'),
    url: 'http://localhost/graphql',
    query: '{ countries { code } }',
    operationName: '',
    isLoading: false,
    subscriptionState: 'idle',
  } as never)
  useSoapStore.setState({
    sendSoap: mock('soap.send'),
    cancelSoap: mock('soap.cancel'),
    mode: 'manual',
    parsedWsdl: null,
    selectedOperation: null,
  } as never)
  useGrpcStore.setState({
    execute: mock('grpc.execute'),
    cancelStream: mock('grpc.cancelStream'),
    cancelUnary: mock('grpc.cancelUnary'),
    endClientStream: mock('grpc.end'),
    protoLoaded: true,
    protoSource: 'file',
    protoUrl: '',
    services: [],
    selectedService: 'Svc',
    selectedMethod: 'Get',
    isLoading: false,
    isStreaming: false,
    halfClosed: false,
    getSelectedMethod: () => ({ name: 'Get', type: 'unary' }),
  } as never)
  useWebSocketStore.setState({
    connect: mock('ws.connect'),
    disconnect: mock('ws.disconnect'),
    sendMessage: mock('ws.send'),
    url: 'ws://localhost/ws',
    connectionState: 'disconnected',
    composerContent: 'hello',
  } as never)
  useSocketIOStore.setState({
    connect: mock('sio.connect'),
    disconnect: mock('sio.disconnect'),
    emit: mock('sio.emit'),
    url: 'http://localhost:3000',
    connectionState: 'disconnected',
    connectionId: null,
  } as never)
  useMqttStore.setState({
    connect: mock('mqtt.connect'),
    disconnect: mock('mqtt.disconnect'),
    publish: mock('mqtt.publish'),
    url: 'mqtt://localhost',
    connectionState: 'disconnected',
    connectionId: null,
  } as never)
  useMqttStore.setState((s) => ({ composer: { ...s.composer, topic: 'a/b' } }) as never)
  useSseStore.setState({
    connect: mock('sse.connect'),
    disconnect: mock('sse.disconnect'),
    reconnect: mock('sse.reconnect'),
    url: 'http://localhost/sse',
    connectionState: 'disconnected',
  } as never)
})
afterEach(cleanup)

describe('HTTP Send', () => {
  it('names the chord while it sends', () => {
    activate('http')
    render(<UrlBar />)
    check('send-btn', true)
  })

  it('not as Cancel: a click cancels, the chord sends', () => {
    activate('http')
    useResponseStore.setState({ isLoading: true } as never)
    render(<UrlBar />)
    check('send-btn', false)
  })
})

describe('GraphQL Run / Subscribe', () => {
  it('Run names the chord; as Cancel it does not', () => {
    activate('graphql')
    render(<GraphQLQueryPane />)
    check('graphql-run', true)
    act(() => useGraphQLStore.setState({ isLoading: true } as never))
    check('graphql-run', false)
  })

  it('Subscribe names the chord; Unsubscribe does not (the chord leaves a subscription alone)', () => {
    activate('graphql')
    useGraphQLStore.setState({ query: 'subscription { tick }' } as never)
    render(<GraphQLQueryPane />)
    check('graphql-subscribe', true)
    act(() => useGraphQLStore.setState({ subscriptionState: 'connected' } as never))
    check('graphql-subscribe', false)
  })
})

describe('SOAP Send', () => {
  it('names the chord while it sends; as Cancel it does not', () => {
    activate('soap')
    render(<SoapEditor />)
    check('soap-send', true)
    act(() => useResponseStore.setState({ isLoading: true } as never))
    check('soap-send', false)
  })

  it('not while a parsed WSDL has no operation chosen (disabled; the chord does nothing)', () => {
    activate('soap')
    useSoapStore.setState({ mode: 'wsdl', parsedWsdl: { services: [] } } as never)
    render(<SoapEditor />)
    check('soap-send', false)
  })
})

describe('gRPC Execute / stream Send', () => {
  it('Execute names the chord; as Cancel it does not', () => {
    activate('grpc')
    render(<GrpcRequestPane />)
    check('grpc-execute', true)
    act(() => useGrpcStore.setState({ isLoading: true } as never))
    check('grpc-execute', false)
  })

  it('a bidi stream’s Send names the chord until End Streaming', () => {
    activate('grpc')
    useGrpcStore.setState({
      isStreaming: true,
      getSelectedMethod: () => ({ name: 'Chat', type: 'bidi_streaming' }),
    } as never)
    render(<GrpcRequestPane />)
    check('grpc-stream-send', true)
    act(() => useGrpcStore.setState({ halfClosed: true } as never))
    check('grpc-stream-send', false)
  })
})

describe('realtime: Connect while disconnected, Send / Emit / Publish while connected', () => {
  it('WebSocket: Connect → Send as the connection opens', () => {
    activate('websocket')
    render(
      <>
        <WsConnectionBar />
        <WsComposer />
      </>,
    )
    check('ws-connect', true)
    // Disabled while disconnected — and the chord would connect, not send.
    check('ws-send', false)

    act(() => useWebSocketStore.setState({ connectionState: 'connected' } as never))
    check('ws-disconnect', false)
    check('ws-send', true)

    // Connected with an empty composer: Send is disabled, the chord does nothing.
    act(() => useWebSocketStore.setState({ composerContent: '' } as never))
    check('ws-send', false)
  })

  it('Socket.IO: Connect, then Emit — also with an empty composer (both call emit())', () => {
    activate('socketio')
    render(
      <>
        <SocketIOConnectionBar />
        <SioComposer />
      </>,
    )
    check('socketio-connect', true)
    check('socketio-emit', false)

    act(() =>
      useSocketIOStore.setState({ connectionState: 'connected', connectionId: 'c1' } as never),
    )
    check('socketio-connect', false) // now Disconnect
    useSocketIOStore.setState((s) => ({
      emitEvent: '',
      emitArgs: s.emitArgs.map((a) => ({ ...a, content: '' })),
    }))
    check('socketio-emit', true)
  })

  it('MQTT: Connect, then Publish', () => {
    activate('mqtt')
    render(
      <>
        <MqttConnectionBar />
        <MqttComposer />
      </>,
    )
    check('mqtt-connect', true)
    check('mqtt-publish', false)
    act(() => useMqttStore.setState({ connectionState: 'connected', connectionId: 'm1' } as never))
    check('mqtt-connect', false)
    check('mqtt-publish', true)
  })

  it('SSE: Connect only (a one-way stream has nothing to send)', () => {
    activate('sse')
    render(<SseConnectionBar />)
    check('sse-connect', true)
    act(() => useSseStore.setState({ connectionState: 'connected' } as never))
    check('sse-disconnect', false)
  })
})

describe('no label where the button is disabled or the chord goes elsewhere', () => {
  it('HTTP Send on a tab without a protocol: the Workbench shows it as HTTP, so does the chord', () => {
    useTabsStore.setState({
      tabs: [{ id: 'old', name: 'Old', protocol: '', url: 'http://x', isDirty: false } as never],
      activeTabId: 'old',
    })
    render(<UrlBar />)
    check('send-btn', true)
  })

  it('HTTP Send on a tab that is not HTTP (the UrlBar fallback): the chord does nothing', () => {
    activate('tools.jwt')
    render(<UrlBar />)
    check('send-btn', false)
  })

  it.each([
    [
      'websocket',
      WsConnectionBar,
      'ws-connect',
      () => useWebSocketStore.setState({ url: '' } as never),
    ],
    [
      'socketio',
      SocketIOConnectionBar,
      'socketio-connect',
      () => useSocketIOStore.setState({ url: '' } as never),
    ],
    ['mqtt', MqttConnectionBar, 'mqtt-connect', () => useMqttStore.setState({ url: '' } as never)],
    ['sse', SseConnectionBar, 'sse-connect', () => useSseStore.setState({ url: '' } as never)],
  ] as const)('%s Connect with an empty URL (disabled)', (protocol, Bar, testId, clearUrl) => {
    activate(protocol)
    clearUrl()
    render(<Bar />)
    check(testId, false)
  })

  it.each([
    ['graphql-run', '{ a }'],
    ['graphql-subscribe', 'subscription { tick }'],
  ])('GraphQL %s with an empty URL (disabled)', (testId, query) => {
    activate('graphql')
    useGraphQLStore.setState({ url: '', query } as never)
    render(<GraphQLQueryPane />)
    check(testId, false)
  })

  it('MQTT Publish without a topic (disabled)', () => {
    activate('mqtt')
    useMqttStore.setState({ connectionState: 'connected', connectionId: 'm1' } as never)
    useMqttStore.setState((s) => ({ composer: { ...s.composer, topic: '' } }) as never)
    render(<MqttComposer />)
    check('mqtt-publish', false)
  })

  it('gRPC Execute without a method (disabled)', () => {
    activate('grpc')
    useGrpcStore.setState({ selectedMethod: '' } as never)
    render(<GrpcRequestPane />)
    check('grpc-execute', false)
  })
})
