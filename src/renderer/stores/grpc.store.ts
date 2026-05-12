import { create } from 'zustand'
import type { KeyValuePair, ApiResponse } from '../types'
import { useResponseStore } from './response.store'
import { useTabsStore } from './tabs.store'
import { useWorkspaceStore } from './workspace.store'
import { useEnvironmentStore } from './environment.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'

function makeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
}

/**
 * Strips a leading URL scheme (`grpc://`, `grpcs://`, `http://`, `https://`)
 * from the user-entered address. Does NOT add a default port — that happens in
 * `normalizeGrpcAddress` at send time, since the user may still be typing.
 */
export function stripGrpcScheme(input: string): string {
  return (input ?? '').replace(/^(grpcs?|https?):\/\//i, '')
}

export function normalizeGrpcAddress(input: string, useTls: boolean): string {
  let s = (input ?? '').trim()
  if (!s) return ''
  s = s.replace(/^(grpcs?|https?):\/\//i, '')
  const slashIdx = s.indexOf('/')
  if (slashIdx >= 0) s = s.slice(0, slashIdx)
  if (!s) return ''
  const hasPort = s.includes(']') ? /]:\d+$/.test(s) : /:\d+$/.test(s)
  if (!hasPort) {
    s = `${s}:${useTls ? 443 : 80}`
  }
  return s
}

/**
 * Maps the user-facing GrpcMethodType to the IPC dispatch channel.
 */
export function dispatchChannelFor(
  type: GrpcMethodType,
): 'execute' | 'serverStream' | 'clientStream' | 'bidiStream' {
  switch (type) {
    case 'server_streaming':
      return 'serverStream'
    case 'client_streaming':
      return 'clientStream'
    case 'bidi_streaming':
      return 'bidiStream'
    default:
      return 'execute'
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
  execute: (
    options: unknown,
  ) => Promise<{ success: boolean; data?: GrpcEngineResponse; error?: string }>
  serverStream: (
    options: unknown,
  ) => Promise<{ success: boolean; data?: { streamId: string }; error?: string }>
  clientStream: (
    options: unknown,
  ) => Promise<{ success: boolean; data?: GrpcEngineResponse; error?: string }>
  bidiStream: (
    options: unknown,
  ) => Promise<{ success: boolean; data?: { streamId: string }; error?: string }>
  sendStreamMessage: (streamId: string, message: unknown) => Promise<unknown>
  endStream: (streamId: string) => Promise<unknown>
  cancelStream: (streamId: string) => Promise<unknown>
  cancelUnary: (requestId: string) => Promise<unknown>
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

// ─── Per-tab state shape ─────────────────────────────────────

/**
 * Snapshot of gRPC state for per-tab caching. `services` is per-tab too —
 * each tab can load its own .proto file without overwriting siblings.
 */
export type ProtoSource = 'reflection' | 'url' | 'file'

interface TabGrpcState {
  address: string
  useTls: boolean
  protoSource: ProtoSource
  protoUrl: string
  protoLoaded: boolean
  protoPath: string | null
  services: GrpcService[]
  selectedService: string | null
  selectedMethod: string | null
  requestBody: string
  metadata: KeyValuePair[]
  response: ApiResponse | null
  streamEvents: GrpcStreamEvent[]
  activeStreamId: string | null
  /** Per-tab disposer for the `grpc:streamEvent` listener. */
  streamUnsubscribe: (() => void) | null
  isLoading: boolean
  isStreaming: boolean
  /**
   * True after the user clicks End Streaming on a client/bidi RPC. The
   * client side is half-closed (no more writes allowed) but the server may
   * still push events (bidi) or deliver the unary response (client_streaming).
   * Send / End buttons gate on this so we don't write-after-end or call
   * `.end()` twice.
   */
  halfClosed: boolean
  errorMessage: string | null
  /**
   * Renderer-side id for an in-flight unary call. Set when `execute()` fires
   * a unary method; the `cancelUnary` action uses it to call
   * `grpc:cancelUnary` on the main process so the user can abort a stalled
   * deadline (e.g. unreachable server).
   */
  _unaryRequestId: string | null
}

// ─── Store ───────────────────────────────────────────────────

interface GrpcStore extends TabGrpcState {
  /** Per-tab state cache */
  _tabStates: Map<string, TabGrpcState>
  _currentTabId: string | null

  setAddress: (address: string) => void
  setUseTls: (useTls: boolean) => void
  setProtoSource: (source: ProtoSource) => void
  setProtoUrl: (url: string) => void
  loadProto: () => Promise<void>
  loadProtoFromUrl: () => Promise<void>
  loadFromReflection: () => Promise<void>
  selectService: (name: string) => void
  selectMethod: (name: string) => void
  setRequestBody: (body: string) => void
  addMetadata: () => void
  updateMetadata: (id: string, updates: Partial<KeyValuePair>) => void
  removeMetadata: (id: string) => void

  execute: () => Promise<void>
  /**
   * Push another message into the active client/bidi stream. No-op if no
   * stream is active (i.e. unary or server-streaming methods, or the stream
   * already ended).
   */
  sendStreamMessage: () => Promise<void>
  /** Half-close the client-side of an active client/bidi stream. */
  endClientStream: () => Promise<void>
  cancelStream: () => Promise<void>
  /** Abort an in-flight unary call. No-op when no unary call is in flight. */
  cancelUnary: () => Promise<void>

  getSelectedService: () => GrpcService | undefined
  getSelectedMethod: () => GrpcMethod | undefined

  /** Switch active tab — saves current state and loads target tab state. */
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab. Tears down any stream subscription. */
  removeTabState: (tabId: string) => void

  reset: () => void
}

const DEFAULT_REQUEST = '{\n  \n}'

function emptyTabState(): TabGrpcState {
  return {
    address: 'localhost:50051',
    useTls: false,
    protoSource: 'reflection',
    protoUrl: '',
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
    halfClosed: false,
    errorMessage: null,
    _unaryRequestId: null,
  }
}

function extractState(s: GrpcStore): TabGrpcState {
  return {
    address: s.address,
    useTls: s.useTls,
    protoSource: s.protoSource,
    protoUrl: s.protoUrl,
    protoLoaded: s.protoLoaded,
    protoPath: s.protoPath,
    services: s.services,
    selectedService: s.selectedService,
    selectedMethod: s.selectedMethod,
    requestBody: s.requestBody,
    metadata: s.metadata,
    response: s.response,
    streamEvents: s.streamEvents,
    activeStreamId: s.activeStreamId,
    streamUnsubscribe: s.streamUnsubscribe,
    isLoading: s.isLoading,
    isStreaming: s.isStreaming,
    halfClosed: s.halfClosed,
    errorMessage: s.errorMessage,
    _unaryRequestId: s._unaryRequestId,
  }
}

const STORAGE_KEY = 'testnizer-grpc'
const persisted = loadTabbedState<TabGrpcState>(STORAGE_KEY, emptyTabState)

export const useGrpcStore = create<GrpcStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,

  setAddress: (address) => set({ address: stripGrpcScheme(address) }),
  setUseTls: (useTls) => set({ useTls }),
  setProtoSource: (protoSource) => set({ protoSource }),
  setProtoUrl: (protoUrl) => set({ protoUrl }),

  loadProto: async () => {
    set({ isLoading: true, errorMessage: null })

    const grpcApi = (
      window as unknown as {
        api?: {
          grpc?: GrpcBridge & {
            loadProto: () => Promise<{ success: boolean; data?: unknown; error?: string }>
          }
        }
      }
    ).api?.grpc
    try {
      const result = grpcApi ? await grpcApi.loadProto() : null

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
            {
              name: 'SayHello',
              type: 'unary',
              requestType: 'HelloRequest',
              responseType: 'HelloReply',
            },
            {
              name: 'SayHelloServerStream',
              type: 'server_streaming',
              requestType: 'HelloRequest',
              responseType: 'HelloReply',
            },
            {
              name: 'SayHelloClientStream',
              type: 'client_streaming',
              requestType: 'HelloRequest',
              responseType: 'HelloReply',
            },
            {
              name: 'SayHelloBidi',
              type: 'bidi_streaming',
              requestType: 'HelloRequest',
              responseType: 'HelloReply',
            },
          ],
        },
        {
          name: 'user.UserService',
          methods: [
            { name: 'GetUser', type: 'unary', requestType: 'GetUserRequest', responseType: 'User' },
            {
              name: 'ListUsers',
              type: 'server_streaming',
              requestType: 'ListUsersRequest',
              responseType: 'User',
            },
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

  loadProtoFromUrl: async () => {
    const { protoUrl } = get()
    if (!protoUrl.trim()) {
      set({ errorMessage: 'URL is required' })
      return
    }
    set({ isLoading: true, errorMessage: null })

    const grpcApi = (
      window as unknown as {
        api?: {
          grpc?: {
            loadProtoFromUrl?: (
              url: string,
            ) => Promise<{ success: boolean; data?: unknown; error?: string }>
          }
        }
      }
    ).api?.grpc
    if (!grpcApi?.loadProtoFromUrl) {
      set({ isLoading: false, errorMessage: 'gRPC bridge not available' })
      return
    }
    const result = await grpcApi.loadProtoFromUrl(protoUrl.trim())
    if (result.success && result.data) {
      const data = result.data as EngineLoadProtoResult
      const services = mapEngineServices(data)
      set({
        services,
        protoPath: data.protoPath,
        protoLoaded: true,
        isLoading: false,
        errorMessage: null,
      })
      if (services.length > 0) {
        const svc = services[0]
        set({ selectedService: svc.name })
        if (svc.methods.length > 0) set({ selectedMethod: svc.methods[0].name })
      }
    } else {
      set({
        errorMessage: result.error || 'Failed to download proto from URL',
        isLoading: false,
      })
    }
  },

  loadFromReflection: async () => {
    const { address, useTls } = get()
    if (!address.trim()) {
      set({ errorMessage: 'Server address is required' })
      return
    }
    set({ isLoading: true, errorMessage: null })

    const grpcApi = (
      window as unknown as {
        api?: {
          grpc?: {
            reflect?: (
              addr: string,
              useTls?: boolean,
            ) => Promise<{ success: boolean; data?: unknown; error?: string }>
          }
        }
      }
    ).api?.grpc
    if (!grpcApi?.reflect) {
      set({ isLoading: false, errorMessage: 'gRPC bridge not available' })
      return
    }
    const result = await grpcApi.reflect(address.trim(), useTls)
    if (result.success && result.data) {
      const data = result.data as EngineLoadProtoResult
      const services = mapEngineServices(data)
      set({
        services,
        protoPath: data.protoPath,
        protoLoaded: true,
        isLoading: false,
        errorMessage: null,
      })
      if (services.length > 0) {
        const svc = services[0]
        set({ selectedService: svc.name })
        if (svc.methods.length > 0) set({ selectedMethod: svc.methods[0].name })
      }
    } else {
      set({
        errorMessage: result.error || 'Server reflection failed',
        isLoading: false,
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

  addMetadata: () => set((state) => ({ metadata: [...state.metadata, defaultKv()] })),

  updateMetadata: (id, updates) =>
    set((state) => ({
      metadata: state.metadata.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),

  removeMetadata: (id) => set((state) => ({ metadata: state.metadata.filter((m) => m.id !== id) })),

  execute: async () => {
    const { address, useTls, selectedService, selectedMethod, requestBody, metadata, protoPath } =
      get()
    if (!address.trim() || !selectedService || !selectedMethod) return

    const method = get().getSelectedMethod()
    const isStream = method?.type !== 'unary'

    // ── Streaming send-multiple branch ──
    // If a client/bidi stream is already open and the user clicked Send again,
    // forward the new payload over the same stream instead of starting over.
    // This matches Postman's behaviour and is the only way to feed multiple
    // messages into a single client/bidi RPC. Skipped once the user has
    // half-closed the stream — at that point Send must be a no-op (or open a
    // fresh call) since writing after `.end()` raises ERR_STREAM_WRITE_AFTER_END.
    const existingStreamId = get().activeStreamId
    if (
      existingStreamId &&
      !get().halfClosed &&
      (method?.type === 'client_streaming' || method?.type === 'bidi_streaming')
    ) {
      await get().sendStreamMessage()
      return
    }

    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const activeTabId = tabsStore.activeTabId

    // Tear down any prior stream subscription before starting a new call.
    const prevUnsub = get().streamUnsubscribe
    if (prevUnsub) prevUnsub()

    // Owner tab — stream events for this call always route into this tab's
    // state (live or cached).
    const ownerTabId = get()._currentTabId

    set({
      isLoading: true,
      errorMessage: null,
      response: null,
      streamEvents: [],
      activeStreamId: null,
      streamUnsubscribe: null,
      halfClosed: false,
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
      set({
        response: errResp,
        isLoading: false,
        isStreaming: false,
        errorMessage: errResp.error ?? null,
      })
      responseStore.setResponse(errResp)
      responseStore.setLoading(false)
      if (activeTabId) tabsStore.markLoading(activeTabId, false)
      return
    }

    const ws = useWorkspaceStore.getState()
    const baseOptions = {
      serverAddress,
      protoPath: protoPath ?? '',
      serviceName: selectedService,
      methodName: selectedMethod,
      metadata: metadataMap,
      useTls,
      _workspaceId: ws.activeWorkspaceId || undefined,
      _projectId: ws.activeProjectId || undefined,
    }

    // Helper that writes a partial state into the owning tab — either live
    // or cached, depending on which tab is currently active.
    const applyToOwner = (patch: Partial<TabGrpcState>): void => {
      const current = get()
      if (current._currentTabId === ownerTabId) {
        set(patch as Partial<GrpcStore>)
      } else if (ownerTabId !== null) {
        const map = new Map(current._tabStates)
        const existing = map.get(ownerTabId) ?? emptyTabState()
        map.set(ownerTabId, { ...existing, ...patch })
        set({ _tabStates: map })
      }
    }

    const appendStreamEventToOwner = (evt: GrpcStreamEvent): void => {
      const current = get()
      if (current._currentTabId === ownerTabId) {
        set((s) => ({
          streamEvents: [...s.streamEvents, { ...evt, index: s.streamEvents.length }],
        }))
      } else if (ownerTabId !== null) {
        const map = new Map(current._tabStates)
        const existing = map.get(ownerTabId) ?? emptyTabState()
        map.set(ownerTabId, {
          ...existing,
          streamEvents: [...existing.streamEvents, { ...evt, index: existing.streamEvents.length }],
        })
        set({ _tabStates: map })
      }
    }

    const getOwnerActiveStreamId = (): string | null => {
      const current = get()
      if (current._currentTabId === ownerTabId) return current.activeStreamId
      if (ownerTabId !== null) {
        return current._tabStates.get(ownerTabId)?.activeStreamId ?? null
      }
      return current.activeStreamId
    }

    const finishUnary = (apiResp: ApiResponse): void => {
      applyToOwner({ response: apiResp, isLoading: false })
      // Only push into the global response pane if THIS tab is currently
      // active — otherwise the user is looking at another tab's response.
      const current = get()
      if (current._currentTabId === ownerTabId) {
        responseStore.setResponse(apiResp)
        responseStore.setLoading(false)
        if (activeTabId) tabsStore.markLoading(activeTabId, false)
      }
    }

    try {
      if (method?.type === 'unary') {
        const unaryRequestId = makeId()
        applyToOwner({ _unaryRequestId: unaryRequestId })
        try {
          const result = (await grpcApi.execute({
            ...baseOptions,
            requestBody: resolvedBody,
            _requestId: unaryRequestId,
          })) as { success: true; data: GrpcEngineResponse } | { success: false; error: string }

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
        } finally {
          // Clear the id whether the call resolved, errored, or was cancelled,
          // so a follow-up cancelUnary() doesn't fire against a stale id.
          applyToOwner({ _unaryRequestId: null })
        }
        return
      }

      // Streaming paths — subscribe before invoking so 'data' events that arrive
      // before our await resolves are not lost.
      const unsubscribe = grpcApi.onStreamEvent((evt: GrpcStreamPayload) => {
        const expected = getOwnerActiveStreamId()
        if (expected && evt.streamId !== expected) return
        if (evt.type === 'data' && evt.data) {
          appendStreamEventToOwner({
            id: makeId(),
            data: evt.data,
            timestamp: evt.timestamp,
            index: 0, // overwritten by appendStreamEventToOwner
          })
        } else if (evt.type === 'end') {
          applyToOwner({
            isStreaming: false,
            isLoading: false,
            activeStreamId: null,
            halfClosed: false,
          })
          const cur = get()
          if (cur._currentTabId === ownerTabId) {
            responseStore.setLoading(false)
            if (activeTabId) tabsStore.markLoading(activeTabId, false)
          }
        } else if (evt.type === 'error') {
          applyToOwner({
            isStreaming: false,
            isLoading: false,
            errorMessage: evt.error ?? 'gRPC stream error',
            activeStreamId: null,
            halfClosed: false,
          })
          const cur = get()
          if (cur._currentTabId === ownerTabId) {
            responseStore.setLoading(false)
            if (activeTabId) tabsStore.markLoading(activeTabId, false)
          }
        }
      })
      applyToOwner({ streamUnsubscribe: unsubscribe })

      if (method?.type === 'server_streaming') {
        const result = (await grpcApi.serverStream({
          ...baseOptions,
          requestBody: resolvedBody,
        })) as { success: true; data: { streamId: string } } | { success: false; error: string }
        if (result.success) {
          applyToOwner({ activeStreamId: result.data.streamId })
        } else {
          applyToOwner({ isStreaming: false, isLoading: false, errorMessage: result.error })
        }
      } else if (method?.type === 'client_streaming') {
        // Reuse the bidi IPC channel — the engine branches on `responseStream`
        // and uses grpc-js's writable-stream + unary-callback shape, which is
        // what client_streaming actually requires. The single response is
        // surfaced as a synthetic 'data' + 'end' event so this listener and
        // the renderer pipeline don't need to know which method type ran.
        const result = (await grpcApi.bidiStream({
          ...(baseOptions as Record<string, unknown>),
          responseStream: false,
        })) as { success: true; data: { streamId: string } } | { success: false; error: string }
        if (result.success) {
          applyToOwner({ activeStreamId: result.data.streamId })
          if (resolvedBody.trim() && resolvedBody.trim() !== '{}') {
            await grpcApi.sendStreamMessage(result.data.streamId, resolvedBody).catch(() => {})
          }
        } else {
          applyToOwner({ isStreaming: false, isLoading: false, errorMessage: result.error })
        }
      } else if (method?.type === 'bidi_streaming') {
        const result = (await grpcApi.bidiStream({
          ...(baseOptions as Record<string, unknown>),
          responseStream: true,
        })) as { success: true; data: { streamId: string } } | { success: false; error: string }
        if (result.success) {
          applyToOwner({ activeStreamId: result.data.streamId })
          // Push the initial message immediately if the user typed one.
          if (resolvedBody.trim() && resolvedBody.trim() !== '{}') {
            await grpcApi.sendStreamMessage(result.data.streamId, resolvedBody).catch(() => {})
          }
        } else {
          applyToOwner({ isStreaming: false, isLoading: false, errorMessage: result.error })
        }
      }
    } catch (err) {
      const errResp: ApiResponse = {
        requestId: makeId(),
        protocol: 'grpc',
        error: (err as Error).message,
        timing: { total: 0 },
      }
      applyToOwner({
        response: errResp,
        isLoading: false,
        isStreaming: false,
        errorMessage: errResp.error ?? null,
      })
      const cur = get()
      if (cur._currentTabId === ownerTabId) {
        responseStore.setResponse(errResp)
        responseStore.setLoading(false)
        if (activeTabId) tabsStore.markLoading(activeTabId, false)
      }
    }
  },

  /**
   * Push the current `requestBody` as another message into the active stream.
   * Used by client_streaming + bidi_streaming methods after the stream is
   * already open. For unary / server-streaming this is a no-op.
   */
  sendStreamMessage: async () => {
    const { activeStreamId, requestBody, halfClosed } = get()
    if (!activeStreamId) return
    // Refuse to write after the user has half-closed the stream — Node's
    // Writable would emit ERR_STREAM_WRITE_AFTER_END here and the user would
    // see only an opaque error.
    if (halfClosed) return
    const grpcApi = (window as unknown as { api?: { grpc?: GrpcBridge } }).api?.grpc
    if (!grpcApi) return
    const activeVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedBody = resolveVariables(requestBody, activeVars)
    try {
      await grpcApi.sendStreamMessage(activeStreamId, resolvedBody)
    } catch (err) {
      set({ errorMessage: (err as Error).message })
    }
  },

  /**
   * Half-close the client side of an active client/bidi stream so the server
   * can finish responding. Server stream events will continue to arrive (for
   * bidi) until the server closes its side.
   */
  endClientStream: async () => {
    const { activeStreamId, halfClosed } = get()
    if (!activeStreamId) return
    // Idempotent — ignore double clicks. Without this the second `.end()`
    // call on grpc-js's writable can emit a transport-level error.
    if (halfClosed) return
    const grpcApi = (window as unknown as { api?: { grpc?: GrpcBridge } }).api?.grpc
    if (!grpcApi) return
    try {
      await grpcApi.endStream(activeStreamId)
      // Stay subscribed to the receive side: bidi server can still push,
      // and client_streaming's unary response is still pending. We just
      // block further writes until the stream actually closes.
      set({ halfClosed: true })
    } catch (err) {
      set({ errorMessage: (err as Error).message })
    }
  },

  cancelStream: async () => {
    const { activeStreamId, streamUnsubscribe } = get()
    set({ isStreaming: false, isLoading: false, halfClosed: false })
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

  cancelUnary: async () => {
    const id = get()._unaryRequestId
    if (!id) return
    const grpcApi = (window as unknown as { api?: { grpc?: GrpcBridge } }).api?.grpc
    try {
      if (grpcApi) await grpcApi.cancelUnary(id)
    } catch {
      // Best-effort — the engine may have already finished.
    }
    // The execute() try/finally clears _unaryRequestId, but if the request
    // already finished without us catching the resolution (race), clear here
    // defensively so the UI flips back to "Send".
    set({ _unaryRequestId: null })
  },

  getSelectedService: () => {
    const { services, selectedService } = get()
    return services.find((s) => s.name === selectedService)
  },

  getSelectedMethod: () => {
    const svc = get().getSelectedService()
    return svc?.methods.find((m) => m.name === get().selectedMethod)
  },

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)

    const currentKey = state._currentTabId === null ? '__null__' : state._currentTabId
    tabStates.set(currentKey, extractState(state))

    const target = tabStates.get(tabId) || emptyTabState()

    set({
      ...target,
      _tabStates: tabStates,
      _currentTabId: tabId,
    })
  },

  removeTabState: (tabId) => {
    const tabStates = new Map(get()._tabStates)
    const removed = tabStates.get(tabId)
    if (removed?.streamUnsubscribe) {
      removed.streamUnsubscribe()
    }
    tabStates.delete(tabId)
    set({ _tabStates: tabStates })

    if (get()._currentTabId === tabId) {
      const liveUnsub = get().streamUnsubscribe
      if (liveUnsub && liveUnsub !== removed?.streamUnsubscribe) liveUnsub()
      set({ streamUnsubscribe: null })
    }
  },

  reset: () => {
    const prev = get().streamUnsubscribe
    if (prev) prev()
    set({ ...emptyTabState() })
  },
}))

attachTabbedPersist(useGrpcStore, STORAGE_KEY, extractState, (s) => ({
  _tabStates: s._tabStates,
  _currentTabId: s._currentTabId,
}))
