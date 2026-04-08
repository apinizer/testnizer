import { create } from 'zustand'
import type { KeyValuePair, ApiResponse } from '../types'
import { useResponseStore } from './response.store'
import { useTabsStore } from './tabs.store'

function makeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
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
  isLoading: false,
  isStreaming: false,
  errorMessage: null,

  setAddress: (address) => set({ address }),
  setUseTls: (useTls) => set({ useTls }),

  loadProto: async () => {
    set({ isLoading: true, errorMessage: null })

    try {
      const result = await window.api?.request?.send({
        method: 'GRPC_LOAD_PROTO',
        url: '__internal__:grpc:loadProto',
        body: { type: 'text', content: '' },
      })

      if (result?.success && result.data) {
        const data = result.data as unknown as { services: GrpcService[]; protoPath: string }
        set({
          services: data.services,
          protoPath: data.protoPath,
          protoLoaded: true,
          isLoading: false,
        })

        // Auto-select first service/method
        if (data.services.length > 0) {
          const svc = data.services[0]
          set({ selectedService: svc.name })
          if (svc.methods.length > 0) {
            set({ selectedMethod: svc.methods[0].name })
          }
        }
      } else {
        set({
          errorMessage: result?.error || 'Failed to load proto file',
          isLoading: false,
        })
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
    const { address, useTls, selectedService, selectedMethod, requestBody, metadata } = get()
    if (!address.trim() || !selectedService || !selectedMethod) return

    const method = get().getSelectedMethod()
    const isStream = method?.type !== 'unary'

    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const activeTabId = tabsStore.activeTabId

    set({ isLoading: true, errorMessage: null, response: null, streamEvents: [] })
    if (isStream) set({ isStreaming: true })
    responseStore.setLoading(true)
    responseStore.clearResponse()
    if (activeTabId) tabsStore.markLoading(activeTabId, true)

    try {
      const result = await window.api?.request?.send({
        method: 'GRPC_CALL',
        url: `${useTls ? 'grpcs' : 'grpc'}://${address}/${selectedService}/${selectedMethod}`,
        headers: metadata.filter((m) => m.enabled && m.key.trim()),
        body: { type: 'json', content: requestBody },
      })

      if (result?.success && result.data) {
        const apiResp = result.data as ApiResponse
        set({ response: apiResp })
        responseStore.setResponse(apiResp)
      } else {
        const errResp: ApiResponse = {
          requestId: makeId(),
          protocol: 'grpc',
          error: result?.error || 'gRPC call failed',
          timing: { total: 0 },
        }
        set({ response: errResp })
        responseStore.setResponse(errResp)
      }
    } catch {
      // Demo mode
      if (isStream) {
        // Simulate streaming events
        let idx = 0
        const interval = setInterval(() => {
          const state = get()
          if (!state.isStreaming || idx >= 5) {
            clearInterval(interval)
            set({ isStreaming: false, isLoading: false })
            responseStore.setLoading(false)
            if (activeTabId) tabsStore.markLoading(activeTabId, false)
            return
          }
          set((s) => ({
            streamEvents: [
              ...s.streamEvents,
              {
                id: makeId(),
                data: JSON.stringify({ message: `Stream event #${idx + 1}`, timestamp: new Date().toISOString() }, null, 2),
                timestamp: Date.now(),
                index: idx,
              },
            ],
          }))
          idx++
        }, 1000)
      } else {
        const demoResp: ApiResponse = {
          requestId: makeId(),
          protocol: 'grpc',
          status: 0,
          statusText: 'OK',
          headers: { 'content-type': 'application/grpc' },
          body: JSON.stringify({ message: 'Hello from gRPC demo!' }, null, 2),
          bodySize: 40,
          timing: { total: 34 },
          actualRequest: {
            method: 'POST',
            url: `${address}/${selectedService}/${selectedMethod}`,
            headers: {},
            body: requestBody,
          },
        }
        set({ response: demoResp })
        responseStore.setResponse(demoResp)
      }
    } finally {
      if (!isStream) {
        set({ isLoading: false })
        responseStore.setLoading(false)
        if (activeTabId) tabsStore.markLoading(activeTabId, false)
      }
    }
  },

  cancelStream: async () => {
    set({ isStreaming: false, isLoading: false })
    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const activeTabId = tabsStore.activeTabId
    responseStore.setLoading(false)
    if (activeTabId) tabsStore.markLoading(activeTabId, false)

    try {
      await window.api?.request?.cancel('grpc-stream')
    } catch {
      // Ignore
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

  reset: () =>
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
      isLoading: false,
      isStreaming: false,
      errorMessage: null,
    }),
}))
