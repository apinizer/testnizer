/**
 * Tester finding 10 — Ctrl/Cmd+Enter on a GraphQL tab did not run the query.
 *
 * `runActiveRequest` (the one dispatch behind the chord and the palette's
 * Send, issue #165) told MCP apart and sent everything else through the HTTP
 * request store's `sendRequest`: on a GraphQL, SOAP, gRPC or realtime tab the
 * chord fired an HTTP request built from a stale slice (or nothing at all).
 * And inside a Monaco editor the chord never reached the window listener —
 * Monaco's own Ctrl/Cmd+Enter (insert line below) handles it and stops the
 * event.
 *
 * The rule now: the chord does what the protocol's primary button on screen
 * does, with that button's own disabled / busy gate, and never cancels,
 * disconnects or unsubscribes. One key press is one dispatch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'

// MonacoWrapperImpl is exercised below with a fake editor: capture what it
// registers instead of booting Monaco in jsdom. Everything else that renders a
// MonacoWrapper gets a plain div.
interface FakeAction {
  id: string
  keybindings?: number[]
  run: () => void
}
const actions: FakeAction[] = []
vi.mock('@monaco-editor/react', () => ({
  default: (props: { onMount?: (ed: unknown, monaco: unknown) => void }) => {
    const ed = {
      addAction: (a: FakeAction) => {
        actions.push(a)
        return { dispose: () => {} }
      },
      getModel: () => null,
      onDidChangeModelContent: () => ({ dispose: () => {} }),
      createDecorationsCollection: () => ({ set: () => {} }),
    }
    const monaco = {
      KeyMod: { CtrlCmd: 2048 },
      KeyCode: { Enter: 3 },
      languages: {
        registerCompletionItemProvider: () => ({ dispose: () => {} }),
        CompletionItemKind: {},
      },
    }
    React.useEffect(() => props.onMount?.(ed, monaco), [])
    return <div data-testid="monaco-impl" />
  },
  loader: { config: () => {} },
}))
vi.mock('monaco-editor', () => ({}))

import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useMqttStore } from '../../src/renderer/stores/mqtt.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { runActiveRequest } from '../../src/renderer/lib/run-active-request'
import { useKeyboardShortcuts } from '../../src/renderer/lib/keyboard-shortcuts'
import { useCommandActions } from '../../src/renderer/lib/command-registry'
import MonacoWrapperImpl from '../../src/renderer/components/shared/MonacoWrapperImpl'
import SioComposer from '../../src/renderer/components/protocols/socketio/SioComposer'
import WsConnectionBar from '../../src/renderer/components/protocols/WsConnectionBar'
import MqttConnectionBar from '../../src/renderer/components/protocols/mqtt/MqttConnectionBar'
import SseConnectionBar from '../../src/renderer/components/protocols/SseConnectionBar'
import UrlBar from '../../src/renderer/components/layout/UrlBar'
import GraphQLQueryPane from '../../src/renderer/components/protocols/GraphQLQueryPane'
import SoapWsdlImport from '../../src/renderer/components/protocols/SoapWsdlImport'
import type { Tab } from '../../src/renderer/types'

const fn = () => vi.fn(async () => undefined)

let sendRequest: ReturnType<typeof fn>
let gql: Record<'executeQuery' | 'subscribe' | 'unsubscribe' | 'cancelQuery', ReturnType<typeof fn>>
let soap: Record<'sendSoap' | 'cancelSoap', ReturnType<typeof fn>>
let grpc: Record<
  'execute' | 'cancelStream' | 'cancelUnary' | 'endClientStream',
  ReturnType<typeof fn>
>
let ws: Record<'connect' | 'disconnect' | 'sendMessage', ReturnType<typeof fn>>
let sio: Record<'connect' | 'disconnect' | 'emit', ReturnType<typeof fn>>
let mqtt: Record<'connect' | 'disconnect' | 'publish', ReturnType<typeof fn>>
let sse: Record<'connect' | 'disconnect' | 'reconnect', ReturnType<typeof fn>>

function activate(protocol: string, id = `tab-${protocol}`): void {
  useTabsStore.setState({
    tabs: [{ id, name: id, protocol, isDirty: false } as Tab],
    activeTabId: id,
  })
}

/** Every action the dispatch may reach — none may have run. */
function allCalls(): number {
  return [sendRequest, gql, soap, grpc, ws, sio, mqtt, sse]
    .flatMap((x) => (typeof x === 'function' ? [x] : Object.values(x)))
    .reduce((n, f) => n + f.mock.calls.length, 0)
}

