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
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { useTabsStore } from './tabs.store'
import { useEnvironmentStore } from './environment.store'
import { useWorkspaceStore } from './workspace.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { makeId } from '../lib/utils'
// Shared dirty-flag helper — flags the active tab's blue dot on a user edit so
// the unsaved-change indicator works for SOAP, not just HTTP (issue #8).
import { markActiveTabDirty } from '../lib/mark-dirty'

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
  /** Manual-mode SOAP Action + version — no WSDL operation to read them from
   *  (issue #17). Persisted per tab so they survive close/reopen. */
  manualSoapAction: string
  manualSoapVersion: 'soap11' | 'soap12'
}

interface SoapStore {
  wsdlUrl: string
  parsedWsdl: WsdlParseResult | null
  isLoading: boolean
  parseError: string | null
  /** request:send IPC id for the in-flight SOAP call (used for cancel). */
  _inflightRequestId: string | null

  selectedService: string | null
  selectedPort: string | null
  selectedOperation: string | null

  formValues: Record<string, string>
  rawXml: string
  bodyMode: 'form' | 'raw'

  wsSecurity: WsSecurityConfig

  /** The resolved SOAP endpoint URL (for sending) */
  endpointUrl: string

  /** Manual-mode SOAP Action + version (issue #17) */
  manualSoapAction: string
  manualSoapVersion: 'soap11' | 'soap12'

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
  setManualSoapAction: (action: string) => void
  setManualSoapVersion: (v: 'soap11' | 'soap12') => void
  setWsSecurity: (config: Partial<WsSecurityConfig>) => void
  sendSoap: () => Promise<void>
  cancelSoap: () => Promise<void>
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
    manualSoapAction: s.manualSoapAction,
    manualSoapVersion: s.manualSoapVersion,
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
    manualSoapAction: '',
    manualSoapVersion: 'soap11',
  }
}

const STORAGE_KEY = 'testnizer-soap'
const persisted = loadTabbedState<TabSoapState>(STORAGE_KEY, emptySoapTabState)

