/**
 * A saved gRPC row whose definition comes from a URL reopens with the URL and the
 * selection, and no file: the path it saved is a cache file on the machine that saved
 * it, and an imported row never had one. Send is the user's action: it downloads the
 * proto first. Opening or restoring the tab fetches nothing, as a pulled project could
 * point anywhere.
 */
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'

const { info, warning } = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn() }))
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: { info, warning, error: vi.fn(), success: vi.fn() },
}))

import GrpcRequestPane from '../../src/renderer/components/protocols/GrpcRequestPane'
import { switchActiveTab } from '../../src/renderer/lib/activate-tab'
import { setLocale } from '../../src/renderer/lib/i18n'
import {
  restoreProtocolFromMetadata,
  snapshotProtocol,
} from '../../src/renderer/lib/save-active-request'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Tab } from '../../src/renderer/types'

const URL = 'https://protos.example.test/a.proto'
const A = 'tab-a'
const B = 'tab-b'

const method = (name: string, responseStream = false) => ({
  name,
  requestType: 'Req',
  responseType: 'Res',
  requestStream: false,
  responseStream,
})
const download = (methods = [method('First'), method('Second')]) => ({
  success: true,
  data: {
    protoPath: '/userData/grpc-protos/abc.proto',
    packageName: 'a',
    services: [
      { name: 'Other', fullName: 'a.Other', methods: [method('Unrelated')] },
      { name: 'Greeter', fullName: 'a.Greeter', methods },
    ],
  },
})

interface Calls {
  loadProtoFromUrl: ReturnType<typeof vi.fn>
  execute: ReturnType<typeof vi.fn>
  serverStream: ReturnType<typeof vi.fn>
}

function bridge(reply: unknown = download()): Calls {
  const calls = {
    loadProtoFromUrl: vi.fn(async () => reply),
    execute: vi.fn(async () => ({
      success: true,
      data: { requestId: 'r', protocol: 'grpc', timing: { total: 1 } },
    })),
    serverStream: vi.fn(async () => ({ success: true, data: { streamId: 's' } })),
  }
  ;(window as unknown as { api: unknown }).api = {
    grpc: {
      ...calls,
      onStreamEvent: () => () => {},
    },
  }
  return calls
}

/**
 * The real path of a saved URL row: Ctrl+S writes the block, another machine (a git
 * pull) or a later open restores it. The saved `protoPath` is a cache file under the
 * saving machine's userData, so it is not a file this machine can read.
 */
function reopenSavedRow(): void {
  useGrpcStore.setState({
    address: 'x.test:1',
    protoSource: 'url',
    protoUrl: URL,
    protoPath: '/Users/teammate/Library/Application Support/Testnizer/grpc-protos/abc.proto',
    protoLoaded: true,
    services: [
      { name: 'a.Other', methods: [] },
      {
        name: 'a.Greeter',
        methods: [{ name: 'Second', type: 'unary', requestType: 'Req', responseType: 'Res' }],
      },
    ],
    selectedService: 'a.Greeter',
    selectedMethod: 'Second',
  })
  const tab = useTabsStore.getState().tabs.find((t) => t.id === A) as Tab
  const saved = snapshotProtocol(tab).protocolMeta
  useGrpcStore.setState({
    protoPath: null,
    protoLoaded: false,
    services: [],
    selectedService: null,
    selectedMethod: null,
    protoUrl: '',
    protoSource: 'reflection',
  })
  restoreProtocolFromMetadata('grpc', saved)
}

beforeEach(() => {
  window.localStorage.clear()
  info.mockReset()
  setLocale('en')
  const tab = (id: string): Tab =>
    ({ id, name: id, protocol: 'grpc', isDirty: false, isLoading: false }) as Tab
  useTabsStore.setState({ tabs: [tab(A), tab(B)], activeTabId: A })
  useGrpcStore.setState({ _currentTabId: null, _tabStates: new Map() })
  switchActiveTab(A)
  useGrpcStore.setState({
    errorMessage: null,
    isLoading: false,
    isStreaming: false,
    services: [],
    protoLoaded: false,
    protoPath: null,
    selectedService: null,
    selectedMethod: null,
  })
})

