import { create } from 'zustand'
import type { KeyValuePair, ApiResponse } from '../types'
import { useResponseStore } from './response.store'
import { useTabsStore } from './tabs.store'
import { useEnvironmentStore } from './environment.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'

function makeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
}

/**
 * Normalizes a user-entered server address to the `host:port` form expected by
 * `@grpc/grpc-js` (which rejects URLs with schemes like `grpc://` or `https://`).
 *
 * Accepts: `host`, `host:port`, `grpc://host`, `grpcs://host:port`,
 * `http://host`, `https://host:port` — strips the scheme. If no port is
 * present, defaults to `443` when `useTls` is true, else `80`.
 *
 * Returned value is safe to pass directly as the `serverAddress` argument
 * to `grpc.Client`. Exported (separately from the store) so it can be unit
 * tested without standing up Zustand / Electron.
 */
/**
 * Strips a leading URL scheme (`grpc://`, `grpcs://`, `http://`, `https://`)
 * from the user-entered address. Does NOT add a default port — that happens in
 * `normalizeGrpcAddress` at send time, since the user may still be typing.
 *
 * Used by `setAddress` so a paste like `grpc://demo.connectrpc.com` shows up
 * in the input as `demo.connectrpc.com` immediately.
 */
export function stripGrpcScheme(input: string): string {
  return (input ?? '').replace(/^(grpcs?|https?):\/\//i, '')
}

export function normalizeGrpcAddress(input: string, useTls: boolean): string {
  let s = (input ?? '').trim()
  if (!s) return ''
  // Strip any of the known schemes — even an `https://` paste should work.
  s = s.replace(/^(grpcs?|https?):\/\//i, '')
  // Drop any path/query the user might have copied in.
  const slashIdx = s.indexOf('/')
  if (slashIdx >= 0) s = s.slice(0, slashIdx)
  if (!s) return ''
  // If there's no explicit port, append the TLS default (443) or plaintext default (80).
  // Detect IPv6 [::1]:port vs ipv6 without port etc — keep it simple: if there's a `:` after
  // the last `]` or anywhere when no `[` present, we treat that as a port.
  const hasPort = s.includes(']')
    ? /]:\d+$/.test(s)
    : /:\d+$/.test(s)
  if (!hasPort) {
    s = `${s}:${useTls ? 443 : 80}`
  }
  return s
}

/**
 * Maps the user-facing GrpcMethodType to the IPC dispatch channel.
 * Pure helper so the dispatch logic can be unit-tested in isolation.
 */
export function dispatchChannelFor(type: GrpcMethodType): 'execute' | 'serverStream' | 'clientStream' | 'bidiStream' {
  switch (type) {
    case 'server_streaming': return 'serverStream'
    case 'client_streaming': return 'clientStream'
    case 'bidi_streaming':   return 'bidiStream'
    default:                  return 'execute'
  }
}

/** Mirrors the engine's `GrpcResponse` (kept loose to avoid a main-process import). */
interface GrpcEngineResponse {
  requestId: string
  protocol: 'grpc'
  body?: string
  bodySize?: number
  timing: { total: number }
  error?: string
  grpcStatus?: number
  grpcStatusMessage?: string
  responseMetadata?: Record<string, string>
  actualRequest?: { method: string; url: string; headers: Record<string, string>; body?: string }
}

/** Mirrors the engine's `GrpcStreamEvent` payload. */
interface GrpcStreamPayload {
  streamId: string
  type: 'data' | 'end' | 'error' | 'status'
  data?: string
  error?: string
  grpcStatus?: number
  grpcStatusMessage?: string
  timestamp: number
}

/** Shape of `window.api.grpc` we depend on. Kept narrow to the methods we call. */
interface GrpcBridge {
  execute: (options: unknown) => Promise<{ success: boolean; data?: GrpcEngineResponse; error?: string }>
  serverStream: (options: unknown) => Promise<{ success: boolean; data?: { streamId: string }; error?: string }>
  clientStream: (options: unknown) => Promise<{ success: boolean; data?: GrpcEngineResponse; error?: string }>
  bidiStream: (options: unknown) => Promise<{ success: boolean; data?: { streamId: string }; error?: string }>
  sendStreamMessage: (streamId: string, message: unknown) => Promise<unknown>
  cancelStream: (streamId: string) => Promise<unknown>
  onStreamEvent: (cb: (event: GrpcStreamPayload) => void) => () => void
}

interface EngineMethodInfo {
  name: string
  requestType: string
  responseType: string
  requestStream: boolean
  responseStream: boolean
  requestSkeleton?: string
}

interface EngineServiceInfo {
  name: string
  fullName: string
  methods: EngineMethodInfo[]
}

interface EngineLoadProtoResult {
  protoPath: string
  packageName: string
  services: EngineServiceInfo[]
}

/**
 * Translate `loadProto`'s engine output (which describes streaming via
 * `requestStream`/`responseStream` booleans) into the renderer store's
 * GrpcService shape (which uses the `type` enum). Pure helper, exported for tests.
 */
export function mapEngineServices(result: EngineLoadProtoResult): GrpcService[] {
  return (result.services ?? []).map((svc) => ({
    name: svc.fullName || svc.name,
    methods: (svc.methods ?? []).map((m) => ({
      name: m.name,
      requestType: m.requestType,
      responseType: m.responseType,
      type: streamingFlagsToType(m.requestStream, m.responseStream),
    })),
  }))
}

function streamingFlagsToType(reqStream: boolean, resStream: boolean): GrpcMethodType {
  if (reqStream && resStream) return 'bidi_streaming'
  if (reqStream) return 'client_streaming'
  if (resStream) return 'server_streaming'
  return 'unary'
}

/**
 * Translate the engine's GrpcResponse into the renderer's ApiResponse shape so
 * the standard ResponsePane can render it. gRPC status maps to `status` /
 * `statusText` for symmetry with HTTP responses.
 */
export function grpcResponseToApi(resp: GrpcEngineResponse): ApiResponse {
  return {
    requestId: resp.requestId,
    protocol: 'grpc',
    status: resp.grpcStatus,
    statusText: resp.grpcStatusMessage,
    headers: resp.responseMetadata,
    body: resp.body,
    bodySize: resp.bodySize,
    timing: resp.timing,
    error: resp.error,
    actualRequest: resp.actualRequest,
  }
}

// ─── gRPC types ──────────────────────────────────────────────

export type GrpcMethodType = 'unary' | 'server_streaming' | 'client_streaming' | 'bidi_streaming'

export interface GrpcMethod {
  name: string
  type: GrpcMethodType
  requestType: string
  responseType: string
}

export interface GrpcService {
  name: string
  methods: GrpcMethod[]
}

export interface GrpcStreamEvent {
  id: string
  data: string
  timestamp: number
  index: number
}

// ─── Store ───────────────────────────────────────────────────

interface GrpcStore {
  address: string
  useTls: boolean
  protoLoaded: boolean
  protoPath: string | null
  services: GrpcService[]
  selectedService: string | null
  selectedMethod: string | null

  requestBody: string
  metadata: KeyValuePair[]

  response: ApiResponse | null
  streamEvents: GrpcStreamEvent[]
  /** Active streamId for any in-flight server / bidi stream. */
  activeStreamId: string | null
  /** Disposer for the `grpc:streamEvent` listener (returned by `onStreamEvent`). */
  streamUnsubscribe: (() => void) | null
  isLoading: boolean
  isStreaming: boolean
  errorMessage: string | null

  setAddress: (address: string) => void
  setUseTls: (useTls: boolean) => void
  loadProto: () => Promise<void>
  selectService: (name: string) => void
  selectMethod: (name: string) => void
  setRequestBody: (body: string) => void
  addMetadata: () => void
  updateMetadata: (id: string, updates: Partial<KeyValuePair>) => void
  removeMetadata: (id: string) => void

  execute: () => Promise<void>
  cancelStream: () => Promise<void>

  getSelectedService: () => GrpcService | undefined
  getSelectedMethod: () => GrpcMethod | undefined

  reset: () => void
}

const DEFAULT_REQUEST = '{\n  \n}'

export const useGrpcStore = create<GrpcStore>((set, get) => ({
  address: 'localhost:50051',
  useTls: false,
  protoLoaded: false,
  protoPath: null,
  services: [],
  selectedService: null,
  selectedMethod: null,

  requestBody: DEFAULT_REQUEST,
  metadata: [defaultKv()],

  response: null,
  streamEvents: [],
  activeStreamId: null,
  streamUnsubscribe: null,
  isLoading: false,
  isStreaming: false,
  errorMessage: null,

  setAddress: (address) => set({ address: stripGrpcScheme(address) }),
  setUseTls: (useTls) => set({ useTls }),

  loadProto: async () => {
    set({ isLoading: true, errorMessage: null })

    const grpcApi = (window as unknown as { api?: { grpc?: GrpcBridge & { loadProto: () => Promise<{ success: boolean; data?: unknown; error?: string }> } } }).api?.grpc
    try {
      const result = grpcApi
        ? await grpcApi.loadProto()
        : null

      if (result?.success && result.data) {
        const services = mapEngineServices(result.data as EngineLoadProtoResult)
        const data = result.data as EngineLoadProtoResult
        set({
          services,
          protoPath: data.protoPath,
          protoLoaded: true,
          isLoading: false,
        })

        // Auto-select first service/method
        if (services.length > 0) {
          const svc = services[0]
          set({ selectedService: svc.name })
          if (svc.methods.length > 0) {
            set({ selectedMethod: svc.methods[0].name })
          }
        }
      } else if (result && !result.success) {
        set({
          errorMessage: result.error || 'Failed to load proto file',
          isLoading: false,
        })
      } else if (!grpcApi) {
        // No bridge (storybook / unit) → fall through to demo path.
        throw new Error('grpc bridge unavailable')
      } else {
        // result.data was null (user cancelled the file dialog).
        set({ isLoading: false })
      }
    } catch {
      // Demo mode: generate sample services
      const demoServices: GrpcService[] = [
        {
          name: 'greeter.GreeterService',
          methods: [
            { name: 'SayHello', type: 'unary', requestType: 'HelloRequest', responseType: 'HelloReply' },
            { name: 'SayHelloServerStream', type: 'server_streaming', requestType: 'HelloRequest', responseType: 'HelloReply' },
            { name: 'SayHelloClientStream', type: 'client_streaming', requestType: 'HelloRequest', responseType: 'HelloReply' },
            { name: 'SayHelloBidi', type: 'bidi_streaming', requestType: 'HelloRequest', responseType: 'HelloReply' },
          ],
        },
        {
          name: 'user.UserService',
          methods: [
            { name: 'GetUser', type: 'unary', requestType: 'GetUserRequest', responseType: 'User' },
            { name: 'ListUsers', type: 'server_streaming', requestType: 'ListUsersRequest', responseType: 'User' },
          ],
        },
      ]

      set({
        services: demoServices,
        protoPath: '/demo/greeter.proto',
        protoLoaded: true,
        isLoading: false,
        selectedService: demoServices[0].name,
        selectedMethod: demoServices[0].methods[0].name,
      })
    }
  },

  selectService: (name) => {
    const svc = get().services.find((s) => s.name === name)
    set({ selectedService: name, selectedMethod: null })
    if (svc && svc.methods.length > 0) {
      set({ selectedMethod: svc.methods[0].name })
    }
  },

  selectMethod: (name) => set({ selectedMethod: name }),

  setRequestBody: (body) => set({ requestBody: body }),

  addMetadata: () =>
    set((state) => ({ metadata: [...state.metadata, defaultKv()] })),

  updateMetadata: (id, updates) =>
    set((state) => ({
      metadata: state.metadata.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),

  removeMetadata: (id) =>
    set((state) => ({ metadata: state.metadata.filter((m) => m.id !== id) })),

  execute: async () => {
    const { address, useTls, selectedService, selectedMethod, requestBody, metadata, protoPath } = get()
    if (!address.trim() || !selectedService || !selectedMethod) return

    const method = get().getSelectedMethod()
    const isStream = method?.type !== 'unary'

    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const activeTabId = tabsStore.activeTabId

    // Tear down any prior stream subscription before starting a new call.
    const prevUnsub = get().streamUnsubscribe
    if (prevUnsub) prevUnsub()

    set({
      isLoading: true,
      errorMessage: null,
      response: null,
      streamEvents: [],
      activeStreamId: null,
      streamUnsubscribe: null,
    })
    if (isStream) set({ isStreaming: true })
    responseStore.setLoading(true)
    responseStore.clearResponse()
    if (activeTabId) tabsStore.markLoading(activeTabId, true)

    const activeVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedAddress = resolveVariables(address, activeVars)
    const resolvedBody = resolveVariables(requestBody, activeVars)
    const resolvedMetadata = resolveKeyValuePairs(
      metadata.filter((m) => m.enabled && m.key.trim()),
      activeVars,
    )

    const serverAddress = normalizeGrpcAddress(resolvedAddress, useTls)
    const metadataMap: Record<string, string> = {}
    for (const m of resolvedMetadata) metadataMap[m.key] = m.value

    const grpcApi = (window as unknown as { api?: { grpc?: GrpcBridge } }).api?.grpc
    if (!grpcApi) {
      const errResp: ApiResponse = {
        requestId: makeId(),
        protocol: 'grpc',
        error: 'gRPC bridge unavailable',
        timing: { total: 0 },
      }
      set({ response: errResp, isLoading: false, isStreaming: false, errorMessage: errResp.error ?? null })
      responseStore.setResponse(errResp)
      responseStore.setLoading(false)
      if (activeTabId) tabsStore.markLoading(activeTabId, false)
      return
    }

    const baseOptions = {
      serverAddress,
      protoPath: protoPath ?? '',
      serviceName: selectedService,
      methodName: selectedMethod,
      metadata: metadataMap,
      useTls,
    }

    const finishUnary = (apiResp: ApiResponse): void => {
      set({ response: apiResp, isLoading: false })
      responseStore.setResponse(apiResp)
      responseStore.setLoading(false)
      if (activeTabId) tabsStore.markLoading(activeTabId, false)
    }

    try {
      if (method?.type === 'unary') {
        const result = await grpcApi.execute({ ...baseOptions, requestBody: resolvedBody }) as
          | { success: true; data: GrpcEngineResponse }
          | { success: false; error: string }

        if (result.success) {
          finishUnary(grpcResponseToApi(result.data))
        } else {
          finishUnary({
            requestId: makeId(),
            protocol: 'grpc',
            error: result.error || 'gRPC call failed',
            timing: { total: 0 },
          })
        }
        return
      }

      // Streaming paths — subscribe before invoking so 'data' events that arrive
      // before our await resolves are not lost.
      const unsubscribe = grpcApi.onStreamEvent((evt: GrpcStreamPayload) => {
        const expected = get().activeStreamId
        if (expected && evt.streamId !== expected) return
        if (evt.type === 'data' && evt.data) {
          set((s) => ({
            streamEvents: [
              ...s.streamEvents,
              { id: makeId(), data: evt.data!, timestamp: evt.timestamp, index: s.streamEvents.length },
            ],
          }))
        } else if (evt.type === 'end') {
          set({ isStreaming: false, isLoading: false, activeStreamId: null })
          responseStore.setLoading(false)
          if (activeTabId) tabsStore.markLoading(activeTabId, false)
        } else if (evt.type === 'error') {
          set({
            isStreaming: false,
            isLoading: false,
            errorMessage: evt.error ?? 'gRPC stream error',
            activeStreamId: null,
          })
          responseStore.setLoading(false)
          if (activeTabId) tabsStore.markLoading(activeTabId, false)
        }
      })
      set({ streamUnsubscribe: unsubscribe })

      if (method?.type === 'server_streaming') {
        const result = await grpcApi.serverStream({ ...baseOptions, requestBody: resolvedBody }) as
          | { success: true; data: { streamId: string } }
          | { success: false; error: string }
        if (result.success) {
          set({ activeStreamId: result.data.streamId })
        } else {
          set({ isStreaming: false, isLoading: false, errorMessage: result.error })
        }
      } else if (method?.type === 'client_streaming') {
        // Single message for now — the UI doesn't yet expose multi-message client streaming.
        const result = await grpcApi.clientStream({ ...baseOptions, messages: [resolvedBody] }) as
          | { success: true; data: GrpcEngineResponse }
          | { success: false; error: string }
        if (result.success) {
          finishUnary(grpcResponseToApi(result.data))
        } else {
          finishUnary({
            requestId: makeId(),
            protocol: 'grpc',
            error: result.error || 'gRPC client-stream failed',
            timing: { total: 0 },
          })
        }
      } else if (method?.type === 'bidi_streaming') {
        const result = await grpcApi.bidiStream(baseOptions) as
          | { success: true; data: { streamId: string } }
          | { success: false; error: string }
        if (result.success) {
          set({ activeStreamId: result.data.streamId })
          // Push the initial message immediately if the user typed one.
          if (resolvedBody.trim() && resolvedBody.trim() !== '{}') {
            await grpcApi.sendStreamMessage(result.data.streamId, resolvedBody).catch(() => {})
          }
        } else {
          set({ isStreaming: false, isLoading: false, errorMessage: result.error })
        }
      }
    } catch (err) {
      const errResp: ApiResponse = {
        requestId: makeId(),
        protocol: 'grpc',
        error: (err as Error).message,
        timing: { total: 0 },
      }
      set({ response: errResp, isLoading: false, isStreaming: false, errorMessage: errResp.error ?? null })
      responseStore.setResponse(errResp)
      responseStore.setLoading(false)
      if (activeTabId) tabsStore.markLoading(activeTabId, false)
    }
  },

  cancelStream: async () => {
    const { activeStreamId, streamUnsubscribe } = get()
    set({ isStreaming: false, isLoading: false })
    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const activeTabId = tabsStore.activeTabId
    responseStore.setLoading(false)
    if (activeTabId) tabsStore.markLoading(activeTabId, false)

    const grpcApi = (window as unknown as { api?: { grpc?: GrpcBridge } }).api?.grpc
    try {
      if (activeStreamId && grpcApi) {
        await grpcApi.cancelStream(activeStreamId)
      }
    } catch {
      // Ignore — cancellation is best-effort.
    } finally {
      if (streamUnsubscribe) streamUnsubscribe()
      set({ activeStreamId: null, streamUnsubscribe: null })
    }
  },

  getSelectedService: () => {
    const { services, selectedService } = get()
    return services.find((s) => s.name === selectedService)
  },

  getSelectedMethod: () => {
    const svc = get().getSelectedService()
    return svc?.methods.find((m) => m.name === get().selectedMethod)
  },

  reset: () => {
    const prev = get().streamUnsubscribe
    if (prev) prev()
    set({
      address: 'localhost:50051',
      useTls: false,
      protoLoaded: false,
      protoPath: null,
      services: [],
      selectedService: null,
      selectedMethod: null,
      requestBody: DEFAULT_REQUEST,
      metadata: [defaultKv()],
      response: null,
      streamEvents: [],
      activeStreamId: null,
      streamUnsubscribe: null,
      isLoading: false,
      isStreaming: false,
      errorMessage: null,
    })
  },
}))
