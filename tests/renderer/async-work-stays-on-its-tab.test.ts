/**
 * Work started on a tab belongs to that tab, wherever the user is when it ends.
 *
 * Workbench swaps one live slice per protocol store when the tab changes, so a
 * plain `set()` after an `await` writes into whichever tab is on screen. Every
 * row here starts on tab A with the IPC promise held open, switches to tab B
 * the way the app does, resolves, then checks B is unchanged and A has the
 * result. A row that resolved before switching would prove nothing.
 *
 * The guard at the bottom fails when a tab-scoped store has no row, so a new
 * store gets a row before it ships.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activateTabStores, switchActiveTab } from '../../src/renderer/lib/activate-tab'
import { cleanupTabState } from '../../src/renderer/lib/cleanup-tab-state'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useMqttStore } from '../../src/renderer/stores/mqtt.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { resetAiKeySessionForTests, useAiChatStore } from '../../src/renderer/stores/ai-chat.store'
import type { ApiResponse, Tab, TestAssertion, WsdlParseResult } from '../../src/renderer/types'
import type { GqlWsEvent } from '../../src/shared/graphql-ws'

const A = 'tab-a'
const B = 'tab-b'

function tab(id: string, protocol: Tab['protocol']): Tab {
  return { id, name: id, protocol, isDirty: false, isLoading: false } as Tab
}

/** An IPC call that stays open until the test ends it. */
function held<T>() {
  const pending: Array<(v: T) => void> = []
  const spy = vi.fn(() => new Promise<T>((r) => pending.push(r)))
  return {
    spy,
    calledTimes: (n: number) => vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(n)),
    resolve: (v: T) => {
      for (const r of pending.splice(0)) r(v)
    },
  }
}

/** Answer a held read and every read that follows it, until `until` holds. */
async function drain(call: ReturnType<typeof held<unknown>>, until: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !until(); i++) {
    call.resolve({ success: true, data: undefined })
    await new Promise((r) => setTimeout(r, 0))
  }
}

const ok = <T>(data: T) => ({ success: true, data })
const fail = (error: string) => ({ success: false, error })

function apiResponse(body: string, protocol = 'http'): ApiResponse {
  return { requestId: body, protocol, status: 200, body, timing: { total: 1 } } as ApiResponse
}

const responseOnScreen = () => useResponseStore.getState().response

function statusRule(name: string): TestAssertion {
  return { id: name, name, type: 'status_equals', enabled: true, expected: 200 }
}

const WSDL: WsdlParseResult = {
  services: [
    {
      name: 'Calc',
      ports: [
        {
          name: 'CalcPort',
          endpointUrl: 'http://a.example/calc',
          operations: [
            {
              name: 'Add',
              soapAction: 'add',
              inputSchema: {},
              outputSchema: {},
              exampleRequest: '<parsed-for-a/>',
              exampleResponse: '',
            },
          ],
        },
      ],
    },
  ],
  endpointUrl: 'http://a.example/calc',
  soapVersion: 'soap11',
  rawWsdl: '',
}

const PROTO = {
  protoPath: '/protos/a.proto',
  packageName: 'a',
  services: [
    {
      name: 'Greeter',
      fullName: 'a.Greeter',
      methods: [
        {
          name: 'Hello',
          requestType: 'Req',
          responseType: 'Res',
          requestStream: false,
          responseStream: false,
        },
      ],
    },
  ],
}

const INTROSPECTION = JSON.stringify({
  data: {
    __schema: {
      queryType: { name: 'Query' },
      mutationType: null,
      subscriptionType: null,
      types: [{ kind: 'OBJECT', name: 'Query', fields: [] }],
    },
  },
})

function setApi(api: Record<string, unknown>): void {
  ;(window as unknown as { api: unknown }).api = api
}

/** The gRPC load rows differ only in the bridge method and how they start. */
function grpcLoadRow(
  action: string,
  name: string,
  bridge: 'loadProto' | 'loadProtoFromUrl' | 'reflect',
  start: () => Promise<void>,
): TabRow[] {
  const run = async (reply: unknown, expectA: () => void) => {
    const call = held<unknown>()
    setApi({ grpc: { [bridge]: call.spy } })
    useGrpcStore.setState({ protoUrl: 'http://a.example/a.proto', address: 'a.example:1' })
    const done = start()
    await call.calledTimes(1)

    switchActiveTab(B)
    useGrpcStore.setState({ requestBody: 'unsaved on B' })
    call.resolve(reply)
    await done

    expect(useGrpcStore.getState().services).toEqual([])
    expect(useGrpcStore.getState().selectedService).toBeNull()
    expect(useGrpcStore.getState().isLoading).toBe(false)
    expect(useGrpcStore.getState().errorMessage).toBeNull()
    expect(useGrpcStore.getState().requestBody).toBe('unsaved on B')

    switchActiveTab(A)
    expect(useGrpcStore.getState().isLoading).toBe(false)
    expectA()
  }
  return [
    {
      store: 'grpc',
      action,
      op: `${name} (success)`,
      run: () =>
        run(ok(PROTO), () => {
          expect(useGrpcStore.getState().protoPath).toBe('/protos/a.proto')
          expect(useGrpcStore.getState().selectedService).toBe('a.Greeter')
          expect(useGrpcStore.getState().selectedMethod).toBe('Hello')
        }),
    },
    {
      store: 'grpc',
      action,
      op: `${name} (error)`,
      run: () =>
        run(fail('load failed for A'), () => {
          expect(useGrpcStore.getState().errorMessage).toBe('load failed for A')
        }),
    },
  ]
}

/** The realtime rows: connect on A held open, B stays disconnected, A connects. */
function connectRow(
  store: TabRow['store'],
  arrange: () => void,
  bridge: (connect: ReturnType<typeof vi.fn>) => Record<string, unknown>,
  connect: () => Promise<void>,
  state: () => { connectionId: string | null; connectionState: string },
): TabRow {
  return {
    store,
    action: 'connect',
    op: 'connect',
    run: async () => {
      const call = held<unknown>()
      setApi(bridge(call.spy))
      arrange()
      const done = connect()
      await call.calledTimes(1)

      switchActiveTab(B)
      expect(state().connectionState).toBe('disconnected')
      call.resolve(ok({ connectionId: 'conn-a', url: 'x', clientId: 'x' }))
      await done

      expect(state().connectionId).toBeNull()
      expect(state().connectionState).toBe('disconnected')

      switchActiveTab(A)
      expect(state().connectionId).toBe('conn-a')
    },
  }
}

const realtimeBridge = (connect: ReturnType<typeof vi.fn>) => ({
  connect,
  disconnect: vi.fn(async () => ok(null)),
  onEvent: () => () => {},
  onClosed: () => () => {},
})

/** A `graphqlWs` bridge whose connect stays open and whose frames the test pushes. */
function heldSubscription() {
  const connect = held<unknown>()
  const listeners = new Set<(e: GqlWsEvent) => void>()
  const disconnect = vi.fn(async (_id: string) => ok(true))
  const cancelConnect = vi.fn(async (_id: string) => ok({ canceled: true }))
  setApi({
    graphqlWs: {
      connect: connect.spy,
      disconnect,
      cancelConnect,
      onEvent: (cb: (e: GqlWsEvent) => void) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    },
  })
  useGraphQLStore.setState({ url: 'ws://a.example/graphql', query: 'subscription { a }' })
  const id = (): string =>
    ((connect.spy.mock.calls as unknown as Array<[{ connectionId: string }]>)[0] ?? [])[0]
      ?.connectionId
  const emit = (e: Record<string, unknown>): void => {
    for (const cb of [...listeners]) {
      cb({ connectionId: id(), timestamp: 1, ...e } as GqlWsEvent)
    }
  }
  return {
    connect,
    disconnect,
    cancelConnect,
    id,
    emit,
    emitData: (data: string) => emit({ type: 'data', data }),
    start: () => useGraphQLStore.getState().subscribe(),
  }
}

interface TabRow {
  store:
    | 'http'
    | 'soap'
    | 'grpc'
    | 'graphql'
    | 'websocket'
    | 'sse'
    | 'socketio'
    | 'mqtt'
    | 'mcp'
    | 'ai'
  /** The store action the row holds open; the guard at the bottom reads it. */
  action?: string
  op: string
  run: () => Promise<void>
}

/** Async actions with no row, and why no write of theirs can land on another tab. */
const NO_TAB_WRITE: Partial<Record<TabRow['store'], Record<string, string>>> = {
  mcp: { forgetOAuth: 'async by signature only: it has no await, so the tab cannot change' },
}