function pressModEnter(target: EventTarget = window): void {
  // Both modifiers: the handler reads Cmd on macOS and Ctrl elsewhere.
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, metaKey: true, bubbles: true }),
  )
}

beforeEach(() => {
  actions.length = 0
  ;(window as unknown as { api: Record<string, unknown> }).api = {}
  sendRequest = fn()
  useRequestStore.setState({ sendRequest } as never)
  useResponseStore.setState({ isLoading: false } as never)

  gql = { executeQuery: fn(), subscribe: fn(), unsubscribe: fn(), cancelQuery: fn() }
  useGraphQLStore.setState({
    ...gql,
    url: 'http://localhost/graphql',
    query: '{ countries { code } }',
    operationName: '',
    isLoading: false,
    subscriptionState: 'idle',
  } as never)

  soap = { sendSoap: fn(), cancelSoap: fn() }
  useSoapStore.setState({
    ...soap,
    mode: 'manual',
    parsedWsdl: null,
    selectedOperation: null,
  } as never)

  grpc = { execute: fn(), cancelStream: fn(), cancelUnary: fn(), endClientStream: fn() }
  useGrpcStore.setState({
    ...grpc,
    protoLoaded: true,
    protoSource: 'file',
    protoUrl: '',
    selectedService: 'Svc',
    selectedMethod: 'Get',
    isLoading: false,
    isStreaming: false,
    halfClosed: false,
    getSelectedMethod: () => ({ name: 'Get', type: 'unary' }),
  } as never)

  ws = { connect: fn(), disconnect: fn(), sendMessage: fn() }
  useWebSocketStore.setState({
    ...ws,
    url: 'ws://localhost/ws',
    connectionState: 'disconnected',
    composerContent: 'hello',
  } as never)

  sio = { connect: fn(), disconnect: fn(), emit: fn() }
  useSocketIOStore.setState({
    ...sio,
    url: 'http://localhost:3000',
    connectionState: 'disconnected',
    connectionId: null,
  } as never)

  mqtt = { connect: fn(), disconnect: fn(), publish: fn() }
  useMqttStore.setState({
    ...mqtt,
    url: 'mqtt://localhost',
    connectionState: 'disconnected',
    connectionId: null,
  } as never)
  useMqttStore.setState((s) => ({ composer: { ...s.composer, topic: 'a/b' } }) as never)

  sse = { connect: fn(), disconnect: fn(), reconnect: fn() }
  useSseStore.setState({
    ...sse,
    url: 'http://localhost/sse',
    connectionState: 'disconnected',
  } as never)
})
afterEach(cleanup)