export const useSoapStore = create<SoapStore>((set, get) => ({
  ...persisted.current,
  // Backfill manual-mode fields for states persisted before they existed.
  manualSoapAction: persisted.current.manualSoapAction ?? '',
  manualSoapVersion: persisted.current.manualSoapVersion ?? 'soap11',
  // Transient — never restored
  isLoading: false,
  parseError: null,
  _inflightRequestId: null,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,

  setWsdlUrl: (url) => {
    set({ wsdlUrl: url })
    markActiveTabDirty()
  },

  parseWsdl: async () => {
    const rawUrl = get().wsdlUrl.trim()
    if (!rawUrl) return

    // Normalize URL: prepend https:// when no scheme is present, so users
    // can paste hostnames like "www.foo.com/svc?wsdl" without errors.
    const normalizedUrl =
      /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) || rawUrl.startsWith('file://')
        ? rawUrl
        : `https://${rawUrl}`

    if (normalizedUrl !== rawUrl) {
      set({ wsdlUrl: normalizedUrl })
    }

    set({ isLoading: true, parseError: null, parsedWsdl: null })

    try {
      const result = await window.api?.soap?.parseWsdl(normalizedUrl)

      if (result?.success && result.data) {
        const parsed = result.data
        set({ parsedWsdl: parsed, isLoading: false })

        // Auto-select first service/port/operation
        if (parsed.services.length > 0) {
          const svc = parsed.services[0]
          set({ selectedService: svc.name })
          if (svc.ports.length > 0) {
            const port = svc.ports[0]
            set({ selectedPort: port.name, endpointUrl: port.endpointUrl })
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
    } catch (e) {
      set({
        parseError: (e as Error).message || 'Failed to parse WSDL',
        isLoading: false,
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
    markActiveTabDirty()
  },

  selectPort: (name) => {
    const { parsedWsdl, selectedService } = get()
    set({ selectedPort: name, selectedOperation: null })
    const svc = parsedWsdl?.services.find((s) => s.name === selectedService)
    const port = svc?.ports.find((p) => p.name === name)
    if (port?.endpointUrl) {
      set({ endpointUrl: port.endpointUrl })
    }
    if (port && port.operations.length > 0) {
      const op = port.operations[0]
      set({
        selectedOperation: op.name,
        rawXml: op.exampleRequest,
        formValues: flattenSchema(op.inputSchema),
      })
    }
    markActiveTabDirty()
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
    markActiveTabDirty()
  },

  setFormValue: (key, value) => {
    set((state) => ({
      formValues: { ...state.formValues, [key]: value },
    }))
    markActiveTabDirty()
  },

  setFormValues: (values) => {
    set({ formValues: values })
    markActiveTabDirty()
  },

  setRawXml: (xml) => {
    set({ rawXml: xml })
    markActiveTabDirty()
  },

  setBodyMode: (mode) => {
    set({ bodyMode: mode })
    markActiveTabDirty()
  },

  setEndpointUrl: (url) => {
    set({ endpointUrl: url })
    markActiveTabDirty()
  },

  setManualSoapAction: (action) => {
    set({ manualSoapAction: action })
    markActiveTabDirty()
  },
  setManualSoapVersion: (v) => {
    set({ manualSoapVersion: v })
    markActiveTabDirty()
  },

  setWsSecurity: (config) => {
    set((state) => ({
      wsSecurity: { ...state.wsSecurity, ...config },
    }))
    markActiveTabDirty()
  },

  sendSoap: async () => {
    const { rawXml, wsSecurity, parsedWsdl, manualSoapAction, manualSoapVersion } = get()
    const responseStore = useResponseStore.getState()
    const tabsStore = useTabsStore.getState()
    const activeTabId = tabsStore.activeTabId

    responseStore.setLoading(true)
    responseStore.clearResponse()
    if (activeTabId) tabsStore.markLoading(activeTabId, true)

    const op = get().getSelectedOperation()
    const port = get().getSelectedPort()
    const endpointUrl = port?.endpointUrl || parsedWsdl?.endpointUrl || get().endpointUrl || ''

    const activeVars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedUrl = resolveVariables(endpointUrl, activeVars)
    const resolvedXml = resolveVariables(rawXml, activeVars)
    // The SOAP Action and version come from the selected WSDL operation when
    // one is loaded, otherwise from the manual form (issue #17 — manual mode
    // had no WSDL op, so the action was always empty). Transport rules differ
    // by version:
    //   SOAP 1.1 → quoted `SOAPAction:` HTTP header
    //   SOAP 1.2 → `action="…"` parameter inside the Content-Type, no SOAPAction
    const effectiveVersion = op ? (parsedWsdl?.soapVersion ?? 'soap11') : manualSoapVersion
    const resolvedSoapAction = resolveVariables(
      op?.soapAction || manualSoapAction || '',
      activeVars,
    )
    const headerPairs =
      effectiveVersion === 'soap12'
        ? [
            {
              key: 'Content-Type',
              value: resolvedSoapAction
                ? `application/soap+xml; charset=utf-8; action="${resolvedSoapAction}"`
                : 'application/soap+xml; charset=utf-8',
              enabled: true,
            },
          ]
        : [
            { key: 'Content-Type', value: 'text/xml; charset=utf-8', enabled: true },
            // SOAP 1.1 requires the action quoted; an unquoted/empty value is
            // what the server rejected in the report.
            { key: 'SOAPAction', value: `"${resolvedSoapAction}"`, enabled: true },
          ]
    const resolvedHeaders = resolveKeyValuePairs(headerPairs, activeVars)
    const resolvedWsseUsername = resolveVariables(
      wsSecurity.usernameToken?.username || wsSecurity.username || '',
      activeVars,
    )
    const resolvedWssePassword = resolveVariables(
      wsSecurity.usernameToken?.password || wsSecurity.password || '',
      activeVars,
    )

    const requestId = makeId()
    set({ _inflightRequestId: requestId })
    try {
      const ws = useWorkspaceStore.getState()
      const result = await window.api?.request?.send({
        method: 'POST',
        url: resolvedUrl,
        headers: resolvedHeaders,
        body: { type: 'xml', content: resolvedXml },
        auth: wsSecurity.enabled
          ? {
              type: 'basic',
              basic: {
                username: resolvedWsseUsername,
                password: resolvedWssePassword,
              },
            }
          : undefined,
        _protocol: 'soap',
        _requestId: requestId,
        _workspaceId: ws.activeWorkspaceId || undefined,
        _projectId: ws.activeProjectId || undefined,
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
      set((s) => (s._inflightRequestId === requestId ? { _inflightRequestId: null } : s))
    }
  },

  cancelSoap: async () => {
    const id = get()._inflightRequestId
    if (!id) return
    try {
      await window.api?.request?.cancel(id)
    } catch {
      // engine already finished
    }
    set({ _inflightRequestId: null })
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

    // Load target tab state (or empty for new tabs). Merge over the empty
    // state so fields added later (manual SOAP action/version) default cleanly
    // for cache entries persisted before they existed.
    const target = { ...emptySoapTabState(), ...tabStates.get(tabId) }

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

attachTabbedPersist(useSoapStore, STORAGE_KEY, extractSoapTabState, (s) => ({
  _tabStates: s._tabStates,
  _currentTabId: s._currentTabId,
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