const ROWS: TabRow[] = [
  {
    store: 'http',
    action: 'sendRequest',
    op: 'Send judges the response by the assertions of the tab that sent it',
    run: async () => {
      const send = held<unknown>()
      setApi({ request: { send: send.spy, cancel: vi.fn() } })
      useRequestStore.setState({ url: 'http://a.example', assertions: [statusRule('rule of A')] })
      const done = useRequestStore.getState().sendRequest()
      await send.calledTimes(1)

      switchActiveTab(B)
      useRequestStore.setState({ url: 'http://b.example', assertions: [statusRule('rule of B')] })
      send.resolve(ok(apiResponse('from A')))
      await done

      expect(responseOnScreen()).toBeNull()
      switchActiveTab(A)
      expect(responseOnScreen()?.body).toBe('from A')
      expect(responseOnScreen()?.testResults?.map((r) => r.assertion.name)).toEqual(['rule of A'])
    },
  },
  {
    store: 'http',
    action: 'sendRequest',
    op: 'Send uses the settings of the tab that sent it after slow setting reads',
    run: async () => {
      const settings = held<unknown>()
      const send = vi.fn(async () => ok(apiResponse('from A')))
      setApi({ settings: { get: settings.spy }, request: { send, cancel: vi.fn() } })
      useRequestStore.setState({ url: 'http://a.example', assertions: [], requestTimeout: 1111 })
      const done = useRequestStore.getState().sendRequest()
      await vi.waitFor(() => expect(settings.spy).toHaveBeenCalled())

      switchActiveTab(B)
      useRequestStore.setState({ requestTimeout: 2222 })
      await drain(settings, () => send.mock.calls.length > 0)
      await done

      expect(send).toHaveBeenCalledTimes(1)
      expect((send.mock.calls[0] as unknown as [{ timeout?: number }])[0].timeout).toBe(1111)
    },
  },
  {
    store: 'http',
    action: 'cancelRequest',
    op: 'Cancel on a tab cancels only its own request',
    run: async () => {
      const send = held<unknown>()
      const cancel = vi.fn(async () => ok(null))
      setApi({ request: { send: send.spy, cancel } })
      useRequestStore.setState({ url: 'http://a.example', assertions: [] })
      const doneA = useRequestStore.getState().sendRequest()
      await send.calledTimes(1)
      switchActiveTab(B)
      useRequestStore.setState({ url: 'http://b.example', assertions: [] })
      const doneB = useRequestStore.getState().sendRequest()
      await send.calledTimes(2)

      switchActiveTab(A)
      await useRequestStore.getState().cancelRequest()
      const idOf = (i: number) =>
        (send.spy.mock.calls[i] as unknown as [{ _requestId: string }])[0]._requestId
      expect(cancel).toHaveBeenCalledWith(idOf(0))
      send.resolve(ok(apiResponse('x')))
      await Promise.all([doneA, doneB])
    },
  },
  {
    store: 'soap',
    action: 'parseWsdl',
    op: 'parse WSDL (success) leaves the unsaved envelope of the tab on screen alone',
    run: async () => {
      const parse = held<unknown>()
      setApi({ soap: { parseWsdl: parse.spy } })
      useSoapStore.setState({ wsdlUrl: 'http://a.example/?wsdl', rawXml: '<a/>' })
      const done = useSoapStore.getState().parseWsdl()
      await parse.calledTimes(1)

      switchActiveTab(B)
      useSoapStore.setState({ rawXml: '<unsaved on B/>' })
      expect(useSoapStore.getState().isLoading).toBe(false)
      // Coming back while the parse is still going shows it still going.
      switchActiveTab(A)
      expect(useSoapStore.getState().isLoading).toBe(true)
      switchActiveTab(B)

      parse.resolve(ok(WSDL))
      await done

      expect(useSoapStore.getState().rawXml).toBe('<unsaved on B/>')
      expect(useSoapStore.getState().parsedWsdl).toBeNull()
      expect(useSoapStore.getState().selectedOperation).toBeNull()

      switchActiveTab(A)
      expect(useSoapStore.getState().parsedWsdl).toEqual(WSDL)
      expect(useSoapStore.getState().selectedOperation).toBe('Add')
      expect(useSoapStore.getState().rawXml).toBe('<parsed-for-a/>')
      expect(useSoapStore.getState().isLoading).toBe(false)
    },
  },
  {
    store: 'soap',
    action: 'parseWsdl',
    op: 'parse WSDL (error) shows on the tab that asked',
    run: async () => {
      const parse = held<unknown>()
      setApi({ soap: { parseWsdl: parse.spy } })
      useSoapStore.setState({ wsdlUrl: 'http://a.example/?wsdl' })
      const done = useSoapStore.getState().parseWsdl()
      await parse.calledTimes(1)

      switchActiveTab(B)
      parse.resolve(fail('no such WSDL'))
      await done

      expect(useSoapStore.getState().parseError).toBeNull()
      switchActiveTab(A)
      expect(useSoapStore.getState().parseError).toBe('no such WSDL')
      expect(useSoapStore.getState().isLoading).toBe(false)
    },
  },
  {
    store: 'soap',
    action: 'sendSoap',
    op: 'Send puts the response on the tab that sent it',
    run: async () => {
      const send = held<unknown>()
      setApi({ request: { send: send.spy, cancel: vi.fn() } })
      useSoapStore.setState({ rawXml: '<a/>', endpointUrl: 'http://a.example', mode: 'manual' })
      const done = useSoapStore.getState().sendSoap()
      await send.calledTimes(1)

      switchActiveTab(B)
      send.resolve(ok(apiResponse('from A', 'soap')))
      await done

      expect(responseOnScreen()).toBeNull()
      switchActiveTab(A)
      expect(responseOnScreen()?.body).toBe('from A')
    },
  },
  {
    store: 'soap',
    action: 'sendSoap',
    op: 'Send uses the network settings of the tab that sent it after slow setting reads',
    run: async () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'w', activeProjectId: 'p' })
      const settings = held<unknown>()
      const send = vi.fn(async () => ok(apiResponse('from A', 'soap')))
      setApi({ settings: { get: settings.spy }, request: { send, cancel: vi.fn() } })
      useRequestStore.setState({ sslVerification: false, followRedirects: false })
      useSoapStore.setState({ rawXml: '<a/>', endpointUrl: 'http://a.example', mode: 'manual' })
      const done = useSoapStore.getState().sendSoap()
      await vi.waitFor(() => expect(settings.spy).toHaveBeenCalled())

      switchActiveTab(B)
      useRequestStore.setState({ sslVerification: true, followRedirects: true })
      await drain(settings, () => send.mock.calls.length > 0)
      await done

      const payload = (send.mock.calls[0] as unknown as [Record<string, unknown>])[0]
      expect(payload.sslVerification).toBe(false)
      expect(payload.followRedirects).toBe(false)
    },
  },
  {
    store: 'soap',
    action: 'cancelSoap',
    op: 'Cancel on a tab cancels only its own request',
    run: async () => {
      const send = held<unknown>()
      const cancel = vi.fn(async () => ok(null))
      setApi({ request: { send: send.spy, cancel } })
      useSoapStore.setState({ rawXml: '<a/>', endpointUrl: 'http://a.example', mode: 'manual' })
      const doneA = useSoapStore.getState().sendSoap()
      await send.calledTimes(1)
      switchActiveTab(B)
      useSoapStore.setState({ rawXml: '<b/>', endpointUrl: 'http://b.example', mode: 'manual' })
      const doneB = useSoapStore.getState().sendSoap()
      await send.calledTimes(2)
      const idOf = (i: number) =>
        (send.spy.mock.calls[i] as unknown as [{ _requestId: string }])[0]._requestId

      switchActiveTab(A)
      await useSoapStore.getState().cancelSoap()
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(cancel).toHaveBeenCalledWith(idOf(0))

      // B's request is still its own to cancel.
      switchActiveTab(B)
      await useSoapStore.getState().cancelSoap()
      expect(cancel).toHaveBeenLastCalledWith(idOf(1))

      send.resolve(ok(apiResponse('x', 'soap')))
      await Promise.all([doneA, doneB])
    },
  },
  ...grpcLoadRow('loadProto', 'load proto file', 'loadProto', () =>
    useGrpcStore.getState().loadProto(),
  ),
  ...grpcLoadRow('loadProtoFromUrl', 'load proto from URL', 'loadProtoFromUrl', () =>
    useGrpcStore.getState().loadProtoFromUrl(),
  ),
  ...grpcLoadRow('loadFromReflection', 'load from reflection', 'reflect', () =>
    useGrpcStore.getState().loadFromReflection(),
  ),
  {
    store: 'grpc',
    action: 'execute',
    op: 'unary call puts the response on the tab that called, and ends its loading state',
    run: async () => {
      const execute = held<unknown>()
      setApi({ grpc: { execute: execute.spy, cancelUnary: vi.fn() } })
      useGrpcStore.setState({
        address: 'a.example:1',
        services: [
          {
            name: 'a.Greeter',
            methods: [{ name: 'Hello', type: 'unary', requestType: 'Q', responseType: 'R' }],
          },
        ],
        selectedService: 'a.Greeter',
        selectedMethod: 'Hello',
      })
      const done = useGrpcStore.getState().execute()
      await execute.calledTimes(1)

      switchActiveTab(B)
      execute.resolve(
        ok({ requestId: 'r', protocol: 'grpc', body: 'from A', timing: { total: 1 } }),
      )
      await done

      expect(useGrpcStore.getState().response).toBeNull()
      expect(responseOnScreen()).toBeNull()

      switchActiveTab(A)
      expect(useGrpcStore.getState().response?.body).toBe('from A')
      expect(responseOnScreen()?.body).toBe('from A')
      expect(useResponseStore.getState().isLoading).toBe(false)
      expect(useTabsStore.getState().tabs.find((t) => t.id === A)?.isLoading).toBe(false)
    },
  },
  {
    store: 'grpc',
    action: 'cancelUnary',
    op: 'cancel unary clears the call id of the tab that cancelled',
    run: async () => {
      const cancelUnary = held<unknown>()
      setApi({ grpc: { cancelUnary: cancelUnary.spy } })
      useGrpcStore.setState({ _unaryRequestId: 'unary-a' })
      const done = useGrpcStore.getState().cancelUnary()
      await cancelUnary.calledTimes(1)

      switchActiveTab(B)
      useGrpcStore.setState({ _unaryRequestId: 'unary-b' })
      cancelUnary.resolve(ok(null))
      await done

      expect(useGrpcStore.getState()._unaryRequestId).toBe('unary-b')
      switchActiveTab(A)
      expect(useGrpcStore.getState()._unaryRequestId).toBeNull()
    },
  },
  {
    store: 'grpc',
    action: 'cancelStream',
    op: 'cancel stream ends the stream of the tab that cancelled',
    run: async () => {
      const cancelStream = held<unknown>()
      setApi({ grpc: { cancelStream: cancelStream.spy } })
      const unsubscribeA = vi.fn()
      useGrpcStore.setState({ activeStreamId: 'stream-a', streamUnsubscribe: unsubscribeA })
      const done = useGrpcStore.getState().cancelStream()
      await cancelStream.calledTimes(1)

      switchActiveTab(B)
      const unsubscribeB = vi.fn()
      useGrpcStore.setState({ activeStreamId: 'stream-b', streamUnsubscribe: unsubscribeB })
      cancelStream.resolve(ok(null))
      await done

      expect(unsubscribeA).toHaveBeenCalledTimes(1)
      expect(unsubscribeB).not.toHaveBeenCalled()
      expect(useGrpcStore.getState().activeStreamId).toBe('stream-b')
      expect(useGrpcStore.getState().streamUnsubscribe).toBe(unsubscribeB)
      switchActiveTab(A)
      expect(useGrpcStore.getState().activeStreamId).toBeNull()
      expect(useGrpcStore.getState().streamUnsubscribe).toBeNull()
    },
  },
  {
    store: 'grpc',
    action: 'sendStreamMessage',
    op: 'a failed stream message shows on the tab that sent it',
    run: async () => {
      let reject: (e: Error) => void = () => {}
      const sendStreamMessage = vi.fn(
        () => new Promise((_resolve, rej) => (reject = rej as (e: Error) => void)),
      )
      setApi({ grpc: { sendStreamMessage } })
      useGrpcStore.setState({ activeStreamId: 'stream-a', halfClosed: false })
      const done = useGrpcStore.getState().sendStreamMessage()
      await vi.waitFor(() => expect(sendStreamMessage).toHaveBeenCalled())

      switchActiveTab(B)
      reject(new Error('stream write failed'))
      await done

      expect(useGrpcStore.getState().errorMessage).toBeNull()
      switchActiveTab(A)
      expect(useGrpcStore.getState().errorMessage).toBe('stream write failed')
    },
  },
  {
    store: 'grpc',
    action: 'endClientStream',
    op: 'End Streaming half-closes the stream of the tab that ended it',
    run: async () => {
      const endStream = held<unknown>()
      setApi({ grpc: { endStream: endStream.spy } })
      useGrpcStore.setState({ activeStreamId: 'stream-a', halfClosed: false })
      const done = useGrpcStore.getState().endClientStream()
      await endStream.calledTimes(1)

      switchActiveTab(B)
      useGrpcStore.setState({ activeStreamId: 'stream-b', halfClosed: false })
      endStream.resolve(ok(null))
      await done

      expect(useGrpcStore.getState().halfClosed).toBe(false)
      switchActiveTab(A)
      expect(useGrpcStore.getState().halfClosed).toBe(true)
    },
  },
  {
    store: 'graphql',
    action: 'introspect',
    op: 'introspect (success) fills the schema of the tab that asked, not the one on screen',
    run: async () => {
      const send = held<unknown>()
      setApi({ request: { send: send.spy, cancel: vi.fn() } })
      useGraphQLStore.setState({ url: 'http://a.example/graphql' })
      const done = useGraphQLStore.getState().introspect()
      await send.calledTimes(1)

      switchActiveTab(B)
      expect(useGraphQLStore.getState().isIntrospecting).toBe(false)
      // Coming back while it is still going shows it still going.
      switchActiveTab(A)
      expect(useGraphQLStore.getState().isIntrospecting).toBe(true)
      switchActiveTab(B)

      send.resolve(ok(apiResponse(INTROSPECTION, 'graphql')))
      await done

      expect(useGraphQLStore.getState().schemaData).toBeNull()
      expect(useGraphQLStore.getState().isIntrospecting).toBe(false)

      switchActiveTab(A)
      expect(useGraphQLStore.getState().schemaData?.queryType).toBe('Query')
      expect(useGraphQLStore.getState().isIntrospecting).toBe(false)
    },
  },
  {
    store: 'graphql',
    action: 'introspect',
    op: 'introspect (error) shows on the tab that asked',
    run: async () => {
      const send = held<unknown>()
      setApi({ request: { send: send.spy, cancel: vi.fn() } })
      useGraphQLStore.setState({ url: 'http://a.example/graphql' })
      const done = useGraphQLStore.getState().introspect()
      await send.calledTimes(1)

      switchActiveTab(B)
      send.resolve(fail('introspection refused'))
      await done

      expect(useGraphQLStore.getState().introspectError).toBeNull()
      switchActiveTab(A)
      expect(useGraphQLStore.getState().introspectError).toBe('introspection refused')
    },
  },
  {
    store: 'graphql',
    action: 'introspect',
    op: 'two tabs keep their own schema',
    run: async () => {
      const send = vi.fn(async () => ok(apiResponse(INTROSPECTION, 'graphql')))
      setApi({ request: { send, cancel: vi.fn() } })
      useGraphQLStore.setState({ url: 'http://a.example/graphql' })
      await useGraphQLStore.getState().introspect()
      expect(useGraphQLStore.getState().schemaData).not.toBeNull()

      switchActiveTab(B)
      expect(useGraphQLStore.getState().schemaData).toBeNull()
      switchActiveTab(A)
      expect(useGraphQLStore.getState().schemaData).not.toBeNull()
    },
  },
  {
    store: 'graphql',
    action: 'executeQuery',
    op: 'Send puts the response on the tab that sent it',
    run: async () => {
      const send = held<unknown>()
      setApi({ request: { send: send.spy, cancel: vi.fn() } })
      useGraphQLStore.setState({ url: 'http://a.example/graphql', query: '{ a }' })
      const done = useGraphQLStore.getState().executeQuery()
      await send.calledTimes(1)

      switchActiveTab(B)
      send.resolve(ok(apiResponse('from A', 'graphql')))
      await done

      expect(useGraphQLStore.getState().response).toBeNull()
      expect(responseOnScreen()).toBeNull()

      switchActiveTab(A)
      expect(useGraphQLStore.getState().response?.body).toBe('from A')
      expect(responseOnScreen()?.body).toBe('from A')
      expect(useResponseStore.getState().isLoading).toBe(false)
    },
  },
  {
    store: 'graphql',
    action: 'cancelQuery',
    op: 'cancel clears the in-flight state of the tab that cancelled',
    run: async () => {
      const cancel = held<unknown>()
      setApi({ request: { cancel: cancel.spy } })
      useGraphQLStore.setState({ _inflightRequestId: 'gql-a', isLoading: true })
      const done = useGraphQLStore.getState().cancelQuery()
      await cancel.calledTimes(1)

      switchActiveTab(B)
      useGraphQLStore.setState({ _inflightRequestId: 'gql-b', isLoading: true })
      cancel.resolve(ok(null))
      await done

      expect(useGraphQLStore.getState()._inflightRequestId).toBe('gql-b')
      expect(useGraphQLStore.getState().isLoading).toBe(true)
      switchActiveTab(A)
      expect(useGraphQLStore.getState()._inflightRequestId).toBeNull()
      expect(useGraphQLStore.getState().isLoading).toBe(false)
    },
  },
  {
    store: 'graphql',
    action: 'subscribe',
    op: 'subscription events stay on the tab that subscribed, across a switch and back',
    run: async () => {
      const sub = heldSubscription()
      const done = sub.start()
      await sub.connect.calledTimes(1)
      sub.emitData('{"n":1}')

      switchActiveTab(B)
      expect(useGraphQLStore.getState().subscriptionState).toBe('disconnected')
      sub.connect.resolve(ok({ connectionId: sub.id() }))
      await done

      // A frame while B is on screen goes to A; B stays empty and idle.
      sub.emitData('{"n":2}')
      expect(useGraphQLStore.getState().subscriptionEvents).toEqual([])
      expect(useGraphQLStore.getState().subscriptionState).toBe('disconnected')
      expect(useGraphQLStore.getState().connectionId).toBeNull()

      switchActiveTab(A)
      expect(useGraphQLStore.getState().subscriptionState).toBe('connected')
      expect(useGraphQLStore.getState().connectionId).toBe(sub.id())
      expect(useGraphQLStore.getState().subscriptionEvents.map((e) => e.data)).toEqual([
        '{"n":1}',
        '{"n":2}',
      ])
      expect(sub.disconnect).not.toHaveBeenCalled()
    },
  },
  {
    store: 'graphql',
    action: 'subscribe',
    op: 'the server ending the subscription while B is on screen ends it on A only',
    run: async () => {
      const sub = heldSubscription()
      const done = sub.start()
      await sub.connect.calledTimes(1)
      sub.connect.resolve(ok({ connectionId: sub.id() }))
      await done

      switchActiveTab(B)
      sub.emit({ type: 'ended', reason: 'complete' })
      expect(useGraphQLStore.getState().subscriptionEnd).toBeNull()

      switchActiveTab(A)
      expect(useGraphQLStore.getState().subscriptionState).toBe('disconnected')
      expect(useGraphQLStore.getState().subscriptionEnd).toEqual({ kind: 'completed' })
    },
  },
  {
    store: 'graphql',
    action: 'subscribe',
    op: 'closing the tab that subscribed disconnects its subscription, B keeps running',
    run: async () => {
      const sub = heldSubscription()
      const done = sub.start()
      await sub.connect.calledTimes(1)
      sub.connect.resolve(ok({ connectionId: sub.id() }))
      await done

      switchActiveTab(B)
      useGraphQLStore.setState({ url: 'ws://b.example/graphql' })
      cleanupTabState(A)
      expect(sub.disconnect).toHaveBeenCalledTimes(1)
      expect(sub.disconnect).toHaveBeenCalledWith(sub.id())
      expect(useGraphQLStore.getState().url).toBe('ws://b.example/graphql')
      expect(useGraphQLStore.getState()._tabStates.has(A)).toBe(false)
    },
  },
  {
    store: 'graphql',
    action: 'subscribe',
    op: 'closing the tab on screen disconnects its subscription',
    run: async () => {
      const sub = heldSubscription()
      const done = sub.start()
      await sub.connect.calledTimes(1)
      sub.connect.resolve(ok({ connectionId: sub.id() }))
      await done

      cleanupTabState(A)
      expect(sub.disconnect).toHaveBeenCalledWith(sub.id())
      expect(useGraphQLStore.getState().connectionId).toBeNull()
    },
  },
  {
    store: 'graphql',
    action: 'subscribe',
    op: 'leaving the project disconnects a subscription on a tab that is not on screen',
    run: async () => {
      useWorkspaceStore.setState({ activeProjectId: 'project-a' })
      const sub = heldSubscription()
      const done = sub.start()
      await sub.connect.calledTimes(1)
      sub.connect.resolve(ok({ connectionId: sub.id() }))
      await done

      switchActiveTab(B)
      useWorkspaceStore.setState({ activeProjectId: 'project-b' })
      expect(sub.disconnect).toHaveBeenCalledTimes(1)
      expect(sub.disconnect).toHaveBeenCalledWith(sub.id())

      switchActiveTab(A)
      expect(useGraphQLStore.getState().subscriptionState).toBe('disconnected')
      expect(useGraphQLStore.getState().connectionId).toBeNull()
      expect(useGraphQLStore.getState().subscriptionEnd).toEqual({ kind: 'projectLeft' })
    },
  },
  {
    store: 'graphql',
    action: 'subscribe',
    op: 'leaving the project during the handshake cancels it',
    run: async () => {
      useWorkspaceStore.setState({ activeProjectId: 'project-a' })
      const sub = heldSubscription()
      const done = sub.start()
      await sub.connect.calledTimes(1)

      useWorkspaceStore.setState({ activeProjectId: 'project-b' })
      expect(sub.cancelConnect).toHaveBeenCalledWith(sub.id())
      sub.connect.resolve(fail('Connection cancelled'))
      await done
      expect(useGraphQLStore.getState().subscriptionError).toBeNull()
      expect(useGraphQLStore.getState().subscriptionState).toBe('disconnected')
    },
  },
  connectRow(
    'websocket',
    () => useWebSocketStore.setState({ url: 'ws://a.example' }),
    (connect) => ({ ws: realtimeBridge(connect), websocket: realtimeBridge(connect) }),
    () => useWebSocketStore.getState().connect(),
    () => useWebSocketStore.getState(),
  ),
  connectRow(
    'sse',
    () => useSseStore.setState({ url: 'http://a.example/sse' }),
    (connect) => ({ sse: realtimeBridge(connect) }),
    () => useSseStore.getState().connect(),
    () => useSseStore.getState(),
  ),
  connectRow(
    'socketio',
    () => useSocketIOStore.setState({ url: 'http://a.example' }),
    (connect) => ({ socketio: realtimeBridge(connect) }),
    () => useSocketIOStore.getState().connect(),
    () => useSocketIOStore.getState(),
  ),
  connectRow(
    'mqtt',
    () => useMqttStore.setState({ url: 'mqtt://a.example' }),
    (connect) => ({ mqtt: realtimeBridge(connect) }),
    () => useMqttStore.getState().connect(),
    () => useMqttStore.getState(),
  ),
  {
    store: 'mcp',
    action: 'connect',
    op: 'connect',
    run: async () => {
      const connect = held<unknown>()
      setApi({
        mcp: {
          connect: connect.spy,
          disconnect: vi.fn(async () => ok(null)),
          onEvent: () => () => {},
          onNotification: () => () => {},
          onFrame: () => () => {},
        },
      })
      useMcpStore.setState({ transport: 'http', url: 'http://a.example/mcp' } as never)
      const done = useMcpStore.getState().connect()
      await connect.calledTimes(1)

      switchActiveTab(B)
      connect.resolve(ok({ connectionId: 'conn-a', capabilities: null }))
      await done

      expect(useMcpStore.getState().connectionId).toBeNull()
      switchActiveTab(A)
      expect(useMcpStore.getState().connectionId).toBe('conn-a')
    },
  },
  {
    store: 'ai',
    action: 'sendPrompt',
    op: 'send keeps the turn and the stream id on the tab that asked',
    run: async () => {
      const send = held<unknown>()
      setApi({ aiChat: { send: send.spy, cancel: vi.fn() } })
      useAiChatStore.setState({ provider: 'openai', model: 'm' } as never)
      const done = useAiChatStore.getState().sendPrompt('hello')
      await send.calledTimes(1)

      switchActiveTab(B)
      expect(useAiChatStore.getState().messages).toEqual([])
      send.resolve(ok({ messageId: 'msg-a' }))
      await done

      expect(useAiChatStore.getState().pendingMessageId).toBeNull()
      switchActiveTab(A)
      expect(useAiChatStore.getState().messages.length).toBeGreaterThan(0)
      expect(useAiChatStore.getState().pendingMessageId).toBe('msg-a')
    },
  },
]