describe('a saved URL row with no downloaded file', () => {
  it('opening it fetches nothing', () => {
    const { loadProtoFromUrl } = bridge()
    reopenSavedRow()
    switchActiveTab(B)
    switchActiveTab(A)
    expect(useGrpcStore.getState().protoUrl).toBe(URL)
    expect(useGrpcStore.getState().protoPath).toBeNull()
    expect(loadProtoFromUrl).not.toHaveBeenCalled()
  })

  it('Send downloads it, keeps the saved method, and calls with the file', async () => {
    const { loadProtoFromUrl, execute } = bridge()
    reopenSavedRow()

    await useGrpcStore.getState().execute()

    expect(loadProtoFromUrl).toHaveBeenCalledTimes(1)
    expect(loadProtoFromUrl).toHaveBeenCalledWith(URL)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toMatchObject({
      protoPath: '/userData/grpc-protos/abc.proto',
      serviceName: 'a.Greeter',
      methodName: 'Second',
    })
    expect(useGrpcStore.getState().selectedMethod).toBe('Second')
    expect(useGrpcStore.getState().protoPath).toBe('/userData/grpc-protos/abc.proto')
  })

  it('offline with a saved copy: Send goes out, with a warning it may be out of date', async () => {
    const reply = download()
    const { execute } = bridge({ ...reply, data: { ...reply.data, fromCache: true } })
    warning.mockClear()
    reopenSavedRow()

    await useGrpcStore.getState().execute()

    expect(execute).toHaveBeenCalledTimes(1)
    expect(useGrpcStore.getState().errorMessage).toBeNull()
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning.mock.calls[0][0]).toMatch(/out of date/)
  })

  it('a fresh download warns of nothing', async () => {
    bridge()
    warning.mockClear()
    reopenSavedRow()
    await useGrpcStore.getState().execute()
    expect(warning).not.toHaveBeenCalled()
  })

  it('no saved copy and no network: the error shows and nothing is sent', async () => {
    const message = 'Could not download the proto file from x.test, and no saved copy.'
    const { execute } = bridge({ success: false, error: message })
    reopenSavedRow()
    await useGrpcStore.getState().execute()
    expect(execute).not.toHaveBeenCalled()
    expect(useGrpcStore.getState().errorMessage).toBe(message)
  })

  it('the Load button warns the same way', async () => {
    const reply = download()
    bridge({ ...reply, data: { ...reply.data, fromCache: true } })
    warning.mockClear()
    reopenSavedRow()
    await useGrpcStore.getState().loadProtoFromUrl()
    expect(useGrpcStore.getState().protoPath).toBe('/userData/grpc-protos/abc.proto')
    expect(warning).toHaveBeenCalledTimes(1)
  })

  it('the second Send does not download again', async () => {
    const { loadProtoFromUrl, execute } = bridge()
    reopenSavedRow()
    await useGrpcStore.getState().execute()
    await useGrpcStore.getState().execute()
    expect(loadProtoFromUrl).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('the downloaded definition decides the streaming type', async () => {
    const { execute, serverStream } = bridge(download([method('First'), method('Second', true)]))
    reopenSavedRow()
    await useGrpcStore.getState().execute()
    expect(execute).not.toHaveBeenCalled()
    expect(serverStream).toHaveBeenCalledTimes(1)
  })

  it('a failed download is shown and nothing is sent', async () => {
    const { execute } = bridge({ success: false, error: 'Request failed with status code 404' })
    reopenSavedRow()
    await useGrpcStore.getState().execute()
    expect(execute).not.toHaveBeenCalled()
    expect(useGrpcStore.getState().errorMessage).toBe('Request failed with status code 404')
    expect(useGrpcStore.getState().isLoading).toBe(false)
  })

  it('a method the download no longer has is named, nothing is sent, the list is usable', async () => {
    const { execute } = bridge(download([method('First')]))
    reopenSavedRow()
    await useGrpcStore.getState().execute()
    expect(execute).not.toHaveBeenCalled()
    const s = useGrpcStore.getState()
    expect(s.errorMessage).toContain('a.Greeter/Second')
    expect(s.protoLoaded).toBe(true)
    expect(s.services.map((x) => x.name)).toEqual(['a.Other', 'a.Greeter'])
    expect(s.isLoading).toBe(false)
  })

  it('leaving the tab during the download: A gets the file, nothing is sent, a toast says so', async () => {
    let finish: (v: unknown) => void = () => {}
    const { execute, loadProtoFromUrl } = bridge()
    loadProtoFromUrl.mockImplementation(() => new Promise((r) => (finish = r)))
    reopenSavedRow()

    const send = useGrpcStore.getState().execute()
    await vi.waitFor(() => expect(loadProtoFromUrl).toHaveBeenCalled())
    switchActiveTab(B)
    useGrpcStore.setState({ address: 'b.test:1' })
    finish(download())
    await send

    expect(execute).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(info).toHaveBeenCalledTimes(1))
    expect(useGrpcStore.getState().address).toBe('b.test:1')
    expect(useGrpcStore.getState().protoPath).toBeNull()
    switchActiveTab(A)
    expect(useGrpcStore.getState().protoPath).toBe('/userData/grpc-protos/abc.proto')
    expect(useGrpcStore.getState().isLoading).toBe(false)
  })
})

