import { create } from 'zustand'
import type {
  WsdlParseResult,
  WsdlService,
  WsdlPort,
  WsdlOperation,
  WsSecurityConfig,
  ApiResponse,
} from '../types'
import { useResponseStore } from './response.store'
import { useTabsStore } from './tabs.store'

function makeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

/** SOAP metadata stored in endpoint request_schema.soap */
interface SoapEndpointMeta {
  wsdlUrl?: string
  serviceName?: string
  portName?: string
  operationName?: string
  soapAction?: string
  soapVersion?: 'soap11' | 'soap12'
  endpointUrl?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  exampleRequest?: string
  exampleResponse?: string
}

/** Snapshot of SOAP state for per-tab caching */
interface TabSoapState {
  wsdlUrl: string
  parsedWsdl: WsdlParseResult | null
  selectedService: string | null
  selectedPort: string | null
  selectedOperation: string | null
  formValues: Record<string, string>
  rawXml: string
  bodyMode: 'form' | 'raw'
  wsSecurity: WsSecurityConfig
  endpointUrl: string
}

interface SoapStore {
  wsdlUrl: string
  parsedWsdl: WsdlParseResult | null
  isLoading: boolean
  parseError: string | null

  selectedService: string | null
  selectedPort: string | null
  selectedOperation: string | null

  formValues: Record<string, string>
  rawXml: string
  bodyMode: 'form' | 'raw'

  wsSecurity: WsSecurityConfig

  /** The resolved SOAP endpoint URL (for sending) */
  endpointUrl: string

  /** Per-tab state cache */
  _tabStates: Map<string, TabSoapState>
  _currentTabId: string | null

  setWsdlUrl: (url: string) => void
  parseWsdl: () => Promise<void>
  selectService: (name: string) => void
  selectPort: (name: string) => void
  selectOperation: (name: string) => void
  setFormValue: (key: string, value: string) => void
  setFormValues: (values: Record<string, string>) => void
  setRawXml: (xml: string) => void
  setBodyMode: (mode: 'form' | 'raw') => void
  setEndpointUrl: (url: string) => void
  setWsSecurity: (config: Partial<WsSecurityConfig>) => void
  sendSoap: () => Promise<void>
  reset: () => void

  /** Load SOAP data from an imported endpoint's request_schema */
  loadFromEndpoint: (data: {
    url: string
    body?: { type: string; content?: string }
    headers?: Array<{ key: string; value: string; enabled: boolean }>
    soap?: SoapEndpointMeta
  }) => void

  /** Switch active tab — saves current state and loads target tab state */
  switchToTab: (tabId: string) => void
  /** Remove cached state for a closed tab */
  removeTabState: (tabId: string) => void

  getSelectedService: () => WsdlService | undefined
  getSelectedPort: () => WsdlPort | undefined
  getSelectedOperation: () => WsdlOperation | undefined
}

const defaultWsSecurity: WsSecurityConfig = {
  enabled: false,
  modes: [],
  signFirst: true,
  usernameToken: {
    username: '',
    password: '',
    passwordType: 'PasswordText',
    nonce: false,
    created: false,
  },
  timestamp: { ttlSeconds: 300 },
  sign: {
    privateKeyPem: '',
    certPem: '',
    algorithm: 'RSA-SHA256',
    references: ['Body'],
    keyInfoStrategy: 'BinarySecurityToken',
  },
  encrypt: {
    recipientCertPem: '',
    algorithm: 'AES-256-CBC',
    keyWrap: 'RSA-OAEP',
  },
}

function extractSoapTabState(s: SoapStore): TabSoapState {
  return {
    wsdlUrl: s.wsdlUrl,
    parsedWsdl: s.parsedWsdl,
    selectedService: s.selectedService,
    selectedPort: s.selectedPort,
    selectedOperation: s.selectedOperation,
    formValues: s.formValues,
    rawXml: s.rawXml,
    bodyMode: s.bodyMode,
    wsSecurity: s.wsSecurity,
    endpointUrl: s.endpointUrl,
  }
}