/** What the tab on screen shows: every field of the store except the other tabs' cache. */
function sliceOnScreen(store: TabRow['store']): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(TABBED_STORES[store].getState()).filter(
      ([key, value]) => typeof value !== 'function' && key !== '_tabStates',
    ),
  )
}

/**
 * One action on A with its IPC call held open. With B on screen no field of B
 * moves when the reply lands, and A has the result when the user comes back.
 */
function heldRow(row: {
  store: TabRow['store']
  action: string
  op?: string
  bridge: (spy: ReturnType<typeof vi.fn>) => Record<string, unknown>
  onA: () => void
  start: () => Promise<void>
  onB?: () => void
  reply: unknown
  expectA?: () => void
}): TabRow {
  return {
    store: row.store,
    action: row.action,
    op: row.op ?? row.action,
    run: async () => {
      const call = held<unknown>()
      setApi(row.bridge(call.spy as ReturnType<typeof vi.fn>))
      row.onA()
      const done = row.start()
      await call.calledTimes(1)

      switchActiveTab(B)
      row.onB?.()
      const onB = sliceOnScreen(row.store)
      call.resolve(row.reply)
      await done
      expect(sliceOnScreen(row.store)).toEqual(onB)

      switchActiveTab(A)
      row.expectA?.()
    },
  }
}