describe('GraphQL', () => {
  it('a query runs the query, never an HTTP send', () => {
    activate('graphql')
    runActiveRequest()
    expect(gql.executeQuery).toHaveBeenCalledTimes(1)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('a subscription operation subscribes', () => {
    activate('graphql')
    useGraphQLStore.setState({ query: 'subscription { tick }' } as never)
    runActiveRequest()
    expect(gql.subscribe).toHaveBeenCalledTimes(1)
    expect(gql.executeQuery).not.toHaveBeenCalled()
  })

  it('a running subscription is never stopped, a running query never cancelled', () => {
    activate('graphql')
    useGraphQLStore.setState({
      query: 'subscription { tick }',
      subscriptionState: 'connected',
    } as never)
    runActiveRequest()
    useGraphQLStore.setState({
      query: '{ a }',
      subscriptionState: 'idle',
      isLoading: true,
    } as never)
    runActiveRequest()
    expect(allCalls()).toBe(0)
  })
})

describe('SOAP', () => {
  it('sends the SOAP request', () => {
    activate('soap')
    runActiveRequest()
    expect(soap.sendSoap).toHaveBeenCalledTimes(1)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('follows the Send button: no operation picked from a WSDL, or in flight → nothing', () => {
    activate('soap')
    useSoapStore.setState({
      mode: 'wsdl',
      parsedWsdl: { services: [] },
      selectedOperation: null,
    } as never)
    runActiveRequest()
    useSoapStore.setState({ mode: 'manual', parsedWsdl: null } as never)
    useResponseStore.setState({ isLoading: true } as never)
    runActiveRequest()
    expect(allCalls()).toBe(0)
  })
})

describe('gRPC', () => {
  it('invokes a unary method', () => {
    activate('grpc')
    runActiveRequest()
    expect(grpc.execute).toHaveBeenCalledTimes(1)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('sends the next message on an open client / bidi stream', () => {
    activate('grpc')
    useGrpcStore.setState({
      isStreaming: true,
      isLoading: true,
      getSelectedMethod: () => ({ name: 'Chat', type: 'bidi_streaming' }),
    } as never)
    runActiveRequest()
    expect(grpc.execute).toHaveBeenCalledTimes(1)
  })

  it('does nothing in flight, on a server stream, after half-close, or before a definition', () => {
    activate('grpc')
    useGrpcStore.setState({ isLoading: true } as never)
    runActiveRequest()
    useGrpcStore.setState({
      isLoading: true,
      isStreaming: true,
      getSelectedMethod: () => ({ name: 'Feed', type: 'server_streaming' }),
    } as never)
    runActiveRequest()
    useGrpcStore.setState({
      halfClosed: true,
      getSelectedMethod: () => ({ name: 'Chat', type: 'bidi_streaming' }),
    } as never)
    runActiveRequest()
    useGrpcStore.setState({ isLoading: false, isStreaming: false, halfClosed: false } as never)
    useGrpcStore.setState({
      protoLoaded: false,
      getSelectedMethod: () => ({ name: 'Get', type: 'unary' }),
    } as never)
    runActiveRequest()
    expect(allCalls()).toBe(0)
  })
})

describe('realtime: disconnected → Connect, connected → send the message, never disconnect', () => {
  it('WebSocket', () => {
    activate('websocket')
    runActiveRequest()
    expect(ws.connect).toHaveBeenCalledTimes(1)
    useWebSocketStore.setState({ connectionState: 'connecting' } as never)
    runActiveRequest()
    expect(ws.connect).toHaveBeenCalledTimes(1)
    useWebSocketStore.setState({ connectionState: 'connected', connectionId: 'c1' } as never)
    runActiveRequest()
    expect(ws.sendMessage).toHaveBeenCalledTimes(1)
    useWebSocketStore.setState({ composerContent: '   ' } as never)
    runActiveRequest()
    expect(ws.sendMessage).toHaveBeenCalledTimes(1)
    expect(ws.disconnect).not.toHaveBeenCalled()
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('Socket.IO', () => {
    activate('socketio')
    runActiveRequest()
    expect(sio.connect).toHaveBeenCalledTimes(1)
    useSocketIOStore.setState({ connectionState: 'connected', connectionId: 'c1' } as never)
    runActiveRequest()
    expect(sio.emit).toHaveBeenCalledTimes(1)
    expect(sio.disconnect).not.toHaveBeenCalled()
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('MQTT — publish needs a topic, like the Publish button', () => {
    activate('mqtt')
    runActiveRequest()
    expect(mqtt.connect).toHaveBeenCalledTimes(1)
    useMqttStore.setState({ connectionState: 'connected', connectionId: 'c1' } as never)
    runActiveRequest()
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
    useMqttStore.setState((s) => ({ composer: { ...s.composer, topic: ' ' } }) as never)
    runActiveRequest()
    expect(mqtt.publish).toHaveBeenCalledTimes(1)
    expect(mqtt.disconnect).not.toHaveBeenCalled()
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('SSE has nothing to send: connects, and does nothing while connected', () => {
    activate('sse')
    runActiveRequest()
    expect(sse.connect).toHaveBeenCalledTimes(1)
    useSseStore.setState({ connectionState: 'connected' } as never)
    runActiveRequest()
    expect(sse.connect).toHaveBeenCalledTimes(1)
    expect(sse.disconnect).not.toHaveBeenCalled()
    expect(sendRequest).not.toHaveBeenCalled()
  })
})

describe('tabs without a request to run', () => {
  it.each(['ai', 'runner', 'mockServer', 'mockMcpServer', 'example', 'tools.jwt'])(
    '%s → nothing, never an HTTP send',
    (protocol) => {
      activate(protocol)
      runActiveRequest()
      expect(allCalls()).toBe(0)
    },
  )

  it('no active tab, or the blank protocol picker → nothing', () => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
    runActiveRequest()
    useTabsStore.setState({
      tabs: [{ id: 'n', name: 'New Request', protocol: 'http', url: '', isDirty: false } as Tab],
      activeTabId: 'n',
    })
    runActiveRequest()
    expect(allCalls()).toBe(0)
  })

  it('HTTP still calls sendRequest', () => {
    activate('http')
    runActiveRequest()
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })
})

describe('the chord and the palette', () => {
  it('Ctrl/Cmd+Enter on a GraphQL tab runs the query once', () => {
    renderHook(() => useKeyboardShortcuts())
    activate('graphql')
    act(() => pressModEnter())
    expect(gql.executeQuery).toHaveBeenCalledTimes(1)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('the palette "Send" runs the GraphQL query', async () => {
    activate('graphql')
    const { result } = renderHook(() => useCommandActions())
    await act(async () => {
      await result.current.find((a) => a.id === 'request.send')?.run()
    })
    expect(gql.executeQuery).toHaveBeenCalledTimes(1)
    expect(sendRequest).not.toHaveBeenCalled()
  })
})

describe('Monaco: the chord runs the request instead of inserting a line', () => {
  it('a request editor registers Ctrl/Cmd+Enter on its own editor and runs the dispatch', () => {
    activate('graphql')
    render(<MonacoWrapperImpl value="" language="graphql" runsActiveRequest />)
    const action = actions.find((a) => a.keybindings?.includes(2048 | 3))
    expect(action).toBeTruthy()
    act(() => action?.run())
    expect(gql.executeQuery).toHaveBeenCalledTimes(1)
  })

  it('other editors (Tools, modals, mocks, response) keep Monaco’s own chord', () => {
    render(<MonacoWrapperImpl value="" />)
    expect(actions.find((a) => a.keybindings?.includes(2048 | 3))).toBeUndefined()
  })
})

describe('one key press, one dispatch (plain-Enter handlers leave the chord to the window)', () => {
  beforeEach(() => {
    renderHook(() => useKeyboardShortcuts())
  })

  it('Socket.IO event name: Mod+Enter emits once', () => {
    activate('socketio')
    useSocketIOStore.setState({ connectionState: 'connected', connectionId: 'c1' } as never)
    render(<SioComposer />)
    act(() => pressModEnter(screen.getByTestId('socketio-event-name')))
    expect(sio.emit).toHaveBeenCalledTimes(1)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['websocket', WsConnectionBar, 'ws-url', () => ws.connect],
    ['mqtt', MqttConnectionBar, 'mqtt-url', () => mqtt.connect],
    ['sse', SseConnectionBar, 'sse-url', () => sse.connect],
  ] as const)('%s URL field: Mod+Enter connects once', (protocol, Bar, testId, connect) => {
    activate(protocol)
    render(<Bar />)
    act(() => pressModEnter(screen.getByTestId(testId)))
    expect(connect()).toHaveBeenCalledTimes(1)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('HTTP URL field: Mod+Enter sends once (it used to send twice), plain Enter once', () => {
    activate('http')
    useTabsStore.setState((st) => ({ tabs: st.tabs.map((t) => ({ ...t, url: 'http://x' })) }))
    render(<UrlBar />)
    act(() => pressModEnter(screen.getByTestId('url-input')))
    expect(sendRequest).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByTestId('url-input'), { key: 'Enter' })
    expect(sendRequest).toHaveBeenCalledTimes(2)
  })

  it('GraphQL URL field: Mod+Enter runs the query once, plain Enter once', () => {
    activate('graphql')
    render(<GraphQLQueryPane />)
    act(() => pressModEnter(screen.getByTestId('graphql-url')))
    expect(gql.executeQuery).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByTestId('graphql-url'), { key: 'Enter' })
    expect(gql.executeQuery).toHaveBeenCalledTimes(2)
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it('SOAP WSDL field: Mod+Enter is Send, plain Enter is Parse', () => {
    activate('soap')
    const parseWsdl = fn()
    useSoapStore.setState({ parseWsdl, wsdlUrl: 'http://x?wsdl' } as never)
    render(<SoapWsdlImport />)
    const field = screen.getByPlaceholderText('https://example.com/service?wsdl')
    act(() => pressModEnter(field))
    expect(soap.sendSoap).toHaveBeenCalledTimes(1)
    expect(parseWsdl).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(parseWsdl).toHaveBeenCalledTimes(1)
    expect(soap.sendSoap).toHaveBeenCalledTimes(1)
  })

  it('plain Enter in a URL field still connects (its own handler)', () => {
    activate('websocket')
    render(<WsConnectionBar />)
    fireEvent.keyDown(screen.getByTestId('ws-url'), { key: 'Enter' })
    expect(ws.connect).toHaveBeenCalledTimes(1)
  })
})