function emptySoapTabState(): TabSoapState {
  return {
    wsdlUrl: '',
    parsedWsdl: null,
    selectedService: null,
    selectedPort: null,
    selectedOperation: null,
    formValues: {},
    rawXml: '',
    bodyMode: 'raw',
    wsSecurity: { ...defaultWsSecurity },
    endpointUrl: '',
  }
}

export const useSoapStore = create<SoapStore>((set, get) => ({
  wsdlUrl: '',
  parsedWsdl: null,
  isLoading: false,
  parseError: null,

  selectedService: null,
  selectedPort: null,
  selectedOperation: null,

  formValues: {},
  rawXml: '',
  bodyMode: 'raw',

  wsSecurity: { ...defaultWsSecurity },

  endpointUrl: '',

  _tabStates: new Map(),
  _currentTabId: null,

  setWsdlUrl: (url) => set({ wsdlUrl: url }),

  parseWsdl: async () => {
    const { wsdlUrl } = get()
    if (!wsdlUrl.trim()) return

    set({ isLoading: true, parseError: null, parsedWsdl: null })

    try {
      const result = await window.api?.request?.send({
        method: 'POST',
        url: '__internal__:soap:parseWsdl',
        body: { type: 'text', content: wsdlUrl },
      })

      if (result?.success && result.data) {
        const parsed = (result.data as unknown as { parsedWsdl: WsdlParseResult }).parsedWsdl
        set({ parsedWsdl: parsed, isLoading: false })

        // Auto-select first service/port/operation
        if (parsed.services.length > 0) {
          const svc = parsed.services[0]
          set({ selectedService: svc.name })
          if (svc.ports.length > 0) {
            const port = svc.ports[0]
            set({ selectedPort: port.name })
            if (port.operations.length > 0) {
              const op = port.operations[0]
              set({
                selectedOperation: op.name,
                rawXml: op.exampleRequest,
                formValues: flattenSchema(op.inputSchema),
              })
            }
          }
        }
      } else {
        set({
          parseError: result?.error || 'Failed to parse WSDL',
          isLoading: false,
        })
      }
    } catch {
      // Demo mode: generate sample WSDL data
      const demoResult: WsdlParseResult = {
        services: [
          {
            name: 'CalculatorService',
            ports: [
              {
                name: 'CalculatorPort',
                endpointUrl: get().wsdlUrl.replace('?wsdl', ''),
                operations: [
                  {
                    name: 'Add',
                    soapAction: 'http://calculator.example.com/Add',
                    inputSchema: { intA: 'int', intB: 'int' },
                    outputSchema: { AddResult: 'int' },
                    exampleRequest:
                      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cal="http://calculator.example.com/">\n  <soapenv:Header/>\n  <soapenv:Body>\n    <cal:Add>\n      <cal:intA>0</cal:intA>\n      <cal:intB>0</cal:intB>\n    </cal:Add>\n  </soapenv:Body>\n</soapenv:Envelope>',
                    exampleResponse:
                      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n  <soapenv:Body>\n    <AddResponse>\n      <AddResult>0</AddResult>\n    </AddResponse>\n  </soapenv:Body>\n</soapenv:Envelope>',
                  },
                  {
                    name: 'Subtract',
                    soapAction: 'http://calculator.example.com/Subtract',
                    inputSchema: { intA: 'int', intB: 'int' },
                    outputSchema: { SubtractResult: 'int' },
                    exampleRequest:
                      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cal="http://calculator.example.com/">\n  <soapenv:Header/>\n  <soapenv:Body>\n    <cal:Subtract>\n      <cal:intA>0</cal:intA>\n      <cal:intB>0</cal:intB>\n    </cal:Subtract>\n  </soapenv:Body>\n</soapenv:Envelope>',
                    exampleResponse:
                      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n  <soapenv:Body>\n    <SubtractResponse>\n      <SubtractResult>0</SubtractResult>\n    </SubtractResponse>\n  </soapenv:Body>\n</soapenv:Envelope>',
                  },
                ],
              },
            ],
          },
        ],
        endpointUrl: get().wsdlUrl.replace('?wsdl', ''),
        soapVersion: 'soap11',
        rawWsdl: '<!-- WSDL content -->',
      }

      set({ parsedWsdl: demoResult, isLoading: false })
      const svc = demoResult.services[0]
      const port = svc.ports[0]
      const op = port.operations[0]
      set({
        selectedService: svc.name,
        selectedPort: port.name,
        selectedOperation: op.name,
        rawXml: op.exampleRequest,
        formValues: flattenSchema(op.inputSchema),
      })
    }
  },

  selectService: (name) => {
    const { parsedWsdl } = get()
    set({ selectedService: name, selectedPort: null, selectedOperation: null })
    const svc = parsedWsdl?.services.find((s) => s.name === name)
    if (svc && svc.ports.length > 0) {
      const port = svc.ports[0]
      set({ selectedPort: port.name })
      if (port.operations.length > 0) {
        const op = port.operations[0]
        set({
          selectedOperation: op.name,
          rawXml: op.exampleRequest,
          formValues: flattenSchema(op.inputSchema),
        })
      }
    }
  },

  selectPort: (name) => {
    const { parsedWsdl, selectedService } = get()
    set({ selectedPort: name, selectedOperation: null })
    const svc = parsedWsdl?.services.find((s) => s.name === selectedService)
    const port = svc?.ports.find((p) => p.name === name)
    if (port && port.operations.length > 0) {
      const op = port.operations[0]
      set({
        selectedOperation: op.name,
        rawXml: op.exampleRequest,
        formValues: flattenSchema(op.inputSchema),
      })
    }
  },

  selectOperation: (name) => {
    const op = get()
      .getSelectedPort()
      ?.operations.find((o) => o.name === name)
    set({ selectedOperation: name })
    if (op) {
      set({
        rawXml: op.exampleRequest,
        formValues: flattenSchema(op.inputSchema),
      })
    }
  },

  setFormValue: (key, value) =>
    set((state) => ({
      formValues: { ...state.formValues, [key]: value },
    })),

  setFormValues: (values) => set({ formValues: values }),

  setRawXml: (xml) => set({ rawXml: xml }),

  setBodyMode: (mode) => set({ bodyMode: mode }),

  setEndpointUrl: (url) => set({ endpointUrl: url }),

  setWsSecurity: (config) =>
    set((state) => ({
      wsSecurity: { ...state.wsSecurity, ...config },
    })),

  sendSoap: async () => {
    const { rawXml, wsSecurity, parsedWsdl, selectedService, selectedPort, selectedOperation } =
      get()
    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const activeTabId = tabsStore.activeTabId

    responseStore.setLoading(true)
    responseStore.clearResponse()
    if (activeTabId) tabsStore.markLoading(activeTabId, true)

    const op = get().getSelectedOperation()
    const port = get().getSelectedPort()
    const endpointUrl = port?.endpointUrl || parsedWsdl?.endpointUrl || get().endpointUrl || ''

    try {
      const result = await window.api?.request?.send({
        method: 'POST',
        url: endpointUrl,
        headers: [
          { id: '1', key: 'Content-Type', value: 'text/xml; charset=utf-8', enabled: true },
          { id: '2', key: 'SOAPAction', value: op?.soapAction || '', enabled: true },
        ],
        body: { type: 'xml', content: rawXml },
        auth: wsSecurity.enabled
          ? {
              type: 'basic',
              basic: {
                username: wsSecurity.usernameToken?.username || wsSecurity.username || '',
                password: wsSecurity.usernameToken?.password || wsSecurity.password || '',
              },
            }
          : undefined,
      })

      if (result?.success && result.data) {
        responseStore.setResponse(result.data as ApiResponse)
      } else {
        responseStore.setResponse({
          requestId: makeId(),
          protocol: 'soap',
          error: result?.error || 'SOAP request failed',
          timing: { total: 0 },
        })
      }
    } catch {
      // Demo mode
      responseStore.setResponse({
        requestId: makeId(),
        protocol: 'soap',
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/xml; charset=utf-8' },
        body:
          op?.exampleResponse ||
          '<soap:Envelope><soap:Body><Response/></soap:Body></soap:Envelope>',
        bodySize: (op?.exampleResponse || '').length,
        timing: { total: 245 },
        actualRequest: {
          method: 'POST',
          url: endpointUrl,
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: op?.soapAction || '',
          },
          body: rawXml,
        },
      })
    } finally {
      responseStore.setLoading(false)
      if (activeTabId) tabsStore.markLoading(activeTabId, false)
    }
  },

  loadFromEndpoint: (data) => {
    const soapMeta = data.soap
    const xmlBody = data.body?.content || soapMeta?.exampleRequest || ''
    const endpointUrl = soapMeta?.endpointUrl || data.url || ''

    if (soapMeta) {
      // Build a synthetic WsdlParseResult from stored metadata
      const operation: WsdlOperation = {
        name: soapMeta.operationName || 'Unknown',
        soapAction: soapMeta.soapAction || '',
        inputSchema: soapMeta.inputSchema || {},
        outputSchema: soapMeta.outputSchema || {},
        exampleRequest: soapMeta.exampleRequest || '',
        exampleResponse: soapMeta.exampleResponse || '',
      }

      const port: WsdlPort = {
        name: soapMeta.portName || 'Port',
        endpointUrl,
        operations: [operation],
      }

      const service: WsdlService = {
        name: soapMeta.serviceName || 'Service',
        ports: [port],
      }

      const syntheticWsdl: WsdlParseResult = {
        services: [service],
        endpointUrl,
        soapVersion: soapMeta.soapVersion || 'soap11',
        rawWsdl: '',
      }

      set({
        wsdlUrl: soapMeta.wsdlUrl || '',
        parsedWsdl: syntheticWsdl,
        isLoading: false,
        parseError: null,
        selectedService: service.name,
        selectedPort: port.name,
        selectedOperation: operation.name,
        rawXml: xmlBody,
        bodyMode: 'raw',
        formValues: flattenSchema(operation.inputSchema),
        endpointUrl,
      })
    } else {
      // No SOAP metadata — just load raw XML
      set({
        wsdlUrl: '',
        parsedWsdl: null,
        isLoading: false,
        parseError: null,
        selectedService: null,
        selectedPort: null,
        selectedOperation: null,
        rawXml: xmlBody,
        bodyMode: 'raw',
        formValues: {},
        endpointUrl,
      })
    }
  },

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)

    // Save current tab state
    if (state._currentTabId) {
      tabStates.set(state._currentTabId, extractSoapTabState(state))
    }

    // Load target tab state (or empty for new tabs)
    const target = tabStates.get(tabId) || emptySoapTabState()

    set({
      ...target,
      isLoading: false,
      parseError: null,
      _tabStates: tabStates,
      _currentTabId: tabId,
    })
  },

  removeTabState: (tabId) => {
    const tabStates = new Map(get()._tabStates)
    tabStates.delete(tabId)
    set({ _tabStates: tabStates })
  },

  reset: () =>
    set({
      wsdlUrl: '',
      parsedWsdl: null,
      isLoading: false,
      parseError: null,
      selectedService: null,
      selectedPort: null,
      selectedOperation: null,
      formValues: {},
      rawXml: '',
      bodyMode: 'raw',
      wsSecurity: { ...defaultWsSecurity },
      endpointUrl: '',
    }),

  getSelectedService: () => {
    const { parsedWsdl, selectedService } = get()
    return parsedWsdl?.services.find((s) => s.name === selectedService)
  },

  getSelectedPort: () => {
    const svc = get().getSelectedService()
    return svc?.ports.find((p) => p.name === get().selectedPort)
  },

  getSelectedOperation: () => {
    const port = get().getSelectedPort()
    return port?.operations.find((o) => o.name === get().selectedOperation)
  },
}))

function flattenSchema(schema: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(schema)) {
    if (typeof val === 'string') {
      result[key] = ''
    } else if (typeof val === 'object' && val !== null) {
      const nested = flattenSchema(val as Record<string, unknown>)
      for (const [nk, nv] of Object.entries(nested)) {
        result[`${key}.${nk}`] = nv
      }
    }
  }
  return result
}