/**
 * Send on A while a withheld credential is being read back, with B on screen
 * when the read ends: nothing goes out with B's configuration.
 */
function withheldRow(row: {
  store: TabRow['store']
  action: string
  bridge: (send: ReturnType<typeof vi.fn>) => Record<string, unknown>
  configure: () => void
  start: () => Promise<void>
  setState: (patch: { withheldCredentials: string[] }) => void
}): TabRow {
  return {
    store: row.store,
    action: row.action,
    op: `${row.action}: the credential reload ends on another tab`,
    run: async () => {
      const read = held<unknown>()
      const send = vi.fn(async () => fail('must not be sent'))
      setApi({ endpoint: { get: read.spy }, ...row.bridge(send) })
      const protocol = PROTOCOL_OF_STORE[row.store]
      useTabsStore.setState({
        tabs: [{ ...tab(A, protocol), endpointId: 'row-a' }, tab(B, protocol)],
        activeTabId: A,
      })
      row.configure()
      row.setState({ withheldCredentials: ['url'] })
      const done = row.start()
      await read.calledTimes(1)

      switchActiveTab(B)
      row.configure()
      read.resolve(fail('row unavailable'))
      await done
      expect(send).not.toHaveBeenCalled()
    },
  }
}

const liveRealtime = { connectionId: 'conn-a', connectionState: 'connected' } as const
const liveRealtimeB = { connectionId: 'conn-b', connectionState: 'connected' } as const

const bridgeOf = (key: string | string[], members: Record<string, unknown>) => {
  const bridge = {
    disconnect: vi.fn(async () => ok(null)),
    cancelConnect: vi.fn(async () => ok(null)),
    connect: vi.fn(async () => fail('not connecting in this row')),
    onEvent: () => () => {},
    onClosed: () => () => {},
    onNotification: () => () => {},
    onFrame: () => () => {},
    ...members,
  }
  return Object.fromEntries([key].flat().map((k) => [k, bridge]))
}

const mcp = () => useMcpStore.getState()
const liveMcp = {
  url: 'http://a.example/mcp',
  transport: 'http',
  connectionId: 'conn-a',
  connectionState: 'connected',
} as never

/** Tab B's own connection and pending call, which no reply of A may touch. */
const mcpOnB = () =>
  useMcpStore.setState({
    url: 'http://b.example/mcp',
    transport: 'http',
    connectionId: 'conn-b',
    connectionState: 'connected',
  } as never)