describe('a URL row with a method and no service list (Postman v3 import)', () => {
  function reopenImportedRow(): void {
    restoreProtocolFromMetadata('grpc', {
      grpc: {
        address: 'x.test:1',
        useTls: false,
        protoSource: 'url',
        protoUrl: URL,
        protoPath: null,
        selectedService: 'a.Greeter',
        selectedMethod: 'Second',
        requestBody: '{}',
        metadata: [],
      },
    })
  }

  it('opening it fetches nothing, and it has a Send button', () => {
    const { loadProtoFromUrl } = bridge()
    reopenImportedRow()
    render(<GrpcRequestPane />)
    expect(screen.getByTestId('grpc-execute')).toBeInTheDocument()
    expect(screen.getByTestId('grpc-execute')).toBeEnabled()
    expect(loadProtoFromUrl).not.toHaveBeenCalled()
    cleanup()
  })

  it('Send downloads the definition and calls the imported method', async () => {
    const { loadProtoFromUrl, execute } = bridge()
    reopenImportedRow()
    await useGrpcStore.getState().execute()
    expect(loadProtoFromUrl).toHaveBeenCalledWith(URL)
    expect(execute.mock.calls[0][0]).toMatchObject({
      serviceName: 'a.Greeter',
      methodName: 'Second',
    })
    expect(useGrpcStore.getState().protoLoaded).toBe(true)
  })

  it('a row with no method yet keeps its Load button as the way in', () => {
    bridge()
    restoreProtocolFromMetadata('grpc', {
      grpc: { address: 'x.test:1', protoSource: 'url', protoUrl: URL, protoPath: null },
    })
    render(<GrpcRequestPane />)
    expect(screen.queryByTestId('grpc-execute')).toBeNull()
    cleanup()
  })
})

describe('what Send leaves alone', () => {
  const ready = {
    address: 'x.test:1',
    services: [
      {
        name: 'a.Greeter',
        methods: [{ name: 'Second', type: 'unary' as const, requestType: '', responseType: '' }],
      },
    ],
    selectedService: 'a.Greeter',
    selectedMethod: 'Second',
  }

  it('a URL row that has its file', async () => {
    const { loadProtoFromUrl, execute } = bridge()
    useGrpcStore.setState({ ...ready, protoSource: 'url', protoUrl: URL, protoPath: '/p.proto' })
    await useGrpcStore.getState().execute()
    expect(loadProtoFromUrl).not.toHaveBeenCalled()
    expect(execute.mock.calls[0][0]).toMatchObject({ protoPath: '/p.proto' })
  })

  it('a file row with no file', async () => {
    const { loadProtoFromUrl, execute } = bridge()
    useGrpcStore.setState({ ...ready, protoSource: 'file', protoUrl: URL, protoPath: null })
    await useGrpcStore.getState().execute()
    expect(loadProtoFromUrl).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
