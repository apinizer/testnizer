/**
 * A failure is shown as a failure. These stores used to answer an exception, or a
 * missing bridge, with data nobody sent: a 200 "Hello from GraphQL demo!", a 200 with
 * the WSDL's example response, sample gRPC services, update 1.1.0 with a progress bar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUpdaterStore } from '../../src/renderer/stores/updater.store'
import type { Tab } from '../../src/renderer/types'

const setApi = (api: unknown): void => {
  ;(window as unknown as { api: unknown }).api = api
}

beforeEach(() => {
  window.localStorage.clear()
  useTabsStore.setState({
    tabs: [{ id: 't', name: 't', protocol: 'graphql', isDirty: false, isLoading: false } as Tab],
    activeTabId: 't',
  })
  useResponseStore.setState({ response: null, isLoading: false })
  useResponseStore.getState().switchToTab?.('t')
  useGraphQLStore.setState({ _currentTabId: 't', _tabStates: new Map() })
  useGrpcStore.setState({ _currentTabId: 't', _tabStates: new Map() })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('GraphQL Send', () => {
  it('a thrown exception shows that error, not a 200', async () => {
    setApi({ request: { send: vi.fn().mockRejectedValue(new Error('socket hang up')) } })
    useGraphQLStore.setState({ url: 'http://x.test/graphql', query: '{ a }' })

    await useGraphQLStore.getState().executeQuery()

    const shown = useResponseStore.getState().response
    expect(shown?.status).toBeUndefined()
    expect(shown?.body).toBeUndefined()
    expect(shown?.error).toBe('socket hang up')
    expect(useGraphQLStore.getState().response?.error).toBe('socket hang up')
    expect(useGraphQLStore.getState().isLoading).toBe(false)
  })
})

describe('SOAP Send', () => {
  it('a thrown exception shows that error, not the example response', async () => {
    setApi({ request: { send: vi.fn().mockRejectedValue(new Error('socket hang up')) } })
    useSoapStore.setState({
      parsedWsdl: null,
      rawXml: '<soapenv:Envelope/>',
      endpointUrl: 'http://x.test/svc',
    })

    await useSoapStore.getState().sendSoap()

    const shown = useResponseStore.getState().response
    expect(shown?.status).toBeUndefined()
    expect(shown?.body).toBeUndefined()
    expect(shown?.error).toBe('socket hang up')
    expect(useResponseStore.getState().isLoading).toBe(false)
  })
})

describe('gRPC Load Proto', () => {
  const nothingInvented = (): void => {
    const s = useGrpcStore.getState()
    expect(s.services).toEqual([])
    expect(s.protoPath).toBeNull()
    expect(s.protoLoaded).toBe(false)
    expect(s.selectedService).toBeNull()
    expect(s.isLoading).toBe(false)
  }
  beforeEach(() => {
    useGrpcStore.setState({
      services: [],
      protoPath: null,
      protoLoaded: false,
      selectedService: null,
      selectedMethod: null,
      errorMessage: null,
      isLoading: false,
    })
  })

  it('a thrown exception shows that error, not sample services', async () => {
    setApi({ grpc: { loadProto: vi.fn().mockRejectedValue(new Error('dialog failed')) } })
    await useGrpcStore.getState().loadProto()
    nothingInvented()
    expect(useGrpcStore.getState().errorMessage).toBe('dialog failed')
  })

  it('no bridge says so, like the other load actions', async () => {
    setApi({})
    await useGrpcStore.getState().loadProto()
    nothingInvented()
    expect(useGrpcStore.getState().errorMessage).toBe('gRPC bridge not available')
  })

  it.each([
    ['loadProtoFromUrl', () => useGrpcStore.getState().loadProtoFromUrl()],
    ['reflect', () => useGrpcStore.getState().loadFromReflection()],
  ])('%s: a thrown exception ends the spinner with that error', async (bridge, start) => {
    setApi({ grpc: { [bridge]: vi.fn().mockRejectedValue(new Error('ipc gone')) } })
    useGrpcStore.setState({ protoUrl: 'http://x.test/a.proto', address: 'x.test:1' })
    await start()
    nothingInvented()
    expect(useGrpcStore.getState().errorMessage).toBe('ipc gone')
  })
})

describe('gRPC stream actions report a refused write', () => {
  beforeEach(() => {
    useGrpcStore.setState({
      activeStreamId: 's1',
      halfClosed: false,
      errorMessage: null,
      requestBody: '{}',
    })
  })

  it('Send on a stream: a failed reply is shown', async () => {
    const sendStreamMessage = vi.fn(async () => ({ success: false, error: 'write failed' }))
    setApi({ grpc: { sendStreamMessage } })
    await useGrpcStore.getState().sendStreamMessage()
    expect(useGrpcStore.getState().errorMessage).toBe('write failed')
  })

  it('Send on a stream the engine no longer has is shown', async () => {
    setApi({ grpc: { sendStreamMessage: vi.fn(async () => ({ success: true, data: false })) } })
    await useGrpcStore.getState().sendStreamMessage()
    expect(useGrpcStore.getState().errorMessage).toMatch(/no longer open/)
  })

  it('End Streaming: a failed reply does not read as half-closed', async () => {
    setApi({ grpc: { endStream: vi.fn(async () => ({ success: false, error: 'end failed' })) } })
    await useGrpcStore.getState().endClientStream()
    expect(useGrpcStore.getState().errorMessage).toBe('end failed')
    expect(useGrpcStore.getState().halfClosed).toBe(false)
  })
})

describe('a stream’s first message', () => {
  it('a refused write on Send is shown', async () => {
    setApi({
      grpc: {
        bidiStream: vi.fn(async () => ({ success: true, data: { streamId: 's1' } })),
        sendStreamMessage: vi.fn(async () => ({ success: true, data: false })),
        onStreamEvent: () => () => {},
      },
    })
    useGrpcStore.setState({
      address: 'x.test:1',
      protoPath: '/p.proto',
      protoSource: 'file',
      activeStreamId: null,
      requestBody: '{"not sent":true}',
      services: [
        {
          name: 'S',
          methods: [{ name: 'M', type: 'bidi_streaming', requestType: '', responseType: '' }],
        },
      ],
      selectedService: 'S',
      selectedMethod: 'M',
    })
    await useGrpcStore.getState().execute()
    expect(useGrpcStore.getState().errorMessage).toMatch(/no longer open/)
  })
})

describe('Updater without a bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setApi({})
    useUpdaterStore.setState({
      status: 'idle',
      version: null,
      releaseNotes: null,
      downloadPercent: 0,
      errorMessage: null,
    })
  })

  it('check: an error, no invented version', () => {
    useUpdaterStore.getState().check()
    vi.advanceTimersByTime(5000)
    const s = useUpdaterStore.getState()
    expect(s.status).toBe('error')
    expect(s.errorMessage).toBeTruthy()
    expect(s.version).toBeNull()
    expect(s.releaseNotes).toBeNull()
  })

  it('download: an error, no invented progress', () => {
    useUpdaterStore.getState().download()
    vi.advanceTimersByTime(10_000)
    const s = useUpdaterStore.getState()
    expect(s.status).toBe('error')
    expect(s.errorMessage).toBeTruthy()
    expect(s.downloadPercent).toBe(0)
  })
})