const ACTION_ROWS: TabRow[] = [
  heldRow({
    store: 'graphql',
    action: 'unsubscribe',
    bridge: (spy) => ({ graphqlWs: { disconnect: spy, cancelConnect: vi.fn() } }),
    onA: () => useGraphQLStore.setState({ subscriptionState: 'connected', connectionId: 'sub-a' }),
    start: () => useGraphQLStore.getState().unsubscribe(),
    onB: () => useGraphQLStore.setState({ subscriptionState: 'connected', connectionId: 'sub-b' }),
    reply: ok(null),
    expectA: () => {
      expect(useGraphQLStore.getState().subscriptionState).toBe('disconnected')
      expect(useGraphQLStore.getState().connectionId).toBeNull()
    },
  }),
  heldRow({
    store: 'websocket',
    action: 'disconnect',
    bridge: (spy) => bridgeOf(['ws', 'websocket'], { disconnect: spy }),
    onA: () => useWebSocketStore.setState(liveRealtime),
    start: () => useWebSocketStore.getState().disconnect(),
    onB: () => useWebSocketStore.setState(liveRealtimeB),
    reply: ok(null),
    expectA: () => {
      expect(useWebSocketStore.getState().connectionId).toBeNull()
      expect(useWebSocketStore.getState().messages.length).toBe(1)
    },
  }),
  heldRow({
    store: 'websocket',
    action: 'sendMessage',
    bridge: (spy) => bridgeOf(['ws', 'websocket'], { send: spy }),
    onA: () => useWebSocketStore.setState({ ...liveRealtime, composerContent: 'hi' }),
    start: () => useWebSocketStore.getState().sendMessage(),
    onB: () => useWebSocketStore.setState(liveRealtimeB),
    reply: fail('send failed for A'),
    expectA: () => expect(useWebSocketStore.getState().errorMessage).toBe('send failed for A'),
  }),
  heldRow({
    store: 'sse',
    action: 'disconnect',
    bridge: (spy) => bridgeOf('sse', { disconnect: spy }),
    onA: () => useSseStore.setState(liveRealtime),
    start: () => useSseStore.getState().disconnect(),
    onB: () => useSseStore.setState(liveRealtimeB),
    reply: ok(null),
    expectA: () => expect(useSseStore.getState().connectionId).toBeNull(),
  }),
  heldRow({
    store: 'sse',
    action: 'reconnect',
    op: 'reconnect does not connect the tab on screen when the close ends',
    bridge: (spy) => bridgeOf('sse', { disconnect: spy }),
    onA: () => useSseStore.setState({ ...liveRealtime, url: 'http://a.example/sse' }),
    start: () => useSseStore.getState().reconnect(),
    onB: () => useSseStore.setState({ url: 'http://b.example/sse' }),
    reply: ok(null),
    expectA: () => expect(useSseStore.getState().connectionId).toBeNull(),
  }),
  heldRow({
    store: 'socketio',
    action: 'disconnect',
    bridge: (spy) => bridgeOf('socketio', { disconnect: spy }),
    onA: () => useSocketIOStore.setState(liveRealtime),
    start: () => useSocketIOStore.getState().disconnect(),
    onB: () => useSocketIOStore.setState(liveRealtimeB),
    reply: ok(null),
    expectA: () => {
      expect(useSocketIOStore.getState().connectionId).toBeNull()
      expect(useSocketIOStore.getState().events.length).toBe(1)
    },
  }),
  heldRow({
    store: 'socketio',
    action: 'emit',
    bridge: (spy) => bridgeOf('socketio', { emitArgs: spy }),
    onA: () => useSocketIOStore.setState(liveRealtime),
    start: () => useSocketIOStore.getState().emit(),
    onB: () => useSocketIOStore.setState(liveRealtimeB),
    reply: fail('emit failed for A'),
    expectA: () => expect(useSocketIOStore.getState().errorMessage).toBe('emit failed for A'),
  }),
  heldRow({
    store: 'mqtt',
    action: 'disconnect',
    bridge: (spy) => bridgeOf('mqtt', { disconnect: spy }),
    onA: () => useMqttStore.setState(liveRealtime),
    start: () => useMqttStore.getState().disconnect(),
    onB: () => useMqttStore.setState(liveRealtimeB),
    reply: ok(null),
    expectA: () => {
      expect(useMqttStore.getState().connectionId).toBeNull()
      expect(useMqttStore.getState().log.length).toBe(1)
    },
  }),
  heldRow({
    store: 'mqtt',
    action: 'publish',
    bridge: (spy) => bridgeOf('mqtt', { publish: spy }),
    onA: () => useMqttStore.setState(liveRealtime),
    start: () => useMqttStore.getState().publish(),
    onB: () => useMqttStore.setState(liveRealtimeB),
    reply: fail('publish failed for A'),
    expectA: () => expect(useMqttStore.getState().errorMessage).toBe('publish failed for A'),
  }),
  heldRow({
    store: 'mqtt',
    action: 'toggleTopic',
    bridge: (spy) => bridgeOf('mqtt', { subscribe: spy, unsubscribe: spy }),
    onA: () =>
      useMqttStore.setState({
        ...liveRealtime,
        topics: [{ id: 't1', name: 'a/topic', qos: 0, subscribe: false }],
      } as never),
    start: () => useMqttStore.getState().toggleTopic('t1'),
    onB: () => useMqttStore.setState(liveRealtimeB),
    reply: fail('subscribe failed for A'),
    expectA: () => expect(useMqttStore.getState().errorMessage).toBe('subscribe failed for A'),
  }),
  heldRow({
    store: 'mcp',
    action: 'disconnect',
    bridge: (spy) => bridgeOf('mcp', { disconnect: spy }),
    onA: () => useMcpStore.setState(liveMcp),
    start: () => mcp().disconnect(),
    onB: mcpOnB,
    reply: ok(null),
    expectA: () => expect(mcp().connectionId).toBeNull(),
  }),
  heldRow({
    store: 'mcp',
    action: 'listTools',
    bridge: (spy) => bridgeOf('mcp', { listTools: spy }),
    onA: () => useMcpStore.setState(liveMcp),
    start: () => mcp().listTools(),
    onB: mcpOnB,
    reply: ok([{ name: 'tool-of-a', inputSchema: {} }]),
    expectA: () => expect(mcp().tools.map((x) => x.name)).toEqual(['tool-of-a']),
  }),
  heldRow({
    store: 'mcp',
    action: 'listResources',
    bridge: (spy) => bridgeOf('mcp', { listResources: spy }),
    onA: () => useMcpStore.setState(liveMcp),
    start: () => mcp().listResources(),
    onB: mcpOnB,
    reply: ok({ resources: [{ uri: 'a://1', name: 'of-a' }], templates: [] }),
    expectA: () => expect(mcp().resources.map((x) => x.uri)).toEqual(['a://1']),
  }),
  heldRow({
    store: 'mcp',
    action: 'listPrompts',
    bridge: (spy) => bridgeOf('mcp', { listPrompts: spy }),
    onA: () => useMcpStore.setState(liveMcp),
    start: () => mcp().listPrompts(),
    onB: mcpOnB,
    reply: ok([{ name: 'prompt-of-a' }]),
    expectA: () => expect(mcp().prompts.map((x) => x.name)).toEqual(['prompt-of-a']),
  }),
  heldRow({
    store: 'mcp',
    action: 'callTool',
    bridge: (spy) => bridgeOf('mcp', { callTool: spy }),
    onA: () =>
      useMcpStore.setState({
        ...(liveMcp as object),
        selectedTool: 'echo',
        toolArgs: '{}',
        tools: [{ name: 'echo', inputSchema: {} }],
      } as never),
    start: () => mcp().callTool(),
    onB: mcpOnB,
    reply: ok({ content: [{ type: 'text', text: 'from A' }] }),
    expectA: () => {
      expect(mcp().isInvoking).toBe(false)
      expect(JSON.stringify(mcp().result)).toContain('from A')
    },
  }),
  heldRow({
    store: 'mcp',
    action: 'respondInput',
    bridge: (spy) => bridgeOf('mcp', { respondInput: spy }),
    onA: () =>
      useMcpStore.setState({
        ...(liveMcp as object),
        selectedTool: 'echo',
        pendingInput: { toolName: 'echo', args: {}, requestState: 's', round: 1, requests: {} },
      } as never),
    start: () => mcp().respondInput({}),
    onB: mcpOnB,
    reply: fail('answer failed for A'),
    expectA: () => {
      expect(mcp().isInvoking).toBe(false)
      expect(mcp().pendingInput?.error).toBe('answer failed for A')
    },
  }),
  heldRow({
    store: 'mcp',
    action: 'readResource',
    bridge: (spy) => bridgeOf('mcp', { readResource: spy }),
    onA: () => useMcpStore.setState({ ...(liveMcp as object), resourceUriDraft: 'a://1' } as never),
    start: () => mcp().readResource(),
    onB: mcpOnB,
    reply: fail('read failed for A'),
    expectA: () => {
      expect(mcp().isReadingResource).toBe(false)
      expect(mcp().resourceError).toBe('read failed for A')
    },
  }),
  heldRow({
    store: 'mcp',
    action: 'getPrompt',
    bridge: (spy) => bridgeOf('mcp', { getPrompt: spy }),
    onA: () =>
      useMcpStore.setState({
        ...(liveMcp as object),
        selectedPrompt: 'p',
        prompts: [{ name: 'p' }],
      } as never),
    start: () => mcp().getPrompt(),
    onB: mcpOnB,
    reply: fail('prompt failed for A'),
    expectA: () => {
      expect(mcp().isGettingPrompt).toBe(false)
      expect(mcp().promptError).toBe('prompt failed for A')
    },
  }),
  heldRow({
    store: 'mcp',
    action: 'cancelCall',
    bridge: (spy) => bridgeOf('mcp', { cancelCall: spy }),
    onA: () =>
      useMcpStore.setState({
        ...(liveMcp as object),
        isInvoking: true,
        toolCallId: 'call-a',
      } as never),
    start: () => mcp().cancelCall('tool'),
    onB: () => {
      mcpOnB()
      useMcpStore.setState({ isInvoking: true, toolCallId: 'call-b' })
    },
    reply: ok(null),
    expectA: () => expect(mcp().toolCallId).toBeNull(),
  }),
  heldRow({
    store: 'mcp',
    action: 'respondElicitation',
    bridge: (spy) => bridgeOf('mcp', { respondElicitation: spy }),
    onA: () =>
      useMcpStore.setState({
        ...(liveMcp as object),
        pendingElicitations: [{ elicitationId: 'e1', message: 'q' }],
      } as never),
    start: () => mcp().respondElicitation('e1', 'decline'),
    onB: mcpOnB,
    reply: fail('answer failed for A'),
    expectA: () => expect(mcp().pendingElicitations[0]?.error).toBe('answer failed for A'),
  }),
  heldRow({
    store: 'mcp',
    action: 'startOAuth',
    bridge: (spy) => bridgeOf('mcp', { oauthStart: spy }),
    onA: () => useMcpStore.setState({ url: 'http://a.example/mcp', transport: 'http' } as never),
    start: () => mcp().startOAuth(),
    onB: mcpOnB,
    reply: ok({ oauthSessionId: 'flow-a' }),
    expectA: () => expect(mcp().oauthFlowId).toBe('flow-a'),
  }),
  heldRow({
    store: 'mcp',
    action: 'cancelOAuth',
    bridge: (spy) => bridgeOf('mcp', { oauthCancel: spy }),
    onA: () => useMcpStore.setState({ oauthRunning: true, oauthFlowId: 'flow-a' }),
    start: () => mcp().cancelOAuth(),
    onB: mcpOnB,
    reply: ok(null),
  }),
  heldRow({
    store: 'mcp',
    action: 'answerOAuthConfirmation',
    bridge: (spy) => bridgeOf('mcp', { oauthConfirm: spy }),
    onA: () => useMcpStore.setState({ oauthRunning: true, oauthFlowId: 'flow-a' }),
    start: () => mcp().answerOAuthConfirmation(true),
    onB: mcpOnB,
    reply: fail('confirm failed for A'),
    expectA: () => expect(mcp().oauthError).toBe('confirm failed for A'),
  }),
  heldRow({
    store: 'mcp',
    action: 'connectWithOAuth',
    op: 'connectWithOAuth does not connect the tab on screen when the close ends',
    bridge: (spy) => bridgeOf('mcp', { disconnect: spy }),
    onA: () =>
      useMcpStore.setState({
        ...(liveMcp as object),
        oauthFlowId: 'flow-a',
        oauthSummary: {},
      } as never),
    start: () => mcp().connectWithOAuth(),
    onB: () => useMcpStore.setState({ url: 'http://b.example/mcp', transport: 'http' } as never),
    reply: ok(null),
    expectA: () => expect(mcp().oauthSessionId).toBe('flow-a'),
  }),
  heldRow({
    store: 'mcp',
    action: 'startSecurityScan',
    bridge: (spy) => bridgeOf('mcp', { securityScan: spy }),
    onA: () => useMcpStore.setState({ url: 'http://a.example/mcp', transport: 'http' } as never),
    start: () => mcp().startSecurityScan(),
    onB: mcpOnB,
    reply: ok({ scanId: 'scan-a' }),
    expectA: () => expect(mcp().securityScanId).toBe('scan-a'),
  }),
  heldRow({
    store: 'mcp',
    action: 'cancelSecurityScan',
    bridge: (spy) => bridgeOf('mcp', { securityCancel: spy }),
    onA: () => useMcpStore.setState({ securityRunning: true, securityScanId: 'scan-a' }),
    start: () => mcp().cancelSecurityScan(),
    onB: mcpOnB,
    reply: ok(null),
  }),
  heldRow({
    store: 'ai',
    action: 'cancel',
    bridge: (spy) => ({ aiChat: { cancel: spy } }),
    onA: () => useAiChatStore.setState({ pendingMessageId: 'msg-a' }),
    start: () => useAiChatStore.getState().cancel(),
    reply: ok(null),
  }),
]

/** The saved key is read in the background when a tab comes on screen. */
function savedKeyRow(op: string, onB: () => void): TabRow {
  return {
    store: 'ai',
    op,
    run: async () => {
      resetAiKeySessionForTests()
      const getKey = held<unknown>()
      setApi({ aiChat: { getKey: getKey.spy } })
      useAiChatStore.setState({ provider: 'openai', customUrl: '', apiKey: '' })
      useAiChatStore.getState().switchToTab(A)
      await getKey.calledTimes(1)

      switchActiveTab(B)
      onB()
      getKey.resolve(ok({ key: 'saved-key', encryptionAvailable: true }))
      await new Promise((r) => setTimeout(r, 0))
      expect(useAiChatStore.getState().apiKey).toBe('')
      resetAiKeySessionForTests()
    },
  }
}

const SAVED_KEY_ROWS: TabRow[] = [
  savedKeyRow('a saved key read for A stays off a tab with saved keys disabled', () =>
    useAiChatStore.setState({ savedKeyDisabled: true }),
  ),
  savedKeyRow('a saved key read for A stays off a tab on another provider', () =>
    useAiChatStore.setState({ provider: 'anthropic' }),
  ),
]

const WITHHELD_ROWS: TabRow[] = [
  withheldRow({
    store: 'http',
    action: 'sendRequest',
    bridge: (send) => ({ request: { send, cancel: vi.fn() } }),
    configure: () => useRequestStore.setState({ url: 'http://x.example' }),
    start: () => useRequestStore.getState().sendRequest(),
    setState: (p) => useRequestStore.setState(p),
  }),
  withheldRow({
    store: 'soap',
    action: 'sendSoap',
    bridge: (send) => ({ request: { send, cancel: vi.fn() } }),
    configure: () =>
      useSoapStore.setState({ rawXml: '<a/>', endpointUrl: 'http://x.example', mode: 'manual' }),
    start: () => useSoapStore.getState().sendSoap(),
    setState: (p) => useSoapStore.setState(p),
  }),
  withheldRow({
    store: 'graphql',
    action: 'executeQuery',
    bridge: (send) => ({ request: { send, cancel: vi.fn() } }),
    configure: () => useGraphQLStore.setState({ url: 'http://x.example/graphql', query: '{ a }' }),
    start: () => useGraphQLStore.getState().executeQuery(),
    setState: (p) => useGraphQLStore.setState(p),
  }),
  withheldRow({
    store: 'graphql',
    action: 'introspect',
    bridge: (send) => ({ request: { send, cancel: vi.fn() } }),
    configure: () => useGraphQLStore.setState({ url: 'http://x.example/graphql' }),
    start: () => useGraphQLStore.getState().introspect(),
    setState: (p) => useGraphQLStore.setState(p),
  }),
  withheldRow({
    store: 'graphql',
    action: 'subscribe',
    bridge: (send) => ({
      graphqlWs: {
        connect: send,
        disconnect: vi.fn(),
        cancelConnect: vi.fn(),
        onEvent: () => () => {},
      },
    }),
    configure: () =>
      useGraphQLStore.setState({ url: 'http://x.example/graphql', query: 'subscription { a }' }),
    start: () => useGraphQLStore.getState().subscribe(),
    setState: (p) => useGraphQLStore.setState(p),
  }),
  withheldRow({
    store: 'grpc',
    action: 'execute',
    bridge: (send) => ({ grpc: { execute: send, cancelUnary: vi.fn() } }),
    configure: () =>
      useGrpcStore.setState({
        address: 'x.example:1',
        services: [
          {
            name: 'a.Greeter',
            methods: [{ name: 'Hello', type: 'unary', requestType: 'Q', responseType: 'R' }],
          },
        ],
        selectedService: 'a.Greeter',
        selectedMethod: 'Hello',
      }),
    start: () => useGrpcStore.getState().execute(),
    setState: (p) => useGrpcStore.setState(p),
  }),
  withheldRow({
    store: 'websocket',
    action: 'connect',
    bridge: (send) => bridgeOf(['ws', 'websocket'], { connect: send }),
    configure: () => useWebSocketStore.setState({ url: 'ws://x.example' }),
    start: () => useWebSocketStore.getState().connect(),
    setState: (p) => useWebSocketStore.setState(p),
  }),
  withheldRow({
    store: 'websocket',
    action: 'sendMessage',
    bridge: (send) => bridgeOf(['ws', 'websocket'], { send }),
    configure: () => useWebSocketStore.setState({ ...liveRealtime, composerContent: 'hi' }),
    start: () => useWebSocketStore.getState().sendMessage(),
    setState: (p) => useWebSocketStore.setState(p),
  }),
  withheldRow({
    store: 'sse',
    action: 'connect',
    bridge: (send) => bridgeOf('sse', { connect: send }),
    configure: () => useSseStore.setState({ url: 'http://x.example/sse' }),
    start: () => useSseStore.getState().connect(),
    setState: (p) => useSseStore.setState(p),
  }),
  withheldRow({
    store: 'socketio',
    action: 'connect',
    bridge: (send) => bridgeOf('socketio', { connect: send }),
    configure: () => useSocketIOStore.setState({ url: 'http://x.example' }),
    start: () => useSocketIOStore.getState().connect(),
    setState: (p) => useSocketIOStore.setState(p),
  }),
  withheldRow({
    store: 'socketio',
    action: 'emit',
    bridge: (send) => bridgeOf('socketio', { emitArgs: send }),
    configure: () => useSocketIOStore.setState(liveRealtime),
    start: () => useSocketIOStore.getState().emit(),
    setState: (p) => useSocketIOStore.setState(p),
  }),
  withheldRow({
    store: 'mqtt',
    action: 'connect',
    bridge: (send) => bridgeOf('mqtt', { connect: send }),
    configure: () => useMqttStore.setState({ url: 'mqtt://x.example' }),
    start: () => useMqttStore.getState().connect(),
    setState: (p) => useMqttStore.setState(p),
  }),
  withheldRow({
    store: 'mqtt',
    action: 'publish',
    bridge: (send) => bridgeOf('mqtt', { publish: send }),
    configure: () => useMqttStore.setState(liveRealtime),
    start: () => useMqttStore.getState().publish(),
    setState: (p) => useMqttStore.setState(p),
  }),
  withheldRow({
    store: 'mcp',
    action: 'connect',
    bridge: (send) => bridgeOf('mcp', { connect: send }),
    configure: () =>
      useMcpStore.setState({ url: 'http://x.example/mcp', transport: 'http' } as never),
    start: () => mcp().connect(),
    setState: (p) => useMcpStore.setState(p),
  }),
  withheldRow({
    store: 'mcp',
    action: 'callTool',
    bridge: (send) => bridgeOf('mcp', { callTool: send }),
    configure: () =>
      useMcpStore.setState({
        ...(liveMcp as object),
        selectedTool: 'echo',
        toolArgs: '{}',
        tools: [{ name: 'echo', inputSchema: {} }],
      } as never),
    start: () => mcp().callTool(),
    setState: (p) => useMcpStore.setState(p),
  }),
  withheldRow({
    store: 'mcp',
    action: 'startOAuth',
    bridge: (send) => bridgeOf('mcp', { oauthStart: send }),
    configure: () =>
      useMcpStore.setState({ url: 'http://x.example/mcp', transport: 'http' } as never),
    start: () => mcp().startOAuth(),
    setState: (p) => useMcpStore.setState(p),
  }),
  withheldRow({
    store: 'mcp',
    action: 'startSecurityScan',
    bridge: (send) => bridgeOf('mcp', { securityScan: send }),
    configure: () =>
      useMcpStore.setState({ url: 'http://x.example/mcp', transport: 'http' } as never),
    start: () => mcp().startSecurityScan(),
    setState: (p) => useMcpStore.setState(p),
  }),
]

interface TabbedStore {
  getState: () => { _tabStates: Map<string, unknown>; removeTabState: (id: string) => void }
}

const TABBED_STORES: Record<TabRow['store'], TabbedStore> = {
  http: useRequestStore,
  soap: useSoapStore,
  grpc: useGrpcStore,
  graphql: useGraphQLStore,
  websocket: useWebSocketStore,
  sse: useSseStore,
  socketio: useSocketIOStore,
  mqtt: useMqttStore,
  mcp: useMcpStore,
  ai: useAiChatStore,
}

/** A piece of work on tab A with its IPC call held open. */
interface ClosedRow {
  op: string
  store: TabRow['store']
  /** Starts the work; `finished` runs once it ended, on a tab that is gone. */
  start: () => {
    call: ReturnType<typeof held<unknown>>
    done: Promise<void>
    reply: unknown
    /** Runs once the tab is closed, before the reply lands. */
    beforeReply?: () => void
    finished?: () => void
  }
}

/** A connection that opens after its tab closed has nobody left to close it. */
function closedConnectRow(
  store: TabRow['store'],
  bridgeKeys: string[],
  arrange: () => void,
  connect: () => Promise<void>,
): ClosedRow {
  return {
    op: `${store} connect`,
    store,
    start: () => {
      const call = held<unknown>()
      const bridge = {
        ...realtimeBridge(call.spy as ReturnType<typeof vi.fn>),
        cancelConnect: vi.fn(async () => ok(null)),
      }
      setApi(Object.fromEntries(bridgeKeys.map((k) => [k, bridge])))
      arrange()
      return {
        call,
        done: connect(),
        reply: ok({ connectionId: 'conn-a', url: 'x', clientId: 'x' }),
        finished: () => expect(bridge.disconnect).toHaveBeenCalledWith('conn-a'),
      }
    },
  }
}

const CLOSED_ROWS: ClosedRow[] = [
  {
    op: 'graphql Send',
    store: 'graphql',
    start: () => {
      const call = held<unknown>()
      setApi({ request: { send: call.spy, cancel: vi.fn() } })
      useGraphQLStore.setState({ url: 'http://a.example/graphql', query: '{ a }' })
      return {
        call,
        done: useGraphQLStore.getState().executeQuery(),
        reply: ok(apiResponse('from A', 'graphql')),
      }
    },
  },
  {
    op: 'graphql introspect',
    store: 'graphql',
    start: () => {
      const call = held<unknown>()
      setApi({ request: { send: call.spy, cancel: vi.fn() } })
      useGraphQLStore.setState({ url: 'http://a.example/graphql' })
      return {
        call,
        done: useGraphQLStore.getState().introspect(),
        reply: ok(apiResponse(INTROSPECTION, 'graphql')),
      }
    },
  },
  {
    op: 'soap parse WSDL',
    store: 'soap',
    start: () => {
      const call = held<unknown>()
      setApi({ soap: { parseWsdl: call.spy } })
      useSoapStore.setState({ wsdlUrl: 'http://a.example/?wsdl' })
      return { call, done: useSoapStore.getState().parseWsdl(), reply: ok(WSDL) }
    },
  },
  {
    op: 'grpc load proto from URL',
    store: 'grpc',
    start: () => {
      const call = held<unknown>()
      setApi({ grpc: { loadProtoFromUrl: call.spy } })
      useGrpcStore.setState({ protoUrl: 'http://a.example/a.proto' })
      return { call, done: useGrpcStore.getState().loadProtoFromUrl(), reply: ok(PROTO) }
    },
  },
  {
    op: 'grpc server stream: an event already on its way, then the late stream id',
    store: 'grpc',
    start: () => {
      const call = held<unknown>()
      const cancelStream = vi.fn(async () => ok(null))
      let event: (e: unknown) => void = () => {}
      setApi({
        grpc: {
          serverStream: call.spy,
          cancelStream,
          onStreamEvent: (cb: (e: unknown) => void) => {
            event = cb
            return () => {}
          },
        },
      })
      useGrpcStore.setState({
        address: 'a.example:1',
        services: [
          {
            name: 'a.Greeter',
            methods: [
              { name: 'Watch', type: 'server_streaming', requestType: 'Q', responseType: 'R' },
            ],
          },
        ],
        selectedService: 'a.Greeter',
        selectedMethod: 'Watch',
      })
      return {
        call,
        done: useGrpcStore.getState().execute(),
        reply: ok({ streamId: 'stream-a' }),
        beforeReply: () => event({ type: 'data', data: '{}', timestamp: 1 }),
        finished: () => expect(cancelStream).toHaveBeenCalledWith('stream-a'),
      }
    },
  },
  closedConnectRow(
    'websocket',
    ['ws', 'websocket'],
    () => useWebSocketStore.setState({ url: 'ws://a.example' }),
    () => useWebSocketStore.getState().connect(),
  ),
  closedConnectRow(
    'sse',
    ['sse'],
    () => useSseStore.setState({ url: 'http://a.example/sse' }),
    () => useSseStore.getState().connect(),
  ),
  closedConnectRow(
    'socketio',
    ['socketio'],
    () => useSocketIOStore.setState({ url: 'http://a.example' }),
    () => useSocketIOStore.getState().connect(),
  ),
  closedConnectRow(
    'mqtt',
    ['mqtt'],
    () => useMqttStore.setState({ url: 'mqtt://a.example' }),
    () => useMqttStore.getState().connect(),
  ),
  {
    op: 'mcp connect',
    store: 'mcp',
    start: () => {
      const call = held<unknown>()
      const disconnect = vi.fn(async () => ok(null))
      setApi({
        mcp: {
          connect: call.spy,
          disconnect,
          cancelConnect: vi.fn(async () => ok(null)),
          onEvent: () => () => {},
          onNotification: () => () => {},
          onFrame: () => () => {},
        },
      })
      useMcpStore.setState({ transport: 'http', url: 'http://a.example/mcp' } as never)
      return {
        call,
        done: useMcpStore.getState().connect(),
        reply: ok({ connectionId: 'conn-a', capabilities: null }),
        finished: () => expect(disconnect).toHaveBeenCalledWith('conn-a'),
      }
    },
  },
  {
    op: 'ai send',
    store: 'ai',
    start: () => {
      const call = held<unknown>()
      const cancel = vi.fn(async () => ok(null))
      setApi({ aiChat: { send: call.spy, cancel } })
      useAiChatStore.setState({ provider: 'openai', model: 'm' } as never)
      return {
        call,
        done: useAiChatStore.getState().sendPrompt('hello'),
        reply: ok({ messageId: 'msg-a' }),
        finished: () => expect(cancel).toHaveBeenCalledWith('msg-a'),
      }
    },
  },
]

/** The tab closes with another tab on screen, or as the tab on screen. */
const CLOSE_ORDERS: Array<[string, (store: TabbedStore) => void, (store: TabbedStore) => void]> = [
  [
    'closed from another tab',
    (store) => {
      switchActiveTab(B)
      store.getState().removeTabState(A)
    },
    () => {},
  ],
  [
    'closed on screen, next tab opens after the reply',
    (store) => store.getState().removeTabState(A),
    () => switchActiveTab(B),
  ],
]

const PROTOCOL_OF_STORE: Record<TabRow['store'], Tab['protocol']> = {
  http: 'http',
  soap: 'soap',
  grpc: 'grpc',
  graphql: 'graphql',
  websocket: 'websocket',
  sse: 'sse',
  socketio: 'socketio',
  mqtt: 'mqtt',
  mcp: 'mcp',
  ai: 'ai',
}

function resetAllStores(protocol: Tab['protocol']): void {
  localStorage.clear()
  const stores = [
    useRequestStore,
    useSoapStore,
    useGrpcStore,
    useGraphQLStore,
    useWebSocketStore,
    useSseStore,
    useSocketIOStore,
    useMqttStore,
    useMcpStore,
    useAiChatStore,
  ] as unknown as Array<{ setState: (p: object) => void }>
  for (const s of stores) s.setState({ _tabStates: new Map(), _currentTabId: null })
  useWorkspaceStore.setState({ activeWorkspaceId: null, activeProjectId: null })
  useTabsStore.setState({ tabs: [tab(A, protocol), tab(B, protocol)], activeTabId: A })
  useResponseStore.setState({ byTab: {}, activeTabId: A, response: null, isLoading: false })
  useRequestStore.setState({ _inflightByTab: {} })
  activateTabStores(A)
}

describe('async work started on a tab stays on that tab', () => {
  const rows = [...ROWS, ...ACTION_ROWS, ...SAVED_KEY_ROWS, ...WITHHELD_ROWS]
  it.each(rows.map((r) => [`${r.store}: ${r.op}`, r] as const))('%s', async (_name, row) => {
    resetAllStores(PROTOCOL_OF_STORE[row.store])
    await row.run()
  })
})

describe('a tab closed while its work is in flight stays closed', () => {
  const cases = CLOSED_ROWS.flatMap((row) =>
    CLOSE_ORDERS.map(([order, close, next]) => [`${row.op}: ${order}`, row, close, next] as const),
  )
  it.each(cases)('%s', async (_name, row, close, next) => {
    resetAllStores(PROTOCOL_OF_STORE[row.store])
    const store = TABBED_STORES[row.store]
    const { call, done, reply, beforeReply, finished } = row.start()
    await call.calledTimes(1)
    close(store)
    beforeReply?.()
    call.resolve(reply)
    await done
    next(store)
    expect([...store.getState()._tabStates.keys()]).toEqual([])
    finished?.()
  })
})

describe('closing a tab forgets its slice', () => {
  const stores = Object.entries(TABBED_STORES) as Array<[TabRow['store'], TabbedStore]>

  it.each(stores)('%s: the tab on screen, with another tab next', (key, store) => {
    resetAllStores(PROTOCOL_OF_STORE[key])
    setApi({})
    cleanupTabState(A)
    switchActiveTab(B)
    expect([...store.getState()._tabStates.keys()]).toEqual([])
  })

  it.each(stores)('%s: the last tab, then a new one', (key, store) => {
    resetAllStores(PROTOCOL_OF_STORE[key])
    setApi({})
    useTabsStore.setState({ tabs: [tab(A, PROTOCOL_OF_STORE[key])], activeTabId: A })
    cleanupTabState(A)
    useTabsStore.setState({ tabs: [tab('tab-c', PROTOCOL_OF_STORE[key])], activeTabId: 'tab-c' })
    switchActiveTab('tab-c')
    expect([...store.getState()._tabStates.keys()]).toEqual([])
  })

  it('an open gRPC stream is cancelled with its tab', () => {
    resetAllStores('grpc')
    const cancelStream = vi.fn(async () => ok(null))
    setApi({ grpc: { cancelStream } })
    useGrpcStore.setState({ activeStreamId: 'stream-a' })
    cleanupTabState(A)
    expect(cancelStream).toHaveBeenCalledWith('stream-a')
  })

  it('an open gRPC stream is cancelled with its tab when another tab is on screen', () => {
    resetAllStores('grpc')
    const cancelStream = vi.fn(async () => ok(null))
    setApi({ grpc: { cancelStream } })
    useGrpcStore.setState({ activeStreamId: 'stream-a' })
    switchActiveTab(B)
    useGrpcStore.getState().removeTabState(A)
    expect(cancelStream).toHaveBeenCalledWith('stream-a')
  })

  it('an open SSE connection closes with its tab', () => {
    resetAllStores('sse')
    const disconnect = vi.fn(async () => ok(null))
    setApi({ sse: { disconnect } })
    useSseStore.setState({ connectionId: 'conn-a', connectionState: 'connected' })
    cleanupTabState(A)
    expect(disconnect).toHaveBeenCalledWith('conn-a')
  })

  it('an open SSE connection closes with its tab when another tab is on screen', () => {
    resetAllStores('sse')
    const disconnect = vi.fn(async () => ok(null))
    setApi({ sse: { disconnect } })
    useSseStore.setState({ connectionId: 'conn-a', connectionState: 'connected' })
    switchActiveTab(B)
    useSseStore.getState().removeTabState(A)
    expect(disconnect).toHaveBeenCalledWith('conn-a')
  })
})

describe('per-tab runtime state stays out of the stored snapshot', () => {
  it('a GraphQL schema is kept for the session, not written to localStorage', async () => {
    resetAllStores('graphql')
    setApi({ request: { send: vi.fn(async () => ok(apiResponse(INTROSPECTION, 'graphql'))) } })
    useGraphQLStore.setState({ url: 'http://a.example/graphql' })
    await useGraphQLStore.getState().introspect()
    expect(useGraphQLStore.getState().schemaData).not.toBeNull()
    switchActiveTab(B)
    expect(localStorage.getItem('testnizer-graphql')).not.toContain('queryType')
    expect(useGraphQLStore.getState()._tabStates.get(A)?.schemaData).not.toBeNull()
  })

  it('Duplicate Tab keeps the GraphQL schema, without the introspection in flight', () => {
    resetAllStores('graphql')
    const schema = { queryType: 'Query', mutationType: null, subscriptionType: null, types: [] }
    useGraphQLStore.setState({ schemaData: schema, isIntrospecting: true })
    useGraphQLStore.getState().cloneTabState(A, B)
    switchActiveTab(B)
    expect(useGraphQLStore.getState().schemaData).toEqual(schema)
    expect(useGraphQLStore.getState().isIntrospecting).toBe(false)
  })

  it('a WSDL parse in flight is not stored and not copied by Duplicate Tab', () => {
    resetAllStores('soap')
    useSoapStore.setState({ isLoading: true, parseError: 'x' })
    useSoapStore.getState().cloneTabState(A, B)
    expect(localStorage.getItem('testnizer-soap')).not.toContain('"isLoading":true')
    switchActiveTab(B)
    expect(useSoapStore.getState().isLoading).toBe(false)
    expect(useSoapStore.getState().parseError).toBeNull()
  })
})

describe('every tab-scoped store has a row in the table above', () => {
  const root = resolvePath(__dirname, '../..')
  const activateSource = readFileSync(resolvePath(root, 'src/renderer/lib/activate-tab.ts'), 'utf8')

  /** The stores `activateTabStores` switches: the workbench's own list. */
  const activated = [...activateSource.matchAll(/use(\w+)Store\.getState\(\)\.switchToTab/g)].map(
    (m) => m[1],
  )

  /** `use<Name>Store` → the row's store key. */
  const ROW_KEY_OF_HOOK: Record<string, TabRow['store']> = {
    Request: 'http',
    Soap: 'soap',
    Grpc: 'grpc',
    GraphQL: 'graphql',
    WebSocket: 'websocket',
    Sse: 'sse',
    SocketIO: 'socketio',
    Mqtt: 'mqtt',
    Mcp: 'mcp',
    AiChat: 'ai',
  }

  it('the list from activate-tab.ts is the one this file knows', () => {
    expect(activated.length).toBeGreaterThan(0)
    const unknown = activated.filter((hook) => !(hook in ROW_KEY_OF_HOOK))
    expect(unknown, 'add a row to ROWS and a ROW_KEY_OF_HOOK entry for these stores').toEqual([])
  })

  it.each(activated.map((hook) => [hook] as const))('use%sStore has a row', (hook) => {
    const key = ROW_KEY_OF_HOOK[hook]
    expect(ROWS.some((r) => r.store === key)).toBe(true)
  })

  /**
   * Every `async` action of a tab-scoped store, read off the live store rather
   * than its source: a new one fails here until it has a row or a stated reason.
   * An action that returns a promise without the `async` keyword is not seen.
   */
  it.each(Object.keys(TABBED_STORES) as Array<TabRow['store']>)(
    '%s: every async action has a row or a stated reason',
    (key) => {
      const actions = Object.entries(TABBED_STORES[key].getState())
        .filter(([, v]) => typeof v === 'function' && v.constructor.name === 'AsyncFunction')
        .map(([name]) => name)
      expect(actions.length).toBeGreaterThan(0)
      const rows = [...ROWS, ...ACTION_ROWS]
      const covered = new Set(rows.filter((r) => r.store === key).map((r) => r.action))
      const exempt = NO_TAB_WRITE[key] ?? {}
      expect(actions.filter((a) => !covered.has(a) && !(a in exempt))).toEqual([])
    },
  )

  it('no store with switchToTab is missing from activateTabStores', () => {
    const dir = resolvePath(root, 'src/renderer/stores')
    const withSwitch = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /\bswitchToTab\s*:/.test(readFileSync(resolvePath(dir, f), 'utf8')))
      .flatMap((f) => {
        const hook = /export const use(\w+)Store\b/.exec(readFileSync(resolvePath(dir, f), 'utf8'))
        return hook ? [hook[1]] : []
      })
    expect(withSwitch.filter((hook) => !activated.includes(hook))).toEqual([])
  })
})
